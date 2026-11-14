# Routing algorithm and mathematical assumptions

Decision, 2026-11-14: **directed eight-neighbor raster A* for each leg, small exact asymmetric stop ordering, and reverse Dijkstra for return-time feasibility**. This is sufficient for a static local terrain/time demonstration. Use ordinary Dijkstra as an optimality check. Additional algorithms should solve demonstrated requirements, rather than serve as an initial benchmark collection.

## Representation and feasibility

Each supported DEM cell is a node. Adjacent horizontal, vertical and diagonal cells define candidate edges. Delete cells with NoData, unsupported derivative neighborhoods, explicit obstacles or scenario-prohibited slope. Delete overly steep edges. Reject diagonals if either adjacent cardinal cell is excluded, preventing corner cutting. Outer cells are excluded because the complete 3 × 3 support neighborhood is absent.

These masks establish **scenario feasibility with respect to represented terrain only**. A DEM cannot certify soil, small obstacles or suit safety. Future mission-critical hazard layers must each have an explicit observed/supported mask. Their absence cannot silently become zero hazard. Obstacles should be dilated by a mission-defined footprint plus navigation/error margin before graph construction. The current one-cell NoData halo is a derivative-support requirement, not a validated astronaut clearance distance.

No explicit graph library is needed: neighbors are generated on demand and `heapq` handles the priority queue. Rasterio/GDAL and PyProj handle geospatial I/O and transformations. This avoids materializing millions of Python edge objects or reimplementing raster formats and map projections.

## Coordinates, distance and slope

The source GeoTIFF and PDS3 label specify spherical Mars, radius `R = 3,396,190 m`, positive-east longitude, planetocentric latitude, equirectangular projection with standard parallel 0°. Input is `(longitude, latitude)` degrees, never `(latitude, longitude)`. Longitude is normalized to [-180,180); no dateline-spanning or polar crop is supported. Earth EPSG:4326/3857 are not substitutes. Source units and body are validated; unsupported projections fail explicitly.

For the equirectangular grid, projected pixel sizes are `Δx, Δy`. At cell-row latitude φ and projection standard parallel φ₁:

```text
east_ground_spacing(φ) = Δx cos(φ) / cos(φ₁)
north_ground_spacing  = |Δy|
h(i,j) = hypot(Δcolumn × mean(east_i,east_j), Δrow × north_spacing)
Δz = z_j − z_i
grade(i,j) = Δz / h(i,j)
d3(i,j) = hypot(h(i,j), Δz)
terrain_slope = atan(hypot(∂z/∂east_ground, ∂z/∂north_ground))
```

Angles are converted to degrees for policy comparison. Native elevation values are retained, with masked NoData converted to NaN before derivatives. `numpy.gradient` supplies central derivatives; the support mask excludes boundaries and neighborhoods containing missing values. Edge-grade checks catch sharp differences even when central slopes cancel. Elevation gain/loss sum directed `Δz`; sensitivity to DEM noise is an explicit limitation.

At Jezero, equatorial projection east-west scale differs from ground spacing by roughly 5%. The row-dependent correction avoids treating a projected metre as a ground metre. Edge distances use a **local spherical surface metric**, tested against PyProj's spherical geodesic on an analytical diagonal. This is an approximation, bounded operationally by rejecting crops wider/higher than 1° and latitudes above 80°; the demonstrated crop is only ~256 projected metres. It does not correct the radius for local topographic height. Future larger areas should use exact planetary geodesic edges or a validated local metric projection and conservative mask reprojection.

A spherical dataset makes planetocentric/planetographic latitude numerically identical within that sphere model. That does **not** authorize treating latitude types as interchangeable for ellipsoidal datasets. For an oblate ellipsoid at its surface, `tan(planetocentric) = (b²/a²) tan(planetographic)`; physical coordinate/height transformations require the specified frame and reference figure. The current loader rejects flattened ellipsoids rather than guessing.

Never merge CTX, HiRISE and HRSC by pixel index. Align body/frame, horizontal control and vertical datum first, then transform footprints and resample explicitly. Continuous elevation can use interpolation with coverage checks; categorical hazard masks require conservative aggregation. Averaging elevation or nearest-neighbor hazard sampling may erase cliffs. The prototype sidesteps this loss by using one native-resolution crop. Rendered hillshade/color/8-bit gray tiles never enter its elevation pipeline.

## Cost and units

The user's candidate `Σ(w_d D + w_t T + w_e E + w_r R)` is meaningful only after defining units and semantics. Metres, seconds, joules and unspecified risk scores cannot simply be added with dimensionless weights. Either use coefficients with explicit reciprocal units or fixed reference scales, for example `Σ[αd D/D₀ + αt T/T₀ + αe E/E₀ + αr R/R₀]`. Reference scales must stay fixed across route alternatives. Data-dependent min/max normalization changes policy when the crop changes. Distance, time and energy can also double-count the same effort.

The implemented first objective is **minimum scenario travel seconds**:

```text
t(i,j) = d3(i,j) / v0 × [1 + a_up max(grade,0) + a_down max(−grade,0)]
C(path) = Σ t(i,j)
```

`v0` has units m/s; grade and coefficients are dimensionless. Coefficients are finite and nonnegative. Defaults are v0=0.5, a_up=4, a_down=2. These are engineering assumptions, not fitted human models. Descending is not rewarded with negative cost. Edges are directed because ascent and descent take different scenario times. No arbitrary negative science reward is applied to edges. Max cell slope and max edge grade are separate hard checks.

Reported `3.71 × cumulative_ascent` J/kg is positive gravitational work per unit carried mass. It omits internal work, gait mechanics, suit resistance, substrate deformation, downhill work and metabolic efficiency. It is **not** oxygen consumption, caloric expenditure or total metabolic energy, and is not used to claim physical-resource feasibility.

For A*, the heuristic is Euclidean row/column displacement using the minimum east spacing anywhere in the crop, north spacing and v0. Every edge cost is at least its ground-distance lower bound divided by v0. The heuristic is consequently admissible and consistent for this graph. `use_heuristic=False` is Dijkstra; tests compare their optimal costs. Grid optimality is not continuous-terrain optimality; eight headings introduce discretization bias.

## Multiple stops and resources

1. Build permitted terrain and directed shortest paths for every required point pair. An unreachable pair is infinity, not a large finite penalty.
2. Store a directed cost matrix: `c_ij != c_ji` in general.
3. For ≤8 visits, enumerate permutations exactly. A closed traverse solves a small asymmetric TSP with fixed base; an open traverse holds final destination fixed and permutes intermediate stops. Constant service times do not alter the ordering optimum.
4. Concatenate cached leg paths, preserving actual movement costs and adding dwell time once at each scheduled visit. Passing through another destination's cell does not automatically count as servicing it.
5. Compute `R(x)` = minimum directed travel time **from x to base** by running Dijkstra from base on reversed edges. Using forward costs from base would be wrong on slopes.
6. At every route cell after elapsed travel/service time `τ`, require:

```text
τ + R(x) + reserve <= EVA_time_budget
```

The check includes dwell completion at stops and start reserve; a violation or infinite return cost fails the route. For a closed static shortest-time tour that fits the budget with reserve, the planned remaining suffix provides a return witness. The explicit per-cell check also handles open routes. Return assumes the same terrain, suit mobility and nominal pace; no injured-crew or failed-system model exists yet. Reserve is a configurable time quantity, not a validated contingency policy.

Future resource constraints should have separate states:

```text
Σ travel_time + Σ service_time + rest + operations + reserve_time <= time_budget
O2_used + O2_return + O2_reserve <= usable_O2
CO2_load <= scrubber_capacity
water_used + water_return + water_reserve <= usable_water
battery_used + battery_return + battery_reserve <= usable_energy
```

Each rate needs validated crew/suit/task/environment input. No public DEM can supply it. If two paths trade time against another resource, a single minimum-time path per destination pair may discard the only resource-feasible solution: retain nondominated path labels or use a constrained shortest-path method at that stage. Do not merely reject the first path and declare the physical problem infeasible.

## Algorithm selection and expansion

| Approach | Decision / trigger |
|---|---|
| A* / Dijkstra on raster | Implemented; deterministic, inspectable, positive costs, easy analytic tests |
| Explicit graph / road network | Implicit raster now; no Mars pedestrian road network assumed |
| D* Lite / Field D* | Defer until repeated local map updates justify incremental search; rover flight precedent alone is not a requirement |
| TSP / Held–Karp | Exact permutation for tiny required sets; Held–Karp or an established solver when visit count grows |
| Orienteering | Appropriate for optional scientific POIs: maximize nonnegative unique-visit reward under feasible tour resources, required visits and return |
| VRP with resources | Appropriate for multiple crews/sorties, differing capacities or shelters; overkill for one walking party |
| Multiobjective shortest path | Needed once validated competing costs matter; label-setting can grow exponentially |
| Time-dependent routing | Needed for moving shadows, temperature, relay windows and fatigue; add arrival time/state and waiting semantics, ensure FIFO assumptions or use time-expanded graph |
| Weighted sums / alternatives | Can sample supported Pareto tradeoffs, but miss nonconvex/discrete Pareto solutions. Prefer epsilon constraints with hard hazards unchanged; never call a weight sweep a complete Pareto frontier |

Scientific value belongs to destination selection (expert scores or explicit information-gain models), with sampling dwell time and no repeated reward collection. Geology/mineral maps locate candidates; they do not objectively determine a universal science score. Alternative paths can first be generated by varying permitted slope/time penalties, then filtered for duplicate geometry and dominance; this is designed, not implemented.

## Interfaces, verification and provenance

`acquire(path, center, size)` is the one working data adapter and verifies cache hashes. `prepare(z, transform, crs, cutoff, obstacle_mask)` accepts an aligned boolean obstacle mask; it rejects misalignment in array shape/type but upstream callers remain responsible for spatial alignment. `shortest_path`, `return_times`, `order_stops` and `validate_budget` form the routing interface. CLI coordinates, DEM sidecar, scenario settings and output metrics are retained in `route.json`.

Output geometry uses longitude/planetocentric latitude/elevation with explicit Mars metadata; it is **not Earth GeoJSON**. CSV is available for planetary GIS import; slope/mask/elevation GeoTIFF preserves the source CRS. The model does not silently transform to Earth Web Mercator for a frontend.

Tests cover analytic planes, coordinate round trips, Mars geodesic spacing, NoData halos, isolated steps, barriers, corner cutting, unreachable points, uphill/downhill costs, A* versus Dijkstra, directed visit ordering, dwell/reserve violations and reverse return direction. A separate real-crop test checks hash and route viability. Tests establish implementation correctness against stated assumptions; they do not validate astronaut safety.

Research basis: [Carsten et al. (2009)](https://doi.org/10.1002/rob.20287) establishes rover global/local integration; [Hedrick et al. (2020)](https://doi.org/10.1109/LRA.2020.3005123) motivates terrain-dependent travel-time maps; [Fink et al. (2019)](https://doi.org/10.1016/j.pss.2019.104707) motivates explicit tradeoffs. The equations, thresholds and engineering choices above are this prototype's assumptions, not formulas attributed to those papers.
