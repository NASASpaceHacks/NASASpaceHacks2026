# Implementation readiness

2026-11-14: ready for a small real-terrain research backend; not ready for operational EVA safety planning. The repository already has numeric Jezero terrain, a routing core and 18 passing tests. This task added research/planning documentation and a new bounded HTTP evidence log only.

## Decisions and evidence

| Question | Decision |
|---|---|
| What research is sufficient? | Terrain-to-cost graph design, local Mars coordinate handling, directed route/return algorithms and need to separate rover mobility from human models |
| Which public sources work? | USGS HiRISE TIFF ranges and labels; PDS/ODE metadata APIs, USGS STAC and Mars Trek WMTS. The latter is display imagery, not numeric terrain. See [fresh evidence](research/evidence/planning_http_checks.json) |
| What is ready now? | Cached real elevation, coordinate-based distance, elevation profile/ascent/descent, slope/edge-grade constraints, scenario time, nominal return reserve and existing CLI required-stop ordering |
| What must be derived? | Roughness, image-reviewed obstacles/quality masks, heading-relative cross-slope and later illumination/LOS; none should be labeled direct human safety measurements |
| What lacks sufficient inputs? | Boot traction, sinkage, foot-scale hazards, validated suited pace/metabolism/fatigue, consumable/thermal limits, reliable local future weather, detailed radiation exposure and operational communications |
| Which algorithm? | Existing directed eight-neighbor A*, Dijkstra oracle, reverse Dijkstra to base. Add distance objective; preserve hard masks. Candidate budget rejection is not complete infeasibility proof |
| Which backend? | Python core + proposed FastAPI, local immutable rasters/JSON manifests, SQLite route records, one bounded worker if needed. No PostGIS/distributed stack until scale warrants it |
| Smallest credible MVP? | Two endpoints within the existing 256 × 256 native Jezero crop; actual route geometry, terrain metrics, scenario time and explicit missing hazards/provenance through REST |

The selected numeric source is the [USGS HiRISE TRN mosaic](https://doi.org/10.5066/P9REJ9JN). The local crop is approximately 243 × 256 ground metres near 77.45°E, 18.445°N. Its 1 m projected posting does not certify footing. [MOLA](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) is useful global context, not pedestrian obstacle coverage. HRSC Python access remains blocked by certificate validation; MCD access has use restrictions and supplies climatology. The [full matrix](research/DATA_AVAILABILITY.md) records those distinctions.

## Prioritized next tasks

1. **Register the existing real crop.** Validate checksum/header, publish source and valid coverage with planetary CRS/vertical lineage in a versioned region manifest; define atomic publication and transfer bounds for future acquisition. Output: one reviewable prepared region, no new bulk download.
2. **Stabilize the core's service contract.** Explicit demonstration scenario, objective support, snapping, unavailable-layer errors and honest candidate-budget rejection; benchmark the real crop and retain Dijkstra checks. Output: a bounded callable routing contract and acceptance fixtures.
3. **Expose the small REST service.** Implement region/terrain discovery, route creation/retrieval and profile using the existing modules; persist results and assumptions. Output: API contract tests and a replayable real-data request/response.

These are dependency-ordered. Real obstacle/imagery review can proceed alongside task 2, but cannot be claimed complete before the matching product and registration are verified.

## Completion gates

- [ ] Crop provenance, hash, WKT, radius, units, transform and valid footprint agree.
- [ ] Explicit east longitude/planetocentric latitude contract; no Earth geodesics or default Earth GeoJSON assumptions.
- [ ] Hard masks and unknown required data enforced; no implicit “safe” category.
- [ ] All costs/model coefficients have units, version and evidence class; scenario time is clearly uncalibrated.
- [ ] Correct directed return and post-validation error semantics; finite-region limitation disclosed.
- [ ] Warm/cold performance measured before request deadlines or concurrency are promised.
- [ ] Full route geometry, source lineage and metrics returned; frontend integration preserves Mars coordinates.
- [ ] Offline tests and API validation pass; archives can fail without synthetic fallback.

## Documentation map

- [Research summary and audit](research/RESEARCH_SUMMARY.md)
- [Variable/data feasibility matrix and exact access methods](research/DATA_AVAILABILITY.md)
- [Routing algorithm, equations and constraints](architecture/ROUTING_ALGORITHM.md)
- [Backend architecture and API contracts](architecture/BACKEND_ARCHITECTURE.md)
- [Milestones and acceptance criteria](implementation/IMPLEMENTATION_PLAN.md)
- [New HTTP verification evidence](research/evidence/planning_http_checks.json)

Earlier research, source code, requirements and examples remain intact. No backend was implemented, dependencies installed, large data downloaded, or changes committed/pushed. Full physiological model reproduction, all archive assets and operational safety validation remain outside verified readiness.
