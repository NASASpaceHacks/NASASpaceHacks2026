# Marswalk planner leaderboard

Site `gale-v1`, 40 static + 40 hidden-hazard scenarios, seed 1.
All paths are scored under judge cost model `pandolf-santee-mars`; optimality gap is vs an independent Dijkstra oracle on the fully known map. Baseline: `dijkstra` x `pandolf-santee-mars`.

| # | Planner | Cost model | Static gap % (mean/max) | Cost s | Length m | Max slope | Rough % | Turns | Expanded | p50 ms | p95 ms | Mem MB | Hazard success | Replans | Extra dist m | Violations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | dijkstra | pandolf-santee-mars | 0.036 / 0.064 | 5166.4 | 2871 | 19.0 | 0.0 | 101.8 | 267523 | 35.99 | 86.56 | 16.6 | 100% | 7.2 | 124.2 | 0 |
| 2 | astar ★ | pandolf-santee-mars | 0.000 / 0.000 | 5164.6 | 2871 | 19.0 | 0.0 | 99.6 | 73575 | 11.18 | 80.08 | 19.0 | 100% | 8.4 | 125.7 | 0 |
| 3 | wastar-1.5 | pandolf-santee-mars | 2.847 / 9.329 | 5295.9 | 2939 | 19.5 | 0.0 | 92.9 | 44839 | 8.80 | 53.51 | 16.1 | 100% | 3.8 | 210.8 | 0 |
| 4 | astar | ref-slope | -4.925 / 5.278 | 4651.9 | 2594 | 19.0 | 0.0 | 104.9 | 103593 | 31.04 | 104.93 | 21.8 | 100% | 4.5 | 24.0 | **148** |
| 5 | dijkstra | ref-slope | -4.914 / 5.276 | 4653.7 | 2594 | 19.1 | 0.0 | 105.1 | 268407 | 79.42 | 137.99 | 18.8 | 100% | 4.3 | 24.0 | **140** |
| 6 | wastar-1.5 | ref-slope | -4.998 / 6.028 | 4647.4 | 2591 | 19.2 | 0.0 | 100.2 | 51228 | 14.88 | 56.10 | 22.3 | 100% | 3.8 | 31.7 | **166** |

**★** = lower mean cost than the baseline (static or hidden-hazard walk) with 0 hard-constraint violations and no loss of success rate. **⚡** = equal cost (within 1%) at >=2x lower p50 latency, same safety. Violations (slope > 20 deg, blocked cells, broken paths) must be 0; a planner with any is ranked last and can never merge. Rough = cells with roughness > 0.5 m. Memory is a heap+ArrayBuffer delta measured around the search call (an estimate, noisy without forced GC). The baseline's own gap should be ~0 by construction.
