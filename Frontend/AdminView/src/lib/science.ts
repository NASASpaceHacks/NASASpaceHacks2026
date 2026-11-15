import type { PlanResult, Provenance, RoverImage, SitePackManifest, Station } from '@mw/shared/contracts';
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

export type DataKind = 'optical' | 'topographic' | 'thermal' | 'atmospheric' | 'radiation' | 'space weather';

export interface SourceRow {
  layer: string;
  kind: DataKind | 'traverse' | 'imagery';
  indicative?: boolean;
  prov: Provenance;
}

const RASTER_KIND: Record<string, DataKind> = {
  dem: 'topographic', slope: 'topographic', rough: 'topographic', normals: 'topographic', skyview: 'topographic',
  ti: 'thermal', dose: 'radiation', shielding: 'radiation', rad: 'radiation',
};

function kindForRaster(id: string, p: Provenance): DataKind {
  if (RASTER_KIND[id]) return RASTER_KIND[id];
  const s = `${p.instrument} ${p.product}`.toLowerCase();
  if (s.includes('rad')) return 'radiation';
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
        mission: 'Mars Science Laboratory', instrument: cams || 'Navcam/Mastcam', product: `${m.images.length} raw images`,
        url: m.images[0].sourceUrl, license: 'NASA/JPL-Caltech image use policy', citation: m.images[0].credit, resolutionM: 0,
      },
    });
  }
  const rems = m.conditions.rems;
  if (rems?.length) {
    rows.push({
      layer: `REMS weather (${rems.length} sols)`,
      kind: 'atmospheric',
      prov: {
        mission: 'Mars Science Laboratory', instrument: 'REMS', product: `sols ${rems[0].sol}–${rems[rems.length - 1].sol}`,
        url: 'https://mars.nasa.gov/msl/mission/weather/', license: 'Public domain (NASA/JPL-Caltech/CAB)', citation: 'REMS team, Centro de Astrobiología (CSIC-INTA)', resolutionM: 0,
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

const NOT_MISSIONS = /synthetic|ccmc|donki|team|derived/i;

export function dataSummary(m: SitePackManifest): { missions: string[]; kinds: DataKind[]; synthetic: boolean } {
  const rows = sourceRows(m);
  const missions = [...new Set(rows.map((r) => r.prov.mission).filter((x) => x && !NOT_MISSIONS.test(x)))];
  const kinds = [...new Set(rows.map((r) => r.kind).filter((k): k is DataKind => k !== 'traverse' && k !== 'imagery'))];
  return { missions, kinds, synthetic: rows.length > 0 && rows.every((r) => /synthetic/i.test(r.prov.mission)) };
}
