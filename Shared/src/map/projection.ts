import proj4 from 'proj4';
import { addProjection, get as getProjection } from 'ol/proj';
import Projection from 'ol/proj/Projection';
import { register } from 'ol/proj/proj4';
import type { GridSpec } from '../contracts/types';
import { MARS_RADIUS_M, eqcInverse, gridExtent, parseEqc } from '../contracts/grid';

/** Stable OpenLayers projection code for a site's local Mars eqc projection. */
export function marsProjectionCode(grid: Pick<GridSpec, 'proj4'>): string {
  const { lon0, latTs, R } = parseEqc(grid.proj4);
  return `MARS2000-EQC:${lon0}:${latTs}:${R}`;
}

/**
 * Register the site's local Mars projection with proj4 + OpenLayers and return it.
 *
 * Why the custom `getPointResolution`:
 * OpenLayers' default `getPointResolution()` (used by the ScaleLine control, by
 * `getPointResolution(...)` callers and by measuring helpers) transforms the pixel to EPSG:4326
 * and measures it with a haversine on the **Earth** sphere (R = 6,371,008.8 m). Our coordinates
 * are already metres on the IAU Mars 2000 sphere (R = 3,396,190 m; Archinal et al. 2018,
 * doi:10.1007/s10569-017-9805-5), so that path would inflate every scale bar and distance by
 * 6,371,008.8 / 3,396,190 ≈ 1.876×. Equidistant cylindrical has unit scale along meridians
 * everywhere and along the standard parallel (`lat_ts`); our AOI is centred on `lat_ts`, so the
 * parallel-scale error cos(φ)/cos(φ_ts) − 1 is < 1e-5 at the site centre (0.005° off lat_ts) and < 1e-4 at the
 * corners of a 5 km AOI (≤ 5 cm on a 500 m scale bar; see projection.test.ts).
 * Returning the input resolution unchanged is therefore the true Mars ground resolution.
 */
export function registerMarsProjection(grid: GridSpec): Projection {
  const code = marsProjectionCode(grid);
  const extent = gridExtent(grid);
  const existing = getProjection(code) as Projection | null;
  if (existing) {
    existing.setExtent(extent);
    return existing;
  }
  proj4.defs(code, grid.proj4);
  const projection = new Projection({
    code,
    units: 'm',
    extent,
    global: false,
    // Coordinates are true Mars metres; see the comment above. Do NOT remove.
    getPointResolution: (resolution: number) => resolution,
  });
  addProjection(projection);
  // Adds proj4-backed transforms between our projection and every other registered code.
  register(proj4);
  return projection;
}

/** Great-circle distance (m) on the Mars 2000 sphere between two projected points of a site grid. */
export function marsGroundDistanceM(grid: Pick<GridSpec, 'proj4'>, a: [number, number], b: [number, number]): number {
  const { lon0, latTs, R } = parseEqc(grid.proj4);
  const [lon1, lat1] = eqcInverse(a[0], a[1], lon0, latTs, R);
  const [lon2, lat2] = eqcInverse(b[0], b[1], lon0, latTs, R);
  return haversineM(lon1, lat1, lon2, lat2, R);
}

export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number, R = MARS_RADIUS_M): number {
  const d2r = Math.PI / 180;
  const p1 = lat1 * d2r, p2 = lat2 * d2r;
  const dp = p2 - p1, dl = (lon2 - lon1) * d2r;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Planetocentric lon/lat (°E, °N) of a projected point. */
export function toLonLat(grid: Pick<GridSpec, 'proj4'>, x: number, y: number): [number, number] {
  const { lon0, latTs, R } = parseEqc(grid.proj4);
  return eqcInverse(x, y, lon0, latTs, R);
}
