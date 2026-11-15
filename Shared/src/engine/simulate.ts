import type { BurndownPoint, Check, RuleId, Segment, Stop } from '../contracts/types';
import { pandolfSanteeMars, horizDistM } from './costModel';
import type { Resolved } from './fields';
import { heatAfterRest, heatAfterWork, restNeeded, REST_W, type HeatParams } from './heat';
import { ltstAt, sunAtLtst } from './marstime';
import { doseEqRateUSvPerMin } from './radiation';

/** Finite sentinel for JSON-safe outputs (PlanResult travels as JSON). */
export const BIG = 9999;
export const fin = (x: number): number => (x === x ? (x > BIG ? BIG : x < -BIG ? -BIG : x) : BIG);

/** Timeline + limits shared by the DP and the simulator (all times EVA minutes). */
export interface Timeline {
  /** Surface start (egress done) — egress/ingress overhead split evenly (team assumption). */
  s0: number;
  ingressHalf: number;
  /** Available surface minutes (EVA max − egress/ingress − EVA_CUT). Contingency O₂ never used. */
  A: number;
  tStart: number;
  /** Walkback deadline: elapsed + walkback(p) ≤ available ⇔ t + walkback(p) ≤ deadline. */
  deadline: number;
  /** Return-to-hab deadline from the EVA duration (= deadline). */
  evaDeadline: number;
  /** Return-to-hab deadline from daylight (sun ≥ threshold until the end of ingress). */
  dayDeadline: number;
  /** EVA duration limit (EVA minutes) used by the duration check. */
  evaLimit: number;
  lsDeg: number;
  latDeg: number;
  startLtstMin: number;
}

export interface SimStop {
  id: string;
  cell: number;
  dwellMin: number;
  taskW: number;
  value: number;
}

export interface SimInput {
  R: Resolved;
  tl: Timeline;
  hp: HeatParams;
  H0: number;
  startLabel: string;
  /** legs[k] = path cells of leg k (inclusive); leg k ends at stops[k] (k < stops.length) or at the hab. */
  legs: number[][];
  stops: SimStop[];
  endLabel: string;
  /** Rules to check (enforced ones only). */
  checks: Set<RuleId>;
  /** For SEP returns: shelter ETA limit (min from tStart) under shelter_time_max_min. */
  shelterEtaLimit?: number;
}

export interface SimOutput {
  pass: boolean;
  failures: { rule: RuleId; seg: number; worst: number; limit: number }[];
  segments: Segment[];
  stops: Stop[];
  burndown: BurndownPoint[];
  tReturn: number;
  distM: number;
  energyKJ: number;
  doseUSv: number;
  /** Same route with no terrain shielding (open sky everywhere): the dose without the skyview term. */
  doseOpenSkyUSv: number;
  maxDistHabM: number;
  /** Latest departure (EVA min) from each stop keeping every time-dependent hard rule. */
  latestDepart: number[];
  /** Earliest time at which the return deadline binds (for the HAB bingo). */
  returnBy: number;
}

interface Acc {
  worst: number;
  atCell: number;
  atMin: number;
}

/** Rules where larger is worse (worst = max); daylight is the only "min" rule. */
const isMinRule = (r: RuleId) => r === 'daylight_min_sun_elev_deg';

export function simulate(inp: SimInput): SimOutput {
  const { R, tl, hp, stops } = inp;
  const { grid, fields, ctx1, w, cellM, rv } = R;
  const model = R.model;
  const powerFn = model.edgePowerW ? model.edgePowerW.bind(model) : pandolfSanteeMars.edgePowerW!.bind(pandolfSanteeMars);
  const elev = grid.elev, slope = grid.slopeDeg, mask = R.mask;
  const wb = fields.walkbackMin, sh = fields.shelterMin, los = fields.los;
  const sky = R.pack.rasters.skyview;
  const habR = (R.hab / w) | 0, habC = R.hab - habR * w;
  const distHab = (c: number) => {
    const r = (c / w) | 0;
    return Math.hypot(r - habR, c - r * w - habC) * cellM;
  };
  const sunAt = (t: number) => sunAtLtst(tl.lsDeg, ltstAt(tl.startLtstMin, t), tl.latDeg).elevDeg;
  const on = inp.checks;

  const segments: Segment[] = [];
  const stopRows: Stop[] = [];
  const burndown: BurndownPoint[] = [];
  const failures: SimOutput['failures'] = [];
  // bingo bookkeeping: time-ordered slack samples
  const slackT: number[] = [];
  const slackV: number[] = [];
  const departIdx: number[] = [];
  const losRunPeakAtDepart: number[] = [];
  const pendingStops: number[] = [];

  let t = tl.tStart, H = inp.H0, gap = 0;
  let energyJ = 0, dose = 0, doseOpen = 0, distM = 0, maxDistHab = 0;
  let nextSample = t;
  let curP = REST_W;
  let blockedHit = false;

  const sample = (cell: number, force = false) => {
    if (!force && t < nextSample) return;
    nextSample = Math.floor(t) + 1;
    burndown.push({
      tMin: t,
      distHabM: distHab(cell),
      elevM: fin(elev[cell]),
      o2Pct: Math.max(0, Math.min(100, (100 * (tl.deadline - t)) / tl.A)),
      walkbackMarginMin: fin(tl.deadline - t - wb[cell]),
      shelterMarginMin: fin(rv.shelterMax - sh[cell]),
      metW: curP,
      heatAvgW: H,
      inLos: los[cell] === 1,
      sunElevDeg: sunAt(t),
    });
  };

  let accs = new Map<RuleId, Acc>();
  const note = (rule: RuleId, value: number, cell: number) => {
    if (!on.has(rule)) return;
    const a = accs.get(rule);
    if (!a) accs.set(rule, { worst: value, atCell: cell, atMin: t });
    else if (isMinRule(rule) ? value < a.worst : value > a.worst) {
      a.worst = value;
      a.atCell = cell;
      a.atMin = t;
    }
  };
  const slackSample = (cell: number) => {
    slackT.push(t);
    slackV.push(rv.wbOn ? tl.deadline - (t + wb[cell]) : Infinity);
  };
  let runPeak = 0;
  const trackGap = (cell: number, inc: number) => {
    if (los[cell] === 1) {
      gap = 0;
    } else {
      gap += inc;
    }
    if (gap > runPeak) runPeak = gap;
    if (gap === 0) {
      for (const i of pendingStops) losRunPeakAtDepart[i] = runPeak;
      pendingStops.length = 0;
      runPeak = 0;
    }
  };
  const pointChecks = (cell: number) => {
    note('walkback_speed_factor', t - tl.s0 + wb[cell], cell);
    note('shelter_time_max_min', sh[cell], cell);
    note('los_gap_max_min', gap, cell);
    note('daylight_min_sun_elev_deg', sunAt(t), cell);
    note('heat_avg_max_w', H, cell);
    slackSample(cell);
  };
  const doRest = (cell: number, minutes: number) => {
    let left = minutes;
    curP = REST_W;
    while (left > 1e-12) {
      const d = left > 1 ? 1 : left;
      H = heatAfterRest(H, d, hp);
      t += d;
      energyJ += REST_W * d * 60;
      dose += doseEqRateUSvPerMin(elev[cell], sky?.[cell]) * d;
      doseOpen += doseEqRateUSvPerMin(elev[cell]) * d;
      trackGap(cell, d);
      pointChecks(cell);
      sample(cell);
      left -= d;
    }
  };
  const fail = (rule: RuleId, seg: number, worst: number, limit: number) => failures.push({ rule, seg, worst, limit });

  sample(inp.legs[0]?.[0] ?? R.hab, true);
  if (inp.legs[0]?.length) trackGap(inp.legs[0][0], 0);

  for (let s = 0; s < inp.legs.length; s++) {
    const cells = inp.legs[s];
    const isStop = s < stops.length;
    const to = isStop ? stops[s].id : inp.endLabel;
    const from = s === 0 ? inp.startLabel : stops[s - 1].id;
    accs = new Map();
    const t0 = t;
    let segDist = 0, segEnergy = 0, segRest = 0;
    for (const c of cells) {
      note('slope_max_deg', mask[c] ? 90 : slope[c], c);
      note('walk_radius_max_m', distHab(c), c);
      if (mask[c]) blockedHit = true;
      const dh = distHab(c);
      if (dh > maxDistHab) maxDistHab = dh;
    }
    if (cells.length) pointChecks(cells[0]);
    for (let k = 1; k < cells.length; k++) {
      const u = cells[k - 1], v = cells[k];
      let dtMin = model.edgeCost(grid, u, v, ctx1) / 60;
      if (!(dtMin < Infinity)) {
        blockedHit = true;
        const d = horizDistM(grid, u, v);
        dtMin = d / R.crew.v0 / 60;
      }
      const P = powerFn(grid, u, v, ctx1);
      const rn = restNeeded(H, dtMin, P, hp);
      if (rn < 0) {
        note('heat_avg_max_w', BIG, u);
      } else if (rn > 0) {
        const e0 = energyJ;
        doRest(u, rn);
        segRest += rn;
        segEnergy += energyJ - e0;
      }
      curP = P;
      H = heatAfterWork(H, dtMin, P, hp);
      t += dtMin;
      energyJ += P * dtMin * 60;
      segEnergy += P * dtMin * 60;
      dose += doseEqRateUSvPerMin(elev[v], sky?.[v]) * dtMin;
      doseOpen += doseEqRateUSvPerMin(elev[v]) * dtMin;
      const dz = elev[v] - elev[u];
      const hd = horizDistM(grid, u, v);
      const len = Math.sqrt(hd * hd + (dz === dz ? dz * dz : 0));
      distM += len;
      segDist += len;
      trackGap(v, dtMin);
      pointChecks(v);
      sample(v);
    }
    const t1 = t;
    if (isStop) {
      const st = stops[s];
      const cell = st.cell;
      const arrive = t;
      let left = st.dwellMin;
      while (left > 1e-12) {
        const d = left > 1 ? 1 : left;
        const rn = restNeeded(H, d, st.taskW, hp);
        if (rn < 0) note('heat_avg_max_w', BIG, cell);
        else if (rn > 0) {
          doRest(cell, rn);
          segRest += rn;
        }
        curP = st.taskW;
        H = heatAfterWork(H, d, st.taskW, hp);
        t += d;
        energyJ += st.taskW * d * 60;
        dose += doseEqRateUSvPerMin(elev[cell], sky?.[cell]) * d;
        doseOpen += doseEqRateUSvPerMin(elev[cell]) * d;
        trackGap(cell, d);
        pointChecks(cell);
        sample(cell);
        left -= d;
      }
      stopRows.push({ id: st.id, arriveMin: arrive, departMin: t, arriveLtstMin: ltstAt(tl.startLtstMin, arrive) });
      departIdx.push(slackT.length);
      losRunPeakAtDepart.push(gap);
      if (gap > 0) pendingStops.push(stopRows.length - 1);
    } else {
      // back at the hab (or shelter): EVA ends after ingress
      const evaEnd = t + tl.ingressHalf;
      note('eva_duration_max_min', evaEnd, cells[cells.length - 1] ?? R.hab);
      if (on.has('daylight_min_sun_elev_deg')) {
        const tt = t;
        t = evaEnd;
        note('daylight_min_sun_elev_deg', sunAt(evaEnd), cells[cells.length - 1] ?? R.hab);
        t = tt;
      }
      if (inp.shelterEtaLimit !== undefined) note('shelter_time_max_min', t - tl.tStart, cells[cells.length - 1] ?? R.hab);
    }
    // build checks
    const checks: Check[] = [];
    for (const [rule, a] of accs) {
      let limit: number;
      switch (rule) {
        case 'slope_max_deg': limit = rv.slopeMax; break;
        case 'walk_radius_max_m': limit = rv.radiusMax; break;
        case 'shelter_time_max_min': limit = inp.shelterEtaLimit ?? rv.shelterMax; break;
        case 'walkback_speed_factor': limit = tl.deadline - tl.s0; break;
        case 'los_gap_max_min': limit = rv.gapMax; break;
        case 'daylight_min_sun_elev_deg': limit = rv.sunMin; break;
        case 'heat_avg_max_w': limit = hp.budgetW; break;
        case 'eva_duration_max_min': limit = tl.evaLimit; break;
        default: limit = Infinity;
      }
      const min = isMinRule(rule);
      const margin = min ? a.worst - limit : limit - a.worst;
      const pass = margin >= -1e-9;
      if (!pass) fail(rule, s, a.worst, limit);
      checks.push({ rule, worst: fin(a.worst), limit: fin(limit), margin: fin(margin), pass, atCell: a.atCell, atMin: a.atMin });
    }
    segments.push({ from, to, cells: cells.slice(), t0Min: t0, t1Min: t1, distM: segDist, energyKJ: segEnergy / 1000, restMin: segRest, checks });
  }
  for (const i of pendingStops) losRunPeakAtDepart[i] = runPeak;
  const lastCell = inp.legs.at(-1)?.at(-1) ?? R.hab;
  sample(lastCell, true);
  if (blockedHit && on.has('slope_max_deg') && !failures.some((f) => f.rule === 'slope_max_deg')) fail('slope_max_deg', 0, 90, rv.slopeMax);

  // bingo: latest departure = depart + min(slack after departure, return slack, LOS slack)
  const returnBy = Math.min(tl.evaDeadline, tl.dayDeadline);
  const retSlack = returnBy - t;
  const suffix = new Float64Array(slackV.length + 1);
  suffix[slackV.length] = retSlack;
  for (let i = slackV.length - 1; i >= 0; i--) suffix[i] = Math.min(slackV[i], suffix[i + 1]);
  const latestDepart = stopRows.map((st, i) => {
    let slack = suffix[departIdx[i]];
    if (rv.gapMax < Infinity && losRunPeakAtDepart[i] > 0) slack = Math.min(slack, rv.gapMax - losRunPeakAtDepart[i]);
    return st.departMin + slack;
  });

  return {
    pass: failures.length === 0,
    failures,
    segments,
    stops: stopRows,
    burndown,
    tReturn: t,
    distM,
    energyKJ: energyJ / 1000,
    doseUSv: dose,
    doseOpenSkyUSv: doseOpen,
    maxDistHabM: maxDistHab,
    latestDepart,
    returnBy,
  };
}
