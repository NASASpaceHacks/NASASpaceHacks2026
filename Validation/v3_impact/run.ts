/** G4 quantified impact: Marswalk vs nearest-first (same rules) vs naive slope-only. Run: pnpm tsx Validation/v3_impact/run.ts */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CREW, DEFAULT_RULES, decodeRaster, mulberry32 } from '../../Shared/src/contracts';
import type { LoadedSitePack } from '../../Shared/src/contracts/sitepack';
import type { PlanRequest, SitePackManifest } from '../../Shared/src/contracts/types';
import { keepoutMask, makeOrderEvaluator, plan, stageFromShelter } from '../../Shared/src/engine';
import { refBuildCostGrid, refCostModel, refSearch } from '../../Research/bench/ref';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const N_PR1 = Number(process.env.N_PR1 ?? 200), N_HAB = Number(process.env.N_HAB ?? 60), SEED = 20260;

function loadPack(): LoadedSitePack {
  const base = join(ROOT, 'SitePacks/gale-v1');
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as SitePackManifest;
  const rasters: Record<string, Float32Array> = {};
  for (const l of Object.values(manifest.rasters)) {
    const b = readFileSync(join(base, l.file));
    rasters[l.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, l);
  }
  return { manifest, rasters, base };
}
const pack = loadPack();
const m = pack.manifest;
const { w, cellM } = m.grid;
const rawReq: PlanRequest = {
  siteId: m.id, hab: m.shelters.find((s) => s.kind === 'hab')!.cell,
  shelters: m.shelters.map((s) => ({ id: s.id, kind: s.kind, cell: s.cell })), sol: m.scenario.sol, startLtstMin: 0,
  stations: m.stations.map((s) => ({ id: s.id, cell: s.cell, value: s.value, dwellMin: s.dwellMin, taskW: s.taskW })),
  rules: DEFAULT_RULES, crew: DEFAULT_CREW, seed: 1,
};
const pr1Req = stageFromShelter(rawReq, 'ROVER1');
const refGrid = refBuildCostGrid(pack);
const koMask = keepoutMask(m.grid, m.keepouts ?? [], true);
const refCtx = { crew: DEFAULT_CREW, rules: DEFAULT_RULES, speedFactor: 1 };
const GRADE_LIM = 20;

const q = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

function naiveRoute(base: number, targets: { id: string; cell: number }[]) {
  const order: string[] = [], legs: number[][] = [];
  let cur = base; const left = [...targets];
  while (left.length) {
    let best: { i: number; r: NonNullable<ReturnType<typeof refSearch>> } | null = null;
    left.forEach((t, i) => { const r = refSearch(refGrid, refCostModel, refCtx, cur, t.cell); if (r && (!best || r.cost < best.r.cost)) best = { i, r }; });
    if (!best) break;
    const b = best as { i: number; r: NonNullable<ReturnType<typeof refSearch>> };
    order.push(left[b.i].id); legs.push(Array.from(b.r.cells)); cur = left[b.i].cell; left.splice(b.i, 1);
  }
  const back = refSearch(refGrid, refCostModel, refCtx, cur, base);
  legs.push(back ? Array.from(back.cells) : [cur, base]);
  return { order, legs, skipped: left.map((t) => t.id), noReturn: !back };
}
function edgeStats(legs: number[][]) {
  let unsafe = 0, ko = 0;
  for (const cells of legs) for (let k = 0; k < cells.length; k++) {
    if (koMask[cells[k]]) ko++;
    if (k === 0) continue;
    const a = cells[k - 1], b = cells[k];
    const d = cellM * Math.hypot(Math.floor(b / w) - Math.floor(a / w), (b % w) - (a % w));
    const dz = pack.rasters.dem[b] - pack.rasters.dem[a];
    if (Math.abs(Math.atan2(dz, d)) * 180 / Math.PI > GRADE_LIM) unsafe++;
  }
  return { unsafe, ko };
}

const ids = m.stations.map((s) => s.id);
const rows: Record<string, string | number>[] = [];
const ruleCounts: Record<string, Record<string, number>> = {};
const stats: Record<string, any> = {};

for (const [setName, baseReq, N, seedOff] of [['PR1', pr1Req, N_PR1, 0], ['HAB1', rawReq, N_HAB, 7]] as const) {
  const rnd = mulberry32(SEED + seedOff);
  const counts: Record<string, number> = {};
  let nUnsafeEdgePlans = 0, nKo = 0, nNaiveViol = 0;
  const A: any[] = [], planMs: number[] = [], replanMs: number[] = [];
  for (let sc = 0; sc < N; sc++) {
    const k = 3 + Math.floor(rnd() * 4);
    const pool = [...ids]; for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const subset = pool.slice(0, k).sort();
    const startLtstMin = Math.round(480 + rnd() * 180);
    const req: PlanRequest = { ...baseReq, startLtstMin, stations: baseReq.stations.filter((s) => subset.includes(s.id)) };
    // A
    const a = plan(pack, req);
    planMs.push(a.solveMs);
    let rms = NaN;
    if (a.status === 'OK' && a.stops.length) {
      const first = a.stops[0];
      const t0 = performance.now();
      plan(pack, { ...req, resume: { elapsedMin: first.departMin, cell: a.segments[1].cells[0], visited: [first.id], o2UsedPct: (100 * (first.departMin - 30)) / 300 } });
      rms = performance.now() - t0; replanMs.push(rms);
    }
    // B: nearest-first by walking time, add only if the whole plan incl. return passes every hard rule
    const ev = makeOrderEvaluator(pack, req);
    let order: string[] = [], bEval = ev([]);
    for (;;) {
      let best: { id: string; legT: number; e: ReturnType<typeof ev> } | null = null;
      for (const id of subset) {
        if (order.includes(id)) continue;
        const e = ev([...order, id]);
        if (!e.pass) continue;
        const legT = e.legMin[order.length];
        if (!best || legT < best.legT) best = { id, legT, e };
      }
      if (!best) break;
      order = [...order, best.id]; bEval = best.e;
    }
    const bVal = order.reduce((s2, id) => s2 + (req.stations.find((s) => s.id === id)?.value ?? 0), 0);
    // C
    const nv = naiveRoute(req.hab, req.stations.filter((s) => true).map((s) => ({ id: s.id, cell: s.cell })));
    const cEv = nv.order.length ? ev(nv.order, nv.legs) : null;
    const es = edgeStats(nv.legs);
    const failed = new Set<string>(cEv ? cEv.failures.map((f) => f.rule) : []);
    if (es.unsafe) failed.add('unsafe_edge_grade_gt_20deg');
    if (es.ko) failed.add('plume_keepout_m');
    const viol = failed.size > 0 || nv.noReturn || nv.skipped.length > 0;
    for (const r of failed) counts[r] = (counts[r] ?? 0) + 1;
    if (viol) nNaiveViol++; if (es.unsafe) nUnsafeEdgePlans++; if (es.ko) nKo++;
    const aVal = a.totals.scienceValue;
    A.push({ aVal, bVal, aOk: a.status === 'OK' });
    rows.push({ set: setName, scenario: sc, startLtst: startLtstMin, stations: subset.join(' '), A_status: a.status, A_value: aVal, A_n: a.order.length, A_evaMin: a.status === 'OK' ? +a.totals.durationMin.toFixed(1) : '',
      A_solveMs: +a.solveMs.toFixed(1), A_replanMs: Number.isNaN(rms) ? '' : +rms.toFixed(1), A_order: a.order.join(' '),
      B_value: bVal, B_n: order.length, B_evaMin: order.length ? +bEval.durationMin.toFixed(1) : '', B_order: order.join(' '),
      C_n: nv.order.length, C_value_if_flown: nv.order.reduce((s2, id) => s2 + (req.stations.find((s) => s.id === id)?.value ?? 0), 0), C_violates: viol ? 1 : 0,
      C_rules: [...failed].join(' '), C_unsafeEdges: es.unsafe, C_keepoutCells: es.ko, C_passesAllRules: cEv?.pass && !viol ? 1 : 0 });
    if ((sc + 1) % 20 === 0) console.log(`${setName} ${sc + 1}/${N}`);
  }
  const both = A.filter((x) => x.bVal > 0);
  const ratios = both.map((x) => x.aVal / x.bVal);
  stats[setName] = {
    scenarios: N,
    marswalkOk: A.filter((x) => x.aOk).length, marswalkStayIn: A.filter((x) => !x.aOk).length,
    nearestFirstZero: A.filter((x) => x.bVal === 0).length,
    scenariosWithBGt0: both.length,
    scienceRatioMean: mean(ratios), scienceRatioMedian: q(ratios, 0.5),
    pctMarswalkBetter: 100 * A.filter((x) => x.aVal > x.bVal + 1e-9).length / N,
    pctEqual: 100 * A.filter((x) => Math.abs(x.aVal - x.bVal) <= 1e-9).length / N,
    pctMarswalkWorse: 100 * A.filter((x) => x.aVal < x.bVal - 1e-9).length / N,
    meanValueA: mean(A.map((x) => x.aVal)), meanValueB: mean(A.map((x) => x.bVal)),
    pctNaiveViolatesAny: 100 * nNaiveViol / N, pctNaiveUnsafeEdge: 100 * nUnsafeEdgePlans / N, pctNaiveKeepout: 100 * nKo / N,
    ruleViolationCounts: counts,
    planP50Ms: q(planMs, 0.5), planP95Ms: q(planMs, 0.95), planMaxMs: Math.max(...planMs),
    replanP50Ms: q(replanMs, 0.5), replanP95Ms: q(replanMs, 0.95), replans: replanMs.length,
  };
  ruleCounts[setName] = counts;
}
const cols = Object.keys(rows[0]);
writeFileSync(join(HERE, 'results.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => { const v = String(r[c]); return /[",\n]/.test(v) ? `"${v}"` : v; }).join(','))].join('\n') + '\n');
writeFileSync(join(HERE, 'summary.json'), JSON.stringify({ site: m.id, seed: SEED, sol: m.scenario.sol, startWindowLtst: '08:00-11:00', stats }, null, 1));
console.log(JSON.stringify(stats, null, 1));
