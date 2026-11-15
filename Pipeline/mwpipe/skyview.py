"""Stage — sky-view raster (`skyview.bin`): visible-sky fraction 0-1 per engine cell, for the radiation shielding term.

Same horizon method and definition as Validation/v1_shielding (Guo et al. 2026 obstructed-sky ratio, "solid_angle" reading,
MAE 2.0 pp vs the paper's Table 1): viewpoint 1 m above the DEM, azimuth rays, horizon elevation per ray (with the d^2/2R
curvature drop), ROS(theta) = fraction of azimuth obstructed at zenith theta (1 deg zenith bins), obstructed fraction
B = sum(ROS*sin theta)/sum(sin theta).  skyview = 1 - B.

Cost control: the horizon is computed at the centre of every 5x5 block of engine cells (a 25 m grid, 1 deg azimuth steps, 5 m
DEM samples every 5 m to 250 m then geometric x1.03 to the edge of the pack) and bilinearly upsampled to the 5 m grid.
The error against a V1-style full-resolution computation (1 m DEM, 0.25 deg rays, 1 m steps to 1 km, 8 m beyond) at random
cells is measured by `validate_against_fullres` and written into the layer's provenance.  The DEM only covers the 5 km pack,
so rays leaving it are truncated (V1 used 20 km): obstruction by far terrain outside the pack is not seen.
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

from .common import MARS_R, Site, write_raster

H_OBS = 1.0
COARSE = 5                                   # engine cells per coarse step (25 m)
N_AZ = 360


def ros_blocked_fraction(elev_deg: np.ndarray) -> np.ndarray:
    """elev_deg (N, n_az) horizon elevations -> obstructed fraction of the hemisphere (solid-angle weighted, as V1)."""
    th = np.arange(0.5, 90, 1.0)
    s = np.sin(np.radians(th))
    cum = np.concatenate([[0.0], np.cumsum(s)])
    k = np.clip(np.ceil(89.5 - elev_deg), 0, 90).astype(int)      # first blocked zenith bin: th_k >= 90 - e
    return ((cum[-1] - cum[k]) / cum[-1]).mean(axis=1)


def horizon_elev(dem: np.ndarray, res: float, px: np.ndarray, py: np.ndarray, n_az: int, dists: np.ndarray,
                 chunk: int = 4000) -> np.ndarray:
    """Horizon elevation (deg) per viewpoint and azimuth. dem pixel (r, c) centre = ((c+.5)res, (r+.5)res), row 0 north.
    px, py: viewpoint position in the same metres (x east, y SOUTH from the DEM top-left)."""
    H, W = dem.shape
    dem0 = np.nan_to_num(dem, nan=0.0)
    z0 = map_coordinates(dem0, [py / res - 0.5, px / res - 0.5], order=1, mode="nearest") + H_OBS
    az = np.radians((np.arange(n_az) + 0.5) * 360.0 / n_az)
    out = np.full((len(px), n_az), -90.0)
    curv = dists ** 2 / (2 * MARS_R)
    for a in range(n_az):
        for i in range(0, len(px), chunk):
            sl = slice(i, i + chunk)
            X = px[sl, None] + np.sin(az[a]) * dists[None, :]
            Y = py[sl, None] - np.cos(az[a]) * dists[None, :]
            cols, rows = X / res - 0.5, Y / res - 0.5
            ok = (cols >= 0) & (cols <= W - 1) & (rows >= 0) & (rows <= H - 1)
            z = map_coordinates(dem0, [rows, cols], order=1, mode="nearest")
            ang = np.degrees(np.arctan2(z - z0[sl, None] - curv[None, :], dists[None, :]))
            out[sl, a] = np.where(ok, ang, -90.0).max(axis=1)
    return out


def coarse_dists(res: float, extent_m: float) -> np.ndarray:
    d = list(np.arange(res, 250 + 1e-9, res))
    while d[-1] < extent_m:
        d.append(d[-1] * 1.03)
    return np.array(d)


def build_skyview_array(dem5: np.ndarray, cell: float) -> np.ndarray:
    """Visible-sky fraction on the engine grid from the engine DEM."""
    h, w = dem5.shape
    ch, cw = h // COARSE, w // COARSE
    jj, ii = np.meshgrid(np.arange(cw), np.arange(ch))
    px = ((jj.ravel() + 0.5) * COARSE) * cell        # block centre
    py = ((ii.ravel() + 0.5) * COARSE) * cell
    elev = horizon_elev(dem5.astype(np.float64), cell, px, py, N_AZ, coarse_dists(cell, max(h, w) * cell * 1.42))
    B = ros_blocked_fraction(elev).reshape(ch, cw)
    # bilinear upsample: fine cell centre (r+.5)*cell -> coarse index (r+.5)/COARSE - .5
    rr, cc = np.meshgrid((np.arange(h) + 0.5) / COARSE - 0.5, (np.arange(w) + 0.5) / COARSE - 0.5, indexing="ij")
    Bf = map_coordinates(B, [rr, cc], order=1, mode="nearest")
    return np.clip(1.0 - Bf, 0.0, 1.0)


def fullres_blocked(z1: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """V1-style reference on the 1 m DEM: 0.25 deg rays (1440), 1 m steps to 1 km, 8 m steps beyond."""
    ext = max(z1.shape) * 1.0 * 1.42
    d = np.concatenate([np.arange(2.0, 1000.0, 1.0), np.arange(1000.0, ext, 8.0)])
    return ros_blocked_fraction(horizon_elev(z1, 1.0, px, py, 1440, d, chunk=40))


def validate_against_fullres(site: Site, sky: np.ndarray, z1: np.ndarray, margin_m: float, n: int = 60, seed: int = 7) -> dict:
    rng = np.random.default_rng(seed)
    r = rng.integers(0, site.h, n)
    c = rng.integers(0, site.w, n)
    px = (c + 0.5) * site.cell_m + margin_m          # position in z1 metres (z1 has margin_m extra on each side)
    py = (r + 0.5) * site.cell_m + margin_m
    ref = fullres_blocked(z1, px, py)
    ours = 1.0 - sky[r, c]
    err = np.abs(ours - ref) * 100
    return dict(n=n, mae_pp=float(err.mean()), p95_pp=float(np.percentile(err, 95)), max_pp=float(err.max()),
                bias_pp=float(((ours - ref) * 100).mean()), mean_blocked_pct=float(ref.mean() * 100),
                rows=r.tolist(), cols=c.tolist(), ref_blocked=[round(float(x), 5) for x in ref])


def build_skyview(site: Site, pack: Path, m: dict) -> dict:
    from .terrain import MARGIN_M, fetch_dem_window, fill_nodata, resample_to_local
    t0 = time.time()
    dem5 = np.fromfile(pack / m["rasters"]["dem"]["file"], dtype="<f4").reshape(site.h, site.w)
    sky = build_skyview_array(dem5, site.cell_m)
    print(f"  skyview: computed in {time.time() - t0:.0f} s, blocked mean {100 * (1 - sky.mean()):.1f} %, max {100 * (1 - sky.min()):.1f} %", flush=True)
    z1, _ = fill_nodata(resample_to_local(site, fetch_dem_window(site), 1.0, MARGIN_M))
    v = validate_against_fullres(site, sky, z1, MARGIN_M)
    print(f"  skyview vs full-res (n={v['n']}): MAE {v['mae_pp']:.2f} pp, p95 {v['p95_pp']:.2f}, max {v['max_pp']:.2f}, bias {v['bias_pp']:+.2f}", flush=True)
    dem_prov = m["rasters"]["dem"]["provenance"][0]
    layer = {
        "id": "skyview", "label": "Visible sky fraction (terrain shielding)", "kind": "continuous", "file": "skyview.bin",
        "dtype": "u16", "bands": 1, "scale": 0.0001, "offset": 0, "unit": "fraction", "indicative": True,
        "provenance": [{
            **dem_prov,
            "product": "Derived from " + dem_prov["product"],
            "citation": "Horizon method and obstructed-sky definition reproduced in Validation/v1_shielding against Guo et al. (2026), "
                        "JGR Planets, doi:10.1029/2026JE009704 (MAE 2.0 pp, r = 0.94, 15 periods). " + dem_prov["citation"],
            "accuracy": (f"Derived. Horizon at 25 m spacing (1 deg azimuth steps, 5 m DEM samples, rays truncated at the 5 km pack edge), "
                         f"bilinearly upsampled to 5 m. Versus a V1-style full-resolution computation (1 m DEM, 0.25 deg rays) at "
                         f"{v['n']} random cells: MAE {v['mae_pp']:.1f} pp, 95th percentile {v['p95_pp']:.1f} pp, max {v['max_pp']:.1f} pp "
                         f"(obstructed fraction, solid-angle weighted). Terrain far outside the pack is not seen. Indicative."),
        }],
    }
    write_raster(pack, layer, sky)
    m["rasters"]["skyview"] = layer
    m.setdefault("_stats", {})["skyview"] = {k: v[k] for k in ("n", "mae_pp", "p95_pp", "max_pp", "bias_pp", "mean_blocked_pct")}
    return m
