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
