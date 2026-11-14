import argparse
import csv
from dataclasses import asdict
import json
from pathlib import Path

import numpy as np
import rasterio

from .acquire import acquire, sha256
from .terrain import read_terrain
from .routing import Scenario, NoRoute, edge, shortest_path, order_stops, return_times, validate_budget


def main():
    parser = argparse.ArgumentParser(description='Research-only Mars terrain routes; all walking parameters are engineering assumptions.')
    parser.add_argument('--dem', type=Path, default=Path('examples/jezero_dem.tif'))
    parser.add_argument('--fetch', action='store_true', help='Acquire the verified 256-pixel Jezero crop if absent')
    parser.add_argument('--start', type=float, nargs=2, metavar=('LON', 'LAT'))
    parser.add_argument('--goal', type=float, nargs=2, metavar=('LON', 'LAT'))
    parser.add_argument('--stop', type=float, nargs=2, action='append', default=[], metavar=('LON', 'LAT'))
    parser.add_argument('--return-to-base', action='store_true')
    parser.add_argument('--speed', type=float, default=0.5, help='Scenario flat speed in m/s, not a measured Mars astronaut speed')
    parser.add_argument('--max-slope', type=float, default=15, help='Illustrative exclusion angle in degrees, not a safety standard')
    parser.add_argument('--budget-min', type=float, default=60)
    parser.add_argument('--reserve-min', type=float, default=10)
    parser.add_argument('--dwell-min', type=float, default=0, help='Service time at each requested stop')
    parser.add_argument('--out', type=Path, default=Path('outputs/jezero'))
    args = parser.parse_args()
    if bool(args.start) != bool(args.goal):
        parser.error('Supply both --start and --goal, or neither for the demonstration')
    if not np.isfinite(args.dwell_min) or args.dwell_min < 0 or len(args.stop) > 7:
        parser.error('Use a nonnegative finite dwell time and at most 7 intermediate stops')
    try:
        if args.fetch:
            acquire(args.dem)
        provenance = json.loads(args.dem.with_suffix('.json').read_text(encoding='utf-8'))
        if provenance['crop_sha256'] != sha256(args.dem):
            raise ValueError('DEM hash does not match provenance')
        scenario = Scenario(speed_m_s=args.speed, max_slope_deg=args.max_slope)
        terrain = read_terrain(args.dem, args.max_slope)
        if args.start:
            requested = [args.start] + args.stop + [args.goal]
            cells = [terrain.cell(*p) for p in requested]
        else:
            if terrain.elevation.shape != (256, 256):
                raise ValueError('Supply explicit coordinates for a non-demo crop')
            endpoints = [(40, 40), (210, 210)]
            start, goal = terrain.lonlat(endpoints)
            requested = [start] + args.stop + [goal]
            cells = [terrain.cell(*p) for p in requested]
        if len(set(cells)) != len(cells):
            raise ValueError('Distinct destinations must map to distinct cells')
        # An open traverse has a fixed final goal; only intermediate stops are reordered.
        paths, costs = {}, np.full((len(cells), len(cells)), np.inf)
        for i, a in enumerate(cells):
            costs[i, i] = 0
            for j, b in enumerate(cells):
                if i != j:
                    try:
                        paths[i, j], costs[i, j] = shortest_path(terrain, a, b, scenario)
                    except NoRoute:
                        pass
        if args.return_to_base:
            order, _ = order_stops(costs, range(1, len(cells)), True)
        else:
            import itertools
            orders = [(0,) + p + (len(cells) - 1,) for p in itertools.permutations(range(1, len(cells) - 1))]
            order = min(orders, key=lambda p: sum(costs[a, b] for a, b in zip(p, p[1:])))
        route, dwell = [cells[0]], {}
        for a, b in zip(order, order[1:]):
            if (a, b) not in paths:
                raise NoRoute('Required destinations are unreachable')
            route.extend(paths[a, b][1:])
            if b:
                dwell[len(route) - 1] = args.dwell_min * 60
        budget = validate_budget(route, terrain, scenario, return_times(terrain, cells[0], scenario),
                                 args.budget_min * 60, args.reserve_min * 60, dwell)
        edges = [edge(terrain, a, b, scenario) for a, b in zip(route, route[1:])]
        coords = terrain.lonlat(route)
        gain = sum(max(e[2], 0) for e in edges)
        metrics = dict(length_3d_m=sum(e[1] for e in edges), walking_s=sum(e[0] for e in edges),
                       elevation_gain_m=gain, elevation_loss_m=sum(max(-e[2], 0) for e in edges),
                       max_edge_slope_deg=max(e[3] for e in edges),
                       max_cell_slope_deg=max(float(terrain.slope[p]) for p in route),
                       positive_gravitational_work_J_per_kg=3.71 * gain, **budget)
        output = dict(schema='mars-route-v1', body='Mars',
                      coordinate_convention='east longitude degrees, planetocentric latitude degrees; NOT Earth GeoJSON',
                      geometry={'type': 'LineString', 'coordinates': [[lon, lat, float(terrain.elevation[p])] for (lon, lat), p in zip(coords, route)]},
                      requested_lonlat=requested, snapped_cells=cells, stop_order=list(order),
                      scenario=asdict(scenario), metrics=metrics, provenance=provenance,
                      limitations=['Research demonstration, not operational EVA guidance',
                                   'Time and slope cutoff are uncalibrated engineering assumptions',
                                   'DEM does not establish foot-scale obstacle or soil safety',
                                   'No oxygen, thermal, radiation, fatigue or communication feasibility model',
                                   'Gravitational work is not metabolic energy'])
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / 'route.json').write_text(json.dumps(output, indent=2, allow_nan=False), encoding='utf-8')
        with (args.out / 'route.csv').open('w', newline='', encoding='utf-8') as stream:
            writer = csv.writer(stream)
            writer.writerow(['east_longitude_deg', 'planetocentric_latitude_deg', 'elevation_m', 'row', 'col'])
            for (lon, lat), p in zip(coords, route):
                writer.writerow([lon, lat, float(terrain.elevation[p]), *p])
        with rasterio.open(args.out / 'terrain.tif', 'w', driver='GTiff', width=terrain.elevation.shape[1],
                           height=terrain.elevation.shape[0], count=3, dtype='float32', crs=terrain.crs,
                           transform=terrain.transform, nodata=np.nan, compress='deflate') as dst:
            for i, (array, name) in enumerate([(terrain.elevation, 'elevation_m'), (terrain.slope, 'slope_degrees'),
                                               (terrain.allowed, 'scenario_permitted_1_excluded_0')], 1):
                dst.write(array.astype('float32'), i)
                dst.set_band_description(i, name)
        print(json.dumps(dict(output=str(args.out), stop_order=list(order), metrics=metrics), indent=2))
    except (ValueError, OSError, KeyError) as exc:
        parser.exit(2, f'Route failed: {exc}\n')


if __name__ == '__main__':
    main()
