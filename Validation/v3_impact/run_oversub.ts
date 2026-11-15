/** G4b oversubscribed family: all 12 stations, EVA_CUT leaves 120-240 min. Run: pnpm tsx Validation/v3_impact/run_oversub.ts */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CREW, DEFAULT_RULES, decodeRaster, mulberry32 } from '../../Shared/src/contracts';
import type { LoadedSitePack } from '../../Shared/src/contracts/sitepack';
import type { PlanRequest, SitePackManifest } from '../../Shared/src/contracts/types';
import { keepoutMask, makeOrderEvaluator, plan, stageFromShelter } from '../../Shared/src/engine';

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
const koMask = keepoutMask(m.grid, m.keepouts ?? [], true);
const refCtx = { crew: DEFAULT_CREW, rules: DEFAULT_RULES, speedFactor: 1 };
const GRADE_LIM = 20;


const N = Number(process.env.N ?? 200), SEED2 = 20261;
const q = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const rnd = mulberry32(SEED2);
const rows: any[] = [];
for (let sc = 0; sc < N; sc++) {
  const startLtstMin = Math.round(480 + rnd() * 180);
  const avail = Math.round(120 + rnd() * 120), cut = 330 - avail; // engine: evaMax 360 - egress 30 = 330 surface min before the cut
  const req: PlanRequest = { ...pr1Req, startLtstMin, events: [{ t: 'EVA_CUT', min: cut }] };
  const a = plan(pack, req);
  const ev = makeOrderEvaluator(pack, req);
  const t0 = performance.now();
  let order: string[] = [], bEval = ev([]);
  for (;;) {
    let best: { id: string; legT: number; e: ReturnType<typeof ev> } | null = null;
    for (const st of req.stations) {
      if (order.includes(st.id)) continue;
      const e = ev([...order, st.id]);
      if (!e.pass) continue;
      const legT = e.legMin[order.length];
      if (!best || legT < best.legT) best = { id: st.id, legT, e };
    }
    if (!best) break;
    order = [...order, best.id]; bEval = best.e;
  }
  const bMs = performance.now() - t0;
  const bVal = order.reduce((s2, id) => s2 + (req.stations.find((s) => s.id === id)?.value ?? 0), 0);
  rows.push({ scenario: sc, startLtst: startLtstMin, availMin: avail, bucket: avail < 160 ? '120-160' : avail < 200 ? '160-200' : '200-240',
    A_status: a.status, A_value: a.totals.scienceValue, A_n: a.order.length, A_evaMin: a.status === 'OK' ? +a.totals.durationMin.toFixed(1) : '', A_solveMs: +a.solveMs.toFixed(1), A_order: a.order.join(' '),
    B_value: bVal, B_n: order.length, B_evaMin: order.length ? +bEval.durationMin.toFixed(1) : '', B_solveMs: +bMs.toFixed(1), B_order: order.join(' ') });
  if ((sc + 1) % 20 === 0) console.log(`${sc + 1}/${N}`);
}
function summ(R: any[]) {
  const both = R.filter((x) => x.B_value > 0), ratios = both.map((x) => x.A_value / x.B_value);
  const n = R.length, pc = (f: (x: any) => boolean) => 100 * R.filter(f).length / n;
  const ev = (k: string) => R.filter((x) => x[k] !== '').map((x) => x[k] as number);
  return { scenarios: n, marswalkOk: R.filter((x) => x.A_status === 'OK').length, marswalkStayIn: R.filter((x) => x.A_status !== 'OK').length, bZero: R.filter((x) => x.B_value === 0).length,
    meanValueA: mean(R.map((x) => x.A_value)), meanValueB: mean(R.map((x) => x.B_value)), scenariosWithBGt0: both.length,
    scienceRatioMean: mean(ratios), scienceRatioMedian: q(ratios, 0.5), scienceRatioMin: ratios.length ? Math.min(...ratios) : NaN, scienceRatioMax: ratios.length ? Math.max(...ratios) : NaN,
    pctAGreater: pc((x) => x.A_value > x.B_value + 1e-9), pctEqual: pc((x) => Math.abs(x.A_value - x.B_value) <= 1e-9), pctBGreater: pc((x) => x.B_value > x.A_value + 1e-9),
    meanStationsA: mean(R.map((x) => x.A_n)), meanStationsB: mean(R.map((x) => x.B_n)), meanEvaMinA: mean(ev('A_evaMin')), meanEvaMinB: mean(ev('B_evaMin')),
    solveMsA_p50: q(R.map((x) => x.A_solveMs), 0.5), solveMsA_p95: q(R.map((x) => x.A_solveMs), 0.95), solveMsB_p50: q(R.map((x) => x.B_solveMs), 0.5), solveMsB_p95: q(R.map((x) => x.B_solveMs), 0.95) };
}
const byBucket: Record<string, any> = {};
for (const b of ['120-160', '160-200', '200-240']) byBucket[b] = summ(rows.filter((r) => r.bucket === b));
const cols = Object.keys(rows[0]);
writeFileSync(join(HERE, 'results_oversub.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c])).join(','))].join('\n') + '\n');
const out = { site: m.id, seed: SEED2, sol: m.scenario.sol, startWindowLtst: '08:00-11:00', availableMinRange: [120, 240], candidates: m.stations.length, overall: summ(rows), byBucket };
writeFileSync(join(HERE, 'summary_oversub.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
