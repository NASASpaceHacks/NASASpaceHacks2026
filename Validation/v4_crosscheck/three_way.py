"""Three-way comparison: engine vs independent checker vs blind AI judges. Writes three_way_summary.json."""
import json, os
H = os.path.dirname(os.path.abspath(__file__))
L = lambda f: json.load(open(os.path.join(H, f)))
eng = {e['walk']: e for e in L('engine_verdicts.json')}
ind = L('independent_results.json')  # {walk: {verdict, failing_rules, ...}}
ai = {r['walk']: r for r in L('ai_judge_batch1.json') + L('ai_judge_batch2.json')}
def eng_rules(e):
    rs = {d['rule'] for d in e.get('dropped', [])}
    b = (e.get('binding') or {}).get('rule')
    if e['engine_verdict'] == 'NO-GO' and b: rs.add(b)
    return sorted(rs)
rows = []; n_ai = n_ind = n_all = named_ai = named_ind = nogo = 0
for w in sorted(eng):
    e, i, a = eng[w], ind.get(w, {}), ai.get(w, {})
    ev, iv, av = e['engine_verdict'], i.get('verdict'), a.get('verdict')
    er = eng_rules(e); ir = sorted({f['rule'] for f in i.get('failing_rules', [])}); ar = sorted({f['rule'] for f in a.get('failing_rules', [])})
    n_ai += ev == av; n_ind += ev == iv; n_all += ev == av == iv
    if ev == 'NO-GO':
        nogo += 1; named_ai += bool(set(er) & set(ar)); named_ind += bool(set(er) & set(ir))
    rows.append(dict(walk=w, engine=ev, engine_rules=er, independent=iv, independent_rules=ir, ai=av, ai_rules=ar, ai_reasoning=a.get('reasoning', '')))
out = dict(walks=len(rows), engine_vs_ai=n_ai, engine_vs_independent=n_ind, all_three=n_all, engine_nogo=nogo,
           rule_named_by_ai=named_ai, rule_named_by_independent=named_ind,
           disagreements=[r for r in rows if not (r['engine'] == r['ai'] == r['independent'])], rows=rows)
json.dump(out, open(os.path.join(H, 'three_way_summary.json'), 'w'), indent=1)
print({k: v for k, v in out.items() if k not in ('rows', 'disagreements')})
for r in out['disagreements']: print(r['walk'], 'eng', r['engine'], r['engine_rules'], '| ind', r['independent'], r['independent_rules'], '| ai', r['ai'], r['ai_rules'])
