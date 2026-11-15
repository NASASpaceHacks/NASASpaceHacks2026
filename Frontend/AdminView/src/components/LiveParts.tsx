import { clearEvents, resolveRequest, setLinkCtl, setSim } from '../actions';
import { useConsole } from '../store';
import { fmt } from '../lib/format';
import { Badge, Button, cx } from './ui';

/** Requests from EV1 (history; open ones also appear in the alert banner). */
export function Requests() {
  const reqs = useConsole((s) => s.requests);
  const open = reqs.filter((r) => !r.handled);
  if (!reqs.length) return <div className="text-[11.5px] text-dim">No requests from EV1.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {reqs.slice(0, 6).map((r) => (
        <div key={r.id} className={cx('rounded-[3px] border px-2.5 py-2', r.handled ? 'border-line opacity-60' : r.kind === 'ABORT' ? 'border-red/60 bg-red/5' : 'border-caution/50 bg-caution/5')}>
          <div className="flex items-center gap-2">
            <Badge tone={r.kind === 'ABORT' ? 'red' : 'amber'}>{r.kind.replace('_', ' ')}</Badge>
            <span className="num text-[10.5px] text-mute">+{r.t.toFixed(0)} min</span>
            {r.handled && <span className="ml-auto text-[10px] text-dim">handled</span>}
          </div>
          {r.note && <div className="mt-1 text-[11.5px] text-ink-2">{r.note}</div>}
          {!r.handled && (
            <div className="mt-2 flex gap-1.5">
              {r.kind === 'HAZARD' && r.cell !== undefined && <Button size="sm" variant="primary" onClick={() => resolveRequest(r.id, 'hazard')}>Block area &amp; replan</Button>}
              <Button size="sm" variant="ghost" onClick={() => resolveRequest(r.id, 'dismiss')}>Acknowledge</Button>
            </div>
          )}
        </div>
      ))}
      {open.length > 0 && <div className="text-[10px] text-caution">{open.length} open</div>}
    </div>
  );
}

/** Replan events applied this EVA, with "Clear events" (re-plans from the EVA base). */
export function EventsSection() {
  const busy = useConsole((s) => s.busyEvent);
  const events = useConsole((s) => s.events);
  const label = (e: (typeof events)[number]) => (e.t === 'EVA_CUT' ? `EVA shortened by ${e.min} min` : e.t === 'SEP_NOWCAST' ? `Radiation spike: reach shelter within ${e.leadMin} min` : e.t === 'HAZARD' ? `Hazard: ${e.cells.length} cells blocked` : 'Position fix');
  return (
    <div className="flex flex-col gap-2">
      {events.length === 0 && <div className="text-[11.5px] text-dim">No events this EVA.</div>}
      {events.map((e, i) => <div key={i} className="text-[12px] text-ink-2">• {label(e)}</div>)}
      <Button variant="ghost" size="sm" className="self-start" onClick={clearEvents} disabled={!events.length || !!busy}>Clear events ({events.length})</Button>
      <div className="text-[10.5px] leading-snug text-dim">Each event re-plans from EV1's last position. A new route reaches the crew only after Send to crew.</div>
    </div>
  );
}

/** Demo: drop / restore / degrade the surface link (Simulation menu). */
export function LinkControls() {
  const ctl = useConsole((s) => s.linkCtl);
  const link = useConsole((s) => s.link);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button data-testid="sim-link" variant={ctl.drop ? 'cyan' : 'danger'} onClick={() => void setLinkCtl({ drop: !ctl.drop })} className="flex-1">
          {ctl.drop ? 'Restore link' : 'Drop link'}
        </Button>
        <span className={cx('font-display text-[10.5px] uppercase tracking-[0.14em]', link === 'up' ? 'text-ok' : link === 'degraded' ? 'text-caution' : 'text-red')}>Visor {link}</span>
      </div>
      <label className="grid grid-cols-[70px_1fr_56px] items-center gap-2">
        <span className="label !text-[9px]">Latency</span>
        <input className="mw-range" type="range" min={0} max={4000} step={100} value={ctl.latencyMs} onChange={(e) => void setLinkCtl({ latencyMs: Number(e.target.value) })} />
        <span className="num text-right text-[10.5px] text-ink-2">{ctl.latencyMs} ms</span>
      </label>
      <label className="grid grid-cols-[70px_1fr_56px] items-center gap-2">
        <span className="label !text-[9px]">Loss</span>
        <input className="mw-range" type="range" min={0} max={60} step={5} value={ctl.lossPct} onChange={(e) => void setLinkCtl({ lossPct: Number(e.target.value) })} />
        <span className="num text-right text-[10.5px] text-ink-2">{ctl.lossPct} %</span>
      </label>
    </div>
  );
}

/** Demo: the visor's astronaut simulator (Simulation menu). */
export function SimControls() {
  const sim = useConsole((s) => s.sim);
  const route = useConsole((s) => s.route);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Button data-testid="sim-run" variant={sim.running ? 'secondary' : 'cyan'} onClick={() => void setSim({ running: !sim.running })} disabled={!route} className="flex-1">
          {sim.running ? 'Pause' : 'Run astronaut'}
        </Button>
        <Button variant="ghost" onClick={() => void setSim({ running: false, reset: true })} disabled={!route}>Reset</Button>
      </div>
      <div className="flex items-center gap-1">
        <span className="label mr-2 !text-[9px]">Speed</span>
        {[10, 30, 60, 120].map((v) => (
          <button key={v} onClick={() => void setSim({ speed: v })} className={cx('num h-6 flex-1 rounded-[2px] border text-[10.5px]', sim.speed === v ? 'border-cyan/60 bg-cyan/10 text-cyan' : 'border-line-2 text-mute hover:text-ink')}>
            {v}×
          </button>
        ))}
      </div>
      {!route && <div className="text-[10.5px] text-dim">Send a route first: the visor's simulator walks the route the crew accepted.</div>}
    </div>
  );
}

/** Event log (Details → Log). */
const BY: Record<string, string> = { hab: 'EVA officer', visor: 'Crew visor', server: 'Hab server', earth: 'Earth', system: 'Console' };

export function EventLog() {
  const log = useConsole((s) => s.log);
  const tone = { info: 'text-ink-2', ok: 'text-ok', caution: 'text-ink', warning: 'text-red' } as const;
  return (
    <div data-testid="event-log" className="max-h-[420px] overflow-y-auto rounded-[3px] border border-line bg-sunk/60">
      <div className="grid grid-cols-[64px_1fr_84px] gap-2 border-b border-line-2 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-dim"><span>Time</span><span>What happened</span><span>By</span></div>
      {log.length === 0 && <div className="px-3 py-3 text-[12px] text-dim">Nothing has happened yet.</div>}
      {log.map((e) => (
        <div key={e.id} className="grid grid-cols-[64px_1fr_84px] gap-2 border-b border-line/60 px-2.5 py-1.5 last:border-0">
          <span className="num text-[11px] text-dim">{fmt.clock(e.utcMs)}</span>
          <span className={cx('text-[12px] leading-snug', tone[e.level])}>{e.text}{e.tMin !== undefined ? <span className="text-dim"> (EVA +{Math.round(e.tMin)} min)</span> : null}</span>
          <span className="text-[11px] text-mute">{BY[e.source] ?? e.source}</span>
        </div>
      ))}
    </div>
  );
}

