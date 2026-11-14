import { goldenPlanResult, mockFields, type FieldSet, type LoadedSitePack, type PlanRequest, type PlanResult } from '@mw/shared/contracts';
import { ENGINE_FALLBACK_NOTE, loadEngine } from '../engine';

export interface PlanJobResult {
  result: PlanResult;
  fields: FieldSet;
  engine: 'real' | 'fallback';
  ms: number;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Golden fixture + mock fields, tagged so the console can show that the engine is not in use. */
export function fallbackPlan(pack: LoadedSitePack, reqKey: string, why: string): PlanJobResult {
  const t0 = performance.now();
  const result = goldenPlanResult(pack);
  result.reqHash = reqKey;
  result.notes = [ENGINE_FALLBACK_NOTE, why, ...result.notes];
  return { result, fields: mockFields(pack), engine: 'fallback', ms: performance.now() - t0 };
}

/** Plan with the engine if it is there and works; otherwise fall back (never throws). */
export async function runPlanJob(pack: LoadedSitePack, req: PlanRequest, reqKey: string, forceFallback = false): Promise<PlanJobResult> {
  const t0 = performance.now();
  if (forceFallback) return fallbackPlan(pack, reqKey, 'engine disabled by server option');
  const { api, caps } = await loadEngine();
  let result: PlanResult | undefined;
  let why = caps.error ?? 'engine.plan is not exported yet';
  if (api.plan) {
    try {
      result = api.plan(pack, req);
    } catch (e) {
      why = `engine.plan threw: ${msg(e)}`;
    }
  }
  if (!result) return fallbackPlan(pack, reqKey, why);
  if (!result.reqHash) result.reqHash = reqKey;
  result.notes ??= [];

  let fields: FieldSet | undefined;
  if (api.computeFields) {
    try {
      fields = api.computeFields(pack, req);
    } catch (e) {
      result.notes.push(`fields: engine.computeFields threw (${msg(e)}) — mock fields shown`);
    }
  } else {
    result.notes.push('fields: engine.computeFields not exported yet — mock fields shown');
  }
  return { result, fields: fields ?? mockFields(pack), engine: 'real', ms: performance.now() - t0 };
}
