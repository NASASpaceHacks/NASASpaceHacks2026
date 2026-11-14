import type { RuleId } from '@mw/shared/contracts';
import { generatePlan } from '../actions';
import { useConsole } from '../store';
import { fmt } from '../lib/format';
import { evaLtst, fmtLtst } from '../lib/marsclock';
import { dropConsequence, objectiveCoverage } from '../lib/science';
import { Badge, Button, Empty, MarginBar, SectionHead, Stat, Tip, cx } from './ui';
import { RuleEvidence } from './Evidence';
import { endpointLabel, relabel, useBaseInfo } from '../lib/base';

const UNIT: Partial<Record<RuleId, string>> = {
  shelter_time_max_min: 'min', walk_radius_max_m: 'm', heat_avg_max_w: 'W', slope_max_deg: '°', slope_soft_deg: '°',
  eva_duration_max_min: 'min', los_gap_max_min: 'min', daylight_min_sun_elev_deg: '°', contingency_o2_min: 'min', egress_ingress_min: 'min', plume_keepout_m: 'm',
};

export function ReportTab() {
  const plan = useConsole((s) => s.plan);
  const rules = useConsole((s) => s.rules);
  const pack = useConsole((s) => s.pack);
  const stationOn = useConsole((s) => s.stationOn);
  const plannerLabel = useConsole((s) => s.plannerLabel);
  const fieldsSource = useConsole((s) => s.fieldsSource);
  const startLtst = useConsole((s) => s.startLtstMin);
  const shelterCells = useConsole((s) => s.shelterCells);
  const zoneArea = useConsole((s) => s.zoneAreaKm2);
  const base = useBaseInfo();
  if (!plan || !pack || !base) {
    return (
      <div className="p-4">
        <Empty title="No plan yet" action={<Button variant="primary" onClick={() => void generatePlan()}>Plan now</Button>}>
          The full report appears with the plan: margins per rule, left-out stops and leave-by times.
        </Empty>
      </div>
    );
  }
  const ruleOf = (id: RuleId) => rules.find((r) => r.id === id);
  const ok = plan.status === 'OK';
  const offeredSet = new Set(Object.entries(stationOn).filter(([, v]) => v).map(([k]) => k));
  const cov = objectiveCoverage(pack.manifest.stations, offeredSet, plan);
  const offeredValue = pack.manifest.stations.filter((s) => offeredSet.has(s.id)).reduce((a, s) => a + s.value, 0);
  const binding = plan.binding;
  const bindRule = binding ? ruleOf(binding.rule) : undefined;
  const bindMargin = binding ? plan.margins[binding.rule] : undefined;
  const stationName = (id: string) => pack.manifest.stations.find((s) => s.id === id)?.name ?? id;
  const margins = (Object.entries(plan.margins) as [RuleId, { min: number; atMin: number }][]).sort((a, b) => {
    const fa = a[1].min / (ruleOf(a[0])?.value || 1), fb = b[1].min / (ruleOf(b[0])?.value || 1);
    return fa - fb;
  });
  const rl = (t: string) => relabel(pack, base, t);
  const segLabel = (i: number) => {
    const sg = plan.segments[i];
    if (!sg) return undefined;
    return `${endpointLabel(pack, base, sg.from, shelterCells, sg.cells[0])} → ${endpointLabel(pack, base, sg.to, shelterCells, sg.cells[sg.cells.length - 1])}`;
  };
  const maxMarginal = Math.max(1, ...plan.leaderboard.map((l) => l.value / Math.max(1, l.marginalMin)));

  return (
    <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
      <div className={cx('flex items-center gap-3 rounded-[3px] border px-3 py-2.5', ok ? 'border-ok/40 bg-ok/5' : 'border-red/50 bg-red/5')}>
        <div className={cx('font-display text-[20px] font-bold tracking-[0.12em]', ok ? 'text-ok' : 'text-red')}>{ok ? 'OK' : 'No safe walk'}</div>
        <div className="min-w-0 flex-1 text-[11px] leading-snug text-mute">
          <div className="truncate text-ink-2">{plannerLabel}</div>
          <div className="num">EVA base {base.short} · safe area {zoneArea !== null ? `${zoneArea.toFixed(2)} km²` : '—'} · solved {Math.round(plan.solveMs)} ms · fields {fieldsSource === 'server' ? 'hab server' : fieldsSource === 'engine' ? 'engine' : 'estimate'} · {plan.reqHash.slice(0, 14)}</div>
        </div>
      </div>

      {!ok && plan.notes.length > 0 && (
        <div className="flex flex-col gap-1 text-[12px] text-ink-2">
          {plan.notes.map((n, i) => <div key={i}>• {rl(n)}</div>)}
        </div>
      )}

      {binding && (
        <section className="relative overflow-hidden rounded-[4px] border border-line-2 p-4">
          <div className="label">What limits this walk <span className="text-dim normal-case tracking-normal">(binding constraint)</span></div>
          <div className="mt-2 font-display text-[22px] font-semibold leading-tight text-ink">{bindRule?.label ?? binding.rule}</div>
          <div className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{rl(binding.text)}</div>
          <div className="mt-3 flex items-end gap-6">
            {bindMargin && (
              <Stat label="Margin left" value={fmt.num(bindMargin.min, bindMargin.min < 10 ? 1 : 0)} unit={UNIT[binding.rule]} sub={`at +${Math.round(bindMargin.atMin)} min`} />
            )}
            {bindRule && <Stat label="Limit" value={bindRule.value} unit={bindRule.unit === 'deg' ? '°' : bindRule.unit} />}
            <Stat label="On leg" value={binding.seg + 1} sub={segLabel(binding.seg)} />
          </div>
          {bindRule && <div className="mt-3 border-t border-line pt-2 text-[10.5px] leading-snug text-mute">{bindRule.citation}</div>}
        </section>
      )}

      <section>
        <SectionHead>Totals</SectionHead>
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-4">
          <Stat label="Distance" value={(plan.totals.distM / 1000).toFixed(2)} unit="km" sub={`max ${fmt.dist(plan.totals.maxDistHabM)} from ${base.short}`} />
          <Stat label="Duration" value={fmt.dur(plan.totals.durationMin)} sub={`${fmtLtst(startLtst)} → ${fmtLtst(evaLtst(startLtst, plan.totals.durationMin))}`} />
          <Stat label="O₂ used" value={plan.totals.o2UsedPct.toFixed(0)} unit="%" sub="excl. contingency" />
          <Stat label="Energy" value={Math.round(plan.totals.energyKJ).toLocaleString()} unit="kJ" />
          <Stat label="Dose" value={plan.totals.doseUSv.toFixed(0)} unit="µSv" sub={<Badge tone="ochre">Indicative</Badge>} />
          <Stat label="Science" value={Math.round(plan.totals.scienceValue)} sub={`of ${Math.round(offeredValue)} offered`} tone="cyan" />
        </div>
      </section>

      <section>
        <SectionHead>Margin per rule</SectionHead>
        <div className="mt-3 flex flex-col gap-3">
          {margins.length === 0 && <div className="text-[11.5px] text-dim">The planner reported no margins.</div>}
          {margins.map(([id, m]) => {
            const r = ruleOf(id);
            const lim = r?.value ?? 1;
            const frac = id === 'heat_avg_max_w' || id === 'walk_radius_max_m' || id === 'slope_max_deg' ? m.min / lim : m.min / lim;
            return (
              <div key={id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {r && <RuleEvidence r={r} />}
                    <Tip content={r?.citation ?? id} side="left" width={300}>
                      <span className="text-[11.5px] text-ink-2">{r?.label ?? id}</span>
                    </Tip>
                  </span>
                  <span className="num text-[11px] text-ink">
                    {fmt.signed(m.min, Math.abs(m.min) < 10 ? 1 : 0)} <span className="text-dim">{UNIT[id] ?? ''}</span>
                    <span className="ml-2 text-dim">@ +{Math.round(m.atMin)}m</span>
                  </span>
                </div>
                <div className="mt-1.5">
                  <MarginBar frac={frac} violated={m.min < 0} tone={binding?.rule === id ? 'amber' : undefined} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {plan.dropped.length > 0 && (
        <section>
          <SectionHead right={<span className="num text-[10px] text-dim">{plan.dropped.length}</span>}>Left-out stops and why</SectionHead>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {plan.dropped.map((d) => {
              const r = ruleOf(d.rule);
              const consequence = dropConsequence(d.id, pack.manifest.stations, cov);
              return (
                <div key={d.id} className="rounded-[3px] border border-line px-2.5 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="num text-[11px] text-red">{d.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{stationName(d.id)}</span>
                    {d.deficitMin > 0 && <span className="num text-[10.5px] text-mute">−{Math.round(d.deficitMin)} min</span>}
                  </div>
                  <div className="mt-1 text-[11px] text-ink-2">
                    {r?.label ?? d.rule} <span className="text-dim">— {d.text}</span>
                  </div>
                  <div className="mt-1 text-[10.5px] text-caution/90">→ {consequence}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {plan.leaderboard.length > 0 && (
        <section>
          <SectionHead>Leaderboard · value per minute</SectionHead>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {[...plan.leaderboard].sort((a, b) => b.value / Math.max(1, b.marginalMin) - a.value / Math.max(1, a.marginalMin)).map((l) => {
              const vpm = l.value / Math.max(1, l.marginalMin);
              return (
                <div key={l.id} className="grid grid-cols-[42px_1fr_70px] items-center gap-2">
                  <span className="num text-[11px] text-mute">{l.id}</span>
                  <div className="h-[5px] overflow-hidden rounded-[1px] bg-sunk ring-1 ring-line">
                    <div className="h-full bg-mute" style={{ width: `${(vpm / maxMarginal) * 100}%` }} />
                  </div>
                  <span className="num text-right text-[10.5px] text-ink-2">{l.value} / {Math.round(l.marginalMin)}m</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {plan.bingo.length > 0 && (
        <section>
          <SectionHead>Leave-by times <span className="normal-case tracking-normal text-dim">(bingo)</span></SectionHead>
          <div className="mt-2.5 overflow-hidden rounded-[3px] border border-line">
            {plan.bingo.map((b) => (
              <div key={b.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                <span className="num w-10 text-[11px] text-cyan">{b.id === 'HAB' ? base.short : b.id}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{rl(b.text)}</span>
                <span className="num text-[12px] text-ink">{fmtLtst(b.ltstMin)}</span>
                <span className="num w-14 text-right text-[10.5px] text-dim">+{Math.round(b.tMin)}m</span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-[10.5px] text-dim">Latest departure from each stop that still keeps every hard rule, in Mars local time.</div>
        </section>
      )}

      {ok && plan.notes.length > 0 && (
        <section>
          <SectionHead>Notes</SectionHead>
          <div className="mt-2 flex flex-col gap-1 text-[11px] leading-snug text-mute">
            {plan.notes.map((n, i) => <div key={i}>{rl(n)}</div>)}
          </div>
        </section>
      )}
    </div>
  );
}
