import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import type OlMap from 'ol/Map';
import { LineString, MultiLineString, Point, Polygon, MultiPolygon } from 'ol/geom';
import type BaseLayer from 'ol/layer/Base';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import WebGLTileLayer, { type Style as WebGLTileStyle } from 'ol/layer/WebGLTile';
import type Projection from 'ol/proj/Projection';
import DataTileSource from 'ol/source/DataTile';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import TileGrid from 'ol/tilegrid/TileGrid';
import Translate from 'ol/interaction/Translate';
import type { Cell, GridSpec, ImageryLayer, KeepOut, Shelter, SitePackManifest, Station } from '../contracts/types';
import { cellToXY, gridExtent, xyToCell } from '../contracts/grid';
import { type BandSource, type IsoLine, sliceTile } from './fieldData';
import { MAP_COLORS } from './ramps';
import { hillshadeStyle } from './styles';

// ───────────────────────────── Raster (GPU) layers ─────────────────────────────

/** Tile grid matching the engine grid exactly (single native level, top-left origin). */
export function createGridTileGrid(grid: GridSpec, tileSize = 256): TileGrid {
  const extent = gridExtent(grid);
  return new TileGrid({ extent, origin: [extent[0], extent[3]], resolutions: [grid.cellM], tileSize });
}

/**
 * DataTile source serving one or more grid bands straight from typed arrays (no network,
 * no re-encoding). Tiles are interleaved by pixel as OpenLayers expects.
 */
export function createGridSource(
  grid: GridSpec,
  projection: Projection,
  bands: BandSource[],
  opts: { interpolate?: boolean; tileSize?: number } = {},
): DataTileSource {
  const tileSize = opts.tileSize ?? 256;
  return new DataTileSource({
    projection,
    tileGrid: createGridTileGrid(grid, tileSize),
    bandCount: bands.length,
    interpolate: opts.interpolate ?? true,
    wrapX: false,
    transition: 0,
    loader: (_z: number, x: number, y: number) => sliceTile(bands, grid.w, grid.h, x * tileSize, y * tileSize, tileSize, tileSize, 0),
  });
}

/**
 * Generic GPU field layer: WebGLTile + DataTile fed from typed arrays, styled by an expression
 * (see styles.ts). Animate with `layer.updateStyleVariables({...})` — no data re-upload.
 */
export function createFieldLayer(opts: {
  grid: GridSpec;
  projection: Projection;
  bands: BandSource[];
  style: WebGLTileStyle;
  opacity?: number;
  visible?: boolean;
  className?: string;
  interpolate?: boolean;
  zIndex?: number;
}): WebGLTileLayer {
  return new WebGLTileLayer({
    source: createGridSource(opts.grid, opts.projection, opts.bands, { interpolate: opts.interpolate }),
    style: opts.style,
    opacity: opts.opacity ?? 1,
    visible: opts.visible ?? true,
    className: opts.className,
    extent: gridExtent(opts.grid),
    zIndex: opts.zIndex,
    cacheSize: 256,
  });
}

/** Swap the data behind a field layer (e.g. after a replan) keeping its style and variables. */
export function setFieldBands(layer: WebGLTileLayer, grid: GridSpec, projection: Projection, bands: BandSource[], interpolate = true): void {
  layer.setSource(createGridSource(grid, projection, bands, { interpolate }));
}

function finiteRange(a: Float32Array): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (Number.isFinite(x)) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

/**
 * GPU hillshade from the `normals` raster (2 bands, interleaved by pixel). With `dem`, the
 * terrain is tinted by elevation (stand-alone base map); without it, the layer renders grey
 * and is meant to be multiplied over an orthoimage (CSS `mix-blend-mode` on `className`).
 * Re-light with `layer.updateStyleVariables({ sunAzDeg, sunElevDeg })`.
 */
export function createHillshadeLayer(opts: {
  grid: GridSpec;
  projection: Projection;
  normals: Float32Array;
  dem?: Float32Array;
  sunAzDeg: number;
  sunElevDeg: number;
  ambient?: number;
  /** Vertical exaggeration for the shading (display only). */
  zFactor?: number;
  opacity?: number;
  className?: string;
}): WebGLTileLayer {
  const bands: BandSource[] = [
    { data: opts.normals, stride: 2, offset: 0 },
    { data: opts.normals, stride: 2, offset: 1 },
  ];
  let demMin = 0, demMax = 1;
  if (opts.dem) {
    bands.push({ data: opts.dem });
    [demMin, demMax] = finiteRange(opts.dem);
  }
  return createFieldLayer({
    grid: opts.grid,
    projection: opts.projection,
    bands,
    style: hillshadeStyle({ sunAzDeg: opts.sunAzDeg, sunElevDeg: opts.sunElevDeg, ambient: opts.ambient, zFactor: opts.zFactor, tint: !!opts.dem, demMin, demMax }),
    opacity: opts.opacity,
    className: opts.className ?? 'mw-hillshade',
  });
}

/**
 * Display imagery from the site pack: WebP/PNG/JPEG via ImageStatic, or a Cloud-Optimised
 * GeoTIFF streamed by HTTP Range via the GeoTIFF source (loaded lazily to keep bundles small).
 */
export function createImageryLayer(img: ImageryLayer, base: string, projection: Projection): BaseLayer {
  const url = `${base.replace(/\/$/, '')}/${img.file}`;
  if (img.format === 'cog') {
    const layer = new WebGLTileLayer({ extent: img.extent, className: 'mw-imagery' });
    void import('ol/source/GeoTIFF').then(({ default: GeoTIFF }) => {
      layer.setSource(new GeoTIFF({ sources: [{ url }], projection, normalize: true, interpolate: true, wrapX: false }));
    });
    return layer;
  }
  return new ImageLayer({
    className: 'mw-imagery',
    source: new ImageStatic({ url, imageExtent: img.extent, projection, interpolate: true }),
  });
}

/**
 * Fallback when WebGL is unavailable: colourize a grid on a 2D canvas (~10 ms per redraw for 1M
 * cells) and serve it through ImageStatic. `colorAt(i, out)` writes RGBA bytes for cell i.
 */
export function canvasImageSource(
  grid: GridSpec,
  projection: Projection,
  colorAt: (i: number, out: Uint8ClampedArray, o: number) => void,
): ImageStatic {
  const canvas = document.createElement('canvas');
  canvas.width = grid.w;
  canvas.height = grid.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid.w, grid.h);
  const n = grid.w * grid.h;
  for (let i = 0; i < n; i++) colorAt(i, img.data, i * 4);
  ctx.putImageData(img, 0, 0);
  return new ImageStatic({ url: canvas.toDataURL(), imageExtent: gridExtent(grid), projection, interpolate: true });
}

/** Canvas-colourized field layer (WebGL fallback). Replace its data with `layer.setSource(canvasImageSource(...))`. */
export function createCanvasFieldLayer(
  grid: GridSpec,
  projection: Projection,
  colorAt: (i: number, out: Uint8ClampedArray, o: number) => void,
  opts: { opacity?: number; className?: string } = {},
): ImageLayer<ImageStatic> {
  return new ImageLayer({ opacity: opts.opacity ?? 1, className: opts.className, source: canvasImageSource(grid, projection, colorAt) });
}

/** True when the browser can run the WebGL tile layers (float textures). */
export function webglFieldsSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') ?? c.getContext('experimental-webgl');
    return !!gl && !!(gl as WebGLRenderingContext).getExtension('OES_texture_float');
  } catch {
    return false;
  }
}

// ───────────────────────────── Vector layers ─────────────────────────────

export interface MapTheme {
  route: string;
  routeCasing: string;
  safe: string;
  caution: string;
  violation: string;
  label: string;
  halo: string;
  muted: string;
  font: string;
  monoFont: string;
}

export const DEFAULT_THEME: MapTheme = {
  route: MAP_COLORS.amber,
  routeCasing: 'rgba(11,13,16,0.85)',
  safe: MAP_COLORS.cyan,
  caution: MAP_COLORS.amber,
  violation: MAP_COLORS.red,
  label: MAP_COLORS.paper,
  halo: 'rgba(11,13,16,0.9)',
  muted: MAP_COLORS.muted,
  font: '600 11px "DIN Alternate", "Bahnschrift", "Roboto Condensed", system-ui, sans-serif',
  monoFont: '500 10.5px "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace',
};

const halo = (t: MapTheme, width = 3) => new Stroke({ color: t.halo, width });

/** Isochrone contours (d3-contour) as labelled vector lines, e.g. "15 min to shelter". */
export function createContourLayer(theme: MapTheme = DEFAULT_THEME): VectorLayer<VectorSource> {
  const cache = new Map<string, Style[]>();
  return new VectorLayer({
    source: new VectorSource(),
    declutter: 'contours',
    updateWhileAnimating: false,
    style: (f: FeatureLike) => {
      const label = f.get('label') as string;
      const emph = !!f.get('emph');
      const key = `${label}|${emph}`;
      let s = cache.get(key);
      if (!s) {
        const color = (f.get('color') as string) ?? theme.safe;
        s = [
          new Style({ stroke: new Stroke({ color: 'rgba(11,13,16,0.55)', width: emph ? 3.5 : 2.5 }) }),
          new Style({
            stroke: new Stroke({ color, width: emph ? 1.5 : 1, lineDash: emph ? [7, 4] : [3, 3] }),
            text: new Text({
              text: label,
              font: theme.monoFont,
              placement: 'line',
              repeat: 520,
              fill: new Fill({ color }),
              stroke: halo(theme, 3),
              maxAngle: Math.PI / 8,
            }),
          }),
        ];
        cache.set(key, s);
      }
      return s;
    },
  });
}

/** Replace contour features. `label(value)` names each isoline; `emphasize(value)` draws it solid. */
export function setContours(
  layer: VectorLayer<VectorSource>,
  isos: IsoLine[],
  label: (value: number) => string,
  opts: { emphasize?: (value: number) => boolean; color?: (value: number) => string } = {},
): void {
  const src = layer.getSource()!;
  src.clear(true);
  src.addFeatures(
    isos
      .filter((i) => i.lines.length)
      .map((i) => new Feature({
        geometry: new MultiLineString(i.lines),
        label: label(i.value),
        value: i.value,
        emph: opts.emphasize?.(i.value) ?? false,
        color: opts.color?.(i.value),
      })),
  );
}

/** Safe-zone outline polygons (crisp vector edge over the GPU fill). */
export function createOutlineLayer(color: string = MAP_COLORS.cyan): VectorLayer<VectorSource> {
  return new VectorLayer({
    source: new VectorSource(),
    style: [
      new Style({ stroke: new Stroke({ color: 'rgba(11,13,16,0.6)', width: 4 }) }),
      new Style({ stroke: new Stroke({ color, width: 1.6 }) }),
    ],
  });
}

export function setOutline(layer: VectorLayer<VectorSource>, polygons: [number, number][][][]): void {
  const src = layer.getSource()!;
  src.clear(true);
  if (polygons.length) src.addFeature(new Feature(new MultiPolygon(polygons)));
}

/** Route line with casing and direction arrows. Use `setRoute` / `setRouteProgress`. */
export function createRouteLayer(theme: MapTheme = DEFAULT_THEME, arrowSpacingPx = 110): VectorLayer<VectorSource> {
  const casing = new Style({ stroke: new Stroke({ color: theme.routeCasing, width: 7, lineCap: 'round', lineJoin: 'round' }) });
  const main = new Style({ stroke: new Stroke({ color: theme.route, width: 3, lineCap: 'round', lineJoin: 'round' }) });
  return new VectorLayer({
    source: new VectorSource(),
    updateWhileAnimating: true,
    updateWhileInteracting: true,
    style: (f: FeatureLike, resolution: number) => {
      const geom = f.getGeometry() as LineString | undefined;
      if (!geom || geom.getType() !== 'LineString') return [casing, main];
      const styles: Style[] = [casing, main];
      const coords = geom.getCoordinates();
      const spacing = arrowSpacingPx * resolution;
      let acc = spacing * 0.5;
      for (let i = 1; i < coords.length; i++) {
        const [x0, y0] = coords[i - 1], [x1, y1] = coords[i];
        const seg = Math.hypot(x1 - x0, y1 - y0);
        while (acc <= seg && seg > 0) {
          const t = acc / seg;
          styles.push(new Style({
            geometry: new Point([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]),
            image: new RegularShape({
              points: 3,
              radius: 5,
              rotation: Math.PI / 2 - Math.atan2(y1 - y0, x1 - x0),
              rotateWithView: true,
              fill: new Fill({ color: theme.routeCasing }),
              stroke: new Stroke({ color: theme.route, width: 1.25 }),
              declutterMode: 'none',
            }),
          }));
          acc += spacing;
        }
        acc -= seg;
      }
      return styles;
    },
  });
}

/** Route from engine cells → projected coordinates. */
export function routeCoords(grid: GridSpec, cells: ArrayLike<number>): [number, number][] {
  const out: [number, number][] = [];
  let last = -1;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c === last) continue;
    out.push(cellToXY(grid, c));
    last = c;
  }
  return out;
}

export function setRoute(layer: VectorLayer<VectorSource>, coords: [number, number][]): void {
  const src = layer.getSource()!;
  src.clear(true);
  if (coords.length < 2) return;
  const f = new Feature({ geometry: new LineString(coords) });
  f.set('full', coords);
  src.addFeature(f);
}

/** Draw only the first `frac` (0..1, by length) of the route — for the "route draws itself" moment. */
export function setRouteProgress(layer: VectorLayer<VectorSource>, frac: number): void {
  const f = layer.getSource()!.getFeatures()[0];
  if (!f) return;
  const full = f.get('full') as [number, number][];
  let total = 0;
  for (let i = 1; i < full.length; i++) total += Math.hypot(full[i][0] - full[i - 1][0], full[i][1] - full[i - 1][1]);
  const target = Math.max(0, Math.min(1, frac)) * total;
  const out: [number, number][] = [full[0]];
  let acc = 0;
  for (let i = 1; i < full.length; i++) {
    const seg = Math.hypot(full[i][0] - full[i - 1][0], full[i][1] - full[i - 1][1]);
    if (acc + seg >= target) {
      const t = seg ? (target - acc) / seg : 0;
      out.push([full[i - 1][0] + (full[i][0] - full[i - 1][0]) * t, full[i - 1][1] + (full[i][1] - full[i - 1][1]) * t]);
      break;
    }
    out.push(full[i]);
    acc += seg;
  }
  if (out.length === 1) out.push(full[0]);
  (f.getGeometry() as LineString).setCoordinates(out);
}

export type StationState = 'planned' | 'dropped' | 'idle' | 'disabled' | 'visited';

/** Stations: value-scaled symbols, planned order inside, decluttered labels. */
export function createStationsLayer(theme: MapTheme = DEFAULT_THEME): VectorLayer<VectorSource> {
  return new VectorLayer({
    source: new VectorSource(),
    declutter: 'labels',
    zIndex: 20,
    style: (f: FeatureLike) => {
      const value = f.get('value') as number;
      const state = f.get('state') as StationState;
      const order = f.get('order') as number | undefined;
      const r = 5 + (Math.max(0, Math.min(100, value)) / 100) * 6;
      const color =
        state === 'planned' ? theme.route : state === 'visited' ? theme.safe : state === 'dropped' ? theme.violation : theme.muted;
      const filled = state === 'planned' || state === 'visited';
      const symbol = new Style({
        image: new CircleStyle({
          radius: r,
          fill: new Fill({ color: filled ? color : 'rgba(11,13,16,0.75)' }),
          stroke: new Stroke({ color: filled ? theme.routeCasing : color, width: filled ? 2 : 1.5, lineDash: state === 'disabled' ? [2, 2] : undefined }),
          declutterMode: 'obstacle',
        }),
        text:
          order !== undefined && filled
            ? new Text({ text: String(order), font: theme.monoFont, fill: new Fill({ color: theme.routeCasing }), declutterMode: 'none' })
            : state === 'dropped'
              ? new Text({ text: '×', font: '700 12px system-ui', fill: new Fill({ color }), declutterMode: 'none' })
              : undefined,
        zIndex: filled ? 2 : 1,
      });
      const label = new Style({
        text: new Text({
          text: `${f.get('id')}  ${Math.round(value)}`,
          font: theme.monoFont,
          offsetX: r + 6,
          textAlign: 'left',
          fill: new Fill({ color: state === 'idle' || state === 'disabled' ? theme.muted : theme.label }),
          stroke: halo(theme),
        }),
        zIndex: 0,
      });
      return [symbol, label];
    },
  });
}

export function setStations(
  layer: VectorLayer<VectorSource>,
  stations: Pick<Station, 'id' | 'name' | 'x' | 'y' | 'value'>[],
  stateOf: (id: string) => { state: StationState; order?: number },
): void {
  const src = layer.getSource()!;
  src.clear(true);
  src.addFeatures(
    stations.map((s) => {
      const st = stateOf(s.id);
      const f = new Feature({ geometry: new Point([s.x, s.y]), id: s.id, name: s.name, value: s.value, state: st.state, order: st.order });
      f.setId(s.id);
      return f;
    }),
  );
}

/**
 * Shelters (hab + pressurized rovers). Movable shelters can be dragged (ol/interaction/Translate);
 * on drop the symbol snaps to the engine cell centre and `onMove(id, cell)` fires.
 */
export function createSheltersLayer(
  shelters: Shelter[],
  grid: GridSpec,
  onMove: (id: string, cell: Cell) => void,
  theme: MapTheme = DEFAULT_THEME,
): { layer: VectorLayer<VectorSource>; translate: Translate; setShelter: (id: string, cell: Cell) => void } {
  const src = new VectorSource();
  for (const s of shelters) {
    const f = new Feature({ geometry: new Point([s.x, s.y]), id: s.id, kind: s.kind, name: s.name, movable: s.movable });
    f.setId(s.id);
    src.addFeature(f);
  }
  const layer = new VectorLayer({
    source: src,
    zIndex: 30,
    style: (f: FeatureLike) => {
      const kind = f.get('kind') as Shelter['kind'];
      const dragging = !!f.get('dragging');
      const isHab = kind === 'hab';
      return [
        new Style({
          image: new RegularShape({
            points: 4,
            radius: isHab ? 10 : 9,
            angle: isHab ? Math.PI / 4 : 0,
            fill: new Fill({ color: isHab ? theme.safe : dragging ? theme.caution : '#E9E4D8' }),
            stroke: new Stroke({ color: theme.routeCasing, width: 2.5 }),
          }),
          text: new Text({ text: isHab ? 'H' : 'R', font: '700 10px system-ui', fill: new Fill({ color: theme.routeCasing }) }),
        }),
        new Style({
          text: new Text({
            // Short shelter name ("Habitat (Hab-1)" → HAB-1, "Pressurized rover (PR-1)" → PR-1) keeps the map uncluttered.
            text: `${(/\(([^)]+)\)\s*$/.exec(f.get('name') as string)?.[1] ?? (isHab ? 'HAB' : (f.get('name') as string))).toUpperCase()}${f.get('movable') ? '  ⇲' : ''}`,
            font: theme.font,
            offsetY: 19,
            fill: new Fill({ color: isHab ? theme.safe : theme.label }),
            stroke: halo(theme),
          }),
        }),
      ];
    },
  });
  const translate = new Translate({ layers: [layer], filter: (f) => !!f.get('movable'), hitTolerance: 6 });
  translate.on('translatestart', (e) => e.features.forEach((f) => f.set('dragging', true)));
  translate.on('translateend', (e) => {
    e.features.forEach((f) => {
      f.set('dragging', false);
      const g = f.getGeometry() as Point;
      const [x, y] = g.getCoordinates();
      let cell = xyToCell(grid, x, y);
      if (cell < 0) {
        // Dropped outside the grid: clamp to the nearest edge cell.
        const c = Math.max(0, Math.min(grid.w - 1, Math.floor((x - grid.originX) / grid.cellM)));
        const r = Math.max(0, Math.min(grid.h - 1, Math.floor((grid.originY - y) / grid.cellM)));
        cell = r * grid.w + c;
      }
      g.setCoordinates(cellToXY(grid, cell));
      onMove(f.get('id') as string, cell);
    });
  });
  const setShelter = (id: string, cell: Cell) => {
    const f = src.getFeatureById(id);
    if (f) (f.getGeometry() as Point).setCoordinates(cellToXY(grid, cell));
  };
  return { layer, translate, setShelter };
}

function hatchPattern(color: string, gap = 7): CanvasPattern | string {
  if (typeof document === 'undefined') return color;
  const c = document.createElement('canvas');
  c.width = c.height = gap;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, gap);
  ctx.lineTo(gap, 0);
  ctx.stroke();
  return ctx.createPattern(c, 'repeat') ?? color;
}

/** Keep-out polygons (hatched, labelled) plus reported hazard markers. */
export function createKeepoutLayer(keepouts: KeepOut[], theme: MapTheme = DEFAULT_THEME): VectorLayer<VectorSource> {
  const src = new VectorSource();
  for (const k of keepouts) {
    const f = new Feature({ geometry: new Polygon(k.rings), label: k.label, kind: k.kind, citation: k.citation });
    f.setId(k.id);
    src.addFeature(f);
  }
  const fill = new Fill({ color: hatchPattern('rgba(255,90,78,0.55)') });
  return new VectorLayer({
    source: src,
    declutter: 'labels',
    zIndex: 10,
    style: (f: FeatureLike) => {
      if (f.get('hazard')) {
        return new Style({
          image: new RegularShape({ points: 4, radius: 7, radius2: 0, angle: Math.PI / 4, stroke: new Stroke({ color: theme.violation, width: 2.5 }) }),
          text: new Text({ text: 'HAZARD', font: theme.monoFont, offsetY: -14, fill: new Fill({ color: theme.violation }), stroke: halo(theme) }),
        });
      }
      return new Style({
        fill,
        stroke: new Stroke({ color: 'rgba(255,90,78,0.85)', width: 1.25, lineDash: [6, 4] }),
        text: new Text({
          text: (f.get('label') as string).toUpperCase(),
          font: theme.monoFont,
          overflow: true,
          fill: new Fill({ color: 'rgba(255,170,160,0.95)' }),
          stroke: halo(theme),
        }),
      });
    },
  });
}

/** Add reported-hazard markers (projected points) to a keep-out layer, replacing previous ones. */
export function setHazards(layer: VectorLayer<VectorSource>, points: [number, number][]): void {
  const src = layer.getSource()!;
  src.getFeatures().filter((f) => f.get('hazard')).forEach((f) => src.removeFeature(f));
  src.addFeatures(points.map((p) => new Feature({ geometry: new Point(p), hazard: true })));
}

/** Curiosity (or Perseverance) traverse polyline(s) from the site pack. */
export function createTraverseLayer(traverse: SitePackManifest['traverse'], theme: MapTheme = DEFAULT_THEME): VectorLayer<VectorSource> {
  const src = new VectorSource();
  if (traverse?.lines.length) src.addFeature(new Feature({ geometry: new MultiLineString(traverse.lines), label: traverse.label }));
  return new VectorLayer({
    source: src,
    declutter: 'labels',
    zIndex: 5,
    style: [
      new Style({ stroke: new Stroke({ color: 'rgba(11,13,16,0.55)', width: 3.5 }) }),
      new Style({
        stroke: new Stroke({ color: 'rgba(233,228,216,0.85)', width: 1.5, lineDash: [1, 4], lineCap: 'round' }),
        text: new Text({
          text: traverse?.label ?? '',
          font: theme.monoFont,
          placement: 'line',
          repeat: 700,
          fill: new Fill({ color: 'rgba(233,228,216,0.9)' }),
          stroke: halo(theme),
        }),
      }),
    ],
  });
}

/** Ellipse ring (projected metres) for position uncertainty. */
export function ellipseRing(cx: number, cy: number, sx: number, sy: number, rotDeg = 0, n = 48): [number, number][] {
  const rot = (rotDeg * Math.PI) / 180;
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const ex = sx * Math.cos(a), ey = sy * Math.sin(a);
    out.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
  }
  return out;
}

/** Astronaut position (heading chevron), uncertainty ellipse and walked track. */
export function createAstronautLayer(theme: MapTheme = DEFAULT_THEME): VectorLayer<VectorSource> {
  const src = new VectorSource();
  const ellipse = new Feature({ kind: 'ellipse' });
  const track = new Feature({ kind: 'track' });
  const pos = new Feature({ kind: 'pos' });
  ellipse.setId('ellipse');
  track.setId('track');
  pos.setId('pos');
  src.addFeatures([track, ellipse, pos]);
  return new VectorLayer({
    source: src,
    zIndex: 40,
    updateWhileAnimating: true,
    style: (f: FeatureLike) => {
      const kind = f.get('kind');
      if (kind === 'ellipse') {
        return new Style({ fill: new Fill({ color: 'rgba(79,209,224,0.1)' }), stroke: new Stroke({ color: theme.safe, width: 1.25, lineDash: [3, 3] }) });
      }
      if (kind === 'track') {
        return [
          new Style({ stroke: new Stroke({ color: 'rgba(11,13,16,0.7)', width: 4.5 }) }),
          new Style({ stroke: new Stroke({ color: theme.safe, width: 2 }) }),
        ];
      }
      const heading = (f.get('heading') as number) ?? 0;
      return [
        new Style({
          image: new CircleStyle({ radius: 8, fill: new Fill({ color: theme.safe }), stroke: new Stroke({ color: theme.routeCasing, width: 2.5 }) }),
        }),
        new Style({
          image: new RegularShape({
            points: 3,
            radius: 5,
            rotation: (heading * Math.PI) / 180,
            rotateWithView: true,
            displacement: [0, 0],
            fill: new Fill({ color: theme.routeCasing }),
          }),
          text: new Text({ text: 'EV1', font: theme.font, offsetY: -18, fill: new Fill({ color: theme.safe }), stroke: halo(theme) }),
        }),
      ];
    },
  });
}

export function setAstronaut(
  layer: VectorLayer<VectorSource>,
  state: { x: number; y: number; sigmaM: number; headingDeg: number; track?: [number, number][] } | null,
): void {
  const src = layer.getSource()!;
  const pos = src.getFeatureById('pos')!, ell = src.getFeatureById('ellipse')!, track = src.getFeatureById('track')!;
  if (!state) {
    pos.setGeometry(undefined);
    ell.setGeometry(undefined);
    track.setGeometry(undefined);
    return;
  }
  pos.setGeometry(new Point([state.x, state.y]));
  pos.set('heading', state.headingDeg);
  // 2-sigma circle (≈86 % containment for a 2-D isotropic Gaussian).
  const r = Math.max(2, state.sigmaM * 2);
  ell.setGeometry(new Polygon([ellipseRing(state.x, state.y, r, r)]));
  if (state.track && state.track.length > 1) track.setGeometry(new LineString(state.track));
}

// ───────────────────────────── Helpers ─────────────────────────────

/** Fit the view to the AOI (grid extent) with padding [top, right, bottom, left] in px. */
export function fitToGrid(map: OlMap, grid: GridSpec, padding: number[] = [40, 40, 40, 40], duration = 0): void {
  map.getView().fit(gridExtent(grid), { padding, duration });
}
