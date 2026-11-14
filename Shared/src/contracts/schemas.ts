import { z } from 'zod';

/** Runtime validation for data crossing trust boundaries (site pack files, HTTP API, surface link). */

const num = z.number().finite();
const xy = z.tuple([num, num]);

export const ProvenanceSchema = z.object({
  mission: z.string(),
  instrument: z.string(),
  product: z.string(),
  url: z.string(),
  license: z.string(),
  citation: z.string(),
  resolutionM: num,
  accuracy: z.string().optional(),
});

export const RasterLayerSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['continuous', 'categorical', 'mask', 'vector2']),
  file: z.string(),
  dtype: z.enum(['u8', 'u16', 'i16', 'f32']),
  bands: z.number().int().min(1).max(4),
  scale: num,
  offset: num,
  nodata: num.optional(),
  unit: z.string(),
  provenance: z.array(ProvenanceSchema).min(1),
  indicative: z.boolean().optional(),
});

export const SitePackManifestSchema = z.object({
  schema: z.literal('sitepack/1'),
  id: z.string(),
  name: z.string(),
  body: z.literal('mars'),
  createdUtc: z.string(),
  grid: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    cellM: num.positive(),
    proj4: z.string().includes('+R=3396190'),
    originX: num,
    originY: num,
    centerLonLat: xy,
  }),
  rasters: z.record(z.string(), RasterLayerSchema).refine((r) => 'dem' in r && 'slope' in r, 'rasters must include dem and slope'),
  imagery: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      file: z.string(),
      format: z.enum(['cog', 'png', 'jpg', 'webp']),
      extent: z.tuple([num, num, num, num]),
      resolutionM: num,
      provenance: z.array(ProvenanceSchema).min(1),
    }),
  ),
  stations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      x: num,
      y: num,
      cell: z.number().int().nonnegative(),
      value: num.min(0).max(100),
      objectiveIds: z.array(z.string()),
      dwellMin: num.nonnegative(),
      taskW: num.optional(),
      description: z.string(),
      citation: z.string().optional(),
      imageIds: z.array(z.string()).optional(),
    }),
  ),
  landmarks: z.array(z.object({ id: z.string(), name: z.string(), x: num, y: num, elevM: num, informal: z.boolean() })),
  shelters: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['hab', 'rover', 'cache']),
        name: z.string(),
        x: num,
        y: num,
        cell: z.number().int().nonnegative(),
        movable: z.boolean(),
      }),
    )
    .refine((s) => s.filter((x) => x.kind === 'hab').length === 1, 'exactly one hab'),
  keepouts: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['plume', 'science_preservation', 'special_region', 'hazard']),
      label: z.string(),
      rings: z.array(z.array(xy)),
      citation: z.string().optional(),
    }),
  ),
  traverse: z
    .object({ label: z.string(), lines: z.array(z.array(xy)), provenance: ProvenanceSchema })
    .optional(),
  images: z.array(
    z.object({
      id: z.string(),
      sol: z.number().int(),
      camera: z.string(),
      x: num,
      y: num,
      cell: z.number().int(),
      file: z.string(),
      credit: z.string(),
      sourceUrl: z.string(),
      caption: z.string().optional(),
    }),
  ),
  conditions: z.object({
    rems: z.array(z.any()).optional(),
    spaceWeather: z.array(z.any()).optional(),
    fetchedUtc: z.string(),
  }),
  scenario: z.object({ sol: z.number().int(), startLtstMin: num, label: z.string() }),
  files: z.record(z.string(), z.string()),
});

const RuleIdSchema = z.enum([
  'slope_max_deg',
  'slope_soft_deg',
  'eva_duration_max_min',
  'egress_ingress_min',
  'contingency_o2_min',
  'walkback_speed_factor',
  'shelter_time_max_min',
  'los_gap_max_min',
  'daylight_min_sun_elev_deg',
  'heat_avg_max_w',
  'walk_radius_max_m',
  'plume_keepout_m',
]);

export const RuleSchema = z.object({
  id: RuleIdSchema,
  label: z.string(),
  value: num,
  unit: z.string(),
  hard: z.boolean(),
  enabled: z.boolean(),
  citation: z.string(),
  assumption: z.boolean().optional(),
});

export const PlanRequestSchema = z.object({
  siteId: z.string(),
  hab: z.number().int().nonnegative(),
  shelters: z.array(z.object({ id: z.string(), kind: z.enum(['hab', 'rover', 'cache']), cell: z.number().int().nonnegative() })),
  sol: z.number().int(),
  startLtstMin: num,
  stations: z
    .array(z.object({ id: z.string(), cell: z.number().int().nonnegative(), value: num, dwellMin: num.nonnegative(), taskW: num.optional() }))
    .max(15),
  rules: z.array(RuleSchema),
  crew: z.object({ bodyMassKg: num.positive(), suitMassKg: num.nonnegative(), toolsKg: num.nonnegative(), v0: num.positive(), gRatio: num.positive() }),
  events: z
    .array(
      z.discriminatedUnion('t', [
        z.object({ t: z.literal('EVA_CUT'), min: num.positive() }),
        z.object({ t: z.literal('SEP_NOWCAST'), leadMin: num.positive() }),
        z.object({ t: z.literal('HAZARD'), cells: z.array(z.number().int().nonnegative()), note: z.string().optional() }),
        z.object({ t: z.literal('FIX'), cell: z.number().int().nonnegative() }),
      ]),
    )
    .optional(),
  resume: z
    .object({ elapsedMin: num.nonnegative(), cell: z.number().int().nonnegative(), visited: z.array(z.string()), o2UsedPct: num })
    .optional(),
  planner: z.object({ pathSearch: z.string(), costModel: z.string() }).optional(),
  seed: z.number().int(),
});

const StopSchema = z.object({ id: z.string(), arriveMin: num, departMin: num, arriveLtstMin: num });
const BingoSchema = z.object({ id: z.string(), ltstMin: num, tMin: num, text: z.string() });

export const PlanPackageSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  parent: z.string().optional(),
  seq: z.number().int().nonnegative(),
  author: z.enum(['hab', 'earth']),
  createdUtc: z.string(),
  siteId: z.string(),
  rulesHash: z.string(),
  route: z.array(z.number().int().nonnegative()),
  stops: z.array(StopSchema),
  order: z.array(z.string()),
  bingo: z.array(BingoSchema),
  startLtstMin: num,
  sol: z.number().int(),
  coarse: z.object({
    cellM: num.positive(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    walkbackMin: z.array(z.number().int().min(0).max(65535)),
    shelterMin: z.array(z.number().int().min(0).max(65535)),
    los: z.array(z.number().int().min(0).max(1)).optional(),
  }),
  rules: z.array(z.object({ id: RuleIdSchema, value: num, enabled: z.boolean() })).optional(),
  sig: z.string(),
});

export const TelemSchema = z.object({
  t: num,
  cell: z.number().int().nonnegative(),
  sigmaM: num.nonnegative(),
  o2Pct: num,
  metW: num,
  heatAvgW: num,
  headingDeg: num,
  routeSeq: z.number().int().nonnegative(),
});

export const LinkMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROUTE_PUSH'), pkg: PlanPackageSchema }),
  z.object({ type: z.literal('ACK'), id: z.string(), seq: z.number().int(), accepted: z.boolean() }),
  z.object({ type: z.literal('TELEM'), telem: TelemSchema }),
  z.object({ type: z.literal('ALERT'), level: z.enum(['info', 'caution', 'warning']), code: z.string(), text: z.string(), t: num }),
  z.object({
    type: z.literal('REQUEST'),
    kind: z.enum(['NEW_TARGET', 'HAZARD', 'FATIGUED', 'ABORT']),
    cell: z.number().int().nonnegative().optional(),
    note: z.string().optional(),
    t: num,
  }),
  z.object({ type: z.literal('HEARTBEAT'), from: z.enum(['hab', 'visor']), t: num, seq: z.number().int() }),
]);
