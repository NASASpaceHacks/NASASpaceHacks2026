# Marswalk explained: what we built, how it works, and why

*For everyone on the team. Read top to bottom once (~20 min), then use it as a reference.
For questions, open a fresh Claude session and say: "Read docs/EXPLAINER.md and the repo, then answer my questions."*

---

## 1. The project in one paragraph
On Mars, Earth is 3–22 light-minutes away, and for about two weeks every 26 months (solar conjunction) it can't be reached at all. So the first astronauts can't rely on Mission Control to keep them safe on a walk. **Marswalk** is the system the crew uses instead.
- A **habitat EVA officer** plans the walk on a correct map of the real terrain, built from several NASA missions. The planner enforces NASA's real safety rules and picks the best science stops.
- The officer confirms the plan, and it's sent over the local surface radio link to the **astronaut's helmet visor**.
- The visor guides the astronaut. If the link drops, it still brings them home.
- Everything runs on Mars, with no internet.

## 2. The challenge, and how we answer it
The NASA challenge: *"create a layered, integrated view of a location or route on the Martian surface that pulls together data from multiple NASA science missions and could help a human explorer plan and carry out a successful Marswalk while conducting new and exciting science along the way."*

| Clause | Our answer |
|---|---|
| Layered, integrated view | The map layers aren't just stacked; they're **fused** into one "safe zone", a constraint report and a route |
| Location or route on Mars | Gale crater / Mount Sharp: a 5 × 5 km area on Curiosity's real 2025–26 "boxwork" traverse |
| Multiple NASA missions | MRO (HiRISE terrain + colour images), Mars Odyssey (THEMIS thermal inertia), Curiosity (traverse, photos, REMS weather, RAD radiation research), MGS (MOLA), heliophysics fleet via CCMC DONKI (space-weather forecasts) |
| Help **plan** | The Habitat Console generates and explains a safe plan |
| …and **carry out** | The Visor navigates, watches safety margins, and works without a link |
| New and exciting science | 12 real Curiosity boxwork-era targets in a Science Traceability Matrix; the planner maximises science value within the safety rules |

**Judging criteria** (each scored 1–5, equal weight): Impact, Creativity, Validity, Relevance, Presentation. The local Toronto round is a live pitch. Global judges see the project page plus a **≤30-second video** (going over means disqualification).

## 3. The system: three parts
```
 EARTH (optional, delayed)        MARS SURFACE (no internet)
 Earth relay  ──3–22 min──▶  HAB SERVER (Backend)  ◀── surface link (WebSocket) ──▶  ASTRONAUT VISOR (UserView)
 (space-weather                engine, event log,       signed routes ~11 KB              moving map + instruments +
  bundles)                     site pack                telemetry, heartbeats             its own safety core
                                     │
                              HABITAT CONSOLE (AdminView): plan → review → CONFIRM → monitor → re-route
```
- **Backend = the habitat's computer.** It runs the route engine, keeps an append-only event log (so it recovers after a crash), signs routes with Ed25519, and relays messages between console and visor.
- **Frontend/AdminView = the Habitat Console.** The EVA officer's screen.
- **Frontend/UserView = the EVA Visor.** What the astronaut sees in the helmet. It's a GUI today; it's built so the logic can move to real helmet hardware later.
- **Design principle: "heavy in the hab, light on the helmet, async with Earth."** The hard computing happens in the habitat. The helmet only does cheap lookups. Earth only ever sends small, late messages.

## 4. One EVA, start to finish (what the demo shows)
1. **Map.** The console opens on real HiRISE imagery of the boxwork, lit by the sun at the planned start time. The scale bar is in true **Mars metres**: web map libraries assume Earth's radius, so we fixed that.
2. **Plan.** The officer picks the **EVA base** (habitat *Hab-1* or pressurized rover *PR-1*) and presses **Generate plan**. The engine returns an **OK** plan (about 6 stations, about 4 hours), or **STAY IN**. Either way it explains the **binding constraint**, the margins, and why each station was dropped.
3. **The insight.** From Hab-1 the answer is STAY IN.
   - The boxwork sits about 200 m below the habitat.
   - Walking back uphill carrying 211 kg (crew + suit) at Mars gravity costs about 800 W.
   - A Mars suit can only shed about 352 W on average, because its evaporative cooler works poorly in Mars air.
   - The suit's heat limit forces so much resting that even the nearest station overruns the 6-hour EVA.
   - **Staged from the pressurized rover, the plan is OK.** This matches NASA's Mars reference architecture (DRA 5.0), where pressurized rovers act as mobile bases. *From the habitat, four limits block every stop at once: suit heat on the climb back, radio contact, shelter time and distance. Even with unlimited suit cooling the walk still fails, so this doesn't hinge on our heat model. The rover fixes all four (consistent with NASA's rover-based plans).*
4. **Explain safe zone.** The reachable area shrinks one NASA rule at a time (slope → distance → walkback → shelter time → comm line of sight), then the route draws itself inside it.
5. **Confirm and push.** The route package (about 11 KB; Curiosity's whole daily uplink is about 28 KB) is signed and pushed. The visor verifies the signature, and the astronaut presses **A** to accept. The console sees the ACK.
6. **Walk.** The visor shows:
   - a heading-up map
   - the bearing and distance to the next stop
   - walkback and shelter margins
   - a "bingo" countdown (the latest time to leave)
   - a heat/pace advisory
   - a heading cue taken from the sun (Mars has no global magnetic field, so no compass)

   At each station a card shows the **science objective, the crew tasks and Curiosity's real photo** of the spot.
7. **Solar storm.** The onboard dose rate rises 25% (a "nowcast"). The engine replans a return to the nearest shelter in under 1 s. The officer confirms route v2; the visor shows RETURN NOW.
8. **Link loss.** The officer clicks Drop link. Within about 3 s the visor goes **AUTONOMOUS** and keeps guiding home on the last confirmed route. When the link returns, queued telemetry back-fills.
9. **Crash.** Reload the visor and it restores its state in well under a second. Radiation-induced crashes are the realistic failure mode for off-the-shelf electronics on Mars.

Measured end-to-end, on real Gale data with the real engine:

| Step | Time |
|---|---|
| Plan solve | ~1.7 s |
| Confirm → visor verified | ~1.3 s |
| Accept → ACK | ~0.25 s |
| Storm replan | ~0.65 s |
| Link drop → autonomous | 2.3–3.4 s |
| Crash restore | 0.1–0.3 s |

## 5. The route engine, simply (`Shared/src/engine/`)
1. **Terrain grid.** The 5 × 5 km area is cut into 1 million cells of 5 m × 5 m, holding elevation, slope, roughness and thermal inertia.
2. **What blocks a cell.** A cell is impassable if:
   - it's steeper than **20°** (NASA's limit for a suited crew)
   - it's inside a keep-out zone (e.g. the 1 km rocket-plume zone around the landing pad)
   - it has no data
   - **or** the *step* between two cells is steeper than 20°, even if each cell alone isn't. This came from George's research.
   - Diagonal moves can't squeeze between two blocked cells.
3. **How much a step costs.** The **Pandolf–Santee** walking-energy equation, which NASA JSC uses, treats the 121 kg suit as load and is scaled to Mars gravity. Walking time = distance ÷ speed (0.56 m/s nominal). A **heat governor** keeps the 30-minute average metabolic rate within the suit's 352 W budget by inserting rests.
4. **Safety fields.** One-to-many shortest-path searches (Dijkstra with a bucket queue) compute, for *every* cell:
   - **walkback time** to the base at half speed (a slowed, degraded crew member)
   - **time to the nearest shelter** (habitat or pressurized rover)
   - **outbound time**
   - **comm line of sight** to the habitat mast or the rover's relay mast
5. **Choosing stations.** An **exact** optimisation (bitmask dynamic programming over up to 15 stations) picks the subset and order with the most science value that fits the time.
6. **Simulator check.** The best candidates are walked step by step in a simulator that checks **every hard rule at every step**: slope, walkback, shelter ≤ 30 min, comm gaps ≤ 10 min, daylight, heat, distance, keep-outs. "Stay in" is always a valid answer, so **the planner can never return an unsafe plan**.
7. **Outputs.** The plan comes with:
   - the **binding constraint**: which rule, if relaxed 10%, would gain the most science
   - **why each station was dropped**
   - **bingo times**
   - **burndown charts**: margins over time
8. **Route package + safety core.** The route is compressed (about 11 KB) together with a coarse 50 m safety grid. The visor's **safety core** uses that grid for constant-time lookups (walkback margin, shelter margin, return bearing) with zero memory allocation, small enough for flight hardware.
9. **Space weather in three tiers** (the radiation officer's view):
   1. **Forecast:** NASA's WSA-ENLIL model predicts coronal mass ejection (CME) arrivals at Mars days ahead, giving a GO or CAUTION call for the EVA date. These are real forecasts from CCMC DONKI.
   2. **Alert:** flare notices from Earth arrive 3–22 minutes late; useful as a heads-up only.
   3. **Nowcast:** the onboard dose rate jumps 25% or more. This is the **only** "return now" trigger, because it gives at least ~30 minutes of warning. That's why shelter time must stay ≤ 30 min everywhere along the route.
10. **Radiation (indicative).** Dose rate comes from a published model (Guo 2015) plus terrain shielding (Guo 2026: cliffs block part of the sky). **Terrain is never a shelter**: the largest measured drop is 19%.

## 6. The data (`Pipeline/` builds `SitePacks/gale-v1/`)
| Layer | Source (mission / instrument) |
|---|---|
| Elevation 1 m → 5 m grid, slope, roughness | USGS Gale merged DEM (HiRISE/CTX/HRSC/MOLA) |
| Colour imagery | HiRISE colour mosaic (MRO) |
| Thermal inertia (loose sand vs rock, indicative) | THEMIS (Mars Odyssey) |
| Curiosity traverse + waypoints | NASA MMGIS |
| Station photos (10) | Curiosity raw images (Mastcam/Navcam) |
| Weather (30 sols) | Curiosity REMS |
| Space weather (31 Mars CME forecasts + flares) | CCMC DONKI-API v2 (keyless; spec in `docs/reference/`) |
- **Projection:** a local equidistant cylindrical projection on the official Mars sphere (radius 3,396,190 m). Every layer is reprojected onto one grid.
- **Quality checks:** the elevation model matches Curiosity's own recorded elevations at 372 waypoints with σ = 0.19 m, and imagery and terrain line up to under a pixel.
- **Size:** the big files (about 58 MB) aren't in git. Rebuild them with `Pipeline/build_sitepack.py gale-v1`, or use the release asset.

## 7. Mars realities we designed around
| Reality | Design answer |
|---|---|
| No internet; Earth 3–22 min away; conjunction blackouts | Everything safety-critical works offline; Earth is optional and asynchronous |
| Tiny uplink (Curiosity ≈ 28 KB per day) | Route package about 11 KB |
| No GPS, no magnetic compass | Heading from the sun's position (Mars24 algorithm), or terrain landmarks around noon; position shown with uncertainty |
| Suit cooling is weak in Mars air | Heat governor + 352 W budget rule |
| Solar storms with only minutes of warning | Shelter ≤ 30 min everywhere; three-tier space weather |
| Radiation crashes electronics | Event log + state restore |
| Gloves and helmets | ≤ 6 big key actions, high-contrast visor, mirror mode for beam-splitter HUDs |
| Comms need line of sight | Comm-gap rule; rover as relay (team assumption, labelled) |

## 8. The science (`Content/`)
- **12 stations**, all real Curiosity 2025–26 boxwork-era targets, positioned from the rover's waypoints on the sol each was studied, each with a citation. Examples: the Altadena drill site, the Valle de la Luna and Nevado Sajama drill pair (a hollow and a ridge drilled to learn how boxwork formed), and the Atacama sulfate block.
- **Science Traceability Matrix (STM):** goals → objectives → crew actions → stations. Goal G1 is groundwater history, G2 sample selection, G3 stratigraphy.
- **Station values (0–100) are a team heuristic, not NASA rankings.** Research track R-C should re-score them.

## 9. Evidence and honesty (the Validity score)
- **V1, radiation shielding:** our terrain pipeline **reproduces** Guo et al. 2026's sky-obstruction values to **2.0 percentage points** (r = 0.94, 15 sites), and predicts Curiosity's measured dose drops within **4.3 points** (8 events). One normalisation choice was made after seeing the data, and we disclose it.
- **V2, walking energy:** within **10.6%** of NASA suited data at 0.22–0.32 g. It under-predicts at lower gravity, and Mars at 0.38 g is an extrapolation.
- **Planner benchmark** (real Gale terrain, 80 scenarios):
  - A* is exactly optimal, with 0 safety violations.
  - A naive slope-only planner looks about 5% cheaper only by taking **140–166 unsafe steps**.
- **Tests:** 115 unit tests (including dynamic programming checked against brute force), plus an end-to-end test of the whole demo flow.
- **Words we never use:** "validated" (we say "reproduces" or "calibrated"); "shelter" for terrain.
- **Limitations** are listed in the console's Evidence panel:
  - not operational guidance
  - extrapolated metabolic model
  - assumed rest power and rover relay
  - indicative thermal inertia and shielding
  - heuristic station values
- Every flight rule carries an **evidence class**: M measured, A analog, D NASA requirement, S simulated, E our assumption.

## 10. Key decisions and why
| Decision | Why |
|---|---|
| **Gale, not Jezero** | Only place terrain radiation shielding was measured (lets us validate); current weather feed; the challenge's own boxwork example; about 4× fewer competing projects. Jezero stays a possible second site using George's 1 m elevation source. |
| **2D map first, 3D optional** | The team's priority is value to NASA people; a correct 2D operational map carries more value per hour |
| **Habitat console + visor + local link** | The team's concept; matches DRA 5.0, where the habitat crew is the primary EVA support |
| **Rover-staged EVAs** | The engine's physics showed walking from the habitat is infeasible for the boxwork; NASA's architecture uses pressurized rovers as bases |
| **Rover as comm relay** | The habitat antenna can't see into the boxwork corridors; labelled as a team assumption |
| **Claude only on the Earth side (stretch goal)** | A cloud AI can't be in the crew's safety loop when Earth is 22 minutes away |
| **Strict safety over cheaper paths** | No corner-cutting, edge-grade checks, fail-closed on unknown terrain |

## 11. The repo and how to work in it
| Folder | What |
|---|---|
| `Backend/` | Habitat server (API, surface link, event log, Earth relay) |
| `Frontend/AdminView/` | Habitat Console |
| `Frontend/UserView/` | EVA Visor |
| `Shared/src/contracts/` | Shared types, flight rules, schemas (the "contract" every part agrees on) |
| `Shared/src/engine/` | Route engine |
| `Shared/src/map/` | Mars map kit (OpenLayers) |
| `Shared/src/link/` | Surface-link messaging |
| `Pipeline/` | Builds site packs from NASA data (Python) |
| `SitePacks/` | Built site packs (manifest in git, binaries not) |
| `Validation/` | V1/V2 reproductions |
| `Research/` | George's research, planner benchmark (`bench/`), research planners (`planners/`), team briefs (`tracks/`) |
| `Content/` | Stations, STM, flight rules, gazetteer |
| `qa/` | End-to-end tests + screenshots |
| `docs/` | Design doc, agent/API spec, walkthrough, this explainer |

Commands:
- `pnpm install`
- `pnpm demo`: starts everything; open the console at :5173 and the visor at :5174/?reset=1
- `pnpm ci`: typecheck + unit tests
- `pnpm e2e`: full demo flow
- `pnpm bench`: planner benchmark

**How research plugs in:** write a planner in `Research/planners/` implementing the `PathSearch` (or `CostModel`) interface, using the template there, and run `pnpm bench`. It replaces the baseline **only** if it wins on the agreed metrics **and** has 0 safety violations. Then it's a one-line config change.

## 12. Glossary
| Term | Meaning |
|---|---|
| **EVA / Marswalk** | Extravehicular activity: a walk outside in a suit |
| **EVA base** | Where the walk starts and ends (habitat or pressurized rover) |
| **Walkback** | Time to walk back to the base if something goes wrong (computed at half speed) |
| **Shelter time** | Time to reach the nearest pressurized shelter (habitat or rover) |
| **Bingo time** | The latest time to leave a stop and still keep every safety rule |
| **Binding constraint** | The rule currently limiting the plan the most |
| **Burndown** | Charts of margins over time (O₂, walkback, shelter, heat) |
| **STAY IN** | No safe plan exists under the rules, so don't go out |
| **LTST / LMST / Sol** | Mars local true / mean solar time; a sol is a Mars day (24 h 39 min) |
| **SEP / CME / ENLIL / DONKI** | Solar energetic particles / coronal mass ejection / NASA's solar-wind model / NASA's space-weather database |
| **DEM / DTM** | Digital elevation (terrain) model |
| **HiRISE, CTX, THEMIS, MOLA, REMS, RAD** | Mars instruments: high-res camera, context camera, thermal imager, laser altimeter, Curiosity weather station, Curiosity radiation detector |
| **Site pack** | All the data for one site, on the engine grid, plus a manifest |
| **FOD** | NASA's Flight Operations Directorate (they define EVA flight rules) |
| **DRA 5.0** | NASA's Mars Design Reference Architecture |
| **Safety core** | The tiny, fast safety logic that runs on the visor |

## 13. Open items and next-iteration ideas
- Walk through the product, note bugs and ideas (`docs/WALKTHROUGH.md` has a table), then iterate.
- Publish the site-pack release asset, so teammates can run `pnpm demo` right after cloning.
- Research: D* Lite / Field D* planners, CVaR risk cost, re-scored station values (`Research/tracks/README.md`).
- Optional: Jezero second site; CRISM mineral layer; Claude "Earth science backroom" summaries; 3D inspect view.
- Later: pitch, 30-second video, project page (drafts exist in `docs/pitch/`, to be rewritten after iteration).
- Team decisions still open: product name; confirm the Toronto judging time.
