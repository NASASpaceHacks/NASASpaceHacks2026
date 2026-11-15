import type { LoadedSitePack, PlanResult, Provenance, RoverImage, SitePackManifest, Station } from '@mw/shared/contracts';
import { roverWxFor } from './weather';
import stmJson from '../../../../Content/stm.json';

/** Science Traceability Matrix (Content/stm.json, C1). */
export interface StmObjective {
  id: string;
  goal: string;
  weight: number;
  statement: string;
  rationale: string;
  stations?: string[];
}
export interface StmGoal {
  id: string;
  statement: string;
}
export interface Stm {
  status: string;
  scoringRule: string;
  goals: StmGoal[];
  objectives: StmObjective[];
}

const BUNDLED_STM = stmJson as unknown as Stm;
/** The current site's matrix. Mutated in place by `loadStm` when the site changes (Gale = bundled Content/stm.json). */
export const STM: Stm = { ...BUNDLED_STM };
export const objectiveById = new Map(STM.objectives.map((o) => [o.id, o]));
export const goalById = new Map(STM.goals.map((g) => [g.id, g]));

function installStm(s: Stm) {
  STM.status = s.status ?? '';
  STM.scoringRule = s.scoringRule ?? '';
  STM.goals = s.goals ?? [];
  STM.objectives = s.objectives ?? [];
  objectiveById.clear();
  goalById.clear();
  STM.objectives.forEach((o) => objectiveById.set(o.id, o));
  STM.goals.forEach((g) => goalById.set(g.id, g));
}

/** Load a site's science traceability matrix: `<pack>/stm.json`, else the bundled Gale one for gale-v1, else empty. */
export async function loadStm(packBase: string, siteId: string): Promise<void> {
  try {
    const r = await fetch(`${packBase}/stm.json`);
    const ct = r.headers.get('content-type') ?? '';
    if (r.ok && ct.includes('json')) {
      const j = (await r.json()) as Stm;
      if (Array.isArray(j?.objectives)) return installStm(j);
    }
  } catch {
    /* fall through */
  }
  installStm(/^(gale|mock)/.test(siteId) ? BUNDLED_STM : { status: `no science traceability matrix for ${siteId}`, scoringRule: '', goals: [], objectives: [] });
}

export type Coverage = 'full' | 'partial' | 'lost' | 'none';

export interface ObjectiveCoverage {
  objective: StmObjective;
  candidates: string[];
  planned: string[];
  coverage: Coverage;
}

/**
 * Coverage of each objective by the current plan, over the stations offered to the planner.
 * full = every candidate station is visited; partial = some; lost = candidates exist but none
 * are visited; none = no station in this site serves the objective.
 */
export function objectiveCoverage(stations: Station[], offered: Set<string>, plan: PlanResult | null): ObjectiveCoverage[] {
  const planned = new Set(plan?.order ?? []);
  return STM.objectives.map((o) => {
    const candidates = stations.filter((s) => offered.has(s.id) && s.objectiveIds.includes(o.id)).map((s) => s.id);
    const p = candidates.filter((id) => planned.has(id));
    const coverage: Coverage = !candidates.length ? 'none' : p.length === candidates.length ? 'full' : p.length ? 'partial' : 'lost';
    return { objective: o, candidates, planned: p, coverage };
  });
}

/** "OBJ-3 coverage partial" style consequence text for a dropped station. */
export function dropConsequence(stationId: string, stations: Station[], cov: ObjectiveCoverage[]): string {
  const st = stations.find((s) => s.id === stationId);
  if (!st) return '';
  const parts = st.objectiveIds
    .map((oid) => cov.find((c) => c.objective.id === oid))
    .filter((c): c is ObjectiveCoverage => !!c && c.coverage !== 'full')
    .map((c) => `${c.objective.id} ${c.coverage === 'lost' ? 'lost' : 'partial'}`);
  return parts.length ? parts.join(' · ') : 'objectives still covered by other stations';
}

/** Rover image near a station (explicit imageIds first, else nearest within 60 m). */
export function stationImage(m: SitePackManifest, st: Station): RoverImage | null {
  if (st.imageIds?.length) {
    const hit = m.images.find((i) => st.imageIds!.includes(i.id));
    if (hit) return hit;
  }
  let best: RoverImage | null = null, bd = 60;
  for (const img of m.images) {
    const d = Math.hypot(img.x - st.x, img.y - st.y);
    if (d < bd) {
      bd = d;
      best = img;
    }
  }
  return best;
}

/** First sentence after "Why:" in a station description, else its first sentence. */
export function whyItMatters(st: Station): string {
  const d = st.description ?? '';
  const why = /Why:\s*([^.]+\.)/.exec(d);
  if (why) return why[1].trim();
  const first = /^([^.]+\.)/.exec(d);
  return (first ? first[1] : d).trim();
}

// ───────────────────────────── Data provenance summary ─────────────────────────────

export type DataKind = 'optical' | 'topographic' | 'thermal' | 'spectral' | 'atmospheric' | 'radiation' | 'space weather';

export interface SourceRow {
  layer: string;
  kind: DataKind | 'traverse' | 'imagery';
  indicative?: boolean;
  prov: Provenance;
}

const RASTER_KIND: Record<string, DataKind> = {
  dem: 'topographic', slope: 'topographic', rough: 'topographic', normals: 'topographic', skyview: 'topographic',
  ti: 'thermal', crism_sindex2: 'spectral', crism_bd1900: 'spectral', dose: 'radiation', shielding: 'radiation', rad: 'radiation',
};

function kindForRaster(id: string, p: Provenance): DataKind {
  if (RASTER_KIND[id]) return RASTER_KIND[id];
  const s = `${p.instrument} ${p.product}`.toLowerCase();
  if (s.includes('rad')) return 'radiation';
  if (s.includes('crism')) return 'spectral';
  if (s.includes('themis') || s.includes('tes') || s.includes('thermal')) return 'thermal';
  if (s.includes('hirise') || s.includes('ctx')) return 'optical';
  return 'topographic';
}

export function sourceRows(m: SitePackManifest): SourceRow[] {
  const rows: SourceRow[] = [];
  for (const img of m.imagery) for (const p of img.provenance) rows.push({ layer: img.label, kind: 'optical', prov: p });
  for (const r of Object.values(m.rasters)) for (const p of r.provenance) rows.push({ layer: r.label, kind: kindForRaster(r.id, p), indicative: r.indicative, prov: p });
  if (m.traverse) rows.push({ layer: m.traverse.label, kind: 'traverse', prov: m.traverse.provenance });
  if (m.images.length) {
    const cams = [...new Set(m.images.map((i) => i.camera.split('_')[0]))].join(', ');
    rows.push({
      layer: `Rover images (${m.images.length})`,
      kind: 'optical',
      prov: {
        mission: roverWxFor(m).mission, instrument: cams || 'Navcam/Mastcam', product: `${m.images.length} raw images`,
        url: m.images[0].sourceUrl, license: 'NASA/JPL-Caltech image use policy', citation: m.images[0].credit, resolutionM: 0,
      },
    });
  }
  const rems = m.conditions.rems;
  if (rems?.length) {
    const rw = roverWxFor(m);
    const sols = rems.map((x) => x.sol);
    rows.push({
      layer: `${rw.instrument} weather (${rems.length} sols)`,
      kind: 'atmospheric',
      prov: {
        mission: rw.mission, instrument: rw.instrument, product: `sols ${Math.min(...sols)}–${Math.max(...sols)}`,
        url: rw.url, license: 'Public domain (NASA/JPL-Caltech/CAB)', citation: rw.credit, resolutionM: 0,
      },
    });
  }
  const sw = m.conditions.spaceWeather;
  if (sw?.length) {
    rows.push({
      layer: `Space weather (${sw.length} events)`,
      kind: 'space weather',
      prov: {
        mission: 'NASA CCMC DONKI', instrument: 'DONKI', product: [...new Set(sw.map((e) => e.kind))].join(', '),
        url: sw[0].sourceUrl, license: 'Public domain (NASA)', citation: 'Space Weather Database Of Notifications, Knowledge, Information (CCMC)', resolutionM: 0,
      },
    });
  }
  return rows;
}

// ───────────────────────────── CRISM mineral signal ─────────────────────────────

export type MineralTier = 'strong' | 'moderate' | 'weak';
export interface MineralSignal {
  tier: MineralTier;
  /** SINDEX2 at the station (mean of the 3×3 engine cells ≈ one 18 m CRISM pixel). */
  value: number;
  /** BD1900_2 hydration band is clearly present here (top 5 % of the AOI). */
  hydrated: boolean;
}

const crismCut = new WeakMap<Float32Array, { p50: number; p85: number }>();

/**
 * Tier of the CRISM polyhydrated-sulfate parameter (SINDEX2) relative to this AOI: strong = top 15 % of the AOI's valid pixels,
 * moderate = above the AOI median, weak = at or below it. Relative, not absolute: summary parameters flag a spectral signature,
 * not an abundance (Viviano-Beck et al. 2014), and the values over this dark terrain are small.
 */
export function mineralSignalAt(pack: LoadedSitePack, x: number, y: number): MineralSignal | null {
  const a = pack.rasters.crism_sindex2;
  if (!a) return null;
  const { w, h, cellM, originX, originY } = pack.manifest.grid;
  let cut = crismCut.get(a);
  if (!cut) {
    const v: number[] = [];
    for (let i = 0; i < a.length; i += 7) if (Number.isFinite(a[i])) v.push(a[i]);
    v.sort((p, q) => p - q);
    cut = { p50: v[Math.floor(v.length * 0.5)] ?? 0, p85: v[Math.floor(v.length * 0.85)] ?? 0 };
    crismCut.set(a, cut);
  }
  const mean = (arr: Float32Array | undefined) => {
    if (!arr) return null;
    const c = Math.floor((x - originX) / cellM), r = Math.floor((originY - y) / cellM);
    let s = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
      const v = arr[rr * w + cc];
      if (Number.isFinite(v)) { s += v; n++; }
    }
    return n ? s / n : null;
  };
  const v = mean(a);
  if (v === null) return null;
  const hyd = mean(pack.rasters.crism_bd1900);
  return { tier: v >= cut.p85 ? 'strong' : v > cut.p50 ? 'moderate' : 'weak', value: v, hydrated: hyd !== null && hyd >= 0.0008 };
}

const NOT_MISSIONS = /synthetic|ccmc|donki|team|derived/i;

export function dataSummary(m: SitePackManifest): { missions: string[]; kinds: DataKind[]; synthetic: boolean } {
  const rows = sourceRows(m);
  const missions = [...new Set(rows.map((r) => r.prov.mission).filter((x) => x && !NOT_MISSIONS.test(x)))];
  const kinds = [...new Set(rows.map((r) => r.kind).filter((k): k is DataKind => k !== 'traverse' && k !== 'imagery'))];
  return { missions, kinds, synthetic: rows.length > 0 && rows.every((r) => /synthetic/i.test(r.prov.mission)) };
}
