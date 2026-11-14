import { idx, type Area, type RoverStop } from './data';
import { plan, PRESETS, hazardMask, timeTo } from './router';
import type { Mission, Params, Pt, Stop, Weights } from './types';

export const DEFAULT_PARAMS: Params = { speed: 0.5, maxSlope: 15, maxRough: 10, budgetMin: 120, reserveMin: 20, bufferM: 4 };
export const DEFAULT_WEIGHTS: Weights = { distance: 0.6, slope: 0.6, rough: 0.6, thermal: 0.3, science: 0.5 };
/** Arrival tolerance by task (Exploration EVA ConOps: 3-5 m for samples, 0.5 m for instrument emplacement). */
export const TASK_RADIUS = { observe: 5, photo: 5, sample: 3, instrument: 0.5 } as const;

let uid = 0;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/** Default EVA: habitat at the Perseverance landing site and three rover-documented sites plus one orbital-only target. */
export function initialStops(a: Area): Stop[] {
  const rs = (sol: number) => a.rover.stops.find((s) => s.sol === sol)!;
  const mk = (s: RoverStop & Pt, name: string, task: Stop['task'], dwell: number, note: string): Stop => ({
    id: newId('s'), name, kind: 'science', x: s.x, y: s.y, task, dwellMin: dwell, arrivalM: TASK_RADIUS[task], note,
  });
  const base = rs(13);
  return [
    { id: 'base', name: 'Habitat (Octavia E. Butler landing)', kind: 'base', x: base.x, y: base.y, task: 'observe', dwellMin: 0, arrivalM: 5, note: 'Perseverance landing site, site 3 drive 0' },
    mk(rs(73), 'Crater-floor outcrop (sol 73 stop)', 'photo', 6, 'Rover-documented site; compare with Navcam POV'),
    mk(rs(113), 'Southern rock unit (sol 113 stop)', 'sample', 10, 'Sample tolerance 3 m'),
    mk(rs(381), 'NE ridge (sol 381 stop)', 'observe', 5, 'Overlook toward dune field'),
    { id: newId('s'), name: 'Dune-field margin', kind: 'science', x: 213, y: 190, task: 'observe', dwellMin: 5, arrivalM: 5,
      note: 'Aeolian bedforms west of the ridge; no rover visit, plan from HiRISE only' },
  ];
}

/** Locally planned demo mission so the HUD can be tried without Mission Control. */
export function demoMission(a: Area): Mission {
  const stops = initialStops(a);
  const params = DEFAULT_PARAMS;
  const w = PRESETS.find((p) => p.id === 'safest')!.weights;
  const { blocked } = hazardMask(a, params, []);
  const ttb = timeTo(a, blocked, idx(a, stops[0].x, stops[0].y), params.speed);
  const route = plan({ area: a, stops, order: stops.slice(1).map((_, k) => k + 1), params, weights: w, nogo: [], sciencePts: stops.slice(1), ttb, id: 'safest', label: 'Safest (demo)' });
  return { id: newId('demo'), version: 1, name: 'Demo EVA (local)', deployedAt: new Date().toISOString(), stops, route, nogo: [], params, weights: w };
}
