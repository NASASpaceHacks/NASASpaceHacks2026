"""Bake real NASA layers for one ~1 km EVA area into offline assets for the Frontend.

Run from Research:  python scripts/export_frontend_data.py [--out ../Frontend/public/data]

Every layer is real mission data or a documented derivation of it. Remote reads are
cached under data/frontend_cache (gitignored); delete the cache to re-acquire.
"""
import argparse
import hashlib
import io
import json
import math
import re
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import Window

R_MARS = 3_396_190.0  # sphere radius of the selected HiRISE products
HIRISE = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/'
DTM = 'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif'
ORTHO = 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif'
THEMIS = ('https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/'
          'default/default028mm/9/{row}/{col}.png')
M20_WAYPOINTS = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json'
M20_TRAVERSE = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json'
M20_RAW = 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}'
ODE_CRISM = ('https://oderest.rsl.wustl.edu/live2/?query=product&target=mars&ihid=mro&iid=crism&pt=TRDR'
             '&westernlon={w}&easternlon={e}&minlat={s}&maxlat={n}&results=fmp&limit=40&output=json')

# 1024 m square in projected metres; contains the Research 256 m crop and the Perseverance landing site.
X0, Y0, N = 4590313, 1093834, 1024
ROUTE_CELL = 2  # metres per routing cell shipped to the browser
try:  # some Python installs ship without a CA bundle; verification always stays on
    import certifi
    TLS = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    TLS = ssl.create_default_context()
GDAL_ENV = dict(GDAL_HTTP_MULTIRANGE='YES', GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES',
                CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_MAX_RETRY='3')


def fetch(url, cache, name):
    path = cache / name
    if not path.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'NASASpaceHacks2026-research'})
        with urllib.request.urlopen(req, timeout=60, context=TLS) as r:
            path.write_bytes(r.read())
    return path.read_bytes()


def read_window(name, cache, scale, out_n, resampling):
    path = cache / (Path(name).stem + f'_{X0}_{Y0}_{N}_{out_n}.npy')
    if not path.exists():
        with rasterio.Env(**GDAL_ENV), rasterio.open('/vsicurl/' + HIRISE + name) as src:
            col = round((X0 - src.transform.c) / scale)
            row = round((src.transform.f - Y0) / scale)
            size = round(N / scale)
            data = src.read(1, window=Window(col, row, size, size), out_shape=(out_n, out_n), resampling=resampling)
            np.save(path, data)
    return np.load(path)


def lonlat(x, y):
    return math.degrees(x / R_MARS), math.degrees(y / R_MARS)


def box_mean(a, k):
    pad = k // 2
    p = np.pad(np.asarray(a, dtype=np.float64), pad, mode='edge')
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def block(a, f, how):
    n = a.shape[0] // f
    v = a[:n * f, :n * f].reshape(n, f, n, f)
    return getattr(v, how)(axis=(1, 3))


def terrain_layers(z, lat_deg):
    dx = math.cos(math.radians(lat_deg))  # ground metres per projected metre east-west
    gy, gx = np.gradient(z.astype(np.float64), 1.0, dx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    # Roughness: std of the residual after removing a 5 m local mean (detrended, metres).
    zc = z.astype(np.float64) - float(z.mean())  # de-mean so cumulative sums keep precision
    resid = zc - box_mean(zc, 5)
    rough = np.sqrt(np.maximum(box_mean(resid ** 2, 5), 0))
    az, alt = math.radians(315), math.radians(35)
    aspect = np.arctan2(-gx, gy)
    sl = np.arctan(np.hypot(gx, gy))
    shade = np.sin(alt) * np.cos(sl) + np.cos(alt) * np.sin(sl) * np.cos(az - aspect)
    return slope, rough, np.clip(shade, 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='../Frontend/public/data')
    ap.add_argument('--cache', default='data/frontend_cache')
    args = ap.parse_args()
    out, cache = Path(args.out), Path(args.cache)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'pov').mkdir(exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    lon_w, lat_n = lonlat(X0, Y0)
    lon_e, lat_s = lonlat(X0 + N, Y0 - N)
    lat_c = (lat_n + lat_s) / 2

    # --- MRO HiRISE stereo DTM (1 m) and orthomosaic (25 cm -> 50 cm)
    z = read_window(DTM, cache, 1.0, N, Resampling.nearest).astype(np.float32)
    if (z < -1e30).any():
        raise SystemExit('NoData inside export window; choose another area')
    ortho = read_window(ORTHO, cache, 0.25, N * 2, Resampling.average)
    slope, rough, shade = terrain_layers(z, lat_c)

    f = ROUTE_CELL
    g_elev = block(z, f, 'mean').astype(np.float32)
    g_slope = block(slope, f, 'max')
    g_rough = block(rough, f, 'max')
    g = g_elev.shape[0]
    with open(out / 'terrain.bin', 'wb') as fh:
        fh.write(g_elev.tobytes())
        fh.write(np.clip(np.round(g_slope * 4), 0, 255).astype(np.uint8).tobytes())    # 0.25 deg steps
        fh.write(np.clip(np.round(g_rough * 100), 0, 255).astype(np.uint8).tobytes())  # centimetres

    Image.fromarray(ortho.astype(np.uint8), 'L').save(out / 'optical.jpg', quality=82)
    Image.fromarray((shade * 255).astype(np.uint8), 'L').save(out / 'hillshade.png')

    # --- Mars Odyssey THEMIS night IR (Trek WMTS level 9, ~81 m/px rendered brightness)
    deg_px = 0.3515625 / 256
    col, row = int((lon_w + 180) / 0.3515625), int((90 - lat_n) / 0.3515625)
    tile = np.asarray(Image.open(io.BytesIO(fetch(THEMIS.format(row=row, col=col), cache, f'themis_{row}_{col}.png'))).convert('L'),
                      dtype=np.float32)
    tlon0, tlat0 = -180 + col * 0.3515625, 90 - row * 0.3515625
    px = lambda lon: (lon - tlon0) / deg_px
    py = lambda lat: (tlat0 - lat) / deg_px
    if px(lon_e) > 256 or py(lat_s) > 256:
        raise SystemExit('Export window crosses THEMIS tile edge; extend tile mosaic')
    th = Image.fromarray(tile.astype(np.uint8), 'L').crop((px(lon_w), py(lat_n), px(lon_e), py(lat_s)))
    th.resize((256, 256), Image.BICUBIC).save(out / 'thermal.png')
    Image.fromarray(tile.astype(np.uint8), 'L').save(out / 'thermal_regional.png')

    # --- MRO CRISM targeted-observation footprints from PDS ODE REST
    ode = json.loads(fetch(ODE_CRISM.format(w=lon_w, e=lon_e, s=lat_s, n=lat_n), cache, 'ode_crism.json'))
    crism = []
    for p in ode['ODEResults'].get('Products', {}).get('Product', []):
        wkt = p.get('Footprint_C0_geometry') or p.get('Footprint_geometry') or ''
        rings = [[[float(a), float(b)] for a, b in re.findall(r'(-?[\d.]+) (-?[\d.]+)', part)]
                 for part in re.findall(r'\(\(([^()]+)\)\)', wkt)]
        if rings:
            crism.append({'id': p['pdsid'], 'time': p.get('UTC_start_time') or p.get('Observation_time'),
                          'rings': rings, 'label': next((x['URL'] for x in p['Product_files']['Product_file']
                                                        if x['URL'].endswith('.xml')), None)})

    # --- Mars 2020 Perseverance localized waypoints, traverse and POV images
    inside = lambda lo, la: lon_w <= lo <= lon_e and lat_s <= la <= lat_n
    wps = json.loads(fetch(M20_WAYPOINTS, cache, 'm20_waypoints.json'))['features']
    trav = json.loads(fetch(M20_TRAVERSE, cache, 'm20_traverse.json'))['features']
    stops = [f['properties'] for f in wps if inside(f['properties']['lon'], f['properties']['lat'])]
    lines = [{'sol': f['properties']['sol'], 'coords': f['geometry']['coordinates']} for f in trav
             if any(inside(c[0], c[1]) for c in f['geometry']['coordinates'])]
    rover = []
    for s in stops:
        site, drive = (int(v) for v in s['RMC'].split('_'))
        tag = f'N{site:03d}{drive:04d}'
        pov = None
        try:
            imgs = json.loads(fetch(M20_RAW.format(sol=s['sol']), cache, f'raw_{s["sol"]}.json'))['images']
            pick = [i for i in imgs if tag in i['image_files'].get('small', '')
                    and i['camera']['instrument'] in ('NAVCAM_LEFT', 'MCZ_LEFT', 'FRONT_HAZCAM_LEFT_A')]
            def el(i):
                try:
                    return float(i.get('extended', {}).get('mastEl', 'nan'))
                except ValueError:
                    return float('nan')
            # Prefer a terrain view near the horizon (mast elevation -25..5 deg), not sky or calibration frames.
            pick.sort(key=lambda i: (not -25 <= el(i) <= 5, 'NAVCAM' not in i['camera']['instrument'], i['imageid']))
            if pick:
                name = f'sol{s["sol"]}_{s["RMC"]}.jpg'
                (out / 'pov' / name).write_bytes(fetch(pick[0]['image_files']['small'], cache, 'pov_' + name))
                pov = {'file': 'pov/' + name, 'camera': pick[0]['camera']['instrument'],
                       'source': pick[0]['image_files']['small'], 'imageid': pick[0]['imageid']}
        except Exception as exc:  # POV is optional context; record and continue.
            print('POV unavailable for sol', s['sol'], exc)
        rover.append({'sol': s['sol'], 'rmc': s['RMC'], 'lon': s['lon'], 'lat': s['lat'],
                      'elev_geoid': s['elev_geoid'], 'note': s.get('Note'), 'yaw': s.get('yaw'), 'pov': pov})

    # Co-registration check: rover-reported geoid elevation vs DTM at the same point.
    def cell(lo, la):
        x, y = R_MARS * math.radians(lo), R_MARS * math.radians(la)
        return int(Y0 - y), int(x - X0)
    deltas = [float(z[cell(r['lon'], r['lat'])] - r['elev_geoid']) for r in rover]

    meta = {
        'schema': 'eva-area-v1',
        'generated_utc': datetime.now(timezone.utc).isoformat(),
        'body': 'Mars', 'site': 'Jezero crater floor, Octavia E. Butler landing area',
        'coordinate_convention': 'east longitude, planetocentric latitude (deg); Mars 2000 sphere R=3396190 m',
        'bounds': {'west': lon_w, 'east': lon_e, 'south': lat_s, 'north': lat_n},
        'projected_origin_m': [X0, Y0], 'size_m': N, 'ground_dx_factor': math.cos(math.radians(lat_c)),
        'grid': {'n': g, 'cell_m': f, 'order': 'row-major, north row first',
                 'layers': ['elevation float32 m', 'slope uint8 deg*4 (max of 1 m cells)', 'roughness uint8 cm (max)']},
        'images': {'optical': {'file': 'optical.jpg', 'px_m': 0.5}, 'hillshade': {'file': 'hillshade.png', 'px_m': 1},
                   'thermal': {'file': 'thermal.png', 'native_px_m': round(deg_px * math.pi / 180 * R_MARS, 1)},
                   'thermal_regional': {'file': 'thermal_regional.png',
                                        'bounds': {'west': tlon0, 'east': tlon0 + 0.3515625,
                                                   'south': tlat0 - 0.3515625, 'north': tlat0}}},
        'elevation_range_m': [float(z.min()), float(z.max())],
        'rover_dtm_minus_geoid_m': {'median': float(np.median(deltas)), 'max_abs': float(np.max(np.abs(deltas)))},
        'sources': [
            {'layer': 'optical', 'evidence': 'M', 'mission': 'MRO HiRISE', 'product': ORTHO, 'url': HIRISE + ORTHO,
             'note': '25 cm orthomosaic averaged to 50 cm. Shows boulders/dunes for human hazard review.'},
            {'layer': 'topographic', 'evidence': 'M', 'mission': 'MRO HiRISE stereo', 'product': DTM, 'url': HIRISE + DTM,
             'doi': '10.5066/P9REJ9JN', 'note': '1 m posting; does not resolve boot-scale obstacles.'},
            {'layer': 'slope / roughness', 'evidence': 'D', 'mission': 'derived from HiRISE DTM',
             'note': 'Slope = gradient at 1 m, latitude-corrected. Roughness = std of 5 m-detrended residual.'},
            {'layer': 'thermal', 'evidence': 'M', 'mission': 'Mars Odyssey THEMIS', 'url': THEMIS.format(row=row, col=col),
             'note': 'Night IR controlled mosaic via Mars Trek WMTS. Rendered brightness, not calibrated temperature. '
                     'Brighter at night = higher thermal inertia (rock/indurated). ~100 m native; only ~12 px span this area.'},
            {'layer': 'spectral', 'evidence': 'M', 'mission': 'MRO CRISM', 'url': ODE_CRISM.split('?')[0],
             'note': 'Targeted observation footprints (TRDR) from PDS ODE. Footprints show where mineral spectra exist; '
                     'spectral cubes are not processed in the MVP.'},
            {'layer': 'rover', 'evidence': 'M', 'mission': 'Mars 2020 Perseverance', 'url': M20_WAYPOINTS,
             'note': 'Localized end-of-drive positions and traverse; terrain driven by the rover is known-traversable '
                     'for a rover, not certified for a suited human.'},
        ],
    }
    (out / 'meta.json').write_text(json.dumps(meta, indent=1))
    (out / 'rover.json').write_text(json.dumps({'stops': rover, 'traverse': lines}))
    (out / 'crism.json').write_text(json.dumps(crism))
    digest = hashlib.sha256((out / 'terrain.bin').read_bytes()).hexdigest()
    print(f'grid {g}x{g} @ {f} m, elev {z.min():.1f}..{z.max():.1f} m, slope max {slope.max():.1f} deg')
    print(f'rover stops {len(rover)} (POV {sum(1 for r in rover if r["pov"])}), traverse segs {len(lines)}, CRISM {len(crism)}')
    print(f'rover DTM-geoid delta median {np.median(deltas):.2f} m; terrain.bin sha256 {digest[:16]}')


if __name__ == '__main__':
    main()
