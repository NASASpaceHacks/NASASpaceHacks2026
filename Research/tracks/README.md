# Research tracks: briefs for the five teammates

Read first: `docs/AGENTS.md`, `docs/designs/marswalk.md` (sections 7, 11), `Research/planners/README.md`, `Research/deep-research-report.md`.

**How your work plugs in.** The engine runs `PathSearch` (graph search) over a `CostGrid` using a `CostModel` (edge cost in seconds, `Infinity` if impassable). Both interfaces are in `Shared/src/contracts/types.ts` (frozen; do not edit). Copy `Research/planners/example-weighted-astar.ts`, put your file in `Research/planners/`, register with `registerPathSearch` / `registerCostModel` (`Shared/src/engine/registry`), and `export default` it.

**How results are judged (all tracks).** `pnpm bench` (also `--site gale-v1 --scenarios 50 --seed 1`). A result replaces the baseline only if it (1) is a star in the leaderboard (lower mean cost than baseline, static or hidden-hazard, without losing success rate) AND (2) has **0 hard-constraint violations** on both site packs (and later passes the X1 constraint hunter). Latency-only wins need team sign-off. Switching is `MARSWALK_PATH_SEARCH=<id>` / `MARSWALK_COST_MODEL=<id>`. Wording: say "calibrated" or "reproduces", never "validated". Cite every constant.

**Checkpoints (all tracks).** H6: a first working file that loads and runs in `pnpm bench` on the mock site, plus a one-page note of what you will try. H12: runs on `gale-v1`, first leaderboard numbers, 0 violations. H16: final result, a short write-up (what won, what did not, honest limitations), a number or chart for the pitch.

Paper links below come from `Research/deep-research-report.md` unless marked (added). Check each link opens before quoting it. Items marked (unverified) are suggestions I did not open.

---

## R-A Search algorithms
**Goal.** Beat the Dijkstra/A* baselines on mean route cost, expanded nodes and latency, and show incremental replanning when an astronaut reports a hazard (the demo "re-route" moment), with smoother any-angle paths.

**Implement.** `PathSearch` ids, each in `Research/planners/`:
1. `weighted-astar` (heuristicWeight >= 1; report the optimality gap against the Dijkstra oracle).
2. `dstar-lite` using `update(changed: Cell[])`; the bench calls it on every hazard reveal and then `search` from the walker's current cell.
3. `theta-star` or `field-dstar` (any-angle). Your result must still be 8-connected `cells`, never enter `grid.blocked`, include start and goal.

**Papers.**
- Carsten, Rankin, Ferguson, Stentz 2009, Field D* on the MER rovers, https://doi.org/10.1002/rob.20287
- Hedrick, Ohi, Gu 2020, terrain-aware planning and map update, https://doi.org/10.1109/LRA.2020.3005123
- Daftry et al. 2022, MLNav (ML orders candidate checks; geometry keeps safety), https://doi.org/10.1109/LRA.2022.3156654
- Toupet et al. 2025, ENav on Perseverance, https://doi.org/10.1109/TFR.2025.3636366
- Koenig and Likhachev 2002, D* Lite, AAAI (added, unverified link; search the title).
- Daniel, Nash, Koenig, Felner 2010, Theta*: any-angle path planning on grids, JAIR 39 (added, unverified).
- Ferguson and Stentz 2006, Using interpolation to improve path planning: the Field D* algorithm, Journal of Field Robotics 23(2) (added, unverified).

**Judged by.** Hazard scenario: extra distance and success rate after replans; static: optimality gap and latency p50/p95 vs `dijkstra` and `astar`. Any-angle paths must not cut corners through blocked cells (violation counts).

**Pitfalls.** Heuristic must be admissible for the cost units (seconds), or label the planner as weighted. Do not mutate the grid. Keep the engine pure (no DOM, no Node-only APIs).

---

## R-B Cost and risk models
**Goal.** A `CostModel` that is more honest about uncertain terrain than the baseline `pandolf-santee-mars`: risk-aware (CVaR), class-aware, and with a human fall-risk term. It is judged on the same ruler, so a model that is merely different will not win.

**Implement.** `CostModel` (`edgeCost`, optional `edgePowerW`) in `Research/planners/`. Proposals, in order of value:
1. **CVaR slip/risk cost.** Replace a point slope penalty with a risk quantile of an uncertain cost, following Endo et al. 2023. Reuse their MIT code (https://github.com/omron-sinicx/safe-rover-navi) for the CVaR formulation; you do not need their learned models for a first version. Uncertainty source on our grid: DEM slope error, roughness, and thermal inertia (`ti.bin`) as a soil cue.
2. **Terrain classes.** AI4Mars (https://data.nasa.gov/dataset/ai4mars-a-dataset-for-terrain-aware-autonomous-driving-on-mars) labels soil, bedrock, sand, big rock from Curiosity images. Use it as a prior for a class-dependent cost multiplier. NASA's portal says "License not specified"; do not redistribute the data in the repo.
3. **Human fall risk vs slope and roughness.** Suited-walker data: Norcross et al. 2010 NASA/TP-2010-216125 (metabolic data to 30% grade, about 16.7 degrees). Treat fall risk as a team model; label it an assumption unless you find a source.

**Papers.**
- Endo, Taniai, Yonetani, Ishigami 2023, https://doi.org/10.1109/ICRA48891.2023.10161466 (PDF https://taniai.space/projects/safe-rover-navi/icra23-paper-copyright.pdf)
- Hedrick and Gu 2021, terrain-aware traverse planning, https://doi.org/10.1080/01691864.2021.1955000
- Sakayori and Ishigami 2021, energy-aware planning, https://doi.org/10.1080/01691864.2021.1959396
- Rockafellar and Uryasev 2000, Optimization of conditional value-at-risk, Journal of Risk 2(3) (added, unverified).

**Judged by.** Mean cost under the judge model, rough-terrain %, hard violations (slope > 20 degrees, blocked cells) = 0. A risk-averse model should show a clearly lower worst-case (max slope, rough %) at a small mean-cost price; show both numbers.

**Pitfalls.** Calibrate constants against cited data, cite them in code comments, never call it "validated". Terrain is never a "shelter".

---

## R-C Science value
**Goal.** Make the station scores defensible, and make the planner's station selection science-aware: what to visit, in what order, within the constraints.

**Deliverables (inputs already drafted in `Content/`).**
- Review and re-score `Content/stm.yaml` and `Content/stations.gale.json` (12 stations, coordinates from Curiosity waypoints at the blog sols). Check each blog claim; fix any overreach. Look for CheMin/SAM results for the boxwork drill holes (Altadena, Valle de la Luna, Nevado Sajama) and tie station values to them only if published.
- Add reasons a station is dropped in plain words (the UI shows "St 7 dropped: walkback, -18 min"); the STM objective id is what the UI shows.
- Propose a selection rule: prize collecting / orienteering with value, dwell time and the shelter/walkback constraints. Compare a greedy value-per-minute rule with an exact/DP result on the 12 stations (small enough to enumerate).

**Papers.**
- Candela and Wettergreen 2022, science and risk-aware planetary rover exploration, https://doi.org/10.1109/LRA.2022.3191949
- Fink et al. 2019, multi-objective Dijkstra traverse planning on Gale terrain, https://doi.org/10.1016/j.pss.2019.104707
- Caswell et al. 2025, "conflicts arise between science priorities and the achievable route", NTRS 20250006063.
- Curiosity blog posts cited per station in `Content/stations.gale.json`.

**Judged by.** Every station value traceable to an objective with a citation; the leaderboard of marginal value (value gained per extra minute) matches what a geologist would choose in the three demo scenarios; the optimizer's total value is within a stated gap of the exhaustive optimum.

**Pitfalls.** Do not present team scores as NASA rankings. Station coordinates are rover positions, good to roughly 10-20 m. Thola's classification as a meteorite is unconfirmed.

---

## R-D Story
**Goal.** A 4-minute live pitch, a 30-second video (over 30 s is disqualified), and a project page that make a NASA SME trust the work in under a minute.

**Deliverables (drafts exist).**
- `docs/pitch/PITCH.md`: script with timings, quotes, three demo moments. Rehearse with a stopwatch. Cut, do not speed up.
- 30 s video script (in `PITCH.md`): shoot or render from real recordings of the app and real NASA imagery only; no NASA logos; use the Space Apps brand assets.
- `docs/pitch/PROJECT_PAGE.md`: project page fields. Fill in repo link, video link, team names.
- Product name and logo: the team picks the final name (currently "Marswalk (working name)").

**Sources.** Design doc sections 2, 3, 14. Quotes with NTRS ids are in `docs/pitch/PITCH.md`; check each against the NTRS PDF before the pitch.

**Judged by.** The Space Apps criteria: Impact, Creativity, Validity, Relevance, Presentation (1-5 each). Validity is where honest limits and "reproduces / calibrated" wording pay off.

**Pitfalls.** No numbers on a slide that are not in `numbers.json` or the design doc; no invented quotes; disclose AI use.
