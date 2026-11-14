import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fireEvent } from '../actions';
import { useConsole } from '../store';
import { fmtLtst, marsTime } from '../lib/marsclock';
import {
  FORECAST_WINDOW_H,
  byCloseness,
  enlilRuns,
  flares,
  mergeDuplicates,
  fmtOffsetH,
  fmtUtc,
  forecastCheck,
  nextLtstUtcMs,
  parseUtc,
  type EnlilRun,
} from '../lib/spaceweather';
import { Badge, Button, Tip, cx } from './ui';

/** Lead time shrinks tier by tier: days (forecast) → minutes (alert) → now (nowcast). */
function Tier({ n, name, lead, tone, right, children, testId }: { n: number; name: string; lead: string; tone: 'cyan' | 'amber' | 'red'; right?: ReactNode; children: ReactNode; testId: string }) {
  const rule = { cyan: 'before:bg-cyan', amber: 'before:bg-amber', red: 'before:bg-red' }[tone];
  const ink = { cyan: 'text-cyan', amber: 'text-amber', red: 'text-red' }[tone];
  return (
    <div data-testid={testId} className={cx('relative rounded-[3px] border border-line bg-sunk/50 py-2.5 pl-3.5 pr-3 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-[3px]', rule)}>
      <div className="flex items-center gap-2">
        <span className={cx('num text-[10.5px]', ink)}>{n}</span>
        <span className={cx('font-display text-[11px] uppercase tracking-[0.16em]', ink)}>{name}</span>
        <span className="text-[10px] text-dim">· {lead}</span>
        <span className="ml-auto">{right}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function RunRow({ r, evaMs, hit }: { r: EnlilRun; evaMs: number; hit: boolean }) {
  const dH = (r.arrivalMs - evaMs) / 3_600_000;
  return (
    <div className={cx('grid grid-cols-[1fr_52px_auto] items-center gap-2 border-b border-line/50 py-1 last:border-0', hit && 'text-amber')}>
      <div className="min-w-0">
        <div className={cx('num text-[11px]', hit ? 'text-amber' : 'text-ink-2')}>{fmtUtc(r.arrivalMs)}</div>
        <div className="truncate text-[10px] text-dim">
          {r.glancing ? 'glancing blow' : 'direct hit listed'}
          {r.speedKmS !== null ? ` · ${Math.round(r.speedKmS)} km/s` : ''}
          {r.halfAngleDeg !== null ? ` · ${Math.round(r.halfAngleDeg)}° half-angle` : ''}
          {r.copies && r.copies > 1 ? ` · listed ×${r.copies}` : ''}
        </div>
      </div>
      <span className={cx('num text-right text-[10.5px]', hit ? 'text-amber' : 'text-mute')}>{fmtOffsetH(dH)}</span>
      <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-cyan hover:underline" title={`${r.id} on CCMC DONKI`}>DONKI ↗</a>
    </div>
  );
}

function Forecast({ now }: { now: number }) {
  const pack = useConsole((s) => s.pack);
  const start = useConsole((s) => s.startLtstMin);
  const [all, setAll] = useState(false);
  const m = pack!.manifest;
  const allRuns = useMemo(() => enlilRuns(m.conditions.spaceWeather), [m]);
  const runs = useMemo(() => mergeDuplicates(allRuns), [allRuns]);
  const lon = m.grid.centerLonLat[0];
  // Demo EVA date: the scenario's Sol 412 is fictional, so the check uses the real next 09:40 LTST at Gale.
  const evaMs = nextLtstUtcMs(now, marsTime(now, lon).ltstH, start);
  const chk = forecastCheck(runs, evaMs);
  const shown = all ? runs : byCloseness(runs, evaMs).slice(0, 3).sort((a, b) => b.arrivalMs - a.arrivalMs);
  const fetched = parseUtc(m.conditions.fetchedUtc);
  const status =
    chk.status === 'GO' ? <Badge tone="cyan">Go</Badge> : chk.status === 'CAUTION' ? <Badge tone="amber">Caution</Badge> : <Badge>No data</Badge>;
  return (
    <Tier n={1} name="Forecast" lead="days ahead" tone={chk.status === 'CAUTION' ? 'amber' : 'cyan'} right={<span data-testid="forecast-status">{status}</span>} testId="tier-forecast">
      <div className="text-[11px] leading-snug text-ink-2">
        WSA-ENLIL CME runs (NASA CCMC DONKI) that predict a <span className="text-ink">Mars</span> arrival: <span className="num text-ink">{allRuns.length}</span> runs
        {runs.length < allRuns.length ? <span className="text-dim"> ({runs.length} distinct)</span> : null}.
      </div>
      <div className="mt-2 rounded-[2px] border border-line/70 bg-bg/40 px-2.5 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label !text-[9px]">Planned EVA start (demo)</span>
          <span className="num text-[11.5px] text-ink">{fmtUtc(evaMs, true)}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-dim">next {fmtLtst(start)} LTST at Gale, from today&apos;s real date</div>
        <div data-testid="forecast-verdict" className={cx('mt-1.5 text-[11px] leading-snug', chk.status === 'CAUTION' ? 'text-amber' : 'text-ink-2')}>
          {chk.status === 'NO_DATA'
            ? 'No ENLIL runs in the site pack.'
            : chk.status === 'CAUTION'
              ? `${chk.hits.length} predicted Mars arrival${chk.hits.length > 1 ? 's' : ''} within ±${FORECAST_WINDOW_H} h of the EVA start: pick another sol or plan shorter, rover-staged EVAs.`
              : `No predicted Mars arrival within ±${FORECAST_WINDOW_H} h of the EVA start.${chk.nearest ? ` Nearest: ${fmtUtc(chk.nearest.run.arrivalMs)} (${fmtOffsetH(chk.nearest.dH)}).` : ''}`}
        </div>
      </div>
      <div className="mt-2">
        {shown.map((r) => <RunRow key={r.id} r={r} evaMs={evaMs} hit={chk.hits.includes(r)} />)}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <button onClick={() => setAll((v) => !v)} className="text-[10.5px] text-cyan hover:underline">
          {all ? 'Show the 3 nearest' : `Show all ${runs.length}${runs.length < allRuns.length ? ' distinct' : ''} runs`}
        </button>
        <span className="num text-[10px] text-dim">fetched {fmtUtc(fetched)}</span>
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-dim">
        Sol 412 is a fictional scenario sol, so this check uses today&apos;s date. Arrival times come from the forecast model, not measurements. The ±{FORECAST_WINDOW_H} h window is a team assumption.
      </div>
    </Tier>
  );
}

function Alert() {
  const pack = useConsole((s) => s.pack);
  const earth = useConsole((s) => s.earth);
  const list = useMemo(() => flares(pack!.manifest.conditions.spaceWeather), [pack]);
  const lt = earth?.oneWayLightMin;
  return (
    <Tier n={2} name="Alert" lead="minutes, light-delayed" tone="amber" testId="tier-alert">
      <div className="flex items-end gap-3">
        <Tip content={<><div className="text-ink">One-way light time, Earth → Mars, now</div><div className="mt-1">{earth ? `${earth.method}. ${earth.source}` : 'Computed by the hab server Earth relay.'}</div></>} side="left" width={300}>
          <div data-testid="light-time" className="num text-[22px] leading-none text-ink">
            {lt !== undefined ? lt.toFixed(2) : '—'}
            <span className="ml-1 text-[11px] text-mute">min</span>
          </div>
        </Tip>
        <div className="pb-0.5 text-[10.5px] leading-snug text-mute">
          one-way light time today{earth ? <> · Earth–Mars <span className="num">{earth.distanceAu.toFixed(2)}</span> AU</> : ' · needs the hab server'}
        </div>
      </div>
      <div className="mt-2 text-[11px] leading-snug text-ink-2">
        DONKI notices (flares, SEP onsets) are issued on Earth and reach the hab {lt !== undefined ? <span className="num">{lt.toFixed(1)}</span> : 'one light-time'}{lt !== undefined ? ' min' : ''} or more later. Use them as a heads-up, not a return trigger.
      </div>
      {list.length > 0 && (
        <div className="mt-2">
          {list.map((f) => (
            <div key={f.id} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 border-b border-line/50 py-1 last:border-0">
              <span className="num text-[11px] text-amber">{f.cls ?? 'FLR'}</span>
              <span className="min-w-0 truncate text-[10.5px] text-ink-2" title={f.note}>
                <span className="num">{fmtUtc(f.startMs)}</span>
                {f.where ? <span className="text-dim"> · {f.where}</span> : null}
              </span>
              <a href={f.url} target="_blank" rel="noreferrer" className="text-[10px] text-cyan hover:underline">DONKI ↗</a>
            </div>
          ))}
          <div className="mt-1 text-[10px] text-dim">Flares are observed from Earth orbit. Whether they matter at Mars depends on heliolongitude.</div>
        </div>
      )}
    </Tier>
  );
}

function Nowcast() {
  const busy = useConsole((s) => s.busyEvent);
  const shelterMax = useConsole((s) => s.rules.find((r) => r.id === 'shelter_time_max_min')?.value ?? 30);
  return (
    <Tier n={3} name="Nowcast" lead="now, measured on site" tone="red" testId="tier-nowcast">
      <Button data-testid="sep-nowcast" variant="danger" className="w-full" onClick={() => void fireEvent({ type: 'SEP_NOWCAST', leadMin: shelterMax }, 'SEP nowcast: onboard dose rate +25 %')} disabled={!!busy}>
        {busy === 'SEP_NOWCAST' ? 'Replanning…' : 'Dose rate +25 % · SEP nowcast'}
      </Button>
      <div className="mt-2 text-[11px] leading-snug text-ink-2">
        The only tier that orders <span className="text-red">return now</span>: it is measured on site, with no light delay. The hab alerts the visor at once and replans from EV1&apos;s position to shelter within {shelterMax} min.
      </div>
      <div className="mt-1 text-[10px] text-dim">Simulated: no dosimeter feed in this demo. The +25 % trigger is a team assumption, not a NASA threshold.</div>
    </Tier>
  );
}

/** Live tab: forecast → alert → nowcast, each labelled with its lead time and what it may trigger. */
export function SpaceWeatherPanel() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <Forecast now={now} />
      <Alert />
      <Nowcast />
    </div>
  );
}
