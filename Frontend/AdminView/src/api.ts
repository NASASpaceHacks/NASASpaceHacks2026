import {
  type Cell,
  type FieldSet,
  type LinkMsg,
  type LoadedSitePack,
  type PlanRequest,
  type PlanResult,
  type RuleId,
  type SitePackManifest,
  cellToXY,
  goldenPlanResult,
  loadSitePack,
  mockFields,
  mockSitePack,
} from '@mw/shared/contracts';
import { engineFn, linkFn } from './lib/engine';
import { buildZone, zoneLimits } from './lib/zone';
import type { ConfirmResult, ConsoleEvent, LinkCtl, LinkHandlers, PlanBundle, ServerState, SimState } from './lib/types';
import { MockVisor } from './mock/visor';

/**
 * Data layer. `HttpBackend` talks to the hab server (Backend, via the Vite proxy: /api/*,
 * /sitepacks/*, WebSocket /link). `MockBackend` runs fully in the browser on the synthetic
 * `mockSitePack(412, 600)` + golden fixtures — or on the real engine when it is importable —
 * so the console always works, even before the Backend and engine land.
 */
export interface Backend {
  kind: 'live' | 'mock';
  /** Human-readable data source, shown in the top bar. */
  label: string;
  /** `onManifest` fires as soon as the manifest is read, before the rasters (used to start the first plan early). */
  loadPack(onStep?: (s: string) => void, onManifest?: (m: SitePackManifest) => void): Promise<LoadedSitePack>;
  /** Start solving a request now; a later identical `plan(req)` reuses the answer (first plan on load). */
  prefetchPlan?(req: PlanRequest): void;
  plan(req: PlanRequest): Promise<PlanBundle>;
  /** Solve a "what if" request (no fields fetched): used to test way-forward candidates. */
  tryPlan(req: PlanRequest): Promise<PlanResult>;
  /** Fire an operational event. `req` is the current request including accumulated events. */
  event(e: ConsoleEvent, req: PlanRequest): Promise<PlanBundle>;
  confirm(bundle: PlanBundle, req: PlanRequest, seq: number): Promise<ConfirmResult>;
  sim(s: SimState): Promise<void>;
  link(ctl: LinkCtl): Promise<void>;
  connect(h: LinkHandlers): () => void;
  pollState(): Promise<ServerState | null>;
}

const FIELD_NAMES = ['walkbackMin', 'shelterMin', 'outboundMin', 'los', 'blocked'] as const;

async function json<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(to);
  }
}

/** Shallow pack clone reflecting the request's station subset and shelter positions. */
export function packForRequest(base: LoadedSitePack, req: PlanRequest): LoadedSitePack {
  const g = base.manifest.grid;
  const ids = new Set(req.stations.map((s) => s.id));
  return {
    ...base,
    manifest: {
      ...base.manifest,
      stations: base.manifest.stations.filter((s) => ids.has(s.id)),
      shelters: base.manifest.shelters.map((s) => {
        const r = req.shelters.find((x) => x.id === s.id);
        if (!r || r.cell === s.cell) return s;
        const [x, y] = cellToXY(g, r.cell);
        return { ...s, cell: r.cell, x, y };
      }),
    },
  };
}

/** Local field computation: engine if present, otherwise the distance-based fixture. */
function localFields(base: LoadedSitePack, req: PlanRequest, useEngine = true): { fields: FieldSet; source: 'engine' | 'estimate' } {
  const compute = useEngine ? engineFn('computeFields') : undefined;
  if (compute) {
    try {
      return { fields: compute(packForRequest(base, req), req), source: 'engine' };
    } catch (err) {
      console.warn('[console] engine.computeFields failed, using estimate', err);
    }
  }
  return { fields: mockFields(packForRequest(base, req)), source: 'estimate' };
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Route package size. Uses the engine codec when available (exact). Otherwise an honest
 * estimate: 3-bit chain-coded route + uint16 50 m safety grids + JSON stops, deflate-raw.
 */
async function packageBytes(base: LoadedSitePack, bundle: PlanBundle, req: PlanRequest, seq: number): Promise<{ bytes: number; estimated: boolean }> {
  const toPkg = engineFn('toPlanPackage');
  const encode = engineFn('encodePackage');
  if (toPkg && encode) {
    try {
      const pkg = toPkg(bundle.result, req, bundle.fields, base.manifest.grid, { seq, author: 'hab' });
      return { bytes: encode(pkg).byteLength, estimated: false };
    } catch (err) {
      console.warn('[console] engine codec failed, estimating size', err);
    }
  }
  const g = base.manifest.grid;
  const route = bundle.result.segments.flatMap((s) => s.cells);
  const chain = new Uint8Array(Math.ceil((route.length * 3) / 8) + 8);
  let bit = 0;
  for (let i = 1; i < route.length; i++) {
    const dr = Math.sign(Math.floor(route[i] / g.w) - Math.floor(route[i - 1] / g.w));
    const dc = Math.sign((route[i] % g.w) - (route[i - 1] % g.w));
    const code = [[-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1]].findIndex(([a, b]) => a === dr && b === dc);
    for (let k = 0; k < 3; k++, bit++) if ((code >> k) & 1) chain[bit >> 3] |= 1 << (bit & 7);
  }
  const k = Math.max(1, Math.round(50 / g.cellM));
  const cw = Math.ceil(g.w / k), ch = Math.ceil(g.h / k);
  const coarse = new Uint16Array(cw * ch * 2);
  for (let r = 0; r < ch; r++) {
    for (let c = 0; c < cw; c++) {
      const cell = Math.min(g.h - 1, r * k) * g.w + Math.min(g.w - 1, c * k);
      const wb = bundle.fields.walkbackMin[cell], sh = bundle.fields.shelterMin[cell];
      coarse[r * cw + c] = Number.isFinite(wb) ? Math.min(65534, Math.round(wb)) : 65535;
      coarse[cw * ch + r * cw + c] = Number.isFinite(sh) ? Math.min(65534, Math.round(sh)) : 65535;
    }
  }
  const head = new TextEncoder().encode(
    JSON.stringify({ v: 1, seq, siteId: req.siteId, stops: bundle.result.stops, order: bundle.result.order, bingo: bundle.result.bingo, start: route[0], sig: '0'.repeat(128) }),
  );
  const blob = new Blob([head, chain, new Uint8Array(coarse.buffer)]);
  try {
    const stream = blob.stream().pipeThrough(new CompressionStream('deflate-raw'));
    const out = await new Response(stream).arrayBuffer();
    return { bytes: out.byteLength, estimated: true };
  } catch {
    return { bytes: blob.size, estimated: true };
  }
}

/** Route package size before sending (engine codec on the console; the hab server signs and sends the real one). */
export function estimatePackageBytes(pack: LoadedSitePack, bundle: PlanBundle, req: PlanRequest, seq: number) {
  return packageBytes(pack, bundle, req, seq);
}

// ───────────────────────────── Live (hab server) ─────────────────────────────

export class HttpBackend implements Backend {
  kind = 'live' as const;
  label = 'Hab server';
  private pack: LoadedSitePack | null = null;
  constructor(private siteId: string) {}

  private prefetched: { key: string; result: Promise<PlanResult> } | null = null;

  async loadPack(onStep?: (s: string) => void, onManifest?: (m: SitePackManifest) => void): Promise<LoadedSitePack> {
    onStep?.(`Loading site pack ${this.siteId}`);
    try {
      // Hand the manifest out as soon as it arrives, so the first plan solves while the rasters load.
      const tap = async (url: string) => {
        const r = await fetch(url);
        if (onManifest && r.ok && url.endsWith('/manifest.json')) {
          void r.clone().json().then((m: SitePackManifest) => onManifest(m)).catch(() => {});
        }
        return r;
      };
      this.pack = await loadSitePack(`/sitepacks/${this.siteId}`, tap as unknown as Parameters<typeof loadSitePack>[1]);
    } catch (err) {
      // The hab server falls back to the in-memory mockSitePack() when the pack is missing.
      const m = /^mock-(\d+)$/.exec(this.siteId);
      if (!m) throw err;
      onStep?.('Hab server is on the synthetic pack — generating it locally');
      this.pack = mockSitePack(Number(m[1]), 600);
    }
    return this.pack;
  }

  private async fields(hash: string, req: PlanRequest): Promise<{ fields: FieldSet; source: PlanBundle['fieldsSource'] }> {
    const g = this.pack!.manifest.grid;
    const n = g.w * g.h;
    try {
      const bufs = await Promise.all(
        FIELD_NAMES.map(async (name) => {
          const r = await fetch(`/api/fields/${encodeURIComponent(hash)}/${name}`);
          if (!r.ok) throw new Error(`fields ${name} ${r.status}`);
          return r.arrayBuffer();
        }),
      );
      const [wb, sh, ob, los, blk] = bufs;
      const fields: FieldSet = {
        w: g.w,
        h: g.h,
        walkbackMin: new Float32Array(wb),
        shelterMin: new Float32Array(sh),
        outboundMin: new Float32Array(ob),
        los: new Uint8Array(los),
        blocked: new Uint8Array(blk),
      };
      if ([fields.walkbackMin, fields.shelterMin, fields.outboundMin, fields.los, fields.blocked].some((a) => a.length !== n)) {
        throw new Error('field size mismatch');
      }
      return { fields, source: 'server' };
    } catch (err) {
      console.warn('[console] server fields unavailable, computing locally', err);
      return localFields(this.pack!, req);
    }
  }

  private async bundle(result: PlanResult, req: PlanRequest): Promise<PlanBundle> {
    const { fields, source } = await this.fields(result.reqHash, req);
    return { result, fields, fieldsSource: source, plannerLabel: `${result.planner.pathSearch} · ${result.planner.costModel}` };
  }

  prefetchPlan(req: PlanRequest) {
    const body = JSON.stringify(req);
    const result = json<PlanResult>('/api/plan', { method: 'POST', body }, 20000);
    result.catch(() => {});
    this.prefetched = { key: body, result };
  }

  async plan(req: PlanRequest): Promise<PlanBundle> {
    const body = JSON.stringify(req);
    const pre = this.prefetched;
    this.prefetched = null;
    const result = pre && pre.key === body ? await pre.result : await json<PlanResult>('/api/plan', { method: 'POST', body }, 20000);
    return this.bundle(result, req);
  }

  async tryPlan(req: PlanRequest): Promise<PlanResult> {
    return json<PlanResult>('/api/plan', { method: 'POST', body: JSON.stringify(req) }, 20000);
  }

  async event(e: ConsoleEvent, req: PlanRequest): Promise<PlanBundle> {
    const result = await json<PlanResult>('/api/events', { method: 'POST', body: JSON.stringify(e) }, 20000);
    return this.bundle(result, req);
  }

  async confirm(bundle: PlanBundle): Promise<ConfirmResult> {
    return json<ConfirmResult>('/api/confirm', { method: 'POST', body: JSON.stringify({ reqHash: bundle.result.reqHash }) });
  }

  async sim(s: SimState): Promise<void> {
    await json('/api/sim', { method: 'POST', body: JSON.stringify(s) });
  }

  async link(ctl: LinkCtl): Promise<void> {
    await json('/api/link', { method: 'POST', body: JSON.stringify(ctl) });
  }

  async pollState(): Promise<ServerState | null> {
    try {
      return await json<ServerState>('/api/state', undefined, 4000);
    } catch {
      return null;
    }
  }

  connect(h: LinkHandlers): () => void {
    const connectWs = linkFn('connectWebSocketLink');
    if (!connectWs) return () => {}; // polling /api/state covers telemetry until the link lib lands
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const link = connectWs(`${proto}://${location.host}/link?role=console`, 'console');
      const offMsg = link.onMessage(h.onMsg);
      return () => {
        offMsg();
        link.close();
      };
    } catch (err) {
      console.warn('[console] surface link unavailable', err);
      return () => {};
    }
  }
}

// ───────────────────────────── Mock (in-browser) ─────────────────────────────

export class MockBackend implements Backend {
  kind = 'mock' as const;
  label = 'Synthetic site · in-browser';
  private pack: LoadedSitePack | null = null;
  private visor: MockVisor;
  private handlers: LinkHandlers | null = null;
  private seq = 0;
  /** `?engine=1`: run the real engine in the browser instead of the golden fixtures. */
  private useEngine = new URLSearchParams(location.search).get('engine') === '1';

  constructor() {
    this.visor = new MockVisor(
      (m: LinkMsg) => this.handlers?.onMsg(m),
      (s) => this.handlers?.onStatus(s),
    );
  }

  async loadPack(onStep?: (s: string) => void): Promise<LoadedSitePack> {
    onStep?.('Generating synthetic Gale-like terrain (mockSitePack 412)');
    await new Promise((r) => setTimeout(r, 30));
    this.pack = mockSitePack(412, 600);
    this.visor.setPack(this.pack);
    return this.pack;
  }

  async tryPlan(req: PlanRequest): Promise<PlanResult> {
    return (await this.plan(req)).result;
  }

  async plan(req: PlanRequest): Promise<PlanBundle> {
    await new Promise((r) => setTimeout(r, 16)); // let the UI paint its busy state
    const base = this.pack!;
    const run = this.useEngine ? engineFn('plan') : undefined;
    if (run) {
      try {
        const t0 = performance.now();
        const pack = packForRequest(base, req);
        const result = run(pack, req);
        const { fields, source } = localFields(base, req);
        return { result: { ...result, solveMs: result.solveMs || performance.now() - t0 }, fields, fieldsSource: source, plannerLabel: `${result.planner.pathSearch} · ${result.planner.costModel} (in-browser)` };
      } catch (err) {
        console.warn('[console] engine.plan failed, using golden fixture', err);
      }
    }
    return this.fixturePlan(req);
  }

  /**
   * Golden-fixture plan that still respects station toggles, rover position and events.
   * Candidates are screened against the safe-zone limits on the estimated fields first, so the
   * fixture only visits stations inside the safe region and every drop names the rule it fails.
   */
  private fixturePlan(req: PlanRequest): PlanBundle {
    const base = this.pack!;
    const fields = mockFields(packForRequest(base, req));
    const events = req.events ?? [];
    const hazards = events.flatMap((e) => (e.t === 'HAZARD' ? e.cells : []));
    const zone = buildZone(base, fields, hazards);
    const lim = zoneLimits(req.rules, events);
    const notes = ['Mock planner: golden fixture with straight-line legs at constant pace (engine not loaded); fields are distance estimates.'];
    const dropped: PlanResult['dropped'] = [];
    const feasible: string[] = [];
    for (const st of req.stations) {
      const c = st.cell;
      const fail: [boolean, RuleId, number, string][] = [
        [!!zone.keepout[c], 'plume_keepout_m', 0, 'inside a keep-out zone'],
        [zone.slope[c] > lim.slopeMax, 'slope_max_deg', 0, `slope ${zone.slope[c].toFixed(0)}° > ${lim.slopeMax}°`],
        [zone.distHab[c] > lim.radiusMax, 'walk_radius_max_m', 0, `${(zone.distHab[c] / 1000).toFixed(2)} km from hab`],
        [zone.walkbackTotal[c] > lim.walkbackMax, 'eva_duration_max_min', zone.walkbackTotal[c] - lim.walkbackMax, 'walkback exceeds EVA budget'],
        [zone.shelter[c] > lim.shelterMax, 'shelter_time_max_min', zone.shelter[c] - lim.shelterMax, `shelter ${Math.round(zone.shelter[c])} min > ${lim.shelterMax}`],
        [zone.losGap[c] > lim.losGapMax, 'los_gap_max_min', zone.losGap[c] - lim.losGapMax, `LOS gap ${Math.round(zone.losGap[c])} min`],
      ];
      const f = fail.find((x) => x[0]);
      if (f) dropped.push({ id: st.id, rule: f[1], deficitMin: Math.max(0, f[2]), text: `${st.id} dropped: ${f[3]}${f[2] > 0 ? `, −${Math.ceil(f[2])} min` : ''}` });
      else feasible.push(st.id);
    }
    if (!feasible.length) {
      const r = this.stayIn(req, 'No offered station lies inside the safe region.');
      return { result: { ...r, dropped: dropped.length ? dropped : r.dropped }, fields, fieldsSource: 'estimate', plannerLabel: 'golden fixture (mock)' };
    }
    let pack = packForRequest(base, { ...req, stations: req.stations.filter((s) => feasible.includes(s.id)) });
    let result = goldenPlanResult(pack);
    // The fixture visits the 4 nearest feasible stations; the rest were skipped for time.
    for (const id of feasible.filter((x) => !result.order.includes(x))) {
      dropped.push({ id, rule: 'eva_duration_max_min', deficitMin: 0, text: `${id} not selected: lower value per minute than the visited set` });
    }
    let binding: PlanResult['binding'] = null;
    const cut = events.reduce((a, e) => (e.t === 'EVA_CUT' ? a + e.min : a), 0);
    if (cut > 0 && result.order.length > 1) {
      const n = Math.max(1, result.order.length - Math.max(1, Math.round(cut / 30)));
      for (const id of result.order.slice(n)) dropped.push({ id, rule: 'eva_duration_max_min', deficitMin: cut, text: `${id} dropped: EVA cut ${cut} min` });
      const keep = result.order.slice(0, n);
      pack = { ...pack, manifest: { ...pack.manifest, stations: pack.manifest.stations.filter((s) => keep.includes(s.id)) } };
      result = goldenPlanResult(pack);
      binding = { rule: 'eva_duration_max_min', text: `Limited by EVA duration (cut ${cut} min)`, seg: Math.max(0, n - 1) };
    }
    if (events.some((e) => e.t === 'SEP_NOWCAST')) {
      binding = { rule: 'shelter_time_max_min', text: `SEP nowcast: every point within ${lim.shelterMax} min of shelter`, seg: 0 };
    }
    result = {
      ...result,
      reqHash: `mock-${fnv(JSON.stringify(req))}`,
      solveMs: 3,
      dropped,
      binding: binding ?? result.binding,
      notes: [...notes, ...(hazards.length ? ['Reported hazard cells are blocked in the safe region.'] : [])],
      stops: result.stops.map((st) => ({ ...st, arriveLtstMin: req.startLtstMin + st.arriveMin })),
      bingo: result.bingo.map((b) => ({ ...b, ltstMin: req.startLtstMin + b.tMin })),
    };
    return { result, fields, fieldsSource: 'estimate', plannerLabel: 'golden fixture (mock)' };
  }

  private stayIn(req: PlanRequest, why: string): PlanResult {
    return {
      status: 'STAY_IN', reqHash: `mock-${fnv(JSON.stringify(req))}`, solveMs: 1,
      planner: { pathSearch: 'golden-straight-line', costModel: 'constant-speed' },
      order: [], segments: [], stops: [], burndown: [], margins: {}, binding: null,
      dropped: req.stations.map((s) => ({ id: s.id, rule: 'shelter_time_max_min' as const, deficitMin: 0, text: `${s.id}: ${why}` })),
      leaderboard: [], bingo: [],
      totals: { distM: 0, durationMin: 0, energyKJ: 0, o2UsedPct: 0, doseUSv: 0, scienceValue: 0, maxDistHabM: 0 },
      notes: [why],
    };
  }

  async event(e: ConsoleEvent, req: PlanRequest): Promise<PlanBundle> {
    return this.plan(req); // req already carries the accumulated events
  }

  async confirm(bundle: PlanBundle, req: PlanRequest, seq: number): Promise<ConfirmResult> {
    this.seq = Math.max(this.seq + 1, seq);
    const { bytes, estimated } = await packageBytes(this.pack!, bundle, req, this.seq);
    const id = `pkg-${fnv(bundle.result.reqHash + this.seq)}`;
    this.visor.pushRoute(bundle.result, this.seq, id);
    return { id, seq: this.seq, bytes, estimated };
  }

  async sim(s: SimState): Promise<void> {
    this.visor.setSim(s);
  }

  async link(ctl: LinkCtl): Promise<void> {
    this.visor.setLink(ctl);
  }

  connect(h: LinkHandlers): () => void {
    this.handlers = h;
    h.onStatus(this.visor.status());
    return () => {
      this.handlers = null;
    };
  }

  async pollState(): Promise<ServerState | null> {
    return null;
  }
}

/** Pick the backend: `?mock=1` forces mock; otherwise live when /api/health answers. */
export async function detectBackend(): Promise<{ backend: Backend; reason: string }> {
  const params = new URLSearchParams(location.search);
  if (params.get('mock') === '1') return { backend: new MockBackend(), reason: 'Mock mode requested (?mock=1)' };
  try {
    const h = await json<{ ok: boolean; siteId: string }>('/api/health', undefined, 2500);
    if (h.ok && h.siteId) return { backend: new HttpBackend(h.siteId), reason: `Hab server online · ${h.siteId}` };
    throw new Error('health not ok');
  } catch {
    return { backend: new MockBackend(), reason: 'Hab server unreachable — running on the in-browser synthetic site' };
  }
}

export type { Cell };
