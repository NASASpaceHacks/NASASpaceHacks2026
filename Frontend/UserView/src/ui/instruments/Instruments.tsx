import { useRef } from 'react';

const D2R = Math.PI / 180;

/** Keep a rotation continuous across 359°→0° so CSS transitions take the short way round. */
export function useUnwrapped(angle: number): number {
  const ref = useRef<number | null>(null);
  if (ref.current === null || !Number.isFinite(ref.current)) ref.current = angle;
  else {
    const cur = ref.current;
    const d = ((((angle - cur) % 360) + 540) % 360) - 180;
    ref.current = cur + d;
  }
  return ref.current;
}

const polar = (c: number, r: number, deg: number): [number, number] => [c + r * Math.sin(deg * D2R), c - r * Math.cos(deg * D2R)];

/** Bearing dial: clock-face ring (12 = walking direction) with a heavy arrow to the target. */
export function BearingDial({
  rel,
  steer,
  size = 300,
  color = 'var(--a)',
  dim = false,
}: {
  rel: number | null;
  steer?: number | null;
  size?: number;
  color?: string;
  dim?: boolean;
}) {
  const c = size / 2;
  const R = c - 10;
  const a = useUnwrapped(rel ?? 0);
  const sa = useUnwrapped(steer ?? 0);
  const ticks = [];
  for (let i = 0; i < 36; i++) {
    const deg = i * 10;
    const major = i % 3 === 0;
    const [x1, y1] = polar(c, R, deg);
    const [x2, y2] = polar(c, R - (major ? 24 : 12), deg);
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? 'var(--g2)' : 'var(--g3)'} strokeWidth={major ? 4 : 2} />);
  }
  const nums = [
    [0, '12'],
    [90, '3'],
    [180, '6'],
    [270, '9'],
  ] as const;
  const L = R - 34; // arrow reach
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      <circle cx={c} cy={c} r={R} fill="none" stroke="var(--g3)" strokeWidth={2} />
      <circle cx={c} cy={c} r={R * 0.42} fill="none" stroke="var(--g4)" strokeWidth={2} />
      {ticks}
      {nums.map(([deg, t]) => {
        const [x, y] = polar(c, R - 50, deg);
        return (
          <text key={t} x={x} y={y + 9} textAnchor="middle" fill="var(--g2)" fontSize={26} className="num">
            {t}
          </text>
        );
      })}
      {/* lubber: walking direction */}
      <path d={`M ${c - 14} ${c - R - 2} L ${c + 14} ${c - R - 2} L ${c} ${c - R + 18} Z`} fill="var(--w)" />
      {steer !== null && steer !== undefined && (
        <g style={{ transform: `rotate(${sa}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform 0.3s linear' }}>
          <path d={`M ${c} ${c - R + 4} l 13 -20 h -26 Z`} fill="none" stroke="var(--g)" strokeWidth={3} />
        </g>
      )}
      {rel !== null && (
        <g style={{ transform: `rotate(${a}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform 0.3s linear', opacity: dim ? 0.4 : 1 }}>
          <path
            d={`M ${c} ${c - L} L ${c + 40} ${c - L + 70} L ${c + 14} ${c - L + 70} L ${c + 14} ${c + L * 0.62} L ${c - 14} ${c + L * 0.62} L ${c - 14} ${c - L + 70} L ${c - 40} ${c - L + 70} Z`}
            fill={color}
            stroke="#000"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </g>
      )}
      <circle cx={c} cy={c} r={7} fill="#000" stroke="var(--w)" strokeWidth={3} />
    </svg>
  );
}

/** 240° arc gauge with a big centre readout. */
export function ArcGauge({
  value,
  max,
  label,
  unit,
  amberBelow,
  redBelow,
  limitAt,
  size = 230,
  invert = false,
  text,
}: {
  value: number | null;
  max: number;
  label: string;
  unit: string;
  amberBelow: number;
  redBelow: number;
  limitAt?: number;
  size?: number;
  invert?: boolean;
  text?: string;
}) {
  const c = size / 2;
  const R = c - 14;
  const v = value === null || !Number.isFinite(value) ? null : value;
  const frac = v === null ? 0 : Math.max(0, Math.min(1, v / max));
  const start = -120, sweep = 240;
  const arc = (f0: number, f1: number) => {
    const a0 = start + sweep * f0, a1 = start + sweep * f1;
    const [x0, y0] = polar(c, R, a0);
    const [x1, y1] = polar(c, R, a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`;
  };
  const bad = v !== null && (invert ? v > redBelow : v <= redBelow);
  const warn = v !== null && (invert ? v > amberBelow : v < amberBelow);
  const col = v === null ? 'var(--g3)' : bad ? 'var(--r)' : warn ? 'var(--a)' : 'var(--g)';
  const ticks = [];
  for (let i = 0; i <= 8; i++) {
    const deg = start + (sweep * i) / 8;
    const [x1, y1] = polar(c, R + 10, deg);
    const [x2, y2] = polar(c, R - 10 - (i % 4 === 0 ? 8 : 0), deg);
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--g3)" strokeWidth={i % 4 === 0 ? 3 : 2} />);
  }
  const lim = limitAt !== undefined ? polar(c, R + 14, start + sweep * Math.min(1, limitAt / max)) : null;
  const lim2 = limitAt !== undefined ? polar(c, R - 18, start + sweep * Math.min(1, limitAt / max)) : null;
  const shown = text ?? (v === null ? '—' : v <= -999 ? '−∞' : String(Math.round(v)));
  return (
    <svg width={size} height={size * 0.86} viewBox={`0 0 ${size} ${size * 0.86}`} style={{ overflow: 'visible' }}>
      <path d={arc(0, 1)} fill="none" stroke="var(--g4)" strokeWidth={16} />
      {frac > 0.004 && <path d={arc(0, frac)} fill="none" stroke={col} strokeWidth={16} style={{ transition: 'stroke 0.4s' }} />}
      {ticks}
      {lim && lim2 && <line x1={lim[0]} y1={lim[1]} x2={lim2[0]} y2={lim2[1]} stroke="var(--r)" strokeWidth={5} />}
      <text x={c} y={c + 22} textAnchor="middle" fill={v === null ? 'var(--g3)' : bad ? 'var(--r)' : warn ? 'var(--a)' : 'var(--w)'} fontSize={shown.length > 3 ? 56 : 72} className="num">
        {shown}
      </text>
      <text x={c} y={c + 58} textAnchor="middle" fill="var(--g2)" fontSize={22} className="lbl">
        {unit}
      </text>
      <text x={c} y={size * 0.86 - 2} textAnchor="middle" fill="var(--g2)" fontSize={21} className="lbl">
        {label}
      </text>
    </svg>
  );
}

/** Clock-face heading cue: walking direction up, sun or landmark glyph at its clock position. */
export function ClockCue({ rel, kind, size = 120 }: { rel: number; kind: 'sun' | 'landmark' | 'none'; size?: number }) {
  const c = size / 2;
  const R = c - 6;
  const a = useUnwrapped(rel);
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const [x1, y1] = polar(c, R, i * 30);
    const [x2, y2] = polar(c, R - (i % 3 === 0 ? 14 : 8), i * 30);
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--g2)" strokeWidth={i % 3 === 0 ? 4 : 2} />);
  }
  const g = R - 26;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={R} fill="none" stroke="var(--g3)" strokeWidth={2} />
      {ticks}
      {/* walker: heading up */}
      <path d={`M ${c} ${c - 22} L ${c + 13} ${c + 14} L ${c} ${c + 6} L ${c - 13} ${c + 14} Z`} fill="var(--w)" />
      {kind !== 'none' && (
        <g style={{ transform: `rotate(${a}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform 0.4s linear' }}>
          {kind === 'sun' ? (
            <g>
              <circle cx={c} cy={c - g} r={10} fill="var(--a)" />
              {Array.from({ length: 8 }, (_, k) => {
                const [x1, y1] = [c + 14 * Math.sin(k * 45 * D2R), c - g - 14 * Math.cos(k * 45 * D2R)];
                const [x2, y2] = [c + 20 * Math.sin(k * 45 * D2R), c - g - 20 * Math.cos(k * 45 * D2R)];
                return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--a)" strokeWidth={3} />;
              })}
            </g>
          ) : (
            <path d={`M ${c - 16} ${c - g + 10} L ${c - 4} ${c - g - 12} L ${c + 3} ${c - g - 2} L ${c + 8} ${c - g - 8} L ${c + 17} ${c - g + 10} Z`} fill="var(--a)" />
          )}
        </g>
      )}
    </svg>
  );
}

/** Horizontal bar with limit tick. */
export function Bar({ frac, color = 'var(--g)', width = 200, height = 14 }: { frac: number; color?: string; width?: number; height?: number }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <svg width={width} height={height}>
      <rect x={1} y={1} width={width - 2} height={height - 2} fill="none" stroke="var(--g3)" strokeWidth={2} />
      <rect x={4} y={4} width={Math.max(0, (width - 8) * f)} height={height - 8} fill={color} />
    </svg>
  );
}
