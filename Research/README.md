# Mars pedestrian terrain-routing research prototype

A working, offline-replayable terrain route on **real USGS HiRISE stereo elevation data from Jezero**. This is a research demonstration: walking speed, grade penalties and slope exclusions are engineering assumptions, not astronaut safety limits. The original `deep-research-report.md` is preserved.

The repository originally contained that rover-focused report and empty Backend/Frontend placeholders. This standalone Python slice adds no frontend or service framework.

## Run

Python 3.13 was used. From this `Research` directory in PowerShell:

```powershell
py -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m unittest discover -s tests -v
.venv/Scripts/python.exe -m mars_routes --out outputs/jezero
```

The included 145 KB `examples/jezero_dem.tif` is a **real** 256 × 256 crop; its sidecar contains source URL, CRS, acquisition time and SHA-256. The default run uses it without network access. To independently acquire the same crop into a new cache:

```powershell
.venv/Scripts/python.exe -m mars_routes --fetch --dem data/jezero_dem.tif --out outputs/fresh
```

Remote window reads require HTTPS range support. The source is a 1.84 GB strip-organized GeoTIFF; the crop reader fetches relevant strips (roughly 22 MB of raster strip payload for 256 rows, plus headers/read buffering), not the whole raster. Exact network transfer volume was not instrumented. TLS verification remains enabled. Source outages fail explicitly; there is no synthetic fallback.

Explicit coordinates are **east longitude, planetocentric latitude**, in degrees:

```powershell
.venv/Scripts/python.exe -m mars_routes --start 77.4485183698317 18.44647962260933 --goal 77.4513863726576 18.443611619783454 --out outputs/explicit
.venv/Scripts/python.exe -m mars_routes --stop 77.45088025451184 18.446142210512168 --stop 77.44885578192887 18.444117737929194 --return-to-base --dwell-min 2 --out outputs/multi
```

For an open traverse, `--goal` is fixed last; intermediate stops are reordered. For a closed traverse, goal and stops are all required visits before returning to start. At most eight visits are supported. Stops snap to containing pixel centers; requested coordinates and cell indices are retained. Endpoints outside the crop or on excluded cells are rejected, never moved to a supposedly safer cell.

Outputs: `route.json` with Mars geometry, provenance, assumptions and metrics; `route.csv`; and three-band `terrain.tif` (elevation, slope, permitted-cell mask) with planetary CRS. The JSON is deliberately **not RFC 7946 Earth GeoJSON**. A consumer must implement Mars coordinates explicitly. Work estimates in J/kg mean positive gravitational work, **not metabolic expenditure**.

## Executed results

| Example | Length | Scenario walking time | Elevation gain/loss | Total with service |
|---|---:|---:|---:|---:|
| `examples/two_point/route.json` | 234.70 m | 8.76 min | 4.70 / 4.61 m | 8.76 min |
| `examples/multi_stop/route.json` | 609.07 m | 22.39 min | 10.43 / 10.43 m | 28.39 min |

Both use 0.5 m/s flat speed, 15° exclusion, 60-minute budget and 10-minute reserve. The closed route visits indices `0 → 2 → 3 → 1 → 0`, including two minutes of service per visit. Reverse directed Dijkstra checks time to base at every route cell. These are scenario-feasibility results, not physiological validation. A 5-minute budget run failed as expected.

Validation: 18 tests cover analytic synthetic cases and the cached real DEM. Final test/CLI results are recorded in `docs/research/evidence/validation.txt`.

## Research and evidence

- [Conversation handoff and project status](main.md)
- [Routing assumptions: findings and supporting research](docs/research/routing_assumptions_findings.md)
- [Original report analysis and traceability](docs/research/research_analysis.md)
- [Dataset/API inventory and HTTP outcomes](docs/research/dataset_api_inventory.md)
- [Human EVA evidence and uncertainty](docs/research/human_eva_constraints.md)
- [Routing model and design](docs/research/routing_algorithm_design.md)
- [Milestones and acceptance criteria](docs/research/implementation_plan.md)

Recheck small public requests with `.venv/Scripts/python.exe scripts/probe_sources.py`; this refreshes `docs/research/evidence/http_checks.json`. Some archive hosts failed certificate validation in this environment; those failures are recorded rather than bypassed.

Modules: `acquire.py` handles one verified source/cache; `terrain.py` handles coordinates, slope and masking; `routing.py` handles directed paths, ordering and time feasibility; `__main__.py` handles CLI/export. Synthetic fixtures in `tests/` verify analytical cases; the integration test uses the included real crop. No third-party rover code or pickled model was executed.

Missing: foot-scale hazard classification, calibrated suited locomotion, physiological consumables, changing weather/illumination, optional science rewards, route alternatives, larger-scale routing and application integration. The DEM alone cannot certify pedestrian traversability.
