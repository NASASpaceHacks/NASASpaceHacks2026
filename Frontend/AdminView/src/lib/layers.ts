import type { LoadedSitePack } from '@mw/shared/contracts';

const demCache = new WeakMap<LoadedSitePack, [number, number]>();

/** Elevation legend range (2nd–98th percentile of the DEM, rounded to 10 m), so a few spikes don't wash out the ramp. */
export function demRange(pack: LoadedSitePack): [number, number] {
  const hit = demCache.get(pack);
  if (hit) return hit;
  const d = pack.rasters.dem;
  const v: number[] = [];
  for (let i = 0; i < d.length; i += 53) if (Number.isFinite(d[i])) v.push(d[i]);
  v.sort((a, b) => a - b);
  const lo = v.length ? Math.floor(v[Math.floor(v.length * 0.02)] / 10) * 10 : 0;
  const hi = v.length ? Math.ceil(v[Math.floor(v.length * 0.98)] / 10) * 10 : 1;
  const r: [number, number] = [lo, hi > lo ? hi : lo + 1];
  demCache.set(pack, r);
  return r;
}
