import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { closeSheet, confirmPush, isSendable, resolveRequest, shortenEva } from '../actions';
import { useConsole } from '../store';
import { endpointLabel, useBaseInfo } from '../lib/base';
import { evaLtst, fmtLtst } from '../lib/marsclock';
import { hm, limitLine } from '../lib/plain';
import type { ActionKind } from '../lib/types';
import { Button, Kbd, cx } from './ui';

const TITLE: Record<ActionKind, { title: string; what: string }> = {
  sep: { title: 'Radiation spike on board', what: 'On-board dose rate is up 25 %. The crew has already been told to head for shelter; this sends them the route.' },
  hazard: { title: 'Hazard reported', what: 'The engine blocks the area and re-routes from where the crew is now.' },
  cut: { title: 'Shorten EVA', what: 'Less time outside. The engine re-plans the rest of the walk from where the crew is now.' },
  recall: { title: 'Recall crew', what: 'The engine plans the direct way back to the base from where the crew is now.' },
};

/** EVA live: guided response. Shows the engine's recommended new plan as a change; Send to crew is the only button. */
export function ActionSheet() {
  const sheet = useConsole((s) => s.sheet);
  return (
    <AnimatePresence>
      {sheet && (
        <motion.div key="sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} className="pointer-events-none absolute inset-0 z-40 flex items-end justify-end p-4">
          <motion.div
            role="dialog"
            aria-label={TITLE[sheet.kind].title}
            data-testid="action-sheet"
            data-kind={sheet.kind}
            initial={{ y: 16, opacity: 0.4 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="pointer-events-auto w-[min(440px,100%)] overflow-hidden rounded-[14px] bg-panel shadow-[0_30px_80px_rgba(0,0,0,0.75)] ring-1 ring-white/[0.07]"
          >
            <Body sheet={sheet} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** `sheet` is passed in (not read from the store) so the exit animation can still render after it closes. */
function Body({ sheet }: { sheet: NonNullable<ReturnType<typeof useConsole.getState>['sheet']> }) {
  const kind = sheet.kind;
  const plan = useConsole((s) => s.plan);
  const busy = useConsole((s) => s.busyEvent);
  const status = useConsole((s) => s.planStatus);
  const confirm = useConsole((s) => s.confirm);
  const route = useConsole((s) => s.route);
  const hazardPick = useConsole((s) => s.hazardPick);
  const requests = useConsole((s) => s.requests);
  const planReq = useConsole((s) => s.planReq);
  const visited = planReq?.resume?.visited ?? [];
  const pack = useConsole((s) => s.pack)!;
  const start = useConsole((s) => s.startLtstMin);
  const shelterCells = useConsole((s) => s.shelterCells);
  const base = useBaseInfo()!;
  const t = TITLE[kind];
  const evReq = requests.find((r) => !r.handled && r.kind === 'HAZARD' && r.cell !== undefined);
  const waitingInput = (kind === 'cut' && sheet.cutMin === undefined) || (kind === 'hazard' && hazardPick) || (kind === 'hazard' && !!evReq && plan?.reqHash === route?.reqHash && !busy);
  const working = !!busy || status === 'planning';
  const changed = !!plan && plan.reqHash !== route?.reqHash;
  const sent = !!route && !!plan && route.reqHash === plan.reqHash && (confirm.stage === 'awaitingAck' || confirm.stage === 'acked' || confirm.stage === 'pushing');
  const label = (id: string, cell?: number) => endpointLabel(pack, base, id, shelterCells, cell);
  const sendRef = useRef<HTMLButtonElement>(null);
  const ready = !!plan && changed && !working && !waitingInput && isSendable(plan);
  useEffect(() => {
    if (ready) sendRef.current?.focus();
  }, [ready]);

  return (
    <>
      <header className={cx('flex items-start gap-3 px-5 pb-3 pt-4', kind === 'sep' && 'bg-red/[0.08]')}>
        <div className="min-w-0">
          <div className={cx('font-display text-[19px] font-semibold uppercase tracking-[0.06em]', kind === 'sep' ? 'text-red' : 'text-ink')}>{t.title}</div>
          <div className="mt-1 text-[12.5px] leading-snug text-ink-2">{t.what}</div>
        </div>
        {!sent && (
          <button onClick={closeSheet} className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[12px] text-mute hover:bg-raised hover:text-ink" aria-label="Not now">
            Not now <Kbd>Esc</Kbd>
          </button>
        )}
      </header>

      <div className="px-5 pb-4">
        {kind === 'cut' && (
          <div className="mt-1">
            <div className="eyebrow mb-1.5">Shorten by</div>
            <div className="grid grid-cols-4 gap-1.5">
              {[15, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  data-testid={`cut-${m}`}
                  disabled={sheet.cutMin !== undefined}
                  onClick={() => void shortenEva(m)}
                  className={cx('num h-11 rounded-[8px] text-[14px] transition-colors disabled:cursor-default', sheet.cutMin === m ? 'bg-amber/20 text-amber ring-1 ring-amber/60' : 'bg-raised text-ink-2 hover:text-ink disabled:opacity-40')}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
        )}
        {kind === 'hazard' && hazardPick && (
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex items-center gap-2.5 rounded-[8px] bg-red/[0.08] px-3 py-2.5 text-[13px] text-ink"><span className="mw-pulse h-2 w-2 rounded-full bg-red" />Click the map where the hazard is.</div>
            {evReq && <Button onClick={() => resolveRequest(evReq.id, 'hazard')}>Use the spot EV1 reported</Button>}
          </div>
        )}
        {kind === 'hazard' && !hazardPick && evReq && !changed && !working && (
          <div className="mt-1 flex flex-col gap-1.5">
            <Button className="w-full" onClick={() => resolveRequest(evReq.id, 'hazard')}>Block the spot EV1 reported{evReq.note ? `: ${evReq.note}` : ''}</Button>
            <button className="self-start text-[12px] text-mute hover:text-ink" onClick={() => useConsole.setState({ hazardPick: true })}>Or click the map instead</button>
          </div>
        )}

        {!waitingInput && (
          <div className="mt-2">
            {working ? (
              <div className="flex h-[92px] items-center gap-3 text-[14px] text-amber"><span className="mw-pulse h-2.5 w-2.5 rounded-full bg-amber" />Finding the safest new plan…</div>
            ) : plan && changed ? (
              <Change before={sheet.before} />
            ) : (
              <div className="h-[20px]" />
            )}
          </div>
        )}
      </div>

      <footer className="bg-sunk/60 px-5 py-4">
        {sent ? (
          route!.acked ? (
            <div data-testid="route-acked" className="flex h-[52px] items-center text-[16px] font-semibold text-cyan">✓ Accepted by EV1 · v{route!.seq}</div>
          ) : (
            <div className="flex h-[52px] items-center gap-3"><span className="mw-pulse h-2.5 w-2.5 rounded-full bg-amber" /><span data-testid="route-sent" className="text-[15px] font-medium text-amber">Waiting for crew to accept v{route!.seq}…</span></div>
          )
        ) : (
          <>
            {confirm.stage === 'error' && <div className="mb-2 text-[12px] text-red">Sending failed: {confirm.error}</div>}
            {plan && changed && !working && !isSendable(plan) && <div className="mb-2 text-[12.5px] text-red">The engine found no safe route from here. Talk to the crew.</div>}
            <Button ref={sendRef} data-testid="sheet-send" data-autofocus="1" variant="primary" size="xl" className="w-full" disabled={!ready} onClick={() => void confirmPush()}>
              Send to crew <Kbd>⏎</Kbd>
            </Button>
          </>
        )}
      </footer>
    </>
  );

  function Change({ before }: { before?: { order: string[]; durationMin: number; endT: number } }) {
    const p = plan!;
    const last = p.segments[p.segments.length - 1];
    const first = p.segments[0];
    const endName = last ? label(last.to, last.cells[last.cells.length - 1]) : base.short;
    const ret = p.order.length === 0;
    const walk = last && first ? last.t1Min - first.t0Min : 0;
    const droppedNow = before ? before.order.filter((id) => !p.order.includes(id) && !visited.includes(id)) : [];
    const lim = limitLine(p, pack, base);
    return (
      <div data-testid="sheet-change" className="rounded-[10px] bg-raised/70 px-4 py-3">
        <div className="eyebrow mb-1">New plan</div>
        <div className="text-[17px] font-medium leading-snug text-ink">
          {ret ? `Return to ${endName} now · ${hm(walk)}` : `${p.order.length} stop${p.order.length === 1 ? '' : 's'} left: ${p.order.join(' → ')}`}
        </div>
        <div className="mt-1 text-[12.5px] text-ink-2">
          {ret ? `Arrive about ${fmtLtst(evaLtst(start, (last?.t1Min ?? 0)))} by the safest path.` : `Back at ${endName} ${fmtLtst(evaLtst(start, (last?.t1Min ?? 0)))}`}
          {before && !ret && <> · was {fmtLtst(evaLtst(start, before.endT))}</>}
        </div>
        {droppedNow.length > 0 && <div className="mt-1.5 text-[12px] text-amber">Skips {droppedNow.join(', ')}</div>}
        {lim && !ret && <div className="mt-1.5 text-[12px] text-mute">Limits: {lim.head}</div>}
      </div>
    );
  }
}
