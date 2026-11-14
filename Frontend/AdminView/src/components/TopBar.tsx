import { useEffect, useMemo, useState } from 'react';
import { useConsole, set } from '../store';
import { fmtLtst, marsTime } from '../lib/marsclock';
import { dataSummary } from '../lib/science';
import { Badge, Tip, cx } from './ui';

export function Mark({ size = 22 }: { size?: number }) {
  // Hab (square) → dotted traverse → footfall chevron. Team-made mark.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="14.5" width="7" height="7" rx="1" stroke="#C8763A" strokeWidth="1.6" />
      <path d="M9.5 15.5 C 13 13, 13 9, 16.5 7.5" stroke="#F2B544" strokeWidth="1.6" strokeDasharray="1.2 2.4" strokeLinecap="round" />
      <path d="M15.2 3.6 L 21 6.4 L 16.4 10.4" stroke="#F2B544" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockCell({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col justify-center px-3" title={title}>
      <div className="label !text-[9px] leading-none">{label}</div>
      <div className="num mt-1 text-[13.5px] leading-none text-ink">{value}</div>
    </div>
  );
}

export function TopBar() {
  const pack = useConsole((s) => s.pack);
  const mode = useConsole((s) => s.mode);
  const startLtst = useConsole((s) => s.startLtstMin);
  const lsDeg = useConsole((s) => s.lsDeg);
  const link = useConsole((s) => s.link);
  const route = useConsole((s) => s.route);
  const confirmStage = useConsole((s) => s.confirm.stage);
  const lastT = useConsole((s) => (s.telem.length ? s.telem[s.telem.length - 1].t : null));
  const sourceReason = useConsole((s) => s.sourceReason);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const m = pack?.manifest;
  const lon = m?.grid.centerLonLat[0] ?? 137.388;
  const lat = m?.grid.centerLonLat[1] ?? -4.805;
  const mt = marsTime(now, lon);
  const summary = useMemo(() => (m ? dataSummary(m) : null), [m]);
  const missionLtst = startLtst + (lastT ?? 0);

  const linkTone = link === 'up' ? 'text-cyan border-cyan/40' : link === 'degraded' ? 'text-amber border-amber/50' : 'text-red border-red/60';
  const linkDot = link === 'up' ? 'bg-cyan' : link === 'degraded' ? 'bg-amber' : 'bg-red';

  return (
    <header className="relative z-20 flex h-[52px] shrink-0 items-stretch border-b border-line bg-panel">
      <div className="flex items-center gap-3 px-4">
        <Mark />
        <div className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-bold tracking-[0.24em] text-ink">MARSWALK</span>
          <span className="label mt-[3px] !text-[8.5px] !tracking-[0.3em]">Habitat console</span>
        </div>
      </div>
      <div className="my-2.5 w-px bg-line" />
      <div className="flex min-w-0 flex-col justify-center px-4">
        <div className="truncate text-[12.5px] font-medium text-ink">{m?.name ?? 'Loading site…'}</div>
        <div className="num mt-0.5 text-[10.5px] text-mute">
          {Math.abs(lat).toFixed(3)}°{lat < 0 ? 'S' : 'N'} {lon.toFixed(3)}°E · {m ? `${(m.grid.w * m.grid.cellM) / 1000} × ${(m.grid.h * m.grid.cellM) / 1000} km AOI` : ''}
        </div>
      </div>

      <div className="ml-auto flex items-stretch">
        <div className="flex items-stretch border-l border-line">
          <ClockCell label="Sol" value={String(m?.scenario.sol ?? '—')} title="Mission sol (scenario)" />
          <ClockCell label={lastT !== null ? 'LTST · EVA' : 'LTST · start'} value={fmtLtst(missionLtst)} title="Local True Solar Time at the site" />
          <ClockCell label="Ls" value={`${lsDeg.toFixed(0)}°`} title="Areocentric solar longitude (season)" />
          <ClockCell label="MTC now" value={`${String(Math.floor(mt.mtcH)).padStart(2, '0')}:${String(Math.floor((mt.mtcH % 1) * 60)).padStart(2, '0')}`} title={`Coordinated Mars Time · MSD ${mt.msd.toFixed(2)} (Mars24 algorithm)`} />
        </div>

        <div className="flex items-center gap-2 border-l border-line px-3">
          {summary && (
            <button
              onClick={() => set({ leftSection: 'sources' })}
              className="group flex h-7 items-center gap-2 rounded-[3px] border border-line-2 px-2.5 hover:border-ochre/60"
              title="Open the Sources panel"
            >
              <span className="label !text-[9px] group-hover:text-ochre">Data</span>
              {summary.synthetic ? (
                <span className="num text-[11px] text-ink-2">synthetic terrain</span>
              ) : (
                <span className="num text-[11px] text-ink">
                  {summary.missions.length} missions <span className="text-dim">·</span> {summary.kinds.length} data kinds
                </span>
              )}
            </button>
          )}

          <button
            data-testid="open-evidence"
            onClick={() => set({ evidence: 'open' })}
            className="group flex h-7 items-center gap-2 rounded-[3px] border border-line-2 px-2.5 hover:border-cyan/60"
            title="Evidence: what we reproduce, calibrate and measure (E)"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden className="text-cyan">
              <path d="M6 1 L10.5 2.8 V6.2 C10.5 8.6 8.6 10.4 6 11 C3.4 10.4 1.5 8.6 1.5 6.2 V2.8 Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M4 6.1 L5.5 7.6 L8.2 4.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="label !text-[9px] text-ink-2 group-hover:text-cyan">Evidence</span>
          </button>

          <Tip content={<>Surface link to the visor (EV1). When it drops, the visor keeps guiding autonomously from its onboard safety core.</>} side="bottom" width={260}>
            <div className={cx('flex h-7 items-center gap-2 rounded-[3px] border px-2.5', linkTone)}>
              <span className={cx('h-1.5 w-1.5 rounded-full', linkDot, link !== 'up' && 'mw-pulse')} />
              <span className="font-display text-[10.5px] uppercase tracking-[0.14em]">Visor {link}</span>
            </div>
          </Tip>

          <div className="flex h-7 items-center gap-2 rounded-[3px] border border-line-2 px-2.5">
            <span className="label !text-[9px]">Route</span>
            {route ? (
              <>
                <span className="num text-[12px] text-ink">v{route.seq}</span>
                {route.acked ? (
                  <span className="font-display text-[10px] uppercase tracking-[0.14em] text-cyan">ACK ✓</span>
                ) : confirmStage === 'rejected' ? (
                  <span className="font-display text-[10px] uppercase tracking-[0.14em] text-red">Rejected</span>
                ) : (
                  <span className="mw-pulse font-display text-[10px] uppercase tracking-[0.14em] text-amber">Awaiting ACK</span>
                )}
              </>
            ) : (
              <span className="font-display text-[10px] uppercase tracking-[0.14em] text-dim">None pushed</span>
            )}
          </div>

          <Tip content={sourceReason || (mode === 'mock' ? 'In-browser synthetic site' : 'Hab server')} side="bottom" width={260}>
            {mode === 'mock' ? <Badge tone="amber">Mock data</Badge> : mode === 'live' ? <Badge tone="cyan">Live</Badge> : <Badge>…</Badge>}
          </Tip>
          <button onClick={() => set((s) => ({ showHelp: !s.showHelp }))} className="num flex h-7 w-7 items-center justify-center rounded-[3px] border border-line-2 text-[12px] text-mute hover:text-ink" aria-label="Keyboard shortcuts">
            ?
          </button>
        </div>
      </div>
    </header>
  );
}
