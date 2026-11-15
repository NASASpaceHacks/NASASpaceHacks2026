# X4: independent cross-check of the route engine's GO/NO-GO verdicts

Three judges look at the same 24 single-destination walks on `SitePacks/gale-v1`:
1. the engine (`Shared/src/engine`, via `plan()` and `evaluateOrder()`),
2. an independent checker written in Python from the rule text and raw rasters (`independent_check.py`),
3. AI judges that read a per-walk evidence packet blind (`ai_judge_instructions.md`; run later by the orchestrator, NOT run here).

## Files
- `make_packets.ts` (run `pnpm tsx Validation/v4_crosscheck/make_packets.ts`): samples walks, runs the engine, writes `packets/W01..W24.json`, `engine_verdicts.json`, `route_cells.json`.
- `independent_check.py` -> `independent_results.json`; `compare.py` -> `results.csv`, `summary.json`.
- Run: `Pipeline/.venv/bin/python -I Validation/v4_crosscheck/independent_check.py && Pipeline/.venv/bin/python -I Validation/v4_crosscheck/compare.py`

## Method
Walk set (seed 4242): 12 science-station cells x two bases plus about 400 random passable cells within 2.5 km of the base, base PR-1 (staged, ~80 %) or Hab-1, dwell from the pack (stations) or 15-30 min, start LTST from {480, 580 (x4), 660, 900}. Every candidate was planned with the engine (one station, `plan()`); 24 were selected: 12 GO + 12 NO-GO, NO-GO spread round-robin over the engine's failing rules (here: comm-LOS gap 3, walk radius 3, EVA duration 2, shelter time 2, daylight 2), 4 of the 24 start from Hab-1.
Candidate route: the engine's own route if GO; otherwise the fastest outbound and return path from the engine's `dijkstraSearch` on the engine's cost grid (so a NO-GO walk still has a concrete route that can be judged). The engine also re-simulated that route with `evaluateOrder` (same simulator as `plan()`), giving a full list of rules it breaks (`engine_all_rules_on_candidate`), in addition to the planner's primary dropped reason.
Packet: rules, crew, base/destination/shelters/masts (cell + lon/lat), start LTST, dwell, and <=120 rows of per-step data (cum distance, elevation, max cell slope and max step grade over the block, cum minutes incl. heat rests, in-LOS flag, out-of-LOS minutes, distance to base, minutes to shelter and back, sun elevation, metabolic W). The engine verdict is NOT in the packets. Block columns keep maxima so downsampling cannot hide a violation; LOS-transition rows are kept when they fit.

## Independence claims (and their limits)
- `independent_check.py` imports no engine code and ports none. It reads `manifest.json`, `dem.bin`, `slope.bin` with its own decoder (little-endian, raw*scale+offset), and the packet's rules/base/destination/start/dwell/mast/shelter cells.
- Everything it reports is recomputed: own Horn slope from the DEM (max difference from the shipped slope raster on routes: ~0.01 deg), own step grades, own distance to base, own radio LOS (rays sampled every 2.5 m with bilinear DEM, 3 m mast, 1.8 m observer, Mars curvature), own plume keep-out polygon test, own sun elevation (Ls 240 as the engine assumes for sol 412; obliquity 25.19 deg), own walking graph (scipy Dijkstra, 8-neighbours, cell slope and step grade <= 20 deg, 0.56 m/s on 3-D length) for shelter minutes and walk-back (half speed).
- NOT independent: the route cells (taken from the engine or its path search), the rule values and masts positions (from the packet), the sun model constants (same published Mars solar geometry), and the DEM/slope data itself (shared input). The checker therefore verifies the safety rules on a given route, not route optimality. The cell masks (slope > 20 deg blocked) mean the path search never produces a slope violation: no walk in this set fails on slope; the slope rule is only exercised by routes up to 19.97 deg.
- The checker deliberately omits the suit-heat governor (heat rests) and the heat-average rule; time-dependent rules (EVA duration, walk-back, LOS gap, daylight) therefore differ from the engine whenever the engine inserts rests. Those differences are labelled "model difference", not errors. Out-of-LOS minutes: an edge counts fully if both ends are out of LOS, half if one end, nothing if neither (lo/hi bounds are in `independent_results.json`).
- `diagnostic_rest_scaled` (in `independent_results.json`) re-runs the checker with walking times stretched uniformly to match the packet's total minutes (spreading rests evenly). It uses engine output and is diagnostic only, never the verdict.

## Results (24 walks)
See `summary.json` and `results.csv`. Headline:
- Verdict agreement engine vs independent: 22/24 (91.7 %). GO walks 12/12 agree (no engine GO that the checker rejects). NO-GO walks 10/12 agree.
- Pass/fail agreement on the rules that do not depend on heat rests (slope, radius, keep-out, shelter minutes): 96/96.
- Own LOS vs engine viewshed on the packet rows: 2.3 % of 2600 rows differ (ray-method effect: nearest-cell sweep vs bilinear rays plus curvature).
- Engine's primary (dropped) rule is among the checker's failing rules in 6/12 NO-GO walks with the checker as specified (no heat rests); 11/12 with the diagnostic rest-scaled variant. The remaining NO-GO walks agree in verdict but name different primary rules because the engine's candidate-route walking times include 25 to 290 min of heat rests (e.g. W01: 287 min on the engine's slope-heavy path-search route), which push EVA duration and walk-back over limit; without rests the checker sees only the LOS gap (and, for >2 km walks, radius/shelter) fail.

### Disagreements (both are engine NO-GO, checker GO)
- **W02** (PR-1 to ST07, start 08:00) and **W19** (PR-1, random cell, start 09:40): engine fails the LOS-gap rule (19.6 min and 28.7 min vs limit 10); checker finds 3.8 and 6.5 min. Cause: the engine's suit-heat governor inserts rests (34.6 and 78.1 min on the route) on a steep out-of-LOS stretch (W02 packet rows 26-45: about 1.3 min per 10 m instead of 0.3), and a rest out of sight counts toward the gap. Classified as heat-rest model difference: engine worst minus the engine's total rest minutes is below the limit in both walks. This is the intended engine behaviour (rule text: time without line of sight), not an engine bug. It does mean the checker is blind to a class of NO-GO that the heat model creates.
- No engine bug, no data-resolution-driven flip was found. Not tested: whether the engine's heat model itself is right (covered by the V2 metabolic validation).

## Honest caveats
- 24 walks, one site, one date; 12 GO were chosen to span distances, so the "12/12 GO agreement" is evidence of no false GO among 12, not a proof (with 12 clean samples the 95 % upper bound on the false-GO rate is about 22 %).
- NO-GO selection is stratified by the engine's reason, so rule coverage is balanced rather than natural. No walk fails slope, keep-out, or heat; the daylight cases use a late start (15:00).
- For NO-GO walks the candidate route is not what the engine would fly; the checker judges it as a route, so the "failing rule" comparison uses the engine's `evaluateOrder` list on the same route.
- The checker's out-of-LOS accounting and LOS rays are our own discretisation; walks within about 1 min of the 10 min limit would be genuinely ambiguous (none were: closest margins are in `results.csv`).
- AI-judge results are pending (orchestrator). Batch 1: W01-W12; batch 2: W13-W24 (6 GO + 6 NO-GO each).
