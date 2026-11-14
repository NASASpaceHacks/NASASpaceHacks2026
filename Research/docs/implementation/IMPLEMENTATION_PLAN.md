# Implementation roadmap

Planning baseline: 2026-11-14. Existing Python terrain routing is implemented and 18 tests passed during this audit. This roadmap identifies remaining engineering work; it is not permission to start implementation during the research task. No dates or team throughput are assumed. Complexity: S = bounded local change, M = several connected changes, L = scientific/integration uncertainty or substantial state-space expansion.

## MVP acceptance and scope

One prepared 256 × 256 native Jezero DEM crop, two endpoints, directed scenario-time routing, a shortest-distance comparison when added, terrain metadata, geometry/profile, explicit model assumptions and source provenance. Replay from public real terrain without network access at request time. Existing required-stop CLI stays available but is not a prerequisite for the first HTTP interface.

Success means a reproducible terrain/scenario route, not an approved EVA route. No claim of safe footing, calibrated walking time, metabolic expenditure, consumable sufficiency or future weather. The included real-data demonstration already fulfills the terrain proof of concept; the MVP's remaining product value is a clear, bounded backend contract and reviewed terrain interpretation.

## Milestone 1 — Data acquisition and region registration

**Status:** real acquisition adapter and crop already exist. **Complexity:** S for registration; M for matching imagery and transfer instrumentation.

Tasks:

1. Register `jezero-demo-256` using [existing sidecar](../../examples/jezero_dem.json), crop hash and read-back header; record native bounds `[77.44783511,18.44284401,77.45215399,18.44716288]` in east-positive planetocentric degrees.
2. Preserve the exact S1 source URL, label, product ID, CRS WKT, vertical lineage, window and attribution in a versioned region manifest. Separate published footprint from usable-data footprint.
3. Review acquisition publication/concurrency: stage TIFF and metadata, verify both, then publish a complete manifest under a per-region lock. Preserve fail-on-incomplete-cache behavior.
4. Independently verify range access with a few KB; instrument transfer bytes before allowing larger crop preparation. A native strip source can fetch tens of MB for a small crop.
5. Identify the matching USGS ortho asset and footprint before any image-window retrieval. Verify registration and reuse conditions; do not assume a nearby individual HiRISE DTM shares the crop footprint.

Dependencies: existing Rasterio/PyProj/NumPy, cached crop, USGS product labels; network only for fresh verification/imagery. Outputs: ready region manifest, source/coverage evidence, a bounded acquisition specification. Validation: cached SHA-256 matches, frame/radius/transform/units read back, boundary coordinates round-trip, numeric asset remains distinguished from rendered products, no full-raster transfer. Risks: source outage, TLS failures, byte-range changes, strip amplification, missing aligned ortho. Cached real DEM permits progress if remote imagery is unavailable; imagery readiness must remain explicit.

## Milestone 2 — Terrain processing and quality

**Status:** slope, NoData halo, edge-grade checks and optional obstacle interface exist. **Complexity:** M.

Tasks:

1. Reuse native-grid distance correction, slope and support masking. Store derivative algorithm/version and valid footprint in the manifest.
2. Keep unthresholded slope separate from policy masks. Define conservative hazard buffering only after footprint/navigation margin is supplied; do not call the one-cell derivative halo a safety buffer.
3. Review the actual corridor against aligned imagery where available; annotate visible rocks/scarps/dunes and unresolved areas with provenance and confidence semantics. Unknown ground remains unknown.
4. If needed for the first comparison, derive detrended plane-fit RMS at a declared window size with support halo. Initially expose roughness as a diagnostic; a penalty awaits justified scaling/calibration.
5. Validate CRS, transform and alignment of masks, not only their dimensions. Preserve step hazards and NoData through any future resampling.

Dependencies: Milestone 1; matched ortho for real visual hazard annotation. Outputs: versioned elevation/slope/support assets, optional reviewed exclusions and roughness, terrain-quality note. Validation: analytical planes, isolated step, missing-data neighborhoods, registration tie checks, read-back metadata, no positive safety inference from missing classifications. Risks: noisy stereo derivatives, unobserved foot hazards, crop-edge halos, terrain concealed by image lighting. An unavailable hazard layer must not block a clearly labeled terrain-only demonstration, but must block requests requiring that layer.

## Milestone 3 — Routing model and objective boundary

**Status:** directed A*, reverse Dijkstra and time/reserve check exist. **Complexity:** S–M for objective/error semantics; L for general resource constraints (deferred).

Tasks:

1. Reuse scenario-time A*. Add distance objective with its admissible metric heuristic; preserve directional time metrics even when optimizing distance.
2. Version the explicit demonstration model and expose assumptions. Retain separate max cell slope and edge-grade checks; no negative science edge rewards.
3. Report post-search rejection as `CANDIDATE_BUDGET_REJECTED`, not global infeasibility. If complete single-leg constrained-time feasibility is required, prune on arrival time + reverse return + reserve within search and test a counterexample to post-validation.
4. Define identical-cell endpoint behavior and requested-to-center snapping consistently. Recompute exported metrics from actual returned edges.
5. Record runtime, peak memory, expanded nodes and cold/warm results for varied real-crop endpoints; set service limits from measured evidence.

Dependencies: Milestone 2 supported terrain, explicit scenario policy. Outputs: objective-aware callable core, feasibility semantics, regression fixtures and benchmark record. Validation: A*/Dijkstra optimal-cost agreement, asymmetric uphill/downhill cases, no corner cutting, no excluded cells, reserve/dwell boundaries, no-path scoped to crop, actual real-crop replay. Risks: objective/budget tradeoffs need nondominated labels; grid bias and finite region can hide detours. Do not implement multi-resource, dynamic or multiobjective solvers merely to expose an API.

## Milestone 4 — Backend API and application integration

**Status:** absent. **Complexity:** M.

Tasks:

1. Implement the proposed FastAPI boundary around core functions, not by spawning the CLI. Begin with regions, terrain metadata and `POST /api/v1/routes`.
2. Validate body/frame, coordinate ranges, finite values, scenario settings, required layer coverage, endpoint mapping, crop limits and request size. Reject unsupported objectives/constraints explicitly.
3. Add persisted route retrieval, metrics and elevation profile using SQLite and local immutable assets. Include all provenance, versions, uncertainty and scope fields in [BACKEND_ARCHITECTURE](../architecture/BACKEND_ARCHITECTURE.md).
4. Expose hazard availability honestly; an empty result must not imply no unknown hazards. Keep full geometry separate from optional decimated preview.
5. Keep terrain preparation offline. Run bounded routing outside the event loop; add durable single-host jobs only if measured latency requires them.
6. Validate a future frontend integration fixture with explicit Mars geometry, actual coverage and route overlay. A complete frontend build is outside this backend milestone.

Dependencies: Milestone 1 manifests, Milestone 2 data, Milestone 3 semantics; install proposed HTTP dependencies only during implementation. Outputs: documented OpenAPI contract, example request/result, persistent result access, reproducible single-host deployment instructions. Validation: contract tests, read-only offline replay, source outage while cached routes remain usable, hash failure rejection, rate/compute limits, correct CORS and Mars display assumptions. Risks: accidental Earth geodesics/GeoJSON handling, event-loop blocking, SQLite write contention, arbitrary-path/URL inputs. No need for a distributed system at this scale.

## Milestone 5 — Evidence-led improvements

**Status:** future, separately prioritized. **Complexity:** M–L.

| Priority / task | Dependency | Output and acceptance | Main risk/blocker |
|---|---|---|---|
| 1. Calibrate or bound human locomotion | Primary study extraction, suit/crew/substrate assumptions | Separate time and energy model provenance; reproduce published domain first; hold-out validation and honest extrapolation limits | No suitable real Mars suited data; no universal default safety limit |
| 2. Better hazards and uncertainty | Aligned images, stereo quality, localization model | Reviewable masks, declared buffers and route sensitivity; no fake Gaussian per-cell errors | Foot-scale coverage unavailable |
| 3. Performance/caching | M3 benchmarks, growing user/region demand | Version-complete cache keys, array-efficient search if measured; immutable tiled assets when warranted | Premature infrastructure or hazard-erasing downsampling |
| 4. Multiple required visits / alternatives | Stable API and directed pair costs | Expose existing <=8-stop behavior; compare small cases to exhaustive oracle; scenario alternatives labeled correctly | One path per pair fails some constrained problems |
| 5. Illumination and environmental context | Epoch/kernels, wider horizon DEM, quality-filtered MEDA; MCD terms if used | Time/frame-validated geometry and historical/model context, with units and source times | Climatology mistaken for forecast; crop too small for shadows |
| 6. Optional scientific POIs | CRISM/geology interpretation, expert utility and dwell | Unique-reward orienteering under explicit budgets; no negative cycles | Utility is mission-defined; patchy coverage |
| 7. Physical resources / degraded return | Suit/crew rates/capacities, shelter and contingency policy | Independent consumable inequalities and nondominated constrained paths; validate against mission scenarios | No reliable public inputs; state explosion |
| 8. Broader coverage and dynamic replanning | Verified CTX/HRSC/MOLA adapters, local observations, product alignment | Hierarchical corridors only where appropriate; D* only for demonstrated map updates | Coarse context cannot establish pedestrian traversability |

## Dependency-aware release checklist

- [ ] M1: immutable registered region, hash/CRS/coverage verified.
- [ ] M2: supported derivative masks and explicit hazard gaps; reviewed image alignment when used.
- [ ] M3: correctly named objectives/feasibility, A*/Dijkstra agreement and real-crop benchmark.
- [ ] M4: bounded API, schema tests, result provenance, offline behavior and deployment checks.
- [ ] Release as a **terrain/scenario research planner** with uncalibrated time clearly visible.
- [ ] Add M5 capabilities only after their data and model gates pass; never expand the safety claim merely because the interface has more layers.

First implementation task: register and validate the existing crop as a versioned prepared region with source/coverage/model metadata. Do not begin with another A* implementation or a planet-wide download.
