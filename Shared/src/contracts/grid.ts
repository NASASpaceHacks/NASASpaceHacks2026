import type { Cell, GridSpec } from './types';

/** Mars 2000 (IAU 49900) sphere radius in metres. */
export const MARS_RADIUS_M = 3_396_190;

export const cellOf = (g: { w: number }, row: number, col: number): Cell => row * g.w + col;
export const rowOf = (g: { w: number }, c: Cell): number => Math.floor(c / g.w);
export const colOf = (g: { w: number }, c: Cell): number => c % g.w;

/** Projected (x, y) metres of a cell centre. */
export function cellToXY(g: GridSpec, c: Cell): [number, number] {
  const r = rowOf(g, c);
  const k = colOf(g, c);
  return [g.originX + (k + 0.5) * g.cellM, g.originY - (r + 0.5) * g.cellM];
}

/** Cell containing projected (x, y), or -1 if outside the grid. */
export function xyToCell(g: GridSpec, x: number, y: number): Cell {
  const k = Math.floor((x - g.originX) / g.cellM);
  const r = Math.floor((g.originY - y) / g.cellM);
  if (k < 0 || r < 0 || k >= g.w || r >= g.h) return -1;
  return r * g.w + k;
}

/** Projected extent [minX, minY, maxX, maxY]. */
export function gridExtent(g: GridSpec): [number, number, number, number] {
  return [g.originX, g.originY - g.h * g.cellM, g.originX + g.w * g.cellM, g.originY];
}

/** Euclidean distance between two cells in metres (planar, local projection). */
export function cellDistM(g: { w: number; cellM: number }, a: Cell, b: Cell): number {
  const dr = Math.floor(a / g.w) - Math.floor(b / g.w);
  const dc = (a % g.w) - (b % g.w);
  return Math.hypot(dr, dc) * g.cellM;
}

/**
 * Inverse of the local equidistant-cylindrical projection (+proj=eqc +lat_ts +lon_0 +R).
 * Returns planetocentric [lon°E, lat°N]. Exact for eqc on a sphere; used for cursor readout.
 */
export function eqcInverse(
  x: number,
  y: number,
  lon0Deg: number,
  latTsDeg: number,
  R = MARS_RADIUS_M,
): [number, number] {
  const latTs = (latTsDeg * Math.PI) / 180;
  const lon = lon0Deg + ((x / (R * Math.cos(latTs))) * 180) / Math.PI;
  const lat = ((y / R) * 180) / Math.PI;
  return [lon, lat];
}

export function eqcForward(
  lonDeg: number,
  latDeg: number,
  lon0Deg: number,
  latTsDeg: number,
  R = MARS_RADIUS_M,
): [number, number] {
  const latTs = (latTsDeg * Math.PI) / 180;
  const x = R * Math.cos(latTs) * (((lonDeg - lon0Deg) * Math.PI) / 180);
  const y = R * ((latDeg * Math.PI) / 180);
  return [x, y];
}

/** Parse lon_0 and lat_ts out of a proj4 eqc string. */
export function parseEqc(proj4: string): { lon0: number; latTs: number; R: number } {
  const num = (k: string, d: number) => {
    const m = proj4.match(new RegExp(`\\+${k}=(-?[0-9.]+)`));
    return m ? parseFloat(m[1]) : d;
  };
  return { lon0: num('lon_0', 0), latTs: num('lat_ts', 0), R: num('R', MARS_RADIUS_M) };
}
