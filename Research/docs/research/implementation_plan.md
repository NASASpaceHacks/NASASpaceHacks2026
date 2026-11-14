# Implementation milestones and executed status

Checked 2026-11-14. The first terrain-aware demonstration and a small required-stop extension are **implemented and executed**. Physiological/environmental safety and optional scientific destination selection remain research/integration work.

## Completed slice

| Component | Files / behavior | Evidence |
|---|---|---|
| Repository/research audit | Five research documents; original report preserved | Single initial report and empty parent application placeholders inspected |
| Public-source checks | `scripts/probe_sources.py`, `docs/research/evidence/` | Bounded read-only requests with HTTP status, response headers, timestamps and samples |
| Numeric data acquisition | `mars_routes/acquire.py` | Real USGS HiRISE window fetched; source/frame, window and SHA-256 saved |
| Coordinates and preprocessing | `mars_routes/terrain.py` | Native spherical Mars CRS, row-dependent distance correction, slope, NoData support and optional obstacle masks |
| Routing | `mars_routes/routing.py` | Directed A*, Dijkstra comparison, reverse return costs, exact small ordering and budget check |
| CLI/export | `mars_routes/__main__.py` | JSON, CSV, three-band terrain GeoTIFF; explicit scenario assumptions |
| Tests | `tests/test_routes.py` | 18 tests in final suite; validation recorded in `evidence/validation.txt` |
| Replay inputs/output | `examples/jezero_dem.tif`, sidecar, `two_point/`, `multi_stop/` | Small real-data input and actual route results; no synthetic terrain in these examples |

Recorded demonstration:

- Source window: 256 × 256 native pixels near 77.45°E, 18.445°N. Nominal projected extent 256 × 256 m; east-west ground extent is smaller.
- Two-point route: 234.704 m, 525.808 scenario walking seconds; ascent 4.697 m, descent 4.613 m.
- Closed three-visit route: 609.065 m, 1,343.660 walking seconds plus 360 service seconds; ascent/descent 10.428 m. Visit order `0,2,3,1,0`.
- Default 3,600 s budget / 600 s reserve passed both examples. The 300 s CLI budget case failed; tests also isolate travel-plus-return and dwell reserve violations.
- All walking quantities depend on the uncalibrated scenario. Actual runtimes/peak RAM/network bytes were not instrumented; no scalability benchmark claimed.

## Next milestones, in priority order

| Milestone | Data / design dependency | Acceptance criteria |
|---|---|---|
| 1. Terrain hazard validation | Co-registered HiRISE ortho, stereo quality masks, image review, documented navigation accuracy | Review demo route against visible rocks/dunes/scarps; record unresolvable hazards; validate frame alignment and conservative buffers; fail when mandatory hazard coverage is absent |
| 2. Human mobility scenarios | Full reduced-gravity suit literature; target suit mass/pressure; credible analog datasets and crew/task assumptions | Separate provenance for measured vs simulated inputs; evaluate multiple speeds/grades/substrates; no Earth/rover coefficients silently relabeled as Mars human performance |
| 3. Multi-destination product integration | Application API/stack decision, currently absent | Accept start/fixed end/required visits/return policy; expose infeasibility and snap displacement; integrate Mars CRS explicitly; regression tests at API boundary |
| 4. Optional scientific targets | CRISM/geology maps, expert POIs, service durations and reward definition | Orienteering solution includes all required visits, collects reward once, respects time/return constraints; compare small cases to brute-force oracle |
| 5. Real resource budgets | Suit oxygen, CO2, water, battery and thermal model; crew effort calibration | Independent resources cannot compensate for each other; return resources checked under documented degraded scenarios; reject missing mandatory rate/capacity input |
| 6. Illumination and environmental scenarios | SPICE epoch/kernels, wider terrain horizon, MEDA quality-filtered records, MCD terms/version | Validate Sun/time/frame calculations; distinguish station history, climatology and forecasts; do not use WMTS shade as quantitative lighting |
| 7. Communication/navigation constraints | Relay ephemerides, antenna/link model, surface localization covariance | Validate horizon/LOS and operational blackout limits; map uncertainty margins; no assumed Mars GPS availability |
| 8. Alternative routes and uncertainty | Calibrated penalties/distributions, classification and DEM errors | Report nondominated feasible alternatives with fixed normalizations; sensitivity to spatially correlated errors; avoid unsupported probabilistic safety claims |
| 9. Scale and replanning | Multi-tile data/quality cache, controlled reprojection, changing observations | Benchmark realistic crops and stop counts; move to Held–Karp/solver and incremental search only when measured bottlenecks justify it |

## Reproducibility and dependency choices

Python 3.13; only NumPy, Rasterio and PyProj are direct runtime dependencies, pinned to the versions installed for this execution. `unittest`, HTTP probing, SHA-256, heap queues and permutation enumeration use the standard library. There is no ROS, training framework, database, web framework or frontend dependency. The local `.venv` is ignored; installs did not alter an existing application environment.

Use the commands in the [README](../../README.md). Fresh acquisition goes to a new `data/` path; identical cached requests verify the crop hash and reuse it. A mismatched request or incomplete cache fails instead of overwriting user data. Network failures do not trigger synthetic fallback. The prepared demo crop makes the test suite independent of archive availability.

Real vs synthetic: included TIFF is a byte-value-preserving crop of real stereo-derived Mars data, not direct human/ground-truth terrain measurements. Requested destinations are demonstration locations, not approved landing/base/science sites. Scenario speed, penalties and reserves are engineering assumptions. Analytic arrays in unit tests are labeled synthetic. No artificial environmental, oxygen or metabolic outputs are supplied.

## Remaining limitations and blockers

No blocker prevented the first milestone. The principal blocker to an **operationally credible** planner is calibrated terrain/human/suit evidence, not the availability of A* or an API. The current model omits unresolved obstacles and soil strength, physical consumable constraints, history-dependent fatigue, weather, illumination, communications and shelter failure. DEM-derived permitted cells mean only that represented constraints pass.

The acquisition adapter supports one verified source; arbitrary planetary products need explicit adapters/quality rules. The terrain loader deliberately rejects unsupported projections, Earth frames, large/polar crops and missing metadata. A general Mars GIS pipeline should add transformations with tests, not relax those checks.

No frontend, live web service, mission certification, large-data throughput test or optional-reward optimizer was built. Existing repository placeholders are untouched. Source licenses and endpoint availability should be rechecked before production distribution, especially MCD and any repackaged/third-party datasets.
