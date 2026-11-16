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
s3 = json.load(open(f'{H}/v3_impact/summary.json')); P = s3['stats']['PR1']; HB = s3['stats']['HAB1']
so = json.load(open(f'{H}/v3_impact/summary_oversub.json')); O = so['overall']
OV = dict(scenarios=O['scenarios'], candidates=so['candidates'], availableMinRange=so['availableMinRange'], meanValueA=round(O['meanValueA'],1), meanValueB=round(O['meanValueB'],1),
  scienceRatioMean=round(O['scienceRatioMean'],3), scienceRatioMedian=round(O['scienceRatioMedian'],3), scienceRatioMax=round(O['scienceRatioMax'],3),
  pctAGreater=O['pctAGreater'], pctEqual=O['pctEqual'], pctBGreater=O['pctBGreater'], meanStationsA=round(O['meanStationsA'],2), meanStationsB=round(O['meanStationsB'],2),
  meanEvaMinA=round(O['meanEvaMinA'],1), meanEvaMinB=round(O['meanEvaMinB'],1), solveMsA_p50=round(O['solveMsA_p50'],1), solveMsA_p95=round(O['solveMsA_p95'],1),
  byBucket={k: dict(n=v['scenarios'], ratioMean=round(v['scienceRatioMean'],3), ratioMedian=round(v['scienceRatioMedian'],3), pctAGreater=round(v['pctAGreater'],1), pctEqual=round(v['pctEqual'],1), pctBGreater=v['pctBGreater']) for k,v in so['byBucket'].items()},
  notes='All 12 stations, base PR-1, available EVA time 120-240 min via EVA_CUT (330 - available), 200 seeded scenarios. B = nearest-first with the same hard-rule checker. Science values are the team STM heuristic; single site; B is a generous but not the only human baseline.')
V3 = dict(scenarios=P['scenarios'], scienceRatioMean=P['scienceRatioMean'], scienceRatioMedian=P['scienceRatioMedian'], pctMarswalkBetter=P['pctMarswalkBetter'],
  pctMarswalkEqualToNearestFirst=P['pctEqual'], pctNaiveUnsafe=P['pctNaiveViolatesAny'], pctNaiveUnsafeEdge=P['pctNaiveUnsafeEdge'], ruleViolationCounts=P['ruleViolationCounts'],
  planP50Ms=round(P['planP50Ms'],1), planP95Ms=round(P['planP95Ms'],1), replanP50Ms=round(P['replanP50Ms'],1), replanP95Ms=round(P['replanP95Ms'],1),
  oversubscribed=OV,
  hab1=dict(scenarios=HB['scenarios'], stayIn=HB['marswalkStayIn'], pctNaiveUnsafe=HB['pctNaiveViolatesAny']),
  manualPlanningRef='no published figure found for hours of manual EVA traverse planning per EVA; only lead times (D-RATS 2010 planning began ~12 months before the field test; BASALT traverse targets were chosen months ahead from satellite imagery)',
  notes='gale-v1 real DEM, base PR-1, 200 seeded scenarios (3-6 of 12 stations, start 08:00-11:00 LTST, sol 412 with assumed Ls 240). Nearest-first WITH the same safety check selected exactly the same station set as Marswalk in every scenario (ratio 1.0): in this tight-limit site the safety rules, not the stop-order optimisation, decide the outcome. The naive slope-only plan visits ALL requested targets and breaks >=1 hard rule in %.1f%% of scenarios. Science values are the team STM heuristic. See v3_impact/README.md.' % P['pctNaiveViolatesAny'])
v5 = json.load(open(f'{H}/v5_rad_dose/summary.json')); K = v5['kappa_diurnal']; L = v5['ls240_year1']; Y = v5['year1_means']; M = v5['model_vs_measured_year1']
V5 = dict(rad_sols_sampled=v5['data']['sols_sampled'], year1_sols_with_pressure=v5['data']['sols_with_pressure_year1'], year1_paired_obs=v5['data']['paired_obs_year1'],
  sep_flagged_sols=v5['data']['sep_flagged_sols'], measured_E_uGy_day_year1=Y['E_uGy_day'], measured_B_uGy_day_year1=Y['B_uGy_day'], measured_mean_pressure_pa=Y['P_pa'],
  modelled_E_uGy_day_at_measured_P=M['model_E_at_measured_P_phi600'], bias_uGy_day=M['bias_uGy_day'], kappa_E_measured=K['E']['k'], kappa_E_se=K['E']['se'], kappa_E_guo2015=K['guo2015_E'], kappa_E_rafkin2014=K['rafkin2014_E'],
  ls240_pressure_pa=round(L['P_mean'], 0), ls240_pressure_range_pa=[round(L['P_min'], 0), round(L['P_max'], 0)], ls240_E_uGy_day=round(L['E_mean'], 1), model_P_ref_pa=750, phi_implied_year1_MV=M['phi_implied_yr1_MV'], phi_implied_ls240_MV=round(L['phi_implied'], 0),
  ls240_all_years=v5['ls240_all_years'],
  notes='Compares (does not validate) the radiation.ts Guo-2015-form dose model with measured MSL RAD absorbed dose (PDS PPI RDR, detector E plastic = like-for-like; B silicon is ~4% higher) and REMS pressure for 131 sampled sols. Measured diurnal barometric coefficient is about half the published values (timing stamps in the RDR are unreliable). P_ref 750 Pa is ~160 Pa below the Ls 240 REMS mean; dose depends strongly on solar-cycle epoch (E 167-296 uGy/day at Ls 240 across 2012-2024). One rover, one site; see v5_rad_dose/README.md.')
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
 v3=V3,
 v5=V5,
 v4=(lambda t: dict(walks=t['walks'], engine_vs_ai_verdict=t['engine_vs_ai'], engine_vs_independent_verdict=t['engine_vs_independent'],
   engine_nogo=t['engine_nogo'], failing_rule_named_by_ai=t['rule_named_by_ai'], failing_rule_named_by_independent=t['rule_named_by_independent'],
   notes='24 single-destination walks on gale-v1 (12 GO, 12 NO-GO by the engine). Independent Python checker (own slope, edge grade, ray line-of-sight, radius, simple time model; no engine code) and blind Claude AI judges (read only the rules + per-step evidence packets; engine verdicts hidden). AI judges use packet values that include engine-derived per-step times (incl. heat rests), line of sight and shelter minutes, so they verify rule application, not the underlying models; the independent checker verifies geometry and line of sight independently. Re-run after the radio-relay fix (every masted shelter relays). The single disagreement (W02) is a safe-side engine NO-GO: the engine judged its heat-aware route (radio gap 0.22 min over the limit) while the shortest-time path in the packet passes; the engine does not yet try alternative paths before NO-GO. See v4_crosscheck/README.md.'))(json.load(open(f'{H}/v4_crosscheck/three_way_summary.json'))),
 generatedUtc=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
json.dump(out, open(f'{H}/numbers.json', 'w'), indent=1); print(json.dumps(out, indent=1))
