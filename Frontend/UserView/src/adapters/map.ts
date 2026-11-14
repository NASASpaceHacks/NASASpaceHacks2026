/**
 * Map adapter: registers the site's Mars projection (IAU Mars 2000 sphere, R = 3,396,190 m) with
 * proj4 + OpenLayers. Preferred: B5's `registerMarsProjection` from `@mw/shared/map` (also fixes
 * OpenLayers' Earth-sphere point resolution); local proj4 registration as fallback. The visor builds
 * its own heading-up map on top (B5's layer factories target the console's north-up 2D map).
 */
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection } from 'ol/proj';
import type Projection from 'ol/proj/Projection';
import { gridExtent, type GridSpec } from '@mw/shared/contracts';
import { registerMarsProjection as sharedRegister } from '@mw/shared/map';

export const mapImpl: { proj: 'shared' | 'local' } = { proj: 'local' };

function localRegister(grid: GridSpec): Projection {
  let h = 0;
  for (let i = 0; i < grid.proj4.length; i++) h = (Math.imul(h, 31) + grid.proj4.charCodeAt(i)) | 0;
  const code = `MARS-EQC:${(h >>> 0).toString(16)}`;
  if (!proj4.defs(code)) {
    proj4.defs(code, grid.proj4);
    register(proj4);
  }
  const p = getProjection(code);
  if (!p) throw new Error(`projection ${code} not registered`);
  p.setExtent(gridExtent(grid));
  return p;
}

export function registerMarsProjection(grid: GridSpec): Projection {
  try {
    const p = sharedRegister(grid);
    mapImpl.proj = 'shared';
    return p;
  } catch (e) {
    console.warn('[visor] shared map projection unavailable, registering locally', e);
    mapImpl.proj = 'local';
    return localRegister(grid);
  }
}
