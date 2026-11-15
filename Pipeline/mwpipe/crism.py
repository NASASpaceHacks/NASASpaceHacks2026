"""MRO CRISM spectral summary parameters (MTRDR, ~18 m/px) onto the site grid.

    Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1 --steps crism

Product: frt000058a3_07_sr165j_mtr3 (FRT000058A3, MSL landing-site-f targeted observation, 2007-04-22), the
"SR" refined summary-parameter cube of the MTRDR (Viviano-Beck et al. 2014, JGR Planets 119, doi:10.1002/2014JE004627).
The precomputed parameters are used as shipped (nothing is recomputed from I/F). They indicate a spectral absorption
signature, not a mineral abundance.

Two parameters are stored: SINDEX2 (convexity at 2.29 µm: polyhydrated sulfate; Mg/Fe-sulfate) and BD1900_2 (1.9 µm H2O band
depth: hydration). BD values are band depths (positive = absorption); the SR cube is in the original MTRDR sign convention.
The module is additive: it only writes its own rasters and never touches the others.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .common import CACHE_DIR, Site, eqc_source_to_local, http_get, read_raster, write_raster

PRODUCT_ID = "frt000058a3_07_sr165j_mtr3"
BASE = ("https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/2007/2007_112/frt000058a3/")
IMG_URL = BASE + PRODUCT_ID + ".img"
LBL_URL = BASE + PRODUCT_ID + ".lbl"
# From the product's ENVI header (788 samples x 735 lines x 60 bands, BSQ, float32 LE; ignore value 65535).
SHAPE = (60, 735, 788)
PIXEL_M = 18.0
UL_X, UL_Y = 8139847.9, -277771.17        # upper-left corner of pixel (1,1); eqc, lat_ts 0, lon_0 0, R = 3396190 m
NODATA_ABOVE = 1e4
BANDS = ("R770 RBR BD530_2 SH600_2 SH770 BD640_2 BD860_2 BD920_2 RPEAK1 BDI1000VIS R440 IRR1 BDI1000IR OLINDEX3 R1330 BD1300 "
         "LCPINDEX2 HCPINDEX2 VAR ISLOPE1 BD1400 BD1435 BD1500_2 ICER1_2 BD1750_2 BD1900_2 BD1900R2 BDI2000 BD2100_2 BD2165 "
         "BD2190 MIN2200 BD2210_2 D2200 BD2230 BD2250 MIN2250 BD2265 BD2290 D2300 BD2355 SINDEX2 ICER2_2 MIN2295_2480 "
         "MIN2345_2537 BD2500_2 BD3000 BD3100 BD3200 BD3400_2 CINDEX2 BD2600 IRR2 IRR3 R530 R600 R1080 R1506 R2529 R3920").split()
assert len(BANDS) == SHAPE[0]

# Co-registration correction. The shipped MTRDR georeference is displaced against HiRISE: CRISM features sit ~205 m south and
# ~175 m east (~15 CRISM px) of the same features in the HiRISE ortho / DEM (measure_offset() below reproduces this; ortho and DEM
# hillshade agree). The cube is therefore moved by this rigid shift, (east, north) in metres, before resampling.
# Sub-region estimates scatter by about +-20 m around the rigid shift (residual rotation/scale), see measure_offset().
REG_SHIFT_M = (-175.0, +205.0)

# raster id -> (band, label, scale, nodata)
PARAMS = {
    "crism_sindex2": ("SINDEX2", "Polyhydrated sulfate signal (CRISM SINDEX2, 18 m)"),
    "crism_bd1900": ("BD1900_2", "Hydration signal (CRISM BD1900_2, 18 m)"),
}
SCALE = 2e-5          # i16: ±0.65 covers the parameter range with 2e-5 steps (the data are ~1e-3)
NODATA = -32768

PROV = {
    "mission": "Mars Reconnaissance Orbiter",
    "instrument": "CRISM (Compact Reconnaissance Imaging Spectrometer for Mars), targeted observation FRT000058A3",
    "product": PRODUCT_ID + ".img (MTRDR refined summary parameters, SR, 18 m/px)",
    "url": IMG_URL,
    "license": "Public domain (NASA PDS Geosciences Node)",
    "citation": "Murchie et al. (2007), JGR 112, E05S03, doi:10.1029/2006JE002682 (CRISM); Seelos et al. (2016) MTRDR; "
                "Viviano-Beck et al. (2014), JGR Planets 119, 1403-1431, doi:10.1002/2014JE004627 (summary parameters).",
    "resolutionM": PIXEL_M,
    "accuracy": "Spectral summary parameters indicate a spectral absorption signature, not a mineral abundance; the values are "
                "small and noisy over dust-free dark terrain, and strength is read relative to the AOI. Native 18 m/px, bilinearly "
                "resampled to 5 m (features smaller than ~36 m are not resolved). Observed 2007-04-22; surface unchanged at this scale."
                " Georeference: the shipped MTRDR footprint sits ~205 m south and ~175 m east of the same features in the HiRISE ortho; co-registered with a rigid shift measured against the HiRISE ortho and confirmed against the DEM hillshade (within ~35 m); residual <=10 m overall, <=30 m in sub-windows (some rotation remains).",
}


def _fetch_cube() -> np.memmap:
    p = CACHE_DIR / "dl" / (PRODUCT_ID + ".img")
    if not p.exists() or p.stat().st_size != int(np.prod(SHAPE)) * 4:
        p.parent.mkdir(parents=True, exist_ok=True)
        print(f"  crism: downloading {IMG_URL} (139 MB) ...", flush=True)
        r = http_get(IMG_URL, stream=True, timeout=600)
        with open(p, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return np.memmap(p, dtype="<f4", mode="r", shape=SHAPE)


def _band_on_site(cube, band: str, site: Site, shift_m=REG_SHIFT_M) -> np.ndarray:
    """One parameter band resampled (bilinear, nodata masked) onto the site grid -> float32 with NaN."""
    from affine import Affine
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    a = np.array(cube[BANDS.index(band)], dtype=np.float32)
    a[~np.isfinite(a) | (a >= NODATA_ABOVE) | (a <= -NODATA_ABOVE)] = np.nan
    crs = CRS.from_proj4(site.proj4)
    src_tr = eqc_source_to_local(site, Affine(PIXEL_M, 0, UL_X, 0, -PIXEL_M, UL_Y))
    src_tr = src_tr * Affine.identity()   # (copy)
    src_tr = Affine(src_tr.a, 0.0, src_tr.c + shift_m[0], 0.0, src_tr.e, src_tr.f + shift_m[1])
    ox, oy = site.origin
    out = np.full((site.h, site.w), np.nan, np.float32)
    reproject(a, out, src_transform=src_tr, src_crs=crs, src_nodata=np.nan,
              dst_transform=Affine(site.cell_m, 0, ox, 0, -site.cell_m, oy), dst_crs=crs, dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    return out


def band_on_site(site: Site, band: str, shift_m=REG_SHIFT_M) -> np.ndarray:
    """Public helper (used by QA): any SR band on the site grid."""
    return _band_on_site(_fetch_cube(), band, site, shift_m)


def _bandpass(a: np.ndarray, lo: float = 2.5, hi: float = 14.0) -> np.ndarray:
    from scipy import ndimage as ndi
    a = a.astype(np.float64).copy()
    a[~np.isfinite(a)] = np.nanmean(a)
    return ndi.gaussian_filter(a, lo) - ndi.gaussian_filter(a, hi)


def _xcorr(A, B, mask, maxs=60):
    n = A.shape[0]
    A = (A - A[mask].mean()) * mask
    B = (B - B[mask].mean()) * mask
    r = np.fft.ifft2(np.fft.fft2(A) * np.conj(np.fft.fft2(B))).real / np.sqrt((A ** 2).sum() * (B ** 2).sum())
    return max((r[dy % n, dx % n], dy, dx) for dy in range(-maxs, maxs + 1) for dx in range(-maxs, maxs + 1))


def measure_offset(site: Site, pack: Path, m: dict, shift_m=(0.0, 0.0)) -> dict:
    """Cross-correlate band-passed CRISM reflectance (R1080, R2529) with the HiRISE ortho luminance and DEM hillshade.

    Returns the displacement of CRISM features relative to the reference, in metres (east, south positive), for the whole AOI and
    for five sub-windows. With shift_m=REG_SHIFT_M the residual should be ~0.
    """
    from PIL import Image

    from .ortho import ortho_cache_path
    from .qa import hillshade
    cm = site.cell_m
    k = int(round(5 / cm))
    o = np.asarray(Image.open(ortho_cache_path(site)).convert("L"), dtype=np.float64)
    ref = {"ortho": o.reshape(site.h, 5, site.w, 5).mean(axis=(1, 3))}
    dem = read_raster(pack, m["rasters"]["dem"]).reshape(site.h, site.w)
    for az in (247, 270):
        ref[f"hillshade{az}"] = hillshade(dem, cm, az=az, alt=40)
    out: dict = {"cell_m": cm, "global": {}, "windows": []}
    for band in ("R1080", "R2529"):
        a = band_on_site(site, band, shift_m)
        mask = np.isfinite(a)
        mask[:, :100] = False
        mask[:60] = False
        mask[-60:] = False
        mask[:, -60:] = False
        A = _bandpass(a) * mask
        for name, r in ref.items():
            c, dy, dx = _xcorr(A, _bandpass(r) * mask, mask, maxs=60)
            out["global"][f"{band}/{name}"] = {"corr": round(float(c), 3), "east_m": dx * cm, "south_m": dy * cm}
        if band == "R1080":
            B = _bandpass(ref["ortho"])
            for r0, c0 in ((0, 100), (0, 500), (500, 100), (500, 500), (250, 300)):
                sl = (slice(r0, r0 + 500), slice(c0, min(c0 + 500, site.w)))
                n = 500
                pa, pb, pm = np.zeros((n, n)), np.zeros((n, n)), np.zeros((n, n), bool)
                h, w = A[sl].shape
                pa[:h, :w], pb[:h, :w], pm[:h, :w] = A[sl], B[sl], mask[sl]
                c, dy, dx = _xcorr(pa * pm, pb * pm, pm, maxs=60)
                out["windows"].append({"origin_rc": [r0, c0], "corr": round(float(c), 3), "east_m": dx * cm, "south_m": dy * cm})
    return out


def build_crism(site: Site, pack: Path, m: dict) -> dict:
    cube = _fetch_cube()
    for rid, (band, label) in PARAMS.items():
        out = _band_on_site(cube, band, site)
        cov = float(np.isfinite(out).mean())
        layer = {"id": rid, "label": label, "kind": "continuous", "file": rid.replace("crism_", "crism_") + ".bin",
                 "dtype": "i16", "bands": 1, "scale": SCALE, "offset": 0, "nodata": NODATA, "unit": "index",
                 "indicative": True, "provenance": [dict(PROV, accuracy=PROV["accuracy"] + f" AOI coverage {cov * 100:.1f} %.")]}
        write_raster(pack, layer, out)
        m["rasters"][rid] = layer
        v = out[np.isfinite(out)]
        print(f"  {rid}: coverage {cov * 100:.1f} %, P5/50/95 = {np.percentile(v, [5, 50, 95]).round(5)}", flush=True)
    return m


def station_values(site: Site, pack: Path, m: dict) -> list[dict]:
    """Per-station parameter values (3x3 mean of the 5 m grid ~ the 18 m CRISM pixel)."""
    out = []
    for rid in PARAMS:
        a = read_raster(pack, m["rasters"][rid])
        a = a.reshape(site.h, site.w)
        out.append((rid, a))
    rows = []
    for s in m["stations"]:
        r, c = site.xy_to_rc(s["x"], s["y"])
        r, c = int(r), int(c)
        row = {"id": s["id"]}
        for rid, a in out:
            w = a[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2]
            row[rid] = float(np.nanmean(w)) if np.isfinite(w).any() else None
        rows.append(row)
    return rows
