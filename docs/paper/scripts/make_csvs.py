"""Builds figure-data CSVs from Validation/ outputs (read-only). Run: Pipeline/.venv/bin/python -I make_csvs.py"""
import csv, json, math, os
import numpy as np
V = '/Users/kumarsashank/dev/NASA-Martian-Map/NASASpaceHacks2026/Validation/'
OUT = '/private/tmp/claude-501/-Users-kumarsashank-dev-NASA-Martian-Map/d88ae1d1-4b98-4a31-805a-4ff51c9d5462/scratchpad/paper/data/'
def w(name, header, rows):
    with open(OUT + name, 'w', newline='') as f:
        c = csv.writer(f); c.writerow(header); c.writerows(rows)
    print(name, len(rows))

# ---- V1
rows = list(csv.reader(open(V + 'v1_shielding/results.csv')))
hdr = None; ros = []; dose = []; mode = None
for r in rows:
    if not r: continue
    if r[0].startswith('#'): continue
    if r[0] == 'period': hdr = r; mode = 'ros'; continue
    if r[0] == 'site': hdr = r; mode = 'dose'; continue
    d = dict(zip(hdr, r)); (ros if mode == 'ros' else dose).append(d)
w('v1_skyview.csv', ['period', 'is_background_period', 'in_15_period_MAE', 'paper_obstructed_pct_Guo2026_Table1', 'ours_obstructed_pct_solid_angle', 'abs_diff_pp', 'ours_mean_ros_pct', 'ours_cos_sin_pct', 'n_positions'],
  [[d['period'], int(d['period'].startswith('BG') or d['period'] == 'MB_BG'), int(not d['period'].startswith('MB')), d['paper_ros_pct'], d['solid_angle'], round(abs(float(d['solid_angle']) - float(d['paper_ros_pct'])), 2), d['mean_ros'], d['cos_sin'], d['n_positions']] for d in ros])
w('v1_dose.csv', ['event', 'background_period', 'measured_drop_pct', 'predicted_drop_pct_two_term_ours_ROS', 'predicted_drop_pct_two_term_paper_ROS', 'predicted_drop_pct_linear_LOO', 'our_dB_pp', 'paper_dB_pp', 'note'],
  [[d['site'], d['bg'], d['measured_drop_pct'], d['pred_two_term_ours'], d['pred_two_term_paperROS'], d['pred_linear_loo'], d['our_dB_pp'], d['paper_dB_pp'],
    'held out (Murray Buttes; BG is a proxy position; measured 4% from Ehresmann 2021)' if d['site'] == 'MB_P' else ''] for d in dose])

# ---- V2
r2 = list(csv.DictReader(open(V + 'v2_metabolic/results.csv')))
s2 = json.load(open(V + 'v2_metabolic/summary.json'))
out = [[x['gravity_g'], x['grade_pct'], 0.765, x['obs_vo2_ml_kg_min'], x['obs_W'], x['model_W'], x['pct_error'], x['model_W_speed_lo'], x['model_W_speed_hi'], 'measured_digitized'] for x in r2]
for gr, v in s2['extrapolation_0_38g_W_uncal'].items():
    out.append([0.38, gr, 0.765, '', '', v, '', '', '', 'extrapolation_no_measured_data'])
w('v2_metabolic.csv', ['gravity_g', 'grade_pct', 'speed_m_s_model_midpoint', 'measured_vo2_ml_kg_min_digitized', 'measured_W', 'model_W', 'pct_error_model_minus_measured', 'model_W_at_0.56_m_s', 'model_W_at_0.97_m_s', 'row_type'], out)

# ---- V3
res = list(csv.DictReader(open(V + 'v3_impact/results.csv')))
s3 = json.load(open(V + 'v3_impact/summary.json'))['stats']
rules = ['walk_radius_max_m', 'walkback_speed_factor', 'shelter_time_max_min', 'los_gap_max_min', 'daylight_min_sun_elev_deg', 'eva_duration_max_min', 'slope_max_deg', 'unsafe_edge_grade_gt_20deg', 'plume_keepout_m']
vrows = []
for st in ('PR1', 'HAB1'):
    S = s3[st]; N = S['scenarios']; sub = [x for x in res if x['set'] == st]
    nviol = sum(x['C_violates'] == '1' for x in sub)
    vrows.append([st, 'Marswalk plan()', N, '', '', 'not measured in results.csv; plan() returns only plans passing the engine hard rules (by construction); V4 checks 24 walks independently'] + [''] * len(rules))
    vrows.append([st, 'Nearest-first with safety check', N, '', '', 'not measured; a stop is added only if the whole plan passes the same hard-rule checker (by construction)'] + [''] * len(rules))
    vrows.append([st, 'Naive slope-only', N, nviol, round(100 * nviol / N, 1), 'plans breaking >=1 rule (one plan can break several)'] + [S['ruleViolationCounts'].get(r, 0) for r in rules])
w('v3_violations.csv', ['set', 'planner', 'n_scenarios', 'n_scenarios_with_ge1_violation', 'pct', 'note'] + ['plans_violating_' + r for r in rules], vrows)

o = list(csv.DictReader(open(V + 'v3_impact/results_oversub.csv')))
srows = []
for x in o:
    a, b = float(x['A_value']), float(x['B_value'])
    srows.append(['oversub', x['scenario'], x['startLtst'], x['availMin'], x['bucket'], x['A_status'], a, b, round(a / b, 4) if b else '', x['A_n'], x['B_n'], x['A_evaMin'], x['B_evaMin'], x['A_order'], x['B_order']])
for x in res:
    if x['set'] != 'PR1': continue
    a, b = float(x['A_value']), float(x['B_value'])
    srows.append(['PR1_full_eva', x['scenario'], x['startLtst'], '', '', x['A_status'], a, b, round(a / b, 4) if b else '', x['A_n'], x['B_n'], x['A_evaMin'], x['B_evaMin'], x['A_order'], x['B_order']])
w('v3_science.csv', ['family', 'scenario', 'start_ltst_min', 'available_min', 'bucket', 'marswalk_status', 'marswalk_value_A', 'nearest_first_value_B', 'ratio_A_over_B', 'A_n_stops', 'B_n_stops', 'A_eva_min', 'B_eva_min', 'A_order', 'B_order'], srows)

trows = []
for x in res:
    if x['A_solveMs']: trows.append(['PR1_full_eva' if x['set'] == 'PR1' else 'HAB1_full_eva', x['scenario'], 'Marswalk plan()', 'plan', x['A_solveMs']])
    if x['A_replanMs']: trows.append([x['set'] + '_full_eva', x['scenario'], 'Marswalk plan(resume)', 'replan', x['A_replanMs']])
for x in o:
    trows.append(['oversub', x['scenario'], 'Marswalk plan()', 'plan', x['A_solveMs']])
    trows.append(['oversub', x['scenario'], 'nearest-first (route matrix prebuilt, untimed)', 'plan', x['B_solveMs']])
w('v3_timing.csv', ['family', 'scenario', 'planner', 'kind', 'ms'], trows)

# ---- V4
tw = json.load(open(V + 'v4_crosscheck/three_way_summary.json'))
cmp_ = {x['walk']: x for x in csv.DictReader(open(V + 'v4_crosscheck/results.csv'))}
arows = []
for x in tw['rows']:
    n = int(x['walk'][1:]); c = cmp_[x['walk']]
    arows.append([x['walk'], c['base'], c['dest'], c['start_ltst'], x['engine'], ' '.join(x['engine_rules']), x['independent'], ' '.join(x['independent_rules']), x['ai'], ' '.join(x['ai_rules']), 'batch1' if n <= 12 else 'batch2',
                  int(x['engine'] == x['independent']), int(x['engine'] == x['ai']), c['route_source']])
w('v4_agreement.csv', ['walk', 'base', 'dest', 'start_ltst_min', 'engine_verdict', 'engine_primary_rule', 'independent_checker_verdict', 'independent_failing_rules', 'ai_judge_verdict', 'ai_judge_failing_rules', 'ai_judge_batch', 'engine_eq_independent', 'engine_eq_ai', 'route_source'], arows)

# ---- V5 (re-uses run.py's own code up to the summary dict; read-only)
src = open(V + 'v5_rad_dose/run.py').read()
src = src[:src.index('sm = dict(')]
src = src.replace("import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt", '')
src = src.replace("H = os.path.dirname(os.path.abspath(__file__)); D = f'{H}/data'", f"D = '{V}v5_rad_dose/data'")
ns = {}; exec(compile(src, 'v5run', 'exec'), ns)
S, LT, mod_sol = ns['S'], ns['LT'], ns['mod_sol']; model = ns['model']
w('v5_dose.csv', ['sol', 'ls_deg_approx', 'rems_mean_pressure_pa', 'measured_E_plastic_uGy_day', 'measured_B_silicon_uGy_day', 'model_E_uGy_day_phi600_at_measured_P', 'model_minus_measured_uGy_day'],
  [[int(s[0]), round(s[4], 1), round(s[1], 1), round(s[3], 1), round(s[2], 1), round(float(m), 1), round(float(m - s[3]), 1)] for s, m in zip(S, mod_sol)])
w('v5_longterm.csv', ['sol', 'ls_deg_approx', 'measured_E_sol_median_uGy_day', 'measured_B_sol_median_uGy_day', 'model_E_phi600_P910_uGy_day_const', 'model_E_phi600_P750_uGy_day_const'],
  [[int(s[0]), round(s[3], 1), round(s[1], 1), round(s[2], 1), round(model(910.0 - 0 + 0) if False else 267 - 0.13 * (910 - 840) - 0.11 * 600, 1), round(267 - 0.13 * (750 - 840) - 0.11 * 600, 1)] for s in LT])
