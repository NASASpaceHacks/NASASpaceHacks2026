// Raster layers rendered once to offscreen canvases (grid resolution) and drawn by MapView.
import type { Area } from './data';

export type LayerId = 'optical' | 'hillshade' | 'elevation' | 'slope' | 'rough' | 'thermal' | 'excluded' | 'science' | 'crism' | 'rover';

export interface LayerDef { id: LayerId; label: string; group: 'Optical' | 'Topographic' | 'Thermal' | 'Spectral' | 'Hazard' | 'Context'; mission: string; evidence: 'M' | 'D' }

export const LAYERS: LayerDef[] = [
  { id: 'optical', label: 'HiRISE orthoimage 50 cm', group: 'Optical', mission: 'MRO HiRISE', evidence: 'M' },
  { id: 'hillshade', label: 'Hillshade', group: 'Topographic', mission: 'MRO HiRISE DTM', evidence: 'D' },
  { id: 'elevation', label: 'Elevation tint', group: 'Topographic', mission: 'MRO HiRISE DTM', evidence: 'M' },
  { id: 'slope', label: 'Slope', group: 'Hazard', mission: 'derived, HiRISE DTM', evidence: 'D' },
  { id: 'rough', label: 'Roughness (5 m detrended)', group: 'Hazard', mission: 'derived, HiRISE DTM', evidence: 'D' },
  { id: 'excluded', label: 'Excluded terrain (hard limits)', group: 'Hazard', mission: 'derived', evidence: 'D' },
  { id: 'thermal', label: 'Night IR (thermal inertia proxy)', group: 'Thermal', mission: 'Mars Odyssey THEMIS', evidence: 'M' },
  { id: 'crism', label: 'CRISM observation footprints', group: 'Spectral', mission: 'MRO CRISM via PDS ODE', evidence: 'M' },
  { id: 'science', label: 'Science pull field', group: 'Spectral', mission: 'derived from stops', evidence: 'D' },
  { id: 'rover', label: 'Perseverance traverse & stops', group: 'Context', mission: 'Mars 2020', evidence: 'M' },
];

type RGB = [number, number, number];
function ramp(stops: RGB[], t: number): RGB {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Sequential, single-hue ramps (light -> dark).
export const RAMPS: Record<string, RGB[]> = {
  elevation: [[253, 240, 222], [226, 170, 110], [150, 85, 40], [70, 35, 15]],
  slope: [[255, 247, 224], [250, 200, 110], [228, 120, 40], [160, 40, 20]],
  rough: [[245, 238, 255], [196, 170, 240], [130, 90, 210], [70, 30, 140]],
  thermal: [[20, 30, 70], [40, 90, 170], [120, 180, 230], [235, 245, 255]],
};

export function gridCanvas(a: Area, fn: (i: number) => [number, number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = a.n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(a.n, a.n);
  for (let i = 0; i < a.n * a.n; i++) {
    const [r, gg, b, al] = fn(i);
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = al;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function renderRaster(a: Area, id: LayerId, opts: { maxSlope: number; maxRough: number; blocked?: Uint8Array; science?: Float32Array }): HTMLCanvasElement | HTMLImageElement | null {
  const [lo, hi] = a.meta.elevation_range_m;
  switch (id) {
    case 'optical': return a.images.optical;
    case 'hillshade': return a.images.hillshade;
    case 'elevation': return gridCanvas(a, (i) => [...ramp(RAMPS.elevation, (a.elev[i] - lo) / (hi - lo)), 255] as never);
    case 'slope': return gridCanvas(a, (i) => [...ramp(RAMPS.slope, a.slope[i] / Math.max(opts.maxSlope * 1.5, 1)), 255] as never);
    case 'rough': return gridCanvas(a, (i) => [...ramp(RAMPS.rough, a.rough[i] / Math.max(opts.maxRough * 1.5, 1)), 255] as never);
    case 'thermal': return gridCanvas(a, (i) => [...ramp(RAMPS.thermal, a.thermal[i]), 255] as never);
    case 'excluded': {
      const b = opts.blocked;
      if (!b) return null;
      // Critical status colour plus a 45-degree stripe texture so exclusion never relies on colour alone.
      return gridCanvas(a, (i) => {
        if (!b[i]) return [0, 0, 0, 0];
        const x = i % a.n, y = Math.floor(i / a.n);
        return (x + y) % 4 < 2 ? [214, 40, 40, 235] : [120, 10, 10, 200];
      });
    }
    case 'science': {
      const s = opts.science;
      if (!s) return null;
      return gridCanvas(a, (i) => [40, 200, 140, Math.round(200 * s[i])]);
    }
    default: return null;
  }
}
