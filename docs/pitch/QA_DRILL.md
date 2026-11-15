# Marswalk: Q&A drill (the 20 hardest questions)

*Each answer is under 20 seconds spoken (50 words or fewer) and ends by pointing at proof. Numbers come from `docs/CRITERIA_ANSWERS.md` and `Validation/numbers.json` only. Owners: **S1** story/evidence, **S2** console/engine, **S3** visor/impact. Drill: each owner says their answers out loud against a timer until all are under 20 s, then the others ask them out of order.*

**How to answer**
1. Answer the question in the first sentence. If the answer is "no", start with "No".
2. When a judge finds a limit, agree first ("Yes, that's a limit"), then point to where we already state it: the in-app Evidence panel (key **E**), `Validation/*/README.md` or the Rules tab.
3. Never say "validated", "NASA flight rules", "safe for crew", "saves hours" or "discovered".
4. If you don't know, say "I don't know. Here's what we measured instead." Don't guess numbers.

---

### 1. "Isn't this just A* with a slope mask?" (S2)
> "The path search is standard, yes. The slope mask is 1 of 12 checks. Every candidate is re-walked against walk-back at half speed, shelter within 30 minutes, radio gaps, daylight, suit heat and distance. In 200 Gale walks, slope-only plans broke one of those 99.5 percent of the time."

**Evidence:** `Validation/v3_impact/README.md`; `Shared/src/contracts/rules.ts` (12 rules, each cited); Details → Rules (`qa/screens/ux7/details-rules.png`).

### 2. "Isn't 99.5% a strawman?" (S1)
> "Yes, by construction, and our README says so. It shows what an unchecked map plan does, and 81 of 135 Space Apps entries plan on slope. The fair test is nearest-first with our same safety checks. There our gain is science: 5 percent more when time is short, never less."

**Evidence:** `Validation/v3_impact/README.md` ("Honest caveats"); `Validation/v3_impact/summary_oversub.json`.

### 3. "Your planner picks the same stops as nearest-first. What does it add?" (S2)
> "At Gale with ample time, the safety rules decide the outcome, so yes, same stops. What we add there is the check, the explanation and the speed: re-plans in 8.3 milliseconds median. With 2 to 4 hours, it beats nearest-first in 62.5 percent of cases and never loses."

**Evidence:** `Validation/numbers.json` → `v3.pctMarswalkEqualToNearestFirst` = 100, `v3.oversubscribed.pctAGreater` = 62.5, `pctBGreater` = 0, `replanP50Ms` = 8.3.

### 4. "How do you know the numbers are right?" (S1)
> "We compared each model with measured NASA data: suited walking tests, Curiosity's radiation detector, Curiosity's own positions for the terrain. The search is exact: A* matches an independent oracle on 80 real-terrain cases, and stop selection matches brute force on 320. Plus 122 unit tests and 26 real-input tests."

**Evidence:** `Validation/numbers.json`; `Validation/v1_shielding`, `v2_metabolic`, `v5_rad_dose`; `Research/bench/results/latest`; `qa/e2e/interactions.spec.ts`.

### 5. "Is your walking model right at Mars gravity?" (S1)
> "We don't know at 0.38 g, and we say so. It's calibrated on NASA suited data: 10.6 percent mean error from 0.22 to 0.32 g, and 36 percent at 0.12 to 0.17 g. Mars is an extrapolation. That's why walk-back is planned at half speed."

**Evidence:** `Validation/v2_metabolic/README.md`, `v2_model_vs_data.png`; NASA/TP-2010-216125 (Norcross 2010).

### 6. "Your dose matches Curiosity within 4%. Isn't that fitted to the same data?" (S1)
> "Mostly, yes. The published model was fitted on early Curiosity data: a consistency check, not a test. At our scenario season it's 9 percent low, and measured dose swings from 167 to 296 microgray a day over the solar cycle. So route doses are plus or minus 30 percent."

**Evidence:** `Validation/v5_rad_dose/README.md`; `numbers.json` → `v5`.

### 7. "You picked the shielding metric after seeing the results?" (S1)
> "Yes. We picked one of three readings of 'obstructed sky' after seeing the data, and we disclose it. With it, we reproduce Guo et al. 2026 to 2.0 percentage points over 15 comparisons. Terrain is never treated as a shelter: the largest measured drop is 19 percent."

**Evidence:** `Validation/v1_shielding/README.md`; `numbers.json` → `v1.mae_pp_by_definition`.

### 8. "What's real data and what's assumed?" (S2)
> "Real: terrain, imagery, thermal inertia, CRISM, Curiosity's route, photos, weather and radiation, and NASA's space-weather forecasts. Scenario: where the habitat and rover sit, the sol, the crew. Assumed and labelled: thermal inertia to effort, the dose constants, the rover relay, three rule values, and the science scores."

**Evidence:** Details → Sources tab; Rules tab evidence chips M/A/D/S/E; SCENARIO tag in the top bar; Layers "Indicative" badges (`qa/screens/ux6/layers-panel.png`).

### 9. "Are these NASA's flight rules?" (S2)
> "No. Mars flight rules aren't public. These are 12 constraints drawn from public NASA EVA documents: the xEVA concept of operations, the Artemis III EVA tenets, DRA 5.0, and Caswell 2025's traverse constraints. Each is cited in the app. Three values are our own design parameters, marked as ours."

**Evidence:** `Shared/src/contracts/rules.ts`; Details → Rules (evidence class E = walk-back speed 0.5, radio gap 10 min, sun elevation 5°).

### 10. "The habitat walk fails. Isn't that just your heat model?" (S2)
> "No, it fails four ways. Under NASA's 352-watt suit figure, the climb back overruns the 6-hour EVA. Raise cooling to 1,500 watts and every stop still breaks radio contact, the 30-minute shelter limit or the 2-kilometre radius. A rover parked near the stops fixes all four."

**Evidence:** `Validation/v3_impact/heat_sensitivity.json`; Hab-1 NO-GO card (`qa/screens/ux6/rover-suggestion.png`); DRA 5.0 (SP-2009-566).

### 11. "Can it ever give an unsafe plan?" (S2)
> "It never returns a plan that breaks the 12 encoded constraints. Every candidate is re-walked in a simulator, and 'stay in' is always allowed. That covers our rules and models, not real people. And it can be too cautious: one test walk was a NO-GO at 0.2 minutes over."

**Evidence:** engine tests (`Shared/src/engine`); `Validation/v4_crosscheck/README.md` (W02); 1,000 randomised cases independently re-checked (`docs/JUDGING.md` §5).

### 12. "Why would NASA use this?" (S3)
> "NASA's EVA concept of operations says Mars crews will plan more of their own EVAs, with automated tools. Today's EVA planner serves ground controllers. We have no NASA relationship. Realistic first uses: analog field campaigns comparing predicted and measured effort, and studies of reach from habitat versus rover."

**Evidence:** EVA-EXP-0042 Rev B §8.1; NTRS 20260001893; `docs/research/impact-evidence.md` §4.

### 13. "What exists already? AEGIS, SEXTANT, Mars Trek?" (S3)
> "Good tools, and some have real users we don't. Mars Trek is a viewer. AEGIS plans Artemis EVAs for ground controllers. SEXTANT and MoonPath find energy-efficient paths. Joint AR is building the helmet display. None is an offline crew planner that enforces cited constraints, explains NO-GOs and guides the walk."

**Evidence:** `docs/CRITERIA_ANSWERS.md` §3 table; `docs/research/existing-solutions.md`.

### 14. "What did AI do, and what did the team do?" (S1)
> "The team chose the problem, concept, design and data, and reviewed everything. Claude coding agents wrote most of the code under our direction; AI also helped draft docs and these pitch materials, which we edited. No AI decides a route. Blind AI reviewers were only an extra check."

**Evidence:** `README.md` (AI disclosure); `Validation/v4_crosscheck/ai_judge_instructions.md`; project page "Use of AI". `[team to confirm the exact split before saying it]`

### 15. "Has anyone in a suit, or an astronaut, used it?" (S3)
> "No. It's simulation only: no suited-human tests, no field test. What we did test is usability: 26 automated tests that drive the console with real mouse and keyboard input. The next step is an analog field test that compares the predicted effort with measured effort."

**Evidence:** `qa/e2e/interactions.spec.ts` (26 tests); Evidence panel → Limitations.

### 16. "Does it work anywhere but Gale? The Moon?" (S2)
> "A second Mars site, Jezero, runs on the same engine with no code changes. Its terrain matches 220 Perseverance positions to 7 centimetres. The pipeline needs HiRISE-class stereo terrain. The Moon isn't demonstrated, so we don't claim it."

**Evidence:** `SitePacks/jezero-v1`; `qa/screens/sites/jezero.png`; UX tests 16–18 and 24.

### 17. "Is the visor showing real data, or a mock-up?" (S3)
> "Real. In the demo the visor runs on the hab server with the real Gale terrain, and the station photo is Curiosity's Mastcam image from sol 4631. There's also an offline demo mode, and it says 'synthetic terrain' on screen. We only use it to show states without the server."

**Evidence:** `qa/screens/visor2/README.md`; `visor2/03-nav.png`, `04-station.png` (live) vs `mock-*.png` (labelled synthetic).

### 18. "Would this run on Mars hardware?" (S3)
> "The heavy solving runs in the habitat: a plan takes 38 milliseconds median on a laptop. The visor only does constant-time lookups on a 50-metre safety grid inside an 11-kilobyte route. Today the visor is a screen app and the link is local Wi-Fi, not suit hardware."

**Evidence:** `numbers.json` → `v3.planP50Ms` = 37.9; `qa/screens/timings.json` (`packageBytes` 10994); `docs/EXPLAINER.md` §5.8.

### 19. "Why 1.7 seconds in one place and 38 milliseconds in another?" (S2)
> "Both are right. The first plan of a session computes the safety fields once, which takes about 1.7 seconds. After that, plans take 37.9 milliseconds median and re-plans 8.3. The 1.7 is a one-time warm-up."

**Evidence:** `qa/screens/timings.json` (`planSolveMs` 1640); `numbers.json` → `v3.planP50Ms`, `replanP50Ms`.

### 20. "Where do the science values come from?" (S3)
> "The 12 stops are real Curiosity boxwork-era targets, each cited to a NASA mission blog post and traced to an objective. The 0-to-100 values are our team's scoring, not NASA's rankings. That's why we only claim relative gains on our own scoring."

**Evidence:** `Content/stations.gale.json` (citations per station); Details → Science tab; `Validation/v3_impact/README.md` ("Science values are the team's STM heuristic").

---

## Backup answers (if there's time)
- **"What if the link drops?"** "Within about 3 seconds the visor goes autonomous on the last confirmed route, using its onboard safety core. Telemetry back-fills when the link returns." *Evidence:* `timings.json` (`dropToAutonomousMs` 3394, `restoreToResyncMs` 1763).
- **"Solar storms?"** "Three tiers: real WSA-ENLIL forecasts of CME arrivals at Mars for go/no-go; flare alerts from Earth, light-delayed; and an onboard dose spike, the only 'return now' trigger. That's why shelter must stay within 30 minutes." *Evidence:* Details → Weather & radiation (`qa/screens/ux8/weather-gale.png`).
- **"Why 5 × 5 km?"** "NASA keeps walkers within about 2 km of the base. 5 km covers that with margin at the 1-metre detail walking safety needs. Moving the rover moves the base." *Evidence:* NTRS 20230008183.
- **"Is the route secure?"** "Every route is signed with Ed25519, and the visor verifies it before showing it. Versions are numbered, and nothing replaces the route until the astronaut accepts." *Evidence:* `qa/screens/visor2/02-new-route.png`.
