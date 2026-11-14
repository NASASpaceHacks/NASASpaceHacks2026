"""Synthetic analytic fixtures are ONLY software tests, never Mars measurements."""
import math
from pathlib import Path
import unittest

import numpy as np
from pyproj import CRS, Geod
from rasterio.transform import from_origin

from mars_routes.acquire import acquire, sha256
from mars_routes.terrain import prepare, read_terrain
from mars_routes.routing import Scenario, NoRoute, edge, shortest_path, order_stops, return_times, validate_budget

CRS_MARS = CRS.from_proj4('+proj=eqc +R=3396190 +units=m +type=crs')


def fixture(z=None, obstacles=None, cutoff=30, latitude=0):
    z = np.zeros((12, 12)) if z is None else z
    y = math.radians(latitude) * 3396190 + z.shape[0]
    return prepare(z, from_origin(0, y, 1, 1), CRS_MARS, cutoff, obstacles)


class TerrainTests(unittest.TestCase):
    def test_coordinate_roundtrip_and_longitude_convention(self):
        t = fixture(latitude=18.4)
        p = (5, 6)
        lon, lat = t.lonlat([p])[0]
        self.assertEqual(t.cell(lon, lat), p)
        self.assertEqual(t.cell(lon + 360, lat), p)
        with self.assertRaises(ValueError):
            t.cell(lon, 91)
        with self.assertRaises(ValueError):
            t.cell(180, 0)

    def test_ground_spacing_matches_mars_geodesic(self):
        t = fixture(latitude=18.4)
        a, b = (4, 4), (5, 5)
        pa, pb = t.lonlat([a, b])
        distance = Geod(a=3396190, b=3396190).inv(*pa, *pb)[2]
        self.assertAlmostEqual(t.distance(a, b), distance, places=6)

    def test_analytic_planar_slope(self):
        z = np.indices((12, 12))[1] * 0.1
        t = fixture(z, latitude=18.4)
        expected = math.degrees(math.atan(0.1 / t.east_m[5]))
        self.assertAlmostEqual(t.slope[5, 5], expected, places=8)

    def test_nodata_halo_and_boundary(self):
        z = np.zeros((12, 12))
        z[5, 5] = np.nan
        t = fixture(z)
        self.assertFalse(t.allowed[4:7, 4:7].any())
        self.assertFalse(t.allowed[0].any())
        self.assertTrue(t.allowed[3, 3])

    def test_reject_earth_and_bad_parameters(self):
        with self.assertRaises(ValueError):
            prepare(np.zeros((5, 5)), from_origin(0, 5, 1, 1), 'EPSG:3857', 15)
        for kwargs in ({'speed_m_s': 0}, {'uphill_factor': -1}, {'max_slope_deg': float('nan')}):
            with self.assertRaises(ValueError):
                Scenario(**kwargs)


class RoutingTests(unittest.TestCase):
    def test_known_flat_shortest_path(self):
        t, s = fixture(), Scenario()
        path, cost = shortest_path(t, (2, 2), (2, 8), s)
        self.assertEqual(len(path), 7)
        self.assertAlmostEqual(cost, 6 * t.east_m[2] / s.speed_m_s)

    def test_astar_matches_dijkstra(self):
        rng = np.random.default_rng(7)
        t = fixture(rng.normal(0, 0.02, (12, 12)))
        s = Scenario(max_slope_deg=30)
        _, a = shortest_path(t, (2, 2), (9, 9), s)
        _, d = shortest_path(t, (2, 2), (9, 9), s, False)
        self.assertAlmostEqual(a, d)

    def test_obstacle_avoidance_and_unreachable(self):
        mask = np.zeros((12, 12), dtype=bool)
        mask[1:8, 5] = True
        t, s = fixture(obstacles=mask), Scenario()
        path, _ = shortest_path(t, (4, 2), (4, 8), s)
        self.assertTrue(all(not mask[p] for p in path))
        self.assertTrue(any(p[0] >= 8 for p in path))
        mask[:, 5] = True
        with self.assertRaises(NoRoute):
            shortest_path(fixture(obstacles=mask), (4, 2), (4, 8), s)

    def test_nodata_avoidance_and_invalid_endpoint(self):
        z = np.zeros((12, 12))
        z[5, 5] = np.nan
        t = fixture(z)
        path, _ = shortest_path(t, (5, 2), (5, 8), Scenario())
        self.assertTrue(all(t.allowed[p] for p in path))
        with self.assertRaises(NoRoute):
            shortest_path(t, (5, 5), (5, 8), Scenario())

    def test_no_diagonal_corner_cutting(self):
        mask = np.ones((12, 12), dtype=bool)
        mask[4, 4] = mask[5, 5] = False
        with self.assertRaises(NoRoute):
            shortest_path(fixture(obstacles=mask), (4, 4), (5, 5), Scenario())

    def test_edge_slope_excludes_spike(self):
        z = np.zeros((12, 12))
        z[5, 5] = 10
        t = fixture(z)
        with self.assertRaises(NoRoute):
            shortest_path(t, (5, 5), (2, 2), Scenario())

    def test_directional_time_formula(self):
        t = fixture(np.indices((12, 12))[1] * 0.1)
        s = Scenario()
        a, b = (5, 5), (5, 6)
        up, distance, dz, _ = edge(t, a, b, s)
        down = edge(t, b, a, s)[0]
        self.assertGreater(up, down)
        self.assertAlmostEqual(up, distance / s.speed_m_s * (1 + 4 * dz / t.distance(a, b)))

    def test_ordering_is_directed(self):
        costs = [[0, 10, 1], [1, 0, 10], [10, 1, 0]]
        order, cost = order_stops(costs, [1, 2])
        self.assertEqual(order, (0, 2, 1, 0))
        self.assertEqual(cost, 3)
        with self.assertRaises(NoRoute):
            order_stops([[0, math.inf], [math.inf, 0]], [1])

    def test_invalid_stop_matrix_and_budget(self):
        for matrix, required in (([[0, 1]], [1]), ([[0]], [1]), ([[0, -1], [1, 0]], [1])):
            with self.assertRaises(ValueError):
                order_stops(matrix, required)
        t = fixture()
        with self.assertRaises(ValueError):
            validate_budget([(2, 2)], t, Scenario(), {(2, 2): 0}, float('nan'))

    def test_stricter_scenario_excludes_nodes_in_reverse_search(self):
        t = fixture(np.indices((12, 12))[1] * 0.3, cutoff=30)
        self.assertTrue(t.allowed[5, 5])
        with self.assertRaises(NoRoute):
            return_times(t, (5, 5), Scenario(max_slope_deg=10))

    def test_return_direction_and_budget(self):
        t = fixture(np.indices((12, 12))[1] * 0.1)
        s, base, goal = Scenario(), (5, 8), (5, 2)
        path, outward = shortest_path(t, base, goal, s)
        _, inward = shortest_path(t, goal, base, s)
        returns = return_times(t, base, s)
        self.assertAlmostEqual(returns[goal], inward)
        self.assertGreater(inward, outward)
        with self.assertRaises(NoRoute):
            validate_budget(path, t, s, returns, outward + 1)
        result = validate_budget(path, t, s, returns, outward + inward + 20, 10, {len(path) - 1: 5})
        self.assertAlmostEqual(result['minimum_return_margin_s'], 5)
        with self.assertRaises(NoRoute):
            validate_budget(path, t, s, returns, outward + inward + 10, 10, {len(path) - 1: 1})

    def test_same_start_goal(self):
        self.assertEqual(shortest_path(fixture(), (2, 2), (2, 2), Scenario()), ([(2, 2)], 0))


class RealDataTests(unittest.TestCase):
    def test_cached_crop_and_real_path(self):
        path = Path('examples/jezero_dem.tif')
        metadata = acquire(path)
        self.assertEqual(metadata['data_kind'], 'real_mars_stereo_dem')
        self.assertEqual(metadata['crop_sha256'], sha256(path))
        t, s = read_terrain(path, 15), Scenario()
        route, cost = shortest_path(t, (40, 40), (210, 210), s)
        self.assertTrue(all(t.allowed[p] for p in route))
        self.assertTrue(500 < cost < 550)
        with self.assertRaises(ValueError):
            acquire(path, center=(77.4, 18.4))


if __name__ == '__main__':
    unittest.main()
