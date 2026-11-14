import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import { getPointResolution, transform } from 'ol/proj';
import { register } from 'ol/proj/proj4';
import type { GridSpec } from '../contracts/types';
import { eqcForward, eqcInverse, gridExtent } from '../contracts/grid';
import { marsGroundDistanceM, registerMarsProjection, toLonLat } from './projection';
import { formatDistance, niceScaleBar } from './scale';

// gale-v1 AOI (docs/AGENTS.md): 5 km × 5 km at 5 m, centred on 137.388°E, −4.805°N.
const PROJ = '+proj=eqc +lat_ts=-4.8 +lat_0=0 +lon_0=137.39 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs';
const [cx, cy] = eqcForward(137.388, -4.805, 137.39, -4.8);
const GRID: GridSpec = {
  w: 1000,
  h: 1000,
  cellM: 5,
  proj4: PROJ,
  originX: cx - 2500,
  originY: cy + 2500,
  centerLonLat: [137.388, -4.805],
};
const EARTH_R = 6371008.8; // OpenLayers' default sphere (ol/sphere DEFAULT_RADIUS)
const MARS_R = 3396190;

describe('registerMarsProjection', () => {
  const proj = registerMarsProjection(GRID);

  it('creates a metre projection whose extent is the AOI', () => {
    expect(proj.getUnits()).toBe('m');
    expect(proj.getExtent()).toEqual(gridExtent(GRID));
    expect(registerMarsProjection(GRID)).toBe(proj); // idempotent
  });

  it('transforms to planetocentric lon/lat exactly like eqcInverse', () => {
    const pts: [number, number][] = [[cx, cy], [GRID.originX, GRID.originY], [GRID.originX + 5000, GRID.originY - 5000]];
    for (const [x, y] of pts) {
      const [lon, lat] = transform([x, y], proj, 'EPSG:4326');
      const [elon, elat] = eqcInverse(x, y, 137.39, -4.8);
      expect(lon).toBeCloseTo(elon, 9);
      expect(lat).toBeCloseTo(elat, 9);
    }
    const [lon, lat] = toLonLat(GRID, cx, cy);
    expect(lon).toBeCloseTo(137.388, 9);
    expect(lat).toBeCloseTo(-4.805, 9);
  });

  it('ScaleLine distance equals true Mars metres (centre and AOI corners)', () => {
    // ol/control/ScaleLine computes its length as minWidth × getPointResolution(projection,
    // viewResolution, viewCenter, 'm'). We call the exact same function here (DOM-free).
    for (const resolution of [0.5, 2, 5, 12.5]) {
      for (const [x, y] of [[cx, cy], [GRID.originX + 1, GRID.originY - 1], [GRID.originX + 4999, GRID.originY - 4999]]) {
        const barPx = 110;
        const scaleLineMetres = barPx * getPointResolution(proj, resolution, [x, y], 'm');
        const span = barPx * resolution;
        const trueMars = marsGroundDistanceM(GRID, [x - span / 2, y], [x + span / 2, y]);
        const isCentre = x === cx && y === cy;
        expect(Math.abs(scaleLineMetres - trueMars) / trueMars).toBeLessThan(isCentre ? 1e-5 : 1e-4);
        // Vertical (meridian) scale is exact in eqc.
        const trueMarsNS = marsGroundDistanceM(GRID, [x, y - span / 2], [x, y + span / 2]);
        expect(Math.abs(scaleLineMetres - trueMarsNS) / trueMarsNS).toBeLessThan(1e-9);
      }
    }
  });

  it("would be ~1.88× wrong with OpenLayers' default (Earth-sphere) point resolution", () => {
    proj4.defs('TEST:MARS-NOFIX', PROJ);
    register(proj4);
    const r = 5;
    const naive = getPointResolution('TEST:MARS-NOFIX', r, [cx, cy], 'm');
    expect(naive / r).toBeCloseTo(EARTH_R / MARS_R, 3);
    expect(naive / r).toBeGreaterThan(1.87);
    expect(getPointResolution(proj, r, [cx, cy], 'm')).toBe(r);
  });
});

describe('niceScaleBar', () => {
  it('picks 1-2-5 lengths at least minWidth wide', () => {
    expect(niceScaleBar(5, 90)).toEqual({ metres: 500, widthPx: 100, label: '500 m' });
    expect(niceScaleBar(1, 90).metres).toBe(100);
    expect(niceScaleBar(12, 90).metres).toBe(2000);
    expect(niceScaleBar(12, 90).label).toBe('2 km');
    const b = niceScaleBar(3.3, 100);
    expect(b.widthPx).toBeGreaterThanOrEqual(100);
    expect(b.metres / b.widthPx).toBeCloseTo(3.3, 9);
  });
  it('formats distances', () => {
    expect(formatDistance(250)).toBe('250 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(12000)).toBe('12 km');
  });
});
