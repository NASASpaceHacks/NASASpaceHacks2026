# NASA Space Apps 2026 — "Interplanetary Survival Guide: Martian Map" — Build Plan

## 1. Context
- **Challenge**: a layered map/tool a Mars astronaut uses to plan and carry out a Marswalk. It must fuse data from multiple NASA missions (≥3 data kinds), put safety first (radiation/space weather, obstacles, suit mobility), and include a route map and POV imagery.
- **Repo**: `github.com/NASASpaceHacks/NASASpaceHacks2026` (public). It currently holds empty `Backend/`, `Frontend/AdminView/` and `Frontend/UserView/` folders (each with an empty `.gitignore`) and `Research/deep-research-report.md`, a rover route-planning literature review covering A*, weighted A*, D* Lite, Field D*, ENav, MLNav, CVaR risk-aware and science-aware planning, the HiRISE Jezero DTM, and a benchmark/metrics design.
- **Working model (team decision)**: **Claude builds the entire product now with parallel agents.** The 5 humans **research route optimization** (and science content/pitch) in parallel. Research results plug in through a `PathSearch` interface and win only if the benchmark harness shows they are better.
- **Team's concept** (owned by the team, per the rules):
  - **Admin view**: the habitat EVA officer plans and confirms routes on a **habitat server**.
  - **Astronaut view**: helmet navigation (GUI now; hardware later).
  - **Local surface network** between them for live re-routes.
- **Team priorities, in order**:
  1. **Value to NASA people** (primary).
  2. A **proper, correct 2D operational map** with product-grade polish (it must look like a final product).
  3. **3D only as optional extra.**
- **Judging**: Impact, Creativity, Validity, Relevance, Presentation (1–5 each). The local Toronto round is a live pitch. Global judging = project page + **≤30 s video** (over the limit = disqualified).
- **Deadline**: Sun Nov 15, 11:59 pm Toronto time. Confirm the local judging time.
- **Hero site**: **Gale / Mount Sharp**: Curiosity RAD measured terrain shielding there (validation), the REMS weather feed is current, it is the challenge's boxwork example, and it has 14 competitor repos vs 55 for Jezero. **Jezero is the second site pack**, matching the team's research dataset (DTEEC_023524_1985_023379_1985_U01). The engine is site-agnostic.
- **Tooling**: install Google's **Elephant-Goldfish Model (EGM)** Claude Code plugin to design with an "elephant" (full context) and review with "goldfish" (fresh-context subagents).

## 2. The value (what NASA people get), in priority order
1. **Constraint-safe route generation**. FOD's real constraint list (slope, walkback on contingency O₂, time-to-shelter, comm LOS gaps, daylight, suit heat, keep-outs) is enforced as hard rules. Every plan states its **margins**, its **binding constraint** ("limited by shelter time at St 3") and **bingo times**. It cannot return an unsafe plan.
2. **Science yield under constraints**: stations come from a cited Science Traceability Matrix; an optimizer selects and orders them; every dropped station is explained ("St 7 dropped: walkback, −18 min"); leaderboard of marginal value.
3. **A closed hab↔astronaut loop**: CONFIRM → push → ACK; replan <1 s (solar storm, EVA cut, astronaut-reported hazard via incremental replanning); live telemetry with plan-vs-actual; **autonomy when the link drops**.
4. **Safety awareness during execution**: walkback margin, shelter time, comm-shadow warnings ahead, heat pace advisories, uncertainty-aware position; heading from sun/landmarks (no GPS, no magnetic compass on Mars).
5. **Multi-mission data fusion with provenance**: 6+ missions on one correct Mars grid, each layer credited with resolution and accuracy.
6. **Credibility**: cited models, reproduction of Curiosity RAD shielding data, metabolic calibration on NASA suited data, 100k-case constraint tests, **a benchmark of 5+ planners** (from the team's research).

**Headline insight**: *"On foot, time-to-shelter limits the EVA before oxygen does."* (A 30-min rule at 0.56 m/s gives about a 1 km radius; the pressurized rover acts as a DRA 5.0 safe haven.)

**Three demo moments**:
1. **Safe Zone**: the reachable area shrinks one constraint at a time on the 2D map; the route snaps inside; drag the rover and the zone grows.
2. **Two devices, one link**: CONFIRM, and the visor gets route v1; the glass cockpit guides her; at the station, Curiosity's real photo shows what she'll see.
3. **Earth goes dark**: storm nowcast → reroute <1 s → network cut → the visor still brings her home.

**Looks shipped**: team-made name/logo, one design system (mission-control aesthetic; `frontend-design` skill), motion, alert sounds, 60 fps map, no dev artifacts, mission credits on every layer, landing page.

## 3. Why NASA people care (pitch spine, from NTRS)
- Mars DRA 5.0: the **habitat crew is the primary EVA support** (Earth 3–22 min away; about 13 days of blackout at conjunction). "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions… upon locally sourced information" (NTRS 20230014957).
- FOD constraint list: "max traverse distance, max distance from lander, lighting, max safe slope, max time without LOS to lander, consumables redlines" (NTRS 20250006063).
- **Gaps**:
  - "integrate real-time EV data (e.g., suit consumables…) with traverse planning" (NTRS 20260001895)
  - "better coupling between timelines and plans", "planned vs. actual" (Deans 2017)
  - "conflicts arise between science priorities and the achievable route" (Caswell 2025)
  - "validation is still needed" (Miller 2024)
  - AEGIS is internal and Moon-only.
- Outputs mirror NASA's EVA product set (NTRS 20240002135): Traverse Plan, burndowns, timeline, Map Book layers, Cuff Checklist.

## 4. Architecture: "Heavy in the hab, light on the helmet, async with Earth"
```
 EARTH (optional, delayed)       MARS SURFACE (no internet)
 ┌─────────────┐ light delay ┌──────────────────────────┐  surface link (WebSocket, LAN)  ┌───────────────────────────┐
 │ Earth relay │─3–22 min───▶│ Backend = HAB SERVER      │◀──── routes ≤25 KB, signed ────▶│ Frontend/UserView = VISOR │
 │ DONKI, REMS │ bundles     │ engine workers, event log,│      telemetry 64 B / 5 s       │ heading-up moving map +   │
 │ (T3 Claude) │◀─EVA logs───│ serves site pack + apps   │      heartbeat 1 Hz             │ instrument cluster +      │
 └─────────────┘             └────────────┬─────────────┘                                 │ portable safety core      │
                                          │ LAN                                           └───────────────────────────┘
                              ┌───────────▼─────────────┐
                              │ Frontend/AdminView       │ 2D map + layers, safe zone, constraint report,
                              │ = HABITAT CONSOLE        │ burndowns, CONFIRM, live monitor, re-route
                              └──────────────────────────┘
```
**Public demo build**: same code, engine in a Web Worker + `MemoryLink`, Admin and Visor side by side on one static page (for global judges).

## 5. Stack (value-first, product-grade 2D; hardware port later)
| Layer | Choice | Why |
|---|---|---|
| Workspace | **npm workspaces** across `Backend`, `Frontend/AdminView`, `Frontend/UserView`, `Shared` | One install, shared types and engine |
| Apps | **React 19 + TS + Vite**, **Zustand** (selectors), **Tailwind** with our tokens, **Motion** | Reliable for vibe coding; heavy work never goes through React renders |
| **Map** (both apps) | **OpenLayers** + proj4 **Mars projection**, **WebGLTile** (GPU band math + style variables), `DataTile` for engine fields, vector layers with declutter, heading-up rotation for the visor | A proper map in real Mars metres; safe-zone shrink = one style-variable change (60 fps) |
| Lighting | Normal bands from the pipeline → GPU hillshade from the **real sun vector** (Mars24 at the planned LTST) | NASA Map Book "lighting" |
| Contours | d3-contour isochrones as labelled vectors | Crisp at every zoom |
| Charts | **uPlot** | Burndowns, profiles, plan-vs-actual, benchmark plots |
| Visor UI | Glass cockpit: moving map + React/SVG instrument cluster (bearing/distance, ETA, walkback dial, shelter time, heat pace, bingo, link) + station photo card; black/amber, mirror toggle, ≤6 key actions | Value-dense; the logic lives in a pure-TS `safety-core` that ports to hardware |
| Engine | Pure TS on **typed arrays**; Dial's bucket-queue Dijkstra; parallel field workers; exact bitmask DP + time-stepped simulator; **pluggable `PathSearch`** | Fast, portable, research-swappable |
| Server | **Node 22 + Hono + ws**; append-only event log; serves the site pack (COG over HTTP Range) and both apps | Light, low risk |
| Link | WebSocket + **CBOR** | Compact; microcontroller-parseable later |
| Pipeline | Python via `uv`: GDAL/rasterio, numpy, scipy, pyproj, rio-cogeo | Heavy GIS work on Earth, pre-mission |
| Tests | Vitest + **fast-check** + Playwright | Constraint hunter, e2e |
| 3D (Tier 3) | Lazy R3F "3D inspect" | Optional |

**Map correctness:**
- **CRS**: local eqc on the IAU Mars 2000 sphere (`+proj=eqc +lat_ts=-4.7 +lon_0=137.4 +R=3396190 +units=m`); correct scale line; planetocentric °E readout; no WebMercator assumptions.
- **Fusion**: one grid for 6 datasets; co-registration check (MSL traverse on the visible tracks); per-layer provenance panel.
- **Size**: COG ortho at 50 cm streamed by Range.
- **Display**: layer presets (Plan / Safety / Science / Comms); colourblind-safe ramps; "indicative" badges; uncertainty ellipse; IAU gazetteer names.

**Designed-for-Mars budgets** (project page):

| Area | Budget |
|---|---|
| Route package | ≤25 KB (Curiosity daily uplink ≈28 KB) |
| Replan | <1 s |
| Safety-core update | O(1) |
| Operation | works with internet off |
| Link drop | → AUTONOMOUS ≤3 s |
| Crash | restore ≤10 s |

## 6. Surface-link protocol
- **Messages**: `ROUTE_PUSH` (PlanPackage: `seq`, parent, Ed25519-signed, deflate), `ACK`, `TELEM`, `ALERT`, `REQUEST` (astronaut → hab: "new target", "hazard here", "fatigued", "abort"), `HEARTBEAT` (1 Hz).
- **Two-step confirm**: constraint report → CONFIRM → push → visor "NEW ROUTE v8 — accept" → ACK. Everything goes into the event log.
- **Link loss**: 3 missed heartbeats → **AUTONOMOUS** (last confirmed route, coarse 50 m walkback/shelter grid in the package, return heading); store-and-forward + idempotent resync; viewshed-predicted comm-shadow warnings.
- **Demo controls**: latency/loss slider, "drop link" button.

## 7. Engine (decided) + research plug-in points
- **Grid**: 5×5 km at 5 m (1000×1000) from the 1 m DTM; Horn slope; roughness (rock proxy); 8-connected baseline.
- **Hard mask**: slope >20° (xEVA ConOps / Artemis III), keep-outs (lander plume zone; pad ≥1.5 km from the hab), nodata.
- **Edge cost**:
  - Pandolf + Santee (NASA JSC, NTRS 20240001423), gravity terms ×0.38, suit treated as load. Calibrated on Norcross IST-2 0.12–0.32 g; 0.38 g labelled an extrapolation.
  - η from THEMIS TI.
  - **Heat governor** (352 W suit design average, NASA ICES-2026-127; a 2013 hollow-fiber SWME prototype is packaged for 370 W in a Mars environment, NTRS 20130014146) + leaky-bucket rests.
- **Fields**: W (contingency walkback, k_c = 0.5), S (multi-source shelter time: hab + rover + caches), O, LOS viewshed.
- **Stations** (≤15): pairwise matrix + **exact bitmask DP** (<150 ms) with walkback pruning → the top 20 subsets go through a **time-stepped simulator** (daylight, LOS gap, heat, SEP lead, keep-outs). "Stay in hab" is always feasible.
- **Outputs**: binding constraint, dropped reasons, leaderboard, bingo times, burndowns. Replan <1 s.
- **Radiation**: Guo 2015 + **Guo 2026 two-term shielding** (indicative; terrain never a shelter; µSv reported).
- **Space weather tiers**: ENLIL forecast → go/no-go; DONKI alert (light-delayed); **onboard nowcast ≥25%** → return now (S ≤ 30 min).
- **Navigation**: sun azimuth (Mars24, LTST); DTM landmark bearings at 11:00–13:00 LTST or in dust; 95% ellipse.

**Research plug-in contract (the bridge to the humans' work):**
```ts
interface PathSearch {            // leg-level search: what research swaps
  id: string;                     // 'dijkstra' | 'astar' | 'wastar' | 'dstarlite' | 'fieldd' | 'thetastar' | 'cvar' ...
  search(g: CostGrid, start: Cell, goal: Cell, opts: SearchOpts): { cells: Uint32Array; cost: number; expanded: number; ms: number };
  update?(changed: Cell[], newCosts: Float32Array): void;   // incremental replanning (D* Lite / Field D*)
}
interface CostModel { id: string; edgeCost(from: Cell, to: Cell, ctx: CostCtx): number }   // e.g. Pandolf (default) vs research cost/risk models (CVaR)
```
- Orienteering, simulator, constraint checks and the X1 hunter are **fixed**, so any research planner is automatically safety-checked. A config flag selects the active planner.
- **Benchmark harness** (`Research/bench/`): runs every `PathSearch × CostModel` over scenarios (Gale, Jezero, synthetic; random start/goal/stations; **hidden-hazard reveal** experiments from the team's report) and outputs the report's metric table (length, accumulated cost, max slope, hazard exposure, replans, extra distance after reveal, latency, expanded nodes, optimality gap vs the Dijkstra oracle, constraint violations = must be 0). Results go to CSV + uPlot charts + a leaderboard page in Admin and on the project page.

## 8. Data stack: Gale (+ Jezero second)
| Kind | Mission | Source |
|---|---|---|
| Topographic 1 m | MRO HiRISE (+CTX/HRSC/MOLA) | `planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif` (crop via `/vsicurl/`) or STAC COG DTMs DTEEC_019698_1750_019988_1750_U01 / DTEEC_009149_1750_009294_1750_U01. Jezero: DTEEC_023524_1985_023379_1985_U01 (team research), CTX DTM for a quick start |
| Optical | MRO HiRISE | `asc-pds-services.s3…/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif` (COG crop) |
| Thermal | Mars Odyssey THEMIS | TI `…THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub` (2.5 GB, start at H0); fallback Trek TES TI |
| Spectral (T3) | MRO CRISM | MOCAAS Gale 10 m |
| Traverse | MSL Curiosity | `mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json`, `MSL_traverse.json` |
| POV images | MSL Mastcam/Navcam | `mars.nasa.gov/api/v1/raw_image_items/…`, joined by sol |
| Current conditions | MSL REMS | `mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` |
| Radiation | MSL RAD | Hassler 2014; Guo 2015; Ehresmann 2021; Guo 2026 |
| Space weather | Heliophysics via CCMC | DONKI WSAEnlilSimulations / FLR / SEP (free key; snapshot in the site pack) |
| Sun/time | — | Mars24 (GISS C-4, D-5, D-6) ported to TS |

## 9. Repo layout (adopts the team's existing folders)
```
NASASpaceHacks2026/
  package.json            npm workspaces; scripts: dev, ci, bench, e2e, sitepack
  Backend/                hab server: Hono API (plan/confirm), ws link hub, event log, sim walker, earth-relay ingest, static serving
  Frontend/AdminView/     habitat console (React + OpenLayers + uPlot)
  Frontend/UserView/      astronaut visor glass cockpit (React + OpenLayers heading-up + SVG instruments)
  Shared/contracts/       types.ts + zod; fixtures (mockSitePack(seed), goldenPlanResult)
  Shared/engine/          grid, cost models, PathSearch impls, fields, orienteer, simulate, radiation, marstime/sun, codec, safety-core
  Shared/map/             OpenLayers Mars CRS kit, layer/field styles, contours, route/station layers
  Shared/link/            WebSocketLink + MemoryLink, CBOR messages
  Pipeline/               uv project: fetch → crop → reproject → derive → export (COG + .bin + manifest)
  SitePacks/              manifests in git; binaries published as GitHub Release assets (fetch script), each file <100 MB
  Research/               deep-research-report.md (existing) + tracks/ + planners/ (human implementations) + bench/ (harness + results)
  Validation/             V1–V6 scripts → numbers.json
  Content/                flightrules.yaml (id, value, unit, hard, citation), stm.yaml, stations.md, gazetteer
  docs/designs/           EGM design doc (from this plan) + review records
  Brand/                  name, logo, tokens, sound cues, helmet CAD renders
  qa/                     fast-check properties + Playwright e2e
```
**Contracts, frozen at H2:** `SitePackManifest`, `Rule`, `PlanRequest`, `PlanResult` (per-rule `Check {worst, limit, margin, pass, atCell, atMin}`, burndown, binding, dropped, leaderboard, bingo), `PlanPackage`, `Telem`, `LinkMsg`, `EvaLog`, `DtnBundle`, `PathSearch`, `CostModel`.
**Mock-first**: `mockSitePack(seed)` + golden PlanResult, so UIs and engine build before real data lands.

## 10. Scope tiers (cut order fixed; value before polish before 3D)
**Tier 1, by ~H12 (end-to-end on LAN, real Gale data, no internet):**
- Site Pack gale-v1; engine fields + DP + simulator (Dijkstra/Pandolf baseline).
- Server plan/confirm/push/event log.
- Admin: correct-CRS map, presets, sun-lit hillshade, **safe-zone animation**, rover drag, contours, constraint report + binding + dropped reasons, burndowns, CONFIRM.
- Visor: accept route, moving map + instrument cluster, AUTONOMOUS on link loss.
- Sim walker, demo director, brand v1, CI (DP = brute force, hunter 1k, package gate).
- **Benchmark harness skeleton + A* baseline** so the research team can plug in immediately.

**Tier 2, ~H12–H18:**
- SEP 3-tier replan; "EVA cut"; astronaut "hazard here" → **incremental replan** (D* Lite from research, or full-replan fallback) → v2.
- Comm shadows; heat advisories; telemetry + plan-vs-actual; visor mirror.
- Station photo card + horizon silhouette; heading cue; uncertainty ellipse; elevation profile.
- Earth uplink panel (light delay, DONKI/REMS snapshot fallback).
- Jezero site pack; research planners integrated + benchmark leaderboard.
- Polish, landing page, public demo build, validations V1–V6.

**Tier 3:** Claude Earth-backroom brief; cuff card; 3D inspect; Monte Carlo P50/P90; CRISM; EVA-accessibility score.

**Cut first if behind**: 3D → Monte Carlo → CRISM → cuff card → horizon silhouette → live DONKI (snapshot) → Claude → sound → Jezero.
**Never cut**: value items 1–4, correct CRS, offline operation, confirm/ack, link autonomy, demo director, polish, V1, V6.

**Claude (Tier 3, Earth side only)**: `@anthropic-ai/sdk`, `claude-opus-5-5`, `messages.parse` + zod `BackroomBrief` (no rule fields), `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), effort `low`, key server-side, recorded fixture fallback; proposals re-checked onboard. Load the `claude-api` skill before implementing.

## 11. Who does what
### Claude build agents (orchestrated from this session; each in its own git worktree/branch, merged by this session)
| Agent | Builds | Acceptance test |
|---|---|---|
| **B0 Scaffold** (this session, first) | workspaces, contracts + zod, fixtures, CI, CODEOWNERS | `npm run ci` green on fixtures |
| **B1 Pipeline** | Gale (then Jezero) site packs; CRS pinned + traverse overlay check | schema-valid; traverse on the tracks; provenance with sha256 |
| **B2 Engine** | cost/fields/DP/simulator/radiation/marstime/codec/safety-core + `PathSearch` (Dijkstra, A*) | Pandolf/Santee values; Mars24 worked example; DP = brute force; 1M cells <800 ms; package ≤25 KB |
| **B3 Map kit** | OpenLayers Mars CRS, COG/DataTile layers, GPU field styles + hillshade, contours, heading-up | scale line matches the published traverse length; 60 fps safe-zone animation |
| **B4 Backend + link** | Hono API, ws hub, event log, sim walker, MemoryLink, earth relay | e2e confirm→push→ack; drop → AUTONOMOUS ≤3 s; resync |
| **B5 AdminView** | console UI, constraint report, burndowns, confirm/monitor/re-route, benchmark leaderboard page | Playwright e2e; X3 demo QA |
| **B6 UserView** | visor glass cockpit, accept/autonomous states, photo cards | screenshot review vs brand; safety core = server |
| **B7 QA** | X1 constraint hunter (fast-check), Playwright e2e, demo director script | 100k cases 0 violations; director runs offline |
| **B8 Bench + Validation** | `Research/bench` harness + V1–V6 scripts | reproducible CSV + charts; numbers.json |
| **Reviewers** | **X2 NASA SME** (citations, product definitions, overclaims) and **EGM goldfish reviews** at checkpoints | zero uncited numbers; review findings resolved |

### Humans (5): research + science + story, plugging into the build
| Track | Who | Output that plugs in |
|---|---|---|
| **R-A Search algorithms** | algorithms/TS person (+1) | `Research/planners/*.ts` implementing `PathSearch`: weighted A*, **D* Lite** (incremental replan on reported hazards), **Field D* / Theta*** (any-angle paths, smoother and shorter for walking), compared in the harness |
| **R-B Cost & risk models** | Python/data person | `CostModel` proposals: CVaR risk on uncertain terrain (Endo et al. 2023, MIT code), terrain classes (AI4Mars), human fall-risk vs slope/roughness; calibration notes |
| **R-C Science value** | science person | STM + 12 Gale stations with value scores and citations (`Content/`); science-aware selection ideas (Candela & Wettergreen 2022) |
| **R-D Story** | pitch/design person | brand by H4, helmet CAD renders, pitch script, 30 s video, project page, SI disclosure |
| **Lead** | user | reviews/merges agent PRs, runs EGM reviews, decides which research results replace baselines, rehearses the pitch |

**Merge rule for research**: a research planner or cost model replaces the baseline only if the harness shows it is better on the agreed metrics **and** it passes X1 (0 violations). It's a one-line config change.

## 12. Timeline
- **H0**: install EGM; write `docs/designs/marswalk.md` from this plan; B0 scaffold; start the DEM/THEMIS downloads (B1); NASA API key; confirm the Toronto judging time; humans start research tracks.
- **H1**: CRS pinned on a real crop; EGM goldfish review of the design doc running in a fresh session.
- **H2**: contracts frozen (EGM findings folded in); fan out B1–B8 in parallel worktrees.
- **H6**: real Gale map in Admin; visor receives a pushed route; harness runs Dijkstra vs A*; research team can submit planners.
- **H12**: **Tier 1 end-to-end on real data, offline**; demo QA #1; research checkpoint #1 (benchmark leaderboard).
- **H16**: feature freeze; research checkpoint #2 (final planner choice); storyboard locked.
- **H20**: code freeze; deploy the public demo build; backup video.
- **H22**: 30 s video locked (`ffprobe` ≤30.0 s); project page submitted; rehearsals.
- **H24**: pitch.

## 13. Validation (wording "reproduces"/"calibrated", never "validated")
| # | Claim | Method |
|---|---|---|
| V1 | Our DTM pipeline reproduces Guo 2026 obstructed-sky ratios and predicts RAD's measured drops at 8 parkings + Murray Buttes (RMSE X pp) | Curiosity position by sol; same Gale DEM; two-term model |
| V2 | Metabolic model within ±X% of NASA suited data (0.12–0.32 g) | Digitize IST-2; 0.38 g stated as extrapolation |
| V3 | Route package median/max bytes vs Curiosity's 28 KB daily uplink | CI gate |
| V4 | Safety-core update p95 µs at 20× CPU throttle | Playwright + CDP |
| V5 | Internet off; link drop → AUTONOMOUS ≤3 s; crash restore ≤10 s | Playwright e2e |
| V6 | 0 violations in 100k cases; DP optimal on 1,000 brute-force checks | fast-check |
| V7 | Planner benchmark: N planners × M scenarios (incl. hidden-hazard reveal), all with 0 constraint violations | `Research/bench` |

## 14. Pitch (≤4 min) + 30 s video
**Setup**: two devices on a travel router (habitat console on the projector, astronaut visor second); demo director (`?director=gale-412`), seeded, offline; backup video.
- **0:00** "Sol 412. Earth is 14 light-minutes away; in 13 days it's gone. Today she walks 3 km across Mount Sharp. Who keeps her safe?"
- **0:20** NASA's own words (FOD constraints, DRA 5.0, documented gaps).
- **0:45** Moment 1, Safe Zone (layers from 6 missions with credits; zone shrinks; route snaps; binding constraint; dropped station; rover drag; CONFIRM).
- **1:35** Moment 2, Two devices (accept v1; glass cockpit; Curiosity's photo at the station; helmet CAD render).
- **2:20** Moment 3, Earth goes dark (nowcast → reroute <1 s → network cut → AUTONOMOUS).
- **3:00** Validation chips (V1, V2, V6, V7) + "the route fits in 6 KB; Curiosity's daily uplink is 28 KB."
- **3:25** Impact: any DEM (Artemis lunar EVAs today); hardware path; Apache-2.0.

**30 s video**: 0:00 names → 0:02 challenge → 0:05 name + tagline over the safe zone → 0:10 four 2.5 s shots → 0:20–0:30 future + URL. Captions; real NASA imagery and our own recordings only; Space Apps brand assets; no NASA logos.

## 15. Risks → fallbacks
| Risk | Fallback |
|---|---|
| DEM/CRS problems | Crop check at H1; explicit proj4; single STAC DTM fallback |
| OpenLayers WebGL learning curve | Canvas-colourized field → `ImageStatic` layer |
| THEMIS 2.5 GB | Start at H0; TES TI fallback; drop the layer |
| Large binaries in git | Release assets + fetch script; LFS only if needed |
| Parallel agents conflict | Strict directory ownership per agent; contracts frozen at H2; this session is the only merger |
| Research arrives late | Baselines ship regardless; research swaps in by config if it wins the benchmark |
| DONKI rate limit / venue Wi-Fi | Snapshot + cache; LAN-only design; travel router |
| Video >30 s | `ffprobe` gate |

## 16. Compliance (Space Apps 2026)
- SI/AI: the idea came from the team ✔. Disclose SI-generated code (README + description). Watermark any SI-generated images/video (we avoid them).
- No NASA logos; Space Apps brand assets; cite every dataset, paper and library (incl. the papers in the team's research report). ≥1 NASA dataset; team ≤6; English; Apache-2.0; public demo link.

## 17. Verification (end-to-end)
1. `npm run ci`: typecheck; engine unit tests (Pandolf/Santee, Mars24 worked example); DP = brute force; X1 hunter 1k; package gate.
2. `npm run sitepack -- gale-v1`: schema-valid; traverse on the visible tracks; scale line = published traverse length.
3. `npm run e2e` (internet disabled): plan → CONFIRM → visor v1 → ACK; SEP → v2 <1 s; drop link → AUTONOMOUS ≤3 s; resync; kill visor → restored.
4. `npm run bench`: all planners × scenarios, 0 violations, results CSV + leaderboard.
5. Public demo build passes the same flow from a static host.
6. X2 + EGM review clean; demo director runs the full pitch twice offline on the pitch machines.

## 18. Right after approval (in order)
1. **Install EGM**: `claude plugin marketplace add google/elephant-goldfish-model` then `claude plugin install egm@egm`. The skills load in a **new session**, so the user (or a teammate) opens one later for EGM reviews; this session keeps building.
2. Clone `NASASpaceHacks/NASASpaceHacks2026` into the working directory; create a branch; write `docs/designs/marswalk.md` from this plan.
3. B0 scaffold: npm workspaces, `Shared/contracts` + zod + fixtures, CI, CODEOWNERS, and the `PathSearch`/`CostModel` interfaces + harness skeleton, so research can start against real interfaces right away.
4. Kick off B1 data downloads and the CRS check.
5. In a fresh session: `/egm:egm-review docs/designs/marswalk.md` → resolve findings → freeze contracts (H2).
6. Fan out B1–B8 in parallel worktrees; write `Research/tracks/README.md` with the human research briefs (R-A to R-D) and how to plug in.
7. Push branches/PRs to the team repo (confirm with the user before the first push).

## Challenge alignment (clause by clause)
> "Create a layered, integrated view of a location or route on the Martian surface that pulls together data from multiple NASA science missions and could help a human explorer plan and carry out a successful Marswalk while conducting new and exciting science along the way."

| Clause | What we built | Where |
|---|---|---|
| Layered, integrated view | 2D Mars map with layer presets (Plan / Safety / Science / Comms). Layers are **fused** into one safe zone, a constraint report and a route, not just stacked. | Habitat Console |
| Location or route on Mars | Gale crater / Mount Sharp, 5×5 km on Curiosity's 2025–26 boxwork traverse, plus generated EVA routes | Site pack `gale-v1` |
| Data from multiple NASA missions | MRO HiRISE (terrain, orthophoto), Mars Odyssey THEMIS (thermal inertia), MSL Curiosity (traverse, Mastcam/Navcam photos, REMS weather, RAD radiation), MGS MOLA (in the merged DEM), heliophysics fleet via CCMC DONKI (space weather) | Sources panel; "N missions · M data kinds" badge |
| Help a human explorer **plan** | Constraint-safe route generation with margins, binding constraint, bingo times, dropped-station reasons | Habitat Console |
| …and **carry out** a successful Marswalk | Confirmed route pushed to the helmet visor; glass-cockpit navigation; walkback and shelter margins; autonomy if the link drops | Visor |
| **New and exciting science** along the way | 12 real boxwork-era Curiosity targets in a cited Science Traceability Matrix; the optimizer maximizes science value under the safety rules; objective coverage shown; crew task checklists and real Curiosity photos at each station | STM panel, station cards |
| ≥3 data kinds (brief) | Optical, topographic, thermal, atmospheric, radiation, space weather (+ spectral, stretch goal) | Sources panel |
| Safety: radiation/space weather, suit mobility, obstacles (brief) | Three-tier space-weather response + terrain-shielding model; NASA suited walking-energy model + suit heat budget; slope and roughness avoidance | Engine |
| HUD / tablet / habitat display (considerations) | Habitat console + helmet visor GUI (hardware port later) | Both apps |
| Point-of-view imagery (considerations) | Curiosity Mastcam/Navcam photos at each station ("What you'll see") | Station cards |
| Rovers / working in pairs (considerations) | Pressurized rover as a movable safe haven; buddy pair walks the same route | Engine, Console |
| Updates on current conditions (intro) | Curiosity REMS weather, DONKI space weather, light-delayed Earth relay | Live tab, Earth panel |
