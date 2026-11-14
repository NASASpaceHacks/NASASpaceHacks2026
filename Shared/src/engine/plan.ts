import type { LoadedSitePack } from '../contracts/sitepack';
import type { Bingo, Check, CostGrid, PlanRequest, PlanResult, Rule, RuleId, Segment } from '../contracts/types';
import { pointInRings } from './costGrid';
import { pandolfSanteeMars } from './costModel';
import { dialRun, DIST_INF, followParents } from './dial';
import { requestHash, resolve, ruleVals, type Resolved, type RuleVals } from './fields';
import { dwellChunks, HEAT_INITIAL_W, HEAT_TAU_MIN, REST_W, Seg, TASK_W_DEFAULT, type HeatParams } from './heat';
import { formatLtst, ltstAt, sunAtLtst } from './marstime';
import { evalSequence, solveDP, type DPResult, type Leg, type OrInstance } from './orienteer';
import { getPathSearch } from './registry';
import { fin, simulate, type SimOutput, type SimStop, type Timeline } from './simulate';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Ls assumed when the site pack has no REMS record for the requested sol (team assumption). */
export const DEFAULT_LS_DEG = 240;
/** Subsets simulated after the DP (by value), before falling back to single stations. */
export const TOP_SUBSETS = 20;
/** Binding analysis: relax each hard rule by 10 %. */
export const RELAX = 0.1;

export const RULE_SHORT: Record<RuleId, string> = {
  slope_max_deg: 'slope',
  slope_soft_deg: 'slope comfort',
  eva_duration_max_min: 'EVA duration',
  egress_ingress_min: 'egress/ingress overhead',
  contingency_o2_min: 'contingency O₂',
  walkback_speed_factor: 'walkback',
  shelter_time_max_min: 'shelter time',
  los_gap_max_min: 'comm LOS gap',
  daylight_min_sun_elev_deg: 'daylight',
  heat_avg_max_w: 'suit heat',
  walk_radius_max_m: 'walk radius',
  plume_keepout_m: 'keep-out',
};

interface Cand {
  id: string;
  cell: number;
  value: number;
  dwellMin: number;
  taskW: number;
}

interface LegX extends Leg {
  cells: number[];
  offs: Float64Array;
  wbs: Float64Array;
}

interface Dropped {
  id: string;
  rule: RuleId;
  deficitMin: number;
  text: string;
}

interface Core {
  R: Resolved;
  rv: RuleVals;
  tl: Timeline;
  hp: HeatParams;
  H0: number;
  startCell: number;
  startLabel: string;
  routeMask: Uint8Array;
  /** Candidate stations in the DP (index i ↔ DP node i+1). */
  cands: Cand[];
  pre: Dropped[];
  parents: Uint8Array[];
  inst: OrInstance;
}

// ─────────────────────────── timeline ───────────────────────────

function lsFor(pack: LoadedSitePack, sol: number): number | null {
  const r = pack.manifest.conditions?.rems?.find((x) => x.sol === sol);
  return r && Number.isFinite(r.ls) ? r.ls : null;
}

/** First EVA minute ≥ from at which the sun drops below sunMin (from itself if already below). */
function daylightUntil(ls: number, lat: number, startLtst: number, sunMin: number, from: number, to: number): number {
  if (sunMin === -Infinity) return Infinity;
  const el = (t: number) => sunAtLtst(ls, ltstAt(startLtst, t), lat).elevDeg;
  if (el(from) < sunMin) return from;
  let prev = from;
  for (let t = from + 1; t <= to + 1; t += 1) {
    if (el(t) < sunMin) {
      let lo = prev, hi = t;
      for (let i = 0; i < 30; i++) {
        const mid = 0.5 * (lo + hi);
        if (el(mid) < sunMin) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    prev = t;
  }
  return Infinity;
}

function makeTimeline(R: Resolved, req: PlanRequest, rv: RuleVals, ls: number): Timeline {
  const s0 = rv.egress / 2;
  const ingressHalf = rv.egress - s0;
  let cut = 0;
  for (const e of req.events ?? []) if (e.t === 'EVA_CUT') cut += e.min;
  const A = Math.max(0, rv.evaMax - rv.egress - cut);
  const tStart = req.resume ? Math.max(req.resume.elapsedMin, s0) : s0;
  const o2Used = req.resume ? Math.min(1, Math.max(0, req.resume.o2UsedPct / 100)) : 0;
  const deadline = req.resume ? Math.min(s0 + A, tStart + A * (1 - o2Used)) : s0 + A;
  const lat = R.gs.centerLonLat[1];
  const dark = daylightUntil(ls, lat, req.startLtstMin, rv.sunMin, tStart, deadline + ingressHalf + 1);
  return {
    s0, ingressHalf, A, tStart, deadline, evaDeadline: deadline, dayDeadline: dark - ingressHalf,
    evaLimit: deadline + ingressHalf, lsDeg: ls, latDeg: lat, startLtstMin: req.startLtstMin,
  };
}

// ─────────────────────────── core build (route mask, matrix, legs, DP instance) ───────────────────────────

function distHabFn(R: Resolved): (c: number) => number {
  const w = R.w, habR = (R.hab / w) | 0, habC = R.hab - habR * w;
  return (c: number) => {
    const r = (c / w) | 0;
    return Math.hypot(r - habR, c - r * w - habC) * R.cellM;
  };
}

function inKeepout(R: Resolved, cell: number): boolean {
  const w = R.w, r = (cell / w) | 0, c = cell - r * w;
  const x = R.gs.originX + (c + 0.5) * R.cellM, y = R.gs.originY - (r + 0.5) * R.cellM;
  return (R.pack.manifest.keepouts ?? []).some((k) => pointInRings(x, y, k.rings));
}

function buildLeg(R: Resolved, cells: number[], dwell: Cand | null, budgetW: number): LegX | null {
  const { grid, ctx1, fields } = R;
  const model = R.model;
  const powerFn = model.edgePowerW ? model.edgePowerW.bind(model) : pandolfSanteeMars.edgePowerW!.bind(pandolfSanteeMars);
  const los = fields.los, wb = fields.walkbackMin;
  const L = cells.length - 1;
  const dt: number[] = [], P: number[] = [];
  const offs = new Float64Array(L + 2), wbs = new Float64Array(L + 2);
  wbs[0] = wb[cells[0]];
  let T = 0, run = 0, lead = 0, maxInt = 0, seenLos = L === 0 && los[cells[0]] === 1;
  for (let k = 1; k <= L; k++) {
    const u = cells[k - 1], v = cells[k];
    const d = model.edgeCost(grid, u, v, ctx1) / 60;
    if (!(d < Infinity)) return null;
    dt.push(d);
    P.push(powerFn(grid, u, v, ctx1));
    T += d;
    offs[k] = T;
    wbs[k] = wb[v];
    if (los[v] === 1) {
      if (!seenLos) {
        lead = run;
        seenLos = true;
      } else if (run > maxInt) maxInt = run;
      run = 0;
    } else run += d;
  }
  let total = T;
  let n = L + 1;
  if (dwell) {
    for (const c of dwellChunks(dwell.dwellMin, dwell.taskW, budgetW)) {
      dt.push(c);
      P.push(dwell.taskW);
    }
    total += dwell.dwellMin;
    offs[n] = T + dwell.dwellMin;
    wbs[n] = wb[dwell.cell];
    n++;
    if (los[dwell.cell] !== 1) run += dwell.dwellMin;
  }
  let wbMax = -Infinity;
  for (let k = 0; k < n; k++) if (offs[k] + wbs[k] > wbMax) wbMax = offs[k] + wbs[k];
  const allNon = !seenLos;
  return {
    seg: new Seg(dt, P), allNon, total, lead: allNon ? total : lead, trail: allNon ? total : run, maxInt, wbMax,
    cells, offs: offs.subarray(0, n), wbs: wbs.subarray(0, n),
  };
}

function buildCore(R: Resolved, req: PlanRequest, tl: Timeline, rv: RuleVals): Core {
  const { w, h, n, fields } = R;
  const wb = fields.walkbackMin, sh = fields.shelterMin;
  const hp: HeatParams = { budgetW: rv.heatMax, restW: REST_W, tauMin: HEAT_TAU_MIN };
  const resume = req.resume;
  const startCell = resume ? resume.cell : R.hab;
  const startLabel = resume && resume.cell !== R.hab ? 'HERE' : 'HAB';
  const H0 = resume ? (rv.heatMax < Infinity ? rv.heatMax : HEAT_INITIAL_W) : Math.min(HEAT_INITIAL_W, rv.heatMax);
  const distHab = distHabFn(R);

  // Route mask: every cell a valid route may use. Exact per-cell rules (radius, shelter time) and a
  // loose static walkback prune (t ≥ tStart) — the DP and the simulator apply the exact checks.
  const loose = (tl.deadline - tl.tStart) * 1.25 + 1;
  const routeMask = R.mask.slice();
  for (let c = 0; c < n; c++) {
    if (routeMask[c]) continue;
    if (!(wb[c] < Infinity) || sh[c] > rv.shelterMax || (rv.wbOn && wb[c] > loose) || distHab(c) > rv.radiusMax) routeMask[c] = 1;
  }
  routeMask[R.hab] = 0;

  const visited = new Set(resume?.visited ?? []);
  const all = req.stations
    .filter((s) => !visited.has(s.id))
    .map((s) => ({ id: s.id, cell: s.cell, value: s.value, dwellMin: s.dwellMin, taskW: s.taskW ?? TASK_W_DEFAULT }));
  const pool = all.length > 15 ? [...all].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, 15) : all;
  const pre: Dropped[] = [];
  const text = (id: string, rule: RuleId, d: number) => `${id} dropped: ${RULE_SHORT[rule]}, −${Math.max(1, Math.ceil(d))} min`;
  const reachable: Cand[] = [];
  for (const s of all) {
    if (!pool.includes(s)) {
      pre.push({ id: s.id, rule: 'eva_duration_max_min', deficitMin: 0, text: `${s.id} dropped: only the 15 highest-value stations are planned` });
      continue;
    }
    const c = s.cell;
    const v0min = R.crew.v0 * 60;
    if (!(c >= 0 && c < n) || R.mask[c] || !(wb[c] < Infinity)) {
      const ko = c >= 0 && c < n && inKeepout(R, c);
      pre.push({ id: s.id, rule: ko ? 'plume_keepout_m' : 'slope_max_deg', deficitMin: 0, text: `${s.id} dropped: unreachable (${ko ? 'inside a keep-out zone' : 'steep or blocked terrain'})` });
    } else if (distHab(c) > rv.radiusMax) {
      const d = (distHab(c) - rv.radiusMax) / v0min;
      pre.push({ id: s.id, rule: 'walk_radius_max_m', deficitMin: d, text: text(s.id, 'walk_radius_max_m', d) });
    } else if (sh[c] > rv.shelterMax) {
      const d = sh[c] - rv.shelterMax;
      pre.push({ id: s.id, rule: 'shelter_time_max_min', deficitMin: d, text: text(s.id, 'shelter_time_max_min', d) });
    } else if (routeMask[c]) {
      const ob = startCell === R.hab ? fields.outboundMin[c] : 0;
      const d = tl.tStart + ob + s.dwellMin + wb[c] - tl.deadline;
      pre.push({ id: s.id, rule: 'walkback_speed_factor', deficitMin: d, text: text(s.id, 'walkback_speed_factor', d) });
    } else reachable.push(s);
  }

  // Pairwise matrix: one-to-many Dial from the start and from each station inside the route mask,
  // early exit once every target is settled. Asymmetric in general (cost models may be anisotropic).
  const T1 = R.TR;
  const targetsAll = [...reachable.map((s) => s.cell), R.hab];
  const srcCells = [startCell, ...reachable.map((s) => s.cell)];
  const parents: Uint8Array[] = [];
  const distTo: Float64Array[] = [];
  for (let i = 0; i < srcCells.length; i++) {
    const par = new Uint8Array(n);
    const res = dialRun({ tab: T1.fwd, maxEdge: T1.maxEdge, w, h, mask: routeMask, sources: [srcCells[i]], targets: targetsAll, parents: par });
    const d = new Float64Array(targetsAll.length);
    for (let j = 0; j < targetsAll.length; j++) d[j] = res.dist[targetsAll[j]] === DIST_INF ? Infinity : res.dist[targetsAll[j]];
    parents.push(par);
    distTo.push(d);
  }
  // stations the start cannot reach (or that cannot get home) inside the route mask
  const cands: Cand[] = [];
  const keepIdx: number[] = [];
  for (let j = 0; j < reachable.length; j++) {
    if (distTo[0][j] < Infinity && distTo[j + 1][reachable.length] < Infinity) {
      cands.push(reachable[j]);
      keepIdx.push(j);
    } else {
      const rule: RuleId = rv.shelterMax < Infinity ? 'shelter_time_max_min' : 'walk_radius_max_m';
      pre.push({ id: reachable[j].id, rule, deficitMin: 0, text: `${reachable[j].id} dropped: no route inside the shelter-time / radius limits` });
    }
  }
  const m = cands.length;
  const nodeSrc = [0, ...keepIdx.map((j) => j + 1)];
  const nodeTgt = [-1, ...keepIdx];
  const path = (srcNode: number, cell: number): number[] => followParents(parents[nodeSrc[srcNode]], w, cell).reverse();
  const legs: (LegX | null)[] = new Array((m + 1) * (m + 1)).fill(null);
  const rets: (LegX | null)[] = new Array(m + 1).fill(null);
  for (let i = 0; i <= m; i++) {
    const di = distTo[nodeSrc[i]];
    for (let j = 1; j <= m; j++) {
      if (i === j || !(di[nodeTgt[j]] < Infinity)) continue;
      legs[i * (m + 1) + j] = buildLeg(R, path(i, cands[j - 1].cell), cands[j - 1], rv.heatMax);
    }
    if (di[reachable.length] < Infinity) rets[i] = buildLeg(R, path(i, R.hab), null, rv.heatMax);
  }
  const inst: OrInstance = {
    n: m,
    values: [0, ...cands.map((c) => c.value)],
    legs,
    rets,
    wbAt: [0, ...cands.map((c) => wb[c.cell])],
    t0: tl.tStart,
    H0,
    g0: 0,
    deadline: tl.deadline,
    evaDeadline: tl.evaDeadline,
    dayDeadline: tl.dayDeadline,
    gapMax: rv.gapMax,
    wbOn: rv.wbOn,
    hp,
  };
  return { R, rv, tl, hp, H0, startCell, startLabel, routeMask, cands, pre, parents, inst };
}

function maskValue(inst: OrInstance, mask: number): number {
  let v = 0;
  for (let j = 1; j <= inst.n; j++) if (mask & (1 << (j - 1))) v += inst.values[j];
  return v;
}

function bestValue(dp: DPResult, inst: OrInstance): number {
  let best = 0;
  for (let mask = 1; mask < dp.bestEnd.length; mask++) if (dp.bestEnd[mask] < Infinity) best = Math.max(best, maskValue(inst, mask));
  return best;
}

function rankMasks(dp: DPResult, inst: OrInstance): number[] {
  const out: number[] = [];
  for (let mask = 1; mask < dp.bestEnd.length; mask++) if (dp.bestEnd[mask] < Infinity) out.push(mask);
  const val = new Map(out.map((m) => [m, maskValue(inst, m)]));
  out.sort((a, b) => val.get(b)! - val.get(a)! || dp.bestEnd[a] - dp.bestEnd[b] || a - b);
  return out;
}

function enforcedChecks(rv: RuleVals): Set<RuleId> {
  const s = new Set<RuleId>();
  if (rv.slopeMax < Infinity) s.add('slope_max_deg');
  if (rv.radiusMax < Infinity) s.add('walk_radius_max_m');
  if (rv.shelterMax < Infinity) s.add('shelter_time_max_min');
  if (rv.wbOn) s.add('walkback_speed_factor');
  if (rv.gapMax < Infinity) s.add('los_gap_max_min');
  if (rv.sunMin > -Infinity) s.add('daylight_min_sun_elev_deg');
  if (rv.heatMax < Infinity) s.add('heat_avg_max_w');
  s.add('eva_duration_max_min');
  return s;
}

/** Leg cells for an order, from the matrix trees (dijkstra) or the selected PathSearch. */
function legPaths(core: Core, order: number[], cache: Map<string, number[] | null>): number[][] | null {
  const { R } = core;
  const m = core.cands.length;
  const nodes = [0, ...order];
  const cellOf = (node: number) => (node === 0 ? core.startCell : core.cands[node - 1].cell);
  const out: number[][] = [];
  const get = (a: number, b: number, bCell: number): number[] | null => {
    if (R.pathSearchId === 'dijkstra') {
      const leg = b <= m && b > 0 ? (core.inst.legs[a * (m + 1) + b] as LegX | null) : (core.inst.rets[a] as LegX | null);
      return leg ? leg.cells : null;
    }
    const key = `${a}>${b}`;
    if (cache.has(key)) return cache.get(key)!;
    const ps = getPathSearch(R.pathSearchId);
    if (R.hazards.length) ps.update?.(R.hazards);
    const blocked = core.routeMask.slice();
    blocked[core.startCell] = 0;
    for (const c of core.cands) blocked[c.cell] = 0;
    blocked[R.hab] = 0;
    const g: CostGrid = { ...R.grid, blocked };
    const res = ps.search(g, R.routeModel, R.ctx1, cellOf(a), bCell);
    const cells = res ? Array.from(res.cells) : null;
    cache.set(key, cells);
    return cells;
  };
  for (let k = 1; k < nodes.length; k++) {
    const p = get(nodes[k - 1], nodes[k], cellOf(nodes[k]));
    if (!p) return null;
    out.push(p);
  }
  const back = get(nodes[nodes.length - 1], -1, R.hab);
  if (!back) return null;
  out.push(back);
  return out;
}

function simStops(core: Core, order: number[]): SimStop[] {
  return order.map((j) => {
    const c = core.cands[j - 1];
    return { id: c.id, cell: c.cell, dwellMin: c.dwellMin, taskW: c.taskW, value: c.value };
  });
}

// ─────────────────────────── result assembly ───────────────────────────

function marginsOf(segments: Segment[]): { margins: PlanResult['margins']; where: Map<RuleId, { seg: number; check: Check }> } {
  const margins: PlanResult['margins'] = {};
  const where = new Map<RuleId, { seg: number; check: Check }>();
  segments.forEach((s, i) => {
    for (const c of s.checks) {
      const cur = margins[c.rule];
      if (!cur || c.margin < cur.min) {
        margins[c.rule] = { min: c.margin, atMin: c.atMin };
        where.set(c.rule, { seg: i, check: c });
      }
    }
  });
  return { margins, where };
}

function emptyTotals(): PlanResult['totals'] {
  return { distM: 0, durationMin: 0, energyKJ: 0, o2UsedPct: 0, doseUSv: 0, scienceValue: 0, maxDistHabM: 0 };
}

function stayIn(
  R: Resolved, req: PlanRequest, t0: number, notes: string[], dropped: Dropped[], binding: PlanResult['binding'],
  tl: Timeline | null, rv: RuleVals,
): PlanResult {
  let segments: Segment[] = [];
  let burndown: PlanResult['burndown'] = [];
  let totals = emptyTotals();
  // Crew already outside: attach the contingency return to the hab (walkback tree) for reference.
  if (req.resume && req.resume.cell !== R.hab && tl && R.fields.walkbackMin[req.resume.cell] < Infinity) {
    const cells = followParents(R.fields.walkbackParents, R.w, req.resume.cell);
    const sim = simulate({
      R, tl, hp: { budgetW: rv.heatMax, restW: REST_W, tauMin: HEAT_TAU_MIN }, H0: rv.heatMax < Infinity ? rv.heatMax : HEAT_INITIAL_W,
      startLabel: 'HERE', legs: [cells], stops: [], endLabel: 'HAB', checks: enforcedChecks(rv),
    });
    segments = sim.segments;
    burndown = sim.burndown;
    totals = { ...totals, distM: sim.distM, durationMin: sim.tReturn + tl.ingressHalf, energyKJ: sim.energyKJ, doseUSv: sim.doseUSv, maxDistHabM: sim.maxDistHabM, o2UsedPct: fin(100 * (1 - (tl.deadline - sim.tReturn) / tl.A)) };
    notes.push('Crew is outside: the attached segment is the direct contingency return to the hab.');
  }
  return {
    status: 'STAY_IN',
    reqHash: requestHash(req),
    solveMs: now() - t0,
    planner: { pathSearch: R.pathSearchId, costModel: R.modelId },
    order: [],
    segments,
    stops: [],
    burndown,
    margins: {},
    binding,
    dropped,
    leaderboard: [],
    bingo: [],
    totals,
    notes,
  };
}

function modelNotes(lsAssumed: boolean, ls: number): string[] {
  const n = [
    'Metabolic model: Pandolf–Santee × g ratio (NASA JSC formulation, NTRS 20240001423); 0.38 g is an extrapolation of the 0.12–0.32 g calibration (NASA/TP-2010-216125).',
    'Suit heat: 30-min leaky-bucket average ≤ budget; rests at 250 W inserted by the governor.',
    'Radiation dose is indicative (Guo et al. 2015 pressure model; terrain shielding indicative, never a shelter).',
    'Comm LOS = hab mast ∪ pressurized-rover relay masts (team assumption: the rover carries a relay radio, cf. Apollo LRV LCRU).',
  ];
  if (lsAssumed) n.push(`Season: no REMS Ls for this sol, Ls ${ls}° assumed for daylight.`);
  return n;
}

function sepPlan(R: Resolved, req: PlanRequest, tl: Timeline, rv: RuleVals, leadMin: number, t0: number, notes: string[]): PlanResult {
  const start = req.resume?.cell ?? R.hab;
  const nameOf = (id: string) => R.pack.manifest.shelters.find((s) => s.id === id)?.name ?? id;
  const dropped: Dropped[] = req.stations
    .filter((s) => !(req.resume?.visited ?? []).includes(s.id))
    .map((s) => ({ id: s.id, rule: 'shelter_time_max_min' as RuleId, deficitMin: 0, text: `${s.id} dropped: SEP nowcast` }));
  if (!req.resume || start === R.hab) {
    return stayIn(R, req, t0, [...notes, 'SEP nowcast: remain in the habitat (pressurized shelter).'], dropped,
      { rule: 'shelter_time_max_min', text: `SEP nowcast: stay in ${nameOf(R.shelters.find((s) => s.cell === R.hab)?.id ?? 'HAB')}`, seg: -1 }, null, rv);
  }
  if (!(R.fields.shelterMin[start] < Infinity)) {
    return stayIn(R, req, t0, [...notes, 'SEP nowcast: no passable route to any shelter from the current position.'], dropped,
      { rule: 'shelter_time_max_min', text: 'SEP nowcast: no route to a shelter', seg: -1 }, tl, rv);
  }
  const cells = followParents(R.fields.shelterParents, R.w, start);
  const end = cells[cells.length - 1];
  const shelter = R.shelters.find((s) => s.cell === end) ?? { id: 'HAB', kind: 'hab', cell: end };
  const checks = new Set<RuleId>(['shelter_time_max_min']);
  if (rv.slopeMax < Infinity) checks.add('slope_max_deg');
  if (rv.heatMax < Infinity) checks.add('heat_avg_max_w');
  const limit = Math.min(leadMin, rv.shelterMax);
  const sim = simulate({
    R, tl, hp: { budgetW: rv.heatMax, restW: REST_W, tauMin: HEAT_TAU_MIN }, H0: rv.heatMax < Infinity ? rv.heatMax : HEAT_INITIAL_W,
    startLabel: 'HERE', legs: [cells], stops: [], endLabel: shelter.id, checks, shelterEtaLimit: limit,
  });
  const eta = sim.tReturn - tl.tStart;
  const out: PlanResult = {
    status: sim.pass ? 'OK' : 'STAY_IN',
    reqHash: requestHash(req),
    solveMs: now() - t0,
    planner: { pathSearch: R.pathSearchId, costModel: R.modelId },
    order: [],
    segments: sim.segments,
    stops: [],
    burndown: sim.burndown,
    margins: marginsOf(sim.segments).margins,
    binding: { rule: 'shelter_time_max_min', text: `SEP nowcast: return to ${nameOf(shelter.id)} now`, seg: 0 },
    dropped,
    leaderboard: [],
    bingo: [],
    totals: {
      distM: sim.distM, durationMin: sim.tReturn + tl.ingressHalf, energyKJ: sim.energyKJ,
      o2UsedPct: fin(100 * (1 - (tl.deadline - sim.tReturn) / tl.A)), doseUSv: sim.doseUSv, scienceValue: 0, maxDistHabM: sim.maxDistHabM,
    },
    notes: [
      ...notes,
      `SEP nowcast: shelter ETA ${eta.toFixed(1)} min vs ${limit.toFixed(0)} min allowed.`,
      ...(sim.pass ? [] : ['Shelter cannot be reached within the nowcast lead time — return immediately anyway.']),
    ],
  };
  return out;
}

// ─────────────────────────── binding analysis ───────────────────────────

function relaxedValue(core: Core, req: PlanRequest, rule: RuleId, rules: Rule[]): number | null {
  const { inst, rv, tl } = core;
  const R = core.R;
  const bump = (x: number) => x * (1 + RELAX);
  const solve = (i: OrInstance) => bestValue(solveDP(i), i);
  switch (rule) {
    case 'eva_duration_max_min': {
      const d = RELAX * rv.evaMax;
      return solve({ ...inst, deadline: inst.deadline + d, evaDeadline: inst.evaDeadline + d });
    }
    case 'egress_ingress_min': {
      const d = RELAX * rv.egress;
      return solve({ ...inst, deadline: inst.deadline + d, evaDeadline: inst.evaDeadline + d });
    }
    case 'walkback_speed_factor': {
      // walkback time ∝ 1/speed factor for time-linear cost models (pandolf-santee-mars)
      const s = 1 / (1 + RELAX);
      const scaleLeg = (l: Leg | null): Leg | null => {
        if (!l) return null;
        const x = l as LegX;
        let m = -Infinity;
        for (let k = 0; k < x.offs.length; k++) m = Math.max(m, x.offs[k] + x.wbs[k] * s);
        return { ...x, wbMax: m };
      };
      return solve({ ...inst, legs: inst.legs.map(scaleLeg), rets: inst.rets.map(scaleLeg), wbAt: inst.wbAt.map((x) => x * s) });
    }
    case 'los_gap_max_min':
      return solve({ ...inst, gapMax: bump(inst.gapMax) });
    case 'daylight_min_sun_elev_deg': {
      const sunMin = rv.sunMin - RELAX * Math.abs(rv.sunMin);
      const dark = daylightUntil(tl.lsDeg, tl.latDeg, tl.startLtstMin, sunMin, tl.tStart, tl.deadline + tl.ingressHalf + 1);
      return solve({ ...inst, dayDeadline: dark - tl.ingressHalf });
    }
    case 'heat_avg_max_w':
      return solve({ ...inst, hp: { ...inst.hp, budgetW: bump(inst.hp.budgetW) } });
    case 'shelter_time_max_min': {
      const rv2 = { ...rv, shelterMax: bump(rv.shelterMax) };
      const c2 = buildCore(R, req, tl, rv2);
      return solve(c2.inst);
    }
    case 'walk_radius_max_m': {
      const rv2 = { ...rv, radiusMax: bump(rv.radiusMax) };
      const c2 = buildCore(R, req, tl, rv2);
      return solve(c2.inst);
    }
    case 'slope_max_deg': {
      const rules2 = rules.map((r) => (r.id === 'slope_max_deg' ? { ...r, value: bump(r.value) } : r));
      const R2 = resolve(R.pack, req, { rules: rules2 });
      const c2 = buildCore(R2, req, tl, ruleVals(rules2));
      return solve(c2.inst);
    }
    default:
      return null;
  }
}

// ─────────────────────────── plan() ───────────────────────────

/**
 * Plan an EVA: choose and order stations to maximize science value under every hard flight rule,
 * then verify the result with a time-stepped simulator along the actual path cells. Deterministic.
 * Never returns an 'OK' plan that violates a hard rule; returns 'STAY_IN' when nothing is safe.
 */
export function plan(pack: LoadedSitePack, req: PlanRequest): PlanResult {
  const t0 = now();
  const res = planImpl(pack, req, t0);
  // Nothing is safe from the EVA base: say whether staging from a pressurized rover would work
  // (the EVA officer decides; the request's EVA base is never changed silently).
  const hasSep = (req.events ?? []).some((e) => e.t === 'SEP_NOWCAST');
  if (res.status === 'STAY_IN' && !req.resume && !hasSep && req.stations.length) {
    let best: { id: string; r: PlanResult } | null = null;
    for (const s of req.shelters) {
      if (s.kind !== 'rover' || s.cell === req.hab) continue;
      const r = planImpl(pack, stageFromShelter(req, s.id), t0);
      if (r.status === 'OK' && (!best || r.totals.scienceValue > best.r.totals.scienceValue)) best = { id: s.id, r };
    }
    if (best) {
      const name = pack.manifest.shelters.find((x) => x.id === best!.id)?.name ?? best.id;
      const o = best.r;
      res.notes.push(`Staging the EVA from ${name} (${best.id}) gives an OK plan: ${o.order.join(' → ')} (science value ${o.totals.scienceValue}, ${Math.round(o.totals.durationMin)} min). Re-plan with stageFromShelter(req, '${best.id}').`);
      if (res.binding) res.binding = { ...res.binding, text: `${res.binding.text} — staging from ${best.id} allows ${o.order.length} station${o.order.length > 1 ? 's' : ''}` };
    }
    res.solveMs = now() - t0;
  }
  return res;
}

function planImpl(pack: LoadedSitePack, req: PlanRequest, t0: number): PlanResult {
  const R = resolve(pack, req);
  const rv = R.rv;
  const lsKnown = lsFor(pack, req.sol);
  const ls = lsKnown ?? DEFAULT_LS_DEG;
  const notes = modelNotes(lsKnown === null, ls);
  const tl = makeTimeline(R, req, rv, ls);
  const cut = (req.events ?? []).filter((e) => e.t === 'EVA_CUT').reduce((a, e) => a + (e.t === 'EVA_CUT' ? e.min : 0), 0);
  if (cut > 0) notes.push(`EVA cut: available surface time reduced by ${cut} min.`);
  if (R.hazards.length) notes.push(`Hazards: ${R.hazards.length} reported cell(s) blocked.`);
  if (req.resume) notes.push(`Replan from the current position at +${req.resume.elapsedMin.toFixed(0)} min; heat state assumed at the budget (conservative).`);

  const sep = [...(req.events ?? [])].reverse().find((e) => e.t === 'SEP_NOWCAST');
  if (sep && sep.t === 'SEP_NOWCAST') return sepPlan(R, req, tl, rv, sep.leadMin, t0, notes);

  const allDropped = (rule: RuleId, why: string): Dropped[] =>
    req.stations.filter((s) => !(req.resume?.visited ?? []).includes(s.id)).map((s) => ({ id: s.id, rule, deficitMin: 0, text: `${s.id} dropped: ${why}` }));
  if (tl.dayDeadline <= tl.tStart) {
    return stayIn(R, req, t0, [...notes, 'Sun below the daylight threshold at EVA start / before the EVA can end.'],
      allDropped('daylight_min_sun_elev_deg', 'daylight'), { rule: 'daylight_min_sun_elev_deg', text: 'Stay in: no daylight window', seg: -1 }, tl, rv);
  }
  if (tl.deadline <= tl.tStart) {
    return stayIn(R, req, t0, [...notes, 'No surface time left within the EVA duration.'],
      allDropped('eva_duration_max_min', 'EVA duration'), { rule: 'eva_duration_max_min', text: 'Stay in: no surface time available', seg: -1 }, tl, rv);
  }

  const core = buildCore(R, req, tl, rv);
  const { inst } = core;
  const dp = solveDP(inst);
  const ranked = rankMasks(dp, inst);
  const singles = ranked.filter((m) => (m & (m - 1)) === 0);
  const tryList = [...ranked.slice(0, TOP_SUBSETS), ...singles.filter((m) => !ranked.slice(0, TOP_SUBSETS).includes(m))];
  const pathCache = new Map<string, number[] | null>();
  const checks = enforcedChecks(rv);
  let chosen: { mask: number; order: number[]; sim: SimOutput } | null = null;
  const simFail = new Map<number, SimOutput['failures']>();
  for (const mask of tryList) {
    const order = dp.reconstruct(mask);
    const legs = legPaths(core, order, pathCache);
    if (!legs) continue;
    const sim = simulate({ R, tl, hp: core.hp, H0: core.H0, startLabel: core.startLabel, legs, stops: simStops(core, order), endLabel: 'HAB', checks });
    if (sim.pass) {
      chosen = { mask, order, sim };
      break;
    }
    simFail.set(mask, sim.failures);
  }

  // dropped reasons for DP candidates
  const ruleText = (id: string, rule: RuleId, d: number) =>
    d > 0 ? `${id} dropped: ${RULE_SHORT[rule]}, −${Math.max(1, Math.ceil(d))} min` : `${id} dropped: ${RULE_SHORT[rule]}`;
  const baseOrder = chosen?.order ?? [];
  const droppedFor = (j: number): Dropped => {
    const id = core.cands[j - 1].id;
    let best: { rule: RuleId; d: number } | null = null;
    for (let p = 0; p <= baseOrder.length; p++) {
      const ord = [...baseOrder.slice(0, p), j, ...baseOrder.slice(p)];
      const ev = evalSequence(inst, ord);
      let worst: { rule: RuleId; d: number };
      if (ev.violations.length === 0) {
        const mask = ord.reduce((a, x) => a | (1 << (x - 1)), 0);
        const f = simFail.get(mask)?.[0];
        worst = f ? { rule: f.rule, d: f.rule === 'los_gap_max_min' || f.rule === 'walkback_speed_factor' ? Math.abs(f.worst - f.limit) : 0 } : { rule: 'eva_duration_max_min', d: 0 };
      } else {
        worst = ev.violations.reduce((a, v) => (v.deficitMin > a.d ? { rule: v.rule, d: v.deficitMin } : a), { rule: ev.violations[0].rule, d: ev.violations[0].deficitMin });
      }
      if (!best || worst.d < best.d) best = worst;
    }
    return { id, rule: best!.rule, deficitMin: best!.d, text: ruleText(id, best!.rule, best!.d) };
  };
  const inPlan = new Set(baseOrder);
  const droppedDp: Dropped[] = [];
  for (let j = 1; j <= inst.n; j++) if (!inPlan.has(j)) droppedDp.push(droppedFor(j));
  const order0 = req.stations.map((s) => s.id);
  const dropped = [...core.pre, ...droppedDp]
    .map((d) => ({ ...d, deficitMin: fin(d.deficitMin) }))
    .sort((a, b) => order0.indexOf(a.id) - order0.indexOf(b.id));

  if (!chosen) {
    const counts = new Map<RuleId, number>();
    for (const d of dropped) counts.set(d.rule, (counts.get(d.rule) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const rule = top?.[0] ?? 'eva_duration_max_min';
    return stayIn(R, req, t0, [...notes, req.stations.length ? 'No station can be visited without violating a hard rule.' : 'No stations requested.'], dropped,
      { rule, text: `Stay in: ${RULE_SHORT[rule]} rules out every station`, seg: -1 }, tl, rv);
  }

  const { sim, order } = chosen;
  const stopsIds = order.map((j) => core.cands[j - 1].id);
  const value = order.reduce((a, j) => a + core.cands[j - 1].value, 0);
  const { margins, where } = marginsOf(sim.segments);

  // leaderboard: minutes saved by removing each selected station (DP model, same order otherwise)
  const full = evalSequence(inst, order).tEnd;
  const leaderboard = order.map((j) => {
    const rest = order.filter((x) => x !== j);
    const e = evalSequence(inst, rest);
    return { id: core.cands[j - 1].id, value: core.cands[j - 1].value, marginalMin: fin(full - e.tEnd) };
  });

  // bingo: latest departure from each stop + latest return to the hab
  const bingo: Bingo[] = sim.stops.map((st, i) => {
    const tMin = sim.latestDepart[i];
    const ltst = ltstAt(tl.startLtstMin, tMin);
    return { id: st.id, tMin, ltstMin: ltst, text: `Leave ${st.id} by +${Math.floor(tMin)} min (${formatLtst(ltst)} LTST)` };
  });
  const retLtst = ltstAt(tl.startLtstMin, sim.returnBy);
  bingo.push({ id: 'HAB', tMin: sim.returnBy, ltstMin: retLtst, text: `Back at HAB by +${Math.floor(sim.returnBy)} min (${formatLtst(retLtst)} LTST)` });

  // binding: the hard rule whose 10 % relaxation adds the most science value. When no single 10 %
  // relaxation adds value (a tie at zero), report the rule that most nearly admits another station
  // (smallest deficit among dropped stations); failing that, the smallest normalized margin.
  const base = bestValue(dp, inst);
  const candidates: RuleId[] = ['walkback_speed_factor', 'shelter_time_max_min', 'los_gap_max_min', 'daylight_min_sun_elev_deg', 'heat_avg_max_w',
    'walk_radius_max_m', 'eva_duration_max_min', 'egress_ingress_min', 'slope_max_deg'];
  const enforced = (r: RuleId) => (r === 'egress_ingress_min' ? R.rules.find((x) => x.id === r)!.hard : checks.has(r));
  const normMargin = (r: RuleId) => {
    const w = where.get(r);
    return w ? w.check.margin / Math.max(1e-9, Math.abs(w.check.limit)) : Infinity;
  };
  const relaxAll = !req.resume; // replans skip the relaxations that rebuild the route grid (≤1 s budget)
  let bind: { rule: RuleId; gain: number; nm: number } | null = null;
  for (const r of candidates) {
    if (!enforced(r)) continue;
    if (!relaxAll && (r === 'slope_max_deg' || r === 'shelter_time_max_min' || r === 'walk_radius_max_m')) continue;
    const v = relaxedValue(core, req, r, R.rules);
    const gain = v === null ? 0 : Math.max(0, v - base);
    const nm = normMargin(r);
    if (!bind || gain > bind.gain + 1e-9 || (Math.abs(gain - bind.gain) <= 1e-9 && nm < bind.nm)) bind = { rule: r, gain, nm };
  }
  // DP instances share Seg objects: restore the base heat preparation
  for (const l of inst.legs) l?.seg.prepare(inst.hp);
  for (const l of inst.rets) l?.seg.prepare(inst.hp);
  let binding: PlanResult['binding'] = null;
  const valueOf = (id: string) => req.stations.find((x) => x.id === id)?.value ?? 0;
  const nearest = dropped
    .filter((d) => d.deficitMin > 0 && enforced(d.rule))
    .sort((a, b) => a.deficitMin - b.deficitMin || valueOf(b.id) - valueOf(a.id) || a.id.localeCompare(b.id))[0];
  if (bind && bind.gain > 0) {
    const wbind = where.get(bind.rule);
    const seg = wbind?.seg ?? 0;
    const s = sim.segments[seg];
    const atStop = wbind && order.map((j) => core.cands[j - 1]).find((c) => c.cell === wbind.check.atCell);
    const loc = bind.rule === 'eva_duration_max_min' || bind.rule === 'egress_ingress_min' ? 'the return to HAB'
      : atStop ? atStop.id : s ? `${s.from}→${s.to}` : 'HAB';
    binding = { rule: bind.rule, text: `Limited by ${RULE_SHORT[bind.rule]} at ${loc} (+10% would add ${Math.round(bind.gain)} science value)`, seg };
  } else if (nearest) {
    binding = { rule: nearest.rule, text: `Limited by ${RULE_SHORT[nearest.rule]} at ${nearest.id} (−${Math.max(1, Math.ceil(nearest.deficitMin))} min)`, seg: where.get(nearest.rule)?.seg ?? 0 };
  } else if (bind) {
    const wbind = where.get(bind.rule);
    const seg = wbind?.seg ?? 0;
    const s = sim.segments[seg];
    const atStop = wbind && order.map((j) => core.cands[j - 1]).find((c) => c.cell === wbind.check.atCell);
    binding = { rule: bind.rule, text: `Limited by ${RULE_SHORT[bind.rule]} at ${atStop ? atStop.id : s ? `${s.from}→${s.to}` : 'HAB'}`, seg };
  }

  return {
    status: 'OK',
    reqHash: requestHash(req),
    solveMs: now() - t0,
    planner: { pathSearch: R.pathSearchId, costModel: R.modelId },
    order: stopsIds,
    segments: sim.segments,
    stops: sim.stops,
    burndown: sim.burndown,
    margins,
    binding,
    dropped,
    leaderboard,
    bingo,
    totals: {
      distM: sim.distM,
      durationMin: sim.tReturn + tl.ingressHalf,
      energyKJ: sim.energyKJ,
      o2UsedPct: fin(100 * (1 - (tl.deadline - sim.tReturn) / tl.A)),
      doseUSv: sim.doseUSv,
      scienceValue: value,
      maxDistHabM: sim.maxDistHabM,
    },
    notes,
  };
}

/**
 * Stage the EVA from another pressurized shelter (e.g. the rover parked near the work site, the DRA
 * 5.0 safe-haven concept): the EVA base (`hab` — egress/ingress, walkback target, comm mast) moves to
 * that shelter's cell; every shelter stays a shelter. Segments still label the base 'HAB'.
 */
export function stageFromShelter(req: PlanRequest, shelterId: string): PlanRequest {
  const s = req.shelters.find((x) => x.id === shelterId);
  if (!s) throw new Error(`shelter ${shelterId} not in request`);
  return { ...req, hab: s.cell };
}
