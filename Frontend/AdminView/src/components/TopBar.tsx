import { useEffect, useMemo, useState } from 'react';
import { isSendable, openDetails, setMode, switchSite } from '../actions';
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
      <rect x="2.5" y="14.5" width="7" height="7" rx="1" stroke="#ffffff" strokeWidth="1.6" />
      <path d="M9.5 15.5 C 13 13, 13 9, 16.5 7.5" stroke="#ffffff" strokeWidth="1.6" strokeDasharray="1.2 2.4" strokeLinecap="round" />
      <path d="M15.2 3.6 L 21 6.4 L 16.4 10.4" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
    <nav aria-label="Console mode" className="flex items-center gap-1 rounded-[10px] bg-sunk p-1 phone:gap-0 phone:p-0.5" data-testid="stepper">
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
              'flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 phone:gap-1 phone:px-1.5 font-display text-[12px] min-[1100px]:gap-2 min-[1100px]:px-3.5 min-[1100px]:text-[13px] uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed',
              active ? 'bg-raised text-ink' : enabled ? 'text-ink-2 hover:text-ink' : 'text-dim/70',
            )}
          >
            <span className={cx('num flex h-[20px] w-[20px] items-center justify-center rounded-full text-[11px]', active ? 'bg-cyan text-black' : done ? 'bg-ok/20 text-ok' : 'bg-white/[0.06]')}>{done ? '✓' : st.n}</span>
            <span className={active ? '' : 'phone:hidden'}>{st.label}</span>
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
    <div className="relative phone:static">
      <button
        data-popover-anchor
        data-testid="sim-menu"
        onClick={() => set((s) => ({ simOpen: !s.simOpen, layersOpen: false }))}
        aria-expanded={open}
        className={cx('flex h-10 items-center gap-2 rounded-[8px] border border-dashed px-3 text-[12.5px] transition-colors phone:hidden', open ? 'border-mute text-mute' : 'border-mute/45 text-mute/85 hover:border-mute hover:text-mute')}
        title="Demo controls: simulated astronaut and link"
      >
        Simulation
        {(sim.running || drop) && <span className={cx('h-1.5 w-1.5 rounded-full', drop ? 'bg-red' : 'bg-mute mw-pulse')} />}
      </button>
      <Popover open={open} onClose={() => set({ simOpen: false })} label="Simulation" className="right-0 top-12 w-[320px] p-4 phone:fixed phone:right-2 phone:top-[60px] phone:w-[calc(100vw-16px)]">
        <div className="flex items-center gap-2">
          <span className="font-display text-[13px] uppercase tracking-[0.12em] text-mute">Simulation</span>
          <span className="rounded-full bg-mute/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-mute">demo only</span>
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

/** Site dropdown: native select, so keyboard and screen readers work (arrow keys / type-ahead, Enter). */
function SitePicker({ fallback }: { fallback: string }) {
  const sites = useConsole((s) => s.sites).filter((x) => x.available);
  const siteId = useConsole((s) => s.siteId);
  const uiMode = useConsole((s) => s.uiMode);
  const switching = useConsole((s) => s.switchingTo);
  if (sites.length < 2 || !siteId) return <span data-testid="site-name" className="truncate text-ink">{fallback}</span>;
  const locked = uiMode !== 'plan' || !!switching;
  return (
    <label className="relative flex items-center" title={uiMode !== 'plan' ? 'Back to Plan to change site' : 'Site'}>
      <span className="sr-only">Site</span>
      <select
        data-testid="site-select"
        aria-label="Site"
        value={switching ?? siteId}
        disabled={locked}
        onChange={(e) => void switchSite(e.target.value)}
        className="h-9 max-w-[200px] phone:h-11 phone:max-w-[112px] cursor-pointer appearance-none truncate rounded-[8px] border border-line-2 bg-black py-0 pl-2.5 pr-7 text-[13px] text-ink outline-none hover:border-cyan focus-visible:border-cyan disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sites.map((st) => (
          <option key={st.id} value={st.id}>{st.name.replace(/\s*—.*$/, '')}</option>
        ))}
      </select>
      <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none absolute right-2.5 text-cyan" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 3.5 L5 7 L8.5 3.5" /></svg>
    </label>
  );
}

/** Phone only: Details, Simulation, Data and Keyboard in one menu. */
function OverflowMenu({ hasData }: { hasData: boolean }) {
  const [open, setOpen] = useState(false);
  const item = 'flex h-12 w-full items-center px-4 text-left text-[15px] text-ink hover:bg-raised';
  const go = (f: () => void) => () => { setOpen(false); f(); };
  return (
    <div className="hidden phone:block">
      <button data-popover-anchor data-testid="overflow-menu" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-raised text-ink-2">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden><circle cx="3.5" cy="9" r="1.6" /><circle cx="9" cy="9" r="1.6" /><circle cx="14.5" cy="9" r="1.6" /></svg>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="More" className="phone:fixed phone:right-2 phone:top-[60px] phone:w-[220px] py-1">
        <button data-testid="open-details-m" className={item} onClick={go(() => openDetails())}>Details</button>
        <button className={item} onClick={go(() => set({ simOpen: true, layersOpen: false }))}>Simulation</button>
        {hasData && <button className={item} onClick={go(() => openDetails('sources'))}>Data sources</button>}
        <button className={item} onClick={go(() => set({ showHelp: true }))}>Keyboard shortcuts</button>
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
    <header className="relative z-30 phone:z-[60] flex h-[60px] min-w-0 shrink-0 items-center gap-3 overflow-hidden bg-panel px-3 phone:h-[56px] phone:gap-2 phone:px-2 min-[1100px]:gap-4 min-[1100px]:px-4">
      <div className="flex items-center gap-3">
        <Mark />
        <div className="flex flex-col leading-none phone:hidden">
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
          <span className="hidden phone:contents min-[1100px]:contents"><SitePicker fallback={site} /></span>
          <span className="hidden text-dim min-[1100px]:inline phone:hidden!">·</span>
          <span className="border border-line-2 px-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-mute phone:hidden">Scenario</span>
          <span className="num phone:hidden">Sol {m?.scenario.sol ?? '—'}</span>
          <span className="text-dim phone:hidden">·</span>
          <span className="phone:hidden"><span className="text-mute">Mars local </span><span className="num text-ink">{fmtLtst(missionLtst)}</span></span>
        </div>
      </Tip>

      <div className="flex min-w-0 flex-1 justify-center phone:flex-none">
        <Stepper />
      </div>

      <div className="flex shrink-0 items-center gap-1 phone:ml-auto min-[1100px]:gap-2">
        <Tip side="bottom" width={280} content={link === 'down' ? 'Link to the visor is down. The visor keeps guiding the crew on board on the last accepted route.' : 'Surface radio link to the crew visor (EV1).'}>
          {link === 'down' && !route ? (
            <div data-testid="crew-link" data-link={link} className="flex h-10 items-center gap-2 rounded-[8px] px-3 text-[12.5px] text-mute phone:px-1.5">
              <span className="h-2 w-2 rounded-full bg-dim" />
              <span className="phone:sr-only">Visor offline</span>
            </div>
          ) : (
            <div data-testid="crew-link" data-link={link} title="How recently the crew visor was last heard from: OK within 1.5 seconds, weak after 1.5 seconds, lost after 3 seconds of silence." className={cx('flex h-10 items-center gap-2 rounded-[8px] px-3 text-[12.5px]', link === 'up' ? 'text-ok' : link === 'degraded' ? 'bg-caution/10 text-caution' : 'bg-red/12 text-red', 'phone:bg-transparent phone:px-1.5')}>
              <span className={cx('h-2 w-2 rounded-full', link === 'up' ? 'bg-ok' : link === 'degraded' ? 'bg-caution mw-pulse' : 'bg-red mw-pulse')} />
              <span className="phone:sr-only">Crew link {link === 'up' ? 'OK' : link === 'degraded' ? 'weak' : 'lost'}</span>
            </div>
          )}
        </Tip>
        {route && (
          <div className="num hidden h-10 items-center gap-1.5 px-1 text-[12px] text-mute min-[1440px]:flex" title="Route version the crew has">
            Route v{route.seq}
            {route.acked ? <span className="text-ok">✓</span> : confirmStage === 'rejected' ? <span className="text-red">✕</span> : <span className="mw-pulse text-caution">…</span>}
          </div>
        )}
        <SimMenu />
        {summary && (
          <button onClick={() => openDetails('sources')} className="flex h-10 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] text-mute hover:bg-raised hover:text-ink phone:hidden" title={summary.synthetic ? 'Synthetic terrain' : `${summary.missions.length} missions · ${summary.kinds.length} data kinds`}>
            Data
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><circle cx="7" cy="7" r="5.6" /><path d="M7 6.2 V10 M7 4.1 V4.3" strokeLinecap="round" /></svg>
          </button>
        )}
        <button data-testid="open-details" onClick={() => openDetails()} className="flex h-10 items-center gap-2 rounded-[8px] bg-raised px-3.5 text-[12.5px] text-ink-2 hover:text-ink phone:hidden">
          Details <Kbd>D</Kbd>
        </button>
        <button onClick={() => set((s) => ({ showHelp: !s.showHelp }))} className="num flex h-10 w-10 items-center justify-center rounded-[8px] text-[13px] text-mute hover:bg-raised hover:text-ink phone:hidden" aria-label="Keyboard shortcuts">
          ?
        </button>
        <OverflowMenu hasData={!!summary} />
      </div>
    </header>
  );
}
