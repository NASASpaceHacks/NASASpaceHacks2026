import type { Pt } from './types';

export interface Meta {
  site: string;
  bounds: { west: number; east: number; south: number; north: number };
  size_m: number;
  ground_dx_factor: number;
  grid: { n: number; cell_m: number };
  images: Record<string, { file: string; px_m?: number; native_px_m?: number; bounds?: Meta['bounds'] }>;
  elevation_range_m: [number, number];
  rover_dtm_minus_geoid_m: { median: number; max_abs: number };
  sources: { layer: string; evidence: string; mission: string; product?: string; url?: string; doi?: string; note: string }[];
  generated_utc: string;
}

export interface RoverStop {
  sol: number; rmc: string; lon: number; lat: number; elev_geoid: number; note: string; yaw: number;
  pov: { file: string; camera: string; source: string; imageid: string } | null;
}

export interface CrismFootprint { id: string; time: string; rings: [number, number][][]; label: string | null }

export interface Area {
  meta: Meta;
  n: number;
  cellM: number;
  /** Ground metres per cell east-west / north-south. */
  dxM: number;
  dyM: number;
  elev: Float32Array;
  slope: Float32Array;   // deg
  rough: Float32Array;   // cm
  thermal: Float32Array; // 0..1 relative night-IR brightness, resampled to grid
  images: { optical: HTMLImageElement; hillshade: HTMLImageElement; thermal: HTMLImageElement };
  rover: { stops: (RoverStop & Pt)[]; traverse: { sol: number; pts: Pt[] }[] };
  crism: (CrismFootprint & { pts: Pt[][] })[];
  base: string; // URL prefix for data files
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Failed to load ' + src));
    im.src = src;
  });
}

let cached: Promise<Area> | null = null;

/** Everything ships as static files, so both views work with no network beyond the local host. */
export function loadArea(base = '../data/'): Promise<Area> {
  if (cached) return cached;
  cached = (async () => {
    const [meta, buf, rover, crism] = await Promise.all([
      fetch(base + 'meta.json').then((r) => r.json() as Promise<Meta>),
      fetch(base + 'terrain.bin').then((r) => r.arrayBuffer()),
      fetch(base + 'rover.json').then((r) => r.json()),
      fetch(base + 'crism.json').then((r) => r.json() as Promise<CrismFootprint[]>),
    ]);
    const n = meta.grid.n;
    const nn = n * n;
    const elev = new Float32Array(buf, 0, nn);
    const s8 = new Uint8Array(buf, nn * 4, nn);
    const r8 = new Uint8Array(buf, nn * 5, nn);
    const slope = new Float32Array(nn);
    const rough = new Float32Array(nn);
    for (let i = 0; i < nn; i++) { slope[i] = s8[i] / 4; rough[i] = r8[i]; }
    const [optical, hillshade, thermalImg] = await Promise.all(
      ['optical', 'hillshade', 'thermal'].map((k) => loadImage(base + meta.images[k].file)),
    );
    const thermal = sampleImage(thermalImg, n);
    const area: Area = {
      meta, n, cellM: meta.grid.cell_m,
      dxM: meta.grid.cell_m * meta.ground_dx_factor, dyM: meta.grid.cell_m,
      elev, slope, rough, thermal,
      images: { optical, hillshade, thermal: thermalImg },
      rover: { stops: [], traverse: [] }, crism: [], base,
    };
    area.rover.stops = rover.stops.map((s: RoverStop) => ({ ...s, ...lonLatToGrid(area, s.lon, s.lat) }));
    area.rover.traverse = rover.traverse.map((t: { sol: number; coords: number[][] }) => ({
      sol: t.sol, pts: t.coords.map((c) => lonLatToGrid(area, c[0], c[1])),
    }));
    area.crism = crism.map((c) => ({ ...c, pts: c.rings.map((r) => r.map(([lo, la]) => lonLatToGrid(area, lo, la))) }));
    return area;
  })();
  return cached;
}

function sampleImage(im: HTMLImageElement, n: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data;
  const out = new Float32Array(n * n);
  let lo = 255, hi = 0;
  for (let i = 0; i < n * n; i++) { const v = d[i * 4]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < n * n; i++) out[i] = (d[i * 4] - lo) / Math.max(1, hi - lo);
  return out;
}

// --- coordinates (equirectangular sphere: x = R*lon, y = R*lat, latitude of true scale 0)
export function lonLatToGrid(a: Area, lon: number, lat: number): Pt {
  const b = a.meta.bounds;
  return { x: ((lon - b.west) / (b.east - b.west)) * a.n, y: ((b.north - lat) / (b.north - b.south)) * a.n };
}

export function gridToLonLat(a: Area, p: Pt): [number, number] {
  const b = a.meta.bounds;
  return [b.west + (p.x / a.n) * (b.east - b.west), b.north - (p.y / a.n) * (b.north - b.south)];
}

export const idx = (a: Area, x: number, y: number) => Math.floor(y) * a.n + Math.floor(x);
export const cellPt = (a: Area, i: number): Pt => ({ x: (i % a.n) + 0.5, y: Math.floor(i / a.n) + 0.5 });
export const inside = (a: Area, p: Pt) => p.x >= 0 && p.y >= 0 && p.x < a.n && p.y < a.n;

/** Ground distance in metres between two grid points. */
export function distM(a: Area, p: Pt, q: Pt): number {
  return Math.hypot((q.x - p.x) * a.dxM, (q.y - p.y) * a.dyM);
}

/** True bearing (deg, 0 = north, clockwise) from p to q. */
export function bearing(a: Area, p: Pt, q: Pt): number {
  const b = (Math.atan2((q.x - p.x) * a.dxM, -(q.y - p.y) * a.dyM) * 180) / Math.PI;
  return (b + 360) % 360;
}

export function sampleBilinear(a: Area, f: Float32Array, p: Pt): number {
  const x = Math.min(Math.max(p.x - 0.5, 0), a.n - 1.001);
  const y = Math.min(Math.max(p.y - 0.5, 0), a.n - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const i = y0 * a.n + x0;
  return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + a.n] * (1 - tx) + f[i + a.n + 1] * tx) * ty;
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inPoly = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inPoly = !inPoly;
  }
  return inPoly;
}

export function distToSegment(p: Pt, a: Pt, b: Pt, ar: Area): number {
  const ax = a.x * ar.dxM, ay = a.y * ar.dyM, bx = b.x * ar.dxM, by = b.y * ar.dyM, px = p.x * ar.dxM, py = p.y * ar.dyM;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function fmtLonLat(a: Area, p: Pt): string {
  const [lo, la] = gridToLonLat(a, p);
  return `${la.toFixed(5)}°N ${lo.toFixed(5)}°E`;
}

export function fmtDur(s: number): string {
  if (!isFinite(s)) return '—';
  const neg = s < 0; s = Math.abs(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (neg ? '-' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`);
}
