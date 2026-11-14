import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SpaceWeatherEvent } from '../Shared/src/contracts';
import { SOL_MS, enlilRuns, flares, forecastCheck, mergeDuplicates, nextLtstUtcMs, parseUtc } from '../Frontend/AdminView/src/lib/spaceweather';

/** Console space-weather tiers on the committed gale-v1 DONKI snapshot (manifest.conditions.spaceWeather). */
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../SitePacks/gale-v1/manifest.json', import.meta.url)), 'utf8'));
const events = manifest.conditions.spaceWeather as SpaceWeatherEvent[];

describe('space weather: forecast tier (WSA-ENLIL Mars arrivals)', () => {
  const runs = enlilRuns(events);

  it('parses every ENLIL run with a Mars arrival, newest first', () => {
    expect(runs).toHaveLength(events.filter((e) => e.kind === 'CME_ENLIL' && e.marsArrivalUtc).length);
    expect(runs.length).toBeGreaterThanOrEqual(30);
    for (const r of runs) {
      expect(Number.isFinite(r.arrivalMs)).toBe(true);
      expect(r.arrivalMs).toBeGreaterThan(r.startMs); // a CME reaches Mars after it leaves the Sun
      expect(r.url).toMatch(/^https:\/\/ccmc\.gsfc\.nasa\.gov\/DONKI\//);
    }
    for (let i = 1; i < runs.length; i++) expect(runs[i - 1].arrivalMs).toBeGreaterThanOrEqual(runs[i].arrivalMs);
    expect(runs.some((r) => r.glancing)).toBe(true);
    expect(runs.find((r) => r.id === 'WSA-ENLIL/48882/1')?.speedKmS).toBeNull(); // "speed None km/s" stays unknown
  });

  it('DONKI minute timestamps parse as UTC', () => {
    expect(parseUtc('2026-09-24T14:45Z')).toBe(Date.UTC(2026, 8, 24, 14, 45));
  });

  it('CAUTION when a predicted Mars arrival is within ±24 h of the EVA start, GO otherwise', () => {
    const hit = runs[0];
    expect(forecastCheck(runs, hit.arrivalMs + 23 * 3_600_000).status).toBe('CAUTION');
    expect(forecastCheck(runs, hit.arrivalMs - 23 * 3_600_000).hits).toContain(hit);
    const far = Date.UTC(2030, 0, 1);
    const go = forecastCheck(runs, far);
    expect(go.status).toBe('GO');
    expect(go.nearest?.run.id).toBe(hit.id);
    expect(forecastCheck([], far).status).toBe('NO_DATA');
  });

  it('merges identical duplicate runs without losing the count', () => {
    const merged = mergeDuplicates(runs);
    const copies = merged.reduce((a, r) => a + (r.copies ?? 1), 0);
    expect(copies).toBe(runs.length);
    expect(merged.length).toBeLessThanOrEqual(runs.length);
  });
});

describe('space weather: alert tier + EVA timing', () => {
  it('lists the DONKI flares with GOES class and source region', () => {
    const f = flares(events);
    expect(f.length).toBe(events.filter((e) => e.kind === 'FLR').length);
    for (const x of f) expect(x.cls).toMatch(/^[ABCMX]\d/);
  });

  it('next LTST occurrence is less than one sol ahead and lands on the target time', () => {
    const now = Date.UTC(2026, 10, 14, 12);
    expect(nextLtstUtcMs(now, 9.5, 580)).toBe(now + ((580 / 60 - 9.5) / 24) * SOL_MS);
    const t = nextLtstUtcMs(now, 10, 580); // 09:40 already passed → next sol
    expect(t - now).toBeGreaterThan(0.9 * SOL_MS);
    expect(t - now).toBeLessThan(SOL_MS);
  });
});
