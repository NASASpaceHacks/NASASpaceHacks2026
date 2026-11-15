import type { BurndownPoint, Check, GridSpec, LoadedSitePack, Rule, RuleId, Segment } from '@mw/shared/contracts';
import { cellDistM } from '@mw/shared/contracts';
import type { AttemptResult } from '@mw/shared/engine';
import { hm } from './plain';

/**
 * The walk a NO-GO would have been: out and back to the stop over the cheapest walkable path, simulated with
 * the same rules as the plan. Says WHERE it breaks the rule, so the map can show it and the panel can say it.
 */
export interface FailureInfo {
  rule: RuleId;
  /** Map label, e.g. "No radio 21 min (limit 10)". */
  short: string;
  /** One plain sentence with numbers, for the verdict panel. */
  sentence: string;
  /** The reason as a phrase for a destination row ("83 min from shelter (limit 30)"): same numbers as `sentence`. */
  reason: string;
  /** What the red mark on the map is, in one sentence. */
  marks: string;
  /** Stretches of route cells to paint red (one cell = a point). */
  runs: number[][];
  /** Where the label sits. */
  labelCell: number;
  worst: number;
  limit: number;
  atMin: number;
}

export interface AttemptTotals {
  distM: number;
  durationMin: number;
  maxSlopeDeg: number;
  outOfContactMin: number;
  longestGapMin: number;
  maxDistHabM: number;
}

export interface AttemptView {
  source: 'pin' | 'plan';
  destId: string;
  legs: number[][];
  failure: FailureInfo | null;
  totals: AttemptTotals;
  margins: Partial<Record<RuleId, { min: number; atMin: number }>>;
  burndown: BurndownPoint[];
}

const num = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Cell k of a segment, as an EVA minute. */
function timeOf(s: Segment, i: number): number {
  const n = s.cells.length;
  return n > 1 ? s.t0Min + ((s.t1Min - s.t0Min) * i) / (n - 1) : s.t0Min;
}

/** Rules a failing check breaks, worst relative violation first. */
function failing(segments: Segment[]): Check[] {
  const out: Check[] = [];
  for (const s of segments) for (const c of s.checks) if (!c.pass) out.push(c);
  return out.sort((a, b) => b.worst / Math.max(1e-6, b.limit) - a.worst / Math.max(1e-6, a.limit));
}

export function summarizeAttempt(
  pack: LoadedSitePack,
  rules: Rule[],
  at: AttemptResult,
  destId: string,
  source: 'pin' | 'plan',
  preferRule?: RuleId,
  baseName = 'the base',
): AttemptView | null {
  const sim = at.sim;
  if (!sim || !at.los) return null;
  const g: GridSpec = pack.manifest.grid;
  const los = at.los;
  const slope = pack.rasters.slope;
  const segs = sim.segments;
  const legs = segs.map((s) => s.cells);
  const base = legs[0]?.[0] ?? 0;
  const ruleOf = (id: RuleId) => rules.find((r) => r.id === id);

  // Time spent out of radio contact, and the continuous stretches.
  let outMin = 0;
  let longest = 0;
  const gapRuns: { cells: number[]; min: number }[] = [];
  let maxSlope = 0;
  // One pass over the whole walk (the dwell at the stop counts as time out of contact when the stop is in shadow).
  let run: number[] = [];
  let runMin = 0;
  const flush = () => {
    if (run.length) gapRuns.push({ cells: run, min: runMin });
    run = [];
    runMin = 0;
  };
  segs.forEach((s, k) => {
    if (k > 0) {
      const prev = segs[k - 1];
      const dwell = Math.max(0, s.t0Min - prev.t1Min);
      const lastCell = prev.cells[prev.cells.length - 1];
      if (los[lastCell] !== 1 && dwell > 0) {
        outMin += dwell;
        runMin += dwell;
      } else flush();
    }
    for (let i = 0; i < s.cells.length; i++) {
      const c = s.cells[i];
      if (slope[c] > maxSlope) maxSlope = slope[c];
      if (los[c] === 1) {
        flush();
        continue;
      }
      const dt = i > 0 ? timeOf(s, i) - timeOf(s, i - 1) : 0;
      outMin += dt;
      runMin += dt;
      if (run[run.length - 1] !== c) run.push(c);
    }
  });
  flush();
  for (const r of gapRuns) longest = Math.max(longest, r.min);

  const margins: AttemptView['margins'] = {};
  for (const s of segs) for (const c of s.checks) {
    const cur = margins[c.rule];
    if (!cur || c.margin < cur.min) margins[c.rule] = { min: c.margin, atMin: c.atMin };
  }

  const fails = failing(segs);
  const pick = (preferRule && fails.find((c) => c.rule === preferRule)) || fails[0];
  let failure: Omit<FailureInfo, 'marks'> | null = null;
  if (pick) {
    const lim = ruleOf(pick.rule);
    const limit = lim ? lim.value : pick.limit;
    const w = pick.worst;
    const point = (cell: number): number[][] => [[cell]];
    switch (pick.rule) {
      case 'los_gap_max_min': {
        const best = [...gapRuns].sort((a, b) => b.min - a.min)[0];
        const cells = best ? best.cells : [pick.atCell];
        failure = {
          rule: pick.rule, runs: [cells], labelCell: cells[Math.floor(cells.length / 2)], worst: w, limit, atMin: pick.atMin,
          short: `No radio ${Math.round(w)} min (limit ${limit})`,
          sentence: `No radio contact for ${Math.round(w)} min on the way (limit ${limit} min)`,
          reason: `no radio contact for ${Math.round(w)} min on the way (limit ${limit} min)`,
        };
        break;
      }
      case 'slope_max_deg': {
        const runs: number[][] = [];
        let cur: number[] = [];
        for (const s of segs) for (const c of s.cells) {
          if (slope[c] > limit) cur.push(c);
          else if (cur.length) (runs.push(cur), (cur = []));
        }
        if (cur.length) runs.push(cur);
        const first = runs[0] ?? [pick.atCell];
        // 90 is the engine's marker for ground the map can't use at all (keep-out zone, no elevation data), not a slope.
        const unusable = w >= 90;
        const deg = Math.round(w);
        failure = {
          rule: pick.rule, runs: runs.length ? runs : point(pick.atCell), labelCell: first[Math.floor(first.length / 2)], worst: w, limit, atMin: pick.atMin,
          short: unusable ? "Ground the map can't use" : `Slope ${deg}° (limit ${limit}°)`,
          sentence: unusable ? "The walk crosses ground the map can't use (a keep-out zone or no elevation data)" : `The ground reaches ${deg}° (limit ${limit}°)`,
          reason: unusable ? "the walk crosses ground the map can't use (a keep-out zone or no elevation data)" : `the walk reaches ${deg}° ground (limit ${limit}°)`,
        };
        break;
      }
      case 'walk_radius_max_m': {
        const first = (legs[0] ?? []).find((c) => cellDistM(g, base, c) > limit) ?? pick.atCell;
        failure = {
          rule: pick.rule, runs: point(first), labelCell: first, worst: w, limit, atMin: pick.atMin,
          short: `${dist(w)} from ${baseName} (limit ${dist(limit)})`,
          sentence: `The stop is ${dist(w)} from ${baseName} (limit ${dist(limit)})`,
          reason: `${dist(w)} from ${baseName} (limit ${dist(limit)})`,
        };
        break;
      }
      case 'shelter_time_max_min':
        failure = {
          rule: pick.rule, runs: point(pick.atCell), labelCell: pick.atCell, worst: w, limit, atMin: pick.atMin,
          short: `${Math.round(w)} min from shelter (limit ${limit} min)`,
          sentence: `The farthest point is ${Math.round(w)} min from the nearest shelter (limit ${limit} min)`,
          reason: `${Math.round(w)} min from the nearest shelter (limit ${limit} min)`,
        };
        break;
      case 'walkback_speed_factor': {
        const over = Math.max(1, Math.round(-pick.margin));
        failure = {
          rule: pick.rule, runs: point(pick.atCell), labelCell: pick.atCell, worst: w, limit, atMin: pick.atMin,
          // worst = time walked so far + the slow (contingency) walk back from here; limit = all walking time available.
          short: `Out + slow walk back ${hm(w)} (limit ${hm(pick.limit)})`,
          sentence: `Walking out and then walking back at contingency pace takes ${hm(w)}; the walking time available is ${hm(pick.limit)} (${over} min short)`,
          reason: `walking out plus a slow walk back takes ${hm(w)} (limit ${hm(pick.limit)})`,
        };
        break;
      }
      case 'heat_avg_max_w':
        failure = {
          rule: pick.rule, runs: point(pick.atCell), labelCell: pick.atCell, worst: w, limit, atMin: pick.atMin,
          short: `Suit heat ${Math.round(w)} W (limit ${limit})`,
          sentence: `Suit heat reaches ${Math.round(w)} W (limit ${limit} W)`,
          reason: `suit heat reaches ${Math.round(w)} W (limit ${limit} W)`,
        };
        break;
      case 'eva_duration_max_min': {
        const evaLimit = pick.limit;
        const restMin = segs.reduce((a, s) => a + s.restMin, 0);
        const restTxt = restMin >= 1 ? `, including ${hm(restMin)} of cooling rests` : '';
        failure = {
          rule: pick.rule, runs: point(pick.atCell), labelCell: pick.atCell, worst: w, limit, atMin: pick.atMin,
          // worst = EVA end time including the airlock; limit = the EVA time limit (airlock included).
          short: `EVA ${hm(w)} (limit ${hm(evaLimit)})`,
          sentence: `The whole EVA, airlock included, would take ${hm(w)} (limit ${hm(evaLimit)})${restTxt}`,
          reason: `the EVA would take ${hm(w)} with the airlock (limit ${hm(evaLimit)})${restTxt}`,
        };
        break;
      }
      case 'daylight_min_sun_elev_deg':
        failure = {
          rule: pick.rule, runs: point(pick.atCell), labelCell: pick.atCell, worst: w, limit, atMin: pick.atMin,
          short: `Sun ${num(w)}° (minimum ${limit}°)`,
          sentence: `The sun drops to ${num(w)}° (minimum ${limit}°)`,
          reason: `the sun drops to ${num(w)}° (minimum ${limit}°)`,
        };
        break;
      default:
        failure = {
          rule: pick.rule, runs: point(pick.atCell), labelCell: pick.atCell, worst: w, limit, atMin: pick.atMin,
          short: lim?.label ?? pick.rule, sentence: lim?.label ?? pick.rule, reason: lim?.label ?? pick.rule,
        };
    }
  }
  const marked: FailureInfo | null = failure && { ...failure, marks: failure.runs.some((r) => r.length > 1) ? 'The stretch is marked red on the map.' : 'The red circle on the map marks where.' };

  const first = segs[0], last = segs[segs.length - 1];
  return {
    source, destId, legs, failure: marked, margins, burndown: sim.burndown,
    totals: {
      distM: sim.distM,
      durationMin: first && last ? last.t1Min - first.t0Min : 0,
      maxSlopeDeg: maxSlope,
      outOfContactMin: Math.max(outMin, pick?.rule === 'los_gap_max_min' ? pick.worst : 0),
      longestGapMin: pick?.rule === 'los_gap_max_min' ? pick.worst : longest,
      maxDistHabM: sim.maxDistHabM,
    },
  };
}
