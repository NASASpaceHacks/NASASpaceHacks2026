import { createHash, randomUUID } from 'node:crypto';
import type { DtnBundle } from '@mw/shared/contracts';
import type { EarthBundleRequest, EarthBundleView, EarthState } from '@mw/shared/link';

/**
 * Earth relay with light-time delay.
 *
 * Heliocentric positions from JPL "Approximate Positions of the Planets" (E. M. Standish,
 * JPL/Caltech), Table 1: Keplerian elements + rates per Julian century w.r.t. the mean ecliptic
 * and equinox of J2000, valid 1800–2050 AD. https://ssd.jpl.nasa.gov/planets/approx_pos.html
 * Earth is represented by the Earth–Moon barycentre ("EM Bary"), as in that table; the ≈4,700 km
 * offset is negligible against a 0.37–2.7 AU Earth–Mars distance.
 */

type El = [base: number, ratePerCy: number];
interface Elements { a: El; e: El; I: El; L: El; peri: El; node: El }

// a [au], e [-], I [deg], L [deg], long.peri [deg], long.node [deg] — JPL approx_pos Table 1.
const EM_BARY: Elements = {
  a: [1.00000261, 0.00000562],
  e: [0.01671123, -0.00004392],
  I: [-0.00001531, -0.01294668],
  L: [100.46457166, 35999.37244981],
  peri: [102.93768193, 0.32327364],
  node: [0.0, 0.0],
};
const MARS: Elements = {
  a: [1.52371034, 0.00001847],
  e: [0.0933941, 0.00007882],
  I: [1.84969142, -0.00813131],
  L: [-4.55343205, 19140.30268499],
  peri: [-23.94362959, 0.44441088],
  node: [49.55953891, -0.29257343],
};

/** IAU 2012 Resolution B2: 1 au = 149,597,870,700 m. */
const AU_KM = 149_597_870.7;
/** Speed of light (SI definition), km/s. */
const C_KM_S = 299_792.458;
/** TT − UTC = 32.184 s (TT − TAI) + 37 s (TAI − UTC since 2017-01-01, IERS Bulletin C). */
const TT_MINUS_UTC_S = 69.184;

const D2R = Math.PI / 180;

export function julianDateTT(utcMs: number): number {
  return utcMs / 86_400_000 + 2_440_587.5 + TT_MINUS_UTC_S / 86_400;
}

/** Heliocentric J2000-ecliptic position (au) per the approx_pos algorithm (steps 1–5). */
export function heliocentric(el: Elements, jdTT: number): [number, number, number] {
  const T = (jdTT - 2_451_545.0) / 36_525;
  const at = (x: El) => x[0] + x[1] * T;
  const a = at(el.a), e = at(el.e), I = at(el.I), L = at(el.L), peri = at(el.peri), node = at(el.node);
  const w = peri - node; // argument of perihelion
  let M = (L - peri) % 360; // mean anomaly (Table 1 has no b,c,s,f terms)
  if (M > 180) M -= 360;
  if (M < -180) M += 360;
  const eStar = e / D2R; // e in degrees
  let E = M + eStar * Math.sin(M * D2R);
  for (let k = 0; k < 50; k++) {
    const dM = M - (E - eStar * Math.sin(E * D2R));
    const dE = dM / (1 - e * Math.cos(E * D2R));
    E += dE;
    if (Math.abs(dE) <= 1e-6) break;
  }
  const xp = a * (Math.cos(E * D2R) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E * D2R);
  const cw = Math.cos(w * D2R), sw = Math.sin(w * D2R);
  const cO = Math.cos(node * D2R), sO = Math.sin(node * D2R);
  const cI = Math.cos(I * D2R), sI = Math.sin(I * D2R);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

export function earthMarsDistanceAu(utcMs: number): number {
  const jd = julianDateTT(utcMs);
  const e = heliocentric(EM_BARY, jd);
  const m = heliocentric(MARS, jd);
  return Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]);
}

export function oneWayLightMin(utcMs: number): number {
  return (earthMarsDistanceAu(utcMs) * AU_KM) / C_KM_S / 60;
}

/**
 * Mars Sol Date + Coordinated Mars Time, Mars24 algorithm step C-2 (Allison & McEwen 2000,
 * Planet. Space Sci. 48, 215–235; https://www.giss.nasa.gov/tools/mars24/help/algorithm.html).
 */
export function marsSolDate(utcMs: number): { msd: number; mtcH: number } {
  const dtJ2000 = julianDateTT(utcMs) - 2_451_545.0;
  const msd = (dtJ2000 - 4.5) / 1.0274912517 + 44_796.0 - 0.0009626;
  return { msd, mtcH: (((msd % 1) + 1) % 1) * 24 };
}

export function formatMarsTime(utcMs: number): string {
  const { msd, mtcH } = marsSolDate(utcMs);
  const h = Math.floor(mtcH);
  const m = Math.floor((mtcH - h) * 60);
  return `MSD ${msd.toFixed(5)} MTC ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

type StoredBundle = DtnBundle & { timeScale: number };

export class EarthRelay {
  private bundles: StoredBundle[] = [];

  constructor(private max = 200) {}

  submit(req: EarthBundleRequest, nowMs = Date.now()): StoredBundle {
    const lightMin = oneWayLightMin(nowMs);
    const timeScale = req.timeScale ?? 1;
    const bundle: StoredBundle = {
      id: randomUUID(),
      src: req.src ?? 'hab',
      kind: req.kind,
      createdUtc: new Date(nowMs).toISOString(),
      marsTime: formatMarsTime(nowMs),
      oneWayLightMin: lightMin,
      deliverAtUtc: new Date(nowMs + (lightMin * 60_000) / timeScale).toISOString(),
      body: req.body ?? null,
      sha256: createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex'),
      timeScale,
    };
    this.restore(bundle);
    return bundle;
  }

  restore(b: StoredBundle): void {
    this.bundles.push(b);
    if (this.bundles.length > this.max) this.bundles.splice(0, this.bundles.length - this.max);
  }

  view(nowMs = Date.now(), limit = 50): EarthState {
    const bundles: EarthBundleView[] = this.bundles.slice(-limit).map((b) => ({
      ...b,
      status: Date.parse(b.deliverAtUtc) <= nowMs ? 'delivered' : 'in_flight',
    }));
    return {
      oneWayLightMin: oneWayLightMin(nowMs),
      distanceAu: earthMarsDistanceAu(nowMs),
      computedUtc: new Date(nowMs).toISOString(),
      method: 'Keplerian mean elements, JPL Approximate Positions of the Planets, Table 1 (1800–2050 AD)',
      source: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html',
      bundles,
    };
  }
}
