# NASA data, the Admin View, and how routing weights changed

A team reference covering three questions: which NASA datasets Marswalk uses, how the Admin View (habitat
console) uses each one, and how the route "weights" changed from the first research prototype to the engine
we ship. All numbers below come from the code as of `d274970` (branch `marswalk`).

Related docs: [SitePacks/README.md](../../SitePacks/README.md) · [Pipeline/README.md](../../Pipeline/README.md) ·
[Content/stm.yaml](../../Content/stm.yaml) · [ROUTING_ALGORITHM.md](../../Research/docs/architecture/ROUTING_ALGORITHM.md) ·
[bench leaderboard](../../Research/bench/results/latest/leaderboard.md)

---

## 1. NASA datasets

`Pipeline/build_sitepack.py` builds the `gale-v1` site pack (5 km × 5 km around 137.388°E, −4.805°N, on a
1000 × 1000 grid of 5 m cells). It reads only the area-of-interest window of each remote raster through GDAL
`/vsicurl/`. Every layer has a `provenance` entry in `SitePacks/gale-v1/manifest.json` with mission, product,
URL, licence and citation.

| Dataset | Mission / instrument | What we made from it | Pack output | Caveat |
|---|---|---|---|---|
| **MSL Gale Merged DEM, 1 m v3** (USGS, Parker & Calef 2016) | MRO HiRISE stereo, merged with CTX, HRSC, MOLA | Elevation, Horn slope, roughness, surface normals | `dem.bin`, `slope.bin`, `rough.bin`, `normals.bin` | Effective resolution is a few metres, so roughness misses sub-metre rocks |
| **HiRISE colour basemap** (USGS 78-quad COG) | MRO HiRISE | Map imagery | `ortho.webp` (1 m), `ortho_cog.tif` (0.5 m) | Display only |
| **THEMIS quantitative thermal inertia, 100 m** | 2001 Mars Odyssey THEMIS | Sand vs rock proxy → terrain factor η | `ti.bin` | Flagged `indicative`. 100 m bilinear to 5 m, ±20 % |
| **MOLA 463 m** | Mars Global Surveyor MOLA | Aeolis Mons summit as a far heading landmark | `manifest.landmarks` | — |
| **Curiosity traverse + waypoints** (MMGIS `MSL_traverse.json`, `MSL_waypoints.json`) | MSL | Rover track; sol labels; image positions; rover staging | `manifest.traverse`, `traverse_waypoints.json` | — |
| **Curiosity raw images** (mars.nasa.gov raw-image API) | MSL Mastcam, Navcam | One photo per science station (≤ 60 m, stationary sols only) | `images/*.jpg`, `manifest.images` | Raw Bayer, demosaicked, not white-balanced |
| **REMS weather** (outreach feed) | MSL REMS (CAB) | Last 30 sols; season (Ls) for sun geometry | `manifest.conditions.rems` | "For outreach purposes only" |
| **DONKI** (CCMC, keyless DONKI API v2, `api.nasa.gov` first) | CCMC WSA-ENLIL, flare and SEP notifications | Mars CME arrival forecasts, flares, SEP alerts | `manifest.conditions.spaceWeather` | API schema in [donki-api-v2.openapi.json](donki-api-v2.openapi.json) |
| **Curiosity mission blog** (science.nasa.gov) | MSL | Facts and citations behind the 12 science stations and the STM | `Content/stations.gale.json`, `Content/stm.yaml` | Station coordinates ≈ 10–20 m |

Published NASA results we use as **model constants** (not raw data):

| Source | Used for |
|---|---|
| NASA/TP-2010-216125 (Norcross et al. 2010), suited partial-gravity treadmill data | Calibrating the Pandolf–Santee metabolic model; 121 kg suit mass; the 16.7° soft slope limit. Reproduced in `Validation/v2_metabolic/` |
| Kim et al. 2024 (NTRS 20240001423), NASA JSC | "Suit treated as load" Pandolf–Santee formulation |
| xEVA ConOps (EVA-EXP-0042 Rev B) | 0.56 m/s planning pace, 20° hard slope limit and other flight rules |
| MSL RAD (Hassler et al. 2014; Guo et al. 2015, 2026) | Surface dose rate vs pressure, quality factor 3.05, terrain shielding. Shielding reproduced in `Validation/v1_shielding/` |
| NSSDC Mars Fact Sheet | 11 km scale height for pressure vs elevation |

Siting of HAB, ROVER1 and landing pad LZ-1 is **our own heuristic** (`Pipeline/mwpipe/siting.py`), not a NASA
selection. The scenario sol (412) is fictional.

---

## 2. How the Admin View uses them

The Admin View (`Frontend/AdminView`) loads the site pack from the hab server at `/sitepacks/gale-v1/`.

| Data | Where in the Admin View | What the operator sees or gets |
|---|---|---|
| HiRISE ortho | `map/MapController.ts` | Basemap under every overlay |
| DEM / slope / roughness | `lib/zone.ts`, `map/MapController.ts`, engine cost grid | Slope overlay, "safe zone" mask (slope ≤ `slope_max_deg`), hillshade, terrain-aware travel times |
| THEMIS TI | `components/LeftRail.tsx` overlay; engine η | "Thermal inertia" layer (sand → rock ramp, labelled indicative). Low TI makes walking costlier in the metabolic model |
| Traverse + waypoints | `TopBar`, `LeftRail`, `MapController` | Curiosity's track on the map and sol labels |
| Rover images | `lib/science.ts` `stationImage()`, Plan tab, Evidence panel | The Curiosity photo nearest each station, with credit |
| REMS | `actions.ts` | Latest Ls sets the season for the sun-elevation model (daylight rule, sun layer). Falls back to engine `DEFAULT_LS_DEG = 240` |
| DONKI ENLIL | `lib/spaceweather.ts`, `components/SpaceWeather.tsx` | **Tier 1 forecast**: CAUTION if a predicted Mars CME arrival is within ±24 h of the planned EVA start, else GO. Duplicate runs are merged |
| DONKI FLR / SEP | Same | **Tier 2 alert**: Earth-issued notifications, which reach the hab one light-time later |
| Onboard dose (RAD-based model) | `LiveTab`, `ConfirmBar`, `zone.ts` | **Tier 3 nowcast**: an `SEP_NOWCAST` event caps `shelter_time_max_min` at the event's lead time. The safe zone shrinks and the route is replanned to a shelter. Only this tier orders RETURN NOW |
| STM objectives (from the mission blog) | `lib/science.ts`, Plan tab | Coverage per objective (full / partial / lost) and "dropping ST05 → OBJ-5 partial" consequence text |
| All provenance | `sourceRows()` / `dataSummary()`, `EvidencePanel.tsx`, `Evidence.tsx` | Data-sources table and evidence chips. Indicative layers and team assumptions are labelled |

What an operator can change: toggle stations in or out (`toggleStation`), edit or disable flight-rule values
(`setRule`), move the rover relay, and set the EVA start time (LTST). Each change replans after a debounce, and
a new plan must be CONFIRMed before it reaches the astronaut's visor.

---

## 3. How the weights changed

"Weights" means two different things in Marswalk. We changed one and left the other alone.

### 3a. Route cost: from tuned multipliers to a physics model

**Before** — George's research prototype (`Research/mars_routes/routing.py`, merged in `e59e861`). Edge time used
hand-picked weights:

```text
t = d_3D / v0 · (1 + a_up·max(grade,0) + a_down·max(−grade,0))
v0 = 0.5 m/s, a_up = 4, a_down = 2, max slope 15°
```

The research doc itself calls these values "uncalibrated engineering choices". It warns against arbitrary
`alpha·d + alpha·t + alpha·e` blends and recommends hard constraints over soft weights.

**After** — the engine (`Shared/src/engine/costModel.ts`, `pandolf-santee-mars`, `ed874ca`). We removed the
arbitrary multipliers and split the cost into three parts:

| Part | Before | After |
|---|---|---|
| **Travel time** (what A*/Dijkstra minimise) | `d/v0 · (1 + 4·up + 2·down)` | `d_3D / (v0 · speedFactor)`. Constant xEVA planning pace **0.56 m/s**. Grade does not slow the pace directly |
| **Slope** | Soft weight + 15° cutoff | **Hard rule** `slope_max_deg = 20°` (xEVA ConOps), checked per cell and per edge step (`e484145`). Diagonal corner-cutting between blocked cells is forbidden (`e6549ae`) |
| **Effort** | Grade multipliers | **Metabolic power** (W) from Pandolf 1977 + Santee 2003 downhill correction. Body 80 kg, suit 121 kg + tools 10 kg as load, × g ratio 0.378. Feeds the energy budget and the **suit-heat governor** (`heat_avg_max_w = 352 W`), whose rests add real time |
| **Terrain type** | None | η from THEMIS TI (team mapping, not published): TI ≥ 350 → 1.0, 100–350 → 1.2, < 100 → 2.1 (Pandolf loose sand) |
| **Walk back** | — | `walkback_speed_factor = 0.5`: return legs are timed at half pace for contingency |

So slope and terrain still make a route "expensive", but through physical quantities (watts, minutes of rest,
hard limits) rather than tuned coefficients. The bench (`Research/bench`) kept the old style as `ref-slope`
(`1 + 3·up + 1.5·down + 2·roughness`, η 1.5 below TI 250). Scored under `pandolf-santee-mars`, it finds paths
that look about 5 % shorter. They break the rules 140–166 times (mostly forbidden steps over 20°), so it ranks
last. Weighted A* (heuristic weight 1.5) is ~3 % worse on cost, with 0 violations. Plain A* matches the Dijkstra
oracle and is the default.

### 3b. Science value: STM weights (unchanged)

Station selection is an orienteering problem (`Shared/src/engine/orienteer.ts`). It maximises the sum of
station **values** under the EVA time, heat, shelter, comm and daylight rules. The values come from the draft
Science Traceability Matrix (`Content/stm.yaml` → `stm.json`):

| Objective | Weight | Statement (short) |
|---|---|---|
| OBJ-1 (G1) | 95 | Boxwork ridge vs hollow mineralogy/texture |
| OBJ-2 (G1) | 85 | Fluid-flow evidence (veins, polygons, nodules) |
| OBJ-3 (G3) | 80 | Stratigraphy and unit contacts |
| OBJ-4 (G2) | 75 | Representative, drillable sample sites |
| OBJ-5 (G3) | 70 | Exotic / float rocks (possible meteorite) |

Station values (0–100): ST02 95, ST12 92, ST03 90, ST07 85, ST01 80, ST06 75, ST11 72, ST04 70, ST10 70,
ST08 65, ST05 60, ST09 60.

These were **assigned by judgment** in C1 (`c434493`), not by a formula. The three guiding factors were the
highest objective weight served, uniqueness, and whether a suited crew can do it in 10–30 min. Git history shows
**no changes** to these weights since then. The Admin View shows them as bars on the Plan tab and labels them "a
transparent team heuristic, not a calibrated model". Operators cannot edit values in the UI; they can only
include or exclude stations. **To do:** the science lead should re-score before the final pitch (`stm.yaml`
`status: draft v0`).

### Team assumptions to state when presenting

- The TI → η mapping and the ±24 h ENLIL window are team assumptions (evidence class E).
- Mars gravity (0.38 g) is outside the Pandolf–Santee calibration range (0.12–0.32 g), so it is an extrapolation.
- Dose numbers are indicative. Terrain reduces dose but is never a shelter.
- Station values are not NASA rankings and must not be quoted as such.
