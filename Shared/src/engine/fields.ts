import { DEFAULT_CREW, DEFAULT_RULES } from '../contracts/rules';
import type { LoadedSitePack } from '../contracts/sitepack';
import type { Cell, CostCtx, CostGrid, CostModel, CrewParams, FieldSet, GridSpec, PlanRequest, Rule, RuleId } from '../contracts/types';
import { buildCostGrid, terrainOf, type Terrain } from './costGrid';
import { pandolfSanteeMars } from './costModel';
import { REST_W } from './heat';
import { buildEdgeTable, dialRun, dsToMinutes, DS_PER_MIN, scaleEdgeTable, type EdgeTable } from './dial';
import './defaults';
import { DEFAULT_COST_MODEL, DEFAULT_PATH_SEARCH, getCostModel } from './registry';

// ─────────────────────────── rules ───────────────────────────

/** DEFAULT_RULES overridden by the request's rules (by id), so a missing rule falls back to its default. */
export function mergeRules(rules: Rule[] | undefined): Rule[] {
  const m = new Map<RuleId, Rule>();
  for (const r of DEFAULT_RULES) m.set(r.id, r);
  for (const r of rules ?? []) m.set(r.id, r);
  return [...m.values()];
}

export interface RuleVals {
  slopeMax: number;
  evaMax: number;
  egress: number;
  wbFactor: number;
  wbOn: boolean;
  shelterMax: number;
  gapMax: number;
  sunMin: number;
  heatMax: number;
  radiusMax: number;
  plumeOn: boolean;
}

/** A rule is enforced iff it is hard AND enabled; otherwise its limit is ±Infinity. */
export function ruleVals(rules: Rule[]): RuleVals {
  const get = (id: RuleId) => rules.find((r) => r.id === id)!;
  const on = (id: RuleId) => {
    const r = get(id);
    return !!r && r.enabled && r.hard;
  };
  const v = (id: RuleId, off: number) => (on(id) ? get(id).value : off);
  return {
    slopeMax: v('slope_max_deg', Infinity),
    evaMax: v('eva_duration_max_min', 24 * 60),
    egress: get('egress_ingress_min').value,
    wbFactor: get('walkback_speed_factor').value,
    wbOn: on('walkback_speed_factor'),
    shelterMax: v('shelter_time_max_min', Infinity),
    gapMax: v('los_gap_max_min', Infinity),
    sunMin: v('daylight_min_sun_elev_deg', -Infinity),
    heatMax: v('heat_avg_max_w', Infinity),
    radiusMax: v('walk_radius_max_m', Infinity),
    plumeOn: on('plume_keepout_m'),
  };
}

// ─────────────────────────── stable hashing ───────────────────────────

/** 64-bit (two interleaved FNV-1a 32) hex hash of a string. */
export function hashString(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h1 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Canonical JSON (sorted keys; typed arrays as plain arrays). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (ArrayBuffer.isView(v)) return JSON.stringify(Array.from(v as unknown as ArrayLike<number>));
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

/** Stable hash of a plan request. */
export function requestHash(req: PlanRequest): string {
  return hashString(canonicalJson(req));
}

// ─────────────────────────── caches (pure: values depend only on their keys) ───────────────────────────

const tableCache = new WeakMap<Float32Array, WeakMap<Float32Array, Map<string, EdgeTable>>>();

function crewKey(c: CrewParams): string {
  return `${c.bodyMassKg},${c.suitMassKg},${c.toolsKg},${c.v0},${c.gRatio}`;
}

/** Cached edge table for (terrain, cost model, crew, speed factor). */
export function getEdgeTable(g: CostGrid, model: CostModel, ctx: CostCtx): EdgeTable {
  let byEta = tableCache.get(g.elev);
  if (!byEta) tableCache.set(g.elev, (byEta = new WeakMap()));
  let m = byEta.get(g.eta);
  if (!m) byEta.set(g.eta, (m = new Map()));
  const key = `${model.id}|${crewKey(ctx.crew)}|${ctx.speedFactor}|${model === pandolfSanteeMars ? '' : hashString(canonicalJson(ctx.rules))}`;
  let t = m.get(key);
  if (!t) {
    if (model === pandolfSanteeMars && ctx.speedFactor !== 1) {
      // travel time ∝ 1/speedFactor for this model: scale the speed-factor-1 table
      t = scaleEdgeTable(getEdgeTable(g, model, { ...ctx, speedFactor: 1 }), 1 / ctx.speedFactor);
    } else t = buildEdgeTable(g, model, ctx);
    m.set(key, t);
  }
  return t;
}

/**
 * Route-search cost: travel time × the steady-state duty factor of the suit-heat governor.
 * Walking an edge at power P > budget B needs rests at REST_W; in steady state the walking fraction
 * is (B − P_rest)/(P − P_rest), so the rest-inclusive time is t·(P − P_rest)/(B − P_rest). Route legs
 * minimize this (so they avoid metabolically expensive steep pitches, and uphill ≠ downhill: the
 * pairwise matrix is asymmetric). The exact governor is applied afterwards by the DP and simulator;
 * edgeCost of the underlying model stays pure travel time (fields use that).
 */
const heatModels = new Map<string, CostModel>();
export function heatAwareModel(base: CostModel, budgetW: number, restW = REST_W): CostModel {
  if (!(budgetW < Infinity)) return base;
  const id = `${base.id}+heat(${budgetW},${restW})`;
  let m = heatModels.get(id);
  if (m && heatModels.get(`${id}#base`) === base) return m;
  const power = base.edgePowerW ? base.edgePowerW.bind(base) : pandolfSanteeMars.edgePowerW!.bind(pandolfSanteeMars);
  m = {
    id,
    label: `${base.label} + suit-heat rests (route search)`,
    edgeCost(g, a, b, ctx) {
      const t = base.edgeCost(g, a, b, ctx);
      if (!(t < Infinity)) return t;
      const P = power(g, a, b, ctx);
      if (P <= budgetW) return t;
      if (restW >= budgetW) return Infinity;
      return (t * (P - restW)) / (budgetW - restW);
    },
    edgePowerW: power,
  };
  heatModels.set(id, m);
  heatModels.set(`${id}#base`, base);
  return m;
}

interface PackCache {
  terrain?: Terrain;
  grids: Map<string, CostGrid>;
  fields: Map<string, InternalFields>;
  los: Map<string, Uint8Array>;
}
const packCache = new WeakMap<LoadedSitePack, PackCache>();
function cacheFor(pack: LoadedSitePack): PackCache {
  let c = packCache.get(pack);
  if (!c) packCache.set(pack, (c = { grids: new Map(), fields: new Map(), los: new Map() }));
  return c;
}
function lruGet<V>(m: Map<string, V>, k: string): V | undefined {
  const v = m.get(k);
  if (v !== undefined) {
    m.delete(k);
    m.set(k, v);
  }
  return v;
}
function lruSet<V>(m: Map<string, V>, k: string, v: V, cap: number): void {
  m.set(k, v);
  while (m.size > cap) m.delete(m.keys().next().value as string);
}

/** Base cost grid (no hazards) for a pack + rule set; cached per (slope limit, plume flag). */
export function getBaseGrid(pack: LoadedSitePack, rv: RuleVals, rules: Rule[]): CostGrid {
  const c = cacheFor(pack);
  const key = `${rv.slopeMax}|${rv.plumeOn}`;
  let g = c.grids.get(key);
  if (!g) {
    c.terrain ??= terrainOf(pack);
    g = buildCostGrid(pack, undefined, rules, c.terrain);
    lruSet(c.grids, key, g, 4);
  }
  return g;
}

// ─────────────────────────── viewshed ───────────────────────────

/** Hab radio mast height above ground (m) — team design parameter. */
export const MAST_HEIGHT_M = 3.0;
/** Astronaut antenna / helmet height above ground (m) — team design parameter. */
export const OBSERVER_HEIGHT_M = 1.8;

/**
 * Line-of-sight viewshed from a mast: rays from the mast to every perimeter cell, each ray tracking
 * the maximum terrain elevation angle so far (max-angle sweep). A cell is visible when its antenna
 * point (ground + targetM) is at or above the running horizon angle along any ray reaching it.
 */
export function viewshed(
  elev: Float32Array, w: number, h: number, cellM: number, obs: Cell, mastM = MAST_HEIGHT_M, targetM = OBSERVER_HEIGHT_M,
): Uint8Array {
  const out = new Uint8Array(w * h);
  if (obs < 0 || obs >= w * h) return out;
  const r0 = (obs / w) | 0, c0 = obs - r0 * w;
  const z0 = elev[obs] + mastM;
  out[obs] = 1;
  const ray = (r1: number, c1: number) => {
    const dr = r1 - r0, dc = c1 - c0;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    if (steps === 0) return;
    const stepLen = (Math.hypot(dr, dc) * cellM) / steps;
    let maxTan = -Infinity;
    for (let i = 1; i <= steps; i++) {
      const r = Math.round(r0 + (dr * i) / steps);
      const c = Math.round(c0 + (dc * i) / steps);
      const cell = r * w + c;
      const z = elev[cell];
      if (!(z === z)) continue;
      const d = i * stepLen;
      if ((z + targetM - z0) / d >= maxTan) out[cell] = 1;
      const t = (z - z0) / d;
      if (t > maxTan) maxTan = t;
    }
  };
  for (let c = 0; c < w; c++) {
    ray(0, c);
    ray(h - 1, c);
  }
  for (let r = 1; r < h - 1; r++) {
    ray(r, 0);
    ray(r, w - 1);
  }
  return out;
}

// ─────────────────────────── resolved planning context ───────────────────────────

export interface InternalFields extends FieldSet {
  /** Next hop toward the hab (walkback tree), direction index or NO_PARENT. */
  walkbackParents: Uint8Array;
  /** Next hop toward the nearest shelter. */
  shelterParents: Uint8Array;
}

export interface Resolved {
  pack: LoadedSitePack;
  gs: GridSpec;
  w: number;
  h: number;
  n: number;
  cellM: number;
  rules: Rule[];
  rv: RuleVals;
  crew: CrewParams;
  model: CostModel;
  modelId: string;
  pathSearchId: string;
  /** Base grid (no hazards). */
  baseGrid: CostGrid;
  /** Grid with hazards applied (blocked = mask). */
  grid: CostGrid;
  ctx1: CostCtx;
  ctxW: CostCtx;
  T1: EdgeTable;
  TW: EdgeTable;
  /** Route-search model (heat-aware) and its edge table at speed factor 1. */
  routeModel: CostModel;
  TR: EdgeTable;
  hazards: number[];
  /** blocked ∪ hazards (1 = impassable). */
  mask: Uint8Array;
  hab: Cell;
  shelters: { id: string; kind: string; cell: Cell }[];
  fields: InternalFields;
}

export function hazardCells(req: PlanRequest, n: number): number[] {
  const s = new Set<number>();
  for (const e of req.events ?? []) if (e.t === 'HAZARD') for (const c of e.cells) if (c >= 0 && c < n) s.add(c);
  return [...s].sort((a, b) => a - b);
}

/** Resolve rules/crew/model/grid/tables/fields for a request (cached across calls). */
export function resolve(pack: LoadedSitePack, req: PlanRequest, override?: { rules?: Rule[] }): Resolved {
  const gs = pack.manifest.grid;
  const { w, h, cellM } = gs;
  const n = w * h;
  const rules = mergeRules(override?.rules ?? req.rules);
  const rv = ruleVals(rules);
  const crew = req.crew ?? DEFAULT_CREW;
  const modelId = req.planner?.costModel ?? DEFAULT_COST_MODEL;
  const model = getCostModel(modelId);
  const pathSearchId = req.planner?.pathSearch ?? DEFAULT_PATH_SEARCH;
  const baseGrid = getBaseGrid(pack, rv, rules);
  const hazards = hazardCells(req, n);
  let mask = baseGrid.blocked;
  if (hazards.length) {
    mask = baseGrid.blocked.slice();
    for (const c of hazards) mask[c] = 1;
  }
  const grid: CostGrid = hazards.length ? { ...baseGrid, blocked: mask } : baseGrid;
  const ctx1: CostCtx = { crew, rules, speedFactor: 1 };
  const ctxW: CostCtx = { crew, rules, speedFactor: rv.wbFactor };
  const T1 = getEdgeTable(baseGrid, model, ctx1);
  const TW = rv.wbFactor === 1 ? T1 : getEdgeTable(baseGrid, model, ctxW);
  const routeModel = heatAwareModel(model, rv.heatMax);
  const TR = routeModel === model ? T1 : getEdgeTable(baseGrid, routeModel, ctx1);
  const hab = req.hab;
  const shelters = req.shelters?.length ? req.shelters : [{ id: 'HAB', kind: 'hab', cell: hab }];

  const c = cacheFor(pack);
  const shelterKey = shelters.map((s) => s.cell).sort((a, b) => a - b).join(',');
  const fkey = `${rv.slopeMax}|${rv.plumeOn}|${hashString(hazards.join(','))}|${hab}|${shelterKey}|${modelId}|${crewKey(crew)}|${rv.wbFactor}`;
  let fields = lruGet(c.fields, fkey);
  if (!fields) {
    // Every masted shelter relays radio, whichever one is the EVA base: a walk staged from the rover still
    // has the habitat mast in view where terrain allows (caches carry no radio).
    const relayCells = shelters.filter((s) => s.kind !== 'cache' && s.cell !== hab).map((s) => s.cell);
    fields = computeInternalFields(pack, { w, h, cellM, mask, T1, TW, hab, shelterCells: shelters.map((s) => s.cell), relayCells, elev: baseGrid.elev });
    lruSet(c.fields, fkey, fields, 4);
  }
  return {
    pack, gs, w, h, n, cellM, rules, rv, crew, model, modelId, pathSearchId, baseGrid, grid, ctx1, ctxW, T1, TW,
    routeModel, TR, hazards, mask, hab, shelters, fields,
  };
}

/**
 * Comm line of sight = union of the viewsheds from the EVA base and from every other masted shelter
 * (habitat mast, pressurized-rover relay masts; all 3 m), so the result does not depend on which one is the base. TEAM ASSUMPTION: the pressurized rover carries a relay radio (precedent:
 * the Apollo 15–17 LRV carried the Lunar Communications Relay Unit for the EVA crew). The LOS-gap
 * rule uses this union. Single viewsheds are cached per mast cell, so dragging the rover only
 * recomputes the rover's viewshed.
 */
function commLos(c: PackCache, elev: Float32Array, w: number, h: number, cellM: number, hab: Cell, relays: Cell[]): Uint8Array {
  const one = (cell: Cell) => {
    const k = `vs${cell}`;
    let v = c.los.get(k);
    if (!v) {
      v = viewshed(elev, w, h, cellM, cell);
      lruSet(c.los, k, v, 6);
    }
    return v;
  };
  const base = one(hab);
  if (!relays.length) return base;
  const out = base.slice();
  for (const r of relays) {
    const v = one(r);
    for (let i = 0; i < out.length; i++) out[i] |= v[i];
  }
  return out;
}

function computeInternalFields(
  pack: LoadedSitePack,
  a: { w: number; h: number; cellM: number; mask: Uint8Array; T1: EdgeTable; TW: EdgeTable; hab: Cell; shelterCells: Cell[]; relayCells: Cell[]; elev: Float32Array },
): InternalFields {
  const { w, h, cellM, mask, T1, TW, hab } = a;
  const n = w * h;
  const walkbackParents = new Uint8Array(n);
  const shelterParents = new Uint8Array(n);
  const walkbackMin = dsToMinutes(dialRun({ tab: TW.rev, maxEdge: TW.maxEdge, w, h, mask, sources: [hab], parents: walkbackParents }).dist);
  const shelterMin = dsToMinutes(dialRun({ tab: T1.rev, maxEdge: T1.maxEdge, w, h, mask, sources: a.shelterCells, parents: shelterParents }).dist);
  const outboundMin = dsToMinutes(dialRun({ tab: T1.fwd, maxEdge: T1.maxEdge, w, h, mask, sources: [hab] }).dist);
  const c = cacheFor(pack);
  const los = commLos(c, a.elev, w, h, cellM, hab, a.relayCells);
  return { w, h, walkbackMin, shelterMin, outboundMin, los, blocked: mask, walkbackParents, shelterParents };
}

/**
 * Dense safety fields for map overlays and the safety core:
 * - walkbackMin: reverse Dijkstra to the hab at walkback_speed_factor × v0 (contingency return)
 * - shelterMin: multi-source reverse Dijkstra from every shelter at v0
 * - outboundMin: forward Dijkstra from the hab at v0
 * - los: comm line of sight (1.8 m antenna) to the hab mast OR a pressurized rover's relay mast (3 m)
 * - blocked: slope / keep-out / nodata / hazards
 * Returned arrays are copies (safe to mutate).
 */
export function computeFields(pack: LoadedSitePack, req: PlanRequest): FieldSet {
  const r = resolve(pack, req);
  const f = r.fields;
  return {
    w: f.w,
    h: f.h,
    walkbackMin: f.walkbackMin.slice(),
    shelterMin: f.shelterMin.slice(),
    outboundMin: f.outboundMin.slice(),
    los: f.los.slice(),
    blocked: f.blocked.slice(),
  };
}

/**
 * One-to-many (or many-to-one when `reverse`) Dijkstra field in MINUTES on a cost grid.
 * Uses the registered cost model (default pandolf-santee-mars) with an edge-table cache.
 */
export function dijkstraField(
  grid: CostGrid, sources: Cell[], reverse: boolean, speedFactor: number, maxSeconds?: number,
  opts?: { crew?: CrewParams; rules?: Rule[]; costModel?: CostModel; targets?: Cell[]; parents?: Uint8Array },
): Float32Array {
  const model = opts?.costModel ?? getCostModel(DEFAULT_COST_MODEL);
  const ctx: CostCtx = { crew: opts?.crew ?? DEFAULT_CREW, rules: opts?.rules ?? DEFAULT_RULES, speedFactor };
  const t = getEdgeTable(grid, model, ctx);
  const res = dialRun({
    tab: reverse ? t.rev : t.fwd, maxEdge: t.maxEdge, w: grid.w, h: grid.h, mask: grid.blocked, sources,
    targets: opts?.targets ?? null, maxCostDs: maxSeconds !== undefined ? Math.round(maxSeconds * 10) : undefined,
    parents: opts?.parents ?? null,
  });
  return dsToMinutes(res.dist);
}

export { DS_PER_MIN };
