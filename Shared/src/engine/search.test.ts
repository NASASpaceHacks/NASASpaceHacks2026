import { describe, expect, it } from 'vitest';
import { DEFAULT_CREW, DEFAULT_RULES } from '../contracts/rules';
import { mulberry32 } from '../contracts/sitepack';
import type { CostCtx, CostGrid } from '../contracts/types';
import { pandolfSanteeMars } from './costModel';
import { dijkstraField } from './fields';
import { getPathSearch } from './index';
import { astarSearch, dijkstraSearch } from './search';

function randomGrid(seed: number, w: number, h: number): CostGrid {
  const rnd = mulberry32(seed);
  const n = w * h;
  const elev = new Float32Array(n);
  // smooth random relief: a few Gaussian bumps + noise
  const bumps = Array.from({ length: 6 }, () => [rnd() * h, rnd() * w, (rnd() - 0.3) * 30, 3 + rnd() * 8]);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    let z = rnd() * 0.5;
    for (const [br, bc, bh, bs] of bumps) z += bh * Math.exp(-((r - br) ** 2 + (c - bc) ** 2) / (2 * bs * bs));
    elev[r * w + c] = z;
  }
  const blocked = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (rnd() < 0.15) blocked[i] = 1;
  return { w, h, cellM: 5, elev, slopeDeg: new Float32Array(n), rough: new Float32Array(n), eta: new Float32Array(n).fill(1), blocked };
}
const ctx: CostCtx = { crew: DEFAULT_CREW, rules: DEFAULT_RULES, speedFactor: 1 };

describe('PathSearch: Dijkstra (Dial) vs A*', () => {
  it('are registered under their ids', () => {
    expect(getPathSearch('dijkstra')).toBe(dijkstraSearch);
    expect(getPathSearch('astar')).toBe(astarSearch);
  });

  it('give equal costs on random grids (within the 0.1 s quantization bound)', () => {
    let compared = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = randomGrid(seed, 40 + (seed % 3) * 15, 35 + (seed % 4) * 10);
      const rnd = mulberry32(seed * 7);
      const pick = () => {
        for (;;) {
          const c = Math.floor(rnd() * g.w * g.h);
          if (!g.blocked[c]) return c;
        }
      };
      const s = pick(), t = pick();
      const d = dijkstraSearch.search(g, pandolfSanteeMars, ctx, s, t);
      const a = astarSearch.search(g, pandolfSanteeMars, ctx, s, t);
      expect(d === null).toBe(a === null);
      if (!d || !a) continue;
      compared++;
      const tol = 0.05 * (d.cells.length + a.cells.length) + 1e-9;
      expect(Math.abs(d.cost - a.cost)).toBeLessThanOrEqual(tol);
      expect(a.cost).toBeLessThanOrEqual(d.cost + 1e-9); // A* with float costs is exactly optimal
      expect(d.cells[0]).toBe(s);
      expect(d.cells[d.cells.length - 1]).toBe(t);
      // paths are 8-connected and avoid blocked cells
      for (const p of [d.cells, a.cells]) for (let i = 1; i < p.length; i++) {
        const dr = Math.abs(Math.floor(p[i] / g.w) - Math.floor(p[i - 1] / g.w));
        const dc = Math.abs((p[i] % g.w) - (p[i - 1] % g.w));
        expect(Math.max(dr, dc)).toBe(1);
        expect(g.blocked[p[i]]).toBe(0);
      }
      // the one-to-many field agrees with the point search
      const f = dijkstraField(g, [s], false, 1);
      expect(Math.abs(f[t] * 60 - d.cost)).toBeLessThanOrEqual(tol);
    }
    expect(compared).toBeGreaterThan(30);
  });

  it('A* expands no more nodes than Dijkstra', () => {
    const g = randomGrid(99, 120, 120);
    const s = 5 * 120 + 5, t = 110 * 120 + 112;
    g.blocked[s] = 0;
    g.blocked[t] = 0;
    const d = dijkstraSearch.search(g, pandolfSanteeMars, ctx, s, t)!;
    const a = astarSearch.search(g, pandolfSanteeMars, ctx, s, t)!;
    expect(a.expanded).toBeLessThanOrEqual(d.expanded);
  });

  it('reverse field = cost TO the source; forward = cost FROM it', () => {
    const g = randomGrid(5, 50, 50);
    const s = 25 * 50 + 25;
    g.blocked[s] = 0;
    const fwd = dijkstraField(g, [s], false, 1);
    const rev = dijkstraField(g, [s], true, 1);
    // pandolf-santee-mars travel time is symmetric, so both agree exactly
    for (let i = 0; i < fwd.length; i += 37) expect(rev[i]).toBe(fwd[i]);
  });

  it('weighted A* stays within its bound', () => {
    const g = randomGrid(11, 80, 80);
    const s = 2 * 80 + 2, t = 77 * 80 + 75;
    g.blocked[s] = 0;
    g.blocked[t] = 0;
    const opt = astarSearch.search(g, pandolfSanteeMars, ctx, s, t)!;
    const w = astarSearch.search(g, pandolfSanteeMars, ctx, s, t, { heuristicWeight: 1.5 })!;
    expect(w.cost).toBeGreaterThanOrEqual(opt.cost - 1e-9);
    expect(w.cost).toBeLessThanOrEqual(1.5 * opt.cost + 1e-9);
  });
});
