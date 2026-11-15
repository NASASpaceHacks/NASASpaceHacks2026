"""Fetch real JPL Mars Trek (Viking MDIM 2.1) tiles -> global + regional context images for a site pack.

    Pipeline/.venv/bin/python Pipeline/mwpipe/context_imagery.py              # gale-v1 (default)
    Pipeline/.venv/bin/python Pipeline/mwpipe/context_imagery.py jezero-v1    # or: build_sitepack.py jezero-v1 --steps context
"""
import io, json, math, pathlib, requests
from PIL import Image
LAYER = "Mars_Viking_MDIM21_ClrMosaic_global_232m"
URL = "https://trek.nasa.gov/tiles/Mars/EQ/%s/1.0.0/default/default028mm/{z}/{row}/{col}.jpg" % LAYER
CREDIT = "NASA/USGS Viking MDIM 2.1 colour mosaic via JPL Mars Trek"
SITEPACKS = pathlib.Path(__file__).resolve().parents[2] / "SitePacks"
OUT = SITEPACKS / "gale-v1/context"
# Per-site regional box (lon0, lon1, lat0, lat1), regional file name and labels. gale-v1 values are the originals.
SITE_CTX = {
    "gale-v1": dict(regional_bbox=(136.0, 139.8, -7.4, -3.4), regional_file="gale_regional.jpg",
                    labels=[dict(name="Gale crater", lon=137.85, lat=-5.4), dict(name="Aeolis Mons (Mount Sharp)", lon=137.85, lat=-5.08)]),
}

def tile(z, r, c):
    resp = requests.get(URL.format(z=z, row=r, col=c), timeout=60); resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")

def stitch(z, c0, c1, r0, r1):
    im = Image.new("RGB", ((c1 - c0 + 1) * 256, (r1 - r0 + 1) * 256))
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            im.paste(tile(z, r, c), ((c - c0) * 256, (r - r0) * 256))
    return im

def _site_ctx(site_id):
    if site_id in SITE_CTX:
        return SITE_CTX[site_id]
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    from mwpipe.common import SITES
    return SITES[site_id].opt("context")


def run(site_id="gale-v1"):
    OUT = SITEPACKS / site_id / "context"
    cfg = _site_ctx(site_id)
    OUT.mkdir(parents=True, exist_ok=True)
    gz = 2  # 8x4 tiles -> 2048x1024
    stitch(gz, 0, 2 ** (gz + 1) - 1, 0, 2 ** gz - 1).save(OUT / "mars_global.jpg", quality=82)
    # regional
    z = 7; deg = 180 / (256 * 2 ** z)  # deg per px
    lon0, lon1, lat0, lat1 = cfg["regional_bbox"]
    px0, px1 = (lon0 + 180) / deg, (lon1 + 180) / deg
    py0, py1 = (90 - lat1) / deg, (90 - lat0) / deg
    im = stitch(z, int(px0 // 256), int((px1 - 1e-9) // 256), int(py0 // 256), int((py1 - 1e-9) // 256))
    ox, oy = int(px0 // 256) * 256, int(py0 // 256) * 256
    L, T, R_, B = round(px0) , round(py0), round(px1), round(py1)
    im.crop((L - ox, T - oy, R_ - ox, B - oy)).save(OUT / cfg["regional_file"], quality=82)
    reg = dict(lonMin=L * deg - 180, lonMax=R_ * deg - 180, latMax=90 - T * deg, latMin=90 - B * deg)
    m = json.load(open(OUT.parent / "manifest.json"))["grid"]
    proj = dict(kv.split("=") for kv in m["proj4"].split() if "=" in kv)
    R = float(proj["+R"]); ts = float(proj["+lat_ts"]); l0 = float(proj["+lon_0"])
    kx = R * math.cos(math.radians(ts))
    lon = lambda x: l0 + math.degrees(x / kx)
    lat = lambda y: math.degrees(y / R)
    x0, y0 = m["originX"], m["originY"]; x1, y1 = x0 + m["w"] * m["cellM"], y0 - m["h"] * m["cellM"]
    src = URL + " (z=%d regional, z=%d global)" % (z, gz)
    ctx = {"global": dict(file="mars_global.jpg", lonMin=-180, lonMax=180, latMin=-90, latMax=90, credit=CREDIT, source=src),
           "regional": dict(file=cfg["regional_file"], **reg, credit=CREDIT, source=src),
           "aoi": dict(lonMin=lon(x0), lonMax=lon(x1), latMin=lat(y1), latMax=lat(y0), label="Study area 5 × 5 km"),
           "labels": cfg["labels"]}
    json.dump(ctx, open(OUT / "context.json", "w"), indent=2, ensure_ascii=False)
    print(ctx)

if __name__ == "__main__":
    import sys
    run(sys.argv[1] if len(sys.argv) > 1 else "gale-v1")
