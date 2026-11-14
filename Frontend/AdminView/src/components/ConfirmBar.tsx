import { AnimatePresence, motion } from 'motion/react';
import { cancelReview, confirmPush, review } from '../actions';
import { useConsole } from '../store';
import { fmt } from '../lib/format';
import { Button, Kbd, cx } from './ui';
import { endpointLabel, relabel, useBaseInfo } from '../lib/base';

/** Curiosity's typical daily uplink volume used for the size comparison (design doc §5 budget table). */
const UPLINK_BYTES = 28_000;
const BUDGET_BYTES = 25_000;

function Bytes({ bytes, estimated }: { bytes: number; estimated?: boolean }) {
  const frac = Math.min(1, bytes / UPLINK_BYTES);
  return (
    <div>
      <div className="num flex items-baseline justify-between text-[11px]">
        <span className="text-ink">
          Route package {estimated ? '≈' : ''}
          {fmt.kb(bytes)}
        </span>
        <span className="text-mute">/ {fmt.kb(UPLINK_BYTES)} Curiosity daily uplink</span>
      </div>
      <div className="relative mt-1.5 h-[5px] overflow-hidden rounded-[1px] bg-sunk ring-1 ring-line">
        <div className={cx('absolute inset-y-0 left-0', bytes > BUDGET_BYTES ? 'bg-red' : 'bg-cyan')} style={{ width: `${frac * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink-2/60" style={{ left: `${(BUDGET_BYTES / UPLINK_BYTES) * 100}%` }} title="25 KB package budget" />
      </div>
    </div>
  );
}

export function ConfirmBar() {
  const plan = useConsole((s) => s.plan);
  const confirm = useConsole((s) => s.confirm);
  const route = useConsole((s) => s.route);
  const status = useConsole((s) => s.planStatus);
  const dirty = useConsole((s) => s.dirty);
  const ok = plan?.status === 'OK';
  const nextSeq = (route?.seq ?? 0) + 1;
  const differs = !!route && !!plan && plan.reqHash !== route.reqHash;
  const pack = useConsole((s) => s.pack);
  const base = useBaseInfo();
  const shelterCells = useConsole((s) => s.shelterCells);
  const rl = (t: string) => (pack && base ? relabel(pack, base, t) : t);
  /** Where the route ends: the EVA base, or (SEP return) whichever shelter is nearest. */
  const endName = (p: NonNullable<typeof plan>) => {
    const last = p.segments[p.segments.length - 1];
    if (!last || !pack || !base) return base?.short ?? 'HAB';
    return endpointLabel(pack, base, last.to, shelterCells, last.cells[last.cells.length - 1]);
  };
  const stopsText = (p: NonNullable<typeof plan>) => {
    const start = p.segments[0]?.from === 'HERE' ? 'EV1' : (base?.short ?? 'HAB');
    return [start, ...p.order, endName(p)].join(' → ');
  };

  return (
    <div className="shrink-0 border-t border-line bg-[#0f1115] px-4 py-3">
      <AnimatePresence mode="wait" initial={false}>
        {confirm.stage === 'review' && plan ? (
          <motion.div key="review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16 }}>
            <div className="label !text-amber/90">Review before push</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div><div className="text-dim">Route</div><div data-testid="review-route" className="num text-ink">{stopsText(plan)}</div></div>
              <div><div className="text-dim">Distance · time</div><div className="num text-ink">{(plan.totals.distM / 1000).toFixed(2)} km · {fmt.dur(plan.totals.durationMin)}</div></div>
              <div><div className="text-dim">Binding</div><div className="truncate text-ink" title={plan.binding ? rl(plan.binding.text) : undefined}>{plan.binding ? rl(plan.binding.text) : 'none'}</div></div>
            </div>
            {dirty && <div className="mt-2 text-[10.5px] text-amber">Inputs changed after this plan was generated — regenerate to include them.</div>}
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" onClick={cancelReview}>Back</Button>
              <Button variant="primary" size="lg" className="flex-1" onClick={() => void confirmPush()}>
                Confirm &amp; push v{nextSeq} <Kbd>C</Kbd>
              </Button>
            </div>
          </motion.div>
        ) : confirm.stage === 'pushing' ? (
          <motion.div key="pushing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-[52px] items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-amber mw-pulse" />
            <span className="font-display text-[12px] uppercase tracking-[0.12em] text-amber">Pushing v{confirm.seq} to visor…</span>
          </motion.div>
        ) : (confirm.stage === 'awaitingAck' || confirm.stage === 'acked' || confirm.stage === 'rejected') && route && !differs ? (
          <motion.div key="sent" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              {route.acked ? (
                <span data-testid="route-acked" className="font-display text-[12.5px] uppercase tracking-[0.12em] text-cyan">✓ v{route.seq} accepted by EV1 · ACK</span>
              ) : confirm.stage === 'rejected' ? (
                <span className="font-display text-[12.5px] uppercase tracking-[0.12em] text-red">v{route.seq} rejected by EV1</span>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-amber mw-pulse" />
                  <span data-testid="route-sent" className="font-display text-[12.5px] uppercase tracking-[0.12em] text-amber">v{route.seq} sent · waiting for ACK</span>
                </>
              )}
            </div>
            <Bytes bytes={route.bytes} estimated={route.estimated} />
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-2">
            {confirm.stage === 'error' && <div className="text-[11px] text-red">Push failed: {confirm.error}</div>}
            {differs && <div className="text-[10.5px] text-amber">New plan differs from pushed v{route!.seq}.</div>}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-[11px] leading-snug">
                {ok ? (
                  <>
                    <div className="num truncate text-ink">{plan!.segments[0]?.from === 'HERE' ? 'EV1' : (base?.short ?? 'HAB')} · {plan!.order.length ? `${plan!.order.length} stations` : `return to ${endName(plan!)}`} · {(plan!.totals.distM / 1000).toFixed(2)} km · {fmt.dur(plan!.totals.durationMin)}</div>
                    <div className="truncate text-mute">{plan!.binding ? rl(plan!.binding.text) : 'No binding constraint'}</div>
                  </>
                ) : plan ? (
                  <div className="text-red">STAY IN{base ? ` from ${base.short}` : ''} — nothing safe to push</div>
                ) : (
                  <div className="text-mute">{status === 'planning' ? 'Planning…' : 'Generate a plan to push it'}</div>
                )}
              </div>
              <Button variant="primary" size="lg" disabled={!ok || status === 'planning'} onClick={review}>
                Review v{nextSeq} <Kbd>C</Kbd>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
