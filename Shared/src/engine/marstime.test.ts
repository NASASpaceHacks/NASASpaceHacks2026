import { describe, expect, it } from 'vitest';
import { formatLtst, ltstAt, mars24, marsTime, sunAtLtst, sunPosition, sunPositionGraphic } from './marstime';

/**
 * Worked examples from "Mars24 Algorithm and Worked Examples" (NASA GISS, updated 2008-05-20),
 * https://www.giss.nasa.gov/tools/mars24/help/algorithm.html (values as printed, 5 decimals).
 * Note: the printed declinations differ from the page's own D-1 formula by ≤ 3e-4° (rounding inside
 * the Mars24 build); we implement the formula as printed, so δ and Z/A are checked to ±5e-4°.
 */
describe('Mars24 worked example 1: 2000-01-06 00:00:00 UTC, 0°W 0°N', () => {
  const ms = 947116800000;
  const m = mars24(ms);
  it('A: Julian dates', () => {
    expect(m.jdUT).toBeCloseTo(2451549.5, 6);
    expect(m.ttMinusUtc).toBeCloseTo(64.184, 6);
    expect(m.jdTT).toBeCloseTo(2451549.50074, 5);
    expect(m.dtJ2000).toBeCloseTo(4.50074, 5);
  });
  it('B: orbital parameters and Ls', () => {
    expect(m.M).toBeCloseTo(21.74548, 4);
    expect(m.alphaFMS).toBeCloseTo(272.74486, 4);
    expect(m.pbs).toBeCloseTo(0.00142, 5);
    expect(m.nuMinusM).toBeCloseTo(4.44191, 4);
    expect(m.ls).toBeCloseTo(277.18677, 4);
  });
  it('C: EOT, MTC, LMST, LTST, subsolar longitude', () => {
    expect(m.eotDeg).toBeCloseTo(-5.18764, 4);
    expect(m.mtcH).toBeCloseTo(23.99431, 4);
    const t = marsTime(ms, 0);
    expect(t.lmstH).toBeCloseTo(23.99431, 4);
    expect(t.ltstH).toBeCloseTo(23.64847, 4);
    expect(t.eotMin).toBeCloseTo(-5.18764 * 4, 3);
    expect(m.subsolarLonW).toBeCloseTo(174.72703, 3);
  });
  it('D: declination, distance, heliocentric coords, zenith, azimuth', () => {
    expect(m.declDeg).toBeCloseTo(-25.22838, 3);
    expect(m.rAU).toBeCloseTo(1.39358, 4);
    expect(m.helioLonDeg).toBeCloseTo(2.2627, 4);
    expect(m.helioLatDeg).toBeCloseTo(-1.35959, 4);
    const s = sunPositionGraphic(ms, 0, 0);
    expect(s.zenithDeg).toBeCloseTo(154.26182, 2);
    expect(s.azDeg).toBeCloseTo(191.03687, 3);
  });
});

describe('Mars24 worked example 2: MER-A Spirit, 2004-01-03 13:46:31 UTC, 184.702°W −14.640°N', () => {
  const ms = 1073137591000;
  const m = mars24(ms);
  it('matches the published intermediate values', () => {
    expect(m.jdUT).toBeCloseTo(2453008.07397, 5);
    expect(m.jdTT).toBeCloseTo(2453008.07471, 5);
    expect(m.dtJ2000).toBeCloseTo(1463.07471, 5);
    expect(m.M).toBeCloseTo(66.06851, 4);
    expect(m.alphaFMS).toBeCloseTo(317.09363, 4);
    expect(m.pbs).toBeCloseTo(0.01614, 5);
    expect(m.nuMinusM).toBeCloseTo(10.22959, 4);
    expect(m.ls).toBeCloseTo(327.32322, 4);
    expect(m.eotDeg).toBeCloseTo(-12.77557, 4);
    expect(m.mtcH).toBeCloseTo(13.16542, 4);
    expect(m.subsolarLonW).toBeCloseTo(4.70575, 3);
    expect(m.declDeg).toBeCloseTo(-13.42105, 3);
    expect(m.rAU).toBeCloseTo(1.47767, 4);
    expect(m.helioLonDeg).toBeCloseTo(52.37469, 4);
    expect(m.helioLatDeg).toBeCloseTo(0.08962, 4);
  });
  it('local times at the landing site (east longitude = 360 − 184.702)', () => {
    const t = marsTime(ms, 360 - 184.702);
    expect(t.lmstH).toBeCloseTo(0.85196, 4);
    expect(t.ltstH).toBeCloseTo(0.00025, 4);
    const s = sunPositionGraphic(ms, 184.702, -14.64);
    expect(s.zenithDeg).toBeCloseTo(151.93895, 2);
    expect(s.azDeg).toBeCloseTo(179.99225, 3);
  });
});

describe('sun helpers', () => {
  it('sunAtLtst reproduces sunPosition at the same instant (same δ and hour angle)', () => {
    for (const ms of [947116800000, 1073137591000, Date.UTC(2026, 10, 14, 15, 0, 0)]) {
      for (const [lonE, lat] of [[137.388, -4.805], [175.298, -14.64], [10, 40]]) {
        const t = marsTime(ms, lonE);
        const a = sunPosition(ms, lonE, lat);
        const b = sunAtLtst(t.lsDeg, t.ltstH * 60, lat);
        expect(b.elevDeg).toBeCloseTo(a.elevDeg, 6);
        expect(b.azDeg).toBeCloseTo(a.azDeg, 6);
      }
    }
  });
  it('morning sun is in the east, afternoon sun in the west, noon is the highest', () => {
    const am = sunAtLtst(240, 9 * 60, -4.8), noon = sunAtLtst(240, 12 * 60, -4.8), pm = sunAtLtst(240, 15 * 60, -4.8);
    expect(am.azDeg).toBeGreaterThan(0);
    expect(am.azDeg).toBeLessThan(180);
    expect(pm.azDeg).toBeGreaterThan(180);
    expect(noon.elevDeg).toBeGreaterThan(am.elevDeg);
    expect(noon.elevDeg).toBeGreaterThan(pm.elevDeg);
    expect(sunAtLtst(240, 0, -4.8).elevDeg).toBeLessThan(0);
    // Ls 240 (southern summer): subsolar latitude ≈ −21.8°, so noon elevation ≈ 90 − |−4.86 + 21.8|
    expect(noon.elevDeg).toBeCloseTo(90 - Math.abs(-4.857 + 21.83), 0);
  });
  it('EVA minutes → Mars-clock LTST', () => {
    expect(ltstAt(580, 0)).toBe(580);
    expect(ltstAt(580, 1.027491252 * 60)).toBeCloseTo(640, 9);
    expect(formatLtst(580)).toBe('09:40');
    expect(formatLtst(1439.6)).toBe('00:00');
  });
});
