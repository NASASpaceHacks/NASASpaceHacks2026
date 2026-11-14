/**
 * Engine adapter. Preferred: `@mw/shared/engine` (B2: createSafetyCore, toPlanPackage, sunAtLtst,
 * ltstAt). Fallback: minimal local implementations with the same signatures, kept so the visor keeps
 * guiding the crew home even if the shared engine throws, and for the offline mock fixture
 * (see createSafetyCore below).
 */
import * as eng from '@mw/shared/engine';
import {
  cellToXY,
  rulesHash,
  rowOf,
  colOf,
  type Cell,
  type FieldSet,
  type GridSpec,
  type PlanPackage,
  type PlanRequest,
  type PlanResult,
  type CoarseSafetyGrid,
} from '@mw/shared/contracts';
import { O2_DEADLINE_MIN, SHELTER_MAX_MIN, SURFACE_MIN } from '../core/constants';

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
  update(cell: Cell, tMin: number, o2Pct: number): SafetyState;
}

export const engineImpl: { safetyCore: 'shared' | 'fallback'; toPlanPackage: 'shared' | 'fallback'; sun: 'shared' | 'fallback' } = {
  safetyCore: 'fallback',
  toPlanPackage: 'fallback',
  sun: 'fallback',
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const norm360 = (a: number) => ((a % 360) + 360) % 360;
export const bearingDeg = (x0: number, y0: number, x1: number, y1: number) => norm360(Math.atan2(x1 - x0, y1 - y0) * R2D);

/** Coarse-grid lookup (50 m cells). Returns minutes or Infinity when unreachable (65535). */
export function coarseAt(grid: GridSpec, coarse: CoarseSafetyGrid, field: 'walkbackMin' | 'shelterMin', cell: Cell): number {
  const f = coarse.cellM / grid.cellM;
  const cr = Math.min(coarse.h - 1, Math.max(0, Math.floor(rowOf(grid, cell) / f)));
  const cc = Math.min(coarse.w - 1, Math.max(0, Math.floor(colOf(grid, cell) / f)));
  const arr = coarse[field];
  const v = arr[cr * coarse.w + cc];
  if (v !== 65535) return v;
  // Unreachable block (e.g. a cliff inside the 50 m block): take the best neighbour.
  let best = Infinity;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const r = cr + dr, c = cc + dc;
      if (r < 0 || c < 0 || r >= coarse.h || c >= coarse.w) continue;
      const u = arr[r * coarse.w + c];
      if (u !== 65535 && u < best) best = u;
    }
  return best;
}

/** Hints the fallback core needs that the PlanPackage does not carry (station cells from the manifest). */
export interface SafetyHints {
  stopCells?: Record<string, Cell>;
}

function fallbackSafetyCore(pkg: PlanPackage, grid: GridSpec, hints: SafetyHints = {}): SafetyCore {
  const n = pkg.route.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y] = cellToXY(grid, pkg.route[i]);
    xs[i] = x;
    ys[i] = y;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x - xs[i - 1], y - ys[i - 1]);
  }
  // Route index of every stop (first match after the previous stop; nearest vertex otherwise).
  const stopIdx = new Int32Array(pkg.stops.length);
  let prev = 0;
  pkg.stops.forEach((st, k) => {
    const c = hints.stopCells?.[st.id];
    let idx = -1;
    if (c !== undefined) {
      for (let i = prev; i < n; i++) if (pkg.route[i] === c) { idx = i; break; }
      if (idx < 0) {
        const [sx, sy] = cellToXY(grid, c);
        let bd = Infinity;
        for (let i = prev; i < n; i++) {
          const d = Math.hypot(xs[i] - sx, ys[i] - sy);
          if (d < bd) { bd = d; idx = i; }
        }
      }
    }
    if (idx < 0) idx = Math.min(n - 1, Math.round(((k + 1) / (pkg.stops.length + 1)) * (n - 1)));
    stopIdx[k] = idx;
    prev = idx;
  });
  const bingoByStop = new Map(pkg.bingo.map((b) => [b.id, b]));
  const [homeX, homeY] = cellToXY(grid, pkg.route[n - 1]);
  const f = pkg.coarse.cellM / grid.cellM;
  let last = -1;
  const out: SafetyState = {
    routeIdx: 0, offRouteM: 0, nextStopId: null, distToNextM: 0, bearingToNextDeg: 0,
    walkbackMarginMin: 0, shelterMarginMin: 0, bingoInMin: null, returnBearingDeg: 0, status: 'NOMINAL',
  };
  return {
    update(cell, tMin, o2Pct) {
      const [x, y] = cellToXY(grid, cell);
      const lo = last < 0 ? 0 : Math.max(0, last - 40);
      const hi = last < 0 ? n - 1 : Math.min(n - 1, last + 400);
      let bi = lo, bd = Infinity;
      for (let i = lo; i <= hi; i++) {
        const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      last = bi;
      out.routeIdx = bi;
      out.offRouteM = Math.sqrt(bd);
      let k = 0;
      while (k < stopIdx.length && stopIdx[k] < bi - 3) k++;
      if (k < stopIdx.length) {
        const st = pkg.stops[k];
        const si = stopIdx[k];
        out.nextStopId = st.id;
        out.distToNextM = Math.max(0, cum[si] - cum[bi]) + out.offRouteM;
        out.bearingToNextDeg = bearingDeg(x, y, xs[si], ys[si]);
        const b = bingoByStop.get(st.id);
        out.bingoInMin = b ? b.tMin - tMin : null;
      } else {
        out.nextStopId = null;
        out.distToNextM = Math.max(0, cum[n - 1] - cum[bi]) + out.offRouteM;
        out.bearingToNextDeg = bearingDeg(x, y, homeX, homeY);
        out.bingoInMin = null;
      }
      const remaining = (o2Pct / 100) * SURFACE_MIN;
      const wb = coarseAt(grid, pkg.coarse, 'walkbackMin', cell);
      const sh = coarseAt(grid, pkg.coarse, 'shelterMin', cell);
      out.walkbackMarginMin = Number.isFinite(wb) ? remaining - wb : -Infinity;
      out.shelterMarginMin = Number.isFinite(sh) ? SHELTER_MAX_MIN - sh : -Infinity;
      // Return heading: steepest descent on the coarse walkback field (terrain-aware), else straight home.
      const cr = Math.floor(rowOf(grid, cell) / f), cc = Math.floor(colOf(grid, cell) / f);
      const cw = pkg.coarse.w, ch = pkg.coarse.h, wbArr = pkg.coarse.walkbackMin;
      const here = cr >= 0 && cc >= 0 && cr < ch && cc < cw ? wbArr[cr * cw + cc] : 65535;
      let br = -1, bc = -1, bv = here;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const r = cr + dr, c = cc + dc;
          if ((dr === 0 && dc === 0) || r < 0 || c < 0 || r >= ch || c >= cw) continue;
          const v = wbArr[r * cw + c];
          if (v < bv) { bv = v; br = r; bc = c; }
        }
      if (br >= 0 && Math.hypot(x - homeX, y - homeY) > pkg.coarse.cellM) {
        const tx = grid.originX + (bc + 0.5) * pkg.coarse.cellM;
        const ty = grid.originY - (br + 0.5) * pkg.coarse.cellM;
        out.returnBearingDeg = bearingDeg(x, y, tx, ty);
      } else out.returnBearingDeg = bearingDeg(x, y, homeX, homeY);
      const bingoPassed = out.bingoInMin !== null && out.bingoInMin < 0;
      out.status =
        out.walkbackMarginMin <= 0 || bingoPassed
          ? 'RETURN_NOW'
          : out.walkbackMarginMin < 15 || out.shelterMarginMin < 0 || out.offRouteM > 30 || (out.bingoInMin !== null && out.bingoInMin < 10)
            ? 'CAUTION'
            : 'NOMINAL';
      return out;
    },
  };
}

/**
 * Onboard safety core. `engine: true` (live hab routes) runs the shared engine core — the flight logic.
 * The offline mock uses the local core by default because the shared fixtures are not mutually
 * consistent: goldenPlanResult is a hand-shaped straight-line plan, and mockFields says its stations sit
 * beyond the 30-min shelter radius, so the engine core (correctly) answers RETURN_NOW on most of the
 * route. The local core keeps the same margins/bingo/walkback logic but reports shelter-rule
 * violations as CAUTION. `?mock=1&core=engine` shows the strict engine verdict.
 */
export function createSafetyCore(pkg: PlanPackage, grid: GridSpec, hints?: SafetyHints, opts: { engine?: boolean } = {}): SafetyCore {
  if (opts.engine !== false) {
    try {
      // Engine walkback deadline = the package's 'HAB' bingo; packages without one (fixtures) use the
      // planned O₂ end minus the ingress reserve (same rule as the local core).
      const hasHab = pkg.bingo.some((b) => b.id === 'HAB');
      const core = eng.createSafetyCore(pkg, grid, hasHab ? {} : { deadlineMin: O2_DEADLINE_MIN });
      engineImpl.safetyCore = 'shared';
      return core;
    } catch (e) {
      console.warn('[visor] shared safety core unavailable, using local core', e);
    }
  }
  engineImpl.safetyCore = 'fallback';
  return fallbackSafetyCore(pkg, grid, hints);
}

/**
 * Downsample a dense field to the 50 m coarse grid. Fallback uses the block MEDIAN of finite values
 * (robust to single steep cells in the synthetic mock fields); the engine's toPlanPackage defines the
 * flight version of this reduction.
 */
function coarsen(field: Float32Array, grid: GridSpec, cellM = 50): { w: number; h: number; vals: number[] } {
  const f = Math.max(1, Math.round(cellM / grid.cellM));
  const w = Math.ceil(grid.w / f), h = Math.ceil(grid.h / f);
  const vals = new Array<number>(w * h);
  const buf = new Float64Array(f * f);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let n = 0;
      for (let rr = r * f; rr < Math.min(grid.h, (r + 1) * f); rr++)
        for (let cc = c * f; cc < Math.min(grid.w, (c + 1) * f); cc++) {
          const v = field[rr * grid.w + cc];
          if (Number.isFinite(v)) buf[n++] = v;
        }
      if (n === 0) { vals[r * w + c] = 65535; continue; }
      const arr = buf.subarray(0, n).sort();
      vals[r * w + c] = Math.min(65534, Math.ceil(arr[n >> 1]));
    }
  return { w, h, vals };
}

function fallbackToPlanPackage(
  res: PlanResult,
  req: PlanRequest,
  fields: FieldSet,
  grid: GridSpec,
  opts: { seq: number; parent?: string; author: 'hab' | 'earth' },
): PlanPackage {
  const route: number[] = [];
  for (const seg of res.segments) for (const c of seg.cells) route.push(c); // joints repeat = stop markers (engine convention)
  const wb = coarsen(fields.walkbackMin, grid);
  const sh = coarsen(fields.shelterMin, grid);
  return {
    v: 1,
    id: `${req.siteId}-${res.reqHash}-v${opts.seq}`,
    parent: opts.parent,
    seq: opts.seq,
    author: opts.author,
    createdUtc: new Date().toISOString(),
    siteId: req.siteId,
    rulesHash: rulesHash(req.rules),
    route,
    stops: res.stops,
    order: res.order,
    bingo: res.bingo,
    startLtstMin: req.startLtstMin,
    sol: req.sol,
    coarse: { cellM: 50, w: wb.w, h: wb.h, walkbackMin: wb.vals, shelterMin: sh.vals },
    sig: '',
  };
}

export function toPlanPackage(
  res: PlanResult,
  req: PlanRequest,
  fields: FieldSet,
  grid: GridSpec,
  opts: { seq: number; parent?: string; author: 'hab' | 'earth' },
): PlanPackage {
  try {
    const pkg = eng.toPlanPackage(res, req, fields, grid, opts);
    engineImpl.toPlanPackage = 'shared';
    return pkg;
  } catch (e) {
    console.warn('[visor] shared toPlanPackage unavailable, using local builder', e);
    engineImpl.toPlanPackage = 'fallback';
    return fallbackToPlanPackage(res, req, fields, grid, opts);
  }
}

// ───────────────────────────── Sun (fallback: Mars24) ─────────────────────────────

/**
 * Sun elevation/azimuth from Ls and LTST. Planetographic solar declination
 * δs = asin(0.42565 sin Ls) + 0.25° sin Ls (Allison & McEwen 2000, Planet. Space Sci. 48:215;
 * NASA GISS Mars24 algorithm). Hour angle = (LTST − 12 h) × 15°/h. Azimuth clockwise from north.
 */
function fallbackSunAtLtst(lsDeg: number, ltstMin: number, latDeg: number): { elevDeg: number; azDeg: number } {
  const ls = lsDeg * D2R;
  const dec = Math.asin(0.42565 * Math.sin(ls)) + 0.25 * D2R * Math.sin(ls);
  const H = ((ltstMin / 60 - 12) * 15) * D2R;
  const phi = latDeg * D2R;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const east = -Math.cos(dec) * Math.sin(H);
  const north = Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H);
  return { elevDeg: Math.asin(Math.max(-1, Math.min(1, sinEl))) * R2D, azDeg: norm360(Math.atan2(east, north) * R2D) };
}

/**
 * Areocentric solar longitude Ls from UTC (Mars24 algorithm, Allison & McEwen 2000; NASA GISS
 * https://www.giss.nasa.gov/tools/mars24/help/algorithm.html). TT−UTC = 69.184 s (37 leap s + 32.184 s).
 */
function fallbackLsFromUtc(utcMs: number): number {
  const jdTT = 2440587.5 + utcMs / 86400000 + 69.184 / 86400;
  const dt = jdTT - 2451545.0;
  const M = (19.3871 + 0.52402073 * dt) * D2R;
  const aFMS = 270.3871 + 0.524038496 * dt;
  const pbsTerms: [number, number, number][] = [
    [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
    [0.0021, 2.1354, 15.704], [0.002, 2.4694, 95.528], [0.0018, 32.8493, 49.095],
  ];
  let pbs = 0;
  for (const [A, tau, phi] of pbsTerms) pbs += A * Math.cos(((0.985626 * dt) / tau + phi) * D2R);
  const nuM =
    (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.05 * Math.sin(3 * M) + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + pbs;
  return norm360(aFMS + nuM);
}

export function sunAtLtst(lsDeg: number, ltstMin: number, latDeg: number): { elevDeg: number; azDeg: number } {
  try {
    const r = eng.sunAtLtst(lsDeg, ltstMin, latDeg);
    engineImpl.sun = 'shared';
    return r;
  } catch {
    engineImpl.sun = 'fallback';
    return fallbackSunAtLtst(lsDeg, ltstMin, latDeg);
  }
}

/** Season used when the site pack has no REMS Ls for the sol (the engine planner's own default, so daylight agrees). */
export function defaultLs(): number {
  return typeof eng.DEFAULT_LS_DEG === 'number' ? eng.DEFAULT_LS_DEG : fallbackLsFromUtc(Date.now());
}

/** LTST (Mars-clock min) at EVA minute t (Earth min): Mars-clock minutes are 1.0275 Earth minutes (Mars24). */
export function ltstAt(startLtstMin: number, tMin: number): number {
  try {
    return eng.ltstAt(startLtstMin, tMin);
  } catch {
    return startLtstMin + tMin / 1.027491252;
  }
}

/** Suit-heat rolling-average time constant (engine: 30-min leaky integrator) and initial state. */
export const HEAT_TAU_MIN: number = typeof eng.HEAT_TAU_MIN === 'number' ? eng.HEAT_TAU_MIN : 30;
export const HEAT_INITIAL_W: number = typeof eng.HEAT_INITIAL_W === 'number' ? eng.HEAT_INITIAL_W : 250;
