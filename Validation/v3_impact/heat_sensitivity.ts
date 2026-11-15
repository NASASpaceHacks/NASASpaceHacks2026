/**
 * How robust is the Hab-1 result ("walking from the habitat to the boxwork overruns the EVA")?
 * Sweeps the suit heat-rejection budget (rule heat_avg_max_w; NASA sizing figure 352 W) and reports, for
 * each budget, how many of the 12 Gale science stops a walk FROM HAB-1 can reach (each stop alone, out and
 * back, every other rule unchanged), and which rule still binds. Same engine, same terrain, same crew.
 *
 * Run: pnpm tsx Validation/v3_impact/heat_sensitivity.ts  → heat_sensitivity.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CREW, DEFAULT_RULES, decodeRaster } from '../../Shared/src/contracts';
import type { LoadedSitePack } from '../../Shared/src/contracts/sitepack';
import type { PlanRequest, Rule, SitePackManifest } from '../../Shared/src/contracts/types';
import { plan } from '../../Shared/src/engine';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const base = join(ROOT, 'SitePacks/gale-v1');
const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as SitePackManifest;
const rasters: Record<string, Float32Array> = {};
for (const l of Object.values(manifest.rasters)) {
  const b = readFileSync(join(base, l.file));
  rasters[l.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, l);
}
const pack: LoadedSitePack = { manifest, rasters, base };

const START = 9 * 60 + 40; // 09:40 LTST, the demo start time
const BUDGETS = [352, 400, 450, 500, 530, 600, 700, 800, 1000, 1500];
const withHeat = (w: number): Rule[] => DEFAULT_RULES.map((r) => (r.id === 'heat_avg_max_w' ? { ...r, value: w } : r));

const habReq = (stationId: string, rules: Rule[]): PlanRequest => ({
  siteId: manifest.id,
  hab: manifest.shelters.find((s) => s.kind === 'hab')!.cell,
  shelters: manifest.shelters.map((s) => ({ id: s.id, kind: s.kind, cell: s.cell })),
  sol: manifest.scenario.sol,
  startLtstMin: START,
  stations: manifest.stations.filter((s) => s.id === stationId).map((s) => ({ id: s.id, cell: s.cell, value: s.value, dwellMin: s.dwellMin, taskW: s.taskW })),
  rules,
  crew: DEFAULT_CREW,
  seed: 1,
});

const rows: { budgetW: number; reachable: string[]; nReachable: number; bindingWhenDropped: Record<string, number> }[] = [];
for (const w of BUDGETS) {
  const rules = withHeat(w);
  const reachable: string[] = [];
  const binding: Record<string, number> = {};
  for (const st of manifest.stations) {
    const r = plan(pack, habReq(st.id, rules));
    if (r.status === 'OK' && r.stops.some((s) => s.id === st.id)) reachable.push(st.id);
    else {
      const d = r.dropped.find((x) => x.id === st.id);
      const key = d?.rule ?? r.status;
      binding[key] = (binding[key] ?? 0) + 1;
    }
  }
  rows.push({ budgetW: w, reachable, nReachable: reachable.length, bindingWhenDropped: binding });
  console.log(`${String(w).padStart(5)} W  reachable ${String(reachable.length).padStart(2)}/12  ${JSON.stringify(binding)}`);
}

const first = rows.find((r) => r.nReachable > 0);
const out = {
  site: manifest.id,
  base: 'HAB1 (walk from the habitat)',
  startLtst: '09:40',
  nasaSizingW: 352,
  rows,
  minBudgetForAnyStopW: first?.budgetW ?? null,
  ratioToNasaSizing: first ? +(first.budgetW / 352).toFixed(2) : null,
  note:
    'Each stop is planned alone (out and back) from Hab-1 with every rule except the heat budget unchanged. The budget at which the first stop becomes reachable says how much more heat the suit would have to reject (or, roughly, how much our energy model would have to over-predict) before walking from the habitat works. Rest periods are fixed at the engine default.',
};
writeFileSync(join(HERE, 'heat_sensitivity.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`first reachable at ${out.minBudgetForAnyStopW} W (${out.ratioToNasaSizing}x NASA's 352 W)`);
