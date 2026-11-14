import { useMemo, useState } from 'react';
import { clearDestinations, isSendable, openDetails, primaryAction, removeDestination, setEvaBase, suggestStops } from '../actions';
import { useConsole } from '../store';
import { relabel, shortName, useBaseInfo } from '../lib/base';
import { fmtLtst } from '../lib/marsclock';
import { dropReason, verdictOf, type Verdict } from '../lib/plain';
import { LtstScrubber, stayInSentence, stayInWhy } from './PlanParts';
import { Button, Kbd, Popover, Tip, ToneMark, cx } from './ui';

const VERDICT_STYLE: Record<Verdict['status'], { word: string; ink: string; glow: string }> = {
  GO: { word: 'GO', ink: 'text-ok', glow: 'border-ok' },
  CAUTION: { word: 'CAUTION', ink: 'text-caution', glow: 'border-caution' },
  'NO-GO': { word: 'NO-GO', ink: 'text-red', glow: 'border-red' },
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
        <div className="eyebrow">Route check</div>
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
      className={cx('relative border bg-black px-4 pb-4 pt-3', nogo ? 'border-red' : 'border-line-2')}
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">{nogo ? `From ${base.short}` : `Route check · from ${base.short}`}</span>
        {status === 'planning' && <span className="mw-pulse text-[11px] text-caution">Re-planning…</span>}
      </div>
      <div className={cx('mt-2 inline-block border px-4 pt-1 font-display text-[64px] font-bold leading-[1.02] tracking-[0.06em]', st.ink, st.glow, status === 'planning' && 'opacity-60')} data-testid="verdict-word">
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
          {stagingText && <div className="mt-2.5 text-[12px] leading-snug text-ok/90">{stagingText.replace(/^Staging the EVA from/, 'Starting from')}</div>}
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
                  {l.neutral ? <span aria-label="Info" className="mt-[1px] inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center border border-line-2 text-mute">i</span> : <ToneMark tone={l.tone} className="mt-[1px]" />}
                  <span className={cx('text-[14px] leading-snug', l.neutral ? 'text-ink-2' : 'text-ink')}>{l.text}</span>
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
    <div className="grid grid-cols-[1fr_auto] items-end gap-3">
      <div className="hidden">
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
                className={cx('flex h-14 flex-1 flex-col items-center justify-center rounded-[6px] leading-tight transition-colors', on ? 'bg-raised text-ink' : 'text-mute hover:text-ink-2')}
              >
                <span className="font-display text-[13px] uppercase tracking-[0.1em]">{shortName(sh)}</span>
                <span className="text-[10.5px] opacity-75">{sh.kind === 'rover' ? 'Rover' : 'Habitat'}{on ? ' · start' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative">
        
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
      {movable && <div className="col-span-2 -mt-1 text-[12px] text-dim">Pick the start in the From field, or click Hab-1 or PR-1 on the map. Drag the rover to move it.</div>}
    </div>
  );
}

function SectionHead({ n, title, sub, right }: { n: number; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2.5 px-1">
      <span className="num flex h-6 w-6 items-center justify-center border border-cyan bg-black text-[12px] font-bold text-white">{n}</span>
      <div className="min-w-0">
        <div className="font-display text-[15px] font-semibold tracking-[0.04em] text-ink">{title}</div>
        {sub && <div className="text-[11.5px] text-mute">{sub}</div>}
      </div>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function Destinations() {
  const pack = useConsole((s) => s.pack)!;
  const dests = useConsole((s) => s.destinations);
  const customs = useConsole((s) => s.customStops);
  const plan = useConsole((s) => s.plan);
  const rules = useConsole((s) => s.rules);
  const status = useConsole((s) => s.planStatus);
  const live = useConsole((s) => s.uiMode === 'live');
  const all = useMemo(() => [...pack.manifest.stations, ...customs], [pack, customs]);
  const ord = (id: string) => { const i = plan?.order.indexOf(id) ?? -1; return i < 0 ? 99 : i; };
  const rows = dests.map((id) => all.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => ord(a.id) - ord(b.id));
  const single = rows.length === 1;
  return (
    <section data-testid="destinations">
      <SectionHead
        n={2}
        title="Where to"
        sub={rows.length ? undefined : 'Your destinations'}
        right={rows.length > 0 && !live ? <button onClick={clearDestinations} className="rounded-[6px] px-2 py-1 text-[11.5px] text-mute hover:bg-raised hover:text-ink">Clear all</button> : undefined}
      />
      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line-2 px-4 py-5 text-center text-[13.5px] text-mute" data-testid="dest-empty">Click a target on the map to add it</div>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="dest-list">
          {rows.map((st, i) => {
            const dropped = plan?.dropped.find((d) => d.id === st.id);
            const planned = plan ? plan.order.indexOf(st.id) >= 0 : false;
            const reason = dropped ? `Can't include: ${dropReason(dropped, rules)}` : plan && !planned && status !== 'planning' ? "Can't include in this walk" : null;
            return (
              <li key={st.id} data-testid={`dest-${st.id}`} className="flex min-h-[52px] items-center gap-3 rounded-[10px] bg-raised/50 px-3 py-1.5">
                <span className={cx('num flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold', reason ? 'bg-sunk text-red ring-1 ring-red/40' : 'bg-cyan text-black')}>
                  {reason ? '✕' : single ? 'B' : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-ink">{st.name.replace(/\s*\([^)]*\)\s*$/, '')}</div>
                  <div className={cx('text-[11.5px] leading-tight', reason ? 'text-red/90' : 'text-mute')}>{reason ?? `${st.id} · science value ${Math.round(st.value)}`}</div>
                </div>
                {!live && (
                  <button aria-label={`Remove ${st.id}`} data-testid={`dest-remove-${st.id}`} onClick={() => removeDestination(st.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-[16px] text-mute hover:bg-sunk hover:text-ink">
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > 1 && <div className="mt-1.5 px-1 text-[11.5px] text-mute">Order: fastest (planner decides)</div>}
      {!live && (
        <Button data-testid="suggest-stops" variant="ghost" size="xl" className="mt-2.5 w-full ring-1 ring-line-2" onClick={() => void suggestStops()}>
          Suggest best stops
        </Button>
      )}
    </section>
  );
}

function RouteSection() {
  const dests = useConsole((s) => s.destinations);
  const plan = useConsole((s) => s.plan);
  const rules = useConsole((s) => s.rules);
  const customs = useConsole((s) => s.customStops);
  const pack = useConsole((s) => s.pack)!;
  if (!dests.length) return null;
  const nameOf = (id: string) => [...pack.manifest.stations, ...customs].find((x) => x.id === id)?.name.replace(/\s*\([^)]*\)\s*$/, '') ?? id;
  const dropped = plan?.dropped.filter((d) => dests.includes(d.id)) ?? [];
  return (
    <section data-testid="route-section">
      <SectionHead n={2} title="Is it safe?" />
      <VerdictCard />
      {dropped.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 px-1 text-[12.5px] text-red/90" data-testid="dropped-list">
          {dropped.map((d) => (
            <li key={d.id}>{d.id} ({nameOf(d.id)}) can't be reached safely: {dropReason(d, rules)}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 px-1 text-[12px] text-mute">Stops are reordered for the fastest safe loop &middot; round trip back to the start.</div>
    </section>
  );
}

/** ① PLAN: route builder. 1 Start, 2 Where to, 3 Route; one primary action. */
export function PlanPanel() {
  const plan = useConsole((s) => s.plan);
  const status = useConsole((s) => s.planStatus);
  const route = useConsole((s) => s.route);
  const has = useConsole((s) => s.destinations.length > 0);
  const sendable = isSendable(plan);
  const differs = !!route && !!plan && route.reqHash !== plan.reqHash;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-4">
        <div className="flex flex-col gap-6">
          <section>
            <SectionHead n={1} title="Start time" />
            <StartControls />
          </section>
          <RouteSection />
          {has && <button onClick={() => openDetails('report')} className="self-start px-1 text-[12px] text-ok hover:underline">Full report, rules and margins in Details →</button>}
        </div>
      </div>
      {plan?.status !== 'STAY_IN' && (
        <div className="shrink-0 bg-panel px-4 pb-4 pt-3">
          {differs && <div className="mb-2 text-[11.5px] text-caution">This plan differs from route v{route!.seq} the crew has.</div>}
          <Button data-testid="review-send" variant="primary" size="xl" className="w-full" disabled={!has || !sendable || status !== 'ready'} onClick={primaryAction}>
            Review &amp; send <span aria-hidden>→</span> <Kbd>⏎</Kbd>
          </Button>
        </div>
      )}
    </div>
  );
}
