import type { LoadedSitePack } from '../contracts/sitepack';
import type { CostGrid, CostModel, RoutePrefs } from '../contracts/types';
import { dirOffsets, EDGE_INF, type EdgeTable } from './dial';

/**
 * Operator route priorities ("weights", PlanRequest.prefs) → a per-cell multiplier on the ROUTE SEARCH cost.
 *
 * Team design: origin/mirim Frontend/shared/router.ts `buildField` + Research/docs/requirement.md ("Weight
 * Control"). Per cell i:
 *
 *   m(i) = (wd + w.slope·s² + w.rough·r² + w.thermal·loose + w.radio·noLos) · (1 − 0.6·w.science·sci)
 *
 *   wd    = max(0.05, w.distance)                 walking time always counts
 *   s     = slope / slope limit, capped at 1        (request's slope_max_deg value; 20° if absent)
 *   r     = rough / ROUGH_REF_M, capped at 1        (DEM roughness, m)
 *   loose = 1 − TI_norm, TI_norm = (TI − 100) / (350 − 100) clamped to 0..1 (thresholds of etaFromThermalInertia)
 *   noLos = 1 where the cell is NOT in comm line of sight of a radio mast (the planner's LOS field), else 0
 *   sci   = (SINDEX2 − 0.003) / (0.0105 − 0.003) clamped to 0..1; 0 where there is no CRISM layer (Jezero)
 *
 * m is divided by its minimum over the grid, so every multiplier is ≥ 1. An edge u→v costs
 * routeTime(u→v) · ½(m(u) + m(v)) ≥ routeTime(u→v) ≥ true travel time, so the A* octile/max-speed heuristic (a
 * travel-time lower bound) stays admissible, and reachability is unchanged (a finite edge stays finite).
 *
 * What this does NOT touch: the safety fields (walkback, shelter, outbound, LOS), every rule limit, the DP's
 * feasibility, the simulator and every reported minute. Those use the base cost model's true travel time along
 * whatever cells the weighted search chose (plan.ts buildLeg / simulate.ts). Weights only pick WHICH safe path.
 */

/** Distance (walking-time) weight floor, so time always counts (mirim buildField). */
export const MIN_DISTANCE_WEIGHT = 0.05;
/**
 * Roughness reference (m): the team prototype's roughness limit (origin/mirim Frontend/shared/demo.ts
 * DEFAULT_PARAMS.maxRough = 10 cm, applied to the same detrended-height std-dev). Cells at or above it count as
 * fully rough (r = 1); on gale-v1 that is the roughest ~25 % (median 4.2 cm, p95 21 cm).
 */
export const ROUGH_REF_M = 0.1;
/** THEMIS TI thresholds (J m⁻² K⁻¹ s⁻½) of etaFromThermalInertia: < 100 loose fines, ≥ 350 indurated / rocky. */
export const TI_LOOSE = 100;
export const TI_FIRM = 350;
/** CRISM SINDEX2 normalization range (polyhydrated sulfate index; the console's CRISM ramp spans this AOI's range). */
export const CRISM_LO = 0.003;
export const CRISM_HI = 0.0105;
/** Strongest science discount: a cell at full CRISM signal costs (1 − 0.6·w.science) as much (mirim buildField). */
export const SCIENCE_PULL = 0.6;
/** Slope reference when the request has no usable slope_max_deg value (xEVA ConOps / Artemis III 20°). */
export const DEFAULT_SLOPE_REF_DEG = 20;

/** Clamped weights. null from normalizePrefs = route-neutral (identical to today's fastest-safe routing). */
export interface NormPrefs {
  preset?: string;
  distance: number;
  slope: number;
  rough: number;
  thermal: number;
  radio: number;
  science: number;
}

const clamp01 = (x: unknown, dflt: number): number => (typeof x === 'number' && x === x ? (x < 0 ? 0 : x > 1 ? 1 : x) : dflt);

/**
 * Clamp every weight to 0..1 (NaN / missing → the default) and floor distance at 0.05. Returns null when no
 * non-distance weight is set: the multiplier would be uniform, so routing is exactly the default (the
 * engine then never builds a multiplier and runs today's code path unchanged).
 */
export function normalizePrefs(p: RoutePrefs | null | undefined): NormPrefs | null {
  if (!p || typeof p !== 'object') return null;
  const n: NormPrefs = {
    distance: Math.max(MIN_DISTANCE_WEIGHT, clamp01(p.distance, 1)),
    slope: clamp01(p.slope, 0),
    rough: clamp01(p.rough, 0),
    thermal: clamp01(p.thermal, 0),
    radio: clamp01(p.radio, 0),
    science: clamp01(p.science, 0),
  };
  if (n.slope === 0 && n.rough === 0 && n.thermal === 0 && n.radio === 0 && n.science === 0) return null;
  if (typeof p.preset === 'string') n.preset = p.preset;
  return n;
}

/** Canonical key of the weights (the preset label does not change the route, so it is not part of it). */
export function prefsKey(n: NormPrefs): string {
  return `${n.distance},${n.slope},${n.rough},${n.thermal},${n.radio},${n.science}`;
}

/** What requestHash hashes for prefs: undefined when route-neutral (so the hash equals a request without prefs). */
export function prefsForHash(p: RoutePrefs | null | undefined): Omit<NormPrefs, 'preset'> | undefined {
  const n = normalizePrefs(p);
  if (!n) return undefined;
  return { distance: n.distance, slope: n.slope, rough: n.rough, thermal: n.thermal, radio: n.radio, science: n.science };
}

/** The request's slope limit used to normalize the slope term (fixed per request; relaxed what-ifs reuse it). */
export function slopeRefDeg(rules: { id: string; value: number }[]): number {
  const r = rules.find((x) => x.id === 'slope_max_deg');
  return r && Number.isFinite(r.value) && r.value > 0 ? r.value : DEFAULT_SLOPE_REF_DEG;
}

/**
 * Per-cell route-search multiplier (Float32Array, min = 1), or null when it is uniform (e.g. science-only
 * where the site has no CRISM layer, or radio-only where every cell is in contact): routing is then exactly
 * the default. Computed once per (weights, slope reference, LOS field) and cached by the caller.
 */
export function routeMultiplier(pack: LoadedSitePack, grid: CostGrid, los: Uint8Array, p: NormPrefs, slopeRef: number): Float32Array | null {
  const n = grid.w * grid.h;
  const slope = grid.slopeDeg, rough = grid.rough;
  const tiR = pack.rasters.ti, crR = pack.rasters.crism_sindex2;
  const ti = p.thermal > 0 && tiR && tiR.length === n ? tiR : null;
  const cr = p.science > 0 && crR && crR.length === n ? crR : null;
  const wd = p.distance, ws = p.slope, wr = p.rough, wt = p.thermal, wl = p.radio, wsci = SCIENCE_PULL * p.science;
  const invS = 1 / slopeRef, invR = 1 / ROUGH_REF_M, tiSpan = TI_FIRM - TI_LOOSE, crSpan = CRISM_HI - CRISM_LO;
  const m = new Float64Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    let a = wd;
    if (ws > 0) {
      let s = slope[i] * invS;
      s = s === s ? (s < 0 ? 0 : s > 1 ? 1 : s) : 0;
      a += ws * s * s;
    }
    if (wr > 0) {
      let r = rough[i] * invR;
      r = r === r ? (r < 0 ? 0 : r > 1 ? 1 : r) : 0;
      a += wr * r * r;
    }
    if (ti) {
      const x = ti[i];
      if (x === x) {
        let tn = (x - TI_LOOSE) / tiSpan;
        tn = tn < 0 ? 0 : tn > 1 ? 1 : tn;
        a += wt * (1 - tn);
      }
    }
    if (wl > 0 && los[i] !== 1) a += wl;
    if (cr) {
      const x = cr[i];
      if (x === x) {
        let c = (x - CRISM_LO) / crSpan;
        c = c < 0 ? 0 : c > 1 ? 1 : c;
        a *= 1 - wsci * c;
      }
    }
    m[i] = a;
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  if (!(hi > lo)) return null;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = m[i] / lo; // ≥ 1 exactly (IEEE division is monotonic); Float32 rounding of a value ≥ 1 stays ≥ 1
    out[i] = v < 1 ? 1 : v;
  }
  return out;
}

/**
 * q'(u→v) = round(q(u→v) · ½(m(u)+m(v))) over a whole table. Since m ≥ 1, ½(m(u)+m(v)) ≥ 1 exactly, so q' ≥ q ≥ 1;
 * capped below EDGE_INF so a passable edge stays passable. Top-level and with bitwise rounding (all values are
 * positive and < 2³¹): ~20 ms for 1M cells, against ~200 ms for a Math.round closure.
 */
function weighEdges(src: Uint16Array, mult: Float32Array, off: Int32Array, n: number): { out: Uint16Array; max: number } {
  const INF = EDGE_INF, CAP = EDGE_INF - 1; // locals: an imported binding read in the hot loop goes through the module namespace
  const out = new Uint16Array(n * 8);
  let max = 1;
  for (let u = 0; u < n; u++) {
    const mu = mult[u];
    const b = u * 8;
    for (let k = 0; k < 8; k++) {
      const q = src[b + k];
      if (q === INF) {
        out[b + k] = INF;
        continue;
      }
      let s = (q * (mu + mult[u + off[k]]) * 0.5 + 0.5) | 0;
      if (s > CAP) s = CAP;
      if (s > max) max = s;
      out[b + k] = s;
    }
  }
  return { out, max };
}

/**
 * Weighted copy of a route edge table (see weighEdges). `rev` is derived on first use (the planner's pairwise
 * matrix only runs forward searches), which halves the memory of a cached weighted table.
 */
export function weightEdgeTable(t: EdgeTable, mult: Float32Array): EdgeTable {
  const { w, h } = t;
  const n = w * h;
  const off = dirOffsets(w);
  const f = weighEdges(t.fwd, mult, off, n);
  if (t.symmetric) return { w, h, fwd: f.out, rev: f.out, maxEdge: f.max, symmetric: true };
  let rev: Uint16Array | null = null;
  const table = { w, h, fwd: f.out, maxEdge: f.max, symmetric: false } as EdgeTable;
  Object.defineProperty(table, 'rev', { enumerable: true, get: () => (rev ??= weighEdges(t.rev, mult, off, n).out) });
  return table;
}

let modelSeq = 0;

/**
 * Route-search cost model with operator priorities: base.edgeCost (seconds, heat-aware) × ½(m(a)+m(b)).
 * Its edgeCost is a SEARCH COST, not travel time: the planner recomputes true time with the base model.
 * Each instance gets a unique id so a PathSearch that caches per cost-model id never mixes two multipliers.
 */
export function weightedRouteModel(base: CostModel, mult: Float32Array, label: string): CostModel {
  return {
    id: `${base.id}+prefs#${++modelSeq}`,
    label: `${base.label} × route priorities (${label})`,
    edgeCost(g, a, b, ctx) {
      const t = base.edgeCost(g, a, b, ctx);
      return t < Infinity ? t * 0.5 * (mult[a] + mult[b]) : t;
    },
    edgePowerW: base.edgePowerW ? base.edgePowerW.bind(base) : undefined,
  };
}

/** Human-readable priorities for PlanResult.notes, e.g. "slope 1, rough 1, thermal 0.5, distance 0.3". */
export function describePrefs(n: NormPrefs): string {
  const parts: string[] = [];
  for (const k of ['slope', 'rough', 'thermal', 'radio', 'science'] as const) if (n[k] > 0) parts.push(`${k} ${+n[k].toFixed(2)}`);
  parts.push(`distance ${+n.distance.toFixed(2)}`);
  return parts.join(', ');
}
