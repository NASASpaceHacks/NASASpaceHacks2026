import { useEffect, useRef, useState } from 'react';
import { fmtLonLat, sampleBilinear, type Area } from './data';
import type { Pt } from './types';

export interface RasterLayer { key: string; src: CanvasImageSource; opacity: number; smooth?: boolean; blend?: GlobalCompositeOperation }

export interface View { cx: number; cy: number; scale: number } // world centre (grid units) and px per grid unit

export interface DrawCtx {
  g: CanvasRenderingContext2D;
  toS: (p: Pt) => [number, number];
  scale: number;        // screen px per grid cell
  w: number; h: number;
}

interface Props {
  area: Area;
  rasters: RasterLayer[];
  draw?: (d: DrawCtx) => void;
  onClick?: (p: Pt, e: MouseEvent) => void;
  onDblClick?: (p: Pt) => void;
  /** Return true to capture a drag starting at p (e.g. moving a stop); then onDrag receives positions. */
  onDragStart?: (p: Pt) => boolean;
  onDrag?: (p: Pt, done: boolean) => void;
  view?: View;          // controlled view (HUD minimap); otherwise user pans/zooms
  cursor?: string;
  showReadout?: boolean;
  redrawKey?: unknown;
  background?: string;
}

export function MapView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const drag = useRef<{ x: number; y: number; v: View; moved: boolean; capture: boolean } | null>(null);
  const v = p.view ?? view;

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Keep the whole area fitted on resize until the user pans or zooms.
  const touched = useRef(false);
  useEffect(() => {
    if ((!view || !touched.current) && size.w > 10) setView({ cx: p.area.n / 2, cy: p.area.n / 2, scale: (Math.min(size.w, size.h) / p.area.n) * 0.96 });
  }, [size, p.area.n]); // eslint-disable-line

  const toW = (sx: number, sy: number, vv: View): Pt => ({ x: vv.cx + (sx - size.w / 2) / vv.scale, y: vv.cy + (sy - size.h / 2) / vv.scale });

  useEffect(() => {
    const c = cv.current;
    if (!c || !v) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = p.background ?? '#0b0d10';
    g.fillRect(0, 0, size.w, size.h);
    const n = p.area.n;
    const ox = size.w / 2 - v.cx * v.scale, oy = size.h / 2 - v.cy * v.scale;
    for (const r of p.rasters) {
      if (r.opacity <= 0) continue;
      g.save();
      g.globalAlpha = r.opacity;
      g.globalCompositeOperation = r.blend ?? 'source-over';
      g.imageSmoothingEnabled = r.smooth ?? v.scale < 4;
      g.drawImage(r.src, ox, oy, n * v.scale, n * v.scale);
      g.restore();
    }
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.strokeRect(ox, oy, n * v.scale, n * v.scale);
    p.draw?.({ g, toS: (q) => [ox + q.x * v.scale, oy + q.y * v.scale], scale: v.scale, w: size.w, h: size.h });
  });

  const evPt = (e: React.MouseEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  return (
    <div ref={wrap} className="mapview" style={{ cursor: p.cursor }}>
      <canvas
        ref={cv}
        style={{ width: size.w, height: size.h, display: 'block' }}
        onWheel={(e) => {
          if (p.view || !v) return;
          touched.current = true;
          const { sx, sy } = evPt(e);
          const before = toW(sx, sy, v);
          const scale = Math.min(40, Math.max(0.3, v.scale * Math.exp(-e.deltaY * 0.0015)));
          setView({ scale, cx: before.x - (sx - size.w / 2) / scale, cy: before.y - (sy - size.h / 2) / scale });
        }}
        onMouseDown={(e) => {
          if (!v) return;
          const { sx, sy } = evPt(e);
          const capture = !!p.onDragStart?.(toW(sx, sy, v));
          drag.current = { x: sx, y: sy, v, moved: false, capture };
        }}
        onMouseMove={(e) => {
          if (!v) return;
          const { sx, sy } = evPt(e);
          setHover(toW(sx, sy, v));
          const d = drag.current;
          if (!d) return;
          if (Math.hypot(sx - d.x, sy - d.y) > 3) d.moved = true;
          if (d.capture) p.onDrag?.(toW(sx, sy, v), false);
          else if (d.moved && !p.view) touched.current = true, setView({ ...d.v, cx: d.v.cx - (sx - d.x) / d.v.scale, cy: d.v.cy - (sy - d.y) / d.v.scale });
        }}
        onMouseUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || !v) return;
          const { sx, sy } = evPt(e);
          if (d.capture) p.onDrag?.(toW(sx, sy, v), true);
          else if (!d.moved) p.onClick?.(toW(sx, sy, v), e.nativeEvent);
        }}
        onMouseLeave={() => { setHover(null); }}
        onDoubleClick={(e) => { if (v) { const { sx, sy } = evPt(e); p.onDblClick?.(toW(sx, sy, v)); } }}
      />
      {p.showReadout && hover && hover.x >= 0 && hover.y >= 0 && hover.x < p.area.n && hover.y < p.area.n && (
        <div className="readout">
          {fmtLonLat(p.area, hover)} · z {sampleBilinear(p.area, p.area.elev, hover).toFixed(1)} m · slope{' '}
          {p.area.slope[Math.floor(hover.y) * p.area.n + Math.floor(hover.x)].toFixed(1)}° · rough{' '}
          {p.area.rough[Math.floor(hover.y) * p.area.n + Math.floor(hover.x)]} cm
        </div>
      )}
      {!p.view && v && <ScaleBar area={p.area} scale={v.scale} />}
      {!p.view && (
        <button className="fit" title="Fit area" onClick={() => (touched.current = false, setView({ cx: p.area.n / 2, cy: p.area.n / 2, scale: (Math.min(size.w, size.h) / p.area.n) * 0.96 }))}>⤢</button>
      )}
    </div>
  );
}

function ScaleBar({ area, scale }: { area: Area; scale: number }) {
  const pxPerM = scale / area.dyM;
  const nice = [5, 10, 20, 50, 100, 200, 500].find((m) => m * pxPerM > 60) ?? 500;
  return (
    <div className="scalebar">
      <div style={{ width: nice * pxPerM }} />
      <span>{nice} m</span>
      <b>N↑</b>
    </div>
  );
}

/** Draw a polyline of grid points. */
export function polyline(d: DrawCtx, pts: Pt[], style: string, width: number, dash: number[] = []) {
  if (pts.length < 2) return;
  const g = d.g;
  g.save();
  g.strokeStyle = style; g.lineWidth = width; g.setLineDash(dash); g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  pts.forEach((q, k) => { const [x, y] = d.toS(q); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
  g.stroke();
  g.restore();
}
