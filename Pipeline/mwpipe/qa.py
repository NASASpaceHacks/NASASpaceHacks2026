"""QA: co-registration overlays + sanity statistics. Writes Pipeline/cache/qa_*.png and qa_report.json."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .common import CACHE_DIR, Site, read_raster


def hillshade(dem: np.ndarray, cell: float, az=315.0, alt=45.0) -> np.ndarray:
    p = np.pad(dem, 1, mode="edge")
    dzdx = (p[1:-1, 2:] - p[1:-1, :-2]) / (2 * cell)
    dzdy = (p[:-2, 1:-1] - p[2:, 1:-1]) / (2 * cell)      # north-positive
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, -dzdy)                      # direction of steepest descent, clockwise from north
    a, z = math.radians(az), math.radians(90 - alt)
    hs = np.cos(z) * np.cos(slope) + np.sin(z) * np.sin(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def phase_corr(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """Sub-pixel shift (dy, dx) that best aligns b onto a, plus peak strength."""
    a = (a - a.mean()) / (a.std() + 1e-9)
    b = (b - b.mean()) / (b.std() + 1e-9)
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    F = np.fft.fft2(a * win) * np.conj(np.fft.fft2(b * win))
    r = np.fft.ifft2(F / (np.abs(F) + 1e-9)).real
    iy, ix = np.unravel_index(np.argmax(r), r.shape)
    peak = r[iy, ix]

    def sub(i, n, axis):
        im, ip = (i - 1) % n, (i + 1) % n
        v = (r[im, ix], r[iy, ix], r[ip, ix]) if axis == 0 else (r[iy, im], r[iy, ix], r[iy, ip])
        d = v[0] - 2 * v[1] + v[2]
        return 0.5 * (v[0] - v[2]) / d if d != 0 else 0.0

    dy, dx = iy + sub(iy, r.shape[0], 0), ix + sub(ix, r.shape[1], 1)
    dy = dy - r.shape[0] if dy > r.shape[0] / 2 else dy
    dx = dx - r.shape[1] if dx > r.shape[1] / 2 else dx
    return float(dy), float(dx), float(peak)


def _draw_overlay(base, site: Site, m: dict, px_m: float, x0: float, y1: float, labels=True, wp=None):
    from PIL import ImageDraw, ImageFont

    img = base.convert("RGB")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", max(12, int(img.width / 110)))
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    P = lambda x, y: ((x - x0) / px_m, (y1 - y) / px_m)  # noqa: E731
    for k in m["keepouts"]:
        d.line([P(*p) for p in k["rings"][0]], fill=(255, 40, 40), width=3)
    if m.get("traverse"):
        for ln in m["traverse"]["lines"]:
            d.line([P(*p) for p in ln], fill=(255, 230, 0), width=2)
    if wp:
        for w in wp:
            u, v = P(w["x"], w["y"])
            d.ellipse([u - 2, v - 2, u + 2, v + 2], fill=(255, 140, 0))
    r = 7
    for s in m["stations"]:
        u, v = P(s["x"], s["y"])
        d.ellipse([u - r, v - r, u + r, v + r], outline=(255, 170, 0), width=3)
        if labels:
            d.text((u + r + 2, v - r), s["id"], fill=(255, 200, 80), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    for s in m["shelters"]:
        u, v = P(s["x"], s["y"])
        col = (0, 255, 255) if s["kind"] == "hab" else (80, 200, 255)
        d.rectangle([u - 9, v - 9, u + 9, v + 9], outline=col, width=4)
        if labels:
            d.text((u + 12, v + 4), s["id"], fill=col, font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    for l in m["landmarks"]:
        u, v = P(l["x"], l["y"])
        if 0 <= u < img.width and 0 <= v < img.height:
            d.polygon([(u, v - 9), (u - 8, v + 7), (u + 8, v + 7)], outline=(200, 120, 255), width=2)
            if labels:
                d.text((u + 10, v - 6), l["id"], fill=(220, 170, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    for im in m["images"]:
        u, v = P(im["x"], im["y"])
        d.rectangle([u - 3, v - 3, u + 3, v + 3], fill=(0, 255, 120))
    return img


def run_qa(site: Site, pack: Path, m: dict) -> dict:
    from PIL import Image

    H, W, cm = site.h, site.w, site.cell_m
    dem = read_raster(pack, m["rasters"]["dem"]).reshape(H, W)
    slope = read_raster(pack, m["rasters"]["slope"]).reshape(H, W)
    rough = read_raster(pack, m["rasters"]["rough"]).reshape(H, W)
    x0, y0, x1, y1 = site.extent
    rep: dict = {}
    hab = next(s for s in m["shelters"] if s["kind"] == "hab")
    hr, hc = divmod(hab["cell"], W)
    edges = [0, 5, 10, 15, 20, 25, 30, 40, 90]
    hist, _ = np.histogram(slope, bins=edges)
    rep["elevation_m"] = {"min": round(float(dem.min()), 1), "max": round(float(dem.max()), 1), "mean": round(float(dem.mean()), 1)}
    rep["slope_hist_pct"] = {f"{a}-{b}": round(float(h) / dem.size * 100, 2) for a, b, h in zip(edges, edges[1:], hist)}
    rep["slope_gt20_pct"] = round(float((slope > 20).mean() * 100), 2)
    rep["hab"] = {"cell": hab["cell"], "slopeDeg": round(float(slope[hr, hc]), 2),
                  "slope3x3MaxDeg": round(float(slope[hr - 1:hr + 2, hc - 1:hc + 2].max()), 2), "elevM": round(float(dem[hr, hc]), 1)}
    rep["rough_m"] = {"median": round(float(np.median(rough)), 3), "p95": round(float(np.percentile(rough, 95)), 3),
                      "max": round(float(rough.max()), 3)}
    for s in m["shelters"]:
        r, c = divmod(s["cell"], W)
        rep.setdefault("shelters", {})[s["id"]] = {"slopeDeg": round(float(slope[r, c]), 2),
                                                    "distHabM": round(math.hypot(s["x"] - hab["x"], s["y"] - hab["y"]))}
    for k in m["keepouts"]:
        cx = np.mean([p[0] for p in k["rings"][0][:-1]]); cy = np.mean([p[1] for p in k["rings"][0][:-1]])
        rep.setdefault("keepouts", {})[k["id"]] = {"distHabM": round(math.hypot(cx - hab["x"], cy - hab["y"]))}
    rep["stations"] = {s["id"]: {"slopeDeg": round(float(slope[divmod(s["cell"], W)]), 1),
                                 "distHabM": round(math.hypot(s["x"] - hab["x"], s["y"] - hab["y"]))} for s in m["stations"]}

    # Waypoint elevation agreement (DEM vs MSL localization) — a horizontal mis-registration shows up as scatter/bias.
    from scipy.ndimage import map_coordinates
    wpf = pack / "traverse_waypoints.json"
    wp = [w for w in json.loads(wpf.read_text())["waypoints"] if w["cell"] >= 0] if wpf.exists() else []
    if wp:
        rr, cc = site.xy_to_rc(np.array([w["x"] for w in wp]), np.array([w["y"] for w in wp]))
        z = map_coordinates(dem, [rr - 0.5, cc - 0.5], order=1)
        dz = z - np.array([w["elevM"] for w in wp])
        rep["dem_vs_waypoint_elev_m"] = {"n": len(wp), "median": round(float(np.median(dz)), 3), "std": round(float(dz.std()), 3),
                                         "p5": round(float(np.percentile(dz, 5)), 3), "p95": round(float(np.percentile(dz, 95)), 3)}

    # Ortho ↔ DEM co-registration: phase-correlate DEM hillshade (sun matched roughly to imagery) vs ortho luminance at 5 m.
    ortho_p = CACHE_DIR / "ortho_1m.jpg"
    if ortho_p.exists():
        o = np.asarray(Image.open(ortho_p).convert("L"), dtype=np.float64)
        o5 = o.reshape(H, 5, W, 5).mean(axis=(1, 3))
        best = None
        for az in (225, 247.5, 270, 292.5, 315):
            hs = hillshade(dem, cm, az=az, alt=40)
            shifts = []
            for (ra, ca) in ((100, 100), (100, 500), (500, 100), (500, 500), (300, 300)):
                sl = (slice(ra, ra + 400), slice(ca, ca + 400))
                shifts.append(phase_corr(o5[sl], hs[sl]))
            corr = float(np.corrcoef(o5.ravel(), hs.ravel())[0, 1])
            if best is None or abs(corr) > abs(best[0]):
                best = (corr, az, shifts)
        corr, az, shifts = best
        dys = np.array([s[0] for s in shifts]) * cm
        dxs = np.array([s[1] for s in shifts]) * cm
        rep["ortho_vs_dem_shift_m"] = {"hillshadeAzDeg": az, "corr": round(corr, 3),
                                       "dx_east_m": [round(float(v), 1) for v in -dxs], "dy_north_m": [round(float(v), 1) for v in dys],
                                       "median_dx_m": round(float(np.median(-dxs)), 2), "median_dy_m": round(float(np.median(dys)), 2),
                                       "peaks": [round(s[2], 3) for s in shifts]}

        # Overlays: full AOI at 2.5 m/px, plus a 1 m zoom around the station cluster.
        full = Image.open(ortho_p).resize((2000, 2000), Image.LANCZOS)
        _draw_overlay(full, site, m, 2.5, x0, y1, wp=wp).save(CACHE_DIR / "qa_overlay.png", optimize=True)
        sx = np.median([s["x"] for s in m["stations"]]) if m["stations"] else hab["x"]
        sy = np.median([s["y"] for s in m["stations"]]) if m["stations"] else hab["y"]
        zx0 = float(np.clip(sx - 600, x0, x1 - 1200)); zy1 = float(np.clip(sy + 600, y0 + 1200, y1))
        box = (int(zx0 - x0), int(y1 - zy1), int(zx0 - x0) + 1200, int(y1 - zy1) + 1200)
        zoom = Image.open(ortho_p).crop(box)
        _draw_overlay(zoom, site, m, 1.0, zx0, zy1, wp=wp).save(CACHE_DIR / "qa_zoom.png", optimize=True)
        hsimg = Image.fromarray((hillshade(dem, cm) * 255).astype(np.uint8)).resize((2000, 2000), Image.BILINEAR)
        _draw_overlay(hsimg, site, m, 2.5, x0, y1, wp=wp).save(CACHE_DIR / "qa_hillshade.png", optimize=True)
        rep["zoomBox_xy"] = [zx0, zy1 - 1200, zx0 + 1200, zy1]

    (CACHE_DIR / "qa_report.json").write_text(json.dumps(rep, indent=1) + "\n")
    print(json.dumps(rep, indent=1))
    return rep
