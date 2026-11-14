# V2: suited metabolic model calibration (Norcross et al. 2010 IST-2)

**Claim we can make:** the engine's Pandolf + Santee model scaled by g/g_E is within **~11% MAPE for 0.22-0.32 g** (max error 14%) on NASA's suited
Mark III data (20 conditions: 5 offload levels x 4 grades), but **under-predicts by 30-60% at 0.12-0.17 g** (overall MAPE 20.8%). 0.38 g (Mars) is an
**extrapolation beyond the 0.32 g maximum**; there is no measured data there.

## Data (honest provenance)
Norcross et al. 2010, NASA/TP-2010-216125 (NTRS 20110003409), IST-2: 6 male astronauts, mean mass 80.7 kg (Table 1), Mark III 121 kg total suit mass, 29.6 kPa, offloads 0.12-0.32 g, grades 0/10/20/30%.
**The report has no numeric table of the mean VO2 per condition; the data were DIGITIZED** from Fig. 36 (p.37): `digitize_fig36.py` tracks the plotted per-gravity polynomial trend lines (raster colour tracking, 300 dpi), fits a quadratic, and evaluates at 0/10/20/30%.
Estimated digitization error ~ +-0.5 mL/kg/min (about +-4% of W). Cross-check against differences stated in the text (highest-minus-lowest offload): 0%: 1.9 stated vs 1.8; 10%: 3.5 vs 4.6; 20%: 8.7 vs 8.9; 30%: 17.0 vs 14.7 (trend lines sit below the 30% markers, so high-grade measured means may be underestimated by us; this makes the model look better at 0.32 g/30% than it may be).
VO2 -> W: mL/kg/min x 80.7 kg x 20.1 kJ/L / 60.

## Model (same as engine)
Pandolf: M = 1.5W + 2(W+L)(L/W)^2 + eta(W+L)(1.5V^2 + 0.35VG), Santee correction for G<0 (unused here), whole result x g/g_E. W = 80.7, L = 121, eta = 1.
**Speed:** per-subject speed was PTS-0.7 m/s (range 0.56-0.97 m/s per Sec. 4); the mean is not reported, so we use the midpoint 0.765 m/s. Sensitivity: MAPE 28.6% at 0.56, 21.7% at 0.97 m/s. This is a real source of uncertainty.

## Results (`results.csv`, `summary.json`, `v2_model_vs_data.png`)
- Overall MAPE **20.8%**, mean signed error -16.8% (under-prediction). 0.22-0.32 g only: MAPE 10.6%; 0.12-0.17 g: 36.0%.
- Why: measured VO2 has a gravity-independent floor (about 14-16 mL/kg/min even at 0.12 g), whereas scaling the whole Pandolf output by g sends the standing/load terms toward zero.
- **Leave-one-gravity-level-out:** the model has no fitted parameters, so the uncalibrated error is the out-of-sample error. A single fitted scalar k (geometric mean obs/model on 4 levels) was also tried: held-out MAPE 26.8% (worse than uncalibrated 20.8%; k is poorly determined because the error structure is gravity-dependent, not a scale factor). We do not recommend it.
- 0.38 g predictions (W, uncalibrated, 0/10/20/30%): 458 / 663 / 868 / 1074. No measured data exist at 0.38 g in this dataset; treat as an extrapolation.

## Caveats
1. Digitized trend lines, not raw subject data. 2. Speed assumption. 3. Mean-subject mass vs per-subject masses. 4. Lab data in a POGO partial-gravity offload rig, not true Mars gravity and not a Mars-suit mass (121 kg is the heavy test suit; the Mars suit is lighter).
5. The model is the engine's; the paper's own regression (Fig. 75) is a different, empirical model.

## Reproduce
```
Pipeline/.venv/bin/python Validation/v2_metabolic/digitize_fig36.py nor.pdf outdir   # optional; digitized_fig36.csv is committed
Pipeline/.venv/bin/python Validation/v2_metabolic/run.py                             # needs matplotlib
Pipeline/.venv/bin/python Validation/make_numbers.py
```
