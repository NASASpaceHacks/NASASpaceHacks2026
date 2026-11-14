import { describe, expect, it } from 'vitest';
import { DEFAULT_CREW, DEFAULT_RULES } from '../contracts/rules';
import type { CostCtx, CostGrid } from '../contracts/types';
import { etaFromThermalInertia, marsMetabolicW, pandolfSanteeMars, pandolfSanteeW } from './costModel';
import { dijkstraField } from './fields';

const W = 80, L = 131; // DEFAULT_CREW: body 80 kg, suit 121 kg + tools 10 kg
const V = 0.56;

function flatGrid(w: number, h: number, cellM = 5): CostGrid {
  const n = w * h;
  return { w, h, cellM, elev: new Float32Array(n), slopeDeg: new Float32Array(n), rough: new Float32Array(n), eta: new Float32Array(n).fill(1), blocked: new Uint8Array(n) };
}
const ctx = (speedFactor = 1): CostCtx => ({ crew: DEFAULT_CREW, rules: DEFAULT_RULES, speedFactor });

describe('Pandolf–Santee metabolic model', () => {
  // Hand calculation (W=80, L=131, V=0.56): L/W = 1.6375, (L/W)² = 2.68140625
  //   1.5W = 120;  2(W+L)(L/W)² = 422 × 2.68140625 = 1131.5534375;  1.5V² = 0.4704;  0.35V = 0.196
  it('level walking matches the hand calculation', () => {
    expect(pandolfSanteeW(W, L, V, 0, 1)).toBeCloseTo(120 + 1131.5534375 + 211 * 0.4704, 9); // 1350.8078375 W
  });
  it('uphill 10 % grade', () => {
    expect(pandolfSanteeW(W, L, V, 10, 1)).toBeCloseTo(1350.8078375 + 211 * 0.196 * 10, 9); // 1764.3678375 W
  });
  it('downhill −10 % applies the Santee correction', () => {
    const mp = 1350.8078375 - 211 * 0.196 * 10; // 937.2478375
    const cf = (-10 * 211 * V) / 3.5 - (211 * 16) / 80 + (25 - V * V); // −337.6 − 42.2 + 24.6864 = −355.1136
    expect(pandolfSanteeW(W, L, V, -10, 1)).toBeCloseTo(mp - cf, 9); // 1292.3614375 W
  });
  it('terrain factor η scales the walking term only', () => {
    expect(pandolfSanteeW(W, L, V, 0, 2.1)).toBeCloseTo(120 + 1131.5534375 + 2.1 * 211 * 0.4704, 9);
  });
  it('Mars scaling multiplies the whole result by the g ratio', () => {
    expect(marsMetabolicW(DEFAULT_CREW, V, 0, 1)).toBeCloseTo(1350.8078375 * (3.711 / 9.807), 9); // ≈ 511 W
  });
  it('uphill costs more than downhill on moderate grades', () => {
    for (const g of [2, 5, 8, 10, 15, 20]) expect(pandolfSanteeW(W, L, V, g, 1)).toBeGreaterThan(pandolfSanteeW(W, L, V, -g, 1));
  });
  it('thermal-inertia → η team mapping', () => {
    expect(etaFromThermalInertia(400)).toBe(1.0);
    expect(etaFromThermalInertia(350)).toBe(1.0);
    expect(etaFromThermalInertia(200)).toBe(1.2);
    expect(etaFromThermalInertia(100)).toBe(1.2);
    expect(etaFromThermalInertia(80)).toBe(2.1);
    expect(etaFromThermalInertia(NaN)).toBe(1.0);
  });
});

describe('edge cost (seconds) and power', () => {
  const g = flatGrid(10, 10);
  it('flat axis / diagonal edges take length / v', () => {
    expect(pandolfSanteeMars.edgeCost(g, 11, 12, ctx())).toBeCloseTo(5 / V, 12);
    expect(pandolfSanteeMars.edgeCost(g, 11, 22, ctx())).toBeCloseTo((5 * Math.SQRT2) / V, 12);
    expect(pandolfSanteeMars.edgeCost(g, 11, 12, ctx(0.5))).toBeCloseTo(5 / (V * 0.5), 12);
  });
  it('uses the 3-D length and the DEM grade', () => {
    const s = flatGrid(3, 1);
    s.elev[1] = 1; // 1 m rise over 5 m
    expect(pandolfSanteeMars.edgeCost(s, 0, 1, ctx())).toBeCloseTo(Math.hypot(5, 1) / V, 12);
    expect(pandolfSanteeMars.edgePowerW!(s, 0, 1, ctx())).toBeCloseTo(marsMetabolicW(DEFAULT_CREW, V, 20, 1), 9);
    expect(pandolfSanteeMars.edgePowerW!(s, 1, 0, ctx())).toBeCloseTo(marsMetabolicW(DEFAULT_CREW, V, -20, 1), 9);
  });
  it('blocked cells are impassable', () => {
    const b = flatGrid(3, 1);
    b.blocked[1] = 1;
    expect(pandolfSanteeMars.edgeCost(b, 0, 1, ctx())).toBe(Infinity);
    expect(pandolfSanteeMars.edgeCost(b, 1, 2, ctx())).toBe(Infinity);
  });
  it('on flat terrain, field time ≈ distance / v (octile metric; ≤0.05 s quantization per edge)', () => {
    const big = flatGrid(201, 201);
    const src = 100 * 201 + 100;
    const f = dijkstraField(big, [src], false, 1);
    for (const [dr, dc] of [[0, 100], [100, 0], [100, 100], [37, 80], [-60, 25]]) {
      const c = (100 + dr) * 201 + 100 + dc;
      const a = Math.abs(dr), b = Math.abs(dc);
      const octile = (Math.max(a, b) - Math.min(a, b) + Math.SQRT2 * Math.min(a, b)) * 5;
      const edges = Math.max(a, b);
      expect(Math.abs(f[c] * 60 - octile / V)).toBeLessThanOrEqual(0.05 * edges + 1e-6); // decisecond rounding
      expect(octile / Math.hypot(a * 5, b * 5)).toBeLessThan(1.083); // ≤ 8.2 % above straight-line distance
    }
  });
});
