import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Station } from '@mw/shared/contracts';
import { isSendable, openDetails, primaryAction, setAllStations, setEvaBase, toggleMustVisit, toggleStation } from '../actions';
import { set, useConsole } from '../store';
import { relabel, shortName, useBaseInfo } from '../lib/base';
import { fmtLtst } from '../lib/marsclock';
import { dropReason, verdictOf, type Verdict } from '../lib/plain';
import { LtstScrubber, StationDetails, stayInSentence, stayInWhy } from './PlanParts';
import { Button, Kbd, Popover, Tip, ToneMark, cx } from './ui';

const VERDICT_STYLE: Record<Verdict['status'], { word: string; ink: string; glow: string }> = {
  GO: { word: 'GO', ink: 'text-cyan', glow: 'from-cyan/[0.10]' },
  CAUTION: { word: 'CAUTION', ink: 'text-amber', glow: 'from-amber/[0.10]' },
  'NO-GO': { word: 'NO-GO', ink: 'text-red', glow: 'from-red/[0.14]' },
};

function VerdictCard() {
  const plan = useConsole((s) => s.plan);
  const pack = useConsole((s) => s.pack)!;
  const rules = useConsole((s) => s.rules);
  const events = useConsole((s) => s.events);
  const start = useConsole((s) => s.startLtstMin);
  const ls = useConsole((s) => s.lsDeg);
  const light = useConsole((s) => s.earth?.oneWayLightMin);
  const status = useConsole((s) => s.planStatus);
  const error = useConsole((s) => s.planError);
  const base = useBaseInfo();
  const [why, setWhy] = useState(false);
  const v = useMemo(
    () => (plan && base ? verdictOf({ plan, pack, base, rules, events, startLtstMin: start, lsDeg: ls, lightMin: light }) : null),
    [plan, pack, base, rules, events, start, ls, light],
  );
  if (!v || !plan || !base) {
    return (
      <div className="rounded-[12px] bg-raised/60 px-5 py-6">
        <div className="eyebrow">Recommended plan</div>
        <div className="mt-3 font-display text-[28px] font-semibold tracking-[0.06em] text-mute">{status === 'error' ? 'Planning failed' : 'Planning…'}</div>
        {error && <div className="mt-2 text-[12.5px] text-red">{error}</div>}
      </div>
    );
  }
  const st = VERDICT_STYLE[v.status];
  const nogo = v.status === 'NO-GO';
  const rover = pack.manifest.shelters.find((s) => s.kind === 'rover' && s.id !== base.id);
  const sentence = nogo ? stayInSentence(base) : null;
  const long = nogo ? stayInWhy(base) : null;
  const staging = nogo ? plan.notes.find((n) => /^Staging the EVA from /.test(n)) : null;
  const stagingText = staging ? relabel(pack, base, staging.replace(/\s*Re-plan with stageFromShelter\([^)]*\)\.?/, '')) : null;
  return (
    <section
      data-testid={nogo ? 'stayin-card' : 'verdict'}
      data-verdict={v.status}
      aria-live="polite"
      className={cx('relative overflow-hidden rounded-[12px] bg-gradient-to-b to-transparent px-5 pb-4 pt-4', st.glow, nogo ? 'bg-red/[0.05] ring-1 ring-red/35' : 'bg-raised/50')}
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">{nogo ? `From ${base.short}` : `Recommended plan · from ${base.short}`}</span>
        {status === 'planning' && <span className="mw-pulse text-[11px] text-amber">Re-planning…</span>}
      </div>
      <div className={cx('mt-1 font-display text-[50px] font-bold leading-[1.02] tracking-[0.04em]', st.ink, status === 'planning' && 'opacity-60')} data-testid="verdict-word">
        {st.word}
      </div>
      <div className="mt-0.5 text-[16px] font-medium text-ink" data-testid="verdict-headline">{v.headline}</div>

      {nogo ? (
        <>
          {sentence && <div data-testid="stayin-reason" className="mt-3 text-[14px] leading-snug text-ink-2">{sentence}</div>}
          {plan.binding && <div data-testid="stayin-binding" className="sr-only">{relabel(pack, base, plan.binding.text)}</div>}
          {rover && (
            <Button data-testid="stage-from-rover" variant="primary" size="xl" className="mt-4 w-full" onClick={() => setEvaBase(rover.id)}>
              Start from rover instead <Kbd>⏎</Kbd>
            </Button>
          )}
          {stagingText && <div className="mt-2.5 text-[12px] leading-snug text-cyan/90">{stagingText.replace(/^Staging the EVA from/, 'Starting from')}</div>}
          {long && (
            <div className="mt-2">
              <button onClick={() => setWhy((x) => !x)} className="text-[12px] text-mute hover:text-ink" aria-expanded={why}>{why ? 'Hide the physics' : 'Show the physics'}</button>
              {why && <div data-testid="stayin-why" className="mt-1.5 text-[12px] leading-snug text-mute">{long}</div>}
              {!why && <div data-testid="stayin-why" className="sr-only">{long}</div>}
            </div>
          )}
        </>
      ) : (
        <ul className="mt-3.5 flex flex-col gap-2" data-testid="verdict-lines">
          {v.lines.map((l) => (
            <li key={l.key} data-tone={l.tone} data-line={l.key}>
              <Tip content={l.sub ?? l.text} side="left" width={300} className="w-full">
                <span className="flex w-full items-start gap-2.5">
                  <ToneMark tone={l.tone} className="mt-[1px]" />
                  <span className={cx('text-[14px] leading-snug', l.key === 'limit' ? 'text-ink-2' : 'text-ink')}>{l.text}</span>
                </span>
              </Tip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StartControls() {
  const pack = useConsole((s) => s.pack)!;
  const evaBase = useConsole((s) => s.evaBase);
  const start = useConsole((s) => s.startLtstMin);
  const uiMode = useConsole((s) => s.uiMode);
  const [timeOpen, setTimeOpen] = useState(false);
  const shelters = pack.manifest.shelters.filter((s) => s.kind === 'hab' || s.kind === 'rover');
  const movable = shelters.some((s) => s.movable);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3">
      <div>
        <div className="eyebrow mb-1.5">Start from</div>
        <div className="flex rounded-[8px] bg-sunk p-[3px]" role="radiogroup" aria-label="EVA base">
          {shelters.map((sh) => {
            const on = evaBase === sh.id;
            return (
              <button
                key={sh.id}
                role="radio"
                aria-checked={on}
                data-testid={`eva-base-${sh.id}`}
                disabled={uiMode === 'live'}
                onClick={() => setEvaBase(sh.id)}
                title={sh.kind === 'rover' ? `${sh.name}: the EVA starts and ends at the rover. Drag it on the map to move it.` : `${sh.name}: the EVA starts and ends at the habitat airlock.`}
                className={cx('flex h-11 flex-1 flex-col items-center justify-center rounded-[6px] leading-tight transition-colors', on ? 'bg-raised text-ink shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]' : 'text-mute hover:text-ink-2')}
              >
                <span className="font-display text-[13px] uppercase tracking-[0.1em]">{shortName(sh)}</span>
                <span className="text-[10.5px] opacity-75">{sh.kind === 'rover' ? 'Rover' : 'Habitat'}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative">
        <div className="eyebrow mb-1.5">Start time</div>
        <button
          data-popover-anchor
          data-testid="start-time"
          onClick={() => setTimeOpen((o) => !o)}
          aria-expanded={timeOpen}
          className="flex h-[50px] w-[124px] flex-col items-start justify-center rounded-[8px] bg-sunk px-3 text-left hover:bg-raised"
        >
          <span className="num text-[18px] leading-none text-ink">{fmtLtst(start)}</span>
          <span className="mt-1 text-[10.5px] text-mute">Mars local time ▾</span>
        </button>
        <Popover open={timeOpen} onClose={() => setTimeOpen(false)} label="EVA start time" className="right-0 top-[78px] w-[360px] p-4">
          <LtstScrubber />
          <div className="mt-3 text-[11px] leading-snug text-dim">Drag along the sun curve. The plan updates as you go.</div>
        </Popover>
      </div>
      {movable && <div className="col-span-2 -mt-1 text-[11px] text-dim">Tip: drag the rover on the map to move where the walk starts.</div>}
    </div>
  );
}

function StopRow({ st }: { st: Station }) {
  const on = useConsole((s) => !!s.stationOn[st.id]);
  const must = useConsole((s) => !!s.mustVisit[st.id]);
  const plan = useConsole((s) => s.plan);
  const rules = useConsole((s) => s.rules);
  const selected = useConsole((s) => s.selectedStation === st.id);
  const live = useConsole((s) => s.uiMode === 'live');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);
  const order = plan?.order.indexOf(st.id) ?? -1;
  const dropped = plan?.dropped.find((d) => d.id === st.id);
  const reason = !on ? 'Left out by you' : dropped ? dropReason(dropped, rules) : order < 0 && plan ? 'Not in this plan' : null;
  const name = st.name.replace(/\s*\([^)]*\)\s*$/, '');
  return (
    <div ref={ref} data-testid={`stop-${st.id}`} data-in-plan={order >= 0} className={cx('rounded-[8px] transition-colors', selected ? 'bg-raised' : 'hover:bg-raised/50')}>
      <div className="flex min-h-[44px] items-center gap-2.5 px-2">
        <button
          role="checkbox"
          aria-checked={on}
          aria-label={`${on ? 'Leave out' : 'Include'} ${st.id}`}
          data-testid={`stop-toggle-${st.id}`}
          disabled={live}
          onClick={() => toggleStation(st.id)}
          className="group -my-1 -ml-1 flex h-11 w-10 shrink-0 items-center justify-center rounded-[8px] disabled:cursor-default"
          title={on ? 'Included: click to leave out' : 'Left out: click to include'}
        >
          <span className={cx(
            'flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
            order >= 0 ? 'num bg-amber text-[#16110a] group-hover:bg-[#ffc65c]' : on ? 'bg-sunk text-red ring-1 ring-red/40' : 'bg-sunk text-dim ring-1 ring-line-2 group-hover:ring-ink-2',
          )}>
            {order >= 0 ? order + 1 : on ? '✕' : ''}
          </span>
        </button>
        <button onClick={() => set({ selectedStation: selected ? null : st.id })} className="min-w-0 flex-1 py-1.5 text-left" aria-expanded={selected}>
          <div className="flex items-baseline gap-2">
            <span className="num shrink-0 text-[11.5px] text-mute">{st.id}</span>
            <span className={cx('truncate text-[13.5px]', on ? 'text-ink' : 'text-mute')}>{name}</span>
          </div>
          {reason && <div className={cx('truncate text-[11.5px] leading-tight', !on ? 'text-dim' : 'text-red/90')}>{reason}</div>}
        </button>
        <span className="flex w-[52px] shrink-0 items-center gap-1.5" title={`Science value ${Math.round(st.value)} of 100`}>
          <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-sunk">
            <span className="block h-full rounded-full bg-ochre" style={{ width: `${st.value}%` }} />
          </span>
          <span className="num w-[18px] text-right text-[11px] text-ink-2">{Math.round(st.value)}</span>
        </span>
        <button
          aria-pressed={must}
          aria-label={`${must ? 'Unpin' : 'Pin'} ${st.id} as must visit`}
          data-testid={`stop-pin-${st.id}`}
          disabled={live}
          onClick={() => toggleMustVisit(st.id)}
          className={cx('flex h-10 w-9 shrink-0 items-center justify-center rounded-[6px] transition-colors', must ? 'text-amber' : 'text-dim/70 hover:text-ink-2')}
          title={must ? 'Must visit: the planner keeps it whenever any safe plan can' : 'Pin as must visit'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill={must ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M5 1.5 h4 l-0.6 4 2.1 2.2 H3.5 L5.6 5.5 Z M7 7.7 V12.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {selected && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden px-2 pl-[46px]">
            <StationDetails st={st} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StopsList() {
  const pack = useConsole((s) => s.pack)!;
  const plan = useConsole((s) => s.plan);
  const live = useConsole((s) => s.uiMode === 'live');
  const stations = pack.manifest.stations;
  const inPlan = plan?.order.length ?? 0;
  // Planned stops first (walking order), then the rest by value.
  const sorted = useMemo(() => {
    const ord = plan?.order ?? [];
    return [...stations].sort((a, b) => {
      const ia = ord.indexOf(a.id), ib = ord.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return b.value - a.value;
    });
  }, [stations, plan]);
  return (
    <section>
      <div className="flex items-center gap-2 px-1">
        <span className="eyebrow">Stops</span>
        <span className="num text-[12px] text-ink-2" data-testid="stops-count">{inPlan} of {stations.length}</span>
        {!live && (
          <span className="ml-auto flex gap-1">
            <button className="rounded-[5px] px-2 py-1 text-[11px] text-mute hover:bg-raised hover:text-ink" onClick={() => setAllStations(true)}>All</button>
            <button className="rounded-[5px] px-2 py-1 text-[11px] text-mute hover:bg-raised hover:text-ink" onClick={() => setAllStations(false)}>None</button>
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-col gap-0.5" data-testid="stops">
        {sorted.map((st) => <StopRow key={st.id} st={st} />)}
      </div>
      <div className="mt-2 px-1 text-[11px] leading-snug text-dim">Click a number to include or leave out a stop; the plan updates at once. Values are a team science heuristic.</div>
    </section>
  );
}

/** ① PLAN: verdict first, then the few inputs, then the stops checklist; one primary action. */
export function PlanPanel() {
  const plan = useConsole((s) => s.plan);
  const status = useConsole((s) => s.planStatus);
  const route = useConsole((s) => s.route);
  const sendable = isSendable(plan);
  const differs = !!route && !!plan && route.reqHash !== plan.reqHash;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-4">
        <div className="flex flex-col gap-5">
          <VerdictCard />
          <StartControls />
          <StopsList />
          <button onClick={() => openDetails('report')} className="self-start px-1 text-[12px] text-cyan hover:underline">Full report, rules and margins in Details →</button>
        </div>
      </div>
      {plan?.status !== 'STAY_IN' && (
        <div className="shrink-0 bg-panel px-4 pb-4 pt-3 shadow-[0_-12px_24px_rgba(10,11,13,0.9)]">
          {differs && <div className="mb-2 text-[11.5px] text-amber">This plan differs from route v{route!.seq} the crew has.</div>}
          <Button data-testid="review-send" variant="primary" size="xl" className="w-full" disabled={!sendable || status !== 'ready'} onClick={primaryAction}>
            Review &amp; send <span aria-hidden>→</span> <Kbd>⏎</Kbd>
          </Button>
        </div>
      )}
    </div>
  );
}
