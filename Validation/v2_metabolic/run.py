"""V2: compare the engine's metabolic model (Pandolf + Santee, x gravity ratio) with NASA IST-2 suited data.
Data: Norcross et al. 2010, NASA/TP-2010-216125, Fig. 36 (digitized, see digitize_fig36.py).
Pandolf et al. 1977, J Appl Physiol 43(4):577-581; Santee et al. 2001, J Appl Physiol 90:2174 (downhill correction)."""
import csv, json, math, os
import numpy as np
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
HERE = os.path.dirname(os.path.abspath(__file__))
W_SUBJ = 80.7      # kg, mean of n=6 (Norcross 2010 Table 1)
L_SUIT = 121.0     # kg, Mark III + POGO-equivalent mass used in IST-2 (Norcross 2010)
ETA = 1.0
V_MID, V_LO, V_HI = 0.765, 0.56, 0.97   # m/s. Paper: lowest walking speed = PTS-0.7 m/s per subject; range 0.56-0.97 (Sec. 4 model range); mean not reported -> midpoint
KJ_PER_L = 20.1    # kJ per L O2 (as specified)
def w_from_vo2(v): return v * W_SUBJ / 1000 * KJ_PER_L * 1000 / 60   # mL/kg/min -> W
def pandolf(W, L, V, G, eta=ETA):
    """W,L kg; V m/s; G percent grade -> watts at 1 g"""
    m = 1.5*W + 2.0*(W+L)*(L/W)**2 + eta*(W+L)*(1.5*V*V + 0.35*V*G)
    if G < 0:  # Santee et al. 2001 downhill correction
        Ga = abs(G)
        corr = eta*((G*(W+L)*V)/3.5 - ((W+L)*(Ga+6)**2/W) + 25 - V*V)
        m = m - corr
    return max(m, 1.5*W)
def model(g, grade, V=V_MID): return pandolf(W_SUBJ, L_SUIT, V, grade) * g/1.0   # gravity ratio g/g_earth
obs = [(float(r['gravity_g']), int(r['grade_pct']), float(r['vo2_ml_kg_min'])) for r in csv.DictReader(open(f'{HERE}/digitized_fig36.csv'))]
rows = []
for g, gr, vo2 in obs:
    ow = w_from_vo2(vo2); mw = model(g, gr)
    rows.append(dict(gravity_g=g, grade_pct=gr, obs_vo2_ml_kg_min=vo2, obs_W=round(ow,1), model_W=round(mw,1),
        pct_error=round(100*(mw-ow)/ow,1), model_W_speed_lo=round(model(g,gr,V_LO),1), model_W_speed_hi=round(model(g,gr,V_HI),1)))
ape = np.array([abs(r['pct_error']) for r in rows]); mape = float(ape.mean())
bias = float(np.mean([r['pct_error'] for r in rows]))
# Leave-one-gravity-level-out: fit ONE scalar k (least-squares in relative error) on 4 levels, predict the held-out level
def fit_k(sub): 
    r = np.array([o/m for (_,_,o,m) in sub]); return float(np.exp(np.mean(np.log(r))))
tri = [(g, gr, w_from_vo2(v), model(g, gr)) for g, gr, v in obs]
logo = []
for hold in sorted({t[0] for t in tri}):
    k = fit_k([t for t in tri if t[0] != hold]); te = [t for t in tri if t[0] == hold]
    logo.append(dict(held_out_g=hold, k=round(k,3),
        mape_uncalibrated=round(100*np.mean([abs(m-o)/o for _,_,o,m in te]),1),
        mape_heldout_scaled=round(100*np.mean([abs(k*m-o)/o for _,_,o,m in te]),1)))
k_all = fit_k(tri)
mape_scaled_insample = float(100*np.mean([abs(k_all*m-o)/o for _,_,o,m in tri]))
logo_mape = float(np.mean([l['mape_heldout_scaled'] for l in logo]))
# 0.38 g extrapolation (no ground truth in this dataset)
extrap = {gr: round(model(0.38, gr),1) for gr in (0,10,20,30)}
extrap_scaled = {gr: round(k_all*model(0.38, gr),1) for gr in (0,10,20,30)}
# stated differences in text cross-check (digitization sanity): highest-minus-lowest offload VO2 at each grade
stated = {0:1.9, 10:3.5, 20:8.7, 30:17.0}
dig = {gr: round(max(v for g,gg,v in obs if gg==gr) - min(v for g,gg,v in obs if gg==gr),1) for gr in stated}
with open(f'{HERE}/results.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
# figure
fig, ax = plt.subplots(1, 2, figsize=(11, 4.4))
cm = plt.cm.viridis
for i, g in enumerate(sorted({r['gravity_g'] for r in rows})):
    rr = [r for r in rows if r['gravity_g']==g]; c = cm(i/4)
    ax[0].plot([r['grade_pct'] for r in rr],[r['obs_W'] for r in rr],'o-',color=c,label=f'{g:.2f} g measured (digitized)')
    ax[0].plot([r['grade_pct'] for r in rr],[r['model_W'] for r in rr],'x--',color=c)
ax[0].set_xlabel('Grade (%)'); ax[0].set_ylabel('Metabolic rate (W)'); ax[0].legend(fontsize=7); ax[0].set_title('Solid: NASA IST-2 data; dashed: Pandolf model')
lim = [0, max(r['obs_W'] for r in rows+rows)*1.3]
lo = [r['obs_W'] for r in rows]; mo = [r['model_W'] for r in rows]
ax[1].scatter(lo, mo, c=[r['gravity_g'] for r in rows], cmap='viridis'); ax[1].plot(lim, lim, 'k-', lw=.8)
ax[1].plot(lim, [x*1.25 for x in lim], 'k:', lw=.6); ax[1].plot(lim, [x*.75 for x in lim], 'k:', lw=.6)
ax[1].set_xlim(lim); ax[1].set_ylim(0, max(mo)*1.1); ax[1].set_xlabel('Measured (W)'); ax[1].set_ylabel('Model (W)')
ax[1].set_title(f'20 conditions, MAPE {mape:.0f}% (dotted: +-25%)')
plt.tight_layout(); plt.savefig(f'{HERE}/v2_model_vs_data.png', dpi=140)
out = dict(n_conditions=len(rows), mape_pct=round(mape,1), mean_signed_error_pct=round(bias,1),
    mape_speed_sensitivity={'0.56 m/s': round(float(np.mean([abs(r['model_W_speed_lo']-r['obs_W'])/r['obs_W']*100 for r in rows])),1),
                            '0.97 m/s': round(float(np.mean([abs(r['model_W_speed_hi']-r['obs_W'])/r['obs_W']*100 for r in rows])),1)},
    k_scale_all=round(k_all,3), mape_after_single_scalar_insample=round(mape_scaled_insample,1),
    logo=logo, logo_mape_pct=round(logo_mape,1), extrapolation_0_38g_W_uncal=extrap, extrapolation_0_38g_W_scaled=extrap_scaled,
    digitization_check_stated_vs_digitized_offload_diff=dict(stated=stated, digitized=dig))
json.dump(out, open(f'{HERE}/summary.json','w'), indent=1); print(json.dumps(out, indent=1))
for r in rows: print(r)
