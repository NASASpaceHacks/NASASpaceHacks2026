/**
 * Heading cues without a magnetic compass (Mars has no global dipole field): the sun's azimuth
 * relative to the walking direction ("SUN AT 4 O'CLOCK"), or a landmark bearing around local noon
 * when the sun is too high to give a usable azimuth.
 */
import type { Landmark } from '@mw/shared/contracts';
import { bearingDeg, norm360, sunAtLtst } from '../adapters/engine';

export interface HeadingCue {
  kind: 'sun' | 'landmark' | 'none';
  text: string;
  clock: number;          // 1..12
  relDeg: number;         // relative bearing, clockwise from the walking direction
  azDeg: number;
  elevDeg: number;
  sunAzDeg: number;
  sunElevDeg: number;
  sub: string;
}

export const clockOf = (relDeg: number) => {
  const h = Math.round(norm360(relDeg) / 30) % 12;
  return h === 0 ? 12 : h;
};

/** Most useful landmark: IAU-named first (informal=false), then the highest. */
export function pickLandmark(landmarks: Landmark[]): Landmark | null {
  if (!landmarks.length) return null;
  return [...landmarks].sort((a, b) => Number(a.informal) - Number(b.informal) || b.elevM - a.elevM)[0];
}

export function headingCue(
  ltstMin: number,
  headingDeg: number,
  lsDeg: number,
  latDeg: number,
  pos: [number, number],
  landmark: Landmark | null,
): HeadingCue {
  const sun = sunAtLtst(lsDeg, ltstMin, latDeg);
  const h = (((ltstMin / 60) % 24) + 24) % 24;
  const noon = h >= 11 && h < 13;
  const useSun = !noon && sun.elevDeg > 2;
  if (useSun) {
    const rel = norm360(sun.azDeg - headingDeg);
    const clock = clockOf(rel);
    return {
      kind: 'sun', text: `SUN AT ${clock} O'CLOCK`, clock, relDeg: rel, azDeg: sun.azDeg, elevDeg: sun.elevDeg,
      sunAzDeg: sun.azDeg, sunElevDeg: sun.elevDeg, sub: `SUN AZ ${Math.round(sun.azDeg).toString().padStart(3, '0')}° · EL ${Math.round(sun.elevDeg)}°`,
    };
  }
  if (landmark) {
    const az = bearingDeg(pos[0], pos[1], landmark.x, landmark.y);
    const rel = norm360(az - headingDeg);
    const clock = clockOf(rel);
    const dist = Math.hypot(landmark.x - pos[0], landmark.y - pos[1]);
    return {
      kind: 'landmark', text: `${landmark.name.replace(/\s*\(.*?\)\s*/g, ' ').trim().toUpperCase()} AT ${clock} O'CLOCK`, clock, relDeg: rel, azDeg: az, elevDeg: 0,
      sunAzDeg: sun.azDeg, sunElevDeg: sun.elevDeg,
      sub: `${noon ? 'SUN HIGH' : 'SUN LOW'} · ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' KM' : Math.round(dist) + ' M'} · ${landmark.informal ? 'INFORMAL NAME' : 'IAU NAME'}`,
    };
  }
  return { kind: 'none', text: 'NO HEADING REFERENCE', clock: 12, relDeg: 0, azDeg: 0, elevDeg: 0, sunAzDeg: sun.azDeg, sunElevDeg: sun.elevDeg, sub: 'USE ROUTE MARKERS' };
}
