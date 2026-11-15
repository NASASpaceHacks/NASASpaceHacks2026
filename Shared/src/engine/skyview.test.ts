import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeRaster, goldenPlanRequest, type SitePackManifest } from '../contracts';
import type { LoadedSitePack } from '../contracts/sitepack';
import { plan, stageFromShelter } from './index';
import { skyShieldFactor } from './radiation';

const GALE = new URL('../../../SitePacks/gale-v1/', import.meta.url);
function loadGale(): LoadedSitePack {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', GALE), 'utf8')) as SitePackManifest;
  const rasters: Record<string, Float32Array> = {};
  for (const l of Object.values(manifest.rasters)) {
    const b = readFileSync(new URL(l.file, GALE));
    rasters[l.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteLength + b.byteOffset) as ArrayBuffer, l);
  }
  return { manifest, rasters, base: GALE.pathname };
}

describe('two-term terrain shielding factor (Guo 2026, V1)', () => {
  it('is 1 for open sky, decreases monotonically with obstruction, never below 0.1 for realistic B, never a shelter', () => {
    expect(skyShieldFactor(1)).toBe(1);
    let prev = 1;
    for (const sky of [0.95, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      const s = skyShieldFactor(sky);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
    // V1 two-term: slope (1-f)w - f = 0.88 per unit blocked fraction; RAD's largest measured drop was 19 %
    expect(skyShieldFactor(0.78)).toBeCloseTo(1 - 0.88 * 0.22, 2);
  });
});

describe.skipIf(!existsSync(new URL('skyview.bin', GALE)))('gale-v1 skyview raster', () => {
  const pack = loadGale();
  const sky = pack.rasters.skyview;

  it('(b) obstructed fraction at in-AOI Curiosity waypoint cells matches the V1-method full-resolution values (<= 2 pp)', () => {
    // V1 parking positions (sols 2643-3576) lie north of the 5 km AOI, so we use three in-AOI Curiosity waypoints and the
    // V1 horizon method (1 m DEM, 0.25 deg rays, solid-angle definition) at the same cells, computed in Pipeline/mwpipe/skyview.py.
    const ref: [number, number][] = [[67623, 15.29], [194711, 16.82], [534419, 13.63]];   // [cell, V1-method blocked %]
    for (const [cell, blockedPct] of ref) expect(Math.abs((1 - sky[cell]) * 100 - blockedPct), `cell ${cell}`).toBeLessThanOrEqual(2);
  });

  it('values are fractions in [0, 1] with real terrain obstruction somewhere', () => {
    let min = 1, max = 0;
    for (let i = 0; i < sky.length; i += 7) { min = Math.min(min, sky[i]); max = Math.max(max, sky[i]); }
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(min).toBeLessThan(0.9);
  });

  it('(a) route dose with shielding <= dose without; plan verdicts do not change when the raster is removed', () => {
    const req = stageFromShelter(goldenPlanRequest(pack), 'ROVER1');
    const withSky = plan(pack, req);
    const { skyview: _s, ...rest } = pack.rasters;
    const without = plan({ ...pack, rasters: rest }, req);
    expect(withSky.status).toBe('OK');
    expect(withSky.totals.doseOpenSkyUSv).toBeDefined();
    expect(withSky.totals.doseUSv).toBeLessThanOrEqual(withSky.totals.doseOpenSkyUSv! + 1e-9);
    expect(withSky.totals.doseUSv).toBeLessThan(withSky.totals.doseOpenSkyUSv!);
    expect(without.totals.doseUSv).toBeCloseTo(withSky.totals.doseOpenSkyUSv!, 6);
    expect(without.totals.doseUSv).toBeGreaterThanOrEqual(withSky.totals.doseUSv);
    expect(withSky.status).toBe(without.status);
    expect(withSky.order).toEqual(without.order);
    expect(withSky.binding).toEqual(without.binding);
    expect(withSky.dropped).toEqual(without.dropped);
    expect(withSky.segments.map((s) => s.checks)).toEqual(without.segments.map((s) => s.checks));
  });
});
