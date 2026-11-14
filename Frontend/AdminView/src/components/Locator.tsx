import { useEffect, useState } from 'react';
import { useConsole } from '../store';
import { cx } from './ui';

interface Frame { file: string; lonMin: number; lonMax: number; latMin: number; latMax: number; credit?: string; source?: string }
interface Context {
  global: Frame;
  regional: Frame;
  aoi: { lonMin: number; lonMax: number; latMin: number; latMax: number; label?: string };
  labels?: { name: string; lon: number; lat: number }[];
}

const pos = (f: { lonMin: number; lonMax: number; latMin: number; latMax: number }, lon: number, lat: number) => {
  const l = lon < f.lonMin ? lon + 360 : lon > f.lonMax ? lon - 360 : lon;
  return { x: ((l - f.lonMin) / (f.lonMax - f.lonMin)) * 100, y: ((f.latMax - lat) / (f.latMax - f.latMin)) * 100 };
};

/** "Where on Mars" inset: real global image with a box at the site; hover/click shows the regional view with the study area. */
export function Locator() {
  const pack = useConsole((s) => s.pack);
  const live = useConsole((s) => s.uiMode === 'live');
  const [ctx, setCtx] = useState<Context | null>(null);
  const [open, setOpen] = useState(true);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!pack) return;
    let live = true;
    fetch(`${pack.base}/context/context.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.global && j?.regional && j?.aoi) setCtx(j as Context); })
      .catch(() => {});
    return () => { live = false; };
  }, [pack]);

  if (!pack || !ctx) return null;
  const expanded = open && (hover || pinned);
  const f = expanded ? ctx.regional : ctx.global;
  const w = expanded ? 236 : 200;
  const a = ctx.aoi;
  const p0 = pos(f, a.lonMin, a.latMax);
  const p1 = pos(f, a.lonMax, a.latMin);
  const bw = Math.max(p1.x - p0.x, 0);
  const bh = Math.max(p1.y - p0.y, 0);
  const small = !expanded;
  const c = pos(f, (a.lonMin + a.lonMax) / 2, (a.latMin + a.latMax) / 2);
  const credit = f.credit ?? f.source ?? '';

  return (
    <div
      data-testid="locator"
      className={cx("absolute right-3 z-20 border border-line-2 bg-black", live ? "bottom-[196px]" : "bottom-[152px]")}
      style={{ width: w, maxWidth: 'calc(100% - 24px)' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="eyebrow !text-[11px]">Where on Mars</span>
        <button aria-label={open ? 'Collapse locator' : 'Expand locator'} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="num h-5 w-5 text-[12px] text-cyan">{open ? '–' : '+'}</button>
      </div>
      {open && (
        <>
          <button className="relative block w-full cursor-zoom-in" aria-label="Toggle regional view" onClick={() => setPinned((v) => !v)}>
            <img src={`${pack.base}/context/${f.file}`} alt={expanded ? 'Regional view of Gale crater' : 'Mars global map'} className="block w-full select-none" draggable={false} />
            <div className="absolute border border-cyan" style={small ? { left: `${c.x}%`, top: `${c.y}%`, width: 8, height: 8, transform: 'translate(-50%,-50%)' } : { left: `${p0.x}%`, top: `${p0.y}%`, width: `${bw}%`, height: `${bh}%` }} />
            {expanded && (
              <span className="absolute font-display text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan" style={{ left: `${p0.x + bw}%`, top: `${p0.y}%`, transform: 'translate(4px,-100%)' }}>{a.label ?? 'Study area'}</span>
            )}
            {expanded && ctx.labels?.map((l) => {
              const q = pos(f, l.lon, l.lat);
              if (q.x < 0 || q.x > 100 || q.y < 0 || q.y > 100) return null;
              return <span key={l.name} className="absolute whitespace-nowrap text-[10px] text-white" style={{ left: `${q.x}%`, top: `${q.y}%`, transform: 'translate(-50%,-50%)', textShadow: '0 0 3px #000, 0 0 3px #000' }}>{l.name}</span>;
            })}
          </button>
          <div className={cx('px-2 py-1 text-[9.5px] leading-snug text-dim')}>{credit}</div>
        </>
      )}
    </div>
  );
}
