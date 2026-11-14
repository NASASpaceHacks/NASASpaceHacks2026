import * as engineNs from '@mw/shared/engine';
import * as linkNs from '@mw/shared/link';
import type { FieldSet, GridSpec, LinkMsg, PlanPackage, PlanRequest, PlanResult } from '@mw/shared/contracts';
import type { LoadedSitePack } from '@mw/shared/contracts';

/**
 * Optional bridges to the engine (B2) and surface link (B4), which are being built concurrently.
 * We look functions up at runtime so the console compiles and runs before they land, and
 * automatically uses them once they exist.
 */
export interface EngineApi {
  plan(pack: LoadedSitePack, req: PlanRequest): PlanResult;
  computeFields(pack: LoadedSitePack, req: PlanRequest): FieldSet;
  toPlanPackage(res: PlanResult, req: PlanRequest, fields: FieldSet, grid: GridSpec, opts: { seq: number; parent?: string; author: 'hab' | 'earth' }): PlanPackage;
  encodePackage(pkg: PlanPackage): Uint8Array;
  marsTime(utcMs: number, lonEastDeg: number): { msd: number; mtcH: number; lmstH: number; ltstH: number; lsDeg: number; eotMin: number };
  sunAtLtst(lsDeg: number, ltstMin: number, latDeg: number): { elevDeg: number; azDeg: number };
}

export type LinkStatus = 'up' | 'degraded' | 'down';
export interface LinkApi {
  connectWebSocketLink(url: string, role: 'console' | 'visor'): {
    send(m: LinkMsg): void;
    onMessage(cb: (m: LinkMsg) => void): () => void;
    onStatus(cb: (s: LinkStatus) => void): () => void;
    status(): LinkStatus;
    close(): void;
  };
}

function pick<T>(ns: object, name: string): T | undefined {
  const f = Reflect.get(ns, name) as unknown;
  return typeof f === 'function' ? (f as T) : undefined;
}

export function engineFn<K extends keyof EngineApi>(name: K): EngineApi[K] | undefined {
  return pick<EngineApi[K]>(engineNs, name);
}

export function linkFn<K extends keyof LinkApi>(name: K): LinkApi[K] | undefined {
  return pick<LinkApi[K]>(linkNs, name);
}

/** Numeric engine constant (e.g. DEFAULT_LS_DEG) when exported. */
export function engineConst(name: string): number | undefined {
  const v = Reflect.get(engineNs, name) as unknown;
  return typeof v === 'number' ? v : undefined;
}
