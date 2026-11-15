#!/usr/bin/env python3
"""X4 compare: engine verdicts vs the independent checker. Writes results.csv and summary.json."""
import csv, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ev = {x['walk']: x for x in json.load(open(os.path.join(HERE, 'engine_verdicts.json')))}
ind = json.load(open(os.path.join(HERE, 'independent_results.json')))
TIME_RULES = {'eva_duration_max_min', 'walkback_speed_factor', 'los_gap_max_min', 'daylight_min_sun_elev_deg'}
rows = []
FREE = ['slope_max_deg', 'walk_radius_max_m', 'plume_keepout_m', 'shelter_time_max_min']
free_ok = free_n = 0
los_d = los_n = 0
for w in sorted(ev):
    e, i = ev[w], ind[w]
    eng_rules = sorted({f['rule'] for f in e['candidate_eval']['failures']})
    eng_primary = e['dropped'][0]['rule'] if e['dropped'] else ''
    ind_rules = sorted(f['rule'] for f in i['failing_rules'])
    sc = i['diagnostic_rest_scaled']
    sc_rules = sorted(f['rule'] for f in sc['failing_rules'])
    agree = e['engine_verdict'] == i['verdict']
    rest = e['packet_rest_min']
    if agree:
        cls = 'agree'
    elif e['engine_verdict'] == 'NO-GO' and i['verdict'] == 'GO' and all(
            f['rule'] in ('los_gap_max_min', 'eva_duration_max_min', 'walkback_speed_factor') and f['worst'] - rest <= f['limit'] + 1e-9
            for f in e['candidate_eval']['failures']):
        # every engine failure is a time rule whose observed value drops to within the limit once the engine's own heat-rest
        # minutes are removed => the disagreement is fully attributable to the checker having no heat-rest model
        cls = 'model_difference_heat_rests'
    else:
        cls = 'UNEXPLAINED'
    primary_in_ind = (eng_primary in ind_rules) if e['engine_verdict'] == 'NO-GO' else ''
    primary_in_scaled = (eng_primary in sc_rules) if e['engine_verdict'] == 'NO-GO' else ''
    set_equal = (set(eng_rules) == set(ind_rules))
    cd = i['checks']
    for fr in FREE:
        free_n += 1; free_ok += int((fr in eng_rules) == (fr in ind_rules))
    los_d += i['model']['los_rows_disagree_with_engine_field']; los_n += i['model']['los_rows']
    rows.append(dict(walk=w, base=e['base'], dest=e['dest_label'], start_ltst=e['start_ltst_min'], engine=e['engine_verdict'], independent=i['verdict'], agree=int(agree),
        class_=cls, engine_primary_rule=eng_primary, engine_all_rules_on_candidate=' '.join(eng_rules), independent_rules=' '.join(ind_rules),
        independent_rest_scaled_verdict=sc['verdict'], independent_rest_scaled_rules=' '.join(sc_rules),
        primary_rule_in_independent=primary_in_ind, primary_rule_in_scaled=primary_in_scaled, rule_sets_identical_raw=int(set_equal),
        engine_rest_min=rest, rest_scale=round(sc['scale'], 2),
        dist_base_max_m=round(cd['walk_radius_max_m']['observed'], 1), max_slope_deg=round(cd['slope_max_deg']['observed'], 2),
        indep_gap_min=round(cd['los_gap_max_min']['observed'], 2), engine_gap_min=next((round(f['worst'], 2) for f in e['candidate_eval']['failures'] if f['rule'] == 'los_gap_max_min'), ''),
        indep_total_eva_min=round(i['model']['total_eva_min_no_rests'], 1), engine_total_eva_min=round(e['own_packet_total_min_with_rests'] + 60, 1),
        los_rows_disagree=i['model']['los_rows_disagree_with_engine_field'], los_rows=i['model']['los_rows'],
        max_slope_ref_diff_deg=round(i['model']['max_slope_ref_diff_deg'], 2), route_source=e['route_source']))
w = csv.DictWriter(open(os.path.join(HERE, 'results.csv'), 'w', newline=''), fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
n = len(rows); ag = sum(r['agree'] for r in rows)
go = [r for r in rows if r['engine'] == 'GO']; no = [r for r in rows if r['engine'] == 'NO-GO']
summary = dict(
    walks=n, engine_GO=len(go), engine_NOGO=len(no),
    verdict_agreement=ag, verdict_agreement_pct=round(100 * ag / n, 1),
    GO_agreement=sum(r['agree'] for r in go), NOGO_agreement=sum(r['agree'] for r in no),
    engine_GO_independent_NOGO=sum(1 for r in go if r['independent'] == 'NO-GO'),
    engine_NOGO_independent_GO=sum(1 for r in no if r['independent'] == 'GO'),
    disagreements=[r['walk'] for r in rows if not r['agree']],
    disagreement_classes={c: sum(1 for r in rows if r['class_'] == c) for c in {r['class_'] for r in rows}},
    after_rest_scaled_diagnostic=dict(verdict_agreement=sum(1 for r in rows if r['engine'] == r['independent_rest_scaled_verdict']), of=n),
    engine_primary_rule_found_by_independent_raw=f"{sum(1 for r in no if r['primary_rule_in_independent'] is True)}/{len(no)}",
    engine_primary_rule_found_by_independent_rest_scaled=f"{sum(1 for r in no if r['primary_rule_in_scaled'] is True)}/{len(no)}",
    identical_rule_sets_raw=f"{sum(r['rule_sets_identical_raw'] for r in rows)}/{n}",
    time_independent_rules_pass_fail_agreement=f'{free_ok}/{free_n} (slope, radius, keepout, shelter-minutes x 24 walks)',
    los_row_disagreement=f'{los_d}/{los_n} rows ({100*los_d/los_n:.1f}%) differ between my ray LOS and the engine viewshed field',
    time_free_rules_note='radius / slope / keepout / shelter-minutes do not depend on heat rests',
    walks_by_engine_primary_rule={k: sum(1 for r in no if r['engine_primary_rule'] == k) for k in sorted({r['engine_primary_rule'] for r in no})},
)
json.dump(summary, open(os.path.join(HERE, 'summary.json'), 'w'), indent=1)
print(json.dumps(summary, indent=1))
for r in rows: print(r['walk'], r['engine'], r['independent'], r['class_'], '| eng:', r['engine_primary_rule'], '| ind:', r['independent_rules'], '| scaled:', r['independent_rest_scaled_rules'])
