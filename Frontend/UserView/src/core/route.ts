/**
 * Route geometry for the visor: the confirmed PlanPackage route as a smoothed polyline in projected
 * metres, with cumulative distance, located stops, and nearest-point queries.
 */
import { DEFAULT_CREW, cellToXY, type Bingo, type CostCtx, type CostGrid, type CrewParams, type GridSpec, type PlanPackage, type Shelter, type SitePackManifest, type Station } from '@mw/shared/contracts';
import { DEFAULT_RULES } from '@mw/shared/contracts';
import { marsMetabolicW, pandolfSanteeMars } from '@mw/shared/engine';
import { bearingDeg } from '../adapters/engine';

/** "Habitat (Hab-1)" → "HAB-1", "Pressurized rover (PR-1)" → "PR-1" (visor labels are upper case). */
export function shelterLabel(s: Pick<Shelter, 'id' | 'name'>): string {
  const m = /\(([^)]+)\)\s*$/.exec(s.name);
  return (m ? m[1] : s.id).toUpperCase();
}

/**
 * The manifest shelter at a cell. Exact cell, else within 25 m, else — the hab is fixed, so a route that
 * ends elsewhere ends at a pressurized rover the EVA officer dragged — the nearest movable shelter.
 * Prefer `routeShelter`, which uses the package's own EVA base before falling back to this guess.
 */
export function shelterAt(manifest: SitePackManifest | null, grid: GridSpec, cell: number): Shelter | null {
  const sh = manifest?.shelters ?? [];
  if (!sh.length) return null;
  const exact = sh.find((s) => s.cell === cell);
  if (exact) return exact;
  const [x, y] = cellToXY(grid, cell);
  const d = (s: Shelter) => Math.hypot(s.x - x, s.y - y);
  const near = [...sh].sort((a, b) => d(a) - d(b));
  if (d(near[0]) < 25) return near[0];
  return near.find((s) => s.movable) ?? null;
}

/**
 * The shelter at a route endpoint, using the package's EVA base (`pkg.base`: the hab or the pressurized
 * rover, at the cell it was staged from — the rover may sit far from its manifest position after the
 * EVA officer dragged it). An endpoint within 25 m of the base IS the base (manifest name, staged
 * position). Otherwise (e.g. a SEP return to a nearer shelter) the manifest shelter at that cell; the
 * nearest-movable-shelter guess remains only for packages without `base`.
 */
export function routeShelter(pkg: Pick<PlanPackage, 'base'>, manifest: SitePackManifest | null, grid: GridSpec, cell: number): Shelter | null {
  const b = pkg.base;
  if (b && b.cell >= 0 && b.cell < grid.w * grid.h) {
    const [bx, by] = cellToXY(grid, b.cell);
    const [x, y] = cellToXY(grid, cell);
    if (b.cell === cell || Math.hypot(bx - x, by - y) < 25) {
      const m = manifest?.shelters.find((s) => s.id === b.id);
      return { id: b.id, kind: b.kind, name: m?.name ?? b.id, movable: m?.movable ?? b.kind !== 'hab', cell: b.cell, x: bx, y: by };
    }
    const sh = manifest?.shelters ?? [];
    const exact = sh.find((s) => s.cell === cell) ?? sh.find((s) => Math.hypot(s.x - x, s.y - y) < 25 && s.id !== b.id);
    if (exact) return exact;
  }
  return shelterAt(manifest, grid, cell);
}

/** Terrain the visor needs to time and cost the route like the planner (engine cost grid subset). */
export interface RouteTerrain {
  elev: Float32Array;
  /** Pandolf terrain factor per cell (engine etaFromThermalInertia), or null → 1.0 (engine default without TI). */
  eta: Float32Array | null;
}

export interface RouteStop {
  id: string;
  name: string;
  idx: number;
  s: number;
  x: number;
  y: number;
  cell: number;
  arriveMin: number;
  departMin: number;
  dwellMin: number;
  station: Station | null;
  bingo: Bingo | null;
}

export class RouteModel {
  readonly n: number;
  readonly cells: number[];
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly cum: Float64Array;
  readonly length: number;
  readonly stops: RouteStop[];
  /** Route end = the EVA base (or, for a SEP return, the nearest shelter). `name` = short visor label (PR-1). */
  readonly home: { x: number; y: number; cell: number; name: string; id: string; full: string; kind: Shelter['kind'] | null };
  readonly start: { x: number; y: number; cell: number; atHome: boolean };
  /**
   * Per route segment i (cells[i] → cells[i+1]): planned travel time (s) and metabolic power (W) forward
   * and backward, from the engine cost model (pandolf-santee-mars edgeCost / edgePowerW) on the DEM.
   * Until the DEM is loaded: planar distance at v0 and level-ground power.
   */
  edgeT: Float64Array;
  edgeP: Float64Array;
  edgePRev: Float64Array;
  terrain = false;

  constructor(readonly pkg: PlanPackage, readonly grid: GridSpec, manifest: SitePackManifest | null) {
    // Dedupe consecutive repeats; a repeat is the engine's stop marker (leg end + next leg start).
    const cells: number[] = [];
    const markers: number[] = [];
    for (let i = 0; i < pkg.route.length; i++) {
      const c = pkg.route[i];
      if (cells[cells.length - 1] === c) {
        markers.push(cells.length - 1);
        continue;
      }
      cells.push(c);
    }
    if (cells.length === 1) cells.push(cells[0]);
    const useMarkers = markers.length >= pkg.stops.length && pkg.stops.length > 0;
    this.cells = cells;
    const n = (this.n = cells.length);
    const rx = new Float64Array(n), ry = new Float64Array(n);
    for (let i = 0; i < n; i++) [rx[i], ry[i]] = cellToXY(grid, cells[i]);

    // Locate stops on the raw cell chain.
    const stationById = new Map((manifest?.stations ?? []).map((s) => [s.id, s]));
    const bingoById = new Map(pkg.bingo.map((b) => [b.id, b]));
    const stopIdx: number[] = [];
    let prev = 0;
    pkg.stops.forEach((st, k) => {
      const station = stationById.get(st.id) ?? null;
      let idx = useMarkers ? markers[pkg.order.indexOf(st.id) >= 0 ? pkg.order.indexOf(st.id) : k] ?? -1 : -1;
      if (idx < prev) idx = -1;
      if (idx < 0 && station) {
        for (let i = prev; i < n; i++) if (cells[i] === station.cell) { idx = i; break; }
        if (idx < 0) {
          let bd = Infinity;
          for (let i = prev; i < n; i++) {
            const d = Math.hypot(rx[i] - station.x, ry[i] - station.y);
            if (d < bd) { bd = d; idx = i; }
          }
        }
      }
      if (idx < 0) idx = Math.min(n - 1, Math.max(prev, Math.round(((k + 1) / (pkg.stops.length + 1)) * (n - 1))));
      stopIdx.push(idx);
      prev = idx;
    });

    // Light smoothing (±2 vertices) to remove 8-connected zig-zags; endpoints and stops pinned.
    const pinned = new Set([0, n - 1, ...stopIdx]);
    const xs = new Float64Array(n), ys = new Float64Array(n);
    const K = 2;
    for (let i = 0; i < n; i++) {
      if (pinned.has(i)) { xs[i] = rx[i]; ys[i] = ry[i]; continue; }
      let sx = 0, sy = 0, m = 0;
      for (let j = Math.max(0, i - K); j <= Math.min(n - 1, i + K); j++) { sx += rx[j]; sy += ry[j]; m++; }
      xs[i] = sx / m;
      ys[i] = sy / m;
    }
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    this.xs = xs;
    this.ys = ys;
    this.cum = cum;
    this.length = cum[n - 1];

    this.stops = pkg.stops.map((st, k) => {
      const station = stationById.get(st.id) ?? null;
      const idx = stopIdx[k];
      return {
        id: st.id,
        name: station?.name ?? st.id,
        idx,
        s: cum[idx],
        x: xs[idx],
        y: ys[idx],
        cell: cells[idx],
        arriveMin: st.arriveMin,
        departMin: st.departMin,
        dwellMin: Math.max(1, st.departMin - st.arriveMin),
        station,
        bingo: bingoById.get(st.id) ?? null,
      };
    });

    const endCell = cells[n - 1];
    const shelter = routeShelter(pkg, manifest, grid, endCell);
    this.home = {
      x: xs[n - 1], y: ys[n - 1], cell: endCell,
      name: shelter ? shelterLabel(shelter) : 'HAB', id: shelter?.id ?? 'HAB', full: shelter?.name ?? 'Habitat', kind: shelter?.kind ?? null,
    };
    this.start = { x: xs[0], y: ys[0], cell: cells[0], atHome: Math.hypot(xs[0] - xs[n - 1], ys[0] - ys[n - 1]) < 25 };

    this.edgeT = new Float64Array(Math.max(1, n - 1));
    this.edgeP = new Float64Array(Math.max(1, n - 1));
    this.edgePRev = new Float64Array(Math.max(1, n - 1));
    const crew = DEFAULT_CREW;
    const pLevel = marsMetabolicW(crew, crew.v0, 0, 1);
    for (let i = 0; i + 1 < n; i++) {
      this.edgeT[i] = Math.hypot(rx[i + 1] - rx[i], ry[i + 1] - ry[i]) / crew.v0;
      this.edgeP[i] = this.edgePRev[i] = pLevel;
    }
  }

  /**
   * Time and cost every segment with the engine's own cost model on the real DEM (same crew, v0 and
   * terrain factor as the planner), so the simulated crew's pace, metabolic rate and heat follow the plan.
   */
  setTerrain(t: RouteTerrain, crew: CrewParams = DEFAULT_CREW) {
    const g = this.grid;
    const n = g.w * g.h;
    if (t.elev.length !== n) return;
    const grid: CostGrid = {
      w: g.w, h: g.h, cellM: g.cellM, elev: t.elev, slopeDeg: t.elev, rough: t.elev,
      eta: t.eta && t.eta.length === n ? t.eta : onesF32(n), blocked: zerosU8(n),
    };
    const ctx: CostCtx = { crew, rules: DEFAULT_RULES, speedFactor: 1 };
    const m = pandolfSanteeMars;
    for (let i = 0; i + 1 < this.n; i++) {
      const a = this.cells[i], b = this.cells[i + 1];
      const dt = m.edgeCost(grid, a, b, ctx);
      if (!(dt < Infinity)) continue; // nodata: keep the planar estimate
      this.edgeT[i] = dt;
      this.edgeP[i] = m.edgePowerW!(grid, a, b, ctx);
      this.edgePRev[i] = m.edgePowerW!(grid, b, a, ctx);
    }
    this.terrain = true;
  }

  /** Walking speed along the smoothed polyline on segment i (m/s) that reproduces the planned edge time. */
  speedOn(i: number): number {
    const j = Math.max(0, Math.min(this.n - 2, i));
    const len = this.cum[j + 1] - this.cum[j];
    const t = this.edgeT[j];
    return t > 0 && len > 0 ? len / t : DEFAULT_CREW.v0;
  }

  /** Segment index i and fraction f such that s lies on [i, i+1]. */
  locate(s: number): [number, number] {
    const cum = this.cum;
    if (s <= 0) return [0, 0];
    if (s >= this.length) return [this.n - 2, 1];
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const segLen = cum[lo + 1] - cum[lo];
    return [lo, segLen > 0 ? (s - cum[lo]) / segLen : 0];
  }

  pointAt(s: number): [number, number] {
    const [i, f] = this.locate(s);
    const j = Math.min(this.n - 1, i + 1);
    return [this.xs[i] + (this.xs[j] - this.xs[i]) * f, this.ys[i] + (this.ys[j] - this.ys[i]) * f];
  }

  /** Bearing of travel at s (direction +1 = along the route, −1 = backtracking), via a look-ahead point. */
  bearingAt(s: number, dir: 1 | -1 = 1, look = 14): number {
    const [x0, y0] = this.pointAt(s);
    let s1 = s + dir * look;
    s1 = Math.max(0, Math.min(this.length, s1));
    if (Math.abs(s1 - s) < 1) {
      const [xa, ya] = this.pointAt(s - dir * look);
      return bearingDeg(xa, ya, x0, y0);
    }
    const [x1, y1] = this.pointAt(s1);
    return bearingDeg(x0, y0, x1, y1);
  }

  /** Nearest along-route distance to (x, y), optionally searching only ±windowM around s0. */
  nearest(x: number, y: number, s0?: number, windowM = 300): { s: number; d: number } {
    let i0 = 0, i1 = this.n - 2;
    if (s0 !== undefined) {
      i0 = this.locate(Math.max(0, s0 - windowM))[0];
      i1 = Math.min(this.n - 2, this.locate(Math.min(this.length, s0 + windowM))[0] + 1);
    }
    let best = { s: 0, d: Infinity };
    for (let i = i0; i <= i1; i++) {
      const ax = this.xs[i], ay = this.ys[i], bx = this.xs[i + 1], by = this.ys[i + 1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
      const px = ax + dx * t, py = ay + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { s: this.cum[i] + Math.sqrt(L2) * t, d };
    }
    return best;
  }

  /** Polyline coordinates between two along-route distances (inclusive), in projected metres. */
  slice(s0: number, s1: number): [number, number][] {
    const a = Math.max(0, Math.min(s0, s1)), b = Math.min(this.length, Math.max(s0, s1));
    const out: [number, number][] = [this.pointAt(a)];
    const [ia] = this.locate(a);
    const [ib] = this.locate(b);
    for (let i = ia + 1; i <= ib; i++) out.push([this.xs[i], this.ys[i]]);
    out.push(this.pointAt(b));
    return out;
  }
}

let ones: Float32Array | null = null;
let zeros: Uint8Array | null = null;
function onesF32(n: number): Float32Array {
  if (!ones || ones.length !== n) ones = new Float32Array(n).fill(1);
  return ones;
}
function zerosU8(n: number): Uint8Array {
  if (!zeros || zeros.length !== n) zeros = new Uint8Array(n);
  return zeros;
}
