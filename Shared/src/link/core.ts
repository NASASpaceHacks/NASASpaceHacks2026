import type { LinkMsg } from '../contracts/types';
import { decodeMsg, encodeMsg, msgKey } from './codec';

export type LinkStatus = 'up' | 'degraded' | 'down';

export interface Link {
  send(m: LinkMsg): void;
  onMessage(cb: (m: LinkMsg) => void): () => void;
  onStatus(cb: (s: LinkStatus) => void): () => void;
  status(): LinkStatus;
  close(): void;
}

/** Demo link-degradation controls (applied by MemoryLink and by the hab server's relay). */
export interface LinkConditions {
  latencyMs: number;
  lossPct: number;
  /** true = radio silence: nothing is delivered in either direction, heartbeats included. */
  drop: boolean;
}

export const NOMINAL_CONDITIONS: LinkConditions = { latencyMs: 0, lossPct: 0, drop: false };

export interface LinkTiming {
  /** HEARTBEAT period (design doc §6: 1 Hz). */
  heartbeatMs: number;
  /** Last frame older than this → 'degraded'. */
  degradedMs: number;
  /** Last frame older than this (3 missed heartbeats) → 'down' (visor goes AUTONOMOUS). */
  downMs: number;
  /** Status re-evaluation period. */
  tickMs: number;
}

export const LINK_TIMING: LinkTiming = { heartbeatMs: 1000, degradedMs: 1500, downMs: 3000, tickMs: 100 };

/** Status from the age of the last frame heard from the peer (null = nothing heard on this connection). */
export function statusFromAge(ageMs: number | null, t: Pick<LinkTiming, 'degradedMs' | 'downMs'> = LINK_TIMING): LinkStatus {
  if (ageMs === null || ageMs > t.downMs) return 'down';
  return ageMs > t.degradedMs ? 'degraded' : 'up';
}

export interface Transport {
  /** Hand bytes to the transport. Return false if it cannot accept them now (not connected). */
  send(bytes: Uint8Array): boolean;
}

export interface LinkCoreOptions {
  from: 'hab' | 'visor';
  timing?: Partial<LinkTiming>;
  /** Max queued messages while down (oldest evicted first). */
  maxQueue?: number;
  now?: () => number;
  onClose?: () => void;
}

/**
 * Transport-independent link state machine shared by the WebSocket and in-memory links.
 *
 * - Sends HEARTBEAT at 1 Hz while the transport is open.
 * - Status from the age of the last frame heard: ≤1.5 s 'up', >1.5 s 'degraded', >3 s 'down'.
 * - Store-and-forward: while not 'up' (degraded or down) messages are queued, keyed by `msgKey`
 *   (an identical message queued twice is kept once). On every return to 'up' the queue is
 *   flushed in order and each entry is removed as it is handed to the transport, so a flush
 *   that is interrupted and resumed never sends an entry twice (idempotent). HEARTBEATs are
 *   never queued.
 * - Inbound: every valid frame is delivered to `onMessage` (HEARTBEAT included). The hab
 *   re-sends ROUTE_PUSH to resync after a reconnect/un-drop: handle it idempotently by `pkg.id`
 *   and re-ACK.
 */
export class LinkCore implements Link {
  readonly timing: LinkTiming;
  private msgCbs = new Set<(m: LinkMsg) => void>();
  private statusCbs = new Set<(s: LinkStatus) => void>();
  private lastRx: number | null = null;
  private open = false;
  private closed = false;
  private cur: LinkStatus = 'down';
  private queue = new Map<string, Uint8Array>();
  private hbSeq = 0;
  private hbTimer: ReturnType<typeof setInterval>;
  private tickTimer: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  /** Count of inbound frames rejected by the codec (for diagnostics). */
  rejected = 0;

  constructor(private transport: Transport, private opts: LinkCoreOptions) {
    this.timing = { ...LINK_TIMING, ...opts.timing };
    this.now = opts.now ?? (() => Date.now());
    this.hbTimer = setInterval(() => this.heartbeat(), this.timing.heartbeatMs);
    this.tickTimer = setInterval(() => this.evaluate(), this.timing.tickMs);
  }

  // ── Link API ──
  send(m: LinkMsg): void {
    if (this.closed) return;
    const bytes = encodeMsg(m);
    if (m.type === 'HEARTBEAT') {
      if (this.open) this.transport.send(bytes);
      return;
    }
    if (this.status() === 'up' && this.queue.size === 0 && this.open && this.transport.send(bytes)) return;
    this.enqueue(msgKey(m), bytes);
    if (this.cur === 'up') this.flush();
  }

  onMessage(cb: (m: LinkMsg) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  onStatus(cb: (s: LinkStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  status(): LinkStatus {
    this.evaluate();
    return this.cur;
  }

  close(): void {
    if (this.closed) return;
    clearInterval(this.hbTimer);
    clearInterval(this.tickTimer);
    this.open = false;
    this.lastRx = null;
    this.evaluate();
    this.closed = true;
    this.opts.onClose?.();
    this.msgCbs.clear();
    this.statusCbs.clear();
  }

  // ── Transport hooks ──
  /** Number of messages waiting for the link to come back. */
  queued(): number {
    return this.queue.size;
  }

  setOpen(open: boolean): void {
    if (this.closed) return;
    this.open = open;
    if (!open) this.lastRx = null; // 'up' again only after hearing the peer on the new connection
    this.evaluate();
    if (open) this.heartbeat();
  }

  isClosed(): boolean {
    return this.closed;
  }

  /** Age (ms) of the last frame heard, or null. */
  lastRxAgeMs(): number | null {
    return this.lastRx === null ? null : this.now() - this.lastRx;
  }

  receive(bytes: Uint8Array): void {
    if (this.closed) return;
    let m: LinkMsg;
    try {
      m = decodeMsg(bytes);
    } catch {
      this.rejected++;
      return;
    }
    this.lastRx = this.now();
    this.evaluate();
    for (const cb of [...this.msgCbs]) {
      try {
        cb(m);
      } catch (e) {
        console.error('[link] onMessage handler threw', e);
      }
    }
  }

  // ── internals ──
  private heartbeat(): void {
    if (!this.open || this.closed) return;
    this.transport.send(encodeMsg({ type: 'HEARTBEAT', from: this.opts.from, t: this.now(), seq: this.hbSeq++ }));
  }

  private enqueue(key: string, bytes: Uint8Array): void {
    if (this.queue.has(key)) return; // identical message already waiting
    this.queue.set(key, bytes);
    const max = this.opts.maxQueue ?? 1000;
    while (this.queue.size > max) this.queue.delete(this.queue.keys().next().value as string);
  }

  private flush(): void {
    for (const [key, bytes] of [...this.queue]) {
      if (!this.open || !this.transport.send(bytes)) return;
      this.queue.delete(key);
    }
  }

  private evaluate(): void {
    if (this.closed) return;
    const s = this.open ? statusFromAge(this.lastRx === null ? null : this.now() - this.lastRx, this.timing) : 'down';
    if (s === this.cur) return;
    this.cur = s;
    if (s === 'up') this.flush();
    for (const cb of [...this.statusCbs]) {
      try {
        cb(s);
      } catch (e) {
        console.error('[link] onStatus handler threw', e);
      }
    }
  }
}
