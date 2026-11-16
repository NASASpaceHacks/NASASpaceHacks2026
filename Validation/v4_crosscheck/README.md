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

## Results (24 walks; re-run 2026-11-14 after the radio-relay fix)
Radio coverage is the union of every masted shelter (habitat mast and rover relays), whichever one is the EVA base (engine commit f6b47dd). The packets list these masts in `radio_masts`. See `summary.json` and `results.csv`. Headline:
- Verdict agreement engine vs independent: **23/24** (95.8 %). GO walks 12/12 agree (no engine GO that the checker rejects). NO-GO walks 11/12 agree.
- Pass/fail agreement on the rules that do not depend on heat rests (slope, radius, keep-out, shelter minutes): 96/96.
- Own LOS vs engine viewshed on the packet rows: 2.5 % of 2625 rows differ (ray-method effect: nearest-cell sweep vs bilinear rays plus curvature).
- Engine's primary (dropped) rule is among the checker's failing rules in 7/12 NO-GO walks with the checker as specified (no heat rests); 11/12 with the diagnostic rest-scaled variant. The rest agree in verdict but name different primary rules, because the engine's walking times include heat rests that push EVA duration and walk-back over the limit.

### The one disagreement: W02 (engine NO-GO; checker GO; AI GO)
- PR-1 to a random cell 762 m away, start 09:40. The engine drops it for the radio-gap rule, 0.22 min over the 10-min limit.
- The engine judged **its own heat-aware route**. For NO-GO walks the packet shows the **plain shortest-time path** (`route_source: path_search`), which stays within the limit (8.9 min longest gap). The engine's own simulator confirms that path passes (`candidate_eval.pass: true` in `engine_verdicts.json`).
- So a valid path existed that the engine did not try. It picks the cheapest path and then checks every rule; it does not yet search for a different path that stays in radio contact. The error is on the safe side: a NO-GO that a slightly different path would fix, never a GO that breaks a rule. Fix (backlog): also evaluate the shortest-time path before declaring NO-GO, or add radio-aware routing.

## Honest caveats
- 24 walks, one site, one date; 12 GO were chosen to span distances, so the "12/12 GO agreement" is evidence of no false GO among 12, not a proof (with 12 clean samples the 95 % upper bound on the false-GO rate is about 22 %).
- NO-GO selection is stratified by the engine's reason, so rule coverage is balanced rather than natural. No walk fails slope, keep-out, or heat; the daylight cases use a late start (15:00).
- For NO-GO walks the candidate route is not what the engine would fly; the checker judges it as a route, so the "failing rule" comparison uses the engine's `evaluateOrder` list on the same route.
- The checker's out-of-LOS accounting and LOS rays are our own discretisation; walks within about 1 min of the 10 min limit would be genuinely ambiguous (none were: closest margins are in `results.csv`).
- AI judges: batch 1 = W01-W12, batch 2 = W13-W24.

## Three-way result (engine · independent checker · blind AI judges)
| Comparison | Same GO/NO-GO verdict | Engine's failing rule also named (12 NO-GO walks) |
|---|---|---|
| Engine vs blind Claude AI judges (2 judges × 12 walks, engine verdicts hidden) | **23/24** | **11/11** of the NO-GO walks both call NO-GO |
| Engine vs independent Python checker (no engine code) | **23/24** | 7/12 |
| All three agree | **23/24** | |

- The only disagreement is W02 (above): the AI judges and the checker both read the packet's shortest-time path, which passes; the engine judged its heat-aware route, which fails by 0.2 min. Safe-side.
- The AI judges read only `ai_judge_instructions.md` and the per-step packets. The packets include engine-derived per-step times (with heat rests), line of sight and shelter minutes, so this checks that the **rules are applied correctly** to the evidence. It is not an independent check of the physical models.
- The independent checker recomputes slope, edge grade, distance, **line of sight (own ray casting)** and a simple walking time from the raw DEM. It agrees on every engine GO. It has **no suit-heat model**, so it names fewer of the time-based failures (EVA duration, daylight).
- Together: geometry and line of sight are confirmed independently, and the engine's rule logic is confirmed by blind review. The remaining model assumptions (metabolic model, heat budget) are covered by `v2_metabolic` and stated as limitations.
- Previous run (before the radio-relay fix, engine 44ffa9e): AI 24/24, checker 22/24. The fix changed which walks were sampled.
- Files: `ai_judge_batch1.json`, `ai_judge_batch2.json`, `three_way.py` → `three_way_summary.json`.
