# NASA data audit (2026-11-14)

Scope: what each NASA dataset does in the code, read from `SitePacks/*/manifest.json`, `Pipeline/`, `Shared/src/engine/`, `Frontend/*`, `Validation/*`. Part B URLs from WebSearch, except where marked "from memory".

## Headline findings (read first)

1. **Terrain-based radiation shielding is not wired into the engine.** `radiation.ts` accepts an optional `skyview` raster, but no pack builds one (`rasters` = dem, slope, rough, normals, ti). The engine dose is elevation-pressure only, so V1 validates a method the planner does not yet use. `skyShieldFactor` returns 1 for every cell.
2. **Radiation dose is a literature model, not measured RAD data.** It is Guo 2015 D(P, Phi) x 3.05. `P_ref = 750 Pa` and `Phi = 600 MV` are team assumptions. REMS pressure is not used. The dose is a report stat labelled "Indicative" (`ReportTab.tsx:152`) and not a rule.
3. **DONKI is advisory only.** `forecastCheck()` (+-24 h window) feeds a GO/CAUTION banner (`plain.ts`). The engine never reads `conditions.spaceWeather`. The engine event `SEP_NOWCAST` is user-injected and simulated.
4. **REMS feeds only `Ls` into the sun geometry** (`actions.ts:70`, `visor.ts:294`, `plan.ts:77`). Scenario sol 412 has no REMS record, so the engine falls back to an assumed `Ls = 240`. REMS temperature, pressure and UV are stored but not shown anywhere in AdminView, apart from a row in the Sources table.
5. **Docs are stale.** `SitePacks/README.md` says `spaceWeather` is absent, but the manifest holds 33 events (31 WSA-ENLIL, 2 FLR). The Jezero `conditions.rems` array holds MEDA data (`weather: "meda"`), yet `science.ts` hard-codes the label "REMS / MSL".
6. **THEMIS to eta is a team mapping** (>=350 -> 1.0, 100-350 -> 1.2, <100 -> 2.1), not a published relation. TI is flagged `indicative`.
7. **Roughness is carried in the cost grid but is not used in the cost or the blocking.** It is display only. Slope (<=20 deg, plus the edge-grade check) is the only terrain hard block.

## Part A: dataset-by-dataset

| Dataset | Mission / instrument | Exact product (URL) | Resolution | Processing | Computational use | QA done | UI | Rating |
|---|---|---|---|---|---|---|---|---|
| USGS Gale merged DEM | MRO HiRISE stereo DTMs merged with CTX, HRSC and MOLA (Parker and Calef 2016) | `MSL_Gale_DEM_Mosaic_1m_v3.tif` (`planetarymaps.usgs.gov/mosaic/Mars/MSL/`) | 1 m posting, a few m effective. Engine grid 5 m (25-sample block mean). | `/vsicurl/` window read, exact affine eqc reprojection, Horn slope, plane-detrended roughness, normals. | **Core.** `slope > 20 deg` blocks cells. Edge-grade check. Elevation gives 3-D length, grade for Pandolf-Santee, and the line-of-sight viewshed (6 m mast to 1.8 m helmet, with curvature). Also used for the radiation pressure term and for sun relief shading. | DEM vs 372 Curiosity waypoint elevations: median -0.001 m, **sigma 0.189 m** (Jezero: n=220, sigma 0.073 m). Slope and normals match the TS reference (max diff 0.007 deg / 6e-5), checked in `validate.ts`. V4 recomputes slope and LOS independently from raw DEM (~0.01 deg diff). | Elevation, slope, roughness overlays; hillshade; walk-back, shelter and LOS maps; route | **Deep** |
| HiRISE colour mosaic | MRO HiRISE (78-quad LRGB, fused to the MSL 25 cm orthomosaic) | `MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif` (`asc-pds-services.s3...`) | 0.25 m native. Shipped at 1 m (WebP) and 0.5 m (COG). | COG overview read, WebP/COG. | None. | Ortho vs DEM hillshade phase-correlation: median offset 0.24 m E / 0.58 m N (<1 cell), corr 0.55. Colour is enhanced, not radiometric (stated in provenance). | Base map, station zoom | **Light** (QA'd, display only) |
| MOLA | MGS MOLA | Control for the merged DEM, plus `Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` (`context.py`) | 463 m | Summit lookup. Elevation datum is the MOLA areoid. | Datum for the DEM. The Aeolis Mons summit (771 m) is used as a far heading cue. | Not separately checked. | Landmark label | **Light** |
| THEMIS thermal inertia | 2001 Mars Odyssey THEMIS (Fergason et al. 2006) | `THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub` (`asc-astropedia.s3...`) | 100 m, bilinear to 5 m | Window read, u16 x 0.1. | `etaFromThermalInertia()` gives a terrain factor eta in the Pandolf energy term (edge power, EVA energy, suit-heat governor rests, which in turn affect duration and LOS gap). Eta is **not** in the travel-time cost (constant pace). Visor uses the same eta. Siting uses TI >= 300 for the landing pad. | None beyond provenance. No ground truth. The eta mapping is an assumption. | TI overlay with "Indicative" badge | **Medium** |
| MSL traverse and waypoints | MSL operations team, MMGIS `MSL_traverse.json`, `MSL_waypoints.json` | `mars.nasa.gov/mmgis-maps/MSL/Layers/json/` | ~1 m localisation | Clip to AOI +-3 km, Douglas-Peucker 0.25 m. | Waypoint elevations are the DEM truth check. Waypoints place rover images and sols. V1 uses the waypoint list for RAD parking positions. Science stations are real Curiosity stops. | sigma 0.19 m check (above). | Traverse layer, station cards | **Deep** (as a validation reference, not a cost input) |
| Curiosity raw images | MSL Mastcam and Navcam | `mars.nasa.gov/msl-raw-images/...` (10 images) | native | Bilinear demosaic of raw RGGB, texture test to reject flats, stationary sols only. | None. | Position tied to the waypoint when the rover was stationary (<=60 m). | Station cards, visor POV | **Light** |
| REMS weather | MSL REMS (outreach feed, "for outreach purposes only") | `mars.nasa.gov/rss/api/?feed=weather&category=msl` | per sol, last 30 sols (4966-4995) | JSON. | Only `Ls`, which sets sun declination for the daylight rule (>=5 deg sun elevation). Sol 412 is outside the feed, so `Ls` falls back to the assumed 240. | None. | Sources table only | **Medium** |
| RAD (literature) | MSL RAD | Guo 2015 (arXiv:1507.03473), Hassler 2014, Guo 2026 JGR (doi:10.1029/2026JE009704) | n/a | Constants in `radiation.ts`. | `doseEqRateUSvPerMin()` integrates dose along the route. Pressure from elevation (scale height 11 km). The terrain-shielding term is **dormant** (no skyview raster). | **V1:** horizon code on the 1 m DEM reproduces the paper's obstructed-sky ratios, **MAE 2.0 pp, r = 0.94, 15 periods**. Dose-drop RMSE 4.3 pp on 8 parkings (null 9.3 pp). Caveats are in `v1_shielding/README.md`: the definition was chosen post hoc, f and w come from the paper, and it is a reproduction, not independent validation. | Report "Radiation dose" stat (Indicative) | **Medium** (computation + validation of a method that is not in the engine) |
| CCMC DONKI | NASA CCMC WSA-ENLIL+Cone, FLR | `ccmc.gsfc.nasa.gov/DONKI/` (api.nasa.gov, keyless fallback) | event-level | 33 events, with Mars arrival times. | Arrival-within-+-24 h-of-EVA check gives a GO/CAUTION banner. Not in the engine. | None (the window is a stated assumption). | Details > Weather tab (forecast, alert, nowcast) and a banner | **Light-to-Medium**: a computed advisory, not a planner input. Rated **Light**. |
| Viking MDIM 2.1 via Mars Trek | Viking Orbiters | `trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/...` | 232 m | Tile mosaic to JPEG, `context.json`. | None. | None. | Locator (global and regional) | **Light** |
| Mars24 sun | NASA GISS Mars24 (Allison and McEwen 2000) | `giss.nasa.gov/tools/mars24/help/algorithm.html` | analytic | Port of steps A-1 to D-6 (`marstime.ts`). | Sun elevation: daylight rule, `daylightUntil`, relief shading. Hill and terrain shadows are not modelled. | Worked examples reproduced in `marstime.test.ts`. V4 recomputes the sun independently, but with the same published constants. | Sun/lighting layer, timeline | **Deep** (computation + tested to NASA's own worked examples) |
| Jezero (in progress) | MRO HiRISE TRN DTM and ortho (greyscale 25 cm), THEMIS 00N060E, M20 traverse, Mastcam-Z/Navcam raw images, MEDA feed | `mars2020_trn/HiRISE/JEZ_hirise_soc_006_*`, `M20_traverse.json` | 1 m DEM, 5 m grid | Same pipeline, `site_jezero.py`, `m20.py`. | Same engine, no engine changes. | DEM vs 220 waypoints sigma 0.073 m. Ortho offset 0.7 m E / 0.2 m N. Built 2026-11-15. | Site switch in the Locator | A second site with the same ratings. Some labels still say REMS where the data is MEDA. |

Not NASA-data validation, but part of the evidence chain:
- **V2** (Norcross 2010, NASA/TP-2010-216125): MAPE 10.6% at 0.22-0.32 g, but 36% at 0.12-0.17 g (overall 20.8%). The data were digitised from a figure. 0.38 g is an extrapolation.
- **V3**: planning gain over nearest-first is 0% in the base set and +5% (median +1%) in the oversubscribed set. The safety rules catch violations in 99.5% of naive plans. Science values are a team heuristic.
- **V4**: 22/24 verdict agreement with the independent checker, 24/24 with the blind AI judges. The two disagreements are the heat-rest model difference.
- **Research/bench**: planner leaderboard on gale-v1 terrain. It measures the algorithm, not data.

### Depth summary
- **Deep**: USGS Gale DEM, MSL waypoints (as validation reference), Mars24 sun.
- **Medium**: THEMIS TI (eta, unvalidated), REMS (`Ls` only), RAD literature (model, V1; shielding not integrated).
- **Light**: HiRISE colour ortho (QA'd), MOLA, Curiosity images, DONKI (advisory), Viking MDIM.

## Part B: unused NASA data

Data-kind value is judged against the challenge list: optical, thermal, spectral, topographic, geophysical, atmospheric, radiation, chemical.

| Dataset | URL | Kind it adds | Effort | Recommendation |
|---|---|---|---|---|
| **CRISM mineral maps (MTRDR, 18-20 m/px)** | PDS4 bundle: https://pds.nasa.gov/data/pds4/releases/geo/mro_crism_mtrdr-20250413/readme.txt. A 2025 GSA abstract maps Gale from MTRDRs (CINDEX2, BD860_2, BD1300, OLINDEX3). The browse index has no Gale-specific link, so the product must be found by tile. | **spectral**, and a chemical/mineralogical proxy | Medium. The 5x5 km AOI is on the Mount Sharp boxwork, which is sulfate-bearing. Pick a tile covering the AOI, derive one parameter raster (for example sulfate or hematite), and resample to the 5 m grid. Note the licence and georeference caveat in `docs/BACKLOG.md`. | **Quick win to medium.** Biggest coverage gain, and it could feed station science value (replacing the heuristic). |
| MSL RAD dose-rate time series (PDS PPI) | https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/AAREADME.TXT. Dose rate in silicon: https://iswa.gsfc.nasa.gov/iswa_data_tree/information/MSLRAD.html | radiation (measured) | Low to medium. Download the RDR, plot dose and sol against REMS pressure, and calibrate or validate the `radiation.ts` pressure term against measured data. | **Quick win.** Turns "literature model" into "measured data". It also removes the assumed `P_ref`. |
| Raw REMS (PDS Atmospheres) and the REMS temperature/pressure we already hold | PDS Atmospheres node (from memory) | atmospheric | Low. Show min/max air and ground temperature, pressure and UV in the weather tab, and use pressure in the dose model. | **Quick win.** The data is already in the manifest and unused. |
| Perseverance MEDA / SuperCam | PDS Atmospheres and Geosciences nodes (from memory) | atmospheric, chemical (SuperCam LIBS) | Medium. Jezero only. MEDA is already fetched as the feed, but only pressure. | Later |
| MRO MARCI weather and dust | PDS Imaging node (from memory) | atmospheric (dust opacity) | Medium. Only a qualitative narrative is possible. | Later |
| MRO MCS atmosphere profiles | PDS Atmospheres node (from memory) | atmospheric | Medium to high. Sparse sampling. | Skip |
| SPICE (NAIF) sun and Earth geometry | https://naif.jpl.nasa.gov/naif/ (from memory) | geophysical (ephemeris), comms light-time | Medium (WASM or a precomputed table). Mars24 is already within ~0.01 deg, but exact Earth geometry would give the real comms light-time. | Later |
| HRSC DTM, CTX orthomosaic | ESA HRSC (PSA) and MRO CTX (PDS Imaging) (from memory) | optical, topographic (wider area) | Low. Already inside the merged DEM. | Skip |
| SWIM subsurface ice map | https://swim.psi.edu (from memory) | geophysical (ice/water) | Medium. Not relevant at equatorial Gale. Relevant only for a polar site. | Skip |
| Mars Climate Database (LMD, not NASA) | https://www-mars.lmd.jussieu.fr/mars/access.html. Web access is "moderate use only". Full version by request. No commercial use without authorisation. | atmospheric (modelled) | Medium. The licence limits it, and it is a model, not NASA data. | Skip |

## Part C: data story and coverage

### Data story (about 100 words)
Every layer of the map is real NASA data. We start from the USGS Gale 1 m terrain model, which agrees with 372 surveyed Curiosity waypoints to 0.19 m (sigma). We add THEMIS thermal inertia to estimate how loose the ground is, and the Mars24 sun model for daylight. A Pandolf-Santee walking model sets the energy cost, and flight-rule limits (slope, shelter time, radio line of sight) decide go or no-go. Our line-of-sight-horizon code reproduces published Curiosity radiation-shielding ratios within 2 percentage points. Anything that is a team assumption, such as the thermal-inertia mapping and the dose constants, is labelled "Indicative".

### Coverage vs the challenge's data kinds
| Kind | Our dataset | Status |
|---|---|---|
| Optical | HiRISE ortho, Curiosity raw images, Viking MDIM | yes (display) |
| Thermal | THEMIS TI, in the energy cost | yes (computation, unvalidated) |
| Spectral | none | **missing** (CRISM) |
| Topographic | USGS Gale DEM, MOLA | yes (deep) |
| Geophysical | MOLA datum, Mars24 solar geometry | partial |
| Atmospheric | REMS (`Ls`, stored values) | partial (not shown or used beyond `Ls`) |
| Radiation | literature RAD model, V1 shielding | partial (shielding not integrated, no measured RAD data) |
| Chemical | none | **missing** |
| Space weather (extra) | DONKI | yes (advisory) |

Note: `docs/JUDGING.md` claims "6 kinds" including space weather. Counting the challenge's 8 kinds, 3 are fully covered (optical, thermal, topographic), 3 partial and 2 missing. Do not overclaim "radiation" or "atmospheric".
