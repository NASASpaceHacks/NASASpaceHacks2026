import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { LinkMsg, PlanPackage } from '@mw/shared/contracts';
import {
  LINK_TIMING,
  NOMINAL_CONDITIONS,
  decodeMsg,
  encodeMsg,
  msgKey,
  statusFromAge,
  type LinkConditions,
  type LinkStatus,
} from '@mw/shared/link';

type Role = 'console' | 'visor';
interface Client {
  ws: WebSocket;
  role: Role;
}

export interface HubHooks {
  onVisorMsg(m: LinkMsg): void;
  onConsoleMsg(m: LinkMsg): void;
  onVisorStatus(s: LinkStatus, prev: LinkStatus): void;
  /** Current confirmed route and whether it still awaits the visor's ACK. */
  route(): { pkg: PlanPackage; pending: boolean } | null;
}

export interface HubOptions {
  heartbeatMs?: number;
  /** Re-send an un-ACKed ROUTE_PUSH this often. */
  routeResendMs?: number;
  rnd?: () => number;
}

const toBytes = (d: RawData): Uint8Array =>
  Array.isArray(d) ? new Uint8Array(Buffer.concat(d)) : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);

/**
 * Surface-link hub on `/link?role=console|visor`.
 *
 * - HEARTBEAT (from 'hab') at 1 Hz to every client.
 * - Visor → hab: TELEM / ACK / REQUEST / ALERT handed to hooks (which relay to consoles).
 * - Console → visor: ALERT relayed.
 * - Link conditions (latency / loss / drop) apply to everything between the hab and the VISOR,
 *   both directions, heartbeats included. Consoles are on the hab LAN and unaffected.
 * - Drop = radio silence: nothing relayed, no heartbeats; outbound ALERTs are held and flushed
 *   on un-drop, then the current route is re-sent (the visor handles it idempotently by id).
 */
export class Hub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4 << 20 });
  private clients = new Set<Client>();
  private cond: LinkConditions = { ...NOMINAL_CONDITIONS };
  private held = new Map<string, Uint8Array>();
  private lastVisorRx: number | null = null;
  private visorStat: LinkStatus = 'down';
  private hbSeq = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private delayed = new Set<ReturnType<typeof setTimeout>>();
  private rnd: () => number;

  constructor(private hooks: HubHooks, opts: HubOptions = {}) {
    this.rnd = opts.rnd ?? Math.random;
    this.timers.push(setInterval(() => this.heartbeat(), opts.heartbeatMs ?? LINK_TIMING.heartbeatMs));
    this.timers.push(setInterval(() => this.evalStatus(), 100));
    this.timers.push(
      setInterval(() => {
        const r = this.hooks.route();
        if (r?.pending && !this.cond.drop) this.sendToVisors({ type: 'ROUTE_PUSH', pkg: r.pkg });
      }, opts.routeResendMs ?? 5000),
    );
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://hab');
      if (url.pathname !== '/link') {
        socket.destroy();
        return;
      }
      const role = url.searchParams.get('role');
      if (role !== 'console' && role !== 'visor') {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nrole must be console or visor');
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, role));
    });
  }

  private onConnection(ws: WebSocket, role: Role): void {
    const c: Client = { ws, role };
    this.clients.add(c);
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const bytes = toBytes(data);
      if (role === 'visor') this.fromVisor(bytes);
      else this.fromConsole(bytes);
    });
    ws.on('close', () => {
      this.clients.delete(c);
      this.evalStatus();
    });
    ws.on('error', () => {
      /* close follows */
    });
    const hb = this.hbBytes();
    if (role === 'console') {
      this.rawSend(c, hb);
    } else if (!this.cond.drop) {
      this.toVisor(c, hb);
      const r = this.hooks.route();
      if (r) this.toVisor(c, encodeMsg({ type: 'ROUTE_PUSH', pkg: r.pkg })); // resync a (re)connecting visor
    }
  }

  // ── inbound ──
  private fromVisor(bytes: Uint8Array): void {
    if (this.cond.drop) return;
    if (this.cond.lossPct > 0 && this.rnd() * 100 < this.cond.lossPct) return;
    this.later(() => {
      let m: LinkMsg;
      try {
        m = decodeMsg(bytes);
      } catch {
        return;
      }
      this.lastVisorRx = Date.now();
      this.evalStatus();
      if (m.type !== 'HEARTBEAT') this.hooks.onVisorMsg(m);
    });
  }

  private fromConsole(bytes: Uint8Array): void {
    let m: LinkMsg;
    try {
      m = decodeMsg(bytes);
    } catch {
      return;
    }
    if (m.type !== 'HEARTBEAT') this.hooks.onConsoleMsg(m);
  }

  // ── outbound ──
  /** Send to every visor through the (possibly degraded) surface link. Returns visors addressed. */
  sendToVisors(m: LinkMsg): number {
    const bytes = encodeMsg(m);
    if (this.cond.drop) {
      if (m.type !== 'HEARTBEAT' && m.type !== 'ROUTE_PUSH') this.held.set(msgKey(m), bytes);
      return 0;
    }
    let n = 0;
    for (const c of this.clients) {
      if (c.role !== 'visor') continue;
      this.toVisor(c, bytes);
      n++;
    }
    return n;
  }

  sendToConsoles(m: LinkMsg): void {
    const bytes = encodeMsg(m);
    for (const c of this.clients) if (c.role === 'console') this.rawSend(c, bytes);
  }

  conditions(): LinkConditions {
    return { ...this.cond };
  }

  setConditions(patch: Partial<LinkConditions>): LinkConditions {
    const wasDropped = this.cond.drop;
    this.cond = {
      latencyMs: patch.latencyMs ?? this.cond.latencyMs,
      lossPct: patch.lossPct ?? this.cond.lossPct,
      drop: patch.drop ?? this.cond.drop,
    };
    if (wasDropped && !this.cond.drop) this.resync();
    return this.conditions();
  }

  visorStatus(): LinkStatus {
    this.evalStatus();
    return this.visorStat;
  }

  counts(): { visors: number; consoles: number } {
    let visors = 0, consoles = 0;
    for (const c of this.clients) c.role === 'visor' ? visors++ : consoles++;
    return { visors, consoles };
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    for (const t of this.delayed) clearTimeout(t);
    this.delayed.clear();
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }

  // ── internals ──
  private resync(): void {
    const visors = [...this.clients].filter((c) => c.role === 'visor');
    const hb = this.hbBytes();
    const held = [...this.held.values()];
    this.held.clear();
    const r = this.hooks.route();
    for (const c of visors) {
      this.toVisor(c, hb); // heard immediately → visor back 'up' → it flushes its own queue
      for (const b of held) this.toVisor(c, b);
      if (r) this.toVisor(c, encodeMsg({ type: 'ROUTE_PUSH', pkg: r.pkg }));
    }
  }

  private heartbeat(): void {
    const hb = this.hbBytes();
    for (const c of this.clients) {
      if (c.role === 'console') this.rawSend(c, hb);
      else if (!this.cond.drop) this.toVisor(c, hb);
    }
  }

  private hbBytes(): Uint8Array {
    return encodeMsg({ type: 'HEARTBEAT', from: 'hab', t: Date.now(), seq: this.hbSeq++ });
  }

  /** Visor-bound frame through loss + latency (drop is handled by callers). */
  private toVisor(c: Client, bytes: Uint8Array): void {
    if (this.cond.lossPct > 0 && this.rnd() * 100 < this.cond.lossPct) return;
    this.later(() => this.rawSend(c, bytes));
  }

  private later(fn: () => void): void {
    const ms = this.cond.latencyMs;
    if (ms <= 0) return fn();
    const h = setTimeout(() => {
      this.delayed.delete(h);
      fn();
    }, ms);
    this.delayed.add(h);
  }

  private rawSend(c: Client, bytes: Uint8Array): void {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(bytes, { binary: true });
  }

  private evalStatus(): void {
    const anyVisor = [...this.clients].some((c) => c.role === 'visor');
    const s: LinkStatus = anyVisor ? statusFromAge(this.lastVisorRx === null ? null : Date.now() - this.lastVisorRx) : 'down';
    if (s === this.visorStat) return;
    const prev = this.visorStat;
    this.visorStat = s;
    this.hooks.onVisorStatus(s, prev);
  }
}
