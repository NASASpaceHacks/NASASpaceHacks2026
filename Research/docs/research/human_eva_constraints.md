# Human EVA constraints and evidence

Checked 2026-11-14. No human Mars surface walking measurements exist. Evidence classes below are **M** = measured on Mars by instruments, **S** = simulated reduced gravity/suited experiments, **A** = Earth analog, **E** = engineering assumption, **D** = derived/model quantity. A Mars instrument measurement is not evidence of astronaut tolerance.

## Human-performance evidence

Norcross et al., *Feasibility of Performing a Suited 10-km Ambulation on the Moon*, NASA/TP-2009-214796, [technical report](https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2009-214796_EVA%20Walkback%20Test.pdf), used controlled suit/partial-gravity simulation. The lunar walkback result is not a Mars return radius; the report explicitly raises concerns about Mark III performance at Mars gravity. **Class S**, not Mars field evidence.

Norcross et al. (2010), *Metabolic Costs and Biomechanics of Level Ambulation in a Planetary Suit*, NASA/TP-2010-216115, [full report](https://www.lpi.usra.edu/lunar/artemis/NorcrossEtAl_NASA-TP-2010-216115_PlanetarySuitMetabolicCosts.pdf), investigates suit and reduced-gravity locomotion. Suit pressure, mass, gait and simulator conditions matter. Results justify calibration by suit/task/gravity; they do not justify multiplying Earth speed or energy by 0.38. **Class S**.

Norcross et al. (2010), *Metabolic Costs and Biomechanics of Inclined Ambulation and Exploration Tasks in a Planetary Suit*, NASA/TP-2010-216125, [NTRS record](https://ntrs.nasa.gov/citations/20110003409), extends investigation to grade and exploration tasks under simulated lunar conditions. Applying coefficients to Mars is an extrapolation. The NTRS record was available in search, while direct retrieval intermittently timed out. **Class S**.

NASA (2022), *Human Thermal Assessment of Traverse and Geology Task Iterations During Simulated Lunar Extravehicular Activity*, [NTRS 20220009966](https://ntrs.nasa.gov/citations/20220009966), describes a two-subject pilot using Mark III and ARGOS lunar offload. It supports treating thermal strain as coupled to activity and cooling, with major sample/environment limits. **Class S**, lunar analog.

NASA's [Human Performance technical reference](https://www.nasa.gov/reference/4-0-human-performance/) provides wider mission design context. It is not a source of universal Mars walking cutoffs. Earth analog traverses can help test navigation workload, fatigue, sampling service times and interface usability, but do not reproduce simultaneous Mars gravity, suit mechanics, pressure and regolith. **Class A** applicability must be declared for every imported model, including Earth hiking-speed equations.

## Variables and routing treatment

| Variable | Why it matters / evidence | Geographic representation | Proposed treatment and uncertainty |
|---|---|---|---|
| Slope / ascent / descent | Balance, muscular demand, falls; M terrain, S mobility response | DEM finite differences at specified baseline; directed elevation changes | Hard exclusion only under an explicit mission/scenario policy; soft directional cost inside permitted terrain. DEM errors and suit limits separate |
| Roughness | Irregular footing and step negotiation; M orbital morphology, no universal Mars human response | Detrended plane residual at multiple scales, not raw height variance on a hillside | Soft penalty or exclusion if calibrated; below-resolution roughness stays unknown. Not implemented |
| Rocks / boulders / steps | Trip, fall, suit puncture and body-clearance concerns; M imagery, E human policy | Co-registered ortho masks plus local stereo/LiDAR when available | Confirmed hazards excluded with footprint/localization buffers. A 1 m posting does not resolve all boot-scale hazards |
| Regolith / loose sand / traction | Bearing, sinkage, slipping and effort; M rover observations, S/A material studies | Terrain class and thermal-inertia proxies, sparse in-situ observations | Uncertain class-specific penalties; mission-defined exclusions for unsuitable material. Rover wheel slip is not human friction or fall probability |
| Cliffs / crater rims / unstable terrain | Falls and collapse; M morphology, unmeasured local stability | Slope, relief, mapped scarps, image review | Hard masks/buffers for verified hazards; DEM slope alone cannot detect overhangs or establish stability |
| Visibility / navigation | Landmark loss, dust, shadow and localization error | D horizon/viewshed, image texture, local measurements | Informational until a visibility model is validated; hard blackout constraints when mission policy requires; spatially varying localization uncertainty |
| Walking speed at ~0.38g | Determines return/time exposure; S evidence, no M human evidence | Function of grade, substrate, gait, suit, crew and load | Scenario range, not a fixed scientific constant. Slower is not automatically metabolically optimal |
| Suit mobility | Pressure joints, inertial mass, center of mass and range of motion | Suit/crew configuration, not orbital raster | Suit-specific calibration and task constraints; changed suit means changed model |
| Metabolic expenditure | Consumes O2, produces CO2/heat, drives fatigue | Time integral of validated task/grade/crew response | Resource constraint when calibrated; presently unknown. Positive gravitational work is only a mechanical proxy |
| Fatigue / exertion | Degrades pace, task performance and recovery capacity | History-dependent crew state, duration/rest/service schedule | Conservatively budget/rest; not an additive stationary raster. No fatigue model implemented |
| Oxygen / CO2 removal / water / battery | Limits life support, not interchangeable resources | Suit initial state, rates, reserves, measured remaining capacity | Separate hard resource budgets with emergency reserves; none can be traded for science reward |
| EVA duration | Integrates travel, task, rest, airlock and contingencies | Mission schedule and suit/crew constraints | Configurable hard scenario budget now; no universal safe number of hours asserted |
| Thermal constraints | Metabolism, radiation, cooling and suit state interact | M weather + D illumination and suit heat balance | Hard suit operating envelope once supplied; air temperature alone is insufficient; no thermal feasibility claim |
| Emergency return | Injury, suit fault, navigation loss or infrastructure failure | Directed cost-to-shelter, remaining consumables, degraded mobility scenarios | Hard feasibility at every route position. Prototype checks time to start at nominal scenario speed only |
| Communications | Earth latency prevents immediate tactical support; local topography blocks links | Relay ephemerides and terrain LOS, antenna/link budget | Mission-dependent hard blackout bound or soft penalty; geometric LOS is not link availability |
| Surface/air temperature | Affects suit heat exchange, material behavior and operations | M MEDA/REMS point series; D MCD/thermal models | Time-tagged context; avoid inventing continuous measured temperature maps from point stations |
| Dust / atmospheric conditions | Visibility, deposition, suit contamination and radiative forcing | M local dust/optical sensors/orbital products; D scenarios | Scenario penalties/operating envelopes; no precise future storm forecast claimed |
| Solar illumination / shadow | Visibility and thermal balance | D Sun geometry + terrain normals/horizons from DEM | Time-dependent layer, not a static shade image; cast shadows need terrain beyond the route crop |
| Ionizing radiation | Exposure integrates over time and varies with space weather/shielding | M RAD time series, D transport and shelter models | Dose constraint/mission-level context; DEM elevation is not a detailed dose-rate map |

## Environmental sources and interpretation

[MEDA archive and product documentation](https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda_old.html), Rodríguez-Manfredi et al. (2021), dataset DOI [10.17189/1522849](https://doi.org/10.17189/1522849), provides actual Jezero measurements. Calibrated products and quality flags are needed; archived data describe the rover's past environment. MEDA radiation/dust channels must not be conflated with penetrating ionizing dose measurements.

Hassler et al. (2014), *Mars' Surface Radiation Environment Measured with the Mars Science Laboratory's Curiosity Rover*, *Science* 343:1244797, [DOI 10.1126/science.1244797](https://doi.org/10.1126/science.1244797), [author institutional record](https://research-portal.uu.nl/en/publications/mars-surface-radiation-environment-measured-with-the-mars-science/), establishes **M** surface radiation evidence at Gale. Conditions, shielding and solar modulation prevent treating a reported average as a safe EVA exposure threshold or a Jezero spatial raster.

Fergason et al. (2006), [THEMIS thermal-inertia study](https://agupubs.onlinelibrary.wiley.com/doi/abs/10.1029/2006je002735), establishes **D from M** thermophysical mapping. Grain size, rock abundance and induration can influence thermal behavior; the inverse mapping to traction is nonunique.

[MCD documentation](https://www-mars.lmd.jussieu.fr/mars/info_web/) and [access cautions](https://www-mars.lmd.jussieu.fr/mars/access) describe **D** climatology based on GCM output and observational validation. Interpolation/averaging smooth variability; outputs are neither direct local measurements nor guaranteed extremes. Use multiple dust/season scenarios with documented version and terms.

NASA (2022), *Communication Delays, Disruptions, and Blackouts for Crewed Mars Missions*, [NTRS 20220013418](https://ntrs.nasa.gov/citations/20220013418), supports planning for substantial latency and blackouts. [NAIF kernels](https://naif.jpl.nasa.gov/naif/kernelsavailability.html) and [illumination routine documentation](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/illumf_c.html) support future geometric calculations; they do not provide a surface hazard policy or complete communications link model.

## Explicit scenario assumptions in code

The default **0.5 m/s**, uphill multiplier coefficient **4**, downhill coefficient **2**, **15°** cutoff, **60 min** budget and **10 min** reserve are **E**, selected to demonstrate behavior. None is claimed to be conservative enough for actual EVA. No human oxygen, metabolic energy, fatigue or thermal quantity is fabricated. The 3.71 m/s² mechanical-work calculation represents approximate Mars gravity, not a calibrated metabolic model.

The graph rejects DEM NoData and its one-cell neighborhood, but valid elevation does not mean every safety variable is observed. Unmodeled soil, obstacles, physiology and weather remain explicit output limitations. A production system should require supported coverage for each mandatory hazard layer and fail closed when it is absent.

## Uncertainty plan

Keep measurement error (height/position), resolution limits, classification confidence, model error and future environmental variability separate. Store source time, scale, frame and processing with each layer. Never derive per-pixel confidence from a mosaic's median registration offset. Mask unknown critical hazards rather than assigning zero risk.

First sensitivity exercise: rerun plausible suit-speed/grade scenarios and progressively stricter slope masks; report route stability and ranges as **scenario ranges**, not confidence intervals. Later use validated distributions and spatially correlated DEM/classification perturbations; report probability of reserve violation only after calibration. Emergency cases should include slowed crew, failed cooling or navigation aids, and shelter unavailability. Nominal return-time feasibility alone cannot establish rescue feasibility.
