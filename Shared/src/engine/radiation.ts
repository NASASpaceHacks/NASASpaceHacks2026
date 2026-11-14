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
 * Terrain shielding (optional `skyview` raster = visible-sky fraction 0–1):
 *   S = 1 − 0.85·blockedFraction. Guo et al. 2026 (JGR-Planets) report RAD dose ratios of ~0.7–1.0
 *   under partial sky obstruction; the 0.85 coefficient is indicative. Terrain REDUCES dose
 *   somewhat — it is never a shelter; SEP response always means returning to a pressurized shelter.
 */
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
  const blocked = Math.min(1, Math.max(0, 1 - skyview));
  return 1 - 0.85 * blocked;
}

/** Dose-equivalent rate (µSv per Earth minute) at elevation z, with optional sky-view fraction. */
export function doseEqRateUSvPerMin(zM: number, skyview?: number, phiMV = PHI_DEFAULT_MV): number {
  if (!(zM === zM)) zM = DOSE_Z_REF_M;
  const d = Math.max(0, doseRateUGyPerDay(pressureAtElevation(zM), phiMV));
  return (d * QUALITY_FACTOR * skyShieldFactor(skyview)) / 1440;
}
