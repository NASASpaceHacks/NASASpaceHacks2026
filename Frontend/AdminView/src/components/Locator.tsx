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

type Box = { lonMin: number; lonMax: number; latMin: number; latMax: number };

/** One fixed view: a real image with a cyan box on the next view's area (never smaller than `minPx`). */
function View({ base, frame, box, h, caption, alt, testId, minPx = 6 }: { base: string; frame: Frame; box: Box; h: number; caption: string; alt: string; testId: string; minPx?: number }) {
  const w = Math.round((h * (frame.lonMax - frame.lonMin)) / (frame.latMax - frame.latMin));
  const p0 = pos(frame, box.lonMin, box.latMax);
  const p1 = pos(frame, box.lonMax, box.latMin);
  const bx = ((p0.x + p1.x) / 2 / 100) * w, by = ((p0.y + p1.y) / 2 / 100) * h;
  const bw = Math.max(((p1.x - p0.x) / 100) * w, minPx), bh = Math.max(((p1.y - p0.y) / 100) * h, minPx);
  return (
    <figure data-testid={testId} className="m-0 shrink-0">
      <figcaption className="pb-1 font-display text-[11px] uppercase tracking-[0.1em] text-ink-2">{caption}</figcaption>
      <div className="relative overflow-hidden ring-1 ring-line-2" style={{ width: w, height: h }}>
        <img src={`${base}/context/${frame.file}`} alt={alt} width={w} height={h} className="block h-full w-full select-none object-fill" draggable={false} />
        <div className="absolute border-[1.5px] border-cyan" style={{ left: bx - bw / 2, top: by - bh / 2, width: bw, height: bh }} />
      </div>
    </figure>
  );
}

/** "Where on Mars": two fixed real-image views side by side — Mars (box on Gale) → Gale crater (box on the study area). Collapse/expand only. */
export function Locator() {
  const pack = useConsole((s) => s.pack);
  const live = useConsole((s) => s.uiMode === 'live');
  const [ctx, setCtx] = useState<Context | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!pack) return;
    let alive = true;
    fetch(`${pack.base}/context/context.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.global && j?.regional && j?.aoi) setCtx(j as Context); })
      .catch(() => {});
    return () => { alive = false; };
  }, [pack]);

  if (!pack || !ctx) return null;
  const H = 92;
  const credit = ctx.global.credit ?? ctx.global.source ?? '';
  const site = ctx.labels?.find((l) => /gale/i.test(l.name))?.name ?? 'Gale crater';

  return (
    <div
      data-testid="locator"
      data-open={open}
      className={cx('absolute right-3 z-20 border border-line-2 bg-black', live ? 'bottom-[196px]' : 'bottom-[152px]')}
      style={{ maxWidth: 'calc(100% - 24px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="eyebrow !text-[11px]">Where on Mars</span>
        <button aria-label={open ? 'Collapse locator' : 'Expand locator'} aria-expanded={open} data-testid="locator-toggle" onClick={() => setOpen((o) => !o)} className="num h-5 w-5 text-[12px] text-cyan">{open ? '–' : '+'}</button>
      </div>
      {open && (
        <>
          <div className="flex items-end gap-1.5 px-2">
            <View base={pack.base} frame={ctx.global} box={ctx.regional} h={H} caption="Mars" alt="Mars global map with a box on Gale crater" testId="locator-mars" />
            <span aria-hidden className="pb-[38px] text-[12px] text-cyan">→</span>
            <View base={pack.base} frame={ctx.regional} box={ctx.aoi} h={H} caption={site} alt="Regional view of Gale crater with the study area" testId="locator-gale" minPx={5} />
          </div>
          <div className="max-w-[300px] px-2 py-1 text-[9.5px] leading-snug text-dim">{credit}</div>
        </>
      )}
    </div>
  );
}
