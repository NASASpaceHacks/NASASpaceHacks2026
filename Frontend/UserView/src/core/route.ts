/**
 * Route geometry for the visor: the confirmed PlanPackage route as a smoothed polyline in projected
 * metres, with cumulative distance, located stops, and nearest-point queries.
 */
import { cellToXY, type Bingo, type GridSpec, type PlanPackage, type SitePackManifest, type Station } from '@mw/shared/contracts';
import { bearingDeg } from '../adapters/engine';

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
  readonly home: { x: number; y: number; cell: number; name: string };
  readonly start: { x: number; y: number; cell: number };

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
    const shelter = manifest?.shelters.find((s) => s.cell === endCell) ??
      manifest?.shelters.find((s) => Math.hypot(s.x - xs[n - 1], s.y - ys[n - 1]) < 25);
    this.home = { x: xs[n - 1], y: ys[n - 1], cell: endCell, name: shelter ? shelter.id : 'HAB' };
    this.start = { x: xs[0], y: ys[0], cell: cells[0] };
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
