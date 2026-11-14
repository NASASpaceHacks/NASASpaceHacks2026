# Research planners

Drop a planner here, run `pnpm bench`, read the leaderboard. Everything else (orienteering, the time-stepped simulator, constraint checks) is fixed, so any planner that wins here is automatically safety-checked in the full plan.

## Add a planner
1. Copy `example-weighted-astar.ts` to `Research/planners/<name>.ts`.
2. Implement `PathSearch` (and/or `CostModel`) from `Shared/src/contracts/types.ts`:
   - `search(grid, costModel, ctx, start, goal, opts)` returns `{ cells, cost, expanded, ms }` or `null`. `cells` is 8-connected, includes start and goal, never enters `grid.blocked`.
   - Optional `update(changedCells)` for incremental replanning (D* Lite, Field D*). The bench calls it on every hazard reveal (`grid.blocked` is already updated), then calls `search` again from the walker's current cell. Without it the bench re-runs a full search.
   - A `CostModel` (`edgeCost`, seconds, `Infinity` if impassable) is automatically crossed with every PathSearch. Paths are always scored under the judge model (`pandolf-santee-mars` when the engine is present), so a different cost model competes on the same ruler.
3. Register on import: `registerPathSearch(p)` / `registerCostModel(c)` from `Shared/src/engine/registry`, and `export default` the object.
4. Run:
   ```
   pnpm bench                                   # mock site, 20 scenarios
   pnpm bench --site mock --scenarios 50 --seed 1
   pnpm bench --site gale-v1 --scenarios 50     # needs SitePacks/gale-v1/manifest.json
   ```
   Output: `Research/bench/results/<timestamp>/{runs.csv,summary.json,leaderboard.md}` and a copy in `results/latest/`.

## Scenarios and metrics
- **static**: random start/goal within 2 km of the hab on passable cells, scored against an independent Dijkstra oracle.
- **hazard**: three hazard blobs on the optimal route are hidden from the planner; a simulated walker follows the plan, senses hazards within 50 m, and replans on reveal.
- Metrics: length, cost (s), gain/loss, mean/max slope, rough-terrain %, turns/angle, optimality gap, expanded nodes, latency p50/p95, memory estimate, replans, extra distance, success rate, hard-constraint violations (slope > 20 deg, blocked cells, broken paths; must be 0).

## Merge rule
A research planner replaces the baseline only if it **wins on the agreed metrics (★ in the leaderboard: lower mean cost than baseline, static or hidden-hazard, without losing success rate) AND has 0 violations** on both site packs. The switch is then a one-line config change, no code edit:

```
MARSWALK_PATH_SEARCH=<id>      # optionally MARSWALK_COST_MODEL=<id>
```
Latency-only wins (⚡) are reported but need the team's sign-off.
