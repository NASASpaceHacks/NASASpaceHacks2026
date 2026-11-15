# V5: surface radiation dose compared with measured Curiosity RAD data

**Claim we can make:** the dose model in `Shared/src/engine/radiation.ts` (Guo 2015 form, Φ = 600 MV, P_ref = 750 Pa) compares with measured RAD
data as follows. Mean year-1 (2012-13) dose in the plastic detector E is **207.8 µGy/day measured** (0.208 mGy/day, matching Hassler 2014's 0.21 ± 0.04) against
**198.8 µGy/day modelled** at the measured REMS pressure (-4%). The model's anchor choices are weaker than that agreement suggests: P_ref = 750 Pa is
**160 Pa below** the REMS pressure at Ls 240 (909 Pa), and the dose scale depends on the solar-cycle epoch by tens of percent. This is a calibration
check on one rover and one solar-cycle phase, not a validation.


> **Applied after this analysis (2026-11-14):** `DOSE_P_REF_PA` 750 → **910 Pa** (the measured REMS pressure at Ls ≈ 240 near z_ref = −4500 m). Φ stays at 600 MV: the only present-day point is one sol (sol 4180, E = 167 µGy/day), too thin to set a new constant. An epoch-dependent Φ is in `docs/BACKLOG.md`. Route doses are indicative to about ±30 % (the measured spread at this season across the solar cycle). The table below describes the model **before** the change (P_ref 750 Pa).

## Data (all public; downloaded by `fetch.py` into git-ignored `data/`, 29 MB)
- **RAD:** PDS PPI `MSL-M-RAD-3-RDR-V1.0` (RAD_RDR, version V00), https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/ . Files `DATA/SOL_xxxxx_xxxxx/RAD_RDR_<yyyy_ddd_hh_mm_ssss>_V00.{LBL,TXT}` (one 17-30 MB file per sol); index `INDEX/INDEX.TAB`.
  Only the `TOT_DOSE_B` and `TOT_DOSE_E` values (unit in the label: **microGray / hour**, x24 here) and the observation start stamp were fetched with HTTP range requests, found via the offsets in each `.LBL`.
  B = silicon detector, E = plastic scintillator (tissue-like). **These are absorbed doses (µGy/day), not dose equivalents.**
- **Pressure:** PDS Atmospheres `mslrem_1001` REMS RDR, modified RDR (`RMD`) products, https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA/SOL_xxxxx_xxxxx/SOLnnnnn/RME_*RMD*.TAB (pressure = third column from the end, Pa; stated uncertainty ~3.5 Pa). Reduced on the fly to (LMST, pressure).
- **Sols sampled:** 131 RAD sols (every 10th sol 10-690, every 60th to sol 4780, plus a few extra), 29 of them in year 1 with a REMS file (sols 20-190 and 270-520, every 10th).
- Published numbers used for comparison (read from the papers, not re-derived): Guo et al. 2015, arXiv:1507.03473 (fit constants, κ_E = -0.13 ± 0.02, κ_B = -0.10 ± 0.06 µGy/day/Pa; β_E = -0.11 µGy/day/MV; D'01 = 267 µGy/day at P0 = 840 Pa); Rafkin et al. 2014, JGR Planets 119:1345 (κ about -0.116 µGy/day/Pa, as quoted by Guo 2015; first 350 sols); Hassler et al. 2014 (0.21 ± 0.04 mGy/day, 0.64 ± 0.12 mSv/day).

## Method (`run.py`)
- Dose: B and E per observation, µGy/hour x 24. Screening: an observation more than 12% above its sol median is dropped; a sol with 3 or more such observations is flagged as an **SEP candidate** and excluded (8 sols flagged: 340, 370, 390, 420, 630, 680, 690, 3280; sol 420 has 24 elevated observations). Isolated spikes (about 500-700 µGy/day single observations) are treated as bad observations. This is a data-driven flag, not checked against the published SEP event list.
- Pressure for a sol = mean over 24 local-time bins of REMS data (REMS sampling is not uniform in time).
- Diurnal barometric coefficient: within-sol, demean dose and pressure, pooled linear slope (the Rafkin/Guo logic). Only observations whose stamp is unique in the sol and chained to a neighbour by one observation length (32 min) are used, because many `START_OBS_MARS` stamps in the RDR are repeated or incremented by 1 s (see the archive's `TIMING_ERRORS.TXT`).
- Model: `267 - 0.13 (P - 840) - 0.11 Φ` µGy/day, copied from `radiation.ts`. It is the Guo fit for detector **E**, so E is the like-for-like channel.
- Ls for each sol from a two-body Mars orbit (landing Ls 150.7; about ±1 deg). Ls 240 season = Ls 225-255.

## Results (`summary.json`, `v5_measured_vs_modelled.png`)
| Quantity | Measured | Modelled / published |
|---|---|---|
| Year-1 mean dose, E (absorbed, tissue-like) | **207.8 µGy/day** | 198.8 at the measured mean 857 Pa, Φ = 600 (bias -9.0, sol-level RMSE 13.9) |
| Year-1 mean dose, B (silicon) | 215.9 µGy/day | the model is not a B model; E/B = 0.96 here |
| Dose equivalent from E x 3.05 | 0.63 mSv/day | Hassler 0.64 ± 0.12 (the quality factor itself cannot be tested from RDR doses) |
| Diurnal κ, E | **-0.066 ± 0.006** µGy/day/Pa (r = -0.61, n = 237) | ours -0.13; Guo -0.13 ± 0.02; **Rafkin -0.116** |
| Diurnal κ, B | -0.035 ± 0.014 (r = -0.16) | Guo -0.10 ± 0.06 |
| Mean pressure, Ls 225-255, year 1 (sols 130-170) | **910 Pa** (888-925) | P_ref assumed **750 Pa** |
| Mean E, same sols | 210.1 µGy/day | model with P_ref 750: 212.7; with 910 Pa: 191.9 |
| Φ that matches year-1 mean E (at κ = -0.13) | 518 MV; 436 MV at Ls 240 | assumed 600 MV |
| E at Ls 240, later years | 265 (sols 1480-1506), 296 (sol 2140), **167 (sol 4180, ~mid 2024)** | model, Φ = 600, 910 Pa: 191.9 |
| Long-term E (sol medians) | 149-320 µGy/day (solar max, minimum around sol 2900, next max) | model is a single number per P and Φ |

## Findings
1. **Mean level:** the model reproduces the year-1 mean E to -4% with the correct pressure. Our dose-equivalent number (0.64 mSv/day) is consistent with Hassler.
2. **P_ref is the weakest constant.** Measured year-1 mean pressure at Gale was 857 Pa, and 910 Pa in the Ls 240 window, so 750 Pa underestimates pressure by 160 Pa. It gives a reasonable dose (212.7 vs 210.1) only because it cancels the Φ = 600 that is too high for 2012-13. Both errors move the dose by about 20 µGy/day in opposite directions.
3. **Φ and epoch matter more than anything else.** The Guo linear fit was made on 2012-13. Measured Ls-240 dose was 210 µGy/day in 2012-13, 265-296 at solar minimum (2016-19) and 167 around mid-2024. The linear fit with Φ = 600 cannot reach 296 (it would need negative Φ), and even Φ = 250 MV gives only 230. Use of the model away from 2012-13 conditions is extrapolation. Φ is a scenario-epoch parameter, not a constant.
4. **Barometric coefficient:** our measured diurnal κ_E is about half the published values (-0.066 vs -0.116 to -0.13). We think the main cause is our noisy observation times (the RDR stamps are unreliable, which attenuates a regression slope) and the small number of usable observations (237 from 29 sols), not a physical disagreement; we did **not** reproduce Rafkin's value, and we do not claim the published one is wrong. The sign and significance are right (r = -0.61). The sol-level year-1 pressure-dose relation is positive (dose and pressure both rose from sol 100 to 190) because the solar-modulation trend dominates; no seasonal coefficient can be fitted from this sampling.
5. **Scenario season (Gale, Ls ≈ 240):** the REMS pressure range is 888-925 Pa (sols 130-170, one year) and 750 Pa lies outside it. Φ = 600 MV lies inside the range implied by the 2012-24 data (about 436 MV at Ls 240 in 2012-13, about 820 MV in 2024), but a single constant cannot represent both.

## Recommended constant changes (the orchestrator applies them; not made here)
- **P_ref: 750 -> 910 Pa** at z_ref = -4500 m for the Ls 240 scenario (mean 909.6, range 888-925 Pa, year 1 only; 840 Pa if a season-free annual mean is wanted, 857 Pa measured in the sampled year-1 sols). Keep the 11 km scale height.
- **Φ: make it an epoch input.** If P_ref changes to 910 Pa, Φ = 600 gives 192 µGy/day, which is 9% below the 2012-13 Ls-240 measurement (210) and 15% above 2024 (167). Suggested defaults: **Φ ≈ 440 MV to reproduce 2012-13, Φ ≈ 820 MV to reproduce 2024**; for a present-day (2025-26, near the cycle 25 maximum) scenario use about 800 MV (single-sol basis; low confidence). Do not change Φ without changing P_ref in the same step.
- **Quality factor 3.05: keep.** Measured E x 3.05 = 0.63 mSv/day matches Hassler's 0.64. The RDR dose tables hold no dose equivalent, so the factor is not tested here, and it may vary with epoch and shielding.
- κ = -0.13 and β = -0.11: keep (they are published Guo values; our own κ_E is lower but less reliable, see finding 4).

## Limits (read before quoting)
1. **One rover, one site, one instrument.** Gale only; RAD calibration (RDR V00 values) may differ from the Guo 2015 dataset.
2. **Solar-cycle phase.** The model constants come from 2012-13; later epochs differ by -20% to +40%. The later-year Ls 240 values use 1-5 sampled sols and an assumed 910 Pa (no REMS fetched after sol 700).
3. **Si vs tissue.** E (plastic) is the tissue-like channel and is what the model fits; B (silicon) is 4% higher in RDR doses. Absorbed dose and dose equivalent are kept separate; the 3.05 factor is a literature mean quality factor applied to E.
4. **Timing and SEP screening are heuristic** (see Method). The SEP flag is a >=3 observations x 12% rule, not a list of known events, and Forbush decreases are not removed.
5. Year-1 comparison uses 29 sampled sols, not all 680; the Ls-240 window has 5 sols from one year.
6. The Ls calculation is approximate (±1 deg).
7. The terrain shielding factor (v1) is separate and not touched here.

## Reproduce
```
Pipeline/.venv/bin/python -I Validation/v5_rad_dose/fetch.py   # ~30 min; writes data/ (needs network)
Pipeline/.venv/bin/python -I Validation/v5_rad_dose/run.py     # needs matplotlib (installed into the Pipeline venv)
```
