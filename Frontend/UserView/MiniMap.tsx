import { useEffect, useRef } from 'react';
import { cellPt, type Area } from '../shared/data';
import type { Pt } from '../shared/types';
import { currentLeg, type Ctx, type Guidance, type SimState } from './sim';

interface Props {
  ctx: Ctx; s: SimState; g: Guidance;
  size: number;
  headingUp: boolean;
  fg: string; warn: string; dim: string;
  rangeM?: number;           // fixed range; otherwise auto-scales to the next waypoint
  terrain?: boolean;         // draw hillshade backdrop (map page)
}

const NICE = [10, 20, 30, 50, 75, 100, 150, 200, 300, 500];

/** Auto-scaling, heading-up moving map with range rings (crew asked for auto-scale and range ticks). */
export function MiniMap(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const range = p.rangeM ?? (NICE.find((r) => r >= p.g.distTarget * 1.15) ?? 500);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = p.size * dpr; c.height = p.size * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a: Area = p.ctx.area;
    const R = p.size / 2 - 4, cx = p.size / 2, cy = p.size / 2;
    const k = R / range;
    const est = p.g.est;
    const rot = p.headingUp ? (p.s.heading * Math.PI) / 180 : 0; // screen-up = forward
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const toS = (q: Pt): [number, number] => {
      const e = (q.x - est.x) * a.dxM, n = -(q.y - est.y) * a.dyM;
      return [cx + (e * cos - n * sin) * k, cy - (e * sin + n * cos) * k];
    };
    g.clearRect(0, 0, p.size, p.size);
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, p.size, p.size);
    if (p.terrain) {
      g.save(); g.globalAlpha = 0.35; g.translate(cx, cy); g.rotate(-rot);
      const s = k * a.dyM; // px per cell (north-south)
      g.drawImage(a.images.hillshade, (-est.x * a.dxM) * k, -est.y * s, a.n * a.dxM * k, a.n * s);
      g.restore();
    }
    // Excluded terrain: hatched cells within range.
    const rc = Math.ceil(range / a.cellM) + 2;
    g.fillStyle = p.warn;
    g.globalAlpha = 0.55;
    const px = Math.max(1.5, a.cellM * k);
    for (let dy = -rc; dy <= rc; dy++)
      for (let dx = -rc; dx <= rc; dx++) {
        const x = Math.floor(est.x) + dx, y = Math.floor(est.y) + dy;
        if (x < 0 || y < 0 || x >= a.n || y >= a.n || !p.ctx.blocked[y * a.n + x]) continue;
        if ((x + y) % 2) continue; // checker texture so it never reads as solid ground
        const [sx, sy] = toS({ x: x + 0.5, y: y + 0.5 });
        g.fillRect(sx - px / 2, sy - px / 2, px, px);
      }
    g.globalAlpha = 1;
    // Range rings with distance ticks.
    g.strokeStyle = p.dim; g.lineWidth = 1; g.fillStyle = p.dim; g.font = '10px ui-monospace, monospace';
    for (const f of [1 / 3, 2 / 3, 1]) {
      g.beginPath(); g.arc(cx, cy, R * f, 0, 7); g.stroke();
      g.fillText(`${Math.round(range * f)}`, cx + 3, cy - R * f + 11);
    }
    // Planned path (dashed) and breadcrumbs (solid), as in Joint AR.
    const leg = currentLeg(p.ctx, p.s);
    const line = (pts: Pt[], dash: number[], w: number, col: string) => {
      if (pts.length < 2) return;
      g.save(); g.setLineDash(dash); g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round';
      g.beginPath(); pts.forEach((q, i) => { const [x, y] = toS(q); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.restore();
    };
    if (p.s.mode === 'mission') p.ctx.legs.slice(p.s.target + 1).forEach((l) => line(l.map((c) => cellPt(a, c)), [2, 5], 1, p.dim));
    line(leg.map((c) => cellPt(a, c)), [7, 5], 2, p.fg);
    line(p.s.crumbs, [], 2.5, p.fg);
    // Landmarks: Perseverance documented stops.
    g.strokeStyle = p.fg; g.lineWidth = 1;
    for (const r of a.rover.stops) {
      const [x, y] = toS(r);
      if (Math.hypot(x - cx, y - cy) > R) continue;
      g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.stroke();
    }
    // Waypoints.
    p.ctx.targets.forEach((t, i) => {
      const [x, y] = toS(t);
      const done = p.s.completed.includes(t.id);
      const isNext = t.id === p.g.target.id;
      g.save();
      g.strokeStyle = p.fg; g.fillStyle = isNext ? p.fg : 'transparent'; g.lineWidth = 2; g.globalAlpha = done ? 0.4 : 1;
      if (t.kind === 'base') { g.strokeRect(x - 6, y - 6, 12, 12); if (isNext) g.fillRect(x - 6, y - 6, 12, 12); }
      else { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.stroke(); }
      g.fillStyle = isNext ? '#000' : p.fg; g.font = 'bold 9px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t.kind === 'base' ? 'H' : String(i + 1), x, y + 0.5);
      if (isNext) { g.globalAlpha = 0.5; g.setLineDash([2, 3]); g.beginPath(); g.arc(x, y, Math.max(3, t.arrivalM * k), 0, 7); g.stroke(); }
      g.restore();
    });
    // Position uncertainty and own-ship.
    g.strokeStyle = p.fg; g.globalAlpha = 0.6; g.setLineDash([3, 3]);
    g.beginPath(); g.arc(cx, cy, Math.max(4, p.s.sigma * 2 * k), 0, 7); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
    g.save(); g.translate(cx, cy); g.rotate(p.headingUp ? 0 : (p.s.heading * Math.PI) / 180);
    g.fillStyle = p.fg; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    // Heading cone.
    g.globalAlpha = 0.15; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35); g.closePath(); g.fill();
    g.restore();
    g.restore();
    // Bezel: north marker.
    g.strokeStyle = p.fg; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    const nx = cx - Math.sin(rot) * (R - 9), ny = cy - Math.cos(rot) * (R - 9);
    g.fillStyle = p.fg; g.font = 'bold 12px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', nx, ny);
  });
  return <canvas ref={ref} style={{ width: p.size, height: p.size }} />;
}
