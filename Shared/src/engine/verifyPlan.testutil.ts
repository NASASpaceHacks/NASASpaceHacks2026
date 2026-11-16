import { existsSync, readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { cellDistM } from '../contracts/grid';
import { decodeRaster, type LoadedSitePack, type SitePackManifest } from '../contracts';
import type { PlanRequest, PlanResult, Rule, RuleId } from '../contracts/types';
import { computeFields } from './index';

/** Test helper (not a test file): independent re-verification of plans, shared by plan.test.ts and prefs.test.ts. */

const packDir = (id: string) => new URL(`../../../SitePacks/${id}/`, import.meta.url);
/** True when SitePacks/<id> is built (tests on real data are skipped otherwise). */
export const sitePackOnDisk = (id: string): boolean => existsSync(new URL('manifest.json', packDir(id))) && existsSync(new URL('dem.bin', packDir(id)));
/** Load SitePacks/<id> from disk (manifest + every raster). */
export function loadSitePackFromDisk(id: string): LoadedSitePack {
  const dir = packDir(id);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as SitePackManifest;
  const rasters: Record<string, Float32Array> = {};
  for (const l of Object.values(manifest.rasters)) {
    const b = readFileSync(new URL(l.file, dir));
    rasters[l.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, l);
  }
  return { manifest, rasters, base: dir.pathname };
}

export const HARD_CHECKED: RuleId[] = ['slope_max_deg', 'walk_radius_max_m', 'shelter_time_max_min', 'walkback_speed_factor', 'los_gap_max_min',
  'daylight_min_sun_elev_deg', 'heat_avg_max_w', 'eva_duration_max_min'];

export const ruleOf = (rules: Rule[], id: RuleId) => rules.find((r) => r.id === id)!;
export const enforced = (rules: Rule[], id: RuleId) => ruleOf(rules, id).enabled && ruleOf(rules, id).hard;
export const strip = (r: PlanResult) => ({ ...r, solveMs: 0 });

/**
 * Independent re-verification of an OK plan against the request (does not trust the plan's checks).
 */
export function verifyOk(pack: LoadedSitePack, req: PlanRequest, res: PlanResult): void {
  const g = pack.manifest.grid;
  const f = computeFields(pack, req);
  const rules = req.rules;
  // every reported check passes
  for (const s of res.segments) for (const c of s.checks) {
    expect(c.pass, `${s.from}->${s.to} ${c.rule} worst ${c.worst} limit ${c.limit}`).toBe(true);
    expect(c.margin).toBeGreaterThanOrEqual(-1e-9);
  }
  for (const id of HARD_CHECKED) if (enforced(rules, id) && res.segments.length) expect(res.margins[id], id).toBeDefined();
  // route geometry: contiguous, 8-connected, from the start to the hab, never on blocked cells
  const start = req.resume?.cell ?? req.hab;
  expect(res.segments[0].cells[0]).toBe(start);
  expect(res.segments.at(-1)!.cells.at(-1)).toBe(req.hab);
  for (let i = 0; i < res.segments.length; i++) {
    const cells = res.segments[i].cells;
    if (i > 0) expect(cells[0]).toBe(res.segments[i - 1].cells.at(-1));
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (c !== start) expect(f.blocked[c], `blocked cell ${c}`).toBe(0);
      if (enforced(rules, 'walk_radius_max_m')) expect(cellDistM(g, req.hab, c)).toBeLessThanOrEqual(ruleOf(rules, 'walk_radius_max_m').value + 1e-6);
      if (enforced(rules, 'shelter_time_max_min') && c !== start) expect(f.shelterMin[c]).toBeLessThanOrEqual(ruleOf(rules, 'shelter_time_max_min').value + 1e-6);
      if (k > 0) {
        const p = cells[k - 1];
        expect(Math.max(Math.abs(Math.floor(c / g.w) - Math.floor(p / g.w)), Math.abs((c % g.w) - (p % g.w)))).toBe(1);
      }
    }
  }
  // stops: in order, dwell honoured, visited stations excluded
  expect(res.stops.map((s) => s.id)).toEqual(res.order);
  for (const s of res.stops) {
    const st = req.stations.find((x) => x.id === s.id)!;
    expect(s.departMin - s.arriveMin).toBeGreaterThanOrEqual(st.dwellMin - 1e-9);
    expect(req.resume?.visited ?? []).not.toContain(s.id);
  }
  // EVA duration, burndown-level walkback / heat / daylight
  const cut = (req.events ?? []).reduce((a, e) => a + (e.t === 'EVA_CUT' ? e.min : 0), 0);
  expect(res.totals.durationMin).toBeLessThanOrEqual(ruleOf(rules, 'eva_duration_max_min').value - cut + 1e-6);
  for (const b of res.burndown) {
    if (enforced(rules, 'walkback_speed_factor')) expect(b.walkbackMarginMin).toBeGreaterThanOrEqual(-1e-6);
    if (enforced(rules, 'heat_avg_max_w')) expect(b.heatAvgW).toBeLessThanOrEqual(ruleOf(rules, 'heat_avg_max_w').value + 1e-6);
    if (enforced(rules, 'daylight_min_sun_elev_deg')) expect(b.sunElevDeg).toBeGreaterThanOrEqual(ruleOf(rules, 'daylight_min_sun_elev_deg').value - 1e-6);
  }
  // bingo: latest departures are not earlier than the planned departures
  for (const s of res.stops) expect(res.bingo.find((b) => b.id === s.id)!.tMin).toBeGreaterThanOrEqual(s.departMin - 1e-6);
}
