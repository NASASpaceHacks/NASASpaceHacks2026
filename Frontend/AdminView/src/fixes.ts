import type { Cell, PlanResult, Station } from '@mw/shared/contracts';
import { cellToXY } from '@mw/shared/contracts';
import { rasterizeKeepouts, safeZoneMask } from '@mw/shared/map';
import { getBackend, moveShelter, replaceDestination, requestFor } from './actions';
import { shortName } from './lib/base';
import { get, log, set, useConsole, type ConsoleState } from './store';

/**
 * NO-GO "way forward": when a chosen destination can't be included, offer
 *  · Closest safe point — the nearest cell (≤ 300 m, nearest first) that passes every hard per-cell rule
 *    (the safe-area mask built from the engine fields), confirmed by re-planning with the engine;
 *  · Move rover closer — a flat (< 5°), unblocked, walkable parking spot near the destination that makes
 *    it a GO, found by trying a handful of spots with the engine planner. The rover's own drive is NOT planned.
 */

const CLOSEST_MAX_M = 300;
const ROVER_FLAT_DEG = 5;
const FIX_ID = 'PFIX';
let token = 0;

/** Rules a closer rover can fix (distance, walk-back, shelter, radio, EVA time). */
const ROVER_RULES = new Set(['walk_radius_max_m', 'walkback_speed_factor', 'shelter_time_max_min', 'los_gap_max_min', 'eva_duration_max_min', 'contingency_o2_min', 'daylight_min_sun_elev_deg', 'heat_avg_max_w']);

function destStation(s: ConsoleState, id: string): Station | undefined {
  return [...s.pack!.manifest.stations, ...s.customStops].find((x) => x.id === id);
}

const rover = (s: ConsoleState) => s.pack!.manifest.shelters.find((x) => x.kind === 'rover');

/** Which ways forward fit this destination's failure. */
export function fixKinds(destId: string): ('closest' | 'rover')[] {
  const s = get();
  const st = destStation(s, destId);
  if (!st || !s.pack) return [];
  const d = s.plan?.dropped.find((x) => x.id === destId);
  const slopeMax = s.limits && Number.isFinite(s.limits.slopeMax) ? s.limits.slopeMax : 20;
  const steepHere = s.pack.rasters.slope[st.cell] > slopeMax || (s.zone ? s.zone.keepout[st.cell] > 0 : false);
  const kinds: ('closest' | 'rover')[] = ['closest'];
  if (rover(s) && !steepHere && (!d || ROVER_RULES.has(d.rule))) kinds.push('rover');
  return kinds;
}

/** A candidate counts when the destination is in the plan and no stop that was in the plan is lost. */
function works(r: PlanResult, target: string, keep: string[]): boolean {
  return r.status === 'OK' && r.order.includes(target) && keep.every((k) => r.order.includes(k));
}

async function tryState(mod: Partial<ConsoleState>): Promise<PlanResult | null> {
  const s = get();
  const b = getBackend();
  if (!b || !s.pack) return null;
  try {
    return await b.tryPlan(requestFor(s.pack.manifest, { ...s, ...mod }));
  } catch {
    return null;
  }
}

/** The hab server remembers the last request as the base for operational events: point it back at the current plan. */
export async function restoreServerBase() {
  const s = get();
  const b = getBackend();
  if (b?.kind === 'live' && s.planReq) await b.tryPlan(s.planReq).catch(() => null);
}

const start = (destId: string, kind: 'closest' | 'rover') => {
  set({ fix: { destId, kind, status: 'searching' } });
  return ++token;
};

export async function findClosestSafe(destId: string) {
  const s0 = get();
  const st = destStation(s0, destId);
  if (!st || !s0.pack) return;
  const my = start(destId, 'closest');
  const g = s0.pack.manifest.grid;
  const slope = s0.pack.rasters.slope;
  const slopeMax = s0.limits && Number.isFinite(s0.limits.slopeMax) ? s0.limits.slopeMax : 20;
  const mask = s0.zone && s0.limits ? safeZoneMask(s0.zone, s0.limits) : null;
  const ok = (c: number) => (mask ? mask[c] === 1 : slope[c] <= slopeMax) && slope[c] <= slopeMax - 1;
  const R = Math.ceil(CLOSEST_MAX_M / g.cellM);
  const r0 = Math.floor(st.cell / g.w), c0 = st.cell % g.w;
  const cands: { cell: Cell; d: number }[] = [];
  for (let dr = -R; dr <= R; dr++) {
    for (let dc = -R; dc <= R; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 1 || c < 1 || r >= g.h - 1 || c >= g.w - 1) continue;
      const d = Math.hypot(dr, dc) * g.cellM;
      if (d > CLOSEST_MAX_M || d < g.cellM * 2) continue;
      const cell = r * g.w + c;
      // The whole 3×3 neighbourhood must pass, so the point isn't a lone speck on a steep face.
      let good = true;
      for (let y = -1; y <= 1 && good; y++) for (let x = -1; x <= 1 && good; x++) good = ok(cell + y * g.w + x);
      if (good) cands.push({ cell, d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const keep = (s0.plan?.order ?? []).filter((id) => id !== destId);
  const tests: { cell: Cell; d: number }[] = [];
  for (const c of cands) {
    if (tests.length >= 6) break;
    if (!tests.length || c.d >= tests[tests.length - 1].d + 20) tests.push(c);
  }
  for (const c of tests) {
    const [x, y] = cellToXY(g, c.cell);
    const tmp: Station = { ...st, id: FIX_ID, cell: c.cell, x, y, name: 'Closest safe point', objectiveIds: [] };
    const stationOn: Record<string, boolean> = { ...s0.stationOn, [FIX_ID]: true };
    delete stationOn[destId];
    const mustVisit: Record<string, boolean> = { ...s0.mustVisit, [FIX_ID]: true };
    delete mustVisit[destId];
    const r = await tryState({ customStops: [...s0.customStops.filter((x2) => x2.id !== destId), tmp], stationOn, mustVisit });
    if (my !== token) return;
    if (r && works(r, FIX_ID, keep)) {
      set({ fix: { destId, kind: 'closest', status: 'found', cell: c.cell, distM: Math.round(c.d / 5) * 5 } });
      void restoreServerBase();
      return;
    }
  }
  if (my !== token) return;
  set({ fix: { destId, kind: 'closest', status: 'none', note: `No safe spot within ${CLOSEST_MAX_M} m of ${destId.startsWith('P') ? 'your pin' : 'this target'}.` } });
  void restoreServerBase();
}

export async function findRoverSpot(destId: string) {
  const s0 = get();
  const st = destStation(s0, destId);
  const rv = rover(s0);
  if (!st || !rv || !s0.pack) return;
  const my = start(destId, 'rover');
  const pack = s0.pack;
  const g = pack.manifest.grid;
  const slope = pack.rasters.slope;
  const keepout = s0.zone?.keepout ?? rasterizeKeepouts(g, pack.manifest.keepouts);
  const blocked = s0.zone?.blocked;
  const hab = pack.manifest.shelters.find((x) => x.kind === 'hab');
  const habCell = hab ? (s0.shelterCells[hab.id] ?? hab.cell) : -1;
  const rc = s0.shelterCells[rv.id] ?? rv.cell;
  const rowOf = (c: number) => Math.floor(c / g.w), colOf = (c: number) => c % g.w;
  const dist = (a: number, b: number) => Math.hypot(rowOf(a) - rowOf(b), colOf(a) - colOf(b)) * g.cellM;
  const flat = (cell: number) => {
    const r = rowOf(cell), c = colOf(cell);
    if (r < 3 || c < 3 || r >= g.h - 3 || c >= g.w - 3) return false;
    // Flat, unblocked, walkable ground for the whole 3×3 neighbourhood (a 15 m pad).
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const k = cell + y * g.w + x;
      if (!(slope[k] < ROVER_FLAT_DEG) || keepout[k] > 0 || (blocked && blocked[k] > 0)) return false;
    }
    return habCell < 0 || dist(cell, habCell) > 40;
  };
  // Flat pads 100–700 m from the destination (sampled every 20 m), nearest first, spread ≥ 80 m apart;
  // ties go to the side facing the rover's current spot (a shorter drive).
  const step = Math.max(1, Math.round(20 / g.cellM));
  const R = Math.ceil(700 / g.cellM);
  const r0 = rowOf(st.cell), c0 = colOf(st.cell);
  const pads: { cell: number; score: number }[] = [];
  for (let dy = -R; dy <= R; dy += step) {
    for (let dx = -R; dx <= R; dx += step) {
      const rr = r0 + dy, cc = c0 + dx;
      if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) continue;
      const d = Math.hypot(dy, dx) * g.cellM;
      if (d < 100 || d > 700) continue;
      const cell = rr * g.w + cc;
      if (!flat(cell)) continue;
      pads.push({ cell, score: d + 0.25 * dist(cell, rc) });
    }
  }
  pads.sort((p, q) => p.score - q.score);
  const cells: number[] = [];
  for (const p of pads) {
    if (cells.every((x) => dist(x, p.cell) > 80)) cells.push(p.cell);
    if (cells.length >= 7) break;
  }
  const keep = (s0.plan?.order ?? []).filter((id) => id !== destId);
  for (const cell of cells) {
    const r = await tryState({ shelterCells: { ...s0.shelterCells, [rv.id]: cell }, evaBase: rv.id });
    if (my !== token) return;
    if (r && works(r, destId, keep)) {
      set({ fix: { destId, kind: 'rover', status: 'found', cell, distM: Math.round(dist(cell, rc) / 10) * 10 } });
      void restoreServerBase();
      return;
    }
  }
  if (my !== token) return;
  set({ fix: { destId, kind: 'rover', status: 'none', note: cells.length ? `No flat rover spot near ${clean(st.name)} makes this a GO.` : `No flat (< ${ROVER_FLAT_DEG}°), unblocked ground to park on near ${clean(st.name)}.` } });
  void restoreServerBase();
}

const clean = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '');

export function acceptFix() {
  const s = get();
  const f = s.fix;
  if (!f || f.status !== 'found' || f.cell === undefined) return;
  token++;
  set({ fix: null });
  if (f.kind === 'closest') {
    const st = destStation(s, f.destId);
    const name = st && st.id.startsWith('P') ? 'Closest safe point' : `Near ${clean(st?.name ?? f.destId)}`;
    replaceDestination(f.destId, f.cell, name);
    log(`Destination moved ${f.distM} m to the closest safe point`, 'info');
  } else {
    const rv = rover(s);
    if (!rv) return;
    log(`${shortName(rv)} moved to the suggested spot (${f.distM} m drive, route not planned)`, 'info');
    moveShelter(rv.id, f.cell);
  }
}

export function dismissFix() {
  token++;
  set({ fix: null });
}

// A changed route or base makes any suggestion stale.
useConsole.subscribe(
  (s) => [s.destinations, s.customStops, s.shelterCells, s.evaBase, s.uiMode] as const,
  () => {
    if (get().fix) dismissFix();
  },
  { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
);
