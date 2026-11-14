# Mars human surface routing: research audit

Audit date: 2026-11-14. Research and planning only; existing application code and earlier research are preserved. This document and the five linked planning documents describe the current repository, not the earlier empty-project state.

## Executive findings

A local, reproducible terrain-routing demonstration already exists. The strongest next step is to expose that tested core through a small backend with explicit region coverage, model assumptions, and unavailable-data behavior. Public orbital elevation supports terrain corridors; it does not establish safe human footing. Human mobility, spacesuit resources, emergency capability and weather require separate evidence.

Use the existing Jezero crop of the USGS Mars 2020 HiRISE TRN elevation mosaic. Retain directed raster A* and reverse Dijkstra. Implement only distance and explicitly labeled scenario-time objectives initially. Do not infer metabolic expenditure from mechanical work, boot traction from rover slip, or safety from valid elevation pixels.

## Repository audit and traceability

All project files were inventoried, including the parent application directories. No local PDFs, application API, frontend implementation, database configuration, or applicable AGENTS.md were found. External PDFs are referenced by the research. The virtual environment is an execution environment, not project research.

| Files inspected | Finding / consequence |
|---|---|
| [Original report](../../deep-research-report.md) | Rover-focused literature synthesis, data leads, proposed costs and algorithm comparisons; useful starting evidence, not a human requirements specification |
| [Bibliography](../../citation/citations.md) | Consolidates papers, sources and URLs; includes duplicate/malformed auto-extracted links and unresolved citation markers |
| [README](../../README.md), [handoff](../../main.md) | Current prototype, example commands, assumptions and outstanding usability/calibration work |
| [Earlier analysis](research_analysis.md), [inventory](dataset_api_inventory.md) | Traceability and historical source verification; early “no implementation” statement describes the initial state only |
| [Human EVA](human_eva_constraints.md), [assumption findings](routing_assumptions_findings.md) | Human evidence classes and explicit rejection of physiological validation for numerical defaults |
| [Earlier algorithm](routing_algorithm_design.md), [earlier roadmap](implementation_plan.md) | Implemented graph/model and remaining integration work; retain these as historical technical detail |
| [Acquisition](../../mars_routes/acquire.py) | One static USGS source; bounded crop, byte-range preflight, source/hash sidecar; no general discovery adapter |
| [Terrain](../../mars_routes/terrain.py) | Native spherical equirectangular Mars grid; local distance correction, slope, NoData support mask, optional obstacles; no roughness layer |
| [Routing](../../mars_routes/routing.py) | Directed eight-neighbor A*, reverse Dijkstra, exact ordering capped at eight visits, post-search time/reserve validation |
| [CLI](../../mars_routes/__main__.py), [package initializer](../../mars_routes/__init__.py) | Standalone package, JSON/CSV/GeoTIFF export; no HTTP service |
| [Requirements](../../requirements.txt) | NumPy 2.5.4, Rasterio 1.5.2, PyProj 3.8.0 pinned; existing Python 3.13 environment |
| [Tests](../../tests/test_routes.py) | 18 tests rerun successfully in this audit: analytic terrain, graph behavior, coordinates, return budgets, real crop/hash |
| [Examples](../../examples/jezero_dem.json) and two_point/multi_stop JSON, CSV, TIFF | Real cached 256 × 256 DEM; saved routes are demonstrations, not astronaut traverses |
| [Probe script](../../scripts/probe_sources.py), [historical evidence](evidence/http_checks.json), labels and validation log | Reusable bounded HTTP checks; new results saved separately in [planning_http_checks.json](evidence/planning_http_checks.json) |
| Parent Backend, Frontend/AdminView, Frontend/UserView | Only empty .gitignore placeholders; no competing application stack to preserve |

Scope of the eventual changes: retain acquisition/terrain/routing modules; add objective selection and HTTP boundary validation, metadata storage and API tests; extend fixtures for supported versus unsupported data. Existing callers are the CLI and tests. This task changes documentation only. Many files were already untracked at audit start; none were removed or committed.

## Evidence categories

- **Measured:** orbital images, laser altimetry, local meteorological/radiation observations. Measurements still have instrument, location and time limitations.
- **Derived:** stereo DEM, slope, roughness, distances, classifications, geometric illumination. Derivation does not make these direct human-performance observations.
- **Modeled:** scenario walking time, atmospheric climatology, future physiological or hazard models.
- **Engineering policy:** permissible slopes, weights, budgets, reserve, footprint and unknown-data rules. Configuration is not scientific validation.
- **Unverified lead:** records lacking inspected data, adequate terms, suitable coverage or reproducible coefficients.

## Findings by topic and relevant publications

### Terrain, graph search and observation

| Source / conclusion | Transfer to the human planner |
|---|---|
| Carsten et al. (2009), [10.1002/rob.20287](https://doi.org/10.1002/rob.20287): Field D* integrated with MER local navigation | Established precedent for graph routing plus local perception. Static A* is sufficient now; flight success does not certify human traversability |
| Hedrick, Ohi & Gu (2020), [10.1109/LRA.2020.3005123](https://doi.org/10.1109/LRA.2020.3005123), and Hedrick & Gu (2021), [10.1080/01691864.2021.1955000](https://doi.org/10.1080/01691864.2021.1955000): terrain-aware mobility and map updates | Reuse terrain-to-cost structure, not rover velocity/slip coefficients |
| Fink et al. (2019), [10.1016/j.pss.2019.104707](https://doi.org/10.1016/j.pss.2019.104707): 3D multi-objective traverse planning | Compare explicit objectives; a weighted-sum sweep need not recover every discrete Pareto optimum |
| Toupet et al. (2025), [10.1109/TFR.2025.3636366](https://doi.org/10.1109/TFR.2025.3636366); Daftry et al. (2022), [accepted manuscript](https://authors.library.caltech.edu/records/wmv09-93s03) | Local collision models and learned search acceleration are rover-specific. Do not repeat performance claims as reproduced results |
| Endo et al. (2023), [10.1109/ICRA48891.2023.10161466](https://doi.org/10.1109/ICRA48891.2023.10161466), [author code](https://github.com/omron-sinicx/safe-rover-navi) | Probabilistic slip/CVaR motivates uncertainty handling; synthetic rover models are not human fall probabilities |
| Candela & Wettergreen (2022), [10.1109/LRA.2022.3191949](https://doi.org/10.1109/LRA.2022.3191949) | Science selection needs unique-visit utility and constrained resources, not negative travel costs |
| Sakayori & Ishigami (2021), [10.1080/01691864.2021.1959396](https://doi.org/10.1080/01691864.2021.1959396); Rockenbauer et al. (2025), [author code](https://github.com/ethz-asl/scouting-ipp) | Energy-aware robot dynamics and scout coordination are future concepts; neither is an MVP dependency |

These rover conclusions are synthesized from the original report and the earlier [source-by-source review](research_analysis.md). This audit did not reproduce those papers' experiments or revalidate every bibliographic detail. Marker-only references in the original report remain unresolved. MarsTM-3D remains a release/coverage/license investigation lead, not a selected dataset.

### Human locomotion and EVA

NASA's Norcross reports distinguish simulated partial gravity, suit mechanics and task demand: [2009 walkback](https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf), [2010 level ambulation](https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2010-216115_PlanetarySuitMetabolicCosts.pdf), and [2010 inclined ambulation](https://ntrs.nasa.gov/citations/20110003409). The inclined report's public NASA record was confirmed through search; direct page retrieval timed out. Lunar analog results and tested inclines do not prescribe safe Mars slopes or emergency walkback distances.

[Kluis et al. (2025)](https://journals.physiology.org/doi/abs/10.1152/japplphysiol.00627.2024) found metabolic response depended on speed, simulated gravity and incline, including interactions. The twelve-person study used 0.25/0.5/0.75/1g, 1.34/1.79 m/s, and 0%/10% grade. It is a useful unsuited calibration lead, not validation of the prototype's 0.5 m/s or descent rule. Coefficients have not been reproduced here. [Minetti et al. (2002)](https://doi.org/10.1152/japplphysiol.01177.2001), retained from earlier research, shows nonlinear Earth walking energy on uphill/downhill gradients; an always-positive downhill time penalty is not that metabolic model.

Human-specific planning needs balance and footing, suit joint resistance and mass, fatigue/rest, task dwell, oxygen, CO2 removal, cooling/water, battery, localization and communications, and degraded return to shelter. No inspected source validates universal human Mars limits for these quantities. Use separate mission inputs and constraints; never exchange life-support reserve for science utility.

### Data coverage and environment

The chosen USGS mosaic covers approximately 77.223–77.584°E, 18.307–18.669°N at 1 m projected posting; the cached demonstration is only about 243 × 256 ground metres near 77.45°E, 18.445°N. Source labels and actual local raster agree on spherical Mars radius 3,396,190 m. See [source metadata](evidence/hirise_label.txt), [planetary label](evidence/hirise_pds3_label.txt) and [crop provenance](../../examples/jezero_dem.json).

HiRISE individual DTMs cover stereo footprints; CTX provides wider, coarser terrain; HRSC provides regional stereo mosaics; MOLA supplies global altimetric context. Native resolution and valid-data masks matter more than the map's display zoom. Full coverage/access detail is in [DATA_AVAILABILITY.md](DATA_AVAILABILITY.md).

MEDA and REMS provide historical local weather; RAD provides radiation observations at Gale. These are not continuous Jezero hazard maps. THEMIS thermal inertia is a derived material proxy, not soil strength. CRISM can inform science targets, not an objective universal science score. SPICE supports geometry when supplied with time/frame-valid kernels and terrain horizons.

## Contradictions, duplication and unsupported assumptions

1. The original rover plan proposes new algorithm implementations and bulk DTM conversion; Python routing and a native GeoTIFF crop already exist. Reuse them.
2. The 700 MB individual HiRISE DTM and 1.84 GB USGS mosaic are different products. Their sizes are not contradictory.
3. A 1 m posting does not imply metre-accurate elevation or visible boot-scale obstacles. The source's inter-mosaic offset is not a per-cell random error distribution.
4. “Roughness is available” means derivable; it is absent from the current code. The obstacle-mask interface exists, but the example has no validated real obstacle layer.
5. Current 0.5 m/s, grade factors 4/2, 15° exclusion, 60-minute budget and 10-minute reserve are scenario values, not validated safety settings.
6. Search/WMTS access is not numeric DEM access. Current probes distinguish metadata, imagery and numeric-file transport.
7. Current budget validation rejects a selected path after optimization; it is not a complete resource-constrained solver. Report this narrowly, especially for future shortest-distance and multi-resource objectives.
8. Parent directories remain placeholders; the earlier “no existing implementation” finding is obsolete for Research. No web framework has yet been selected in code.
9. Bibliography, handoff and six earlier research notes repeat defaults/source tables. Preserve them, but use this new document set for the prospective backend plan.
10. A cropped search can miss a detour outside the crop. “No route” must be scoped to the prepared region, model and solver capability.

## Unresolved questions and immediate implications

What real obstacles and uncertain stereo areas intersect the example corridor? Which suit/crew data can calibrate speed separately from energy? What clearance and localization margins apply? Which shelter and degraded-return assumptions does the mission authorize? Can quantitative hazard layers support anything stronger than a terrain-only demonstration? What latency/memory is acceptable on deployment hardware?

Those questions block operational safety claims, not the small research API. Next artifacts: [routing specification](../architecture/ROUTING_ALGORITHM.md), [backend design](../architecture/BACKEND_ARCHITECTURE.md), [roadmap](../implementation/IMPLEMENTATION_PLAN.md), and [readiness checklist](../IMPLEMENTATION_READINESS.md).
