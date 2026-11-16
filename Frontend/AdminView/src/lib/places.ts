import type { Cell, LoadedSitePack } from '@mw/shared/contracts';
import { cellToXY, gridExtent, xyToCell } from '@mw/shared/contracts';
import { toLonLat } from '@mw/shared/map';
import gazetteer from '../../../../Content/gazetteer.json';
import type { ConsoleState } from '../store';
import { zoneLimits } from './zone';

/** Inverse of the site pack's equirectangular projection (linear in lon/lat over the AOI). */
export function lonLatToXY(pack: LoadedSitePack, lon: number, lat: number): [number, number] {
  const g = pack.manifest.grid;
  const e = gridExtent(g);
  const a = toLonLat(g, e[0], e[1]);
  const b = toLonLat(g, e[2], e[3]);
  return [e[0] + ((lon - a[0]) / (b[0] - a[0])) * (e[2] - e[0]), e[1] + ((lat - a[1]) / (b[1] - a[1])) * (e[3] - e[1])];
}

export interface Landmark {
  name: string;
  cell: Cell;
  note: string;
}

/** Gazetteer features that fall inside the map and are not already a science target. */
export function landmarksIn(pack: LoadedSitePack): Landmark[] {
  const g = pack.manifest.grid;
  const out: Landmark[] = [];
  const feats = (gazetteer as { features: { name: string; type: string; lon: number; lat: number }[] }).features;
  for (const f of feats) {
    const [x, y] = lonLatToXY(pack, f.lon, f.lat);
    const cell = xyToCell(g, x, y);
    if (cell < 0) continue;
    const near = pack.manifest.stations.some((s) => Math.hypot(s.x - x, s.y - y) < 45);
    if (near || /informal name|^Curiosity/.test(f.name)) continue;
    out.push({ name: f.name.replace(/\s*\(.*$/, ''), cell, note: f.type.replace(/\s*\(.*$/, '') });
  }
  return out;
}

export interface CellPreview {
  lon: number;
  lat: number;
  elevM: number;
  slopeDeg: number;
  minutes: number | null;
  ok: boolean;
  reason: string | null;
}

/** Quick safety preview from the fields the console already holds (no re-plan). */
export function previewCell(s: ConsoleState, cell: Cell): CellPreview | null {
  const pack = s.pack;
  if (!pack) return null;
  const g = pack.manifest.grid;
  const [x, y] = cellToXY(g, cell);
  const [lon, lat] = toLonLat(g, x, y);
  const slope = pack.rasters.slope[cell];
  const elev = pack.rasters.dem[cell];
  const z = s.zone;
  const lim = zoneLimits(s.rules, s.events);
  const out = s.fields?.outboundMin[cell];
  let reason: string | null = null;
  if (slope > lim.slopeMax) reason = `too steep (${Math.round(slope)}°)`;
  else if (z && z.keepout[cell]) reason = 'inside a keep-out zone';
  else if (z && z.blocked[cell]) reason = 'blocked terrain';
  else if (s.fields && !Number.isFinite(out)) reason = 'no safe path from the start';
  else if (z && z.shelter[cell] > lim.shelterMax) reason = 'too far from a shelter';
  else if (z && z.walkbackTotal[cell] > lim.walkbackMax) reason = 'too far to get back in time';
  else if (z && z.distHab[cell] > lim.radiusMax) reason = 'beyond the walk radius';
  else if (z && z.losGap[cell] > lim.losGapMax) reason = 'out of radio contact for too long';
  return { lon, lat, elevM: elev, slopeDeg: slope, minutes: out !== undefined && Number.isFinite(out) ? out : null, ok: !reason, reason };
}
