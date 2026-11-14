import type { Cell, CostCtx, CostGrid, CostModel, PathSearch, SearchOpts, SearchResult } from '../contracts/types';
import { DC, DR, quantizeDs, EDGE_INF } from './dial';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function pathCost(g: CostGrid, cost: CostModel, ctx: CostCtx, cells: Uint32Array): number {
  let s = 0;
  for (let i = 1; i < cells.length; i++) s += cost.edgeCost(g, cells[i - 1], cells[i], ctx);
  return s;
}

function dirsFor(opts?: SearchOpts): number[] {
  return opts?.connectivity === 4 ? [0, 2, 4, 6] : [0, 1, 2, 3, 4, 5, 6, 7];
}

function reconstruct(parent: Int32Array, start: Cell, goal: Cell): Uint32Array {
  const rev: number[] = [];
  let c = goal;
  while (c !== start) {
    rev.push(c);
    c = parent[c];
    if (c < 0) throw new Error('broken parent chain');
  }
  rev.push(start);
  rev.reverse();
  return Uint32Array.from(rev);
}

// ─────────────────────────── Dial (bucket queue) point-to-point ───────────────────────────

function dialPointToPoint(
  g: CostGrid, cost: CostModel, ctx: CostCtx, start: Cell, goal: Cell, opts: SearchOpts | undefined, B: number,
): SearchResult | null | number {
  const t0 = now();
  const { w, h } = g;
  const n = w * h;
  if (start < 0 || start >= n || goal < 0 || goal >= n) return null;
  const dist = new Int32Array(n).fill(0x7fffffff);
  const parent = new Int32Array(n).fill(-1);
  const state = new Uint8Array(n);
  const next = new Int32Array(n);
  const prev = new Int32Array(n);
  const head = new Int32Array(B).fill(-1);
  const dirs = dirsFor(opts);
  const maxExp = opts?.maxExpansions ?? Infinity;
  dist[start] = 0;
  state[start] = 1;
  head[0] = start;
  next[start] = -1;
  prev[start] = -1;
  let queued = 1, cur = 0, bi = 0, expanded = 0;
  while (queued > 0) {
    while (head[bi] < 0) {
      bi++;
      cur++;
      if (bi === B) bi = 0;
    }
    const u = head[bi];
    const nx = next[u];
    head[bi] = nx;
    if (nx >= 0) prev[nx] = -1;
    state[u] = 2;
    queued--;
    expanded++;
    if (u === goal) {
      const cells = reconstruct(parent, start, goal);
      return { cells, cost: pathCost(g, cost, ctx, cells), expanded, ms: now() - t0 };
    }
    if (expanded > maxExp) return null;
    const r = (u / w) | 0, c = u - r * w;
    for (const k of dirs) {
      const rr = r + DR[k], cc = c + DC[k];
      if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
      const v = rr * w + cc;
      const sv = state[v];
      if (sv === 2 || g.blocked[v] !== 0) continue;
      // No corner-cutting between two blocked cells (matches the field searches and the bench oracle).
      if (DR[k] !== 0 && DC[k] !== 0 && (g.blocked[r * w + cc] !== 0 || g.blocked[rr * w + c] !== 0)) continue;
      const q = quantizeDs(cost.edgeCost(g, u, v, ctx));
      if (q === EDGE_INF) continue;
      if (q >= B) return q; // bucket ring too small: caller retries with a larger ring
      const nd = cur + q;
      if (nd < dist[v]) {
        if (sv === 1) {
          const pv = prev[v], nv = next[v];
          if (pv >= 0) next[pv] = nv;
          else head[(bi + (dist[v] - cur)) % B] = nv;
          if (nv >= 0) prev[nv] = pv;
        } else {
          state[v] = 1;
          queued++;
        }
        dist[v] = nd;
        parent[v] = u;
        let b = bi + q;
        if (b >= B) b -= B;
        next[v] = head[b];
        prev[v] = -1;
        if (head[b] >= 0) prev[head[b]] = v;
        head[b] = v;
      }
    }
  }
  return null;
}

/**
 * Dijkstra with Dial's bucket queue (edge costs quantized to integer deciseconds, circular buckets,
 * early exit at the goal). Returned `cost` is the exact (unquantized) cost along the found path.
 */
export const dijkstraSearch: PathSearch = {
  id: 'dijkstra',
  label: "Dijkstra (Dial's bucket queue, 0.1 s quantization)",
  search(g, cost, ctx, start, goal, opts) {
    let B = 4096;
    for (;;) {
      const r = dialPointToPoint(g, cost, ctx, start, goal, opts, B);
      if (typeof r !== 'number') return r;
      B = 1 << Math.ceil(Math.log2(r + 1));
    }
  },
};

// ─────────────────────────── A* (binary heap on typed arrays) ───────────────────────────

/**
 * A* with a binary min-heap (typed arrays, decrease-key via a position index).
 * Heuristic: octile (8-connected straight-line) distance / max speed (v0 × speedFactor). Octile ≥
 * Euclidean ≥ … is a lower bound on the 3-D length of any 8-connected path, so it is admissible and
 * consistent for cost models whose travel speed never exceeds v0 × speedFactor (true for
 * pandolf-santee-mars). `heuristicWeight` > 1 gives weighted A* (bounded-suboptimal).
 */
export const astarSearch: PathSearch = {
  id: 'astar',
  label: 'A* (octile / max-speed heuristic, binary heap)',
  search(g, cost, ctx, start, goal, opts) {
    const t0 = now();
    const { w, h, cellM } = g;
    const n = w * h;
    if (start < 0 || start >= n || goal < 0 || goal >= n) return null;
    const vmax = ctx.crew.v0 * ctx.speedFactor;
    const hw = (opts?.heuristicWeight ?? 1) * (cellM / vmax);
    const gr = (goal / w) | 0, gc = goal - gr * w;
    const heur = (u: number): number => {
      const r = (u / w) | 0;
      const dr = Math.abs(r - gr), dc = Math.abs(u - r * w - gc);
      const mn = dr < dc ? dr : dc, mx = dr < dc ? dc : dr;
      return hw * (mx - mn + Math.SQRT2 * mn);
    };
    const gScore = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const pos = new Int32Array(n).fill(-1);
    let cap = 1024;
    let heapN = new Int32Array(cap);
    let heapF = new Float64Array(cap);
    let size = 0;
    const swap = (i: number, j: number) => {
      const a = heapN[i], b = heapN[j];
      const fa = heapF[i];
      heapN[i] = b; heapF[i] = heapF[j]; pos[b] = i;
      heapN[j] = a; heapF[j] = fa; pos[a] = j;
    };
    const up = (i: number) => {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= heapF[i]) break;
        swap(i, p);
        i = p;
      }
    };
    const down = (i: number) => {
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < size && heapF[l] < heapF[m]) m = l;
        if (r < size && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    };
    const push = (v: number, f: number) => {
      const p = pos[v];
      if (p >= 0) {
        heapF[p] = f;
        up(p);
        return;
      }
      if (size === cap) {
        cap *= 2;
        const nn = new Int32Array(cap); nn.set(heapN); heapN = nn;
        const nf = new Float64Array(cap); nf.set(heapF); heapF = nf;
      }
      heapN[size] = v; heapF[size] = f; pos[v] = size;
      up(size++);
    };
    const pop = (): number => {
      const top = heapN[0];
      pos[top] = -1;
      size--;
      if (size > 0) {
        heapN[0] = heapN[size]; heapF[0] = heapF[size]; pos[heapN[0]] = 0;
        down(0);
      }
      return top;
    };

    const dirs = dirsFor(opts);
    const maxExp = opts?.maxExpansions ?? Infinity;
    gScore[start] = 0;
    push(start, heur(start));
    let expanded = 0;
    while (size > 0) {
      const u = pop();
      if (closed[u]) continue;
      closed[u] = 1;
      expanded++;
      if (u === goal) {
        const cells = reconstruct(parent, start, goal);
        return { cells, cost: pathCost(g, cost, ctx, cells), expanded, ms: now() - t0 };
      }
      if (expanded > maxExp) return null;
      const r = (u / w) | 0, c = u - r * w;
      const gu = gScore[u];
      for (const k of dirs) {
        const rr = r + DR[k], cc = c + DC[k];
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
        const v = rr * w + cc;
        if (closed[v] || g.blocked[v] !== 0) continue;
        if (DR[k] !== 0 && DC[k] !== 0 && (g.blocked[r * w + cc] !== 0 || g.blocked[rr * w + c] !== 0)) continue;
        const ec = cost.edgeCost(g, u, v, ctx);
        if (!(ec < Infinity)) continue;
        const ng = gu + ec;
        if (ng < gScore[v]) {
          gScore[v] = ng;
          parent[v] = u;
          push(v, ng + heur(v));
        }
      }
    }
    return null;
  },
};
