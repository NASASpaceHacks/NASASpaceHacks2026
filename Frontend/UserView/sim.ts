// Suit-side navigation logic. Everything here runs on the suit computer with the bundled terrain, so guidance,
// hazard look-ahead and emergency re-planning keep working when the habitat link drops.
//
// The astronaut's motion, position drift and consumables are SIMULATED for the browser demo (no real IMU,
// visual odometry or suit telemetry). Drift and consumption rates are labelled engineering assumptions.
import { bearing, cellPt, distM, distToSegment, idx, inside, type Area } from '../shared/data';
import { astar, buildField, hazardMask, PRESETS, timeTo, timeToBaseAt } from '../shared/router';
import { RAD_GALE_MSV_PER_DAY } from '../shared/mars';
import type { Mission, Pt, Stop } from '../shared/types';

export const VO_DRIFT = 0.02;      // E: position error grows ~2% of distance walked since last fix
export const FIX_SIGMA = 0.5;      // E: 1-sigma after a landmark/beacon fix, metres
export const OFF_ROUTE_M = 8;      // cross-track distance that triggers off-route guidance
const LOOKAHEAD_M = 10;
const HAZARD_LOOKAHEAD_M = 40;

export interface Alert { id: string; sev: 'info' | 'caution' | 'warning'; text: string }

export interface Ctx {
  area: Area;
  mission: Mission;
  targets: Stop[];          // visit sequence; last is the habitat
  legs: number[][];         // planned cells for each target
  blocked: Uint8Array;
  ttb: Float32Array;        // time-to-habitat field
}

export interface SimState {
  truth: Pt;
  heading: number;
  bias: Pt;                 // estimate - truth, metres (east, south)
  driftDir: number;
  sigma: number;
  sinceFixM: number;
  pet: number;
  o2: number;
  battery: number;
  doseMsv: number;
  target: number;
  phase: 'enroute' | 'task' | 'done';
  taskLeft: number;
  completed: string[];
  crumbs: Pt[];
  mode: 'mission' | 'return';
  returnLeg: number[] | null;
  walking: boolean;
}

export function makeCtx(area: Area, m: Mission): Ctx {
  const targets = [...m.stops.slice(1), m.stops[0]];
  const legs = m.route.legEnds.map((end, k) => m.route.cells.slice(k === 0 ? 0 : m.route.legEnds[k - 1], end + 1));
  const { blocked } = hazardMask(area, m.params, m.nogo);
  const base = m.stops[0];
  const ttb = timeTo(area, blocked, idx(area, base.x, base.y), m.params.speed);
  return { area, mission: m, targets, legs, blocked, ttb };
}

export function initState(ctx: Ctx): SimState {
  const b = ctx.mission.stops[0];
  const first = ctx.legs[0]?.[Math.min(6, ctx.legs[0].length - 1)];
  return {
    truth: { x: b.x, y: b.y }, heading: first !== undefined ? bearing(ctx.area, b, cellPt(ctx.area, first)) : 0,
    bias: { x: 0, y: 0 }, driftDir: Math.random() * 360, sigma: FIX_SIGMA, sinceFixM: 0,
    pet: 0, o2: 100, battery: 100, doseMsv: 0, target: 0, phase: 'enroute', taskLeft: 0, completed: [],
    crumbs: [{ x: b.x, y: b.y }], mode: 'mission', returnLeg: null, walking: false,
  };
}

export const estimate = (a: Area, s: SimState): Pt => ({ x: s.truth.x + s.bias.x / a.dxM, y: s.truth.y + s.bias.y / a.dyM });

export function currentTarget(ctx: Ctx, s: SimState): Stop {
  return s.mode === 'return' ? ctx.mission.stops[0] : ctx.targets[Math.min(s.target, ctx.targets.length - 1)];
}

export function currentLeg(ctx: Ctx, s: SimState): number[] {
  return s.mode === 'return' ? s.returnLeg ?? [] : ctx.legs[Math.min(s.target, ctx.legs.length - 1)] ?? [];
}

export interface Guidance {
  est: Pt;
  target: Stop;
  distTarget: number;       // straight-line metres
  distAlong: number;        // remaining metres along the planned leg
  distTotal: number;        // remaining metres for the whole EVA
  legLen: number;
  crossTrack: number;
  steer: number;            // true bearing to follow (along the safe path)
  bearingTarget: number;    // true bearing straight to the target
  nearestK: number;
  etaS: number;
  timeToBaseS: number;
  marginS: number;
}

function polyLen(a: Area, cells: number[], from = 0): number {
  let L = 0;
  for (let k = Math.max(1, from + 1); k < cells.length; k++) L += distM(a, cellPt(a, cells[k - 1]), cellPt(a, cells[k]));
  return L;
}

export function guidance(ctx: Ctx, s: SimState): Guidance {
  const a = ctx.area;
  const est = estimate(a, s);
  const target = currentTarget(ctx, s);
  const leg = currentLeg(ctx, s);
  let nearestK = 0, ct = Infinity;
  for (let k = 0; k < leg.length - 1; k++) {
    const d = distToSegment(est, cellPt(a, leg[k]), cellPt(a, leg[k + 1]), a);
    if (d < ct) { ct = d; nearestK = k; }
  }
  if (leg.length < 2) { ct = 0; }
  let acc = 0, k = nearestK, look = leg.length ? cellPt(a, leg[leg.length - 1]) : target;
  while (k < leg.length - 1) {
    acc += distM(a, cellPt(a, leg[k]), cellPt(a, leg[k + 1]));
    k++;
    if (acc >= LOOKAHEAD_M) { look = cellPt(a, leg[k]); break; }
  }
  const distTarget = distM(a, est, target);
  const offRoute = ct > OFF_ROUTE_M;
  // On route: follow the safe path. Off route: head back to the nearest path point rather than cutting across.
  const steerTo = offRoute && leg.length ? cellPt(a, leg[Math.min(nearestK + 1, leg.length - 1)]) : distTarget < LOOKAHEAD_M ? target : look;
  const distAlong = leg.length ? polyLen(a, leg, nearestK) + Math.min(ct, 50) : distTarget;
  let distTotal = distAlong;
  if (s.mode === 'mission') for (let j = s.target + 1; j < ctx.legs.length; j++) distTotal += polyLen(a, ctx.legs[j]);
  const p = ctx.mission.params;
  const here = idx(a, Math.min(a.n - 1, Math.max(0, est.x)), Math.min(a.n - 1, Math.max(0, est.y)));
  const timeToBaseS = timeToBaseAt(a, ctx.ttb, here, p.speed);
  return {
    est, target, distTarget, distAlong, distTotal, legLen: polyLen(a, leg), crossTrack: ct,
    steer: bearing(a, est, steerTo), bearingTarget: bearing(a, est, target), nearestK,
    etaS: distAlong / (p.speed * 0.8),
    timeToBaseS,
    marginS: p.budgetMin * 60 - s.pet - p.reserveMin * 60 - timeToBaseS,
  };
}

const wrap180 = (d: number) => ((d + 540) % 360) - 180;
export const clock = (rel: number) => { const c = Math.round(((rel + 360) % 360) / 30) % 12; return c === 0 ? 12 : c; };

export interface Input { forward: boolean; left: boolean; right: boolean; auto: boolean }

/** Advance the simulation by dt seconds. */
export function step(ctx: Ctx, s: SimState, dt: number, inp: Input): SimState {
  const a = ctx.area, p = ctx.mission.params;
  const n: SimState = { ...s, pet: s.pet + dt };
  let walking = false;
  if (s.phase === 'enroute') {
    if (inp.auto) {
      const g = guidance(ctx, s);
      const diff = wrap180(g.steer - s.heading);
      n.heading = (s.heading + Math.max(-90 * dt, Math.min(90 * dt, diff)) + (Math.random() - 0.5) * 6 * dt + 360) % 360;
      walking = true;
    } else {
      if (inp.left) n.heading = (s.heading - 60 * dt + 360) % 360;
      if (inp.right) n.heading = (s.heading + 60 * dt) % 360;
      walking = inp.forward;
    }
  } else if (s.phase === 'task') {
    n.taskLeft = Math.max(0, s.taskLeft - dt);
  }
  let grade = 0;
  if (walking) {
    const h = (n.heading * Math.PI) / 180;
    const here = idx(a, s.truth.x, s.truth.y);
    const ahead = { x: s.truth.x + (Math.sin(h) * 2) / a.dxM, y: s.truth.y - (Math.cos(h) * 2) / a.dyM };
    if (inside(a, ahead)) {
      const j = idx(a, ahead.x, ahead.y);
      grade = j !== here ? (a.elev[j] - a.elev[here]) / distM(a, cellPt(a, here), cellPt(a, j)) : 0;
    }
    const v = p.speed / (1 + 4 * Math.max(grade, 0) + 2 * Math.max(-grade, 0));
    const d = v * dt;
    const next = { x: s.truth.x + (Math.sin(h) * d) / a.dxM, y: s.truth.y - (Math.cos(h) * d) / a.dyM };
    if (inside(a, next)) {
      n.truth = next;
      n.sinceFixM = s.sinceFixM + d;
      n.sigma = FIX_SIGMA + VO_DRIFT * n.sinceFixM;
      const dr = (s.driftDir * Math.PI) / 180;
      n.bias = { x: s.bias.x + Math.sin(dr) * d * VO_DRIFT * 0.8, y: s.bias.y - Math.cos(dr) * d * VO_DRIFT * 0.8 };
      n.driftDir = (s.driftDir + (Math.random() - 0.5) * 20 * dt + 360) % 360;
      const last = s.crumbs[s.crumbs.length - 1];
      const e = estimate(a, n);
      if (distM(a, last, e) > 1.5) n.crumbs = [...s.crumbs, e].slice(-4000);
    }
  }
  n.walking = walking;
  // E: notional consumables for the demo, scaled so a nominal EVA uses ~60% O2 and ~50% battery.
  const budget = p.budgetMin * 60;
  const exertion = walking ? 1 + 3 * Math.max(grade, 0) : 0.6;
  n.o2 = Math.max(0, s.o2 - (dt / (budget * 1.6)) * 100 * exertion);
  n.battery = Math.max(0, s.battery - (dt / (budget * 2)) * 100);
  n.doseMsv = s.doseMsv + (RAD_GALE_MSV_PER_DAY * dt) / 88775;

  if (n.phase === 'enroute') {
    const t = currentTarget(ctx, n);
    const est = estimate(a, n);
    if (distM(a, est, t) <= Math.max(t.arrivalM, 1)) {
      if (t.kind === 'base') n.phase = 'done';
      else { n.phase = 'task'; n.taskLeft = t.dwellMin * 60; }
    }
  } else if (n.phase === 'task' && inp.auto && n.taskLeft <= 0) {
    return completeTask(ctx, n);
  }
  return n;
}

export function completeTask(ctx: Ctx, s: SimState): SimState {
  if (s.phase !== 'task') return s;
  const t = currentTarget(ctx, s);
  return { ...s, phase: 'enroute', completed: [...s.completed, t.id], target: s.target + 1, taskLeft: 0 };
}

/** Landmark / beacon fix: resets accumulated drift. Requires a known landmark nearby or a planned stop. */
export function fix(s: SimState): SimState {
  return { ...s, bias: { x: 0, y: 0 }, sigma: FIX_SIGMA, sinceFixM: 0, driftDir: Math.random() * 360 };
}

/** Local emergency return: safest weights and 20% stricter slope, relaxing to mission limits if needed. */
export function planReturn(ctx: Ctx, s: SimState): number[] | null {
  const a = ctx.area, m = ctx.mission;
  const est = estimate(a, s);
  const from = idx(a, Math.min(a.n - 1, Math.max(0, est.x)), Math.min(a.n - 1, Math.max(0, est.y)));
  const to = idx(a, m.stops[0].x, m.stops[0].y);
  const w = PRESETS.find((q) => q.id === 'safest')!.weights;
  for (const strict of [0.8, 1]) {
    const params = { ...m.params, maxSlope: m.params.maxSlope * strict };
    const path = astar(a, buildField(a, params, w, m.nogo, []), from, to, m.params.speed);
    if (path) return path;
  }
  return null;
}

/** Re-plan the remainder of the current leg from the estimated position (after a detour). */
export function replanLeg(ctx: Ctx, s: SimState): number[] | null {
  const a = ctx.area, m = ctx.mission;
  const est = estimate(a, s);
  const t = currentTarget(ctx, s);
  const from = idx(a, Math.min(a.n - 1, Math.max(0, est.x)), Math.min(a.n - 1, Math.max(0, est.y)));
  return astar(a, buildField(a, m.params, m.weights, m.nogo, []), from, idx(a, t.x, t.y), m.params.speed);
}

export function alerts(ctx: Ctx, s: SimState, g: Guidance): Alert[] {
  const a = ctx.area, p = ctx.mission.params;
  const out: Alert[] = [];
  if (s.phase === 'done') return [{ id: 'done', sev: 'info', text: 'EVA COMPLETE — at habitat' }];
  if (g.marginS < 0) out.push({ id: 'margin', sev: 'warning', text: `RETURN NOW — reserve breached by ${Math.ceil(-g.marginS / 60)} min` });
  else if (g.marginS < 300 && s.mode === 'mission') out.push({ id: 'margin', sev: 'caution', text: `Turn-back point in ${Math.floor(g.marginS / 60)} min` });
  if (s.o2 < 25) out.push({ id: 'o2', sev: 'warning', text: `O₂ ${s.o2.toFixed(0)}%` });
  const here = idx(a, Math.min(a.n - 1, Math.max(0, g.est.x)), Math.min(a.n - 1, Math.max(0, g.est.y)));
  if (ctx.blocked[here]) out.push({ id: 'inhaz', sev: 'warning', text: 'IN EXCLUDED TERRAIN — back out the way you came' });
  if (s.phase === 'enroute' && g.crossTrack > OFF_ROUTE_M) {
    const rel = wrap180(g.steer - s.heading);
    out.push({ id: 'off', sev: 'caution', text: `OFF ROUTE ${g.crossTrack.toFixed(0)} m — steer ${rel < 0 ? 'left' : 'right'} ${Math.abs(rel).toFixed(0)}°` });
  }
  // Nearby excluded cells within 6 m.
  const r = Math.ceil(6 / a.cellM);
  let best = Infinity, bestPt: Pt | null = null;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const q = { x: Math.floor(g.est.x) + dx + 0.5, y: Math.floor(g.est.y) + dy + 0.5 };
      if (!inside(a, q) || !ctx.blocked[idx(a, q.x, q.y)]) continue;
      const d = distM(a, g.est, q);
      if (d < best) { best = d; bestPt = q; }
    }
  if (bestPt && !ctx.blocked[here]) out.push({ id: 'near', sev: 'caution', text: `Excluded terrain ${best.toFixed(0)} m at ${clock(bearing(a, g.est, bestPt) - s.heading)} o'clock` });
  // Look ahead along the planned leg.
  const leg = currentLeg(ctx, s);
  let acc = 0;
  for (let k = g.nearestK + 1; k < leg.length && acc < HAZARD_LOOKAHEAD_M; k++) {
    acc += distM(a, cellPt(a, leg[k - 1]), cellPt(a, leg[k]));
    const c = leg[k];
    if (a.slope[c] > p.maxSlope * 0.75) { out.push({ id: 'ahead', sev: 'caution', text: `Slope ${a.slope[c].toFixed(0)}° in ${acc.toFixed(0)} m — shorten stride` }); break; }
    if (a.rough[c] > p.maxRough * 0.75) { out.push({ id: 'ahead', sev: 'caution', text: `Rough ground in ${acc.toFixed(0)} m` }); break; }
  }
  const t = currentTarget(ctx, s);
  if (g.distTarget < 25 && s.sigma > t.arrivalM)
    out.push({ id: 'unc', sev: 'caution', text: `Position ±${s.sigma.toFixed(1)} m exceeds ${t.task} tolerance ±${t.arrivalM} m — take a fix` });
  return out;
}

export function nearestLandmark(ctx: Ctx, est: Pt, maxM = 80) {
  let best: (typeof ctx.area.rover.stops)[number] | null = null, bd = maxM;
  for (const r of ctx.area.rover.stops) { const d = distM(ctx.area, r, est); if (d < bd) { bd = d; best = r; } }
  return best ? { stop: best, d: bd } : null;
}

