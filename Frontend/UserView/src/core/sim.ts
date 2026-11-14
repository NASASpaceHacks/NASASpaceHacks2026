/**
 * Astronaut simulator (runs on the visor, per docs/AGENTS.md): walks the confirmed route, dwells at
 * stations, accumulates dead-reckoning drift, burns O₂ and produces metabolic/heat telemetry.
 *
 * It uses the ENGINE's models so TELEM matches the plan: each route edge takes the planner's travel
 * time (pandolf-santee-mars edgeCost: 3-D length at v0) at the planner's metabolic power (edgePowerW:
 * Pandolf–Santee × g ratio on the DEM grade), and the engine's suit-heat governor inserts rests at
 * REST_W before any edge that would push the 30-min heat average over the budget (engine heat.ts
 * restNeeded / leaky-bucket average). Pure data in, pure data out: SimState is JSON-serialisable so it
 * can be checkpointed to localStorage on every tick.
 */
import type { RouteModel } from './route';
import { HEAT_INITIAL_W, HEAT_TAU_MIN } from '../adapters/engine';
import { REST_W as GOV_REST_W, heatAfterWork, restNeeded, type HeatParams } from '@mw/shared/engine';
import {
  ARRIVE_RADIUS_M,
  DR_SIGMA_FRAC,
  EVA_T0_MIN,
  HEAT_BUDGET_W,
  HEAT_PACE_FACTOR,
  SIGMA0_M,
  o2PctAt,
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
  /** Heat-governor rest still to take before the next edge (sim seconds). */
  restLeftS?: number;
  /** Route segment whose governor check is done (direction-signed: +i forward, −(i+1) backward). */
  edgeKey?: number;
  /** True while standing for a suit-heat rest. */
  resting?: boolean;
  /** Total heat-governor rest taken (min). */
  restMin?: number;
}

export type SimEvent =
  | { e: 'ARRIVED'; id: string }
  | { e: 'DEPARTED'; id: string }
  | { e: 'DONE' }
  | { e: 'RETURNING' };

export interface SimEnv {
  /** Unused since the engine cost model times/costs the route (RouteModel.setTerrain); kept for callers. */
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

/** Default station task power, W (Station.taskW default per contracts; engine TASK_W_DEFAULT). */
const TASK_W_DEFAULT = 250;
/** Resting in suit (paused / done / heat rest), W — the engine governor's REST_W (heat.ts, team assumption). */
const REST_W = GOV_REST_W;
/** Suit-heat governor parameters (engine heat.ts): budget = heat_avg_max_w rule, rest power, 30-min τ. */
const HP: HeatParams = { budgetW: HEAT_BUDGET_W, restW: GOV_REST_W, tauMin: HEAT_TAU_MIN };

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
    o2Pct: o2PctAt(EVA_T0_MIN),
    metW: REST_W,
    heatAvgW: HEAT_INITIAL_W,
    headingDeg: 0,
    odoM: 0,
    rng: seed >>> 0,
    restLeftS: 0,
    edgeKey: Number.NaN,
    resting: false,
    restMin: 0,
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
  sim.edgeKey = Number.NaN; // re-run the heat-governor check on the new route's edge
  sim.headingDeg = route.bearingAt(sim.s);
}

function fix(sim: SimState) {
  sim.sigmaM = SIGMA0_M;
  sim.sinceFixM = 0;
  sim.driftX = sim.driftY = 0;
}

/** dH/dt = (P − H)/τ — the engine heat governor's "leaky bucket" form of the 30-min average. */
function accumulateHeat(sim: SimState, P: number, dtS: number) {
  if (dtS <= 0) return;
  sim.heatAvgW = heatAfterWork(sim.heatAvgW, dtS / 60, P, HP);
}

/** Move the TRUE position to s1 along the route (dead-reckoning drift grows with distance walked). */
function advance(sim: SimState, s1: number) {
  const ds = Math.abs(s1 - sim.s);
  if (ds <= 0) return;
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

/**
 * Walk toward `target` (along-route metres) in direction `dir` for up to `budget` sim seconds, edge by
 * edge, applying the engine heat governor before each edge. Returns the unused budget (> 0 only when
 * the target was reached).
 */
function walk(sim: SimState, route: RouteModel, target: number, dir: 1 | -1, budget: number, pace: number): number {
  let guard = 0;
  while (budget > 1e-6 && guard++ < 10000) {
    if (dir > 0 ? sim.s >= target - 1e-6 : sim.s <= target + 1e-6) return budget;
    // Suit-heat rest in progress: stand at REST_W.
    if ((sim.restLeftS ?? 0) > 0) {
      const r = Math.min(budget, sim.restLeftS!);
      sim.metW = REST_W;
      sim.resting = true;
      accumulateHeat(sim, REST_W, r);
      sim.restLeftS = sim.restLeftS! - r;
      sim.restMin = (sim.restMin ?? 0) + r / 60;
      budget -= r;
      continue;
    }
    sim.resting = false;
    // Current segment: forward → the segment starting at or before s; backward → the one ending at s.
    const i = dir > 0 ? route.locate(sim.s)[0] : route.locate(Math.max(0, sim.s - 1e-6))[0];
    const P = dir > 0 ? route.edgeP[i] : route.edgePRev[i];
    const key = dir > 0 ? i : -(i + 1);
    if (key !== sim.edgeKey) {
      sim.edgeKey = key;
      // Engine governor: rest first if walking this edge would push the 30-min average over the budget.
      const rest = restNeeded(sim.heatAvgW, route.edgeT[i] / pace / 60, P, HP);
      if (rest > 0) {
        sim.restLeftS = rest * 60;
        continue;
      }
    }
    const segEnd = dir > 0 ? Math.min(target, route.cum[i + 1]) : Math.max(target, route.cum[i]);
    const v = route.speedOn(i) * pace;
    const need = Math.abs(segEnd - sim.s) / v;
    const step = Math.min(budget, need);
    sim.metW = P;
    accumulateHeat(sim, P, step);
    advance(sim, step >= need ? segEnd : sim.s + dir * v * step);
    budget -= step;
  }
  return 0;
}

/** Advance the simulator by dtRealS seconds of wall time. Returns discrete events. */
export function simTick(sim: SimState, route: RouteModel, dtRealS: number, env: SimEnv): SimEvent[] {
  const ev: SimEvent[] = [];
  if (!sim.running || sim.mode === 'IDLE') return ev;
  const dt = dtRealS * sim.speed; // sim seconds
  if (sim.mode === 'DONE') {
    sim.metW = REST_W;
    sim.resting = false;
    return ev;
  }
  sim.t += dt / 60;
  sim.o2Pct = o2PctAt(sim.t);

  if (env.returning && sim.mode !== 'RETURN') {
    // Head home: forward along a route that ends at the home shelter; backtrack only when this route
    // started at home (out-and-back) and home is nearer behind.
    sim.returnDir = route.start.atHome && sim.s < route.length - sim.s ? -1 : 1;
    sim.mode = 'RETURN';
    sim.dwellStart = sim.dwellUntil = null;
    sim.edgeKey = Number.NaN;
    ev.push({ e: 'RETURNING' });
  }

  // Pace: the planning pace v0 (heat is handled by governor rests, as in the plan). The advisory pace
  // cut only applies if the average is somehow already over budget (e.g. restored from a checkpoint).
  const pace = env.heatAdvisory && !sim.resting ? HEAT_PACE_FACTOR : 1;
  switch (sim.mode) {
    case 'DWELL': {
      const st = route.stops[sim.stopK];
      sim.metW = st?.station?.taskW ?? TASK_W_DEFAULT;
      sim.resting = false;
      accumulateHeat(sim, sim.metW, dt);
      if (!st || (sim.dwellUntil !== null && sim.t >= sim.dwellUntil)) {
        if (st) {
          sim.visited.push(st.id);
          ev.push({ e: 'DEPARTED', id: st.id });
        }
        sim.stopK++;
        sim.mode = 'WALK';
        sim.dwellStart = sim.dwellUntil = null;
        sim.dwellCut = false;
        sim.edgeKey = Number.NaN;
      }
      break;
    }
    case 'WALK': {
      const st = route.stops[sim.stopK];
      const target = st ? st.s : route.length;
      const left = walk(sim, route, target, 1, dt, pace);
      sim.headingDeg = route.bearingAt(sim.s, 1);
      if (st && target - sim.s <= ARRIVE_RADIUS_M && (sim.restLeftS ?? 0) <= 0) {
        advance(sim, target);
        sim.mode = 'DWELL';
        sim.resting = false;
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
        sim.metW = st.station?.taskW ?? TASK_W_DEFAULT;
        accumulateHeat(sim, sim.metW, left);
        fix(sim);
        ev.push({ e: 'ARRIVED', id: st.id });
      } else if (!st && route.length - sim.s <= 1) {
        sim.mode = 'DONE';
        sim.resting = false;
        fix(sim);
        ev.push({ e: 'DONE' });
      }
      break;
    }
    case 'RETURN': {
      const target = sim.returnDir > 0 ? route.length : 0;
      walk(sim, route, target, sim.returnDir, dt, pace);
      sim.headingDeg = route.bearingAt(sim.s, sim.returnDir);
      if (Math.abs(target - sim.s) <= 1) {
        sim.mode = 'DONE';
        sim.resting = false;
        fix(sim);
        ev.push({ e: 'DONE' });
      }
      break;
    }
  }
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
