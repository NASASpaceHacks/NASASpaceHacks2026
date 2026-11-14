import type { SpaceWeatherEvent } from '@mw/shared/contracts';

/**
 * Three-tier space-weather response (pure; no DOM, no engine):
 *   1 FORECAST: WSA-ENLIL CME runs that list a Mars arrival (CCMC DONKI, keyless DONKI API v2, cached in
 *     the site pack as manifest.conditions.spaceWeather). Days of lead time, so plan the EVA date with it.
 *   2 ALERT: DONKI notifications (flares, SEP onsets) issued on Earth reach the hab one light-time later.
 *   3 NOWCAST: the onboard dose rate. Measured on site with no delay; the only tier that orders RETURN NOW.
 * Source: https://ccmc.gsfc.nasa.gov/tools/DONKI/ (Space Weather Database Of Notifications, Knowledge,
 * Information; NASA CCMC). WSA-ENLIL+Cone: Odstrcil 2003, Adv. Space Res. 32, 497, doi:10.1016/S0273-1177(03)00332-6.
 */

/** Mean Mars solar day, 88,775.244 s (Allison & McEwen 2000, Planet. Space Sci. 48, 215; Mars24). */
export const SOL_MS = 88_775_244;

/** ±window around the planned EVA start that flags a predicted Mars arrival (team assumption, evidence E). */
export const FORECAST_WINDOW_H = 24;

export interface EnlilRun {
  id: string;
  /** CME start time (UTC ms) the run was made for. */
  startMs: number;
  /** Predicted shock arrival at Mars (UTC ms). */
  arrivalMs: number;
  glancing: boolean;
  speedKmS: number | null;
  halfAngleDeg: number | null;
  url: string;
  /** Identical runs merged into this one (DONKI sometimes lists the same CME analysis twice). */
  copies?: number;
}

export interface Flare {
  id: string;
  startMs: number;
  /** GOES class, e.g. "M6.7". */
  cls: string | null;
  /** Source location / active region, e.g. "N12W20 (AR 14549)". */
  where: string | null;
  note: string;
  url: string;
}

/** DONKI timestamps look like "2026-09-24T14:45Z" (no seconds). */
export function parseUtc(s: string | undefined): number {
  if (!s) return NaN;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  return Date.parse(s.replace(/Z$/, ':00Z'));
}

const num = (re: RegExp, s: string): number | null => {
  const m = re.exec(s);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
};

/** ENLIL runs with a Mars arrival, newest arrival first. */
export function enlilRuns(events: SpaceWeatherEvent[] | undefined): EnlilRun[] {
  return (events ?? [])
    .filter((e) => e.kind === 'CME_ENLIL' && e.marsArrivalUtc)
    .map((e) => ({
      id: e.id,
      startMs: parseUtc(e.startUtc),
      arrivalMs: parseUtc(e.marsArrivalUtc),
      glancing: /glancing/i.test(e.note),
      speedKmS: num(/speed\s+([\d.]+)\s*km\/s/i, e.note),
      halfAngleDeg: num(/half-angle\s+([\d.]+)/i, e.note),
      url: e.sourceUrl,
    }))
    .filter((r) => Number.isFinite(r.arrivalMs))
    .sort((a, b) => b.arrivalMs - a.arrivalMs);
}

/** Merge runs with the same CME start, Mars arrival, speed and half-angle (keeps the first id). */
export function mergeDuplicates(runs: EnlilRun[]): EnlilRun[] {
  const out = new Map<string, EnlilRun>();
  for (const r of runs) {
    const k = `${r.startMs}|${r.arrivalMs}|${r.speedKmS}|${r.halfAngleDeg}`;
    const prev = out.get(k);
    if (prev) prev.copies = (prev.copies ?? 1) + 1;
    else out.set(k, { ...r });
  }
  return [...out.values()];
}

export function flares(events: SpaceWeatherEvent[] | undefined): Flare[] {
  return (events ?? [])
    .filter((e) => e.kind === 'FLR')
    .map((e) => {
      const m = /^([A-Z]\d+(?:\.\d+)?) flare from (\S+(?: \(AR \d+\))?)/.exec(e.note);
      return { id: e.id, startMs: parseUtc(e.startUtc), cls: m ? m[1] : null, where: m ? m[2] : null, note: e.note, url: e.sourceUrl };
    })
    .sort((a, b) => b.startMs - a.startMs);
}

/**
 * UTC of the next occurrence of `targetMin` (minutes after local midnight, LTST) at the site, given the
 * site's LTST now (hours). LTST advances 24 h per sol; the equation-of-time drift over < 1 sol is a
 * few seconds and is ignored.
 */
export function nextLtstUtcMs(nowMs: number, ltstNowH: number, targetMin: number): number {
  const dH = (((targetMin / 60 - ltstNowH) % 24) + 24) % 24;
  return nowMs + (dH / 24) * SOL_MS;
}

export interface ForecastCheck {
  status: 'GO' | 'CAUTION' | 'NO_DATA';
  evaMs: number;
  windowH: number;
  /** Runs whose predicted Mars arrival is within ±windowH of the EVA start. */
  hits: EnlilRun[];
  /** Run with the smallest |arrival − EVA| and that offset in hours (negative = before the EVA). */
  nearest: { run: EnlilRun; dH: number } | null;
}

/** Go/no-go for an EVA date: CAUTION if any predicted Mars arrival falls within ±windowH of the EVA start. */
export function forecastCheck(runs: EnlilRun[], evaMs: number, windowH = FORECAST_WINDOW_H): ForecastCheck {
  if (!runs.length) return { status: 'NO_DATA', evaMs, windowH, hits: [], nearest: null };
  let nearest: ForecastCheck['nearest'] = null;
  const hits: EnlilRun[] = [];
  for (const r of runs) {
    const dH = (r.arrivalMs - evaMs) / 3_600_000;
    if (Math.abs(dH) <= windowH) hits.push(r);
    if (!nearest || Math.abs(dH) < Math.abs(nearest.dH)) nearest = { run: r, dH };
  }
  return { status: hits.length ? 'CAUTION' : 'GO', evaMs, windowH, hits, nearest };
}

/** Runs ordered by closeness to the EVA start. */
export function byCloseness(runs: EnlilRun[], evaMs: number): EnlilRun[] {
  return [...runs].sort((a, b) => Math.abs(a.arrivalMs - evaMs) - Math.abs(b.arrivalMs - evaMs));
}

/** "13 Nov 12:00 UTC" */
export function fmtUtc(ms: number, withYear = false): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${mon}${withYear ? ` ${d.getUTCFullYear()}` : ''} ${hh}:${mm} UTC`;
}

/** Signed hour offset: "−39 h", "+2.5 d". */
export function fmtOffsetH(dH: number): string {
  const s = dH < 0 ? '−' : '+';
  const a = Math.abs(dH);
  return a >= 72 ? `${s}${(a / 24).toFixed(1)} d` : `${s}${a.toFixed(a < 10 ? 1 : 0)} h`;
}
