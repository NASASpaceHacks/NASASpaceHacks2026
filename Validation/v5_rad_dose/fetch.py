"""Fetch MSL RAD dose-rate (PDS PPI MSL-M-RAD-3-RDR-V1.0) and REMS pressure (PDS Atmospheres mslrem_1001) for selected sols.
Only the dose bytes of each RAD observation are fetched (HTTP range requests); REMS RMD files are streamed and reduced to
(LMST sol, pressure) so no multi-GB raw files are kept. Output: data/rad_dose.csv, data/rems_p_<sol>.csv. Run: python fetch.py"""
import re, os, sys, csv, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
H = os.path.dirname(os.path.abspath(__file__)); D = f'{H}/data'; os.makedirs(D, exist_ok=True)
RAD = 'https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0'
REMS = 'https://atmos.nmsu.edu/PDS/data/mslrem_1001/DATA'
def get(url, rng=None, tries=4):
    for t in range(tries):
        try:
            rq = urllib.request.Request(url, headers={'Range': f'bytes={rng[0]}-{rng[1]}'} if rng else {})
            return urllib.request.urlopen(rq, timeout=60).read()
        except Exception as e:
            err = e
    raise err
def index():
    p = f'{D}/INDEX.TAB'
    if not os.path.exists(p): open(p, 'wb').write(get(RAD + '/INDEX/INDEX.TAB'))
    out = {}
    for l in open(p).readlines()[1:]:
        m = re.search(r'"(/DATA/[^"]+_(\d{4})_V\d\d\.LBL)"', l)
        if m: out.setdefault(int(m.group(2)), []).append(m.group(1))
    return out
def rad_sol(path):
    lbl = get(RAD + path).decode('latin1')
    items = re.findall(r'\^OBS(\d+)_TOT_DOSE_([BE])_ELEMENT\s*=\s*\("([^"]+)",(\d+) <BYTES>', lbl)
    if not items: return []
    fn = items[0][2]; url = RAD + os.path.dirname(path) + '/' + fn
    obs = {}
    for o, k, _, b in items:
        if k == 'B': obs[o] = int(b) - 1
    l1 = {o: int(b) - 1 for o, b in re.findall(r'\^OBS(\d+)_L1_TABLE\s*=\s*\("[^"]+",(\d+) <BYTES>', lbl)}
    def one(o):
        b = obs[o]
        if o not in l1: return None
        h = get(url, (max(0, l1[o] - 700), l1[o])).decode('latin1')
        k = h.rfind('[OBSERVATION:'); m = re.findall(r'START_OBS_MARS="(\d{4}) (\d\d):(\d\d):(\d\d)"', h[k:]) if k >= 0 else []
        if not m: return None
        s, hh, mm, ss = map(int, m[-1])
        t = get(url, (b, b + 50)).decode('latin1')
        return (int(o), s + (hh + mm / 60 + ss / 3600) / 24, float(t[:7]), float(t[43:50]))
    with ThreadPoolExecutor(8) as ex: res = list(ex.map(one, obs))
    return [r for r in res if r]
def rems_sol(sol):
    p = f'{D}/rems_p_{sol:04d}.csv'
    if os.path.exists(p): return
    a = f'{REMS}/SOL_{(sol-1)//89*89+1 if sol<90 else None}'
    # directory ranges are irregular; find via listing of the top-level
    top = get(REMS + '/').decode()
    for d in re.findall(r'SOL_(\d{5})_(\d{5})/', top):
        if int(d[0]) <= sol <= int(d[1]): rng = f'SOL_{d[0]}_{d[1]}'
    ls = get(f'{REMS}/{rng}/SOL{sol:05d}/').decode()
    f = re.findall(r'(RME_\d+RMD\d+_+P\w\.TAB)"', ls)[0]
    rows = []
    with urllib.request.urlopen(f'{REMS}/{rng}/SOL{sol:05d}/{f}', timeout=120) as r:
        for line in r:
            c = line.decode('latin1').split(',')
            try:
                P = float(c[-3]); lm = c[1].strip('"'); conf = c[-1].strip().strip('"')
                if 200 < P < 1500:
                    s = int(lm[:5]); hh, mm, ss = lm[6:].split(':')
                    rows.append((round(s + (int(hh) + int(mm) / 60 + float(ss) / 3600) / 24, 5), P))
            except Exception: pass
    with open(p, 'w') as fh:
        fh.write('lmst_sol,p_pa\n'); [fh.write(f'{a},{b}\n') for a, b in rows]
    print('rems', sol, len(rows), flush=True)
if __name__ == '__main__':
    idx = index()
    dose_sols = sorted(set(range(10, 700, 10)) | set(range(700, 4800, 60)) | set(range(840, 880, 4)) | set(range(1500, 1560, 6)))
    dose_sols = [s for s in dose_sols if s in idx]
    outp = f'{D}/rad_dose.csv'
    done = set()
    if os.path.exists(outp): done = {int(r['file_sol']) for r in csv.DictReader(open(outp))}
    new = not os.path.exists(outp)
    fh = open(outp, 'a'); w = csv.writer(fh)
    if new: w.writerow(['file_sol', 'obs', 'mars_sol_frac', 'dose_B_uGy_h', 'dose_E_uGy_h'])
    for s in dose_sols:
        if s in done and s != max(done): continue
        for path in idx[s]:
            for r in rad_sol(path): w.writerow([s, *r])
        fh.flush(); print('rad', s, flush=True)
    for s in [x for x in dose_sols if x <= 700]:
        try: rems_sol(s)
        except Exception as e: print('rems fail', s, e)
