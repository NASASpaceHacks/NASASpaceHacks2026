import { useEffect, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { closeSheet, explainSafeZone, getMap, startHazardPick } from '../actions';
import { PRESETS, set, useConsole } from '../store';
import { objectiveById, stationImage, whyItMatters } from '../lib/science';
import { LayersPanel } from './Layers';
import { Kbd, Popover, cx } from './ui';

const STEP_LABELS = ['Slope', 'Distance', 'Walk-back', 'Shelter', 'Radio', 'Safe area'];

function AnimatedNumber({ from, to, digits = 2, ms = 1200 }: { from: number; to: number; digits?: number; ms?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - t) ** 3;
      setV(from + (to - from) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, ms]);
  return <>{v.toFixed(digits)}</>;
}

function ExplainCard() {
  const ex = useConsole((s) => s.explain);
  return (
    <AnimatePresence>
      {ex.running && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="pointer-events-none absolute left-4 top-4 z-20 w-[min(600px,calc(100%-330px))] min-w-[380px]"
        >
          <div className="overflow-hidden rounded-[4px] border border-line-2 bg-[#0e1014]/92 shadow-[0_18px_48px_rgba(0,0,0,0.6)] backdrop-blur-md">
            <div className="flex items-stretch border-b border-line">
              {STEP_LABELS.map((l, i) => {
                const n = i + 1;
                const done = ex.step > n;
                const active = ex.step === n;
                return (
                  <div key={l} className={cx('relative flex flex-1 items-center gap-1.5 px-2.5 py-2 transition-colors', active && 'bg-amber/10')}>
                    <span className={cx('num flex h-4 w-4 items-center justify-center rounded-full text-[9px]', done ? 'bg-cyan text-[#06222a]' : active ? 'bg-amber text-[#16110a]' : 'bg-line text-dim')}>{done ? '✓' : n}</span>
                    <span className={cx('truncate font-display text-[9.5px] uppercase tracking-[0.1em]', active ? 'text-amber' : done ? 'text-ink-2' : 'text-dim')}>{l}</span>
                    {active && <motion.span layoutId="explain-bar" className="absolute inset-x-0 bottom-0 h-[2px] bg-amber" />}
                  </div>
                );
              })}
            </div>
            <div className="flex items-end justify-between gap-6 px-5 py-4">
              <div className="min-w-0">
                <AnimatePresence mode="wait">
                  <motion.div key={ex.caption} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                    <div className="font-display text-[24px] font-semibold leading-none tracking-[0.02em] text-ink">{ex.caption}</div>
                    <div className="mt-2 text-[12px] leading-snug text-mute">{ex.detail}</div>
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="shrink-0 text-right">
                <div className="label !text-[9px]">Reachable</div>
                <div className={cx('num mt-1 text-[26px] leading-none', ex.step >= 6 ? 'text-cyan' : 'text-ink')}>
                  <AnimatedNumber from={ex.areaFrom} to={ex.areaTo} />
                  <span className="ml-1 text-[12px] text-mute">km²</span>
                </div>
                {ex.step >= 1 && ex.step <= 6 && ex.areaFrom - ex.areaTo > 0.004 && (
                  <div className="num mt-1 text-[11px] text-amber">−{(ex.areaFrom - ex.areaTo).toFixed(2)} km²</div>
                )}
                {ex.step >= 1 && ex.step <= 5 && ex.areaFrom - ex.areaTo <= 0.004 && <div className="mt-1 text-[11px] text-dim">already inside</div>}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StationTip() {
  const hover = useConsole((s) => s.hoverStation);
  const pack = useConsole((s) => s.pack);
  const plan = useConsole((s) => s.plan);
  const on = useConsole((s) => (hover ? !!s.stationOn[hover.id] : false));
  const st = hover && pack ? pack.manifest.stations.find((x) => x.id === hover.id) : null;
  if (!hover || !st || !pack) return null;
  const order = plan?.order.indexOf(st.id) ?? -1;
  const stop = plan?.stops.find((x) => x.id === st.id);
  const dropped = plan?.dropped.find((d) => d.id === st.id);
  const img = stationImage(pack.manifest, st);
  const left = Math.max(8, hover.x + 16);
  return (
    <div className="pointer-events-none absolute z-30 w-[280px] rounded-[4px] border border-line-2 bg-[#121419]/95 shadow-[0_12px_32px_rgba(0,0,0,0.55)] backdrop-blur-md" style={{ left, top: Math.max(8, hover.y - 20) }}>
      <div className="flex gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num text-[11px] text-mute">{st.id}</span>
            <span className="num ml-auto text-[11px] text-ochre">value {Math.round(st.value)}</span>
          </div>
          <div className="mt-1 text-[12.5px] leading-snug text-ink">{st.name}</div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-mute">{whyItMatters(st)}</div>
        </div>
        {img && <img src={`${pack.base}/${img.file}`} alt="" className="h-16 w-16 shrink-0 rounded-[2px] object-cover ring-1 ring-line" />}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t border-line px-3 py-2">
        {st.objectiveIds.map((o) => (
          <span key={o} title={objectiveById.get(o)?.statement} className="num rounded-[2px] border border-line-2 px-1 text-[9.5px] text-ink-2">{o}</span>
        ))}
        <span className="num ml-auto text-[10.5px]">
          {!on ? <span className="text-dim">not offered</span> : order >= 0 ? <span className="text-amber">stop {order + 1}{stop ? ` · arrive +${Math.round(stop.arriveMin)}′` : ''}</span> : dropped ? <span className="text-red">{dropped.text.replace(/^ST\d+\s*/, '')}</span> : <span className="text-dim">not in plan</span>}
        </span>
      </div>
    </div>
  );
}

function LayersButton() {
  const open = useConsole((s) => s.layersOpen);
  const preset = useConsole((s) => s.preset);
  return (
    <div className="relative">
      <button
        data-popover-anchor
        data-testid="layers-button"
        onClick={() => set((s) => ({ layersOpen: !s.layersOpen, simOpen: false }))}
        aria-expanded={open}
        className={cx('flex h-11 items-center gap-2 rounded-[10px] px-3.5 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors', open ? 'bg-[#1c2026]/95 text-ink' : 'bg-[#0e1014]/85 text-ink-2 hover:text-ink')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
          <path d="M8 2 L14.5 5.5 L8 9 L1.5 5.5 Z" />
          <path d="M1.5 8.5 L8 12 L14.5 8.5" />
        </svg>
        Layers
        {preset !== 'calm' && <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] text-amber">{PRESETS[preset].label}</span>}
      </button>
      <Popover open={open} onClose={() => set({ layersOpen: false })} label="Map layers" className="right-0 top-[52px]">
        <LayersPanel />
      </Popover>
    </div>
  );
}

export function MapHud({ readoutRef, scaleRef }: { readoutRef: RefObject<HTMLDivElement | null>; scaleRef: RefObject<HTMLDivElement | null> }) {
  const planStatus = useConsole((s) => s.planStatus);
  const explaining = useConsole((s) => s.explain.running);
  const hasZone = useConsole((s) => !!s.zone);
  const hazardPick = useConsole((s) => s.hazardPick);
  const live = useConsole((s) => s.uiMode === 'live');
  const follow = useConsole((s) => s.follow);
  const sheet = useConsole((s) => s.sheet);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const el = readoutRef.current?.parentElement?.parentElement;
    if (!el) return;
    const on = () => setHover(true), off = () => setHover(false);
    el.addEventListener('pointerenter', on);
    el.addEventListener('pointerleave', off);
    return () => {
      el.removeEventListener('pointerenter', on);
      el.removeEventListener('pointerleave', off);
    };
  }, [readoutRef]);

  return (
    <>
      {planStatus === 'planning' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[2px] overflow-hidden bg-amber/15">
          <div className="mw-scan h-full w-1/3 bg-amber" />
        </div>
      )}

      <div className="absolute right-4 top-4 z-30 flex items-start gap-2">
        <button
          data-testid="why-area"
          onClick={() => void explainSafeZone()}
          disabled={!hasZone}
          className={cx(
            'flex h-11 items-center gap-2 rounded-[10px] px-3.5 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors disabled:opacity-40',
            explaining ? 'bg-amber/20 text-amber' : 'bg-[#0e1014]/85 text-ink-2 hover:text-ink',
          )}
          title="Watch the safe area shrink one flight rule at a time (S)"
        >
          {explaining ? 'Stop' : 'Why this area?'}
        </button>
        <LayersButton />
      </div>

      <ExplainCard />
      <StationTip />

      <AnimatePresence>
        {hazardPick && !sheet && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-[10px] bg-[#1a0f0e]/92 px-4 py-2.5 text-[13px] text-ink ring-1 ring-red/50 backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-red mw-pulse" />
              Click the map where the hazard is
              <button onClick={() => (sheet ? closeSheet() : startHazardPick())} className="ml-2 text-mute hover:text-ink">Cancel <Kbd>Esc</Kbd></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none absolute bottom-3 left-4 z-10 flex items-end gap-3">
        <div className="pointer-events-auto rounded-[8px] bg-[#0e1014]/70 px-2.5 pb-1.5 pt-1.5 backdrop-blur-sm">
          <div ref={scaleRef} className="num pr-3 text-[9.5px] text-ink-2 [&_.mw-sb-bar]:text-ink" />
        </div>
        <div ref={readoutRef} className={cx('flex gap-3 rounded-[8px] bg-[#0e1014]/70 px-2.5 py-1.5 text-[11px] backdrop-blur-sm transition-opacity', hover ? 'opacity-100' : 'opacity-0')} aria-hidden={!hover}>
          <span><span className="text-dim">lat </span><span data-v className="num text-ink-2">—</span></span>
          <span><span className="text-dim">lon </span><span data-v className="num text-ink-2">—</span></span>
          <span><span className="text-dim">elev </span><span data-v className="num text-ink-2">—</span></span>
          <span><span className="text-dim">slope </span><span data-v className="num text-ink-2">—</span></span>
        </div>
      </div>

      <div className={cx('absolute right-4 z-10 flex flex-col overflow-hidden rounded-[10px] bg-[#0e1014]/80 backdrop-blur-sm', sheet ? 'top-[72px]' : 'bottom-4')}>
        {live && (
          <button title={follow ? 'Following the crew: click to stop' : 'Follow the crew'} aria-pressed={follow} onClick={() => set((s) => ({ follow: !s.follow }))} className={cx('flex h-10 w-10 items-center justify-center text-[11px]', follow ? 'text-cyan' : 'text-mute hover:text-ink')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><circle cx="8" cy="8" r="2.4" fill={follow ? 'currentColor' : 'none'} /><path d="M8 1.5 V4 M8 12 V14.5 M1.5 8 H4 M12 8 H14.5" strokeLinecap="round" /></svg>
          </button>
        )}
        {[
          { l: '+', t: 'Zoom in', f: () => getMap()?.zoomBy(1) },
          { l: '−', t: 'Zoom out', f: () => getMap()?.zoomBy(-1) },
          { l: '⤢', t: 'Fit to route (Z)', f: () => getMap()?.fitRoute() },
        ].map((b) => (
          <button key={b.t} title={b.t} aria-label={b.t} onClick={b.f} className="num flex h-10 w-10 items-center justify-center text-[16px] text-ink-2 hover:bg-raised hover:text-ink">
            {b.l}
          </button>
        ))}
      </div>
    </>
  );
}
