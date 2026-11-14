import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../contracts/types';
import { cellToXY } from '../contracts/grid';
import {
  UNREACHABLE,
  chamferDistanceM,
  distanceFromCell,
  isolines,
  maskAreaKm2,
  maskPolygons,
  rasterizeKeepouts,
  safeZoneMask,
  sampleAt,
  sliceTile,
  type SafeZoneInputs,
  NO_LIMITS,
} from './fieldData';
import { lambert, sunVector } from './sun';
import { SAFE_ZONE_BANDS, hillshadeStyle, rampStyle, safeZoneStyle } from './styles';
import { TIME_RAMP } from './ramps';

const G: GridSpec = { w: 40, h: 30, cellM: 5, proj4: '+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m', originX: 1000, originY: 2000, centerLonLat: [0, 0] };

describe('derived fields', () => {
  it('distanceFromCell is Euclidean metres', () => {
    const d = distanceFromCell(G, 0);
    expect(d[0]).toBe(0);
    expect(d[3]).toBeCloseTo(15);
    expect(d[4 * G.w + 3]).toBeCloseTo(25);
  });

  it('chamfer distance is within 8 % of Euclidean and 0 on targets', () => {
    const mask = new Uint8Array(G.w * G.h);
    mask[15 * G.w + 20] = 1;
    const d = chamferDistanceM(mask, G.w, G.h, G.cellM);
    const e = distanceFromCell(G, 15 * G.w + 20);
    for (let i = 0; i < d.length; i++) {
      expect(d[i]).toBeGreaterThanOrEqual(e[i] - 1e-3);
      expect(d[i]).toBeLessThanOrEqual(e[i] * 1.0824 + 1e-3);
    }
    expect(chamferDistanceM(new Uint8Array(4), 2, 2, 5)[0]).toBe(UNREACHABLE);
  });

  it('rasterizes keep-out polygons with holes', () => {
    const outer: [number, number][] = [[1000, 2000], [1100, 2000], [1100, 1900], [1000, 1900], [1000, 2000]];
    const hole: [number, number][] = [[1040, 1960], [1060, 1960], [1060, 1940], [1040, 1940], [1040, 1960]];
    const m = rasterizeKeepouts(G, [{ rings: [outer, hole] }]);
    expect(m[0]).toBe(1); // inside
    expect(m[5 * G.w + 5]).toBe(1);
    expect(m[19 * G.w + 19]).toBe(1);
    expect(m[10 * G.w + 21]).toBe(0); // east of the polygon
    expect(m[9 * G.w + 9]).toBe(0); // in the hole (x≈1047.5, y≈1952.5)
  });
});

describe('safe zone mask', () => {
  const n = G.w * G.h;
  const z: SafeZoneInputs = {
    w: G.w, h: G.h, cellM: G.cellM,
    slope: new Float32Array(n).fill(5),
    distHab: distanceFromCell(G, 0),
    walkbackTotal: new Float32Array(n).fill(10),
    shelter: new Float32Array(n).fill(10),
    losGap: new Float32Array(n),
    keepout: new Uint8Array(n),
    blocked: new Uint8Array(n),
  };
  z.slope[5] = 30;
  z.keepout[6] = 1;
  it('applies limits independently and reports area', () => {
    expect(maskAreaKm2(safeZoneMask(z, NO_LIMITS), G.cellM)).toBeCloseTo((n * 25) / 1e6);
    const m = safeZoneMask(z, { ...NO_LIMITS, slopeMax: 20, useKeepout: true, radiusMax: 50 });
    expect(m[5]).toBe(0);
    expect(m[6]).toBe(0);
    expect(m[4]).toBe(1);
    expect(m[11]).toBe(0); // 55 m from the hab
  });
});

describe('tiling + isolines', () => {
  it('sliceTile interleaves bands by pixel and pads outside the grid', () => {
    const a = Float32Array.from({ length: G.w * G.h }, (_, i) => i);
    const b = Float32Array.from({ length: G.w * G.h }, (_, i) => -i);
    const t = sliceTile([{ data: a }, { data: b }], G.w, G.h, 32, 0, 16, 2, 7);
    expect(t.length).toBe(16 * 2 * 2);
    expect([t[0], t[1]]).toEqual([32, -32]);
    expect(t[(1 * 16 + 0) * 2]).toBe(G.w + 32);
    expect(t[(0 * 16 + 8) * 2]).toBe(7); // col 40 is outside
    const interleaved = new Float32Array(G.w * G.h * 2).map((_, i) => i);
    const t2 = sliceTile([{ data: interleaved, stride: 2, offset: 1 }], G.w, G.h, 0, 0, 2, 1);
    expect(Array.from(t2)).toEqual([1, 3]);
  });

  it('isolines land at the right projected distance', () => {
    const hab = 15 * G.w + 20;
    const minutes = distanceFromCell(G, hab).map((d) => d / 1); // 1 m per "minute"
    const [iso] = isolines(G, minutes, [50]);
    const [hx, hy] = cellToXY(G, hab);
    expect(iso.lines.length).toBeGreaterThan(0);
    for (const line of iso.lines) {
      for (const [x, y] of line) expect(Math.abs(Math.hypot(x - hx, y - hy) - 50)).toBeLessThan(3);
    }
  });

  it('maskPolygons outlines a block of cells', () => {
    const m = new Uint8Array(G.w * G.h);
    for (let r = 10; r < 20; r++) for (let c = 10; c < 20; c++) m[r * G.w + c] = 1;
    const polys = maskPolygons(G, m);
    expect(polys.length).toBe(1);
    const xs = polys[0][0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(1000 + 10 * 5, 0);
    expect(Math.max(...xs)).toBeCloseTo(1000 + 20 * 5, 0);
    expect(sampleAt(G, m, 1000 + 12 * 5, 2000 - 12 * 5)).toBe(1);
    expect(sampleAt(G, m, 0, 0)).toBeNaN();
  });
});

describe('sun + styles', () => {
  it('sun vector follows azimuth clockwise from north', () => {
    const [ex, ny] = sunVector(90, 0);
    expect(ex).toBeCloseTo(1);
    expect(ny).toBeCloseTo(0);
    expect(lambert(0, 0, 123, 90)).toBeCloseTo(1);
    // a slope facing east (normal tilted east) is lit by an eastern sun more than a western one
    expect(lambert(0.3, 0, 90, 30)).toBeGreaterThan(lambert(0.3, 0, 270, 30));
  });

  it('style builders expose the animated variables', () => {
    expect(hillshadeStyle({ sunAzDeg: 100, sunElevDeg: 30 }).variables).toMatchObject({ sunAzDeg: 100, sunElevDeg: 30 });
    expect(rampStyle(TIME_RAMP, { threshold: 30 }).variables).toEqual({ threshold: 30 });
    const s = safeZoneStyle({ limShelter: 30 });
    expect(s.variables).toMatchObject({ limShelter: 30, morph: 1 });
    expect(JSON.stringify(s.color)).toContain(`["band",${SAFE_ZONE_BANDS.shelterB}]`);
  });
});
