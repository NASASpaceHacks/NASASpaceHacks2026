import { useEffect, useMemo, useRef, useState } from 'react';
import { set, useConsole } from '../store';
import { endpointLabel, useBaseInfo } from '../lib/base';
import { evaLtst, evaMinAt, fmtLtst } from '../lib/marsclock';
import { deadlineT, hm, hmShort, returnT, scheduleDelta } from '../lib/plain';
import { cx } from './ui';

/**
 * The EVA timeline: the spine of the console, the way flight controllers read an EVA.
 * airlock → walk → stop (dwell) → … → back in · rest blocks (suit-heat governor) · leave-by ticks ·
 * the walk-back deadline · the spare time before it · in EVA live a NOW cursor and ahead/behind.
 * Built only from the PlanResult (segments, stops, restMin, bingo) and the flight rules.
 */
export function Timeline() {
  // EVA live follows the route the crew has; a drafted change shows in the action sheet and on the map.
  const plan = useConsole((s) => (s.uiMode === 'live' && s.sentPlan && !s.sheet ? s.sentPlan : s.plan));
  const req = useConsole((s) => s.planReq);
  const pack = useConsole((s) => s.pack);
  const rules = useConsole((s) => s.rules);
  const events = useConsole((s) => s.events);
  const start = useConsole((s) => s.startLtstMin);
  const uiMode = useConsole((s) => s.uiMode);
  const telem = useConsole((s) => s.telem);
  const status = useConsole((s) => s.planStatus);
  const shelterCells = useConsole((s) => s.shelterCells);
  const selected = useConsole((s) => s.selectedStation);
  const base = useBaseInfo();
  const live = uiMode === 'live';
  const lastT = live && telem.length ? telem[telem.length - 1].t : null;

  const model = useMemo(() => {
    if (!plan || !pack || !base || !plan.segments.length) return null;
    const rv = (id: string, d: number) => {
      const r = rules.find((x) => x.id === id);
      return r && r.enabled ? r.value : d;
    };
    const evaMax = rv('eva_duration_max_min', 360);
    const half = rv('egress_ingress_min', 60) / 2;
    const cut = events.reduce((a, e) => (e.t === 'EVA_CUT' ? a + e.min : a), 0);
    const back = returnT(plan);
    const dl = deadlineT(plan) ?? evaMax - cut - half;
    const resumed = req?.resume?.elapsedMin ?? null;
    const t1 = Math.max(evaMax - cut, back + half, dl + half) * 1.02;
    const label = (id: string, cell?: number) => endpointLabel(pack, base, id, shelterCells, cell);
    const order = (id: string) => plan.order.indexOf(id) + 1;
    return { evaMax, half, cut, back, dl, resumed, t1, label, order };
  }, [plan, pack, base, rules, events, req, shelterCells]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(900);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth || 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!model]); // eslint-disable-line react-hooks/exhaustive-deps
  const delta = useMemo(() => (live && plan && pack && telem.length ? scheduleDelta(plan, telem, pack.manifest.grid) : null), [live, plan, pack, telem]);

  if (!model || !plan) {
    return (
      <div className="flex h-full items-center px-5 text-[12.5px] text-mute">
        {status === 'planning' ? 'Planning the walk…' : plan?.status === 'STAY_IN' ? 'No walk to show: nothing is safe from this base.' : 'The EVA timeline appears with the plan.'}
      </div>
    );
  }
  const { half, back, dl, resumed, t1, label, order } = model;
  const x = (t: number) => `${(Math.max(0, Math.min(t1, t)) / t1) * 100}%`;
  const w = (a: number, b: number) => `${(Math.max(0, Math.min(t1, b) - Math.max(0, a)) / t1) * 100}%`;
  const firstSeg = plan.segments[0];
  const endsAtBase = (() => {
    const last = plan.segments[plan.segments.length - 1];
    return !!last && (last.to === 'HAB' || last.to === base?.id);
  })();
  // Hour ticks on the Mars clock, placed at their EVA minute (Mars minutes are 1.0275 Earth minutes).
  const hours: { t: number; ltst: number }[] = [];
  for (let h = Math.ceil(start / 60) * 60; evaMinAt(start, h) <= t1; h += 60) hours.push({ t: evaMinAt(start, h), ltst: h });
  const px = (a: number, b: number) => ((Math.min(t1, b) - Math.max(0, a)) / t1) * trackW;
  const spare = dl - back;
  const deltaText = delta === null ? null : delta.offRouteM > 60 ? `${Math.round(delta.offRouteM)} m off route` : Math.abs(delta.deltaMin) < 2 ? 'On plan' : delta.deltaMin > 0 ? `${Math.round(delta.deltaMin)} min ahead` : `${Math.round(-delta.deltaMin)} min behind`;
  const deltaTone = delta === null ? '' : delta.offRouteM > 60 || delta.deltaMin < -10 ? 'text-red' : delta.deltaMin < -2 ? 'text-amber' : 'text-cyan';

  return (
    <div data-testid="timeline" className="relative flex h-full flex-col px-5 pb-2.5 pt-2.5" aria-label="EVA timeline">
      <div className="flex items-center gap-4">
        <span className="eyebrow">EVA timeline</span>
        <span className="num text-[11.5px] text-mute">Mars local time · {fmtLtst(start)} → {fmtLtst(evaLtst(start, plan.totals.durationMin))}</span>
        {live && (
          <span data-testid="timeline-delta" className={cx('num ml-1 text-[12.5px] font-medium', deltaTone || 'text-mute')}>
            {lastT === null ? 'Waiting for the crew to start' : `NOW ${fmtLtst(evaLtst(start, lastT))} · ${deltaText ?? '—'}`}
          </span>
        )}
        <span className="ml-auto flex items-center gap-4 text-[11px] text-mute">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[2px] bg-amber/25 ring-1 ring-amber/60" />Stop</span>
          <span className="flex items-center gap-1.5"><span className="mw-rest h-3 w-3 rounded-[2px]" />Rest</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-[2px] bg-amber" />Leave by</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-0 border-l-2 border-dashed border-red" />Walk-back deadline</span>
        </span>
      </div>

      <div ref={trackRef} className="relative mt-2 flex-1">
        {/* hour grid */}
        {hours.map((h) => (
          <div key={h.ltst} className="absolute bottom-[16px] top-0 w-px bg-white/[0.04]" style={{ left: x(h.t) }} />
        ))}

        {/* leave-by ticks */}
        <div className="absolute inset-x-0 top-0 h-[18px]">
          {plan.bingo.filter((b) => b.id !== 'HAB' && order(b.id) > 0).map((b) => (
            <div key={b.id} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: x(b.tMin) }} title={`Leave ${b.id} by ${fmtLtst(b.ltstMin)}`}>
              <span className="num text-[9.5px] leading-none text-amber">{order(b.id)}</span>
              <span className="mt-[2px] h-[7px] w-[2px] rounded-full bg-amber/80" />
            </div>
          ))}
        </div>

        {/* track */}
        <div className="absolute inset-x-0 top-[22px] h-[40px]">
          {resumed !== null && resumed > 0 && (
            <div className="absolute inset-y-[6px] flex items-center overflow-hidden rounded-[4px] bg-white/[0.04] px-2 text-[11px] text-dim" style={{ left: 0, width: w(0, resumed) }} title={`Walked before this re-plan (to +${Math.round(resumed)} min)`}>
              <span className="truncate">Done</span>
            </div>
          )}
          {/* spare time before the walk-back deadline */}
          {spare > 0 && (
            <div className="mw-spare absolute inset-y-[6px] flex items-center justify-end rounded-r-[4px] pr-2" style={{ left: x(back), width: w(back, dl) }} title={`Spare time to get home: ${hm(spare)} before the walk-back deadline ${fmtLtst(evaLtst(start, dl))}`}>
              <span className="num truncate text-right text-[11.5px] leading-tight text-cyan">
                <span className="font-medium">{hmShort(spare)} before deadline</span>
                {px(back + half, dl) > 190 && <span className="text-cyan/70"> {fmtLtst(evaLtst(start, dl))}</span>}
              </span>
            </div>
          )}
          {firstSeg.from !== 'HERE' && firstSeg.t0Min > 0.5 && (
            <Block left={x(0)} width={w(0, firstSeg.t0Min)} tone="airlock" title={`Airlock out · ${Math.round(firstSeg.t0Min)} min`}>Airlock</Block>
          )}
          {plan.segments.map((s, i) => {
            const restEnd = s.t1Min;
            const restStart = s.t1Min - s.restMin;
            return (
              <div key={i}>
                <div className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-amber/70" style={{ left: x(s.t0Min), width: w(s.t0Min, s.t1Min) }} title={`Walk ${label(s.from, s.cells[0])} → ${label(s.to, s.cells[s.cells.length - 1])} · ${Math.round(s.t1Min - s.t0Min)} min · ${Math.round(s.distM)} m`} />
                {s.restMin > 0.05 && (
                  <div className="mw-rest absolute inset-y-[9px] rounded-[2px] ring-1 ring-amber/40" style={{ left: x(restStart), width: `max(4px, ${w(restStart, restEnd)})` }} title={`Rest${s.restMin >= 1 ? `s, ${Math.round(s.restMin)} min` : ', under a minute'} on this walk (suit heat)`} />
                )}
              </div>
            );
          })}
          {plan.stops.map((st) => {
            const n = order(st.id);
            const bingo = plan.bingo.find((b) => b.id === st.id);
            const dwell = Math.round(st.departMin - st.arriveMin);
            return (
              <button
                key={st.id}
                onClick={() => set({ selectedStation: st.id })}
                className={cx('absolute inset-y-0 flex min-w-[6px] items-center gap-1 overflow-hidden rounded-[4px] px-1.5 text-left transition-colors', selected === st.id ? 'bg-amber/35 ring-1 ring-amber' : 'bg-amber/18 ring-1 ring-amber/55 hover:bg-amber/28')}
                style={{ left: x(st.arriveMin), width: w(st.arriveMin, st.departMin) }}
                title={`Stop ${n} · ${st.id} · ${dwell} min · arrive ${fmtLtst(evaLtst(start, st.arriveMin))}, leave ${fmtLtst(evaLtst(start, st.departMin))}${bingo ? ` · leave by ${fmtLtst(bingo.ltstMin)}` : ''}`}
              >
                <span className="num text-[11px] font-semibold text-amber">{n}</span>
                {px(st.arriveMin, st.departMin) >= 50 && <span className="num truncate text-[11px] text-ink">{st.id}</span>}
                {px(st.arriveMin, st.departMin) >= 82 && <span className="num truncate text-[10px] text-mute">{dwell}′</span>}
              </button>
            );
          })}
          {endsAtBase && (
            <Block left={x(back)} width={w(back, back + half)} tone="airlock" title={`Back in at ${base?.short} · airlock ${Math.round(half)} min`}>Back in</Block>
          )}
        </div>

        {/* walk-back deadline */}
        <div className="pointer-events-none absolute bottom-[16px] top-[18px] border-l-2 border-dashed border-red/80" style={{ left: x(dl) }} title={`Walk-back deadline ${fmtLtst(evaLtst(start, dl))}`} />

        {/* now */}
        {lastT !== null && (
          <>
            <div className="pointer-events-none absolute bottom-[16px] left-0 top-[18px] bg-bg/55" style={{ width: x(lastT) }} />
            <div data-testid="timeline-now" className="pointer-events-none absolute bottom-[12px] top-[14px] w-[2px] -translate-x-1/2 rounded-full bg-cyan shadow-[0_0_10px_rgba(79,209,224,0.7)]" style={{ left: x(lastT) }} />
          </>
        )}

        {/* axis */}
        <div className="absolute inset-x-0 bottom-0 h-[14px]">
          <span className="num absolute left-0 text-[10px] text-mute">{fmtLtst(start)}</span>
          {hours.filter((h) => h.t / t1 > 0.06).map((h) => (
            <span key={h.ltst} className="num absolute -translate-x-1/2 text-[10px] text-dim" style={{ left: x(h.t) }}>{fmtLtst(h.ltst)}</span>
          ))}
          <span className="num absolute -translate-x-1/2 whitespace-nowrap rounded-[3px] bg-panel px-1 text-[10px] text-red" style={{ left: x(dl) }}>{fmtLtst(evaLtst(start, dl))}</span>
        </div>
      </div>
    </div>
  );
}

function Block({ left, width, tone, title, children }: { left: string; width: string; tone: 'airlock'; title: string; children: string }) {
  return (
    <div className={cx('absolute inset-y-[5px] flex items-center justify-center overflow-hidden rounded-[4px] px-1', tone === 'airlock' && 'bg-[#232830] text-mute')} style={{ left, width }} title={title}>
      <span className="truncate font-display text-[10px] uppercase tracking-[0.1em]">{children}</span>
    </div>
  );
}
