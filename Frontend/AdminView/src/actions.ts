import type { Cell, LinkMsg, Station, PlanEvent, PlanRequest, PlanResult, Rule, RuleId, SitePackManifest } from '@mw/shared/contracts';
import { DEFAULT_CREW, cellToXY, xyToCell } from '@mw/shared/contracts';
import { stageFromShelter } from '@mw/shared/engine';
import { maskAreaKm2, safeZoneMask } from '@mw/shared/map';
import { detectBackend, type Backend } from './api';
import { marsTime } from './lib/marsclock';
import { baseInfo, defaultBase, relabel, shelterById, shortName } from './lib/base';
import { engineConst } from './lib/engine';
import type { ActionKind, ConsoleEvent, DetailsTab, LinkCtl, OverlayId, PlanBundle, PresetId, UiMode, VectorId } from './lib/types';
import { buildZone, explainSteps, losGapSource, zoneLimits } from './lib/zone';
import type { MapController } from './map/MapController';
import { OVERLAY_LIMIT, PRESETS, get, log, pushAlert, set } from './store';

/**
 * "Must visit" pin: the request carries no hard must-visit field (contract frozen), so a pinned station
 * gets this much extra value in the request. The planner's objective is science value, so it then
 * keeps the station whenever any safe plan can include it; if none can, it is still dropped with the
 * engine's reason. Displayed values are always the station's real value (see `realValues`).
 */
export const MUST_VISIT_BONUS = 10_000;

let backend: Backend | null = null;
let map: MapController | null = null;
let disconnect: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let replanTimer: ReturnType<typeof setTimeout> | null = null;
let planToken = 0;

export const getBackend = () => backend;
export const getMap = () => map;

// ───────────────────────────── Boot ─────────────────────────────

let booted = false;

export async function boot() {
  if (booted) return; // React StrictMode runs mount effects twice in dev
  booted = true;
  const step = (s: string) => set((st) => ({ bootSteps: [...st.bootSteps, s] }));
  try {
    step('Contacting hab server');
    const { backend: b, reason } = await detectBackend();
    backend = b;
    set({ sourceLabel: b.label, sourceReason: reason });
    step(reason);
    // The recommended plan: base = rover if present, scenario start time, every station. On the hab
    // server it starts solving as soon as the manifest is read (zero clicks, verdict in ≤ 3 s).
    const recommended = (m: SitePackManifest) => {
      const stationOn: Record<string, boolean> = {};
      // Route builder: nothing is chosen until the officer picks destinations.
      const shelterCells: Record<string, Cell> = {};
      m.shelters.forEach((s) => (shelterCells[s.id] = s.cell));
      const evaBase = (m.shelters.find((s) => s.kind === 'rover') ?? m.shelters.find((s) => s.kind === 'hab') ?? m.shelters[0]).id;
      return { stationOn, shelterCells, evaBase, startLtstMin: m.scenario.startLtstMin };
    };
    const pack = await b.loadPack(step);
    const m = pack.manifest;
    const { stationOn, shelterCells } = recommended(m);
    const rems = m.conditions.rems;
    // Season for sun geometry: latest REMS Ls; else the engine's scenario default (keeps the
    // console's daylight check consistent with the planner); else Ls now.
    const lsDeg = rems?.length ? rems[rems.length - 1].ls : (engineConst('DEFAULT_LS_DEG') ?? marsTime(Date.now(), m.grid.centerLonLat[0]).lsDeg);
    set({
      pack,
      mode: b.kind,
      stationOn,
      shelterCells,
      // Live / in-browser engine: stage from the rover by default. The offline golden fixture always
      // plans from the hab, so mock mode without ?engine=1 starts from Hab-1 to stay coherent.
      evaBase: b.kind === 'mock' && new URLSearchParams(location.search).get('engine') !== '1'
        ? (m.shelters.find((x) => x.kind === 'hab')?.id ?? defaultBase(pack))
        : defaultBase(pack),
      startLtstMin: m.scenario.startLtstMin,
      lsDeg,
    });
    step(`Site pack ready · ${m.grid.w}×${m.grid.h} cells at ${m.grid.cellM} m`);
    log(`${b.kind === 'live' ? 'Connected to hab server' : 'Mock mode'} — ${m.name}`, 'info', 'system');
    disconnect = b.connect({ onMsg: handleLinkMsg, onStatus: (s) => setLinkStatus(s) });
    if (b.kind === 'live') {
      pollTimer = setInterval(pollServer, 2000);
      void pollServer();
    }
  } catch (err) {
    set({ bootError: err instanceof Error ? err.message : String(err) });
  }
}

export function attachMap(m: MapController | null) {
  map = m;
}

export function shutdown() {
  disconnect?.();
  if (pollTimer) clearInterval(pollTimer);
}

// ───────────────────────────── Planning ─────────────────────────────

export function buildRequest(): PlanRequest {
  return requestFor(get().pack!.manifest, get());
}

/** The plan request for a manifest and the planning inputs (pure; `buildRequest` = current state). */
export function requestFor(
  m: SitePackManifest,
  s: { customStops?: Station[]; shelterCells: Record<string, Cell>; stationOn: Record<string, boolean>; mustVisit: Record<string, boolean>; startLtstMin: number; rules: Rule[]; events: PlanEvent[]; evaBase: string | null },
): PlanRequest {
  const hab = m.shelters.find((x) => x.kind === 'hab')!;
  let req: PlanRequest = {
    siteId: m.id,
    hab: s.shelterCells[hab.id] ?? hab.cell,
    shelters: m.shelters.map((x) => ({ id: x.id, kind: x.kind, cell: s.shelterCells[x.id] ?? x.cell })),
    sol: m.scenario.sol,
    startLtstMin: s.startLtstMin,
    stations: [...m.stations, ...(s.customStops ?? [])]
      .filter((x) => s.stationOn[x.id])
      .slice(0, 15)
      .map((x) => ({ id: x.id, cell: x.cell, value: x.value + (s.mustVisit[x.id] ? MUST_VISIT_BONUS : 0), dwellMin: x.dwellMin, ...(x.taskW !== undefined ? { taskW: x.taskW } : {}) })),
    rules: s.rules,
    crew: DEFAULT_CREW,
    seed: 1,
  };
  if (s.events.length) req.events = s.events;
  // EVA base: a rover-staged EVA starts and ends at the pressurized rover (engine stageFromShelter
  // sets req.hab to the rover cell; comm LOS stays the union of the hab mast and rover relay masts).
  const base = s.evaBase ? m.shelters.find((x) => x.id === s.evaBase) : undefined;
  if (base && base.kind !== 'hab') req = stageFromShelter(req, base.id);
  return req;
}

/** Current EVA base (id, display name, cell). */
export function currentBase() {
  const s = get();
  return baseInfo(s.pack!, s.evaBase, s.shelterCells);
}

/** EVA base selector (Plan tab) and the "Stage from PR-1" action on a STAY_IN explanation. */
export function setEvaBase(id: string) {
  const s = get();
  const sh = shelterById(s.pack!, id);
  if (!sh || s.evaBase === id) return;
  set({ evaBase: id });
  log(`EVA base → ${sh.name}${sh.kind === 'rover' ? ' (rover-staged EVA)' : ''} — replanning`, 'info');
  scheduleReplan(`Replanned from ${shortName(sh)}`, 10);
}

/** Undo the must-visit bonus in everything the console displays (totals, leaderboard, value text). */
function realValues(r: PlanResult, req: PlanRequest): PlanResult {
  if (!req.stations.some((x) => x.value >= MUST_VISIT_BONUS)) return r;
  const st = get().pack!.manifest.stations;
  const val = (id: string) => st.find((x) => x.id === id)?.value ?? 0;
  const fix = (t: string) => t.replace(/(add|value) (\d+)( science value|\b)/g, (_m, a: string, n: string, b: string) => `${a} ${Number(n) % MUST_VISIT_BONUS}${b}`);
  return {
    ...r,
    totals: { ...r.totals, scienceValue: r.order.reduce((a, id) => a + val(id), 0) },
    leaderboard: r.leaderboard.map((l) => ({ ...l, value: val(l.id) })),
    binding: r.binding ? { ...r.binding, text: fix(r.binding.text) } : null,
    notes: r.notes.map(fix),
  };
}

function installBundle(bundle: PlanBundle, req: PlanRequest, why: string) {
  const s = get();
  const pack = s.pack!;
  bundle = { ...bundle, result: realValues(bundle.result, req) };
  const replaced = s.plan !== null;
  const plan = {
    plan: bundle.result,
    planReq: req,
    fields: bundle.fields,
    fieldsSource: bundle.fieldsSource,
    plannerLabel: bundle.plannerLabel,
    planStatus: 'ready' as const,
    planError: null,
    planVersion: s.planVersion + 1,
    dirty: false,
    confirm: s.confirm.stage === 'awaitingAck' ? s.confirm : s.uiMode === 'send' && !s.sheet ? { stage: 'review' as const } : { stage: 'idle' as const },
  };
  const r = bundle.result;
  const base = baseInfo(pack, s.evaBase, s.shelterCells);
  const prevArea = s.zoneAreaKm2;
  const installZone = () => {
    const st = get();
    if (st.plan !== bundle.result) return; // a newer plan arrived meanwhile
    const zone = buildZone(pack, bundle.fields, st.hazards, req.hab);
    const limits = zoneLimits(st.rules, st.events);
    const area = maskAreaKm2(safeZoneMask(zone, limits), zone.cellM);
    set({ zone, limits, zoneAreaKm2: area, losSource: bundle.fieldsSource === 'estimate' ? 'estimate' : losGapSource(pack, bundle.fields) });
    map?.setZone(zone, limits, replaced);
    return area;
  };
  const report = (area: number | undefined) => {
    const delta = area !== undefined && prevArea !== null && Math.abs(area - prevArea) > 0.005 ? ` · safe region ${area > prevArea ? '+' : ''}${(area - prevArea).toFixed(2)} km²` : '';
    log(
      r.status === 'OK'
        ? `${why}: ${r.order.length ? `${r.order.length} stations from ${base.short}` : 'return route'}, ${(r.totals.distM / 1000).toFixed(2)} km, ${Math.round(r.totals.durationMin)} min · solved in ${Math.round(r.solveMs)} ms${delta}`
        : `${why}: STAY IN from ${base.short} — ${r.binding ? relabel(pack, base, r.binding.text) : (r.notes[r.notes.length - 1] ?? 'no safe plan')}`,
      r.status === 'OK' ? 'ok' : 'warning',
    );
  };
  if (!s.zone) {
    // First plan of the session: show the verdict at once; the safe-area model (the first comm-shadow
    // field takes a few hundred ms on the console) follows a frame later.
    set(plan);
    report(undefined);
    requestAnimationFrame(() => map?.fitRoute(0));
    setTimeout(installZone, 40);
    return;
  }
  set(plan);
  report(installZone());
}

export async function generatePlan(why = 'Plan generated') {
  if (!backend || !get().pack) return;
  const token = ++planToken;
  if (!Object.values(get().stationOn).some(Boolean)) {
    // Route builder: no destinations, no route.
    set({ plan: null, planReq: null, planStatus: 'idle', planError: null, dirty: false });
    return;
  }
  set({ planStatus: 'planning', planError: null });
  const req = buildRequest();
  try {
    const bundle = await backend.plan(req);
    if (token !== planToken) return;
    installBundle(bundle, req, why);
  } catch (err) {
    if (token !== planToken) return;
    const msg = err instanceof Error ? err.message : String(err);
    set({ planStatus: 'error', planError: msg });
    log(`Planning failed: ${msg}`, 'warning');
  }
}

/** Debounced replan after an input change (rover drag, toggles). */
export function scheduleReplan(why: string, ms = 120) {
  set({ dirty: true });
  if (replanTimer) clearTimeout(replanTimer);
  replanTimer = setTimeout(() => void generatePlan(why), ms);
}

export function moveShelter(id: string, cell: Cell) {
  const s = get();
  const g = s.pack!.manifest.grid;
  set({ shelterCells: { ...s.shelterCells, [id]: cell } });
  const [x, y] = cellToXY(g, cell);
  const sh = s.pack!.manifest.shelters.find((x2) => x2.id === id);
  const name = sh?.name ?? id;
  // Dragging the rover means "stage the EVA from here": the rover becomes the EVA base.
  if (sh?.kind === 'rover' && s.evaBase !== id) set({ evaBase: id });
  log(`${name} moved to ${(x - g.originX).toFixed(0)} m E, ${(g.originY - y).toFixed(0)} m S of AOI corner — replanning from ${sh ? shortName(sh) : id}`, 'info');
  scheduleReplan('Replanned after rover move', 10);
}

/** Stops checklist: include / leave out a station. Re-plans at once. */
export function toggleStation(id: string) {
  const on0 = !get().stationOn[id];
  if (on0) addDestination(id);
  else removeDestination(id);
}

// ───────────────────────────── Route builder ─────────────────────────────

function applyDestinations(ids: string[], why: string) {
  const s = get();
  const stationOn: Record<string, boolean> = {};
  ids.forEach((id) => (stationOn[id] = true));
  set({ destinations: ids, stationOn, mustVisit: Object.fromEntries(Object.entries(s.mustVisit).filter(([k, v]) => v && stationOn[k])), mapPopover: null });
  if (!ids.length) {
    planToken++;
    if (replanTimer) clearTimeout(replanTimer);
    set({ plan: null, planReq: null, planStatus: 'idle', planError: null, dirty: false });
    return;
  }
  set({ planStatus: 'planning' });
  scheduleReplan(why, 60);
}

export function addDestination(id: string) {
  const s = get();
  if (s.destinations.includes(id) || s.destinations.length >= 15) return;
  applyDestinations([...s.destinations, id], `Replanned: ${id} added`);
}

export function removeDestination(id: string) {
  const s = get();
  applyDestinations(s.destinations.filter((x) => x !== id), `Replanned: ${id} removed`);
}

export function clearDestinations() {
  applyDestinations([], 'Cleared');
}

/** Click on empty terrain → "Add custom stop here": a new stop WPn (value 50, 10 min) at that cell. */
export function addCustomStop(cell: Cell) {
  const s = get();
  const g = s.pack!.manifest.grid;
  let n = 1;
  while (s.customStops.some((c) => c.id === `WP${n}`)) n++;
  const [x, y] = cellToXY(g, cell);
  const st: Station = { id: `WP${n}`, name: `Custom stop WP${n}`, x, y, cell, value: 50, objectiveIds: [], dwellMin: 10, description: 'A stop you placed on the map.' };
  set({ customStops: [...s.customStops, st] });
  addDestination(st.id);
}

/** "Suggest best stops": the planner picks its best subset and order from all targets. */
export async function suggestStops() {
  const s = get();
  if (!backend || !s.pack) return;
  const m = s.pack.manifest;
  const all: Record<string, boolean> = {};
  m.stations.forEach((x) => (all[x.id] = true));
  const token = ++planToken;
  set({ planStatus: 'planning', mapPopover: null });
  try {
    const req = requestFor(m, { ...s, stationOn: all, mustVisit: {}, customStops: [] });
    const bundle = await backend.plan(req);
    if (token !== planToken) return;
    const order = bundle.result.order;
    if (!order.length) {
      set({ planStatus: 'idle' });
      installBundle(bundle, req, 'Suggested stops');
      return;
    }
    const stationOn: Record<string, boolean> = {};
    order.forEach((id) => (stationOn[id] = true));
    set({ destinations: order, stationOn, customStops: [] });
    // Re-plan for exactly the chosen list (keeps the request and the crew route in step).
    void generatePlan('Suggested best stops');
  } catch (err) {
    if (token !== planToken) return;
    set({ planStatus: 'error', planError: err instanceof Error ? err.message : String(err) });
  }
}

/** "Must visit" pin (implies included). Re-plans at once. */
export function toggleMustVisit(id: string) {
  const s = get();
  const pin = !s.mustVisit[id];
  set({ mustVisit: { ...s.mustVisit, [id]: pin }, stationOn: pin ? { ...s.stationOn, [id]: true } : s.stationOn });
  scheduleReplan(`Replanned: ${id} ${pin ? 'pinned as must visit' : 'unpinned'}`, 60);
}

export function setAllStations(on: boolean) {
  const s = get();
  const next: Record<string, boolean> = {};
  s.pack!.manifest.stations.forEach((x) => (next[x.id] = on));
  set({ stationOn: next, ...(on ? {} : { mustVisit: {} }) });
  scheduleReplan(on ? 'Replanned with every station' : 'Replanned with no stations', 60);
}

export function updateRule(id: RuleId, patch: Partial<Rule>) {
  set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  scheduleReplan(`Replanned: rule ${id} changed`, 450);
}

export function setStartLtst(min: number) {
  set({ startLtstMin: min });
  scheduleReplan(`Replanned for a ${fmtStart(min)} start`, 350);
}

const fmtStart = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

// ───────────────────────────── Display ─────────────────────────────

export function applyPreset(p: PresetId) {
  const pr = PRESETS[p];
  set((s) => ({ preset: p, overlays: [...pr.overlays], vectors: { ...s.vectors, ...pr.vectors } }));
}

export function toggleOverlay(id: OverlayId) {
  set((s) => {
    const on = s.overlays.includes(id);
    let overlays = on ? s.overlays.filter((x) => x !== id) : [...s.overlays, id];
    if (overlays.length > OVERLAY_LIMIT) overlays = overlays.slice(overlays.length - OVERLAY_LIMIT);
    return { overlays };
  });
}

export function setOpacity(id: OverlayId, v: number) {
  set((s) => ({ opacity: { ...s.opacity, [id]: v } }));
}

export function toggleVector(id: VectorId) {
  set((s) => ({ vectors: { ...s.vectors, [id]: !s.vectors[id] } }));
}

// ───────────────────────────── Modes, drawer, sheets ─────────────────────────────

/** Can this plan be sent to the crew? OK plans, or (crew outside) the engine's direct return route. */
export function isSendable(p: PlanResult | null, req: PlanRequest | null = get().planReq): boolean {
  if (!p) return false;
  return p.status === 'OK' || (!!req?.resume && p.segments.length > 0);
}

/** Top stepper. Send needs a sendable plan; EVA live needs a route already sent. */
export function setMode(m: UiMode) {
  const s = get();
  if (m === 'send' && !isSendable(s.plan)) return;
  if (m === 'live' && !s.route) return;
  set({ uiMode: m, layersOpen: false, simOpen: false, ...(m === 'send' ? { confirm: s.confirm.stage === 'review' || !s.route || s.plan?.reqHash !== s.route.reqHash ? { stage: 'review' } : s.confirm } : {}) });
  if (m === 'live') requestAnimationFrame(() => map?.fitRoute());
}

export function openDetails(tab?: DetailsTab) {
  set((s) => ({ details: { open: true, tab: tab ?? s.details.tab }, layersOpen: false, simOpen: false }));
}

export function closeDetails() {
  set((s) => ({ details: { ...s.details, open: false } }));
}

export function ackAlert(id: number) {
  set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, acked: true } : a)) }));
}

export function ackAllAlerts() {
  set((s) => ({ alerts: s.alerts.map((a) => ({ ...a, acked: true })) }));
}

/**
 * EVA live action dock: open a guided response. Each sheet asks the engine for the recommended new
 * plan (existing event/replan logic) and shows it as a change; Send to crew is the only button.
 */
/** What the crew has now (the sent route's plan), for showing a response as a change. */
function beforeOf(s: ReturnType<typeof get>) {
  const p = s.sentPlan ?? s.plan;
  return p ? { order: [...p.order], durationMin: p.totals.durationMin, endT: p.segments[p.segments.length - 1]?.t1Min ?? 0 } : undefined;
}

export function openSheet(kind: ActionKind) {
  const s = get();
  if (s.busyEvent) return;
  const before = beforeOf(s);
  set({ sheet: { kind, before }, layersOpen: false, simOpen: false, confirm: { stage: 'idle' } });
  if (kind === 'sep') {
    const shelterMax = s.rules.find((r) => r.id === 'shelter_time_max_min')?.value ?? 30;
    void fireEvent({ type: 'SEP_NOWCAST', leadMin: shelterMax }, 'Radiation spike on board (dose rate +25 %)');
  } else if (kind === 'recall') {
    void recallCrew();
  } else if (kind === 'hazard') {
    const req = s.requests.find((r) => !r.handled && r.kind === 'HAZARD' && r.cell !== undefined);
    if (!req) set({ hazardPick: true });
  }
}

export function closeSheet() {
  if (get().hazardPick) set({ hazardPick: false });
  set({ sheet: null });
}

/**
 * Shorten EVA by `min` (the officer picks the amount in the sheet). The hab server replans from its
 * latest request, so cuts accumulate there: one amount per sheet, never re-picked.
 */
export async function shortenEva(min: number) {
  const s = get();
  if (s.sheet?.kind !== 'cut' || s.sheet.cutMin !== undefined) return;
  set((st) => ({ sheet: st.sheet ? { ...st.sheet, cutMin: min } : st.sheet }));
  await fireEvent({ type: 'EVA_CUT', min }, `Shorten EVA by ${min} min`);
}

/**
 * Recall crew: the engine's direct return to the EVA base from the crew's last position (a plan
 * request with no stations left to visit, resumed from the last TELEM).
 */
export async function recallCrew() {
  const s = get();
  if (!backend || !s.pack) return;
  set({ busyEvent: 'RECALL' });
  log('Recall crew → direct return to the EVA base from the current position', 'caution');
  const t0 = performance.now();
  const req = buildRequest();
  req.stations = [];
  const last = s.telem[s.telem.length - 1];
  if (last) req.resume = { elapsedMin: last.t, cell: last.cell, visited: s.plan?.stops.filter((st) => st.departMin <= last.t).map((st) => st.id) ?? [], o2UsedPct: 100 - last.o2Pct };
  try {
    const bundle = await backend.plan(req);
    installBundle(bundle, req, `Recall: return route in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    log(`Recall failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  } finally {
    set({ busyEvent: null });
  }
}

/** Enter: the primary action of the current mode. */
export function primaryAction() {
  const s = get();
  if (s.sheet) {
    if (isSendable(s.plan) && !s.busyEvent && s.planStatus === 'ready' && (s.confirm.stage === 'idle' || s.confirm.stage === 'error')) void confirmPush();
    return;
  }
  if (s.uiMode === 'plan') {
    if (s.plan?.status === 'STAY_IN' && s.planStatus === 'ready') {
      const base = shelterById(s.pack!, s.evaBase);
      const rover = s.pack!.manifest.shelters.find((x) => x.kind === 'rover' && x.id !== base?.id);
      if (rover) setEvaBase(rover.id);
      return;
    }
    if (isSendable(s.plan) && s.planStatus === 'ready') setMode('send');
    return;
  }
  if (s.uiMode === 'send') {
    if (s.confirm.stage === 'review' || s.confirm.stage === 'idle' || s.confirm.stage === 'error') void confirmPush();
    else if (s.confirm.stage === 'acked') setMode('live');
  }
}

// ───────────────────────────── Safe-zone explainer ─────────────────────────────

export async function explainSafeZone() {
  const s = get();
  if (!map || !s.zone || !s.limits) return;
  if (s.explain.running) {
    map.cancelExplain();
    set({ explain: { ...s.explain, running: false, step: 0 } });
    return;
  }
  const steps = explainSteps(s.zone, s.limits);
  // Say which line-of-sight model the comm-gap step uses (engine field from the hab server, not an estimate).
  const masts = s.pack!.manifest.shelters.filter((x) => x.kind === 'hab' || x.kind === 'rover').map((x) => shortName(x)).join(' mast ∪ ');
  const losStep = steps.find((x) => x.key === 'limLos');
  if (losStep) {
    losStep.detail = s.losSource === 'engine'
      ? `Engine comm line of sight (${masts} relay, hab server field); time spent in comm shadow timed on the terrain. FOD constraint, NTRS 20250006063.`
      : `Comm line of sight (${masts} relay) — straight-line gap estimate while the engine field is unavailable. FOD constraint, NTRS 20250006063.`;
  }
  set({ explain: { running: true, step: 0, caption: 'Whole site', detail: 'Every cell before any flight rule is applied.', areaFrom: steps[0].areaBefore, areaTo: steps[0].areaBefore } });
  const ok = await map.explain(steps, (i) => {
    if (i <= steps.length) {
      const st = steps[i - 1];
      set({ explain: { running: true, step: i, caption: st.caption, detail: st.detail, areaFrom: st.areaBefore, areaTo: st.areaAfter } });
    } else {
      const last = steps[steps.length - 1];
      const st = get();
      const r = st.plan;
      const base = baseInfo(st.pack!, st.evaBase, st.shelterCells);
      set({
        explain: {
          running: true, step: 7,
          caption: r?.status === 'OK' ? `Route from ${base.short}: ${r.order.length} stations inside` : `No safe route from ${base.short} — stay in`,
          detail: r?.binding ? relabel(st.pack!, base, r.binding.text) : 'The planner only uses ground inside the safe region.',
          areaFrom: last.areaAfter, areaTo: last.areaAfter,
        },
      });
    }
  });
  if (ok) {
    setTimeout(() => {
      if (get().explain.step === 7) set((st) => ({ explain: { ...st.explain, running: false, step: 0 } }));
    }, 2600);
  }
}

// ───────────────────────────── Confirm / push ─────────────────────────────

export function review() {
  const s = get();
  if (!isSendable(s.plan)) return;
  set({ confirm: { stage: 'review' } });
}

export function cancelReview() {
  set({ confirm: { stage: 'idle' } });
}

export async function confirmPush() {
  const s = get();
  if (!backend || !s.plan || !s.fields || !s.planReq || !isSendable(s.plan)) return;
  const seq = (s.route?.seq ?? 0) + 1;
  set({ confirm: { stage: 'pushing', seq } });
  try {
    const r = await backend.confirm({ result: s.plan, fields: s.fields, fieldsSource: s.fieldsSource ?? 'estimate', plannerLabel: s.plannerLabel }, s.planReq, seq);
    set({
      confirm: { stage: 'awaitingAck', seq: r.seq, id: r.id, bytes: r.bytes, estimated: r.estimated },
      route: { seq: r.seq, id: r.id, acked: false, bytes: r.bytes, estimated: r.estimated, reqHash: s.plan.reqHash },
      sentPlan: s.plan,
    });
    log(`ROUTE_PUSH v${r.seq} sent · ${r.estimated ? '≈' : ''}${(r.bytes / 1000).toFixed(1)} KB`, 'info');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set({ confirm: { stage: 'error', error: msg } });
    log(`Push failed: ${msg}`, 'warning');
  }
}

// ───────────────────────────── Live: link, events, sim ─────────────────────────────

function setLinkStatus(st: 'up' | 'degraded' | 'down') {
  const prev = get().link;
  if (prev === st) return;
  set({ link: st });
  // Only an EVA in progress (a route sent) makes a link change an alert; before that it is just status.
  if (get().route) {
    if (st === 'down') pushAlert({ level: 'warning', title: 'Crew link lost', text: 'The visor keeps guiding the crew on board, on the last route they accepted. Telemetry back-fills when the link returns.' });
    else if (prev === 'down') pushAlert({ level: 'info', title: 'Crew link restored', text: 'Telemetry is back-filling from the visor.' });
  }
  log(
    st === 'down' ? 'Visor link DOWN — visor continues autonomously' : st === 'degraded' ? 'Visor link DEGRADED' : 'Visor link restored',
    st === 'down' ? 'warning' : st === 'degraded' ? 'caution' : 'ok',
    'system',
  );
}

export function handleLinkMsg(m: LinkMsg) {
  const s = get();
  switch (m.type) {
    case 'ACK': {
      if (s.route && m.id === s.route.id) {
        set({ route: { ...s.route, acked: m.accepted }, confirm: { ...s.confirm, stage: m.accepted ? 'acked' : 'rejected', ackUtcMs: Date.now() } });
        if (!m.accepted) pushAlert({ level: 'warning', title: `Crew rejected route v${m.seq}`, text: 'Talk to the crew, adjust the plan and send it again.' });
        else if (get().uiMode === 'send' || get().sheet) {
          // "✓ Accepted by EV1" → straight into EVA live.
          setTimeout(() => {
            const st = get();
            if (st.route?.id === m.id && st.route.acked) {
              if (st.uiMode === 'send') setMode('live');
              if (st.sheet) set({ sheet: null });
            }
          }, 1400);
        }
      }
      log(`ACK v${m.seq} ${m.accepted ? 'accepted by EV1' : 'REJECTED by EV1'}`, m.accepted ? 'ok' : 'warning', 'visor');
      break;
    }
    case 'TELEM': {
      const last = s.telem[s.telem.length - 1];
      if (last && m.telem.t <= last.t) {
        if (m.telem.t < last.t - 1) set({ telem: [m.telem] }); // sim reset
        break;
      }
      set({ telem: [...s.telem, m.telem].slice(-2000) });
      break;
    }
    case 'REQUEST': {
      const rid = Date.now();
      set({ requests: [{ ...m, id: rid, handled: false, utcMs: Date.now() }, ...s.requests].slice(0, 30) });
      pushAlert({
        level: m.kind === 'ABORT' ? 'warning' : 'caution',
        title: m.kind === 'HAZARD' ? 'EV1 reports a hazard' : m.kind === 'ABORT' ? 'EV1 requests abort' : `EV1 request: ${m.kind.replace('_', ' ').toLowerCase()}`,
        text: m.note,
        tMin: m.t,
        requestId: rid,
      });
      log(`REQUEST ${m.kind}${m.note ? ` — ${m.note}` : ''}`, m.kind === 'ABORT' ? 'warning' : 'caution', 'visor', m.t);
      break;
    }
    case 'ALERT':
      // ALERT.from: the hab's own alerts are echoed to the console; the rest come from the visor.
      log(`${m.code}: ${m.text}`, m.level === 'warning' ? 'warning' : m.level === 'caution' ? 'caution' : 'info', m.from === 'hab' ? 'hab' : 'visor', m.t);
      if (m.level !== 'info') pushAlert({ level: m.level === 'warning' ? 'warning' : 'caution', title: m.from === 'hab' ? `Sent to crew: ${alertTitle(m.code)}` : `Visor: ${alertTitle(m.code)}`, text: m.text, tMin: m.t });
      break;
    case 'ROUTE_PUSH':
    case 'HEARTBEAT':
      break;
  }
}

/** Plain title for an ALERT code ("SEP_NOWCAST" → "radiation spike — return to shelter"). */
function alertTitle(code: string): string {
  const k: Record<string, string> = { SEP_NOWCAST: 'radiation spike — return to shelter', RETURN_NOW: 'return now', BINGO: 'leave-by time reached', OFF_ROUTE: 'crew off route', LOW_O2: 'oxygen low', HEAT: 'suit heat high' };
  return k[code] ?? code.replace(/_/g, ' ').toLowerCase();
}

async function pollServer() {
  if (!backend) return;
  const st = await backend.pollState();
  if (!st) return;
  setLinkStatus(st.visorLink);
  const s = get();
  if (st.route && s.route && st.route.id === s.route.id && st.routeAcked && !s.route.acked) {
    handleLinkMsg({ type: 'ACK', id: st.route.id, seq: st.route.seq, accepted: true });
  }
  if (st.lastTelem) handleLinkMsg({ type: 'TELEM', telem: st.lastTelem });
  if (st.earth && Number.isFinite(st.earth.oneWayLightMin)) {
    const e = st.earth;
    const prev = get().earth;
    if (!prev || Math.abs(prev.oneWayLightMin - e.oneWayLightMin) > 0.005) {
      set({ earth: { oneWayLightMin: e.oneWayLightMin, distanceAu: e.distanceAu, computedUtc: e.computedUtc, method: e.method, source: e.source } });
    }
  }
}

function toPlanEvent(e: ConsoleEvent): PlanEvent {
  return e.type === 'EVA_CUT' ? { t: 'EVA_CUT', min: e.min } : e.type === 'SEP_NOWCAST' ? { t: 'SEP_NOWCAST', leadMin: e.leadMin } : { t: 'HAZARD', cells: e.cells };
}

export async function fireEvent(e: ConsoleEvent, label: string) {
  set({ confirm: { stage: 'idle' } });
  if (!backend || !get().pack) return;
  set((s) => ({
    busyEvent: e.type,
    events: [...s.events, toPlanEvent(e)],
    hazards: e.type === 'HAZARD' ? [...s.hazards, ...e.cells] : s.hazards,
  }));
  if (e.type === 'HAZARD') map?.setHazards(get().hazards);
  log(`${label} → replanning from current position`, e.type === 'SEP_NOWCAST' ? 'warning' : 'caution');
  const t0 = performance.now();
  const req = buildRequest();
  const last = get().telem[get().telem.length - 1];
  if (last) req.resume = { elapsedMin: last.t, cell: last.cell, visited: get().plan?.stops.filter((st) => st.departMin <= last.t).map((st) => st.id) ?? [], o2UsedPct: 100 - last.o2Pct };
  try {
    const bundle = await backend.event(e, req);
    installBundle(bundle, req, `Replan (${label}) in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    log(`Replan failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  } finally {
    set({ busyEvent: null });
  }
}

export function clearEvents() {
  set({ events: [], hazards: [] });
  map?.setHazards([]);
  scheduleReplan('Events cleared');
}

export function startHazardPick() {
  set((s) => ({ hazardPick: !s.hazardPick }));
}

export function handleMapClick(cell: Cell, stationId: string | null, extra?: { shelterId: string | null; pixel: [number, number] }) {
  const s = get();
  if (s.uiMode === 'plan' && !s.hazardPick && extra) {
    if (stationId) return set({ mapPopover: { kind: 'station', id: stationId, cell, px: extra.pixel }, selectedStation: stationId });
    if (extra.shelterId) {
      const sh = shelterById(s.pack!, extra.shelterId);
      if (sh && (sh.kind === 'hab' || sh.kind === 'rover')) setEvaBase(sh.id);
      return set({ mapPopover: null });
    }
    return set({ mapPopover: s.mapPopover ? null : { kind: 'terrain', cell, px: extra.pixel } });
  }
  if (s.hazardPick) {
    const g = s.pack!.manifest.grid;
    const [x, y] = cellToXY(g, cell);
    const cells: Cell[] = [];
    const R = 20; // metres: blocked disc around the reported hazard
    for (let dy = -R; dy <= R; dy += g.cellM) {
      for (let dx = -R; dx <= R; dx += g.cellM) {
        if (dx * dx + dy * dy > R * R) continue;
        const c = xyToCell(g, x + dx, y + dy);
        if (c >= 0) cells.push(c);
      }
    }
    set({ hazardPick: false });
    if (!s.sheet) set({ sheet: { kind: 'hazard', before: beforeOf(s) } });
    void fireEvent({ type: 'HAZARD', cells }, 'Hazard reported');
    return;
  }
  if (stationId) set({ selectedStation: stationId });
}

export function resolveRequest(id: number, action: 'hazard' | 'dismiss') {
  const s = get();
  const req = s.requests.find((r) => r.id === id);
  set({ requests: s.requests.map((r) => (r.id === id ? { ...r, handled: true } : r)), alerts: s.alerts.map((a) => (a.requestId === id ? { ...a, acked: true } : a)), hazardPick: false });
  if (action === 'hazard' && req?.cell !== undefined && !s.sheet) {
    set({ sheet: { kind: 'hazard', before: beforeOf(s) } });
  }
  if (!req || action === 'dismiss') return;
  if (req.cell !== undefined) {
    const g = s.pack!.manifest.grid;
    const [x, y] = cellToXY(g, req.cell);
    const cells: Cell[] = [];
    for (let dy = -25; dy <= 25; dy += g.cellM) for (let dx = -25; dx <= 25; dx += g.cellM) if (dx * dx + dy * dy <= 625) {
      const c = xyToCell(g, x + dx, y + dy);
      if (c >= 0) cells.push(c);
    }
    void fireEvent({ type: 'HAZARD', cells }, `EV1 hazard at ${req.note ? 'reported spot' : 'cell'}`);
  }
}

export async function setSim(p: Partial<{ running: boolean; speed: number; reset: boolean }>) {
  const s = get();
  const next = { running: p.running ?? s.sim.running, speed: p.speed ?? s.sim.speed };
  set({ sim: next, ...(p.reset ? { telem: [] } : {}) });
  try {
    await backend?.sim({ ...next, ...(p.reset ? { reset: true } : {}) });
    if (p.running !== undefined) log(p.running ? `Astronaut simulator running at ${next.speed}×` : 'Astronaut simulator paused', 'info', 'system');
  } catch (err) {
    log(`Sim control failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  }
}

export async function setLinkCtl(p: Partial<LinkCtl>) {
  const ctl = { ...get().linkCtl, ...p };
  set({ linkCtl: ctl });
  try {
    await backend?.link(ctl);
  } catch (err) {
    log(`Link control failed: ${err instanceof Error ? err.message : String(err)}`, 'warning');
  }
}
