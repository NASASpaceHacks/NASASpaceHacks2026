// Export the default Gale scenario (Hab-1 vs rover-staged) for the paper's scenario figure.
// Run from the repo root: npx tsx <this file> <outdir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '/Users/kumarsashank/dev/NASA-Martian-Map/NASASpaceHacks2026';
const out = process.argv[2];

const contracts = await import(join(REPO, 'Shared/src/contracts/index.ts'));
const engine = await import(join(REPO, 'Shared/src/engine/index.ts'));
const { decodeRaster, goldenPlanRequest } = contracts;
const { plan, stageFromShelter, computeFields } = engine;

const dir = join(REPO, 'SitePacks/gale-v1');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const rasters: Record<string, Float32Array> = {};
for (const l of Object.values<any>(manifest.rasters)) {
  const b = readFileSync(join(dir, l.file));
  rasters[l.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), l);
}
const pack = { manifest, rasters, base: dir + '/' };

const req = goldenPlanRequest(pack);
const hab = plan(pack, req);
const rreq = stageFromShelter(req, 'ROVER1');
const rov = plan(pack, rreq);

const summary = (r: any) => ({
  status: r.status, order: r.order, binding: r.binding?.text, totals: r.totals,
  dropped: r.dropped.map((d: any) => ({ id: d.id, rule: d.rule, text: d.text })),
  segments: r.segments.map((s: any) => ({ from: s.from, to: s.to, cells: s.cells, restMin: s.restMin, distM: s.distM })),
  stops: r.stops,
});
writeFileSync(join(out, 'scenario.json'), JSON.stringify({ hab: summary(hab), rover: summary(rov) }));

for (const [name, rq] of [['hab', req], ['rover', rreq]] as const) {
  const f = computeFields(pack, rq);
  for (const k of ['walkbackMin', 'shelterMin', 'outboundMin'] as const) writeFileSync(join(out, `${name}_${k}.f32`), Buffer.from(f[k].buffer.slice(0)));
  writeFileSync(join(out, `${name}_los.u8`), Buffer.from(Uint8Array.from(f.los as ArrayLike<number>)));
  writeFileSync(join(out, `${name}_blocked.u8`), Buffer.from(Uint8Array.from(f.blocked as ArrayLike<number>)));
}
console.log('hab', hab.status, hab.binding?.text);
console.log('rover', rov.status, rov.order.join(' '), rov.totals?.scienceValue, rov.totals?.durationMin, rov.binding?.text);
