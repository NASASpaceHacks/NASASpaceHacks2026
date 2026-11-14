# Analysis of the original report

Checked 2026-11-14. Scope: human pedestrians on Mars. Primary conclusion: **real elevation-based corridor routing is feasible now; astronaut-safe route certification is not supported by the available map and human-performance evidence.**

## Repository findings

Read the entire 35,456-byte `deep-research-report.md`, titled *Mars Rover Route-Planning Literature: Variables, Datasets, Algorithms, and a Reproducible CS Project*. It is the only initial Markdown report. The parent repository has `Backend`, `Frontend/UserView`, and `Frontend/AdminView` containing only `.gitignore` placeholders. No application source, routing APIs, dependency manifests, tests, or applicable AGENTS.md were found. There is no existing implementation to integrate or migrate. All changes are contained in `Research`; the report is unchanged.

The report recommends HiRISE Jezero elevation, slope/roughness masks, grid costs, A*/D* comparisons, simulated map updates, learned wheel-slip uncertainty, and eventual science utility. It also suggests AI4Mars classification and two open-source robot planners. Its useful core is data → terrain assessment → graph search. Its proposed algorithm bake-off, ROS scout, wheel mechanics and training pipeline are outside the first pedestrian milestone.

The exported report contains opaque `turn...` citation tokens. Those tokens are not independently resolvable references. Verification here uses its explicit DOI/URL links and new primary sources. A publication abstract or repository README confirms scope and availability, not reproduction of an experiment. No original-paper numerical performance claim is treated as an astronaut result.

## Traceability

| Report recommendation / claim | Original or replacement primary source | Verification on check date | Human implementation decision |
|---|---|---|---|
| Jezero DTM `DTEEC_023524_1985_023379_1985_U01`, 1 m, 700 MB | [HiRISE product page](https://hirise.lpl.arizona.edu/dtm/ESP_023524_1985) | Product ID, posted size and scale confirmed; full IMG not downloaded | Valid alternative; choose existing USGS GeoTIFF to avoid PDS conversion |
| Elevation should feed slope and traversability | Fergason et al. (2020), [TRN production paper](https://www.hou.usra.edu/meetings/lpsc2020/pdf/2020.pdf); USGS [dataset DOI](https://doi.org/10.5066/P9REJ9JN) | Numeric Float32 elevation actually acquired and processed | Implemented with native-grid Mars distance correction |
| HiRISE public-domain imagery | [HiRISE usage policy](https://www.uahirise.org/media/usage.php) | Policy checked; credit requested | Credit source; separately retain USGS product use constraints (none) |
| MOLA global 4–128 pixels/degree | [PDS MEGDR documentation](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) | Documentation confirmed; initial Python TLS failure, repeat GET 200 | Context and long-range elevation only; 128 ppd is approximately 463 m at equator |
| Terrain-aware time maps | Hedrick, Ohi & Gu (2020), RA-L 5:5181–5188, DOI [10.1109/LRA.2020.3005123](https://doi.org/10.1109/LRA.2020.3005123), [author paper via conference](https://ras.papercept.net/images/temp/IROS/files/2624.pdf) | Terrain class/expected-velocity planning supported | Reuse architecture, replace rover speed/slip with explicitly uncalibrated pedestrian scenario |
| Thermal/soil feedback and slip | Hedrick & Gu (2021), DOI [10.1080/01691864.2021.1955000](https://doi.org/10.1080/01691864.2021.1955000) | Bibliographic lead retained; full 2021 methodology not independently evaluated | No pedestrian traction coefficients inferred |
| Flight global replanning with Field D* | Carsten et al. (2009), JFR 26:337–357, DOI [10.1002/rob.20287](https://onlinelibrary.wiley.com/doi/10.1002/rob.20287) | Publisher abstract confirms integration and Mars runs | Static A* first; incremental replanning only once observations change maps |
| Multiobjective 3D Dijkstra / GRTOP | Fink et al. (2019), PSS 179:104707, [author institutional record](https://experts.arizona.edu/en/publications/globally-optimal-rover-traverse-planning-in-3d-using-dijkstras-al-2/) | Publication and multiple-traverse scope confirmed; code not verified | Retain directed graph and metrics; do not claim all weighted runs recover every Pareto solution |
| ENav collision checks | Toupet et al. (2025), T-FR 3:83–124, [IEEE record](https://ieeexplore.ieee.org/document/11265757), DOI 10.1109/TFR.2025.3636366 | Primary record confirms 24 November 2025 publication and rover architecture | Supports local perception requirement; rover body checks do not validate suited walking |
| Learned heuristic preserves model-based checks | Daftry et al. (2022), RA-L 7:5461–5468, [Caltech manuscript record](https://authors.library.caltech.edu/records/wmv09-93s03), DOI 10.1109/LRA.2022.3156654 | Manuscript availability confirmed; speedup not reproduced | No ML dependency in prototype; hazards cannot be traded away |
| CVaR slip uncertainty and reusable code | Endo et al. (2023), ICRA, DOI [10.1109/ICRA48891.2023.10161466](https://doi.org/10.1109/ICRA48891.2023.10161466); [official repository](https://github.com/omron-sinicx/safe-rover-navi) | Code, MIT license and experiment links confirmed; not installed | Conceptual uncertainty reference only; synthetic rover slip is not boot traction |
| Science-aware reward | Candela & Wettergreen (2022), DOI [10.1109/LRA.2022.3191949](https://doi.org/10.1109/LRA.2022.3191949); [CMU account](https://www.cs.cmu.edu/news/2022/balancing-risk-reward-in-space) | Author institution confirms paper and exploration aim; technical implementation not reproduced | Optional science becomes a stop reward subject to safety/resource constraints |
| Energy-aware rover planning | Sakayori & Ishigami (2021), Advanced Robotics 35:1302–1316, [publisher](https://www.tandfonline.com/doi/abs/10.1080/01691864.2021.1959396) | Rover dynamics and energy-management scope confirmed | Wheel power / solar-array equations do not transfer to metabolism |
| Scout/follower informative planning | Rockenbauer et al. (2025), RA-L 10:1776–1783, [official repository](https://github.com/ethz-asl/scouting-ipp), DOI 10.1109/LRA.2024.3513036 | Repository and citation confirmed; no ROS execution | Defer until a genuine scouting platform and observation model exist |
| AI4Mars semantic data | [NASA dataset record](https://data.nasa.gov/dataset/ai4mars-a-dataset-for-terrain-aware-autonomous-driving-on-mars) | Public record exists; license still unspecified there | Ground-camera learning resource, not georeferenced orbital coverage; mirror size/license not independently verified |
| MarsTM-3D, published 11 November 2026 | [IEEE early-access record](https://ieeexplore.ieee.org/abstract/document/11789780), DOI 10.1109/TGRS.2026.3752726 | Date/title/reconstructed-scene scope confirmed | Stable downloadable release not verified; do not describe reconstructed LiDAR as measured Mars LiDAR |
| Suggested 2–5 km crop, 2 m resampling, millions of cells on laptop | Report's engineering recommendation | Not a measured benchmark; neither performance nor hardware claim reproduced | First crop is 256 × 256 at native posting; no averaging that could hide hazards |

## Corrections and new evidence

The report's combined risk/reward cell cost is a proposed synthesis, not a validated formula. Negative science reward on travel edges can create pathological loops; safety must be enforced before optimization. Turning penalties require heading in the search state if they are to be optimized correctly. Neither feature is necessary for this milestone.

Pixel posting is not spatial accuracy or obstacle detectability. The USGS product metadata describes inter-mosaic registration and a median vertical offset, not independent per-pixel Gaussian errors. Therefore the prototype does not generate artificial confidence intervals from those values. Reported uncertainty must include unresolved rocks, material properties, DEM seams, localization and human response.

NASA reduced-gravity suited tests supply the missing human context. They are controlled simulations, often lunar, and cannot establish Mars emergency walkback distance, maximum slope, EVA duration or oxygen budgets. See [human evidence](human_eva_constraints.md).

MCD is model climatology with scientific-use and redistribution restrictions, not an unrestricted weather REST API. Mars Trek WMTS is a visualization interface. PDS Search and USGS STAC are real metadata APIs; actual numeric elevation comes from product assets. See [inventory](dataset_api_inventory.md).

## Result and unresolved questions

Executed: small public DEM acquisition, hash/provenance cache, coordinate conversion, slope/mask calculation, A*, directed return costs, exact small stop ordering, time-budget rejection and exports. The included routes use real terrain and hypothetical destinations; analytical tests use explicitly synthetic arrays.

Needed before credible astronaut planning: suit/crew locomotion calibration; terrain-class and obstacle validation; local navigation error and footprint buffers; emergency mobility assumptions; suit oxygen/CO2/water/battery/thermal telemetry; time-resolved illumination and communications; mission-approved policies. No current implementation resolves those scientific and operational gaps.
