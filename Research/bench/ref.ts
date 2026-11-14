/**
 * Bench-local reference implementations (independent of Shared/src/engine) so the harness runs
 * stand-alone and has an ORACLE that does not share code with the planners under test.
 * The reference cost model is a simple slope/roughness time model. It is a stand-in, NOT calibrated
 * to any physiological data (the engine's `pandolf-santee-mars` is the calibrated model).
 */
import type { Cell, CostCtx, CostGrid, CostModel, PathSearch, SearchOpts, SearchResult } from '../../Shared/src/contracts/types';
import type { LoadedSitePack } from '../../Shared/src/contracts/sitepack';

export const SLOPE_HARD_DEG = 20; // xEVA ConOps EVA-EXP-0042 Rev B; see Shared/src/contracts/rules.ts

/** Minimal CostGrid from a site pack: blocked = slope > 20 deg or nodata. Keep-outs are NOT applied here. */
export function refBuildCostGrid(pack: LoadedSitePack, extraBlocked: Cell[] = []): CostGrid {
  const { w, h, cellM } = pack.manifest.grid;
  const n = w * h;
  const dem = pack.rasters.dem, slope = pack.rasters.slope;
  const rough = pack.rasters.rough ?? new Float32Array(n);
  const ti = pack.rasters.ti;
  const eta = new Float32Array(n), blocked = new Uint8Array(n), elev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    elev[i] = Number.isNaN(dem[i]) ? 0 : dem[i];
    // crude terrain factor proxy: low thermal inertia (loose fines) -> higher resistance
    eta[i] = ti && ti[i] < 250 ? 1.5 : 1.0;
    if (Number.isNaN(dem[i]) || Number.isNaN(slope[i]) || slope[i] > SLOPE_HARD_DEG) blocked[i] = 1;
  }
  for (const c of extraBlocked) blocked[c] = 1;
  return { w, h, cellM, elev, slopeDeg: Float32Array.from(slope, (v) => (Number.isNaN(v) ? 90 : v)), rough: Float32Array.from(rough, (v) => (Number.isNaN(v) ? 0 : v)), eta, blocked };
}

export const refCostModel: CostModel = {
  id: 'ref-slope',
  label: 'Bench reference slope/roughness time model (uncalibrated)',
  edgeCost(g, a, b, ctx) {
    if (g.blocked[a] || g.blocked[b]) return Infinity;
    const w = g.w;
    const dr = Math.floor(b / w) - Math.floor(a / w), dc = (b % w) - (a % w);
    const d = g.cellM * Math.hypot(dr, dc);
    const grade = (g.elev[b] - g.elev[a]) / d;
    const m = ((g.eta[a] + g.eta[b]) / 2) * (1 + 3 * Math.max(grade, 0) + 1.5 * Math.max(-grade, 0)) + 2 * (g.rough[a] + g.rough[b]) / 2;
    return (d / (ctx.crew.v0 * ctx.speedFactor)) * m;
  },
};

class MinHeap {
  private k = new Float64Array(1 << 12);
  private v = new Int32Array(1 << 12);
  n = 0;
  push(key: number, val: number) {
    if (this.n === this.k.length) {
      const k2 = new Float64Array(this.n * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.n * 2); v2.set(this.v); this.v = v2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop(): number {
    const top = this.v[0];
    const key = this.k[--this.n], val = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = key; this.v[i] = val;
    return top;
  }
}

const NB: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

/** Exact 8-connected Dijkstra (diagonals need both orthogonal neighbours open). The oracle. */
export function refSearch(g: CostGrid, cm: CostModel, ctx: CostCtx, start: Cell, goal: Cell): SearchResult | null {
  const t0 = performance.now();
  const { w, h } = g;
  const dist = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = new MinHeap();
  dist[start] = 0; heap.push(0, start);
  let expanded = 0;
  while (heap.n) {
    const u = heap.pop();
    if (closed[u]) continue; // lazy deletion of stale heap entries
    closed[u] = 1;
    const du = dist[u];
    if (u === goal) break;
    expanded++;
    const r = Math.floor(u / w), c = u % w;
    for (const [dr, dc] of NB) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
      const v = rr * w + cc;
      if (g.blocked[v]) continue;
      if (dr && dc && (g.blocked[r * w + cc] || g.blocked[rr * w + c])) continue;
      const nd = du + cm.edgeCost(g, u, v, ctx);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
    }
  }
  if (!Number.isFinite(dist[goal])) return null;
  const out: number[] = [];
  for (let c = goal; c !== -1; c = prev[c]) out.push(c);
  out.reverse();
  return { cells: Uint32Array.from(out), cost: dist[goal], expanded, ms: performance.now() - t0 };
}

export const refDijkstra: PathSearch = {
  id: 'ref-dijkstra',
  label: 'Bench reference Dijkstra (binary heap)',
  search: (g, cm, ctx, s, t, _o?: SearchOpts) => refSearch(g, cm, ctx, s, t),
};

/** Neighbour test shared with planners that want identical connectivity rules. */
export const neighbours8 = NB;
