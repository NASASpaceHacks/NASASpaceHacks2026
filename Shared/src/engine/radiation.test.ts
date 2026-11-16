import { describe, expect, it } from 'vitest';
import { doseEqRateUSvPerMin, doseRateUGyPerDay, pressureAtElevation, skyShieldFactor } from './radiation';

describe('indicative surface dose (Guo 2015 pressure model × Hassler 2014 quality factor)', () => {
  it('dose rate formula', () => {
    expect(doseRateUGyPerDay(840, 0)).toBe(267);
    expect(doseRateUGyPerDay(740, 600)).toBeCloseTo(267 + 13 - 66, 9);
  });
  it('pressure falls with an 11 km scale height from 910 Pa (REMS, Ls ≈ 240) at −4500 m', () => {
    expect(pressureAtElevation(-4500)).toBe(910);
    expect(pressureAtElevation(-4500 + 11000)).toBeCloseTo(910 / Math.E, 9);
    expect(pressureAtElevation(-3500)).toBeLessThan(910);
  });
  it('dose equivalent = absorbed × 3.05, per minute; terrain shielding is indicative', () => {
    const d = doseRateUGyPerDay(910, 600);
    expect(doseEqRateUSvPerMin(-4500)).toBeCloseTo((d * 3.05) / 1440, 12);
    expect(skyShieldFactor(1)).toBe(1);
    expect(skyShieldFactor(0.6)).toBeCloseTo(1 - 0.88 * 0.4, 2); // Guo 2026 two-term, slope (1-f)w - f ≈ 0.88
    expect(skyShieldFactor(undefined)).toBe(1);
    // ≈0.59 mSv/day on the Gale floor at Ls 240 — inside RAD's 0.64 ± 0.12 mSv/d (Hassler et al. 2014)
    expect(doseEqRateUSvPerMin(-4500) * 1440).toBeGreaterThan(560);
    expect(doseEqRateUSvPerMin(-4500) * 1440).toBeLessThan(720);
  });
});
