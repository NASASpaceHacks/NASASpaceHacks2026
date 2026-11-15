/**
 * AR visor position model: Mars has no GPS, so the helmet dead-reckons from an IMU + step counting and
 * its estimate drifts away from where the astronaut really is.
 *
 * - TRUE position (simulation truth) and ESTIMATED position (what the helmet believes) are kept apart.
 *   The estimate is what the visor shows, what off-route detection uses, and what the onboard safety
 *   core reads (via VisorController.posModel).
 * - While walking, the estimate error grows by a slowly-wandering drift of ~DRIFT_M_PER_MIN.
 * - Every FIX_INTERVAL_MIN mission minutes a landmark sighting or radio ranging to the rover snaps the
 *   estimate back to within ~FIX_RESIDUAL_M of the truth. Arriving at a surveyed station is also a fix.
 * - If the estimate stays more than OFF_ROUTE_M from the active route for OFF_ROUTE_HOLD_S mission
 *   seconds, reroute() runs the engine's A* (same cost model and slope / keep-out rules as the planner)
 *   from the estimated cell to the next unvisited stop, or to the rover / hab on the return leg, and the
 *   crew walks that local detour. The simulator holds its along-route progress meanwhile and resumes at
 *   the stop the detour rejoins.
 */
import { DEFAULT_CREW, DEFAULT_RULES, cellToXY, hornSlopeDeg, xyToCell, type CostGrid, type LoadedSitePack } from '@mw/shared/contracts';
import { astarSearch, buildCostGrid, pandolfSanteeMars } from '@mw/shared/engine';
import type { PositionModel, VisorController } from '@mw/visor/src/core/visor';
import type { SimState } from '@mw/visor/src/core/sim';
import type { RouteModel } from '@mw/visor/src/core/route';
import { bearingDeg } from '@mw/visor/src/adapters/engine';

export type XY = [number, number];

/** Dead-reckoning error growth while walking, m per minute walked (team assumption; IMU + step count, 1–3 m/min). */
export const DRIFT_M_PER_MIN = 2;
/** Mission minutes between position corrections (landmark sighting / radio ranging to the rover). */
export const FIX_INTERVAL_MIN = 10;
/** 1-σ residual error right after a correction, m (team assumption). */
export const FIX_RESIDUAL_M = 1.5;
/** Estimate this far from the active route counts as off route, m. */
export const OFF_ROUTE_M = 25;
/** Off route for longer than this (mission seconds) triggers a reroute. */
export const OFF_ROUTE_HOLD_S = 3;
/** After a failed reroute, wait this long (mission seconds) before trying again. */
export const REROUTE_RETRY_S = 30;
/** Demo "Push off route": sideways displacement of the true position, m. */
export const PUSH_M = 40;
/** How long a transient note stays up, real ms. */
const NOTE_MS = 6000;

// ─────────────────────────── geometry ───────────────────────────

interface Poly { pts: XY[]; cum: number[]; len: number }

function poly(pts: XY[]): Poly {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] ?? 0 };
}

function polyAt(p: Poly, s: number): XY {
  const { pts, cum } = p;
  if (pts.length === 1 || s <= 0) return pts[0];
  if (s >= p.len) return pts[pts.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1];
  const f = seg > 0 ? (s - cum[i - 1]) / seg : 0;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
}

/** Nearest point on a polyline: along-path distance s and perpendicular distance d. */
function polyNearest(pts: XY[], cum: number[] | null, pos: XY): { s: number; d: number } {
  if (pts.length === 0) return { s: 0, d: Infinity };
  if (pts.length === 1) return { s: 0, d: Math.hypot(pos[0] - pts[0][0], pos[1] - pts[0][1]) };
  let best = { s: 0, d: Infinity };
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((pos[0] - ax) * dx + (pos[1] - ay) * dy) / L2)) : 0;
    const d = Math.hypot(pos[0] - (ax + dx * t), pos[1] - (ay + dy * t));
    const s0 = cum ? cum[i] : acc;
    if (d < best.d) best = { s: s0 + Math.sqrt(L2) * t, d };
    acc += Math.sqrt(L2);
  }
  return best;
}

/** Distance in metres from a position to the nearest point on a route polyline. */
export function offRouteDistance(pos: XY, path: XY[]): number {
  return polyNearest(path, null, pos).d;
}

// ─────────────────────────── model ───────────────────────────

export interface Detour {
  path: Poly;
  /** Along-path distance the crew believes it has walked. */
  b: number;
  /** Walking speed on the detour (m/s): path length / A* travel time (terrain-aware). */
  v: number;
  target: { kind: 'stop' | 'home'; name: string; s: number };
  /** The remaining route this detour replaced (drawn faded). */
  old: XY[];
}

export interface Note { kind: 'fix' | 'reroute' | 'noroute'; text: string }

export interface NavView {
  truth: XY;
  est: XY;
  errM: number;
  lastFixMinAgo: number;
  offRouteM: number;
  /** Estimate currently beyond OFF_ROUTE_M of the active route. */
  offRoute: boolean;
  detour: null | {
    remaining: XY[];
    old: XY[];
    remainingM: number;
    totalM: number;
    doneM: number;
    etaMin: number;
    steerDeg: number;
    targetName: string;
  };
  note: Note | null;
}

function rng(seed: number) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
  return { r, gauss };
}

export class NavModel implements PositionModel {
  private sim: SimState | null = null;
  private route: RouteModel | null = null;
  private prevMode: SimState['mode'] | null = null;
  /** Follow mode: truth = route point + push (true sideways displacement from the route). */
  private push: XY = [0, 0];
  /** Detour mode: est = detour point + off (believed displacement from the detour path). */
  private off: XY = [0, 0];
  /** Dead-reckoning error = est − truth. */
  private err: XY = [0, 0];
  private theta = 0;
  private lastFixT = 0;
  private fixCount = 0;
  private offSinceT: number | null = null;
  private lastFailT = -Infinity;
  private failing = false;
  private detour: Detour | null = null;
  private note: (Note & { until: number }) | null = null;
  private truth: XY = [0, 0];
  private est: XY = [0, 0];
  private offRouteM = 0;
  private rand = rng(9071);
  private grid: { dem: Float32Array; g: CostGrid } | null = null;

  constructor(private readonly ctl: VisorController) {}

  // ── PositionModel ──

  holding(): boolean {
    return this.detour !== null;
  }

  estimate(sim: SimState, route: RouteModel): XY {
    if (sim !== this.sim || route !== this.route) this.sync(sim, route);
    return this.est;
  }

  step(sim: SimState, route: RouteModel, dtRealS: number): void {
    if (sim !== this.sim || route !== this.route) this.sync(sim, route);
    const live = sim.running && sim.mode !== 'IDLE' && sim.mode !== 'DONE';
    const dtS = live ? dtRealS * sim.speed : 0;

    // Arrival at a surveyed station / at the shelter: the crew is physically there → position fix.
    if (sim.mode !== this.prevMode && (sim.mode === 'DWELL' || sim.mode === 'DONE')) {
      const was = Math.hypot(this.err[0], this.err[1]);
      this.detour = null;
      this.push = [0, 0];
      this.err = this.residual();
      this.lastFixT = sim.t;
      if (sim.mode === 'DWELL') this.flash('fix', `Position corrected · station marker (was ±${Math.round(was)} m)`);
    }
    // Return ordered mid-detour toward a stop: drop the detour; off-route logic reroutes to the shelter.
    if (this.detour && this.detour.target.kind === 'stop' && sim.mode === 'RETURN') this.handBack(sim, route, null);
    this.prevMode = sim.mode;

    const walking = dtS > 0 && (sim.mode === 'WALK' || sim.mode === 'RETURN') && (this.detour !== null || !sim.resting);

    // Walk the detour.
    const d = this.detour;
    if (d && walking) {
      const ds = Math.min(d.v * dtS, d.path.len - d.b);
      d.b += ds;
      sim.odoM += ds;
      const [ax, ay] = polyAt(d.path, d.b), [bx, by] = polyAt(d.path, Math.min(d.path.len, d.b + 14));
      if (Math.hypot(bx - ax, by - ay) > 1) sim.headingDeg = bearingDeg(ax, ay, bx, by);
      if (d.b >= d.path.len - 0.5) this.handBack(sim, route, d.target.s);
    }

    // Dead-reckoning drift: a coherent error velocity whose direction wanders (a random walk on heading bias).
    if (walking) {
      const min = dtS / 60;
      this.theta += this.rand.gauss() * 0.6 * Math.sqrt(min);
      const k = DRIFT_M_PER_MIN * min;
      this.err[0] += k * Math.cos(this.theta) + this.rand.gauss() * 0.15 * Math.sqrt(min);
      this.err[1] += k * Math.sin(this.theta) + this.rand.gauss() * 0.15 * Math.sqrt(min);
    }
    this.place(sim, route);

    // Periodic correction: landmark sighting or radio ranging to the rover.
    if (live && sim.t - this.lastFixT >= FIX_INTERVAL_MIN) this.correct(sim, route);

    // Off-route detection on the estimate.
    this.offRouteM = offRouteDistance(this.est, this.activePath(sim, route));
    const walkLeg = sim.mode === 'WALK' || sim.mode === 'RETURN';
    if (walkLeg && this.offRouteM > OFF_ROUTE_M) {
      if (this.offSinceT === null) this.offSinceT = sim.t;
      if ((sim.t - this.offSinceT) * 60 > OFF_ROUTE_HOLD_S && (sim.t - this.lastFailT) * 60 >= REROUTE_RETRY_S) this.reroute(sim, route);
    } else {
      this.offSinceT = null;
      if (this.failing) {
        this.failing = false;
        if (this.note?.kind === 'noroute') this.note = null;
      }
    }
  }

  // ── demo ──

  /** Push the TRUE position PUSH_M sideways (to the right of travel). The IMU feels it, so the estimate moves too. */
  pushOffRoute(): void {
    const sim = this.ctl.sim, route = this.ctl.route;
    if (!sim || !route) return;
    if (sim !== this.sim || route !== this.route) this.sync(sim, route);
    const a = ((sim.headingDeg + 90) * Math.PI) / 180;
    const v: XY = [PUSH_M * Math.sin(a), PUSH_M * Math.cos(a)];
    if (this.detour) this.off = [this.off[0] + v[0], this.off[1] + v[1]];
    else this.push = [this.push[0] + v[0], this.push[1] + v[1]];
    this.place(sim, route);
  }

  view(): NavView | null {
    const sim = this.ctl.sim, route = this.ctl.route;
    if (!sim || !route || sim !== this.sim) return null;
    const d = this.detour;
    let detour: NavView['detour'] = null;
    if (d) {
      const remainingM = Math.max(0, d.path.len - d.b);
      const remaining: XY[] = [this.est];
      for (let i = 0; i < d.path.pts.length; i++) if (d.path.cum[i] > d.b) remaining.push(d.path.pts[i]);
      const look = polyAt(d.path, Math.min(d.path.len, d.b + 40));
      const steerDeg = remainingM > 1 ? bearingDeg(this.est[0], this.est[1], look[0], look[1]) : sim.headingDeg;
      detour = {
        remaining, old: d.old, remainingM, totalM: d.path.len, doneM: d.b,
        etaMin: remainingM / d.v / 60, steerDeg, targetName: d.target.name,
      };
    }
    const note = this.note && (this.note.kind === 'noroute' || this.note.until > performance.now()) ? { kind: this.note.kind, text: this.note.text } : null;
    return {
      truth: this.truth,
      est: this.est,
      errM: Math.hypot(this.err[0], this.err[1]),
      lastFixMinAgo: Math.max(0, sim.t - this.lastFixT),
      offRouteM: this.offRouteM,
      offRoute: (sim.mode === 'WALK' || sim.mode === 'RETURN') && this.offRouteM > OFF_ROUTE_M,
      detour,
      note,
    };
  }

  // ── internals ──

  /** New simulator (reset / first route) or a new route version: keep the truth continuous where possible. */
  private sync(sim: SimState, route: RouteModel) {
    const fresh = sim !== this.sim;
    if (fresh) {
      this.push = [0, 0];
      this.err = [0, 0];
      this.theta = this.rand.r() * 2 * Math.PI;
      this.lastFixT = sim.t;
      this.note = null;
    } else {
      // Mid-EVA replan: the simulator rebased onto the new route; the astronaut stays where they are.
      const [x, y] = route.pointAt(sim.s);
      this.push = sim.mode === 'DONE' ? [0, 0] : [this.truth[0] - x, this.truth[1] - y];
    }
    this.detour = null;
    this.off = [0, 0];
    this.offSinceT = null;
    this.failing = false;
    this.sim = sim;
    this.route = route;
    this.prevMode = sim.mode;
    this.place(sim, route);
  }

  private place(sim: SimState, route: RouteModel) {
    const d = this.detour;
    if (d) {
      const p = polyAt(d.path, d.b);
      this.est = [p[0] + this.off[0], p[1] + this.off[1]];
      this.truth = [this.est[0] - this.err[0], this.est[1] - this.err[1]];
    } else {
      const [x, y] = route.pointAt(sim.s);
      this.truth = [x + this.push[0], y + this.push[1]];
      this.est = [this.truth[0] + this.err[0], this.truth[1] + this.err[1]];
    }
  }

  private residual(): XY {
    return [this.rand.gauss() * FIX_RESIDUAL_M, this.rand.gauss() * FIX_RESIDUAL_M];
  }

  private correct(sim: SimState, route: RouteModel) {
    const was = Math.hypot(this.err[0], this.err[1]);
    const truth = this.truth;
    this.err = this.residual();
    this.lastFixT = sim.t;
    const src = this.fixCount++ % 2 === 0 ? 'landmark' : 'radio ranging to rover';
    const d = this.detour;
    if (d) {
      // Truth is unchanged; the believed position jumps to it. Re-anchor on the detour path.
      const est: XY = [truth[0] + this.err[0], truth[1] + this.err[1]];
      d.b = polyNearest(d.path.pts, d.path.cum, est).s;
      const p = polyAt(d.path, d.b);
      this.off = [est[0] - p[0], est[1] - p[1]];
    }
    this.place(sim, route);
    this.flash('fix', `Position corrected · ${src} (was ±${Math.round(was)} m)`);
  }

  /** Remaining part of the route being followed (the detour, or the planned route ahead). */
  private activePath(sim: SimState, route: RouteModel): XY[] {
    const d = this.detour;
    if (d) return d.path.pts.filter((_, i) => d.path.cum[i] >= d.b - 30).concat([d.path.pts[d.path.pts.length - 1]]);
    const back = sim.mode === 'RETURN' && sim.returnDir < 0;
    return back ? route.slice(0, Math.min(route.length, sim.s + 60)) : route.slice(Math.max(0, sim.s - 60), route.length);
  }

  /** End the detour: hand the walk back to the simulator at along-route s (null = keep its held s). */
  private handBack(sim: SimState, route: RouteModel, s: number | null) {
    const truth = this.truth;
    this.detour = null;
    this.off = [0, 0];
    if (s !== null) sim.s = s;
    const [x, y] = route.pointAt(sim.s);
    this.push = [truth[0] - x, truth[1] - y];
    sim.edgeKey = Number.NaN;
    this.place(sim, route);
  }

  /** Engine cost grid for the visor's site pack (DEM slope, keep-outs, η from TI), built once per DEM. */
  private costGrid(): CostGrid | null {
    const { dem, manifest, eta } = this.ctl;
    if (!dem || !manifest) return null;
    if (this.grid?.dem === dem) return this.grid.g;
    const { w, h, cellM } = manifest.grid;
    const n = w * h;
    if (dem.length !== n) return null;
    const g = buildCostGrid({ manifest, rasters: {}, base: '' } as LoadedSitePack, undefined, DEFAULT_RULES, {
      elev: dem,
      slopeDeg: hornSlopeDeg(dem, w, h, cellM),
      rough: new Float32Array(n),
      eta: eta && eta.length === n ? eta : new Float32Array(n).fill(1),
    });
    this.grid = { dem, g };
    return g;
  }

  /** Nearest passable cell to (x, y) within a few cells. */
  private snap(g: CostGrid, x: number, y: number): number {
    const grid = this.ctl.grid!;
    const c = xyToCell(grid, x, y);
    if (c < 0) return -1;
    if (!g.blocked[c]) return c;
    const r0 = Math.floor(c / g.w), c0 = c % g.w;
    for (let rad = 1; rad <= 6; rad++)
      for (let dr = -rad; dr <= rad; dr++)
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const r = r0 + dr, k = c0 + dc;
          if (r < 0 || k < 0 || r >= g.h || k >= g.w) continue;
          if (!g.blocked[r * g.w + k]) return r * g.w + k;
        }
    return -1;
  }

  /** A* from the estimated cell to the next unvisited stop (or the shelter on the return leg). */
  reroute(sim: SimState, route: RouteModel): boolean {
    const offM = this.offRouteM;
    const stop = sim.mode === 'RETURN' ? null : route.stops[sim.stopK] ?? null;
    const target: Detour['target'] = stop
      ? { kind: 'stop', name: stop.name, s: stop.s }
      : { kind: 'home', name: route.home.name, s: sim.mode === 'RETURN' && sim.returnDir < 0 ? 0 : route.length };
    const goalXY: XY = stop ? [stop.x, stop.y] : sim.mode === 'RETURN' && sim.returnDir < 0 ? [route.start.x, route.start.y] : [route.home.x, route.home.y];
    const g = this.costGrid();
    const grid = this.ctl.grid;
    let cells: Uint32Array | null = null;
    let costS = 0;
    if (g && grid) {
      const start = this.snap(g, this.est[0], this.est[1]);
      const goal = this.snap(g, goalXY[0], goalXY[1]);
      if (start >= 0 && goal >= 0) {
        const res = astarSearch.search(g, pandolfSanteeMars, { crew: DEFAULT_CREW, rules: DEFAULT_RULES, speedFactor: 1 }, start, goal, { maxExpansions: 2_000_000 });
        if (res) {
          cells = res.cells;
          costS = res.cost;
        }
      }
    }
    if (!cells || !grid) {
      this.lastFailT = sim.t;
      this.failing = true;
      this.note = { kind: 'noroute', text: `No safe route from here. Return to ${route.home.kind === 'hab' ? route.home.name : 'rover'}.`, until: Infinity };
      return false;
    }
    const pts: XY[] = [[this.est[0], this.est[1]]];
    for (let i = 1; i < cells.length; i++) pts.push(cellToXY(grid, cells[i]));
    pts.push(goalXY);
    const path = poly(pts);
    const old = this.detour
      ? this.detour.path.pts.filter((_, i) => this.detour!.path.cum[i] >= this.detour!.b)
      : target.s >= sim.s ? route.slice(sim.s, target.s) : route.slice(target.s, sim.s).reverse();
    const v = costS > 0 && path.len > 0 ? path.len / costS : DEFAULT_CREW.v0;
    this.detour = { path, b: 0, v, target, old };
    this.off = [0, 0];
    this.offSinceT = null;
    this.failing = false;
    this.place(sim, route);
    this.offRouteM = 0;
    const min = Math.max(1, Math.ceil(path.len / v / 60));
    this.flash('reroute', `Off route by ${Math.round(offM)} m. New route: ${Math.round(path.len)} m, about ${min} min.`);
    return true;
  }

  private flash(kind: Note['kind'], text: string) {
    if (this.note?.kind === 'noroute' && kind === 'fix') return; // keep the safety message up
    this.note = { kind, text, until: performance.now() + NOTE_MS };
  }
}
