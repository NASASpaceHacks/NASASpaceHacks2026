import type { RasterLayer, SitePackManifest } from './types';

/** A site pack with its engine rasters decoded into physical units. */
export interface LoadedSitePack {
  manifest: SitePackManifest;
  /** Physical-unit rasters keyed by layer id (length w*h, or 2*w*h for 2-band 'normals', band-interleaved by pixel). */
  rasters: Record<string, Float32Array>;
  /** Base URL/path the pack was loaded from (for imagery files). */
  base: string;
}

const CTORS = {
  u8: Uint8Array,
  u16: Uint16Array,
  i16: Int16Array,
  f32: Float32Array,
} as const;

/** Decode a little-endian raw raster into physical units (raw*scale+offset). Nodata → NaN. */
export function decodeRaster(buf: ArrayBuffer, layer: RasterLayer): Float32Array {
  const C = CTORS[layer.dtype];
  const raw = new C(buf);
  const out = new Float32Array(raw.length);
  const { scale, offset, nodata } = layer;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    out[i] = nodata !== undefined && v === nodata ? NaN : v * scale + offset;
  }
  return out;
}

/** Encode physical values into the layer's raw dtype (inverse of decodeRaster). NaN → nodata. */
export function encodeRaster(values: Float32Array, layer: RasterLayer): ArrayBuffer {
  const C = CTORS[layer.dtype];
  const raw = new C(values.length);
  const { scale, offset, nodata } = layer;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    raw[i] = Number.isNaN(v) ? (nodata ?? 0) : Math.round((v - offset) / scale);
  }
  return raw.buffer as ArrayBuffer;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>;

/**
 * Load a site pack over HTTP (browser, or Node with global fetch against the hab server).
 * `base` is the pack root URL, e.g. '/sitepacks/gale-v1'.
 */
export async function loadSitePack(base: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<LoadedSitePack> {
  const root = base.replace(/\/$/, '');
  const res = await fetchFn(`${root}/manifest.json`);
  if (!res.ok) throw new Error(`site pack manifest ${res.status}`);
  const manifest = (await res.json()) as SitePackManifest;
  const rasters: Record<string, Float32Array> = {};
  await Promise.all(
    Object.values(manifest.rasters).map(async (layer) => {
      const r = await fetchFn(`${root}/${layer.file}`);
      if (!r.ok) throw new Error(`raster ${layer.id} ${r.status}`);
      rasters[layer.id] = decodeRaster(await r.arrayBuffer(), layer);
    }),
  );
  return { manifest, rasters, base: root };
}

/** Horn (1981) slope in degrees from a DEM. Edge cells use clamped neighbours. NaN-safe (NaN → NaN). */
export function hornSlopeDeg(dem: Float32Array, w: number, h: number, cellM: number): Float32Array {
  const out = new Float32Array(w * h);
  const at = (r: number, c: number) => dem[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const a = at(r - 1, c - 1), b = at(r - 1, c), cc = at(r - 1, c + 1);
      const d = at(r, c - 1), f = at(r, c + 1);
      const g = at(r + 1, c - 1), hh = at(r + 1, c), i = at(r + 1, c + 1);
      const dzdx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * cellM);
      const dzdy = (g + 2 * hh + i - (a + 2 * b + cc)) / (8 * cellM);
      out[r * w + c] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return out;
}

/** Surface normal (nx, ny) components, band-interleaved by pixel, for GPU hillshade. nz = sqrt(1-nx²-ny²). */
export function surfaceNormals(dem: Float32Array, w: number, h: number, cellM: number): Float32Array {
  const out = new Float32Array(2 * w * h);
  const at = (r: number, c: number) => dem[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const dzdx = (at(r, c + 1) - at(r, c - 1)) / (2 * cellM);
      const dzdyNorth = (at(r - 1, c) - at(r + 1, c)) / (2 * cellM); // +y = north
      const nx = -dzdx, ny = -dzdyNorth, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      out[2 * (r * w + c)] = nx / len;
      out[2 * (r * w + c) + 1] = ny / len;
    }
  }
  return out;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
