import type { Cell, CostGrid, FieldSet, LoadedSitePack, PlanEvent, Rule, RuleId } from '@mw/shared/contracts';
import { DEFAULT_CREW } from '@mw/shared/contracts';
import { buildCostGrid, dijkstraField } from '@mw/shared/engine';
import {
  NO_LIMITS,
  chamferDistanceM,
  distanceFromCell,
  finiteField,
  maskAreaKm2,
  rasterizeKeepouts,
  safeZoneMask,
  type SafeZoneInputs,
  type SafeZoneLimits,
  type SafeZoneVars,
} from '@mw/shared/map';

/** Derived per-pack rasters that never change during a session. */
interface PackStatics {
  keepout: Uint8Array;
  slope: Float32Array;
  /** Straight-line distance from an EVA base cell (walk radius), last few bases. */
  dist: Map<Cell, Float32Array>;
  /** Engine cost grid (lazily built) for terrain-aware LOS gaps. */
  grid?: CostGrid | null;
  /** LOS-gap field per engine LOS raster content (the LOS only changes when the rover relay moves). */
  losGap: Map<string, { gap: Float32Array; source: 'engine' | 'estimate' }>;
}
const packCache = new WeakMap<LoadedSitePack, PackStatics>();

function packStatics(pack: LoadedSitePack): PackStatics {
  let s = packCache.get(pack);
  if (!s) {
    const g = pack.manifest.grid;
    s = {
      keepout: rasterizeKeepouts(g, pack.manifest.keepouts),
      slope: finiteField(pack.rasters.slope, 90),
      dist: new Map(),
      losGap: new Map(),
    };
    packCache.set(pack, s);
  }
  return s;
}

function distFrom(pack: LoadedSitePack, st: PackStatics, cell: Cell): Float32Array {
  let d = st.dist.get(cell);
  if (!d) {
    d = distanceFromCell(pack.manifest.grid, cell);
    st.dist.set(cell, d);
    while (st.dist.size > 3) st.dist.delete(st.dist.keys().next().value as Cell);
  }
  return d;
}

/**
 * Round-trip minutes spent outside comm line of sight to visit a cell. `los` is the ENGINE's comm
 * line-of-sight field (hab mast ∪ pressurized-rover relay masts, from /api/fields/:reqHash/los).
 * The one-way time from the nearest LOS cell uses the engine's own travel-time model (Dial over the
 * Pandolf–Santee-Mars cost grid at v0, slope/keep-out blocked), so the zone matches how the planner
 * times comm gaps along a route. Falls back to a straight-line estimate if the engine is unavailable.
 */
/** FNV-1a over a mask's set-cell indices (cheap content key, ~2 ms per 1M cells). */
function maskKey(m: Uint8Array): string {
  let h = 0x811c9dc5, ones = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== 1) continue;
    ones++;
    h = Math.imul(h ^ i, 0x01000193);
  }
  return `${m.length}:${ones}:${(h >>> 0).toString(16)}`;
}

function losGapField(pack: LoadedSitePack, st: PackStatics, los: Uint8Array): { gap: Float32Array; source: 'engine' | 'estimate' } {
  const key = maskKey(los);
  const hit = st.losGap.get(key);
  if (hit) return hit;
  const g = pack.manifest.grid;
  const n = g.w * g.h;
  const gap = new Float32Array(n);
  let source: 'engine' | 'estimate' = 'estimate';
  try {
    if (st.grid === undefined) st.grid = buildCostGrid(pack);
    if (st.grid) {
      const src: number[] = [];
      for (let i = 0; i < n; i++) if (los[i] === 1) src.push(i);
      const oneWay = src.length ? dijkstraField(st.grid, src, false, 1) : null;
      if (oneWay) {
        for (let i = 0; i < n; i++) {
          const v = 2 * oneWay[i];
          gap[i] = v < 1e5 ? v : 1e5;
        }
        source = 'engine';
      }
    }
  } catch (err) {
    console.warn('[console] engine LOS-gap field failed, using straight-line estimate', err);
    st.grid = null;
  }
  // In comm LOS = no gap, by definition (also for LOS cells the walking graph treats as blocked).
  for (let i = 0; i < n; i++) if (los[i] === 1) gap[i] = 0;
  if (source === 'estimate') {
    // Straight-line round trip at nominal pace v0 (DEFAULT_CREW.v0 = 0.56 m/s, xEVA ConOps EVA-EXP-0042).
    const losDistM = chamferDistanceM(los, g.w, g.h, g.cellM);
    const k = 2 / (DEFAULT_CREW.v0 * 60);
    for (let i = 0; i < n; i++) gap[i] = Math.min(1e5, losDistM[i] * k);
  }
  const out = { gap, source };
  st.losGap.set(key, out);
  while (st.losGap.size > 3) st.losGap.delete(st.losGap.keys().next().value as string);
  return out;
}

/** Which model produced the LOS-gap layer of a zone built from these fields. */
export function losGapSource(pack: LoadedSitePack, fields: FieldSet): 'engine' | 'estimate' | null {
  return packCache.get(pack)?.losGap.get(maskKey(fields.los))?.source ?? null;
}

/**
 * Build the safe-zone inputs from engine fields. `baseCell` = the EVA base (req.hab; the rover cell
 * for a rover-staged EVA), so the walk radius is measured from where the EVA starts, like the planner.
 */
export function buildZone(pack: LoadedSitePack, fields: FieldSet, hazards: Cell[] = [], baseCell?: Cell): SafeZoneInputs {
  const g = pack.manifest.grid;
  const n = g.w * g.h;
  const st = packStatics(pack);
  const base = baseCell ?? pack.manifest.shelters.find((x) => x.kind === 'hab')!.cell;
  const walkbackTotal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = fields.outboundMin[i] + fields.walkbackMin[i];
    walkbackTotal[i] = Number.isFinite(v) ? Math.min(v, 1e5) : 1e5;
  }
  const losGap = losGapField(pack, st, fields.los).gap;
  let keepout = st.keepout;
  if (hazards.length) {
    keepout = st.keepout.slice();
    for (const c of hazards) if (c >= 0 && c < n) keepout[c] = 1;
  }
  return {
    w: g.w,
    h: g.h,
    cellM: g.cellM,
    slope: st.slope,
    distHab: distFrom(pack, st, base),
    walkbackTotal,
    shelter: finiteField(fields.shelterMin),
    losGap,
    keepout,
    blocked: fields.blocked,
  };
}

const rv = (rules: Rule[], id: RuleId, dflt: number) => {
  const r = rules.find((x) => x.id === id);
  return r && r.enabled ? r.value : dflt;
};

/** Hard-rule limits for the zone, from the active rules and accumulated plan events. */
export function zoneLimits(rules: Rule[], events: PlanEvent[] = []): SafeZoneLimits {
  const cut = events.reduce((a, e) => (e.t === 'EVA_CUT' ? a + e.min : a), 0);
  const sep = events.reduce((a, e) => (e.t === 'SEP_NOWCAST' ? Math.min(a, e.leadMin) : a), Infinity);
  return {
    slopeMax: rv(rules, 'slope_max_deg', Infinity),
    radiusMax: rv(rules, 'walk_radius_max_m', Infinity),
    walkbackMax: rv(rules, 'eva_duration_max_min', Infinity) - rv(rules, 'egress_ingress_min', 0) - cut,
    shelterMax: Math.min(rv(rules, 'shelter_time_max_min', Infinity), sep),
    losGapMax: rv(rules, 'los_gap_max_min', Infinity),
    useKeepout: true,
    useBlocked: true,
  };
}

export const toVars = (l: SafeZoneLimits): Partial<SafeZoneVars> => ({
  limSlope: Number.isFinite(l.slopeMax) ? l.slopeMax : 1e6,
  limRadius: Number.isFinite(l.radiusMax) ? l.radiusMax : 1e9,
  limWalkback: Number.isFinite(l.walkbackMax) ? l.walkbackMax : 1e9,
  limShelter: Number.isFinite(l.shelterMax) ? l.shelterMax : 1e9,
  limLos: Number.isFinite(l.losGapMax) ? l.losGapMax : 1e9,
  keepOn: l.useKeepout ? 1 : 0,
  blockedOn: l.useBlocked ? 1 : 0,
});

export interface ExplainStep {
  act: number;
  key: keyof SafeZoneVars;
  from: number;
  to: number;
  caption: string;
  detail: string;
  /** Safe area (km²) before and after this step. */
  areaBefore: number;
  areaAfter: number;
  /** Variables set at the start of the step (e.g. keep-outs on). */
  set?: Partial<SafeZoneVars>;
}

function maxFinite(a: Float32Array, cap = 1e4): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (a[i] < cap && a[i] > m) m = a[i];
  return m;
}

/** The six-step "Explain safe zone" sequence with honest area numbers computed on the CPU. */
export function explainSteps(z: SafeZoneInputs, l: SafeZoneLimits): ExplainStep[] {
  const cum: SafeZoneLimits[] = [];
  let cur: SafeZoneLimits = { ...NO_LIMITS };
  const push = (p: Partial<SafeZoneLimits>) => {
    cur = { ...cur, ...p };
    cum.push(cur);
  };
  push({ slopeMax: l.slopeMax, useKeepout: true });
  push({ radiusMax: l.radiusMax });
  push({ walkbackMax: l.walkbackMax });
  push({ shelterMax: l.shelterMax });
  push({ losGapMax: l.losGapMax });
  push({ useBlocked: true });
  const mask = new Uint8Array(z.w * z.h);
  const area0 = maskAreaKm2(safeZoneMask(z, NO_LIMITS, mask), z.cellM);
  const areas = cum.map((c) => maskAreaKm2(safeZoneMask(z, c, mask), z.cellM));
  const before = (i: number) => (i === 0 ? area0 : areas[i - 1]);
  const v = toVars(l);
  const fin = (x: number, d: number) => (Number.isFinite(x) ? x : d);
  return [
    {
      act: 1, key: 'limSlope', from: Math.max(45, fin(l.slopeMax, 20) + 10), to: v.limSlope!, set: { keepOn: 1 },
      caption: `Slope ≤ ${fin(l.slopeMax, 0)}° · keep-outs`,
      detail: 'Suited-crew slope limit (xEVA ConOps EVA-EXP-0042) and plume / hazard keep-out zones.',
      areaBefore: before(0), areaAfter: areas[0],
    },
    {
      act: 2, key: 'limRadius', from: maxFinite(z.distHab, 1e9), to: v.limRadius!,
      caption: `Walk radius ≤ ${(fin(l.radiusMax, 0) / 1000).toFixed(1)} km`,
      detail: 'Measured from the EVA base. 1 h emergency return on contingency O₂ (Tenets of Lunar EVA, NTRS 20230008183).',
      areaBefore: before(1), areaAfter: areas[1],
    },
    {
      act: 3, key: 'limWalkback', from: Math.max(maxFinite(z.walkbackTotal), fin(l.walkbackMax, 0) + 1), to: v.limWalkback!,
      caption: `Walkback fits ${Math.round(fin(l.walkbackMax, 0))} min`,
      detail: 'Outbound time plus a degraded-crew return at 0.5× pace must fit the EVA budget.',
      areaBefore: before(2), areaAfter: areas[2],
    },
    {
      act: 4, key: 'limShelter', from: Math.max(Math.min(maxFinite(z.shelter), fin(l.shelterMax, 30) * 5), fin(l.shelterMax, 0) + 1), to: v.limShelter!,
      caption: `Shelter ≤ ${Math.round(fin(l.shelterMax, 0))} min`,
      detail: 'Onboard SEP nowcast gives ≥ 30 min warning (arXiv:2502.02469). Hab or pressurized rover.',
      areaBefore: before(3), areaAfter: areas[3],
    },
    {
      act: 5, key: 'limLos', from: Math.max(Math.min(maxFinite(z.losGap), 120), fin(l.losGapMax, 0) + 1), to: v.limLos!,
      caption: `Line-of-sight gaps ≤ ${Math.round(fin(l.losGapMax, 0))} min`,
      detail: 'Engine comm line of sight (hab mast ∪ rover relay). Cells deeper in comm shadow than the gap limit, timed round trip on the terrain (FOD constraint, NTRS 20250006063).',
      areaBefore: before(4), areaAfter: areas[4],
    },
    {
      act: 6, key: 'blockedOn', from: 0, to: 1,
      caption: 'Safe region',
      detail: 'Every hard rule at once, including engine-blocked terrain. The plan may only use this ground.',
      areaBefore: before(5), areaAfter: areas[5],
    },
  ];
}

/** Final safe-region mask for the current limits. */
export function finalMask(z: SafeZoneInputs, l: SafeZoneLimits): Uint8Array {
  return safeZoneMask(z, l);
}
