import { useRef, useState } from 'react';

interface Props {
  xs: number[];
  ys: number[];
  title: string;
  xFmt: (x: number) => string;
  yFmt: (y: number) => string;
  color?: string;
  /** Horizontal reference line (e.g. zero return margin). */
  ref0?: { y: number; label: string };
  marks?: { x: number; label: string }[];
  height?: number;
  onHover?: (k: number | null) => void;
}

/** Single-series line chart with crosshair tooltip. One axis only; two measures get two charts. */
export function LineChart(p: Props) {
  const [hk, setHk] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = 340, H = p.height ?? 120, L = 44, R = 8, T = 18, B = 20;
  if (p.xs.length < 2) return null;
  const x0 = p.xs[0], x1 = p.xs[p.xs.length - 1];
  const fin = p.ys.filter((y) => isFinite(y));
  if (!fin.length) return null;
  let y0 = Math.min(...fin), y1 = Math.max(...fin);
  if (p.ref0) { y0 = Math.min(y0, p.ref0.y); y1 = Math.max(y1, p.ref0.y); }
  if (y1 - y0 < 1e-6) { y1 += 1; y0 -= 1; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const step = Math.max(1, Math.floor(p.xs.length / 400));
  let d = '';
  let pen = false;
  for (let k = 0; k < p.xs.length; k += step) {
    if (!isFinite(p.ys[k])) { pen = false; continue; } // gaps for unknown values, never a fake number
    d += (pen ? 'L' : 'M') + sx(p.xs[k]).toFixed(1) + ',' + sy(p.ys[k]).toFixed(1);
    pen = true;
  }
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const move = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = x0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (x1 - x0);
    let lo = 0, hi = p.xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.xs[m] < x) lo = m; else hi = m; }
    const k = Math.abs(p.xs[lo] - x) < Math.abs(p.xs[hi] - x) ? lo : hi;
    setHk(k); p.onHover?.(k);
  };
  return (
    <figure className="chart">
      <figcaption>{p.title}</figcaption>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => { setHk(null); p.onHover?.(null); }}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 6} y={sy(t) + 3} textAnchor="end" className="tick">{p.yFmt(t)}</text>
          </g>
        ))}
        {p.ref0 && (
          <g>
            <line x1={L} x2={W - R} y1={sy(p.ref0.y)} y2={sy(p.ref0.y)} stroke="var(--critical)" strokeDasharray="4 3" strokeWidth={1.5} />
            <text x={W - R} y={sy(p.ref0.y) - 4} textAnchor="end" className="tick" fill="var(--critical)">{p.ref0.label}</text>
          </g>
        )}
        {p.marks?.map((m, k) => (
          <g key={k}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={T} y2={H - B} stroke="var(--ink-3)" strokeDasharray="2 3" />
            <text x={sx(m.x)} y={T - 5} textAnchor="middle" className="tick">{m.label}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke={p.color ?? 'var(--route)'} strokeWidth={2} strokeLinejoin="round" />
        <text x={L} y={H - 5} className="tick">{p.xFmt(x0)}</text>
        <text x={W - R} y={H - 5} textAnchor="end" className="tick">{p.xFmt(x1)}</text>
        {hk !== null && isFinite(p.ys[hk]) && (
          <g>
            <line x1={sx(p.xs[hk])} x2={sx(p.xs[hk])} y1={T} y2={H - B} stroke="var(--ink-2)" />
            <circle cx={sx(p.xs[hk])} cy={sy(p.ys[hk])} r={4} fill={p.color ?? 'var(--route)'} stroke="var(--panel)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hk !== null && (
        <div className="tip">{p.xFmt(p.xs[hk])} · <b>{p.yFmt(p.ys[hk])}</b></div>
      )}
    </figure>
  );
}
