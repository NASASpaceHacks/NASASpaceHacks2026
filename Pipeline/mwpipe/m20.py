"""Perseverance (Mars 2020) specifics: raw images at each station's rover position, and the MEDA weather feed.

Raw images: mars.nasa.gov raw-image RSS API (category=mars2020). Every image carries the rover's site/drive (RMC);
an image whose site/drive equals a localized waypoint's was taken from that exact rover position, so its x/y is the
waypoint's. Mastcam-Z raw JPEGs are already colour (ZCAM_*_RGB filters).
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

from .common import CACHE_DIR, REPO_DIR, Site, http_get

RAW_RSS = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}"
MEDA_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json"
# Mastcam-Z sequence families that show rover hardware, not terrain (empirical, from the frames on these sols):
# ZCAM00xxx = calibration-target frames (e.g. ZCAM00064/65), ZCAM05xxx = sampling-system views (ZCAM05069/70 coring-bit and
# turret inspection after each core, ZCAM05133 bit carousel). Science imaging uses the ZCAM03xxx / ZCAM08xxx families.
SKIP_SEQ_PREFIXES = ("ZCAM00", "ZCAM05")
CAMS = {  # instrument → (label, default credit, priority)
    "MCZ_LEFT": ("Mastcam-Z left", "NASA/JPL-Caltech/ASU", 0),
    "MCZ_RIGHT": ("Mastcam-Z right", "NASA/JPL-Caltech/ASU", 1),
    "NAVCAM_LEFT": ("Navcam left", "NASA/JPL-Caltech", 2),
    "NAVCAM_RIGHT": ("Navcam right", "NASA/JPL-Caltech", 3),
}


def _raw_sol(sol: int) -> list[dict]:
    p = CACHE_DIR / "dl" / "raw_m20" / f"{sol}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(http_get(RAW_RSS.format(sol=sol), timeout=60).text)
        time.sleep(0.3)
    return json.loads(p.read_text()).get("images", [])


def _dims(it: dict) -> tuple[int, int]:
    try:
        w, h = (int(v) for v in it["extended"]["dimension"].strip("()").split(","))
        return w, h
    except Exception:  # noqa: BLE001
        return 0, 0


def _candidates(sols: list[int], site_no: int, drive: int) -> list[dict]:
    out = []
    for sol in sols:
        try:
            items = _raw_sol(sol)
        except Exception as e:  # noqa: BLE001
            print(f"  ! raw API sol {sol}: {e}")
            continue
        for it in items:
            inst = it.get("camera", {}).get("instrument", "")
            if inst not in CAMS or it.get("sample_type") != "Full":
                continue
            if int(it.get("site", -1)) != site_no or int(it.get("drive", -1)) != drive:
                continue
            seq = it.get("imageid", "")[35:44]          # e.g. ZCAM08839 / NCAM00500
            if seq.startswith(SKIP_SEQ_PREFIXES):
                continue
            w, h = _dims(it)
            mcz = inst.startswith("MCZ")
            if (mcz and (w < 1200 or "RGB" not in it["camera"].get("filter_name", ""))) or (not mcz and w < 1280) or h < 0.6 * w:
                continue                                  # (h < 0.6 w: panorama strips)
            try:
                el = float(it["extended"].get("mastEl", "nan"))
            except ValueError:
                el = float("nan")
            if not (-35.0 <= el <= 5.0):          # terrain/outcrop views; skip sky, deck and straight-down frames
                continue
            out.append(it)
    out.sort(key=lambda i: (CAMS[i["camera"]["instrument"]][2], abs(float(i["extended"]["mastEl"]) + 12.0)))
    return out


def _fetch(it: dict):
    from PIL import Image
    url = it["image_files"].get("large") or it["image_files"]["full_res"]
    p = CACHE_DIR / "dl" / "raw_m20" / url.rsplit("/", 1)[-1]
    if not p.exists():
        p.write_bytes(http_get(url, timeout=60).content)
    return Image.open(p), url


def build_images(site: Site, pack: Path, m: dict, max_images: int = 10) -> dict:
    from .context import _usable
    from .siting import link_station_images, stations_json

    allw = json.loads((pack / "traverse_waypoints.json").read_text())["waypoints"]
    allw.sort(key=lambda w: (w["sol"], w["site"], w["drive"]))
    sols = {s["id"]: s.get("sol") for s in json.loads(stations_json(site).read_text())}

    def stop_for(sol: int):
        prev = [w for w in allw if w["sol"] <= sol]
        if not prev:
            return None, []
        wp = prev[-1]
        nxt = [w["sol"] for w in allw if w["sol"] > wp["sol"]]
        hi = min(nxt[0] if nxt else sol + 4, sol + 6)
        return wp, list(range(sol, hi + 1))

    targets = []
    for s in sorted(m["stations"], key=lambda s: -s["value"]):
        if sols.get(s["id"]) is not None:
            wp, ss = stop_for(int(sols[s["id"]]))
            if wp and math.hypot(wp["x"] - s["x"], wp["y"] - s["y"]) <= 60:
                targets.append((wp, ss, s["id"]))
    # Fill with evenly spread in-AOI stops (sols between drives) so the console has context views too.
    inaoi = [w for w in allw if w["cell"] >= 0]
    for w in inaoi[:: max(1, len(inaoi) // 8)]:
        nxt = [x["sol"] for x in allw if x["sol"] > w["sol"]]
        targets.append((w, list(range(w["sol"], min(nxt[0] if nxt else w["sol"] + 3, w["sol"] + 4) + 1)), None))

    imgdir = pack / "images"
    imgdir.mkdir(exist_ok=True)
    images: list[dict] = []
    for wp, ss, st in targets:
        if len(images) >= max_images:
            break
        if any(math.hypot(i["x"] - wp["x"], i["y"] - wp["y"]) <= 60 for i in images):
            continue
        pick = None
        for it in _candidates(ss, wp["site"], wp["drive"])[:10]:
            try:
                img, url = _fetch(it)
            except Exception:  # noqa: BLE001
                continue
            rgb = img.convert("RGB")
            if it["camera"]["instrument"].startswith("MCZ"):
                import numpy as np
                a = np.asarray(rgb.resize((200, 150)), dtype=np.float32)
                if float((a[..., 0] - a[..., 2]).mean()) < 8.0:     # near-grey frame (narrow-band or unbalanced)
                    continue
            if _usable(rgb):
                pick = (it, rgb, url)
                break
        if not pick:
            continue
        it, img, url = pick
        inst = it["camera"]["instrument"]
        label, credit, _ = CAMS[inst]
        img.thumbnail((1280, 1280))
        sol = int(it["sol"])
        iid = f"m20-{sol}-{it['imageid'][:28]}"
        fn = f"images/{iid}.jpg"
        img.save(pack / fn, "JPEG", quality=85, optimize=True, progressive=True)
        ext = it.get("extended", {})
        images.append({
            "id": iid, "sol": sol, "camera": inst, "x": wp["x"], "y": wp["y"], "cell": wp["cell"], "file": fn,
            "credit": it.get("credit") or credit, "sourceUrl": url,
            "caption": f"Perseverance {label}, sol {sol} ({it.get('date_taken_utc', '')[:10]}), raw image taken at rover position "
                       f"site {wp['site']}, drive {wp['drive']} (localized waypoint of sol {wp['sol']}); mast azimuth "
                       f"{float(ext.get('mastAz', 'nan')):.0f}°, elevation {float(ext.get('mastEl', 'nan')):.0f}° as reported by the "
                       "raw-image feed (frame not stated). Raw, not calibrated." + (f" Rover stop at station {st}." if st else ""),
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


def fetch_meda() -> list[dict]:
    """MEDA outreach feed (mars.nasa.gov). It stopped updating in April 2024 (last sol 1133) and holds only a few
    sols; keep the sols that carry measurements, each labelled with its terrestrial date."""
    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    d = http_get(MEDA_URL, timeout=60).json()
    out = []
    for s in sorted(d.get("sols", []), key=lambda s: int(s["sol"]), reverse=True)[:30]:
        if num(s.get("ls")) is None or (num(s.get("min_temp")) is None and num(s.get("max_temp")) is None
                                        and num(s.get("pressure")) is None):
            continue
        out.append({"sol": int(s["sol"]), "terrestrialDate": s["terrestrial_date"], "ls": num(s.get("ls")),
                    "minAirC": num(s.get("min_temp")), "maxAirC": num(s.get("max_temp")), "minGroundC": None, "maxGroundC": None,
                    "pressurePa": num(s.get("pressure")), "opacity": None, "uvIndex": None,
                    "sunrise": (s.get("sunrise") or None) and s["sunrise"][:5], "sunset": (s.get("sunset") or None) and s["sunset"][:5]})
    return out


__all__ = ["build_images", "fetch_meda", "REPO_DIR"]
