// Grid coordinates: x = column, y = row (north row 0), in routing cells (meta.grid.cell_m metres).
export interface Pt { x: number; y: number }

export type StopKind = 'base' | 'science' | 'goal';
export type TaskKind = 'observe' | 'photo' | 'sample' | 'instrument';

export interface Stop extends Pt {
  id: string;
  name: string;
  kind: StopKind;
  task: TaskKind;
  dwellMin: number;
  /** Arrival tolerance; Exploration EVA ConOps: ~3-5 m for samples, 0.5 m for instrument emplacement. */
  arrivalM: number;
  note?: string;
}

export interface NoGo { id: string; pts: Pt[]; reason: string; source: 'admin' | 'crew' }

export interface Weights {
  distance: number;  // time / path length
  slope: number;     // grade-related effort and fall risk
  rough: number;     // terrain safety (detrended roughness)
  thermal: number;   // prefer high thermal inertia (firmer ground proxy)
  science: number;   // pull toward science features
}

export interface Params {
  speed: number;       // flat walking speed m/s (engineering assumption)
  maxSlope: number;    // hard exclusion, deg
  maxRough: number;    // hard exclusion, cm
  budgetMin: number;   // EVA time budget
  reserveMin: number;  // return reserve
  bufferM: number;     // keep-out buffer around no-go zones
}

export interface RouteMetrics {
  lengthM: number;
  walkS: number;
  totalS: number;      // walking + dwell
  gainM: number;
  lossM: number;
  maxSlope: number;
  hazardPct: number;   // % length on slope>10deg or roughness > half the limit
  scienceScore: number; // 0-100
  minMarginS: number;  // min over route of budget - (elapsed + time-to-base + reserve)
  feasible: boolean;
}

export interface Route {
  id: string;
  label: string;
  weights: Weights;
  cells: number[];      // grid indices along the path
  legEnds: number[];    // index into cells where each leg ends (arrival at stop i+1)
  order: number[];      // stop visit order (indices into stops)
  elapsedS: number[];   // cumulative elapsed time (walk + dwell) at each cell
  returnS: number[];    // optimal walking time back to base from each cell
  metrics: RouteMetrics;
  error?: string;
}

export interface Mission {
  id: string;
  version: number;
  name: string;
  deployedAt: string;
  stops: Stop[];        // already in visit order; last returns to base if closed
  route: Route;
  nogo: NoGo[];
  params: Params;
  weights: Weights;
}

export interface Telemetry {
  t: number;            // epoch ms
  missionId: string;
  version: number;
  est: Pt;              // estimated position (cells)
  sigmaM: number;       // 1-sigma position uncertainty
  heading: number;      // deg true
  legIndex: number;     // next stop index
  crossTrackM: number;
  pet: number;          // phase elapsed seconds
  o2: number; battery: number; // % (simulated)
  marginS: number;
  status: 'nominal' | 'caution' | 'warning' | 'emergency';
  completed: string[];  // stop ids
  alerts: string[];
}

export interface CrewPin { id: string; t: number; at: Pt; kind: 'hazard' | 'science'; note: string }
