/**
 * Raster → vector helpers for the moving map (d3-contour marching squares).
 * Output coordinates are projected metres; d3 grid coordinates are cell corners ([0, w] × [0, h]).
 */
import { contours } from 'd3-contour';
import type { GridSpec } from '@mw/shared/contracts';

export type Rings = [number, number][][];
export interface Iso {
  value: number;
  polys: Rings[]; // MultiPolygon: polygons → rings → coords
}

/** Grid placement of a (possibly downsampled) raster. */
export interface RasterFrame {
  w: number;
  h: number;
  cellM: number;
  originX: number;
  originY: number;
}

export function isobands(values: ArrayLike<number>, f: RasterFrame, thresholds: number[]): Iso[] {
  const gen = contours().size([f.w, f.h]).thresholds(thresholds).smooth(true);
  const arr = Array.from(values, (v) => (Number.isFinite(v) ? v : 1e9));
  return gen(arr).map((mp) => ({
    value: mp.value,
    polys: mp.coordinates.map((poly) =>
      poly.map((ring) => ring.map(([cx, cy]) => [f.originX + cx * f.cellM, f.originY - cy * f.cellM] as [number, number])),
    ),
  }));
}

/** Block-average a full-resolution raster by an integer factor (NaN-aware). */
export function downsample(src: ArrayLike<number>, grid: GridSpec, factor: number): { vals: Float64Array; frame: RasterFrame } {
  const w = Math.floor(grid.w / factor), h = Math.floor(grid.h / factor);
  const vals = new Float64Array(w * h);
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let s = 0, n = 0;
      for (let rr = r * factor; rr < (r + 1) * factor; rr++)
        for (let cc = c * factor; cc < (c + 1) * factor; cc++) {
          const v = src[rr * grid.w + cc];
          if (Number.isFinite(v)) { s += v; n++; }
        }
      vals[r * w + c] = n ? s / n : NaN;
    }
  return { vals, frame: { w, h, cellM: grid.cellM * factor, originX: grid.originX, originY: grid.originY } };
}

/** Elevation isolines every `step` m (index contours every 5th). */
export function demContours(dem: ArrayLike<number>, grid: GridSpec, targetCellM = 20, step = 10): Iso[] {
  const factor = Math.max(1, Math.round(targetCellM / grid.cellM));
  const { vals, frame } = downsample(dem, grid, factor);
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return [];
  const th: number[] = [];
  for (let z = Math.ceil(lo / step) * step; z <= hi; z += step) th.push(z);
  return isobands(vals, frame, th);
}
