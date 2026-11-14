import { engineFn } from './engine';

/**
 * Mars time + sun. Uses the engine's Mars24 implementation when present (B2); until then a
 * local implementation of the same published algorithm:
 *   Allison & McEwen (2000), Planet. Space Sci. 48, 215–235, doi:10.1016/S0032-0633(99)00092-6;
 *   NASA GISS Mars24 algorithm, https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
 * TT−UTC = 69.184 s (leap seconds through 2017-01-01, IERS Bulletin C).
 */

const D2R = Math.PI / 180;
const mod = (a: number, n: number) => ((a % n) + n) % n;

export interface MarsTime {
  msd: number;
  mtcH: number;
  lmstH: number;
  ltstH: number;
  lsDeg: number;
  eotMin: number;
}

function localMarsTime(utcMs: number, lonEastDeg: number): MarsTime {
  const jdUT = 2440587.5 + utcMs / 86400000;
  const jdTT = jdUT + 69.184 / 86400;
  const dt = jdTT - 2451545.0;
  const M = 19.3871 + 0.52402073 * dt; // mean anomaly (B-1)
  const aFMS = 270.3871 + 0.524038496 * dt; // fictitious mean sun (B-2)
  const A = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.002, 0.0018];
  const tau = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
  const phi = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
  let pbs = 0;
  for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos(((0.985626 * dt) / tau[i] + phi[i]) * D2R); // (B-3)
  const Mr = M * D2R;
  const eoc = (10.691 + 3.0e-7 * dt) * Math.sin(Mr) + 0.623 * Math.sin(2 * Mr) + 0.05 * Math.sin(3 * Mr) + 0.005 * Math.sin(4 * Mr) + 0.0005 * Math.sin(5 * Mr) + pbs; // (B-4)
  const ls = mod(aFMS + eoc, 360); // (B-5)
  const lsr = ls * D2R;
  const eotDeg = 2.861 * Math.sin(2 * lsr) - 0.071 * Math.sin(4 * lsr) + 0.002 * Math.sin(6 * lsr) - eoc; // (C-1)
  const msd = (dt - 4.5) / 1.0274912517 + 44796.0 - 0.0009626; // (C-2)
  const mtcH = mod(24 * msd, 24); // (C-3)
  const lmstH = mod(mtcH + lonEastDeg / 15, 24); // (C-4), east-positive longitude
  const ltstH = mod(lmstH + eotDeg / 15, 24); // (C-5)
  return { msd, mtcH, lmstH, ltstH, lsDeg: ls, eotMin: eotDeg * 4 };
}

export function marsTime(utcMs: number, lonEastDeg: number): MarsTime {
  const f = engineFn('marsTime');
  if (f) {
    try {
      return f(utcMs, lonEastDeg);
    } catch {
      /* fall through */
    }
  }
  return localMarsTime(utcMs, lonEastDeg);
}

/**
 * Sun elevation/azimuth (az clockwise from north) at a site for a given Ls and LTST.
 * Declination: Mars24 (D-1) δs = asin(0.42565 sin Ls) + 0.25° sin Ls; hour angle from LTST.
 */
export function sunAtLtst(lsDeg: number, ltstMin: number, latDeg: number): { elevDeg: number; azDeg: number } {
  const f = engineFn('sunAtLtst');
  if (f) {
    try {
      return f(lsDeg, ltstMin, latDeg);
    } catch {
      /* fall through */
    }
  }
  const ls = lsDeg * D2R;
  const dec = Math.asin(0.42565 * Math.sin(ls)) + 0.25 * D2R * Math.sin(ls);
  const H = ((ltstMin / 60 - 12) * 15) * D2R;
  const lat = latDeg * D2R;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)); // from south, westward
  return { elevDeg: el / D2R, azDeg: mod(azS / D2R + 180, 360) };
}

/** Minutes after local midnight → "HH:MM". Mars sols are 24h39m35s; LTST still reads 00:00–23:59. */
export function fmtLtst(min: number): string {
  const m = mod(Math.round(min), 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Mars-clock minutes per Earth minute: 1 sol = 1.027491252 Earth days (Mars24 C-2; same as the engine's ltstAt). */
export const EARTH_MIN_PER_MARS_MIN = 1.027491252;

/** Mars local time (LTST minutes) at EVA minute `tMin` (Earth minutes) of an EVA starting at `startLtstMin`. */
export function evaLtst(startLtstMin: number, tMin: number): number {
  return startLtstMin + tMin / EARTH_MIN_PER_MARS_MIN;
}

/** EVA minute (Earth minutes) at Mars local time `ltstMin`. */
export function evaMinAt(startLtstMin: number, ltstMin: number): number {
  return (ltstMin - startLtstMin) * EARTH_MIN_PER_MARS_MIN;
}
