# Project page v1: Marswalk

*Paste-ready text for the Space Apps 2026 submission. Replaces v0. Every claim and number comes from `docs/CRITERIA_ANSWERS.md` and `Validation/numbers.json`. Fill in the `[brackets]` before submitting. "Marswalk" is the working name; if the team renames it, search and replace.*

---

## Project name
Marswalk

## Challenge
Interplanetary Survival Guide: Martian Map

## Summary (≈250 characters)
Marswalk is a habitat console and helmet visor that plan a Mars surface walk on real NASA data, check it against 12 cited NASA EVA constraints, explain every NO-GO, and keep guiding the astronaut if the link drops. It runs offline.

---

## What it is
Marswalk is the planning and guidance system a Mars crew would use for a surface walk (EVA) when Mission Control is too far away to help in real time. It has three parts:

1. **Habitat console.** The habitat's EVA officer picks a start (the habitat or a pressurized rover) and the places to visit, then gets a plan on a 1-metre terrain model of Gale crater. Every plan is checked against 12 constraints drawn from public NASA EVA documents. The verdict is GO or NO-GO, with the reason, the place on the map where the walk fails, and a way forward.
2. **Signed route.** The confirmed route is packed into about 11 KB, signed (Ed25519) and sent over the local surface link. For scale, Curiosity's daily uplink is about 28 KB.
3. **Helmet visor.** The visor shows the astronaut where to go, how much walk-back margin and time to shelter she has, the latest time she can leave each stop, her suit-heat load, and Curiosity's real photo of each stop. If the link to the habitat drops, it goes autonomous within about 3 seconds and keeps guiding her on the last confirmed route.

Everything runs on a habitat server, with no internet. The study site is a 5 × 5 km area of Gale crater on Curiosity's 2025–26 boxwork traverse, at the foot of Mount Sharp (the challenge's own example). The same engine also runs a second site, Jezero crater, with no code changes.

## The problem
On Mars, Earth is up to 22 light-minutes away, and around solar conjunction it can't be reached for about two weeks. NASA's documents say the crew will have to plan more of its own walks:

- "the crew will likely be more involved in planning their EVAs than as is currently done on ISS… crew input, ground based planners, and automated planning tools" (NASA xEVA System ConOps, EVA-EXP-0042 Rev B §8.1)
- "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions… upon locally sourced information" (NTRS 20230014957)
- "Future work may integrate real-time EV data (e.g., suit consumables, physiological performance) with traverse planning" (NTRS 20260001895)

Today's tools don't do this for a crew. Mars Trek and MMGIS are map viewers. NASA's AEGIS/EMSS plans Artemis EVAs for flight controllers ("Current state: empowering ground-based flight controllers", NTRS 20260001893). SEXTANT and MoonPath find energy-efficient paths without a constraint set. The common way to plan a walk on a map is to avoid steep ground: 81 of the 135 Space Apps 2026 project READMEs we surveyed use slope-based A* or Dijkstra.

## How it works
- **One correct Mars grid.** Every layer is reprojected onto a 5 m grid on the official Mars sphere (radius 3,396,190 m), and the scale bar is in true Mars metres.
- **Walking cost from physiology.** Each step's cost uses the Pandolf–Santee walking-energy model (the model family NASA JSC uses), with the 121 kg suit as load, scaled to Mars gravity. A heat governor keeps the 30-minute average within a 352 W suit cooling budget by adding rests.
- **12 constraints, each cited.** Maximum slope 20°, 6-hour EVA, egress and ingress time, contingency oxygen, walk-back at half speed, shelter within 30 minutes, radio gaps of 10 minutes or less, daylight, suit heat, 2 km radius, and a 1 km plume keep-out, plus a soft slope-comfort limit. The citations are NASA's xEVA ConOps, the Artemis III EVA tenets, DRA 5.0, the FOD traverse constraints in Caswell et al. 2025, and others. Three values are our design parameters and are labelled as such in the app (evidence class "E").
- **Exact search, then a second check.** Shortest paths are exact (A*/Dijkstra). Stop selection is exact (dynamic programming over up to 15 stops). Every candidate plan is then re-walked step by step in a simulator against all hard constraints. "Stay in" is always a valid answer.
- **Explanation.** Each plan comes with its binding constraint, the margin on each rule, the latest departure time from each stop, why each stop was dropped, and for a NO-GO, the red stretch on the map and the ways forward ("Closest safe point", "Move rover closer", "Start from rover instead").
- **Space weather in three tiers.** Real WSA-ENLIL forecasts of CME arrivals at Mars (NASA CCMC DONKI) give the go/no-go for the EVA date. Flare alerts from Earth arrive light-delayed. An onboard dose-rate spike is the only "return now" trigger.
- **Visor safety core.** The route package carries a coarse 50 m safety grid, so the visor's checks are constant-time lookups with no memory allocation.

**What our model shows.** From the habitat at Gale, none of the 12 boxwork stops is reachable. The stops sit about 220 m below the habitat, and the climb back costs about 800 W (modelled) against NASA's 352 W suit sizing figure, so the forced rests overrun the 6-hour EVA. This doesn't hinge on the heat model. With up to 1,500 W of cooling, every stop still breaks radio contact (7 of 12), the 30-minute shelter limit (2) or the 2 km radius (3). A pressurized rover parked near the stops fixes all four at once. That's consistent with how NASA's Mars reference architecture uses rovers (DRA 5.0, SP-2009-566). It's our model's result, not a NASA finding.

## Results
| What | Result | Source |
|---|---|---|
| Plans that only avoid steep ground (the common baseline), 200 simulated Gale walks | Broke at least one constraint in 99.5%. Marswalk's plans broke none (simulator-checked). This baseline is a strawman by construction: it ignores everything but slope | `Validation/v3_impact` |
| Against nearest-first with the same safety checks, 12 candidate stops, 2–4 h available | +5% science value on average, better in 62.5% of cases, never lower. With ample time, both pick the same stops | `summary_oversub.json` |
| From the habitat, 60 scenarios | "Stay in" in 60 of 60 | `Validation/v3_impact` |
| Speed on a laptop | Plan 37.9 ms median; mid-EVA re-plan 8.3 ms median (p95 19.8 ms). The first plan of a session takes about 1.7 s while the safety fields are computed once | `Validation/numbers.json`, `qa/screens/timings.json` |
| Route package | About 11 KB (Curiosity's daily uplink is about 28 KB) | package gate |
| Link loss | Visor autonomous within about 3 s | `qa/screens/timings.json` |

## NASA data used
| Mission | Instrument / product | Used for | Credit |
|---|---|---|---|
| Mars Reconnaissance Orbiter | USGS MSL Gale merged DEM, 1 m (HiRISE stereo DTMs merged with CTX, HRSC and MOLA) | Slope limit, edge grade, walking length and grade, radio line of sight, sunlight, dose shielding | NASA/JPL/University of Arizona; NASA/JPL/MSSS; USGS (Parker & Calef 2016) |
| Mars Reconnaissance Orbiter | HiRISE colour mosaic, 0.25 m | Base map | NASA/JPL/University of Arizona |
| Mars Reconnaissance Orbiter | CRISM FRT000058A3 summary parameters (SINDEX2, BD1900_2), 18 m | Hydrated-sulfate signal at each stop (indicative) | NASA/JHUAPL |
| 2001 Mars Odyssey | THEMIS quantitative thermal inertia, 100 m | Terrain factor in walking energy and suit heat (indicative) | NASA/JPL/ASU; USGS Astrogeology mosaic |
| Mars Science Laboratory (Curiosity) | Traverse and waypoints (MMGIS) | Real science stops; terrain check | NASA/JPL-Caltech |
| Mars Science Laboratory (Curiosity) | Mastcam and Navcam raw images | Photo at each stop, on console and visor | NASA/JPL-Caltech/MSSS (Mastcam); NASA/JPL-Caltech (Navcam) |
| Mars Science Laboratory (Curiosity) | RAD measured dose (PDS PPI); REMS pressure and weather (PDS) | Dose model check (V5); reference pressure; weather panel | NASA/JPL-Caltech/SwRI (RAD); NASA/JPL-Caltech/CAB (CSIC-INTA) (REMS) |
| Mars Global Surveyor | MOLA | Datum (in the merged DEM) | NASA/GSFC |
| Viking | MDIM 2.1 colour mosaic | "Where on Mars" locator | NASA/USGS, via JPL Mars Trek |
| Mars 2020 (Perseverance) | HiRISE TRN DTM and ortho, traverse, Mastcam-Z and Navcam, MEDA | Second site (Jezero) | NASA/JPL-Caltech/ASU (Mastcam-Z); NASA/JPL-Caltech; NASA/JPL-Caltech/CAB (MEDA) |
| Heliophysics, NASA GSFC CCMC | DONKI WSA-ENLIL CME runs and flare notices | Space-weather go/no-go | NASA CCMC |
| NASA GISS | Mars24 sun-position algorithm (Allison & McEwen 2000) | Daylight rule, lighting, sun heading on the visor | NASA GISS |

`[verify in app: check each credit line against Details → Sources before submitting]` HRSC is an instrument on ESA's Mars Express (ESA/DLR/FU Berlin). Its data are part of the USGS merged DEM, and we credit it here. Every layer's product ID, resolution and sha256 checksum are in `SitePacks/gale-v1/manifest.json` and in the app's Sources tab. Anything that is scenario (habitat, rover and pad positions; sol 412; crew parameters) is labelled SCENARIO in the app.

**Data kinds covered:** optical, topographic and thermal are fully used. Spectral (CRISM), radiation (RAD), atmospheric (REMS/MEDA) and geophysical (datum, ephemeris) are partly used. Space weather is used in addition. Chemical data are not used.

## Validation, and its limits
We say "calibrated" and "reproduces". We do not say "validated", and nothing here has been tested with suited people.

| Check | Result | Limit |
|---|---|---|
| Terrain vs 372 surveyed Curiosity positions | Median −0.001 m, σ 0.19 m (Jezero: 220 Perseverance positions, σ 0.07 m) | — |
| V1: terrain radiation shielding | Reproduces Guo et al. 2026 obstructed-sky values: MAE 2.0 pp, r 0.94, 15 comparisons | Metric chosen after seeing the data (one of three readings), disclosed; one rover, 8 events |
| V2: walking energy | Calibrated on NASA IST-2 suited data (Norcross 2010): 10.6% mean error at 0.22–0.32 g | 36% at 0.12–0.17 g; 20.8% overall; Mars 0.38 g is an extrapolation (no data there) |
| V5: radiation dose | Within 4% of Curiosity's measured year-1 mean (198.8 vs 207.8 µGy/day, 131 sols sampled, SEP days removed) | Largely in-sample (the published model was fitted on early RAD data); −9% at the scenario season with our constants; measured dose spans 167–296 µGy/day over the solar cycle, so route doses are ±30%; the measured daily pressure effect was not reproduced |
| V4: three-way cross-check, 24 walks | Engine, an independent Python checker and blind AI judges agree on 23 of 24 | The one difference (W02) is a safe-side engine NO-GO, 0.22 min over the radio limit; the AI judges check rule application, not the models |
| Search | A*: 0.000% gap vs an independent oracle, 80 real-terrain cases. Stop selection = brute force on 320 cases | Uncertainty sits in the models, not the search |
| Software | 122 unit tests; 26 real mouse-and-keyboard UI tests | — |

**Other limits.** Simulation only, with no field or suited-human test. Mapping thermal inertia to walking effort, the dose constants and the rover radio relay are our assumptions, labelled in the app. The 12 stops are real Curiosity targets, each cited, but their 0–100 science values are our team's scoring, not NASA rankings. The REMS reading shown is the latest outreach-feed value, not the scenario sol; the scenario sol (412) predates the feed, so the season falls back to an assumed Ls 240. The visor is a screen app, not suit hardware, and the link is local Wi-Fi. We have no NASA relationship. We don't claim hours of planning saved: there's no published baseline.

## Challenge alignment
| The challenge asks for | Marswalk |
|---|---|
| A layered, integrated view of a location or route on Mars | Gale crater / Mount Sharp boxwork, 5 × 5 km; layers fused into a verdict, a route and its margins, not only stacked |
| Data from multiple NASA missions (≥3 kinds) | MRO, Mars Odyssey, Curiosity, MGS, Viking, Perseverance, CCMC: optical, topographic, thermal, spectral, radiation, atmospheric, space weather |
| Help a human explorer **plan** | Habitat console: plan, verdict, reasons, ways forward |
| …and **carry out** a Marswalk | Signed route to the helmet visor; live guidance; autonomy on link loss |
| Science along the way | 12 real Curiosity boxwork-era targets traced to objectives; exact stop selection under the constraints |
| Safety: radiation and space weather, suit mobility, obstacles | Route dose with terrain shielding; three-tier space weather; 30-minute shelter rule; slope and edge-grade blocking; suit energy and heat; keep-outs |
| Point-of-view imagery | Curiosity's photo at each stop, on console and visor |

## Use of artificial intelligence
- The team chose the problem, the concept, the system design, the data sources and the scope, and reviewed the work.
- Most of the code (engine, server, both apps, tests, data pipeline) was written with Anthropic's Claude coding agents (Claude Code) under the team's direction and review.
- AI also drafted parts of the documentation, the science content and these pitch materials. The team edited them and checks the citations against their sources. `[team to confirm this line]`
- **AI is not in the safety path.** No AI decides a route. The verdict comes from the engine and its simulator.
- Blind AI reviewers (Claude) were used once as an extra consistency check of the engine's verdicts (V4). That shows the logic is consistent, not that the models are right.
- No AI-generated imagery or video is used. Every NASA image and dataset is credited to its mission. No NASA logos are used.

## Team
Team NASASpaceHacks, Toronto.
- [Name], [role]
- [Name], [role]
- [Name], [role]
- [Name], [role]

## Links
- Repository: [https://github.com/NASASpaceHacks/NASASpaceHacks2026]
- Live demo (no login): [URL]
- 30-second video: [URL]
- Slides (7): [URL]

## Licence
Apache-2.0.

## References
- NASA xEVA System ConOps, EVA-EXP-0042 Rev B (2020)
- NTRS 20230014957 (Earth independence); NTRS 20260001895 (EV data and traverse planning); NTRS 20260001893 (AEGIS/EMSS); NTRS 20250011652 (planning-tool review); NTRS 20220013671 (Joint AR)
- Caswell et al., ASCEND 2025, NTRS 20250006063 (traverse constraints)
- Tenets of Lunar EVA for Artemis III, NTRS 20230008183; Artemis III EVA slope, NTRS 20230005904
- Mars DRA 5.0 Addendum, NASA SP-2009-566-ADD; NTRS 20220004017 (suit EVA-hours)
- NASA ICES-2026-127 (352 W suit sizing); NASA Tech Brief MSC-24849-1, NTRS 20130014146 (SWME)
- Norcross et al. 2010, NASA/TP-2010-216125 (suited metabolic data)
- Hassler et al. 2014; Guo et al. 2015; Guo et al. 2026 (RAD dose and terrain shielding)
- Hoffman et al., First Landing Site/Exploration Zone Workshop, NTRS 20160002370 (plume keep-out)
- Parker & Calef 2016, MSL Gale Merged DEM (USGS)
- Allison & McEwen 2000 (Mars24)
- Full citation list per rule: `Shared/src/contracts/rules.ts`; per dataset: `SitePacks/gale-v1/manifest.json`
