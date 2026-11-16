import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_PREFS,
  encodeRaster,
  goldenPlanRequest,
  mockSitePack,
  type LinkMsg,
  type LoadedSitePack,
  type PlanPackage,
  type PlanResult,
  ROUTE_PRESETS,
  type Telem,
} from '@mw/shared/contracts';
import { connectWebSocketLink, verifyPackage, type ConfirmResponse, type HabState, type HealthResponse, type Link } from '@mw/shared/link';
import { createHabServer, type HabServer, type HabServerOptions } from './server';

// ───────────────────────────── fixtures / helpers ─────────────────────────────

const tmpRoots: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmpRoots.push(d);
  return d;
};

/** Write a small synthetic site pack to disk exactly as the pipeline lays one out. */
function writePack(root: string, id: string, size: number): LoadedSitePack {
  const p = mockSitePack(7, size);
  const manifest = { ...p.manifest, id, name: `Test pack ${size}` };
  mkdirSync(join(root, id), { recursive: true });
  for (const layer of Object.values(manifest.rasters)) {
    writeFileSync(join(root, id, layer.file), Buffer.from(encodeRaster(p.rasters[layer.id], layer)));
  }
  writeFileSync(join(root, id, 'manifest.json'), JSON.stringify(manifest));
  return { ...p, manifest };
}

const PACKS = tmp('mw-packs-');
const SMALL = writePack(PACKS, 'small', 120);

const servers: HabServer[] = [];
const links: Link[] = [];

async function start(o: HabServerOptions = {}): Promise<HabServer> {
  const hab = await createHabServer({ port: 0, varDir: tmp('mw-var-'), sitePacksDir: PACKS, sitePack: 'small', quiet: true, ...o });
  servers.push(hab);
  return hab;
}

function link(hab: HabServer, role: 'console' | 'visor'): Link {
  const l = connectWebSocketLink(`ws://127.0.0.1:${hab.port}/link`, role, { backoffMinMs: 50 });
  links.push(l);
  return l;
}

async function waitFor<T>(fn: () => T | Promise<T>, what: string, ms = 8000): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(hab: HabServer, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(hab.url + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T };
}

const state = async (hab: HabServer) => (await api<HabState>(hab, '/api/state')).json;

function collect(l: Link) {
  const got: LinkMsg[] = [];
  l.onMessage((m) => {
    if (m.type !== 'HEARTBEAT') got.push(m);
  });
  return got;
}

const telem = (t: number, routeSeq: number, cell: number): Telem => ({ t, cell, sigmaM: 3, o2Pct: 100 - t / 4, metW: 310, heatAvgW: 300, headingDeg: 90, routeSeq });

afterEach(async () => {
  for (const l of links.splice(0)) l.close();
  for (const s of servers.splice(0)) await s.close();
});

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

// ───────────────────────────── tests ─────────────────────────────

describe('hab server API (e2e on an ephemeral port)', () => {
  it('plan → confirm → visor gets a signed ROUTE_PUSH → ACK → routeAcked', async () => {
    // planning worker; golden plan (deterministic while the engine planner evolves) + the engine's package codec
    const hab = await start({ engine: 'golden-plan' });
    expect(hab.port).not.toBe(8787);
    const health = (await api<HealthResponse>(hab, '/api/health')).json;
    expect(health).toMatchObject({ ok: true, siteId: 'small', sitePack: { source: 'disk' } });
    expect(health.pubKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(health.planner.mode).toBe('worker');

    const consoleLink = link(hab, 'console');
    const visor = link(hab, 'visor');
    const atConsole = collect(consoleLink);
    const atVisor = collect(visor);
    // the visor app: verify + ACK every new route (idempotent by id)
    const acked = new Set<string>();
    visor.onMessage(async (m) => {
      if (m.type !== 'ROUTE_PUSH') return;
      const ok = await verifyPackage(m.pkg, health.pubKeyHex);
      if (!acked.has(m.pkg.id)) acked.add(m.pkg.id);
      visor.send({ type: 'ACK', id: m.pkg.id, seq: m.pkg.seq, accepted: ok });
    });
    await waitFor(() => visor.status() === 'up' && consoleLink.status() === 'up', 'links up');
    await waitFor(async () => (await state(hab)).visorLink === 'up', 'server sees visor');

    const bad = await api<{ error: string }>(hab, '/api/plan', { siteId: 'small' });
    expect(bad.status).toBe(400);

    const req = goldenPlanRequest(SMALL);
    const plan = await api<PlanResult>(hab, '/api/plan', req);
    expect(plan.status).toBe(200);
    expect(plan.json.reqHash).toBeTruthy();
    expect(plan.json.status).toBe('OK');

    const n = SMALL.manifest.grid.w * SMALL.manifest.grid.h;
    const wb = await fetch(`${hab.url}/api/fields/${plan.json.reqHash}/walkbackMin`);
    expect(wb.headers.get('content-type')).toBe('application/octet-stream');
    expect((await wb.arrayBuffer()).byteLength).toBe(n * 4);
    const los = await fetch(`${hab.url}/api/fields/${plan.json.reqHash}/los`);
    expect((await los.arrayBuffer()).byteLength).toBe(n);
    expect((await fetch(`${hab.url}/api/fields/nope/los`)).status).toBe(404);

    const c1 = await api<ConfirmResponse>(hab, '/api/confirm', { reqHash: plan.json.reqHash });
    expect(c1.status).toBe(200);
    expect(c1.json).toMatchObject({ seq: 1, pushedTo: 1 });
    expect(c1.json.bytes).toBeGreaterThan(0);
    if (health.engine.encodePackage) expect(c1.json.withinBudget).toBe(true);

    const push = await waitFor(() => atVisor.find((m): m is Extract<LinkMsg, { type: 'ROUTE_PUSH' }> => m.type === 'ROUTE_PUSH' && m.pkg.id === c1.json.id), 'ROUTE_PUSH');
    expect(push.pkg.seq).toBe(1);
    expect(push.pkg.parent).toBeUndefined();
    expect(await verifyPackage(push.pkg, health.pubKeyHex)).toBe(true);

    await waitFor(async () => (await state(hab)).routeAcked, 'routeAcked');
    expect(atConsole.some((m) => m.type === 'ACK' && m.id === c1.json.id)).toBe(true);

    // TELEM visor → hab → console
    visor.send({ type: 'TELEM', telem: telem(12, 1, req.hab + 3) });
    await waitFor(() => atConsole.some((m) => m.type === 'TELEM' && m.telem.t === 12), 'TELEM relayed');
    expect((await state(hab)).lastTelem).toMatchObject({ t: 12, cell: req.hab + 3 });

    // ALERT console → visor, REQUEST visor → console
    consoleLink.send({ type: 'ALERT', level: 'caution', code: 'TEST', text: 'hello visor', t: 12 });
    visor.send({ type: 'REQUEST', kind: 'FATIGUED', t: 13 });
    await waitFor(() => atVisor.some((m) => m.type === 'ALERT' && m.code === 'TEST'), 'ALERT relayed');
    await waitFor(() => atConsole.some((m) => m.type === 'REQUEST' && m.kind === 'FATIGUED'), 'REQUEST relayed');

    // event → replan from the last TELEM (no auto-push), then confirm → seq 2 with parent
    const hz = await api<PlanResult>(hab, '/api/events', { type: 'HAZARD', cells: [req.hab + 2 * SMALL.manifest.grid.w] });
    expect(hz.status).toBe(200);
    expect(hz.json.reqHash).not.toBe(plan.json.reqHash);
    expect(hz.json.notes.some((s) => s.includes('last TELEM'))).toBe(true);
    expect(atVisor.filter((m) => m.type === 'ROUTE_PUSH' && m.pkg.seq === 2)).toHaveLength(0);
    const c2 = await api<ConfirmResponse>(hab, '/api/confirm', { reqHash: hz.json.reqHash });
    expect(c2.json).toMatchObject({ seq: 2, parent: c1.json.id });
    await waitFor(async () => {
      const s = await state(hab);
      return s.routeAcked && s.route?.id === c2.json.id;
    }, 'routeAcked v2');

    // sim state for the visor to poll
    const sim = await api<{ running: boolean; speed: number; rev: number }>(hab, '/api/sim', { running: true, speed: 20 });
    expect(sim.json).toMatchObject({ running: true, speed: 20, rev: 1 });
    expect((await api<{ speed: number }>(hab, '/api/sim?role=visor')).json.speed).toBe(20);

    // Earth relay
    const b = await api<{ id: string; oneWayLightMin: number; deliverAtUtc: string }>(hab, '/api/earth/bundle', { kind: 'LOG', body: { eva: 1 }, timeScale: 600 });
    expect(b.status).toBe(201);
    expect(b.json.oneWayLightMin).toBeGreaterThan(3);
    expect(b.json.oneWayLightMin).toBeLessThan(23);
    const s = await state(hab);
    expect(s.earth.bundles.find((x) => x.id === b.json.id)?.status).toBe('in_flight');
    expect(s.events.map((e) => e.type)).toEqual(expect.arrayContaining(['plan', 'confirm', 'push', 'ack', 'request', 'event', 'sim', 'earth']));
  });

  it('/api/link drop stops relaying both ways; un-drop resyncs (held ALERT, re-sent route, visor queue flushed)', async () => {
    const hab = await start({ engine: 'fallback', useWorker: false });
    const consoleLink = link(hab, 'console');
    const visor = link(hab, 'visor');
    const atConsole = collect(consoleLink);
    const atVisor = collect(visor);
    visor.onMessage((m) => {
      if (m.type === 'ROUTE_PUSH') visor.send({ type: 'ACK', id: m.pkg.id, seq: m.pkg.seq, accepted: true });
    });
    await waitFor(() => visor.status() === 'up' && consoleLink.status() === 'up', 'links up');

    const plan = await api<PlanResult>(hab, '/api/plan', goldenPlanRequest(SMALL));
    expect(plan.json.notes[0]).toBe('engine unavailable — golden fixture');
    const c1 = await api<ConfirmResponse>(hab, '/api/confirm', { reqHash: plan.json.reqHash });
    await waitFor(async () => (await state(hab)).routeAcked, 'route v1 acked');

    const dropped = await api<{ drop: boolean }>(hab, '/api/link', { drop: true });
    expect(dropped.json.drop).toBe(true);
    // sent while the visor still believes the link is up → lost in the radio silence
    visor.send({ type: 'TELEM', telem: telem(1, 1, 500) });
    await waitFor(() => visor.status() === 'down', 'visor link down (3 missed heartbeats)', 6000);
    await waitFor(async () => (await state(hab)).visorLink === 'down', 'hab sees visor down', 6000);
    expect((await api<unknown>(hab, '/api/sim?role=visor')).status).toBe(503);

    visor.send({ type: 'TELEM', telem: telem(2, 1, 501) }); // queued on the visor (store-and-forward)
    consoleLink.send({ type: 'ALERT', level: 'warning', code: 'SEP', text: 'seek shelter', t: 2 }); // held at the hab
    const c2 = await api<ConfirmResponse>(hab, '/api/confirm', { reqHash: plan.json.reqHash });
    expect(c2.json).toMatchObject({ seq: 2, parent: c1.json.id, pushedTo: 0 });
    await sleep(600);
    expect(atConsole.filter((m) => m.type === 'TELEM')).toHaveLength(0);
    expect(atVisor.some((m) => m.type === 'ALERT')).toBe(false);
    expect(atVisor.some((m) => m.type === 'ROUTE_PUSH' && m.pkg.id === c2.json.id)).toBe(false);
    expect((await state(hab)).routeAcked).toBe(false);

    await api(hab, '/api/link', { drop: false });
    await waitFor(() => visor.status() === 'up', 'visor link back up', 4000);
    await waitFor(() => atConsole.some((m) => m.type === 'TELEM' && m.telem.t === 2), 'queued TELEM flushed');
    await waitFor(() => atVisor.some((m) => m.type === 'ALERT' && m.code === 'SEP'), 'held ALERT delivered');
    await waitFor(() => atVisor.some((m) => m.type === 'ROUTE_PUSH' && m.pkg.id === c2.json.id), 'route v2 resynced');
    await waitFor(async () => (await state(hab)).routeAcked, 'route v2 acked');
    await waitFor(async () => (await state(hab)).visorLink === 'up', 'hab sees visor up');
    expect(atConsole.filter((m) => m.type === 'TELEM').map((m) => (m.type === 'TELEM' ? m.telem.t : -1))).toEqual([2]); // t=1 was lost, t=2 once
    const ev = (await state(hab)).events.map((e) => e.type);
    expect(ev).toEqual(expect.arrayContaining(['link', 'link_status']));
  });

  it('serves site-pack files with HTTP Range (disk pack and in-memory mock pack)', async () => {
    const hab = await start({ engine: 'fallback', useWorker: false });
    const size = 120 * 120 * 4;
    const full = new Uint8Array(await (await fetch(`${hab.url}/sitepacks/small/dem.bin`)).arrayBuffer());
    expect(full.byteLength).toBe(size);

    const part = await fetch(`${hab.url}/sitepacks/small/dem.bin`, { headers: { Range: 'bytes=100-199' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 100-199/${size}`);
    expect(part.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(full.slice(100, 200));

    const suffix = await fetch(`${hab.url}/sitepacks/small/dem.bin`, { headers: { Range: 'bytes=-10' } });
    expect(suffix.status).toBe(206);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(full.slice(size - 10));

    const beyond = await fetch(`${hab.url}/sitepacks/small/dem.bin`, { headers: { Range: `bytes=${size}-` } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${size}`);

    const head = await fetch(`${hab.url}/sitepacks/small/dem.bin`, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(String(size));
    expect((await fetch(`${hab.url}/sitepacks/small/..%2F..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${hab.url}/sitepacks/small/missing.bin`)).status).toBe(404);
    const packs = (await api<{ id: string }[]>(hab, '/api/sitepacks')).json;
    expect(packs.map((p) => p.id)).toContain('small');

    // missing pack → in-memory mock, served identically (under its own id and the requested id)
    const mock = await start({ sitePack: 'not-there', engine: 'fallback', useWorker: false });
    const h = (await api<HealthResponse>(mock, '/api/health')).json;
    expect(h.sitePack).toMatchObject({ source: 'mock', id: 'mock-412', requested: 'not-there' });
    expect(h.siteId).toBe('mock-412');
    const man = (await api<{ id: string; grid: { w: number } }>(mock, '/sitepacks/mock-412/manifest.json')).json;
    expect(man).toMatchObject({ id: 'mock-412', grid: { w: 600 } });
    const r = await fetch(`${mock.url}/sitepacks/not-there/slope.bin`, { headers: { Range: 'bytes=4-11' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 4-11/${600 * 600 * 4}`);
    expect((await r.arrayBuffer()).byteLength).toBe(8);
  });

  it('uses the real engine in the planning worker when it is exported', async () => {
    const hab = await start({ sitePack: 'small' });
    const health = (await api<HealthResponse>(hab, '/api/health')).json;
    expect(health.planner.mode).toBe('worker');
    const plan = await api<PlanResult>(hab, '/api/plan', goldenPlanRequest(SMALL));
    expect(plan.status).toBe(200);
    expect(plan.json.reqHash).toBeTruthy();
    if (!health.engine.plan) {
      expect(plan.json.notes[0]).toBe('engine unavailable — golden fixture');
      return;
    }
    expect(plan.json.notes).not.toContain('engine unavailable — golden fixture');
    expect(plan.json.planner.pathSearch).not.toBe('golden-straight-line');
    const n = SMALL.manifest.grid.w * SMALL.manifest.grid.h;
    const f = await fetch(`${hab.url}/api/fields/${plan.json.reqHash}/shelterMin`);
    expect((await f.arrayBuffer()).byteLength).toBe(n * 4);
    // identical request → served from the reqHash cache
    const again = await api<PlanResult>(hab, '/api/plan', goldenPlanRequest(SMALL));
    expect(again.json.reqHash).toBe(plan.json.reqHash);
    const c = await api<ConfirmResponse & { error?: string }>(hab, '/api/confirm', { reqHash: plan.json.reqHash });
    if (plan.json.status === 'OK') {
      expect(c.status).toBe(200);
      expect(c.json.withinBudget).toBe(true);
      expect(c.json.notes).toEqual([]);
    } else {
      expect(c.status).toBe(409); // STAY_IN: nothing to push
    }
  });

  it('route priorities reach the engine: validated, hashed, never sharing a cached plan', async () => {
    const hab = await start({ sitePack: 'small', useWorker: false });
    const health = (await api<HealthResponse>(hab, '/api/health')).json;
    if (!health.engine.plan) return;
    const req = goldenPlanRequest(SMALL);
    const radio = ROUTE_PRESETS.find((p) => p.id === 'radio')!.prefs;
    const plain = await api<PlanResult>(hab, '/api/plan', req);
    const def = await api<PlanResult>(hab, '/api/plan', { ...req, prefs: DEFAULT_ROUTE_PREFS });
    const pri = await api<PlanResult>(hab, '/api/plan', { ...req, prefs: radio });
    expect([plain.status, def.status, pri.status]).toEqual([200, 200, 200]);
    expect(def.json.reqHash).toBe(plain.json.reqHash); // default priorities = no priorities
    expect(pri.json.reqHash).not.toBe(plain.json.reqHash);
    expect(pri.json.notes.some((n) => n.startsWith('Route priorities (radio)'))).toBe(true); // prefs survived the schema
    expect(plain.json.notes.some((n) => n.startsWith('Route priorities'))).toBe(false);
    const other = await api<PlanResult>(hab, '/api/plan', { ...req, prefs: { ...radio, radio: 0.7 } });
    expect(other.json.reqHash).not.toBe(pri.json.reqHash);
    const bad = await api<{ error: string }>(hab, '/api/plan', { ...req, prefs: { ...radio, slope: 2 } });
    expect(bad.status).toBe(400);
  });

  it('replays the event log on restart: route, seq and parent chain survive a crash', async () => {
    const varDir = tmp('mw-var-replay-');
    const a = await start({ varDir, engine: 'fallback', useWorker: false });
    const plan = await api<PlanResult>(a, '/api/plan', goldenPlanRequest(SMALL));
    const c1 = await api<ConfirmResponse>(a, '/api/confirm', { reqHash: plan.json.reqHash });
    const c2 = await api<ConfirmResponse>(a, '/api/confirm', { reqHash: plan.json.reqHash });
    expect([c1.json.seq, c2.json.seq]).toEqual([1, 2]);
    const pub = a.publicKeyHex;
    await a.close();
    servers.splice(servers.indexOf(a), 1);

    const b = await start({ varDir, engine: 'fallback', useWorker: false });
    expect(b.publicKeyHex).toBe(pub); // key persisted in var/key.json
    const s = await state(b);
    expect(s.seq).toBe(2);
    expect(s.route?.id).toBe(c2.json.id);
    expect(s.route?.parent).toBe(c1.json.id);
    expect(s.routeAcked).toBe(false);
    expect(await verifyPackage(s.route as PlanPackage, pub)).toBe(true);
    expect(s.events.some((e) => e.type === 'boot' && e.data.replayed)).toBe(true);
    // the plan cache was lost with the process; confirm re-plans the logged request
    const c3 = await api<ConfirmResponse>(b, '/api/confirm', { reqHash: plan.json.reqHash });
    expect(c3.status).toBe(200);
    expect(c3.json).toMatchObject({ seq: 3, parent: c2.json.id });
  });
});
