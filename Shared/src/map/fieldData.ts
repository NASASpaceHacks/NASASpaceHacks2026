import { contours } from 'd3-contour';
import type { Cell, GridSpec, KeepOut } from '../contracts/types';

/**
 * Pure (DOM-free) raster helpers for map overlays: derived fields, safe-zone masks, tiling and
 * isochrone extraction. Everything is on the engine grid (row 0 = north, cell = row * w + col).
 */

/** Large finite stand-in for "unreachable" so GPU float textures and comparisons stay well-defined. */
export const UNREACHABLE = 1e5;

/** Copy of `src` with non-finite values replaced by `cap` (default UNREACHABLE). */
export function finiteField(src: ArrayLike<number>, cap = UNREACHABLE): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    out[i] = Number.isFinite(v) ? Math.min(v, cap) : cap;
  }
  return out;
}

/** Straight-line distance (m) from one cell to every cell. */
export function distanceFromCell(grid: Pick<GridSpec, 'w' | 'h' | 'cellM'>, cell: Cell): Float32Array {
  const { w, h, cellM } = grid;
  const r0 = Math.floor(cell / w), c0 = cell % w;
  const out = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    const dr = (r - r0) * cellM;
    for (let c = 0; c < w; c++) {
      const dc = (c - c0) * cellM;
      out[r * w + c] = Math.sqrt(dr * dr + dc * dc);
    }
  }
  return out;
}

/**
 * Distance (m) from every cell to the nearest cell where `mask` is non-zero.
 * Two-pass 8-neighbour chamfer (weights 1, √2; Borgefors 1986, doi:10.1016/S0734-189X(86)80047-0).
 * Max error vs Euclidean ≈ 8 %. Cells with no target anywhere get UNREACHABLE.
 */
export function chamferDistanceM(mask: ArrayLike<number>, w: number, h: number, cellM: number): Float32Array {
  const INF = 1e30;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const a = cellM, b = cellM * Math.SQRT2;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      let v = d[i];
      if (v === 0) continue;
      if (c > 0) v = Math.min(v, d[i - 1] + a);
      if (r > 0) {
        v = Math.min(v, d[i - w] + a);
        if (c > 0) v = Math.min(v, d[i - w - 1] + b);
        if (c < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let r = h - 1; r >= 0; r--) {
    for (let c = w - 1; c >= 0; c--) {
      const i = r * w + c;
      let v = d[i];
      if (v === 0) continue;
      if (c < w - 1) v = Math.min(v, d[i + 1] + a);
      if (r < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (c < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (c > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) if (d[i] >= INF) d[i] = UNREACHABLE;
  return d;
}

function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rasterize keep-out polygons (first ring outer, others holes) onto the grid: 1 = inside. */
export function rasterizeKeepouts(grid: GridSpec, keepouts: Pick<KeepOut, 'rings'>[]): Uint8Array {
  const { w, h, cellM, originX, originY } = grid;
  const out = new Uint8Array(w * h);
  for (const k of keepouts) {
    const outer = k.rings[0];
    if (!outer?.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of outer) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const c0 = Math.max(0, Math.floor((minX - originX) / cellM));
    const c1 = Math.min(w - 1, Math.ceil((maxX - originX) / cellM));
    const r0 = Math.max(0, Math.floor((originY - maxY) / cellM));
    const r1 = Math.min(h - 1, Math.ceil((originY - minY) / cellM));
    for (let r = r0; r <= r1; r++) {
      const y = originY - (r + 0.5) * cellM;
      for (let c = c0; c <= c1; c++) {
        const x = originX + (c + 0.5) * cellM;
        if (!pointInRing(x, y, outer)) continue;
        let hole = false;
        for (let k2 = 1; k2 < k.rings.length && !hole; k2++) hole = pointInRing(x, y, k.rings[k2]);
        if (!hole) out[r * w + c] = 1;
      }
    }
  }
  return out;
}

/** Inputs for the safe-zone (reachable-area) visualisation; all length w*h. */
export interface SafeZoneInputs {
  w: number;
  h: number;
  cellM: number;
  /** Slope (deg). */
  slope: Float32Array;
  /** Straight-line distance from the hab (m). */
  distHab: Float32Array;
  /** Outbound + contingency walkback time (min): the touch-and-return cost of visiting a cell. */
  walkbackTotal: Float32Array;
  /** Time to the nearest shelter (min). */
  shelter: Float32Array;
  /** Round-trip minutes spent outside hab line of sight to visit the cell. */
  losGap: Float32Array;
  /** 1 = keep-out zone / reported hazard. */
  keepout: Uint8Array;
  /** Engine hard-blocked cells (slope, keep-outs, nodata, hazards). */
  blocked: Uint8Array;
}

export interface SafeZoneLimits {
  slopeMax: number;
  radiusMax: number;
  walkbackMax: number;
  shelterMax: number;
  losGapMax: number;
  useKeepout: boolean;
  useBlocked: boolean;
}

export const NO_LIMITS: SafeZoneLimits = {
  slopeMax: Infinity,
  radiusMax: Infinity,
  walkbackMax: Infinity,
  shelterMax: Infinity,
  losGapMax: Infinity,
  useKeepout: false,
  useBlocked: false,
};

/** 1 = cell satisfies every active limit. */
export function safeZoneMask(z: SafeZoneInputs, lim: SafeZoneLimits, out = new Uint8Array(z.w * z.h)): Uint8Array {
  const n = z.w * z.h;
  for (let i = 0; i < n; i++) {
    out[i] =
      z.slope[i] <= lim.slopeMax &&
      z.distHab[i] <= lim.radiusMax &&
      z.walkbackTotal[i] <= lim.walkbackMax &&
      z.shelter[i] <= lim.shelterMax &&
      z.losGap[i] <= lim.losGapMax &&
      !(lim.useKeepout && z.keepout[i]) &&
      !(lim.useBlocked && z.blocked[i])
        ? 1
        : 0;
  }
  return out;
}

/** Area (km²) of non-zero cells. */
export function maskAreaKm2(mask: ArrayLike<number>, cellM: number): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return (n * cellM * cellM) / 1e6;
}

/** A band source: `data[i * stride + offset]` is the value of cell i. */
export interface BandSource {
  data: ArrayLike<number>;
  stride?: number;
  offset?: number;
}

/**
 * Cut a tile out of one or more grid bands, interleaved by pixel (OpenLayers DataTile layout).
 * Pixels outside the grid get `fill`.
 */
export function sliceTile(
  bands: BandSource[],
  w: number,
  h: number,
  col0: number,
  row0: number,
  tileW: number,
  tileH: number,
  fill = 0,
): Float32Array {
  const nb = bands.length;
  const out = new Float32Array(tileW * tileH * nb);
  for (let j = 0; j < tileH; j++) {
    const r = row0 + j;
    for (let i = 0; i < tileW; i++) {
      const c = col0 + i;
      const o = (j * tileW + i) * nb;
      if (r < 0 || c < 0 || r >= h || c >= w) {
        for (let b = 0; b < nb; b++) out[o + b] = fill;
        continue;
      }
      const cell = r * w + c;
      for (let b = 0; b < nb; b++) {
        const s = bands[b];
        const v = s.data[cell * (s.stride ?? 1) + (s.offset ?? 0)];
        out[o + b] = Number.isFinite(v) ? v : fill;
      }
    }
  }
  return out;
}

/** Block-average downsample (factor `k`), NaN-aware. Returns the new size too. */
export function downsample(values: ArrayLike<number>, w: number, h: number, k: number): { data: Float32Array; w: number; h: number } {
  if (k <= 1) return { data: Float32Array.from(values), w, h };
  const W = Math.ceil(w / k), H = Math.ceil(h / k);
  const out = new Float32Array(W * H);
  for (let R = 0; R < H; R++) {
    for (let C = 0; C < W; C++) {
      let s = 0, n = 0;
      for (let r = R * k; r < Math.min(h, R * k + k); r++) {
        for (let c = C * k; c < Math.min(w, C * k + k); c++) {
          const v = values[r * w + c];
          if (Number.isFinite(v)) { s += v; n++; }
        }
      }
      out[R * W + C] = n ? s / n : UNREACHABLE;
    }
  }
  return { data: out, w: W, h: H };
}

export interface IsoLine {
  /** Threshold value of this isoline (field units). */
  value: number;
  /** Line strings in projected metres (each ring of every polygon). */
  lines: [number, number][][];
}

/**
 * Isolines of a grid field (d3-contour marching squares) in projected metres.
 * d3-contour places the value of grid index (c, r) at pixel point (c + 0.5, r + 0.5), so pixel
 * point (px, py) maps to x = originX + px·cellM·k, y = originY − py·cellM·k for downsample k.
 * Lines shorter than `minLengthM` are dropped (speckle).
 */
export function isolines(
  grid: Pick<GridSpec, 'w' | 'h' | 'cellM' | 'originX' | 'originY'>,
  values: ArrayLike<number>,
  thresholds: number[],
  opts: { downsample?: number; minLengthM?: number; cap?: number } = {},
): IsoLine[] {
  const k = Math.max(1, Math.round(opts.downsample ?? 1));
  const cap = opts.cap ?? UNREACHABLE;
  const ds = downsample(finiteField(values, cap), grid.w, grid.h, k);
  const step = grid.cellM * k;
  const minLen = opts.minLengthM ?? step * 6;
  const gen = contours().size([ds.w, ds.h]).smooth(true).thresholds(thresholds);
  // d3 contours enclose values >= threshold, so rings run along the grid frame wherever the
  // region touches it. Those frame runs are not isolines: split the rings there.
  const onFrame = (px: number, py: number) => px <= 1e-9 || py <= 1e-9 || px >= ds.w - 1e-9 || py >= ds.h - 1e-9;
  return gen(Array.from(ds.data)).map((mp) => {
    const lines: [number, number][][] = [];
    const flush = (pts: [number, number][], len: number) => {
      if (pts.length > 1 && len >= minLen) lines.push(pts);
    };
    for (const poly of mp.coordinates) {
      for (const ring of poly) {
        let pts: [number, number][] = [];
        let len = 0;
        for (let i = 0; i < ring.length; i++) {
          const [px, py] = ring[i];
          if (onFrame(px, py)) {
            flush(pts, len);
            pts = [];
            len = 0;
            continue;
          }
          if (pts.length) {
            const [qx, qy] = ring[i - 1];
            len += Math.hypot(px - qx, py - qy) * step;
          }
          pts.push([grid.originX + px * step, grid.originY - py * step]);
        }
        flush(pts, len);
      }
    }
    return { value: mp.value, lines };
  });
}

/** Polygons (projected metres; first ring outer) enclosing non-zero cells of a mask. */
export function maskPolygons(
  grid: Pick<GridSpec, 'w' | 'h' | 'cellM' | 'originX' | 'originY'>,
  mask: ArrayLike<number>,
  opts: { downsample?: number; minAreaM2?: number } = {},
): [number, number][][][] {
  const k = Math.max(1, Math.round(opts.downsample ?? 1));
  const ds = downsample(mask, grid.w, grid.h, k);
  const step = grid.cellM * k;
  const minArea = opts.minAreaM2 ?? step * step * 4;
  const [mp] = contours().size([ds.w, ds.h]).smooth(true).thresholds([0.5])(Array.from(ds.data));
  const out: [number, number][][][] = [];
  for (const poly of mp?.coordinates ?? []) {
    const rings = poly.map((ring) => ring.map(([px, py]) => [grid.originX + px * step, grid.originY - py * step] as [number, number]));
    if (!rings[0] || Math.abs(ringArea(rings[0])) < minArea) continue;
    // Drop speckle holes too (small excluded islands inside the region).
    out.push([rings[0], ...rings.slice(1).filter((h) => Math.abs(ringArea(h)) >= minArea)]);
  }
  return out;
}

function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/** Sample a grid field at a projected point (nearest cell); NaN outside the grid. */
export function sampleAt(grid: Pick<GridSpec, 'w' | 'h' | 'cellM' | 'originX' | 'originY'>, values: ArrayLike<number>, x: number, y: number, stride = 1, offset = 0): number {
  const c = Math.floor((x - grid.originX) / grid.cellM);
  const r = Math.floor((grid.originY - y) / grid.cellM);
  if (c < 0 || r < 0 || c >= grid.w || r >= grid.h) return NaN;
  return values[(r * grid.w + c) * stride + offset];
}
