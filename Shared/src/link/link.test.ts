import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkMsg, PlanPackage } from '../contracts/types';
import {
  LinkDecodeError,
  canonicalCbor,
  connectWebSocketLink,
  createMemoryLinkPair,
  decodeMsg,
  encodeMsg,
  generateSigningKey,
  linkUrl,
  msgKey,
  signPackage,
  verifyPackage,
  type LinkStatus,
  type WebSocketLike,
} from './index';
import { Encoder } from 'cbor-x';

const pkg = (over: Partial<PlanPackage> = {}): PlanPackage => ({
  v: 1,
  id: 'pkg-0001',
  parent: 'pkg-0000',
  seq: 7,
  author: 'hab',
  createdUtc: '2026-11-14T12:00:00Z',
  siteId: 'gale-v1',
  rulesHash: 'abc123',
  route: [1001, 1002, 2003, 3004],
  stops: [{ id: 'ST01', arriveMin: 40.5, departMin: 60.5, arriveLtstMin: 620.25 }],
  order: ['ST01'],
  bingo: [{ id: 'ST01', ltstMin: 700, tMin: 80, text: 'Leave ST01 by +80 min' }],
  startLtstMin: 580,
  sol: 412,
  coarse: { cellM: 50, w: 2, h: 2, walkbackMin: [10, 20, 65535, 30], shelterMin: [5, 6, 65535, 7] },
  sig: '',
  ...over,
});

const ALL_MSGS: LinkMsg[] = [
  { type: 'ROUTE_PUSH', pkg: pkg() },
  { type: 'ROUTE_PUSH', pkg: pkg({ parent: undefined, seq: 1 }) },
  { type: 'ACK', id: 'pkg-0001', seq: 7, accepted: true },
  { type: 'TELEM', telem: { t: 12.5, cell: 4242, sigmaM: 3.2, o2Pct: 91.4, metW: 310.5, heatAvgW: 298, headingDeg: 271.5, routeSeq: 7 } },
  { type: 'ALERT', level: 'caution', code: 'SEP', text: 'Dose rate rising', t: 33.25 },
  { type: 'REQUEST', kind: 'HAZARD', cell: 777, note: 'loose sand', t: 45 },
  { type: 'REQUEST', kind: 'FATIGUED', t: 46 },
  { type: 'HEARTBEAT', from: 'visor', t: 1_763_000_000_000, seq: 99 },
];

const strip = (m: unknown) => JSON.parse(JSON.stringify(m));

describe('codec', () => {
  it('round-trips every message type through CBOR + schema validation', () => {
    for (const m of ALL_MSGS) {
      const bytes = encodeMsg(m);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(strip(decodeMsg(bytes))).toEqual(strip(m));
      // ArrayBuffer input (browser WebSocket binaryType 'arraybuffer')
      expect(strip(decodeMsg(bytes.slice().buffer))).toEqual(strip(m));
    }
    const types = new Set(ALL_MSGS.map((m) => m.type));
    expect(types.size).toBe(6);
  });

  it('is compact (TELEM well under the 64 B/5 s budget order of magnitude)', () => {
    const telem = ALL_MSGS.find((m) => m.type === 'TELEM')!;
    expect(encodeMsg(telem).byteLength).toBeLessThan(160);
  });

  it('rejects garbage and schema violations', () => {
    expect(() => decodeMsg(new Uint8Array([0xff, 0x00, 0x13]))).toThrow(LinkDecodeError);
    const enc = new Encoder({ useRecords: false, mapsAsObjects: true });
    expect(() => decodeMsg(enc.encode({ type: 'NOPE' }))).toThrow(/invalid LinkMsg/);
    expect(() => decodeMsg(enc.encode({ type: 'ACK', id: 'x', seq: 1.5, accepted: true }))).toThrow(LinkDecodeError);
    expect(() => decodeMsg(enc.encode({ type: 'TELEM', telem: { t: 1 } }))).toThrow(LinkDecodeError);
    const badPkg = { ...pkg(), coarse: { ...pkg().coarse, walkbackMin: [70000] } };
    expect(() => decodeMsg(enc.encode({ type: 'ROUTE_PUSH', pkg: badPkg }))).toThrow(LinkDecodeError);
  });

  it('msgKey identifies messages for idempotent store-and-forward', () => {
    const keys = ALL_MSGS.map(msgKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(msgKey({ type: 'ACK', id: 'a', seq: 1, accepted: true })).toBe(msgKey({ type: 'ACK', id: 'a', seq: 1, accepted: true }));
  });

  it('canonical CBOR is independent of key order and drops undefined', () => {
    const a = canonicalCbor({ b: 1, a: { y: [1, 2.5], x: 'z' }, u: undefined });
    const b = canonicalCbor({ a: { x: 'z', y: [1, 2.5] }, b: 1 });
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
  });
});

describe('Ed25519 package signatures', () => {
  it('signs the canonical body and detects tampering', async () => {
    const key = await generateSigningKey();
    const p = pkg();
    const sig = await signPackage(p, key.secretKeyHex);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    const signed = { ...p, sig };
    expect(await verifyPackage(signed, key.publicKeyHex)).toBe(true);
    // key order of the object must not matter
    const reordered = JSON.parse(JSON.stringify({ ...Object.fromEntries(Object.entries(p).reverse()), sig }));
    expect(await verifyPackage(reordered, key.publicKeyHex)).toBe(true);
    // survives the wire
    const wire = decodeMsg(encodeMsg({ type: 'ROUTE_PUSH', pkg: signed }));
    expect(wire.type === 'ROUTE_PUSH' && (await verifyPackage(wire.pkg, key.publicKeyHex))).toBe(true);
    expect(await verifyPackage({ ...signed, route: [...p.route, 5] }, key.publicKeyHex)).toBe(false);
    expect(await verifyPackage({ ...signed, seq: 8 }, key.publicKeyHex)).toBe(false);
    const other = await generateSigningKey();
    expect(await verifyPackage(signed, other.publicKeyHex)).toBe(false);
    expect(await verifyPackage({ ...p, sig: '' }, key.publicKeyHex)).toBe(false);
  });
});

describe('memory link pair (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const alert = (t: number): LinkMsg => ({ type: 'ALERT', level: 'info', code: 'T', text: `t${t}`, t });

  it('comes up after the first heartbeat exchange and delivers both ways', () => {
    const [hab, visor] = createMemoryLinkPair({ seed: 1 });
    expect(hab.status()).toBe('down');
    vi.advanceTimersByTime(5);
    expect(hab.status()).toBe('up');
    expect(visor.status()).toBe('up');
    const gotV: LinkMsg[] = [];
    const gotH: LinkMsg[] = [];
    visor.onMessage((m) => m.type !== 'HEARTBEAT' && gotV.push(m));
    hab.onMessage((m) => m.type !== 'HEARTBEAT' && gotH.push(m));
    hab.send({ type: 'ROUTE_PUSH', pkg: pkg() });
    visor.send({ type: 'ACK', id: 'pkg-0001', seq: 7, accepted: true });
    vi.advanceTimersByTime(1);
    expect(gotV.map((m) => m.type)).toEqual(['ROUTE_PUSH']);
    expect(gotH.map((m) => m.type)).toEqual(['ACK']);
    hab.close();
    visor.close();
  });

  it('applies latency', () => {
    const pair = createMemoryLinkPair({ latencyMs: 800, seed: 2 });
    const [hab, visor] = pair;
    const got: number[] = [];
    visor.onMessage((m) => m.type === 'ALERT' && got.push(Date.now()));
    vi.advanceTimersByTime(900); // heartbeats arrive at 800 ms → up
    expect(hab.status()).toBe('up');
    const t0 = Date.now();
    hab.send(alert(1));
    vi.advanceTimersByTime(799);
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(got).toEqual([t0 + 800]);
    expect(pair.conditions().latencyMs).toBe(800);
    hab.close();
    visor.close();
  });

  it('applies loss (seeded, statistically ~lossPct) and 100 % loss delivers nothing', () => {
    const [hab, visor] = createMemoryLinkPair({ seed: 3 });
    vi.advanceTimersByTime(5);
    let n = 0;
    visor.onMessage((m) => m.type === 'ALERT' && n++);
    hab.setConditions({ lossPct: 50 });
    for (let i = 0; i < 400; i++) hab.send(alert(i));
    vi.advanceTimersByTime(1);
    expect(n).toBeGreaterThan(150);
    expect(n).toBeLessThan(250);
    hab.setConditions({ lossPct: 100 });
    n = 0;
    for (let i = 1000; i < 1100; i++) hab.send(alert(i));
    vi.advanceTimersByTime(1);
    expect(n).toBe(0);
    hab.close();
    visor.close();
  });

  it('status up → degraded (>1.5 s) → down (>3 s) on drop; store-and-forward flushes once on recovery', () => {
    const pair = createMemoryLinkPair({ seed: 4 });
    const [hab, visor] = pair;
    vi.advanceTimersByTime(5);
    const seen: LinkStatus[] = [];
    visor.onStatus((s) => seen.push(s));
    const telems: number[] = [];
    hab.onMessage((m) => m.type === 'TELEM' && telems.push(m.telem.t));

    pair.setConditions({ drop: true });
    // last heartbeat arrived at ≤ t=1000 ms after the drop at ~5 ms
    vi.advanceTimersByTime(1400);
    expect(visor.status()).toBe('up');
    const telem = (t: number): LinkMsg => ({ type: 'TELEM', telem: { t, cell: 10 + t, sigmaM: 2, o2Pct: 90, metW: 300, heatAvgW: 300, headingDeg: 0, routeSeq: 1 } });
    vi.advanceTimersByTime(1000); // > 1.5 s since the last heartbeat
    expect(visor.status()).toBe('degraded');
    visor.send(telem(0)); // degraded → held, not sent into a failing link
    expect(visor.queued()).toBe(1);
    vi.advanceTimersByTime(1000); // > 3 s
    expect(visor.status()).toBe('down');
    expect(hab.status()).toBe('down');
    expect(seen).toEqual(['degraded', 'down']);

    visor.send(telem(1));
    visor.send(telem(2));
    visor.send(telem(2)); // identical message → kept once
    expect(visor.queued()).toBe(3);
    vi.advanceTimersByTime(10_000);
    expect(telems).toEqual([]);

    pair.setConditions({ drop: false });
    vi.advanceTimersByTime(1100); // next heartbeat → up → flush
    expect(visor.status()).toBe('up');
    expect(telems).toEqual([0, 1, 2]);
    expect(visor.queued()).toBe(0);
    expect(seen.at(-1)).toBe('up');

    // further status flaps do not re-send already flushed messages
    pair.setConditions({ drop: true });
    vi.advanceTimersByTime(4000);
    pair.setConditions({ drop: false });
    vi.advanceTimersByTime(1100);
    expect(visor.status()).toBe('up');
    expect(telems).toEqual([0, 1, 2]);
    hab.close();
    visor.close();
  });

  it('closing one side takes the other down within 3 s', () => {
    const [hab, visor] = createMemoryLinkPair({ seed: 5 });
    vi.advanceTimersByTime(5);
    hab.close();
    expect(hab.status()).toBe('down');
    vi.advanceTimersByTime(3200);
    expect(visor.status()).toBe('down');
    visor.close();
  });
});

// ───────────────────────────── WebSocket link with a fake socket ─────────────────────────────

class FakeWS implements WebSocketLike {
  static all: FakeWS[] = [];
  readyState = 0;
  binaryType = 'blob';
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: LinkMsg[] = [];
  constructor(public url: string) {
    FakeWS.all.push(this);
  }
  send(data: Uint8Array) {
    this.sent.push(decodeMsg(data));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
  // server side helpers
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(m: LinkMsg) {
    this.onmessage?.({ data: encodeMsg(m).buffer });
  }
}

describe('WebSocket link (fake socket, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.all = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const hb = (seq: number): LinkMsg => ({ type: 'HEARTBEAT', from: 'hab', t: Date.now(), seq });

  it('builds the role URL', () => {
    expect(linkUrl('http://hab.local:8787/link', 'visor')).toBe('ws://hab.local:8787/link?role=visor');
    expect(linkUrl('wss://x/link?role=console', 'visor')).toBe('wss://x/link?role=console');
  });

  it('heartbeats at 1 Hz, tracks status, reconnects with backoff and flushes its queue', () => {
    const link = connectWebSocketLink('ws://hab/link', 'visor', { WebSocketImpl: FakeWS });
    const statuses: LinkStatus[] = [];
    link.onStatus((s) => statuses.push(s));
    expect(FakeWS.all).toHaveLength(1);
    const s1 = FakeWS.all[0];
    expect(s1.url).toContain('role=visor');
    expect(s1.binaryType).toBe('arraybuffer');
    expect(link.status()).toBe('down');

    s1.accept();
    expect(link.status()).toBe('down'); // open but nothing heard yet
    s1.push(hb(0));
    expect(link.status()).toBe('up');

    vi.advanceTimersByTime(1400);
    expect(link.status()).toBe('up');
    vi.advanceTimersByTime(200); // 1.6 s since the hab was last heard
    expect(link.status()).toBe('degraded');
    vi.advanceTimersByTime(1500); // 3.1 s
    expect(link.status()).toBe('down');
    const beats = s1.sent.filter((m) => m.type === 'HEARTBEAT');
    expect(beats.length).toBeGreaterThanOrEqual(4); // 1 on open + 1 Hz
    expect(beats.every((m) => m.type === 'HEARTBEAT' && m.from === 'visor')).toBe(true);
    expect(statuses).toEqual(['up', 'degraded', 'down']);

    // heard again → up
    s1.push(hb(1));
    expect(link.status()).toBe('up');
    vi.advanceTimersByTime(1600);
    expect(link.status()).toBe('degraded');
    s1.push(hb(2));
    expect(link.status()).toBe('up');

    // socket drops → down immediately, messages queue
    s1.close();
    expect(link.status()).toBe('down');
    link.send({ type: 'REQUEST', kind: 'ABORT', t: 99 });
    link.send({ type: 'REQUEST', kind: 'ABORT', t: 99 });
    expect(FakeWS.all).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(FakeWS.all).toHaveLength(1); // backoff ≥ 250 ms
    vi.advanceTimersByTime(200);
    expect(FakeWS.all).toHaveLength(2);
    const s2 = FakeWS.all[1];
    s2.close(); // connection refused → next attempt backs off further (≥ 500 ms)
    vi.advanceTimersByTime(450);
    expect(FakeWS.all).toHaveLength(2);
    vi.advanceTimersByTime(250);
    expect(FakeWS.all).toHaveLength(3);
    const s3 = FakeWS.all[2];
    s3.accept();
    expect(s3.sent.filter((m) => m.type === 'REQUEST')).toHaveLength(0); // still not 'up'
    s3.push(hb(3));
    expect(link.status()).toBe('up');
    expect(s3.sent.filter((m) => m.type === 'REQUEST')).toEqual([{ type: 'REQUEST', kind: 'ABORT', t: 99 }]);

    link.close();
    expect(s3.readyState).toBe(3);
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.all).toHaveLength(3); // no reconnect after close()
  });

  it('recycles a socket that went silent (dead-socket watchdog)', () => {
    const link = connectWebSocketLink('ws://hab/link', 'console', { WebSocketImpl: FakeWS, backoffMinMs: 100 });
    const s1 = FakeWS.all[0];
    s1.accept();
    s1.push(hb(0));
    vi.advanceTimersByTime(7200);
    expect(s1.readyState).toBe(3);
    expect(FakeWS.all.length).toBeGreaterThanOrEqual(2);
    expect(s1.sent.find((m) => m.type === 'HEARTBEAT')).toMatchObject({ from: 'hab' });
    link.close();
  });
});
