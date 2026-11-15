// Engine public API (B2). Pure TS on typed arrays — no DOM, no Node-only APIs — so it runs in Node,
// Web Workers and the visor. See docs/AGENTS.md "Engine public API".
//
// Time conventions used by every engine output:
// - tMin = EARTH minutes from EVA start (start of egress). Egress/ingress overhead is split evenly:
//   the crew is on the surface from egress/2 until the return, then ingress/2.
// - ltstMin = Mars-clock minutes (1/1440 sol) after local midnight; ltst(t) = startLtstMin + t/1.0275
//   (use ltstAt()).
// - PlanResult.bingo ends with an entry id 'HAB' = latest return to the hab (the safety core reads it).
// - PlanPackage.route = concatenated segment cells; each stop appears twice in a row (stop marker).
import './defaults'; // registers pandolf-santee-mars, dijkstra, astar

export * from './registry';

export { buildCostGrid, keepoutMask, pointInRings } from './costGrid';
export { computeFields, dijkstraField, viewshed, requestHash, mergeRules, MAST_HEIGHT_M, OBSERVER_HEIGHT_M } from './fields';
export { plan, stageFromShelter, evaluateOrder, makeOrderEvaluator, type OrderEval, DEFAULT_LS_DEG, RULE_SHORT } from './plan';
export { toPlanPackage, encodePackage, decodePackage, coarsen, COARSE_CELL_M, COARSE_UNREACHABLE, PACKAGE_MAX_BYTES } from './codec';
export { marsTime, sunPosition, sunAtLtst, mars24, ltstAt, formatLtst, solarDeclination, planetographicLat, EARTH_MIN_PER_MARS_MIN } from './marstime';
export { createSafetyCore, type SafetyCore, type SafetyState, type SafetyLimits } from './safetyCore';
export { pandolfSanteeMars, pandolfSanteeW, marsMetabolicW, etaFromThermalInertia, PANDOLF_SANTEE_MARS } from './costModel';
export { dijkstraSearch, astarSearch } from './search';
export { doseEqRateUSvPerMin, doseRateUGyPerDay, pressureAtElevation, skyShieldFactor } from './radiation';
export { HEAT_TAU_MIN, REST_W, TASK_W_DEFAULT, HEAT_INITIAL_W, restNeeded, heatAfterRest, heatAfterWork, type HeatParams } from './heat';
