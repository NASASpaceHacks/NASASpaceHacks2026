import { useEffect, useMemo, useRef } from 'react';
import type { Rule, Station } from '@mw/shared/contracts';
import { generatePlan, setAllStations, setStartLtst, toggleStation, updateRule } from '../actions';
import { set, useConsole } from '../store';
import { fmtLtst, sunAtLtst } from '../lib/marsclock';
import { fmtRule } from '../lib/format';
import { STM, goalById, objectiveById, objectiveCoverage, stationImage, whyItMatters, type Coverage } from '../lib/science';
import { Badge, Button, Kbd, SectionHead, Switch, Tip, cx } from './ui';

const T0 = 5 * 60, T1 = 19 * 60;

function LtstScrubber() {
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
  const end = start + duration;
  const sunEnd = sunAtLtst(ls, end, lat);
  const dark = sun.elevDeg < minEl || (duration > 0 && sunEnd.elevDeg < minEl);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="num text-[22px] leading-none text-ink">{fmtLtst(start)} <span className="text-[11px] text-mute">LTST</span></div>
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
          <path d={path} fill="none" stroke="#C8763A" strokeWidth="1.5" />
          <line x1={x(start)} x2={x(start)} y1="0" y2={H} stroke="#F2B544" strokeWidth="1" />
          <circle cx={x(start)} cy={y(sun.elevDeg)} r="3.5" fill="#F2B544" />
        </svg>
        <input
          aria-label="EVA start time (LTST)"
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
  full: { label: 'Covered', cls: 'text-cyan border-cyan/40 bg-cyan/5' },
  partial: { label: 'Partial', cls: 'text-amber border-amber/40 bg-amber/5' },
  lost: { label: 'Lost', cls: 'text-red border-red/50 bg-red/5' },
  none: { label: 'No station', cls: 'text-dim border-line-2' },
};

function SciencePanel() {
  const pack = useConsole((s) => s.pack);
  const plan = useConsole((s) => s.plan);
  const stationOn = useConsole((s) => s.stationOn);
  if (!pack) return null;
  const offered = new Set(Object.entries(stationOn).filter(([, v]) => v).map(([k]) => k));
  const cov = objectiveCoverage(pack.manifest.stations, offered, plan);
  return (
    <div className="flex flex-col gap-3">
      {STM.goals.map((g) => (
        <div key={g.id}>
          <Tip content={g.statement} side="left" width={300}>
            <div className="flex items-baseline gap-2">
              <span className="num text-[10.5px] text-ochre">{g.id}</span>
              <span className="line-clamp-1 text-[11.5px] text-ink-2">{g.statement}</span>
            </div>
          </Tip>
          <div className="mt-1.5 flex flex-col gap-1 border-l border-line pl-3">
            {cov.filter((c) => c.objective.goal === g.id).map((c) => (
              <Tip
                key={c.objective.id}
                side="left"
                width={320}
                content={
                  <>
                    <div className="text-ink">{c.objective.statement}</div>
                    <div className="mt-1.5 text-dim">{c.objective.rationale}</div>
                    <div className="num mt-1.5 text-[10.5px] text-mute">Weight {c.objective.weight} · stations {c.candidates.join(', ') || '—'}</div>
                  </>
                }
              >
                <div className="flex w-full items-center gap-2">
                  <span className="num w-11 shrink-0 text-[10.5px] text-mute">{c.objective.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">{c.objective.statement}</span>
                  <span className="num shrink-0 text-[10px] text-dim">{c.planned.length}/{c.candidates.length}</span>
                  <span className={cx('shrink-0 rounded-[2px] border px-1.5 font-display text-[9px] uppercase tracking-[0.1em]', COV_STYLE[c.coverage].cls)}>{COV_STYLE[c.coverage].label}</span>
                </div>
              </Tip>
            ))}
          </div>
        </div>
      ))}
      <div className="text-[10px] leading-snug text-dim">STM {STM.status}. Station values are a transparent team heuristic, not a calibrated model.</div>
    </div>
  );
}

function StationCard({ st }: { st: Station }) {
  const on = useConsole((s) => !!s.stationOn[st.id]);
  const plan = useConsole((s) => s.plan);
  const selected = useConsole((s) => s.selectedStation === st.id);
  const pack = useConsole((s) => s.pack)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selected]);
  const order = plan?.order.indexOf(st.id) ?? -1;
  const dropped = plan?.dropped.find((d) => d.id === st.id);
  const img = stationImage(pack.manifest, st);
  const why = whyItMatters(st);
  return (
    <div
      ref={ref}
      onClick={() => set({ selectedStation: selected ? null : st.id })}
      className={cx(
        'group cursor-pointer rounded-[3px] border p-2.5 transition-colors',
        selected ? 'border-amber/60 bg-amber/5' : 'border-line hover:border-line-2',
        !on && 'opacity-55',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="pt-0.5">
          <Switch size="sm" on={on} onChange={() => toggleStation(st.id)} label={`Offer ${st.id} to the planner`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num text-[11px] text-mute">{st.id}</span>
            {order >= 0 && <span className="num flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[9.5px] font-semibold text-[#16110a]">{order + 1}</span>}
            {dropped && <Badge tone="red">Dropped</Badge>}
            <span className="ml-auto num text-[11px] text-ink">{Math.round(st.value)}</span>
            <div className="h-1 w-10 overflow-hidden rounded-full bg-sunk ring-1 ring-line">
              <div className="h-full bg-ochre" style={{ width: `${st.value}%` }} />
            </div>
          </div>
          <div className="mt-1 text-[12.5px] leading-snug text-ink">{st.name}</div>
          {why && <div className={cx('mt-1 text-[11px] leading-snug text-mute', selected ? '' : 'line-clamp-2')}>{why}</div>}
          {dropped && <div className="mt-1 text-[11px] text-red/90">{dropped.text}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {st.objectiveIds.map((oid) => {
              const o = objectiveById.get(oid);
              return (
                <Tip key={oid} side="left" width={300} content={o ? <><div className="num mb-1 text-[10px] text-ochre">{oid} · {goalById.get(o.goal)?.id}</div>{o.statement}</> : oid}>
                  <span className="num rounded-[2px] border border-line-2 px-1 text-[9.5px] text-ink-2 hover:border-ochre/60 hover:text-ochre">{oid}</span>
                </Tip>
              );
            })}
            <span className="num ml-1 text-[10px] text-dim">{st.dwellMin} min dwell</span>
            {st.citation && /^https?:/.test(st.citation) && (
              <a href={st.citation} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto text-[10px] text-cyan hover:underline">
                Source ↗
              </a>
            )}
          </div>
        </div>
        {img && (
          <Tip side="left" width={260} content={<><img src={`${pack.base}/${img.file}`} alt="" className="w-full rounded-[2px]" /><div className="mt-1.5 text-[10.5px]">Sol {img.sol} · {img.camera} · {img.credit}</div></>}>
            <img src={`${pack.base}/${img.file}`} alt={`Curiosity ${img.camera} sol ${img.sol}`} className="h-12 w-12 shrink-0 rounded-[2px] object-cover ring-1 ring-line" loading="lazy" />
          </Tip>
        )}
      </div>
    </div>
  );
}

function RuleRow({ r }: { r: Rule }) {
  return (
    <div className={cx('flex items-center gap-2.5 border-b border-line/60 py-2 last:border-0', !r.enabled && 'opacity-50')}>
      <Switch size="sm" on={r.enabled} onChange={(v) => updateRule(r.id, { enabled: v })} label={`Enable ${r.label}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Tip content={<><div className="text-ink">{r.label}</div><div className="mt-1.5">{r.citation}</div></>} side="left" width={320}>
            <span className="truncate text-[11.5px] text-ink-2 underline decoration-line-2 decoration-dotted underline-offset-[3px]">{r.label}</span>
          </Tip>
          {r.assumption && <Badge tone="ochre">Assumption</Badge>}
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
          className="num h-6 w-[58px] rounded-[2px] border border-line-2 bg-sunk px-1.5 text-right text-[11px] text-ink focus:border-amber/60 focus:outline-none"
          aria-label={`${r.label} value`}
          title={fmtRule(r.value, r.unit)}
        />
        <span className="num w-7 text-[10px] text-dim">{r.unit}</span>
      </label>
    </div>
  );
}

export function PlanTab() {
  const pack = useConsole((s) => s.pack);
  const rules = useConsole((s) => s.rules);
  const stationOn = useConsole((s) => s.stationOn);
  const status = useConsole((s) => s.planStatus);
  const dirty = useConsole((s) => s.dirty);
  if (!pack) return null;
  const stations = pack.manifest.stations;
  const offered = stations.filter((s) => stationOn[s.id]).length;
  return (
    <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
      <div className="flex items-center gap-2">
        <Button variant="primary" size="lg" className="flex-1" onClick={() => void generatePlan()} disabled={status === 'planning'}>
          {status === 'planning' ? 'Planning…' : 'Generate plan'} <Kbd>G</Kbd>
        </Button>
        {dirty && status !== 'planning' && <span className="max-w-[110px] text-[10.5px] leading-tight text-amber">Inputs changed since the last plan</span>}
      </div>

      <section>
        <SectionHead>EVA start</SectionHead>
        <div className="mt-3">
          <LtstScrubber />
        </div>
      </section>

      <section>
        <SectionHead>Science coverage</SectionHead>
        <div className="mt-3">
          <SciencePanel />
        </div>
      </section>

      <section>
        <SectionHead
          right={
            <div className="flex items-center gap-1">
              <span className="num mr-1 text-[10px] text-dim">{offered}/{stations.length}</span>
              <Button size="sm" variant="ghost" onClick={() => setAllStations(true)}>All</Button>
              <Button size="sm" variant="ghost" onClick={() => setAllStations(false)}>None</Button>
            </div>
          }
        >
          Stations
        </SectionHead>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {stations.map((st) => <StationCard key={st.id} st={st} />)}
        </div>
      </section>

      <section>
        <SectionHead right={<span className="num text-[10px] text-dim">{rules.filter((r) => r.enabled && r.hard).length} hard</span>}>Flight rules</SectionHead>
        <div className="mt-1.5">
          {rules.map((r) => <RuleRow key={r.id} r={r} />)}
        </div>
      </section>
    </div>
  );
}
