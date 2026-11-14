import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import { Polygon } from 'ol/geom';
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
  DEM_TINT,
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

export interface MapCallbacks {
  onShelterMoved(id: string, cell: Cell): void;
  onClick(cell: Cell, stationId: string | null, extra?: { shelterId: string | null; pixel: [number, number] }): void;
  onReadout(r: CursorReadout | null): void;
  onHoverStation(id: string | null, pixel: [number, number] | null): void;
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
      if (pack.rasters.ti) {
        this.fieldLayers.ti = createFieldLayer({ grid: g, projection: this.proj, bands: [{ data: pack.rasters.ti }], style: rampStyle(TI_RAMP), visible: false, className: 'mw-f-ti' });
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

    const span = Math.max(ext[2] - ext[0], ext[3] - ext[1]);
    const pad = span * 0.35;
    this.map = new OlMap({
      target,
      controls: [],
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false }).extend([this.shelters.translate]),
      layers: [
        ...(this.imagery ? [this.imagery] : []),
        (this.hillshade ?? this.hillCanvas)!,
        ...(['ti', 'slope'] as OverlayId[]).map((k) => this.fieldLayers[k]).filter((x): x is WebGLTileLayer => !!x),
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
      ],
      view: new View({
        projection: this.proj,
        center: [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2],
        resolution: g.cellM,
        maxResolution: g.cellM * 6,
        minResolution: 0.2,
        extent: [ext[0] - pad, ext[1] - pad, ext[2] + pad, ext[3] + pad],
        constrainOnlyCenter: true,
        enableRotation: false,
      }),
    });

    this.offReadout = attachCursorReadout(this.map, g, { dem: pack.rasters.dem, slope: pack.rasters.slope }, (r) => this.cb.onReadout(r));

    this.map.on('singleclick', (e) => {
      const cell = xyToCell(g, e.coordinate[0], e.coordinate[1]);
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
    this.map.on('pointermove', (e) => {
      if (e.dragging) return;
      let station: string | null = null;
      let stationXY: number[] | null = null;
      const hit = this.map.forEachFeatureAtPixel(
        e.pixel,
        (f, layer) => {
          if (layer === this.stationsLayer) {
            station = f.get('id') as string;
            stationXY = (f.getGeometry() as unknown as { getCoordinates(): number[] }).getCoordinates();
          }
          return f.get('movable') ? 'grab' : f.get('id') ? 'pointer' : null;
        },
        { layerFilter: (l) => l === this.shelters.layer || l === this.stationsLayer, hitTolerance: 6 },
      );
      const vp = this.map.getViewport();
      if (vp) vp.style.cursor = hit ?? '';
      if (station !== hovered) {
        hovered = station;
        const px = stationXY ? (this.map.getPixelFromCoordinate(stationXY) as [number, number]) : null;
        this.cb.onHoverStation(station, px);
      }
    });
    this.map.on('movestart', () => {
      if (hovered) {
        hovered = null;
        this.cb.onHoverStation(null, null);
      }
    });
  }

  attachScale(el: HTMLElement) {
    this.offScale?.();
    this.offScale = attachScaleBar(this.map, el, 110);
  }

  fit(duration = 450) {
    const g = this.pack.manifest.grid;
    const size = this.map.getSize();
    if (!size) return;
    this.map.getView().fit(gridExtent(g), { padding: [72, 36, 64, 36], duration });
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
      else if (act) { out[o] = 242; out[o + 1] = 181; out[o + 2] = 68; out[o + 3] = 128; }
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

  /** Zoom to the current route and its stations (falls back to the whole AOI). */
  fitRoute(duration = 450) {
    const g = this.pack.manifest.grid;
    if (!this.routeCells.length) return this.fit(duration);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this.routeCells) {
      const [x, y] = cellToXY(g, c);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const pad = Math.max(250, 0.35 * Math.max(x1 - x0, y1 - y0));
    this.map.getView().fit([x0 - pad, y0 - pad, x1 + pad, y1 + pad], { padding: [72, 36, 64, 36], duration });
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
