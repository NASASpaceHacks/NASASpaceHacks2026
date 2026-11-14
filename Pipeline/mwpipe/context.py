"""Stage 3 — thermal inertia, landmarks, Curiosity images, REMS weather, DONKI space weather."""
from __future__ import annotations

import io
import json
import math
import os
import time
from pathlib import Path

import numpy as np
from scipy import ndimage

from .common import CACHE_DIR, MARS_R, REPO_DIR, Site, eqc_source_to_local, http_get, read_raster, write_raster

THEMIS_URL = ("https://asc-astropedia.s3.us-west-2.amazonaws.com/Mars/Odyssey/THEMIS-Global-Thermal-Inertia-Mosaic/"
              "Quantitative-32-Bit/THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub")
MOLA_URL = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
RAW_API = "https://mars.nasa.gov/api/v1/raw_image_items/"
REMS_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json"
DONKI = "https://api.nasa.gov/DONKI"
DONKI_CCMC = "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get"
GAZETTEER = REPO_DIR / "Content" / "gazetteer.json"


# ───────────────────────────── thermal inertia ─────────────────────────────

def build_ti(site: Site, pack: Path, m: dict) -> dict:
    import rasterio
    from affine import Affine
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    from rasterio.windows import from_bounds

    cache = CACHE_DIR / f"themis_ti_window_{site.id}.tif"
    if not cache.exists():
        xc, yc = MARS_R * math.radians(site.lon), MARS_R * math.radians(site.lat)
        half = 4000.0
        with rasterio.open("/vsicurl/" + THEMIS_URL) as src:
            # ISIS SimpleCylindrical, CenterLongitude 0, x = R_eq·lon, y = R_eq·lat (planetocentric) — same form as the DEM source.
            win = from_bounds(xc - half, yc - half, xc + half, yc + half, src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=win)
            prof = dict(driver="GTiff", dtype="float32", width=arr.shape[1], height=arr.shape[0], count=1, crs=src.crs,
                        transform=src.window_transform(win), nodata=src.nodata)
        with rasterio.open(cache, "w", **prof) as dst:
            dst.write(arr, 1)
    crs = CRS.from_proj4(site.proj4)
    ox, oy = site.origin
    out = np.full((site.h, site.w), np.nan, np.float32)
    with rasterio.open(cache) as src:
        a = src.read(1).astype(np.float32)
        a[(a <= -1e30) | (a <= 0)] = np.nan
        reproject(a, out, src_transform=eqc_source_to_local(site, src.transform), src_crs=crs, src_nodata=np.nan,
                  dst_transform=Affine(site.cell_m, 0, ox, 0, -site.cell_m, oy), dst_crs=crs, dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
    n_nan = int(np.isnan(out).sum())
    layer = {
        "id": "ti", "label": "Thermal inertia (THEMIS, 100 m)", "kind": "continuous", "file": "ti.bin", "dtype": "u16", "bands": 1,
        "scale": 0.1, "offset": 0, "nodata": 65535, "unit": "J m⁻² K⁻¹ s⁻½", "indicative": True,
        "provenance": [{
            "mission": "2001 Mars Odyssey", "instrument": "THEMIS (Thermal Emission Imaging System), IR band 9 (12.57 µm)",
            "product": "THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub (quantitative global thermal-inertia mosaic, 32-bit)",
            "url": THEMIS_URL, "license": "Public domain (NASA / ASU / USGS Astrogeology)",
            "citation": "THEMIS quantitative thermal inertia global mosaic, 100 m/px (USGS Astrogeology). Method: Fergason, Christensen & "
                        "Kieffer (2006), JGR 111, E12004, doi:10.1029/2006JE002735; mosaicking: Edwards et al. (2011), JGR 116, "
                        "E10008, doi:10.1029/2010JE003755.",
            "resolutionM": 100.0,
            "accuracy": "Native 100 m/px, bilinearly interpolated to 5 m (does not resolve features smaller than ~100 m). Stated "
                        "thermal-inertia uncertainty ~±20 % (Fergason et al. 2006). Used only as an indicative terrain/sand proxy."
                        + (f" {n_nan} cells without data." if n_nan else ""),
        }],
    }
    write_raster(pack, layer, out)
    m["rasters"]["ti"] = layer
    v = out[np.isfinite(out)]
    print(f"  ti: {np.nanmin(out):.0f}…{np.nanmax(out):.0f} (median {np.median(v):.0f}) J m⁻² K⁻¹ s⁻½, {n_nan} nodata", flush=True)
    return m


# ───────────────────────────── landmarks ─────────────────────────────

def _mola_peak(lon: float, lat: float, search_deg: float = 0.45):
    """Highest MOLA 463 m sample within ±search_deg of (lon, lat). Returns (lon, lat, elev)."""
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open("/vsicurl/" + MOLA_URL) as src:
        # MOLA global mosaic: equirectangular, clon 0, Mars 2000 sphere (x = R·lon, y = R·lat), int16 m (areoid).
        k = MARS_R * math.pi / 180
        win = from_bounds((lon - search_deg) * k, (lat - search_deg) * k, (lon + search_deg) * k, (lat + search_deg) * k,
                          src.transform).round_offsets().round_lengths()
        a = src.read(1, window=win).astype(np.float64)
        if src.nodata is not None:
            a[a == src.nodata] = np.nan
        tr = src.window_transform(win)
        r, c = np.unravel_index(np.nanargmax(a), a.shape)
        x, y = tr * (c + 0.5, r + 0.5)
        return x / k, y / k, float(a[r, c])


def build_landmarks(site: Site, pack: Path, m: dict) -> dict:
    dem = read_raster(pack, m["rasters"]["dem"]).reshape(site.h, site.w)
    H, W, cm = site.h, site.w, site.cell_m
    out = [l for l in m["landmarks"] if l["id"] == "LZ1"]      # keep the scenario pad marker from siting

    # 1) Local prominences in the DEM: local maxima (r = 150 m) ranked by relief above the 10th-percentile
    #    elevation within 300 m. These are unnamed — labelled by bearing/elevation, informal.
    mx = ndimage.maximum_filter(dem, size=61, mode="nearest")
    peaks = np.argwhere((dem == mx))
    cand = []
    yy, xx = np.mgrid[-60:61, -60:61]
    disk = (xx ** 2 + yy ** 2) <= 60 ** 2
    for r, c in peaks:
        if r < 20 or c < 20 or r > H - 21 or c > W - 21:
            continue
        r0, r1, c0, c1 = max(r - 60, 0), min(r + 61, H), max(c - 60, 0), min(c + 61, W)
        sub = dem[r0:r1, c0:c1][disk[(r0 - r + 60):(r1 - r + 60), (c0 - c + 60):(c1 - c + 60)]]
        relief = float(dem[r, c] - np.percentile(sub, 10))
        cand.append((relief, int(r), int(c)))
    cand.sort(reverse=True)
    chosen = []
    for relief, r, c in cand:
        if relief < 25 or len(chosen) >= 6:
            break
        if all(math.hypot(r - r2, c - c2) * cm >= 700 for _, r2, c2 in chosen):
            chosen.append((relief, r, c))
    for i, (relief, r, c) in enumerate(chosen):
        x, y = site.cell_to_xy(r * W + c)
        out.append({"id": f"KNOB{i + 1}", "name": f"Knob {i + 1} (unnamed; {relief:.0f} m local relief)", "x": x, "y": y,
                    "elevM": round(float(dem[r, c]), 1), "informal": True})

    # 2) Named features from the Content gazetteer that fall inside the grid (orientation features only).
    if GAZETTEER.exists():
        skip = ("drill", "rover position", "float rock", "target")
        seen: list[tuple[float, float]] = []
        for f in json.loads(GAZETTEER.read_text()).get("features", []):
            if any(s in f.get("type", "") for s in skip):
                continue
            x, y = (float(v) for v in site.fwd(f["lon"], f["lat"]))
            cell = site.xy_to_cell(x, y)
            if cell < 0 or any(math.hypot(x - a, y - b) < 30 for a, b in seen):
                continue
            seen.append((x, y))
            r, c = divmod(cell, W)
            slug = "".join(ch for ch in f["name"].upper() if ch.isalnum())[:12]
            out.append({"id": f"GZ-{slug}", "name": f["name"], "x": round(x, 2), "y": round(y, 2),
                        "elevM": round(float(dem[r, c]), 1), "informal": bool(f.get("informal", True))})

    # 3) Far heading cue: Aeolis Mons (IAU name). Summit = highest MOLA sample within 0.45° of the gazetteer point
    #    (the maximum is stable from 0.3° to 0.45°; Gale's rim is > 1° away, so it cannot be picked up).
    try:
        lon, lat, z = _mola_peak(137.85, -5.08)
        x, y = (float(v) for v in site.fwd(lon, lat))
        out.append({"id": "AEOLIS-MONS", "name": "Aeolis Mons summit (Mount Sharp)", "x": round(x, 1), "y": round(y, 1),
                    "elevM": round(z, 0), "informal": False})
        print(f"  Aeolis Mons summit (MOLA max within 0.45° of 137.85E −5.08N): {lon:.3f}E {lat:.3f}N {z:.0f} m, "
              f"{math.hypot(x, y - site.fwd(site.lon, site.lat)[1]) / 1000:.1f} km from AOI centre", flush=True)
    except Exception as e:  # noqa: BLE001
        x, y = (float(v) for v in site.fwd(137.85, -5.08))
        print(f"  MOLA lookup failed ({e}); Aeolis Mons at the IAU centre point without MOLA elevation", flush=True)
        out.append({"id": "AEOLIS-MONS", "name": "Aeolis Mons (Mount Sharp), IAU centre point", "x": round(x, 1),
                    "y": round(y, 1), "elevM": 0.0, "informal": False})
    m["landmarks"] = out
    print(f"  landmarks: {len(out)} ({len(chosen)} DEM knobs)", flush=True)
    return m


# ───────────────────────────── Curiosity images ─────────────────────────────

def _stationary_sols(wps: list[dict]) -> list[tuple[dict, list[int]]]:
    """For each in-AOI waypoint, the sols strictly between its drive sol and the next drive: the rover did not move,
    so images from those sols were taken at this waypoint."""
    out = []
    for a, b in zip(wps, wps[1:] + [None]):
        hi = b["sol"] if b else a["sol"] + 4
        sols = list(range(a["sol"] + 1, hi))
        if sols:
            out.append((a, sols))
    return out


def _raw_items(sol: int, instrument: str) -> list[dict]:
    url = (f"{RAW_API}?order=sol%20desc&per_page=100&page=0&condition_1=msl:mission&condition_2={sol}:sol:eq"
           f"&condition_3={instrument}:instrument")
    p = CACHE_DIR / "dl" / "raw" / f"{sol}_{instrument}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(http_get(url, timeout=60).text)
        time.sleep(0.3)
    return json.loads(p.read_text()).get("items", [])


def _fetch_img(url: str):
    from PIL import Image
    p = CACHE_DIR / "dl" / "raw" / url.rsplit("/", 1)[-1]
    if not p.exists():
        p.write_bytes(http_get(url, timeout=60).content)
    return Image.open(p), p


def _demosaic_rggb(img):
    """Raw Mastcam JPEGs on the raw-image site are single-channel RGGB Bayer mosaics. Detect the Bayer signature and
    demosaic bilinearly. Output is raw colour: not white-balanced, not radiometrically calibrated. Returns None if not Bayer."""
    from PIL import Image
    a = np.asarray(img.convert("L"), dtype=np.float32)
    a = a[: a.shape[0] // 2 * 2, : a.shape[1] // 2 * 2]
    checker = float(np.abs(a[0::2, 0::2] - a[0::2, 1::2]).mean())
    smooth = float(np.abs(a[0::2, 0::2][:-1] - a[2::2, 0::2]).mean())
    r_m, b_m = a[0::2, 0::2].mean(), a[1::2, 1::2].mean()
    if checker < 1.5 * smooth or r_m < 1.05 * b_m:
        return None
    H, W = a.shape
    R = np.zeros_like(a); G = np.zeros_like(a); B = np.zeros_like(a)
    R[0::2, 0::2] = a[0::2, 0::2]; B[1::2, 1::2] = a[1::2, 1::2]
    G[0::2, 1::2] = a[0::2, 1::2]; G[1::2, 0::2] = a[1::2, 0::2]
    krb = np.array([[1, 2, 1], [2, 4, 2], [1, 2, 1]], np.float32) / 4
    kg = np.array([[0, 1, 0], [1, 4, 1], [0, 1, 0]], np.float32) / 4
    rgb = np.stack([ndimage.convolve(R, krb, mode="mirror"), ndimage.convolve(G, kg, mode="mirror"),
                    ndimage.convolve(B, krb, mode="mirror")], -1)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def _usable(img) -> bool:
    """Reject dark/calibration frames and featureless sky flats: needs mid-tone brightness and terrain texture
    (mean |gradient| on a 256 px thumbnail, centre crop; sky flats ≈ 1, terrain ≥ 10 on these sols)."""
    a = np.asarray(img.convert("L").resize((256, 256)), dtype=np.float32)[32:-32, 32:-32]
    grad = np.abs(np.diff(a, axis=0)).mean() + np.abs(np.diff(a, axis=1)).mean()
    return 30 < a.mean() < 230 and grad > 5.0


def _pick_image(stops: list[tuple[dict, list[int]]]):
    """First usable frame from the stationary sols of the given stops: colour Mastcam (full/large subframe), else Navcam."""
    for wp, sols in stops:
        for sol in sols[:4]:
            for inst in ("MAST_LEFT", "MAST_RIGHT", "NAV_LEFT_B", "NAV_RIGHT_B"):
                mast = inst.startswith("MAST")
                try:
                    items = [i for i in _raw_items(sol, inst)
                             if (i.get("extended") or {}).get("sample_type") in (("full", "subframe") if mast else ("full",))]
                except Exception as e:  # noqa: BLE001
                    print(f"  ! raw API sol {sol} {inst}: {e}")
                    continue
                items.sort(key=lambda i: i["extended"]["sample_type"] != "full")
                for it in items[:5]:
                    try:
                        img, _ = _fetch_img(it["https_url"])
                    except Exception:  # noqa: BLE001
                        continue
                    if min(img.size) < (900 if mast else 700):
                        continue
                    if mast:
                        img = _demosaic_rggb(img) if img.mode == "L" else img.convert("RGB")
                        if img is None:
                            continue
                    if _usable(img):
                        return it, img, sol, inst, wp
    return None


def build_images(site: Site, pack: Path, m: dict) -> dict:
    from PIL import Image  # noqa: F401
    from .siting import link_station_images

    wpf = pack / "traverse_waypoints.json"
    wps = [w for w in json.loads(wpf.read_text())["waypoints"] if w["cell"] >= 0]
    stat = _stationary_sols(wps)
    # Priority: the stop nearest each station (so the station card can show what the crew will see), then spread out.
    targets: list[tuple[list[tuple[dict, list[int]]], str | None]] = []
    used: set[int] = set()
    for s in m["stations"]:
        near = sorted((t for t in stat if math.hypot(t[0]["x"] - s["x"], t[0]["y"] - s["y"]) <= 60),
                      key=lambda t: math.hypot(t[0]["x"] - s["x"], t[0]["y"] - s["y"]))
        if near:
            used.update(id(t) for t in near)
            targets.append((near[:4], s["id"]))
    rest = [t for t in stat if id(t) not in used]
    for t in rest[:: max(1, len(rest) // 6)]:
        targets.append(([t], None))

    imgdir = pack / "images"
    imgdir.mkdir(exist_ok=True)
    images, seen_sols = [], set()
    for stops, st in targets:
        if len(images) >= 10:
            break
        if st and any(math.hypot(i["x"] - sx, i["y"] - sy) <= 60 for i in images
                      for sx, sy in [next((x["x"], x["y"]) for x in m["stations"] if x["id"] == st)]):
            continue                                   # an image already within 60 m of this station
        pick = _pick_image(stops)
        if not pick or pick[2] in seen_sols:
            continue
        it, img, sol, inst, wp = pick
        seen_sols.add(sol)
        img = img.convert("RGB") if inst.startswith("MAST") else img.convert("L")
        img.thumbnail((1280, 1280))
        iid = f"msl-{sol}-{it['imageid'][:24]}"
        fn = f"images/{iid}.jpg"
        img.save(pack / fn, "JPEG", quality=85, optimize=True, progressive=True)
        cam = {"MAST_LEFT": "Mastcam left (M-34)", "MAST_RIGHT": "Mastcam right (M-100)",
               "NAV_LEFT_B": "Navcam left (B)", "NAV_RIGHT_B": "Navcam right (B)"}[inst]
        images.append({
            "id": iid, "sol": sol, "camera": inst, "x": wp["x"], "y": wp["y"], "cell": wp["cell"], "file": fn,
            "credit": it.get("image_credit") or ("NASA/JPL-Caltech/MSSS" if inst.startswith("MAST") else "NASA/JPL-Caltech"),
            "sourceUrl": it["https_url"],
            "caption": f"Curiosity {cam}, sol {sol} ({it['date_taken'][:10]}), raw image taken from the rover's position after the "
                       f"sol {wp['sol']} drive (site {wp['site']}, drive {wp['drive']}); view direction not recorded here."
                       + (" Colour: raw Bayer frame demosaicked by the Marswalk pipeline (not white-balanced or calibrated)."
                          if inst.startswith("MAST") else "")
                       + (f" Nearest stop to station {st}." if st else ""),
        })
        print(f"  image sol {sol} {inst} {img.size} → {fn}" + (f" (station {st})" if st else ""), flush=True)
    keep = {i["file"] for i in images}
    for f in imgdir.glob("*.jpg"):
        if f"images/{f.name}" not in keep:
            f.unlink()
    m["images"] = images
    link_station_images(m)
    print(f"  images: {len(images)}", flush=True)
    return m


# ───────────────────────────── conditions ─────────────────────────────

def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _str(v):
    return None if v in (None, "", "--") else str(v)


def build_conditions(site: Site, pack: Path, m: dict) -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cond = {"fetchedUtc": now}
    try:
        d = http_get(REMS_URL, timeout=90).json()
        sols = sorted(d["soles"], key=lambda s: int(s["sol"]), reverse=True)[:30]
        cond["rems"] = [{
            "sol": int(s["sol"]), "terrestrialDate": s["terrestrial_date"], "ls": _num(s.get("ls")),
            "minAirC": _num(s.get("min_temp")), "maxAirC": _num(s.get("max_temp")),
            "minGroundC": _num(s.get("min_gts_temp")), "maxGroundC": _num(s.get("max_gts_temp")),
            "pressurePa": _num(s.get("pressure")), "opacity": _str(s.get("atmo_opacity")),
            "uvIndex": _str(s.get("local_uv_irradiance_index")), "sunrise": _str(s.get("sunrise")), "sunset": _str(s.get("sunset")),
        } for s in sols]
        print(f"  REMS: {len(cond['rems'])} sols ({cond['rems'][-1]['sol']}–{cond['rems'][0]['sol']})", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"  ! REMS failed: {e}")
        if m["conditions"].get("rems"):
            cond["rems"] = m["conditions"]["rems"]

    key = os.environ.get("NASA_API_KEY", "DEMO_KEY")

    def donki(path: str, q: str):
        """api.nasa.gov (key; DEMO_KEY is heavily rate-limited) → fallback: CCMC's keyless DONKI web service (same data)."""
        try:
            return http_get(f"{DONKI}/{path}?{q}&api_key={key}", timeout=60, retries=2).json() or []
        except Exception as e:  # noqa: BLE001
            print(f"  ! api.nasa.gov DONKI/{path}: {e}; trying CCMC", flush=True)
            return http_get(f"{DONKI_CCMC}/{path}?{q}", timeout=25, retries=1).json() or []

    end = time.gmtime()
    start = time.gmtime(time.time() - 60 * 86400)
    sd, ed = time.strftime("%Y-%m-%d", start), time.strftime("%Y-%m-%d", end)
    events = []
    try:
        enl = donki("WSAEnlilSimulations", f"startDate={sd}&endDate={ed}")
        for e in enl:
            mars = [i for i in (e.get("impactList") or []) if "mars" in (i.get("location") or "").lower()]
            if not mars:
                continue
            cmes = e.get("cmeInputs") or [{}]
            arr = mars[0].get("arrivalTime")
            speed = cmes[0].get("speed")
            events.append({"id": e.get("simulationID"), "kind": "CME_ENLIL",
                           "startUtc": cmes[0].get("cmeStartTime") or e.get("modelCompletionTime"),
                           **({"marsArrivalUtc": arr} if arr else {}),
                           "note": f"WSA-ENLIL+Cone run lists Mars impact{' (glancing blow)' if mars[0].get('isGlancingBlow') else ''}; "
                                   f"CME {cmes[0].get('associatedCMEID', '')} speed {speed} km/s, half-angle {cmes[0].get('halfAngle')}°.",
                           "sourceUrl": e.get("link") or f"{DONKI}/WSAEnlilSimulations"})
        print(f"  DONKI ENLIL: {len(enl)} runs in {sd}…{ed}, {len(events)} list Mars", flush=True)
        time.sleep(1.5)
        fl = donki("FLR", f"startDate={sd}&endDate={ed}")
        big = [f for f in fl if (f.get("classType") or "")[:1] == "X" or (f.get("classType") or "")[:2] >= "M5"]
        for f in big:
            events.append({"id": f.get("flrID"), "kind": "FLR", "startUtc": f.get("beginTime"),
                           "note": f"{f.get('classType')} flare from {f.get('sourceLocation') or 'unknown location'} (AR {f.get('activeRegionNum')}), "
                                   "observed from Earth orbit; relevance to Mars depends on heliolongitude.",
                           "sourceUrl": f.get("link") or f"{DONKI}/FLR"})
        print(f"  DONKI FLR: {len(fl)} flares, kept {len(big)} ≥M5", flush=True)
        time.sleep(1.5)
        sep = donki("SEP", f"startDate={sd}&endDate={ed}")
        for s in sep:
            inst = ", ".join(i.get("displayName", "") for i in (s.get("instruments") or []))
            events.append({"id": s.get("sepID"), "kind": "SEP", "startUtc": s.get("eventTime"),
                           "note": f"Solar energetic particle event detected by {inst or 'n/a'} (near Earth / STEREO, not at Mars).",
                           "sourceUrl": s.get("link") or f"{DONKI}/SEP"})
        print(f"  DONKI SEP: {len(sep)} events", flush=True)
        cond["spaceWeather"] = [e for e in events if e.get("id") and e.get("startUtc")]
    except Exception as e:  # noqa: BLE001
        print(f"  ! DONKI failed: {e}")
        if m["conditions"].get("spaceWeather"):
            cond["spaceWeather"] = m["conditions"]["spaceWeather"]
        elif events:
            cond["spaceWeather"] = events
    m["conditions"] = cond
    return m
