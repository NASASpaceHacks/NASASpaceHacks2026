"""Collects v1/v2 summary.json into Validation/numbers.json (run both run.py first)."""
import json, csv, datetime, os
H = os.path.dirname(os.path.abspath(__file__))
v1 = json.load(open(f'{H}/v1_shielding/summary.json')); v2 = json.load(open(f'{H}/v2_metabolic/summary.json'))
r2 = list(csv.DictReader(open(f'{H}/v2_metabolic/results.csv')))
hi = [abs(float(r['pct_error'])) for r in r2 if float(r['gravity_g']) >= 0.22]
lo = [abs(float(r['pct_error'])) for r in r2 if float(r['gravity_g']) < 0.22]
sites = [dict(site=r['site'], bg=r['bg'], measured_drop_pct=r['measured_drop_pct'], predicted_two_term_pct=r['pred_two_term_ours'],
              our_blocked_change_pp=r['our_dB_pp'], paper_blocked_change_pp=r['paper_dB_pp']) for r in v1['rows_dose']]
sites.append(dict(site='Murray Buttes', measured_drop_pct=4.0, predicted_two_term_pct=v1['murray_buttes']['pred_two_term_ours'], note='held out; BG is proxy'))
out = dict(
 v1=dict(sites=sites, n_obstructed_sky_comparisons=15, mae_pp=v1['mae_ros_pp_all15']['solid_angle'], mae_pp_parking_only=v1['mae_ros_pp_parking8']['solid_angle'],
   mae_pp_by_definition=v1['mae_ros_pp_by_definition'], ros_pearson_r=v1['ros_pearson_r'], rmse_dose_pp=v1['rmse_dose_pp']['two_term_ours'],
   rmse_dose_pp_detail=v1['rmse_dose_pp'], murray_buttes=dict(measured_pct=4.0, predicted_pct=v1['murray_buttes']['pred_two_term_ours']),
   notes='Reproduces (not validates) Guo et al. 2026 obstructed-sky ratios from the USGS Gale 1 m DEM at MSL waypoint positions (MAE %.1f pp over 15 periods, r=%.2f). Metric definition chosen post hoc among 3 readings. Dose-drop RMSE %.1f pp with our ROS vs %.1f pp with the paper ROS; the largest miss is Maria Gordon Notch (narrow valley: ours %s%% vs paper 37.9%%). 8 events, one rover, one GCR model: indicative only.'
     % (v1['mae_ros_pp_all15']['solid_angle'], v1['ros_pearson_r'], v1['rmse_dose_pp']['two_term_ours'], v1['rmse_dose_pp']['two_term_paperROS'],
        [r for r in v1['rows_ros'] if r['period']=='P6'][0]['solid_angle'])),
 v2=dict(conditions=v2['n_conditions'], mape_pct=v2['mape_pct'], mape_pct_0_22_to_0_32g=round(sum(hi)/len(hi),1), mape_pct_0_12_to_0_17g=round(sum(lo)/len(lo),1),
   mean_signed_error_pct=v2['mean_signed_error_pct'], logo_mape_pct=v2['logo_mape_pct'],
   notes='Pandolf+Santee x g-ratio vs IST-2 Mark III suited VO2 (digitized Fig. 36 trend lines, Norcross 2010), 5 gravities x 4 grades, subject mass 80.7 kg, suit 121 kg, speed 0.765 m/s (paper range 0.56-0.97). Model underpredicts at 0.12-0.17 g (measured VO2 has a gravity-independent floor) and is within about +-14% at 0.22-0.32 g. 0.38 g is an extrapolation beyond the 0.32 g maximum; no data there.'),
 generatedUtc=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
json.dump(out, open(f'{H}/numbers.json', 'w'), indent=1); print(json.dumps(out, indent=1))
