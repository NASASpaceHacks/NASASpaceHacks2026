# v3: quantified impact (Marswalk vs. two baselines)

Run: `pnpm tsx Validation/v3_impact/run.ts` (about 3 min) then `python3 Validation/make_numbers.py`. Outputs: `results.csv` (one row per scenario), `summary.json`.

## Method
Real `SitePacks/gale-v1` terrain, default hard rules and crew. Seeded (20260) scenarios: random 3-6 of the 12 manifest stations as candidate targets, start time uniform 08:00-11:00 LTST (sol 412, which has no REMS record, so the engine's assumed Ls 240 is used).
- Set PR1: 200 scenarios, EVA base staged at PR-1 (`stageFromShelter`). Set HAB1: 60 scenarios from Hab-1.
- A. Marswalk: `plan()`.
- B. Nearest-first with the same safety rules: from the base, repeatedly add the feasible unvisited target with the shortest walking leg (engine cost model, heat rests included); a target is added only if the whole plan including the return passes every hard rule in the engine simulator (new export `evaluateOrder` / `makeOrderEvaluator`). If the nearest fails, the next nearest is tried (a generous baseline).
- C. Naive slope-only: all requested targets, nearest-first by the `ref-slope` cost on a slope <= 20 deg grid (no walkback, shelter, heat, comm, daylight, keep-out awareness), then the resulting cell paths are checked by the same simulator. Also counted: edges with grade > 20 deg on the DEM.

## Results (PR1, n=200)
- Marswalk OK in 196, STAY_IN in 4. Mean science value A = B = 181.3.
- Science ratio A/B: mean 1.00, median 1.00. A > B in 0%, A == B in 100%, A < B in 0%. Same station set in 200/200 (same order in 133/200).
- C violates >= 1 hard rule in 99.5% (199/200); 75% contain at least one edge steeper than 20 deg. Per rule (plans): comm LOS gap 187, walkback 182, shelter time 182, EVA duration 182, daylight 169, walk radius 158, slope/blocked-cell 150, edge grade > 20 deg 150. Keep-out: 0.
- Marswalk plan() solveMs p50 38.5, p95 71.7 (max 1386, first call cold cache); replan (resume after first stop) p50 8.5, p95 18.2 ms (196 replans).
- HAB1 (n=60): STAY_IN in 60/60 (the Hab-1 geometry cannot satisfy the shelter/walkback/radius rules for these stations); nearest-first also finds nothing; the naive plan breaks rules in 60/60. plan() solveMs p50 65, p95 125.

## Honest caveats
- No optimality advantage was measured. Because B reuses Marswalk's own safety checker, and the real limits are tight (most plans have only 1-3 stations), nearest-first-with-checks picks the same stations. The measured value of Marswalk here is the safety check plus speed, not better stop selection. Larger gains from exact selection may exist with more stations or looser limits; not measured.
- C is a strawman by construction: it visits every requested target and ignores everything but slope, so near-100% violation is expected. It shows what an unchecked plan does, not what a careful human does. A human who eyeballs distances would sit between B and C; B assumes a perfect rule check that humans do not have.
- Science values are the team's STM heuristic, not mission data. Scenario subsets and start times are synthetic. Ls is assumed (240). Violation counts are per plan (one plan can break many rules); the simulator reports blocked/keep-out cells as the slope rule.
- Timing is Node on one laptop, warm caches.

## Manual planning time reference
No published figure found for hours of manual EVA traverse planning per EVA. Only lead times: D-RATS 2010 planning began about 12 months before the field test (https://ui.adsabs.harvard.edu/abs/2013AcAau..90..254H/abstract); BASALT traverse targets (2-3 per EVA) were chosen months ahead by the science team from satellite imagery (https://pmc.ncbi.nlm.nih.gov/articles/PMC6442258). These are strategic lead times, not per-EVA replanning durations.

## Oversubscribed family (G4b)
Run: `pnpm tsx Validation/v3_impact/run_oversub.ts` (about 1 min). Outputs: `results_oversub.csv`, `summary_oversub.json`.

Why: the first family (3-6 targets, full EVA) is not oversubscribed, so A == B there. Real EVAs usually have more science wanted than time (Caswell et al. 2025, NTRS 20250006063).

### Method
Same pack, rules, crew, base PR-1 (`stageFromShelter`), sol 412 (assumed Ls 240). 200 scenarios, seed 20261. Candidates: all 12 gale-v1 stations. Start time uniform 08:00-11:00 LTST. Available surface time drawn uniform 120-240 min and imposed with one `EVA_CUT` event. Engine arithmetic: nominal EVA 360 min minus 30 min egress/ingress = 330 surface min, so cut = 330 - available (a first attempt used 300 - available, which gave 150-270 min available; it was discarded and the run redone with the corrected formula before any analysis). A = `plan()`. B = nearest-first with the same hard-rule checker (`makeOrderEvaluator`), same as family 1. Reported EVA minutes include the 30 min egress/ingress.

### Results (n=200, all Marswalk OK, nearest-first never empty)
- Mean science value A 382.2 vs B 366.1. Ratio A/B: mean 1.050, median 1.011, min 1.000, max 1.306.
- A > B in 62.5%, equal in 37.5%, B > A in 0% (consistent with A being optimal under the engine's rules; no counterexample found).
- Stations visited: A 4.79 vs B 4.65 mean. EVA minutes used: A 196.9 vs B 185.2 mean.
- Solve time: A p50 105 ms / p95 125 ms; B (many evaluator calls) p50 3.7 / p95 7.7 ms (B's route matrix is built outside the timed loop, so B ms understates a cold start).

| Available min | n | mean A | mean B | ratio mean | ratio median | A>B | equal | B>A |
|---|---|---|---|---|---|---|---|---|
| 120-160 | 65 | 308.5 | 293.5 | 1.060 | 1.000 | 46% | 54% | 0% |
| 160-200 | 72 | 389.8 | 377.4 | 1.037 | 1.000 | 44% | 56% | 0% |
| 200-240 | 63 | 449.4 | 428.1 | 1.053 | 1.038 | 100% | 0% | 0% |

### Caveats
- Science values are the team's STM heuristic, not mission data; an "improvement" is in those units.
- Nearest-first-with-checks is a reasonable but generous human baseline (it has a perfect rule checker). It is not the only possible human strategy (e.g. highest-value-first).
- Gains are modest (mean +5%, median +1%) and concentrated in about 62% of cases; in the rest nearest-first is already optimal.
- Single site (Gale), single base (PR-1), synthetic start/time draws, assumed Ls, one seed. Solve time is Node on one laptop.
