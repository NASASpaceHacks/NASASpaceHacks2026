/**
 * Science content for the STATION card: the Science Traceability Matrix (Content/stm.json, C1) gives
 * each objective's statement and the crew actions that make its measurements; Content/stations.gale.json
 * carries the 12 real boxwork-era targets (descriptions + citations) for the gale site packs.
 */
import stmJson from '../../../../Content/stm.json';
import galeStationsJson from '../../../../Content/stations.gale.json';

export interface StmMeasurement {
  id: string;
  crew_action: string;
  instrument_analog?: string;
  output?: string;
}
export interface StmObjective {
  id: string;
  goal: string;
  weight: number;
  statement: string;
  measurements: StmMeasurement[];
  stations?: string[];
}
interface Stm {
  goals: { id: string; statement: string }[];
  objectives: StmObjective[];
}
export interface GaleStation {
  id: string;
  name: string;
  description: string;
  citation?: string;
  objectiveIds: string[];
}

const BUNDLED = stmJson as unknown as Stm;
let STM = BUNDLED;
const GALE = galeStationsJson as unknown as GaleStation[];
const OBJ = new Map(STM.objectives.map((o) => [o.id, o]));

/** The visor follows the route's site: load that site's matrix (`<pack>/stm.json`); Gale falls back to the bundled one. */
export async function loadSiteStm(packBase: string, siteId: string): Promise<void> {
  let next: Stm | null = null;
  try {
    const r = await fetch(`${packBase}/stm.json`);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const j = (await r.json()) as Stm;
      if (Array.isArray(j?.objectives)) next = j;
    }
  } catch {
    /* fall back */
  }
  STM = next ?? (/^(gale|mock)/.test(siteId) ? BUNDLED : { ...BUNDLED, objectives: [] });
  OBJ.clear();
  STM.objectives.forEach((o) => OBJ.set(o.id, o));
}

/** Objectives a station serves, highest weight first. */
export function objectivesFor(ids: string[]): StmObjective[] {
  return ids.map((id) => OBJ.get(id)).filter((o): o is StmObjective => !!o).sort((a, b) => b.weight - a.weight);
}

export interface CrewTask {
  id: string;
  label: string;
  objectiveId: string;
  instrument: string | null;
}

/** Crew checklist = the crew_action lines of the measurements of the objectives the station serves. */
export function crewTasks(objectiveIds: string[]): CrewTask[] {
  const out: CrewTask[] = [];
  const seen = new Set<string>();
  for (const o of objectivesFor(objectiveIds))
    for (const m of o.measurements) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, label: m.crew_action, objectiveId: o.id, instrument: m.instrument_analog ?? null });
    }
  return out;
}

export function goalStatement(goalId: string): string | null {
  return STM.goals.find((g) => g.id === goalId)?.statement ?? null;
}

/** Real Gale target metadata by id — only used when the site pack itself is a gale pack. */
export function galeStation(id: string): GaleStation | null {
  return GALE.find((s) => s.id === id) ?? null;
}
