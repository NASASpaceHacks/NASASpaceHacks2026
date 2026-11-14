import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  SitePackManifestSchema,
  PlanRequestSchema,
  cellToXY,
  decodeRaster,
  encodeRaster,
  eqcForward,
  eqcInverse,
  goldenPlanRequest,
  goldenPlanResult,
  mockFields,
  mockSitePack,
  rulesHash,
  xyToCell,
} from './index';

describe('contracts', () => {
  const pack = mockSitePack(412, 200);

  it('mock site pack validates against the manifest schema', () => {
    const r = SitePackManifestSchema.safeParse(pack.manifest);
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
    expect(pack.rasters.dem.length).toBe(200 * 200);
    expect(pack.rasters.normals.length).toBe(2 * 200 * 200);
  });

  it('mock pack is deterministic per seed', () => {
    const a = mockSitePack(7, 100), b = mockSitePack(7, 100);
    expect(a.rasters.dem).toEqual(b.rasters.dem);
    expect(a.manifest.stations).toEqual(b.manifest.stations);
  });

  it('cell <-> xy round-trips', () => {
    const g = pack.manifest.grid;
    for (const c of [0, 1, 199, 200, 12345, 200 * 200 - 1]) {
      const [x, y] = cellToXY(g, c);
      expect(xyToCell(g, x, y)).toBe(c);
    }
  });

  it('eqc forward/inverse round-trips on the Mars sphere', () => {
    const [x, y] = eqcForward(137.39, -4.83, 137.4, -4.7);
    const [lon, lat] = eqcInverse(x, y, 137.4, -4.7);
    expect(lon).toBeCloseTo(137.39, 9);
    expect(lat).toBeCloseTo(-4.83, 9);
  });

  it('raster encode/decode round-trips with quantization', () => {
    const layer = { ...pack.manifest.rasters.dem, dtype: 'u16' as const, scale: 0.1, offset: -5000, nodata: 65535 };
    const back = decodeRaster(encodeRaster(pack.rasters.dem, layer), layer);
    for (let i = 0; i < back.length; i += 997) expect(Math.abs(back[i] - pack.rasters.dem[i])).toBeLessThanOrEqual(0.051);
  });

  it('golden plan request validates; golden result is coherent', () => {
    expect(PlanRequestSchema.safeParse(goldenPlanRequest(pack)).success).toBe(true);
    const res = goldenPlanResult(pack);
    expect(res.status).toBe('OK');
    expect(res.segments[0].from).toBe('HAB');
    expect(res.segments.at(-1)!.to).toBe('HAB');
    expect(res.order.length).toBe(res.stops.length);
  });

  it('mock fields have the grid size', () => {
    const f = mockFields(pack);
    expect(f.walkbackMin.length).toBe(200 * 200);
  });

  it('rules hash is stable and order-independent', () => {
    expect(rulesHash(DEFAULT_RULES)).toBe(rulesHash([...DEFAULT_RULES].reverse()));
    const changed = DEFAULT_RULES.map((r) => (r.id === 'slope_max_deg' ? { ...r, value: 15 } : r));
    expect(rulesHash(changed)).not.toBe(rulesHash(DEFAULT_RULES));
  });

  it('every default rule carries a citation', () => {
    for (const r of DEFAULT_RULES) expect(r.citation.length).toBeGreaterThan(20);
  });
});
