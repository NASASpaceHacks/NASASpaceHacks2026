import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE_PREFS, goldenPlanRequest, mockSitePack, PlanRequestSchema, ROUTE_PRESETS } from '../contracts';
import { DEFAULT_RULES } from '../contracts/rules';
import type { LoadedSitePack } from '../contracts/sitepack';
import type { PlanRequest, PlanResult, Rule, RoutePrefs, Segment } from '../contracts/types';
import { pandolfSanteeMars } from './costModel';
import { EDGE_INF } from './dial';
import { requestHash, resolve } from './fields';
import { attemptRoute, computeFields, evaluateOrder, plan, routeStats, stageFromShelter, type RouteStats } from './index';
import { normalizePrefs, routeMultiplier } from './prefs';
import { loadSitePackFromDisk, sitePackOnDisk, strip, verifyOk } from './verifyPlan.testutil';

const preset = (id: string): RoutePrefs => ROUTE_PRESETS.find((p) => p.id === id)!.prefs;
const withPrefs = (req: PlanRequest, prefs: RoutePrefs | undefined): PlanRequest => ({ ...req, prefs });
const now = () => performance.now();
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Route metrics the console shows (engine routeStats: true walking time, cell-averaged slope / CRISM). */
const routeMetrics = (pack: LoadedSitePack, req: PlanRequest, r: { segments: Segment[]; stops?: { id: string; arriveMin: number; departMin: number }[] }) => routeStats(pack, req, r);

const fmt = (id: string, r: PlanResult | { pass: boolean; durationMin: number }, m: RouteStats, extra = '') =>
  `${id.padEnd(8)} ${'status' in r ? `${r.status} [${r.order.join(',')}] sci ${r.totals.scienceValue}` : r.pass ? 'pass' : 'FAIL'}` +
  ` | out-of-contact ${m.outOfContactMin.toFixed(2)} min | slope mean ${m.meanSlopeDeg.toFixed(2)}° max ${m.maxSlopeDeg.toFixed(1)}°` +
  ` | rough>10cm ${(100 * m.roughFrac).toFixed(1)}% | CRISM mean ${m.meanCrism?.toFixed(5)} | walk ${m.walkMin.toFixed(1)} min` +
  ` | EVA ${('status' in r ? r.totals.durationMin : r.durationMin).toFixed(1)} min | ${m.distM.toFixed(0)} m${extra}`;

// ─────────────────────────── unit: weights → multiplier (mock terrain) ───────────────────────────

describe('route priorities: normalization and the per-cell multiplier', () => {
  const pack = mockSitePack(412, 200);
  const req = goldenPlanRequest(pack);

  it('neutral priorities normalize to null (no multiplier is ever built)', () => {
    expect(normalizePrefs(undefined)).toBeNull();
    expect(normalizePrefs(DEFAULT_ROUTE_PREFS)).toBeNull();
    expect(normalizePrefs({ distance: 0.3, slope: 0, rough: 0, thermal: 0, radio: 0, science: 0 })).toBeNull();
    expect(normalizePrefs({ distance: 0, slope: -1, rough: NaN, thermal: 0, radio: 0, science: 0 })).toBeNull();
    const n = normalizePrefs({ preset: 'x', distance: 0, slope: 7, rough: -2, thermal: NaN, radio: 0.5, science: 1 })!;
    expect(n).toEqual({ preset: 'x', distance: 0.05, slope: 1, rough: 0, thermal: 0, radio: 0.5, science: 1 });
  });

  it('multiplier is ≥ 1 everywhere with min exactly 1; radio-only = (wd + wr)/wd off-LOS, 1 in LOS', () => {
    const R = resolve(pack, req);
    const p = normalizePrefs({ distance: 0.5, slope: 0, rough: 0, thermal: 0, radio: 1, science: 0 })!;
    const m = routeMultiplier(pack, R.baseGrid, R.fields.los, p, 20)!;
    let lo = Infinity;
    for (let i = 0; i < m.length; i++) {
      lo = Math.min(lo, m[i]);
      expect(m[i]).toBeCloseTo(R.fields.los[i] === 1 ? 1 : 3, 6);
    }
    expect(lo).toBe(1);
    const all = normalizePrefs({ distance: 0.2, slope: 1, rough: 1, thermal: 1, radio: 1, science: 1 })!;
    const m2 = routeMultiplier(pack, R.baseGrid, R.fields.los, all, 20)!;
    let lo2 = Infinity;
    for (let i = 0; i < m2.length; i++) lo2 = Math.min(lo2, m2[i]);
    expect(lo2).toBe(1);
  });

  it('science-only priority on a site without CRISM (mock, like Jezero) is uniform → identical routing', () => {
    expect(pack.rasters.crism_sindex2).toBeUndefined();
    const sreq = withPrefs(req, { distance: 0.5, slope: 0, rough: 0, thermal: 0, radio: 0, science: 1 });
    const R = resolve(pack, sreq);
    expect(R.prefs).not.toBeNull();
    expect(R.routeMult).toBeNull();
    expect(R.TR).toBe(resolve(pack, req).TR);
    const a = plan(pack, req), b = plan(pack, sreq);
    expect(b.order).toEqual(a.order);
    expect(b.segments.map((s) => s.cells)).toEqual(a.segments.map((s) => s.cells));
    expect(b.notes.join(' ')).toMatch(/no CRISM layer/);
  });

  it('weighted route edges are never cheaper than the time-based ones, and passable exactly where they are', () => {
    const base = resolve(pack, req).TR;
    const R = resolve(pack, withPrefs(req, preset('safest')));
    const wt = R.TR;
    expect(wt).not.toBe(base);
    for (const [a, b] of [[base.fwd, wt.fwd], [base.rev, wt.rev]] as const) {
      for (let i = 0; i < a.length; i++) {
        if (a[i] === EDGE_INF) expect(b[i]).toBe(EDGE_INF);
        else if (!(b[i] >= a[i] && b[i] < EDGE_INF)) throw new Error(`edge ${i}: weighted ${b[i]} < base ${a[i]} or impassable`);
      }
    }
    // the continuous route model agrees: cost ≥ heat-aware time ≥ true time on every edge out of the hab region
    const hab = req.hab, w = pack.manifest.grid.w;
    for (const v of [hab + 1, hab - 1, hab + w, hab - w, hab + w + 1]) {
      const t = pandolfSanteeMars.edgeCost(R.grid, hab, v, R.ctx1);
      if (t < Infinity) expect(R.routeModel.edgeCost(R.grid, hab, v, R.ctx1)).toBeGreaterThanOrEqual(t);
    }
  });

  it('safety fields are pure travel time: identical with and without priorities', () => {
    const a = computeFields(pack, req);
    for (const p of ROUTE_PRESETS) expect(computeFields(pack, withPrefs(req, p.prefs))).toEqual(a);
  });

  it('request hash: default-equivalent priorities hash like no priorities; different weights never share a hash', () => {
    const h0 = requestHash(req);
    expect(requestHash(withPrefs(req, DEFAULT_ROUTE_PREFS))).toBe(h0);
    expect(requestHash(withPrefs(req, { distance: 0.4, slope: 0, rough: 0, thermal: 0, radio: 0, science: 0 }))).toBe(h0);
    const hs = ROUTE_PRESETS.filter((p) => p.id !== 'default').map((p) => requestHash(withPrefs(req, p.prefs)));
    expect(new Set([h0, ...hs]).size).toBe(hs.length + 1);
    expect(requestHash(withPrefs(req, { ...preset('radio'), radio: 0.9 }))).not.toBe(requestHash(withPrefs(req, preset('radio'))));
  });

  it('PlanRequestSchema keeps prefs (zod would strip an unknown key) and rejects out-of-range weights', () => {
    const r = PlanRequestSchema.safeParse(withPrefs(req, preset('safest')));
    expect(r.success).toBe(true);
    expect((r.data as PlanRequest).prefs).toEqual(preset('safest'));
    expect(PlanRequestSchema.safeParse(withPrefs(req, { ...preset('safest'), slope: 1.5 })).success).toBe(false);
    expect(PlanRequestSchema.safeParse(withPrefs(req, { ...preset('safest'), radio: -0.1 })).success).toBe(false);
    expect(PlanRequestSchema.safeParse(withPrefs(req, { ...preset('safest'), distance: NaN })).success).toBe(false);
    expect(PlanRequestSchema.safeParse(req).success).toBe(true);
  });
});

// ─────────────────────────── real data: SitePacks/gale-v1 ───────────────────────────

describe.skipIf(!sitePackOnDisk('gale-v1'))('route priorities on SitePacks/gale-v1', () => {
  const pack = loadSitePackFromDisk('gale-v1');
  const habReq = goldenPlanRequest(pack);
  const roverReq = stageFromShelter(habReq, 'ROVER1');
  const roverPlan = plan(pack, roverReq);

  it('(a) default priorities are identical to no priorities: plans, attempts, fields, hashes (bitwise)', () => {
    expect(roverPlan.status).toBe('OK');
    const first = roverPlan.stops[0];
    const leg0 = roverPlan.segments[0].cells;
    const scenarios: [string, PlanRequest][] = [
      ['hab (STAY_IN + staging note)', habReq],
      ['rover-staged', roverReq],
      ['rover-staged, A*', { ...roverReq, planner: { pathSearch: 'astar', costModel: 'pandolf-santee-mars' } }],
      ['rover-staged, resume after the first stop', { ...roverReq, resume: { elapsedMin: first.departMin, cell: roverPlan.segments[1].cells[0], visited: [first.id], o2UsedPct: 20 } }],
      ['rover-staged, HAZARD on leg 1', { ...roverReq, events: [{ t: 'HAZARD', cells: leg0.slice(Math.floor(leg0.length * 0.3), Math.floor(leg0.length * 0.6)) }] }],
      ['rover-staged, EVA_CUT 60', { ...roverReq, events: [{ t: 'EVA_CUT', min: 60 }] }],
    ];
    const neutral: RoutePrefs[] = [DEFAULT_ROUTE_PREFS, { preset: 'custom', distance: 0.4, slope: 0, rough: 0, thermal: 0, radio: 0, science: 0 }];
    for (const [name, req] of scenarios) {
      const a = plan(pack, req);
      for (const p of neutral) {
        const b = plan(pack, withPrefs(req, p));
        expect(b.order, name).toEqual(a.order);
        expect(b.segments.map((s) => s.cells), name).toEqual(a.segments.map((s) => s.cells));
        expect(b.totals, name).toEqual(a.totals);
        expect(strip(b), name).toEqual(strip(a)); // everything else too: burndown, bingo, margins, binding, notes, reqHash
      }
      // the code path is untouched: no multiplier, the very same route table and model objects
      const R0 = resolve(pack, req), R1 = resolve(pack, withPrefs(req, DEFAULT_ROUTE_PREFS));
      expect(R1.prefs).toBeNull();
      expect(R1.routeMult).toBeNull();
      expect(R1.TR).toBe(R0.TR);
      expect(R1.routeModel).toBe(R0.routeModel);
    }
    for (const id of ['ST01', 'ST04', 'ST07', 'ST09']) {
      const a = attemptRoute(pack, roverReq, id);
      const b = attemptRoute(pack, withPrefs(roverReq, DEFAULT_ROUTE_PREFS), id);
      expect(b.legs).toEqual(a.legs);
      expect(b.sim).toEqual(a.sim);
    }
    expect(computeFields(pack, withPrefs(roverReq, DEFAULT_ROUTE_PREFS))).toEqual(computeFields(pack, roverReq));
  }, 120_000);

  it('every reported minute is TRUE travel time: a priority route re-simulated with no priorities gives the same numbers', () => {
    for (const p of ROUTE_PRESETS.filter((x) => x.id !== 'default')) {
      const req = withPrefs(roverReq, p.prefs);
      const r = plan(pack, req);
      expect(r.status, p.id).toBe('OK');
      verifyOk(pack, req, r);
      // same cells, base cost model, no priorities → identical segment times, distances, energy, checks and duration
      const ev = evaluateOrder(pack, roverReq, r.order, r.segments.map((s) => s.cells));
      expect(ev.pass, p.id).toBe(true);
      expect(ev.segments, p.id).toEqual(r.segments);
      expect(ev.durationMin).toBe(r.totals.durationMin);
      // and per segment: walking time = Σ base edge times along the cells (+ heat rests)
      const R = resolve(pack, roverReq);
      for (const s of r.segments) {
        let walk = 0;
        for (let k = 1; k < s.cells.length; k++) walk += pandolfSanteeMars.edgeCost(R.grid, s.cells[k - 1], s.cells[k], R.ctx1) / 60;
        expect(s.t1Min - s.t0Min).toBeGreaterThanOrEqual(walk - 1e-9);
        expect(s.t1Min - s.t0Min).toBeLessThanOrEqual(walk + s.restMin + 1e-9);
      }
    }
  }, 120_000);

  it('(c) behaviour on a fixed stop order (rover-staged): radio ↓ out-of-contact, safest ↓ slope, science ↑ CRISM', () => {
    const order = roverPlan.order;
    const m: Record<string, RouteStats> = {};
    const lines: string[] = [];
    for (const p of ROUTE_PRESETS) {
      const ev = evaluateOrder(pack, withPrefs(roverReq, p.prefs), order);
      m[p.id] = routeMetrics(pack, roverReq, ev);
      lines.push(fmt(p.id, ev, m[p.id]));
    }
    console.log(`fixed order ${order.join(',')} from ROVER1:\n  ${lines.join('\n  ')}`);
    expect(m.radio.outOfContactMin).toBeLessThan(m.default.outOfContactMin);
    expect(m.safest.meanSlopeDeg).toBeLessThan(m.default.meanSlopeDeg);
    expect(m.safest.maxSlopeDeg).toBeLessThanOrEqual(m.default.maxSlopeDeg);
    expect(m.science.meanCrism!).toBeGreaterThan(m.default.meanCrism!);
  }, 120_000);

  it('(c) behaviour of full plans (rover-staged): every OK plan verified; radio/safest/science move their metric the right way', () => {
    const m: Record<string, RouteStats> = {};
    const lines: string[] = [];
    for (const p of ROUTE_PRESETS) {
      const req = withPrefs(roverReq, p.prefs);
      const r = plan(pack, req);
      expect(r.status, p.id).toBe('OK');
      verifyOk(pack, req, r);
      m[p.id] = routeMetrics(pack, roverReq, r);
      lines.push(fmt(p.id, r, m[p.id], ` | LOS-gap margin ${r.margins.los_gap_max_min?.min.toFixed(1)} min`));
      if (p.id !== 'default') expect(r.notes.some((n) => n.startsWith('Route priorities'))).toBe(true);
    }
    console.log(`full plans from ROVER1:\n  ${lines.join('\n  ')}`);
    expect(m.radio.outOfContactMin).toBeLessThanOrEqual(m.default.outOfContactMin);
    expect(m.safest.meanSlopeDeg).toBeLessThanOrEqual(m.default.meanSlopeDeg);
    expect(m.science.meanCrism!).toBeGreaterThan(m.default.meanCrism!);
  }, 120_000);

  it('(c) radio priority turns the ST07 out-and-back from a comm-gap NO-GO into a GO (attemptRoute honours prefs)', () => {
    const a = attemptRoute(pack, roverReq, 'ST07');
    const b = attemptRoute(pack, withPrefs(roverReq, preset('radio')), 'ST07');
    const ma = routeMetrics(pack, roverReq, a.sim!), mb = routeMetrics(pack, roverReq, b.sim!);
    console.log(`ST07 attempt: default ${a.sim!.pass ? 'GO' : `NO-GO (${a.sim!.failures.map((f) => f.rule).join(',')})`} ${ma.outOfContactMin.toFixed(2)} min out of contact; radio ${b.sim!.pass ? 'GO' : 'NO-GO'} ${mb.outOfContactMin.toFixed(2)} min`);
    expect(mb.outOfContactMin).toBeLessThanOrEqual(ma.outOfContactMin);
    if (!a.sim!.pass) expect(a.sim!.failures.map((f) => f.rule)).toContain('los_gap_max_min');
    expect(b.sim!.pass).toBe(true);
  }, 60_000);

  it('(d) performance: plan p50 with a preset stays within ~2× the default and well under 1 s', () => {
    const runs = 7;
    const p50 = (req: PlanRequest) => {
      plan(pack, req); // warm
      const ts: number[] = [];
      for (let i = 0; i < runs; i++) {
        const t = now();
        plan(pack, req);
        ts.push(now() - t);
      }
      return median(ts);
    };
    const def = p50(roverReq);
    const out: string[] = [`default ${def.toFixed(0)} ms`];
    for (const p of ROUTE_PRESETS.filter((x) => x.id !== 'default')) {
      const t = p50(withPrefs(roverReq, p.prefs));
      out.push(`${p.id} ${t.toFixed(0)} ms`);
      expect(t).toBeLessThan(1000);
      expect(t).toBeLessThan(2.5 * def + 25);
    }
    // a weight setting never seen before (multiplier + weighted table built inside the call)
    const colds: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = now();
      plan(pack, withPrefs(roverReq, { preset: 'custom', distance: 0.31 + i / 97, slope: 0.4, rough: 0.2, thermal: 0.1, radio: 0.6, science: 0.3 }));
      colds.push(now() - t);
    }
    const cold = median(colds);
    out.push(`new weights (cold) ${cold.toFixed(0)} ms`);
    const habDef = p50(habReq), habRadio = p50(withPrefs(habReq, preset('radio')));
    out.push(`hab base (STAY_IN + staging probe): default ${habDef.toFixed(0)} ms, radio ${habRadio.toFixed(0)} ms`);
    console.log(`plan p50 on gale-v1 (rover-staged, 1M cells): ${out.join(' | ')}`);
    expect(cold).toBeLessThan(1000);
    expect(habRadio).toBeLessThan(1000);
  }, 180_000);
});

// ─────────────────────────── property: random priorities on random gale-v1 requests ───────────────────────────

describe.skipIf(!sitePackOnDisk('gale-v1'))('property: with ANY route priorities, every OK plan on gale-v1 passes every hard rule', () => {
  it('holds over 200 random requests', () => {
    const pack = loadSitePackFromDisk('gale-v1');
    const g = pack.manifest.grid;
    const base0 = goldenPlanRequest(pack);
    const ids = base0.stations.map((s) => s.id);
    // A few discrete rule sets: each distinct rules array builds (and caches) its own 1M-cell route table.
    const set = (o: Partial<Record<Rule['id'], number | false>>): Rule[] =>
      DEFAULT_RULES.map((r) => (r.id in o ? (o[r.id] === false ? { ...r, enabled: false } : { ...r, value: o[r.id] as number }) : r));
    const RULESETS: Rule[][] = [
      DEFAULT_RULES,
      set({ shelter_time_max_min: 25, walk_radius_max_m: 1200, los_gap_max_min: 5 }),
      set({ shelter_time_max_min: 60, walk_radius_max_m: 2500, los_gap_max_min: false, eva_duration_max_min: 480 }),
      set({ heat_avg_max_w: 380, daylight_min_sun_elev_deg: 12, eva_duration_max_min: 240 }),
    ];
    const unit = fc.oneof(fc.constant(0), fc.constant(1), fc.double({ min: 0, max: 1, noNaN: true }));
    const maybe = <T,>(arb: fc.Arbitrary<T>, pct: number): fc.Arbitrary<T | undefined> =>
      fc.oneof({ weight: 100 - pct, arbitrary: fc.constant(undefined) }, { weight: pct, arbitrary: arb });
    let ok = 0, cases = 0;
    const t0 = now();
    fc.assert(
      fc.property(
        fc.record({
          rover: fc.boolean(),
          rules: fc.nat(RULESETS.length - 1),
          stations: fc.subarray(ids, { minLength: 1 }),
          startH: fc.double({ min: 7, max: 16.5, noNaN: true }),
          cut: maybe(fc.integer({ min: 10, max: 200 }), 20),
          hazard: maybe(fc.record({ dr: fc.integer({ min: -80, max: 80 }), dc: fc.integer({ min: -80, max: 80 }), size: fc.integer({ min: 1, max: 8 }) }), 8),
          resume: maybe(fc.record({ dr: fc.integer({ min: -60, max: 60 }), dc: fc.integer({ min: -60, max: 60 }), elapsed: fc.double({ min: 20, max: 200, noNaN: true }), o2: fc.double({ min: 0, max: 60, noNaN: true }), nVisited: fc.nat(3) }), 15),
          sep: maybe(fc.double({ min: 5, max: 60, noNaN: true }), 5),
          astar: fc.oneof({ weight: 85, arbitrary: fc.constant(false) }, { weight: 15, arbitrary: fc.constant(true) }),
          prefs: fc.record({ preset: fc.constant('custom'), distance: unit, slope: unit, rough: unit, thermal: unit, radio: unit, science: unit }),
        }),
        (p) => {
          cases++;
          const base = p.rover ? stageFromShelter(base0, 'ROVER1') : base0;
          const at = (dr: number, dc: number) => {
            const r = Math.min(g.h - 1, Math.max(0, Math.floor(base.hab / g.w) + dr)), c = Math.min(g.w - 1, Math.max(0, (base.hab % g.w) + dc));
            return r * g.w + c;
          };
          const events: PlanRequest['events'] = [];
          if (p.cut !== undefined) events.push({ t: 'EVA_CUT', min: p.cut });
          if (p.hazard) {
            const cells: number[] = [];
            for (let i = 0; i < p.hazard.size; i++) for (let j = 0; j < p.hazard.size; j++) cells.push(at(p.hazard.dr + i, p.hazard.dc + j));
            events.push({ t: 'HAZARD', cells: cells.filter((c) => c !== base.hab) });
          }
          if (p.sep !== undefined) events.push({ t: 'SEP_NOWCAST', leadMin: p.sep });
          const req: PlanRequest = {
            ...base,
            rules: RULESETS[p.rules],
            stations: base.stations.filter((s) => p.stations.includes(s.id)),
            startLtstMin: p.startH * 60,
            events,
            planner: p.astar ? { pathSearch: 'astar', costModel: 'pandolf-santee-mars' } : undefined,
            prefs: p.prefs,
          };
          if (p.resume) req.resume = { cell: at(p.resume.dr, p.resume.dc), elapsedMin: p.resume.elapsed, o2UsedPct: p.resume.o2, visited: p.stations.slice(0, p.resume.nVisited) };
          const res = plan(pack, req);
          expect(['OK', 'STAY_IN']).toContain(res.status);
          if (res.status === 'STAY_IN') {
            expect(res.order).toEqual([]);
            return;
          }
          ok++;
          if (p.sep !== undefined) {
            for (const s of res.segments) for (const c of s.checks) expect(c.pass).toBe(true);
            return;
          }
          verifyOk(pack, req, res);
        },
      ),
      { numRuns: 200, seed: 20261115 },
    );
    console.log(`property (gale-v1, random priorities): ${ok} OK plans of ${cases} cases, all independently verified, in ${((now() - t0) / 1000).toFixed(1)} s`);
    expect(ok).toBeGreaterThan(30); // not vacuous
  }, 600_000);
});
