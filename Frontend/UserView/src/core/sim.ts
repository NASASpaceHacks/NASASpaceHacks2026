/**
 * Astronaut simulator (runs on the visor, per docs/AGENTS.md): walks the confirmed route at
 * v0 × sim speed, dwells at stations, accumulates dead-reckoning drift, burns O₂ and produces
 * metabolic/heat estimates. Pure data in, pure data out: SimState is JSON-serialisable so it can be
 * checkpointed to localStorage on every tick.
 */
import type { RouteModel } from './route';
import { HEAT_INITIAL_W, HEAT_TAU_MIN } from '../adapters/engine';
import {
  ARRIVE_RADIUS_M,
  DR_SIGMA_FRAC,
  EVA_DURATION_MIN,
  EVA_T0_MIN,
  HEAT_PACE_FACTOR,
  SIGMA0_M,
  V0,
} from './constants';

export type SimMode = 'IDLE' | 'WALK' | 'DWELL' | 'RETURN' | 'DONE';

export interface SimState {
  running: boolean;
  speed: number;
  t: number;              // EVA minutes
  s: number;              // along-route distance of the TRUE position (m)
  mode: SimMode;
  stopK: number;          // index of the next stop not yet completed
  dwellStart: number | null;
  dwellUntil: number | null;
  dwellCut: boolean;
  tasksDone: number;      // crew tasks ticked at the current station
  visited: string[];
  returnDir: 1 | -1;
  sigmaM: number;
  sinceFixM: number;
  driftX: number;
  driftY: number;
  driftTheta: number;
  o2Pct: number;
  metW: number;
  heatAvgW: number;       // suit-heat rolling average: leaky integrator, τ = engine HEAT_TAU_MIN (30 min)
  headingDeg: number;
  odoM: number;
  rng: number;
}

export type SimEvent =
  | { e: 'ARRIVED'; id: string }
  | { e: 'DEPARTED'; id: string }
  | { e: 'DONE' }
  | { e: 'RETURNING' };

export interface SimEnv {
  elevAt?: (x: number, y: number) => number;
  heatAdvisory: boolean;
  returning: boolean;
}

/** mulberry32 step with explicit state (keeps SimState serialisable). */
function rand(sim: SimState): number {
  let a = (sim.rng = (sim.rng + 0x6d2b79f5) >>> 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
function gauss(sim: SimState): number {
  const u = Math.max(1e-9, rand(sim)), v = rand(sim);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Metabolic rate while walking, W. TEAM PLACEHOLDER (not a published model): 290 W on the level at
 * 0.56 m/s, +14 W per % uphill grade, +5 W per % downhill grade (i.e. less when descending, floor
 * 220 W). Chosen to sit in the 300–380 W range of the golden plan burndown; replace with the
 * engine CostModel.edgePowerW (Pandolf/Santee) once the visor carries a cost grid.
 */
export function walkMetW(gradePct: number): number {
  const g = Math.max(-15, Math.min(25, gradePct));
  return Math.max(220, Math.min(650, 290 + (g >= 0 ? 14 * g : 5 * g)));
}
/** Default station task power, W (Station.taskW default per contracts). */
const TASK_W_DEFAULT = 250;
/** Resting in suit (paused / done), W (team placeholder). */
const REST_W = 150;

export function newSim(seed: number, running: boolean, speed: number): SimState {
  return {
    running,
    speed,
    t: EVA_T0_MIN,
    s: 0,
    mode: 'WALK',
    stopK: 0,
    dwellStart: null,
    dwellUntil: null,
    dwellCut: false,
    tasksDone: 0,
    visited: [],
    returnDir: 1,
    sigmaM: SIGMA0_M,
    sinceFixM: 0,
    driftX: 0,
    driftY: 0,
    driftTheta: (seed % 628) / 100,
    o2Pct: 100 * (1 - EVA_T0_MIN / EVA_DURATION_MIN),
    metW: REST_W,
    heatAvgW: HEAT_INITIAL_W,
    headingDeg: 0,
    odoM: 0,
    rng: seed >>> 0,
  };
}

/** Re-anchor the simulator on a new route version (mid-EVA replan): keep time, O₂, drift; snap to the new route. */
export function rebaseSim(sim: SimState, oldRoute: RouteModel | null, route: RouteModel): void {
  const [x, y] = oldRoute ? oldRoute.pointAt(sim.s) : route.pointAt(0);
  const near = route.nearest(x, y);
  sim.s = near.s;
  let k = 0;
  while (k < route.stops.length && (sim.visited.includes(route.stops[k].id) || route.stops[k].s < sim.s - ARRIVE_RADIUS_M)) k++;
  sim.stopK = k;
  if (sim.mode !== 'DONE') sim.mode = 'WALK';
  sim.dwellStart = sim.dwellUntil = null;
  sim.dwellCut = false;
  sim.headingDeg = route.bearingAt(sim.s);
}

function fix(sim: SimState) {
  sim.sigmaM = SIGMA0_M;
  sim.sinceFixM = 0;
  sim.driftX = sim.driftY = 0;
}

/** dH/dt = (P − H)/τ — the engine heat governor's "leaky bucket" form of the 30-min average. */
function accumulateHeat(sim: SimState, dtS: number) {
  sim.heatAvgW += (sim.metW - sim.heatAvgW) * (1 - Math.exp(-dtS / 60 / HEAT_TAU_MIN));
}

function advance(sim: SimState, route: RouteModel, s1: number, env: SimEnv) {
  const ds = Math.abs(s1 - sim.s);
  if (ds <= 0) return;
  if (env.elevAt) {
    const [xa, ya] = route.pointAt(sim.s);
    const [xb, yb] = route.pointAt(s1);
    const za = env.elevAt(xa, ya), zb = env.elevAt(xb, yb);
    const grade = Number.isFinite(za) && Number.isFinite(zb) ? ((zb - za) / ds) * 100 : 0;
    sim.metW = walkMetW(grade);
  } else sim.metW = walkMetW(0);
  // Dead reckoning: σ grows with distance since the last fix; the actual error wanders coherently.
  sim.driftTheta += gauss(sim) * 0.08 * Math.sqrt(ds);
  sim.driftX += ds * DR_SIGMA_FRAC * 0.7 * Math.cos(sim.driftTheta);
  sim.driftY += ds * DR_SIGMA_FRAC * 0.7 * Math.sin(sim.driftTheta);
  sim.sinceFixM += ds;
  sim.sigmaM = SIGMA0_M + DR_SIGMA_FRAC * sim.sinceFixM;
  const mag = Math.hypot(sim.driftX, sim.driftY);
  if (mag > 1.5 * sim.sigmaM) {
    sim.driftX *= (1.5 * sim.sigmaM) / mag;
    sim.driftY *= (1.5 * sim.sigmaM) / mag;
  }
  sim.odoM += ds;
  sim.s = s1;
}

/** Advance the simulator by dtRealS seconds of wall time. Returns discrete events. */
export function simTick(sim: SimState, route: RouteModel, dtRealS: number, env: SimEnv): SimEvent[] {
  const ev: SimEvent[] = [];
  if (!sim.running || sim.mode === 'IDLE') return ev;
  const dt = dtRealS * sim.speed; // sim seconds
  if (sim.mode === 'DONE') {
    sim.metW = REST_W;
    return ev;
  }
  sim.t += dt / 60;
  sim.o2Pct = Math.max(0, 100 * (1 - sim.t / EVA_DURATION_MIN));

  if (env.returning && sim.mode !== 'RETURN') {
    // Head home along the route: backtrack only when this route started at the home shelter.
    const startIsHome = Math.hypot(route.start.x - route.home.x, route.start.y - route.home.y) < 25;
    sim.returnDir = startIsHome && sim.s < route.length - sim.s ? -1 : 1;
    sim.mode = 'RETURN';
    sim.dwellStart = sim.dwellUntil = null;
    ev.push({ e: 'RETURNING' });
  }

  const v = V0 * (env.heatAdvisory ? HEAT_PACE_FACTOR : 1);
  switch (sim.mode) {
    case 'DWELL': {
      const st = route.stops[sim.stopK];
      sim.metW = st?.station?.taskW ?? TASK_W_DEFAULT;
      if (!st || (sim.dwellUntil !== null && sim.t >= sim.dwellUntil)) {
        if (st) {
          sim.visited.push(st.id);
          ev.push({ e: 'DEPARTED', id: st.id });
        }
        sim.stopK++;
        sim.mode = 'WALK';
        sim.dwellStart = sim.dwellUntil = null;
        sim.dwellCut = false;
      }
      break;
    }
    case 'WALK': {
      const st = route.stops[sim.stopK];
      const target = st ? st.s : route.length;
      const s1 = Math.min(target, sim.s + v * dt);
      advance(sim, route, s1, env);
      sim.headingDeg = route.bearingAt(sim.s, 1);
      if (st && target - sim.s <= ARRIVE_RADIUS_M) {
        advance(sim, route, target, env);
        sim.mode = 'DWELL';
        sim.dwellStart = sim.t;
        let until = sim.t + st.dwellMin;
        sim.dwellCut = false;
        // Behind schedule: cut the dwell so the crew still leaves before bingo.
        if (st.bingo && until > st.bingo.tMin - 1) {
          until = Math.max(sim.t + 2, st.bingo.tMin - 1);
          sim.dwellCut = true;
        }
        sim.dwellUntil = until;
        sim.tasksDone = 0;
        fix(sim);
        ev.push({ e: 'ARRIVED', id: st.id });
      } else if (!st && route.length - sim.s <= 1) {
        sim.mode = 'DONE';
        fix(sim);
        ev.push({ e: 'DONE' });
      }
      break;
    }
    case 'RETURN': {
      const target = sim.returnDir > 0 ? route.length : 0;
      const s1 = sim.returnDir > 0 ? Math.min(target, sim.s + v * dt) : Math.max(target, sim.s - v * dt);
      advance(sim, route, s1, env);
      sim.headingDeg = route.bearingAt(sim.s, sim.returnDir);
      if (Math.abs(target - sim.s) <= 1) {
        sim.mode = 'DONE';
        fix(sim);
        ev.push({ e: 'DONE' });
      }
      break;
    }
  }
  accumulateHeat(sim, dt);
  return ev;
}

/** Leave the current station now (key N). */
export function departNow(sim: SimState): void {
  if (sim.mode === 'DWELL') sim.dwellUntil = sim.t;
}

/** Estimated (dead-reckoned) position: truth + accumulated drift. */
export function estimatedXY(sim: SimState, route: RouteModel): [number, number] {
  const [x, y] = route.pointAt(sim.s);
  return [x + sim.driftX, y + sim.driftY];
}
