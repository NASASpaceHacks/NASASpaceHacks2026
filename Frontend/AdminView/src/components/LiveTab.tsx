import { cellDistM } from '@mw/shared/contracts';
import { clearEvents, fireEvent, resolveRequest, setLinkCtl, setSim, startHazardPick } from '../actions';
import { useConsole } from '../store';
import { fmt } from '../lib/format';
import { fmtLtst } from '../lib/marsclock';
import { Badge, Button, Kbd, SectionHead, Stat, cx } from './ui';

function Telemetry() {
  const telem = useConsole((s) => s.telem);
  const pack = useConsole((s) => s.pack);
  const fields = useConsole((s) => s.fields);
  const limits = useConsole((s) => s.limits);
  const link = useConsole((s) => s.link);
  const start = useConsole((s) => s.startLtstMin);
  const last = telem[telem.length - 1];
  if (!last || !pack) {
    return <div className="rounded-[3px] border border-dashed border-line-2 px-3 py-4 text-[11.5px] leading-relaxed text-mute">No telemetry yet. Confirm a route, then start the astronaut simulator below{link === 'down' ? ' — the visor link is down' : ''}.</div>;
  }
  const g = pack.manifest.grid;
  const hab = pack.manifest.shelters.find((s) => s.kind === 'hab')!;
  const dist = cellDistM(g, hab.cell, last.cell);
  const sh = fields ? fields.shelterMin[last.cell] : NaN;
  const shMax = limits && Number.isFinite(limits.shelterMax) ? limits.shelterMax : 30;
  const age = link === 'down' ? 'stale — link down' : 'live';
  return (
    <div className={cx('rounded-[3px] border p-3', link === 'down' ? 'border-red/40' : 'border-line')}>
      <div className="mb-3 flex items-center justify-between">
        <span className="num text-[11px] text-ink-2">EV1 · +{last.t.toFixed(1)} min · {fmtLtst(start + last.t)} LTST</span>
        <span className={cx('font-display text-[9.5px] uppercase tracking-[0.12em]', link === 'down' ? 'text-red' : 'text-cyan')}>{age}</span>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-3.5">
        <Stat label="O₂" value={last.o2Pct.toFixed(1)} unit="%" tone={last.o2Pct < 20 ? 'red' : undefined} />
        <Stat label="Metabolic" value={Math.round(last.metW)} unit="W" />
        <Stat label="Heat avg" value={Math.round(last.heatAvgW)} unit="W" tone={last.heatAvgW > 352 ? 'amber' : undefined} />
        <Stat label="From hab" value={fmt.dist(dist)} />
        <Stat label="Shelter" value={Number.isFinite(sh) ? sh.toFixed(0) : '—'} unit="min" tone={sh > shMax ? 'red' : sh > shMax * 0.8 ? 'amber' : 'cyan'} />
        <Stat label="Position ±" value={(last.sigmaM * 2).toFixed(0)} unit="m" sub="2σ dead reckoning" />
      </div>
    </div>
  );
}

function Requests() {
  const reqs = useConsole((s) => s.requests);
  const open = reqs.filter((r) => !r.handled);
  if (!reqs.length) return <div className="text-[11.5px] text-dim">No requests from EV1.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {reqs.slice(0, 6).map((r) => (
        <div key={r.id} className={cx('rounded-[3px] border px-2.5 py-2', r.handled ? 'border-line opacity-60' : r.kind === 'ABORT' ? 'border-red/60 bg-red/5' : 'border-amber/50 bg-amber/5')}>
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
      {open.length > 0 && <div className="text-[10px] text-amber">{open.length} open</div>}
    </div>
  );
}

function EventButtons() {
  const busy = useConsole((s) => s.busyEvent);
  const events = useConsole((s) => s.events);
  const hazardPick = useConsole((s) => s.hazardPick);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="danger" onClick={() => void fireEvent({ type: 'SEP_NOWCAST', leadMin: 30 }, 'SEP nowcast, 30 min lead')} disabled={!!busy}>
          {busy === 'SEP_NOWCAST' ? 'Replanning…' : 'SEP nowcast'}
        </Button>
        <Button onClick={() => void fireEvent({ type: 'EVA_CUT', min: 45 }, 'EVA cut 45 min')} disabled={!!busy}>
          {busy === 'EVA_CUT' ? 'Replanning…' : 'Cut EVA 45 min'}
        </Button>
        <Button onClick={startHazardPick} disabled={!!busy} className={cx(hazardPick && '!border-red/60 !text-red')}>
          {hazardPick ? 'Click map…' : 'Report hazard'}
        </Button>
        <Button variant="ghost" onClick={clearEvents} disabled={!events.length || !!busy}>Clear events ({events.length})</Button>
      </div>
      <div className="text-[10.5px] leading-snug text-dim">Each event replans from EV1's current position. The new route still needs CONFIRM before it reaches the visor.</div>
    </div>
  );
}

function LinkControls() {
  const ctl = useConsole((s) => s.linkCtl);
  const link = useConsole((s) => s.link);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button variant={ctl.drop ? 'cyan' : 'danger'} onClick={() => void setLinkCtl({ drop: !ctl.drop })} className="flex-1">
          {ctl.drop ? 'Restore link' : 'Drop link'}
        </Button>
        <span className={cx('font-display text-[10.5px] uppercase tracking-[0.14em]', link === 'up' ? 'text-cyan' : link === 'degraded' ? 'text-amber' : 'text-red')}>Visor {link}</span>
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

function SimControls() {
  const sim = useConsole((s) => s.sim);
  const route = useConsole((s) => s.route);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Button variant={sim.running ? 'secondary' : 'cyan'} onClick={() => void setSim({ running: !sim.running })} disabled={!route} className="flex-1">
          {sim.running ? 'Pause' : 'Run astronaut'}
        </Button>
        <Button variant="ghost" onClick={() => void setSim({ running: false, reset: true })} disabled={!route}>Reset</Button>
      </div>
      <div className="flex items-center gap-1">
        <span className="label mr-2 !text-[9px]">Speed</span>
        {[10, 30, 60, 120].map((v) => (
          <button key={v} onClick={() => void setSim({ speed: v })} className={cx('num h-6 flex-1 rounded-[2px] border text-[10.5px]', sim.speed === v ? 'border-amber/60 bg-amber/10 text-amber' : 'border-line-2 text-mute hover:text-ink')}>
            {v}×
          </button>
        ))}
      </div>
      {!route && <div className="text-[10.5px] text-dim">Confirm a route first — the visor simulator walks the confirmed route.</div>}
    </div>
  );
}

function EventLog() {
  const log = useConsole((s) => s.log);
  const tone = { info: 'text-ink-2', ok: 'text-cyan', caution: 'text-amber', warning: 'text-red' } as const;
  return (
    <div className="max-h-[260px] overflow-y-auto rounded-[3px] border border-line bg-sunk/60">
      {log.length === 0 && <div className="px-3 py-3 text-[11px] text-dim">Nothing logged yet.</div>}
      {log.map((e) => (
        <div key={e.id} className="grid grid-cols-[58px_44px_1fr] gap-2 border-b border-line/60 px-2.5 py-1.5 last:border-0">
          <span className="num text-[10px] text-dim">{fmt.clock(e.utcMs)}</span>
          <span className="font-display text-[9px] uppercase tracking-[0.1em] text-mute">{e.source}</span>
          <span className={cx('text-[11px] leading-snug', tone[e.level])}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

export function LiveTab() {
  const mode = useConsole((s) => s.mode);
  return (
    <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
      <section>
        <SectionHead>Telemetry</SectionHead>
        <div className="mt-2.5"><Telemetry /></div>
      </section>
      <section>
        <SectionHead>Requests from EV1</SectionHead>
        <div className="mt-2.5"><Requests /></div>
      </section>
      <section>
        <SectionHead>Events</SectionHead>
        <div className="mt-2.5"><EventButtons /></div>
      </section>
      <section>
        <SectionHead right={<span className="text-[10px] text-dim">demo</span>}>Surface link</SectionHead>
        <div className="mt-2.5"><LinkControls /></div>
      </section>
      <section>
        <SectionHead right={<span className="text-[10px] text-dim">{mode === 'mock' ? 'in-browser visor sim' : 'visor runs the sim'}</span>}>Astronaut simulator</SectionHead>
        <div className="mt-2.5"><SimControls /></div>
      </section>
      <section>
        <SectionHead right={<span className="flex items-center gap-1 text-[10px] text-dim"><Kbd>L</Kbd></span>}>Event log</SectionHead>
        <div className="mt-2.5"><EventLog /></div>
      </section>
    </div>
  );
}
