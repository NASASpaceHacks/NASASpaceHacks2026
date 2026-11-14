// Weighted, safety-constrained pedestrian routing on the HiRISE grid. Runs entirely in the browser so the
// habitat and the suit can each (re)plan without any Earth or server dependency.
//
// Time model is the Research prototype's: t = d3 / v0 * (1 + 4*max(grade,0) + 2*max(-grade,0)).
// Its coefficients are engineering assumptions (see Research/docs/research/routing_assumptions_findings.md).
import { cellPt, distM, idx, pointInPoly, type Area } from './data';
import type { NoGo, Params, Pt, Route, RouteMetrics, Stop, Weights } from './types';

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

class Heap {
  k = new Float64Array(1 << 16);
  v = new Int32Array(1 << 16);
  n = 0;
  push(key: number, val: number) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.n * 2); v.set(this.v); this.v = v;
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
  get topKey() { return this.k[0]; }
}

export interface Field {
  blocked: Uint8Array;   // 1 = hard excluded
  reason: Uint8Array;    // 1 slope, 2 roughness, 3 no-go zone
  mult: Float32Array;    // weighted multiplier on edge time
  science: Float32Array; // 0..1 proximity to science features
  minMult: number;
}

export function scienceField(a: Area, pts: Pt[], sigmaM = 15): Float32Array {
  const f = new Float32Array(a.n * a.n);
  const r = Math.ceil((3 * sigmaM) / a.cellM);
  for (const p of pts) {
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    for (let y = Math.max(0, cy - r); y <= Math.min(a.n - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(a.n - 1, cx + r); x++) {
        const d = distM(a, p, { x: x + 0.5, y: y + 0.5 });
        const v = Math.exp(-(d * d) / (2 * sigmaM * sigmaM));
        const i = y * a.n + x;
        if (v > f[i]) f[i] = v;
      }
  }
  return f;
}

/** Rasterize hard exclusions (slope, roughness, buffered no-go zones). */
export function hazardMask(a: Area, p: Params, nogo: NoGo[]): { blocked: Uint8Array; reason: Uint8Array } {
  const nn = a.n * a.n;
  const blocked = new Uint8Array(nn), reason = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) {
    if (a.slope[i] > p.maxSlope) { blocked[i] = 1; reason[i] = 1; }
    else if (a.rough[i] > p.maxRough) { blocked[i] = 1; reason[i] = 2; }
  }
  const zone = new Uint8Array(nn);
  for (const z of nogo) {
    if (z.pts.length < 3) continue;
    const xs = z.pts.map((q) => q.x), ys = z.pts.map((q) => q.y);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(a.n - 1, Math.ceil(Math.max(...ys))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(a.n - 1, Math.ceil(Math.max(...xs))); x++)
        if (pointInPoly({ x: x + 0.5, y: y + 0.5 }, z.pts)) zone[y * a.n + x] = 1;
  }
  const r = Math.ceil(p.bufferM / a.cellM);
  for (let y = 0; y < a.n; y++)
    for (let x = 0; x < a.n; x++) {
      if (!zone[y * a.n + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= a.n || yy >= a.n || Math.hypot(dx * a.dxM, dy * a.dyM) > p.bufferM + a.cellM / 2) continue;
          const i = yy * a.n + xx;
          blocked[i] = 1; reason[i] = 3;
        }
    }
  return { blocked, reason };
}

export function buildField(a: Area, p: Params, w: Weights, nogo: NoGo[], sciencePts: Pt[]): Field {
  const { blocked, reason } = hazardMask(a, p, nogo);
  const science = scienceField(a, sciencePts);
  const nn = a.n * a.n;
  const mult = new Float32Array(nn);
  const wd = Math.max(0.05, w.distance);
  let minMult = Infinity;
  for (let i = 0; i < nn; i++) {
    const s = a.slope[i] / p.maxSlope, r = a.rough[i] / p.maxRough;
    const m = (wd + w.slope * s * s + w.rough * r * r + w.thermal * (1 - a.thermal[i])) * (1 - 0.6 * w.science * science[i]);
    mult[i] = m;
    if (m < minMult) minMult = m;
  }
  return { blocked, reason, mult, science, minMult };
}

/** Directed walking time (s) for one move between adjacent cells. */
export function edgeTime(a: Area, i: number, j: number, speed: number): number {
  const dxc = (j % a.n) - (i % a.n), dyc = Math.floor(j / a.n) - Math.floor(i / a.n);
  const d = Math.hypot(dxc * a.dxM, dyc * a.dyM);
  const dz = a.elev[j] - a.elev[i];
  const g = dz / d;
  return (Math.hypot(d, dz) / speed) * (1 + 4 * Math.max(g, 0) + 2 * Math.max(-g, 0));
}

/** A* on weighted cost. The start cell is exempt from exclusion so a crew member standing in a hazard can leave it. */
export function astar(a: Area, f: Field, from: number, to: number, speed: number): number[] | null {
  if (f.blocked[to]) return null;
  const nn = a.n * a.n;
  const g = new Float64Array(nn).fill(Infinity);
  const prev = new Int32Array(nn).fill(-1);
  const closed = new Uint8Array(nn);
  const tx = to % a.n, ty = Math.floor(to / a.n);
  const hk = f.minMult / speed;
  const h = (i: number) => Math.hypot(((i % a.n) - tx) * a.dxM, (Math.floor(i / a.n) - ty) * a.dyM) * hk;
  const heap = new Heap();
  g[from] = 0;
  heap.push(h(from), from);
  while (heap.n) {
    const i = heap.pop();
    if (closed[i]) continue;
    if (i === to) break;
    closed[i] = 1;
    const x = i % a.n, y = Math.floor(i / a.n);
    for (const [dx, dy] of NB) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= a.n || yy >= a.n) continue;
      const j = yy * a.n + xx;
      if (closed[j] || f.blocked[j]) continue;
      // No diagonal corner-cutting past excluded cells.
      if (dx && dy && (f.blocked[y * a.n + xx] || f.blocked[yy * a.n + x])) continue;
      const c = g[i] + edgeTime(a, i, j, speed) * 0.5 * (f.mult[i] + f.mult[j]);
      if (c < g[j]) { g[j] = c; prev[j] = i; heap.push(c + h(j), j); }
    }
  }
  if (!isFinite(g[to])) return null;
  const path: number[] = [];
  for (let i = to; i !== -1; i = prev[i]) path.push(i);
  return path.reverse();
}

/** Walking time from every cell TO `target` (reverse directed Dijkstra on pure time, hard exclusions only). */
export function timeTo(a: Area, blocked: Uint8Array, target: number, speed: number): Float32Array {
  const nn = a.n * a.n;
  // Float64 while relaxing: comparing float64 heap keys against float32-rounded entries would skip live nodes.
  const t = new Float64Array(nn).fill(Infinity);
  const heap = new Heap();
  t[target] = 0;
  heap.push(0, target);
  while (heap.n) {
    const k = heap.topKey;
    const i = heap.pop();
    if (k > t[i]) continue;
    const x = i % a.n, y = Math.floor(i / a.n);
    for (const [dx, dy] of NB) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= a.n || yy >= a.n) continue;
      const j = yy * a.n + xx;
      if (blocked[j]) continue;
      if (dx && dy && (blocked[y * a.n + xx] || blocked[yy * a.n + x])) continue;
      const c = t[i] + edgeTime(a, j, i, speed); // the walker moves j -> i
      if (c < t[j]) { t[j] = c; heap.push(c, j); }
    }
  }
  return Float32Array.from(t);
}

/** Time to base from a cell that may itself be excluded: best over its 3x3 neighbourhood plus one step. */
export function timeToBaseAt(a: Area, ttb: Float32Array, i: number, speed: number): number {
  if (isFinite(ttb[i])) return ttb[i];
  const x = i % a.n, y = Math.floor(i / a.n);
  let best = Infinity;
  for (const [dx, dy] of NB) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= a.n || yy >= a.n) continue;
    const j = yy * a.n + xx;
    best = Math.min(best, ttb[j] + edgeTime(a, i, j, speed));
  }
  return best;
}

export interface PlanInput {
  area: Area;
  stops: Stop[];        // stops[0] is base; route is base -> stops[order] -> base
  order: number[];      // indices into stops (excluding 0)
  params: Params;
  weights: Weights;
  nogo: NoGo[];
  sciencePts: Pt[];
  ttb: Float32Array;    // time-to-base field under the same hard exclusions
  id: string;
  label: string;
}

export function plan(inp: PlanInput): Route {
  const { area: a, stops, params: p, weights: w } = inp;
  const f = buildField(a, p, w, inp.nogo, inp.sciencePts);
  const seq = [0, ...inp.order, 0];
  const cells: number[] = [];
  const legEnds: number[] = [];
  const empty = (error: string): Route => ({
    id: inp.id, label: inp.label, weights: w, cells: [], legEnds: [], order: inp.order, elapsedS: [], returnS: [], error,
    metrics: { lengthM: 0, walkS: 0, totalS: 0, gainM: 0, lossM: 0, maxSlope: 0, hazardPct: 0, scienceScore: 0, minMarginS: -Infinity, feasible: false },
  });
  for (const s of stops) {
    const i = idx(a, s.x, s.y);
    if (f.blocked[i]) return empty(`${s.name} is on excluded terrain (${['', 'slope', 'roughness', 'no-go zone'][f.reason[i]]})`);
  }
  for (let k = 0; k < seq.length - 1; k++) {
    const A = stops[seq[k]], B = stops[seq[k + 1]];
    const leg = astar(a, f, idx(a, A.x, A.y), idx(a, B.x, B.y), p.speed);
    if (!leg) return empty(`No permitted path from ${A.name} to ${B.name}`);
    cells.push(...(k === 0 ? leg : leg.slice(1)));
    legEnds.push(cells.length - 1);
  }
  const route: Route = { id: inp.id, label: inp.label, weights: w, cells, legEnds, order: inp.order, elapsedS: [], returnS: [], metrics: null! };
  route.metrics = measure(a, route, stops, seq, p, inp.ttb, f.science);
  return route;
}

export function measure(a: Area, r: Route, stops: Stop[], seq: number[], p: Params, ttb: Float32Array, science: Float32Array): RouteMetrics {
  const budget = p.budgetMin * 60, reserve = p.reserveMin * 60;
  let len = 0, walk = 0, gain = 0, loss = 0, maxSlope = 0, hazLen = 0, sciLen = 0, elapsed = 0;
  let minMargin = Infinity;
  let leg = 0;
  const el: number[] = [], ret: number[] = [];
  for (let k = 0; k < r.cells.length; k++) {
    const i = r.cells[k];
    if (k > 0) {
      const j = r.cells[k - 1];
      const d = distM(a, cellPt(a, j), cellPt(a, i));
      const dz = a.elev[i] - a.elev[j];
      const t = edgeTime(a, j, i, p.speed);
      len += Math.hypot(d, dz); walk += t; elapsed += t;
      if (dz > 0) gain += dz; else loss -= dz;
      if (a.slope[i] > 10 || a.rough[i] > p.maxRough / 2) hazLen += d;
      if (science[i] > 0.3) sciLen += d;
    }
    maxSlope = Math.max(maxSlope, a.slope[i]);
    if (leg < r.legEnds.length && k === r.legEnds[leg]) {
      const stop = stops[seq[leg + 1]];
      if (stop.kind !== 'base') elapsed += stop.dwellMin * 60;
      leg++;
    }
    const back = timeToBaseAt(a, ttb, i, p.speed);
    el.push(elapsed); ret.push(back);
    minMargin = Math.min(minMargin, budget - (elapsed + back + reserve));
  }
  r.elapsedS = el; r.returnS = ret;
  return {
    lengthM: len, walkS: walk, totalS: elapsed, gainM: gain, lossM: loss, maxSlope,
    hazardPct: len ? (100 * hazLen) / len : 0,
    scienceScore: len ? Math.min(100, (100 * sciLen) / len + 5 * (stops.length - 1)) : 0,
    minMarginS: minMargin, feasible: minMargin >= 0,
  };
}

/** Exact visit order for up to 7 intermediate stops using one time Dijkstra per stop. */
export function optimizeOrder(a: Area, stops: Stop[], blocked: Uint8Array, speed: number): number[] {
  const n = stops.length;
  const cells = stops.map((s) => idx(a, s.x, s.y));
  const T = cells.map((c) => timeTo(a, blocked, c, speed)); // T[j][cell] = time from cell to stop j
  const cost = (i: number, j: number) => T[j][cells[i]];
  const rest = [...Array(n).keys()].slice(1);
  if (rest.length > 7) return rest;
  let best = Infinity, bestOrder = rest;
  const perm = (cur: number[], left: number[], acc: number) => {
    if (acc >= best) return;
    if (!left.length) {
      const tot = acc + cost(cur[cur.length - 1], 0);
      if (tot < best) { best = tot; bestOrder = cur.slice(1); }
      return;
    }
    for (let k = 0; k < left.length; k++) {
      const nx = left[k];
      perm([...cur, nx], [...left.slice(0, k), ...left.slice(k + 1)], acc + cost(cur[cur.length - 1], nx));
    }
  };
  perm([0], rest, 0);
  return bestOrder;
}

export const PRESETS: { id: string; label: string; weights: Weights; blurb: string }[] = [
  { id: 'shortest', label: 'Fastest', weights: { distance: 1, slope: 0, rough: 0, thermal: 0, science: 0 }, blurb: 'Minimum walking time within hard limits' },
  { id: 'safest', label: 'Safest', weights: { distance: 0.3, slope: 1, rough: 1, thermal: 0.5, science: 0 }, blurb: 'Avoids grade, rough ground and loose (low thermal-inertia) material' },
  { id: 'science', label: 'Science-rich', weights: { distance: 0.5, slope: 0.3, rough: 0.3, thermal: 0, science: 1 }, blurb: 'Bends toward science features and rover-documented sites' },
];
