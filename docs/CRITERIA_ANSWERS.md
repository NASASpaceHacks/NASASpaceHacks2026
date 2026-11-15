# Criteria answers: what we say to every judging question, and the proof

*The single source for the pitch, the project page and Q&A. Each answer is short enough to say aloud, followed by the proof a judge can check and the limit we state before they ask. Research behind it: `docs/research/existing-solutions.md` (what exists, gaps), `docs/research/impact-evidence.md` (NASA needs, claims we can defend), `docs/research/nasa-data-audit.md` (how deeply each dataset is used). Numbers come from `Validation/numbers.json`.*

**Rules for everyone on the team**
- Say "reproduces" or "calibrated", never "validated". Say "12 constraints drawn from public NASA EVA documents, each cited", never "NASA's flight rules" (Mars flight rules are not public).
- The habitat-vs-rover result is *our model's result*, consistent with NASA's rover-based architecture. It is not a NASA finding and we don't call it a discovery. Heat is one of four limits that block walking from the habitat, not the only one (`Validation/v3_impact/heat_sensitivity.json`).
- When a judge finds a limit, agree, and point to where we already state it (Evidence panel, `Validation/*/README.md`).

---

## The five big answers

### 1. What makes us unique?
**Say it:** "Every method we use is known on its own: least-cost paths, NASA's walking-energy model, science-stop optimisation. What we found nowhere else is all of it in one offline system that also checks each plan against 12 cited NASA constraints, re-verifies it in a separate simulator, explains why it's limited, and hands a signed route to the astronaut's visor, which keeps guiding if the link drops."

What exactly is new (we searched NASA tools, papers and 135 Space Apps 2026 repos; `existing-solutions.md` §c):
| What | Who else does it | Ours |
|---|---|---|
| Suited walking energy at Mars gravity **and** a suit heat budget in the route cost | SEXTANT (2010) had energy + sun/shadow heat load; MoonPath has energy only; no peer models suit heat rejection (4 of 135 READMEs mention suit cooling at all) | Pandolf–Santee × Mars g (NASA JSC's model family) + a 30-min suit heat governor against NASA's 352 W sizing figure |
| Constraints as **hard checks, re-verified** by an independent simulator | Not documented in any public tool (AEGIS internals are not public). 5 of 6 repos that mention flight rules say theirs are "not flight rules" | 12 cited constraints; a time-stepped simulator re-checks every one on every plan; "stay in" is always the safe fallback |
| **Explains** the verdict and offers a way out | NASA's review says tool usability and explanation are under-evaluated; peers give a verdict plus a chatbot | Binding constraint, why each stop was dropped, the red stretch on the map where it fails, "Closest safe point" / "Move rover closer" |
| Crew-side **execution without Earth** | AEGIS/EMSS: "Current state: empowering ground-based flight controllers"; Joint AR: "a seamless suit-integrated AR solution does not yet exist" | Signed ~11 KB route pushed over the local link; the visor runs its own safety core and goes autonomous within ~3 s of link loss |
| **Three-tier space weather** for Mars | 20 of 135 peers name DONKI, mostly as a static feed | Real WSA-ENLIL Mars arrival forecasts (go/no-go) → light-delayed flare alerts → onboard nowcast as the only "return now" trigger |
| **Checked against NASA data** | Rare in peers | Dose within 4% of Curiosity's measured RAD dose (V5); reproduces RAD terrain shielding (MAE 2.0 pp), calibrated on NASA suited data (MAPE 10.6% at 0.22–0.32 g), engine vs independent checker vs blind AI judges (all three agree on 23 of 24 walks; the one difference is a safe-side engine NO-GO) |

**Limit to state:** AEGIS, SEXTANT and Joint AR have real users or field tests; we have neither. Our novelty is the combination, the verification step and the crew-side handoff, not any single algorithm.

### 2. What impact do we create?
**Say it:** "NASA says Mars crews will plan more of their own EVAs, under a 4-to-20-minute delay, with automated tools. Marswalk is that tool. In 200 simulated walks at Gale, a slope-only planner broke at least one safety constraint 99.5% of the time; ours never did, and it re-plans in about 8 milliseconds with no Earth in the loop."

| Impact | Number / evidence | Source |
|---|---|---|
| The need is NASA's own | "the crew will likely be more involved in planning their EVAs than as is currently done on ISS… crew input, ground based planners, and automated planning tools"; latency "~4 and 20 minutes" | EVA-EXP-0042 Rev B §8.1 |
| | "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions… upon locally sourced information" | NTRS 20230014957 |
| | "Future work may integrate real-time EV data (e.g., suit consumables, physiological performance) with traverse planning" | NTRS 20260001895 |
| Safety | Slope-only plans break ≥1 constraint in **99.5%** of 200 Gale scenarios; Marswalk **0%** (simulator-verified). From Hab-1, 60/60 scenarios correctly return "stay in" | `Validation/v3_impact` |
| Speed without Earth | Plan median **37.9 ms**, mid-EVA re-plan median **8.3 ms** (p95 19.8 ms) on a laptop | same |
| Science when time is short | With 12 candidate stops and 2–4 h available: **+5%** science value on average vs a safety-checked nearest-first plan, **never lower**, better in 62.5% of cases | `summary_oversub.json` |
| Fits Mars links | Route package **~11 KB** (Curiosity's daily uplink is ~28 KB) | codec gate |
| A mission-design result (our model, robust) | From the habitat no stop is reachable, and that does not hinge on our heat model. Under NASA's 352 W suit sizing figure the climb back (~220 m up) overruns the 6-hour EVA; with unlimited suit cooling the stops still break radio contact (7 of 12), the 30-min shelter limit (2) or the 2 km radius (3). A pressurized rover parked near the stops fixes all four at once, which is how NASA's Mars reference plans use rovers (DRA 5.0; HEOMD-415) | Hab-1 NO-GO card; `Validation/v3_impact/heat_sensitivity.json`; ICES-2026-127; SP-2009-566 |
| Scale | Reference Mars missions: 6 crew, ~500 days; suits designed for up to 24 EVA-hours per person per week | SP-2009-566; NTRS 20220004017 |
| Works beyond one site | Second Mars site (Jezero, Perseverance's delta) runs on the same engine with no code changes | `SitePacks/jezero-v1` |

Who would use it, and how: Mars crews and the in-habitat IV crewmember (who "essentially performs the roles of IV, Flight Director, partial EVA Officer"); NASA analog campaigns (JETT, BASALT) as a side tool comparing predicted vs measured effort; Mars exploration-zone studies (reach from habitat vs rover); suit designers (which targets are walkable for a given heat budget). Paths and their requirements: `impact-evidence.md` §4.

**Limits to state:** simulation only, no suited-human validation; the science values are our heuristic; no NASA relationship; no published baseline for manual planning time, so we don't claim "saves X hours". In the base (not oversubscribed) set, a safety-checked nearest-first plan picks the same stops: at Gale the safety rules, not the ordering, decide the outcome.

### 3. Are there existing solutions? How are we different, and why?
**Say it:** "Yes, and they're good at what they do. Mars Trek and MMGIS are map viewers. NASA's AEGIS plans Artemis EVAs for flight controllers on the ground. SEXTANT and MoonPath find energy-optimal paths. Joint AR is building the helmet display. Rover planners drive robots. None of them is an offline planner for the crew that enforces EVA constraints, explains the verdict and guides the walk, which is what Mars needs because the ground is minutes away."

| Tool | What it does well | What it doesn't do (for a Mars crew) | Better than us at |
|---|---|---|---|
| JPL Mars Trek, NASA MMGIS | Global data, measuring, slope, viewshed, ops GIS | No EVA budget, rules or physiology; viewers, not planners | Data breadth, multi-user, heritage |
| AEGIS / EMSS (JSC, Artemis) | EVA time estimates, science coverage, path comparison; prime Artemis planning tool | Ground tool ("next evolution: extending… to in-space assets"); no suit physiology listed | Real flight-control users, JETT3–5 and Artemis sims |
| SEXTANT / Minerva (MIT, BASALT) | Energy-optimal paths, walk-back, thermal load | No rule set; its MDRS field test found real time and energy **higher** than predicted (per the study abstract) | Field-tested with human subjects |
| MoonPath (2024) | Dijkstra minimising metabolic workload, lunar south pole | Lunar, batch, no comm/heat/explanation | Peer-reviewed |
| Broddrick et al. (NASA, 2024) | Exact science-yield optimisation (MILP) | Fixed 0.5 m/s speed, "has not yet been validated" | NASA science-team integration |
| Joint AR, AxEMU HUD | Real suit optics and displays | Hardware and integration bound; no planner | Real hardware |
| Field D*, ENav, MLNav | Flight-proven rover autonomy | Machines: no consumables, no physiology | Flight heritage |
| Space Apps 2026 peers (135 READMEs) | Slope A* (81), HUD (53), AI explainer (65) | 6 mention flight rules (5 disclaim them); 0 signed route push; ~2 exact stop optimisation | Some have broader layer lists or live demos |

Why our design differs: on Mars the ground can't be in the loop for every decision (latency up to 22 min, ~2 weeks of blackout at conjunction), so the planner has to live with the crew. It also has to be trusted without an expert at hand, which is why it re-verifies every plan and explains itself.

### 4. What gaps did we find in current tools?
Each gap is quoted from a NASA source, with what we did about it (`existing-solutions.md` §b):
| # | Gap (source) | What Marswalk does |
|---|---|---|
| 1 | "operational focus has remained almost exclusively on microgravity rather than planetary surface operations" (NTRS 20260001895) | A surface-EVA planner at the scale of one walk |
| 2 | Physiology isn't coupled to traverse planning; Apollo crews "frequently exceed[ed] the rates predicted" (NTRS 20260001895, 20250011652) | Energy and suit heat are in the route cost and the burndowns; telemetry is compared with the plan during the EVA |
| 3 | Metabolic path models under-predict in the field (SEXTANT MDRS study, per its abstract) | We report our model error openly (V2) and plan with contingency walk-back at half speed. Same risk applies to us |
| 4 | Planners are ground tools; crew execution is immature: "Empowering ground-based flight controllers" (NTRS 20260001893); "a seamless suit-integrated AR solution does not yet exist" (NTRS 20220013671) | Planner runs on the habitat server; the visor guides the walk and goes autonomous on link loss |
| 5 | No public tool documents EVA constraints as machine-checked hard limits with re-verification; general GIS "lack the mission specific capabilities" (NTRS 20230000186) | 12 cited constraints, simulator re-verification, never an unsafe plan |
| 6 | Single-criterion paths, unvalidated science optimisation: "incorporate multiple criteria" (NTRS 20250011652); fixed 0.5 m/s speed (Broddrick 2024) | Exact stop selection with terrain-dependent walking time and every constraint at once |
| 7 | Usability and explanation are under-evaluated: "an explicit lack of emphasis placed on evaluating the usability" (NTRS 20250011652) | Plain-language verdicts, the failing stretch in red, ways forward; real mouse-and-keyboard tests (26) |
| 8 | Hackathon peers converge on "A* on slope + Mars Trek tiles + O₂ gauge + AI narrator" (README survey) | Physics-first engine; AI is not in the safety path |

### 5. How well do we use NASA data?
**Say it:** "Every layer is real NASA data, and the important ones do work in the engine, not just on screen. The terrain model drives slope limits, walking energy, radio line of sight and sunlight, and we checked it against 372 surveyed Curiosity positions: 19 cm standard deviation. Thermal inertia from Mars Odyssey feeds the walking effort, the terrain model shields the radiation dose, CRISM shows where the orbiter sees sulfate at each science stop, and CCMC's Mars forecasts drive the space-weather go/no-go."

| Dataset (mission) | What it does in Marswalk | Checked how | Depth |
|---|---|---|---|
| USGS Gale 1 m DEM (MRO HiRISE + CTX + HRSC + MOLA) | Slope limit, edge grade, 3-D walking length and grade (energy), radio viewshed, sun relief, dose pressure term | vs 372 Curiosity waypoint elevations: median −0.001 m, σ 0.19 m; slope/LOS recomputed independently in V4 | **Deep** |
| HiRISE colour mosaic (MRO) | Base map, station zoom | Registered to the DEM within 0.24 m E / 0.58 m N | Display |
| THEMIS thermal inertia (Mars Odyssey) | Terrain factor in walking energy and suit heat | Mapping TI → effort is our assumption, labelled "Indicative" | Medium |
| Curiosity traverse + waypoints (MSL) | Real science stops; DEM truth check; RAD parking positions for V1 | σ 0.19 m check | **Deep** (as reference) |
| Curiosity Mastcam/Navcam raw images (MSL) | Point-of-view photo at each stop (console + visor) | Matched to stationary rover positions | Display |
| RAD (MSL): measured dose (PDS PPI RDR) + published models (Hassler 2014, Guo 2015/2026); REMS pressure (PDS) | Route dose estimate, with terrain shielding from the DEM sky-view (Guo 2026 two-term model; e.g. 8.6% on the default plan). Reference pressure set from measured REMS (910 Pa at the scenario season) | **V5:** at measured pressure the model is within 4% of Curiosity's measured year-1 dose (198.8 vs 207.8 µGy/day, 131 sols sampled, SEP days removed). **V1:** shielding method reproduces the published ratios (MAE 2.0 pp). Measured dose at this season spans 167–296 µGy/day over the solar cycle, so route doses are ±30% | **Deep** (measured-data comparison) |
| REMS weather (MSL) / MEDA (M2020) | Latest air and ground temperature, pressure, UV in the Weather tab (labelled as the latest reading, not the scenario sol); season for sun geometry when the feed has the scenario sol | — | Light |
| CRISM summary parameters (MRO; FRT000058A3, 2007, 18 m) | Minerals layer (polyhydrated sulfate SINDEX2; hydration BD1900_2); sulfate signal shown at each science stop | Co-registered to HiRISE: the product sat ~270 m off and was shifted (confirmed by the DEM hillshade within ~35 m; residual ≤30 m). Tiers are relative to the area; a signature, not an abundance | Medium |
| CCMC DONKI WSA-ENLIL + flares | Go/no-go banner from real CME arrival forecasts at Mars | 33 events in the pack | Medium |
| Mars24 (NASA GISS) | Sun elevation: daylight rule, timeline, lighting | Reproduces NASA's worked examples | **Deep** |
| MOLA (MGS), Viking MDIM 2.1 | Datum, far heading cue; locator map | — | Light |
| Jezero: HiRISE TRN DTM + ortho, M20 traverse, Mastcam-Z/Navcam, MEDA | Same pipeline, second site | DEM vs 220 Perseverance waypoints: σ 0.07 m | Same |

Coverage of the challenge's data kinds: **optical, topographic, thermal** fully used; **spectral** (CRISM sulfate and hydration signal, indicative), **radiation** (dose model checked against measured RAD data, with terrain shielding), **atmospheric** (rover weather shown; season) and **geophysical** (datum, ephemeris) partly; **space weather** in addition. Chemical: none.

**Done since the data audit:** terrain shielding wired into the dose; REMS/MEDA readings shown; CRISM mineral layer (adds spectral); dose model compared with measured Curiosity RAD data (V5) and its reference pressure set from measured REMS.

**Limits to state:** THEMIS→effort and the dose constants are assumptions (labelled); REMS is the outreach feed; the scenario sol (412) predates the REMS feed, so the season falls back to an assumed Ls 240.

---

## Criterion by criterion

| # | Criterion | The judge's question | Our answer (say it) | Proof | Limit we state |
|---|---|---|---|---|---|
| 1 | Impact | "Who benefits, and how much?" | Big answer 2 | v3 numbers; NASA quotes | Simulation only |
| 2 | Creativity / originality | "What's new? What exists?" | Big answers 1, 3, 4 | Comparison table; peer survey | Combination is new, parts are known |
| 3 | Scientifically & technically sound | "Why should I trust the numbers?" | "Cited models, checked against measured NASA data (Curiosity radiation, NASA suited-walking tests), exact search, 122 unit tests and 26 real-input tests." | V1 MAE 2.0 pp; V2 MAPE 10.6% (0.22–0.32 g); V5 dose within 4% of measured RAD (year 1); A* 0.000% gap vs an independent oracle on 80 real-terrain cases; stop selection = brute force on 320 cases; V4: all three agree on 23/24 | 0.38 g is an extrapolation (data stop at 0.32 g; error 36% at 0.12–0.17 g); V1 metric chosen post hoc; the AI check shows consistency, not truth; the engine can miss a valid path and say NO-GO (W02, 0.2 min over; safe-side) |
| 4 | Credible data | "Is this real data?" | "Every layer is NASA/USGS data with product IDs, resolution and checksums in the app's Sources tab; anything scenario is labelled SCENARIO." | Sources tab; manifest provenance + sha256; DEM σ 0.19 m | Station science values are team priorities |
| 5 | Belief | "Did you really build this?" | "Try it. Every number on screen comes from code in the repo, with history and tests." | Live demo; repo history; `pnpm test:ux`; Validation scripts | Public link still to publish (needs team OK) |
| 6 | Feasible, functional, practical | "Would it work on Mars?" | "It runs offline on a laptop, plans in milliseconds, the route fits in 11 KB, and the visor brings the astronaut home with no link. A second Mars site works with no code changes." | Timings; package gate; autonomy test; Jezero | Visor is a screen UI, not suit hardware; networking is local Wi-Fi |
| 7 | Relevance | "Does it answer *this* challenge?" | "It's a layered, integrated view of one Marswalk at Mount Sharp's boxwork (the challenge's own example) that helps plan **and** carry it out, with science on the way." | Challenge-alignment table (`docs/designs/marswalk.md`) | — |
| 8 | Meets requirements | "≥3 data kinds? Safety? Route? POV?" | See the table below | Layers panel; station cards; visor | No chemical data; spectral is an indicative signal |
| 9 | Problem → solution → importance | "Say it in 20 seconds." | "Mars crews will plan their own walks with Earth up to 22 minutes away. Marswalk is a habitat console and helmet visor that plan a walk on real NASA data, check it against 12 cited NASA constraints, explain the verdict, and keep guiding with no link. It turns NASA's stated need for Earth-independent EVA decisions into a working tool." | Opening of pitch | — |
| 10 | Shows which NASA data | "Which datasets, exactly?" | Big answer 5 | Sources tab, data slide | — |
| 11 | Acknowledges AI + sources | "Did you use AI?" | "Yes. The team chose the problem, concept and design; most of the code was written with Claude coding agents under our direction and review. AI is not in the safety path: no AI decides a route. Blind AI reviewers were used only as an extra check of the engine's verdicts. No AI imagery. Every dataset and paper is cited." | README; project page; final slide | — |
| 12 | Presentation = technical | — | 20-second story, ≤30 s video, ≤7 slides, live demo, Q&A drills from this file | `docs/pitch/` | Being prepared |

### Requirement checklist (criterion 8)
| Challenge asks for | Where it is |
|---|---|
| ≥3 kinds of NASA data in one view | Layers panel: imagery (HiRISE), elevation/slope (DEM), thermal inertia (THEMIS), minerals (CRISM), lighting (Mars24), radio coverage (DEM viewshed), safety maps; plus space weather (DONKI), rover weather (REMS/MEDA) and photos (Curiosity) |
| Safety: radiation / space weather | Dose per route; three-tier space weather; 30-min shelter rule |
| Safety: suit mobility | Slope ≤20°, walking energy at Mars g, suit heat budget, contingency walk-back at half speed |
| Obstacles | Slope and edge-grade blocking, plume keep-out, astronaut-reported hazards trigger a re-plan |
| Route map | Console map with the route, stops, margins over time |
| POV imagery | Real Curiosity/Perseverance photo at each stop, on console and visor |
| Plan **and** carry out | Habitat console → signed route → visor guidance, live telemetry, re-plan |
| Science along the way | Science stops traced to the Curiosity team's boxwork campaign; exact selection under the constraints |

---

## Say this, not that
| Don't say | Say |
|---|---|
| "NASA flight rules" | "12 constraints drawn from public NASA EVA documents, each cited (3 values are our design parameters, labelled)" |
| "We discovered cooling, not oxygen, limits walking" | "From the habitat, four limits block the walk: suit heat on the climb back, radio contact, shelter time and distance. Even with unlimited cooling it still fails. The rover fixes all four, which is consistent with NASA's rover-based plans" |
| "Validated" / "safe for crew" | "Reproduces / calibrated against NASA data; internally consistent; not tested with suited people" |
| "SWME rejects 370 W on Mars" (as fact) | "A 2013 hollow-fiber SWME prototype is packaged for 370 W in a Mars environment (NASA Tech Brief MSC-24849-1); Mars-pressure performance still needs testing" |
| "~800 W walking" (as measured) | "~800 W modelled for the loaded climb at 0.38 g, an extrapolation; above NASA's 530 W design maximum" |
| "+5% science" (alone) | "+5% when time is short, against a safety-checked nearest-first plan, on our science scoring" |
| "AI agreed, so it's correct" | "Blind AI reviewers matched the engine on 23 of 24 walks (the other was a safe-side engine NO-GO); that shows the logic is consistent, not that the models are right" |
| "Saves hours of planning" | (don't claim: no published baseline) |
| "1,000 EVAs per mission" | "Hundreds of EVAs in the planning ceiling" (our arithmetic from NASA's 3–4 per week) |

## What would raise the score further
1. Publish the no-login demo link (criteria 5, 6; required for global judging). Needs the team's OK.
2. ~~Measured-RAD comparison~~ done (V5).
3. ~~Visor in the same navigator look~~ done (12).
4. Presentation block: video, slides, rehearsal with this file (9–12).
