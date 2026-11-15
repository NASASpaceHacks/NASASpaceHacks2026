#!/usr/bin/env python3
"""X4 independent checker. Written from the rule text (Shared/src/contracts/rules.ts labels/citations) and the
raw rasters only; NO engine code is imported, ported or called. Inputs from the packet: rules, base/destination/
shelter/mast cells, start LTST, dwell. Route cells come from route_cells.json (the full cell list behind the packet).

Own model (deliberately simpler than the engine):
  * slope: Horn 3x3 on the raw DEM (5 m); edge grade: atan(|dz|/horizontal step)
  * walking time: 3-D step length / 0.56 m/s, NO suit-heat rests; walk-back contingency = half speed along the
    best (own Dijkstra) path; dwell; 30 min egress + 30 min ingress
  * radio LOS: own ray sampling (2.5 m, bilinear DEM, Mars curvature) from 3 m masts to a 1.8 m observer
  * out-of-LOS minutes: an edge counts fully if both ends are out of LOS, half if one end, none if neither
  * sun: elevation from Ls (obliquity 25.19 deg), LTST hour angle, latitude of site centre
Usage: python independent_check.py  -> independent_results.json
"""
import json, math, os, sys
import numpy as np
from scipy.ndimage import map_coordinates
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PACK = os.path.join(ROOT, 'SitePacks', 'gale-v1')
man = json.load(open(os.path.join(PACK, 'manifest.json')))
W = man['grid']['w']; H = man['grid']['h']; CELL = man['grid']['cellM']
OX, OY = man['grid']['originX'], man['grid']['originY']
DT = {'f32': '<f4', 'u16': '<u2', 'i16': '<i2'}

def load(rid):
    L = man['rasters'][rid]
    a = np.fromfile(os.path.join(PACK, L['file']), dtype=DT[L['dtype']]).reshape(H, W)
    out = a.astype(np.float64) * L['scale'] + L['offset']
    if L.get('nodata') is not None:
        out[a == L['nodata']] = np.nan
    return out

dem = load('dem'); slope_ref = load('slope')
V0 = 0.56; WB = 0.5; MAST = 3.0; OBS = 1.8; RMARS = 3396190.0
LS = 240.0  # sol 412 has no REMS record in the pack; rules/engine assume Ls=240 for it (documented in packets' notes)
LAT = man['grid']['centerLonLat'][1]

# ---------- own Horn slope ----------
def horn_slope(z):
    p = np.pad(z, 1, mode='edge')
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * CELL)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * CELL)  # sign irrelevant for magnitude
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
slope = horn_slope(dem)

def rc(c): return divmod(int(c), W)
def dist_cells(a, b):
    ra, ca = rc(a); rb, cb = rc(b); return math.hypot(ra - rb, ca - cb) * CELL

# ---------- keep-out polygons (plume) ----------
def keepout_mask():
    m = np.zeros((H, W), bool)
    rr, cc = np.mgrid[0:H, 0:W]
    xs = OX + (cc + 0.5) * CELL; ys = OY - (rr + 0.5) * CELL
    for k in man.get('keepouts', []):
        if k.get('kind') != 'plume': continue
        for ring in k['rings']:
            P = np.array(ring); x0, x1, y0, y1 = P[:, 0].min(), P[:, 0].max(), P[:, 1].min(), P[:, 1].max()
            sel = (xs >= x0) & (xs <= x1) & (ys >= y0) & (ys <= y1)
            px, py = xs[sel], ys[sel]; inside = np.zeros(px.shape, bool)
            j = len(P) - 1
            for i in range(len(P)):
                xi, yi, xj, yj = P[i, 0], P[i, 1], P[j, 0], P[j, 1]
                cond = ((yi > py) != (yj > py)) & (px < (xj - xi) * (py - yi) / (yj - yi + 1e-30) + xi)
                inside ^= cond; j = i
            m[sel] |= inside
    return m
KO = keepout_mask()

# ---------- own walking graph (for walk-back / shelter minutes) ----------
ok_cell = np.isfinite(dem) & (slope <= 20.0) & ~KO
def build_graph():
    idx = np.arange(H * W).reshape(H, W)
    rows, cols, cost = [], [], []
    for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
        r0, r1 = (0, H - dr); c0, c1 = (max(0, -dc), W - max(0, dc))
        a = idx[r0:r1, c0:c1]; b = idx[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
        za = dem[r0:r1, c0:c1]; zb = dem[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
        hd = CELL * math.hypot(dr, dc); dz = zb - za
        good = ok_cell[r0:r1, c0:c1] & ok_cell[r0 + dr:r1 + dr, c0 + dc:c1 + dc] & (np.abs(dz) <= hd * math.tan(math.radians(20)))
        t = np.hypot(hd, dz) / V0 / 60.0
        rows.append(a[good]); cols.append(b[good]); cost.append(t[good])
    r = np.concatenate(rows); c = np.concatenate(cols); w = np.concatenate(cost)
    return coo_matrix((np.concatenate([w, w]), (np.concatenate([r, c]), np.concatenate([c, r]))), shape=(H * W, H * W)).tocsr()
G = build_graph()
_field_cache = {}
def field(sources):
    k = tuple(sorted(sources))
    if k not in _field_cache:
        _field_cache[k] = dijkstra(G, directed=False, indices=list(k), min_only=True).reshape(H, W)
    return _field_cache[k]  # minutes at nominal speed

# ---------- own LOS ----------
def los_to(mast_cell, targets):
    r0, c0 = rc(mast_cell); z0 = dem[r0, c0] + MAST
    out = np.zeros(len(targets), bool)
    for n, t in enumerate(targets):
        r1, c1 = rc(t)
        D = math.hypot(r1 - r0, c1 - c0) * CELL
        if D == 0: out[n] = True; continue
        z1 = dem[r1, c1] + OBS
        ns = max(2, int(D / 2.5))
        s = np.linspace(0, D, ns + 1)[1:-1]
        f = s / D
        rr = r0 + (r1 - r0) * f; cc = c0 + (c1 - c0) * f
        zt = map_coordinates(dem, [rr, cc], order=1, mode='nearest')
        line = z0 + (z1 - z0) * f
        bulge = s * (D - s) / (2 * RMARS)
        out[n] = bool(np.all(zt + bulge <= line))
    return out

# ---------- own sun ----------
def sun_elev(ltst_min):
    dec = math.asin(math.sin(math.radians(25.19)) * math.sin(math.radians(LS)))
    h = math.radians((ltst_min / 60.0 - 12.0) * 15.0)
    lat = math.radians(LAT)
    return math.degrees(math.asin(math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(h)))

def rule(rules, rid): return next(r['value'] for r in rules if r['id'] == rid)

def check(packet, legs, scale=1.0):
    rules = packet['rules']
    slope_lim = rule(rules, 'slope_max_deg'); eva_lim = rule(rules, 'eva_duration_max_min'); egr = rule(rules, 'egress_ingress_min')
    wbf = rule(rules, 'walkback_speed_factor'); sh_lim = rule(rules, 'shelter_time_max_min'); gap_lim = rule(rules, 'los_gap_max_min')
    sun_lim = rule(rules, 'daylight_min_sun_elev_deg'); rad_lim = rule(rules, 'walk_radius_max_m')
    v0 = packet['crew']['v0']
    base = packet['base']['cell']; dest = packet['destination']['cell']
    masts = packet['radio_masts']; shel = [s['cell'] for s in packet['shelters']]
    start = packet['start_ltst_min']; dwell = packet['dwell_min']
    out, ret = legs
    cells = out + ret[1:]
    nd = len(out) - 1  # index of the destination node
    # time per node (min since surface start), nominal pace, no heat rests
    t = [0.0]; walk3d = 0.0
    for k in range(1, len(cells)):
        a, b = cells[k - 1], cells[k]
        ra, ca = rc(a); rb, cb = rc(b)
        hd = CELL * math.hypot(ra - rb, ca - cb); dz = dem[rb, cb] - dem[ra, ca]
        L = math.sqrt(hd * hd + (0 if np.isnan(dz) else dz * dz)); walk3d += L
        t.append(t[-1] + scale * L / v0 / 60.0)
        if k == nd:  # dwell
            t[-1] = t[-1]
    # insert dwell: nodes after the destination are shifted by dwell
    tt = [x if i <= nd else x + dwell for i, x in enumerate(t)]
    t_arrive_dest = tt[nd]; t_depart_dest = tt[nd] + dwell
    walk_min = t[-1]
    total = egr / 2 + walk_min + dwell + egr / 2
    arr = np.array(cells)
    z = dem[arr // W, arr % W]; sl = slope[arr // W, arr % W]
    cell_slope_max = float(np.nanmax(sl)) if np.isfinite(sl).all() else float('inf')
    # edge grades
    eg = []
    for k in range(1, len(cells)):
        ra, ca = rc(cells[k - 1]); rb, cb = rc(cells[k])
        hd = CELL * math.hypot(ra - rb, ca - cb); dz = dem[rb, cb] - dem[ra, ca]
        eg.append(90.0 if np.isnan(dz) else math.degrees(math.atan2(abs(dz), hd)))
    edge_max = max(eg) if eg else 0.0
    ref_diff = float(np.nanmax(np.abs(sl - slope_ref[arr // W, arr % W])))
    dist_base = np.array([dist_cells(c, base) for c in cells]); maxd = float(dist_base.max())
    ko_hits = int(KO[arr // W, arr % W].sum())
    # LOS
    vis = np.zeros(len(cells), bool)
    uniq = sorted(set(cells))
    pos = {c: i for i, c in enumerate(uniq)}
    vm = np.zeros(len(uniq), bool)
    for m in masts: vm |= los_to(m, uniq)
    vis = np.array([vm[pos[c]] for c in cells])
    # out-of-LOS run (lo/mid/hi)
    def run(mode):
        best = cur = 0.0
        for k in range(1, len(cells)):
            dtk = t[k] - t[k - 1]
            ua, ub = (not vis[k - 1]), (not vis[k])
            if mode == 'mid': inc = dtk * (0.5 * ua + 0.5 * ub) if (ua or ub) else 0.0
            elif mode == 'lo': inc = dtk if (ua and ub) else 0.0
            else: inc = dtk if ub else 0.0   # arrival-node convention
            if not (ua or ub) or (mode == 'lo' and not (ua and ub)) or (mode == 'hi' and not ub): cur = 0.0
            else: cur += inc
            if k == nd and not vis[k] and dwell:
                cur += dwell
            best = max(best, cur)
            # hi/mid: reset only when LOS regained (handled above)
        return best
    gap = {m: run(m) for m in ('lo', 'mid', 'hi')}
    # walk-back / shelter along the route (own Dijkstra fields)
    wbfield = field([base]) / wbf  # minutes at half speed
    shfield = field(shel)
    wb_worst = -1e9; wb_at = None; sh_worst = -1e9
    avail = eva_lim - egr
    for k, c in enumerate(cells):
        r, q = rc(c)
        for tk in ([tt[k]] if k != nd else [t_arrive_dest, t_depart_dest]):
            v = tk + wbfield[r, q]
            if v > wb_worst: wb_worst, wb_at = v, k
        sh_worst = max(sh_worst, shfield[r, q])
    # sun (EVA minutes = 30 egress + surface time, Earth minutes -> Mars minutes /1.0275)
    def sun_at(tsurf): return sun_elev(start + (egr / 2 + tsurf) / 1.027491252)
    sun_min = min(sun_at(x) for x in tt + [t_depart_dest])
    sun_end = sun_at(tt[-1] + egr / 2) if True else None
    sun_worst = min(sun_min, sun_end)
    checks = {
        'slope_max_deg': dict(observed=max(cell_slope_max, edge_max), limit=slope_lim, margin=slope_lim - max(cell_slope_max, edge_max), detail=dict(cell_slope_max=cell_slope_max, edge_grade_max=edge_max)),
        'walk_radius_max_m': dict(observed=maxd, limit=rad_lim, margin=rad_lim - maxd),
        'plume_keepout_m': dict(observed=ko_hits, limit=0, margin=-ko_hits),
        'eva_duration_max_min': dict(observed=total, limit=eva_lim, margin=eva_lim - total),
        'walkback_speed_factor': dict(observed=wb_worst, limit=avail, margin=avail - wb_worst),
        'shelter_time_max_min': dict(observed=float(sh_worst), limit=sh_lim, margin=sh_lim - float(sh_worst)),
        'los_gap_max_min': dict(observed=gap['mid'], limit=gap_lim, margin=gap_lim - gap['mid'], detail=dict(lo=gap['lo'], hi=gap['hi'])),
        'daylight_min_sun_elev_deg': dict(observed=sun_worst, limit=sun_lim, margin=sun_worst - sun_lim),
    }
    fails = [dict(rule=k, observed=round(v['observed'], 3), limit=v['limit'], margin=round(v['margin'], 3)) for k, v in checks.items() if v['margin'] < -1e-9]
    return dict(verdict='NO-GO' if fails else 'GO', failing_rules=fails, checks=checks,
                model=dict(walk_min_no_rests=walk_min, total_eva_min_no_rests=total, path_3d_m=walk3d, max_slope_ref_diff_deg=ref_diff,
                           los_true_frac=float(vis.mean()), n_nodes=len(cells)),
                los_by_cell={str(c): bool(vm[pos[c]]) for c in uniq})

def main():
    legs_all = json.load(open(os.path.join(HERE, 'route_cells.json')))
    res = {}
    for fn in sorted(os.listdir(os.path.join(HERE, 'packets'))):
        if not fn.endswith('.json'): continue
        p = json.load(open(os.path.join(HERE, 'packets', fn)))
        r = check(p, legs_all[p['walk']])
        # DIAGNOSTIC variant: stretch walking times uniformly so the total matches the packet's cumulative minutes
        # (this spreads the engine's heat rests evenly over the route). Never used for the primary verdict.
        walk_min = r['model']['walk_min_no_rests']
        sc = max(1.0, (p['steps'][-1]['cum_min'] - p['dwell_min']) / walk_min)
        r2 = check(p, legs_all[p['walk']], scale=sc); r2.pop('los_by_cell')
        r['diagnostic_rest_scaled'] = dict(scale=sc, verdict=r2['verdict'], failing_rules=r2['failing_rules'])
        # LOS agreement with the packet rows (engine field) -- diagnostic only
        los = r.pop('los_by_cell'); n = d = 0
        for s in p['steps']:
            n += 1; d += int(los[str(s['cell'])] != s['in_los'])
        r['model']['los_rows_disagree_with_engine_field'] = d; r['model']['los_rows'] = n
        r['packet_final_cum_min'] = p['steps'][-1]['cum_min']
        res[p['walk']] = r
        print(p['walk'], r['verdict'], [f['rule'] for f in r['failing_rules']], 'losdiff', d, '/', n, flush=True)
    json.dump(res, open(os.path.join(HERE, 'independent_results.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
