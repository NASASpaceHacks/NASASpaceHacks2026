import { Encoder } from 'cbor-x';
import { LinkMsgSchema } from '../contracts/schemas';
import type { LinkMsg } from '../contracts/types';

/**
 * CBOR codec for the surface link (RFC 8949). Pure: runs in browsers, Web Workers and Node.
 *
 * - Objects are encoded as plain CBOR maps (no cbor-x record extension) with minimal-length
 *   headers, so any CBOR decoder (e.g. a microcontroller on a future visor) can parse frames.
 * - `decodeMsg` validates every inbound frame with `LinkMsgSchema` (a trust boundary).
 */
const cbor = new Encoder({ useRecords: false, mapsAsObjects: true, variableMapSize: true, tagUint8Array: false });

export class LinkDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkDecodeError';
  }
}

/** Encode a link message as CBOR. Returns a fresh, exactly-sized Uint8Array. */
export function encodeMsg(m: LinkMsg): Uint8Array {
  return Uint8Array.from(cbor.encode(m));
}

/** Decode + validate a CBOR link frame. Throws `LinkDecodeError` on malformed CBOR or schema mismatch. */
export function decodeMsg(b: Uint8Array | ArrayBuffer): LinkMsg {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let raw: unknown;
  try {
    raw = cbor.decode(bytes);
  } catch (e) {
    throw new LinkDecodeError(`bad CBOR: ${(e as Error).message}`);
  }
  const r = LinkMsgSchema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new LinkDecodeError(`invalid LinkMsg: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim());
  }
  return r.data as LinkMsg;
}

/**
 * Identity key of a message, used for idempotent store-and-forward: a message whose key is
 * already waiting in the queue is not queued again.
 */
export function msgKey(m: LinkMsg): string {
  switch (m.type) {
    case 'ROUTE_PUSH':
      return `R:${m.pkg.id}:${m.pkg.seq}`;
    case 'ACK':
      return `A:${m.id}:${m.seq}:${m.accepted ? 1 : 0}`;
    case 'TELEM':
      return `T:${m.telem.routeSeq}:${m.telem.t}:${m.telem.cell}`;
    case 'ALERT':
      return `L:${m.level}:${m.code}:${m.t}:${m.text}`;
    case 'REQUEST':
      return `Q:${m.kind}:${m.t}:${m.cell ?? ''}:${m.note ?? ''}`;
    case 'HEARTBEAT':
      return `H:${m.from}:${m.seq}`;
  }
}

// ───────────────────────────── Canonical CBOR (for signatures) ─────────────────────────────

function compareKeys(a: string, b: string): number {
  // RFC 7049 §3.9 canonical map ordering for text keys: shorter first, then bytewise.
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canonicalize(x)));
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort(compareKeys)) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canonicalize(x);
    }
    return out;
  }
  return v;
}

/**
 * Deterministic CBOR: map keys sorted (length-first, then lexicographic), `undefined` members
 * dropped, typed arrays as plain arrays, minimal-length heads, non-integers as float64.
 * Same input value → same bytes on every platform; used as the Ed25519 signing input.
 */
export function canonicalCbor(v: unknown): Uint8Array {
  return Uint8Array.from(cbor.encode(canonicalize(v)));
}

/** Decode CBOR produced by `canonicalCbor`/`encodeMsg` without schema validation. */
export function decodeCbor(b: Uint8Array): unknown {
  return cbor.decode(b);
}
