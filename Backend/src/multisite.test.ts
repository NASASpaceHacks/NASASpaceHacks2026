import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodeRaster, goldenPlanRequest, mockSitePack, type LoadedSitePack, type PlanResult } from '@mw/shared/contracts';
import { createHabServer } from './server';

const roots: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  roots.push(d);
  return d;
};
function writePack(root: string, id: string, size: number): LoadedSitePack {
  const p = mockSitePack(7, size);
  const manifest = { ...p.manifest, id, name: `Site ${id}` };
  mkdirSync(join(root, id), { recursive: true });
  for (const layer of Object.values(manifest.rasters)) writeFileSync(join(root, id, layer.file), Buffer.from(encodeRaster(p.rasters[layer.id], layer)));
  writeFileSync(join(root, id, 'manifest.json'), JSON.stringify(manifest));
  return { ...p, manifest };
}

afterAll(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('multi-site hab server', () => {
  it('lists packs, plans on the pack named by siteId (worker caches per id), 404s unknown sites, finds late packs', async () => {
    const dir = tmp('mw-sites-');
    const A = writePack(dir, 'alpha', 120);
    const B = writePack(dir, 'beta', 90);
    const hab = await createHabServer({ port: 0, varDir: tmp('mw-var-'), sitePacksDir: dir, sitePack: 'alpha', quiet: true, engine: 'golden-plan' });
    try {
      const get = async (path: string) => fetch(hab.url + path);
      const list = (await (await get('/api/sitepacks')).json()) as { id: string; name: string; centerLonLat: number[]; available: boolean }[];
      expect(list.map((s) => s.id)).toEqual(['alpha', 'beta']);
      expect(list[1]).toMatchObject({ name: 'Site beta', available: true });
      expect(list[1].centerLonLat).toHaveLength(2);

      const post = (path: string, body: unknown) => fetch(hab.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      for (const [pack, other] of [[A, B], [B, A], [A, B]] as const) {
        const res = await post('/api/plan', goldenPlanRequest(pack));
        expect(res.status).toBe(200);
        const plan = (await res.json()) as PlanResult;
        expect(plan.status).toBe('OK');
        const n = pack.manifest.grid.w * pack.manifest.grid.h;
        expect(n).not.toBe(other.manifest.grid.w * other.manifest.grid.h);
        const wb = await get(`/api/fields/${plan.reqHash}/walkbackMin`);
        expect((await wb.arrayBuffer()).byteLength).toBe(n * 4); // fields come from the requested site's grid
        expect(wb.headers.get('x-grid-w')).toBe(String(pack.manifest.grid.w));
        const confirm = await post('/api/confirm', { reqHash: plan.reqHash });
        expect(confirm.status).toBe(200);
      }
      const state = (await (await get('/api/state')).json()) as { route: { siteId: string } };
      expect(state.route.siteId).toBe('alpha');

      // a cell valid on alpha but outside beta's smaller grid is rejected against beta
      const outside = { ...goldenPlanRequest(B), hab: A.manifest.grid.w * A.manifest.grid.h - 1 };
      expect((await post('/api/plan', outside)).status).toBe(400);

      const missing = await post('/api/plan', { ...goldenPlanRequest(A), siteId: 'nowhere' });
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { error: string }).error).toMatch(/unknown site "nowhere"/);

      writePack(dir, 'gamma', 60); // appears while running
      const later = (await (await get('/api/sitepacks')).json()) as { id: string }[];
      expect(later.map((s) => s.id)).toContain('gamma');
      expect((await post('/api/plan', goldenPlanRequest(writePack(dir, 'gamma', 60)))).status).toBe(200);
    } finally {
      await hab.close();
    }
  }, 60_000);
});
