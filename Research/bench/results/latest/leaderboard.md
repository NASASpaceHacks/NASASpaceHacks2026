# Marswalk planner leaderboard

Site `gale-v1`, 40 static + 40 hidden-hazard scenarios, seed 1.
All paths are scored under judge cost model `pandolf-santee-mars`; optimality gap is vs an independent Dijkstra oracle on the fully known map. Baseline: `dijkstra` x `pandolf-santee-mars`.

| # | Planner | Cost model | Static gap % (mean/max) | Cost s | Length m | Max slope | Rough % | Turns | Expanded | p50 ms | p95 ms | Mem MB | Hazard success | Replans | Extra dist m | Violations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | astar ★ | pandolf-santee-mars | 0.000 / 0.000 | 4606.4 | 2560 | 19.1 | 0.0 | 95.5 | 55283 | 7.90 | 33.04 | 20.9 | 100% | 8.6 | 141.4 | 0 |
| 2 | dijkstra | pandolf-santee-mars | 0.037 / 0.064 | 4608.1 | 2560 | 19.0 | 0.0 | 97.8 | 259124 | 36.18 | 79.14 | 19.4 | 100% | 7.4 | 140.7 | 0 |
| 3 | astar | ref-slope | 1.261 / 5.448 | 4667.6 | 2594 | 19.0 | 0.0 | 105.4 | 103593 | 30.55 | 105.48 | 28.3 | 100% | 5.3 | 156.6 | 0 |
| 4 | dijkstra | ref-slope | 1.257 / 5.446 | 4668.0 | 2594 | 19.1 | 0.0 | 105.5 | 268407 | 79.31 | 138.49 | 22.5 | 100% | 5.1 | 156.6 | 0 |
| 5 | wastar-1.5 | ref-slope | 1.291 / 6.028 | 4666.6 | 2591 | 19.2 | 0.0 | 100.8 | 51228 | 15.70 | 55.34 | 24.5 | 100% | 4.6 | 165.6 | 0 |
| 6 | wastar-1.5 | pandolf-santee-mars | 2.810 / 8.625 | 4738.1 | 2627 | 19.5 | 0.0 | 82.6 | 30539 | 8.70 | 60.66 | 20.8 | 100% | 4.3 | 217.9 | 0 |

**★** = lower mean cost than the baseline (static or hidden-hazard walk) with 0 hard-constraint violations and no loss of success rate. **⚡** = equal cost (within 1%) at >=2x lower p50 latency, same safety. Violations (slope > 20 deg, blocked cells, broken paths) must be 0; a planner with any is ranked last and can never merge. Rough = cells with roughness > 0.5 m. Memory is a heap+ArrayBuffer delta measured around the search call (an estimate, noisy without forced GC). The baseline's own gap should be ~0 by construction.
