import { useMemo } from 'react';
import type { Rule, Station } from '@mw/shared/contracts';
import { DEFAULT_CREW, cellDistM } from '@mw/shared/contracts';
import { marsMetabolicW } from '@mw/shared/engine';
import { getMap, setStartLtst, updateRule } from '../actions';
import { type BaseInfo } from '../lib/base';
import { set, useConsole } from '../store';
import { evaLtst, fmtLtst, sunAtLtst } from '../lib/marsclock';
import { fmtRule } from '../lib/format';
import { STM, goalById, objectiveById, objectiveCoverage, stationImage, whyItMatters, type Coverage } from '../lib/science';
import { MineralLine } from './PlaceCard';
import { Badge, SectionHead, Switch, Tip, cx } from './ui';
import { EvidenceLegend, RuleEvidence, openEvidence } from './Evidence';

const T0 = 5 * 60, T1 = 19 * 60;

/** EVA start time on the sun curve (Mars local time); drag to move. */
export function LtstScrubber() {
  const start = useConsole((s) => s.startLtstMin);
  const ls = useConsole((s) => s.lsDeg);
  const lat = useConsole((s) => s.pack?.manifest.grid.centerLonLat[1] ?? -4.8);
  const rules = useConsole((s) => s.rules);
  const duration = useConsole((s) => s.plan?.totals.durationMin ?? 0);
  const minEl = rules.find((r) => r.id === 'daylight_min_sun_elev_deg')?.value ?? 5;
  const W = 340, H = 64;
  const curve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let t = T0; t <= T1; t += 10) pts.push([t, sunAtLtst(ls, t, lat).elevDeg]);
    return pts;
  }, [ls, lat]);
  const x = (t: number) => ((t - T0) / (T1 - T0)) * W;
  const y = (el: number) => H - 6 - (Math.max(-10, el) / 90) * (H - 12);
  const path = curve.map(([t, e], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
  const sun = sunAtLtst(ls, start, lat);
  const end = evaLtst(start, duration);
  const sunEnd = sunAtLtst(ls, end, lat);
  const dark = sun.elevDeg < minEl || (duration > 0 && sunEnd.elevDeg < minEl);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="num text-[22px] leading-none text-ink">{fmtLtst(start)} <span className="text-[11px] text-mute">Mars local time</span></div>
          <div className="num mt-1.5 text-[11px] text-mute">
            sun {sun.elevDeg.toFixed(1)}° el · {sun.azDeg.toFixed(0)}° az{duration > 0 && <> · back {fmtLtst(end)} ({sunEnd.elevDeg.toFixed(0)}°)</>}
          </div>
        </div>
        {dark ? <Badge tone="red">Below {minEl}° sun</Badge> : <Badge tone="cyan">Daylight</Badge>}
      </div>
      <div className="relative mt-3">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-16">
          <rect x="0" y={y(minEl)} width={W} height={H - y(minEl)} fill="rgba(255,255,255,0.02)" />
          <line x1="0" x2={W} y1={y(minEl)} y2={y(minEl)} stroke="#5b5f67" strokeDasharray="2 3" strokeWidth="0.75" />
          {duration > 0 && <rect x={x(start)} y="0" width={Math.max(1, x(Math.min(T1, end)) - x(start))} height={H} fill="rgba(242,181,68,0.08)" />}
          <path d={path} fill="none" stroke="#9aa3ad" strokeWidth="1.5" />
          <line x1={x(start)} x2={x(start)} y1="0" y2={H} stroke="#e9edf2" strokeWidth="1" />
          <circle cx={x(start)} cy={y(sun.elevDeg)} r="3.5" fill="#e9edf2" />
        </svg>
        <input
          aria-label="EVA start time (Mars local time)"
          type="range"
          min={T0}
          max={T1}
          step={5}
          value={start}
          onChange={(e) => setStartLtst(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
        <div className="num mt-1 flex justify-between text-[9.5px] text-dim">
          {['05', '08', '11', '14', '17', '19'].map((h) => <span key={h}>{h}:00</span>)}
        </div>
      </div>
    </div>
  );
}

const COV_STYLE: Record<Coverage, { label: string; cls: string }> = {
  full: { label: 'Covered', cls: 'text-ok border-ok/40 bg-ok/5' },
  partial: { label: 'Partial', cls: 'text-caution border-caution/40 bg-caution/5' },
  lost: { label: 'Lost', cls: 'text-red border-red/50 bg-red/5' },
  none: { label: 'No station', cls: 'text-dim border-line-2' },
};

/** Science: goals → objectives → the stops that serve each, with covered / lost, linked to the targets on the map. */
export function SciencePanel() {
  const pack = useConsole((s) => s.pack);
  const plan = useConsole((s) => s.plan);
  const stationOn = useConsole((s) => s.stationOn);
  if (!pack) return null;
  const offered = new Set(Object.entries(stationOn).filter(([, v]) => v).map(([k]) => k));
  const cov = objectiveCoverage(pack.manifest.stations, offered, plan);
  const inPlan = new Set(plan?.order ?? []);
  const nm = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '');
  const show = (id: string) => {
    const st = pack.manifest.stations.find((x) => x.id === id);
    const map = getMap();
    if (!st || !map) return;
    set({ details: { open: false, tab: 'science' } });
    map.reveal([[st.x, st.y]]);
    setTimeout(() => {
      const px = map.map.getPixelFromCoordinate([st.x, st.y]);
      if (px) set({ mapPopover: { kind: 'station', id: st.id, cell: st.cell, px: [px[0], px[1]] } });
    }, 450);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="science-panel">
      {STM.goals.map((g) => (
        <div key={g.id}>
          <div className="text-[13px] font-medium leading-snug text-ink">{g.statement}</div>
          <div className="mt-2 flex flex-col gap-2.5 border-l border-line pl-3">
            {cov.filter((c) => c.objective.goal === g.id).map((c) => {
              const serving = pack.manifest.stations.filter((st) => st.objectiveIds.includes(c.objective.id));
              return (
                <div key={c.objective.id}>
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-2">{c.objective.statement}</span>
                    <span className={cx('shrink-0 rounded-[2px] border px-1.5 font-display text-[10px] uppercase tracking-[0.1em]', COV_STYLE[c.coverage].cls)}>{c.coverage === 'none' ? 'Not chosen' : COV_STYLE[c.coverage].label}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {serving.length === 0 && <span className="text-[11px] text-dim">No target at this site serves it.</span>}
                    {serving.map((st) => {
                      const state = inPlan.has(st.id) ? 'covered' : offered.has(st.id) ? 'lost' : 'not chosen';
                      return (
                        <button
                          key={st.id}
                          onClick={() => show(st.id)}
                          title={`${nm(st.name)}: ${state}. Show on the map.`}
                          className={cx('flex items-center gap-1.5 border px-1.5 py-0.5 text-[11.5px] hover:bg-cyan/10', state === 'covered' ? 'border-ok/50 text-ok' : state === 'lost' ? 'border-red/60 text-red' : 'border-line-2 text-mute')}
                        >
                          {nm(st.name)} <span className="text-[10px] opacity-80">{state}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="text-[11px] leading-snug text-dim">Covered = on the walk. Lost = chosen but left out. Station values are a transparent team heuristic, not a calibrated model.</div>
    </div>
  );
}

/** Expanded station row in the Stops checklist: why it matters, objectives, photo, source. */
export function StationDetails({ st }: { st: Station }) {
  const pack = useConsole((s) => s.pack)!;
  const plan = useConsole((s) => s.plan);
  const stop = plan?.stops.find((x) => x.id === st.id);
  const startLtst = useConsole((s) => s.startLtstMin);
  const bingo = plan?.bingo.find((b) => b.id === st.id);
  const img = stationImage(pack.manifest, st);
  const why = whyItMatters(st);
  return (
    <div className="flex gap-3 pb-1 pt-2">
      <div className="min-w-0 flex-1">
        {why && <div className="text-[12.5px] leading-snug text-ink-2">{why}</div>}
        <MineralLine x={st.x} y={st.y} testid="station-mineral" />
        {stop && (
          <div className="num mt-1.5 text-[11.5px] text-mute">
            Arrive {fmtLtst(evaLtst(startLtst, stop.arriveMin))} · leave {fmtLtst(evaLtst(startLtst, stop.departMin))}{bingo ? <> · <span className="text-caution">leave by {fmtLtst(bingo.ltstMin)}</span></> : null}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {st.objectiveIds.map((oid) => {
            const o = objectiveById.get(oid);
            return (
              <Tip key={oid} side="left" width={300} content={o ? <><div className="num mb-1 text-[10px] text-mute">{oid} · {goalById.get(o.goal)?.id}</div>{o.statement}</> : oid}>
                <span tabIndex={0} className="num rounded-[3px] bg-raised px-1.5 py-0.5 text-[10px] text-ink-2 hover:text-mute">{oid}</span>
              </Tip>
            );
          })}
          <span className="num ml-1 text-[10.5px] text-dim">{st.dwellMin} min at the stop</span>
          {st.citation && /^https?:/.test(st.citation) && (
            <a href={st.citation} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-ok hover:underline">
              Source ↗
            </a>
          )}
        </div>
      </div>
      {img && (
        <Tip side="left" width={260} content={<><img src={`${pack.base}/${img.file}`} alt="" className="w-full rounded-[2px]" /><div className="mt-1.5 text-[10.5px]">Sol {img.sol} · {img.camera} · {img.credit}</div></>}>
          <img src={`${pack.base}/${img.file}`} alt={`Curiosity ${img.camera} sol ${img.sol}`} className="h-14 w-14 shrink-0 rounded-[4px] object-cover" loading="lazy" />
        </Tip>
      )}
    </div>
  );
}

/**
 * Physical reason behind a STAY_IN driven by EVA duration: the closest dropped station's elevation
 * below the base (DEM) and the engine's own metabolic model on the climb back, against the suit-heat
 * budget. Every number is computed (DEM, Pandolf–Santee-Mars, flight rules, engine deficits).
 */
export function stayInWhy(base: BaseInfo): string | null {
  const s = useConsole.getState();
  const plan = s.plan, pack = s.pack;
  if (!plan || !pack) return null;
  const timeDrops = plan.dropped.filter((d) => d.rule === 'eva_duration_max_min' || d.rule === 'walkback_speed_factor' || d.rule === 'heat_avg_max_w');
  if (!timeDrops.length) return null;
  const d = [...timeDrops].sort((a, b) => a.deficitMin - b.deficitMin)[0];
  const st = pack.manifest.stations.find((x) => x.id === d.id);
  const dem = pack.rasters.dem;
  if (!st || !dem) return null;
  const g = pack.manifest.grid;
  const dz = dem[base.cell] - dem[st.cell];
  const dist = cellDistM(g, base.cell, st.cell);
  const rule = (id: Rule['id']) => s.rules.find((r) => r.id === id);
  const heat = rule('heat_avg_max_w');
  const eva = rule('eva_duration_max_min');
  const crew = DEFAULT_CREW;
  const mass = Math.round(crew.bodyMassKg + crew.suitMassKg + crew.toolsKg);
  const pLevel = marsMetabolicW(crew, crew.v0, 0, 1);
  const deficit = d.deficitMin > 0 ? `by ${Math.ceil(d.deficitMin)} min` : '';
  if (dz > 20 && dist > 0 && heat?.enabled) {
    const grade = (100 * dz) / dist;
    const pUp = marsMetabolicW(crew, crew.v0, grade, 1);
    return `Suit heat: ${st.id} sits ${Math.round(dz)} m below ${base.short}, so the walk back climbs ≈${grade.toFixed(0)} % on average. Carrying ${mass} kg at 0.38 g and ${crew.v0} m/s that costs ≈${Math.round(pUp)} W (level ≈${Math.round(pLevel)} W) against the ${heat.value} W suit-heat budget, so the heat governor must insert rests and even the closest station overruns the ${eva?.value ?? 360}-min EVA ${deficit}.`;
  }
  return `Even the closest station (${st.id}) overruns the ${eva?.value ?? 360}-min EVA ${deficit} from ${base.short}${heat?.enabled && pLevel > heat.value ? ` (walking ≈${Math.round(pLevel)} W vs the ${heat.value} W suit-heat budget needs rests)` : ''}.`;
}

/**
 * NO-GO in one plain sentence (the physical reason), for the verdict card. Same numbers as
 * `stayInWhy`: DEM elevation difference, the engine's metabolic model and the suit-heat rule.
 */
export function stayInSentence(base: BaseInfo): string | null {
  const s = useConsole.getState();
  const plan = s.plan, pack = s.pack;
  if (!plan || !pack) return null;
  const timeDrops = plan.dropped.filter((d) => d.rule === 'eva_duration_max_min' || d.rule === 'walkback_speed_factor' || d.rule === 'heat_avg_max_w');
  if (!timeDrops.length) return null;
  const d = [...timeDrops].sort((a, b) => a.deficitMin - b.deficitMin)[0];
  const st = pack.manifest.stations.find((x) => x.id === d.id);
  const dem = pack.rasters.dem;
  if (!st || !dem) return null;
  const g = pack.manifest.grid;
  const dz = dem[base.cell] - dem[st.cell];
  const dist = cellDistM(g, base.cell, st.cell);
  const heat = s.rules.find((r) => r.id === 'heat_avg_max_w');
  const eva = s.rules.find((r) => r.id === 'eva_duration_max_min');
  const crew = DEFAULT_CREW;
  if (dz > 20 && dist > 0 && heat?.enabled) {
    const pUp = marsMetabolicW(crew, crew.v0, (100 * dz) / dist, 1);
    // Only name what the engine actually reported: other stops can fail for other reasons (radio, shelter, radius).
    const val = (id: Rule['id']) => s.rules.find((r) => r.id === id)?.value;
    const OTHER: Partial<Record<Rule['id'], string>> = {
      los_gap_max_min: 'radio contact',
      shelter_time_max_min: `the ${val('shelter_time_max_min') ?? 30}-min shelter limit`,
      walk_radius_max_m: `the ${((val('walk_radius_max_m') ?? 2000) / 1000).toFixed(0)} km walking radius`,
      daylight_min_sun_elev_deg: 'daylight',
      slope_max_deg: 'the slope limit',
    };
    const others = [...new Set(plan.dropped.map((x) => OTHER[x.rule]).filter((x): x is string => !!x))];
    const also = others.length ? ` Other stops also break ${others.join(', ').replace(/, ([^,]*)$/, ' or $1')}.` : '';
    return `The stops are about ${Math.round(dz / 10) * 10} m below ${base.short}: the climb back costs ≈${Math.round(pUp)} W against the suit's ${heat.value} W cooling limit, so the closest one overruns the ${Math.round((eva?.value ?? 360) / 60)}-hour EVA.${also}`;
  }
  return `Even the closest stop (${st.id}) overruns the ${Math.round((eva?.value ?? 360) / 60)}-hour EVA from ${base.short}.`;
}

function RuleRow({ r }: { r: Rule }) {
  return (
    <div className={cx('flex items-center gap-2.5 border-b border-line/60 py-2 last:border-0', !r.enabled && 'opacity-50')}>
      <Switch size="sm" on={r.enabled} onChange={(v) => updateRule(r.id, { enabled: v })} label={`Enable ${r.label}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <RuleEvidence r={r} />
          <Tip className="min-w-0" content={<><div className="text-ink">{r.label}</div><div className="mt-1.5">{r.citation}</div></>} side="left" width={320}>
            <span className="block truncate text-[11.5px] text-ink-2 underline decoration-line-2 decoration-dotted underline-offset-[3px]">{r.label}</span>
          </Tip>
          {r.assumption && !r.evidence && <Badge tone="ochre">Assumption</Badge>}
        </div>
      </div>
      <button
        onClick={() => updateRule(r.id, { hard: !r.hard })}
        title={r.hard ? 'Hard: an OK plan may never violate it. Click to make soft.' : 'Soft: penalized, may be exceeded. Click to make hard.'}
        className={cx('rounded-[2px] border px-1 font-display text-[9px] uppercase tracking-[0.1em]', r.hard ? 'border-ink-2/40 text-ink-2' : 'border-line-2 text-dim')}
      >
        {r.hard ? 'Hard' : 'Soft'}
      </button>
      <label className="flex items-center gap-1">
        <input
          type="number"
          value={r.value}
          step={r.unit === 'm' ? 100 : r.unit === '×v₀' ? 0.05 : 1}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) updateRule(r.id, { value: v });
          }}
          className="num h-6 w-[58px] rounded-[2px] border border-line-2 bg-sunk px-1.5 text-right text-[11px] text-ink focus:border-cyan/60 focus:outline-none"
          aria-label={`${r.label} value`}
          title={fmtRule(r.value, r.unit)}
        />
        <span className="num w-7 text-[10px] text-dim">{r.unit}</span>
      </label>
    </div>
  );
}

/** Flight rules with values, citations, evidence chips and on/off toggles (Details → Rules). */
export function RulesSection() {
  const rules = useConsole((s) => s.rules);
  return (
    <section>
      <SectionHead right={<span className="num text-[10px] text-dim">{rules.length} rules · {rules.filter((r) => r.enabled && r.hard).length} hard and on</span>}>Flight rules</SectionHead>
      <div className="mt-2 text-[12px] leading-snug text-mute">Every rule the planner applies. A hard rule can never be broken by a GO plan; a soft rule is only a preference. Changing a value or switching a rule off re-plans at once.</div>
      <div data-testid="rules-note" className="mt-1.5 text-[12px] leading-snug text-ink-2">Switching off a hard rule is for analysis only. A plan made that way is not a safe EVA plan.</div>
      <div className="mt-3 rounded-[6px] bg-sunk/60 px-3 py-2">
        <div className="label mb-1.5 !text-[9px]">Evidence class: M measured · A analog · D NASA requirement · S simulated · E team assumption. Hover a chip or a rule name for the citation.</div>
        <EvidenceLegend compact />
      </div>
      <div className="mt-3 flex items-center gap-2.5 border-b border-line-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-dim"><span className="w-[34px]">On</span><span className="flex-1">Rule · evidence</span><span className="w-[34px]">Type</span><span className="w-[96px] text-right">Value</span></div>
      <div data-testid="rules" className="mt-1">
        {rules.map((r) => <RuleRow key={r.id} r={r} />)}
      </div>
      <button data-testid="open-limitations" onClick={() => openEvidence('limitations')} className="mt-2 text-[11.5px] text-ok hover:underline">
        Limitations &amp; assumptions →
      </button>
    </section>
  );
}
