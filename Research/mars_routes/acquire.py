"""One verified source adapter: USGS Mars 2020 HiRISE TRN elevation mosaic."""
import datetime
import hashlib
import json
import math
from pathlib import Path
import urllib.request

import rasterio
from rasterio.windows import Window
from pyproj import Transformer

BASE = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/'
PRODUCT = 'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40'
URL = BASE + PRODUCT + '.tif'


def sha256(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def acquire(path, center=(77.45, 18.445), size=256):
    path = Path(path)
    sidecar = path.with_suffix('.json')
    if (not isinstance(size, int) or not 16 <= size <= 512 or len(center) != 2
            or not all(math.isfinite(v) for v in center) or not -90 <= center[1] <= 90):
        raise ValueError('Use a finite lon/lat center and a crop size from 16 to 512 pixels')
    request = {'center_east_lon_planetocentric_lat': list(center), 'size_pixels': size}
    if path.exists() or sidecar.exists():
        if not (path.exists() and sidecar.exists()):
            raise ValueError('Incomplete cache; choose a new output path')
        metadata = json.loads(sidecar.read_text(encoding='utf-8'))
        if metadata['request'] != request or metadata['crop_sha256'] != sha256(path) or metadata['source_url'] != URL:
            raise ValueError('Cache provenance mismatch; choose a new output path')
        return metadata
    # Fail if range requests cease working, rather than accepting a multi-GB response.
    with urllib.request.urlopen(urllib.request.Request(URL, headers={'Range': 'bytes=0-15'}), timeout=30) as reply:
        if reply.status != 206 or not reply.headers.get('Content-Range', '').startswith('bytes 0-15/'):
            raise ValueError('Source does not honor byte ranges')
        reply.read(16)
        headers = dict(reply.headers)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_TIMEOUT='30', GDAL_HTTP_MAX_RETRY='2'):
        with rasterio.open(URL) as src:
            from pyproj import CRS
            crs = CRS.from_user_input(src.crs)
            x, y = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True).transform((center[0] + 180) % 360 - 180, center[1])
            row, col = src.index(x, y)
            window = Window(col - size // 2, row - size // 2, size, size)
            if window.col_off < 0 or window.row_off < 0 or window.col_off + size > src.width or window.row_off + size > src.height:
                raise ValueError('Crop extends outside the source mosaic')
            data = src.read(1, window=window)
            transform = src.window_transform(window)
            with rasterio.open(path.with_suffix('.partial.tif'), 'w', driver='GTiff', width=size, height=size,
                               count=1, dtype=data.dtype, crs=src.crs, transform=transform,
                               nodata=src.nodata, compress='deflate') as dst:
                dst.write(data, 1)
                dst.update_tags(source_url=URL, data_kind='real_mars_stereo_dem')
            metadata = dict(source_url=URL, product=PRODUCT, request=request,
                            acquired_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                            http_headers=headers, source_shape=[src.height, src.width],
                            source_block_shapes=src.block_shapes, source_dtype=src.dtypes[0],
                            nodata=src.nodata, crs_wkt=src.crs.to_wkt(), transform=list(transform),
                            source_window=[window.col_off, window.row_off, size, size],
                            resampling='none; native pixel values preserved',
                            data_kind='real_mars_stereo_dem',
                            vertical_reference='MOLA topography; retain source DeltaGeoid processing history',
                            label_url=BASE + PRODUCT + '_pds3.lbl')
    path.with_suffix('.partial.tif').replace(path)
    metadata['crop_sha256'] = sha256(path)
    sidecar.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    return metadata
