import { useMemo, type ReactNode } from 'react';
import { isSendable, openDetails, openSheet, setMode } from '../actions';
import { set, useConsole } from '../store';
import { endpointLabel, useBaseInfo } from '../lib/base';
import { evaLtst, fmtLtst } from '../lib/marsclock';
import { liveValues, scheduleDelta, type Tone } from '../lib/plain';
import type { ActionKind } from '../lib/types';
import { Button, Kbd, cx } from './ui';

const TONE_INK: Record<Tone, string> = { ok: 'text-ink', watch: 'text-caution', act: 'text-red' };
const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok', watch: 'bg-caution', act: 'bg-red' };

/** ③ EVA live: is my crew OK, are we on time, what's next? Readable in one glance. */
function CrewCard() {
  const telem = useConsole((s) => s.telem);
  const plan = useConsole((s) => s.sentPlan ?? s.plan);
  const req = useConsole((s) => s.planReq);
  const fields = useConsole((s) => s.fields);
  const rules = useConsole((s) => s.rules);
  const link = useConsole((s) => s.link);
  const events = useConsole((s) => s.events);
  const pack = useConsole((s) => s.pack)!;
  const start = useConsole((s) => s.startLtstMin);
  const route = useConsole((s) => s.route);
  const shelterCells = useConsole((s) => s.shelterCells);
  const base = useBaseInfo()!;
  const last = telem[telem.length - 1];
  const delta = useMemo(() => (plan && telem.length ? scheduleDelta(plan, telem, pack.manifest.grid) : null), [plan, telem, pack]);
  const values = useMemo(() => (last && plan ? liveValues({ last, plan, req, fields, rules, link, events }) : []), [last, plan, req, fields, rules, link, events]);
  const label = (id: string, cell?: number) => endpointLabel(pack, base, id, shelterCells, cell);

  if (!last || !plan) {
    return (
      <section className="rounded-[12px] bg-raised/50 px-5 py-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Crew · EV1</span>
          <LinkPill />
        </div>
        <div className="mt-3 font-display text-[26px] font-semibold tracking-[0.04em] text-ink-2">{route?.acked ? 'Ready to walk' : 'Waiting for the crew'}</div>
        <div className="mt-1.5 text-[13px] leading-snug text-mute">
          {route?.acked ? `Route v${route.seq} accepted. Crew data appears here as soon as they start walking.` : route ? `Route v${route.seq} sent; waiting for EV1 to accept it on the visor.` : 'No route sent yet.'}
        </div>
        <div className="mt-3 text-[11.5px] text-dim">Demo: start the simulated astronaut from the Simulation menu (top bar).</div>
      </section>
    );
  }

  const returning = plan.order.length === 0;
  // Radiation spike declared but the return route not sent yet: the crew has been told to head for shelter.
  const sepPending = !returning && events.some((e) => e.t === 'SEP_NOWCAST');
  const stopNow = plan.stops.find((s) => last.t >= s.arriveMin - 0.3 && last.t <= s.departMin + 0.3);
  const nextStop = plan.stops.find((s) => s.arriveMin > last.t + 0.3);
  const lastSeg = plan.segments[plan.segments.length - 1];
  const endName = lastSeg ? label(lastSeg.to, lastSeg.cells[lastSeg.cells.length - 1]) : base.short;
  const offRoute = delta && delta.offRouteM > 60;
  const d = delta?.deltaMin ?? 0;
  const statusText = sepPending ? 'Return now' : offRoute ? 'Off route' : returning ? `Returning to ${endName}` : delta === null ? 'Tracking' : Math.abs(d) < 2 ? 'On plan' : d > 0 ? `${Math.round(d)} min ahead` : `${Math.round(-d)} min behind`;
  const statusTone: Tone = sepPending || offRoute || d < -10 ? 'act' : returning || d < -2 ? 'watch' : 'ok';
  let next: ReactNode = null;
  if (sepPending) {
    next = <>Radiation spike: crew told to head for shelter. <b className="font-medium text-ink">Send them the return route.</b></>;
  } else if (stopNow) {
    const b = plan.bingo.find((x) => x.id === stopNow.id);
    next = <>Leave <b className="font-medium text-ink">{stopNow.id}</b> at {fmtLtst(evaLtst(start, stopNow.departMin))}{b ? <span className="text-caution"> · latest {fmtLtst(b.ltstMin)}</span> : null}</>;
  } else if (nextStop) {
    next = <>Arrive <b className="font-medium text-ink">{nextStop.id}</b> at {fmtLtst(evaLtst(start, nextStop.arriveMin))} <span className="text-mute">(stop {plan.order.indexOf(nextStop.id) + 1} of {plan.order.length})</span></>;
  } else if (lastSeg) {
    next = <>Back at <b className="font-medium text-ink">{endName}</b> by {fmtLtst(evaLtst(start, lastSeg.t1Min))}</>;
  }
  const worst = values.find((v) => v.tone === 'act') ?? values.find((v) => v.tone === 'watch');

  return (
    <section data-testid="telemetry" data-status={statusTone} className={cx('rounded-[12px] px-5 pb-4 pt-4', statusTone === 'act' ? 'bg-red/[0.07] ring-1 ring-red/35' : 'bg-raised/50')}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">Crew · EV1 · {fmtLtst(evaLtst(start, last.t))}</span>
        <LinkPill />
      </div>
      <div data-testid="crew-status" className={cx('mt-1.5 font-display text-[32px] font-bold leading-none tracking-[0.03em]', statusTone === 'ok' ? 'text-ok' : statusTone === 'watch' ? 'text-caution' : 'text-red')}>
        {statusText}
      </div>
      {next && <div data-testid="crew-next" className="mt-2 text-[14.5px] leading-snug text-ink-2"><span className="text-mute">Next: </span>{next}</div>}
      <div className={cx('mt-2 text-[12.5px]', sepPending ? 'text-red' : worst ? TONE_INK[worst.tone] : 'text-mute')} data-testid="crew-risk">
        {sepPending ? 'Biggest risk: radiation dose until the crew reaches shelter' : worst ? `Watch: ${worst.label.toLowerCase()} ${worst.tone === 'act' ? 'past the limit' : 'getting close'}` : 'All values normal'}
      </div>
      <dl className="mt-3.5 flex flex-col gap-0.5">
        {values.map((v) => (
          <div key={v.key} data-key={v.key} data-tone={v.tone} title={v.hint} className="flex items-center gap-3 rounded-[6px] py-1.5">
            <span className={cx('h-2 w-2 shrink-0 rounded-full', TONE_DOT[v.tone])} />
            <dt className="flex-1 text-[13.5px] text-ink-2">{v.label}</dt>
            <dd className={cx('num text-[19px] leading-none', TONE_INK[v.tone])}>
              {v.value}
              {v.unit && <span className="ml-1 text-[11.5px] text-mute">{v.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LinkPill() {
  const link = useConsole((s) => s.link);
  return (
    <span className={cx('flex items-center gap-1.5 text-[12px]', link === 'up' ? 'text-ok' : link === 'degraded' ? 'text-caution' : 'text-red')}>
      <span className={cx('h-2 w-2 rounded-full', link === 'up' ? 'bg-ok' : link === 'degraded' ? 'bg-caution mw-pulse' : 'bg-red mw-pulse')} />
      {link === 'up' ? 'Link OK' : link === 'degraded' ? 'Link weak' : 'Link lost'}
    </span>
  );
}

const ACTIONS: { kind: ActionKind; label: string; sub: string; icon: ReactNode; danger?: boolean }[] = [
  {
    kind: 'sep', label: 'Radiation spike', sub: 'On-board dose rate up', danger: true,
    icon: <path d="M8 8 m-1.6 0 a1.6 1.6 0 1 0 3.2 0 a1.6 1.6 0 1 0 -3.2 0 M8 6.4 L5.6 2.2 A6.5 6.5 0 0 1 10.4 2.2 Z M9.4 8.8 L13.9 10.4 A6.5 6.5 0 0 1 11.5 14.2 Z M6.6 8.8 L4.5 14.2 A6.5 6.5 0 0 1 2.1 10.4 Z" fill="currentColor" stroke="none" />,
  },
  { kind: 'hazard', label: 'Hazard reported', sub: 'Block an area, re-route', icon: <path d="M8 2 L14.5 13.5 H1.5 Z M8 6.5 V9.5 M8 11.4 V11.6" fill="none" /> },
  { kind: 'cut', label: 'Shorten EVA', sub: 'Less time outside', icon: <path d="M8 2.5 a5.5 5.5 0 1 0 0.01 0 M8 5 V8.3 L10.2 9.6" fill="none" /> },
  { kind: 'recall', label: 'Recall crew', sub: 'Come home now', icon: <path d="M2.5 8.5 L8 3 L13.5 8.5 M4.5 7 V13 H11.5 V7" fill="none" /> },
];

function ActionDock() {
  const busy = useConsole((s) => s.busyEvent);
  const sheet = useConsole((s) => s.sheet);
  return (
    <section>
      <div className="eyebrow mb-2 px-1">If something happens</div>
      <div className="grid grid-cols-2 gap-2" data-testid="action-dock">
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            data-testid={`action-${a.kind}`}
            onClick={() => openSheet(a.kind)}
            disabled={!!busy || !!sheet}
            className={cx(
              'flex min-h-[60px] items-center gap-2.5 rounded-[10px] px-3 text-left transition-colors disabled:opacity-40',
              a.danger ? 'bg-red/[0.10] text-red hover:bg-red/[0.18]' : 'bg-raised text-ink hover:bg-[#20242b]',
            )}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">{a.icon}</svg>
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-[14px] font-medium leading-tight">{a.label}</span>
              <span className={cx('block truncate text-[11px]', a.danger ? 'text-red/70' : 'text-mute')}>{a.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** A drafted change the officer closed without sending (stays visible until sent or replaced). */
function UnsentChange() {
  const plan = useConsole((s) => s.plan);
  const route = useConsole((s) => s.route);
  const sheet = useConsole((s) => s.sheet);
  const status = useConsole((s) => s.planStatus);
  if (sheet || !plan || !route || plan.reqHash === route.reqHash || !isSendable(plan) || status !== 'ready') return null;
  return (
    <div className="rounded-[10px] bg-caution/[0.08] px-4 py-3 ring-1 ring-caution/30">
      <div className="text-[13px] font-medium text-caution">New plan not sent yet</div>
      <div className="mt-0.5 text-[12px] text-ink-2">The crew is still on route v{route.seq}.</div>
      <Button variant="primary" className="mt-2.5 w-full" onClick={() => set({ uiMode: 'send', confirm: { stage: 'review' } })}>Review &amp; send <Kbd>⏎</Kbd></Button>
    </div>
  );
}

export function LivePanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4">
        <div className="flex flex-col gap-4">
          <CrewCard />
          <UnsentChange />
          <ActionDock />
          <div className="flex items-center gap-3 px-1 text-[12px]">
            <button onClick={() => setMode('plan')} className="text-mute hover:text-ink">See the plan</button>
            <span className="text-line-2">·</span>
            <button onClick={() => openDetails('margins')} className="text-ok hover:underline">Margins over time →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
