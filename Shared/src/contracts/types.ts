/**
 * Marswalk shared contracts — FROZEN at H2.
 * Changes only at checkpoints with lead + timekeeper sign-off.
 *
 * Conventions
 * - Grid: row-major, row 0 = NORTH edge (y down in raster space). Cell = row * w + col.
 * - Projected coordinates (x, y) are metres in the site's local Mars projection
 *   (equidistant cylindrical on the IAU Mars 2000 sphere, R = 3,396,190 m). x east, y north.
 * - Cell centre: x = grid.originX + (col + 0.5) * cellM, y = grid.originY - (row + 0.5) * cellM
 *   (originX/originY = top-left CORNER of the grid).
 * - Times: minutes from EVA start (`tMin`) unless suffixed. Mars local time in minutes after
 *   local midnight (`ltstMin`, Local True Solar Time, 0..1480 for a 24h39m sol).
 * - Energy: kJ. Power: W. Dose: µSv. Distances: m. Angles: degrees unless noted.
 */

// ───────────────────────────── Grid / site pack ─────────────────────────────

export type Cell = number;

export interface GridSpec {
  w: number;
  h: number;
  /** Cell size in metres (engine grid; 5 m for gale-v1). */
  cellM: number;
  /** proj4 string of the local projection, e.g. +proj=eqc +lat_ts=-4.7 +lon_0=137.4 +R=3396190 +units=m +no_defs */
  proj4: string;
  /** Projected x of the grid's top-left corner (m). */
  originX: number;
  /** Projected y of the grid's top-left corner (m). */
  originY: number;
  /** Planetocentric lon/lat (°E, °N) of the grid centre — for display only. */
  centerLonLat: [number, number];
}

export type RasterDType = 'u8' | 'u16' | 'i16' | 'f32';

export interface Provenance {
  mission: string;        // e.g. "Mars Reconnaissance Orbiter"
  instrument: string;     // e.g. "HiRISE"
  product: string;        // product id / file name
  url: string;
  license: string;        // e.g. "Public domain (USGS/NASA)"
  citation: string;       // human-readable citation
  resolutionM: number;    // native resolution
  accuracy?: string;      // stated accuracy / caveats
}

/** A raster on the ENGINE grid (same w/h as GridSpec). Value = raw * scale + offset. */
export interface RasterLayer {
  id: string;             // 'dem' | 'slope' | 'rough' | 'ti' | 'normals' | 'skyview' | 'keepout' | ...
  label: string;
  kind: 'continuous' | 'categorical' | 'mask' | 'vector2';
  file: string;           // relative to the site pack root, little-endian raw binary
  dtype: RasterDType;
  bands: number;          // 1, or 2 for normals (nx, ny)
  scale: number;
  offset: number;
  nodata?: number;        // raw nodata value
  unit: string;
  provenance: Provenance[];
  indicative?: boolean;   // show the "indicative" badge (e.g. TI-derived, shielding)
}

/** Display imagery (higher resolution than the engine grid). */
export interface ImageryLayer {
  id: string;             // 'ortho'
  label: string;
  /** Cloud-optimised GeoTIFF (preferred) or a PNG/JPEG/WebP covering `extent`. */
  file: string;
  format: 'cog' | 'png' | 'jpg' | 'webp';
  /** [minX, minY, maxX, maxY] in projected metres. */
  extent: [number, number, number, number];
  resolutionM: number;
  provenance: Provenance[];
}

export interface Station {
  id: string;             // 'ST01'
  name: string;
  x: number;
  y: number;
  cell: Cell;
  /** Science value 0..100 from the Science Traceability Matrix. */
  value: number;
  objectiveIds: string[];
  dwellMin: number;
  /** Station task power for the heat model (W), default 250. */
  taskW?: number;
  description: string;
  citation?: string;
  imageIds?: string[];
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  y: number;
  elevM: number;
  informal: boolean;      // true = rover-team informal name, false = IAU-approved
}

export type ShelterKind = 'hab' | 'rover' | 'cache';

export interface Shelter {
  id: string;
  kind: ShelterKind;
  name: string;
  x: number;
  y: number;
  cell: Cell;
  /** Pressurized rovers can be moved by the admin. */
  movable: boolean;
}

/** Keep-out zones in projected metres (polygon rings, first ring outer). */
export interface KeepOut {
  id: string;
  kind: 'plume' | 'science_preservation' | 'special_region' | 'hazard';
  label: string;
  rings: [number, number][][];
  citation?: string;
}

export interface RoverImage {
  id: string;
  sol: number;
  camera: string;          // 'NAV_LEFT_B', 'MAST_LEFT', ...
  x: number;
  y: number;
  cell: Cell;
  file: string;            // relative path inside the site pack
  credit: string;          // "NASA/JPL-Caltech/MSSS"
  sourceUrl: string;
  caption?: string;
}

export interface RemsSol {
  sol: number;
  terrestrialDate: string;
  ls: number;
  minAirC: number | null;
  maxAirC: number | null;
  minGroundC: number | null;
  maxGroundC: number | null;
  pressurePa: number | null;
  opacity: string | null;
  uvIndex: string | null;
  sunrise: string | null;
  sunset: string | null;
}

export interface SpaceWeatherEvent {
  id: string;
  kind: 'CME_ENLIL' | 'FLR' | 'SEP';
  startUtc: string;
  /** For ENLIL: predicted shock arrival at Mars (UTC), if listed. */
  marsArrivalUtc?: string;
  note: string;
  sourceUrl: string;
}

export interface SitePackManifest {
  schema: 'sitepack/1';
  id: string;              // 'gale-v1'
  name: string;            // 'Gale Crater — Mount Sharp boxwork'
  body: 'mars';
  createdUtc: string;
  grid: GridSpec;
  rasters: Record<string, RasterLayer>;   // must include 'dem' and 'slope'
  imagery: ImageryLayer[];
  stations: Station[];
  landmarks: Landmark[];
  shelters: Shelter[];                    // exactly one kind:'hab'
  keepouts: KeepOut[];
  /** Curiosity/Perseverance traverse polyline(s) in projected metres. */
  traverse?: { label: string; lines: [number, number][][]; provenance: Provenance };
  images: RoverImage[];
  conditions: {
    rems?: RemsSol[];
    spaceWeather?: SpaceWeatherEvent[];
    fetchedUtc: string;
  };
  /** Mars sol + LTST the demo scenario uses by default. */
  scenario: { sol: number; startLtstMin: number; label: string };
  /** sha256 per file, for provenance and cache-busting. */
  files: Record<string, string>;
}

// ───────────────────────────── Rules (flight rules) ─────────────────────────────

export type RuleId =
  | 'slope_max_deg'
  | 'slope_soft_deg'
  | 'eva_duration_max_min'
  | 'egress_ingress_min'
  | 'contingency_o2_min'
  | 'walkback_speed_factor'
  | 'shelter_time_max_min'
  | 'los_gap_max_min'
  | 'daylight_min_sun_elev_deg'
  | 'heat_avg_max_w'
  | 'walk_radius_max_m'
  | 'plume_keepout_m';

export interface Rule {
  id: RuleId;
  label: string;
  value: number;
  unit: string;
  /** Hard rules may never be violated by an OK plan. */
  hard: boolean;
  enabled: boolean;
  citation: string;
  /** True when the value is a team design parameter rather than a published NASA number. */
  assumption?: boolean;
}

// ───────────────────────────── Planning ─────────────────────────────

export interface CrewParams {
  bodyMassKg: number;      // W in Pandolf
  suitMassKg: number;      // carried as load L
  toolsKg: number;         // added to L
  /** Nominal walking speed (m/s). */
  v0: number;
  /** Gravity ratio g_mars / g_earth. */
  gRatio: number;
}

export type PlanEvent =
  | { t: 'EVA_CUT'; min: number }                         // shorten available EVA time by `min`
  | { t: 'SEP_NOWCAST'; leadMin: number }                 // onboard dose-rate alert: must reach shelter within leadMin
  | { t: 'HAZARD'; cells: Cell[]; note?: string }         // astronaut-reported hazard → block cells
  | { t: 'FIX'; cell: Cell };                             // position fix

export interface StationRequest {
  id: string;
  cell: Cell;
  value: number;
  dwellMin: number;
  taskW?: number;
}

export interface PlanRequest {
  siteId: string;
  hab: Cell;
  shelters: { id: string; kind: ShelterKind; cell: Cell }[];
  sol: number;
  startLtstMin: number;
  stations: StationRequest[];
  rules: Rule[];
  crew: CrewParams;
  events?: PlanEvent[];
  /** Mid-EVA replan: where the crew is now and what is done. */
  resume?: { elapsedMin: number; cell: Cell; visited: string[]; o2UsedPct: number };
  planner?: { pathSearch: string; costModel: string };
  seed: number;
}

export interface Check {
  rule: RuleId;
  /** Worst observed value along the segment/plan (same unit as the rule). */
  worst: number;
  limit: number;
  /** Positive = inside the limit. Same unit as the rule. */
  margin: number;
  pass: boolean;
  atCell: Cell;
  atMin: number;
}

export interface Segment {
  from: string;            // 'HAB' or station id
  to: string;
  cells: number[];         // path cells, inclusive of both ends
  t0Min: number;
  t1Min: number;
  distM: number;
  energyKJ: number;
  restMin: number;         // heat-governor rests inserted on this leg
  checks: Check[];
}

export interface Stop {
  id: string;
  arriveMin: number;
  departMin: number;
  arriveLtstMin: number;
}

export interface BurndownPoint {
  tMin: number;
  distHabM: number;        // straight-line distance from the hab
  elevM: number;
  o2Pct: number;           // remaining planned O2 (100 → 0), excluding the never-planned contingency reserve
  walkbackMarginMin: number;
  shelterMarginMin: number;
  metW: number;            // metabolic rate
  heatAvgW: number;        // 30-min rolling (leaky-bucket) average
  inLos: boolean;
  sunElevDeg: number;
}

export interface Bingo {
  id: string;              // station id: latest departure time that still keeps every hard rule
  ltstMin: number;
  tMin: number;
  text: string;
}

export interface PlanResult {
  status: 'OK' | 'STAY_IN';
  reqHash: string;
  solveMs: number;
  planner: { pathSearch: string; costModel: string };
  order: string[];         // visited station ids in order
  segments: Segment[];
  stops: Stop[];
  burndown: BurndownPoint[];
  margins: Partial<Record<RuleId, { min: number; atMin: number }>>;
  binding: { rule: RuleId; text: string; seg: number } | null;
  dropped: { id: string; rule: RuleId; deficitMin: number; text: string }[];
  leaderboard: { id: string; value: number; marginalMin: number }[];
  bingo: Bingo[];
  totals: {
    distM: number;
    durationMin: number;
    energyKJ: number;
    o2UsedPct: number;
    doseUSv: number;
    scienceValue: number;
    maxDistHabM: number;
  };
  /** Human-readable reasons when status is STAY_IN. */
  notes: string[];
}

/** Dense safety fields on the engine grid, for map overlays and the safety core. */
export interface FieldSet {
  w: number;
  h: number;
  /** Contingency walkback time to the hab (min). Infinity → unreachable. */
  walkbackMin: Float32Array;
  /** Time to the nearest shelter (min). */
  shelterMin: Float32Array;
  /** Outbound time from the hab (min). */
  outboundMin: Float32Array;
  /** 1 = comm line of sight to the hab mast OR a pressurized-rover relay mast (rover relay = team assumption). */
  los: Uint8Array;
  /** Hard-blocked cells (slope, keep-out, nodata, hazards). */
  blocked: Uint8Array;
}

// ───────────────────────────── Research plug-in contracts ─────────────────────────────

/** Read-only terrain the planners search over. All arrays length w*h. */
export interface CostGrid {
  w: number;
  h: number;
  cellM: number;
  elev: Float32Array;      // m
  slopeDeg: Float32Array;
  rough: Float32Array;     // m (std-dev of detrended heights)
  eta: Float32Array;       // Pandolf terrain factor (1.0 hard … 2.1 loose sand)
  blocked: Uint8Array;     // 1 = impassable
}

export interface CostCtx {
  crew: CrewParams;
  rules: Rule[];
  /** Speed multiplier (e.g. contingency factor 0.5). */
  speedFactor: number;
}

/** Edge cost model. Must return a finite, positive cost in SECONDS of travel time, or Infinity if impassable. */
export interface CostModel {
  id: string;
  label: string;
  edgeCost(g: CostGrid, from: Cell, to: Cell, ctx: CostCtx): number;
  /** Optional: metabolic power (W) on the edge, for energy/heat accounting. */
  edgePowerW?(g: CostGrid, from: Cell, to: Cell, ctx: CostCtx): number;
}

export interface SearchOpts {
  /** 8 = 8-connected (default). Any-angle planners may ignore. */
  connectivity?: 4 | 8 | 16;
  /** Weighted A* inflation (≥1). */
  heuristicWeight?: number;
  maxExpansions?: number;
}

export interface SearchResult {
  cells: Uint32Array;      // path including start and goal
  cost: number;            // seconds
  expanded: number;
  ms: number;
}

/** Leg-level path search. Research planners implement this and register in Shared/src/engine/registry.ts. */
export interface PathSearch {
  id: string;
  label: string;
  search(g: CostGrid, cost: CostModel, ctx: CostCtx, start: Cell, goal: Cell, opts?: SearchOpts): SearchResult | null;
  /** Incremental replanning hook (D* Lite / Field D*): cells whose cost changed since the last search. */
  update?(changed: Cell[]): void;
}

// ───────────────────────────── Surface link ─────────────────────────────

export interface CoarseSafetyGrid {
  cellM: number;           // 50
  w: number;
  h: number;
  /** Minutes, uint16, 65535 = unreachable. Row-major, row 0 = north. */
  walkbackMin: number[];
  shelterMin: number[];
  /** Optional (added at checkpoint 1): 1 = coarse cell mostly in habitat line of sight (comm), 0 = comm shadow. */
  los?: number[];
}

export interface PlanPackage {
  v: 1;
  id: string;              // uuid-ish
  parent?: string;
  seq: number;             // monotonically increasing route version
  author: 'hab' | 'earth';
  createdUtc: string;
  siteId: string;
  rulesHash: string;
  /** Route as cells (codec may compress to chain codes on the wire). */
  route: number[];
  stops: Stop[];
  order: string[];
  bingo: Bingo[];
  startLtstMin: number;
  sol: number;
  coarse: CoarseSafetyGrid;
  /** Optional (added at checkpoint 1): the rule values this route was planned under, so the visor need not assume defaults. */
  rules?: { id: RuleId; value: number; enabled: boolean }[];
  /** Ed25519 signature (hex) over the canonical body; empty in mocks. */
  sig: string;
}

export interface Telem {
  t: number;               // EVA minutes
  cell: Cell;
  sigmaM: number;          // 1-sigma position uncertainty
  o2Pct: number;
  metW: number;
  heatAvgW: number;
  headingDeg: number;
  routeSeq: number;
}

export type AlertLevel = 'info' | 'caution' | 'warning';

export type LinkMsg =
  | { type: 'ROUTE_PUSH'; pkg: PlanPackage }
  | { type: 'ACK'; id: string; seq: number; accepted: boolean }
  | { type: 'TELEM'; telem: Telem }
  | { type: 'ALERT'; level: AlertLevel; code: string; text: string; t: number }
  | { type: 'REQUEST'; kind: 'NEW_TARGET' | 'HAZARD' | 'FATIGUED' | 'ABORT'; cell?: Cell; note?: string; t: number }
  | { type: 'HEARTBEAT'; from: 'hab' | 'visor'; t: number; seq: number };

export interface DtnBundle {
  id: string;
  src: 'hab' | 'earth';
  kind: 'PLAN' | 'LOG' | 'STM_DELTA' | 'SPACEWX' | 'NOTE';
  createdUtc: string;
  marsTime: string;
  oneWayLightMin: number;
  deliverAtUtc: string;
  body: unknown;
  sha256: string;
}

export interface EvaLog {
  evaId: string;
  planId: string;
  samples: Telem[];
  stations: { id: string; arriveMin: number; departMin: number; note?: string }[];
}
