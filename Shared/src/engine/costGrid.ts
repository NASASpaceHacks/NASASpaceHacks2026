import { DEFAULT_RULES } from '../contracts/rules';
import { hornSlopeDeg, type LoadedSitePack } from '../contracts/sitepack';
import type { Cell, CostGrid, GridSpec, KeepOut, Rule } from '../contracts/types';
import { etaFromThermalInertia } from './costModel';

/** Even–odd point-in-polygon over all rings (outer ring + holes). */
export function pointInRings(x: number, y: number, rings: [number, number][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Rasterize keep-out polygons onto the engine grid (cell centres). */
export function keepoutMask(grid: GridSpec, keepouts: KeepOut[], includePlume = true): Uint8Array {
  const { w, h, cellM, originX, originY } = grid;
  const mask = new Uint8Array(w * h);
  for (const ko of keepouts) {
    if (!includePlume && ko.kind === 'plume') continue;
    if (!ko.rings.length || !ko.rings[0].length) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of ko.rings[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const c0 = Math.max(0, Math.floor((minX - originX) / cellM));
    const c1 = Math.min(w - 1, Math.floor((maxX - originX) / cellM));
    const r0 = Math.max(0, Math.floor((originY - maxY) / cellM));
    const r1 = Math.min(h - 1, Math.floor((originY - minY) / cellM));
    for (let r = r0; r <= r1; r++) {
      const y = originY - (r + 0.5) * cellM;
      for (let c = c0; c <= c1; c++) {
        const x = originX + (c + 0.5) * cellM;
        if (pointInRings(x, y, ko.rings)) mask[r * w + c] = 1;
      }
    }
  }
  return mask;
}

function ruleOn(rules: Rule[], id: Rule['id']): Rule | null {
  const r = rules.find((x) => x.id === id) ?? DEFAULT_RULES.find((x) => x.id === id) ?? null;
  return r && r.enabled && r.hard ? r : null;
}

export interface Terrain {
  elev: Float32Array;
  slopeDeg: Float32Array;
  rough: Float32Array;
  eta: Float32Array;
}

/** Rule-independent terrain layers of a pack (η from TI when present). */
export function terrainOf(pack: LoadedSitePack): Terrain {
  const g = pack.manifest.grid;
  const { w, h, cellM } = g;
  const n = w * h;
  const elev = pack.rasters.dem;
  if (!elev || elev.length !== n) throw new Error(`site pack ${pack.manifest.id}: dem raster missing or wrong size`);
  const slopeDeg = pack.rasters.slope && pack.rasters.slope.length === n ? pack.rasters.slope : hornSlopeDeg(elev, w, h, cellM);
  const rough = pack.rasters.rough && pack.rasters.rough.length === n ? pack.rasters.rough : new Float32Array(n);
  const ti = pack.rasters.ti && pack.rasters.ti.length === n ? pack.rasters.ti : null;
  const eta = new Float32Array(n);
  if (ti) for (let i = 0; i < n; i++) eta[i] = etaFromThermalInertia(ti[i]);
  else eta.fill(1);
  return { elev, slopeDeg, rough, eta };
}

/**
 * Engine cost grid from a loaded site pack.
 * blocked = slope > slope_max_deg (xEVA ConOps EVA-EXP-0042 / Artemis III ≤20°) OR nodata DEM OR
 * inside any keep-out polygon (plume zones only when plume_keepout_m is enabled) OR extraBlocked.
 * η comes from the `ti` raster when present (team mapping, see etaFromThermalInertia), else 1.0.
 */
export function buildCostGrid(pack: LoadedSitePack, extraBlocked?: Cell[], rules: Rule[] = DEFAULT_RULES, terrain?: Terrain): CostGrid {
  const g = pack.manifest.grid;
  const { w, h, cellM } = g;
  const n = w * h;
  const { elev, slopeDeg, rough, eta } = terrain ?? terrainOf(pack);
  if (elev.length !== n) throw new Error('terrain does not match the grid');

  const slopeRule = ruleOn(rules, 'slope_max_deg');
  const slopeMax = slopeRule ? slopeRule.value : Infinity;
  const blocked = keepoutMask(g, pack.manifest.keepouts ?? [], !!ruleOn(rules, 'plume_keepout_m'));
  for (let i = 0; i < n; i++) {
    const z = elev[i], s = slopeDeg[i];
    if (!(z === z) || !(s === s) || s > slopeMax) blocked[i] = 1;
  }
  if (extraBlocked) for (const c of extraBlocked) if (c >= 0 && c < n) blocked[c] = 1;
  return { w, h, cellM, elev, slopeDeg, rough, eta, blocked };
}
