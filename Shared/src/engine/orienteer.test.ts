import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../contracts/sitepack';
import { HEAT_TAU_MIN, REST_W, Seg, type HeatParams, type SegEval } from './heat';
import { bruteForce, evalSequence, solveDP, type Leg, type OrInstance } from './orienteer';

/** Random synthetic leg: walking chunks (with per-chunk LOS + walkback values) then an optional dwell. */
function randomLeg(rnd: () => number, dwell: { min: number; P: number; los: boolean; wb: number } | null): Leg {
  const k = 1 + Math.floor(rnd() * 25);
  const dt: number[] = [], P: number[] = [];
  let T = 0, run = 0, lead = 0, maxInt = 0, seen = false;
  let wbMax = rnd() * 40;
  for (let i = 0; i < k; i++) {
    const d = 0.1 + rnd() * 1.5;
    dt.push(d);
    P.push(150 + rnd() * 750);
    T += d;
    const los = rnd() < 0.6;
    if (los) {
      if (!seen) {
        lead = run;
        seen = true;
      } else maxInt = Math.max(maxInt, run);
      run = 0;
    } else run += d;
    wbMax = Math.max(wbMax, T + rnd() * 60);
  }
  let total = T;
  if (dwell) {
    dt.push(dwell.min);
    P.push(dwell.P);
    total += dwell.min;
    if (!dwell.los) run += dwell.min;
    wbMax = Math.max(wbMax, total + dwell.wb);
  }
  const allNon = !seen;
  return { seg: new Seg(dt, P), allNon, total, lead: allNon ? total : lead, trail: allNon ? total : run, maxInt, wbMax };
}

function randomInstance(seed: number, n: number): OrInstance {
  const rnd = mulberry32(seed);
  const st = Array.from({ length: n }, () => ({ min: 5 + rnd() * 25, P: rnd() < 0.8 ? 250 : 360 + rnd() * 80, los: rnd() < 0.6, wb: 10 + rnd() * 50 }));
  const legs: (Leg | null)[] = new Array((n + 1) * (n + 1)).fill(null);
  for (let i = 0; i <= n; i++) for (let j = 1; j <= n; j++) if (i !== j && rnd() < 0.92) legs[i * (n + 1) + j] = randomLeg(rnd, st[j - 1]);
  const rets = Array.from({ length: n + 1 }, () => (rnd() < 0.95 ? randomLeg(rnd, null) : null));
  const deadline = 60 + rnd() * 200;
  return {
    n,
    values: [0, ...st.map(() => Math.round(10 + rnd() * 90))],
    legs,
    rets,
    wbAt: [0, ...st.map((s) => s.wb)],
    t0: 30,
    H0: rnd() < 0.5 ? 250 : 352,
    g0: 0,
    deadline,
    evaDeadline: deadline,
    dayDeadline: rnd() < 0.3 ? deadline * (0.6 + rnd() * 0.4) : Infinity,
    gapMax: rnd() < 0.3 ? Infinity : 4 + rnd() * 20,
    wbOn: rnd() < 0.8,
    hp: { budgetW: 300 + rnd() * 120, restW: REST_W, tauMin: HEAT_TAU_MIN },
  };
}

describe('heat governor: exact closed-form segment evaluation', () => {
  it('Seg.eval equals the step-by-step governor and is monotone in start heat', () => {
    const rnd = mulberry32(42);
    const out: SegEval = { feasible: false, dur: 0, rest: 0, hEnd: 0 };
    for (let trial = 0; trial < 400; trial++) {
      const k = 1 + Math.floor(rnd() * 60);
      const dt = Array.from({ length: k }, () => 0.05 + rnd() * 2);
      const P = Array.from({ length: k }, () => 100 + rnd() * 1100);
      const hp: HeatParams = { budgetW: 280 + rnd() * 200, restW: REST_W, tauMin: HEAT_TAU_MIN };
      const s = new Seg(dt, P);
      s.prepare(hp);
      let prev: SegEval | null = null;
      for (let H0 = 100; H0 <= hp.budgetW; H0 += (hp.budgetW - 100) / 23) {
        const ref = s.simulate(H0, hp);
        s.eval(H0, out);
        expect(out.feasible).toBe(ref.feasible);
        if (!ref.feasible) break;
        expect(out.dur).toBeCloseTo(ref.dur, 7);
        expect(out.rest).toBeCloseTo(ref.rest, 7);
        expect(out.hEnd).toBeCloseTo(ref.hEnd, 7);
        expect(out.hEnd).toBeLessThanOrEqual(hp.budgetW + 1e-6);
        if (prev) {
          expect(out.dur).toBeGreaterThanOrEqual(prev.dur - 1e-9);
          expect(out.hEnd).toBeGreaterThanOrEqual(prev.hEnd - 1e-9);
        }
        prev = { ...out };
      }
    }
  });

  it('walking above the budget forces rests at the steady-state duty cycle', () => {
    const hp: HeatParams = { budgetW: 352, restW: 250, tauMin: 30 };
    const s = new Seg(new Array(2000).fill(0.1), new Array(2000).fill(511)); // 200 min of level walking at ≈511 W
    const r = s.simulate(352, hp);
    const duty = 200 / r.dur; // walking fraction
    expect(duty).toBeCloseTo((352 - 250) / (511 - 250), 2);
    expect(r.hEnd).toBeLessThanOrEqual(352 + 1e-9);
  });

  it('a chunk is infeasible only when resting cannot cool enough', () => {
    const hp: HeatParams = { budgetW: 240, restW: 250, tauMin: 30 };
    expect(new Seg([1], [400]).simulate(240, hp).feasible).toBe(false); // needs H ≤ 234.6 W, rest only reaches 250 W
    expect(new Seg([1], [400]).simulate(200, hp).feasible).toBe(false); // conservative: infeasible whatever the start heat
    expect(new Seg([1], [200]).simulate(200, hp).feasible).toBe(true);
  });
});

describe('orienteering DP', () => {
  it('equals brute-force enumeration on 320 random instances (n ≤ 7)', () => {
    let feasibleMasks = 0;
    for (let seed = 1; seed <= 320; seed++) {
      const n = 1 + (seed % 7);
      const inst = randomInstance(seed * 101, n);
      const dp = solveDP(inst);
      const bf = bruteForce(inst);
      for (let mask = 0; mask < 1 << n; mask++) {
        const a = dp.bestEnd[mask], b = bf[mask];
        if (b === Infinity) expect(a).toBe(Infinity);
        else {
          feasibleMasks++;
          expect(Math.abs(a - b)).toBeLessThan(1e-9);
          // the reconstructed order really achieves the optimum and visits exactly the mask
          const order = dp.reconstruct(mask);
          expect(order.reduce((m, j) => m | (1 << (j - 1)), 0)).toBe(mask);
          const ev = evalSequence(inst, order);
          expect(ev.feasible).toBe(true);
          expect(Math.abs(ev.tEnd - b)).toBeLessThan(1e-9);
        }
      }
    }
    expect(feasibleMasks).toBeGreaterThan(1000);
  });

  it('evalSequence reports deficits for infeasible orders', () => {
    const inst = randomInstance(7, 4);
    const tight = { ...inst, deadline: inst.t0 + 1, evaDeadline: inst.t0 + 1, wbOn: true };
    const ev = evalSequence(tight, [1]);
    expect(ev.feasible).toBe(false);
    expect(ev.violations.length).toBeGreaterThan(0);
  });
});
