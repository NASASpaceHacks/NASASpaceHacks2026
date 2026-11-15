/**
 * Surface radiation dose (INDICATIVE — for planning awareness, not dosimetry).
 *
 * Absorbed dose rate (µGy/day) vs column pressure P (Pa) and heliospheric modulation Φ (MV):
 *   D = 267 − 0.13·(P − 840) − 0.11·Φ
 *   Guo et al. 2015, "Modeling the variations of dose rate measured by RAD during the first MSL
 *   Martian year: 2012–2014", arXiv:1507.03473.
 * Pressure with elevation: P = P_ref · exp(−(z − z_ref)/H), scale height H = 11.1 km rounded to
 *   11 km (NSSDC Mars Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html).
 *   P_ref = 750 Pa at z_ref = −4500 m is a TEAM ASSUMPTION (order of the REMS pressures measured on
 *   the Gale floor; the seasonal cycle is not modelled). Φ = 600 MV default is also an assumption.
 * Dose equivalent: × 3.05 (Hassler et al. 2014, Science 343:1244797: 0.21 ± 0.04 mGy/d →
 *   0.64 ± 0.12 mSv/d on the surface, i.e. mean quality factor ≈ 3.05).
 * Terrain shielding (optional `skyview` raster = visible-sky fraction 0–1, built by Pipeline/mwpipe/skyview.py):
 *   Guo et al. 2026 (JGR Planets, doi:10.1029/2026JE009704) two-term model, as reproduced in Validation/v1_shielding:
 *   D(B) = (1 − f)(1 − w·B) + f(1 + B), B = obstructed fraction of the sky, f = 0.21 flat-terrain (albedo) share,
 *   w = 1.377 sky weighting (both from the paper's tables, not fitted to RAD). D(0) = 1, and D is linear in B with
 *   slope (1 − f)·w − f ≈ 0.88. Terrain REDUCES dose somewhat (RAD saw at most 19 %) — it is never a shelter;
 *   SEP response always means returning to a pressurized shelter. Indicative.
 */
export const SHIELD_F_ALBEDO = 0.21;
export const SHIELD_W_SKY = 1.377;
export const DOSE_P_REF_PA = 750;
export const DOSE_Z_REF_M = -4500;
export const MARS_SCALE_HEIGHT_M = 11000;
export const PHI_DEFAULT_MV = 600;
export const QUALITY_FACTOR = 3.05;

export function pressureAtElevation(zM: number, pRef = DOSE_P_REF_PA, zRef = DOSE_Z_REF_M): number {
  return pRef * Math.exp(-(zM - zRef) / MARS_SCALE_HEIGHT_M);
}

/** Absorbed dose rate (µGy/day) at pressure P (Pa), modulation Φ (MV). */
export function doseRateUGyPerDay(pPa: number, phiMV = PHI_DEFAULT_MV): number {
  return 267 - 0.13 * (pPa - 840) - 0.11 * phiMV;
}

/** Terrain shielding factor from the visible-sky fraction (1 = open sky). Indicative. */
export function skyShieldFactor(skyview: number | undefined): number {
  if (skyview === undefined || !(skyview === skyview)) return 1;
  const B = Math.min(1, Math.max(0, 1 - skyview));
  const D = (1 - SHIELD_F_ALBEDO) * (1 - SHIELD_W_SKY * B) + SHIELD_F_ALBEDO * (1 + B);
  return Math.min(1, Math.max(0, D));
}

/** Dose-equivalent rate (µSv per Earth minute) at elevation z, with optional sky-view fraction. */
export function doseEqRateUSvPerMin(zM: number, skyview?: number, phiMV = PHI_DEFAULT_MV): number {
  if (!(zM === zM)) zM = DOSE_Z_REF_M;
  const d = Math.max(0, doseRateUGyPerDay(pressureAtElevation(zM), phiMV));
  return (d * QUALITY_FACTOR * skyShieldFactor(skyview)) / 1440;
}
