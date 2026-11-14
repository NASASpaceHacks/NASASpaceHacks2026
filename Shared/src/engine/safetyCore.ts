import { DEFAULT_RULES } from '../contracts/rules';
import type { Cell, GridSpec, PlanPackage } from '../contracts/types';
import { COARSE_UNREACHABLE } from './codec';

export interface SafetyState {
  routeIdx: number;
  offRouteM: number;
  nextStopId: string | null;
  distToNextM: number;
  bearingToNextDeg: number;
  walkbackMarginMin: number;
  shelterMarginMin: number;
  bingoInMin: number | null;
  returnBearingDeg: number;
  status: 'NOMINAL' | 'CAUTION' | 'RETURN_NOW';
}

export interface SafetyCore {
  /** O(1) amortized and allocation-free: returns the SAME state object every call (copy it to keep it). */
  update(cell: Cell, tMin: number, o2Pct: number): SafetyState;
}

export interface SafetyLimits {
  /** Latest return to the hab (EVA min). Default: the package's 'HAB' bingo entry. */
  deadlineMin?: number;
  /** shelter_time_max_min. Default: the package's `rules` (checkpoint 1), else DEFAULT_RULES. */
  shelterMaxMin?: number;
  /** CAUTION threshold on the walkback margin (min). Default 15. */
  cautionMin?: number;
}

/** Sentinel for "unreachable / no margin" (finite so it survives JSON). */
const NO_MARGIN = -9999;
const WINDOW_BACK = 30;
const WINDOW_AHEAD = 120;
const REACQUIRE_CHUNK = 256;

const bearing = (dRow: number, dCol: number): number => {
  // clockwise from grid north: east = +col, north = −row
  const b = (Math.atan2(dCol, -dRow) * 180) / Math.PI;
  return b < 0 ? b + 360 : b;
};

/**
 * Portable safety core for the visor: everything it needs is in the route package (route cells,
 * stops/bingo, 50 m conservative walkback + shelter grids), so guidance continues with the link down.
 */
export function createSafetyCore(pkg: PlanPackage, grid: GridSpec, limits: SafetyLimits = {}): SafetyCore {
  const w = grid.w;
  const cellM = grid.cellM;
  const n = pkg.route.length;
  const rows = new Int32Array(n), cols = new Int32Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = Math.floor(pkg.route[i] / w);
    cols[i] = pkg.route[i] - rows[i] * w;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(rows[i] - rows[i - 1], cols[i] - cols[i - 1]) * cellM;
  }
  // stop markers: a stop appears twice in a row in the route (leg end + next leg start)
  const stopIdx: number[] = [];
  for (let i = 0; i + 1 < n; i++) if (pkg.route[i] === pkg.route[i + 1]) stopIdx.push(i);
  const stopIds: string[] = pkg.order.slice(0, stopIdx.length);
  const stopBingo = new Float64Array(stopIds.length).fill(NaN);
  const bingoById = new Map(pkg.bingo.map((b) => [b.id, b.tMin]));
  stopIds.forEach((id, k) => (stopBingo[k] = bingoById.get(id) ?? NaN));
  const habBingo = bingoById.get('HAB');
  const deadline = limits.deadlineMin ?? habBingo ?? Infinity;
  const pkgShelter = pkg.rules?.find((r) => r.id === 'shelter_time_max_min');
  const shelterMax = limits.shelterMaxMin
    ?? (pkgShelter ? (pkgShelter.enabled ? pkgShelter.value : Infinity) : DEFAULT_RULES.find((r) => r.id === 'shelter_time_max_min')!.value);
  const caution = limits.cautionMin ?? 15;

  // coarse grids + precomputed return bearing per block (toward decreasing walkback)
  const cg = pkg.coarse;
  const b = Math.max(1, Math.round(cg.cellM / cellM));
  const cw = cg.w, ch = cg.h;
  const wbC = Uint16Array.from(cg.walkbackMin);
  const shC = Uint16Array.from(cg.shelterMin);
  const retBearing = new Float32Array(cw * ch);
  const endR = n ? rows[n - 1] : 0, endC = n ? cols[n - 1] : 0;
  for (let br = 0; br < ch; br++) {
    for (let bc = 0; bc < cw; bc++) {
      const here = wbC[br * cw + bc];
      let best = here, bdr = 0, bdc = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = br + dr, cc = bc + dc;
        if (rr < 0 || cc < 0 || rr >= ch || cc >= cw) continue;
        const v = wbC[rr * cw + cc];
        if (v < best) {
          best = v;
          bdr = dr;
          bdc = dc;
        }
      }
      retBearing[br * cw + bc] = bdr || bdc
        ? bearing(bdr, bdc)
        : bearing(endR - (br * b + b / 2), endC - (bc * b + b / 2)); // at the minimum: head for the route end (hab)
    }
  }

  const state: SafetyState = {
    routeIdx: 0, offRouteM: 0, nextStopId: null, distToNextM: 0, bearingToNextDeg: 0, walkbackMarginMin: 0,
    shelterMarginMin: 0, bingoInMin: null, returnBearingDeg: 0, status: 'NOMINAL',
  };
  let idx = 0;
  let scan = 0;

  return {
    update(cell: Cell, tMin: number, o2Pct: number): SafetyState {
      const r = Math.floor(cell / w), c = cell - r * w;
      if (n > 0) {
        // sliding-window nearest route index (O(window))
        let best = idx, bestD2 = Infinity;
        const lo = idx > WINDOW_BACK ? idx - WINDOW_BACK : 0;
        const hi = idx + WINDOW_AHEAD < n ? idx + WINDOW_AHEAD : n - 1;
        for (let i = lo; i <= hi; i++) {
          const dr = rows[i] - r, dc = cols[i] - c;
          const d2 = dr * dr + dc * dc;
          // ties (out-and-back legs, stop repeats) prefer forward progress: first index ≥ idx
          if (d2 < bestD2 || (d2 === bestD2 && best < idx && i >= idx)) {
            bestD2 = d2;
            best = i;
          }
        }
        // > 50 m off the window: scan a rotating chunk of the whole route (amortized global re-acquire).
        // Smaller drifts never jump, so a position error cannot skip ahead onto an overlapping leg.
        if (bestD2 > 100) {
          const end = Math.min(n, scan + REACQUIRE_CHUNK);
          for (let i = scan; i < end; i++) {
            const dr = rows[i] - r, dc = cols[i] - c;
            const d2 = dr * dr + dc * dc;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = i;
            }
          }
          scan = end >= n ? 0 : end;
        }
        idx = best;
        state.routeIdx = idx;
        state.offRouteM = Math.sqrt(bestD2) * cellM;
        // next stop = first stop marker at or after the current index
        let k = 0;
        while (k < stopIdx.length && stopIdx[k] < idx) k++;
        if (k < stopIdx.length) {
          const si = stopIdx[k];
          state.nextStopId = stopIds[k] ?? null;
          state.distToNextM = cum[si] - cum[idx] + state.offRouteM;
          state.bearingToNextDeg = bearing(rows[si] - r, cols[si] - c);
          state.bingoInMin = stopBingo[k] === stopBingo[k] ? stopBingo[k] - tMin : null;
        } else {
          state.nextStopId = null;
          state.distToNextM = cum[n - 1] - cum[idx] + state.offRouteM;
          state.bearingToNextDeg = bearing(rows[n - 1] - r, cols[n - 1] - c);
          state.bingoInMin = habBingo !== undefined ? habBingo - tMin : null;
        }
      }
      // margins from the conservative coarse grids
      const br = Math.min(ch - 1, Math.floor(r / b)), bc = Math.min(cw - 1, Math.floor(c / b));
      const bi = br * cw + bc;
      const wv = wbC[bi], sv = shC[bi];
      state.walkbackMarginMin = wv === COARSE_UNREACHABLE ? NO_MARGIN : deadline - tMin - wv;
      state.shelterMarginMin = sv === COARSE_UNREACHABLE ? NO_MARGIN : shelterMax === Infinity ? -NO_MARGIN : shelterMax - sv;
      state.returnBearingDeg = retBearing[bi];
      state.status =
        state.walkbackMarginMin <= 0 || state.shelterMarginMin < 0 || o2Pct <= 0
          ? 'RETURN_NOW'
          : state.walkbackMarginMin < caution
            ? 'CAUTION'
            : 'NOMINAL';
      return state;
    },
  };
}
