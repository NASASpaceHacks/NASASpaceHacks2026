"""Directed, nonnegative scenario-time routing and small exact stop ordering."""
from dataclasses import dataclass
import heapq
import itertools
import math


@dataclass(frozen=True)
class Scenario:
    speed_m_s: float = 0.5
    uphill_factor: float = 4.0
    downhill_factor: float = 2.0
    max_slope_deg: float = 15.0

    def __post_init__(self):
        if (not all(math.isfinite(x) for x in vars(self).values()) or self.speed_m_s <= 0
                or min(self.uphill_factor, self.downhill_factor) < 0 or not 0 < self.max_slope_deg < 90):
            raise ValueError('Invalid scenario parameters')


class NoRoute(ValueError):
    pass


def edge(terrain, a, b, scenario):
    horizontal = terrain.distance(a, b)
    dz = float(terrain.elevation[b] - terrain.elevation[a])
    grade = dz / horizontal
    distance = math.hypot(horizontal, dz)
    seconds = distance / scenario.speed_m_s * (1 + scenario.uphill_factor * max(grade, 0) + scenario.downhill_factor * max(-grade, 0))
    return seconds, distance, dz, abs(math.degrees(math.atan(grade)))


def neighbors(terrain, a, scenario):
    if not terrain.allowed[a] or terrain.slope[a] > scenario.max_slope_deg:
        return
    for dr, dc in itertools.product((-1, 0, 1), repeat=2):
        if not (dr or dc):
            continue
        b = (a[0] + dr, a[1] + dc)
        if not terrain.inside(b) or not terrain.allowed[b] or terrain.slope[b] > scenario.max_slope_deg:
            continue
        sides = ((a[0] + dr, a[1]), (a[0], a[1] + dc))
        if dr and dc and any(not terrain.allowed[p] or terrain.slope[p] > scenario.max_slope_deg for p in sides):
            continue
        if edge(terrain, a, b, scenario)[3] <= scenario.max_slope_deg:
            yield b


def shortest_path(terrain, start, goal, scenario, use_heuristic=True):
    for p in (start, goal):
        if not terrain.inside(p) or not terrain.allowed[p] or terrain.slope[p] > scenario.max_slope_deg:
            raise NoRoute('Endpoint is outside supported, permitted terrain')
    min_east = float(min(terrain.east_m))

    def heuristic(p):
        return math.hypot((goal[0] - p[0]) * terrain.north_m, (goal[1] - p[1]) * min_east) / scenario.speed_m_s if use_heuristic else 0

    queue = [(heuristic(start), 0.0, start)]
    costs, parent = {start: 0.0}, {}
    while queue:
        _, cost, a = heapq.heappop(queue)
        if cost != costs[a]:
            continue
        if a == goal:
            path = [a]
            while a in parent:
                a = parent[a]
                path.append(a)
            return path[::-1], cost
        for b in neighbors(terrain, a, scenario):
            candidate = cost + edge(terrain, a, b, scenario)[0]
            if candidate < costs.get(b, math.inf):
                costs[b], parent[b] = candidate, a
                heapq.heappush(queue, (candidate + heuristic(b), candidate, b))
    raise NoRoute('No feasible route inside this crop')


def return_times(terrain, base, scenario):
    """Reverse Dijkstra: directed costs TO base, not the costs FROM base."""
    if not terrain.inside(base) or not terrain.allowed[base] or terrain.slope[base] > scenario.max_slope_deg:
        raise NoRoute('Base is unsupported')
    costs, queue = {base: 0.0}, [(0.0, base)]
    while queue:
        cost, a = heapq.heappop(queue)
        if cost != costs[a]:
            continue
        for b in neighbors(terrain, a, scenario):
            candidate = cost + edge(terrain, b, a, scenario)[0]
            if candidate < costs.get(b, math.inf):
                costs[b] = candidate
                heapq.heappush(queue, (candidate, b))
    return costs


def order_stops(costs, required, return_to_base=True):
    """Exact asymmetric ordering for <=8 required stops; index 0 is base."""
    required = tuple(required)
    if not len(costs) or any(len(row) != len(costs) for row in costs) or any(not isinstance(i, int) or not 0 <= i < len(costs) for i in required):
        raise ValueError('Expected a square cost matrix and valid stop indices')
    if len(required) > 8 or len(set(required)) != len(required) or 0 in required:
        raise ValueError('Use at most 8 distinct required stops excluding base')
    if any(not math.isfinite(v) and v != math.inf or v < 0 for row in costs for v in row):
        raise ValueError('Costs must be nonnegative or infinity')
    best = (math.inf, None)
    # shortcut: factorial ordering is capped at 8 stops, use Held-Karp or a solver for larger missions.
    for perm in itertools.permutations(required):
        order = (0,) + perm + ((0,) if return_to_base else ())
        cost = sum(costs[a][b] for a, b in zip(order, order[1:]))
        if cost < best[0]:
            best = cost, order
    if best[1] is None:
        raise NoRoute('Required stops cannot be connected')
    return best[1], best[0]


def validate_budget(path, terrain, scenario, to_base, budget_s, reserve_s=0, dwell_s=None):
    if not path:
        raise ValueError('Route must contain at least one cell')
    if not all(math.isfinite(x) and x >= 0 for x in (budget_s, reserve_s)):
        raise ValueError('Budget and reserve must be finite and nonnegative')
    dwell_s = dwell_s or {}
    if any(not isinstance(i, int) or not 0 <= i < len(path) or not math.isfinite(v) or v < 0 for i, v in dwell_s.items()):
        raise ValueError('Dwell times must be nonnegative seconds at valid path indices')
    elapsed, min_margin = 0.0, math.inf
    for i, cell in enumerate(path):
        if i:
            elapsed += edge(terrain, path[i - 1], cell, scenario)[0]
        elapsed += dwell_s.get(i, 0)
        margin = budget_s - elapsed - to_base.get(cell, math.inf) - reserve_s
        min_margin = min(min_margin, margin)
        if margin < -1e-8:
            raise NoRoute('EVA time budget or emergency return reserve violated')
    return {'elapsed_s': elapsed, 'minimum_return_margin_s': min_margin, 'budget_s': budget_s, 'reserve_s': reserve_s}
