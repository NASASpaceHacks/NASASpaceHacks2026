/** pnpm bench [--site mock|gale-v1] [--scenarios N] [--seed S] [--out Research/bench/results] [--size N] */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeRaster, type LoadedSitePack } from '../../Shared/src/contracts/sitepack';
import { mockSitePack } from '../../Shared/src/contracts/fixtures/mockSitePack';
import type { CostGrid, CostModel, PathSearch, SitePackManifest } from '../../Shared/src/contracts/types';
import * as registry from '../../Shared/src/engine/registry';
import { refBuildCostGrid, refCostModel, refDijkstra } from './ref';
import { leaderboardMd, makeScenarios, runBench, summarize, type BenchEnv, type Row } from './harness';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

export function loadSite(site: string, mockSize = 1000): LoadedSitePack {
  if (site !== 'gale-v1' && !existsSync(join(ROOT, 'SitePacks', site, 'manifest.json'))) return mockSitePack(412, mockSize);
  const base = join(ROOT, 'SitePacks', site);
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as SitePackManifest;
  const rasters: Record<string, Float32Array> = {};
  for (const layer of Object.values(manifest.rasters)) {
    const b = readFileSync(join(base, layer.file));
    rasters[layer.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, layer);
  }
  return { manifest, rasters, base };
}

const isSearch = (x: any): x is PathSearch => x && typeof x.search === 'function' && typeof x.id === 'string';
const isCost = (x: any): x is CostModel => x && typeof x.edgeCost === 'function' && typeof x.id === 'string';

/** Collect engine registry + every Research/planners/*.ts (default export, array, or self-registered). */
export async function collectPlanners() {
  let engine: any = {};
  try { engine = await import('../../Shared/src/engine/index'); } catch (e) { console.warn(`[bench] engine index not importable (${(e as Error).message}); using reference only`); }
  const dir = join(ROOT, 'Research/planners');
  for (const f of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f.endsWith('.d.ts')) continue;
    try {
      const m = await import(pathToFileURL(join(dir, f)).href);
      for (const x of [m.default, ...(Array.isArray(m.default) ? m.default : [])]) {
        if (isSearch(x)) registry.registerPathSearch(x);
        else if (isCost(x)) registry.registerCostModel(x);
      }
    } catch (e) { console.warn(`[bench] could not load planner ${f}: ${(e as Error).message}`); }
  }
  const planners = new Map<string, PathSearch>(), costModels = new Map<string, CostModel>();
  for (const p of registry.listPathSearches()) planners.set(p.id, p);
  for (const c of registry.listCostModels()) costModels.set(c.id, c);
  const hasEngineDijkstra = planners.has('dijkstra');
  if (!hasEngineDijkstra) planners.set(refDijkstra.id, refDijkstra);
  costModels.set(refCostModel.id, refCostModel);
  const judge = costModels.get('pandolf-santee-mars') ?? refCostModel;
  const buildGrid = typeof engine.buildCostGrid === 'function' ? (p: LoadedSitePack): CostGrid => engine.buildCostGrid(p) : refBuildCostGrid;
  return {
    planners: [...planners.values()], costModels: [...costModels.values()], judge, buildGrid,
    baseline: { search: hasEngineDijkstra ? 'dijkstra' : refDijkstra.id, cost: judge.id },
    engine: typeof engine.buildCostGrid === 'function',
  };
}

export function writeResults(outDir: string, rows: Row[], summary: ReturnType<typeof summarize>, md: string, meta: object) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(outDir, stamp);
  mkdirSync(dir, { recursive: true });
  const cols = Object.keys(rows[0] ?? {}) as (keyof Row)[];
  writeFileSync(join(dir, 'runs.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n') + '\n');
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ meta, summary }, null, 2));
  writeFileSync(join(dir, 'leaderboard.md'), md);
  const latest = join(outDir, 'latest');
  rmSync(latest, { recursive: true, force: true });
  cpSync(dir, latest, { recursive: true });
  return dir;
}

async function main() {
  const a = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  const site = arg('site', 'mock'), n = Number(arg('scenarios', '20')), seed = Number(arg('seed', '1'));
  const out = resolve(ROOT, arg('out', 'Research/bench/results'));
  const pack = loadSite(site, Number(arg('size', '1000')));
  const c = await collectPlanners();
  const env: BenchEnv = { pack, buildGrid: c.buildGrid, planners: c.planners, costModels: c.costModels, judge: c.judge, baseline: c.baseline };
  console.log(`[bench] site=${pack.manifest.id} grid=${pack.manifest.grid.w}x${pack.manifest.grid.h} engineGrid=${c.engine} planners=${c.planners.map((p) => p.id)} costModels=${c.costModels.map((m) => m.id)} judge=${c.judge.id}`);
  const t0 = performance.now();
  const scen = makeScenarios(env, n, seed);
  console.log(`[bench] ${scen.length} scenarios generated in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const rows = runBench(env, scen, console.log);
  const sum = summarize(rows, c.baseline);
  const md = leaderboardMd(sum, { site: pack.manifest.id, scenarios: n, seed, judge: c.judge.id, baseline: c.baseline });
  const dir = writeResults(out, rows, sum, md, { site: pack.manifest.id, scenarios: n, seed, judge: c.judge.id, baseline: c.baseline, engineGrid: c.engine, createdUtc: new Date().toISOString() });
  console.log(md + `\n[bench] wrote ${dir} (+ latest/)`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
