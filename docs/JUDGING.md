# Judging scorecard and defense prep

> **The current, research-backed answers are in `docs/CRITERIA_ANSWERS.md`** (uniqueness, impact, existing tools, gaps, NASA data depth, and "say this, not that"). Where this file differs, that file wins.

*Built from the organisers' briefing. Every criterion maps to our answer, the evidence that proves it, and what's still missing. Judges treat the presentation like a defense: we don't have to say everything up front, but we must be able to answer every question with proof.*

## 1. Problem, solution, importance (the 20-second version)
- **Problem.** The first Mars crews must plan and carry out surface walks without Mission Control: Earth is 3–22 light-minutes away and unreachable for about 2 weeks at solar conjunction. Mars Trek and the USGS geologic maps show regional and global views; nobody fuses the data at the hyperlocal scale of one spacewalk, and no public tool checks a walk against NASA's EVA constraints as hard limits and re-verifies it. The challenge says exactly this.
- **Solution.** Marswalk has three parts:
  1. A habitat console that plans a walk on a correct map of real Gale crater data from 5+ NASA missions. 12 constraints drawn from public NASA EVA documents (each cited) are hard checks; it explains its verdict and never hands out a plan that breaks one.
  2. A signed route of about 11 KB, pushed over the local surface link.
  3. A helmet visor that guides the astronaut, and still brings them home if the link drops.
- **Importance.** It turns NASA's own stated needs into a working tool. Those needs are "Earth independence… informed decisions upon locally sourced information" (NTRS 20230014957) and "integrate real-time EV data with traverse planning" (NTRS 20260001895). Safety comes first, with science maximised inside the rules.

## 2. Scorecard
| # | Criterion (organisers' words) | Our answer | Evidence (where to point) | Status |
|---|---|---|---|---|
| 1 | **Impact**: difference, community, exploration | Safe, explainable EVA plans in seconds, with no Earth in the loop. More science per walk within NASA's rules. The engine works on any terrain model, so the same approach serves Artemis lunar EVAs and analog field tests. Open source with an open benchmark, so researchers can plug in planners. | Live demo; `Research/bench` (open benchmark); Apache-2.0; NASA quotes (§1) | **Partly**: impact is argued but not quantified (gap G4). The "works on the Moon" claim isn't demonstrated (G3), so don't claim it as done. |
| 2a | **Creativity: real-world gap** | The challenge itself names the gap (regional/global tools, nothing hyperlocal). NASA's EVA GIS (AEGIS) is internal and Moon-only. Analog tools (xGDS/Playbook) depend on an Earth backroom. | Challenge text; NTRS 20250006063, 20240002135; `docs/designs/marswalk.md` §3 | ✔ |
| 2b | **New idea or improvement? What do people do now?** | Now: map viewers (Mars Trek), static maps, rover path planners (Field D*, ENav) built for *rovers*, and research human planners (SEXTANT, MoonPath) without constraint checking. In this challenge, a survey of 135 repo READMEs shows mostly slope A* + chatbot + HUD; 5 of 6 that mention flight rules disclaim them. **We add** human suit physiology (energy *and* heat), 12 cited NASA EVA constraints as hard checks re-verified by a simulator, three-tier space weather with real CME forecasts for Mars, and an Earth-independent habitat ↔ visor system. | Engine (`Shared/src/engine`); Evidence panel; differentiation table §4 | ✔ (needs a slide later) |
| 2c | **Stands out from conventional methods** | Conventional: shortest or least-slope path. Ours: *"is it safe and worth it?"* Shelter time, walk-back on contingency speed, comm line of sight, daylight, suit heat, keep-outs; binding constraint and drop reasons; bingo times. Our model's headline result: **from the habitat four limits block every stop (suit heat on the climb back, radio contact, shelter time, distance); even with unlimited cooling it still fails**, so EVAs are staged from the pressurized rover, consistent with NASA DRA 5.0 (our model result, not a NASA finding; `Validation/v3_impact/heat_sensitivity.json`). | Hab-1 NO-GO card + "Start from rover"; benchmark: a naive slope-only planner takes 140–166 unsafe steps vs our 0 | ✔ |
| 3 | **Scientifically and technically sound** | Every model is cited: Pandolf–Santee (NASA JSC), RAD dose (Hassler 2014, Guo 2015/2026), xEVA ConOps rules, Mars24 sun. Reproductions against NASA data. An exact optimiser (checked against brute force). A* exactly optimal vs an independent oracle. 115 unit tests, end-to-end test, real-input UX tests. | `Validation/` (V1 MAE 2.0 pp, V2 MAPE 10.6%); `Research/bench/results/latest`; `qa/`; Evidence panel in the app | ✔ (wording: "reproduces / calibrated", never "validated") |
| 4 | **Credible data** | NASA/USGS data: MRO HiRISE (terrain, colour), Mars Odyssey THEMIS, MSL Curiosity (traverse, Mastcam/Navcam, REMS, RAD), MGS MOLA, CCMC DONKI (WSA-ENLIL Mars forecasts), Viking MDIM. Provenance for every layer. Real vs scenario labelled. | Sources panel; `SitePacks/gale-v1/manifest.json`; SCENARIO tag | ✔ |
| 5 | **Belief** (did you really do the work?) | A live demo on real data, not mock-ups. Commit history. Validation figures. The team's literature research (George). Measured timings. Honest limitations listed in the app. | Repo history; Evidence panel; `docs/EXPLAINER.md` | **Needs**: a public demo link so global judges can try it (G9) |
| 6 | **Feasible, functional, practical** | Runs today end to end on a laptop, offline. First plan with all 12 targets ~1.7 s (cold, safety fields computed once); later plans ~38–105 ms and mid-EVA replans ~8.5 ms median (fields cached); route 11 KB vs Curiosity's ~28 KB/day uplink. Visor autonomy within ~3 s of link loss. Clear hardware path (safety core is pure, O(1)). | e2e timings (`qa/screens/timings.json`); `pnpm demo` | **Partly**: usability is being fixed now (G1); second site to show it works anywhere (G2) |
| 7 | **Relevance**: directly addresses the challenge | Layered, integrated view of a route at Gale/Mount Sharp (the challenge's own boxwork example); helps plan **and** carry out; science along the way | Challenge-alignment table (`docs/designs/marswalk.md`, end) | ✔ |
| 8 | **Meets the challenge requirements** | ≥3 data kinds (fully: optical, topographic, thermal; partly: radiation, atmospheric; plus space weather); safety (radiation/space weather, suit mobility, obstacles); route map; POV images (real Curiosity photos at each stop); habitat display + helmet HUD; rover + pairs considered | Same table; station cards; visor | ✔ |
| 9 | **Problem, solution, importance** | §1 above | — | ✔ (to be rehearsed) |
| 10 | **Show which NASA data we use** (video or slides) | Data badge "N missions · M data kinds" + Sources panel + locator credits | Console top bar | **Later**: a data slide/frame in the video (G7) |
| 11 | **Acknowledge AI use and sources** | README disclosure; citations everywhere; no AI imagery; no NASA logos | `README.md`; project page draft | ✔ (repeat on the project page and final slide) |
| 12 | **Equal attention to presentation and technical** | Technical is strong; the presentation comes after the UI settles | — | **Later** (G7) |

## 3. Gaps to close (priority order)
| ID | Gap | Why it matters (criteria) | Plan |
|---|---|---|---|
| **G1** | Console must be usable without instructions (Google-Maps behaviour) | 6 Functional, 5 Belief, 12 Presentation | In progress: real-use audit → fixes → real-input UX tests |
| **G9** | Public no-login demo link | Required for global judging; 5 Belief | Static build (engine in the browser) on a public host |
| **G2** | Second real site (Jezero) + site picker | 6 Feasible ("works anywhere"), 1 Impact | Pipeline for Jezero (George's verified 1 m DTM); globe picker |
| **G4** ✔ | Quantify impact | 1 Impact | Done: naive slope-only plans break ≥1 safety constraint in 99.5% (ours 0%); oversubscribed EVAs +5% science on average, never lower; replan 8.3 ms median. Originally planned: science value per walk-hour vs a naive "nearest stops first" plan; planning time (seconds vs the hours of manual traverse planning reported in NASA analog tests; cite it); unsafe steps avoided |
| **G6** | Visor matches the new console look | 12 Presentation | Apply the navigator palette to the visor after console sign-off |
| **G3** | "Works on the Moon": prove it or don't claim it | 1 Impact | Optional: a small LRO/LOLA site pack (Artemis III candidate region), else phrase it as "designed to be site-agnostic" |
| **G7** | Pitch, ≤30 s video, project page | 9–12 | After the UI direction is approved |
| **G10** | Site-pack release asset | Teammates can run the demo | `Pipeline/release.py` (with the user's OK) |

## 4. Differentiation (for "what do others do?")
| | Mars Trek / USGS maps | Rover planners (Field D*, ENav) | Research human planners (SEXTANT) | Typical Space Apps entry | **Marswalk** |
|---|---|---|---|---|---|
| Scale | Regional/global | Rover-local | Site | Site | **One EVA (hyperlocal)** |
| Who it's for | Viewers | Rovers | Humans (research) | Humans | **Suited crew + habitat EVA officer** |
| Cost model | — | Terrain/slip | Metabolic | Slope / distance | **Suited metabolic × Mars g + suit heat budget** |
| NASA EVA constraints as hard checks | — | Rover limits | Partial | Rarely (5 of 6 disclaim) | **12 cited, simulator-verified; never unsafe** |
| Explains why | — | — | — | — | **Binding constraint, drop reasons, bingo times** |
| Space weather | — | — | — | Sometimes static | **Three tiers with real ENLIL Mars forecasts** |
| Works without Earth | n/a | Yes (rover) | — | Usually cloud/chatbot | **Habitat ↔ visor, autonomy on link loss** |
| Evidence | — | Flight heritage | Papers | Rare | **Reproductions vs Curiosity RAD + NASA suit data; benchmark** |

## 5. Defense bank: likely judge questions
| Question | Short answer | Proof |
|---|---|---|
| Is the walking-energy model valid at Mars gravity? | It's calibrated: within ~11% of NASA suited data at 0.22–0.32 g. 0.38 g is an extrapolation, and we say so. NASA JSC uses the same Pandolf–Santee form. | V2 figure; NTRS 20240001423 |
| Why does the habitat plan fail, and is that a bug? | Physics, and it's overdetermined. The boxwork is ~220 m below; the climb back with 211 kg at 0.38 g costs ~800 W (modelled) vs NASA's 352 W suit sizing figure, so rests overrun the 6 h EVA. Raise the cooling budget to 1,500 W and it still fails: radio contact, the 30-min shelter limit and the 2 km radius block every stop. A rover parked near the stops fixes all four, as in NASA's DRA 5.0. | Hab-1 NO-GO card; `Validation/v3_impact/heat_sensitivity.json`; ICES-2026-127; NTRS 20130014146 |
| How do you know the route is optimal? | Path search is exact (A* 0.000% gap vs an independent oracle over 80 real-terrain scenarios). Stop selection is exact (DP checked against brute force on 320 cases). Uncertainty lives in the models, not the search. | `Research/bench/results/latest` |
| Can it ever give an unsafe plan? | No. Every candidate is re-walked step by step against all hard rules, and "stay in" is always valid. 1,000 randomised cases were independently re-verified. | Engine tests; X1 checks |
| Is the radiation part real? | Indicative. The dose model uses published RAD results. Our terrain pipeline reproduces Guo et al. 2026's sky-obstruction values to 2.0 pp. Terrain is never treated as a shelter (max measured drop 19%). The forecast tier uses real WSA-ENLIL Mars runs. | V1 figure; DONKI-API v2 |
| What's real and what's made up? | Real: terrain, imagery, thermal, Curiosity route and photos, science targets, weather, space weather. Scenario: the habitat/rover/pad placement, the sol number, crew parameters. The app labels this. | SCENARIO tag; Sources panel |
| What if they land somewhere else? | The pipeline builds a site pack for any location with HiRISE stereo terrain. Crewed sites are chosen years ahead and mapped in detail first. Where detail is missing, the tool says so instead of guessing. | `Pipeline/`; (Jezero site, G2) |
| Why only 5 × 5 km? | NASA keeps suited walkers within ~2 km of the base; 5 × 5 km covers that with margin, at the 1 m detail walking safety needs. Rover drives move the base. | Artemis III EVA tenets (NTRS 20230008183) |
| How does this run on Mars hardware? | Heavy solving runs in the habitat; the visor's safety core is O(1) lookups with no allocation. The route is 11 KB, and the link protocol is compact and signed. | Engine `safety-core`; package size |
| How is this better than Mars Trek? | Mars Trek is a viewer of global layers. We fuse layers into decisions for one walk: a safe route, why it's limited, leave-by times, and live guidance. | Differentiation table |
| What happens if the radio link drops? | The visor switches to AUTONOMOUS within ~3 s and keeps guiding home on the last confirmed route and its onboard safety map. Telemetry back-fills on reconnect. | e2e timings |
| Did you use AI? | Yes. Code was generated with Claude Code under the team's direction and review. Idea, decisions, data choices and validation are ours. No AI imagery. Disclosed in the README and project page. | `README.md` |
