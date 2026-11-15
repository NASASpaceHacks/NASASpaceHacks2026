"""V5: compares the Marswalk surface dose model (Shared/src/engine/radiation.ts, Guo 2015 form) with measured MSL RAD dose
(PDS PPI RDR) and REMS pressure (PDS Atmospheres). Needs data/ from fetch.py. Run: Pipeline/.venv/bin/python -I Validation/v5_rad_dose/run.py"""
import csv, glob, json, os, math
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
H = os.path.dirname(os.path.abspath(__file__)); D = f'{H}/data'
# --- model constants copied from Shared/src/engine/radiation.ts ---
P_REF, Z_REF, HS, PHI, QF = 750.0, -4500.0, 11000.0, 600.0, 3.05
model = lambda P, phi=PHI: 267 - 0.13 * (P - 840) - 0.11 * phi       # uGy/day, Guo 2015 plastic detector E
def ls_of_sol(sol, ls0=150.7, e=0.0934, ls_peri=250.99, per=668.6):
    # Mars areocentric longitude from sols since landing (Kepler, approximate: +-1 deg)
    nu0 = math.radians(ls0 - ls_peri); E0 = 2 * math.atan(math.sqrt((1 - e) / (1 + e)) * math.tan(nu0 / 2)); M0 = E0 - e * math.sin(E0)
    M = M0 + 2 * math.pi * sol / per; Ek = M
    for _ in range(30): Ek = M + e * math.sin(Ek)
    nu = 2 * math.atan2(math.sqrt(1 + e) * math.sin(Ek / 2), math.sqrt(1 - e) * math.cos(Ek / 2))
    return (math.degrees(nu) + ls_peri) % 360
# --- load RAD ---
# START_OBS_MARS is unreliable for many observations (runs of identical/1-s-increment stamps, see PDS TIMING_ERRORS.TXT). We keep an
# observation's time only when it is chained to a neighbour by one observation length (32 min, 1900-2000 Mars-clock s); others still count
# for sol means but not for the diurnal fit.
R = {}; seen = set()
for r in csv.DictReader(open(f'{D}/rad_dose.csv')):
    k = (r['file_sol'], r['obs'], r['mars_sol_frac'])
    if k in seen: continue
    seen.add(k)
    b, e = float(r['dose_B_uGy_h']) * 24, float(r['dose_E_uGy_h']) * 24
    if 50 < b < 600 and 50 < e < 600: R.setdefault(int(r['file_sol']), []).append((int(r['obs']), float(r['mars_sol_frac']), b, e))
def chain_valid(a):
    a = sorted(a); ok = []
    d = lambda x, y: ((y[1] - x[1]) % 1.0) * 86400
    cnt = {}
    for o in a: cnt[o[1]] = cnt.get(o[1], 0) + 1
    for i, o in enumerate(a):
        v = cnt[o[1]] == 1 and ((i > 0 and 1900 <= d(a[i-1], o) <= 2000) or (i + 1 < len(a) and 1900 <= d(o, a[i+1]) <= 2000))
        ok.append(v)
    return a, ok
# --- sol-level screening. SEP/outlier: an observation >12% above the sol median (diurnal tide is ~5% peak-to-peak). Sols with >=3 such
# observations are flagged SEP candidates and dropped; isolated bad observations are dropped individually. ---
sols = sorted(R); sep_sols = set(); Rc = {}
for s in sols:
    a, ok = chain_valid(R[s]); e = np.array([x[3] for x in a]); med = np.median(e)
    hi = e > 1.12 * med
    if hi.sum() >= 3 or len(a) < 20: sep_sols.add(s); continue
    keep = (e < 1.12 * med) & (e > 0.88 * med)
    Rc[s] = [(x, o) for x, o, k in zip(a, ok, keep) if k]
R = {s: [x for x, o in v] for s, v in Rc.items()}; Rok = {s: [x for x, o in v if o] for s, v in Rc.items()}
sols = sorted(R)
# --- pair obs with REMS pressure (mean of REMS rows at the same Mars time-of-day within the 32-min obs window) ---
pairs = []; solrows = []
for s in sols:
    p = f'{D}/rems_p_{s:04d}.csv'
    if not os.path.exists(p): continue
    P = np.loadtxt(p, delimiter=',', skiprows=1)
    if P.size < 100: continue
    tod, pp = P[:, 0] % 1.0, P[:, 1]
    for _, tt, b, e in Rok[s]:
        t0 = tt % 1.0; m = (tod >= t0) & (tod < t0 + 0.0222)
        if m.sum() >= 3: pairs.append((s, tt, pp[m].mean(), b, e))
pairs = np.array(pairs); ok = ~np.isin(pairs[:, 0], list(sep_sols))
clean = pairs[ok]
yr1 = clean[clean[:, 0] <= 690]
# --- 1. diurnal barometric coefficient (within-sol, Rafkin/Guo method): demean per sol, pooled slope ---
def kappa(arr, col):
    dx, dy = [], []
    for s in np.unique(arr[:, 0]):
        m = arr[:, 0] == s
        if m.sum() < 8: continue
        dx += list(arr[m, 2] - arr[m, 2].mean()); dy += list(arr[m, col] - arr[m, col].mean())
    dx, dy = np.array(dx), np.array(dy); k = (dx * dy).sum() / (dx * dx).sum()
    res = dy - k * dx; se = math.sqrt((res ** 2).sum() / (len(dx) - 2) / (dx * dx).sum())
    return k, se, float(np.corrcoef(dx, dy)[0, 1]), len(dx)
kE, kB = kappa(yr1, 4), kappa(yr1, 3)
# --- 2. sol-mean series, year 1 ---
S = []
for s in np.unique(yr1[:, 0]):
    Pm_ = np.loadtxt(f'{D}/rems_p_{int(s):04d}.csv', delimiter=',', skiprows=1)
    # sol-mean pressure: average of per-time-of-day bin means (REMS sampling is not uniform in time)
    bins = np.floor((Pm_[:, 0] % 1.0) * 24).astype(int); pm = np.mean([Pm_[bins == h, 1].mean() for h in range(24) if (bins == h).any()])
    a_ = np.array(R[int(s)])
    if len(a_) >= 20: S.append((s, pm, a_[:, 2].mean(), a_[:, 3].mean(), ls_of_sol(s)))
S = np.array(S)
# seasonal + time-trend regression on sol means: D = a + k P + c*sol (sol trend = Phi proxy; collinear risk noted)
X = np.c_[np.ones(len(S)), S[:, 1] - 840, S[:, 0]]; cE, *_ = np.linalg.lstsq(X, S[:, 3], rcond=None)
seasonal_k_simple = np.polyfit(S[:, 1], S[:, 3], 1)[0]
# --- 3. modelled vs measured, year 1, E channel (model is the plastic-detector fit) ---
meas_E = float(S[:, 3].mean()); meas_B = float(S[:, 2].mean()); Pm = float(S[:, 1].mean())
mod_obs = model(yr1[:, 2]); mod_sol = np.array([model(p) for p in S[:, 1]])
bias = float((mod_sol - S[:, 3]).mean()); rmse = float(np.sqrt(((mod_sol - S[:, 3]) ** 2).mean()))
r_sol = float(np.corrcoef(mod_sol, S[:, 3])[0, 1])
# model with elevation-derived pressure (P_ref seasonal-free) at MSL elevation ~ -4.5 km
P_model_ref = P_REF
mod_ref = model(P_model_ref)
# implied Phi that reproduces measured year-1 mean at measured pressure
phi_implied_yr1 = (267 - 0.13 * (Pm - 840) - meas_E) / 0.11
# --- 4. Ls ~ 240 season ---
ls = S[:, 4]; mS = (ls > 225) & (ls < 255)
ls240 = dict(n_sols=int(mS.sum()), P_mean=float(S[mS, 1].mean()) if mS.any() else None, P_min=float(S[mS, 1].min()) if mS.any() else None,
             P_max=float(S[mS, 1].max()) if mS.any() else None, E_mean=float(S[mS, 3].mean()) if mS.any() else None,
             B_mean=float(S[mS, 2].mean()) if mS.any() else None, sols=[int(x) for x in S[mS, 0]])
if mS.any():
    ls240['model_E_at_measured_P_phi600'] = float(model(ls240['P_mean'])); ls240['model_E_at_Pref750_phi600'] = float(model(750))
    ls240['phi_implied'] = float((267 - 0.13 * (ls240['P_mean'] - 840) - ls240['E_mean']) / 0.11)
# --- 5. long-term series (dose only, all sampled sols) ---
LT = [(s, np.median([x[3] for x in R[s]]), np.median([x[2] for x in R[s]]), ls_of_sol(s)) for s in sols]
LT = np.array(LT)
ls240_lt = []
for lo in range(0, 4800, 669):  # one Mars year windows starting at landing season; pick Ls 225-255 sols
    m = (LT[:, 0] >= lo) & (LT[:, 0] < lo + 669) & (LT[:, 3] > 225) & (LT[:, 3] < 255)
    if m.sum(): ls240_lt.append(dict(my_index=lo // 669, n_sols=int(m.sum()), sol_range=[int(LT[m, 0].min()), int(LT[m, 0].max())], E_median_uGy_day=round(float(LT[m, 1].mean()), 1), B_median_uGy_day=round(float(LT[m, 2].mean()), 1), assumed_P_pa=910, model_E_at_910Pa_phi600=round(float(model(910)), 1), phi_implied_at_910Pa_MV=round(float((267 - 0.13 * (910 - 840) - LT[m, 1].mean()) / 0.11), 0), sols_used=[int(x) for x in LT[m, 0]]))
ratio_EB = float(np.mean(S[:, 3] / S[:, 2]))
# QF: tissue dose from E x 3.05 => dose equivalent
sm = dict(
 data=dict(rad='PDS PPI MSL-M-RAD-3-RDR-V1.0 (RAD_RDR TOT_DOSE_B/E, uGy/hour x24 -> uGy/day), https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/',
           rems='PDS Atmospheres mslrem_1001 RMD (modified RDR) pressure column, https://atmos.nmsu.edu/PDS/data/mslrem_1001/',
           sols_sampled=len(sols), sols_with_pressure_year1=int(len(S)), sol_range_year1=[int(S[:, 0].min()), int(S[:, 0].max())],
           sep_flagged_sols=sorted(int(x) for x in sep_sols), paired_obs_year1=int(len(yr1))),
 year1_means=dict(P_pa=round(Pm, 1), E_uGy_day=round(meas_E, 1), B_uGy_day=round(meas_B, 1), E_over_B=round(ratio_EB, 3),
   E_dose_equiv_mSv_day_QF3p05=round(meas_E * QF / 1000, 3)),
 model_vs_measured_year1=dict(model_E_at_measured_P_phi600=round(float(model(Pm)), 1), bias_uGy_day=round(bias, 1), rmse_sol_uGy_day=round(rmse, 1), pearson_r=round(r_sol, 2),
   model_E_at_Pref750_phi600=round(mod_ref, 1), phi_implied_yr1_MV=round(phi_implied_yr1, 0)),
 kappa_diurnal=dict(E=dict(k=round(kE[0], 3), se=round(kE[1], 3), r=round(kE[2], 3), n=kE[3]), B=dict(k=round(kB[0], 3), se=round(kB[1], 3), r=round(kB[2], 3), n=kB[3]),
   units='uGy/day/Pa', ours_E=-0.13, guo2015_E=-0.13, guo2015_B=-0.10, rafkin2014_E=-0.116),
 seasonal_regression_E=dict(k_with_time_trend=round(float(cE[1]), 3), time_trend_uGy_day_per_sol=round(float(cE[2]), 4), k_simple_no_trend=round(float(seasonal_k_simple), 3)),
 ls240_year1=ls240, ls240_all_years=ls240_lt,
 longterm=dict(E_median_first=round(float(LT[0, 1]), 1), E_min=round(float(LT[:, 1].min()), 1), E_max=round(float(LT[:, 1].max()), 1), sols=[int(LT[0, 0]), int(LT[-1, 0])]))
json.dump(sm, open(f'{H}/summary.json', 'w'), indent=1); print(json.dumps(sm, indent=1))
# --- figure ---
fig, ax = plt.subplots(1, 3, figsize=(15, 4.4))
a = ax[0]; a.scatter(yr1[:, 2], yr1[:, 4], s=3, alpha=.25, c='#7aa6c8', label='RAD E, per observation')
a.scatter(S[:, 1], S[:, 3], s=18, c='#1f4e79', label='sol means (SEP days excluded)')
pp = np.linspace(680, 960, 10); a.plot(pp, model(pp), 'r-', label='model, Phi=600 MV (Guo 2015)')
a.plot(pp, model(pp, phi_implied_yr1), 'r--', label=f'model, Phi={phi_implied_yr1:.0f} MV (implied)')
a.axvline(P_REF, c='gray', ls=':'); a.text(P_REF + 3, a.get_ylim()[0] + 2, 'P_ref 750', fontsize=8, color='gray')
a.set_xlabel('REMS pressure (Pa)'); a.set_ylabel('RAD plastic (E) dose rate (uGy/day)'); a.set_title('Year 1: dose vs pressure'); a.legend(fontsize=7)
a = ax[1]; a.plot(S[:, 0], S[:, 3], 'o-', ms=3, c='#1f4e79', label='measured E'); a.plot(S[:, 0], mod_sol, 'r-', label='model at REMS pressure, Phi=600')
a.set_xlabel('sol'); a.set_ylabel('uGy/day'); a.set_title('Year 1 time series'); a.legend(fontsize=7)
a = ax[2]; a.plot(LT[:, 0], LT[:, 1], '.', c='#1f4e79', ms=4, label='measured E, sol median'); a.axhline(model(840), c='r', label='model at 840 Pa, Phi=600')
a.set_xlabel('sol'); a.set_title('Long term (sol 0 = Aug 2012; max-min-max of solar cycles 24-25)'); a.legend(fontsize=7)
fig.suptitle('Marswalk dose model compared with measured Curiosity RAD data (absorbed dose in plastic detector E, uGy/day)', fontsize=10)
fig.tight_layout(); fig.savefig(f'{H}/v5_measured_vs_modelled.png', dpi=130)
