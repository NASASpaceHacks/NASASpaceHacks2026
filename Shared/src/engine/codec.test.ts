import { describe, expect, it } from 'vitest';
import { goldenPlanRequest, mockSitePack, PlanPackageSchema } from '../contracts';
import { mulberry32 } from '../contracts/sitepack';
import type { PlanPackage, PlanResult } from '../contracts/types';
import { COARSE_UNREACHABLE, computeFields, decodePackage, encodePackage, PACKAGE_MAX_BYTES, plan, toPlanPackage } from './index';

describe('route package codec (1000×1000 mock)', () => {
  const pack = mockSitePack(412, 1000);
  const req = goldenPlanRequest(pack);
  const res = plan(pack, req);
  const fields = computeFields(pack, req);
  const g = pack.manifest.grid;
  const pkg = toPlanPackage(res, req, fields, g, { seq: 3, parent: 'abc', author: 'hab' });
  const bytes = encodePackage(pkg);

  it('carries a 50 m conservative coarse grid (100×100) and the route', () => {
    expect(pkg.coarse).toMatchObject({ cellM: 50, w: 100, h: 100 });
    expect(pkg.coarse.walkbackMin).toHaveLength(10_000);
    expect(pkg.route.length).toBe(res.segments.reduce((a, s) => a + s.cells.length, 0));
    expect(pkg.sig).toBe('');
    expect(pkg.coarse.los).toHaveLength(10_000);
    expect(pkg.rules?.find((r) => r.id === 'shelter_time_max_min')).toEqual({ id: 'shelter_time_max_min', value: 30, enabled: true });
    // conservative = ceil(max finite minutes) within each 10×10 block
    for (const [br, bc] of [[0, 0], [30, 50], [62, 41], [99, 99]]) {
      let mx = -1;
      for (let r = br * 10; r < br * 10 + 10; r++) for (let c = bc * 10; c < bc * 10 + 10; c++) {
        const v = fields.walkbackMin[r * 1000 + c];
        if (v < Infinity) mx = Math.max(mx, v);
      }
      expect(pkg.coarse.walkbackMin[br * 100 + bc]).toBe(mx < 0 ? COARSE_UNREACHABLE : Math.ceil(mx));
    }
  });

  it(`round-trips losslessly and is ≤ ${PACKAGE_MAX_BYTES} bytes`, () => {
    console.log(`package: ${bytes.length} B (route ${pkg.route.length} cells, ${pkg.stops.length} stops)`);
    expect(bytes.length).toBeLessThanOrEqual(PACKAGE_MAX_BYTES);
    const back = decodePackage(bytes);
    expect(back).toEqual(pkg);
    expect(PlanPackageSchema.safeParse(back).success).toBe(true);
  });

  it('encoding is deterministic', () => {
    expect(encodePackage(pkg)).toEqual(bytes);
  });

  it('stays under budget for a long worst-case route (15 stops, 8,000 cells, non-adjacent jumps)', () => {
    const rnd = mulberry32(3);
    const route: number[] = [500 * 1000 + 500];
    const moves = [-1001, -1000, -999, -1, 1, 999, 1000, 1001];
    for (let i = 0; i < 8000; i++) route.push(route[route.length - 1] + (i % 997 === 0 ? 37 : moves[Math.floor(rnd() * 8)]));
    const stops = Array.from({ length: 15 }, (_, i) => ({ id: `ST${i + 1}`, arriveMin: 30 + i * 17.123, departMin: 50 + i * 17.456, arriveLtstMin: 600 + i * 16.7 }));
    const big: PlanPackage = {
      ...pkg,
      route,
      stops,
      order: stops.map((s) => s.id),
      bingo: stops.map((s) => ({ id: s.id, tMin: s.departMin + 12.3, ltstMin: s.arriveLtstMin + 20, text: `Leave ${s.id} by +${Math.floor(s.departMin + 12)} min (13:02 LTST)` })),
    };
    const b = encodePackage(big);
    console.log(`worst-case package: ${b.length} B`);
    expect(b.length).toBeLessThanOrEqual(PACKAGE_MAX_BYTES);
    expect(decodePackage(b)).toEqual(big);
  });

  it('STAY_IN packages (empty route) round-trip', () => {
    const stay: PlanResult = { ...res, status: 'STAY_IN', segments: [], stops: [], order: [], bingo: [] };
    const p = toPlanPackage(stay, req, fields, g, { seq: 4, author: 'earth' });
    expect(decodePackage(encodePackage(p))).toEqual(p);
  });
});
