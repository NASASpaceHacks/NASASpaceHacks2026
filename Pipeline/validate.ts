/**
 * Validate a site pack: schema (SitePackManifestSchema) + file integrity + grid consistency.
 *
 *   pnpm tsx Pipeline/validate.ts SitePacks/gale-v1/manifest.json
 *
 * Exit code 0 = valid. Prints one line per check group.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SitePackManifestSchema, decodeRaster, hornSlopeDeg, surfaceNormals, xyToCell, type SitePackManifest } from '../Shared/src/contracts/index.ts';

const path = process.argv[2] ?? 'SitePacks/gale-v1/manifest.json';
const root = dirname(path);
const errors: string[] = [];
const warn: string[] = [];

const raw = JSON.parse(readFileSync(path, 'utf8'));
const parsed = SitePackManifestSchema.safeParse(raw);
if (!parsed.success) {
  console.error('SCHEMA: FAIL');
  for (const i of parsed.error.issues.slice(0, 30)) console.error(`  ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
console.log('SCHEMA: ok (SitePackManifestSchema.parse)');
const m = raw as SitePackManifest;
const g = m.grid;
const BYTES = { u8: 1, u16: 2, i16: 2, f32: 4 } as const;

// Files: existence + sha256 + raster sizes
let total = 0;
for (const [rel, sha] of Object.entries(m.files)) {
  const p = join(root, rel);
  if (!existsSync(p)) { errors.push(`missing file ${rel}`); continue; }
  const buf = readFileSync(p);
  total += buf.length;
  if (buf.length > 50 * 1024 * 1024) errors.push(`${rel} is ${(buf.length / 1048576).toFixed(1)} MB (> 50 MB)`);
  const h = createHash('sha256').update(buf).digest('hex');
  if (h !== sha) errors.push(`sha256 mismatch ${rel}`);
}
const referenced = [
  ...Object.values(m.rasters).map((l) => l.file),
  ...m.imagery.map((i) => i.file),
  ...m.images.map((i) => i.file),
];
for (const f of referenced) if (!(f in m.files)) errors.push(`${f} referenced but not in files{}`);
if (total > 100 * 1024 * 1024) errors.push(`pack total ${(total / 1048576).toFixed(1)} MB > 100 MB`);
console.log(`FILES: ${Object.keys(m.files).length} files, ${(total / 1048576).toFixed(1)} MB total`);

for (const l of Object.values(m.rasters)) {
  const p = join(root, l.file);
  if (!existsSync(p)) continue;
  const expect = g.w * g.h * l.bands * BYTES[l.dtype];
  const size = statSync(p).size;
  if (size !== expect) { errors.push(`${l.id}: ${size} B, expected ${expect}`); continue; }
  const buf = readFileSync(p);
  const vals = decodeRaster(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), l);
  let lo = Infinity, hi = -Infinity, nan = 0;
  for (const v of vals) { if (Number.isNaN(v)) nan++; else { if (v < lo) lo = v; if (v > hi) hi = v; } }
  console.log(`RASTER ${l.id.padEnd(8)} ${l.dtype}×${l.bands} ${(size / 1048576).toFixed(1)} MB  range ${lo.toFixed(3)}…${hi.toFixed(3)} ${l.unit}  nodata ${nan}`);
  if (nan > 0 && (l.id === 'dem' || l.id === 'slope')) warn.push(`${l.id} has ${nan} nodata cells`);
}

// Derived layers must match the contract's own implementations (interior cells; the pipeline uses real
// neighbours beyond the grid edge where the TS helpers clamp).
const load = (id: string) => {
  const l = m.rasters[id];
  if (!l || !existsSync(join(root, l.file))) return null;
  const b = readFileSync(join(root, l.file));
  return decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), l);
};
const dem = load('dem'), slope = load('slope'), normals = load('normals');
if (dem && slope) {
  const ref = hornSlopeDeg(dem, g.w, g.h, g.cellM);
  let worst = 0;
  for (let r = 1; r < g.h - 1; r++) for (let c = 1; c < g.w - 1; c++) worst = Math.max(worst, Math.abs(ref[r * g.w + c] - slope[r * g.w + c]));
  console.log(`CONSISTENCY slope vs hornSlopeDeg(dem): max |Δ| ${worst.toFixed(4)}°`);
  if (worst > 0.05) errors.push(`slope differs from hornSlopeDeg by ${worst}°`);
}
if (dem && normals) {
  const ref = surfaceNormals(dem, g.w, g.h, g.cellM);
  let worst = 0;
  for (let r = 1; r < g.h - 1; r++) for (let c = 1; c < g.w - 1; c++) {
    const i = 2 * (r * g.w + c);
    worst = Math.max(worst, Math.abs(ref[i] - normals[i]), Math.abs(ref[i + 1] - normals[i + 1]));
  }
  console.log(`CONSISTENCY normals vs surfaceNormals(dem): max |Δ| ${worst.toExponential(2)}`);
  if (worst > 1e-3) errors.push(`normals differ from surfaceNormals by ${worst}`);
}

// Point features: cells must match x,y
const checkCell = (kind: string, id: string, x: number, y: number, cell: number) => {
  const c = xyToCell(g, x, y);
  if (c !== cell) errors.push(`${kind} ${id}: cell ${cell} != xyToCell ${c}`);
};
for (const s of m.shelters) checkCell('shelter', s.id, s.x, s.y, s.cell);
for (const s of m.stations) checkCell('station', s.id, s.x, s.y, s.cell);
for (const i of m.images) {
  checkCell('image', i.id, i.x, i.y, i.cell);
  if (!existsSync(join(root, i.file))) errors.push(`image file missing ${i.file}`);
}
const ids = new Set(m.images.map((i) => i.id));
for (const s of m.stations) for (const im of s.imageIds ?? []) if (!ids.has(im)) errors.push(`station ${s.id} → unknown image ${im}`);

// Plume keep-outs must not cover any shelter
for (const k of m.keepouts) {
  const ring = k.rings[0];
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (const s of m.shelters) if (inside(s.x, s.y)) errors.push(`keep-out ${k.id} covers shelter ${s.id}`);
}
console.log(
  `FEATURES: ${m.shelters.length} shelters, ${m.keepouts.length} keep-outs, ${m.stations.length} stations, ` +
    `${m.landmarks.length} landmarks, ${m.images.length} images, traverse ${m.traverse ? m.traverse.lines.reduce((a, l) => a + l.length, 0) + ' pts' : 'none'}, ` +
    `rems ${m.conditions.rems?.length ?? 0}, spaceWeather ${m.conditions.spaceWeather?.length ?? 0}`,
);
for (const w of warn) console.log(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  process.exit(1);
}
console.log('VALID');
