import type { PlanRequest, PlanResult, RuleId, Station } from '@mw/shared/contracts';
import { cellToXY } from '@mw/shared/contracts';
import { attemptRoute } from '@mw/shared/engine';
import { directionsTo, getBackend, requestFor } from './actions';
import { findClosestSafe, findRoverSpot, restoreServerBase } from './fixes';
import { baseInfo } from './lib/base';
import { deadlineT, dropReason, hm, returnT } from './lib/plain';
import { summarizeAttempt, type AttemptView } from './lib/failure';
import { get, set, useConsole, type ConsoleState } from './store';

/**
 * One verdict for a place: the dropped-pin card runs the SAME full check the plan runs (all hard rules,
 * from the current EVA base) for that single destination, so the card and the plan always agree.
 * For a NO-GO it also computes the attempted walk, so the map can show where it breaks the rule.
 */

let pinToken = 0;
let planToken = 0;

/** The attempted walk to one stop of a request, summarised (null when the engine can't path to it). */
export function attemptFor(req: PlanRequest, destId: string, source: 'pin' | 'plan', preferRule?: RuleId): AttemptView | null {
  const s = get();
  if (!s.pack) return null;
  try {
    const at = attemptRoute(s.pack, req, destId);
    return summarizeAttempt(s.pack, s.rules, at, destId, source, preferRule, baseInfo(s.pack, s.evaBase, s.shelterCells).short);
  } catch (err) {
    console.warn('[console] attempted route failed', err);
    return null;
  }
}

function nextPinId(s: ConsoleState): string {
  let n = 1;
  while (s.customStops.some((c) => c.id === `P${n}`)) n++;
  return `P${n}`;
}

async function runPin() {
  const s = get();
  const pop = s.mapPopover;
  const b = getBackend();
  if (!pop || pop.kind !== 'terrain' || pop.id || !b || !s.pack) {
    pinToken++; // a check still in flight must not land after the card is gone
    if (s.pinCheck || s.attemptPin) set({ pinCheck: null, attemptPin: null });
    return;
  }
  const my = ++pinToken;
  const g = s.pack.manifest.grid;
  const id = nextPinId(s);
  const [x, y] = cellToXY(g, pop.cell);
  const tmp: Station = { id, name: 'Dropped pin', x, y, cell: pop.cell, value: 50, objectiveIds: [], dwellMin: 10, description: 'A place you chose on the map.' };
  set({ pinCheck: { cell: pop.cell, destId: id, status: 'checking' }, attemptPin: null });
  const req = requestFor(s.pack.manifest, { ...s, customStops: [...s.customStops, tmp], stationOn: { [id]: true }, mustVisit: { [id]: true } });
  let r: PlanResult;
  try {
    r = await b.tryPlan(req);
  } catch {
    if (my === pinToken) set({ pinCheck: null });
    return;
  }
  if (my !== pinToken) return;
  void restoreServerBase();
  if (r.order.includes(id)) {
    const out = r.segments[0];
    const dl = deadlineT(r);
    const spare = dl !== null ? dl - returnT(r) : NaN;
    set({
      pinCheck: { cell: pop.cell, destId: id, status: 'done', verdict: 'GO', walkMin: out ? out.t1Min - out.t0Min : undefined, spareMin: Number.isFinite(spare) ? spare : undefined },
      attemptPin: null,
    });
    return;
  }
  const d = r.dropped.find((x2) => x2.id === id);
  const attempt = attemptFor(req, id, 'pin', d?.rule ?? r.binding?.rule);
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const text = attempt?.failure ? cap(attempt.failure.reason) : d ? cap(dropReason(d, s.rules, { pack: s.pack, baseCell: baseInfo(s.pack, s.evaBase, s.shelterCells).cell, stopCell: pop.cell, baseName: baseInfo(s.pack, s.evaBase, s.shelterCells).short })) : (r.notes[r.notes.length - 1] ?? 'no safe plan');
  set({ pinCheck: { cell: pop.cell, destId: id, status: 'done', verdict: 'NO-GO', text, rule: d?.rule ?? attempt?.failure?.rule ?? r.binding?.rule }, attemptPin: attempt?.failure ? attempt : null });
}

/** The attempted walk behind a NO-GO plan (drawn on the map, explained in Details → Report). */
function runPlan() {
  const s = get();
  const p = s.plan;
  const req = s.planReq;
  if (!p || !req || p.status === 'OK' || !s.destinations.length) {
    if (s.attemptPlan) set({ attemptPlan: null });
    return;
  }
  const my = ++planToken;
  const dropped = s.destinations.map((id) => p.dropped.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
  const target = dropped[0]?.id ?? s.destinations[0];
  setTimeout(() => {
    if (my !== planToken || get().plan !== p) return;
    const a = attemptFor(req, target, 'plan', dropped[0]?.rule);
    set({ attemptPlan: a });
  }, 0);
}

useConsole.subscribe(
  (s) => [s.mapPopover, s.rules, s.evaBase, s.shelterCells, s.events, s.startLtstMin, s.customStops] as const,
  () => void runPin(),
  { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
);
useConsole.subscribe((s) => s.plan, runPlan);

/** Way forward from the pin card: make the pin the destination, wait for its NO-GO, then search. */
export async function fixFromPin(kind: 'closest' | 'rover') {
  const pc = get().pinCheck;
  if (!pc) return;
  const id = pc.destId;
  directionsTo({ cell: pc.cell });
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const s = get();
    if (s.planStatus === 'ready' && s.destinations.includes(id) && s.plan && !s.plan.order.includes(id)) break;
  }
  if (kind === 'closest') await findClosestSafe(id);
  else await findRoverSpot(id);
}
