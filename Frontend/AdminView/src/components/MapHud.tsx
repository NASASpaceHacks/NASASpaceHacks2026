import { useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { explainSafeZone, getMap, startHazardPick } from '../actions';
import { useConsole } from '../store';
import { fmtLtst, sunAtLtst } from '../lib/marsclock';
import { objectiveById, stationImage, whyItMatters } from '../lib/science';
import { Kbd, cx } from './ui';

const STEP_LABELS = ['Slope', 'Radius', 'Walkback', 'Shelter', 'Line of sight', 'Safe region'];

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
          className="pointer-events-none absolute left-1/2 top-4 z-20 w-[min(620px,calc(100%-380px))] min-w-[420px] -translate-x-1/2"
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

function SunDial() {
  const startLtst = useConsole((s) => s.startLtstMin);
  const ls = useConsole((s) => s.lsDeg);
  const pack = useConsole((s) => s.pack);
  const lat = pack?.manifest.grid.centerLonLat[1] ?? -4.8;
  const sun = sunAtLtst(ls, startLtst, lat);
  const r = 17 * (1 - Math.max(0, sun.elevDeg) / 90);
  const a = (sun.azDeg * Math.PI) / 180;
  const up = sun.elevDeg > 0;
  return (
    <div className="flex items-center gap-2.5 rounded-[4px] border border-line bg-[#0e1014]/85 px-2.5 py-2 backdrop-blur-sm">
      <svg width="40" height="40" viewBox="-20 -20 40 40" aria-hidden>
        <circle r="17" fill="none" stroke="#2e333b" />
        <circle r="8.5" fill="none" stroke="#22262d" strokeDasharray="1 2" />
        <text y="-11" textAnchor="middle" fontSize="6" fill="#5b5f67" fontFamily="var(--font-mono)">N</text>
        {up && <line x1="0" y1="0" x2={Math.sin(a) * r} y2={-Math.cos(a) * r} stroke="#F2B544" strokeOpacity="0.4" />}
        <circle cx={Math.sin(a) * (up ? r : 17)} cy={-Math.cos(a) * (up ? r : 17)} r="3.2" fill={up ? '#F2B544' : '#5b5f67'} />
      </svg>
      <div className="leading-tight">
        <div className="label !text-[9px]">Sun · {fmtLtst(startLtst)} LTST</div>
        <div className="num mt-1 text-[11.5px] text-ink">
          {sun.elevDeg.toFixed(1)}° <span className="text-dim">el</span> {sun.azDeg.toFixed(0)}° <span className="text-dim">az</span>
        </div>
      </div>
    </div>
  );
}

export function MapHud({ readoutRef, scaleRef }: { readoutRef: RefObject<HTMLDivElement | null>; scaleRef: RefObject<HTMLDivElement | null> }) {
  const planStatus = useConsole((s) => s.planStatus);
  const area = useConsole((s) => s.zoneAreaKm2);
  const explaining = useConsole((s) => s.explain.running);
  const hasZone = useConsole((s) => !!s.zone);
  const hazardPick = useConsole((s) => s.hazardPick);
  const movable = useConsole((s) => s.pack?.manifest.shelters.some((x) => x.movable));
  const prevArea = useRef<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    if (area === null) return;
    if (prevArea.current !== null && Math.abs(area - prevArea.current) > 0.005) {
      setDelta(area - prevArea.current);
      const id = setTimeout(() => setDelta(null), 3500);
      prevArea.current = area;
      return () => clearTimeout(id);
    }
    prevArea.current = area;
  }, [area]);

  return (
    <>
      {planStatus === 'planning' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[2px] overflow-hidden bg-amber/15">
          <div className="mw-scan h-full w-1/3 bg-amber" />
        </div>
      )}

      <div className="absolute left-4 top-4 z-10 flex flex-col items-start gap-2">
        <button
          onClick={() => void explainSafeZone()}
          disabled={!hasZone}
          className={cx(
            'group flex h-10 items-center gap-2.5 rounded-[4px] border pl-3 pr-3.5 font-display text-[12px] uppercase tracking-[0.12em] shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm transition-colors disabled:opacity-40',
            explaining ? 'border-amber/70 bg-amber/15 text-amber' : 'border-cyan/50 bg-[#0e1014]/85 text-cyan hover:bg-cyan/10',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 1.5 L14 4.5 V8.5 C14 11.5 11.5 13.7 8 14.5 C4.5 13.7 2 11.5 2 8.5 V4.5 Z" stroke="currentColor" strokeWidth="1.4" />
            {explaining ? <rect x="6" y="6" width="4" height="4" fill="currentColor" /> : <path d="M6.5 5.5 L10.5 8 L6.5 10.5 Z" fill="currentColor" />}
          </svg>
          {explaining ? 'Stop' : 'Explain safe zone'}
          <Kbd>S</Kbd>
        </button>
        {area !== null && !explaining && (
          <div className="flex items-center gap-3 rounded-[4px] border border-line bg-[#0e1014]/85 px-3 py-2 backdrop-blur-sm">
            <div>
              <div className="label !text-[9px]">Safe region</div>
              <div className="num mt-1 text-[16px] leading-none text-cyan">
                {area.toFixed(2)}
                <span className="ml-1 text-[10.5px] text-mute">km²</span>
                <AnimatePresence>
                  {delta !== null && (
                    <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={cx('ml-2 text-[11px]', delta > 0 ? 'text-cyan' : 'text-amber')}>
                      {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
            {movable && <div className="max-w-[150px] border-l border-line pl-3 text-[10.5px] leading-snug text-mute">Drag the rover <span className="text-ink-2">R</span> to move the safe haven</div>}
          </div>
        )}
      </div>

      <ExplainCard />
      <StationTip />

      <div className="absolute right-4 top-4 z-10">
        <SunDial />
      </div>

      <AnimatePresence>
        {hazardPick && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-20 left-1/2 z-20 -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-[4px] border border-red/60 bg-[#1a0f0e]/90 px-4 py-2.5 text-[12px] text-ink backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-red mw-pulse" />
              Click the map where EV1 reported the hazard
              <button onClick={startHazardPick} className="ml-2 text-mute hover:text-ink">Cancel <Kbd>Esc</Kbd></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-end gap-3">
        <div className="pointer-events-auto rounded-[4px] border border-line bg-[#0e1014]/85 px-3 pb-2 pt-2 backdrop-blur-sm">
          <div className="label mb-2 !text-[9px]">Scale · Mars metres</div>
          <div ref={scaleRef} className="num pr-3 text-[9.5px] text-ink-2 [&_.mw-sb-bar]:text-ink" />
        </div>
        <div ref={readoutRef} className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 rounded-[4px] border border-line bg-[#0e1014]/85 px-3 py-2 backdrop-blur-sm">
          <span className="label !text-[9px]">Lat</span>
          <span data-v className="num w-[92px] text-[11px] text-ink">—</span>
          <span className="label !text-[9px]">Lon</span>
          <span data-v className="num text-[11px] text-ink">—</span>
          <span className="label !text-[9px]">Elev</span>
          <span data-v className="num text-[11px] text-ink">—</span>
          <span className="label !text-[9px]">Slope</span>
          <span data-v className="num text-[11px] text-ink">—</span>
        </div>
      </div>

      <div className="absolute bottom-4 right-4 z-10 flex flex-col overflow-hidden rounded-[4px] border border-line bg-[#0e1014]/85 backdrop-blur-sm">
        {[
          { l: '+', t: 'Zoom in', f: () => getMap()?.zoomBy(1) },
          { l: '−', t: 'Zoom out', f: () => getMap()?.zoomBy(-1) },
          { l: '⤢', t: 'Fit to AOI (F)', f: () => getMap()?.fit() },
        ].map((b) => (
          <button key={b.t} title={b.t} aria-label={b.t} onClick={b.f} className="num flex h-8 w-8 items-center justify-center border-b border-line text-[15px] text-ink-2 last:border-0 hover:bg-raised hover:text-ink">
            {b.l}
          </button>
        ))}
      </div>
    </>
  );
}
