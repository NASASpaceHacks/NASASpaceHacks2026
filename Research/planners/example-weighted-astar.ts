/**
 * TEMPLATE: weighted A* (w = 1.5). Copy this file to Research/planners/<your-planner>.ts and edit.
 *
 * Contract (Shared/src/contracts/types.ts):
 *   PathSearch.search(grid, costModel, ctx, start, goal, opts) -> { cells, cost, expanded, ms } | null
 *   - `cells` includes start and goal, 8-connected steps, never through grid.blocked cells.
 *   - `cost` is seconds, summed from costModel.edgeCost (the bench recomputes it anyway and
 *     measures your gap against its own Dijkstra oracle, so honest numbers are the only useful ones).
 *   - Optional `update(changedCells)` enables incremental replanning (D* Lite style): the bench calls
 *     it whenever hidden hazards are revealed (grid.blocked has already been mutated), then calls
 *     search() again from the walker's current cell.
 * The module registers itself on import, and also default-exports the planner.
 */
import type { Cell, CostCtx, CostGrid, CostModel, PathSearch, SearchOpts, SearchResult } from '../../Shared/src/contracts/types';
import { registerPathSearch } from '../../Shared/src/engine/registry';

const W = 1.5; // heuristic inflation: suboptimality bounded by W if h is admissible

/** Binary min-heap on (key, node); lazy deletion. */
class Heap {
  k: number[] = []; v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    let i = this.k.length; this.k.push(key); this.v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = key; this.v[i] = val;
  }
  pop(): number {
    const top = this.v[0], key = this.k.pop()!, val = this.v.pop()!;
    const n = this.k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
        if (this.k[c] >= key) break;
        this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
      }
      this.k[i] = key; this.v[i] = val;
    }
    return top;
  }
}

/**
 * Admissible heuristic scale: the cheapest observed cost per metre over a sample of edges.
 * h(n) = straight-line metres * minCostPerM never overestimates if the sample hit the true minimum;
 * sampling keeps setup O(cells/7). Cached per grid+model.
 */
const hCache = new WeakMap<CostGrid, Map<string, number>>();
function minCostPerM(g: CostGrid, cm: CostModel, ctx: CostCtx): number {
  let m = hCache.get(g); if (!m) hCache.set(g, (m = new Map()));
  const hit = m.get(cm.id); if (hit !== undefined) return hit;
  let best = Infinity;
  for (let i = 0; i < g.w * g.h - g.w - 1; i += 7) {
    if (g.blocked[i]) continue;
    for (const j of [i + 1, i + g.w]) {
      if (g.blocked[j]) continue;
      const c = cm.edgeCost(g, i, j, ctx) / g.cellM;
      if (c < best) best = c;
    }
  }
  const out = Number.isFinite(best) ? best * 0.999 : 0; // 0 => degrades to Dijkstra, still correct
  m.set(cm.id, out);
  return out;
}

const NB: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

export const weightedAStar: PathSearch = {
  id: 'wastar-1.5',
  label: 'Weighted A* (w=1.5)',
  search(g: CostGrid, cm: CostModel, ctx: CostCtx, start: Cell, goal: Cell, opts?: SearchOpts): SearchResult | null {
    const t0 = performance.now();
    const w = opts?.heuristicWeight ?? W;
    const { w: gw, h: gh } = g;
    const scale = minCostPerM(g, cm, ctx);
    const gr = Math.floor(goal / gw), gc = goal % gw;
    const hOf = (n: Cell) => {
      const dr = Math.abs(Math.floor(n / gw) - gr), dc = Math.abs((n % gw) - gc);
      return (Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc)) * g.cellM * scale; // octile
    };
    const dist = new Float64Array(gw * gh).fill(Infinity);
    const prev = new Int32Array(gw * gh).fill(-1);
    const closed = new Uint8Array(gw * gh);
    const heap = new Heap();
    dist[start] = 0; heap.push(w * hOf(start), start);
    let expanded = 0;
    while (heap.size) {
      const u = heap.pop();
      if (closed[u]) continue;
      closed[u] = 1;
      if (u === goal) break;
      if (opts?.maxExpansions && expanded >= opts.maxExpansions) return null;
      expanded++;
      const r = Math.floor(u / gw), c = u % gw;
      for (const [dr, dc] of NB) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= gh || cc >= gw) continue;
        const v = rr * gw + cc;
        if (g.blocked[v] || closed[v]) continue;
        if (dr && dc && (g.blocked[r * gw + cc] || g.blocked[rr * gw + c])) continue; // no corner cutting
        const nd = dist[u] + cm.edgeCost(g, u, v, ctx);
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd + w * hOf(v), v); }
      }
    }
    if (!Number.isFinite(dist[goal])) return null;
    const out: number[] = [];
    for (let c = goal; c !== -1; c = prev[c]) out.push(c);
    out.reverse();
    return { cells: Uint32Array.from(out), cost: dist[goal], expanded, ms: performance.now() - t0 };
  },
  // No update(): the bench falls back to a full search from the walker's current cell.
};

registerPathSearch(weightedAStar);
export default weightedAStar;
