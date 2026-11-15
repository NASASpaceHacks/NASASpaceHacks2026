# Marswalk: 7 slides (global submission + live backdrop)

*One deck serves both uses. **Global judging:** it's the "≤7 slides" option next to the project page, so it has to tell the whole story without a speaker. **Toronto live pitch:** slides 1, 5, 6 and 7 are on screen around the demo; slides 2–4 are the fallback if the demo fails (see `PITCH.md`). Numbers come from `docs/CRITERIA_ANSWERS.md` / `Validation/numbers.json` only.*

**Counting rule.** "On-slide text" is the slide's message, at most 25 words (count given). Two things are counted separately: the title, which is a claim of at most 12 words, and the small **source line** at the bottom (citations, credits, URLs), which judges need for traceability.

**Look.** Match the console's navigator style: near-black background, white text, cyan for actions and links, green for GO, red for NO-GO. **No yellow or orange.** Screenshots are 1440×900 (console) and 1920×1080 (visor); crop as noted. No NASA logos. The Space Apps 2026 brand mark is allowed on slide 1 and slide 7 only.

**Live order:** slide 1 (0:00–0:45) → console and visor demo (0:45–2:50) → slide 5 (2:50) → slide 6 (2:55–3:25) → slide 7 (3:25–end, and during Q&A).

---

## Slide 1 · Problem
**Title:** On Mars, the crew has to plan its own walks

**On-slide text (24 words):**
> Marswalk · NASA Space Apps 2026
> Earth is up to 22 light-minutes away.
> NASA: "the crew will likely be more involved in planning their EVAs."

**Visual:** `qa/screens/sites/gale.png` full-bleed, darkened about 50%. Crop to the map (roughly x 86–950, y 60–770) so the console chrome doesn't compete with the text.

**Source line:** EVA-EXP-0042 Rev B §8.1 (NASA xEVA System ConOps) · Team NASASpaceHacks, Toronto · Challenge: Interplanetary Survival Guide: Martian Map

**Speaker notes:** The hook and NASA's own words (PITCH 0:00–0:45). The quote is NASA's; the latency figure is ours (3–22 light-minutes; about two weeks with no contact at solar conjunction). The second NASA line, if asked: "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions… upon locally sourced information" (NTRS 20230014957).

---

## Slide 2 · What it is
**Title:** Marswalk plans the walk, checks it, and guides it, offline

**On-slide text (24 words, counting the step numbers):**
> 1 Habitat console plans and checks.
> 2 A signed 11 KB route goes to the helmet.
> 3 The visor guides, even with no link.

**Visual:** three panels, left to right, with arrows between:
1. `qa/screens/ux5/route.png`: crop the map plus the green GO card with its checklist (spare time, space weather, daylight, suit heat, limit). The screenshot was regenerated on 15 Nov and may change again; use the latest one.
2. `qa/screens/visor2/02-new-route.png`: crop the "INCOMING ROUTE · ED25519 ✓ VERIFIED · NEW ROUTE v1" modal.
3. `qa/screens/visor2/04-station.png`: full frame. It has the real Curiosity Mastcam photo with its credit line.

**Source line:** Real Gale crater data; habitat, rover and sol are scenario (labelled SCENARIO in the app). Photo: NASA/JPL-Caltech/MSSS, Curiosity Mastcam, sol 4631.

**Speaker notes:** Three parts. (1) The habitat console plans on real NASA terrain and checks every plan against 12 constraints drawn from public NASA EVA documents, each cited (3 values are our design parameters, labelled). (2) The route is signed (Ed25519) and about 11 KB; Curiosity's daily uplink is about 28 KB. (3) The visor shows distance, walk-back margin, minutes to shelter, latest departure time and suit heat against 352 W, plus Curiosity's photo at each stop. If the link drops, it goes autonomous within about 3 s. Plans take 37.9 ms median and re-plans 8.3 ms median, on a laptop.

---

## Slide 3 · Explains the verdict
**Title:** A NO-GO says why, where, and what to do instead

**On-slide text (23 words):**
> No radio contact for 13 min, limit 10.
> The failing stretch is marked red.
> Ways forward: closest safe point, or move the rover.

**Visual:** `qa/screens/ux7/nogo-highlight.png`: crop the map with the red label "No radio 13 min (limit 10)" plus the NO-GO card with its **Closest safe point** / **Move rover closer** buttons. Inset, bottom right: the card from `qa/screens/ux6/closest-safe-point.png` ("Closest safe point: 35 m short of your pin").

**Source line:** Constraint: maximum time without line of sight, a NASA FOD traverse constraint (Caswell et al., ASCEND 2025, NTRS 20250006063); the 10 min value is a team design parameter, labelled "E" in the app.

**Speaker notes:** Most planners give a verdict. This one gives the reason, the place and the fix. The same check runs before you commit (on the pin) and after (in the plan), and they agree (UX test 20). Details → Report adds "What was tried", "Why it failed" and "Ways forward" (`qa/screens/ux7/details-report-nogo.png`). NASA's review literature names usability and explanation as under-evaluated: "an explicit lack of emphasis placed on evaluating the usability" (NTRS 20250011652).

---

## Slide 4 · The mission-design result
**Title:** Our model shows why Mars walks start from a rover

**On-slide text (25 words):**
> From the habitat: 0 of 12 stops reachable.
> Climb back ≈800 W versus 352 W suit cooling.
> Unlimited cooling: still 0.
> From the rover: GO.

**Visual:** left, crop of `qa/screens/ux6/rover-suggestion.png`: the right-hand NO-GO card ("the walk runs 41 min past the EVA time limit… The stops are about 220 m below Hab-1: the climb back costs ≈817 W against the suit's 352 W cooling limit…") with the cyan **START FROM ROVER INSTEAD** button and the line "Starting from PR-1 gives an OK plan". Right, a small table built from `Validation/v3_impact/heat_sensitivity.json`:

| Suit cooling budget | Stops reachable from the habitat | What blocks the 12 stops |
|---|---|---|
| 352 W (NASA sizing) | 0 of 12 | EVA time 7 · shelter time 2 · distance 3 |
| 400–1,500 W | 0 of 12 | radio contact 7 · shelter time 2 · distance 3 |

**Source line:** Our model's result, consistent with NASA's rover-based Mars architecture (DRA 5.0, SP-2009-566); not a NASA finding. 352 W: NASA ICES-2026-127. ≈800 W is modelled at 0.38 g, an extrapolation. `Validation/v3_impact/heat_sensitivity.json`

**Speaker notes:** This is the insight to lead with, ahead of any percentage. The boxwork sits about 220 m below the habitat, and the loaded climb back costs about 800 W (modelled) against NASA's 352 W suit sizing figure. The forced rests overrun the 6-hour EVA. The result doesn't hinge on our heat model: at 1,500 W of cooling, radio contact, the 30-minute shelter limit and the 2 km radius still block every stop. A pressurized rover parked near the stops fixes all four at once, which is how NASA's reference plans use rovers. In 60 of 60 simulated scenarios from the habitat, Marswalk correctly says "stay in".

---

## Slide 5 · NASA data used (criterion 10)
**Title:** Every layer is NASA data, and the key layers drive the engine

**On-slide text (21 words):**
> Five NASA Mars missions at Gale, Perseverance at Jezero, plus NASA space-weather forecasts.
> Terrain matches 372 Curiosity positions: σ 19 cm.

**Visual:** a credits table (build it as a slide table; columns fixed), plus a thumbnail of `qa/screens/ux6/layers-panel.png` (the in-app layer list with mission, instrument and resolution per layer).

| Mission | Instrument / product | What it does in Marswalk | Credit |
|---|---|---|---|
| Mars Reconnaissance Orbiter | HiRISE stereo DTMs merged with CTX (plus HRSC and MOLA): USGS MSL Gale merged DEM, 1 m | Slope limit, walking energy, radio line of sight, sunlight, dose shielding | NASA/JPL/University of Arizona; NASA/JPL/MSSS; USGS (Parker & Calef 2016) |
| Mars Reconnaissance Orbiter | HiRISE colour mosaic, 0.25 m | Base map | NASA/JPL/University of Arizona |
| Mars Reconnaissance Orbiter | CRISM FRT000058A3 summary parameters, 18 m | Hydrated-sulfate signal at stops (indicative) | NASA/JHUAPL |
| 2001 Mars Odyssey | THEMIS thermal inertia, 100 m | Terrain factor in walking effort (indicative) | NASA/JPL/ASU; USGS Astrogeology mosaic |
| Mars Science Laboratory (Curiosity) | Traverse and waypoints (MMGIS); Mastcam and Navcam raw images; RAD dose (PDS PPI); REMS weather | Real science stops, terrain check, photo at each stop, dose check, weather | NASA/JPL-Caltech/MSSS (Mastcam); NASA/JPL-Caltech (Navcam, MMGIS); RAD: NASA/JPL-Caltech/SwRI; REMS: NASA/JPL-Caltech/CAB (CSIC-INTA) |
| Mars Global Surveyor | MOLA | Datum (inside the merged DEM) | NASA/GSFC |
| Viking | MDIM 2.1 colour mosaic | "Where on Mars" locator | NASA/USGS, via JPL Mars Trek |
| Mars 2020 (Perseverance), Jezero site | HiRISE DTM and ortho, traverse, Mastcam-Z/Navcam, MEDA | Second site, same engine | NASA/JPL-Caltech/ASU; NASA/JPL-Caltech/CAB |
| Heliophysics, NASA GSFC CCMC | DONKI WSA-ENLIL CME runs and flare notices | Space-weather go/no-go for the EVA date | NASA CCMC |
| NASA GISS | Mars24 algorithm | Sun position, daylight rule, sun heading | Allison & McEwen 2000 |

`[verify in app]`: confirm each credit line against the console's **Details → Sources** tab before export. HRSC is an ESA Mars Express instrument (ESA/DLR/FU Berlin); it's inside the USGS merged DEM, so credit it, but don't count it as a NASA mission.

**Source line:** Product IDs, resolutions and sha256 checksums: `SitePacks/gale-v1/manifest.json`, shown in the app's Sources tab. Jezero terrain vs 220 Perseverance waypoints: σ 0.07 m.

**Speaker notes:** The important layers do work, not decoration. The elevation model drives the slope limit, walking energy, radio line of sight, sunlight and dose shielding. THEMIS feeds walking effort. CRISM shows where the orbiter sees sulfate at each stop. CCMC's real forecasts drive the space-weather go/no-go. Data kinds: optical, topographic and thermal are fully used; spectral, radiation, atmospheric and geophysical partly; space weather in addition; chemical not at all.

---

## Slide 6 · Evidence
**Title:** Each model is checked against measured NASA data

**On-slide text (23 words):**
> Suited walking energy: 10.6% mean error (0.22–0.32 g).
> Terrain shielding: 2.0 pp.
> Dose: within 4% of Curiosity RAD.
> Not tested with suited people.

**Visual:** three charts side by side, each with a one-line caption:
1. `Validation/v2_metabolic/v2_model_vs_data.png`, **left panel only** (measured vs model by gravity and grade). Caption: "NASA suited data, 0.12–0.32 g. Mars 0.38 g = extrapolation." Don't show the right panel: its title says "MAPE 21%" (all gravities), which will confuse unless you explain it.
2. `Validation/v1_shielding/v1_predicted_vs_measured.png`, **left panel only** (obstructed-sky ratio, ours vs Guo et al. 2026). Caption: "Reproduces RAD terrain shielding: MAE 2.0 pp, r 0.94, n 15."
3. `Validation/v5_rad_dose/v5_measured_vs_modelled.png`, **left panel only** (dose vs REMS pressure). Caption: "Year-1 mean: 198.8 vs 207.8 µGy/day measured."

**Source line:** V2: Pandolf–Santee × Mars g vs NASA IST-2 suited VO₂ (Norcross 2010): 10.6% at 0.22–0.32 g, 36% at 0.12–0.17 g, 20.8% overall. V1: metric chosen post hoc among 3 readings. V5: at measured pressure; −9% at the scenario season; route doses ±30%. V4: engine, independent checker and blind AI judges agree on 23 of 24 walks.

**Speaker notes:** Say "calibrated" and "reproduces", never "validated". Each check has a stated limit: 0.38 g is extrapolated; the V1 metric was picked after seeing the data, and we say so; the V5 match is against the early RAD data the published dose model was fitted on, so it's a consistency check, and measured dose at this season spans 167–296 µGy/day across the solar cycle. The search itself is exact: A* has a 0.000% gap against an independent oracle on 80 real-terrain cases, and stop selection matches brute force on 320 cases. The code has 122 unit tests and 26 real mouse-and-keyboard tests. The one V4 disagreement (W02) is a safe-side engine NO-GO, 0.22 min over the radio limit.

---

## Slide 7 · Impact, next, disclosure
**Title:** The habitat crew gets checked plans in milliseconds, without Earth

**On-slide text (24 words):**
> Slope-only plans broke a NASA EVA constraint in 99.5% of 200 walks; ours, 0%.
> +5% science when time is short.
> Next: analog field test.

**Visual:** two small bar charts, built from `Validation/numbers.json` (no other source):
- **A.** Share of 200 seeded Gale plans breaking at least one constraint: slope-only `v3.pctNaiveUnsafe` = 99.5%; Marswalk = 0% (simulator-verified).
- **B.** Science value vs nearest-first **with the same safety checks**, 12 candidate stops, 2–4 h available (`v3.oversubscribed`): mean +5.0%, better in 62.5% of cases, never lower (0%).
- Under the charts, one strip: "Re-plan 8.3 ms median · route 11 KB · second site: Jezero".

**Source line:** `Validation/v3_impact`: the slope-only plan is the common baseline (81 of 135 Space Apps 2026 READMEs) and a strawman by construction. With ample time, nearest-first with our checks picks the same stops. AI use: most code written with Claude coding agents under team direction and review; no AI in the safety path; no AI imagery. Repo [URL] · Demo [URL] · Video [URL]

**Speaker notes:** Read the 99.5% only together with the +5%. Who uses it: the habitat crew member who "essentially performs the roles of IV, Flight Director, partial EVA Officer" (EVA-EXP-0042 Rev B §8.1); NASA analog campaigns as a side tool (predicted vs measured effort); exploration-zone studies (reach from habitat vs rover); suit designers (what's walkable for a given heat budget). Scale: reference Mars missions have 6 crew for about 500 days, with suits designed for up to 24 EVA-hours per person per week (SP-2009-566; NTRS 20220004017). Limits: simulation only, no suited-human tests, no NASA relationship, science values are our heuristic, and no "hours saved" claim, because there's no published baseline. Next: an analog field test comparing predicted and measured effort; the visor on real helmet hardware; trying more than one path before a NO-GO (the W02 fix).

---

## Export checklist
- [ ] 7 slides, 16:9, PDF export for the submission plus the live file.
- [ ] Every number on a slide appears in `docs/CRITERIA_ANSWERS.md` or `Validation/numbers.json`.
- [ ] No NASA logos; Space Apps 2026 brand mark only on slides 1 and 7.
- [ ] No screenshot from `qa/screens/ux/` or the root `qa/screens/0*.png` (old orange look) and no `visor2/mock-*` image (synthetic terrain), unless the slide labels it as demo mode.
- [ ] Credit lines on slide 5 checked against the Sources tab `[verify in app]`.
- [ ] Repo, demo and video URLs filled in on slide 7.
