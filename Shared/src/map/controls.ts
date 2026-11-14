import type OlMap from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import ScaleLine from 'ol/control/ScaleLine';
import { unByKey } from 'ol/Observable';
import type { GridSpec } from '../contracts/types';
import { xyToCell } from '../contracts/grid';
import { getPointResolution } from 'ol/proj';
import { toLonLat } from './projection';
import { formatDistance, niceScaleBar } from './scale';

/**
 * Mars-correct scale bar. Correct because the map's projection comes from
 * `registerMarsProjection`, whose `getPointResolution` returns true Mars metres (OpenLayers'
 * default would measure on the Earth sphere and be ~1.88× too long).
 */
export function createMarsScaleLine(opts: { target?: HTMLElement; minWidth?: number; className?: string } = {}): ScaleLine {
  return new ScaleLine({
    units: 'metric',
    bar: true,
    steps: 4,
    text: false,
    minWidth: opts.minWidth ?? 110,
    target: opts.target,
    className: opts.className ?? 'ol-scale-bar mw-scale',
  });
}

/**
 * Lightweight Mars-correct scale bar rendered into `el` (fully styleable, 4 alternating
 * segments). Length = niceScaleBar(getPointResolution(...)) — true Mars metres with a
 * projection from `registerMarsProjection`. Returns an unsubscribe function.
 */
export function attachScaleBar(map: OlMap, el: HTMLElement, minWidthPx = 110): () => void {
  const view = map.getView();
  const render = () => {
    const res = view.getResolution();
    const center = view.getCenter();
    if (!res || !center) return;
    const r = getPointResolution(view.getProjection(), res, center, 'm');
    const bar = niceScaleBar(r, minWidthPx);
    const seg = bar.widthPx / 4;
    const cells = [0, 1, 2, 3]
      .map((i) => `<span style="position:absolute;left:${(i * seg).toFixed(1)}px;width:${seg.toFixed(1)}px;top:0;bottom:0;${i % 2 ? '' : 'background:currentColor;'}"></span>`)
      .join('');
    el.innerHTML =
      `<div class="mw-sb-bar" style="position:relative;width:${bar.widthPx.toFixed(1)}px;height:4px;border:1px solid currentColor;box-sizing:border-box">${cells}</div>` +
      `<div class="mw-sb-labels" style="position:relative;width:${bar.widthPx.toFixed(1)}px;height:12px;margin-top:3px">` +
      `<span style="position:absolute;left:0">0</span>` +
      `<span style="position:absolute;left:50%;transform:translateX(-50%)">${formatDistance(bar.metres / 2)}</span>` +
      `<span style="position:absolute;right:0;transform:translateX(50%)">${bar.label}</span></div>`;
  };
  render();
  const k1 = view.on('change:resolution', render);
  const k2 = map.on('moveend', render);
  return () => {
    unByKey(k1);
    unByKey(k2);
  };
}

export interface CursorReadout {
  x: number;
  y: number;
  /** Planetocentric longitude (°E). */
  lon: number;
  /** Planetocentric latitude (°N). */
  lat: number;
  cell: number;
  /** Elevation (m, Mars 2000 areoid-referenced as in the site pack DEM). */
  elevM: number;
  slopeDeg: number;
}

/**
 * Cursor readout: planetocentric °E/°N via the exact eqc inverse, plus DEM elevation and slope
 * at the hovered engine cell. Calls `cb(null)` when the pointer leaves the map or the AOI.
 * Returns an unsubscribe function.
 */
export function attachCursorReadout(
  map: OlMap,
  grid: GridSpec,
  rasters: { dem?: Float32Array; slope?: Float32Array },
  cb: (r: CursorReadout | null) => void,
): () => void {
  const key = map.on('pointermove', (e: MapBrowserEvent) => {
    if (e.dragging) return;
    const [x, y] = e.coordinate;
    const cell = xyToCell(grid, x, y);
    if (cell < 0) {
      cb(null);
      return;
    }
    const [lon, lat] = toLonLat(grid, x, y);
    cb({ x, y, lon, lat, cell, elevM: rasters.dem?.[cell] ?? NaN, slopeDeg: rasters.slope?.[cell] ?? NaN });
  });
  const vp = map.getViewport();
  const leave = () => cb(null);
  vp?.addEventListener('mouseleave', leave);
  return () => {
    unByKey(key);
    vp?.removeEventListener('mouseleave', leave);
  };
}

/** Format planetocentric coordinates the way MSL/HiRISE products do (°E, °N, east-positive). */
export function formatLonLat(lon: number, lat: number, digits = 5): string {
  return `${lat.toFixed(digits)}°N  ${lon.toFixed(digits)}°E`;
}
