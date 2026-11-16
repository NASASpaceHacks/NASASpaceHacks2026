import { useConsole } from '../store';
import { latestWx, roverWxFor } from '../lib/weather';

const t = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}`);

function Cell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="label !text-[9px]">{label}</div>
      <div className="num mt-0.5 text-[14px] leading-none text-ink">
        {value}
        {unit && !/^[—/ ]+$/.test(value) && <span className="ml-1 text-[10px] text-mute">{unit}</span>}
      </div>
    </div>
  );
}

/** The rover weather the site pack holds, newest sol only. It is a real measurement, but not for the scenario sol. */
export function SurfaceWeather() {
  const pack = useConsole((s) => s.pack);
  if (!pack) return null;
  const m = pack.manifest;
  const rover = roverWxFor(m);
  const wx = latestWx(m);
  if (!wx) return null;
  const r = wx.latest;
  return (
    <div data-testid="surface-weather" className="rounded-[3px] border border-line bg-sunk/50 px-3 py-2.5">
      <div className="text-[11px] leading-snug text-ink">
        Latest surface weather from {rover.label} <span className="num text-ink-2">(sol {r.sol}, {r.terrestrialDate})</span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-3">
        <Cell label="Air min / max" value={`${t(r.minAirC)} / ${t(r.maxAirC)}`} unit="°C" />
        <Cell label="Ground min / max" value={`${t(r.minGroundC)} / ${t(r.maxGroundC)}`} unit="°C" />
        <Cell label="Pressure" value={r.pressurePa === null ? '—' : r.pressurePa.toFixed(0)} unit="Pa" />
        <Cell label="UV index" value={r.uvIndex ?? '—'} />
        <Cell label="Season (Ls)" value={`${r.ls.toFixed(0)}°`} />
      </div>
      <div data-testid="surface-weather-note" className="mt-2.5 text-[10px] leading-snug text-dim">
        This is the latest rover reading, not the scenario sol: the scenario is sol {m.scenario.sol}, and the {rover.instrument} feed holds only{' '}
        {wx.n === 1 ? `sol ${wx.last}` : `${wx.n} recent sols (${wx.first}–${wx.last})`}. Shown for context: the plan's sun geometry uses the season of sol {m.scenario.sol}{m.conditions.rems?.some((x) => x.sol === m.scenario.sol) ? ' from this feed' : ' (not in the feed, so an assumed season)'}.
        {r.minGroundC === null && r.uvIndex === null ? ` The ${rover.instrument} outreach feed does not carry ground temperature or UV.` : ''} {rover.instrument} outreach feed, not for science use.
      </div>
    </div>
  );
}
