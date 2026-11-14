"""Shared helpers: site grid, Mars eqc projection maths, raster I/O, manifest I/O.

Projection conventions follow Shared/src/contracts/types.ts and grid.ts:
- local projection: +proj=eqc +lat_ts=<ts> +lat_0=0 +lon_0=<lon0> +R=3396190 (IAU Mars 2000 sphere)
- grid row 0 = NORTH edge; cell = row * w + col; origin = top-left CORNER.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MARS_R = 3_396_190.0  # IAU Mars 2000 sphere radius, m (Archinal et al. 2018, Celest Mech Dyn Astr 130:22)

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent
CACHE_DIR = PIPELINE_DIR / "cache"
SITEPACKS_DIR = REPO_DIR / "SitePacks"

# Make GDAL's /vsicurl/ polite and quick (no directory listings, retries, range merging).
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("CPL_VSIL_CURL_CHUNK_SIZE", "1048576")

USER_AGENT = "marswalk-sitepack-pipeline/1.0 (NASA Space Apps 2026)"


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    lon: float          # AOI centre, planetocentric °E
    lat: float          # AOI centre, °N
    lon0: float         # projection central meridian
    lat_ts: float       # projection true-scale latitude
    w: int = 1000
    h: int = 1000
    cell_m: float = 5.0

    @property
    def proj4(self) -> str:
        return (f"+proj=eqc +lat_ts={self.lat_ts:g} +lat_0=0 +lon_0={self.lon0:g} "
                f"+x_0=0 +y_0=0 +R=3396190 +units=m +no_defs")

    @property
    def kx(self) -> float:
        """x scale of the local eqc: metres per radian of longitude."""
        return MARS_R * math.cos(math.radians(self.lat_ts))

    def fwd(self, lon, lat):
        """Planetocentric lon/lat (deg) → local projected x, y (m). Matches eqcForward() in grid.ts."""
        lon = np.asarray(lon, dtype=np.float64)
        lat = np.asarray(lat, dtype=np.float64)
        return self.kx * np.radians(lon - self.lon0), MARS_R * np.radians(lat)

    def inv(self, x, y):
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        return self.lon0 + np.degrees(x / self.kx), np.degrees(y / MARS_R)

    @property
    def origin(self) -> tuple[float, float]:
        """Top-left corner, snapped to a multiple of the cell size so cell edges are round numbers."""
        xc, yc = self.fwd(self.lon, self.lat)
        ox = round((float(xc) - self.w * self.cell_m / 2) / self.cell_m) * self.cell_m
        oy = round((float(yc) + self.h * self.cell_m / 2) / self.cell_m) * self.cell_m
        return ox, oy

    @property
    def extent(self) -> tuple[float, float, float, float]:
        ox, oy = self.origin
        return ox, oy - self.h * self.cell_m, ox + self.w * self.cell_m, oy

    def grid_spec(self) -> dict:
        ox, oy = self.origin
        cx, cy = ox + self.w * self.cell_m / 2, oy - self.h * self.cell_m / 2
        clon, clat = self.inv(cx, cy)
        return {
            "w": self.w, "h": self.h, "cellM": self.cell_m, "proj4": self.proj4,
            "originX": ox, "originY": oy,
            "centerLonLat": [round(float(clon), 6), round(float(clat), 6)],
        }

    def xy_to_rc(self, x, y):
        """Projected metres → (row, col) float indices of the engine grid (cell centres at +0.5)."""
        ox, oy = self.origin
        return (oy - np.asarray(y)) / self.cell_m, (np.asarray(x) - ox) / self.cell_m

    def xy_to_cell(self, x: float, y: float) -> int:
        r, c = self.xy_to_rc(x, y)
        r, c = int(math.floor(r)), int(math.floor(c))
        if r < 0 or c < 0 or r >= self.h or c >= self.w:
            return -1
        return r * self.w + c

    def cell_to_xy(self, cell: int) -> tuple[float, float]:
        r, c = divmod(int(cell), self.w)
        ox, oy = self.origin
        return ox + (c + 0.5) * self.cell_m, oy - (r + 0.5) * self.cell_m


SITES = {
    # AOI + projection fixed in docs/AGENTS.md ("Fixed area of interest (gale-v1)").
    "gale-v1": Site(id="gale-v1", name="Gale Crater — Mount Sharp boxwork",
                    lon=137.388, lat=-4.805, lon0=137.39, lat_ts=-4.8),
}


def eqc_source_to_local(site: Site, src_transform, src_lon0: float = 0.0, src_lat_ts: float = 0.0):
    """Affine of a global equirectangular raster on the SAME sphere, re-expressed in the site's local eqc.

    Both projections are linear in lon/lat on the same sphere, so the mapping is exact and affine:
      lon = src_lon0 + x_src / (R cos ts_src)  ⇒  x_loc = (cos ts / cos ts_src) * x_src + R cos ts * (src_lon0 - lon0)
      y_loc = y_src  (both have lat_0 = 0)
    This avoids any PROJ datum/celestial-body ambiguity.
    """
    from affine import Affine
    a, b, c, d, e, f = src_transform.a, src_transform.b, src_transform.c, src_transform.d, src_transform.e, src_transform.f
    assert abs(b) < 1e-12 and abs(d) < 1e-12, "rotated source not supported"
    s = math.cos(math.radians(site.lat_ts)) / math.cos(math.radians(src_lat_ts))
    shift = site.kx * math.radians(src_lon0 - site.lon0)
    return Affine(a * s, 0.0, c * s + shift, 0.0, e, f)


def local_to_source_x(site: Site, x_loc, src_lon0: float = 0.0, src_lat_ts: float = 0.0):
    s = math.cos(math.radians(site.lat_ts)) / math.cos(math.radians(src_lat_ts))
    shift = site.kx * math.radians(src_lon0 - site.lon0)
    return (np.asarray(x_loc) - shift) / s


# ───────────────────────────── raster + manifest I/O ─────────────────────────────

def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


DTYPES = {"u8": "<u1", "u16": "<u2", "i16": "<i2", "f32": "<f4"}


def write_raster(pack_dir: Path, layer: dict, values: np.ndarray) -> None:
    """Encode physical values with the layer's scale/offset/dtype (inverse of decodeRaster in sitepack.ts)."""
    dt = np.dtype(DTYPES[layer["dtype"]])
    v = np.asarray(values, dtype=np.float64)
    nan = ~np.isfinite(v)
    if layer["dtype"] == "f32" and layer["scale"] == 1 and layer["offset"] == 0:
        raw = v.astype("<f4")
        if nan.any():
            raw[nan] = layer.get("nodata", np.nan)
    else:
        raw = np.round((v - layer["offset"]) / layer["scale"])
        if dt.kind in "iu":
            info = np.iinfo(dt)
            raw = np.clip(np.where(nan, 0, raw), info.min, info.max)
        if nan.any():
            raw[nan] = layer.get("nodata", 0)
        raw = raw.astype(dt)
    (pack_dir / layer["file"]).write_bytes(raw.tobytes(order="C"))


def read_raster(pack_dir: Path, layer: dict) -> np.ndarray:
    raw = np.fromfile(pack_dir / layer["file"], dtype=np.dtype(DTYPES[layer["dtype"]])).astype(np.float64)
    out = raw * layer["scale"] + layer["offset"]
    if "nodata" in layer:
        out[raw == layer["nodata"]] = np.nan
    return out


def load_manifest(pack_dir: Path) -> dict | None:
    p = pack_dir / "manifest.json"
    return json.loads(p.read_text()) if p.exists() else None


def write_manifest(pack_dir: Path, m: dict) -> None:
    """Recompute the sha256 map over every referenced file, then write manifest.json atomically."""
    files: dict[str, str] = {}
    refs = [l["file"] for l in m["rasters"].values()] + [i["file"] for i in m["imagery"]] + [i["file"] for i in m["images"]]
    refs += m.get("_extraFiles", [])
    for rel in refs:
        p = pack_dir / rel
        if p.exists():
            files[rel] = sha256_file(p)
        else:
            raise FileNotFoundError(f"manifest references missing file {rel}")
    m["files"] = dict(sorted(files.items()))
    out = {k: v for k, v in m.items() if not k.startswith("_")}
    tmp = pack_dir / "manifest.json.tmp"
    tmp.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(pack_dir / "manifest.json")


def http_get(url: str, *, timeout: float = 90, retries: int = 3, **kw):
    import time

    import requests
    headers = {"User-Agent": USER_AGENT, **kw.pop("headers", {})}
    last = None
    for i in range(retries):
        try:
            r = requests.get(url, timeout=timeout, headers=headers, **kw)
            if r.status_code == 429:
                time.sleep(5 * (i + 1))
                last = RuntimeError(f"429 rate limited: {url}")
                continue
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed after {retries} tries: {url}: {last}")


def cached_download(url: str, name: str, *, max_age_h: float | None = None) -> Path:
    import time
    p = CACHE_DIR / "dl" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists() and (max_age_h is None or (time.time() - p.stat().st_mtime) < max_age_h * 3600):
        return p
    r = http_get(url)
    p.write_bytes(r.content)
    return p


def ring(cx: float, cy: float, r: float, n: int = 64) -> list[list[float]]:
    pts = [[round(cx + r * math.cos(2 * math.pi * k / n), 2), round(cy + r * math.sin(2 * math.pi * k / n), 2)] for k in range(n)]
    return pts + [pts[0]]
