import type { RuleId } from '@mw/shared/contracts';
import { generatePlan, setEvaBase } from '../actions';
import { useConsole } from '../store';
import { fmt } from '../lib/format';
import { evaLtst, fmtLtst } from '../lib/marsclock';
import { dropConsequence, objectiveCoverage } from '../lib/science';
import { RULE_PLAIN, dropReason, hm, limitLine } from '../lib/plain';
import { Badge, Button, Empty, MarginBar, SectionHead, Stat, Tip } from './ui';
import { RuleEvidence } from './Evidence';
import { WayForward, useLeftOut } from './WayForward';
import { useBaseInfo } from '../lib/base';
import { cx } from './ui';

const UNIT: Partial<Record<RuleId, string>> = {
  shelter_time_max_min: 'min', walk_radius_max_m: 'm', heat_avg_max_w: 'W', slope_max_deg: '°', slope_soft_deg: '°',
  eva_duration_max_min: 'min', los_gap_max_min: 'min', daylight_min_sun_elev_deg: '°', contingency_o2_min: 'min', egress_ingress_min: 'min', plume_keepout_m: 'm',
  walkback_speed_factor: 'min',
};

/** Details → Report: the verdict in words, what limits the walk, what was tried (NO-GO), margins, left-out stops. */
export function ReportTab() {
  const plan = useConsole((s) => s.plan);
  const rules = useConsole((s) => s.rules);
  const pack = useConsole((s) => s.pack);
  const stationOn = useConsole((s) => s.stationOn);
  const plannerLabel = useConsole((s) => s.plannerLabel);
  const fieldsSource = useConsole((s) => s.fieldsSource);
  const startLtst = useConsole((s) => s.startLtstMin);
  const zoneArea = useConsole((s) => s.zoneAreaKm2);
  const attempt = useConsole((s) => s.attemptPlan);
  const customs = useConsole((s) => s.customStops);
  const leftOut = useLeftOut();
  const base = useBaseInfo();
  if (!plan || !pack || !base) {
    return (
      <div className="p-4">
        <Empty title="No plan yet" action={<Button variant="primary" onClick={() => void generatePlan()}>Plan now</Button>}>
          Choose a destination and the report appears here: what limits the walk, the margin on every rule and any stop left out.
        </Empty>
      </div>
    );
  }
  const ruleOf = (id: RuleId) => rules.find((r) => r.id === id);
  const ok = plan.status === 'OK';
  const open = plan.totals.doseOpenSkyUSv;
  const shieldPct = open !== undefined && open > 0 ? Math.max(0, (100 * (open - plan.totals.doseUSv)) / open) : null;
  const offeredSet = new Set(Object.entries(stationOn).filter(([, v]) => v).map(([k]) => k));
  const cov = objectiveCoverage(pack.manifest.stations, offeredSet, plan);
  const offeredValue = pack.manifest.stations.filter((s) => offeredSet.has(s.id)).reduce((a, s) => a + s.value, 0);
  const binding = plan.binding;
  const bindRule = binding ? ruleOf(binding.rule) : undefined;
  const bindMargin = binding ? plan.margins[binding.rule] : undefined;
  const all = [...pack.manifest.stations, ...customs];
  const stationName = (id: string) => (all.find((s) => s.id === id)?.name ?? id).replace(/\s*\([^)]*\)\s*$/, '');
  const shownMargins = ok ? plan.margins : attempt?.margins ?? {};
  const margins = (Object.entries(shownMargins) as [RuleId, { min: number; atMin: number }][]).sort((a, b) => {
    const fa = a[1].min / (ruleOf(a[0])?.value || 1), fb = b[1].min / (ruleOf(b[0])?.value || 1);
    return fa - fb;
  });
  const lim = limitLine(plan, pack, base);
  const rover = pack.manifest.shelters.find((s) => s.kind === 'rover' && s.id !== base.id);
  const first = leftOut[0];
  const maxMarginal = Math.max(1, ...plan.leaderboard.map((l) => l.value / Math.max(1, l.marginalMin)));
  const fail = attempt?.failure ?? null;
  const dest = first?.name ?? (attempt ? stationName(attempt.destId) : 'the stop');

  const headline = ok
    ? plan.order.length
      ? `${plan.order.length} stop${plan.order.length === 1 ? '' : 's'}, ${hm(plan.totals.durationMin)}, ${(plan.totals.distM / 1000).toFixed(1)} km, from ${base.short}`
      : `Return to ${base.short}`
    : `No safe walk from ${base.short}`;

  return (
    <div className="flex flex-col gap-6 px-4 pb-6 pt-4" data-testid="report">
      <div className={cx('rounded-[3px] border px-3 py-2.5', ok ? 'border-ok/40' : 'border-red/60')}>
        <div className="flex items-center gap-3">
          <div className={cx('font-display text-[22px] font-bold tracking-[0.1em]', ok ? 'text-ok' : 'text-red')} data-testid="report-verdict">{ok ? 'GO' : 'NO-GO'}</div>
          <div className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink">{headline}</div>
        </div>
        {!ok && first && <div className="mt-1.5 text-[12.5px] text-ink-2">{first.name}: <span className="text-red">{first.reason}</span></div>}
      </div>

      <section>
        <SectionHead>{ok ? 'What limits this walk' : 'Why it failed'}</SectionHead>
        {ok && binding && (
          <div className="mt-2.5 rounded-[4px] border border-line-2 p-3.5">
            <div className="font-display text-[19px] font-semibold leading-tight text-ink">{bindRule?.label ?? RULE_PLAIN[binding.rule]}</div>
            {lim && <div className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{lim.head}. {lim.detail}</div>}
            <div className="mt-3 flex items-end gap-6">
              {bindMargin && <Stat label="Margin left" value={fmt.num(bindMargin.min, bindMargin.min < 10 ? 1 : 0)} unit={UNIT[binding.rule]} sub={`at +${Math.round(bindMargin.atMin)} min`} />}
              {bindRule && <Stat label="Limit" value={bindRule.value} unit={bindRule.unit === 'deg' ? '°' : bindRule.unit} />}
            </div>
          </div>
        )}
        {ok && !binding && <div className="mt-2 text-[12.5px] text-mute">No single rule is limiting this walk.</div>}
        {!ok && (
          <div className="mt-2.5 rounded-[4px] border border-red/50 p-3.5" data-testid="report-why">
            {fail ? (
              <>
                <div className="font-display text-[19px] font-semibold leading-tight text-red">{ruleOf(fail.rule)?.label ?? RULE_PLAIN[fail.rule]}</div>
                <div className="mt-1.5 text-[13px] leading-snug text-ink">{fail.sentence}, on the walk to {dest} and back. This stretch is marked red on the map.</div>
              </>
            ) : first ? (
              <div className="text-[13px] leading-snug text-ink">{first.name}: {first.reason}.</div>
            ) : (
              <div className="text-[13px] leading-snug text-ink">{binding ? (bindRule?.label ?? RULE_PLAIN[binding.rule]) : 'No walk from this base satisfies every hard rule.'}</div>
            )}
            {bindRule && <div className="mt-2 text-[11px] leading-snug text-mute">{bindRule.citation}</div>}
          </div>
        )}
      </section>

      {!ok && (
        <section data-testid="report-tried">
          <SectionHead>What was tried</SectionHead>
          {attempt ? (
            <>
              <div className="mt-1 text-[12px] text-mute">The shortest walk from {base.short} to {dest} and back, checked against every hard rule.</div>
              <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-4">
                <Stat label="Distance" value={(attempt.totals.distM / 1000).toFixed(2)} unit="km" sub="out and back" />
                <Stat label="Time" value={hm(attempt.totals.durationMin)} sub={`${fmtLtst(startLtst)} → ${fmtLtst(evaLtst(startLtst, attempt.totals.durationMin + 30))}`} />
                <Stat label="Steepest ground" value={Math.round(attempt.totals.maxSlopeDeg)} unit="°" sub={`limit ${ruleOf('slope_max_deg')?.value ?? 20}°`} />
                <Stat label="Out of radio contact" value={Math.round(attempt.totals.outOfContactMin)} unit="min" sub={`longest gap ${Math.round(attempt.totals.longestGapMin)} min`} tone={fail?.rule === 'los_gap_max_min' ? 'red' : undefined} />
                <Stat label="Furthest from base" value={fmt.dist(attempt.totals.maxDistHabM)} sub={`limit ${fmt.dist(ruleOf('walk_radius_max_m')?.value ?? 2000)}`} />
              </div>
            </>
          ) : (
            <div className="mt-2 text-[12.5px] text-mute">No walkable path from {base.short} reaches this stop, so there is nothing to measure.</div>
          )}
        </section>
      )}

      {!ok && (
        <section data-testid="report-ways">
          <SectionHead>Ways forward</SectionHead>
          <div className="mt-2.5 flex flex-col gap-2.5">
            {first && <WayForward destId={first.id} where="verdict" />}
            {rover && (
              <button onClick={() => setEvaBase(rover.id)} className="self-start border border-cyan px-3 py-2 text-[13.5px] font-bold text-cyan hover:bg-cyan/10">Start from {rover.name.replace(/\s*\([^)]*\)\s*$/, '')} instead</button>
            )}
            <div className="text-[12px] text-mute">Or pick a different stop on the map.</div>
          </div>
        </section>
      )}

      {ok && (
        <section>
          <SectionHead>Totals</SectionHead>
          <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-4">
            <Stat label="Distance" value={(plan.totals.distM / 1000).toFixed(2)} unit="km" sub={`max ${fmt.dist(plan.totals.maxDistHabM)} from ${base.short}`} />
            <Stat label="Duration" value={fmt.dur(plan.totals.durationMin)} sub={`${fmtLtst(startLtst)} → ${fmtLtst(evaLtst(startLtst, plan.totals.durationMin))}`} />
            <Stat label="Oxygen used" value={plan.totals.o2UsedPct.toFixed(0)} unit="%" sub="reserve not counted" />
            <Stat label="Energy" value={Math.round(plan.totals.energyKJ).toLocaleString()} unit="kJ" />
            <Stat label="Radiation dose" value={plan.totals.doseUSv.toFixed(0)} unit="µSv" sub={<Badge tone="ochre">Indicative</Badge>} />
            <Stat label="Science value" value={Math.round(plan.totals.scienceValue)} sub={`of ${Math.round(offeredValue)} offered`} tone="cyan" />
          </div>
          {shieldPct !== null && (
            <div data-testid="radiation-shielding" className="mt-3 text-[10.5px] leading-snug text-dim">
              <span className="text-ink-2">Terrain shields {shieldPct < 0.05 ? 'under 0.1' : shieldPct.toFixed(1)}% of the dose on this route</span> ({Math.round(plan.totals.doseOpenSkyUSv!)} µSv with open sky). Method:
              Guo et al. 2026 two-term sky-obstruction model on the site DEM, reproduced against Curiosity RAD (see Evidence). Terrain is never a shelter. Indicative.
            </div>
          )}
        </section>
      )}

      <section>
        <SectionHead>{ok ? 'Margin per rule' : 'Margin per rule on the attempted walk'}</SectionHead>
        <div className="mt-3 flex flex-col gap-3" data-testid="report-margins">
          {margins.length === 0 && <div className="text-[12px] text-dim">No margins to show.</div>}
          {margins.map(([id, m]) => {
            const r = ruleOf(id);
            const limit = r?.value ?? 1;
            const over = m.min < 0;
            return (
              <div key={id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {r && <RuleEvidence r={r} />}
                    <Tip content={r?.citation ?? id} side="left" width={300}>
                      <span className="text-[12px] text-ink-2">{r?.label ?? id}</span>
                    </Tip>
                  </span>
                  <span className={cx('num text-[11.5px]', over ? 'text-red' : 'text-ink')}>
                    {over ? 'over by ' : ''}{fmt.num(Math.abs(m.min), Math.abs(m.min) < 10 ? 1 : 0)} <span className="text-dim">{UNIT[id] ?? ''}{over ? '' : ' to spare'}</span>
                    <span className="ml-2 text-dim">at +{Math.round(m.atMin)} min</span>
                  </span>
                </div>
                <div className="mt-1.5"><MarginBar frac={m.min / limit} violated={over} /></div>
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
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{stationName(d.id)}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-ink-2">{dropReason(d, rules)}{r ? <span className="text-dim"> · rule: {r.label}</span> : null}</div>
                  <div className="mt-1 text-[11px] text-mute">{consequence}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {ok && plan.leaderboard.length > 0 && (
        <section>
          <SectionHead>Science value per minute</SectionHead>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {[...plan.leaderboard].sort((a, b) => b.value / Math.max(1, b.marginalMin) - a.value / Math.max(1, a.marginalMin)).map((l) => {
              const vpm = l.value / Math.max(1, l.marginalMin);
              return (
                <div key={l.id} className="grid grid-cols-[42px_1fr_96px] items-center gap-2">
                  <span className="num text-[11px] text-mute">{l.id}</span>
                  <div className="h-[5px] overflow-hidden rounded-[1px] bg-sunk ring-1 ring-line">
                    <div className="h-full bg-mute" style={{ width: `${(vpm / maxMarginal) * 100}%` }} />
                  </div>
                  <span className="num text-right text-[11px] text-ink-2">{l.value} pts / {Math.round(l.marginalMin)} min</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {ok && plan.bingo.length > 0 && (
        <section>
          <SectionHead>Latest time to leave each stop</SectionHead>
          <div className="mt-2.5 overflow-hidden rounded-[3px] border border-line">
            {plan.bingo.map((b) => (
              <div key={b.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{b.id === 'HAB' ? `Be back at ${base.short}` : `Leave ${stationName(b.id)}`}</span>
                <span className="num text-[12.5px] text-ink">{fmtLtst(b.ltstMin)}</span>
                <span className="num w-14 text-right text-[11px] text-dim">+{Math.round(b.tMin)} min</span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-dim">Mars local time. Leaving later breaks at least one hard rule.</div>
        </section>
      )}

      <section>
        <SectionHead>Planning facts</SectionHead>
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          <dt className="text-mute">EVA base</dt><dd className="text-ink">{base.short}</dd>
          <dt className="text-mute">EVA start</dt><dd className="num text-ink">{fmtLtst(startLtst)} Mars local time</dd>
          <dt className="text-mute">Safe walking area</dt><dd className="num text-ink">{zoneArea !== null ? `${zoneArea.toFixed(2)} km²` : 'not yet computed'}</dd>
        </dl>
      </section>

      <footer className="border-t border-line pt-3 text-[10.5px] leading-snug text-dim" data-testid="report-technical">
        <span className="uppercase tracking-[0.12em]">Technical</span> · {plannerLabel || `${plan.planner.pathSearch} · ${plan.planner.costModel}`} · solved in {Math.round(plan.solveMs)} ms · fields from {fieldsSource === 'server' ? 'hab server' : fieldsSource === 'engine' ? 'in-browser engine' : 'estimate'} · {plan.reqHash.slice(0, 12)}
      </footer>
    </div>
  );
}
