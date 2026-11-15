import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import { LineString, Point, Polygon } from 'ol/geom';
import type { FeatureLike } from 'ol/Feature';
import Translate from 'ol/interaction/Translate';
import { Circle as CircleStyle, Fill, Icon, Text } from 'ol/style';
import type BaseLayer from 'ol/layer/Base';
import type ImageLayer from 'ol/layer/Image';
import type ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import type WebGLTileLayer from 'ol/layer/WebGLTile';
import type Projection from 'ol/proj/Projection';
import VectorSource from 'ol/source/Vector';
import { Stroke, Style } from 'ol/style';
import { defaults as defaultInteractions } from 'ol/interaction/defaults';
import type { Cell, LoadedSitePack, PlanResult, Station, Telem } from '@mw/shared/contracts';
import { cellToXY, gridExtent, xyToCell } from '@mw/shared/contracts';
import {
  LOS_RAMP,
  SAFE_ZONE_OPEN,
  SLOPE_RAMP,
  TIME_RAMP,
  TI_RAMP,
  CRISM_RAMP,
  ROUGH_RAMP,
  DEM_TINT,
  elevationRamp,
  attachCursorReadout,
  canvasImageSource,
  createCanvasFieldLayer,
  webglFieldsSupported,
  createAstronautLayer,
  createContourLayer,
  createFieldLayer,
  createHillshadeLayer,
  createImageryLayer,
  createKeepoutLayer,
  attachScaleBar,
  createOutlineLayer,
  createRouteLayer,
  createSheltersLayer,
  createStationsLayer,
  createTraverseLayer,
  isolines,
  maskPolygons,
  registerMarsProjection,
  rampStyle,
  routeCoords,
  safeZoneMask,
  safeZoneStyle,
  setAstronaut,
  setContours,
  setFieldBands,
  setHazards,
  setOutline,
  setRoute,
  setRouteProgress,
  setStations,
  setStationsDetail,
  type BandSource,
  type CursorReadout,
  type Ramp,
  type SafeZoneInputs,
  type SafeZoneLimits,
  type SafeZoneVars,
  type StationState,
} from '@mw/shared/map';
import type { OverlayId, VectorId } from '../lib/types';
import { toVars, type ExplainStep } from '../lib/zone';
import { demRange } from '../lib/layers';
import type { AttemptView } from '../lib/failure';

/** A "way forward" suggestion drawn on the map (closest safe point, or a rover parking spot). */
export interface MapSuggestion {
  kind: 'closest' | 'rover';
  xy: [number, number];
  label: string;
  /** Closest point: the original destination, joined to the suggestion by a dashed line. */
  from?: [number, number];
}

const ROVER_GHOST_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><rect x="8" y="8" width="14" height="14" transform="rotate(45 15 15)" fill="rgba(0,0,0,0.6)" stroke="#00e5ff" stroke-width="2" stroke-dasharray="3 2"/><circle cx="15" cy="15" r="2.5" fill="#00e5ff"/></svg>',
  );

let attemptMap: OlMap | null = null;
/** Markers the failure label must not cover: [x, y, extra height below the marker] in map coordinates. */
let attemptObstacles: () => [number, number, number][] = () => [];

/** Where the failure label sits around its stop: right, left, above, below; the first that covers no marker (else the one covering fewest). */
function attemptSlot(f: FeatureLike): { align: 'left' | 'right' | 'center'; ox: number; oy: number } {
  const g = (f as Feature).getGeometry?.() as Point | undefined;
  const size = attemptMap?.getSize();
  const at = g && attemptMap ? attemptMap.getPixelFromCoordinate(g.getCoordinates()) : null;
  const right = { align: 'left' as const, ox: 24, oy: -12 };
  if (!at || !size || !attemptMap) return right;
  const w = String(f.get('label') ?? '').length * 7.4 + 18, h = 22;
  // Box of each candidate, relative to the stop's pixel: [x0, y0, x1, y1].
  const cands = [
    { ...right, box: [24, -23, 24 + w, -1] },
    { align: 'right' as const, ox: -24, oy: -12, box: [-24 - w, -23, -24, -1] },
    { align: 'center' as const, ox: 0, oy: -50, box: [-w / 2, -61, w / 2, -39] },
    { align: 'center' as const, ox: 0, oy: 34, box: [-w / 2, 23, w / 2, 45] },
  ];
  const marks = attemptObstacles().flatMap(([x, y, below]) => {
    const px = attemptMap!.getPixelFromCoordinate([x, y]);
    return px ? [[px[0] - at[0] - 15, px[1] - at[1] - 15, px[0] - at[0] + 15, px[1] - at[1] + 15 + below]] : [];
  });
  let best = cands[0], bestScore = Infinity;
  for (const c of cands) {
    const [x0, y0, x1, y1] = c.box;
    let score = marks.filter((m) => x0 < m[2] && x1 > m[0] && y0 < m[3] && y1 > m[1]).length * 10;
    if (at[0] + x0 < 8 || at[0] + x1 > size[0] - 8 || at[1] + y0 < 8 || at[1] + y1 > size[1] - 8) score += 5;
    if (score < bestScore) (best = c, (bestScore = score));
  }
  return best;
}

function attemptStyle(f: FeatureLike): Style | Style[] {
  const k = f.get('k');
  if (k === 'leg') return new Style({ stroke: new Stroke({ color: 'rgba(255,43,214,0.45)', width: 3, lineDash: [7, 6], lineCap: 'round' }), zIndex: 1 });
  if (k === 'bad') return [
    new Style({ stroke: new Stroke({ color: 'rgba(0,0,0,0.85)', width: 9, lineCap: 'round', lineJoin: 'round' }), zIndex: 2 }),
    new Style({ stroke: new Stroke({ color: '#ff3b30', width: 5, lineCap: 'round', lineJoin: 'round' }), zIndex: 3 }),
  ];
  if (k === 'point') return new Style({ image: new CircleStyle({ radius: 8, fill: new Fill({ color: 'rgba(255,59,48,0.35)' }), stroke: new Stroke({ color: '#ff3b30', width: 3 }) }), zIndex: 3 });
  return new Style({
    text: new Text({
      text: String(f.get('label') ?? ''),
      font: '700 14px "Barlow Condensed", sans-serif',
      // Beside the stop or pin (never on it): the lettered circle is 12 px, the pin 26 px wide and 36 tall.
      ...(({ align, ox, oy }) => ({ textAlign: align, offsetX: ox, offsetY: oy }))(attemptSlot(f)),
      fill: new Fill({ color: '#ffffff' }),
      backgroundFill: new Fill({ color: 'rgba(0,0,0,0.88)' }),
      backgroundStroke: new Stroke({ color: '#ff3b30', width: 1.5 }),
      padding: [3, 6, 2, 6],
      declutterMode: 'obstacle',
    }),
    zIndex: 5,
  });
}

function suggestStyle(f: FeatureLike): Style | Style[] {
  if (f.get('link')) return new Style({ stroke: new Stroke({ color: 'rgba(0,229,255,0.9)', width: 1.5, lineDash: [4, 4] }) });
  const rover = f.get('kind') === 'rover';
  const label = new Text({
    text: String(f.get('label') ?? ''),
    font: '600 13px "Barlow Condensed", sans-serif',
    offsetX: 18,
    offsetY: rover ? 0 : 18, // below the destination's own label
    textAlign: 'left',
    fill: new Fill({ color: '#00e5ff' }),
    stroke: new Stroke({ color: 'rgba(0,0,0,0.9)', width: 3 }),
  });
  return rover
    ? new Style({ image: new Icon({ src: ROVER_GHOST_SVG, width: 30, height: 30 }), text: label, zIndex: 6 })
    : new Style({ image: new CircleStyle({ radius: 9, fill: new Fill({ color: 'rgba(0,0,0,0.55)' }), stroke: new Stroke({ color: '#00e5ff', width: 2.5 }) }), text: label, zIndex: 6 });
}

/** A route stop drawn as a lettered, draggable marker (B, C… — A is the start base). */
export interface DestMarker {
  id: string;
  letter: string;
  name: string;
  x: number;
  y: number;
  /** Left out of the plan (unsafe / unreachable): drawn red. */
  bad: boolean;
}

const PIN_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36"><path d="M13 1C6.4 1 1 6.3 1 12.9 1 21.5 13 35 13 35s12-13.5 12-22.1C25 6.3 19.6 1 13 1z" fill="#00e5ff" stroke="#000" stroke-width="2"/><circle cx="13" cy="13" r="4.5" fill="#000"/></svg>',
  );

function destStyle(f: FeatureLike): Style | Style[] {
  if (!f.get('pin') && !f.get('dest')) return [];
  if (f.get('pin')) return new Style({ image: new Icon({ src: PIN_SVG, anchor: [0.5, 1], width: 26, height: 36, declutterMode: 'obstacle' }), zIndex: 10 });
  const bad = !!f.get('bad');
  const dragging = !!f.get('dragging');
  const color = bad ? '#ff3b30' : '#ff2bd6';
  return new Style({
    image: new CircleStyle({ radius: dragging ? 14 : 12, fill: new Fill({ color: '#000' }), stroke: new Stroke({ color, width: 2.5 }), declutterMode: 'obstacle' }),
    text: new Text({ text: String(f.get('letter')), font: '700 13px "Barlow Condensed", sans-serif', fill: new Fill({ color: '#fff' }), declutterMode: 'none' }),
    zIndex: 5,
  });
}

/** A stop's name beside its letter. Lower priority than every marker, the start base and the failure label: it drops out instead of covering them. */
function destNameStyle(f: FeatureLike): Style | Style[] {
  if (!f.get('dest')) return [];
  const bad = !!f.get('bad');
  const nm = String(f.get('name') ?? '');
  return [
    new Style({
      text: new Text({
        text: nm.length > 26 ? `${nm.slice(0, 25)}…` : nm,
        font: '600 13px "Barlow Condensed", sans-serif',
        offsetY: 26, // under the letter: the route usually leaves a stop sideways
        textAlign: 'center',
        fill: new Fill({ color: bad ? '#ff8a80' : '#ffffff' }),
        stroke: new Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
        declutterMode: 'declutter',
      }),
      zIndex: 4,
    }),
  ];
}

export interface MapCallbacks {
  onShelterMoved(id: string, cell: Cell): void;
  /** A destination marker was dragged to a new cell. */
  onDestMoved?(id: string, cell: Cell): void;
  /** Right-click on the map. */
  onContext?(cell: Cell, stationId: string | null, pixel: [number, number]): void;
  onClick(cell: Cell, stationId: string | null, extra?: { shelterId: string | null; pixel: [number, number]; destId?: string }): void;
  onReadout(r: CursorReadout | null): void;
  onHoverStation(id: string | null, pixel: [number, number] | null): void;
  onHoverShelter?(id: string | null, pixel: [number, number] | null): void;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function scaleRamp(r: Ramp, k: number, id: string): Ramp {
  return { id, stops: r.stops.map(([v, c]) => [v * k, c]) };
}

export class MapController {
  readonly map: OlMap;
  readonly proj: Projection;
  private pack: LoadedSitePack;
  /** False → canvas fallback (no WebGL float textures): hillshade + safe zone only. */
  readonly gl = webglFieldsSupported();
  private hillshade: WebGLTileLayer | null = null;
  private hillCanvas: ImageLayer<ImageStatic> | null = null;
  private safeCanvas: ImageLayer<ImageStatic> | null = null;
  private sun = { az: 100, el: 35 };
  private canvasRaf = 0;
  private imagery: BaseLayer | null = null;
  private safe: WebGLTileLayer | null = null;
  private fieldLayers: Partial<Record<OverlayId, WebGLTileLayer>> = {};
  private contour = createContourLayer();
  private outline = createOutlineLayer();
  private routeLayer = createRouteLayer();
  private stationsLayer = createStationsLayer();
  private keepouts: VectorLayer<VectorSource>;
  /** Crew-reported hazards: always visible, separate from the keep-out polygons (a Safety-view layer). */
  private hazards: VectorLayer<VectorSource> = createKeepoutLayer([]);
  private outlineOn = true;
  private traverse: VectorLayer<VectorSource>;
  private astronaut = createAstronautLayer();
  /** Route stops (lettered, draggable) and the temporary dropped pin. */
  private destLayer = new VectorLayer({ source: new VectorSource(), zIndex: 40, declutter: 'labels', style: destStyle });
  /** Stop names: same source, a layer below the bases (30) and the failure label (39) so those always win. */
  private destNameLayer = new VectorLayer({ source: this.destLayer.getSource()!, zIndex: 25, declutter: 'labels', style: destNameStyle });
  private destTranslate: Translate;
  private pickMode = false;
  /** Way-forward suggestion (closest safe point / rover parking spot). */
  /** A NO-GO's attempted walk (dimmed) with the stretch that breaks the rule in red. */
  private attemptLayer = new VectorLayer({ source: new VectorSource(), zIndex: 39, declutter: 'labels', style: attemptStyle });
  private suggestLayer = new VectorLayer({ source: new VectorSource(), zIndex: 41, style: suggestStyle });
  private aoi: VectorLayer<VectorSource>;
  private shelters: ReturnType<typeof createSheltersLayer>;
  private prevZone: SafeZoneInputs | null = null;
  private zone: SafeZoneInputs | null = null;
  private limits: SafeZoneLimits | null = null;
  private vars: SafeZoneVars = { ...SAFE_ZONE_OPEN };
  private animToken = 0;
  private morphRaf = 0;
  private offScale: (() => void) | null = null;
  private offReadout: () => void;
  private overlayState: { ids: OverlayId[]; opacity: Record<OverlayId, number> } = { ids: ['safezone'], opacity: {} as Record<OverlayId, number> };
  explaining = false;
  private contourWasVisible = true;

  constructor(target: HTMLElement, pack: LoadedSitePack, private cb: MapCallbacks) {
    this.pack = pack;
    const m = pack.manifest;
    const g = m.grid;
    this.proj = registerMarsProjection(g);

    const ortho = m.imagery[0];
    if (ortho) this.imagery = createImageryLayer(ortho, pack.base, this.proj);
    if (this.gl) {
      this.hillshade = createHillshadeLayer({
        grid: g,
        projection: this.proj,
        normals: pack.rasters.normals,
        dem: ortho ? undefined : pack.rasters.dem,
        sunAzDeg: 100,
        sunElevDeg: 35,
        ambient: ortho ? 0.45 : 0.2,
        zFactor: ortho ? 1.5 : 3,
        opacity: ortho ? 0.55 : 1,
        className: ortho ? 'mw-hillshade mw-blend' : 'mw-hillshade',
      });
      // Static field overlays straight from the site pack.
      this.fieldLayers.slope = createFieldLayer({ grid: g, projection: this.proj, bands: [{ data: pack.rasters.slope }], style: rampStyle(SLOPE_RAMP), visible: false, className: 'mw-f-slope' });
      const [lo, hi] = demRange(pack);
      this.fieldLayers.elevation = createFieldLayer({ grid: g, projection: this.proj, bands: [{ data: pack.rasters.dem }], style: rampStyle(elevationRamp(lo, hi)), visible: false, className: 'mw-f-elevation' });
      if (pack.rasters.rough) {
        this.fieldLayers.rough = createFieldLayer({ grid: g, projection: this.proj, bands: [{ data: pack.rasters.rough }], style: rampStyle(ROUGH_RAMP), visible: false, className: 'mw-f-rough' });
      }
      if (pack.rasters.ti) {
        this.fieldLayers.ti = createFieldLayer({ grid: g, projection: this.proj, bands: [{ data: pack.rasters.ti }], style: rampStyle(TI_RAMP), visible: false, className: 'mw-f-ti' });
      }
      if (pack.rasters.crism_sindex2) {
        this.fieldLayers.crism = createFieldLayer({ grid: g, projection: this.proj, bands: [{ data: pack.rasters.crism_sindex2 }], style: rampStyle(CRISM_RAMP), visible: false, className: 'mw-f-crism' });
      }
    } else {
      console.info('[map] WebGL float textures unavailable — canvas fallback (hillshade + safe zone)');
      this.hillCanvas = createCanvasFieldLayer(g, this.proj, this.hillColor(), { opacity: ortho ? 0.55 : 1, className: ortho ? 'mw-blend' : undefined });
    }

    this.keepouts = createKeepoutLayer(m.keepouts);
    this.traverse = createTraverseLayer(m.traverse);
    this.traverse.setVisible(false);
    this.shelters = createSheltersLayer(m.shelters, g, (id, cell) => this.cb.onShelterMoved(id, cell));

    const ext = gridExtent(g);
    this.aoi = new VectorLayer({
      source: new VectorSource({ features: [new Feature(new Polygon([[[ext[0], ext[1]], [ext[2], ext[1]], [ext[2], ext[3]], [ext[0], ext[3]], [ext[0], ext[1]]]]))] }),
      style: new Style({ stroke: new Stroke({ color: 'rgba(233,228,216,0.28)', width: 1, lineDash: [2, 6] }) }),
    });

    // Dragging a destination marker moves that stop (snapped to the engine cell on drop) and re-plans.
    this.destTranslate = new Translate({ layers: [this.destLayer], filter: (f) => !!f.get('dest'), hitTolerance: 6 });
    this.destTranslate.on('translatestart', (e) => {
      e.features.forEach((f) => f.set('dragging', true));
      this.cursor('grabbing');
    });
    this.destTranslate.on('translateend', (e) => {
      this.cursor('grab');
      e.features.forEach((f) => {
        f.set('dragging', false);
        const geom = f.getGeometry() as Point;
        const [x, y] = geom.getCoordinates();
        const c = Math.max(0, Math.min(g.w - 1, Math.floor((x - g.originX) / g.cellM)));
        const r = Math.max(0, Math.min(g.h - 1, Math.floor((g.originY - y) / g.cellM)));
        const cell = r * g.w + c;
        geom.setCoordinates(cellToXY(g, cell));
        this.cb.onDestMoved?.(f.get('id') as string, cell);
      });
    });
    this.shelters.translate.on('translatestart', () => this.cursor('grabbing'));
    this.shelters.translate.on('translateend', () => this.cursor('grab'));

    const span = Math.max(ext[2] - ext[0], ext[3] - ext[1]);
    const pad = 0; // never pan or zoom past the study area (no black void)
    this.map = new OlMap({
      target,
      controls: [],
      // A press-drag-release under 5 px still counts as a click (hand jitter); anything more is a pan.
      moveTolerance: 5,
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }).extend([this.shelters.translate, this.destTranslate]),
      layers: [
        ...(this.imagery ? [this.imagery] : []),
        (this.hillshade ?? this.hillCanvas)!,
        ...(['elevation', 'ti', 'crism', 'rough', 'slope'] as OverlayId[]).map((k) => this.fieldLayers[k]).filter((x): x is WebGLTileLayer => !!x),
        this.aoi,
        this.keepouts,
        this.hazards,
        this.traverse,
        this.contour,
        this.outline,
        this.routeLayer,
        this.stationsLayer,
        this.shelters.layer,
        this.astronaut,
        this.attemptLayer,
        this.destNameLayer,
        this.destLayer,
        this.suggestLayer,
      ],
      view: new View({
        projection: this.proj,
        center: [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2],
        resolution: g.cellM,
        minResolution: 0.2,
        extent: [ext[0] - pad, ext[1] - pad, ext[2] + pad, ext[3] + pad],
        constrainOnlyCenter: false,
        enableRotation: false,
      }),
    });

    attemptMap = this.map;
    attemptObstacles = () => [
      ...this.shelters.layer.getSource()!.getFeatures().map((f) => [...(f.getGeometry() as Point).getCoordinates(), 18] as [number, number, number]),
      ...this.pack.manifest.stations.map((q) => [q.x, q.y, 0] as [number, number, number]),
      ...this.extraStations.map((q) => [q.x, q.y, 0] as [number, number, number]),
      ...this.destLayer.getSource()!.getFeatures().filter((f) => f.get('dest')).map((f) => [...(f.getGeometry() as Point).getCoordinates(), 0] as [number, number, number]),
    ];
    this.offReadout = attachCursorReadout(this.map, g, { dem: pack.rasters.dem, slope: pack.rasters.slope }, (r) => this.cb.onReadout(r));

    this.map.on('singleclick', (e) => {
      let cell = xyToCell(g, e.coordinate[0], e.coordinate[1]);
      // A click on a route-stop marker opens that stop's card (a science target, or the place itself).
      let dest: { id: string; xy: number[] } | null = null;
      this.map.forEachFeatureAtPixel(e.pixel, (f) => {
        if (f.get('dest')) dest = { id: f.get('id') as string, xy: (f.getGeometry() as unknown as { getCoordinates(): number[] }).getCoordinates() };
        return !!dest;
      }, { layerFilter: (l) => l === this.destLayer, hitTolerance: 6 });
      if (dest) {
        const d = dest as { id: string; xy: number[] };
        const isStation = this.pack.manifest.stations.some((s) => s.id === d.id);
        cell = xyToCell(g, d.xy[0], d.xy[1]);
        if (cell >= 0) this.cb.onClick(cell, isStation ? d.id : null, { shelterId: null, pixel: e.pixel as [number, number], destId: isStation ? undefined : d.id });
        return;
      }
      let stationId: string | null = null;
      this.map.forEachFeatureAtPixel(e.pixel, (f) => {
        stationId = (f.get('id') as string) ?? null;
        return true;
      }, { layerFilter: (l) => l === this.stationsLayer, hitTolerance: 6 });
      let shelterId: string | null = null;
      if (!stationId) {
        this.map.forEachFeatureAtPixel(e.pixel, (f) => {
          shelterId = (f.get('id') as string) ?? null;
          return true;
        }, { layerFilter: (l) => l === this.shelters.layer, hitTolerance: 6 });
      }
      if (cell >= 0) this.cb.onClick(cell, stationId, { shelterId, pixel: e.pixel as [number, number] });
    });
    let hovered: string | null = null;
    let hoveredShelter: string | null = null;
    this.map.on('pointermove', (e) => {
      if (e.dragging) return;
      let station: string | null = null;
      let stationXY: number[] | null = null;
      let shelter: string | null = null;
      const hit = this.map.forEachFeatureAtPixel(
        e.pixel,
        (f, layer) => {
          if (layer === this.destLayer) return f.get('dest') ? 'grab' : null;
          if (layer === this.stationsLayer) {
            station = f.get('id') as string;
            stationXY = (f.getGeometry() as unknown as { getCoordinates(): number[] }).getCoordinates();
          }
          if (layer === this.shelters.layer) shelter = (f.get('id') as string) ?? null;
          return f.get('movable') ? 'grab' : f.get('id') ? 'pointer' : null;
        },
        { layerFilter: (l) => l === this.shelters.layer || l === this.stationsLayer || l === this.destLayer, hitTolerance: 6 },
      );
      const vp = this.map.getViewport();
      if (vp) vp.style.cursor = hit ?? (this.pickMode ? 'crosshair' : '');
      if (shelter !== hoveredShelter) {
        hoveredShelter = shelter;
        this.cb.onHoverShelter?.(shelter, shelter ? (e.pixel as [number, number]) : null);
      }
      if (station !== hovered) {
        hovered = station;
        const px = stationXY ? (this.map.getPixelFromCoordinate(stationXY) as [number, number]) : null;
        this.cb.onHoverStation(station, px);
      }
    });
    // Right-click: a small context menu (Directions to here / Add as stop / What's here?).
    this.map.getViewport()?.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const px = this.map.getEventPixel(ev) as [number, number];
      const coord = this.map.getCoordinateFromPixel(px);
      if (!coord) return;
      const cell = xyToCell(g, coord[0], coord[1]);
      let stationId: string | null = null;
      this.map.forEachFeatureAtPixel(px, (f) => {
        stationId = (f.get('id') as string) ?? null;
        return true;
      }, { layerFilter: (l) => l === this.stationsLayer, hitTolerance: 6 });
      if (cell >= 0) this.cb.onContext?.(cell, stationId, px);
    });
    this.map.on('movestart', () => {
      if (hoveredShelter) {
        hoveredShelter = null;
        this.cb.onHoverShelter?.(null, null);
      }
      if (hovered) {
        hovered = null;
        this.cb.onHoverStation(null, null);
      }
    });
  }

  /** Route stops as lettered markers (plan mode) plus the temporary dropped pin. */
  setDestinations(list: DestMarker[], pin: [number, number] | null) {
    const src = this.destLayer.getSource()!;
    src.clear(true);
    const feats = list.map((d) => {
      const f = new Feature({ geometry: new Point([d.x, d.y]), dest: true, id: d.id, letter: d.letter, name: d.name, bad: d.bad });
      f.setId(`dest-${d.id}`);
      return f;
    });
    if (pin) feats.push(new Feature({ geometry: new Point(pin), pin: true }));
    src.addFeatures(feats);
  }

  private cursor(c: string) {
    const vp = this.map.getViewport();
    if (vp) vp.style.cursor = c;
  }

  /** "Choose on map": crosshair cursor until the next map click. */
  setPickMode(on: boolean) {
    this.pickMode = on;
    const vp = this.map.getViewport();
    if (vp) vp.style.cursor = on ? 'crosshair' : '';
  }

  attachScale(el: HTMLElement) {
    this.offScale?.();
    this.offScale = attachScaleBar(this.map, el, 110);
  }

  fit(duration = 450) {
    const g = this.pack.manifest.grid;
    const size = this.map.getSize();
    if (!size || !size[0] || !size[1]) return;
    // Cover-style: the study area fills the visible map (no black bars); the base is kept in view.
    const [ax0, ay0, ax1, ay1] = gridExtent(g);
    const aw = ax1 - ax0, ah = ay1 - ay0, r = size[0] / size[1];
    const w = aw / ah > r ? ah * r : aw;
    const h = w / r;
    // Centre on the targets and bases (so most of them are in view), then keep the window inside the study area.
    const pts = [...this.pack.manifest.stations.map((q) => [q.x, q.y]), ...this.pack.manifest.shelters.map((q) => cellToXY(g, q.cell))];
    const bx = pts.length ? (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2 : (ax0 + ax1) / 2;
    const by = pts.length ? (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2 : (ay0 + ay1) / 2;
    let x0 = bx - w / 2, y0 = by - h / 2;
    x0 = Math.max(ax0, Math.min(ax1 - w, x0));
    y0 = Math.max(ay0, Math.min(ay1 - h, y0));
    this.map.getView().fit([x0, y0, x0 + w, y0 + h], { padding: [0, 0, 0, 0], duration });
  }

  /** Pixels to keep clear when fitting a route [top, right, bottom, left]: the Directions card on the left, the buttons and inset on the right, the scale strip below. */
  private fitPadding(): [number, number, number, number] {
    const vp = this.map.getViewport()?.getBoundingClientRect() ?? new DOMRect(0, 0, 1000, 700);
    const card = document.querySelector('[data-testid="directions"]')?.getBoundingClientRect();
    const left = card && card.right > vp.left && card.right < vp.left + vp.width * 0.7 ? card.right - vp.left + 40 : 60;
    return [110, 140, 120, left];
  }

  /** The most zoomed-out view allowed: the study area fills the map (no black void), as `fit` shows it. */
  private coverResolution(): number {
    const size = this.map.getSize();
    const [ax0, ay0, ax1, ay1] = gridExtent(this.pack.manifest.grid);
    return size && size[0] && size[1] ? Math.min((ax1 - ax0) / size[0], (ay1 - ay0) / size[1]) : Infinity;
  }

  /** Start base and the stop markers: what must stay in view when a route is too long to fit. */
  private keyPoints(): [number, number][] {
    const pts: [number, number][] = [];
    for (const f of this.shelters.layer.getSource()!.getFeatures()) if (f.get('isA')) pts.push((f.getGeometry() as Point).getCoordinates() as [number, number]);
    for (const f of this.destLayer.getSource()!.getFeatures()) if (f.get('dest') || f.get('pin')) pts.push((f.getGeometry() as Point).getCoordinates() as [number, number]);
    return pts;
  }

  zoomBy(d: number) {
    const v = this.map.getView();
    v.animate({ zoom: (v.getZoom() ?? 0) + d, duration: 220 });
  }

  setSun(azDeg: number, elevDeg: number) {
    this.sun = { az: azDeg, el: elevDeg };
    if (this.hillshade) this.hillshade.updateStyleVariables({ sunAzDeg: azDeg, sunElevDeg: elevDeg });
    else this.scheduleCanvas();
  }

  /** CPU twin of the GPU hillshade (canvas fallback). */
  private hillColor() {
    const { normals, dem } = this.pack.rasters;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < dem.length; i++) if (Number.isFinite(dem[i])) { lo = Math.min(lo, dem[i]); hi = Math.max(hi, dem[i]); }
    const az = (this.sun.az * Math.PI) / 180, el = (this.sun.el * Math.PI) / 180;
    const sx = Math.sin(az) * Math.cos(el), sy = Math.cos(az) * Math.cos(el), sz = Math.sin(el);
    const day = Math.max(0, Math.min(1, (this.sun.el + 6) / 10));
    const tint = !this.imagery;
    return (i: number, out: Uint8ClampedArray, o: number) => {
      const nx0 = normals[2 * i], ny0 = normals[2 * i + 1];
      const nz = Math.sqrt(Math.max(0, 1 - nx0 * nx0 - ny0 * ny0));
      const nx = nx0 * 3, ny = ny0 * 3;
      const shade = Math.max(0, Math.min(1, (nx * sx + ny * sy + nz * sz) / Math.hypot(nx, ny, nz)));
      const lit = 0.2 * (0.35 + 0.65 * day) + 0.8 * shade * day;
      let r = 255, g = 255, b = 255;
      if (tint) {
        const t = (dem[i] - lo) / (hi - lo || 1);
        let k = 1;
        while (k < DEM_TINT.length - 1 && DEM_TINT[k][0] < t) k++;
        const [t0, c0] = DEM_TINT[k - 1], [t1, c1] = DEM_TINT[k];
        const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0 || 1)));
        r = c0[0] + (c1[0] - c0[0]) * f; g = c0[1] + (c1[1] - c0[1]) * f; b = c0[2] + (c1[2] - c0[2]) * f;
      }
      out[o] = r * lit; out[o + 1] = g * lit; out[o + 2] = b * lit; out[o + 3] = 255;
    };
  }

  /** Safe-zone colours for the canvas fallback, from the current style variables. */
  private safeColor() {
    const z = this.zone!, v = this.vars;
    return (i: number, out: Uint8ClampedArray, o: number) => {
      const ex = [
        z.slope[i] > v.limSlope || (v.keepOn > 0.5 && z.keepout[i] > 0) ? 1 : 0,
        z.distHab[i] > v.limRadius ? 2 : 0,
        z.walkbackTotal[i] > v.limWalkback ? 3 : 0,
        z.shelter[i] > v.limShelter ? 4 : 0,
        z.losGap[i] > v.limLos ? 5 : 0,
        v.blockedOn > 0.5 && z.blocked[i] ? 6 : 0,
      ].filter(Boolean);
      const prev = ex.some((k) => k !== v.act);
      const act = ex.includes(v.act);
      if (prev || (act && v.actGlow < 0.3)) { out[o] = 8; out[o + 1] = 9; out[o + 2] = 12; out[o + 3] = 140; }
      else if (act) { out[o] = 255; out[o + 1] = 59; out[o + 2] = 48; out[o + 3] = 128; }
      else { out[o] = 79; out[o + 1] = 209; out[o + 2] = 224; out[o + 3] = 26; }
    };
  }

  private scheduleCanvas() {
    if (this.gl || this.canvasRaf) return;
    this.canvasRaf = requestAnimationFrame(() => {
      this.canvasRaf = 0;
      const g = this.pack.manifest.grid;
      this.hillCanvas?.setSource(canvasImageSource(g, this.proj, this.hillColor()));
      if (this.zone) {
        if (!this.safeCanvas) {
          this.safeCanvas = createCanvasFieldLayer(g, this.proj, this.safeColor());
          this.insertBelow(this.safeCanvas, this.aoi);
          this.setOverlays(this.overlayState.ids, this.overlayState.opacity);
        } else this.safeCanvas.setSource(canvasImageSource(g, this.proj, this.safeColor()));
      }
    });
  }

  setVectors(v: Record<VectorId, boolean>) {
    this.contourWasVisible = v.contours;
    this.outlineOn = v.outline;
    this.outline.setVisible(this.outlineOn || this.overlayState.ids.includes('safezone') || this.explaining);
    setStationsDetail(this.stationsLayer, v.stationDetail);
    if (!this.explaining) this.contour.setVisible(v.contours);
    this.keepouts.setVisible(v.keepouts);
    this.traverse.setVisible(v.traverse);
    this.stationsLayer.setVisible(v.stations);
    this.routeLayer.setVisible(v.route);
    this.shelters.layer.setVisible(v.shelters);
    this.imagery?.setVisible(v.imagery);
    (this.hillshade ?? this.hillCanvas)?.setVisible(v.relief || !this.imagery || !v.imagery);
  }

  /** Draw (or clear) a NO-GO's attempted walk: dimmed route, the offending stretch in red, a short label. */
  setAttempt(a: AttemptView | null) {
    const src = this.attemptLayer.getSource()!;
    src.clear(true);
    this.attemptLabelXY = null;
    if (!a || !a.failure) return;
    const g = this.pack.manifest.grid;
    // Outbound walk only: the return leg runs almost on top of it and would read as a two-lane road.
    const out = a.legs[0] ?? [];
    if (out.length >= 2) src.addFeature(new Feature({ geometry: new LineString(routeCoords(g, out)), k: 'leg' }));
    const onOut = new Set(out);
    // Whole-walk rules have no place on the route: mark them at the stop, not at the start.
    const wholeWalk = ['eva_duration_max_min', 'heat_avg_max_w', 'walkback_speed_factor'].includes(a.failure.rule);
    const stopCell = out.length ? out[out.length - 1] : a.failure.labelCell;
    const runs: number[][] = [];
    for (const run of wholeWalk ? [[stopCell]] : a.failure.runs) {
      if (!run.some((c) => onOut.has(c))) { runs.push(run); continue; } // return leg only: keep
      let cur: number[] = [];
      for (const c of run) {
        if (onOut.has(c)) cur.push(c);
        else if (cur.length) (runs.push(cur), (cur = []));
      }
      if (cur.length) runs.push(cur);
    }
    for (const run of runs) {
      if (run.length >= 2) src.addFeature(new Feature({ geometry: new LineString(routeCoords(g, run)), k: 'bad' }));
      else src.addFeature(new Feature({ geometry: new Point(cellToXY(g, run[0])), k: 'point' }));
    }
    const xy = cellToXY(g, wholeWalk ? stopCell : a.failure.labelCell);
    this.attemptLabelXY = xy;
    src.addFeature(new Feature({ geometry: new Point(xy), k: 'label', label: a.failure.short }));
  }

  private attemptLabelXY: number[] | null = null;
  /** Map coordinates of the attempt label (for the test geometry hook). */
  attemptXY(): number[] | null {
    return this.attemptLabelXY;
  }

  /** Show (or clear) a way-forward suggestion on the map. */
  setSuggestion(sg: MapSuggestion | null) {
    const src = this.suggestLayer.getSource()!;
    src.clear(true);
    if (!sg) return;
    const feats: Feature[] = [];
    if (sg.from) feats.push(new Feature({ geometry: new LineString([sg.from, sg.xy]), link: true }));
    const f = new Feature({ geometry: new Point(sg.xy), kind: sg.kind, label: sg.label });
    f.setId('suggestion');
    feats.push(f);
    src.addFeatures(feats);
  }

  /** Pan/zoom (only if needed) so these points are on screen, clear of the side cards. */
  reveal(pts: [number, number][]) {
    const size = this.map.getSize();
    if (!size || !pts.length) return;
    const inView = pts.every((p) => {
      const px = this.map.getPixelFromCoordinate(p);
      return px && px[0] > 400 && px[0] < size[0] - 80 && px[1] > 60 && px[1] < size[1] - 80;
    });
    const view = this.map.getView();
    // Two nearby points (closest safe point vs the pin): zoom in until they sit ~120 px apart.
    if (pts.length === 2) {
      const dm = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const res = view.getResolution() ?? 1;
      if (dm / res < 60) {
        view.animate({ center: [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], resolution: Math.max(0.3, Math.min(res, dm / 120)), duration: 400 });
        return;
      }
    }
    if (inView) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = 200;
    this.map.getView().fit([x0 - pad, y0 - pad, x1 + pad, y1 + pad], { padding: [80, 80, 120, 420], duration: 400, maxZoom: this.map.getView().getZoom() });
  }

  /** Map coordinates of the suggestion marker (for the test geometry hook). */
  suggestionXY(): number[] | null {
    const f = this.suggestLayer.getSource()!.getFeatureById('suggestion');
    return f ? (f.getGeometry() as Point).getCoordinates() : null;
  }

  setOverlays(ids: OverlayId[], opacity: Record<OverlayId, number>) {
    this.overlayState = { ids, opacity };
    for (const [id, layer] of Object.entries(this.fieldLayers) as [OverlayId, WebGLTileLayer][]) {
      layer.setVisible(ids.includes(id));
      layer.setOpacity(opacity[id] ?? 1);
    }
    if (this.safe) {
      this.safe.setVisible(ids.includes('safezone') || this.explaining);
      this.safe.setOpacity(opacity.safezone ?? 1);
    }
    this.safeCanvas?.setVisible(ids.includes('safezone') || this.explaining);
    this.outline.setVisible(this.outlineOn || ids.includes('safezone') || this.explaining);
  }

  /** Install a new safe-zone solution. With `morph`, the region animates from the previous one. */
  setZone(zone: SafeZoneInputs, limits: SafeZoneLimits, morph: boolean) {
    const g = this.pack.manifest.grid;
    const prev = this.prevZone ?? zone;
    this.zone = zone;
    this.limits = limits;
    const bands: BandSource[] = [
      { data: zone.slope }, { data: zone.distHab },
      { data: prev.walkbackTotal }, { data: zone.walkbackTotal },
      { data: prev.shelter }, { data: zone.shelter },
      { data: prev.losGap }, { data: zone.losGap },
      { data: zone.keepout }, { data: zone.blocked },
    ];
    if (!this.explaining) this.vars = { ...this.vars, ...toVars(limits), act: 0, actGlow: 0 };
    if (!this.gl) {
      this.prevZone = zone;
      this.scheduleCanvas();
      this.updateContours(zone, limits);
      if (!this.explaining) this.refreshOutline();
      return;
    }
    if (!this.safe) {
      this.safe = createFieldLayer({ grid: g, projection: this.proj, bands, style: safeZoneStyle({ ...this.vars, morph: 1 }), className: 'mw-f-safe' });
      this.insertBelow(this.safe, this.aoi);
    } else {
      setFieldBands(this.safe, g, this.proj, bands);
    }

    // Dynamic overlays from the engine fields.
    const shelterLayerStyle = rampStyle(TIME_RAMP, { threshold: Number.isFinite(limits.shelterMax) ? limits.shelterMax : 1e9 });
    const wbMax = Number.isFinite(limits.walkbackMax) ? limits.walkbackMax : 300;
    this.upsertField('shelter', [{ data: zone.shelter }], shelterLayerStyle);
    this.upsertField('walkback', [{ data: zone.walkbackTotal }], rampStyle(scaleRamp(TIME_RAMP, wbMax / 30, 'walkback'), { threshold: wbMax }));
    this.upsertField('los', [{ data: zone.losGap }], rampStyle(LOS_RAMP));
    this.fieldLayers.shelter?.updateStyleVariables({ threshold: Number.isFinite(limits.shelterMax) ? limits.shelterMax : 1e9 });
    this.fieldLayers.walkback?.updateStyleVariables({ threshold: wbMax });
    this.setOverlays(this.overlayState.ids, this.overlayState.opacity);

    this.updateContours(zone, limits);

    cancelAnimationFrame(this.morphRaf);
    if (morph && this.prevZone && !this.explaining) {
      this.safe.updateStyleVariables({ morph: 0 });
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 1100);
        this.safe?.updateStyleVariables({ morph: easeInOut(t) });
        if (t < 1) this.morphRaf = requestAnimationFrame(step);
        else this.refreshOutline();
      };
      this.morphRaf = requestAnimationFrame(step);
    } else {
      this.safe.updateStyleVariables({ morph: 1 });
      if (!this.explaining) this.refreshOutline();
    }
    this.prevZone = zone;
  }

  private updateContours(zone: SafeZoneInputs, limits: SafeZoneLimits) {
    const g = this.pack.manifest.grid;
    // Isochrones: minutes to the nearest shelter.
    const lim = Number.isFinite(limits.shelterMax) ? limits.shelterMax : 30;
    const ks = [...new Set([10, 20, lim])].filter((v) => v <= lim).sort((a, b) => a - b);
    const k = Math.max(2, Math.ceil(g.w / 250));
    setContours(this.contour, isolines(g, zone.shelter, ks, { downsample: k, minLengthM: 700 }), (v) => `${Math.round(v)} min to shelter`, {
      emphasize: (v) => v === lim,
      color: (v) => (v === lim ? '#ff3b30' : '#a8a8a8'),
    });

  }

  private upsertField(id: OverlayId, bands: BandSource[], style: ReturnType<typeof rampStyle>) {
    const g = this.pack.manifest.grid;
    const existing = this.fieldLayers[id];
    if (existing) {
      setFieldBands(existing, g, this.proj, bands);
      return;
    }
    const layer = createFieldLayer({ grid: g, projection: this.proj, bands, style, visible: false, className: `mw-f-${id}` });
    this.fieldLayers[id] = layer;
    this.insertBelow(layer, this.aoi);
  }

  private insertBelow(layer: BaseLayer, ref: BaseLayer) {
    const layers = this.map.getLayers();
    const idx = layers.getArray().indexOf(ref);
    layers.insertAt(idx < 0 ? layers.getLength() : idx, layer);
  }

  private refreshOutline() {
    if (!this.zone || !this.limits) return;
    const g = this.pack.manifest.grid;
    const mask = safeZoneMask(this.zone, this.limits);
    // One clean outline: small islands and steep speckle holes (< 2 ha) are left out of the line;
    // the Safety view's shading shows the exact cells.
    setOutline(this.outline, maskPolygons(g, mask, { downsample: Math.max(2, Math.ceil(g.w / 400)), minAreaM2: 20000, minHoleM2: 20000 }));
  }

  private routeCells: number[] = [];

  /**
   * Zoom to the current route, clear of the cards. Short routes zoom in; long ones never zoom out past the
   * cover level (no black void): then the base, the stop(s) and `keep` (e.g. the failure label) stay in view
   * and the route may run off-screen.
   */
  fitRoute(duration = 450, cells: number[] = this.routeCells, keep: number[] = []) {
    const g = this.pack.manifest.grid;
    const size = this.map.getSize();
    if (!cells.length || !size || !size[0]) return this.fit(duration);
    const bounds = (pts: number[][]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return [x0, y0, x1, y1];
    };
    const key = [...this.keyPoints(), ...keep.map((c) => cellToXY(g, c) as [number, number])];
    const [x0, y0, x1, y1] = bounds([...cells.map((c) => cellToXY(g, c)), ...key]);
    const pad = Math.max(60, 0.05 * Math.max(x1 - x0, y1 - y0));
    const [pt, pr, pb, pl] = this.fitPadding();
    const availW = Math.max(120, size[0] - pl - pr), availH = Math.max(120, size[1] - pt - pb);
    const view = this.map.getView();
    const resFit = Math.max((x1 - x0 + 2 * pad) / availW, (y1 - y0 + 2 * pad) / availH);
    const res = Math.max(view.getMinResolution(), Math.min(resFit, this.coverResolution()));
    let [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    if (resFit > res && key.length) {
      // Doesn't fit at this zoom: centre on the base, stop(s) and label instead of the whole route.
      const [kx0, ky0, kx1, ky1] = bounds(key);
      [cx, cy] = [(kx0 + kx1) / 2, (ky0 + ky1) / 2];
    }
    // Put that point in the middle of the free area (not the middle of the map).
    const center = [cx - ((pl - pr) / 2) * res, cy + ((pt - pb) / 2) * res];
    // Keep the window inside the study area (no black void), whatever the route does.
    const [ax0, ay0, ax1, ay1] = gridExtent(g);
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    center[0] = clamp(center[0], ax0 + (size[0] * res) / 2, ax1 - (size[0] * res) / 2);
    center[1] = clamp(center[1], ay0 + (size[1] * res) / 2, ay1 - (size[1] * res) / 2);
    if (duration > 0) view.animate({ center, resolution: res, duration });
    else { view.setResolution(res); view.setCenter(center); }
  }

  setPlan(plan: PlanResult | null, stateOf: (id: string) => { state: StationState; order?: number }) {
    const g = this.pack.manifest.grid;
    const cells: number[] = [];
    for (const s of plan?.segments ?? []) for (const c of s.cells) cells.push(c);
    this.routeCells = cells;
    setRoute(this.routeLayer, routeCoords(g, cells));
    this.refreshStations(stateOf);
  }

  refreshStations(stateOf: (id: string) => { state: StationState; order?: number }) {
    setStations(this.stationsLayer, [...this.pack.manifest.stations, ...this.extraStations], stateOf);
  }

  private extraStations: Pick<Station, 'id' | 'name' | 'x' | 'y' | 'value'>[] = [];
  /** Custom stops (not in the site pack) drawn with the pack's stations. */
  setExtraStations(list: Pick<Station, 'id' | 'name' | 'x' | 'y' | 'value'>[]) {
    this.extraStations = list;
  }

  /** Marks the chosen start base with an "A" badge. */
  setBaseA(id: string | null) {
    const src = this.shelters.layer.getSource()!;
    src.getFeatures().forEach((f) => f.set('isA', f.get('id') === id));
  }

  setShelter(id: string, cell: Cell) {
    this.shelters.setShelter(id, cell);
  }

  setHazards(cells: Cell[]) {
    const g = this.pack.manifest.grid;
    // One marker per reported hazard cluster (cells within 30 m collapse).
    const pts: [number, number][] = [];
    for (const c of cells) {
      const p = cellToXY(g, c);
      if (!pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 30)) pts.push(p);
    }
    setHazards(this.hazards, pts);
  }

  /** EVA live: keep the crew in view (pans only when they leave the middle of the map). */
  followCrew(cell: Cell) {
    const g = this.pack.manifest.grid;
    const size = this.map.getSize();
    if (!size) return;
    const xy = cellToXY(g, cell);
    const px = this.map.getPixelFromCoordinate(xy);
    if (!px) return;
    const mx = size[0] * 0.25, my = size[1] * 0.25;
    if (px[0] < mx || px[0] > size[0] - mx || px[1] < my || px[1] > size[1] - my) {
      this.map.getView().animate({ center: xy, duration: 600 });
    }
  }

  setTelemetry(telem: Telem[]) {
    const g = this.pack.manifest.grid;
    const last = telem[telem.length - 1];
    if (!last) {
      setAstronaut(this.astronaut, null);
      return;
    }
    const [x, y] = cellToXY(g, last.cell);
    setAstronaut(this.astronaut, { x, y, sigmaM: last.sigmaM, headingDeg: last.headingDeg, track: telem.map((t) => cellToXY(g, t.cell)) });
  }

  private tween(ms: number, token: number, fn: (t: number) => void, ease = easeInOut): Promise<boolean> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now: number) => {
        if (token !== this.animToken) return resolve(false);
        const t = Math.min(1, (now - t0) / ms);
        fn(ease(t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }

  private setVars(p: Partial<SafeZoneVars>) {
    this.vars = { ...this.vars, ...p };
    this.safe?.updateStyleVariables(p as Record<string, number>);
    if (!this.gl) this.scheduleCanvas();
  }

  /**
   * "Explain safe zone": apply each hard rule in turn (~1.2 s each) by animating one style
   * variable; cells the active rule removes flash amber, then fade into the veil. Finally the
   * outline appears and the route draws itself inside.
   */
  async explain(steps: ExplainStep[], onStep: (i: number) => void, stepMs = 1200): Promise<boolean> {
    if ((!this.safe && !this.safeCanvas) || !this.limits) return false;
    const token = ++this.animToken;
    cancelAnimationFrame(this.morphRaf);
    this.explaining = true;
    this.contourWasVisible = this.contour.getVisible();
    this.contour.setVisible(false);
    this.setOverlays(this.overlayState.ids, this.overlayState.opacity);
    setOutline(this.outline, []);
    setRouteProgress(this.routeLayer, 0);
    this.setVars({ ...SAFE_ZONE_OPEN, morph: 1 });
    await this.tween(250, token, () => {});
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (token !== this.animToken) break;
      onStep(i + 1);
      this.setVars({ ...(s.set ?? {}), act: s.act, actGlow: 1, [s.key]: s.from });
      const ok = await this.tween(stepMs, token, (t) => this.setVars({ [s.key]: s.from + (s.to - s.from) * t }), s.key === 'blockedOn' ? (t) => (t > 0.15 ? 1 : 0) : easeOutCubic);
      if (!ok) break;
      await this.tween(380, token, (t) => this.setVars({ actGlow: 1 - t }));
    }
    if (token !== this.animToken) return false;
    this.setVars({ act: 0, actGlow: 0, ...toVars(this.limits) });
    this.refreshOutline();
    onStep(7);
    await this.tween(1700, token, (t) => setRouteProgress(this.routeLayer, t), (t) => t);
    setRouteProgress(this.routeLayer, 1);
    this.explaining = false;
    this.contour.setVisible(this.contourWasVisible);
    this.setOverlays(this.overlayState.ids, this.overlayState.opacity);
    return token === this.animToken;
  }

  cancelExplain() {
    this.animToken++;
    if (this.explaining) this.contour.setVisible(this.contourWasVisible);
    this.explaining = false;
    if (this.limits) this.setVars({ act: 0, actGlow: 0, morph: 1, ...toVars(this.limits) });
    setRouteProgress(this.routeLayer, 1);
    this.refreshOutline();
    this.setOverlays(this.overlayState.ids, this.overlayState.opacity);
  }

  dispose() {
    this.animToken++;
    cancelAnimationFrame(this.morphRaf);
    this.offReadout();
    this.offScale?.();
    for (const l of this.map.getLayers().getArray().slice()) l.dispose?.();
    this.map.setTarget(undefined);
  }
}
