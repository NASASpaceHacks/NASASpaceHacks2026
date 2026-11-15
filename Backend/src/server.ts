import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import {
  PlanPackageSchema,
  PlanRequestSchema,
  type FieldSet,
  type LinkMsg,
  type PlanEvent,
  type PlanPackage,
  type PlanRequest,
  type PlanResult,
  type Telem,
} from '@mw/shared/contracts';
import {
  ConfirmRequestSchema,
  EarthBundleRequestSchema,
  FIELD_NAMES,
  HabEventRequestSchema,
  LinkConditionsPatchSchema,
  SimRequestSchema,
  signPackage,
  type ConfirmResponse,
  type FieldName,
  type HabState,
  type HealthResponse,
  type SimState,
} from '@mw/shared/link';
import { EarthRelay } from './earth';
import { fallbackEncodePackage, fallbackToPlanPackage, loadEngine, requestKey, type EngineHandle } from './engine';
import { EventLog } from './eventlog';
import { Hub } from './hub';
import { loadOrCreateKey } from './keys';
import { Planner } from './planner/pool';
import { listSitePacks, loadSitePackSource, type PackSource } from './sitepack';
import { contentTypeFor, safeJoin, serveBytes, serveFile } from './static';

export const BACKEND_DIR = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Route package budget (design doc §4: ≤25 KB, Curiosity daily uplink ≈ 28 KB). */
const PACKAGE_BUDGET_B = 25_000;

export interface HabServerOptions {
  port?: number;
  host?: string;
  /** Runtime state: key.json, events.jsonl. Default Backend/var. */
  varDir?: string;
  sitePacksDir?: string;
  /** Site pack id (default env SITEPACK || 'gale-v1'). */
  sitePack?: string;
  useWorker?: boolean;
  /**
   * 'auto' (default): engine when available, golden fixture when it is missing/throws.
   * 'golden-plan': always plan with the golden fixture, but build/encode packages with the engine.
   * 'fallback': never call the engine (golden fixture + Backend package codec).
   */
  engine?: 'auto' | 'golden-plan' | 'fallback';
  planTimeoutMs?: number;
  heartbeatMs?: number;
  routeResendMs?: number;
  quiet?: boolean;
}

export interface HabServer {
  port: number;
  url: string;
  publicKeyHex: string;
  siteId: string;
  close(): Promise<void>;
}

interface CacheEntry {
  req: PlanRequest;
  result: PlanResult;
  fields: FieldSet;
  engine: 'real' | 'fallback';
  /** The pack this plan was made on. */
  site: PackSource;
}

class SiteError extends Error {
  constructor(public siteId: string) {
    super(`unknown site "${siteId}"`);
  }
}

class Lru<K, V> {
  private m = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }
}

const bad = (c: Context, error: string, extra: Record<string, unknown> = {}, status: 400 | 404 | 409 | 500 | 503 = 400) =>
  c.json({ error, ...extra }, status);

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

const zIssues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.slice(0, 10).map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);

export async function createHabServer(o: HabServerOptions = {}): Promise<HabServer> {
  const startedAt = Date.now();
  const log = (s: string) => {
    if (!o.quiet) console.log(`[hab] ${s}`);
  };
  const varDir = o.varDir ?? join(BACKEND_DIR, 'var');
  const sitePacksDir = o.sitePacksDir ?? join(REPO_ROOT, 'SitePacks');
  const requested = o.sitePack ?? process.env.SITEPACK ?? 'gale-v1';

  const packSrc = await loadSitePackSource(sitePacksDir, requested);
  const pack = packSrc.pack;
  const grid = pack.manifest.grid;
  log(`site pack ${packSrc.id} (${packSrc.source}${packSrc.reason ? `: ${packSrc.reason}` : ''}) ${grid.w}×${grid.h} @ ${grid.cellM} m`);
  for (const w of packSrc.warnings) log(`site pack warning: ${w}`);

  // ───────────── sites: the default pack is loaded now, every other SitePacks/<id> lazily on first use ─────────────
  const sites = new Map<string, Promise<PackSource | null>>();
  const defaultSite = Promise.resolve<PackSource | null>(packSrc);
  sites.set(packSrc.id, defaultSite);
  sites.set(requested, defaultSite);
  /** The pack for a site id (cached); null when there is no such site. */
  const getSite = (id: string): Promise<PackSource | null> => {
    let p = sites.get(id);
    if (!p) {
      p = !/^[\w.-]+$/.test(id) || id === '..' || !existsSync(join(sitePacksDir, id, 'manifest.json'))
        ? Promise.resolve(null)
        : loadSitePackSource(sitePacksDir, id).then((src) => {
            log(`site pack ${src.id} loaded on demand (${src.source}${src.reason ? `: ${src.reason}` : ''})`);
            return src.source === 'disk' ? src : null; // a broken pack is "missing", never swapped for the mock
          });
      if (!/^[\w.-]+$/.test(id)) return p;
      sites.set(id, p);
      p.then((v) => v === null && sites.get(id) === p && sites.delete(id)); // re-check the disk on the next request
    }
    return p;
  };
  const noSite = (c: Context, id: string) => bad(c, `unknown site "${id}" — GET /api/sitepacks lists the available sites`, { siteId: id }, 404);

  const key = await loadOrCreateKey(varDir);
  const evlog = new EventLog(join(varDir, 'events.jsonl'));
  const earth = new EarthRelay();
  const planner = new Planner(pack, { useWorker: o.useWorker ?? true, timeoutMs: o.planTimeoutMs ?? 20_000, forceFallback: o.engine === 'fallback' || o.engine === 'golden-plan', log });
  const plannerReady = planner.start();

  // ───────────── mission state ─────────────
  let route: PlanPackage | null = null;
  let routeAck: HabState['routeAck'] = null;
  let seq = 0;
  let lastTelem: Telem | null = null;
  let lastTelemLogAt = 0;
  const track: Telem[] = [];
  let sim: SimState = { running: false, speed: 1, reset: false, rev: 0, updatedUtc: new Date().toISOString() };
  /** Request the next /api/events replan starts from (latest confirmed route or event replan). */
  let baseReqHash: string | null = null;
  let lastPlan: HabState['lastPlan'] = null;
  const cache = new Lru<string, CacheEntry>(20);
  const reqKeyIndex = new Lru<string, string>(100); // requestKey → reqHash
  const reqLog = new Lru<string, PlanRequest>(200); // reqHash → request (crash recovery)

  // ───────────── crash recovery: replay the event log ─────────────
  const replayed = evlog.replay();
  for (const e of replayed) {
    const d = e.data as Record<string, any>;
    switch (e.type) {
      case 'plan':
        if (d.reqHash && d.req) reqLog.set(d.reqHash, d.req as PlanRequest);
        if (d.reqHash) lastPlan = { reqHash: d.reqHash, status: d.status, engine: d.engine };
        if (!route && d.cause === 'plan' && d.reqHash) baseReqHash = d.reqHash;
        break;
      case 'confirm':
        if (d.pkg) {
          route = d.pkg as PlanPackage;
          seq = Math.max(seq, route.seq);
          routeAck = null;
          if (d.reqHash) baseReqHash = d.reqHash;
        }
        break;
      case 'ack':
        if (route && d.id === route.id) routeAck = { id: d.id, seq: d.seq, accepted: !!d.accepted, ts: e.ts };
        break;
      case 'event':
        if (d.reqHash) baseReqHash = d.reqHash;
        break;
      case 'telem':
        if (d.telem) lastTelem = d.telem as Telem;
        break;
      case 'sim':
        if (d.sim) sim = d.sim as SimState;
        break;
      case 'earth':
        if (d.bundle) earth.restore(d.bundle);
        break;
    }
  }
  if (replayed.length) log(`replayed ${replayed.length} log entries → route ${route ? `seq ${route.seq} (${route.id})` : 'none'}`);

  // ───────────── surface link hub ─────────────
  const isRoutePending = () => !!route && !(routeAck && routeAck.id === route.id);
  const hub: Hub = new Hub(
    {
      onVisorMsg(m) {
        switch (m.type) {
          case 'TELEM': {
            lastTelem = m.telem;
            track.push(m.telem);
            if (track.length > 5000) track.splice(0, track.length - 5000);
            const now = Date.now();
            if (now - lastTelemLogAt >= 30_000) {
              lastTelemLogAt = now;
              evlog.append('telem', { telem: m.telem });
            }
            break;
          }
          case 'ACK':
            evlog.append('ack', { id: m.id, seq: m.seq, accepted: m.accepted, current: route?.id === m.id });
            if (route && m.id === route.id) routeAck = { id: m.id, seq: m.seq, accepted: m.accepted, ts: new Date().toISOString() };
            break;
          case 'REQUEST':
            evlog.append('request', { kind: m.kind, cell: m.cell, note: m.note, t: m.t });
            break;
          case 'ALERT':
            evlog.append('alert', { from: 'visor', level: m.level, code: m.code, text: m.text, t: m.t });
            break;
          case 'ROUTE_PUSH':
            return; // only the hab issues routes
        }
        hub.sendToConsoles(m);
      },
      onConsoleMsg(m) {
        if (m.type !== 'ALERT') return;
        evlog.append('alert', { from: 'console', level: m.level, code: m.code, text: m.text, t: m.t });
        hub.sendToVisors({ ...m, from: m.from ?? 'hab' }); // the habitat console speaks for the hab
      },
      onVisorStatus(s, prev) {
        evlog.append('link_status', { visorLink: s, prev });
        log(`visor link ${prev} → ${s}`);
      },
      route: () => (route ? { pkg: route, pending: isRoutePending() } : null),
    },
    { heartbeatMs: o.heartbeatMs, routeResendMs: o.routeResendMs },
  );

  // ───────────── planning ─────────────
  const plannerDefaults = (req: PlanRequest): PlanRequest => {
    const ps = process.env.MARSWALK_PATH_SEARCH, cm = process.env.MARSWALK_COST_MODEL;
    if (req.planner || (!ps && !cm)) return req;
    return { ...req, planner: { pathSearch: ps ?? 'dijkstra', costModel: cm ?? 'pandolf-santee-mars' } };
  };

  async function doPlan(input: PlanRequest, cause: 'plan' | 'event' | 'replay'): Promise<CacheEntry> {
    const site = await getSite(input.siteId);
    if (!site) throw new SiteError(input.siteId);
    const req = plannerDefaults(input);
    const rk = requestKey(req);
    const known = reqKeyIndex.get(rk);
    const hit = known ? cache.get(known) : undefined;
    if (hit) {
      if (cause === 'plan' && !route) baseReqHash = hit.result.reqHash;
      return hit;
    }
    const out = await planner.plan(req, rk, site.pack);
    const entry: CacheEntry = { req, result: out.result, fields: out.fields, engine: out.engine, site };
    const h = out.result.reqHash;
    cache.set(h, entry);
    reqKeyIndex.set(rk, h);
    reqLog.set(h, req);
    if (cause !== 'replay') {
      lastPlan = { reqHash: h, status: out.result.status, engine: out.engine };
      if (cause === 'plan' && !route) baseReqHash = h;
      evlog.append('plan', {
        reqHash: h,
        req,
        cause,
        status: out.result.status,
        order: out.result.order,
        solveMs: out.result.solveMs,
        engine: out.engine,
        ms: Math.round(out.ms),
      });
    }
    return entry;
  }

  /** Cached plan, or re-plan a logged request (after a restart). */
  async function getEntry(reqHash: string): Promise<CacheEntry | null> {
    const hit = cache.get(reqHash);
    if (hit) return hit;
    const req = reqLog.get(reqHash);
    if (!req) return null;
    const entry = await doPlan(req, 'replay').catch((e) => (e instanceof SiteError ? null : Promise.reject(e)));
    if (!entry) return null;
    cache.set(reqHash, entry);
    return entry;
  }

  const cellsInGrid = (cells: number[], g = grid) => cells.every((c) => Number.isInteger(c) && c >= 0 && c < g.w * g.h);

  await plannerReady;
  log(`planner: ${planner.mode}; engine exports ${JSON.stringify(planner.caps)}`);
  const mainEngine: EngineHandle = o.engine === 'fallback' ? { api: {}, caps: { ...planner.caps, toPlanPackage: false, encodePackage: false } } : await loadEngine();

  // ───────────── HTTP API ─────────────
  const app = new Hono();
  app.use(
    '*',
    cors({ origin: '*', exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag', 'X-Grid-W', 'X-Grid-H', 'X-DType'] }),
  );
  app.onError((err, c) => {
    if (err instanceof SiteError) return noSite(c, err.siteId);
    log(`error ${c.req.method} ${c.req.path}: ${err.stack ?? err.message}`);
    return c.json({ error: err.message }, 500);
  });

  app.get('/', (c) => c.json({ name: 'Marswalk hab server', health: '/api/health', state: '/api/state', link: '/link?role=console|visor' }));

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      siteId: packSrc.id,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      sitePack: { id: packSrc.id, source: packSrc.source, requested: packSrc.requested, reason: packSrc.reason, warnings: packSrc.warnings },
      engine: { ...planner.caps, toPlanPackage: mainEngine.caps.toPlanPackage, encodePackage: mainEngine.caps.encodePackage },
      planner: { mode: planner.mode, pathSearch: process.env.MARSWALK_PATH_SEARCH, costModel: process.env.MARSWALK_COST_MODEL },
      pubKeyHex: key.publicKeyHex,
    } satisfies HealthResponse),
  );

  app.get('/api/pubkey', (c) =>
    c.json({ alg: 'Ed25519', publicKeyHex: key.publicKeyHex, signs: 'canonical CBOR of the PlanPackage without `sig` (packageSigningBytes)' }),
  );

  app.get('/api/sitepacks', async (c) => c.json(await listSitePacks(sitePacksDir, packSrc)));

  app.get('/sitepacks/:id/*', async (c) => {
    const id = c.req.param('id');
    const path = new URL(c.req.url).pathname;
    const prefix = `/sitepacks/${encodeURIComponent(id)}/`;
    if (!path.startsWith(prefix)) return c.text('not found', 404);
    let rel: string;
    try {
      rel = decodeURIComponent(path.slice(prefix.length));
    } catch {
      return c.text('bad path', 400);
    }
    if (packSrc.source === 'mock' && (id === packSrc.id || id === packSrc.requested)) {
      const f = packSrc.memFiles!.get(rel);
      if (!f) return c.text('not found', 404);
      const etag = `"${pack.manifest.files[rel]?.slice(0, 16) ?? `${f.byteLength}-${startedAt}`}"`;
      return serveBytes(c.req.raw, f, contentTypeFor(rel), etag);
    }
    if (!/^[\w.-]+$/.test(id) || id === '..') return c.text('not found', 404);
    const abs = safeJoin(join(sitePacksDir, id), rel);
    if (!abs) return c.text('not found', 404);
    return serveFile(c.req.raw, abs);
  });

  app.post('/api/plan', async (c) => {
    const parsed = PlanRequestSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return bad(c, 'invalid PlanRequest', { issues: zIssues(parsed.error) });
    const req = parsed.data as PlanRequest;
    const cells = [req.hab, ...req.shelters.map((s) => s.cell), ...req.stations.map((s) => s.cell), ...(req.resume ? [req.resume.cell] : [])];
    const site = await getSite(req.siteId);
    if (!site) return noSite(c, req.siteId);
    const g = site.pack.manifest.grid;
    if (!cellsInGrid(cells, g)) return bad(c, `cell outside the ${g.w}×${g.h} grid of ${site.id}`);
    const entry = await doPlan(req, 'plan');
    return c.json(entry.result);
  });

  app.get('/api/fields/:reqHash/:name', async (c) => {
    const name = c.req.param('name') as FieldName;
    if (!FIELD_NAMES.includes(name)) return bad(c, `unknown field; one of ${FIELD_NAMES.join(', ')}`);
    const entry = await getEntry(c.req.param('reqHash'));
    if (!entry) return bad(c, 'unknown reqHash (plan first)', {}, 404);
    const arr = entry.fields[name];
    const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const bytes = arr.buffer instanceof ArrayBuffer ? (view as Uint8Array<ArrayBuffer>) : view.slice(); // SharedArrayBuffer → copy
    return c.body(bytes, 200, {
      'Content-Type': 'application/octet-stream',
      'X-Grid-W': String(entry.fields.w),
      'X-Grid-H': String(entry.fields.h),
      'X-DType': arr instanceof Float32Array ? 'f32' : 'u8',
      'Cache-Control': 'private, max-age=3600',
    });
  });

  let confirmChain: Promise<unknown> = Promise.resolve();
  app.post('/api/confirm', async (c) => {
    const parsed = ConfirmRequestSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return bad(c, 'body must be { reqHash }', { issues: zIssues(parsed.error) });
    const run = async (): Promise<Response> => {
      const { reqHash } = parsed.data;
      const entry = await getEntry(reqHash);
      if (!entry) return bad(c, 'unknown reqHash (plan first)', {}, 404);
      // STAY_IN is never pushed, except when the crew is already outside: then the engine's attached
      // direct return to the EVA base is the route to send (console "Recall crew").
      const crewReturn = !!entry.req.resume && entry.result.segments.length > 0;
      if (entry.result.status !== 'OK' && !crewReturn) return bad(c, 'plan status is STAY_IN — nothing to confirm', { notes: entry.result.notes }, 409);
      const notes: string[] = [];
      if (entry.engine === 'fallback') notes.push('route from golden fixture (engine unavailable)');
      const nextSeq = seq + 1;
      const parent = route?.id;
      const api = mainEngine.api;
      const grid = entry.site.pack.manifest.grid;
      let pkg: PlanPackage | undefined;
      if (api.toPlanPackage) {
        try {
          pkg = api.toPlanPackage(entry.result, entry.req, entry.fields, grid, { seq: nextSeq, parent, author: 'hab' });
        } catch (e) {
          notes.push(`engine.toPlanPackage threw (${(e as Error).message}) — Backend fallback package`);
        }
      } else notes.push('engine.toPlanPackage not exported yet — Backend fallback package');
      pkg ??= fallbackToPlanPackage(entry.result, entry.req, entry.fields, grid, { seq: nextSeq, parent, author: 'hab' });
      pkg = { ...pkg, v: 1, seq: nextSeq, author: 'hab', id: pkg.id || randomUUID(), sig: '' };
      if (parent) pkg.parent = parent;
      else delete pkg.parent;
      pkg.sig = await signPackage(pkg, key.secretKeyHex);
      const valid = PlanPackageSchema.safeParse(pkg);
      if (!valid.success) return bad(c, 'PlanPackage failed schema validation', { issues: zIssues(valid.error) }, 500);

      let bytes: number;
      try {
        bytes = api.encodePackage ? api.encodePackage(pkg).byteLength : fallbackEncodePackage(pkg).byteLength;
        if (!api.encodePackage) notes.push('engine.encodePackage not exported yet — size from Backend CBOR+deflate-raw');
      } catch (e) {
        notes.push(`engine.encodePackage threw (${(e as Error).message}) — size from Backend CBOR+deflate-raw`);
        bytes = fallbackEncodePackage(pkg).byteLength;
      }

      route = pkg;
      routeAck = null;
      seq = nextSeq;
      baseReqHash = reqHash;
      evlog.append('confirm', { pkg, reqHash, bytes, engine: entry.engine });
      const pushedTo = hub.sendToVisors({ type: 'ROUTE_PUSH', pkg });
      evlog.append('push', { id: pkg.id, seq: pkg.seq, visors: pushedTo, held: hub.conditions().drop });
      log(`confirmed route seq ${pkg.seq} (${bytes} B) → ${pushedTo} visor(s)`);
      const res: ConfirmResponse = {
        id: pkg.id,
        seq: pkg.seq,
        parent: pkg.parent,
        bytes,
        withinBudget: bytes <= PACKAGE_BUDGET_B,
        sig: pkg.sig,
        pushedTo,
        notes,
      };
      return c.json(res);
    };
    const p = confirmChain.then(run);
    confirmChain = p.catch(() => undefined);
    return p;
  });

  app.get('/api/state', (c) =>
    c.json({
      route,
      routeAcked: !!(route && routeAck && routeAck.id === route.id && routeAck.accepted),
      routeAck,
      seq,
      visorLink: hub.visorStatus(),
      lastTelem,
      events: evlog.tail(50, ['telem']),
      link: hub.conditions(),
      sim,
      earth: earth.view(),
      clients: hub.counts(),
      lastPlan,
    } satisfies HabState),
  );

  app.get('/api/telem', (c) => c.json({ routeSeq: route?.seq ?? null, track }));

  app.post('/api/events', async (c) => {
    const parsed = HabEventRequestSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return bad(c, 'invalid event', { issues: zIssues(parsed.error) });
    const ev = parsed.data;
    const baseHash = baseReqHash;
    const baseEntry = baseHash ? await getEntry(baseHash) : null;
    const base = baseEntry?.req;
    if (!baseHash || !base || !baseEntry) return bad(c, 'no plan to replan from — POST /api/plan first', {}, 409);
    const eg = baseEntry.site.pack.manifest.grid;
    if (ev.type === 'HAZARD' && !cellsInGrid(ev.cells, eg)) return bad(c, `hazard cell outside the ${eg.w}×${eg.h} grid of ${baseEntry.site.id}`);

    if (ev.type === 'SEP_NOWCAST') {
      // Safety first: warn the crew immediately over the surface link (held and flushed if the link is
      // dropped); the replanned return route follows once the EVA officer confirms it.
      const alert: LinkMsg = {
        type: 'ALERT',
        level: 'warning',
        code: 'SEP_NOWCAST',
        text: `SEP NOWCAST — REACH SHELTER WITHIN ${ev.leadMin} MIN`,
        t: lastTelem?.t ?? 0,
        from: 'hab',
      };
      evlog.append('alert', { from: 'hab', level: alert.level, code: alert.code, text: alert.text, t: alert.t });
      hub.sendToVisors(alert);
      hub.sendToConsoles(alert);
    }
    const planEvent: PlanEvent =
      ev.type === 'SEP_NOWCAST'
        ? { t: 'SEP_NOWCAST', leadMin: ev.leadMin }
        : ev.type === 'EVA_CUT'
          ? { t: 'EVA_CUT', min: ev.min }
          : { t: 'HAZARD', cells: ev.cells, ...(ev.note ? { note: ev.note } : {}) };
    let resume = base.resume;
    const telem = lastTelem;
    if (telem && telem.cell < eg.w * eg.h && (!route || route.siteId === base.siteId)) {
      const reached = route ? route.stops.filter((s) => s.arriveMin <= telem.t && s.id !== 'HAB').map((s) => s.id) : [];
      resume = {
        elapsedMin: telem.t,
        cell: telem.cell,
        visited: [...new Set([...(base.resume?.visited ?? []), ...reached])],
        o2UsedPct: Math.min(100, Math.max(0, 100 - telem.o2Pct)),
      };
    }
    const req: PlanRequest = { ...base, events: [...(base.events ?? []), planEvent], ...(resume ? { resume } : {}) };
    const entry = await doPlan(req, 'event');
    const note = telem ? `replanned from last TELEM (t=${telem.t.toFixed(1)} min, cell ${telem.cell})` : 'no TELEM received yet — replanned from the hab';
    if (!entry.result.notes.includes(note)) entry.result.notes.push(note);
    baseReqHash = entry.result.reqHash;
    evlog.append('event', { event: ev, reqHash: entry.result.reqHash, baseReqHash: baseHash, resume: resume ?? null });
    return c.json(entry.result);
  });

  app.get('/api/sim', (c) => {
    if (c.req.query('role') === 'visor' && hub.conditions().drop) return bad(c, 'surface link dropped', {}, 503);
    return c.json(sim);
  });
  app.post('/api/sim', async (c) => {
    const parsed = SimRequestSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return bad(c, 'body must be { running, speed, reset? }', { issues: zIssues(parsed.error) });
    sim = { running: parsed.data.running, speed: parsed.data.speed, reset: !!parsed.data.reset, rev: sim.rev + 1, updatedUtc: new Date().toISOString() };
    evlog.append('sim', { sim });
    return c.json(sim);
  });

  app.get('/api/link', (c) => c.json({ ...hub.conditions(), visorLink: hub.visorStatus() }));
  app.post('/api/link', async (c) => {
    const parsed = LinkConditionsPatchSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return bad(c, 'body must be { latencyMs?, lossPct?, drop? }', { issues: zIssues(parsed.error) });
    const prev = hub.conditions();
    const next = hub.setConditions(parsed.data);
    evlog.append('link', { prev, next });
    log(`link conditions ${JSON.stringify(next)}`);
    return c.json({ ...next, visorLink: hub.visorStatus() });
  });

  app.get('/api/earth', (c) => c.json(earth.view()));
  app.post('/api/earth/bundle', async (c) => {
    const parsed = EarthBundleRequestSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return bad(c, 'body must be { kind, body, src?, timeScale? }', { issues: zIssues(parsed.error) });
    const b = earth.submit(parsed.data);
    evlog.append('earth', { bundle: b });
    return c.json({ ...b, status: 'in_flight' }, 201);
  });

  app.all('/api/*', (c) => bad(c, 'not found', {}, 404));

  evlog.append('boot', { sitePack: packSrc.id, source: packSrc.source, replayed: replayed.length, routeId: route?.id ?? null, seq });

  // ───────────── listen ─────────────
  let server: Server;
  try {
    server = await new Promise<Server>((resolve, reject) => {
      const s = serve({ fetch: app.fetch, port: o.port ?? 8787, hostname: o.host }, () => resolve(s as Server)) as Server;
      s.once('error', reject);
    });
  } catch (e) {
    await hub.close();
    await planner.close();
    throw e;
  }
  hub.attach(server);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : (o.port ?? 8787);
  log(`listening on http://localhost:${port} (ws /link)`);

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    publicKeyHex: key.publicKeyHex,
    siteId: packSrc.id,
    async close() {
      await hub.close();
      await planner.close();
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
