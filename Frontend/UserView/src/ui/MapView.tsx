/**
 * Heading-up moving map (OpenLayers). Minimal layers: terrain isolines, comm shadow, keep-outs,
 * safe-zone boundary, route done/ahead, stops, range rings, own position + 1-σ uncertainty ellipse.
 * An SVG overlay draws the ARC-mode compass rose (rotates with the simulated track).
 */
import { useEffect, useRef } from 'react';
import { shelterLabel } from '../core/route';
import OLMap from 'ol/Map';
import View from 'ol/View';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import LineString from 'ol/geom/LineString';
import MultiPolygon from 'ol/geom/MultiPolygon';
import Polygon from 'ol/geom/Polygon';
import Point from 'ol/geom/Point';
import CircleGeom from 'ol/geom/Circle';
import { Fill, Icon, RegularShape, Stroke, Style, Text } from 'ol/style';
import CircleStyle from 'ol/style/Circle';
import type { FeatureLike } from 'ol/Feature';
import { registerMarsProjection } from '../adapters/map';
import type { VisorController } from '../core/visor';
import { useVisor, type Snapshot } from '../state/store';
import { hdg } from './format';

export const MAP_W = 1100;
export const MAP_H = 896;
const OWN_Y = 0.7; // ownship at 70 % of the panel height
const ROSE_R = MAP_H * 0.62;
const RES = 0.8; // m per px
const D2R = Math.PI / 180;

const G = '#4dff94', G2 = '#33c46f', G3 = '#1d7a45', A = '#ffb627', C = '#4ee6ff', R = '#ff4534';
const FONT = (px: number) => `700 ${px}px "B612", "DIN Alternate", "Bahnschrift", "Arial Narrow", sans-serif`;

function hatch(color: string, gap = 16, width = 2): CanvasPattern | string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = gap;
  const ctx = cv.getContext('2d');
  if (!ctx) return color;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(0, gap);
  ctx.lineTo(gap, 0);
  ctx.moveTo(-gap / 2, gap / 2);
  ctx.lineTo(gap / 2, -gap / 2);
  ctx.moveTo(gap / 2, gap * 1.5);
  ctx.lineTo(gap * 1.5, gap / 2);
  ctx.stroke();
  return ctx.createPattern(cv, 'repeat') ?? color;
}

const ownIcon =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 4 L54 56 L32 44 L10 56 Z" fill="#f2fff7" stroke="#000" stroke-width="4" stroke-linejoin="round"/></svg>`,
  );

const textStyle = (text: string, color: string, px: number, offsetY = 0, offsetX = 0) =>
  new Text({ text, font: FONT(px), fill: new Fill({ color }), stroke: new Stroke({ color: '#000', width: 6 }), offsetY, offsetX });

function stopStyle(f: FeatureLike): Style | Style[] {
  const kind = f.get('kind') as string;
  const id = f.get('id') as string;
  if (kind === 'next')
    return new Style({
      image: new RegularShape({ points: 4, radius: 20, angle: 0, fill: new Fill({ color: A }), stroke: new Stroke({ color: '#000', width: 3 }) }),
      text: textStyle(id, A, 28, -40),
      zIndex: 10,
    });
  if (kind === 'upcoming')
    return new Style({
      image: new RegularShape({ points: 4, radius: 14, angle: 0, stroke: new Stroke({ color: A, width: 3 }), fill: new Fill({ color: 'rgba(0,0,0,0.6)' }) }),
      text: textStyle(id, A, 22, -32),
      zIndex: 8,
    });
  if (kind === 'visited')
    return new Style({
      image: new RegularShape({ points: 4, radius: 11, angle: 0, stroke: new Stroke({ color: G3, width: 3 }) }),
      text: textStyle(id, G3, 20, -28),
      zIndex: 6,
    });
  if (kind === 'home')
    return new Style({
      image: new RegularShape({ points: 4, radius: 20, angle: Math.PI / 4, stroke: new Stroke({ color: C, width: 4 }), fill: new Fill({ color: 'rgba(78,230,255,0.15)' }) }),
      text: textStyle(id, C, 24, 36),
      zIndex: 9,
    });
  return new Style({
    image: new CircleStyle({ radius: 13, stroke: new Stroke({ color: C, width: 3 }), fill: new Fill({ color: 'rgba(78,230,255,0.10)' }) }),
    text: textStyle(id, C, 20, 32),
    zIndex: 7,
  });
}

interface MapCtx {
  map: OLMap;
  view: View;
  src: Record<'dem' | 'shadow' | 'keep' | 'zone' | 'done' | 'ahead' | 'later' | 'stops' | 'rings' | 'own' | 'leader', VectorSource>;
  own: Feature<Point>;
  ellipse: Feature<Polygon>;
  done: Feature<LineString>;
  ahead: Feature<LineString>;
  later: Feature<LineString>;
  leader: Feature<LineString>;
  rings: Feature<CircleGeom>[];
  ringLabels: Feature<Point>[];
  versions: { route: number; zone: number; layers: number };
}

function buildMap(target: HTMLDivElement, ctl: VisorController): MapCtx | null {
  const L = ctl.getMapLayers();
  if (!L) return null;
  const proj = registerMarsProjection(L.grid);
  const src = {
    dem: new VectorSource(), shadow: new VectorSource(), keep: new VectorSource(), zone: new VectorSource(), done: new VectorSource(),
    ahead: new VectorSource(), later: new VectorSource(), stops: new VectorSource(), rings: new VectorSource(), own: new VectorSource(), leader: new VectorSource(),
  };
  const vl = (source: VectorSource, style: Style | Style[] | ((f: FeatureLike) => Style | Style[]), z: number) =>
    new VectorLayer({ source, style, zIndex: z, updateWhileAnimating: true, updateWhileInteracting: true });
  const demMinor = new Style({ stroke: new Stroke({ color: 'rgba(77,255,148,0.13)', width: 2 }) });
  const demMajor = new Style({ stroke: new Stroke({ color: 'rgba(77,255,148,0.28)', width: 2 }) });
  const shadowStyle = new Style({ fill: new Fill({ color: hatch('rgba(255,182,39,0.30)', 18, 2) }), stroke: new Stroke({ color: 'rgba(255,182,39,0.45)', width: 2, lineDash: [6, 8] }) });
  const keepFill = hatch('rgba(255,69,52,0.45)', 14, 2);
  const zoneStyle = [
    new Style({ stroke: new Stroke({ color: 'rgba(0,0,0,0.9)', width: 8 }) }),
    new Style({ stroke: new Stroke({ color: C, width: 3, lineDash: [18, 12] }) }),
  ];
  const aheadStyle = [
    new Style({ stroke: new Stroke({ color: '#000', width: 16, lineCap: 'round', lineJoin: 'round' }), zIndex: 1 }),
    new Style({ stroke: new Stroke({ color: G, width: 7, lineCap: 'round', lineJoin: 'round' }), zIndex: 2 }),
  ];
  const laterStyle = [
    new Style({ stroke: new Stroke({ color: '#000', width: 10, lineCap: 'round', lineJoin: 'round' }), zIndex: 1 }),
    new Style({ stroke: new Stroke({ color: 'rgba(51,196,111,0.55)', width: 4, lineCap: 'round', lineJoin: 'round' }), zIndex: 2 }),
  ];
  const doneStyle = new Style({ stroke: new Stroke({ color: G3, width: 4, lineDash: [3, 12], lineCap: 'round' }) });
  const ringStyle = new Style({ stroke: new Stroke({ color: 'rgba(77,255,148,0.38)', width: 2, lineDash: [6, 10] }) });
  const leaderStyle = new Style({ stroke: new Stroke({ color: 'rgba(255,182,39,0.75)', width: 2, lineDash: [4, 10] }) });

  const map = new OLMap({
    target,
    controls: [],
    interactions: [],
    pixelRatio: Math.max(1, window.devicePixelRatio || 1),
    layers: [
      vl(src.dem, (f) => (f.get('major') ? demMajor : demMinor), 1),
      vl(src.shadow, shadowStyle, 2),
      vl(src.keep, (f) => new Style({ fill: new Fill({ color: keepFill }), stroke: new Stroke({ color: R, width: 3 }), text: textStyle(String(f.get('label') ?? 'KEEP-OUT'), R, 20) }), 3),
      vl(src.zone, zoneStyle, 4),
      vl(src.rings, (f) => (f.get('label') ? new Style({ text: textStyle(String(f.get('label')), G2, 20) }) : ringStyle), 5),
      vl(src.done, doneStyle, 6),
      vl(src.later, laterStyle, 7),
      vl(src.leader, leaderStyle, 7),
      vl(src.ahead, aheadStyle, 8),
      vl(src.stops, stopStyle, 9),
      vl(src.own, (f) =>
        f.get('k') === 'ellipse'
          ? new Style({ fill: new Fill({ color: 'rgba(77,255,148,0.10)' }), stroke: new Stroke({ color: G2, width: 2 }) })
          : new Style({ image: new Icon({ src: ownIcon, width: 52, height: 52, rotateWithView: false }) }), 10),
    ],
    view: new View({ projection: proj, center: [L.grid.originX + (L.grid.w * L.grid.cellM) / 2, L.grid.originY - (L.grid.h * L.grid.cellM) / 2], resolution: RES, rotation: 0 }),
  });
  const own = new Feature(new Point([0, 0]));
  const ellipse = new Feature(new Polygon([[[0, 0], [0, 0], [0, 0]]]));
  ellipse.set('k', 'ellipse');
  src.own.addFeatures([ellipse, own]);
  const done = new Feature(new LineString([]));
  const ahead = new Feature(new LineString([]));
  const later = new Feature(new LineString([]));
  src.later.addFeature(later);
  const leader = new Feature(new LineString([]));
  src.done.addFeature(done);
  src.ahead.addFeature(ahead);
  src.leader.addFeature(leader);
  const rings = [100, 250, 500].map(() => new Feature(new CircleGeom([0, 0], 1)));
  const ringLabels = [100, 250, 500].map((r) => {
    const f = new Feature(new Point([0, 0]));
    f.set('label', `${r}`);
    return f;
  });
  src.rings.addFeatures([...rings, ...ringLabels]);
  return { map, view: map.getView(), src, own, ellipse, done, ahead, later, leader, rings, ringLabels, versions: { route: -1, zone: -1, layers: -1 } };
}

function syncStatic(m: MapCtx, ctl: VisorController, s: Snapshot) {
  const L = ctl.getMapLayers();
  if (L && s.versions.layers !== m.versions.layers) {
    m.versions.layers = s.versions.layers;
    m.src.dem.clear();
    m.src.dem.addFeatures(
      L.demIso.map((iso) => {
        const f = new Feature(new MultiPolygon(iso.polys));
        f.set('major', Math.round(iso.value) % 50 === 0);
        return f;
      }),
    );
    m.src.shadow.clear();
    m.src.shadow.addFeatures(L.shadowIso.map((iso) => new Feature(new MultiPolygon(iso.polys))));
    m.src.keep.clear();
    m.src.keep.addFeatures(
      L.keepouts.map((k) => {
        const f = new Feature(new Polygon(k.rings));
        f.set('label', 'KEEP-OUT');
        return f;
      }),
    );
  }
  if (s.versions.zone !== m.versions.zone) {
    m.versions.zone = s.versions.zone;
    m.src.zone.clear();
    m.src.zone.addFeatures(ctl.zone.map((iso) => new Feature(new MultiPolygon(iso.polys))));
  }
}

function syncDynamic(m: MapCtx, ctl: VisorController, s: Snapshot) {
  const route = ctl.route, sim = ctl.sim, L = ctl.getMapLayers();
  // Stops (kinds change as the crew progresses).
  m.src.stops.clear();
  const feats: Feature[] = [];
  if (route && sim) {
    route.stops.forEach((st, k) => {
      const f = new Feature(new Point([st.x, st.y]));
      f.set('id', st.id);
      f.set('kind', sim.visited.includes(st.id) ? 'visited' : k === sim.stopK && sim.mode !== 'RETURN' ? 'next' : 'upcoming');
      feats.push(f);
    });
    const h = new Feature(new Point([route.home.x, route.home.y]));
    h.set('id', route.home.name);
    h.set('kind', 'home');
    feats.push(h);
  }
  for (const sh of L?.shelters ?? []) {
    if (route && (sh.cell === route.home.cell || sh.id === route.home.id)) continue; // home drawn at the route end (rover may have moved)
    const f = new Feature(new Point([sh.x, sh.y]));
    f.set('id', shelterLabel(sh));
    f.set('kind', sh.kind === 'hab' ? 'home' : 'shelter');
    feats.push(f);
  }
  m.src.stops.addFeatures(feats);

  if (route && sim) {
    if (sim.mode === 'RETURN') {
      const end = sim.returnDir > 0 ? route.length : 0;
      m.ahead.getGeometry()!.setCoordinates(sim.returnDir > 0 ? route.slice(sim.s, end) : route.slice(end, sim.s).reverse());
      m.done.getGeometry()!.setCoordinates(sim.returnDir > 0 ? route.slice(0, sim.s) : route.slice(sim.s, route.length));
      m.later.getGeometry()!.setCoordinates([]);
    } else {
      // Current leg bright, later legs dim, walked track dotted.
      const st = route.stops[sim.stopK];
      const legEnd = st ? st.s : route.length;
      m.ahead.getGeometry()!.setCoordinates(route.slice(sim.s, legEnd));
      m.later.getGeometry()!.setCoordinates(legEnd < route.length ? route.slice(legEnd, route.length) : []);
      m.done.getGeometry()!.setCoordinates(route.slice(0, sim.s));
    }
  } else {
    m.ahead.getGeometry()!.setCoordinates([]);
    m.later.getGeometry()!.setCoordinates([]);
    m.done.getGeometry()!.setCoordinates([]);
  }
  if (s.est && s.next && route && sim && sim.mode === 'WALK') {
    const st = route.stops[sim.stopK];
    const tgt: [number, number] = st ? [st.x, st.y] : [route.home.x, route.home.y];
    m.leader.getGeometry()!.setCoordinates([s.est, tgt]);
  } else m.leader.getGeometry()!.setCoordinates([]);
}

/** Uncertainty ellipse: 1σ along-track, 0.6σ cross-track (heading-error smaller than pace-count error). */
function ellipseRing(x: number, y: number, sigma: number, headingDeg: number): [number, number][] {
  const a = Math.max(2, sigma), b = Math.max(2, sigma * 0.6);
  const th = headingDeg * D2R;
  const ux = Math.sin(th), uy = Math.cos(th); // along-track unit (x east, y north)
  const vx = uy, vy = -ux;
  const out: [number, number][] = [];
  for (let k = 0; k <= 48; k++) {
    const t = (k / 48) * Math.PI * 2;
    const p = a * Math.cos(t), q = b * Math.sin(t);
    out.push([x + p * ux + q * vx, y + p * uy + q * vy]);
  }
  return out;
}

export function MapView({ ctl }: { ctl: VisorController }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const roseRef = useRef<SVGGElement>(null);
  const bugRef = useRef<SVGGElement>(null);
  const hdgRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    let m: MapCtx | null = null;
    let raf = 0;
    let last = performance.now();
    const sm = { h: NaN, x: NaN, y: NaN, sigma: 0, bug: NaN };
    let tgt = { h: 0, x: NaN, y: NaN, sigma: 0, bug: NaN as number };

    const onSnap = (s: Snapshot) => {
      if (!m && mapEl.current && s.versions.layers > 0) m = buildMap(mapEl.current, ctl);
      if (!m) return;
      syncStatic(m, ctl, s);
      syncDynamic(m, ctl, s);
      if (s.est) tgt = { h: s.headingDeg, x: s.est[0], y: s.est[1], sigma: s.sigmaM, bug: s.next ? s.next.relDeg : NaN };
      else {
        const L = ctl.getMapLayers();
        const hab = L?.shelters.find((x) => x.kind === 'hab');
        if (hab) tgt = { h: 0, x: hab.x, y: hab.y, sigma: 0, bug: NaN };
      }
    };
    onSnap(useVisor.getState().snap);
    const unsub = useVisor.subscribe((st) => onSnap(st.snap));

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      if (!m || !Number.isFinite(tgt.x)) return;
      const k = 1 - Math.exp(-dt / 0.22);
      if (!Number.isFinite(sm.x)) Object.assign(sm, { h: tgt.h, x: tgt.x, y: tgt.y, sigma: tgt.sigma });
      const dh = ((((tgt.h - sm.h) % 360) + 540) % 360) - 180;
      sm.h = (sm.h + dh * k + 360) % 360;
      if (Math.hypot(tgt.x - sm.x, tgt.y - sm.y) > 200) { sm.x = tgt.x; sm.y = tgt.y; }
      sm.x += (tgt.x - sm.x) * k;
      sm.y += (tgt.y - sm.y) * k;
      sm.sigma += (tgt.sigma - sm.sigma) * k;
      const th = sm.h * D2R;
      const off = (OWN_Y - 0.5) * MAP_H * RES;
      m.view.setRotation(-th);
      m.view.setCenter([sm.x + Math.sin(th) * off, sm.y + Math.cos(th) * off]);
      m.own.getGeometry()!.setCoordinates([sm.x, sm.y]);
      m.ellipse.getGeometry()!.setCoordinates([ellipseRing(sm.x, sm.y, sm.sigma, sm.h)]);
      [100, 250, 500].forEach((r, i) => {
        m!.rings[i].getGeometry()!.setCenterAndRadius([sm.x, sm.y], r);
        // ring label just right of the track line, upright on screen
        const a = th + 0.22;
        m!.ringLabels[i].getGeometry()!.setCoordinates([sm.x + Math.sin(a) * r, sm.y + Math.cos(a) * r]);
      });
      if (roseRef.current) roseRef.current.setAttribute('transform', `rotate(${-sm.h} ${MAP_W / 2} ${MAP_H * OWN_Y})`);
      if (hdgRef.current) hdgRef.current.textContent = `${hdg(sm.h)}°`;
      if (bugRef.current) {
        if (Number.isFinite(tgt.bug)) {
          if (!Number.isFinite(sm.bug)) sm.bug = tgt.bug;
          const db = ((((tgt.bug - sm.bug) % 360) + 540) % 360) - 180;
          sm.bug = (sm.bug + db * k + 360) % 360;
          bugRef.current.setAttribute('transform', `rotate(${sm.bug} ${MAP_W / 2} ${MAP_H * OWN_Y})`);
          bugRef.current.style.display = '';
        } else bugRef.current.style.display = 'none';
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      m?.map.setTarget(undefined);
    };
  }, [ctl]);

  const cx = MAP_W / 2, cy = MAP_H * OWN_Y;
  const ticks = [];
  for (let d = 0; d < 360; d += 5) {
    const major = d % 10 === 0;
    const r1 = ROSE_R, r2 = ROSE_R - (d % 30 === 0 ? 26 : major ? 16 : 9);
    const s = Math.sin(d * D2R), c = Math.cos(d * D2R);
    ticks.push(<line key={d} x1={cx + r1 * s} y1={cy - r1 * c} x2={cx + r2 * s} y2={cy - r2 * c} stroke={d % 30 === 0 ? G : G2} strokeWidth={d % 30 === 0 ? 3 : 2} />);
    if (d % 30 === 0) {
      const lr = ROSE_R - 50;
      const lab = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
      ticks.push(
        <text key={`t${d}`} x={cx + lr * s} y={cy - lr * c + 10} textAnchor="middle" fill={d % 90 === 0 ? G : G2} fontSize={d % 90 === 0 ? 30 : 24} className="num" transform={`rotate(${d} ${cx + lr * s} ${cy - lr * c})`}>
          {lab}
        </text>,
      );
    }
  }

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#000' }}>
      <div ref={mapEl} className="absolute inset-0" />
      <svg className="absolute inset-0 pointer-events-none" width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
        <defs>
          <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.85" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={MAP_W} height={110} fill="url(#fadeTop)" />
        <g ref={roseRef}>{ticks}</g>
        {/* next-stop bearing bug on the rose */}
        <g ref={bugRef} style={{ display: 'none' }}>
          <path d={`M ${cx} ${cy - ROSE_R - 2} l 16 -22 l -16 -10 l -16 10 Z`} fill={A} stroke="#000" strokeWidth={3} />
        </g>
        {/* lubber line + track box */}
        <path d={`M ${cx - 16} ${cy - ROSE_R + 30} L ${cx + 16} ${cy - ROSE_R + 30} L ${cx} ${cy - ROSE_R + 4} Z`} fill="var(--w)" />
        <rect x={cx - 96} y={8} width={192} height={58} fill="#000" stroke="var(--w)" strokeWidth={3} />
        <text x={cx - 82} y={48} fill="var(--g2)" fontSize={22} className="lbl">
          TRK
        </text>
        <text ref={hdgRef} x={cx + 82} y={51} textAnchor="end" fill="var(--w)" fontSize={38} className="num">
          000°
        </text>
      </svg>
    </div>
  );
}
