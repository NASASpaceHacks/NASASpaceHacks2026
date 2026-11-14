# Human Mars routing specification

Decision: retain the existing implicit, directed eight-neighbor raster graph and A*. Use Dijkstra as the reference oracle and reverse Dijkstra for minimum time to base. This is a static terrain/scenario planner, not an operational EVA safety model. Research basis and evidence limits are in [RESEARCH_SUMMARY](../research/RESEARCH_SUMMARY.md); variable sources are in [DATA_AVAILABILITY](../research/DATA_AVAILABILITY.md).

## Existing behavior versus planned behavior

[routing.py](../../mars_routes/routing.py) already minimizes scenario seconds, checks edge grades, forbids diagonal corner cutting, computes return times and orders up to eight visits. [terrain.py](../../mars_routes/terrain.py) supplies slope and a supported-cell mask. New work is objective selection, explicit API contracts and validation, optional roughness/real hazards, and correct semantics for constrained search. Do not rewrite A* or add a graph library merely to expose HTTP.

## Required layers and planetary geometry

Required: numeric elevation in metres; valid-data mask; full CRS/frame, grid transform and vertical reference; a declared scenario policy. Optional: spatially verified obstacle/quality masks with their own observed masks. If a requested mandatory layer is missing, reject the request. A terrain-only research mode must disclose unresolved hazards rather than pretending it has observed them.

For the selected spherical equirectangular source, radius R=3,396,190 m, standard parallel phi1=0, east longitude and planetocentric latitude. At row latitude phi:

```text
east_spacing = projected_pixel_width * cos(phi) / cos(phi1)
north_spacing = abs(projected_pixel_height)
h_ij = hypot(delta_column * mean(east_spacing_i, east_spacing_j),
             delta_row * north_spacing)
dz_ij = z_j - z_i
g_ij = dz_ij / h_ij                      # signed dimensionless grade
d_ij = sqrt(h_ij^2 + dz_ij^2)            # 3D polyline segment, metres
theta_i = atan(hypot(dz/deast, dz/dnorth))
```

The local metric matches the existing tests against a Mars sphere geodesic. It neglects topographic radius adjustment and is not a planet-wide guarantee. Preserve existing limits: north-up spherical equirectangular, less than 1° wide/high, below 80° absolute latitude, at most one million cells. MVP further restricts service routing to the registered 256 × 256 crop. Use planetary geodesic edges or a validated local Mars projection before expansion; do not call Earth-default distance routines.

Cell slope uses supported central differences; edge grade separately catches steps that a central derivative can miss. Preserve NoData, reject unsupported boundaries and derivative neighborhoods. Block excluded endpoints; snap only to the containing pixel center and report displacement. No search for a nearby “safe” replacement endpoint. Distances describe the center-to-center route; the access movement from requested coordinates to centers is not validated or included unless explicitly modeled.

## Hard feasibility and soft cost

| Variable group | Feasibility or objective role | Units / normalization and interactions |
|---|---|---|
| Elevation, distance, ascent/descent | Geometry; distance objective | Metres; elevation has no independent preference weight |
| Cell slope, signed grade, cross-slope | Explicit policy cutoff plus directional time penalty | Radians/degrees for cutoff; `dz/h` for grade. Cross-slope requires heading; no universal human threshold |
| NoData, unsupported quality, obstacles, cliffs | Hard exclusion when represented/required | Boolean with separate known mask. Buffer obstacles by supplied footprint + localization/map margin; derivative halo is not that buffer |
| Roughness, steps, rock abundance | Diagnostic initially; optional soft penalty or policy exclusion later | Plane-fit residual RMS in metres at fixed physical baseline; `q=r/r_ref`, fixed declared `r_ref>0`. No crop min/max normalization; sub-pixel roughness remains unknown |
| Terrain type, traction, sinkage, thermal inertia | Optional material-dependent pace/exclusion only after calibration | Categories and class confidence, not ordinal numbers. No mapping from thermal inertia or rover slip to human traction without data |
| Time, dwell, rest, reserve, shelter | Hard mission budget; time objective | Seconds, separately report travel/task/return. Changing global speed scales time but not the unconstrained minimum-time route |
| Suit mass, mobility, energy, fatigue | Future calibrated model and independent constraints | Joules/rates/history, not arbitrary elevation coefficients. Fatigue breaks a cell-only stationary state |
| O2, CO2, water/cooling, battery | Separate hard resource inequalities | Physical units/capacities/reserves; unavailable public route-ready inputs. Reject requests requiring these in MVP |
| Temperature, pressure, wind, humidity, dust | Future time-tagged exposure/model operating envelope | Kelvin, Pa, m/s, optical depth etc.; physiological implications require suit model. Never normalize disparate channels into a generic safety score |
| Illumination, shadow, visibility | Future time-dependent hard/soft rule | Epoch + geometry and horizon; static hillshade is not sunlight history |
| Radiation | Future integrated dose and mission limit | Dose-rate × time with shielding/space-weather uncertainty; not a DEM-only spatial penalty |
| Communications | Future permitted blackout duration / soft preference | Geometry + link model, seconds disconnected; LOS alone does not imply a usable link |
| Localization and measurement uncertainty | Coverage, footprint inflation, sensitivity | Metres/covariance only when supported; missing data is not zero uncertainty |
| Scientific value | Optional unique POI reward under budgets | Expert-defined score per visited target plus dwell, not a negative per-edge reward |
| Heading/turning | Future maneuver cost if justified | Angle and calibrated time; search state must include incoming heading |
| Changing hazards/scouting | Replan on supported new observations | Versioned map change, not invented observation probabilities |

Policies cannot be bought away by soft preferences. Mandatory hazards must be known and pass; otherwise fail closed for that requested capability. The MVP does not require unavailable physiological layers and explicitly limits its claim to the represented terrain scenario.

## Cost definitions and objectives

Existing demonstration-time model:

```text
t_ij = d_ij / v0 * (1 + a_up * max(g_ij,0) + a_down * max(-g_ij,0))
C_time(P) = sum(t_ij)
C_distance(P) = sum(d_ij)
```

Require finite `v0>0`, `a_up>=0`, `a_down>=0`. Current defaults v0=0.5 m/s, a_up=4, a_down=2 and slope cutoff 15° are uncalibrated engineering choices. Preserve them only in a named, versioned `demo-v1` scenario with explicit disclosure, not as mission-safe recommendations. Require an explicit scenario selection in the HTTP interface.

| Objective | Meaning and readiness |
|---|---|
| Shortest | Minimum represented 3D length subject to the same terrain masks; planned extension, not current CLI objective |
| Fastest | Minimum scenario time; existing implementation. Real fastest walking route is unknown without calibration |
| Safest | Undefined without specified hazards, uncertainty and policy. Initially expose slope/known exclusions/unknown coverage, not a “safety probability” |
| Lowest energy | Needs a validated suited metabolic model. `3.71 * cumulative_ascent` J/kg is positive gravitational work only; do not optimize or label it metabolic energy |
| Scientific value | Future constrained orienteering with reward counted once per POI, required visits and service time |

A possible future nonnegative terrain preference is `t_ij * (1 + beta_r*q_ij + beta_u*u_ij)`, where q is fixed-scale roughness and u is an explicitly defined dimensionless uncertainty indicator. This is an engineering proposal, not a fitted physical law. Keep beta terms disabled until layers and interpretation are reviewed; absent layers cannot be silently assigned zero to satisfy a requested capability.

For genuinely distinct calibrated objectives, use `sum(alpha_d*d/D0 + alpha_t*t/T0 + alpha_e*e/E0 + alpha_x*x/X0)`. Reference scales are fixed across requests/alternatives and stored with policy; weights are nonnegative user preferences, not scientifically derived constants. Avoid simultaneously weighting highly correlated distance, time and energy without explaining double-counting. Prefer explicit constraints/epsilon bounds when users cannot interpret weights. A weighted sweep can miss unsupported/nonconvex Pareto solutions.

Calibration: extract primary study domain (suit, gravity simulation, speed, grade, substrate, duration), reproduce reported outcomes within that domain, then fit time and energy separately with held-out analog data. Treat extrapolation to Mars suits as uncertain. Sweep grade coefficients/cutoffs and report path stability and scenario ranges; do not call ranges confidence intervals without calibrated error distributions. [Human evidence](../research/routing_assumptions_findings.md) explains why Earth hiking rules and reduced-gravity metabolic results cannot directly set Mars walking times.

## Search pseudocode and correctness

```text
validate coordinates, region, scenario and required layer coverage
construct supported mask and policy exclusions
map endpoints to containing cells; reject excluded endpoints
g[start] = 0; queue = [(heuristic(start), 0, start)]
while queue not empty:
    (_, stored_g, u) = pop_min(queue)
    if stored_g != g[u]: continue
    if u == goal: reconstruct parents; return path and cost
    for v in up to 8 adjacent cells:
        reject outside/unknown/excluded cells and excessive edge grade
        reject diagonal if either cardinal side cell is excluded
        candidate = g[u] + nonnegative_edge_cost(u,v)
        if candidate < g[v]:
            g[v] = candidate; parent[v] = u
            push(candidate + heuristic(v), candidate, v)
return NO_PATH_IN_PREPARED_REGION
```

For time use `h = hypot(delta_row*north_spacing, delta_column*min_east_spacing)/v0`; for distance omit `/v0`. These are lower bounds because 3D distance is at least horizontal distance and time multipliers are at least one. This establishes admissibility/consistency on the supported grid. Use h=0 if future costs cannot prove a valid bound. Do not casually multiply h (weighted A*) while claiming exact optimality. Costs are directed because ascent/descent differ even when mask adjacency is symmetric.

No continuous path optimum is claimed: eight directions introduce grid bias. Do not smooth lines through prohibited cells; any smoothing needs segment-level revalidation and recomputation of all metrics.

## Return, budgets and completeness

Compute `R(x)` with Dijkstra from base on the reversed graph, charging original cost `t(x→predecessor)`, not forward cost from base. For elapsed mission time tau at each position require `tau + R(x) + reserve <= budget`, including task completion. This proves only nominal scenario return under the same map and model. Injury, shelter failure and degraded suit performance need separate contingency models.

The existing implementation checks the selected route after search. A failure means **that candidate failed**, not that all possible constrained routes failed. Even minimum-time travel to a fixed goal can have an intermediate return constraint violated while another path complies. A planned single-leg time solver can prune candidates during expansion using arrival time plus R and reserve; earlier arrival dominates later arrival at a cell under static nonnegative costs. For shortest-distance with a time budget, or multiple resources, labels must retain nondominated cost/resource states; a single distance label is insufficient. MVP may keep post-validation and return `CANDIDATE_BUDGET_REJECTED` with `feasibility_complete=false`, rather than implement a full constrained solver immediately.

Required-stop ordering currently uses directed pairwise paths and factorial enumeration, capped at eight visits. Preserve as an existing capability but omit it from the first HTTP scope. Future constraints on intermediate return, time windows or physical resources invalidate assuming one unconstrained path per pair is sufficient. Degraded return must use a separately stated model; physical resources require independent inequalities, never conversion to a single arbitrary scalar reserve.

## Complexity, verification and limits

For N cells and E<=8N edges, binary-heap A*/Dijkstra worst-case time is O(N log N), memory O(N); Python object overhead remains significant. Reverse Dijkstra has the same bound. K destinations require up to O(K² N log N) pairwise work; current permutation ordering is O(K! K). Bounded-degree adjacency avoids materializing a graph. Future nondominated resource labels can grow exponentially; benchmark before expanding scope.

Retain the 18 passing tests. Add objective-specific A*/Dijkstra equivalence, directional and boundary cases, independent route metric recomputation, mandatory-layer rejection, and a candidate-budget-failure case with a feasible alternative to verify error semantics. For roughness use flat/tilted planes and known perturbations, not an implementation-mirroring test. Test actual crop coordinates and hash offline. Source outages must not produce synthetic terrain or imply no feasible physical route.

The scientific limitations remain foot-scale hazards, unknown substrate mechanics, no validated suited performance or consumable model, uncertain time-dependent environment and finite crop coverage. These belong in every route's metadata.
