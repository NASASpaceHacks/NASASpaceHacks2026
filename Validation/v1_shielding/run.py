"""V1: reproduce Guo et al. 2026 (JGR Planets, doi:10.1029/2026JE009704) obstructed-sky ratios from the USGS Gale
1 m DEM at Curiosity's positions, then predict RAD dose drops.  Needs the cache written by fetch_dem.py (V1_CACHE)."""
import json, csv, math, os, sys
import numpy as np
from scipy.ndimage import map_coordinates
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('V1_CACHE', os.path.join(HERE, 'cache'))
WAYPTS = os.environ.get('V1_WAYPOINTS', os.path.join(CACHE, 'MSL_waypoints.json'))
R = 3396190.0
T_C, T_F = 8127993.492786024, -244781.075189438           # DEM geotransform origin (1 m pixels)
CL = {'A':(137.384,-4.735),'B':(137.4125,-4.7354),'C':(137.3945,-4.748),'D':(137.399,-4.759),'E':(137.3535,-4.695)}
H_OBS, AZ_BIN, R_FAR, R_NEAR, STEP_FAR = 1.0, 0.25, 20000.0, 1000.0, 8.0   # Guo 2026: 1 m viewpoint, 0.25 deg bins, 20 km
# ---- Guo et al. 2026 Table 1 (transcribed): period, sol range, cluster, measured drop vs BG (%), ROS sum (%), BG period
# BG sol ranges and ROS values from Table 1 / Sec. 3.1-3.5 text.
PER = {  # name: (sol_lo, sol_hi, cluster, paper_ROS_pct, D_RAD uGy/d)
 'BG1':(2643.5,2657.5,'A',7.9,313.9),'P1':(2664.5,2691.5,'A',13.7,301.3),'BG2':(2702,2729,'A',5.4,323.5),'P2':(2734.5,2742.5,'A',14.8,300.5),
 'BG3':(2790.5,2795.5,'A',7.2,318.5),'P3':(2797.6,2800.6,'A',12.7,297.8),'BG45':(3052.6,3072.6,'B',11.8,290.5),
 'P4':(3072.6,3074.6,'B',14.4,279.3),'P5':(3076.6,3079.6,'B',11.4,284.4),'BG6':(3326.6,3329.6,'C',18.0,285.1),'P6':(3324.6,3326.6,'C',37.9,229.8),
 'BG7':(3560.6,3563.6,'D',22.1,215.5),'P7':(3564.6,3565.6,'D',32.8,190.4),'BG8':(3571.6,3576.6,'D',17.8,224.3),'P8':(3567.5,3570.5,'D',29.6,202.0)}
PAIRS = [('P1','BG1',4.0,6.5),('P2','BG2',7.1,10.3),('P3','BG3',6.5,6.5),('P4','BG45',3.8,4.2),('P5','BG45',2.1,1.7),
         ('P6','BG6',19.4,24.1),('P7','BG7',9.8,14.6),('P8','BG8',9.9,22.0)]   # (P, BG, measured drop %, paper-modelled Dsky drop %)
# Murray Buttes (Ehresmann+2021 JGR 126 e2021JE006851: sols 1456-1467, 19% sky blocked, 4% drop; Guo+2021 GRL: 19% vs ~10% reference, drop 5+-1%)
PER['MB_P'] = (1456,1467,'E',19.0,None); PER['MB_BG'] = (1446,1448,'E',10.0,None)
def xy(lon, lat): return R*math.radians(lon), R*math.radians(lat)
near = {k: np.load(f'{CACHE}/near_{k}.npy') for k in CL}
far = np.concatenate([np.load(f'{CACHE}/far_{i}.npy') for i in range(10)]); FAR_ROW0, FAR_STEP = 13000, 8
def nodata(a): a = a.astype(np.float64); a[a < -30000] = np.nan; return a
near = {k: nodata(v) for k, v in near.items()}; far = nodata(far)
NEAR_ORG = {}
for k, (lon, lat) in CL.items():
    x, y = xy(lon, lat); NEAR_ORG[k] = (int((T_F - y)) - 1500, int((x - T_C)) - 1500)   # row0, col0 (1 m px)
def sample(arr, rows, cols):
    v = map_coordinates(np.nan_to_num(arr, nan=-1e9), [rows, cols], order=1, mode='nearest')
    bad = map_coordinates(np.isnan(arr).astype(float), [rows, cols], order=0, mode='nearest') > 0
    out = v.copy(); out[bad] = np.nan; return out
def horizon(lon, lat, cl):
    x0, y0 = xy(lon, lat); r0, c0 = NEAR_ORG[cl]
    z0 = sample(near[cl], np.array([T_F - y0 - r0 - 0.5]), np.array([x0 - T_C - c0 - 0.5]))[0] + H_OBS
    az = np.deg2rad(np.arange(0, 360, AZ_BIN) + AZ_BIN/2)
    dn = np.arange(2.0, R_NEAR, 1.0); df = np.arange(R_NEAR, R_FAR, STEP_FAR)
    elev = np.full(len(az), -90.0)
    for d, arr, mode in ((dn, 'near', 0), (df, 'far', 1)):
        X = x0 + np.outer(np.sin(az), d); Y = y0 + np.outer(np.cos(az), d)
        if mode == 0: rows = T_F - Y - r0 - 0.5; cols = X - T_C - c0 - 0.5; z = sample(near[cl], rows, cols)
        else: rows = (T_F - Y - FAR_ROW0)/FAR_STEP - 0.5; cols = (X - T_C)/FAR_STEP - 0.5; z = sample(far, rows, cols)
        ang = np.degrees(np.arctan2(z - z0 - d**2/(2*R), d))            # includes Mars curvature drop d^2/2R
        elev = np.fmax(elev, np.nanmax(np.where(np.isnan(ang), -90, ang), axis=1))
    return elev, z0
def ros_curves(elev):
    th = np.arange(0.5, 90, 1.0)                                         # zenith bins, 1 deg (Guo: dtheta = 1 deg)
    ros = np.array([np.mean(elev >= 90 - t) for t in th])                # fraction of azimuth obstructed at zenith theta
    return th, ros
def metrics(elev):
    th, ros = ros_curves(elev); w = np.sin(np.radians(th))
    return dict(mean_ros=100*ros.mean(),                                  # (a) literal: sum ROS(theta) dtheta / 90 deg
                solid_angle=100*(ros*w).sum()/w.sum(),                    # (b) blocked fraction of hemisphere solid angle
                cos_sin=100*(ros*np.sin(2*np.radians(th))).sum()/np.sin(2*np.radians(th)).sum(),  # (c) projected-area (cos*sin) weighted
                max_elev=float(elev.max()))
wp = [(f['properties']['sol'], f['properties']['lon'], f['properties']['lat']) for f in json.load(open(WAYPTS))['features']]
res = {}
for name, (a, b, cl, pros, drad) in PER.items():
    pts = [(s, lo, la) for s, lo, la in wp if a - 1.0 <= s <= b]
    if not pts: pts = [max([p for p in wp if p[0] <= a], key=lambda p: p[0])]
    ms = []
    for s, lo, la in pts:
        e, z0 = horizon(lo, la, cl); m = metrics(e); m['sol'] = s; ms.append(m)
    avg = {k: float(np.mean([m[k] for m in ms])) for k in ('mean_ros','solid_angle','cos_sin','max_elev')}
    avg['n_positions'] = len(ms); avg['sols'] = [m['sol'] for m in ms]; res[name] = avg
    print(name, {k: (round(v,1) if isinstance(v, float) else v) for k, v in avg.items()}, 'paper', pros, flush=True)
# ---- (1) obstructed-sky agreement with paper Table 1 (+ Murray Buttes 19% / ~10%)
cmp_rows = []
for name, (a, b, cl, pros, d) in PER.items():
    cmp_rows.append(dict(period=name, paper_ros_pct=pros, **{k: round(res[name][k],2) for k in ('mean_ros','solid_angle','cos_sin','max_elev')}, n_positions=res[name]['n_positions']))
tab = [r for r in cmp_rows if not r['period'].startswith('MB')]
def mae(key, rows): return float(np.mean([abs(r[key] - r['paper_ros_pct']) for r in rows]))
mae_all = {k: round(mae(k, tab), 2) for k in ('mean_ros','solid_angle','cos_sin')}
mae_P = {k: round(mae(k, [r for r in tab if r['period'].startswith('P')]), 2) for k in mae_all}
# The paper's 'sum ROS(theta)*dtheta' is ambiguous about normalisation. Three readings were computed; the solid-angle-weighted one
# (blocked fraction of the sky hemisphere) agrees best with Table 1. This choice was made AFTER seeing the comparison (1 of 3 candidates), so treat the MAE as selected-metric, not blind.
KEY = 'solid_angle'
corr = float(np.corrcoef([r[KEY] for r in tab], [r['paper_ros_pct'] for r in tab])[0,1])
# ---- (2) dose-drop prediction
# Two-term model (Guo 2026 Eq. 5 logic): D = (1 - f)*(1 - w*B) + f*(1 + B),  B = blocked fraction, f = flat-terrain albedo share
# f = 0.21 (paper-derived mean of 18-24%); w = dose-weighting of blocked sky = paper's own Dsky-decrease/dROS ratio (mean over 8 pairs). Neither is fit to the RAD drops.
F_ALB = 0.21
W_SKY = float(sum(pd for p, b, md, pd in PAIRS)/sum(PER[p][3]-PER[b][3] for p, b, md, pd in PAIRS))   # ratio of sums (P5 has dROS<0, so a mean of ratios is unstable)
def two_term(Bp, Bb):
    Dp = (1-F_ALB)*(1 - W_SKY*Bp) + F_ALB*(1 + Bp); Db = (1-F_ALB)*(1 - W_SKY*Bb) + F_ALB*(1 + Bb); return 100*(1 - Dp/Db)
rows_d = []
for p, b, md, pd in PAIRS + [('MB_P','MB_BG',4.0,None)]:
    dB_ours = (res[p][KEY] - res[b][KEY])/100; dB_paper = (PER[p][3] - PER[b][3])/100
    rows_d.append(dict(site=p, bg=b, measured_drop_pct=md, paper_dB_pp=round(100*dB_paper,1), our_dB_pp=round(100*dB_ours,1),
        pred_two_term_ours=round(two_term(res[p][KEY]/100, res[b][KEY]/100),2), pred_two_term_paperROS=round(two_term(PER[p][3]/100, PER[b][3]/100),2)))
tab_d = [r for r in rows_d if not r['site'].startswith('MB')]
y = np.array([r['measured_drop_pct'] for r in tab_d]); X = np.array([r['our_dB_pp'] for r in tab_d])
# linear: drop = k * dB_ours (through the origin); leave-one-site-out
def fitk(X, y): return float((X*y).sum()/(X*X).sum())
loo = []
for i in range(len(y)):
    m = np.arange(len(y)) != i; loo.append(fitk(X[m], y[m]) * X[i])
k_all = fitk(X, y)
for i, r in enumerate(tab_d): r['pred_linear_loo'] = round(float(loo[i]), 2); r['pred_linear_insample'] = round(k_all*r['our_dB_pp'], 2)
rm = lambda p: float(np.sqrt(np.mean((np.array(p) - y)**2)))
rmse = dict(two_term_ours=rm([r['pred_two_term_ours'] for r in tab_d]), two_term_paperROS=rm([r['pred_two_term_paperROS'] for r in tab_d]),
            linear_loo=rm(loo), linear_insample=rm(k_all*X), null_zero=rm(np.zeros_like(y)), null_mean_drop=rm(np.full_like(y, y.mean())))
# Murray Buttes (held out; not in the 8-period set)
mb = rows_d[-1]
with open(f'{HERE}/results.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['# part 1: obstructed-sky ratio (%), ours vs Guo 2026 Table 1; solid_angle=selected metric (see README)'])
    w.writerow(list(cmp_rows[0].keys())); [w.writerow(list(r.values())) for r in cmp_rows]
    w.writerow([]); w.writerow(['# part 2: dose drop P vs BG (%), measured vs predicted (Murray Buttes: measured 4% Ehresmann 2021; BG is a proxy position, see README)'])
    fn = ['site','bg','measured_drop_pct','paper_dB_pp','our_dB_pp','pred_two_term_ours','pred_two_term_paperROS','pred_linear_loo','pred_linear_insample']
    w.writerow(fn); [w.writerow([r.get(k, '') for k in fn]) for r in rows_d]
out = dict(mae_ros_pp_all15=mae_all, mae_ros_pp_parking8=mae_P, ros_pearson_r=round(corr,3), selected_metric=KEY, mae_ros_pp_by_definition=mae_all,
    F_ALB=F_ALB, W_SKY=round(W_SKY,3), k_linear=round(k_all,3), rmse_dose_pp={k: round(v,2) for k, v in rmse.items()},
    murray_buttes=mb, rows_dose=tab_d, rows_ros=cmp_rows)
json.dump(out, open(f'{HERE}/summary.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ('rows_dose', 'rows_ros')}, indent=1))
# ---- figure
fig, ax = plt.subplots(1, 3, figsize=(15, 4.6))
a = ax[0]; a.scatter([r['paper_ros_pct'] for r in tab], [r[KEY] for r in tab], c=['C3' if r['period'].startswith('P') else 'C0' for r in tab])
for r in tab: a.annotate(r['period'], (r['paper_ros_pct'], r[KEY]), fontsize=6)
a.plot([0, 45], [0, 45], 'k-', lw=.8); a.set_xlabel('Guo et al. 2026 Table 1 obstructed sky (%)'); a.set_ylabel('This work, USGS 1 m DEM (%)')
a.set_title(f'Obstructed-sky ratio: MAE {mae_all[KEY]:.1f} pp, r={corr:.2f} (n=15)\nred=parking, blue=background', fontsize=9)
a = ax[1]; a.scatter(y, [r['pred_two_term_ours'] for r in tab_d], c='C1', label=f"two-term, our ROS (RMSE {rmse['two_term_ours']:.1f} pp)")
a.scatter(y, [r['pred_linear_loo'] for r in tab_d], c='C2', marker='s', label=f"linear k*dB, leave-one-out (RMSE {rmse['linear_loo']:.1f} pp)")
a.scatter([4.0], [mb['pred_two_term_ours']], c='C1', marker='*', s=140, label='Murray Buttes (two-term, 4% measured)')
for r in tab_d: a.annotate(r['site'], (r['measured_drop_pct'], r['pred_two_term_ours']), fontsize=7)
a.plot([0, 22], [0, 22], 'k-', lw=.8); a.set_xlabel('Measured RAD dose drop P vs BG (%)'); a.set_ylabel('Predicted (%)'); a.legend(fontsize=7); a.set_title('Dose drop: predicted vs measured', fontsize=9)
a = ax[2]; a.scatter(y, [r['pred_two_term_paperROS'] for r in tab_d], c='C4', label=f"two-term, paper's ROS (RMSE {rmse['two_term_paperROS']:.1f} pp)")
a.plot([0, 22], [0, 22], 'k-', lw=.8); a.set_xlabel('Measured (%)'); a.set_ylabel('Predicted (%)'); a.legend(fontsize=7); a.set_title('Model error alone (paper ROS as input)', fontsize=9)
plt.tight_layout(); plt.savefig(f'{HERE}/v1_predicted_vs_measured.png', dpi=130)
