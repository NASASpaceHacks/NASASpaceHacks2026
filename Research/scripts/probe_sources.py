"""Bounded, read-only HTTP probes; no credentials and no full raster downloads."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request

BASE = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/'
PRODUCT = 'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40'
SOURCES = {
    'hirise_dem_range': BASE + PRODUCT + '.tif',
    'hirise_label': BASE + PRODUCT + '.xml',
    'hirise_pds3_label': BASE + PRODUCT + '_pds3.lbl',
    'trek_docs': 'https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars',
    'trek_wmts': 'https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml',
    'ode_rest': 'https://oderest.rsl.wustl.edu/live2/?query=product&target=mars&ihid=mro&iid=hirise&pt=dtm&results=cm&limit=1&output=json',
    'pds_rest': 'https://pds.nasa.gov/api/search/1/products?limit=1',
    'usgs_stac': 'https://stac.astrogeology.usgs.gov/api/',
    'usgs_stac_collections': 'https://stac.astrogeology.usgs.gov/api/collections',
    'mola': 'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html',
    'hrsc': 'https://hrscteam.dlr.de/public/data/regionaldtms.php',
    'mcd': 'https://www-mars.lmd.jussieu.fr/mars/access',
    'meda': 'https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/',
    'ctx_dem_head': 'https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif',
}


def probe(item):
    name, url = item
    headers = {'User-Agent': 'MarsTerrainResearch/0.1'}
    if name.endswith('_range'):
        headers['Range'] = 'bytes=0-4095'
    method = 'HEAD' if name.endswith('_head') else 'GET'
    result = dict(name=name, url=url, method=method, request_headers=headers,
                  checked_utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers, method=method), timeout=25) as response:
            body = response.read(131072) if method != 'HEAD' else b''
            result.update(status=response.status, final_url=response.url, headers=dict(response.headers),
                          bytes_read=len(body), sample_sha256=hashlib.sha256(body).hexdigest())
            if not name.endswith(('_range', '_head')):
                result['text_sample'] = body.decode('utf-8', errors='replace')[:1500]
            if name.startswith('hirise_') and 'label' in name:
                Path('docs/research/evidence', name + '.txt').write_bytes(body)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        result['error'] = str(exc)
        if isinstance(exc, urllib.error.HTTPError):
            result['status'] = exc.code
    return result


if __name__ == '__main__':
    Path('docs/research/evidence').mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(probe, SOURCES.items()))
    Path('docs/research/evidence/http_checks.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    for result in results:
        print(result['name'], result.get('status'), result.get('error', ''), result.get('bytes_read'))
