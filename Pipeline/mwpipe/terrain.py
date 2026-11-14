"""Stage 1 — terrain rasters (dem, slope, rough, normals) and the Curiosity traverse."""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import numpy as np

from .common import CACHE_DIR, MARS_R, Site, cached_download, eqc_source_to_local, write_raster

DEM_URL = "https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
DEM_PAGE = "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m"
TRAVERSE_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"

MARGIN_M = 10  # extra 1 m samples around the AOI so 5 m slope/normals at the edge use real neighbours

DEM_PROV = {
    "mission": "Mars Reconnaissance Orbiter + Mars Express + Mars Global Surveyor",
    "instrument": "HiRISE stereo DTMs, merged with CTX, HRSC and MOLA DEMs",
    "product": "MSL_Gale_DEM_Mosaic_1m_v3.tif (MSL Gale Merged DEM, 1 m)",
    "url": DEM_URL,
    "license": "Public domain (USGS Astrogeology / NASA PDS Annex)",
    "citation": "Parker, T. J. & Calef, F. J. III (2016), MSL Gale Merged Digital Elevation Model, 1 m/px, "
                "PDS Annex, U.S. Geological Survey. " + DEM_PAGE,
    "resolutionM": 1.0,
    "accuracy": "1 m posting; HiRISE stereo DTMs (effective resolution a few metres) where available, "
                "else CTX/HRSC/MOLA fill. Controlled to MOLA via HRSC (~100 m horizontal, ~1 m vertical absolute). "
                "Elevation relative to the MOLA areoid. Resampled here to the 5 m engine grid (block mean of 1 m samples).",
}


def fetch_dem_window(site: Site, half_m: float = 2700.0) -> Path:
    """Read only the AOI window of the 3.87 GB stripped GeoTIFF via /vsicurl/ and cache it (≈45 MB)."""
    import rasterio
    from rasterio.windows import from_bounds

    out = CACHE_DIR / f"dem_src_window_{site.id}.tif"
    legacy = CACHE_DIR / "dem_src_window.tif"
    if legacy.exists() and not out.exists():
        legacy.rename(out)
    if out.exists():
        return out
    xc, yc = MARS_R * math.radians(site.lon), MARS_R * math.radians(site.lat)  # source: eqc clon0, lat_ts 0
    t0 = time.time()
    with rasterio.open("/vsicurl/" + DEM_URL) as src:
        win = from_bounds(xc - half_m, yc - half_m, xc + half_m, yc + half_m, src.transform).round_offsets().round_lengths()
        print(f"  DEM: reading window {win} via /vsicurl/ ...", flush=True)
        arr = src.read(1, window=win)
        prof = dict(driver="GTiff", dtype="float32", width=arr.shape[1], height=arr.shape[0], count=1, crs=src.crs,
                    transform=src.window_transform(win), nodata=src.nodata, compress="deflate", predictor=3, tiled=True)
    with rasterio.open(out, "w", **prof) as dst:
        dst.write(arr, 1)
    print(f"  DEM: window cached in {time.time() - t0:.0f} s → {out.name}", flush=True)
    return out


def resample_to_local(site: Site, src_path: Path, res_m: float, margin_m: float, *, src_lon0=0.0, src_lat_ts=0.0,
                      resampling="bilinear", band_count=1, dtype="float32") -> np.ndarray:
    """Resample a global-eqc raster (same sphere) onto a local-eqc grid aligned with the site grid (+margin)."""
    import rasterio
    from affine import Affine
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    ox, oy = site.origin
    n_w = int(round((site.w * site.cell_m + 2 * margin_m) / res_m))
    n_h = int(round((site.h * site.cell_m + 2 * margin_m) / res_m))
    dst_tr = Affine(res_m, 0, ox - margin_m, 0, -res_m, oy + margin_m)
    crs = CRS.from_proj4(site.proj4)
    with rasterio.open(src_path) as src:
        src_tr = eqc_source_to_local(site, src.transform, src_lon0, src_lat_ts)
        out = np.full((band_count, n_h, n_w), np.nan if dtype == "float32" else 0, dtype=dtype)
        for b in range(band_count):
            reproject(source=rasterio.band(src, b + 1), destination=out[b], src_transform=src_tr, src_crs=crs,
                      dst_transform=dst_tr, dst_crs=crs, src_nodata=src.nodata,
                      dst_nodata=np.nan if dtype == "float32" else None, resampling=getattr(Resampling, resampling))
    return out[0] if band_count == 1 else out


def fill_nodata(a: np.ndarray) -> tuple[np.ndarray, int]:
    from scipy import ndimage
    bad = ~np.isfinite(a)
    n = int(bad.sum())
    if n:
        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        a = a[tuple(idx)]
    return a, n


def block_stats(z1: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Block mean and roughness for k×k blocks of 1 m samples.

    Roughness = RMS residual of a least-squares plane fitted to the k×k heights of each cell (std-dev of
    detrended heights). On a regular centred grid the plane fit is separable: b = Σuz/Σu², c = Σvz/Σv².
    """
    H, W = z1.shape[0] // k, z1.shape[1] // k
    b = z1[: H * k, : W * k].reshape(H, k, W, k).astype(np.float64)
    mean = b.mean(axis=(1, 3))
    u = np.arange(k) - (k - 1) / 2.0
    su2 = (u ** 2).sum() * k
    gx = (b * u[None, None, None, :]).sum(axis=(1, 3)) / su2   # dz per sample along columns (east)
    gy = (b * u[None, :, None, None]).sum(axis=(1, 3)) / su2   # dz per sample along rows (south)
    plane = mean[:, None, :, None] + gx[:, None, :, None] * u[None, None, None, :] + gy[:, None, :, None] * u[None, :, None, None]
    rough = np.sqrt(((b - plane) ** 2).mean(axis=(1, 3)))
    return mean, rough


def horn_slope_deg(dem: np.ndarray, cell: float) -> np.ndarray:
    """Horn (1981) slope; identical stencil to hornSlopeDeg() in Shared/src/contracts/sitepack.ts (edges clamped)."""
    p = np.pad(dem, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cell)
    dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cell)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def surface_normals(dem: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """(nx, ny) exactly as surfaceNormals() in sitepack.ts: +y = north, nx = −dz/dx, ny = −dz/dy_north, normalised."""
    p = np.pad(dem, 1, mode="edge")
    dzdx = (p[1:-1, 2:] - p[1:-1, :-2]) / (2 * cell)
    dzdy_n = (p[:-2, 1:-1] - p[2:, 1:-1]) / (2 * cell)
    nx, ny = -dzdx, -dzdy_n
    ln = np.sqrt(nx * nx + ny * ny + 1.0)
    return nx / ln, ny / ln


def build_terrain(site: Site, pack: Path, m: dict) -> dict:
    t0 = time.time()
    src = fetch_dem_window(site)
    k = int(site.cell_m)  # 1 m samples per 5 m cell edge
    z1 = resample_to_local(site, src, 1.0, MARGIN_M)
    z1, n_fill = fill_nodata(z1)
    dem_m, rough_m = block_stats(z1, k)          # (h+2p, w+2p) with p = MARGIN_M / cell
    p = int(MARGIN_M // site.cell_m)
    slope_m = horn_slope_deg(dem_m, site.cell_m)
    nx_m, ny_m = surface_normals(dem_m, site.cell_m)
    crop = (slice(p, p + site.h), slice(p, p + site.w))
    dem, rough, slope, nx, ny = dem_m[crop], rough_m[crop], slope_m[crop], nx_m[crop], ny_m[crop]
    assert dem.shape == (site.h, site.w)

    acc = DEM_PROV["accuracy"] + (f" {n_fill} nodata 1 m samples filled by nearest neighbour." if n_fill else "")
    prov = {**DEM_PROV, "accuracy": acc}
    deriv = lambda what: {**prov, "accuracy": f"Derived ({what}) from the 1 m DEM. " + acc}  # noqa: E731
    layers = {
        "dem": dict(id="dem", label="Elevation (MOLA areoid)", kind="continuous", file="dem.bin", dtype="f32", bands=1,
                    scale=1, offset=0, unit="m", provenance=[prov]),
        "slope": dict(id="slope", label="Slope (Horn, 5 m)", kind="continuous", file="slope.bin", dtype="u16", bands=1,
                      scale=0.01, offset=0, unit="deg", provenance=[deriv("Horn 1981 3×3 slope on the 5 m block-mean DEM")]),
        "rough": dict(id="rough", label="Roughness (std-dev of detrended 1 m heights per 5 m cell)", kind="continuous",
                      file="rough.bin", dtype="u16", bands=1, scale=0.001, offset=0, unit="m",
                      provenance=[deriv("RMS residual of a plane fitted to the 25 one-metre heights in each 5 m cell; "
                                        "limited by the DTM's effective resolution, so it under-represents sub-metre rocks")]),
        "normals": dict(id="normals", label="Surface normals (nx, ny)", kind="vector2", file="normals.bin", dtype="i16",
                        bands=2, scale=1 / 32767, offset=0, unit="", provenance=[deriv("central differences on the 5 m DEM, +y north")]),
    }
    write_raster(pack, layers["dem"], dem)
    write_raster(pack, layers["slope"], slope)
    write_raster(pack, layers["rough"], rough)
    nrm = np.stack([nx, ny], axis=-1)  # band-interleaved by pixel
    write_raster(pack, layers["normals"], nrm.reshape(-1))
    m["rasters"].update(layers)
    stats = {
        "elev_min": float(dem.min()), "elev_max": float(dem.max()),
        "slope_gt20_pct": float((slope > 20).mean() * 100), "slope_gt30_pct": float((slope > 30).mean() * 100),
        "slope_median": float(np.median(slope)), "rough_median": float(np.median(rough)), "rough_p99": float(np.percentile(rough, 99)),
        "filled": n_fill,
    }
    print(f"  terrain: elev {stats['elev_min']:.1f}…{stats['elev_max']:.1f} m, slope>20° {stats['slope_gt20_pct']:.1f} %, "
          f"rough median {stats['rough_median']:.3f} m ({time.time() - t0:.0f} s)", flush=True)
    m.setdefault("_stats", {})["terrain"] = stats
    return m


# ───────────────────────────── traverse ─────────────────────────────

def _dp(pts: np.ndarray, tol: float) -> np.ndarray:
    """Douglas–Peucker simplification (iterative)."""
    if len(pts) < 3:
        return pts
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        L = np.hypot(*ab)
        seg = pts[i + 1:j] - a
        d = np.abs(ab[0] * seg[:, 1] - ab[1] * seg[:, 0]) / L if L > 0 else np.hypot(seg[:, 0], seg[:, 1])
        k = int(np.argmax(d))
        if d[k] > tol:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return pts[keep]


def build_traverse(site: Site, pack: Path, m: dict, context_m: float = 3000.0) -> dict:
    trav = json.loads(cached_download(TRAVERSE_URL, "MSL_traverse.json", max_age_h=24).read_text())
    wps = json.loads(cached_download(WAYPOINTS_URL, "MSL_waypoints.json", max_age_h=24).read_text())
    x0, y0, x1, y1 = site.extent
    bx0, by0, bx1, by1 = x0 - context_m, y0 - context_m, x1 + context_m, y1 + context_m

    # Concatenate the drive segments into one ordered polyline, then keep runs inside the context box.
    pts = []
    for f in trav["features"]:
        g = f["geometry"]
        lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        for ln in lines:
            pts.extend((c[0], c[1]) for c in ln)
    ll = np.array(pts, dtype=np.float64)
    x, y = site.fwd(ll[:, 0], ll[:, 1])
    xy = np.stack([x, y], 1)
    inside = (x >= bx0) & (x <= bx1) & (y >= by0) & (y <= by1)
    lines = []
    i, n = 0, len(xy)
    while i < n:
        if not inside[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and inside[j + 1]:
            j += 1
        a, b = max(i - 1, 0), min(j + 1, n - 1)   # one point beyond the box on each side
        run = xy[a:b + 1]
        keep = np.r_[True, np.hypot(*np.diff(run, axis=0).T) > 0.01]
        run = _dp(run[keep], 0.25)
        if len(run) >= 2:
            lines.append([[round(float(px), 2), round(float(py), 2)] for px, py in run])
        i = j + 1
    n_pts = sum(len(l) for l in lines)
    m["traverse"] = {
        "label": "Curiosity (MSL) traverse",
        "lines": lines,
        "provenance": {
            "mission": "Mars Science Laboratory (Curiosity)",
            "instrument": "Rover localization (MSL operations team, MMGIS)",
            "product": "MSL_traverse.json",
            "url": TRAVERSE_URL,
            "license": "Public domain (NASA/JPL-Caltech)",
            "citation": "NASA/JPL-Caltech MSL mission traverse map (MMGIS layer MSL_traverse.json, waypoints MSL_waypoints.json); "
                        "rover positions localized on the HiRISE base map. Fetched " + time.strftime("%Y-%m-%d", time.gmtime()) + ".",
            "resolutionM": 1.0,
            "accuracy": f"Localized against the MSL HiRISE base map (~1 m relative). Clipped to the AOI ± {context_m / 1000:g} km "
                        "and simplified (Douglas–Peucker, 0.25 m).",
        },
    }

    # Waypoints (end-of-drive positions with sol) inside the context box — used for rover-image positions.
    wp_out = []
    for fe in wps["features"]:
        pr = fe["properties"]
        wx, wy = site.fwd(pr["lon"], pr["lat"])
        if bx0 <= wx <= bx1 and by0 <= wy <= by1:
            wp_out.append({"sol": int(pr["sol"]), "site": pr["site"], "drive": pr["drive"], "x": round(float(wx), 2),
                           "y": round(float(wy), 2), "elevM": pr["elev_geoid"], "lon": pr["lon"], "lat": pr["lat"],
                           "cell": site.xy_to_cell(float(wx), float(wy))})
    (pack / "traverse_waypoints.json").write_text(json.dumps({
        "source": WAYPOINTS_URL, "credit": "NASA/JPL-Caltech", "proj4": site.proj4,
        "note": "Curiosity end-of-drive waypoints within the AOI ± 3 km, projected to the site eqc. cell = -1 outside the engine grid.",
        "waypoints": wp_out}, indent=0) + "\n")
    extra = m.setdefault("_extraFiles", [])
    if "traverse_waypoints.json" not in extra:
        extra.append("traverse_waypoints.json")
    in_aoi = [w for w in wp_out if w["cell"] >= 0]
    print(f"  traverse: {len(lines)} line(s), {n_pts} pts; {len(wp_out)} waypoints in context box, {len(in_aoi)} in AOI "
          f"(sols {in_aoi[0]['sol'] if in_aoi else '-'}–{in_aoi[-1]['sol'] if in_aoi else '-'})", flush=True)
    return m
