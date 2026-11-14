import { cellOf, cellToXY, eqcForward } from '../grid';
import { hornSlopeDeg, mulberry32, surfaceNormals, type LoadedSitePack } from '../sitepack';
import type { GridSpec, KeepOut, Landmark, RasterLayer, Shelter, SitePackManifest, Station } from '../types';

/**
 * Synthetic Gale-like terrain for development and tests (no real data needed).
 * Features: regional ramp rising to the south (Mount Sharp), Gaussian buttes, a narrow notch
 * through a ridge, sand patches (low thermal inertia), fractal-ish noise. Deterministic per seed.
 */
export function mockSitePack(seed = 412, size = 600, cellM = 5): LoadedSitePack {
  const w = size, h = size;
  const rnd = mulberry32(seed);
  const lon0 = 137.4, latTs = -4.7;
  const [cx, cy] = eqcForward(137.39, -4.83, lon0, latTs);
  const grid: GridSpec = {
    w,
    h,
    cellM,
    proj4: `+proj=eqc +lat_ts=${latTs} +lat_0=0 +lon_0=${lon0} +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs`,
    originX: cx - (w * cellM) / 2,
    originY: cy + (h * cellM) / 2,
    centerLonLat: [137.39, -4.83],
  };

  const dem = new Float32Array(w * h);
  // value noise octaves
  const octave = (freq: number, amp: number) => {
    const gw = Math.ceil(w / freq) + 2;
    const lattice = new Float32Array(gw * gw).map(() => rnd() * 2 - 1);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const fx = c / freq, fy = r / freq;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const v00 = lattice[y0 * gw + x0], v10 = lattice[y0 * gw + x0 + 1];
        const v01 = lattice[(y0 + 1) * gw + x0], v11 = lattice[(y0 + 1) * gw + x0 + 1];
        dem[r * w + c] += amp * ((v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy);
      }
    }
  };
  octave(120, 6);
  octave(40, 2.5);
  octave(12, 0.8);
  octave(4, 0.25);

  const base = -4400;
  const buttes: [number, number, number, number][] = []; // row, col, height, sigma(cells)
  for (let i = 0; i < 7; i++) {
    buttes.push([60 + rnd() * (h - 120), 60 + rnd() * (w - 120), 25 + rnd() * 45, 10 + rnd() * 18]);
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let z = base + (r / h) * 120; // rises to the south
      for (const [br, bc, bh, bs] of buttes) {
        const d2 = ((r - br) ** 2 + (c - bc) ** 2) / (2 * bs * bs);
        z += bh * Math.exp(-d2 * d2 * 0.6); // flat-topped mesa-like
      }
      // E-W ridge at 62% height with a narrow notch at 40% width
      const ridgeRow = h * 0.62;
      const ridge = 40 * Math.exp(-((r - ridgeRow) ** 2) / (2 * 6 ** 2));
      const notch = 1 - Math.exp(-((c - w * 0.4) ** 2) / (2 * 5 ** 2));
      z += ridge * notch;
      dem[r * w + c] += z;
    }
  }

  const slope = hornSlopeDeg(dem, w, h, cellM);
  const rough = new Float32Array(w * h);
  const ti = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    rough[i] = Math.min(2, 0.05 + slope[i] / 25 + rnd() * 0.05);
    ti[i] = 380;
  }
  // sand patches (low TI)
  for (let k = 0; k < 5; k++) {
    const pr = rnd() * h, pc = rnd() * w, ps = 15 + rnd() * 25;
    for (let r = Math.max(0, Math.floor(pr - 3 * ps)); r < Math.min(h, pr + 3 * ps); r++) {
      for (let c = Math.max(0, Math.floor(pc - 3 * ps)); c < Math.min(w, pc + 3 * ps); c++) {
        const d = Math.hypot(r - pr, c - pc) / ps;
        if (d < 1) ti[r * w + c] = 80 + d * 120;
      }
    }
  }
  const normals = surfaceNormals(dem, w, h, cellM);

  const prov = {
    mission: 'Synthetic',
    instrument: 'mockSitePack',
    product: `mock-${seed}`,
    url: 'about:mock',
    license: 'Apache-2.0',
    citation: 'Synthetic terrain for development only — not real Mars data.',
    resolutionM: cellM,
  };
  const layer = (id: string, label: string, unit: string, kind: RasterLayer['kind'] = 'continuous', bands = 1): RasterLayer => ({
    id, label, kind, file: `${id}.bin`, dtype: 'f32', bands, scale: 1, offset: 0, unit, provenance: [prov],
  });

  const habRC: [number, number] = [Math.floor(h * 0.3), Math.floor(w * 0.5)];
  const hab = cellOf(grid, habRC[0], habRC[1]);
  const rover = cellOf(grid, Math.floor(h * 0.48), Math.floor(w * 0.3));
  const shelterAt = (id: string, kind: Shelter['kind'], name: string, cell: number, movable: boolean): Shelter => {
    const [x, y] = cellToXY(grid, cell);
    return { id, kind, name, x, y, cell, movable };
  };
  const shelters = [
    shelterAt('HAB', 'hab', 'Habitat', hab, false),
    shelterAt('ROVER1', 'rover', 'Pressurized rover', rover, true),
  ];

  const names = ['Boxwork ridge A', 'Sulfate contact', 'Butte flank', 'Vein field', 'Dark sand edge', 'Ridge notch', 'Layered outcrop', 'Float rock cluster', 'Upper bench', 'Fracture halo'];
  const stations: Station[] = names.map((name, i) => {
    let r = 0, c = 0, tries = 0;
    do {
      r = Math.floor(h * 0.15 + rnd() * h * 0.7);
      c = Math.floor(w * 0.15 + rnd() * w * 0.7);
      tries++;
    } while (slope[r * w + c] > 12 && tries < 50);
    const cell = cellOf(grid, r, c);
    const [x, y] = cellToXY(grid, cell);
    return {
      id: `ST${String(i + 1).padStart(2, '0')}`,
      name,
      x, y, cell,
      value: Math.round(30 + rnd() * 70),
      objectiveIds: [`OBJ-${1 + (i % 4)}`],
      dwellMin: 15 + Math.round(rnd() * 3) * 5,
      description: `Mock station: ${name}.`,
    };
  });

  const [padX, padY] = cellToXY(grid, cellOf(grid, Math.floor(h * 0.08), Math.floor(w * 0.85)));
  const ring = (cxm: number, cym: number, rm: number): [number, number][] =>
    Array.from({ length: 33 }, (_, k) => {
      const a = (k / 32) * Math.PI * 2;
      return [cxm + rm * Math.cos(a), cym + rm * Math.sin(a)] as [number, number];
    });
  const keepouts: KeepOut[] = [
    { id: 'PLUME', kind: 'plume', label: 'Lander plume-ejecta zone', rings: [ring(padX, padY, 400)], citation: 'Hoffman et al. 2016 (NTRS 20160002370) — scaled for mock grid' },
  ];

  const landmarks: Landmark[] = buttes.slice(0, 4).map(([br, bc, bh], i) => {
    const [x, y] = cellToXY(grid, cellOf(grid, Math.floor(br), Math.floor(bc)));
    return { id: `LM${i + 1}`, name: `Butte ${String.fromCharCode(65 + i)}`, x, y, elevM: base + bh, informal: true };
  });

  const manifest: SitePackManifest = {
    schema: 'sitepack/1',
    id: `mock-${seed}`,
    name: 'Mock Gale (synthetic)',
    body: 'mars',
    createdUtc: '2026-11-14T00:00:00Z',
    grid,
    rasters: {
      dem: layer('dem', 'Elevation', 'm'),
      slope: layer('slope', 'Slope', 'deg'),
      rough: layer('rough', 'Roughness', 'm'),
      ti: { ...layer('ti', 'Thermal inertia', 'J m⁻² K⁻¹ s⁻½'), indicative: true },
      normals: layer('normals', 'Surface normals', '', 'vector2', 2),
    },
    imagery: [],
    stations,
    landmarks,
    shelters,
    keepouts,
    images: [],
    conditions: { fetchedUtc: '2026-11-14T00:00:00Z' },
    scenario: { sol: 412, startLtstMin: 9 * 60 + 40, label: 'Sol 412 — 09:40 LTST' },
    files: {},
  };

  return { manifest, rasters: { dem, slope, rough, ti, normals }, base: 'mock://' };
}
