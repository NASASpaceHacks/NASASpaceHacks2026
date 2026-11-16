import type { RemsSol, SitePackManifest } from '@mw/shared/contracts';

/** Which rover's weather station the pack's `conditions.rems` array holds (the field name is historical; Jezero holds MEDA). */
export interface RoverWx {
  /** 'REMS' or 'MEDA' */
  instrument: string;
  /** 'Curiosity' / 'Perseverance' */
  rover: string;
  /** 'Curiosity REMS' / 'Perseverance MEDA' */
  label: string;
  mission: string;
  url: string;
  credit: string;
}

export function roverWxFor(m: SitePackManifest): RoverWx {
  const jezero = /jezero/i.test(`${m.id} ${m.name}`);
  return jezero
    ? { rover: 'Perseverance', instrument: 'MEDA', label: 'Perseverance MEDA', mission: 'Mars 2020', url: 'https://mars.nasa.gov/mars2020/weather/', credit: 'MEDA team, Centro de Astrobiología (CSIC-INTA) / NASA/JPL-Caltech' }
    : { rover: 'Curiosity', instrument: 'REMS', label: 'Curiosity REMS', mission: 'Mars Science Laboratory', url: 'https://mars.nasa.gov/msl/mission/weather/', credit: 'REMS team, Centro de Astrobiología (CSIC-INTA)' };
}

/** The most recent sol in the feed (the array order is not guaranteed). */
export function latestWx(m: SitePackManifest): { latest: RemsSol; first: number; last: number; n: number } | null {
  const r = m.conditions.rems;
  if (!r?.length) return null;
  const sols = r.map((x) => x.sol);
  const last = Math.max(...sols);
  return { latest: r.find((x) => x.sol === last)!, first: Math.min(...sols), last, n: r.length };
}
