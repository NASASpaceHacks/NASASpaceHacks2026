"""Read a small, native-grid Mars DEM and derive conservative terrain masks."""
from dataclasses import dataclass
import math

import numpy as np
from pyproj import CRS, Transformer
import rasterio
from rasterio.transform import rowcol, xy


@dataclass
class Terrain:
    elevation: np.ndarray
    transform: object
    crs: CRS
    slope: np.ndarray
    allowed: np.ndarray
    east_m: np.ndarray
    north_m: float

    def cell(self, lon, lat):
        if not math.isfinite(lon) or not math.isfinite(lat) or not -90 <= lat <= 90:
            raise ValueError('Expected finite east longitude and planetocentric latitude in degrees')
        lon = (lon + 180) % 360 - 180
        x, y = Transformer.from_crs(self.crs.geodetic_crs, self.crs, always_xy=True).transform(lon, lat)
        r, c = rowcol(self.transform, x, y)
        cell = (int(r), int(c))
        if not self.inside(cell):
            raise ValueError('Coordinate is outside the DEM crop')
        return cell

    def inside(self, cell):
        r, c = cell
        return 0 <= r < self.elevation.shape[0] and 0 <= c < self.elevation.shape[1]

    def lonlat(self, cells):
        rows, cols = zip(*cells)
        xs, ys = xy(self.transform, rows, cols)
        lon, lat = Transformer.from_crs(self.crs, self.crs.geodetic_crs, always_xy=True).transform(xs, ys)
        return list(zip(lon, lat))

    def distance(self, a, b):
        # shortcut: local spherical metric only, use geodesic edges for larger or polar crops.
        dx = (self.east_m[a[0]] + self.east_m[b[0]]) / 2 * (b[1] - a[1])
        return math.hypot(dx, self.north_m * (b[0] - a[0]))


def prepare(elevation, transform, crs, max_slope_deg, obstacle_mask=None):
    crs = CRS.from_user_input(crs)
    operation = crs.coordinate_operation
    if (operation is None or operation.method_name != 'Equidistant Cylindrical (Spherical)' or crs.ellipsoid.inverse_flattening != 0
            or not 3.3e6 < crs.ellipsoid.semi_major_metre < 3.5e6
            or any(axis.unit_name != 'metre' for axis in crs.axis_info)
            or transform.b != 0 or transform.d != 0 or transform.a <= 0 or transform.e >= 0):
        raise ValueError('Only north-up, metre-unit spherical Mars equirectangular DEMs are supported')
    if not math.isfinite(max_slope_deg) or not 0 < max_slope_deg < 90:
        raise ValueError('Slope cutoff must be between 0 and 90 degrees')
    z = np.asarray(elevation, dtype=float).copy()
    if z.ndim != 2 or min(z.shape) < 3 or z.size > 1_000_000:
        raise ValueError('Use a 2D crop with at least 3 cells per axis and at most 1 million cells')
    xs, ys = xy(transform, np.arange(z.shape[0]), np.zeros(z.shape[0], dtype=int))
    _, lat = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True).transform(xs, ys)
    lat = np.asarray(lat)
    radius = crs.ellipsoid.semi_major_metre
    if np.max(np.abs(lat)) > 80 or np.ptp(lat) > 1 or z.shape[1] * transform.a / radius > math.radians(1):
        raise ValueError('Use a local crop below 80 degrees latitude and under 1 degree wide/high')
    # Native equatorial equirectangular pixels are not square ground-distance cells.
    standard_parallel = next(p.value for p in operation.params if p.name == 'Latitude of 1st standard parallel')
    east = transform.a * np.cos(np.radians(lat)) / math.cos(math.radians(standard_parallel))
    north = abs(transform.e)
    gy, gx = np.gradient(z)
    slope = np.degrees(np.arctan(np.hypot(gx / east[:, None], gy / north)))
    known = np.isfinite(z)
    supported = known.copy()
    padded = np.pad(known, 1, constant_values=False)
    for dr in range(3):
        for dc in range(3):
            supported &= padded[dr:dr + z.shape[0], dc:dc + z.shape[1]]
    allowed = supported & np.isfinite(slope) & (slope <= max_slope_deg)
    if obstacle_mask is not None:
        obstacles = np.asarray(obstacle_mask)
        if obstacles.shape != z.shape or obstacles.dtype != bool:
            raise ValueError('Obstacle mask must be boolean and aligned with the DEM')
        allowed &= ~obstacles
    return Terrain(z, transform, crs, slope, allowed, east, north)


def read_terrain(path, max_slope_deg):
    with rasterio.open(path) as src:
        if src.count != 1 or src.width * src.height > 1_000_000:
            raise ValueError('Expected a small single-band elevation crop')
        z = src.read(1, masked=True).astype(float).filled(np.nan)
        z = z * src.scales[0] + src.offsets[0]
        return prepare(z, src.transform, src.crs, max_slope_deg)
