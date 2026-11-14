"""Hab / rover / landing-pad siting, plume keep-out, and science stations.

Siting is a deterministic, documented heuristic on the real DEM (not a published NASA selection):
- HAB: flat (<5° at the cell and mean <5° over 35 m) within 750 m of the AOI centre, maximising the
  distance-weighted fraction of walkable terrain within 2 km that is in line of sight from a mast.
- ROVER (movable pressurized shelter): flat cell 700–900 m from the hab in the hab's walkable component,
  closest to the area Curiosity actually explored (median distance to in-AOI waypoints).
- LANDING PAD: flat ≥105 m pad area, ≥1.6 km from the hab (rule: ≥1.5 km), within 450 m of the AOI edge;
  the 1 km plume ring (plume_keepout_m) must clear the hab and rover and covers as little walkable terrain as possible.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy import ndimage

from .common import REPO_DIR, Site, read_raster, ring

SLOPE_MAX = 20.0            # rules.ts slope_max_deg (xEVA ConOps / Artemis III); hard mask
FLAT = 5.0                  # task brief: hab on a <5° cell
MAST_H = 6.0                # assumed hab comm-mast height above ground (m) — design parameter for siting only
HELMET_H = 1.8              # suited crew antenna height (m)
WALK_R = 2000.0             # rules.ts walk_radius_max_m
PLUME_R = 1000.0            # rules.ts plume_keepout_m (Hoffman et al., NTRS 20160002370)
PLUME_CITE = ("Hoffman et al., First Landing Site/Exploration Zone Workshop (NTRS 20160002370): ~1 km plume-ejecta "
              "hazard zone around the landing site; pad ≥1.5 km from the hab (Marswalk rule plume_keepout_m).")
STATIONS_JSON = REPO_DIR / "Content" / "stations.gale.json"


def load_terrain(site: Site, pack: Path, m: dict):
    dem = read_raster(pack, m["rasters"]["dem"]).reshape(site.h, site.w)
    slope = read_raster(pack, m["rasters"]["slope"]).reshape(site.h, site.w)
    return dem, slope


def walkable_component(slope: np.ndarray, seed_rc: tuple[int, int]) -> np.ndarray:
    lab, _ = ndimage.label(slope <= SLOPE_MAX, structure=np.ones((3, 3)))
    return lab == lab[seed_rc]


def viewshed_score(dem, walk, site: Site, r0: int, c0: int, h_obs=MAST_H, h_tgt=HELMET_H, radius_m=WALK_R, n_rays=360):
    """Distance-weighted fraction of walkable ray samples within radius that see the observer (radial sweep)."""
    step = 0.5
    d = np.arange(1, radius_m / site.cell_m / step + 1) * step               # in cells
    ang = np.linspace(0, 2 * np.pi, n_rays, endpoint=False)
    rr = r0 + np.outer(-np.cos(ang), d)
    cc = c0 + np.outer(np.sin(ang), d)
    ok = (rr >= 0) & (rr <= site.h - 1) & (cc >= 0) & (cc <= site.w - 1)
    z = ndimage.map_coordinates(dem, [np.clip(rr, 0, site.h - 1), np.clip(cc, 0, site.w - 1)], order=1)
    wk = ndimage.map_coordinates(walk.astype(np.float32), [np.clip(rr, 0, site.h - 1), np.clip(cc, 0, site.w - 1)], order=0) > 0.5
    z0 = dem[r0, c0] + h_obs
    dist = d[None, :] * site.cell_m
    terr = (z - z0) / dist
    horizon = np.maximum.accumulate(np.concatenate([np.full((n_rays, 1), -np.inf), terr[:, :-1]], 1), axis=1)
    vis = (z + h_tgt - z0) / dist >= horizon
    wgt = dist * (ok & wk)
    return float((vis * wgt).sum() / max(wgt.sum(), 1e-9)), vis, ok


def _flat_mask(slope: np.ndarray, cell_lim=FLAT, mean_win=7, mean_lim=FLAT):
    return (slope < cell_lim) & (ndimage.uniform_filter(slope, mean_win, mode="nearest") < mean_lim) & \
           (ndimage.maximum_filter(slope, 3, mode="nearest") < cell_lim + 2)


def _shelter(site: Site, sid, kind, name, rc, movable):
    cell = int(rc[0] * site.w + rc[1])
    x, y = site.cell_to_xy(cell)
    return {"id": sid, "kind": kind, "name": name, "x": x, "y": y, "cell": cell, "movable": movable}


def _aoi_waypoints(pack: Path):
    p = pack / "traverse_waypoints.json"
    if not p.exists():
        return []
    return [w for w in json.loads(p.read_text())["waypoints"] if w["cell"] >= 0]


def build_siting(site: Site, pack: Path, m: dict) -> dict:
    dem, slope = load_terrain(site, pack, m)
    H, W = site.h, site.w
    rows, cols = np.mgrid[0:H, 0:W]
    flat = _flat_mask(slope)
    # Largest walkable component (the hab must reach as much of the AOI as possible).
    lab, n = ndimage.label(slope <= SLOPE_MAX, structure=np.ones((3, 3)))
    big = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)

    # ── HAB ──
    dc = np.hypot(rows - (H - 1) / 2, cols - (W - 1) / 2) * site.cell_m
    cand = np.argwhere(flat & big & (dc < 750) & (rows % 3 == 0) & (cols % 3 == 0))
    if len(cand) == 0:
        cand = np.argwhere((slope < FLAT) & big & (dc < 1000))
    if len(cand) > 400:
        cand = cand[np.random.default_rng(412).choice(len(cand), 400, replace=False)]
    best = None
    for r, c in cand:
        sc, _, _ = viewshed_score(dem, big, site, int(r), int(c), n_rays=180)
        score = sc - 0.05 * dc[r, c] / 750.0
        if best is None or score > best[0]:
            best = (score, sc, int(r), int(c))
    _, vis_frac, hr, hc = best
    vis_frac, _, _ = viewshed_score(dem, big, site, hr, hc, n_rays=720)
    hab = _shelter(site, "HAB", "hab", "Habitat (Hab-1)", (hr, hc), False)
    walk = walkable_component(slope, (hr, hc))

    # ── ROVER ──
    dh = np.hypot(rows - hr, cols - hc) * site.cell_m
    wps = _aoi_waypoints(pack)
    wrc = np.array([[w["cell"] // W, w["cell"] % W] for w in wps]) if wps else np.array([[hr, hc]])
    rc_c = np.argwhere(flat & walk & (dh >= 700) & (dh <= 900))
    if len(rc_c) == 0:
        rc_c = np.argwhere((slope < FLAT) & walk & (dh >= 700) & (dh <= 900))
    med = np.array([np.median(np.hypot(wrc[:, 0] - r, wrc[:, 1] - c)) for r, c in rc_c])
    rr_, rcol = map(int, rc_c[int(med.argmin())])
    rover = _shelter(site, "ROVER1", "rover", "Pressurized rover (PR-1)", (rr_, rcol), True)

    # ── LANDING PAD + plume keep-out ──
    edge = np.minimum.reduce([rows, cols, H - 1 - rows, W - 1 - cols]) * site.cell_m
    dr = np.hypot(rows - rr_, cols - rcol) * site.cell_m
    base = walk & (dh >= 1600) & (edge <= 450) & (edge >= 60) & (dr >= PLUME_R + 150)
    # Open approach: < 15 m of relief within ~155 m (no mesas beside the pad).
    relief = ndimage.maximum_filter(dem, 31, mode="nearest") - ndimage.minimum_filter(dem, 31, mode="nearest")
    rough = read_raster(pack, m["rasters"]["rough"]).reshape(H, W) if "rough" in m["rasters"] else np.zeros_like(slope)
    rough_pad = ndimage.uniform_filter(rough, 21, mode="nearest")
    if "ti" in m["rasters"]:   # avoid likely unconsolidated sand (THEMIS TI < 300 J m⁻² K⁻¹ s⁻½; indicative, 100 m data)
        ti = read_raster(pack, m["rasters"]["ti"]).reshape(H, W)
        base &= np.nan_to_num(ti, nan=0) >= 300
    pad_c = np.empty((0, 2), int)
    for win, lim, rel in ((21, 5.0, 15), (21, 6.0, 20), (15, 6.0, 25), (11, 8.0, 40)):   # relax only if needed
        padflat = (ndimage.maximum_filter(slope, 11, mode="nearest") < lim + 5) & \
                  (ndimage.uniform_filter(slope, win, mode="nearest") < lim) & (relief < rel)
        pad_c = np.argwhere(base & padflat & (rows % 2 == 0) & (cols % 2 == 0))
        if len(pad_c):
            pad_win, pad_lim = win, lim
            break
    assert len(pad_c), "no landing-pad candidate"
    walk_near_hab = walk & (dh <= WALK_R)
    wr, wc = np.nonzero(walk_near_hab[::4, ::4])
    wr, wc = wr * 4, wc * 4
    best_pad = None
    for r, c in pad_c:
        covered = np.count_nonzero(np.hypot(wr - r, wc - c) * site.cell_m < PLUME_R)
        wp_cov = int(np.count_nonzero(np.hypot(wrc[:, 0] - r, wrc[:, 1] - c) * site.cell_m < PLUME_R)) if wps else 0
        score = covered + 20 * wp_cov + 2000 * rough_pad[r, c]    # 0.1 m mean roughness ≈ 200 covered samples
        if best_pad is None or score < best_pad[0]:
            best_pad = (score, int(r), int(c), covered, wp_cov)
    _, pr, pc, cov, wp_cov = best_pad
    px, py = site.cell_to_xy(pr * W + pc)
    keep = {"id": "PLUME-LZ1", "kind": "plume", "label": "Landing zone LZ-1 plume-ejecta keep-out (1 km)",
            "rings": [ring(px, py, PLUME_R, 72)], "citation": PLUME_CITE}
    assert math.hypot(px - hab["x"], py - hab["y"]) >= 1500 and math.hypot(px - rover["x"], py - rover["y"]) > PLUME_R

    m["shelters"] = [hab, rover] + [s for s in m["shelters"] if s["kind"] == "cache"]
    m["keepouts"] = [keep] + [k for k in m["keepouts"] if k["id"] != "PLUME-LZ1"]
    m["landmarks"] = [l for l in m["landmarks"] if l["id"] != "LZ1"] + [{
        "id": "LZ1", "name": "Landing pad LZ-1 (scenario)", "x": px, "y": py, "elevM": round(float(dem[pr, pc]), 1), "informal": True}]
    m["_siting"] = {"hab_slope": float(slope[hr, hc]), "hab_vis": vis_frac, "rover_slope": float(slope[rr_, rcol]),
                    "pad_slope": float(slope[pr, pc]), "pad_hab_m": math.hypot(px - hab["x"], py - hab["y"]),
                    "rover_hab_m": math.hypot(rover["x"] - hab["x"], rover["y"] - hab["y"])}
    print(f"  hab cell {hab['cell']} (r{hr} c{hc}) slope {slope[hr, hc]:.2f}°, LOS to {vis_frac * 100:.1f} % of walkable ≤2 km; "
          f"rover {m['_siting']['rover_hab_m']:.0f} m away slope {slope[rr_, rcol]:.2f}°; pad {m['_siting']['pad_hab_m']:.0f} m from hab, "
          f"slope {slope[pr, pc]:.2f}° (pad window {pad_win * 5} m < {pad_lim}°), ring covers {wp_cov} Curiosity waypoints", flush=True)
    return m


# ───────────────────────────── stations ─────────────────────────────

def _snap_walkable(site: Site, slope, walk, r, c, max_m=30.0):
    if 0 <= r < site.h and 0 <= c < site.w and walk[r, c]:
        return r, c, 0.0
    rad = int(max_m / site.cell_m)
    best = None
    for dr in range(-rad, rad + 1):
        for dc in range(-rad, rad + 1):
            rr, cc = r + dr, c + dc
            if 0 <= rr < site.h and 0 <= cc < site.w and walk[rr, cc]:
                d = math.hypot(dr, dc) * site.cell_m
                if d <= max_m and (best is None or d < best[2]):
                    best = (rr, cc, d)
    return best


def _inside_keepouts(m, x, y):
    for k in m["keepouts"]:
        pts = k["rings"][0]
        inside = False
        for i in range(len(pts)):
            (xi, yi), (xj, yj) = pts[i], pts[i - 1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
        if inside:
            return k["id"]
    return None


def build_stations(site: Site, pack: Path, m: dict) -> dict:
    dem, slope = load_terrain(site, pack, m)
    hab = next(s for s in m["shelters"] if s["kind"] == "hab")
    hr, hc = divmod(hab["cell"], site.w)
    walk = walkable_component(slope, (hr, hc))
    out = []
    if STATIONS_JSON.exists():
        src = json.loads(STATIONS_JSON.read_text())
        items = src["stations"] if isinstance(src, dict) else src
        for s in items:
            x, y = site.fwd(s["lon"], s["lat"])
            r, c = (int(math.floor(v)) for v in site.xy_to_rc(float(x), float(y)))
            snap = _snap_walkable(site, slope, walk, r, c)
            if snap is None:
                print(f"  ! station {s['id']} at ({s['lon']}, {s['lat']}) is off-grid or >30 m from walkable terrain — skipped")
                continue
            rr, cc, dm = snap
            desc = s.get("description", "")
            if dm > 0:
                x, y = site.cell_to_xy(rr * site.w + cc)
                desc += f" [Pipeline: position snapped {dm:.0f} m to the nearest walkable (≤{SLOPE_MAX:g}°) cell.]"
            st = {"id": s["id"], "name": s["name"], "x": round(float(x), 2), "y": round(float(y), 2), "cell": int(rr * site.w + cc),
                  "value": float(s["value"]), "objectiveIds": list(s.get("objectiveIds", [])), "dwellMin": float(s.get("dwellMin", 20)),
                  "description": desc}
            for opt in ("taskW", "citation", "imageIds"):
                if s.get(opt) is not None:
                    st[opt] = s[opt]
            ko = _inside_keepouts(m, st["x"], st["y"])
            if ko:
                print(f"  ! station {s['id']} lies inside keep-out {ko} (kept; the engine will report it unreachable)")
            out.append(st)
        print(f"  stations: {len(out)} from {STATIONS_JSON.relative_to(REPO_DIR)}")
    else:
        # PLACEHOLDERS on Curiosity end-of-drive positions (real places the rover stopped), spread by farthest-point sampling.
        wps = _aoi_waypoints(pack)
        elig = []
        for w in wps:
            r, c = divmod(w["cell"], site.w)
            d = math.hypot(w["x"] - hab["x"], w["y"] - hab["y"])
            if walk[r, c] and ndimage.maximum_filter(slope[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2], 1).max() < 12 \
                    and 250 <= d <= 1800 and not _inside_keepouts(m, w["x"], w["y"]):
                elig.append(w)
        chosen = []
        if elig:
            P = np.array([[w["x"], w["y"]] for w in elig])
            dmin = np.hypot(P[:, 0] - hab["x"], P[:, 1] - hab["y"]) * 0 + np.inf
            idx = int(np.argmin(np.hypot(P[:, 0] - hab["x"], P[:, 1] - hab["y"])))
            for _ in range(min(8, len(elig))):
                chosen.append(idx)
                dmin = np.minimum(dmin, np.hypot(P[:, 0] - P[idx, 0], P[:, 1] - P[idx, 1]))
                idx = int(np.argmax(dmin))
        for i, k in enumerate(sorted(chosen, key=lambda j: elig[j]["sol"])):
            w = elig[k]
            x, y = site.cell_to_xy(w["cell"])
            out.append({"id": f"ST{i + 1:02d}", "name": f"Placeholder {i + 1} (Curiosity sol {w['sol']} stop)", "x": x, "y": y,
                        "cell": w["cell"], "value": 50.0, "objectiveIds": ["PLACEHOLDER"], "dwellMin": 20.0,
                        "description": f"PLACEHOLDER — awaiting Content/stations.gale.json. Curiosity end-of-drive position on sol "
                                       f"{w['sol']} (site {w['site']}, drive {w['drive']}), elevation {w['elevM']:.1f} m. "
                                       "Science value is a neutral placeholder (50), not an STM score.",
                        "citation": "NASA/JPL-Caltech MSL waypoints (MMGIS MSL_waypoints.json)"})
        print(f"  stations: Content/stations.gale.json not found → {len(out)} PLACEHOLDER stations on Curiosity stops")
    m["stations"] = out
    link_station_images(m)
    return m


def link_station_images(m: dict, radius_m: float = 60.0) -> None:
    """Attach rover images taken within radius_m of a station (keeps any Content-provided imageIds)."""
    for s in m["stations"]:
        near = [i["id"] for i in m["images"] if math.hypot(i["x"] - s["x"], i["y"] - s["y"]) <= radius_m]
        ids = list(dict.fromkeys([*(s.get("imageIds") or []), *near]))
        ids = [i for i in ids if any(im["id"] == i for im in m["images"])]
        if ids:
            s["imageIds"] = ids
        else:
            s.pop("imageIds", None)
