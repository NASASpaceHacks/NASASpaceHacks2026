import { createHash, randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import type { CoarseSafetyGrid, FieldSet, GridSpec, LoadedSitePack, PlanPackage, PlanRequest, PlanResult } from '@mw/shared/contracts';
import { canonicalCbor } from '@mw/shared/link';

/**
 * Guarded access to the engine (Shared/src/engine, built concurrently by B2).
 *
 * The module is imported through a non-literal specifier so (a) a missing export or an engine
 * that throws never takes the hab server down, and (b) engine work-in-progress cannot break the
 * Backend typecheck. Signatures mirror docs/AGENTS.md "Engine public API".
 */
export interface EngineApi {
  plan(pack: LoadedSitePack, req: PlanRequest): PlanResult;
  computeFields(pack: LoadedSitePack, req: PlanRequest): FieldSet;
  toPlanPackage(
    res: PlanResult,
    req: PlanRequest,
    fields: FieldSet,
    grid: GridSpec,
    opts: { seq: number; parent?: string; author: 'hab' | 'earth' },
  ): PlanPackage;
  encodePackage(pkg: PlanPackage): Uint8Array;
}

export interface EngineHandle {
  api: Partial<EngineApi>;
  caps: { plan: boolean; computeFields: boolean; toPlanPackage: boolean; encodePackage: boolean; error?: string };
}

const ENGINE_MODULE: string = '@mw/shared/engine';
let loading: Promise<EngineHandle> | null = null;

export function loadEngine(): Promise<EngineHandle> {
  loading ??= (async () => {
    let api: Partial<EngineApi> = {};
    let error: string | undefined;
    try {
      api = (await import(ENGINE_MODULE)) as Partial<EngineApi>;
    } catch (e) {
      error = `engine import failed: ${(e as Error).message}`;
    }
    const fn = (k: keyof EngineApi) => typeof api[k] === 'function';
    return {
      api,
      caps: { plan: fn('plan'), computeFields: fn('computeFields'), toPlanPackage: fn('toPlanPackage'), encodePackage: fn('encodePackage'), error },
    };
  })();
  return loading;
}

export const ENGINE_FALLBACK_NOTE = 'engine unavailable — golden fixture';

// ───────────────────────────── Fallbacks (used only when the engine is missing / throws) ─────────────────────────────

const U16_UNREACHABLE = 65535;

/** Conservative coarse grid: per block, the WORST (max) finite value; 65535 = unreachable. */
export function coarsen(fields: FieldSet, grid: GridSpec, cellM = 50): CoarseSafetyGrid {
  const f = Math.max(1, Math.round(cellM / grid.cellM));
  const cw = Math.ceil(fields.w / f), ch = Math.ceil(fields.h / f);
  const walkbackMin: number[] = new Array(cw * ch);
  const shelterMin: number[] = new Array(cw * ch);
  for (let R = 0; R < ch; R++) {
    for (let C = 0; C < cw; C++) {
      let wb = -1, sh = -1;
      for (let r = R * f; r < Math.min(fields.h, (R + 1) * f); r++) {
        for (let c = C * f; c < Math.min(fields.w, (C + 1) * f); c++) {
          const i = r * fields.w + c;
          const a = fields.walkbackMin[i], b = fields.shelterMin[i];
          if (Number.isFinite(a) && a > wb) wb = a;
          if (Number.isFinite(b) && b > sh) sh = b;
        }
      }
      walkbackMin[R * cw + C] = wb < 0 ? U16_UNREACHABLE : Math.min(U16_UNREACHABLE - 1, Math.ceil(wb));
      shelterMin[R * cw + C] = sh < 0 ? U16_UNREACHABLE : Math.min(U16_UNREACHABLE - 1, Math.ceil(sh));
    }
  }
  return { cellM: f * grid.cellM, w: cw, h: ch, walkbackMin, shelterMin };
}

export function fallbackToPlanPackage(
  res: PlanResult,
  req: PlanRequest,
  fields: FieldSet,
  grid: GridSpec,
  opts: { seq: number; parent?: string; author: 'hab' | 'earth' },
): PlanPackage {
  const route: number[] = [];
  for (const s of res.segments) {
    for (const c of s.cells) if (route[route.length - 1] !== c) route.push(c);
  }
  return {
    v: 1,
    id: randomUUID(),
    parent: opts.parent,
    seq: opts.seq,
    author: opts.author,
    createdUtc: new Date().toISOString(),
    siteId: req.siteId,
    rulesHash: createHash('sha256').update(JSON.stringify(req.rules)).digest('hex').slice(0, 16),
    route,
    stops: res.stops,
    order: res.order,
    bingo: res.bingo,
    startLtstMin: req.startLtstMin,
    sol: req.sol,
    coarse: coarsen(fields, grid),
    sig: '',
  };
}

/** Canonical CBOR + deflate-raw (same wire format the engine specifies). */
export function fallbackEncodePackage(pkg: PlanPackage): Uint8Array {
  return new Uint8Array(deflateRawSync(canonicalCbor(pkg)));
}

/** Stable JSON (sorted keys) for request hashing. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function requestKey(req: PlanRequest): string {
  return createHash('sha256').update(stableJson(req)).digest('hex').slice(0, 16);
}
