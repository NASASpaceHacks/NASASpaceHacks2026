import { describe, expect, it } from 'vitest';
import { mockSitePack } from '../../Shared/src/contracts/fixtures/mockSitePack';
import { makeScenarios, runBench, summarize, type BenchEnv } from './harness';
import { refBuildCostGrid, refCostModel, refDijkstra } from './ref';
import { weightedAStar } from '../planners/example-weighted-astar';

const env: BenchEnv = {
  pack: mockSitePack(412, 200), buildGrid: refBuildCostGrid, planners: [refDijkstra, weightedAStar],
  costModels: [refCostModel], judge: refCostModel, baseline: { search: 'ref-dijkstra', cost: 'ref-slope' },
};

describe('bench harness (200x200 mock, 5 scenarios)', () => {
  const scen = makeScenarios(env, 5, 7);
  const rows = runBench(env, scen);
  it('generates 5 static + 5 hazard scenarios', () => {
    expect(scen.filter((s) => s.kind === 'static')).toHaveLength(5);
    expect(scen.filter((s) => s.kind === 'hazard')).toHaveLength(5);
  });
  it('reference Dijkstra equals the oracle', () => {
    for (const r of rows.filter((r) => r.planner === 'ref-dijkstra' && r.kind === 'static')) {
      expect(r.success).toBe(1);
      expect(Math.abs(r.gapPct)).toBeLessThan(1e-6);
    }
  });
  it('weighted A* gap >= 0', () => {
    const w = rows.filter((r) => r.planner === 'wastar-1.5');
    expect(w.length).toBeGreaterThan(0);
    for (const r of w.filter((r) => r.success)) expect(r.gapPct).toBeGreaterThanOrEqual(-1e-9);
  });
  it('hard-constraint violations are 0 and everything succeeds', () => {
    for (const r of rows) { expect(r.violations).toBe(0); expect(r.success).toBe(1); }
  });
  it('summary marks no star for the baseline', () => {
    const s = summarize(rows, env.baseline);
    expect(s.find((x) => x.planner === 'ref-dijkstra')!.star).toBe(false);
  });
});
