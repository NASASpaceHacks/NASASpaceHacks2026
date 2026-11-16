// One-at-a-time sensitivity of the default Gale scenario to team-chosen parameters, from Hab-1 and from PR-1,
// plus the PR-1 plan's burndown for the "anatomy of a plan" figure. Read-only use of the repo.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '/Users/kumarsashank/dev/NASA-Martian-Map/NASASpaceHacks2026';
const out = process.argv[2];
const contracts = await import(join(REPO, 'Shared/src/contracts/index.ts'));
const rulesMod = await import(join(REPO, 'Shared/src/contracts/rules.ts'));
const engine = await import(join(REPO, 'Shared/src/engine/index.ts'));
const { decodeRaster, goldenPlanRequest } = contracts;
const { DEFAULT_RULES } = rulesMod;
const { plan, stageFromShelter } = engine;

const dir = join(REPO, 'SitePacks/gale-v1');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const rasters: Record<string, Float32Array> = {};
for (const l of Object.values<any>(manifest.rasters)) {
  const b = readFileSync(join(dir, l.file));
  rasters[l.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), l);
}
const pack = { manifest, rasters, base: dir + '/' };
const base = goldenPlanRequest(pack);

const withRules = (req: any, changes: Record<string, { value?: number; enabled?: boolean }>) => ({
  ...req,
  rules: DEFAULT_RULES.map((r: any) => (changes[r.id] ? { ...r, ...changes[r.id] } : r)),
});

const variants: [string, Record<string, { value?: number; enabled?: boolean }>][] = [
  ['baseline', {}],
  ['heat budget 530 W', { heat_avg_max_w: { value: 530 } }],
  ['heat limit off', { heat_avg_max_w: { enabled: false } }],
  ['radio gap 20 min', { los_gap_max_min: { value: 20 } }],
  ['radio gap rule off', { los_gap_max_min: { enabled: false } }],
  ['walk-back factor 0.67', { walkback_speed_factor: { value: 0.67 } }],
  ['shelter limit 45 min', { shelter_time_max_min: { value: 45 } }],
  ['radius 3 km', { walk_radius_max_m: { value: 3000 } }],
  ['heat off + radio off', { heat_avg_max_w: { enabled: false }, los_gap_max_min: { enabled: false } }],
];

const rows: any[] = [];
for (const [bname, mk] of [['Hab-1', (r: any) => r], ['PR-1', (r: any) => stageFromShelter(r, 'ROVER1')]] as const) {
  for (const [vname, ch] of variants) {
    const req = mk(withRules(base, ch));
    const t0 = performance.now();
    const r = plan(pack, req);
    const ms = performance.now() - t0;
    const hist: Record<string, number> = {};
    for (const d of r.dropped) hist[d.rule] = (hist[d.rule] ?? 0) + 1;
    rows.push({ base: bname, variant: vname, status: r.status, n: r.order.length, order: r.order, value: r.totals?.scienceValue ?? 0,
      durationMin: r.status === 'OK' ? r.totals.durationMin : null, binding: r.binding?.text ?? null, dropped: hist, ms: Math.round(ms) });
    console.log(bname.padEnd(6), vname.padEnd(24), r.status.padEnd(8), String(r.order.length).padEnd(3), String(r.totals?.scienceValue ?? 0).padEnd(5),
      r.status === 'OK' ? r.totals.durationMin.toFixed(0) : '-', JSON.stringify(hist));
  }
}
writeFileSync(join(out, 'sensitivity.json'), JSON.stringify(rows, null, 1));

const rov = plan(pack, stageFromShelter(base, 'ROVER1'));
writeFileSync(join(out, 'rover_plan.json'), JSON.stringify({ burndown: rov.burndown, stops: rov.stops, segments: rov.segments.map((s: any) => ({ from: s.from, to: s.to, t0Min: s.t0Min, t1Min: s.t1Min, restMin: s.restMin, distM: s.distM })), margins: rov.margins, bingo: rov.bingo, totals: rov.totals, binding: rov.binding }));
console.log('rover burndown points', rov.burndown.length, 'surface min', rov.burndown.at(-1)?.tMin);
