import type { CostCtx, CostGrid, CostModel } from '../contracts/types';

/**
 * 8-connected grid graph primitives + Dial's bucket-queue Dijkstra over precomputed edge tables.
 *
 * Directions k: 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW (row 0 = north). opposite(k) = (k+4)&7.
 * Edge costs are quantized to integer DECISECONDS (Dial 1969: bucket queue with circular buckets).
 */
export const DR = Int8Array.from([-1, -1, 0, 1, 1, 1, 0, -1]);
export const DC = Int8Array.from([0, 1, 1, 1, 0, -1, -1, -1]);
export const NO_PARENT = 255;
export const EDGE_INF = 0xffff;
export const DIST_INF = 0x7fffffff;
/** Deciseconds per minute. */
export const DS_PER_MIN = 600;

export function dirOffsets(w: number): Int32Array {
  const off = new Int32Array(8);
  for (let k = 0; k < 8; k++) off[k] = DR[k] * w + DC[k];
  return off;
}

/** Quantize seconds → deciseconds for the bucket queue (≥1, EDGE_INF if impassable). */
export function quantizeDs(sec: number): number {
  if (!(sec < Infinity) || !(sec >= 0)) return EDGE_INF;
  const q = Math.round(sec * 10);
  return q < 1 ? 1 : q >= EDGE_INF ? EDGE_INF - 1 : q;
}

/**
 * Edge table: fwd[u*8+k] = cost(u → u+off[k]); rev[u*8+k] = cost(u+off[k] → u) (for reverse
 * searches). Out-of-grid edges are EDGE_INF. Built on a copy of the grid with NOTHING blocked, so a
 * table survives hazard/rule changes; blocking is applied by the search mask.
 */
export interface EdgeTable {
  w: number;
  h: number;
  fwd: Uint16Array;
  rev: Uint16Array;
  maxEdge: number;
  symmetric: boolean;
}

export function buildEdgeTable(g: CostGrid, model: CostModel, ctx: CostCtx): EdgeTable {
  const { w, h } = g;
  const n = w * h;
  const open: CostGrid = { ...g, blocked: new Uint8Array(n) };
  const fwd = new Uint16Array(n * 8);
  let maxEdge = 1;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const u = r * w + c;
      const base = u * 8;
      for (let k = 0; k < 8; k++) {
        const rr = r + DR[k], cc = c + DC[k];
        if (rr < 0 || cc < 0 || rr >= h || cc >= w) {
          fwd[base + k] = EDGE_INF;
          continue;
        }
        const q = quantizeDs(model.edgeCost(open, u, rr * w + cc, ctx));
        fwd[base + k] = q;
        if (q !== EDGE_INF && q > maxEdge) maxEdge = q;
      }
    }
  }
  // reverse table: rev[u*8+k] = fwd[v*8+opp(k)], v = u+off[k]
  const off = dirOffsets(w);
  const rev = new Uint16Array(n * 8);
  let symmetric = true;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const u = r * w + c;
      const base = u * 8;
      for (let k = 0; k < 8; k++) {
        const rr = r + DR[k], cc = c + DC[k];
        let q = EDGE_INF;
        if (rr >= 0 && cc >= 0 && rr < h && cc < w) q = fwd[(u + off[k]) * 8 + ((k + 4) & 7)];
        rev[base + k] = q;
        if (q !== fwd[base + k]) symmetric = false;
      }
    }
  }
  return { w, h, fwd, rev: symmetric ? fwd : rev, maxEdge, symmetric };
}

/** Scale a table's costs by `factor` (used for speed factors of time-linear cost models). */
export function scaleEdgeTable(t: EdgeTable, factor: number): EdgeTable {
  const scale = (src: Uint16Array) => {
    const out = new Uint16Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const q = src[i];
      if (q === EDGE_INF) out[i] = EDGE_INF;
      else {
        const s = Math.round(q * factor);
        out[i] = s < 1 ? 1 : s >= EDGE_INF ? EDGE_INF - 1 : s;
      }
    }
    return out;
  };
  const fwd = scale(t.fwd);
  const rev = t.symmetric ? fwd : scale(t.rev);
  let maxEdge = 1;
  for (let i = 0; i < fwd.length; i++) if (fwd[i] !== EDGE_INF && fwd[i] > maxEdge) maxEdge = fwd[i];
  return { w: t.w, h: t.h, fwd, rev, maxEdge, symmetric: t.symmetric };
}

// ─────────────────────────── Dial core ───────────────────────────

interface DialBuffers {
  n: number;
  dist: Int32Array;
  next: Int32Array;
  prev: Int32Array;
  state: Uint8Array;
  isTarget: Uint8Array;
}
let pool: DialBuffers | null = null;
function buffers(n: number): DialBuffers {
  if (!pool || pool.n !== n) {
    pool = {
      n,
      dist: new Int32Array(n),
      next: new Int32Array(n),
      prev: new Int32Array(n),
      state: new Uint8Array(n),
      isTarget: new Uint8Array(n),
    };
  }
  return pool;
}

export interface DialRunOpts {
  /** fwd table for forward searches (cost from sources), rev table for reverse (cost to sources). */
  tab: Uint16Array;
  maxEdge: number;
  w: number;
  h: number;
  /** 1 = never entered (sources are always allowed). */
  mask: Uint8Array | null;
  sources: ArrayLike<number>;
  /** Early exit once every target is settled. */
  targets?: ArrayLike<number> | null;
  /** Stop expanding beyond this cost (deciseconds). */
  maxCostDs?: number;
  /** Out: direction from each reached cell to its tree parent (NO_PARENT for sources/unreached). */
  parents?: Uint8Array | null;
}

export interface DialRunResult {
  /** Cost in deciseconds per cell (DIST_INF unreached). Shared buffer: copy before the next run. */
  dist: Int32Array;
  settled: number;
}

/**
 * Dial's algorithm (bucket queue with B = maxEdge+1 circular buckets, intrusive doubly-linked lists
 * so decrease-key is O(1)). Returns integer-decisecond distances.
 */
export function dialRun(o: DialRunOpts): DialRunResult {
  const { tab, w, h, mask } = o;
  const n = w * h;
  const buf = buffers(n);
  const { dist, next, prev, state, isTarget } = buf;
  dist.fill(DIST_INF);
  state.fill(0);
  const parents = o.parents ?? null;
  if (parents) parents.fill(NO_PARENT);
  const B = o.maxEdge + 1;
  const head = new Int32Array(B).fill(-1);
  const off = dirOffsets(w);
  const maxCost = o.maxCostDs ?? DIST_INF;

  let remaining = 0;
  const targets = o.targets ?? null;
  if (targets) {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t >= 0 && t < n && !isTarget[t]) {
        isTarget[t] = 1;
        remaining++;
      }
    }
  }

  let queued = 0;
  for (let i = 0; i < o.sources.length; i++) {
    const s = o.sources[i];
    if (s < 0 || s >= n || state[s] === 1) continue;
    dist[s] = 0;
    state[s] = 1;
    next[s] = head[0];
    prev[s] = -1;
    if (head[0] >= 0) prev[head[0]] = s;
    head[0] = s;
    queued++;
  }

  let cur = 0;
  let bi = 0;
  let settled = 0;
  while (queued > 0) {
    while (head[bi] < 0) {
      bi++;
      cur++;
      if (bi === B) bi = 0;
    }
    if (cur > maxCost) break;
    const u = head[bi];
    const nx = next[u];
    head[bi] = nx;
    if (nx >= 0) prev[nx] = -1;
    state[u] = 2;
    queued--;
    settled++;
    if (remaining > 0 && isTarget[u] === 1) {
      remaining--;
      if (remaining === 0) break;
    }
    const base = u * 8;
    for (let k = 0; k < 8; k++) {
      const c = tab[base + k];
      if (c === EDGE_INF) continue;
      const v = u + off[k];
      const sv = state[v];
      if (sv === 2) continue;
      if (mask !== null) {
        if (mask[v] !== 0) continue;
        // No corner-cutting: a diagonal step may not squeeze between two blocked (too-steep / keep-out) cells.
        if ((k & 1) === 1 && (mask[u + off[(k + 7) & 7]] !== 0 || mask[u + off[(k + 1) & 7]] !== 0)) continue;
      }
      const nd = cur + c;
      if (nd < dist[v]) {
        if (sv === 1) {
          // unlink v from its current bucket
          const pv = prev[v], nv = next[v];
          if (pv >= 0) next[pv] = nv;
          else head[(bi + (dist[v] - cur)) % B] = nv;
          if (nv >= 0) prev[nv] = pv;
        } else {
          state[v] = 1;
          queued++;
        }
        dist[v] = nd;
        let b = bi + c;
        if (b >= B) b -= B;
        const hb = head[b];
        next[v] = hb;
        prev[v] = -1;
        if (hb >= 0) prev[hb] = v;
        head[b] = v;
        if (parents !== null) parents[v] = (k + 4) & 7;
      }
    }
  }
  if (targets) for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t >= 0 && t < n) isTarget[t] = 0;
  }
  return { dist, settled };
}

/** Walk parent directions from `cell` back to a tree root. Returns cells from `cell` to the root. */
export function followParents(parents: Uint8Array, w: number, cell: number, maxLen = 1 << 22): number[] {
  const off = dirOffsets(w);
  const out: number[] = [cell];
  let c = cell;
  for (let i = 0; i < maxLen; i++) {
    const d = parents[c];
    if (d === NO_PARENT) return out;
    c = c + off[d];
    out.push(c);
  }
  throw new Error('parent chain too long (cycle?)');
}

/** Convert decisecond distances to Float32 minutes (Infinity unreached). */
export function dsToMinutes(dist: Int32Array, out = new Float32Array(dist.length)): Float32Array {
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    out[i] = d === DIST_INF ? Infinity : d / DS_PER_MIN;
  }
  return out;
}
