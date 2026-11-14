/** Benchmark harness: scenarios, metrics, aggregation. Pure TS + Node timing; no file IO here. */
import type { Cell, CostCtx, CostGrid, CostModel, PathSearch } from '../../Shared/src/contracts/types';
import type { LoadedSitePack } from '../../Shared/src/contracts/sitepack';
import { mulberry32 } from '../../Shared/src/contracts/sitepack';
import { DEFAULT_CREW, DEFAULT_RULES } from '../../Shared/src/contracts/rules';
import { refBuildCostGrid, refCostModel, refDijkstra, refSearch, SLOPE_HARD_DEG } from './ref';

export const ROUGH_THRESHOLD_M = 0.5; // bench choice: cells with roughness (std-dev, m) above this count as rough terrain
export const SENSE_RADIUS_M = 50;     // hidden-hazard sensing radius (team report: rover "senses" a radius)
export const START_GOAL_RADIUS_M = 2000;

export const benchCtx: CostCtx = { crew: DEFAULT_CREW, rules: DEFAULT_RULES, speedFactor: 1 };

export interface BenchEnv {
  pack: LoadedSitePack;
  buildGrid: (pack: LoadedSitePack) => CostGrid;
  planners: PathSearch[];
  costModels: CostModel[];
  judge: CostModel;          // all paths are scored (and the oracle computed) under this model
  baseline: { search: string; cost: string };
}

export interface Scenario { id: number; kind: 'static' | 'hazard'; start: Cell; goal: Cell; hazards?: Cell[][] }

export interface Row {
  kind: 'static' | 'hazard'; scenario: number; planner: string; costModel: string;
  success: number; lengthM: number; judgeCost: number; oracleCost: number; gapPct: number;
  gainM: number; lossM: number; meanSlope: number; maxSlope: number; roughPct: number; turns: number; turnDeg: number;
  expanded: number; ms: number; memMB: number; replans: number; extraDistM: number; extraCostPct: number; violations: number;
}

const rowCol = (g: CostGrid, c: Cell): [number, number] => [Math.floor(c / g.w), c % g.w];

function habCell(pack: LoadedSitePack): Cell {
  const s = pack.manifest.shelters.find((x) => x.kind === 'hab');
  const { w, h } = pack.manifest.grid;
  return s ? s.cell : Math.floor(h / 2) * w + Math.floor(w / 2);
}

export function makeScenarios(env: BenchEnv, n: number, seed: number): Scenario[] {
  const g = env.buildGrid(env.pack);
  const rnd = mulberry32(seed);
  const hab = habCell(env.pack);
  const [hr, hc] = rowCol(g, hab);
  const rad = Math.min(START_GOAL_RADIUS_M / g.cellM, g.w / 2 - 1);
  const minSep = Math.min(300, START_GOAL_RADIUS_M) / g.cellM;
  const pick = (): Cell => {
    for (let k = 0; k < 10000; k++) {
      const r = Math.round(hr + (rnd() * 2 - 1) * rad), c = Math.round(hc + (rnd() * 2 - 1) * rad);
      if (r < 0 || c < 0 || r >= g.h || c >= g.w) continue;
      if (Math.hypot(r - hr, c - hc) > rad) continue;
      const cell = r * g.w + c;
      if (!g.blocked[cell]) return cell;
    }
    throw new Error('no passable cell near hab');
  };
  const out: Scenario[] = [];
  for (const kind of ['static', 'hazard'] as const) {
    let id = 0, guard = 0;
    while (id < n && guard++ < n * 50) {
      const start = pick(), goal = pick();
      const [r1, c1] = rowCol(g, start), [r2, c2] = rowCol(g, goal);
      if (Math.hypot(r1 - r2, c1 - c2) < minSep) continue;
      const base = refSearch(g, env.judge, benchCtx, start, goal);
      if (!base) continue;
      if (kind === 'static') { out.push({ id: id++, kind, start, goal }); continue; }
      // hazard blobs centred on the known-optimal path (so they matter), radius 3-5 cells
      const cells = base.cells;
      if (cells.length < 30) continue;
      const blobs: Cell[][] = [];
      for (let b = 0; b < 3; b++) {
        const centre = cells[Math.floor(cells.length * (0.25 + 0.25 * b + rnd() * 0.12))];
        const [cr, cc] = rowCol(g, centre), rr = 3 + Math.floor(rnd() * 3);
        const blob: Cell[] = [];
        for (let r = cr - rr; r <= cr + rr; r++) for (let c = cc - rr; c <= cc + rr; c++) {
          if (r < 0 || c < 0 || r >= g.h || c >= g.w || Math.hypot(r - cr, c - cc) > rr) continue;
          const cell = r * g.w + c;
          if (cell !== start && cell !== goal) blob.push(cell);
        }
        blobs.push(blob);
      }
      const tg = { ...g, blocked: g.blocked.slice() };
      for (const b of blobs) for (const c of b) tg.blocked[c] = 1;
      if (!refSearch(tg, env.judge, benchCtx, start, goal)) continue; // goal must stay reachable
      out.push({ id: id++, kind, start, goal, hazards: blobs });
    }
  }
  return out;
}

export interface PathMetrics {
  lengthM: number; judgeCost: number; gainM: number; lossM: number; meanSlope: number; maxSlope: number;
  roughPct: number; turns: number; turnDeg: number; violations: number;
}

/** Score a path on the TRUE grid (blocked includes hidden hazards). */
export function pathMetrics(g: CostGrid, judge: CostModel, p: ArrayLike<number>, start: Cell, goal: Cell, trueBlocked: Uint8Array = g.blocked): PathMetrics {
  const m: PathMetrics = { lengthM: 0, judgeCost: 0, gainM: 0, lossM: 0, meanSlope: 0, maxSlope: 0, roughPct: 0, turns: 0, turnDeg: 0, violations: 0 };
  if (p.length === 0 || p[0] !== start || p[p.length - 1] !== goal) m.violations++;
  let slopeSum = 0, rough = 0, prevH = NaN;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (trueBlocked[c] || g.blocked[c]) m.violations++;
    if (g.slopeDeg[c] > SLOPE_HARD_DEG) m.violations++;
    slopeSum += g.slopeDeg[c];
    m.maxSlope = Math.max(m.maxSlope, g.slopeDeg[c]);
    if (g.rough[c] > ROUGH_THRESHOLD_M) rough++;
    if (i > 0) {
      const a = p[i - 1];
      const [r0, c0] = rowCol(g, a), [r1, c1] = rowCol(g, c);
      if (Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0)) !== 1) { m.violations++; continue; } // non-adjacent jump
      m.lengthM += g.cellM * Math.hypot(r1 - r0, c1 - c0);
      m.judgeCost += judge.edgeCost(g, a, c, benchCtx);
      const dz = g.elev[c] - g.elev[a];
      if (dz > 0) m.gainM += dz; else m.lossM -= dz;
      const hd = Math.atan2(c1 - c0, -(r1 - r0)) * 180 / Math.PI;
      if (!Number.isNaN(prevH)) {
        let d = Math.abs(hd - prevH); if (d > 180) d = 360 - d;
        if (d > 1e-6) { m.turns++; m.turnDeg += d; }
      }
      prevH = hd;
    }
  }
  m.meanSlope = slopeSum / Math.max(1, p.length);
  m.roughPct = (100 * rough) / Math.max(1, p.length);
  return m;
}

const memNow = () => { const u = process.memoryUsage(); return u.heapUsed + u.arrayBuffers; };

function oracleFor(env: BenchEnv, g: CostGrid, s: Scenario, truth: boolean, cache: Map<string, number>): number {
  const key = `${s.kind}:${s.id}:${truth}`;
  let v = cache.get(key);
  if (v === undefined) {
    let gg = g;
    if (truth && s.hazards) { gg = { ...g, blocked: g.blocked.slice() }; for (const b of s.hazards) for (const c of b) gg.blocked[c] = 1; }
    v = refSearch(gg, env.judge, benchCtx, s.start, s.goal)!.cost;
    cache.set(key, v);
  }
  return v;
}

function failRow(s: Scenario, ps: PathSearch, cm: CostModel, oracle: number, violations = 0): Row {
  return { kind: s.kind, scenario: s.id, planner: ps.id, costModel: cm.id, success: 0, lengthM: NaN, judgeCost: NaN, oracleCost: oracle, gapPct: NaN,
    gainM: NaN, lossM: NaN, meanSlope: NaN, maxSlope: NaN, roughPct: NaN, turns: NaN, turnDeg: NaN, expanded: NaN, ms: NaN, memMB: NaN,
    replans: 0, extraDistM: NaN, extraCostPct: NaN, violations };
}

function runStatic(env: BenchEnv, g: CostGrid, s: Scenario, ps: PathSearch, cm: CostModel, cache: Map<string, number>): Row {
  const oracle = oracleFor(env, g, s, false, cache);
  const grid = { ...g, blocked: g.blocked.slice() };
  const m0 = memNow(), t0 = performance.now();
  let res;
  try { res = ps.search(grid, cm, benchCtx, s.start, s.goal); } catch (e) { console.warn(`[bench] ${ps.id} threw: ${(e as Error).message}`); res = null; }
  const ms = performance.now() - t0, mem = Math.max(0, memNow() - m0) / 1048576;
  if (!res) return failRow(s, ps, cm, oracle);
  const pm = pathMetrics(g, env.judge, res.cells, s.start, s.goal);
  return { kind: s.kind, scenario: s.id, planner: ps.id, costModel: cm.id, success: 1, lengthM: pm.lengthM, judgeCost: pm.judgeCost, oracleCost: oracle,
    gapPct: (100 * (pm.judgeCost - oracle)) / oracle, gainM: pm.gainM, lossM: pm.lossM, meanSlope: pm.meanSlope, maxSlope: pm.maxSlope, roughPct: pm.roughPct,
    turns: pm.turns, turnDeg: pm.turnDeg, expanded: res.expanded, ms, memMB: mem, replans: 0, extraDistM: 0, extraCostPct: 0, violations: pm.violations };
}

/** Walker follows the plan, senses hidden hazards within 50 m, replans on reveal. */
function runHazard(env: BenchEnv, g: CostGrid, s: Scenario, ps: PathSearch, cm: CostModel, cache: Map<string, number>): Row {
  const truthOracle = oracleFor(env, g, s, true, cache);
  const hidden = new Set<Cell>(); for (const b of s.hazards!) for (const c of b) hidden.add(c);
  const trueBlocked = g.blocked.slice(); for (const c of hidden) trueBlocked[c] = 1;
  const grid = { ...g, blocked: g.blocked.slice() }; // planner's (incomplete) knowledge
  const senseCells = SENSE_RADIUS_M / g.cellM;
  let expanded = 0, totalMs = 0, replans = 0, peakMem = 0;
  const call = (from: Cell) => {
    const m0 = memNow(), t0 = performance.now();
    let r = null;
    try { r = ps.search(grid, cm, benchCtx, from, s.goal); } catch (e) { console.warn(`[bench] ${ps.id} threw: ${(e as Error).message}`); }
    totalMs += performance.now() - t0; peakMem = Math.max(peakMem, memNow() - m0);
    if (r) expanded += r.expanded;
    return r;
  };
  let plan = call(s.start);
  if (!plan) return failRow(s, ps, cm, truthOracle);
  const walked: number[] = [s.start];
  let idx = 0;
  while (plan.cells[idx] !== s.goal) {
    const cur = plan.cells[idx];
    // sense
    const [cr, cc] = rowCol(g, cur);
    const revealed: Cell[] = [];
    for (const c of hidden) {
      const [r, k] = rowCol(g, c);
      if (Math.hypot(r - cr, k - cc) <= senseCells) revealed.push(c);
    }
    if (revealed.length) {
      for (const c of revealed) { hidden.delete(c); grid.blocked[c] = 1; }
      const remaining = new Set<number>(Array.from(plan.cells.subarray(idx)));
      const hit = revealed.some((c) => remaining.has(c));
      ps.update?.(revealed);
      if (hit) {
        if (++replans > 60) return failRow(s, ps, cm, truthOracle);
        const np = call(cur);
        if (!np) return failRow(s, ps, cm, truthOracle);
        plan = np; idx = 0;
        if (plan.cells[0] !== cur) return failRow(s, ps, cm, truthOracle, 1);
      }
    }
    idx++;
    if (idx >= plan.cells.length) return failRow(s, ps, cm, truthOracle, 1);
    walked.push(plan.cells[idx]);
  }
  const pm = pathMetrics(g, env.judge, walked, s.start, s.goal, trueBlocked);
  return { kind: s.kind, scenario: s.id, planner: ps.id, costModel: cm.id, success: 1, lengthM: pm.lengthM, judgeCost: pm.judgeCost, oracleCost: truthOracle,
    gapPct: (100 * (pm.judgeCost - truthOracle)) / truthOracle, gainM: pm.gainM, lossM: pm.lossM, meanSlope: pm.meanSlope, maxSlope: pm.maxSlope, roughPct: pm.roughPct,
    turns: pm.turns, turnDeg: pm.turnDeg, expanded, ms: totalMs, memMB: peakMem / 1048576, replans,
    extraDistM: pm.lengthM - pathMetrics(g, env.judge, refSearch({ ...g, blocked: trueBlocked }, env.judge, benchCtx, s.start, s.goal)!.cells, s.start, s.goal, trueBlocked).lengthM,
    extraCostPct: (100 * (pm.judgeCost - truthOracle)) / truthOracle, violations: pm.violations };
}

export function runBench(env: BenchEnv, scenarios: Scenario[], log: (m: string) => void = () => {}): Row[] {
  const g = env.buildGrid(env.pack);
  const cache = new Map<string, number>();
  const rows: Row[] = [];
  for (const ps of env.planners) for (const cm of env.costModels) {
    for (const s of scenarios) {
      // fresh planner state per scenario is the planner's job; we hand it a fresh grid copy
      rows.push(s.kind === 'static' ? runStatic(env, g, s, ps, cm, cache) : runHazard(env, g, s, ps, cm, cache));
    }
    log(`  ${ps.id} x ${cm.id}: done`);
  }
  return rows;
}

// ───────────── aggregation ─────────────
const q = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export interface Summary {
  planner: string; costModel: string; star: boolean; fast: boolean;
  static: { n: number; success: number; meanCost: number; meanGapPct: number; maxGapPct: number; meanLengthM: number; meanMaxSlope: number; roughPct: number;
    meanTurns: number; expanded: number; msP50: number; msP95: number; memMB: number; violations: number };
  hazard: { n: number; success: number; meanCost: number; meanExtraDistM: number; meanReplans: number; meanExtraCostPct: number; msP50: number; msP95: number; violations: number };
}

export function summarize(rows: Row[], baseline: { search: string; cost: string }) {
  const keys = [...new Set(rows.map((r) => `${r.planner}|${r.costModel}`))];
  const out: Summary[] = keys.map((k) => {
    const [planner, costModel] = k.split('|');
    const mine = rows.filter((r) => r.planner === planner && r.costModel === costModel);
    const st = mine.filter((r) => r.kind === 'static'), hz = mine.filter((r) => r.kind === 'hazard');
    const ok = (a: Row[]) => a.filter((r) => r.success);
    const f = (a: Row[], key: keyof Row) => ok(a).map((r) => r[key] as number);
    return { planner, costModel, star: false, fast: false,
      static: { n: st.length, success: st.length ? ok(st).length / st.length : NaN, meanCost: mean(f(st, 'judgeCost')), meanGapPct: mean(f(st, 'gapPct')), maxGapPct: f(st, 'gapPct').reduce((m, v) => Math.max(m, v), -Infinity),
        meanLengthM: mean(f(st, 'lengthM')), meanMaxSlope: mean(f(st, 'maxSlope')), roughPct: mean(f(st, 'roughPct')), meanTurns: mean(f(st, 'turns')),
        expanded: mean(f(st, 'expanded')), msP50: q(f(st, 'ms'), 0.5), msP95: q(f(st, 'ms'), 0.95), memMB: Math.max(0, ...f(st, 'memMB')),
        violations: st.reduce((a, r) => a + r.violations, 0) },
      hazard: { n: hz.length, success: hz.length ? ok(hz).length / hz.length : NaN, meanCost: mean(f(hz, 'judgeCost')), meanExtraDistM: mean(f(hz, 'extraDistM')),
        meanReplans: mean(f(hz, 'replans')), meanExtraCostPct: mean(f(hz, 'extraCostPct')), msP50: q(f(hz, 'ms'), 0.5), msP95: q(f(hz, 'ms'), 0.95),
        violations: hz.reduce((a, r) => a + r.violations, 0) } };
  });
  const base = out.find((s) => s.planner === baseline.search && s.costModel === baseline.cost);
  if (base) for (const s of out) {
    if (s === base) continue;
    const safe = s.static.violations + s.hazard.violations === 0 && !(s.static.success < base.static.success) && !(s.hazard.success < base.hazard.success);
    const eps = 1e-9;
    const cheaper = (s.static.meanCost < base.static.meanCost * (1 - eps)) || (s.hazard.n > 0 && s.hazard.meanCost < base.hazard.meanCost * (1 - eps));
    s.star = safe && cheaper;
    // equal cost (within 1%) at >=2x lower p50 latency
    s.fast = safe && !cheaper && s.static.meanCost <= base.static.meanCost * 1.01 && s.static.msP50 * 2 <= base.static.msP50;
  }
  return out;
}

const fx = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');

export function leaderboardMd(sum: Summary[], meta: { site: string; scenarios: number; seed: number; judge: string; baseline: { search: string; cost: string } }): string {
  const sorted = [...sum].sort((a, b) => (a.static.violations + a.hazard.violations > 0 ? 1 : 0) - (b.static.violations + b.hazard.violations > 0 ? 1 : 0)
    || (a.hazard.meanCost || 0) - (b.hazard.meanCost || 0) || a.static.meanGapPct - b.static.meanGapPct);
  let md = `# Marswalk planner leaderboard\n\nSite \`${meta.site}\`, ${meta.scenarios} static + ${meta.scenarios} hidden-hazard scenarios, seed ${meta.seed}.\n`;
  md += `All paths are scored under judge cost model \`${meta.judge}\`; optimality gap is vs an independent Dijkstra oracle on the fully known map. Baseline: \`${meta.baseline.search}\` x \`${meta.baseline.cost}\`.\n\n`;
  md += `| # | Planner | Cost model | Static gap % (mean/max) | Cost s | Length m | Max slope | Rough % | Turns | Expanded | p50 ms | p95 ms | Mem MB | Hazard success | Replans | Extra dist m | Violations |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  sorted.forEach((s, i) => {
    const v = s.static.violations + s.hazard.violations;
    const mark = s.star ? ' ★' : s.fast ? ' ⚡' : '';
    md += `| ${i + 1} | ${s.planner}${mark} | ${s.costModel} | ${fx(s.static.meanGapPct, 3)} / ${fx(s.static.maxGapPct, 3)} | ${fx(s.static.meanCost, 1)} | ${fx(s.static.meanLengthM, 0)} | ${fx(s.static.meanMaxSlope, 1)} | ${fx(s.static.roughPct, 1)} | ${fx(s.static.meanTurns, 1)} | ${fx(s.static.expanded, 0)} | ${fx(s.static.msP50)} | ${fx(s.static.msP95)} | ${fx(s.static.memMB, 1)} | ${fx(100 * s.hazard.success, 0)}% | ${fx(s.hazard.meanReplans, 1)} | ${fx(s.hazard.meanExtraDistM, 1)} | ${v === 0 ? '0' : '**' + v + '**'} |\n`;
  });
  md += `\n**★** = lower mean cost than the baseline (static or hidden-hazard walk) with 0 hard-constraint violations and no loss of success rate. **⚡** = equal cost (within 1%) at >=2x lower p50 latency, same safety. Violations (slope > ${SLOPE_HARD_DEG} deg, blocked cells, broken paths) must be 0; a planner with any is ranked last and can never merge. Rough = cells with roughness > ${ROUGH_THRESHOLD_M} m. Memory is a heap+ArrayBuffer delta measured around the search call (an estimate, noisy without forced GC). The baseline's own gap should be ~0 by construction.\n`;
  return md;
}

export function defaultRefs() { return { search: refDijkstra, cost: refCostModel, build: refBuildCostGrid }; }
