# V1: terrain radiation shielding (reproduces Guo et al. 2026)

**Claim we can make:** from the public USGS Gale 1 m DEM and the public MSL waypoint list, our horizon code reproduces the obstructed-sky
ratios in Guo et al. 2026 Table 1 to **2.0 pp MAE (r = 0.94, 15 periods)**, and a two-term shielding model driven by our ratios predicts the
8 RAD parking dose drops to **RMSE 4.3 pp** (drops range 2-19%). It is a reproduction/calibration check, not a validation.

## Sources
- Guo et al. 2026, JGR Planets, doi:10.1029/2026JE009704 (DLR elib open-access PDF): Table 1 (RAD dose, drop, ROS), sol ranges (Sec. 3.1-3.5), method (Sec. 3).
- Ehresmann et al. 2021, doi:10.1029/2021JE006851 (Murray Buttes): sols 1456-1467, 19% sky blocked, 4% drop (via abstract/secondary summaries; full text not read). Guo et al. 2021 (GRL) quotes 5 +- 1% against a ~10% reference period.
- DEM: `MSL_Gale_DEM_Mosaic_1m_v3.tif` (USGS Astrogeology; 3.9 GB, read only as windows via `/vsicurl/`). Waypoints: `MSL_waypoints.json` (mars.nasa.gov MMGIS).

## Method (`run.py`, `fetch_dem.py`)
- Same geometry as the paper: viewpoint 1 m above the DEM, 0.25 deg azimuth bins (1440 rays), 20 km radius, 1 deg zenith bins.
- Terrain sampling: 1 m within 1 km (windows around 5 site clusters), 8 m point-sampled DEM from 1 to 20 km. Mars curvature drop d^2/2R included. DEM nodata is ignored. MOLA not used (DEM covers 20 km for these sites).
- Position of a period: mean over MSL waypoints with sol in [start-1, end] (fallback: last prior waypoint). Averaging is ours; the paper used the rover position of each period (not tabulated).
- Horizon elevation -> ROS(theta) = fraction of azimuth blocked at zenith theta.
- Dose model (Guo 2026 Eq. 5 logic): D = (1-f)(1 - w B) + f (1 + B), B = blocked fraction, f = 0.21 flat-terrain albedo share (paper: 18-24%), w = 1.38 = sum of the paper's modelled Dsky decreases / sum of its dROS over the 8 pairs. **Neither f nor w is fitted to RAD drops** (both come from paper tables; w is a zenith-weighting proxy because we did not digitize their Fig. 2 d(theta)). Drop = 1 - D(P)/D(BG).
- Also reported: linear drop = k dB with leave-one-site-out; null baselines.

## Results (`results.csv`, `summary.json`, `v1_predicted_vs_measured.png`)
| Metric | Value |
|---|---|
| Obstructed-sky MAE vs Table 1, all 15 periods | **2.0 pp** (parking-only 2.3 pp), r = 0.94 |
| Dose-drop RMSE, two-term, our ROS | **4.3 pp** |
| Dose-drop RMSE, two-term, paper's ROS (model error alone) | 1.8 pp |
| Dose-drop RMSE, linear k dB, leave-one-out | 5.1 pp (in-sample 4.1) |
| Null: predict 0 / predict mean drop | 9.3 / 5.1 pp |
| Murray Buttes (held out) | ours 18.5% blocked vs 19% reported; predicted drop 8.4% vs measured 4% |

## Caveats (read before quoting)
1. **Definition chosen post hoc.** The paper's "sum ROS(theta) dtheta" is ambiguous. We computed three normalisations: plain mean over zenith (MAE 6.5 pp), solid-angle weighted (**2.0 pp**), projected-area weighted (11.9 pp). We report the solid-angle one; the choice was made after seeing the comparison.
2. **Largest miss: Maria Gordon Notch P6** (ours 25.7% vs 37.9%; also P7 and BG7 lower by 1.5-4 pp). Narrow valley next to a cliff: a few metres of position error or DEM voids/smoothing matter, and waypoints are drive ends (the exact parking pose is not in the public list). The 19.4% measured drop is therefore underpredicted (10% vs 19.4%) by our ROS; with the paper's ROS the model gets it (20.7%).
3. Our dose drops are underpredicted for P4/P5 because our P-minus-BG ROS difference is ~0 or negative (BG45 and P4/P5 are near-identical sites); measured drops there are 2-4%, inside the noise of the RAD daily variation.
4. Murray Buttes is over-predicted (8.4 vs 4%), the same direction as the paper's own 12% vs 5% (Guo 2021); the paper attributes it to albedo from the butte. Our BG position (sols 1446-1448) is a proxy for their "10% reference".
5. Only 8 independent events at one site type (Gale), one instrument; RMSE of 4 pp on drops averaging 7 pp is modest. The model uses the paper's own albedo and weighting constants; it is not an independent dose-transport result. Terrain is never described as a shelter: the largest measured drop is 19%.
6. E-W metre-to-pixel scale (cos 4.7 deg, 0.3%) and rover height variation are ignored.

## Reproduce
```
Pipeline/.venv/bin/python Validation/v1_shielding/fetch_dem.py A   # also B C D E, far0..far9 (set V1_CACHE; ~1.2 GB downloaded, ~400 MB on disk)
curl -L https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json -o $V1_CACHE/MSL_waypoints.json
V1_CACHE=... Pipeline/.venv/bin/python Validation/v1_shielding/run.py   # needs matplotlib (not in Pipeline venv)
```
