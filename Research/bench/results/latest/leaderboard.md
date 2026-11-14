# Marswalk planner leaderboard

Site `mock-412`, 50 static + 50 hidden-hazard scenarios, seed 1.
All paths are scored under judge cost model `ref-slope`; optimality gap is vs an independent Dijkstra oracle on the fully known map. Baseline: `ref-dijkstra` x `ref-slope`.

| # | Planner | Cost model | Static gap % (mean/max) | Cost s | Length m | Max slope | Rough % | Turns | Expanded | p50 ms | p95 ms | Mem MB | Hazard success | Replans | Extra dist m | Violations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ref-dijkstra | ref-slope | 0.000 / 0.000 | 4486.5 | 1943 | 4.4 | 0.0 | 67.9 | 298930 | 96.64 | 201.59 | 26.2 | 100% | 6.9 | 8.9 | 0 |
| 2 | wastar-1.5 | ref-slope | 4.583 / 10.248 | 4698.0 | 1946 | 5.1 | 0.0 | 18.3 | 3158 | 6.26 | 10.09 | 25.5 | 100% | 1.5 | 7.3 | 0 |

**★** = lower mean cost than the baseline (static or hidden-hazard walk) with 0 hard-constraint violations and no loss of success rate. **⚡** = equal cost (within 1%) at >=2x lower p50 latency, same safety. Violations (slope > 20 deg, blocked cells, broken paths) must be 0; a planner with any is ranked last and can never merge. Rough = cells with roughness > 0.5 m. Memory is a heap+ArrayBuffer delta measured around the search call (an estimate, noisy without forced GC). The baseline's own gap should be ~0 by construction.
