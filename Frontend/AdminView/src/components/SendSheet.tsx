import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { estimatePackageBytes } from '../api';
import { confirmPush, setMode } from '../actions';
import { useConsole } from '../store';
import { endpointLabel, useBaseInfo } from '../lib/base';
import { evaLtst, fmtLtst } from '../lib/marsclock';
import { hm, limitLine, thingsToWatch, verdictOf } from '../lib/plain';
import { Button, Kbd, cx } from './ui';

/** Curiosity's typical daily uplink volume, the yardstick for the route package (design doc §5). */
export const UPLINK_BYTES = 28_000;
/** Package budget the engine codec targets. */
export const BUDGET_BYTES = 25_000;

export function PackageSize({ bytes, estimated }: { bytes: number; estimated?: boolean }) {
  const frac = Math.min(1, bytes / UPLINK_BYTES);
  const fits = bytes <= BUDGET_BYTES;
  return (
    <div data-testid="package-size">
      <div className="num flex items-baseline justify-between text-[12.5px]">
        <span className="text-ink">
          Route package {estimated ? '≈' : ''}{(bytes / 1000).toFixed(1)} KB <span className={fits ? 'text-ok' : 'text-red'}>· {fits ? 'fits' : 'too big'}</span>
        </span>
        <span className="text-mute">of {(UPLINK_BYTES / 1000).toFixed(0)} KB Curiosity daily uplink</span>
      </div>
      <div className="relative mt-2 h-[6px] overflow-hidden rounded-full bg-sunk">
        <div className={cx('absolute inset-y-0 left-0 rounded-full', fits ? 'bg-ok' : 'bg-red')} style={{ width: `${frac * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink-2/60" style={{ left: `${(BUDGET_BYTES / UPLINK_BYTES) * 100}%` }} title="25 KB package budget" />
      </div>
    </div>
  );
}

/** ② SEND: the crew brief the officer reads out, then one button. */
export function SendSheet() {
  const open = useConsole((s) => s.uiMode === 'send');
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="send" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 px-6 py-6">
          <motion.div initial={{ y: 14, opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="w-[min(680px,100%)]">
            <Brief />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Brief() {
  const plan = useConsole((s) => s.plan)!;
  const req = useConsole((s) => s.planReq);
  const fields = useConsole((s) => s.fields);
  const fieldsSource = useConsole((s) => s.fieldsSource);
  const plannerLabel = useConsole((s) => s.plannerLabel);
  const pack = useConsole((s) => s.pack)!;
  const rules = useConsole((s) => s.rules);
  const events = useConsole((s) => s.events);
  const start = useConsole((s) => s.startLtstMin);
  const ls = useConsole((s) => s.lsDeg);
  const confirm = useConsole((s) => s.confirm);
  const route = useConsole((s) => s.route);
  const dirty = useConsole((s) => s.dirty);
  const shelterCells = useConsole((s) => s.shelterCells);
  const base = useBaseInfo()!;
  const [est, setEst] = useState<{ bytes: number; estimated: boolean } | null>(null);
  const nextSeq = (route?.seq ?? 0) + 1;
  const sent = (confirm.stage === 'awaitingAck' || confirm.stage === 'acked' || confirm.stage === 'rejected') && route?.reqHash === plan.reqHash;
  const label = (id: string, cell?: number) => endpointLabel(pack, base, id, shelterCells, cell);

  useEffect(() => {
    if (!fields || !req) return;
    let alive = true;
    void estimatePackageBytes(pack, { result: plan, fields, fieldsSource: fieldsSource ?? 'estimate', plannerLabel }, req, nextSeq).then((r) => alive && setEst({ bytes: r.bytes, estimated: true }));
    return () => {
      alive = false;
    };
  }, [plan, fields, req, pack, fieldsSource, plannerLabel, nextSeq]);

  const v = useMemo(() => verdictOf({ plan, pack, base, rules, events, startLtstMin: start, lsDeg: ls }), [plan, pack, base, rules, events, start, ls]);
  const watch = useMemo(() => thingsToWatch(plan, rules, (id) => label(id)), [plan, rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const lim = limitLine(plan, pack, base);
  const last = plan.segments[plan.segments.length - 1];
  const startName = plan.segments[0]?.from === 'HERE' ? 'EV1' : base.short;
  const endName = last ? label(last.to, last.cells[last.cells.length - 1]) : base.short;
  const routeText = [startName, ...plan.order, endName].join(' → ');
  const back = last?.t1Min ?? 0;

  return (
    <section data-testid="crew-brief" className="overflow-hidden rounded-[14px] bg-panel ring-1 ring-white/[0.06]">
      <header className="flex items-start gap-4 px-6 pb-4 pt-5">
        <div className="min-w-0">
          <div className="eyebrow">Crew brief · route v{sent ? route!.seq : nextSeq}</div>
          <div data-testid="review-route" className="num mt-1.5 text-[15.5px] leading-snug text-ink">{routeText}</div>
          <div className="mt-1 text-[13px] text-ink-2">{v.headline} · back at {endName} {fmtLtst(evaLtst(start, back))}</div>
        </div>
        {!sent && (
          <button onClick={() => setMode('plan')} className="ml-auto flex h-9 shrink-0 items-center gap-2 rounded-[6px] px-3 text-[12px] text-mute hover:bg-raised hover:text-ink" aria-label="Back to plan">
            Back to plan <Kbd>Esc</Kbd>
          </button>
        )}
      </header>

      <div className="flex flex-col gap-5 px-6 pb-5">
        {plan.stops.length > 0 && (
          <div>
            <div className="eyebrow mb-2">Stops and leave-by times</div>
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup><col className="w-8" /><col /><col className="w-[64px]" /><col className="w-[64px]" /><col className="w-[76px]" /></colgroup>
              <thead>
                <tr className="text-[11px] text-dim">
                  <th className="pb-1.5 font-normal">#</th>
                  <th className="pb-1.5 font-normal">Stop</th>
                  <th className="pb-1.5 text-right font-normal">Arrive</th>
                  <th className="pb-1.5 text-right font-normal">Leave</th>
                  <th className="pb-1.5 text-right font-normal text-ink-2">Leave by</th>
                </tr>
              </thead>
              <tbody>
                {plan.stops.map((st, i) => {
                  const s = pack.manifest.stations.find((x) => x.id === st.id);
                  const b = plan.bingo.find((x) => x.id === st.id);
                  return (
                    <tr key={st.id} className="text-[13px]">
                      <td className="py-1"><span className="num inline-flex h-[22px] w-[22px] items-center justify-center border border-cyan bg-black text-[11px] font-semibold text-white">{i + 1}</span></td>
                      <td className="truncate py-1 pr-3 text-ink"><span className="num mr-2 text-[11.5px] text-mute">{st.id}</span>{s?.name.replace(/\s*\([^)]*\)\s*$/, '') ?? st.id}</td>
                      <td className="num py-1 text-right text-ink-2">{fmtLtst(evaLtst(start, st.arriveMin))}</td>
                      <td className="num py-1 text-right text-ink-2">{fmtLtst(evaLtst(start, st.departMin))}</td>
                      <td className="num py-1 text-right text-ink">{b ? fmtLtst(b.ltstMin) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid grid-cols-2 gap-5">
          <div>
            <div className="eyebrow mb-1.5">What limits this walk</div>
            <div className="text-[13.5px] leading-snug text-ink">{lim ? lim.head : plan.order.length ? 'Nothing close to a limit' : `Direct return to ${endName}`}</div>
            {lim?.detail && <div className="mt-1 text-[12px] leading-snug text-mute">{lim.detail}</div>}
            <div className="mt-2 text-[12px] text-mute">Back <span className="text-ok">{hm(v.spareMin)}</span> before the walk-back deadline</div>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Three things to watch</div>
            <ol className="flex flex-col gap-1.5" data-testid="watch-list">
              {watch.map((w, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
                  <span className="num text-cyan">{i + 1}</span>
                  <span>{w}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {sent ? <PackageSize bytes={route!.bytes} estimated={route!.estimated} /> : est ? <PackageSize bytes={est.bytes} estimated /> : <div className="h-[30px] text-[12px] text-dim">Sizing the route package…</div>}
        {dirty && !sent && <div className="text-[12px] text-caution">Inputs changed: re-planning before you send.</div>}
      </div>

      <footer className="bg-sunk/60 px-6 py-4">
        <SendState />
      </footer>
    </section>
  );
}

function SendState() {
  const confirm = useConsole((s) => s.confirm);
  const route = useConsole((s) => s.route);
  const plan = useConsole((s) => s.plan);
  const status = useConsole((s) => s.planStatus);
  const dirty = useConsole((s) => s.dirty);
  const sent = !!route && route.reqHash === plan?.reqHash;
  if (confirm.stage === 'pushing') {
    return <div className="flex h-[52px] items-center gap-3 text-[15px] text-cyan"><span className="mw-pulse h-2.5 w-2.5 rounded-full bg-cyan" />Sending to the crew…</div>;
  }
  if (sent && confirm.stage === 'awaitingAck') {
    return (
      <div className="flex h-[52px] items-center gap-3">
        <span className="mw-pulse h-2.5 w-2.5 rounded-full bg-cyan" />
        <span data-testid="route-sent" className="text-[16px] font-medium text-cyan">Waiting for crew to accept v{route!.seq}…</span>
        <span className="ml-auto text-[12px] text-mute">Signed and sent · the visor checks the signature</span>
      </div>
    );
  }
  if (sent && route!.acked) {
    return (
      <div className="flex h-[52px] items-center gap-3">
        <span data-testid="route-acked" className="text-[17px] font-semibold text-ok">✓ Accepted by EV1 · v{route!.seq}</span>
        <span className="ml-auto text-[12px] text-mute">Opening EVA live…</span>
        <Button variant="cyan" onClick={() => setMode('live')}>EVA live <Kbd>⏎</Kbd></Button>
      </div>
    );
  }
  if (sent && confirm.stage === 'rejected') {
    return (
      <div className="flex h-[52px] items-center gap-3">
        <span className="text-[16px] font-medium text-red">EV1 rejected v{route!.seq}</span>
        <Button className="ml-auto" onClick={() => setMode('plan')}>Back to plan</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {confirm.stage === 'error' && <div className="text-[12.5px] text-red">Sending failed: {confirm.error}. Check the hab server, then send again.</div>}
      <Button data-testid="send-to-crew" data-autofocus="1" autoFocus variant="primary" size="xl" className="w-full" disabled={status !== 'ready' || dirty} onClick={() => void confirmPush()}>
        Send to crew <Kbd>⏎</Kbd>
      </Button>
    </div>
  );
}
