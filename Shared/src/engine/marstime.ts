/**
 * Mars time and sun position — port of the Mars24 algorithm (NASA GISS):
 *   Allison, M. & McEwen, M. (2000), "A post-Pathfinder evaluation of areocentric solar coordinates
 *   with improved timing recipes for Mars seasonal/diurnal climate studies", Planet. Space Sci. 48:215.
 *   Allison (1997), Geophys. Res. Lett. 24:1967 (declination, eq. 5).
 *   "Mars24 Algorithm and Worked Examples" (GISS, updated 2008-05-20),
 *   https://www.giss.nasa.gov/tools/mars24/help/algorithm.html — steps A-1…D-6 below follow it
 *   line by line; its worked examples are reproduced in marstime.test.ts.
 *
 * Conventions: Mars24 uses planetographic WEST longitude. This module's public API takes
 * planetocentric EAST longitude / latitude (the site-pack convention) and converts.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const mod = (x: number, m: number) => ((x % m) + m) % m;
const sind = (x: number) => Math.sin(x * D2R);
const cosd = (x: number) => Math.cos(x * D2R);

/** Earth seconds per Mars mean solar day ratio (Mars24 C-2: 1 sol = 1.027491252 d). */
export const SOL_PER_DAY = 1.027491252;
/** Earth minutes per Mars-clock minute (1/1440 sol), Mars24 C-2. */
export const EARTH_MIN_PER_MARS_MIN = SOL_PER_DAY;

/**
 * TAI−UTC (s) from the IERS/USNO leap-second table (A-4). No leap second has been added since
 * 2017-01-01 (IERS Bulletin C). TT−UTC = TAI−UTC + 32.184 s.
 */
const LEAP: [number, number][] = [
  [Date.UTC(1972, 0, 1), 10], [Date.UTC(1972, 6, 1), 11], [Date.UTC(1973, 0, 1), 12], [Date.UTC(1974, 0, 1), 13],
  [Date.UTC(1975, 0, 1), 14], [Date.UTC(1976, 0, 1), 15], [Date.UTC(1977, 0, 1), 16], [Date.UTC(1978, 0, 1), 17],
  [Date.UTC(1979, 0, 1), 18], [Date.UTC(1980, 0, 1), 19], [Date.UTC(1981, 6, 1), 20], [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22], [Date.UTC(1985, 6, 1), 23], [Date.UTC(1988, 0, 1), 24], [Date.UTC(1990, 0, 1), 25],
  [Date.UTC(1991, 0, 1), 26], [Date.UTC(1992, 6, 1), 27], [Date.UTC(1993, 6, 1), 28], [Date.UTC(1994, 6, 1), 29],
  [Date.UTC(1996, 0, 1), 30], [Date.UTC(1997, 6, 1), 31], [Date.UTC(1999, 0, 1), 32], [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34], [Date.UTC(2012, 6, 1), 35], [Date.UTC(2015, 6, 1), 36], [Date.UTC(2017, 0, 1), 37],
];

/** A-4: TT − UTC in seconds. */
export function ttMinusUtc(utcMs: number): number {
  if (utcMs < LEAP[0][0]) {
    // Pre-1972 polynomial (Mars24 A-4, revision of AM2000 eq. 27); T from A-3.
    const T = (2440587.5 + utcMs / 8.64e7 - 2451545.0) / 36525;
    return 64.184 + 59 * T - 51.2 * T * T - 67.1 * T ** 3 - 16.4 * T ** 4;
  }
  let tai = 10;
  for (const [t, v] of LEAP) if (utcMs >= t) tai = v;
  return tai + 32.184;
}

/** B-3 perturbation table (AM2000 Table 5 as given on the Mars24 page): A_i (°), τ_i (Julian yr), φ_i (°). */
const PBS: [number, number, number][] = [
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704], [0.002, 2.4694, 95.528], [0.0018, 32.8493, 49.095],
];

export interface Mars24 {
  jdUT: number;
  ttMinusUtc: number;
  jdTT: number;
  dtJ2000: number;
  M: number;
  alphaFMS: number;
  pbs: number;
  nuMinusM: number;
  ls: number;
  /** Equation of time, degrees. */
  eotDeg: number;
  /** Coordinated Mars Time (mean solar time at the prime meridian), hours 0–24. */
  mtcH: number;
  msd: number;
  /** Subsolar planetographic WEST longitude (°). */
  subsolarLonW: number;
  /** Solar declination (planetographic, °). */
  declDeg: number;
  /** Heliocentric distance (AU). */
  rAU: number;
  helioLonDeg: number;
  helioLatDeg: number;
}

/** Mars24 steps A–D for an instant (UTC epoch ms). Angles normalized to 0–360 where Mars24 does. */
export function mars24(utcMs: number): Mars24 {
  const jdUT = 2440587.5 + utcMs / 8.64e7; // A-2
  const dT = ttMinusUtc(utcMs); // A-4
  const jdTT = jdUT + dT / 86400; // A-5
  const dt = jdTT - 2451545.0; // A-6
  const M = mod(19.387 + 0.52402075 * dt, 360); // B-1
  const alphaFMS = mod(270.3863 + 0.5240384 * dt, 360); // B-2
  let pbs = 0; // B-3
  for (const [A, tau, phi] of PBS) pbs += A * cosd((0.985626 * dt) / tau + phi);
  const nuMinusM = // B-4
    (10.691 + 3.0e-7 * dt) * sind(M) + 0.623 * sind(2 * M) + 0.05 * sind(3 * M) + 0.005 * sind(4 * M) + 0.0005 * sind(5 * M) + pbs;
  const ls = mod(alphaFMS + nuMinusM, 360); // B-5
  const eotDeg = 2.861 * sind(2 * ls) - 0.071 * sind(4 * ls) + 0.002 * sind(6 * ls) - nuMinusM; // C-1
  const msd = (jdTT - 2451549.5) / SOL_PER_DAY + 44796.0 - 0.00096; // C-2 (inner term)
  const mtcH = mod(24 * msd, 24); // C-2
  const subsolarLonW = mod((mtcH + eotDeg / 15) * 15 + 180, 360); // C-5
  const declDeg = Math.asin(0.42565 * sind(ls)) * R2D + 0.25 * sind(ls); // D-1
  const rAU = 1.523679 * (1.00436 - 0.09309 * cosd(M) - 0.004336 * cosd(2 * M) - 0.00031 * cosd(3 * M) - 0.00003 * cosd(4 * M)); // D-2
  const helioLonDeg = mod(ls + 85.061 - 0.015 * sind(71 + 2 * ls) - 5.5e-6 * dt, 360); // D-3
  const helioLatDeg = -(1.8497 - 2.23e-5 * dt) * sind(ls - 144.5 + 2.57e-6 * dt); // D-4
  return { jdUT, ttMinusUtc: dT, jdTT, dtJ2000: dt, M, alphaFMS, pbs, nuMinusM, ls, eotDeg, mtcH, msd, subsolarLonW, declDeg, rAU, helioLonDeg, helioLatDeg };
}

/** D-5/D-6 for planetographic latitude φ, declination δ and hour angle H (°). Azimuth clockwise from north. */
export function sunFromHourAngle(latGraphicDeg: number, declDeg: number, hourAngleDeg: number): { elevDeg: number; azDeg: number; zenithDeg: number } {
  const cz = sind(declDeg) * sind(latGraphicDeg) + cosd(declDeg) * cosd(latGraphicDeg) * cosd(hourAngleDeg);
  const zenithDeg = Math.acos(Math.max(-1, Math.min(1, cz))) * R2D;
  const az = Math.atan2(sind(hourAngleDeg), cosd(latGraphicDeg) * Math.tan(declDeg * D2R) - sind(latGraphicDeg) * cosd(hourAngleDeg)) * R2D;
  return { elevDeg: 90 - zenithDeg, azDeg: mod(az, 360), zenithDeg };
}

/** IAU 2000 Mars ellipsoid radii (km), for planetocentric → planetographic latitude. */
const RE = 3396.19, RP = 3376.2;
export function planetographicLat(latCentricDeg: number): number {
  return Math.atan(Math.tan(latCentricDeg * D2R) * (RE / RP) ** 2) * R2D;
}

/** Sun position at an instant for a planetographic WEST longitude / planetographic latitude (Mars24 native). */
export function sunPositionGraphic(utcMs: number, lonWestDeg: number, latGraphicDeg: number) {
  const m = mars24(utcMs);
  const H = lonWestDeg - m.subsolarLonW; // D-5: H = Λ − Λs
  return sunFromHourAngle(latGraphicDeg, m.declDeg, H);
}

/**
 * Mars time at a site (planetocentric east longitude).
 * Returns MSD, MTC/LMST/LTST in Mars-clock hours (0–24), Ls (°) and the equation of time in
 * Mars-clock minutes (EOT° × 4).
 */
export function marsTime(utcMs: number, lonEastDeg: number): { msd: number; mtcH: number; lmstH: number; ltstH: number; lsDeg: number; eotMin: number } {
  const m = mars24(utcMs);
  const lonW = mod(-lonEastDeg, 360);
  const lmstH = mod(m.mtcH - lonW / 15, 24); // C-3
  const ltstH = mod(lmstH + m.eotDeg / 15, 24); // C-4
  return { msd: m.msd, mtcH: m.mtcH, lmstH, ltstH, lsDeg: m.ls, eotMin: m.eotDeg * 4 };
}

/** Sun elevation / azimuth (clockwise from north) at an instant, planetocentric east lon / lat. */
export function sunPosition(utcMs: number, lonEastDeg: number, latDeg: number): { elevDeg: number; azDeg: number } {
  const s = sunPositionGraphic(utcMs, mod(-lonEastDeg, 360), planetographicLat(latDeg));
  return { elevDeg: s.elevDeg, azDeg: s.azDeg };
}

/** Solar declination from Ls (Mars24 D-1, Allison 1997 eq. 5), degrees. */
export function solarDeclination(lsDeg: number): number {
  return Math.asin(0.42565 * sind(lsDeg)) * R2D + 0.25 * sind(lsDeg);
}

/**
 * Sun at a Local True Solar Time (Mars-clock minutes after local midnight, 0–1440) for a season Ls
 * and planetocentric latitude. Hour angle from LTST: H = 180° − 15°·LTST_h (H > 0 = morning,
 * consistent with Mars24's H = Λ − Λs in west longitude).
 */
export function sunAtLtst(lsDeg: number, ltstMin: number, latDeg: number): { elevDeg: number; azDeg: number } {
  const H = 180 - (ltstMin / 60) * 15;
  const s = sunFromHourAngle(planetographicLat(latDeg), solarDeclination(lsDeg), H);
  return { elevDeg: s.elevDeg, azDeg: s.azDeg };
}

/**
 * LTST (Mars-clock minutes) at EVA minute tMin (Earth minutes) after an EVA starting at startLtstMin.
 * Mars-clock minutes are 1/1440 sol = 1.0275 Earth minutes (Mars24 C-2).
 */
export function ltstAt(startLtstMin: number, tMin: number): number {
  return startLtstMin + tMin / EARTH_MIN_PER_MARS_MIN;
}

/** "HH:MM" for Mars-clock minutes. */
export function formatLtst(ltstMin: number): string {
  const m = mod(Math.round(ltstMin), 1440);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
