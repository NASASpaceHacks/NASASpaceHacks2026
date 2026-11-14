import { describe, expect, it } from 'vitest';
import { earthMarsDistanceAu, marsSolDate, oneWayLightMin } from './earth';

describe('Earth–Mars light time (JPL approximate elements)', () => {
  it('reproduces known close approach and solar conjunction distances', () => {
    // 2025-01-12 Mars closest approach: 96.08 million km = 0.6423 au (NASA Mars close approach page).
    expect(earthMarsDistanceAu(Date.UTC(2025, 0, 12))).toBeCloseTo(0.642, 2);
    // 2023-11-18 solar conjunction: Mars ≈ 2.48 au from Earth (behind the Sun).
    const conj = earthMarsDistanceAu(Date.UTC(2023, 10, 18));
    expect(conj).toBeGreaterThan(2.4);
    expect(conj).toBeLessThan(2.55);
  });

  it('stays within the 3–22.5 min one-way light-time envelope over a synodic period', () => {
    let lo = Infinity, hi = -Infinity;
    for (let d = 0; d < 800; d += 2) {
      const m = oneWayLightMin(Date.UTC(2025, 0, 1) + d * 86_400_000);
      lo = Math.min(lo, m);
      hi = Math.max(hi, m);
    }
    expect(lo).toBeGreaterThan(3);
    expect(hi).toBeLessThan(22.5);
    expect(hi - lo).toBeGreaterThan(12);
  });

  it('Mars Sol Date matches the Mars24 J2000 reference', () => {
    // Mars24 algorithm worked example: 2000-01-06 00:00 UTC → MSD ≈ 44795.9998.
    expect(marsSolDate(Date.UTC(2000, 0, 6)).msd).toBeCloseTo(44795.9998, 3);
  });
});
