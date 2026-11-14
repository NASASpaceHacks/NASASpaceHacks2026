import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  SitePackManifestSchema,
  decodeRaster,
  encodeRaster,
  mockSitePack,
  type LoadedSitePack,
  type SitePackManifest,
} from '@mw/shared/contracts';

const BYTES = { u8: 1, u16: 2, i16: 2, f32: 4 } as const;

export interface PackSource {
  pack: LoadedSitePack;
  id: string;
  source: 'disk' | 'mock';
  /** SITEPACK that was asked for. */
  requested: string;
  /** Directory on disk (disk packs). */
  dir?: string;
  /** Why we fell back to the mock. */
  reason?: string;
  warnings: string[];
  /** In-memory files for the mock pack (manifest.json + *.bin), served like a disk pack. */
  memFiles?: Map<string, Uint8Array>;
}

export async function loadPackFromDir(dir: string): Promise<{ pack: LoadedSitePack; warnings: string[] }> {
  const warnings: string[] = [];
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as unknown;
  const v = SitePackManifestSchema.safeParse(raw);
  if (!v.success) {
    for (const i of v.error.issues.slice(0, 5)) warnings.push(`manifest: ${i.path.join('.')} ${i.message}`);
  }
  const manifest = raw as SitePackManifest;
  if (!manifest?.grid?.w || !manifest.grid.h || !manifest.rasters) throw new Error('manifest has no grid/rasters');
  const n = manifest.grid.w * manifest.grid.h;
  const rasters: Record<string, Float32Array> = {};
  for (const layer of Object.values(manifest.rasters)) {
    const required = layer.id === 'dem' || layer.id === 'slope';
    try {
      const buf = await readFile(join(dir, layer.file));
      const want = n * (layer.bands || 1) * BYTES[layer.dtype];
      if (buf.byteLength !== want) throw new Error(`${layer.file}: ${buf.byteLength} B, expected ${want} B`);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      rasters[layer.id] = decodeRaster(ab, layer);
    } catch (e) {
      if (required) throw e;
      warnings.push(`raster ${layer.id} skipped: ${(e as Error).message}`);
    }
  }
  return { pack: { manifest, rasters, base: dir }, warnings };
}

/** Synthetic pack + in-memory files so the frontends can load it exactly like a disk pack. */
export function buildMockPack(requested: string, reason: string): PackSource {
  const pack = mockSitePack(412, 600);
  const memFiles = new Map<string, Uint8Array>();
  const files: Record<string, string> = {};
  for (const layer of Object.values(pack.manifest.rasters)) {
    const bytes = new Uint8Array(encodeRaster(pack.rasters[layer.id], layer));
    memFiles.set(layer.file, bytes);
    files[layer.file] = createHash('sha256').update(bytes).digest('hex');
  }
  pack.manifest = { ...pack.manifest, files };
  memFiles.set('manifest.json', new TextEncoder().encode(JSON.stringify(pack.manifest, null, 2)));
  return { pack, id: pack.manifest.id, source: 'mock', requested, reason, warnings: [], memFiles };
}

export async function loadSitePackSource(sitePacksDir: string, requested: string): Promise<PackSource> {
  const dir = join(sitePacksDir, requested);
  if (!existsSync(join(dir, 'manifest.json'))) {
    return buildMockPack(requested, `SitePacks/${requested}/manifest.json not found`);
  }
  try {
    const { pack, warnings } = await loadPackFromDir(dir);
    return { pack, id: pack.manifest.id || requested, source: 'disk', requested, dir, warnings };
  } catch (e) {
    return buildMockPack(requested, `SitePacks/${requested} failed to load: ${(e as Error).message}`);
  }
}

export async function listSitePacks(sitePacksDir: string, active: PackSource): Promise<{ id: string; name: string; source: 'disk' | 'mock' }[]> {
  const out: { id: string; name: string; source: 'disk' | 'mock' }[] = [];
  try {
    for (const ent of await readdir(sitePacksDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      try {
        const m = JSON.parse(await readFile(join(sitePacksDir, ent.name, 'manifest.json'), 'utf8')) as { name?: string };
        out.push({ id: ent.name, name: m.name ?? ent.name, source: 'disk' });
      } catch {
        /* not a pack */
      }
    }
  } catch {
    /* no SitePacks dir */
  }
  if (active.source === 'mock') out.unshift({ id: active.id, name: active.pack.manifest.name, source: 'mock' });
  return out;
}
