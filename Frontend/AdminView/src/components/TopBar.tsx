import { useEffect, useMemo, useState } from 'react';
import { isSendable, openDetails, setMode } from '../actions';
import { set, useConsole } from '../store';
import { evaLtst, fmtLtst, marsTime } from '../lib/marsclock';
import { dataSummary } from '../lib/science';
import type { UiMode } from '../lib/types';
import { LinkControls, SimControls } from './LiveParts';
import { Kbd, Popover, Tip, cx } from './ui';

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

const STEPS: { id: UiMode; n: string; label: string }[] = [
  { id: 'plan', n: '1', label: 'Plan' },
  { id: 'send', n: '2', label: 'Send' },
  { id: 'live', n: '3', label: 'EVA live' },
];

function Stepper() {
  const uiMode = useConsole((s) => s.uiMode);
  const plan = useConsole((s) => s.plan);
  const route = useConsole((s) => s.route);
  const sendable = isSendable(plan);
  const idx = STEPS.findIndex((s) => s.id === uiMode);
  return (
    <nav aria-label="Console mode" className="flex items-center gap-1 rounded-[10px] bg-sunk p-1" data-testid="stepper">
      {STEPS.map((st, i) => {
        const active = st.id === uiMode;
        const enabled = st.id === 'plan' || (st.id === 'send' && sendable) || (st.id === 'live' && !!route);
        const done = i < idx;
        return (
          <button
            key={st.id}
            data-testid={`step-${st.id}`}
            aria-current={active ? 'step' : undefined}
            disabled={!enabled}
            onClick={() => setMode(st.id)}
            className={cx(
              'flex h-11 items-center gap-2 rounded-[7px] px-3.5 font-display text-[13px] uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed',
              active ? 'bg-raised text-ink shadow-[inset_0_-2px_0_var(--color-amber)]' : enabled ? 'text-ink-2 hover:text-ink' : 'text-dim/70',
            )}
          >
            <span className={cx('num flex h-[20px] w-[20px] items-center justify-center rounded-full text-[11px]', active ? 'bg-amber text-[#16110a]' : done ? 'bg-cyan/20 text-cyan' : 'bg-white/[0.06]')}>{done ? '✓' : st.n}</span>
            {st.label}
          </button>
        );
      })}
    </nav>
  );
}

function SimMenu() {
  const open = useConsole((s) => s.simOpen);
  const sim = useConsole((s) => s.sim);
  const drop = useConsole((s) => s.linkCtl.drop);
  const mode = useConsole((s) => s.mode);
  return (
    <div className="relative">
      <button
        data-popover-anchor
        data-testid="sim-menu"
        onClick={() => set((s) => ({ simOpen: !s.simOpen, layersOpen: false }))}
        aria-expanded={open}
        className={cx('flex h-10 items-center gap-2 rounded-[8px] border border-dashed px-3 text-[12.5px] transition-colors', open ? 'border-ochre text-ochre' : 'border-ochre/45 text-ochre/85 hover:border-ochre hover:text-ochre')}
        title="Demo controls: simulated astronaut and link"
      >
        Simulation
        {(sim.running || drop) && <span className={cx('h-1.5 w-1.5 rounded-full', drop ? 'bg-red' : 'bg-ochre mw-pulse')} />}
      </button>
      <Popover open={open} onClose={() => set({ simOpen: false })} label="Simulation" className="right-0 top-12 w-[320px] p-4">
        <div className="flex items-center gap-2">
          <span className="font-display text-[13px] uppercase tracking-[0.12em] text-ochre">Simulation</span>
          <span className="rounded-full bg-ochre/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-ochre">demo only</span>
        </div>
        <div className="mt-1 text-[11.5px] leading-snug text-mute">Not real operations. {mode === 'mock' ? 'An in-browser visor simulates the astronaut.' : 'The visor runs a simulated astronaut on the accepted route.'}</div>
        <div className="eyebrow mb-2 mt-4">Simulated astronaut</div>
        <SimControls />
        <div className="eyebrow mb-2 mt-5">Surface link</div>
        <LinkControls />
      </Popover>
    </div>
  );
}

export function TopBar() {
  const pack = useConsole((s) => s.pack);
  const startLtst = useConsole((s) => s.startLtstMin);
  const lsDeg = useConsole((s) => s.lsDeg);
  const link = useConsole((s) => s.link);
  const route = useConsole((s) => s.route);
  const confirmStage = useConsole((s) => s.confirm.stage);
  const lastT = useConsole((s) => (s.telem.length ? s.telem[s.telem.length - 1].t : null));
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
  const missionLtst = evaLtst(startLtst, lastT ?? 0);
  const site = m?.name.replace(/\s*—.*$/, '') ?? 'Loading site…';

  return (
    <header className="relative z-30 flex h-[60px] shrink-0 items-center gap-4 bg-panel px-4">
      <div className="flex items-center gap-3">
        <Mark />
        <div className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-bold tracking-[0.24em] text-ink">MARSWALK</span>
          <span className="label mt-[3px] !text-[8.5px] !tracking-[0.3em]">Habitat console</span>
        </div>
      </div>
      <Tip
        side="bottom"
        width={300}
        content={
          <>
            <div className="text-ink">{m?.name}</div>
            <div className="num mt-1">{Math.abs(lat).toFixed(3)}°{lat < 0 ? 'S' : 'N'} {lon.toFixed(3)}°E · {m ? `${(m.grid.w * m.grid.cellM) / 1000} × ${(m.grid.h * m.grid.cellM) / 1000} km` : ''}</div>
            <div className="num mt-1">Season Ls {lsDeg.toFixed(0)}° · Coordinated Mars Time now {String(Math.floor(mt.mtcH)).padStart(2, '0')}:{String(Math.floor((mt.mtcH % 1) * 60)).padStart(2, '0')} (Mars24)</div>
          </>
        }
      >
        <div tabIndex={0} className="flex min-w-0 items-baseline gap-2 whitespace-nowrap text-[13px] text-ink-2">
          <span className="hidden truncate text-ink min-[1440px]:inline">{site}</span>
          <span className="hidden text-dim min-[1440px]:inline">·</span>
          <span className="num">Sol {m?.scenario.sol ?? '—'}</span>
          <span className="text-dim">·</span>
          <span><span className="text-mute">Mars local </span><span className="num text-ink">{fmtLtst(missionLtst)}</span></span>
        </div>
      </Tip>

      <div className="flex flex-1 justify-center">
        <Stepper />
      </div>

      <div className="flex items-center gap-2">
        <Tip side="bottom" width={280} content={link === 'down' ? 'Link to the visor is down. The visor keeps guiding the crew on board on the last accepted route.' : 'Surface radio link to the crew visor (EV1).'}>
          {link === 'down' && !route ? (
            <div data-testid="crew-link" data-link={link} className="flex h-10 items-center gap-2 rounded-[8px] px-3 text-[12.5px] text-mute">
              <span className="h-2 w-2 rounded-full bg-dim" />
              Visor offline
            </div>
          ) : (
            <div data-testid="crew-link" data-link={link} className={cx('flex h-10 items-center gap-2 rounded-[8px] px-3 text-[12.5px]', link === 'up' ? 'text-cyan' : link === 'degraded' ? 'bg-amber/10 text-amber' : 'bg-red/12 text-red')}>
              <span className={cx('h-2 w-2 rounded-full', link === 'up' ? 'bg-cyan' : link === 'degraded' ? 'bg-amber mw-pulse' : 'bg-red mw-pulse')} />
              Crew link {link === 'up' ? 'OK' : link === 'degraded' ? 'weak' : 'lost'}
            </div>
          )}
        </Tip>
        {route && (
          <div className="num hidden h-10 items-center gap-1.5 px-1 text-[12px] text-mute min-[1440px]:flex" title="Route version the crew has">
            Route v{route.seq}
            {route.acked ? <span className="text-cyan">✓</span> : confirmStage === 'rejected' ? <span className="text-red">✕</span> : <span className="mw-pulse text-amber">…</span>}
          </div>
        )}
        <SimMenu />
        {summary && (
          <button onClick={() => openDetails('sources')} className="flex h-10 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] text-mute hover:bg-raised hover:text-ink" title={summary.synthetic ? 'Synthetic terrain' : `${summary.missions.length} missions · ${summary.kinds.length} data kinds`}>
            Data
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><circle cx="7" cy="7" r="5.6" /><path d="M7 6.2 V10 M7 4.1 V4.3" strokeLinecap="round" /></svg>
          </button>
        )}
        <button data-testid="open-details" onClick={() => openDetails()} className="flex h-10 items-center gap-2 rounded-[8px] bg-raised px-3.5 text-[12.5px] text-ink-2 hover:text-ink">
          Details <Kbd>D</Kbd>
        </button>
        <button onClick={() => set((s) => ({ showHelp: !s.showHelp }))} className="num flex h-10 w-10 items-center justify-center rounded-[8px] text-[13px] text-mute hover:bg-raised hover:text-ink" aria-label="Keyboard shortcuts">
          ?
        </button>
      </div>
    </header>
  );
}
