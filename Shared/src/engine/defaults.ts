// Registers the default planners. Imported by every module that resolves planners by id, so the
// defaults exist whichever engine entry point is loaded first.
import { pandolfSanteeMars } from './costModel';
import { registerCostModel, registerPathSearch } from './registry';
import { astarSearch, dijkstraSearch } from './search';

registerCostModel(pandolfSanteeMars);
registerPathSearch(dijkstraSearch);
registerPathSearch(astarSearch);

export const DEFAULTS_REGISTERED = true;
