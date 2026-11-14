import type { RuleId } from '../contracts/types';
import { Seg, type HeatParams, type SegEval } from './heat';

/**
 * Orienteering over ≤15 stations: exact bitmask DP over (subset, last station).
 *
 * Each label is (t, H, g): departure time (EVA min), suit-heat state (W) and the out-of-LOS time
 * carried into the next leg (min). Labels are kept as a Pareto front per (subset, last); since leg
 * duration and end heat are non-decreasing in start heat, and every check is monotone in t and g,
 * dropping dominated labels is exact. Minimum return time per subset therefore equals brute-force
 * enumeration of all orders (verified in orienteer.test.ts).
 *
 * Model fidelity vs the time-stepped simulator: heat rests and the station walkback check are exact;
 * the mid-leg walkback check and the LOS-gap check use rest-free walking times (optimistic), so the
 * simulator has the final word.
 */
export interface Leg {
  seg: Seg;
  /** LOS bookkeeping on rest-free work time (min). */
  allNon: boolean;
  total: number;
  lead: number;
  trail: number;
  maxInt: number;
  /** max over path points (and dwell end) of (rest-free offset + walkbackMin(point)); −Inf if none. */
  wbMax: number;
}

export interface OrInstance {
  /** Number of stations (indices 1..n; 0 = start node). */
  n: number;
  /** values[j], j = 1..n (values[0] unused). */
  values: number[];
  /** Leg i→j including the dwell at j (i ∈ 0..n, j ∈ 1..n), or null if unreachable. */
  legs: (Leg | null)[];
  /** Return legs i→end (hab), index i ∈ 0..n. */
  rets: (Leg | null)[];
  /** walkbackMin at station j (index 1..n). */
  wbAt: number[];
  t0: number;
  H0: number;
  g0: number;
  /** Walkback deadline: t + walkback(p) ≤ deadline (EVA min). */
  deadline: number;
  /** EVA-duration deadline for the return to the hab (EVA min). */
  evaDeadline: number;
  /** Daylight deadline for the return to the hab (EVA min). */
  dayDeadline: number;
  gapMax: number;
  wbOn: boolean;
  hp: HeatParams;
}

export const legAt = (inst: OrInstance, i: number, j: number): Leg | null => inst.legs[i * (inst.n + 1) + j];

export function prepareInstance(inst: OrInstance): void {
  for (const l of inst.legs) l?.seg.prepare(inst.hp);
  for (const l of inst.rets) l?.seg.prepare(inst.hp);
}

const scratch: SegEval = { feasible: false, dur: 0, rest: 0, hEnd: 0 };

/** Apply a leg to a label. Returns false if infeasible; result in `out` = [t, H, g]. */
export function applyLeg(inst: OrInstance, leg: Leg, t: number, H: number, g: number, stationJ: number, isReturn: boolean, out: Float64Array): boolean {
  const se = leg.seg.eval(H, scratch);
  if (!se.feasible) return false;
  let g2: number;
  if (leg.allNon) {
    g2 = g + leg.total;
    if (g2 > inst.gapMax) return false;
  } else {
    if (g + leg.lead > inst.gapMax || leg.maxInt > inst.gapMax || leg.trail > inst.gapMax) return false;
    g2 = leg.trail;
  }
  if (inst.wbOn && t + leg.wbMax > inst.deadline) return false;
  const t2 = t + se.dur;
  if (isReturn) {
    if (t2 > inst.evaDeadline || t2 > inst.dayDeadline) return false;
  } else if (inst.wbOn && t2 + inst.wbAt[stationJ] > inst.deadline) return false;
  out[0] = t2;
  out[1] = se.hEnd;
  out[2] = g2;
  return true;
}

export interface DPResult {
  n: number;
  /** Minimum return time per subset mask (Infinity = infeasible). */
  bestEnd: Float64Array;
  /** Label id (at the last station) achieving bestEnd, −1 = return straight from the start. */
  bestLabel: Int32Array;
  reconstruct(mask: number): number[];
  labels: number;
}

/** Exact Pareto-label bitmask DP. */
export function solveDP(inst: OrInstance): DPResult {
  prepareInstance(inst);
  const n = inst.n;
  const N1 = n + 1;
  const M = 1 << n;
  let cap = 1024, size = 0;
  let LT = new Float64Array(cap), LH = new Float64Array(cap), LG = new Float64Array(cap);
  let LP = new Int32Array(cap), LN = new Int16Array(cap);
  const add = (t: number, H: number, g: number, prev: number, node: number): number => {
    if (size === cap) {
      cap *= 2;
      const grow = <T extends Float64Array | Int32Array | Int16Array>(a: T, C: new (k: number) => T): T => {
        const b = new C(cap);
        b.set(a);
        return b;
      };
      LT = grow(LT, Float64Array); LH = grow(LH, Float64Array); LG = grow(LG, Float64Array);
      LP = grow(LP, Int32Array); LN = grow(LN, Int16Array);
    }
    LT[size] = t; LH[size] = H; LG[size] = g; LP[size] = prev; LN[size] = node;
    return size++;
  };
  const lists: (number[] | undefined)[] = new Array(M * N1);
  const bestEnd = new Float64Array(M).fill(Infinity);
  const bestLabel = new Int32Array(M).fill(-2);
  const out = new Float64Array(3);
  const EPS = 1e-12;

  lists[0] = [add(inst.t0, inst.H0, inst.g0, -1, 0)];
  for (let mask = 0; mask < M; mask++) {
    for (let last = 0; last <= n; last++) {
      const list = lists[mask * N1 + last];
      if (!list) continue;
      const ret = inst.rets[last];
      for (const id of list) {
        const t = LT[id], H = LH[id], g = LG[id];
        if (ret && applyLeg(inst, ret, t, H, g, 0, true, out) && out[0] < bestEnd[mask] - EPS) {
          bestEnd[mask] = out[0];
          bestLabel[mask] = mask === 0 ? -1 : id;
        }
        for (let j = 1; j <= n; j++) {
          const bit = 1 << (j - 1);
          if (mask & bit) continue;
          const leg = inst.legs[last * N1 + j];
          if (!leg) continue;
          if (!applyLeg(inst, leg, t, H, g, j, false, out)) continue;
          const t2 = out[0], H2 = out[1], g2 = out[2];
          const si = (mask | bit) * N1 + j;
          let L = lists[si];
          if (!L) lists[si] = L = [];
          let dominated = false;
          for (const o of L) {
            if (LT[o] <= t2 + EPS && LH[o] <= H2 + EPS && LG[o] <= g2 + EPS) {
              dominated = true;
              break;
            }
          }
          if (dominated) continue;
          let w = 0;
          for (let r = 0; r < L.length; r++) {
            const o = L[r];
            if (!(t2 <= LT[o] + EPS && H2 <= LH[o] + EPS && g2 <= LG[o] + EPS)) L[w++] = o;
          }
          L.length = w;
          L.push(add(t2, H2, g2, id, j));
        }
      }
    }
  }
  return {
    n,
    bestEnd,
    bestLabel,
    labels: size,
    reconstruct(mask: number): number[] {
      const id0 = bestLabel[mask];
      if (id0 < 0) return [];
      const order: number[] = [];
      for (let id = id0; id >= 0 && LN[id] !== 0; id = LP[id]) order.push(LN[id]);
      return order.reverse();
    },
  };
}

/** Brute-force enumeration of every order of every subset (reference for tests, n ≤ 8). */
export function bruteForce(inst: OrInstance): Float64Array {
  prepareInstance(inst);
  const n = inst.n;
  const best = new Float64Array(1 << n).fill(Infinity);
  const out = new Float64Array(3);
  const rec = (mask: number, last: number, t: number, H: number, g: number) => {
    const ret = inst.rets[last];
    if (ret && applyLeg(inst, ret, t, H, g, 0, true, out) && out[0] < best[mask]) best[mask] = out[0];
    for (let j = 1; j <= n; j++) {
      const bit = 1 << (j - 1);
      if (mask & bit) continue;
      const leg = inst.legs[last * (n + 1) + j];
      if (!leg || !applyLeg(inst, leg, t, H, g, j, false, out)) continue;
      rec(mask | bit, j, out[0], out[1], out[2]);
    }
  };
  rec(0, 0, inst.t0, inst.H0, inst.g0);
  return best;
}

export interface SeqViolation {
  rule: RuleId;
  deficitMin: number;
  /** Station index (1..n) at/after which it happens, 0 = start, −1 = return leg. */
  at: number;
}

export interface SeqEval {
  feasible: boolean;
  tEnd: number;
  violations: SeqViolation[];
  /** Departure time from each station of the order (EVA min). */
  depart: number[];
}

/**
 * Evaluate a fixed order in the DP model, accumulating every violation with its deficit in
 * minutes (used for dropped-station reasons and the leaderboard).
 */
export function evalSequence(inst: OrInstance, order: number[]): SeqEval {
  prepareInstance(inst);
  const v: SeqViolation[] = [];
  let t = inst.t0, H = inst.H0, g = inst.g0, last = 0;
  const se: SegEval = { feasible: false, dur: 0, rest: 0, hEnd: 0 };
  const depart: number[] = [];
  const step = (leg: Leg | null, j: number, isReturn: boolean): boolean => {
    if (!leg) {
      v.push({ rule: 'shelter_time_max_min', deficitMin: 0, at: isReturn ? -1 : j });
      return false;
    }
    leg.seg.eval(H, se);
    if (!se.feasible) {
      v.push({ rule: 'heat_avg_max_w', deficitMin: 0, at: isReturn ? -1 : j });
      return false;
    }
    let g2: number;
    if (leg.allNon) {
      g2 = g + leg.total;
      if (g2 > inst.gapMax) v.push({ rule: 'los_gap_max_min', deficitMin: g2 - inst.gapMax, at: j });
    } else {
      const worst = Math.max(g + leg.lead, leg.maxInt, leg.trail);
      if (worst > inst.gapMax) v.push({ rule: 'los_gap_max_min', deficitMin: worst - inst.gapMax, at: j });
      g2 = leg.trail;
    }
    if (inst.wbOn && t + leg.wbMax > inst.deadline) v.push({ rule: 'walkback_speed_factor', deficitMin: t + leg.wbMax - inst.deadline, at: j });
    const t2 = t + se.dur;
    if (isReturn) {
      if (t2 > inst.evaDeadline) v.push({ rule: 'eva_duration_max_min', deficitMin: t2 - inst.evaDeadline, at: -1 });
      if (t2 > inst.dayDeadline) v.push({ rule: 'daylight_min_sun_elev_deg', deficitMin: t2 - inst.dayDeadline, at: -1 });
    } else {
      if (inst.wbOn && t2 + inst.wbAt[j] > inst.deadline) v.push({ rule: 'walkback_speed_factor', deficitMin: t2 + inst.wbAt[j] - inst.deadline, at: j });
      depart.push(t2);
    }
    t = t2;
    H = se.hEnd;
    g = g2;
    return true;
  };
  for (const j of order) {
    if (!step(legAt(inst, last, j), j, false)) return { feasible: false, tEnd: Infinity, violations: v, depart };
    last = j;
  }
  if (!step(inst.rets[last], 0, true)) return { feasible: false, tEnd: Infinity, violations: v, depart };
  return { feasible: v.length === 0, tEnd: t, violations: v, depart };
}
