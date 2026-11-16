import type { PlanResult } from '@mw/shared/contracts';
import { ROUTE_PRESETS } from '@mw/shared/contracts';
import { getBackend, requestFor } from './actions';
import { baseInfo } from './lib/base';
import { verdictOf } from './lib/plain';
import { get, log, set, useConsole, type CompareRow } from './store';
import { restoreServerBase } from './fixes';

let token = 0;

/** Worst value of a rule's check over the whole route (e.g. steepest slope, longest radio gap). */
function worst(p: PlanResult, rule: 'slope_max_deg' | 'los_gap_max_min'): number | null {
  let w: number | null = null;
  for (const seg of p.segments) for (const c of seg.checks) if (c.rule === rule && Number.isFinite(c.worst)) w = w === null ? c.worst : Math.max(w, c.worst);
  return w;
}

/** The presets this site can honour: no mineral map, no Science-rich route. */
export function comparablePresets() {
  const crism = !!get().pack?.rasters.crism_sindex2;
  return ROUTE_PRESETS.filter((x) => x.id !== 'science' || crism);
}

/** Plan the current destinations once per preset (the non-mutating plan path), then point the hab server back at the current plan. */
export async function compareRoutes() {
  const s = get();
  const b = getBackend();
  if (!b || !s.pack || !s.destinations.length) return;
  const my = ++token;
  set({ compare: { status: 'running', rows: [] } });
  const rows: CompareRow[] = [];
  try {
    for (const pr of comparablePresets()) {
      const req = requestFor(s.pack.manifest, { ...s, prefs: pr.prefs });
      const plan = await b.tryPlan(req);
      if (my !== token) return;
      const base = baseInfo(s.pack, s.evaBase, s.shelterCells);
      const v = verdictOf({ plan, pack: s.pack, base, rules: s.rules, events: s.events, startLtstMin: s.startLtstMin, lsDeg: s.lsDeg });
      const ok = plan.status === 'OK';
      rows.push({
        id: pr.id,
        label: pr.label,
        verdict: v.status,
        timeMin: ok ? plan.totals.durationMin : null,
        distM: ok ? plan.totals.distM : null,
        steepDeg: ok ? worst(plan, 'slope_max_deg') : null,
        radioGapMin: ok ? worst(plan, 'los_gap_max_min') : null,
        spareMin: ok && Number.isFinite(v.spareMin) ? v.spareMin : null,
        stops: ok ? plan.order.length : null,
        science: ok ? plan.totals.scienceValue : null,
      });
    }
    set({ compare: { status: 'done', rows } });
  } catch (err) {
    if (my !== token) return;
    set({ compare: { status: 'error', rows: [] } });
    log(`Compare routes failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  } finally {
    if (my === token) await restoreServerBase();
  }
}

export function clearCompare() {
  token++;
  if (get().compare) set({ compare: null });
}

// A changed route, base, start time or rule makes the comparison stale (priorities alone do not).
useConsole.subscribe(
  (s) => [s.destinations, s.customStops, s.shelterCells, s.evaBase, s.startLtstMin, s.rules, s.events, s.siteId, s.stationOn, s.mustVisit] as const,
  clearCompare,
  { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
);
