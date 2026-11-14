// Mars time, Sun geometry and Earth-Mars light time, computed locally (no network).
// Mars clock follows NASA GISS Mars24 (Allison & McEwen 2000). Light time uses JPL mean Keplerian elements
// (Standish, valid 1800-2050) and is an approximation (~1%), adequate for comms-delay awareness.
const D2R = Math.PI / 180;

function jdTT(ms: number) {
  return ms / 86400000 + 2440587.5 + 69.184 / 86400;
}

export interface MarsTime {
  ls: number;       // areocentric solar longitude, deg
  mtc: number;      // coordinated Mars time, hours
  lmst: number;     // local mean solar time, hours
  ltst: number;     // local true solar time, hours
  sunElev: number;  // deg above horizon (no terrain horizon)
  sol: number;      // Mars sol date
}

export function marsTime(ms: number, lonEast: number, latDeg: number): MarsTime {
  const jd = jdTT(ms);
  const dt = jd - 2451545.0;
  const M = (19.3871 + 0.52402073 * dt) * D2R;
  const aFMS = 270.3871 + 0.524038496 * dt;
  const A = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.002, 0.0018];
  const tau = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
  const phi = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
  let pbs = 0;
  for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos(((0.985626 * dt) / tau[i] + phi[i]) * D2R);
  const eoc = (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.05 * Math.sin(3 * M)
    + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + pbs;
  const ls = (((aFMS + eoc) % 360) + 360) % 360;
  const L = ls * D2R;
  const eot = 2.861 * Math.sin(2 * L) - 0.071 * Math.sin(4 * L) + 0.002 * Math.sin(6 * L) - eoc;
  const msd = (jd - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mtc = (((24 * msd) % 24) + 24) % 24;
  const lmst = (((mtc + lonEast / 15) % 24) + 24) % 24;
  const ltst = (((lmst + eot / 15) % 24) + 24) % 24;
  const dec = Math.asin(0.42565 * Math.sin(L)) + 0.25 * D2R * Math.sin(L);
  const H = (ltst - 12) * 15 * D2R;
  const lat = latDeg * D2R;
  const sunElev = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H)) / D2R;
  return { ls, mtc, lmst, ltst, sunElev, sol: Math.floor(msd) };
}

export function fmtHours(h: number) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

type El = { a: number; e: number; i: number; L: number; w: number; O: number; da: number; de: number; di: number; dL: number; dw: number; dO: number };
const EARTH: El = { a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166, w: 102.93768193, O: 0, da: 0.00000562, de: -0.00004392, di: -0.01294668, dL: 35999.37244981, dw: 0.32327364, dO: 0 };
const MARS: El = { a: 1.52371034, e: 0.0933941, i: 1.84969142, L: -4.55343205, w: -23.94362959, O: 49.55953891, da: 0.00001847, de: 0.00007882, di: -0.00813131, dL: 19140.30268499, dw: 0.44441088, dO: -0.29257343 };

function helio(el: El, T: number): [number, number, number] {
  const a = el.a + el.da * T, e = el.e + el.de * T, I = (el.i + el.di * T) * D2R;
  const L = el.L + el.dL * T, w = el.w + el.dw * T, O = el.O + el.dO * T;
  const M = ((((L - w) % 360) + 540) % 360 - 180) * D2R;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const om = (w - O) * D2R, Om = O * D2R;
  const co = Math.cos(om), so = Math.sin(om), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

/** One-way Earth-Mars light time in minutes. */
export function lightTimeMin(ms: number): number {
  const T = (jdTT(ms) - 2451545.0) / 36525;
  const e = helio(EARTH, T), m = helio(MARS, T);
  const au = Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]);
  return (au * 499.004784) / 60;
}

/** Published reference: MSL RAD surface dose-equivalent rate at Gale, 0.64 +/- 0.12 mSv/day (Hassler et al. 2014, Science 343). */
export const RAD_GALE_MSV_PER_DAY = 0.64;
