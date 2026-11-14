# Routing assumptions: implementation, evidence and research gaps

Recorded 2026-11-14 from the research and follow-up discussion in this conversation. This consolidates findings; it does not introduce a newly calibrated model. Source availability was checked during that research, not rechecked for this documentation-only update.

## Main conclusion

There is research supporting the importance of gravity, suit configuration, speed, incline and terrain. **The exact prototype values were not fitted to that research.** Flat speed 0.5 m/s, uphill coefficient 4, downhill coefficient 2, and the 15-degree exclusion are engineering assumptions. No source identified in this investigation validates this combination for astronauts on Mars.

Real terrain does not make the human-performance model validated. The planner demonstrates reproducible terrain-aware routing, not operational EVA safety.

## Variables actually used

| Variable | Acquisition or derivation | Current role / value |
|---|---|---|
| Elevation, metres | USGS HiRISE Jezero stereo DEM, read as numeric elevation from a GeoTIFF | Supplies elevation differences, slopes and route metrics; no independent weight |
| Horizontal distance, metres | Pixel positions, source Mars CRS and latitude-dependent ground-spacing correction | Contributes to distance and estimated time |
| Elevation change | Next-cell elevation minus current-cell elevation | Supplies directed grade and 3D distance |
| Uphill grade | Positive elevation change divided by horizontal distance | Dimensionless time multiplier coefficient **4** |
| Downhill grade | Magnitude of negative elevation change divided by horizontal distance | Dimensionless time multiplier coefficient **2** |
| Flat walking speed | User/scenario input, not measured from orbital data | **0.5 m/s** default |
| Cell slope | Elevation gradient across neighboring cells using ground distances | Exclude above **15 degrees** by default |
| Edge slope | Arctangent of elevation change divided by horizontal distance | Also exclude absolute edge slopes above **15 degrees** |
| Missing elevation | Source NoData mask and nonfinite values | Exclude missing cells, their immediate neighborhood, and unsupported outer boundary |
| Obstacles | Optional aligned boolean mask accepted by `prepare()` | Hard exclusion; no real rock/boulder mask is included in the demonstration |
| Destinations | User coordinates or fixed demonstration points | Required visits; choose order minimizing travel time |
| EVA time budget | User setting | **60 minutes** default, hard feasibility constraint |
| Return reserve | User setting | **10 minutes** default, hard feasibility constraint |
| Service/dwell duration | User setting per requested visit | **0 minutes** default; **2 minutes** in the saved multi-stop example |

The data pipeline reads the actual Mars elevation raster, not rendered map tiles or hillshade. Source and processing details are in [dataset_api_inventory.md](dataset_api_inventory.md) and the [crop provenance](../../examples/jezero_dem.json).

## Exact cost model

For a movement between adjacent permitted cells:

```text
h    = horizontal ground distance in metres
dz   = next elevation - current elevation, in metres
g    = dz / h                           # signed grade, not degrees
d3   = sqrt(h*h + dz*dz)                # 3D segment distance
t    = d3 / v0 * (1 + 4*max(g,0) + 2*max(-g,0))
cost = sum(t over all movements)
```

The coefficients are not percentages or normalized importance weights. A 10% uphill grade (`g=0.10`, about 5.7 degrees) gives a multiplier of 1.4; the same downhill grade gives 1.2. These factors multiply the baseline time for the 3D segment distance.

The current objective is estimated travel **seconds**. It is not a weighted sum of independently calibrated distance, metabolic energy, radiation and science scores. Hard exclusions are applied first and cannot be offset by a shorter route. Uphill and downhill costs differ, so costs between destinations are directional.

A constant change in `v0` scales all movement times; it changes budget feasibility but does not alone change the minimum-time path or required-stop order. Changing directional coefficients or exclusions can change the route. Fixed service durations are added to elapsed time; they do not change the ordering optimum when the same visits are required.

At every route cell, the implementation checks:

```text
elapsed travel and service time + shortest directed return time + reserve <= EVA budget
```

Return assumes unchanged terrain and nominal scenario mobility. It does not simulate injury or suit failure. Positive gravitational work (`3.71 * cumulative ascent`, J/kg) is reported separately; it is not metabolic expenditure or an optimization weight.

Implementation: [routing.py](../../mars_routes/routing.py), [terrain.py](../../mars_routes/terrain.py), [CLI defaults](../../mars_routes/__main__.py).

## Evidence for each assumption

| Assumption | Finding | What remains unsupported |
|---|---|---|
| 0.5 m/s | Reduced-gravity and suited studies show speed, gravity and equipment influence effort | No identified study establishes 0.5 m/s as a universal or safe suited Mars speed |
| Uphill coefficient 4 | Incline influences metabolic demand, including under simulated partial gravity | No identified source establishes 4 for our walking-time equation |
| Downhill coefficient 2 | Direction matters, and energy cost can vary nonlinearly with downhill grade | No identified source establishes 2; moderate downhill energy savings cannot directly determine travel time |
| 15-degree cutoff | Suited inclined-ambulation experiments exist | An experimental test slope is not a safety threshold; neither all terrain below 15 degrees nor all crew/suit configurations are proven safe |
| 60-minute EVA / 10-minute reserve | Mission planning needs resource and emergency-return constraints | These particular settings are demonstration choices, not fitted endurance or contingency limits |

## Sources and applicability

### 1. Norcross et al. (2009): suited walkback and simulated Mars conditions

**Citation:** Norcross, J. R., et al. *Feasibility of Performing a Suited 10-km Ambulation on the Moon: Final Report of the EVA Walkback Test (EWT).* NASA/TP-2009-214796. [Full NASA report hosted by LPI](https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf).

Evidence class: simulated partial gravity with a prototype suit, not Mars field measurements. The study also investigated Mars-gravity conditions; subjects in its Mark III configuration approached high physiological effort during brisk walking. The successful lunar walkback does not establish an equivalent Mars return distance. The report supports suit-specific performance modeling, not our particular speed or reserve. See the executive summary and the Mars locomotion discussion/figures.

### 2. Norcross et al. (2010): level suited locomotion

**Citation:** Norcross, J. R., et al. *Metabolic Costs and Biomechanics of Level Ambulation in a Planetary Suit.* NASA/TP-2010-216115. [Full report](https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2010-216115_PlanetarySuitMetabolicCosts.pdf).

Evidence class: controlled reduced-gravity simulation. This is relevant to effects of suit configuration and speed on metabolic and biomechanical response. It does not establish a general Mars pedestrian speed. Suit resistance, inertial mass and gait cannot be accounted for simply by multiplying an Earth model by 0.38.

### 3. Norcross et al. (2010): inclined suited locomotion

**Citation:** Norcross, J. R., et al. *Metabolic Costs and Biomechanics of Inclined Ambulation and Exploration Tasks in a Planetary Suit.* NASA/TP-2010-216125. [NTRS record](https://ntrs.nasa.gov/citations/20110003409).

Evidence class: prototype-suit experiments under simulated lunar conditions. Relevant to grade and exploration-task effects, but transfer to Mars needs justification. The record was identified and its scope checked; direct access intermittently timed out. No coefficients were extracted and fitted to this prototype. Do not cite it as certification of a 15-degree limit.

### 4. Kluis et al. (2025): partial-gravity metabolic model

**Citation:** Kluis, L., Wynn, C., Kennedy, D., and Diaz-Artiles, A. (2025). *Characterization of the effects of sex, speed, and incline on metabolic rate during partial gravity ambulation.* Journal of Applied Physiology, 139(3), 787-796. DOI: [10.1152/japplphysiol.00627.2024](https://doi.org/10.1152/japplphysiol.00627.2024). [PubMed abstract](https://pubmed.ncbi.nlm.nih.gov/40879065/).

Twelve unsuited participants used a treadmill and body-weight support. Conditions combined speeds of 1.34 and 1.79 m/s, gravity levels of 0.25/0.5/0.75/1g, and grades of 0%/10%. A mixed-effects model included speed/gravity and gravity/incline interactions. This is a useful quantitative lead for metabolic modeling, not a direct walking-time model. It did not directly test 0.38g, 0.5 m/s, downhill locomotion, 15-degree slopes, or a spacesuit. Interpolation in gravity and extrapolation outside tested speeds/slopes must be distinguished. Publisher full-page access returned 403 in one attempt; the abstract and indexed primary-source text were available. Coefficients and supplementary data have not yet been independently extracted or reproduced.

### 5. Minetti et al. (2002): nonlinear uphill/downhill energy costs

**Citation:** Minetti, A. E., Moia, C., Roi, G. S., Susta, D., and Ferretti, G. (2002). *Energy cost of walking and running at extreme uphill and downhill slopes.* Journal of Applied Physiology, 93(3), 1039-1046. DOI: [10.1152/japplphysiol.01177.2001](https://doi.org/10.1152/japplphysiol.01177.2001). [Original-paper PDF](https://runscribe.com/wp-content/uploads/power/Minetti2002.pdf).

Evidence class: Earth treadmill experiments. Moderate downhill walking could cost less metabolic energy than level walking; steeper descent increased cost again. This cautions against interpreting the prototype's always-positive linear descent penalty as a metabolic model. It does not directly calibrate a time penalty or validate a Mars suit model. Uphill/downhill energy, walking speed and fall risk should remain distinct quantities.

### 6. Additional lead: gravity and mechanically optimal speed

**Source:** *The role of gravity in human walking: pendular energy exchange, external work and optimal speed* (2000), DOI [10.1111/j.1469-7793.2000.00657.x](https://doi.org/10.1111/j.1469-7793.2000.00657.x), [PubMed](https://pubmed.ncbi.nlm.nih.gov/11060138/).

The abstract reports a mechanically optimal speed near 2.5 km/h at simulated 0.4g. A minimum in external mechanical work is not a validated optimum for suited metabolic expenditure, operational pace or safety. This is a further reading lead, not grounds to replace 0.5 m/s with a different universal constant.

## Variables still missing

No calibrated roughness, boot traction, sand sinkage, fatigue, oxygen/CO2, suit cooling, battery, radiation, changing weather, communications or science reward enters the current objective. The optional obstacle interface exists, but actual image-derived hazards are not loaded. Required stops are not an implemented optional-science orienteering problem. See [human_eva_constraints.md](human_eva_constraints.md) for the broader evidence matrix.

## Recommended next investigation

1. Extract experimental tables and model coefficients, recording suit, gravity simulation, surface, speed, incline, duration, participant count and measured response.
2. Separate a travel-time model from metabolic expenditure and from hard terrain policy. Never convert an energy multiplier into a time multiplier without a justified relationship.
3. Reproduce a published model only within its stated domain before extrapolating to Mars/suit conditions. Treat Kluis et al. as an unsuited baseline lead, not a complete solution.
4. Run sensitivity scenarios for uncertain pace, directional penalties and exclusions. Label ranges as scenario results, not confidence intervals.
5. Validate the current Jezero routes against co-registered imagery for rocks, dunes and scarps. Record unresolved hazards and spatial registration uncertainty.
6. Derive suit/crew resource budgets and degraded-return scenarios before replacing example time reserves with operational claims.

No code or coefficients changed as a result of the follow-up literature search. Calibration, full model reproduction, and operational safety validation remain outstanding.
