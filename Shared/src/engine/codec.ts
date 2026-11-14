import { Decoder, Encoder } from 'cbor-x';
import { deflateSync, inflateSync } from 'fflate';
import { rulesHash } from '../contracts/rules';
import type { CoarseSafetyGrid, FieldSet, GridSpec, PlanPackage, PlanRequest, PlanResult, RuleId } from '../contracts/types';
import { hashString, mergeRules } from './fields';

/** Coarse safety grid cell size (m) carried in every route package (visor autonomy on link loss). */
export const COARSE_CELL_M = 50;
export const COARSE_UNREACHABLE = 65535;
/** Route-package budget: Curiosity's daily uplink is ≈28 KB; we gate at 25,000 B. */
export const PACKAGE_MAX_BYTES = 25_000;

/**
 * Conservative coarse grid: each block holds the MAX minutes over its passable cells (ceil to whole
 * minutes), 65535 when no cell of the block can reach safety. Block = round(50 m / cellM) cells.
 */
export function coarsen(field: Float32Array, w: number, h: number, cellM: number, blockM = COARSE_CELL_M): { cellM: number; w: number; h: number; data: number[] } {
  const b = Math.max(1, Math.round(blockM / cellM));
  const cw = Math.ceil(w / b), ch = Math.ceil(h / b);
  const data = new Array<number>(cw * ch);
  for (let br = 0; br < ch; br++) {
    for (let bc = 0; bc < cw; bc++) {
      let mx = -1;
      for (let r = br * b; r < Math.min(h, (br + 1) * b); r++) {
        for (let c = bc * b; c < Math.min(w, (bc + 1) * b); c++) {
          const v = field[r * w + c];
          if (v < Infinity && v > mx) mx = v;
        }
      }
      data[br * cw + bc] = mx < 0 ? COARSE_UNREACHABLE : Math.min(COARSE_UNREACHABLE - 1, Math.ceil(mx));
    }
  }
  return { cellM: b * cellM, w: cw, h: ch, data };
}

/** Coarse LOS: 1 when ≥ 50 % of a block's fine cells see the hab mast. */
export function coarsenLos(los: Uint8Array, w: number, h: number, cellM: number, blockM = COARSE_CELL_M): number[] {
  const b = Math.max(1, Math.round(blockM / cellM));
  const cw = Math.ceil(w / b), ch = Math.ceil(h / b);
  const out = new Array<number>(cw * ch);
  for (let br = 0; br < ch; br++) {
    for (let bc = 0; bc < cw; bc++) {
      let vis = 0, tot = 0;
      for (let r = br * b; r < Math.min(h, (br + 1) * b); r++) {
        for (let c = bc * b; c < Math.min(w, (bc + 1) * b); c++) {
          vis += los[r * w + c];
          tot++;
        }
      }
      out[br * cw + bc] = 2 * vis >= tot ? 1 : 0;
    }
  }
  return out;
}

/** Build the route package pushed to the visor (sig is added by the Backend). */
export function toPlanPackage(
  res: PlanResult, req: PlanRequest, fields: FieldSet, grid: GridSpec,
  opts: { seq: number; parent?: string; author: 'hab' | 'earth' },
): PlanPackage {
  const wbk = coarsen(fields.walkbackMin, grid.w, grid.h, grid.cellM);
  const shc = coarsen(fields.shelterMin, grid.w, grid.h, grid.cellM);
  const coarse: CoarseSafetyGrid = {
    cellM: wbk.cellM, w: wbk.w, h: wbk.h, walkbackMin: wbk.data, shelterMin: shc.data,
    los: coarsenLos(fields.los, grid.w, grid.h, grid.cellM),
  };
  // Route = concatenation of the segments' cell lists. Each stop therefore appears twice in a row
  // (end of one leg + start of the next): the safety core uses these repeats as stop markers.
  const route: number[] = [];
  for (const s of res.segments) for (const c of s.cells) route.push(c);
  const createdUtc = new Date().toISOString();
  const id = hashString(`${res.reqHash}|${opts.seq}|${opts.author}|${opts.parent ?? ''}|${createdUtc}`);
  const pkg: PlanPackage = {
    v: 1,
    id: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}`,
    seq: opts.seq,
    author: opts.author,
    createdUtc,
    siteId: req.siteId,
    rulesHash: rulesHash(req.rules),
    route,
    stops: res.stops.map((s) => ({ ...s })),
    order: [...res.order],
    bingo: res.bingo.map((b) => ({ ...b })),
    startLtstMin: req.startLtstMin,
    sol: req.sol,
    coarse,
    // the rule values this route was planned under (DEFAULT_RULES fill any rule the request omits)
    rules: mergeRules(req.rules).map((r) => ({ id: r.id, value: r.value, enabled: r.enabled })),
    sig: '',
  };
  if (opts.parent !== undefined) pkg.parent = opts.parent;
  return pkg;
}

// ─────────────────────────── wire format ───────────────────────────

const zig = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzig = (z: number) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

function writeVarints(vals: number[]): Uint8Array {
  const out: number[] = [];
  for (let v of vals) {
    while (v >= 0x80) {
      out.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    out.push(v);
  }
  return Uint8Array.from(out);
}

function readVarints(b: Uint8Array): number[] {
  const out: number[] = [];
  let v = 0, mul = 1;
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    v += (x & 0x7f) * mul;
    if (x & 0x80) mul *= 0x80;
    else {
      out.push(v);
      v = 0;
      mul = 1;
    }
  }
  return out;
}

/** Row-delta coding: each row minus the row above (zigzag varints). */
function rowDelta(data: number[], w: number): Uint8Array {
  const d: number[] = new Array(data.length);
  for (let i = 0; i < data.length; i++) d[i] = zig(i < w ? data[i] : data[i] - data[i - w]);
  return writeVarints(d);
}

function rowUndelta(b: Uint8Array, w: number): number[] {
  const d = readVarints(b).map(unzig);
  for (let i = w; i < d.length; i++) d[i] += d[i - w];
  return d;
}

/**
 * Route as chain codes: consecutive-cell deltas are drawn from a tiny dictionary (the 8 neighbour
 * moves plus 0 for the stop repeats; any other jump is just another dictionary entry), so the code
 * stream is one byte per step and needs no grid width.
 */
function chainEncode(route: number[]): { r0: number; dict: Uint8Array; codes: Uint8Array } | { r0: number; deltas: Uint8Array } {
  if (route.length === 0) return { r0: -1, deltas: new Uint8Array(0) };
  const deltas: number[] = [];
  for (let i = 1; i < route.length; i++) deltas.push(route[i] - route[i - 1]);
  const uniq = [...new Set(deltas)].sort((a, b) => a - b);
  if (uniq.length <= 256) {
    const idx = new Map(uniq.map((d, i) => [d, i]));
    return { r0: route[0], dict: writeVarints(uniq.map(zig)), codes: Uint8Array.from(deltas.map((d) => idx.get(d)!)) };
  }
  return { r0: route[0], deltas: writeVarints(deltas.map(zig)) };
}

function chainDecode(o: { r0: number; dict?: Uint8Array; codes?: Uint8Array; deltas?: Uint8Array }): number[] {
  if (o.r0 < 0) return [];
  const route = [o.r0];
  const deltas = o.dict && o.codes ? (() => {
    const dict = readVarints(o.dict!).map(unzig);
    return Array.from(o.codes!, (k) => dict[k]);
  })() : readVarints(o.deltas!).map(unzig);
  for (const d of deltas) route.push(route[route.length - 1] + d);
  return route;
}

function packBits(bits: number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

function unpackBits(b: Uint8Array, n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = (b[i >> 3] >> (i & 7)) & 1;
  return out;
}

/** Recursively sort object keys (canonical form for deterministic CBOR). */
function canon(v: unknown): unknown {
  if (v === null || typeof v !== 'object' || v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return v.map(canon);
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = canon(o[k]);
  return out;
}

const encoder = new Encoder({ useRecords: false, mapsAsObjects: true, tagUint8Array: false, variableMapSize: true });
const decoder = new Decoder({ useRecords: false, mapsAsObjects: true });

/** Canonical CBOR + row-delta coarse grids + chain-coded route, then raw DEFLATE (fflate). */
export function encodePackage(pkg: PlanPackage): Uint8Array {
  const wire = {
    v: pkg.v,
    id: pkg.id,
    parent: pkg.parent,
    seq: pkg.seq,
    author: pkg.author,
    createdUtc: pkg.createdUtc,
    siteId: pkg.siteId,
    rulesHash: pkg.rulesHash,
    route: chainEncode(pkg.route),
    stops: pkg.stops.map((s) => [s.id, s.arriveMin, s.departMin, s.arriveLtstMin]),
    order: pkg.order,
    bingo: pkg.bingo.map((b) => [b.id, b.ltstMin, b.tMin, b.text]),
    startLtstMin: pkg.startLtstMin,
    sol: pkg.sol,
    coarse: {
      cellM: pkg.coarse.cellM,
      w: pkg.coarse.w,
      h: pkg.coarse.h,
      wb: rowDelta(pkg.coarse.walkbackMin, pkg.coarse.w),
      sh: rowDelta(pkg.coarse.shelterMin, pkg.coarse.w),
      los: pkg.coarse.los ? packBits(pkg.coarse.los) : undefined,
    },
    rules: pkg.rules?.map((r) => [r.id, r.value, r.enabled]),
    sig: pkg.sig,
  };
  const cbor = encoder.encode(canon(wire));
  return deflateSync(new Uint8Array(cbor.buffer, cbor.byteOffset, cbor.byteLength), { level: 9 });
}

export function decodePackage(bytes: Uint8Array): PlanPackage {
  const raw = inflateSync(bytes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = decoder.decode(raw) as any;
  const u8 = (x: unknown): Uint8Array => (x instanceof Uint8Array ? x : new Uint8Array(x as ArrayLike<number>));
  const route = chainDecode({
    r0: o.route.r0,
    dict: o.route.dict !== undefined ? u8(o.route.dict) : undefined,
    codes: o.route.codes !== undefined ? u8(o.route.codes) : undefined,
    deltas: o.route.deltas !== undefined ? u8(o.route.deltas) : undefined,
  });
  const pkg: PlanPackage = {
    v: 1,
    id: o.id,
    seq: o.seq,
    author: o.author,
    createdUtc: o.createdUtc,
    siteId: o.siteId,
    rulesHash: o.rulesHash,
    route,
    stops: (o.stops as [string, number, number, number][]).map(([id, arriveMin, departMin, arriveLtstMin]) => ({ id, arriveMin, departMin, arriveLtstMin })),
    order: o.order,
    bingo: (o.bingo as [string, number, number, string][]).map(([id, ltstMin, tMin, text]) => ({ id, ltstMin, tMin, text })),
    startLtstMin: o.startLtstMin,
    sol: o.sol,
    coarse: {
      cellM: o.coarse.cellM,
      w: o.coarse.w,
      h: o.coarse.h,
      walkbackMin: rowUndelta(u8(o.coarse.wb), o.coarse.w),
      shelterMin: rowUndelta(u8(o.coarse.sh), o.coarse.w),
    },
    sig: o.sig,
  };
  if (o.coarse.los !== undefined) pkg.coarse.los = unpackBits(u8(o.coarse.los), o.coarse.w * o.coarse.h);
  if (o.rules !== undefined) pkg.rules = (o.rules as [RuleId, number, boolean][]).map(([id, value, enabled]) => ({ id, value, enabled }));
  if (o.parent !== undefined) pkg.parent = o.parent;
  return pkg;
}
