import type { CostModel, PathSearch } from '../contracts/types';

/**
 * Planner registry — the plug-in point for research.
 *
 * Research planners (Research/planners/*.ts) and cost models register here. The orienteering
 * optimizer, time-stepped simulator and constraint checks are FIXED, so every registered planner
 * is automatically safety-checked. Select the active planner with PlanRequest.planner or the
 * MARSWALK_PATH_SEARCH / MARSWALK_COST_MODEL env vars on the Backend.
 */
const pathSearches = new Map<string, PathSearch>();
const costModels = new Map<string, CostModel>();

export function registerPathSearch(p: PathSearch): void {
  pathSearches.set(p.id, p);
}

export function registerCostModel(c: CostModel): void {
  costModels.set(c.id, c);
}

export function getPathSearch(id: string): PathSearch {
  const p = pathSearches.get(id);
  if (!p) throw new Error(`PathSearch '${id}' not registered (have: ${[...pathSearches.keys()].join(', ')})`);
  return p;
}

export function getCostModel(id: string): CostModel {
  const c = costModels.get(id);
  if (!c) throw new Error(`CostModel '${id}' not registered (have: ${[...costModels.keys()].join(', ')})`);
  return c;
}

export const listPathSearches = (): PathSearch[] => [...pathSearches.values()];
export const listCostModels = (): CostModel[] => [...costModels.values()];

/** Defaults used when a request does not specify a planner. */
export const DEFAULT_PATH_SEARCH = 'dijkstra';
export const DEFAULT_COST_MODEL = 'pandolf-santee-mars';
