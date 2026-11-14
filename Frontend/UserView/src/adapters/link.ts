/**
 * Surface-link adapter.
 * Preferred: `connectWebSocketLink` from `@mw/shared/link` (B4). Fallback: a minimal WebSocket
 * client with the same `Link` interface (binary CBOR frames, 1 Hz HEARTBEAT, 'down' after 3 s of
 * silence, auto-reconnect). `withLocalDrop` wraps any link so the demo panel can simulate a drop.
 */
import { LinkMsgSchema, type LinkMsg } from '@mw/shared/contracts';
import { connectWebSocketLink, verifyPackage } from '@mw/shared/link';
import type { PlanPackage } from '@mw/shared/contracts';
import { cborDecode, cborEncode } from './cbor';

export type LinkStatus = 'up' | 'degraded' | 'down';

export interface Link {
  send(m: LinkMsg): void;
  onMessage(cb: (m: LinkMsg) => void): () => void;
  onStatus(cb: (s: LinkStatus) => void): () => void;
  status(): LinkStatus;
  close(): void;
}

/** Which implementation is live (shown in the demo panel and the final report). */
export const linkImpl: { ws: 'shared' | 'fallback' } = { ws: 'fallback' };

export function visorLinkUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/link`;
}

/** Small event hub shared by the link implementations. */
export class Hub<T> {
  private subs = new Set<(v: T) => void>();
  on(cb: (v: T) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  emit(v: T) {
    for (const cb of [...this.subs]) {
      try {
        cb(v);
      } catch (e) {
        console.warn('[link] subscriber failed', e);
      }
    }
  }
}

/** Fallback WebSocket link (used only when the shared link module is unavailable). */
export function fallbackWebSocketLink(url: string): Link {
  const msgs = new Hub<LinkMsg>();
  const stats = new Hub<LinkStatus>();
  let ws: WebSocket | null = null;
  let st: LinkStatus = 'down';
  let lastRx = 0;
  let hbSeq = 0;
  let closed = false;
  let backoff = 1000;
  let reconnectTimer: number | undefined;

  const setStatus = (s: LinkStatus) => {
    if (s === st) return;
    st = s;
    stats.emit(s);
  };

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      backoff = 1000;
      lastRx = performance.now();
      setStatus('up');
    };
    ws.onmessage = (ev) => {
      lastRx = performance.now();
      try {
        const raw = ev.data instanceof ArrayBuffer ? cborDecode(new Uint8Array(ev.data)) : JSON.parse(String(ev.data));
        const parsed = LinkMsgSchema.safeParse(raw);
        if (!parsed.success) return;
        msgs.emit(parsed.data as LinkMsg);
      } catch {
        /* malformed frame: ignore */
      }
    };
    ws.onclose = () => {
      ws = null;
      setStatus('down');
      scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, backoff);
    backoff = Math.min(5000, backoff * 1.6);
  };

  const hb = window.setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const silent = performance.now() - lastRx;
    setStatus(silent > 3000 ? 'down' : silent > 1500 ? 'degraded' : 'up');
    try {
      ws.send(cborEncode({ type: 'HEARTBEAT', from: 'visor', t: Date.now(), seq: ++hbSeq }));
    } catch {
      /* ignore */
    }
  }, 1000);

  connect();

  return {
    send(m) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(cborEncode(m));
    },
    onMessage: (cb) => msgs.on(cb),
    onStatus: (cb) => stats.on(cb),
    status: () => st,
    close() {
      closed = true;
      window.clearInterval(hb);
      window.clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}

export function connectVisorLink(url = visorLinkUrl()): Link {
  try {
    const l = connectWebSocketLink(url, 'visor') as unknown as Link;
    linkImpl.ws = 'shared';
    return l;
  } catch (e) {
    console.warn('[visor] shared link unavailable, using local WebSocket client', e);
    linkImpl.ws = 'fallback';
    return fallbackWebSocketLink(`${url}?role=visor`);
  }
}

/** A link wrapper whose status can be forced to 'down' locally (demo: "simulate link drop"). */
export interface DroppableLink extends Link {
  setDropped(d: boolean): void;
  dropped(): boolean;
}

export function withLocalDrop(inner: Link): DroppableLink {
  const msgs = new Hub<LinkMsg>();
  const stats = new Hub<LinkStatus>();
  let drop = false;
  const eff = (): LinkStatus => (drop ? 'down' : inner.status());
  let last = eff();
  const push = () => {
    const s = eff();
    if (s !== last) {
      last = s;
      stats.emit(s);
    }
  };
  const u1 = inner.onMessage((m) => {
    if (!drop) msgs.emit(m);
  });
  const u2 = inner.onStatus(push);
  return {
    send(m) {
      if (!drop) inner.send(m);
    },
    onMessage: (cb) => msgs.on(cb),
    onStatus: (cb) => stats.on(cb),
    status: eff,
    close() {
      u1();
      u2();
      inner.close();
    },
    setDropped(d) {
      drop = d;
      push();
    },
    dropped: () => drop,
  };
}

/** Ed25519 route-package signature check (B4's verifyPackage; never throws). */
export async function verifyRoute(pkg: PlanPackage, publicKeyHex: string): Promise<boolean> {
  try {
    return await verifyPackage(pkg, publicKeyHex);
  } catch {
    return false;
  }
}
