# Start here: Mars human exploration routing handoff

Last updated: 2026-11-14. This file preserves the project context for the next conversation. Working directory: `Research` inside `NASASpaceHacks2026`. Shell used: PowerShell on Windows.

## Goal and current focus

Build a scientifically grounded multi-destination route planner for **human astronauts walking on Mars**. Prioritize real data, valid planetary coordinates, terrain feasibility and reproducibility. Rover wheel-slip models and flight navigation results do not establish human mobility limits.

The user most recently asked whether the prototype's walking speed, directional penalties and slope cutoff have research support. **Their exact numerical values were chosen for demonstration, not derived from studies.** The latest findings are saved in [routing_assumptions_findings.md](docs/research/routing_assumptions_findings.md). No replacement coefficients have been fitted or implemented.

The user also found the `.tif` examples difficult to view. They contain numeric GIS layers, not a finished image with a route overlay. QGIS viewing instructions were explained, but a simple PNG/browser preview has **not** been created. This is an outstanding usability improvement, not a completed feature.

## Read these files

| File | Purpose |
|---|---|
| [README.md](README.md) | Install/run commands and example outputs |
| [Latest assumptions findings](docs/research/routing_assumptions_findings.md) | Actual variables/formula, evidence for defaults, source applicability and next calibration work |
| [Research analysis](docs/research/research_analysis.md) | Original-report review and recommendation-to-source traceability |
| [Dataset/API inventory](docs/research/dataset_api_inventory.md) | Exact endpoints, access types, tested outcomes, data quality and restrictions |
| [Human EVA constraints](docs/research/human_eva_constraints.md) | Mars measurements vs simulation/analog/engineering assumptions |
| [Routing design](docs/research/routing_algorithm_design.md) | Coordinate treatment, costs, hard exclusions, ordering and expansion strategy |
| [Implementation plan](docs/research/implementation_plan.md) | Completed work and future acceptance criteria |
| [Original report](deep-research-report.md) | Preserved rover-focused Deep Research starting point, not authoritative specification |

## What exists and has been executed

Initial inspection found only the research report and empty Backend/Frontend placeholders in the parent repository. No pre-existing application routing stack was available. Implementation is standalone Python within `Research`; no frontend integration was performed.

- Real 256 x 256 crop of the USGS 1 m HiRISE Jezero TRN elevation mosaic; source fetched with HTTP range/window reads, not a full planetary download.
- Mars CRS parsing, coordinate conversion, latitude-corrected local ground distances, slope calculation, NoData handling and terrain exclusion.
- Directed eight-neighbor A*; Dijkstra verification; exact ordering for at most eight required visits; reverse Dijkstra for time-to-base.
- Per-route-cell time-budget/return-reserve checks, including dwell time.
- JSON/CSV route exports and three-band terrain GeoTIFF.
- **18 tests passed** in the last recorded code validation. Two-point and multi-stop CLI examples succeeded; an insufficient-budget run failed as expected.

Evidence: [test and CLI log](docs/research/evidence/validation.txt), [HTTP probes](docs/research/evidence/http_checks.json), [crop provenance](examples/jezero_dem.json). These are historical execution results; rerun relevant checks after code changes. This handoff-writing update did not rerun the suite.

| Saved example | Distance | Scenario time |
|---|---:|---:|
| [Two-point route](examples/two_point/route.json) | 234.70 m | 8.76 minutes walking |
| [Three-visit return route](examples/multi_stop/route.json) | 609.07 m | 22.39 minutes walking, 28.39 including service |

The elevation is real stereo-derived Mars data. Destinations are demonstration locations. Synthetic terrain appears only in analytical unit tests. Walking coefficients, cutoffs and budgets are assumptions, not measurements.

## Code and current assumptions

| Module | Responsibility |
|---|---|
| [acquire.py](mars_routes/acquire.py) | One verified source adapter, bounded crop, provenance and SHA-256 cache checks |
| [terrain.py](mars_routes/terrain.py) | Supported Mars CRS, coordinates, slope and masks |
| [routing.py](mars_routes/routing.py) | Directed travel time, A*, return Dijkstra, ordering, budget validation |
| [__main__.py](mars_routes/__main__.py) | CLI, pairwise planning and exports |
| [test_routes.py](tests/test_routes.py) | Synthetic analytic tests plus real-crop integration test |
| [probe_sources.py](scripts/probe_sources.py) | Small public HTTP availability/metadata checks |

Cost per movement is `d3 / v0 * (1 + 4*max(grade,0) + 2*max(-grade,0))` seconds. Default `v0=0.5 m/s`; maximum permitted cell/edge slope `15 degrees`; budget `60 min`; reserve `10 min`. There is no separate weighted science, radiation or calibrated metabolic objective. Positive gravitational work is an informational mechanical quantity, not oxygen use.

The loader supports local north-up spherical Mars equirectangular DEMs, with explicit size/location restrictions. The selected source uses radius **3,396,190 m**, planetocentric latitude and east longitude. Do not replace its CRS with Earth EPSG:4326/3857. Output JSON is a custom Mars geometry schema, not RFC 7946 Earth GeoJSON. Do not silently mix planetographic and planetocentric latitude, vertical datums or different product reference radii.

## Run from Research

The local `.venv` was created with Python 3.13. Direct dependencies are NumPy, Rasterio and PyProj, pinned in `requirements.txt`.

```powershell
# Existing environment; no network needed for the cached example/tests
.venv/Scripts/python.exe -m unittest discover -s tests -v
.venv/Scripts/python.exe -m mars_routes --out outputs/jezero

# Closed traverse with two additional stops and service time
.venv/Scripts/python.exe -m mars_routes --stop 77.45088025451184 18.446142210512168 --stop 77.44885578192887 18.444117737929194 --return-to-base --dwell-min 2 --out outputs/multi

# Optional independent acquisition into a new cache
.venv/Scripts/python.exe -m mars_routes --fetch --dem data/jezero_dem.tif --out outputs/fresh
```

For a new environment, follow the README. Windows sandbox restrictions previously blocked the installed Python runtime and uv cache; escalated execution was needed. The project interpreter prefix was approved in that session, but a later conversation must respect its actual permission state. Keep TLS validation enabled; do not bypass certificate failures.

## What the dataset investigation established

Public HiRISE byte-range access, Mars Trek WMTS, PDS Search REST, ODE REST and USGS planetary STAC were tested. CTX availability was checked by HEAD; MOLA/MEDA/MCD pages or directories were accessed. HRSC's Python probe failed TLS validation, although its web documentation was readable. Exact outcomes are in the inventory/evidence; these are not permanent uptime guarantees.

HiRISE is the best tested local elevation input. CTX/HRSC/MOLA are broader but too coarse to establish foot-scale obstacle safety. WMTS imagery and hillshade are not quantitative elevation. MCD is model climatology with usage/distribution conditions, not an unrestricted real-time weather API. Do not register, redistribute or infer terms from mere public accessibility.

## Next research and implementation priorities

1. **Calibrate or bound human locomotion assumptions.** Start with the latest findings note: NASA suited tests, Kluis et al. (2025) partial-gravity metabolic modeling, and Minetti et al. (2002) uphill/downhill energy. Extract applicable measurements before changing coefficients. Keep time, energy and safety policy distinct.
2. **Validate terrain hazards.** Use matching imagery to inspect rocks, dunes and cliffs along the actual routes; quantify unresolved hazards and alignment error. Valid DEM cells do not imply safe footing.
3. **Provide an accessible preview.** Export a terrain-and-route PNG or lightweight viewer with labels, scale and assumption notes; avoid unnecessary frontend infrastructure.
4. **Run uncertainty/sensitivity scenarios.** Compare paths and return margins under documented parameter changes; do not call scenario ranges confidence intervals.
5. **Expand destination planning.** Required-stop ordering works; optional scientific POI selection/reward and alternative routes remain unimplemented.
6. **Add physical resource/environment models when inputs exist.** Oxygen, CO2, cooling, water, battery, fatigue, illumination, weather and communication constraints are not yet modeled. Nominal return time is not degraded-crew rescue feasibility.

No operational astronaut safety claim is justified. Keep the original report intact, preserve measured/simulated/assumed distinctions, avoid synthetic fallback for real-data demos, and make the smallest complete changes needed for the next requested milestone.
