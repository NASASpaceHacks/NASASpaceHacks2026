import { cellDistM, colOf, rowOf } from '../grid';
import { DEFAULT_CREW, DEFAULT_RULES, ruleValue } from '../rules';
import type { LoadedSitePack } from '../sitepack';
import type { BurndownPoint, Cell, FieldSet, PlanRequest, PlanResult, Segment } from '../types';

/**
 * Hand-shaped (NOT optimized) PlanResult for UI development before the engine lands.
 * Straight-line legs HAB → 4 stations → HAB at constant speed. Field values are plausible, not physical.
 */
function line(w: number, a: Cell, b: Cell): number[] {
  let x0 = colOf({ w }, a), y0 = rowOf({ w }, a);
  const x1 = colOf({ w }, b), y1 = rowOf({ w }, b);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: number[] = [];
  for (;;) {
    out.push(y0 * w + x0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

export function goldenPlanRequest(pack: LoadedSitePack): PlanRequest {
  const m = pack.manifest;
  const hab = m.shelters.find((s) => s.kind === 'hab')!;
  return {
    siteId: m.id,
    hab: hab.cell,
    shelters: m.shelters.map((s) => ({ id: s.id, kind: s.kind, cell: s.cell })),
    sol: m.scenario.sol,
    startLtstMin: m.scenario.startLtstMin,
    stations: m.stations.map((s) => ({ id: s.id, cell: s.cell, value: s.value, dwellMin: s.dwellMin, taskW: s.taskW })),
    rules: DEFAULT_RULES,
    crew: DEFAULT_CREW,
    seed: 1,
  };
}

export function goldenPlanResult(pack: LoadedSitePack): PlanResult {
  const m = pack.manifest;
  const g = m.grid;
  const dem = pack.rasters.dem;
  const hab = m.shelters.find((s) => s.kind === 'hab')!;
  const picks = [...m.stations].sort((a, b) => cellDistM(g, hab.cell, a.cell) - cellDistM(g, hab.cell, b.cell)).slice(0, 4);
  const v = DEFAULT_CREW.v0;
  const stops = ['HAB', ...picks.map((s) => s.id), 'HAB'];
  const cellOfId = (id: string) => (id === 'HAB' ? hab.cell : m.stations.find((s) => s.id === id)!.cell);

  let t = ruleValue(DEFAULT_RULES, 'egress_ingress_min') / 2;
  const segments: Segment[] = [];
  const burndown: BurndownPoint[] = [];
  const stopRows = [];
  let dist = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = cellOfId(stops[i]), b = cellOfId(stops[i + 1]);
    const cells = line(g.w, a, b);
    const d = cellDistM(g, a, b);
    const t0 = t;
    const dur = d / v / 60;
    for (let k = 0; k < cells.length; k += Math.max(1, Math.floor(cells.length / 12))) {
      const c = cells[k];
      const tm = t0 + (dur * k) / cells.length;
      const dh = cellDistM(g, hab.cell, c);
      burndown.push({
        tMin: tm,
        distHabM: dh,
        elevM: dem[c],
        o2Pct: Math.max(0, 100 - (tm / 300) * 100),
        walkbackMarginMin: Math.max(0, 300 - tm - (dh / (v * 0.5)) / 60),
        shelterMarginMin: Math.max(0, 30 - Math.min(dh, cellDistM(g, m.shelters[1]?.cell ?? hab.cell, c)) / v / 60),
        metW: 300 + (k % 5) * 20,
        heatAvgW: 310,
        inLos: dh < 1200,
        sunElevDeg: 35 + tm / 10,
      });
    }
    t += dur;
    dist += d;
    segments.push({ from: stops[i], to: stops[i + 1], cells, t0Min: t0, t1Min: t, distM: d, energyKJ: (d / v) * 0.33, restMin: 0, checks: [] });
    if (i < picks.length) {
      const st = picks[i];
      stopRows.push({ id: st.id, arriveMin: t, departMin: t + st.dwellMin, arriveLtstMin: m.scenario.startLtstMin + t });
      t += st.dwellMin;
    }
  }
  t += ruleValue(DEFAULT_RULES, 'egress_ingress_min') / 2;

  const dropped = m.stations.filter((s) => !picks.includes(s)).slice(0, 3).map((s, i) => ({
    id: s.id,
    rule: (i === 0 ? 'shelter_time_max_min' : 'walk_radius_max_m') as PlanResult['dropped'][number]['rule'],
    deficitMin: 6 + i * 4,
    text: `${s.id} dropped: ${i === 0 ? 'shelter time' : 'walk radius'}, −${6 + i * 4} min`,
  }));

  return {
    status: 'OK',
    reqHash: 'golden',
    solveMs: 0,
    planner: { pathSearch: 'golden-straight-line', costModel: 'constant-speed' },
    order: picks.map((s) => s.id),
    segments,
    stops: stopRows,
    burndown,
    margins: {
      shelter_time_max_min: { min: 4.5, atMin: 120 },
      walk_radius_max_m: { min: 310, atMin: 140 },
      heat_avg_max_w: { min: 22, atMin: 95 },
    },
    binding: { rule: 'shelter_time_max_min', text: `Limited by shelter time at ${picks[2]?.id ?? 'ST'}`, seg: 2 },
    dropped,
    leaderboard: picks.map((s, i) => ({ id: s.id, value: s.value, marginalMin: 20 + i * 7 })),
    bingo: stopRows.map((s) => ({ id: s.id, ltstMin: s.departMin + m.scenario.startLtstMin + 15, tMin: s.departMin + 15, text: `Leave ${s.id} by +${Math.round(s.departMin + 15)} min` })),
    totals: {
      distM: dist,
      durationMin: t,
      energyKJ: (dist / v) * 0.33,
      o2UsedPct: Math.min(100, (t / 360) * 100),
      doseUSv: (t / 1440) * 640,
      scienceValue: picks.reduce((a, s) => a + s.value, 0),
      maxDistHabM: Math.max(...picks.map((s) => cellDistM(g, hab.cell, s.cell))),
    },
    notes: ['Golden fixture — straight-line legs, not optimized.'],
  };
}

/** Plausible dense fields for UI development (distance-based, slope-penalized). */
export function mockFields(pack: LoadedSitePack): FieldSet {
  const g = pack.manifest.grid;
  const n = g.w * g.h;
  const hab = pack.manifest.shelters.find((s) => s.kind === 'hab')!;
  const shelters = pack.manifest.shelters;
  const slope = pack.rasters.slope;
  const v = DEFAULT_CREW.v0;
  const walkbackMin = new Float32Array(n), shelterMin = new Float32Array(n), outboundMin = new Float32Array(n);
  const los = new Uint8Array(n), blocked = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    const pen = 1 + slope[c] / 10;
    const dh = cellDistM(g, hab.cell, c);
    const ds = Math.min(...shelters.map((s) => cellDistM(g, s.cell, c)));
    outboundMin[c] = (dh * pen) / v / 60;
    walkbackMin[c] = (dh * pen) / (v * 0.5) / 60;
    shelterMin[c] = (ds * pen) / v / 60;
    blocked[c] = slope[c] > 20 ? 1 : 0;
    los[c] = dh < 1500 && slope[c] < 15 ? 1 : 0;
  }
  return { w: g.w, h: g.h, walkbackMin, shelterMin, outboundMin, los, blocked };
}
