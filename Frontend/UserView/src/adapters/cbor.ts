/**
 * Minimal RFC 8949 CBOR codec. FALLBACK ONLY: used by the local WebSocket client when
 * `@mw/shared/link` (cbor-x based) is not available. Supports the subset LinkMsg needs:
 * unsigned/negative ints, float16/32/64, text/byte strings (definite + indefinite), arrays,
 * maps, booleans, null/undefined and RFC 8746 typed-array tags.
 */

const te = new TextEncoder();
const td = new TextDecoder();

class Writer {
  buf: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  dv = new DataView(this.buf.buffer);
  p = 0;
  ensure(n: number) {
    if (this.p + n <= this.buf.length) return;
    let len = this.buf.length * 2;
    while (len < this.p + n) len *= 2;
    const nb = new Uint8Array(len);
    nb.set(this.buf);
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.buf[this.p++] = v;
  }
  head(major: number, n: number) {
    const m = major << 5;
    if (n < 24) this.u8(m | n);
    else if (n < 0x100) {
      this.u8(m | 24);
      this.u8(n);
    } else if (n < 0x10000) {
      this.u8(m | 25);
      this.ensure(2);
      this.dv.setUint16(this.p, n);
      this.p += 2;
    } else if (n < 0x100000000) {
      this.u8(m | 26);
      this.ensure(4);
      this.dv.setUint32(this.p, n);
      this.p += 4;
    } else {
      this.u8(m | 27);
      this.ensure(8);
      this.dv.setBigUint64(this.p, BigInt(n));
      this.p += 8;
    }
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.p);
    this.p += b.length;
  }
}

function enc(w: Writer, v: unknown): void {
  if (v === null) return w.u8(0xf6);
  if (v === undefined) return w.u8(0xf7);
  if (v === true) return w.u8(0xf5);
  if (v === false) return w.u8(0xf4);
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) {
      return v >= 0 ? w.head(0, v) : w.head(1, -1 - v);
    }
    w.u8(0xfb);
    w.ensure(8);
    w.dv.setFloat64(w.p, v);
    w.p += 8;
    return;
  }
  if (typeof v === 'string') {
    const b = te.encode(v);
    w.head(3, b.length);
    return w.bytes(b);
  }
  if (v instanceof Uint8Array) {
    w.head(2, v.length);
    return w.bytes(v);
  }
  if (ArrayBuffer.isView(v)) {
    const arr = Array.from(v as unknown as ArrayLike<number>);
    return enc(w, arr);
  }
  if (Array.isArray(v)) {
    w.head(4, v.length);
    for (const x of v) enc(w, x);
    return;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    w.head(5, entries.length);
    for (const [k, x] of entries) {
      enc(w, k);
      enc(w, x);
    }
    return;
  }
  throw new Error(`cbor: unsupported ${typeof v}`);
}

export function cborEncode(v: unknown): Uint8Array<ArrayBuffer> {
  const w = new Writer();
  enc(w, v);
  return w.buf.slice(0, w.p);
}

function f16(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** RFC 8746 little-endian typed-array tags (what cbor-x emits for typed arrays). */
const TYPED: Record<number, new (b: ArrayBuffer) => ArrayLike<number>> = {
  64: Uint8Array,
  68: Uint8ClampedArray,
  69: Uint16Array,
  70: Uint32Array,
  72: Int8Array,
  77: Int16Array,
  78: Int32Array,
  85: Float32Array,
  86: Float64Array,
};

const BREAK = Symbol('break');

export function cborDecode(b: Uint8Array): unknown {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const len = (ai: number): number => {
    if (ai < 24) return ai;
    if (ai === 24) return b[p++];
    if (ai === 25) {
      const v = dv.getUint16(p);
      p += 2;
      return v;
    }
    if (ai === 26) {
      const v = dv.getUint32(p);
      p += 4;
      return v;
    }
    if (ai === 27) {
      const v = Number(dv.getBigUint64(p));
      p += 8;
      return v;
    }
    if (ai === 31) return -1;
    throw new Error('cbor: bad length');
  };
  const item = (): unknown => {
    if (p >= b.length) throw new Error('cbor: truncated');
    const ib = b[p++];
    const mt = ib >> 5;
    const ai = ib & 31;
    switch (mt) {
      case 0:
        return len(ai);
      case 1:
        return -1 - len(ai);
      case 2:
      case 3: {
        const n = len(ai);
        let bytes: Uint8Array;
        if (n < 0) {
          const parts: Uint8Array[] = [];
          for (;;) {
            if (b[p] === 0xff) {
              p++;
              break;
            }
            parts.push(item() as Uint8Array);
          }
          const total = parts.reduce((a, x) => a + (typeof x === 'string' ? te.encode(x).length : x.length), 0);
          bytes = new Uint8Array(total);
          let o = 0;
          for (const x of parts) {
            const xb = typeof x === 'string' ? te.encode(x) : x;
            bytes.set(xb, o);
            o += xb.length;
          }
        } else {
          bytes = b.slice(p, p + n);
          p += n;
        }
        return mt === 3 ? td.decode(bytes) : bytes;
      }
      case 4: {
        const n = len(ai);
        const out: unknown[] = [];
        if (n < 0) {
          for (;;) {
            const x = item();
            if (x === BREAK) break;
            out.push(x);
          }
        } else for (let i = 0; i < n; i++) out.push(item());
        return out;
      }
      case 5: {
        const n = len(ai);
        const out: Record<string, unknown> = {};
        if (n < 0) {
          for (;;) {
            const k = item();
            if (k === BREAK) break;
            out[String(k)] = item();
          }
        } else
          for (let i = 0; i < n; i++) {
            const k = item();
            out[String(k)] = item();
          }
        return out;
      }
      case 6: {
        const tag = len(ai);
        const v = item();
        const C = TYPED[tag];
        if (C && v instanceof Uint8Array) {
          const copy = v.slice().buffer;
          return Array.from(new C(copy));
        }
        return v;
      }
      default: {
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 23) return undefined;
        if (ai === 25) {
          const v = f16(dv.getUint16(p));
          p += 2;
          return v;
        }
        if (ai === 26) {
          const v = dv.getFloat32(p);
          p += 4;
          return v;
        }
        if (ai === 27) {
          const v = dv.getFloat64(p);
          p += 8;
          return v;
        }
        if (ai === 31) return BREAK;
        if (ai < 24) return ai;
        throw new Error('cbor: bad simple');
      }
    }
  };
  return item();
}
