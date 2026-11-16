import { describe, expect, it } from 'vitest';
import { goldenPlanRequest, mockSitePack } from '../contracts';
import { attemptRoute } from './plan';

describe('attemptRoute slope report', () => {
  it('a stop on steep ground reports its real slope, not the 90 sentinel', () => {
    const pack = mockSitePack(412, 1000);
    const req = goldenPlanRequest(pack);
    const st = req.stations[0];
    const limit = req.rules.find((r) => r.id === 'slope_max_deg')!.value;
    const slope = Float32Array.from(pack.rasters.slope);
    slope[st.cell] = limit + 12;
    const steep = { ...pack, rasters: { ...pack.rasters, slope } };
    const at = attemptRoute(steep, req, st.id);
    expect((at as { reason?: string }).reason).toBeUndefined();
    const worst = at.sim!.segments.flatMap((s) => s.checks).filter((c) => c.rule === 'slope_max_deg' && !c.pass);
    expect(worst.length).toBeGreaterThan(0);
    for (const c of worst) {
      expect(c.worst).toBeLessThan(90);
      expect(c.worst).toBeGreaterThan(limit);
    }
  });
});
