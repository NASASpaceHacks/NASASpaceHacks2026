import type { Cell, LinkMsg, PlanEvent, PlanRequest, Rule, RuleId } from '@mw/shared/contracts';
import { DEFAULT_CREW, cellToXY, xyToCell } from '@mw/shared/contracts';
import { stageFromShelter } from '@mw/shared/engine';
import { maskAreaKm2, safeZoneMask } from '@mw/shared/map';
import { detectBackend, type Backend } from './api';
import { marsTime } from './lib/marsclock';
import { baseInfo, defaultBase, relabel, shelterById, shortName } from './lib/base';
import { engineConst } from './lib/engine';
import type { ConsoleEvent, LinkCtl, OverlayId, PlanBundle, PresetId, TabId, VectorId } from './lib/types';
import { buildZone, explainSteps, losGapSource, zoneLimits } from './lib/zone';
import type { MapController } from './map/MapController';
import { OVERLAY_LIMIT, PRESETS, get, log, set } from './store';

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
    const pack = await b.loadPack(step);
    const m = pack.manifest;
    const stationOn: Record<string, boolean> = {};
    m.stations.forEach((s) => (stationOn[s.id] = true));
    const shelterCells: Record<string, Cell> = {};
    m.shelters.forEach((s) => (shelterCells[s.id] = s.cell));
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
    void generatePlan();
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
  const s = get();
  const m = s.pack!.manifest;
  const hab = m.shelters.find((x) => x.kind === 'hab')!;
  let req: PlanRequest = {
    siteId: m.id,
    hab: s.shelterCells[hab.id] ?? hab.cell,
    shelters: m.shelters.map((x) => ({ id: x.id, kind: x.kind, cell: s.shelterCells[x.id] ?? x.cell })),
    sol: m.scenario.sol,
    startLtstMin: s.startLtstMin,
    stations: m.stations
      .filter((x) => s.stationOn[x.id])
      .slice(0, 15)
      .map((x) => ({ id: x.id, cell: x.cell, value: x.value, dwellMin: x.dwellMin, ...(x.taskW !== undefined ? { taskW: x.taskW } : {}) })),
    rules: s.rules,
    crew: DEFAULT_CREW,
    seed: 1,
  };
  if (s.events.length) req.events = s.events;
  // EVA base: a rover-staged EVA starts and ends at the pressurized rover (engine stageFromShelter
  // sets req.hab to the rover cell; comm LOS stays the union of the hab mast and rover relay masts).
  const base = shelterById(s.pack!, s.evaBase);
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

function installBundle(bundle: PlanBundle, req: PlanRequest, why: string) {
  const s = get();
  const pack = s.pack!;
  const zone = buildZone(pack, bundle.fields, s.hazards, req.hab);
  const limits = zoneLimits(s.rules, s.events);
  const area = maskAreaKm2(safeZoneMask(zone, limits), zone.cellM);
  const prevArea = s.zoneAreaKm2;
  const replaced = s.plan !== null;
  set({
    plan: bundle.result,
    planReq: req,
    fields: bundle.fields,
    fieldsSource: bundle.fieldsSource,
    plannerLabel: bundle.plannerLabel,
    zone,
    limits,
    zoneAreaKm2: area,
    losSource: bundle.fieldsSource === 'estimate' ? 'estimate' : losGapSource(pack, bundle.fields),
    planStatus: 'ready',
    planError: null,
    planVersion: s.planVersion + 1,
    dirty: false,
    confirm: s.confirm.stage === 'awaitingAck' ? s.confirm : { stage: 'idle' },
  });
  map?.setZone(zone, limits, replaced);
  const r = bundle.result;
  const base = baseInfo(pack, s.evaBase, s.shelterCells);
  const delta = prevArea !== null && Math.abs(area - prevArea) > 0.005 ? ` · safe region ${area > prevArea ? '+' : ''}${(area - prevArea).toFixed(2)} km²` : '';
  log(
    r.status === 'OK'
      ? `${why}: ${r.order.length ? `${r.order.length} stations from ${base.short}` : 'return route'}, ${(r.totals.distM / 1000).toFixed(2)} km, ${Math.round(r.totals.durationMin)} min · solved in ${Math.round(r.solveMs)} ms${delta}`
      : `${why}: STAY IN from ${base.short} — ${r.binding ? relabel(pack, base, r.binding.text) : (r.notes[r.notes.length - 1] ?? 'no safe plan')}`,
    r.status === 'OK' ? 'ok' : 'warning',
  );
}

export async function generatePlan(why = 'Plan generated') {
  if (!backend || !get().pack) return;
  const token = ++planToken;
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

export function toggleStation(id: string) {
  const s = get();
  set({ stationOn: { ...s.stationOn, [id]: !s.stationOn[id] }, dirty: true });
}

export function setAllStations(on: boolean) {
  const s = get();
  const next: Record<string, boolean> = {};
  s.pack!.manifest.stations.forEach((x) => (next[x.id] = on));
  set({ stationOn: next, dirty: true });
}

export function updateRule(id: RuleId, patch: Partial<Rule>) {
  set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)), dirty: true }));
}

export function setStartLtst(min: number) {
  set({ startLtstMin: min, dirty: true });
}

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

export function setTab(t: TabId) {
  set({ tab: t });
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
  if (!s.plan || s.plan.status !== 'OK') return;
  set({ confirm: { stage: 'review' } });
}

export function cancelReview() {
  set({ confirm: { stage: 'idle' } });
}

export async function confirmPush() {
  const s = get();
  if (!backend || !s.plan || !s.fields || !s.planReq) return;
  const seq = (s.route?.seq ?? 0) + 1;
  set({ confirm: { stage: 'pushing', seq } });
  try {
    const r = await backend.confirm({ result: s.plan, fields: s.fields, fieldsSource: s.fieldsSource ?? 'estimate', plannerLabel: s.plannerLabel }, s.planReq, seq);
    set({
      confirm: { stage: 'awaitingAck', seq: r.seq, id: r.id, bytes: r.bytes, estimated: r.estimated },
      route: { seq: r.seq, id: r.id, acked: false, bytes: r.bytes, estimated: r.estimated, reqHash: s.plan.reqHash },
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
        set({ route: { ...s.route, acked: m.accepted }, confirm: { ...s.confirm, stage: m.accepted ? 'acked' : 'rejected' } });
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
      set({ requests: [{ ...m, id: Date.now(), handled: false, utcMs: Date.now() }, ...s.requests].slice(0, 30), tab: s.tab === 'live' ? s.tab : s.tab });
      log(`REQUEST ${m.kind}${m.note ? ` — ${m.note}` : ''}`, m.kind === 'ABORT' ? 'warning' : 'caution', 'visor', m.t);
      break;
    }
    case 'ALERT':
      log(`${m.code}: ${m.text}`, m.level === 'warning' ? 'warning' : m.level === 'caution' ? 'caution' : 'info', 'visor', m.t);
      break;
    case 'ROUTE_PUSH':
    case 'HEARTBEAT':
      break;
  }
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
}

function toPlanEvent(e: ConsoleEvent): PlanEvent {
  return e.type === 'EVA_CUT' ? { t: 'EVA_CUT', min: e.min } : e.type === 'SEP_NOWCAST' ? { t: 'SEP_NOWCAST', leadMin: e.leadMin } : { t: 'HAZARD', cells: e.cells };
}

export async function fireEvent(e: ConsoleEvent, label: string) {
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

export function handleMapClick(cell: Cell, stationId: string | null) {
  const s = get();
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
    void fireEvent({ type: 'HAZARD', cells }, 'Hazard reported');
    return;
  }
  if (stationId) set({ selectedStation: stationId, tab: 'plan' });
}

export function resolveRequest(id: number, action: 'hazard' | 'dismiss') {
  const s = get();
  const req = s.requests.find((r) => r.id === id);
  set({ requests: s.requests.map((r) => (r.id === id ? { ...r, handled: true } : r)) });
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
