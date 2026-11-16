import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ackAlert, ackAllAlerts, openSheet, resolveRequest } from '../actions';
import { useConsole } from '../store';
import { evaLtst, fmtLtst } from '../lib/marsclock';
import { cx } from './ui';

const LEVEL: Record<'info' | 'caution' | 'warning', { bar: string; ink: string; bg: string }> = {
  info: { bar: 'bg-ok', ink: 'text-ok', bg: 'bg-black' },
  caution: { bar: 'bg-ink', ink: 'text-ink', bg: 'bg-black' },
  warning: { bar: 'bg-red', ink: 'text-red', bg: 'bg-black' },
};

/** Alert queue across the top of the map: newest unacknowledged first, colour-coded, each acknowledgeable. */
export function AlertBanner() {
  const alerts = useConsole((s) => s.alerts);
  const requests = useConsole((s) => s.requests);
  const start = useConsole((s) => s.startLtstMin);
  const sheet = useConsole((s) => s.sheet);
  const [expanded, setExpanded] = useState(false);
  const open = alerts.filter((a) => !a.acked);
  const shown = expanded ? open : open.slice(0, 1);
  if (!open.length) return null;
  return (
    <div className="pointer-events-none absolute left-0 right-[290px] top-0 z-30 flex flex-col items-start gap-1.5 pl-4 pt-4 phone:right-2 phone:pl-2 phone:pt-2" data-testid="alerts">
      <AnimatePresence initial={false}>
        {shown.map((a) => {
          const L = LEVEL[a.level];
          const req = a.requestId ? requests.find((r) => r.id === a.requestId && !r.handled) : undefined;
          return (
            <motion.div
              key={a.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              role="alert"
              data-level={a.level}
              className={cx('pointer-events-auto relative flex w-[min(680px,100%)] items-center gap-3 overflow-hidden rounded-[10px] py-2.5 pl-5 pr-2 ring-1 ring-white/[0.06]', L.bg)}
            >
              <span className={cx('absolute inset-y-0 left-0 w-[4px]', L.bar)} />
              <div className="min-w-0 flex-1">
                <div className={cx('text-[14px] font-medium', L.ink)}>
                  {a.title}
                  {a.tMin !== undefined && <span className="num ml-2 text-[11.5px] font-normal text-mute">{fmtLtst(evaLtst(start, a.tMin))}</span>}
                </div>
                {a.text && <div className="truncate text-[12px] text-ink-2">{a.text}</div>}
              </div>
              {req && req.kind === 'HAZARD' && req.cell !== undefined && !sheet && (
                <button onClick={() => { ackAlert(a.id); openSheet('hazard'); resolveRequest(req.id, 'hazard'); }} className="h-9 shrink-0 rounded-[7px] bg-white/[0.08] px-3 text-[12.5px] text-ink hover:bg-white/[0.14]">
                  Block area &amp; re-plan
                </button>
              )}
              <button onClick={() => (req ? resolveRequest(req.id, 'dismiss') : ackAlert(a.id))} className="h-9 shrink-0 rounded-[7px] px-3 text-[12.5px] text-ink-2 hover:bg-white/[0.08] hover:text-ink" data-testid="alert-ack">
                Acknowledge
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {open.length > 1 && (
        <div className="pointer-events-auto flex gap-2 pl-1 text-[11.5px]">
          <button onClick={() => setExpanded((e) => !e)} className="rounded-full bg-black/60 px-3 py-1 text-ink-2 hover:text-ink">{expanded ? 'Show newest only' : `+${open.length - 1} more`}</button>
          <button onClick={ackAllAlerts} className="rounded-full bg-black/60 px-3 py-1 text-mute hover:text-ink">Acknowledge all</button>
        </div>
      )}
    </div>
  );
}
