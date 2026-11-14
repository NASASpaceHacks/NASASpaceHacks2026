"""Stage 2 — HiRISE colour orthoimage cropped to the AOI (1 m WebP, optional 0.5 m COG)."""
from __future__ import annotations

import math
import time
from pathlib import Path

import numpy as np

from .common import CACHE_DIR, Site, eqc_source_to_local, local_to_source_x

ORTHO_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif"
ORTHO_PROV = {
    "mission": "Mars Reconnaissance Orbiter",
    "instrument": "HiRISE (colour strips fused to the MSL HiRISE RED orthomosaic)",
    "product": "MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif (HiRISE 78-quad colour basemap)",
    "url": ORTHO_URL,
    "license": "Public domain (USGS Astrogeology / NASA PDS Annex; HiRISE: NASA/JPL-Caltech/UArizona)",
    "citation": "Parker, T. J. & Calef, F. J. III, HiRISE 78-quad colour basemap of the MSL Gale operations area, "
                "fused to Calef & Parker (2016) MSL Gale Merged Orthophoto Mosaic (25 cm), USGS Astrogeology / PDS Annex. "
                "https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm",
    "resolutionM": 0.25,
    "accuracy": "Georectified to the MSL mission HiRISE orthomosaic with manual tie-points (the base map used for rover "
                "localization); colour is enhanced (sharpened, not radiometric).",
}
MAX_COG_BYTES = 50 * 1024 * 1024


def read_ortho(site: Site, res_m: float, margin_m: float = 8.0) -> np.ndarray:
    """Return (3, n, n) uint8 on the local grid at res_m covering exactly the engine-grid extent."""
    import rasterio
    from affine import Affine
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    from rasterio.windows import from_bounds

    x0, y0, x1, y1 = site.extent
    sx0, sx1 = local_to_source_x(site, [x0 - margin_m, x1 + margin_m])
    n = int(round((x1 - x0) / res_m))
    crs = CRS.from_proj4(site.proj4)
    with rasterio.open("/vsicurl/" + ORTHO_URL) as src:
        win = from_bounds(float(sx0), y0 - margin_m, float(sx1), y1 + margin_m, src.transform).round_offsets().round_lengths()
        dec = max(1, int(round(res_m / src.res[0])))          # read from the matching overview (×2 → 0.5 m, ×4 → 1 m)
        out_shape = (3, int(math.ceil(win.height / dec)), int(math.ceil(win.width / dec)))
        t0 = time.time()
        arr = src.read(window=win, out_shape=out_shape, resampling=Resampling.average)
        wt = src.window_transform(win)
        src_tr = Affine(wt.a * win.width / out_shape[2], 0, wt.c, 0, wt.e * win.height / out_shape[1], wt.f)
        print(f"  ortho: read {out_shape[2]}×{out_shape[1]} px at {res_m} m in {time.time() - t0:.0f} s", flush=True)
    loc_tr = eqc_source_to_local(site, src_tr)
    dst = np.zeros((3, n, n), np.uint8)
    reproject(arr, dst, src_transform=loc_tr, src_crs=crs, dst_transform=Affine(res_m, 0, x0, 0, -res_m, y1), dst_crs=crs,
              resampling=Resampling.bilinear)
    return dst


def build_ortho(site: Site, pack: Path, m: dict) -> dict:
    from PIL import Image

    x0, y0, x1, y1 = site.extent
    rgb = read_ortho(site, 1.0)
    black = float((rgb.max(axis=0) == 0).mean() * 100)
    img = Image.fromarray(np.moveaxis(rgb, 0, -1))
    (CACHE_DIR / "ortho_1m.png").unlink(missing_ok=True)
    img.save(CACHE_DIR / "ortho_1m.jpg", quality=92)        # cache for QA overlays
    q = 80
    while True:
        img.save(pack / "ortho.webp", "WEBP", quality=q, method=5)
        sz = (pack / "ortho.webp").stat().st_size
        if sz <= 25 * 1024 * 1024 or q <= 50:
            break
        q -= 10
    layers = [{"id": "ortho", "label": "HiRISE colour orthoimage (1 m)", "file": "ortho.webp", "format": "webp",
               "extent": [x0, y0, x1, y1], "resolutionM": 1.0,
               "provenance": [{**ORTHO_PROV, "accuracy": ORTHO_PROV["accuracy"] + f" Resampled to 1 m (WebP q{q})."}]}]
    print(f"  ortho.webp {sz / 1e6:.1f} MB (q{q}); black/no-data pixels {black:.2f} %", flush=True)
    del rgb, img

    # Optional 0.5 m COG (kept only if < 50 MB).
    try:
        import rasterio
        from affine import Affine
        from rasterio.crs import CRS
        rgb2 = read_ortho(site, 0.5)
        tmp = CACHE_DIR / "ortho_cog_tmp.tif"
        n = rgb2.shape[1]
        with rasterio.open(tmp, "w", driver="COG", width=n, height=n, count=3, dtype="uint8", crs=CRS.from_proj4(site.proj4),
                           transform=Affine(0.5, 0, x0, 0, -0.5, y1), compress="JPEG", quality=85, blocksize=512,
                           overview_resampling="average") as dst:
            dst.write(rgb2)
        del rgb2
        sz2 = tmp.stat().st_size
        if sz2 < MAX_COG_BYTES:
            tmp.replace(pack / "ortho_cog.tif")
            layers.append({"id": "ortho_hr", "label": "HiRISE colour orthoimage (0.5 m COG)", "file": "ortho_cog.tif", "format": "cog",
                           "extent": [x0, y0, x1, y1], "resolutionM": 0.5,
                           "provenance": [{**ORTHO_PROV, "accuracy": ORTHO_PROV["accuracy"] + " Resampled to 0.5 m, JPEG-compressed COG (q85, YCbCr)."}]})
            print(f"  ortho_cog.tif {sz2 / 1e6:.1f} MB (0.5 m)", flush=True)
        else:
            tmp.unlink()
            (pack / "ortho_cog.tif").unlink(missing_ok=True)
            print(f"  0.5 m COG would be {sz2 / 1e6:.1f} MB ≥ 50 MB — skipped", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"  0.5 m COG skipped: {e}", flush=True)
    m["imagery"] = layers + [i for i in m["imagery"] if i["id"] not in ("ortho", "ortho_hr")]
    return m
