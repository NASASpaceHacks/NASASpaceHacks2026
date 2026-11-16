# Marswalk scorecard (mock Space Apps judge)

## 2026-11-14 baseline — overall 45/60 (Δ vs last: n/a, first entry)
Judged from docs, `Validation/numbers.json` and `Validation/v3_impact/README.md`, `Research/bench/results/latest/leaderboard.md`, and screenshots in `qa/screens/ux6/` (layers-panel, nogo-options), `Frontend/UserView/docs/gale-03-nav.png`, plus `qa/ux-audit.md`. I did not run the app.

| # | Criterion | Score | Evidence | What would make it a 5 |
|---|---|---|---|---|
| 1 | Impact | 3 | Impact is quantified in `Validation/v3_impact`, but its own README says "no optimality advantage was measured": Marswalk equals nearest-first-with-checks on science value in 200/200 scenarios. The 99.5% "naive violates rules" figure is against a strawman the README itself calls one. The Hab-1 finding (suit cooling limits range, so stage from the rover) is the real insight (`ux6/nogo-options.png`). No second site, no Moon demo. | Lead with the insight, not the 99.5%. Add Jezero. Show a case where exact selection beats nearest-first, or say plainly that the value is the safety check plus speed. |
| 2 | Creativity | 4 | Suit energy and heat model plus 12 NASA flight rules as hard checks, NO-GO with "Closest safe point", habitat-to-visor link with autonomy. The differentiation table in `docs/JUDGING.md` §4 is credible. The Google-Maps-style interaction is polished (`qa/ux-audit.md`). | A live side-by-side where a conventional slope A* plan fails in front of the judges. |
| 3 | Scientifically and technically sound | 4 | A* gap 0.000% against an oracle (`leaderboard.md`); the slope-only planners have 140-166 violations. V1 MAE 1.98 pp over 15 comparisons, but the metric definition was "chosen post hoc among 3" and the largest miss is 12 pp. V2 MAPE 20.8% overall, 10.6% only at 0.22-0.32 g, -36% error at 0.12-0.17 g, and 0.38 g is extrapolated. The wording "reproduces/calibrated" is honest. | Out-of-sample validation at 0.38 g or against another suit dataset. Replace post-hoc metric choice with a pre-declared one. |
| 4 | Credible data | 4 | The layers panel names the mission, instrument and resolution for each layer (`ux6/layers-panel.png`: MRO HiRISE 0.25 m, THEMIS 100 m). Computed layers are separated from data and tagged INDICATIVE. The SCENARIO tag is visible. One 5x5 km site. Station science values are a team heuristic (v3 README). | Show the DONKI forecast and Curiosity photo provenance in one visible frame; document the STM scoring rationale (already a human task). |
| 5 | Belief | 4 | Substantial: validation folders with CSVs and scripts, a benchmark, unit and e2e tests, honest caveats. Missing: no public demo link, so global judges can't try it. The docs say G9 is not done. | A public no-login demo and a short real screen recording. |
| 6 | Feasible, functional, practical | 4 | Plan p50 38 ms and replan p50 8.5 ms (v3); an 11 KB route. The UI works (ux3/ux5/ux6 screens). Known weak points: `qa/e2e/demo-flow.spec.ts` is stale (BACKLOG), and the audit found 1 Blocker and 9 Major issues (since fixed per the audit). Only one site. "1.7 s plan" in JUDGING.md disagrees with the 38 ms measured, so the numbers need reconciling. | A second site and a public static build. Reconcile the timing numbers everywhere. |
| 7 | Relevance | 5 | Hyperlocal EVA scale, Mount Sharp boxwork, plan and carry out. This is exactly the gap the challenge names. | — |
| 8 | Meets challenge requirements | 4 | At least 3 kinds of data (imagery, elevation/slope/roughness, thermal, lighting, radio coverage). Radiation and space weather exist as models, but I did not see a radiation or space-weather layer in the layers panel (it shows 0/3 colour layers and a safety analysis section). Suit mobility and obstacles: yes. Route map: yes. POV imagery: claimed (station cards), unseen by me in the latest screens. | Make radiation, space weather and POV photos visible in the main console flow, not only in docs and Details. |
| 9 | Problem, solution, importance | 4 | The 20-second version in `docs/JUDGING.md` §1 is clear. The product screen shows the verdict (NO-GO) and the reason. The pitch is a draft with [verify] flags. | A rehearsed version and a one-line product name. |
| 10 | Shows which NASA data is used | 3 | The Data badge, Sources panel and layer credits exist in the app. There is no data slide or video frame yet (JUDGING.md "Later", G7). | One data slide and one video frame: missions, layers, where they appear. |
| 11 | Acknowledges AI use and sources | 4 | The README has a disclosure; there are citations (NTRS numbers) throughout. The project page is a draft. | Repeat on the project page and final slide, with a full citation list. |
| 12 | Equal attention to presentation and technical | 2 | The product UI and visor look strong (`gale-03-nav.png`, `ux6`). But the pitch is a v0 draft with unverified numbers, there is no video, and `WIN_PLAN` items 5 and 7 are not started. The visor's look does not yet match the console. Technical depth far exceeds the presentation. | A finished 30 s video, a 7-slide deck, a rehearsed 4-minute pitch, and a visor restyle. |

### Overclaims and inconsistencies to fix now
- "Never gives an unsafe plan" rests on the team's own simulator and rule set; say "never violates the 12 encoded rules".
- "99.5% of naive plans break flight rules" (WIN_PLAN) is a strawman result; the v3 README says so. Don't headline it.
- WIN_PLAN still lists the oversubscribed test as "to run", but `Validation/v3_impact/summary_oversub.json` exists. Update the docs.
- Timings disagree (1.7 s in JUDGING.md vs 38 ms p50 in v3).
- Real Gale terrain is shown while the habitat, rover and sol are scenario placements. The app tags this, which is good.

### Top 5 fixes by points gained per hour
1. Public no-login demo link (criteria 5, 6, 8; about +3 points).
2. Finished 30 s video, a data-sources frame and a rehearsed pitch, with numbers verified (10, 12, 9; about +3).
3. Reframe impact honestly and add a case where exact selection beats nearest-first (or drop that claim); fix doc inconsistencies (1, 3, 5; about +2).
4. Surface radiation, space weather and POV photos in the main console flow (8; +1).
5. Jezero second site, or explicit "site-agnostic pipeline" wording (1, 6; +1 to +2).

### 10 hardest questions a judge will ask (can the team answer with proof today?)
1. Your own benchmark shows no better stops than nearest-first. What does Marswalk add? — partly (the safety check and speed are documented; no quality gain).
2. Is the 99.5% unsafe-naive figure a fair comparison? — partly (the README admits it is a strawman).
3. How do you validate the walking model at 0.38 g? — no (extrapolation, said openly).
4. Radiation: you chose the metric definition after seeing results. Why trust it? — partly.
5. Are the station science values real priorities? — partly (a team heuristic, with STM citations).
6. Why does the habitat plan fail, and is that a bug? — yes (physics, with the DRA 5.0 backing).
7. What is real and what is scenario? — yes (the SCENARIO tag and Sources panel).
8. Does it work anywhere other than Gale? — no (one site pack).
9. What happens when the link drops? — yes (autonomy timing in `qa/screens/timings.json`).
10. Which parts did AI write, and which did you? — yes (README disclosure), but each teammate must rehearse an answer.

## 2026-11-14 checkpoint 2 (commit 6d4e595) — overall 50/60 (Δ vs last: +5)
Judged from `docs/CRITERIA_ANSWERS.md`, the three research docs, `Validation/numbers.json` (v1-v5), `v3_impact/heat_sensitivity.json`, the v4 and v5 READMEs, `Shared/src/contracts/rules.ts`, `docs/pitch/PITCH.md`, and screenshots `qa/screens/ux7`, `ux8` (report-radiation, crism-layer, crism-station, weather-gale) and `visor2` (03-nav, 04-station). I curled `/api/sitepacks` (gale-v1 and jezero-v1 both `available`). I did not drive the app. Spot-checks: every number I compared in CRITERIA_ANSWERS matches numbers.json (99.5%, plan p50 37.9 ms, replan p50 8.3 ms / p95 19.8, +5% / 62.5% oversubscribed, V1 MAE 1.98, V2 10.6% / 36%, 23/24 three-way). `rules.ts` has 12 rule ids and each carries a citation (NTRS numbers, ConOps EVA-EXP-0042). The "7 radio / 2 shelter / 3 radius" Hab-1 breakdown matches `heat_sensitivity.json`.

| # | Criterion | Score | Evidence | What would make it a 5 |
|---|---|---|---|---|
| 1 | Impact | 4 | Now honest and sourced: NASA's own need quotes, the oversubscribed result (+5% mean, never lower, 62.5% better, `numbers.json` v3.oversubscribed), Hab-1 decomposed into four limits that survive unlimited cooling (`heat_sensitivity.json`), Jezero runs. The text still says "no published baseline, so we don't claim hours saved". Still simulation only, and the headline 99.5% is still a strawman (v3 README line 21), now repeated in the "Say it" of Big answer 2. | Drop 99.5% from the spoken line (lead with the Hab-1 result and the +5%), or add one human-baseline comparison, even a single astronaut-trainer or analog-scientist review of the plans. |
| 2 | Creativity | 4 | `existing-solutions.md` and the 8-row table in CRITERIA_ANSWERS name AEGIS, SEXTANT, MoonPath, Mars Trek, and what each does better. The claim is "the combination", which is defensible. The re-verified rules, explained NO-GO and crew-side handoff are real. | A short live A/B where a conventional slope A* plan fails against Marswalk in front of the judges. |
| 3 | Scientifically and technically sound | 4 | V5 compares the dose with measured RAD (198.8 vs 207.8 µGy/day, -4%) and the README is candid. But that is not an independent test: the Guo 2015 fit being compared was fitted on the same 2012-13 RAD data, and the shipped constant (P_ref 910 Pa, Φ 600) gives 192 vs 210 (-9%) in the Ls 240 window. V5 also failed to reproduce the published barometric coefficient (-0.066 vs -0.13). V1 metric still post hoc. V2 still extrapolates at 0.38 g. V4 is 23/24 and says so. | Check the dose model out of sample (sol 4180: 167 measured vs 192 modelled) with an epoch-dependent Φ; pre-declare the V1 metric; add suited data near 0.38 g. |
| 4 | Credible data | 5 | Product IDs, resolution and sha256 in the manifest; DEM checked against 372 Curiosity positions (σ 0.19 m) and 220 Perseverance positions (σ 0.07 m); CRISM co-registration shift documented (`crism-layer.png` shows the id `frt000058a3_07_sr185j_mtr3`, 18 m, "INDICATIVE"); REMS "latest reading, not the scenario sol" is labelled on screen (`weather-gale.png`); the dose card shows "Terrain shields 8.6%... Indicative" (`report-radiation.png`). Remaining limits are labelled. Caveat: the visor demo runs on synthetic terrain (below). | — |
| 5 | Belief | 4 | Five validation folders with scripts and CSVs, a three-way check, commit history, honest limits written down. Still no public no-login demo, and `docs/pitch/PITCH.md` is v0. I could not run the tests (the "122 unit + 26 real-input tests" count is the team's, unverified by me). | Public demo link plus a screen recording. |
| 6 | Feasible, functional, practical | 4 | 38 ms plan, 8 ms replan, 11 KB route, two Mars sites live on the server. The visor shows a nominal flow (`visor2/03-nav.png`, `04-station.png`). Limits: visor is a screen UI; the visor demo is not on the real site pack (see overclaims). | Visor run on the real gale-v1 pack, plus a public build. |
| 7 | Relevance | 5 | Hyperlocal plan-and-carry-out on Mount Sharp boxwork, with science targets from the actual campaign. | — |
| 8 | Meets challenge requirements | 5 | Now visible in the console: imagery, DEM/slope/roughness, THEMIS, CRISM spectral, lighting, radio (≥3 kinds, `crism-layer.png`); radiation dose with terrain shielding in the Report (`report-radiation.png`); DONKI three-tier forecast and REMS weather in "Weather & radiation" (`weather-gale.png`); suit heat budget at 0.0 W margin; route and obstacles; POV photo thumbnail on the station card (`crism-station.png`). | — |
| 9 | Problem, solution, importance | 4 | The 20-second answer in CRITERIA_ANSWERS is crisp. Product screens show a verdict plus the limiting factor. But `docs/pitch/PITCH.md` still says "draft v0... [verify]" and quotes numbers (route ~6 KB, "under one second") that disagree with the measured 11 KB / 8 ms. | A final, rehearsed script with every [verify] cleared. |
| 10 | Shows which NASA data is used | 4 | The dataset table with mission, use, how checked and depth (CRITERIA_ANSWERS Big answer 5), plus the Layers panel credit lines and the Sources tab. It is a strong answer, but it lives in a doc: no data slide or video frame has been shown. | One data slide / video frame built from that table. |
| 11 | Acknowledges AI use and sources | 4 | The README disclosure plus an explicit statement that AI is outside the safety path; every dataset and rule is cited. The project page is still a draft. | Repeat on the project page and final slide. |
| 12 | Equal attention to presentation and technical | 3 | The visor is restyled into the console's look (`visor2/*`); both UIs are polished. But there is still no video, no slide deck, and the pitch is v0 with stale numbers. The technical side is far ahead. | A 30 s video, a 7-slide deck, a rehearsed pitch. |

### Overclaims and inconsistencies still present
- **Visor is not on real data.** `visor2/03-nav.png` states "TERRAIN: SYNTHETIC - NOT REAL MARS DATA", and its stations (ST03 "Butte flank", ST10) differ from the console's Curiosity targets. `04-station.png` says "NO ROVER IMAGE FOR THIS STATION IN THE SITE PACK". CRITERIA_ANSWERS row 8 says "Real Curiosity/Perseverance photo at each stop, on console and visor", and row 6 implies the visor carries the real route. That is true for the console only, as far as I saw. Fix the wording or put the visor on gale-v1.
- "Dose within 4% of Curiosity's measured RAD dose" is presented as a check ("Checked against NASA data"). It is in-sample against the data the Guo fit came from, at the measured year-1 pressure, not at the shipped constants (192 vs 210, -9%). Say "reproduces the year-1 mean, route doses ±30%, epoch-dependent".
- 99.5% against a slope-only straw plan remains the spoken headline of Big answer 2, while the v3 README calls it a strawman. The "Say it" line should lead with the Hab-1 result.
- "Dose checked against measured data" omits that V5 did not reproduce the published diurnal coefficient.
- DONKI counts: CRITERIA says "33 events in the pack", the Weather tab shows 31 runs / 27 distinct. Reconcile.
- The pitch (`docs/pitch/PITCH.md`) numbers (route ~6 KB, "under one second") disagree with the engine numbers (11 KB, 8 ms).
- "Never gives an unsafe plan" is now appropriately worded as "12 encoded constraints" in the rules block, but "never an unsafe plan" survives in the gap-5 row of Big answer 4. Remove it.

### Top 5 fixes by points gained per hour
1. Finish the presentation block: 30 s video, 7 slides, rehearsed pitch with the [verify] numbers replaced from `numbers.json` (criteria 9, 10, 12; about +3).
2. Publish the no-login demo link (5, 6; +1 to +2).
3. Put the visor on the real gale-v1 pack, with the station photo, or label it as a mock everywhere (6, 4, 8; +1, and removes the biggest honesty risk).
4. Lead impact with the Hab-1 result and drop 99.5% from spoken lines; fix the in-sample wording of V5 (1, 3; +1).
5. Out-of-sample dose check with an epoch-dependent Φ (3; +0.5 to +1).

### 10 hardest questions a judge will ask (can the team answer with proof today?)
1. Your selection equals nearest-first in the base set. What does Marswalk add? — yes (the safety rules decide; +5% when oversubscribed; stated in CRITERIA_ANSWERS).
2. Is 99.5% a fair comparison? — partly (README admits strawman; the spoken line still leads with it).
3. Your dose model matches measured data. Isn't that fitted to the same data? — partly (V5 states the limits, but the answer sheet says "within 4%" without "in-sample").
4. How is the walking model checked at 0.38 g? — no (extrapolation, openly stated).
5. Are the science values real priorities? — partly (a heuristic traced to the boxwork campaign).
6. Why does a walk from the habitat fail; is it just your heat model? — yes (`heat_sensitivity.json`: 4 limits, survives unlimited cooling).
7. Does the engine call a safe walk NO-GO? — yes, W02 documented (0.2 min over; safe side).
8. Does it work elsewhere than Gale? — yes (jezero-v1 loads; DEM σ 0.07 m) but only the terrain/engine, not the science list's depth.
9. Is the visor really using real terrain and photos? — no (synthetic terrain label, no rover image in the visor screens).
10. Which parts did AI write? — yes (README plus drafted answer; each teammate must rehearse it).
