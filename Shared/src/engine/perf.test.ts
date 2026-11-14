import { describe, expect, it } from 'vitest';
import { goldenPlanRequest, mockSitePack } from '../contracts';
import type { PlanRequest } from '../contracts/types';
import { computeFields, encodePackage, plan, toPlanPackage } from './index';

const now = () => performance.now();
const time = <T,>(f: () => T): [T, number] => {
  const t = now();
  const r = f();
  return [r, now() - t];
};

/**
 * Performance on mockSitePack(seed, 1000) — 1M cells, 10 stations. Targets: full plan ≤ 3 s,
 * replan ≤ 1 s (Node). Timings are logged; the assertions are deliberately loose so slow CI
 * hardware does not fail the build.
 */
describe('performance (1000×1000, 10 stations)', () => {
  it('logs plan / replan timings and package size', () => {
    const pack = mockSitePack(412, 1000); // fresh pack object → cold caches
    const req = goldenPlanRequest(pack);
    const [res, cold] = time(() => plan(pack, req));
    const [, warm] = time(() => plan(pack, req));
    const first = res.stops[0];
    const resume: PlanRequest = first
      ? { ...req, resume: { elapsedMin: first.departMin, cell: res.segments[1].cells[0], visited: [first.id], o2UsedPct: (100 * (first.departMin - 30)) / 300 } }
      : req;
    const [, replan] = time(() => plan(pack, resume));
    const leg = res.segments[0]?.cells ?? [];
    const [, hazard] = time(() => plan(pack, { ...resume, events: [{ t: 'HAZARD', cells: leg.slice(10, 30) }] }));
    const [, sep] = time(() => plan(pack, { ...resume, events: [{ t: 'SEP_NOWCAST', leadMin: 30 }] }));
    const [fields, fieldsMs] = time(() => computeFields(pack, req));
    const [bytes, encMs] = time(() => encodePackage(toPlanPackage(res, req, fields, pack.manifest.grid, { seq: 1, author: 'hab' })));
    const line = `perf 1M cells: plan cold ${cold.toFixed(0)} ms | warm ${warm.toFixed(0)} ms | replan(resume) ${replan.toFixed(0)} ms | replan(hazard) ${hazard.toFixed(0)} ms | replan(SEP) ${sep.toFixed(0)} ms | computeFields(cached) ${fieldsMs.toFixed(0)} ms | package ${bytes.length} B in ${encMs.toFixed(0)} ms | solveMs ${res.solveMs.toFixed(0)}`;
    console.log(line);
    if (cold > 3000 || replan > 1000) console.warn(`perf above target: ${line}`);
    expect(cold).toBeLessThan(30_000);
    expect(replan).toBeLessThan(10_000);
  }, 120_000);
});
