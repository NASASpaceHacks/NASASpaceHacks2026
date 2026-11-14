import { LinkCore, type Link, type LinkTiming } from './core';

/** Minimal WebSocket surface we use (browser WebSocket, Node ≥ 22 global WebSocket, or a test fake). */
export interface WebSocketLike {
  readyState: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface WsLinkOptions {
  /** Defaults to globalThis.WebSocket. */
  WebSocketImpl?: WebSocketCtor;
  timing?: Partial<LinkTiming>;
  /** Reconnect backoff: starts at min, doubles per failed attempt, capped at max (+ up to 25 % jitter). */
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** Force a reconnect when the socket is open but silent for this long (dead-socket detection). */
  staleReconnectMs?: number;
  maxQueue?: number;
}

const OPEN = 1;

/** Resolve '/link', 'http://host:8787/link' or 'ws://…' into a ws(s):// URL carrying ?role=. */
export function linkUrl(url: string, role: 'console' | 'visor'): string {
  const loc = (globalThis as { location?: { href: string } }).location;
  const u = new URL(url, loc?.href ?? 'ws://localhost/');
  if (u.protocol === 'http:') u.protocol = 'ws:';
  else if (u.protocol === 'https:') u.protocol = 'wss:';
  if (!u.searchParams.has('role')) u.searchParams.set('role', role);
  return u.toString();
}

/**
 * Surface link over a WebSocket (binary CBOR frames) to the hab server's `/link` endpoint.
 * Auto-reconnects with exponential backoff; HEARTBEAT 1 Hz; 'down' after 3 missed heartbeats;
 * store-and-forward queue flushed idempotently when the link comes back (see LinkCore).
 */
export function connectWebSocketLink(url: string, role: 'console' | 'visor', opts: WsLinkOptions = {}): Link {
  const Impl = opts.WebSocketImpl ?? ((globalThis as { WebSocket?: unknown }).WebSocket as WebSocketCtor | undefined);
  if (!Impl) throw new Error('connectWebSocketLink: no WebSocket implementation available');
  const target = linkUrl(url, role);
  const minMs = opts.backoffMinMs ?? 250;
  const maxMs = opts.backoffMaxMs ?? 5000;
  let ws: WebSocketLike | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const core = new LinkCore(
    {
      send(bytes) {
        if (!ws || ws.readyState !== OPEN) return false;
        try {
          ws.send(bytes);
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      from: role === 'visor' ? 'visor' : 'hab',
      timing: opts.timing,
      maxQueue: opts.maxQueue,
      onClose() {
        stopped = true;
        clearInterval(watchdog);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const s = ws;
        ws = null;
        try {
          s?.close(1000, 'client closed');
        } catch {
          /* ignore */
        }
      },
    },
  );
  const staleMs = opts.staleReconnectMs ?? core.timing.downMs * 2;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const base = Math.min(maxMs, minMs * 2 ** attempt);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, base * (1 + Math.random() * 0.25));
  };

  const connect = () => {
    if (stopped) return;
    let sock: WebSocketLike;
    try {
      sock = new Impl(target);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      if (ws !== sock) return;
      core.setOpen(true);
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      const d = ev.data;
      if (d instanceof ArrayBuffer) core.receive(new Uint8Array(d));
      else if (ArrayBuffer.isView(d)) core.receive(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
      else if (d && typeof (d as Blob).arrayBuffer === 'function') {
        (d as Blob).arrayBuffer().then((b) => ws === sock && core.receive(new Uint8Array(b)));
      } else return; // text frames are not part of the protocol
      attempt = 0; // heard the peer: reset backoff
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      core.setOpen(false);
      scheduleReconnect();
    };
    sock.onerror = () => {
      /* a close event follows */
    };
  };

  // Dead-socket watchdog: an open socket that has been silent too long is recycled.
  const watchdog = setInterval(() => {
    if (!ws || ws.readyState !== OPEN) return;
    const age = core.lastRxAgeMs();
    if (age !== null && age > staleMs) {
      const s = ws;
      ws = null;
      core.setOpen(false);
      try {
        s.close(4000, 'stale');
      } catch {
        /* ignore */
      }
      scheduleReconnect();
    }
  }, 1000);

  connect();
  return core;
}
