import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { goldenPlanRequest, mockSitePack } from '../contracts';
import { DEFAULT_RULES } from '../contracts/rules';
import type { LoadedSitePack } from '../contracts/sitepack';
import type { PlanRequest } from '../contracts/types';
import { evaluateOrder, plan, stageFromShelter } from './index';
import { loadSitePackFromDisk, sitePackOnDisk, strip, verifyOk } from './verifyPlan.testutil';

describe('plan() on the 1000×1000 mock (5 km × 5 km at 5 m)', () => {
  const pack = mockSitePack(412, 1000);
  const req = goldenPlanRequest(pack);
  const res = plan(pack, req);

  it('returns a verified OK plan with every output filled', () => {
    expect(res.status).toBe('OK');
    expect(res.order.length).toBeGreaterThanOrEqual(1);
    verifyOk(pack, req, res);
    expect(res.binding).not.toBeNull();
    expect(res.binding!.text).toMatch(/^Limited by /);
    expect(res.leaderboard.map((l) => l.id)).toEqual(res.order);
    expect(res.bingo.at(-1)!.id).toBe('HAB');
    expect(res.burndown.length).toBeGreaterThan(res.totals.durationMin * 0.8 - 60);
    expect(res.totals.doseUSv).toBeGreaterThan(0);
    expect(res.totals.scienceValue).toBe(res.order.reduce((a, id) => a + req.stations.find((s) => s.id === id)!.value, 0));
    expect(res.reqHash).toMatch(/^[0-9a-f]{16}$/);
    expect(res.planner).toEqual({ pathSearch: 'dijkstra', costModel: 'pandolf-santee-mars' });
    // every unselected station is explained
    for (const s of req.stations) if (!res.order.includes(s.id)) expect(res.dropped.find((d) => d.id === s.id)?.text).toMatch(new RegExp(`^${s.id} dropped: `));
    expect(JSON.parse(JSON.stringify(res))).toEqual(res); // JSON-safe (no Infinity/NaN)
  });

  it('is deterministic', () => {
    expect(strip(plan(pack, req))).toEqual(strip(res));
  });

  it('EVA_CUT shortens the plan', () => {
    const cut = plan(pack, { ...req, events: [{ t: 'EVA_CUT', min: 120 }] });
    if (cut.status === 'OK') {
      expect(cut.totals.durationMin).toBeLessThanOrEqual(360 - 120 + 1e-6);
      verifyOk(pack, { ...req, events: [{ t: 'EVA_CUT', min: 120 }] }, cut);
    }
    expect(cut.notes.join(' ')).toMatch(/EVA cut/);
  });

  it('SEP nowcast mid-EVA returns straight to the nearest shelter', () => {
    const mid = res.segments[0].cells[Math.floor(res.segments[0].cells.length * 0.7)];
    const sepReq: PlanRequest = { ...req, events: [{ t: 'SEP_NOWCAST', leadMin: 30 }], resume: { elapsedMin: 45, cell: mid, visited: [], o2UsedPct: 5 } };
    const sep = plan(pack, sepReq);
    expect(sep.order).toEqual([]);
    expect(sep.segments).toHaveLength(1);
    expect(sep.segments[0].cells[0]).toBe(mid);
    const end = sep.segments[0].cells.at(-1)!;
    expect(req.shelters.map((s) => s.cell)).toContain(end);
    expect(sep.binding!.text).toMatch(/^SEP nowcast: return to .+ now$/);
    if (sep.status === 'OK') for (const c of sep.segments[0].checks) expect(c.pass).toBe(true);
  });

  it('SEP nowcast before egress means stay in', () => {
    const sep = plan(pack, { ...req, events: [{ t: 'SEP_NOWCAST', leadMin: 30 }] });
    expect(sep.status).toBe('STAY_IN');
    expect(sep.order).toEqual([]);
  });

  it('HAZARD cells are avoided', () => {
    const leg = res.segments[0].cells;
    const hz = leg.slice(Math.floor(leg.length * 0.3), Math.floor(leg.length * 0.6));
    const hreq: PlanRequest = { ...req, events: [{ t: 'HAZARD', cells: hz }] };
    const h = plan(pack, hreq);
    for (const s of h.segments) for (const c of s.cells) expect(hz).not.toContain(c);
    if (h.status === 'OK') verifyOk(pack, hreq, h);
  });

  it('resume replans from the current cell with visited stations excluded', () => {
    const first = res.stops[0];
    const rreq: PlanRequest = { ...req, resume: { elapsedMin: first.departMin, cell: res.segments[1].cells[0], visited: [first.id], o2UsedPct: (100 * (first.departMin - 30)) / 300 } };
    const r = plan(pack, rreq);
    expect(r.order).not.toContain(first.id);
    if (r.status === 'OK') {
      verifyOk(pack, rreq, r);
      expect(r.segments[0].t0Min).toBeCloseTo(first.departMin, 9);
    }
  });

  it('A* as the leg planner is safety-checked by the same simulator', () => {
    const areq: PlanRequest = { ...req, planner: { pathSearch: 'astar', costModel: 'pandolf-santee-mars' } };
    const a = plan(pack, areq);
    expect(a.planner.pathSearch).toBe('astar');
    if (a.status === 'OK') verifyOk(pack, areq, a);
  });
});

describe('regression: mockSitePack(412, 600)', () => {
  const pack = mockSitePack(412, 600);
  const req = goldenPlanRequest(pack);
  it('default request returns a verified OK plan with a binding constraint and explained drops', () => {
    const r = plan(pack, req);
    expect(r.status).toBe('OK');
    verifyOk(pack, req, r);
    expect(r.binding?.text).toMatch(/^Limited by /);
    for (const s of req.stations) if (!r.order.includes(s.id)) expect(r.dropped.find((d) => d.id === s.id)?.text).toMatch(new RegExp(`^${s.id} dropped: `));
  });
  it('EVA staged from the pressurized rover returns a verified OK plan', () => {
    const sreq = stageFromShelter(req, 'ROVER1');
    const r = plan(pack, sreq);
    expect(r.status).toBe('OK');
    verifyOk(pack, sreq, r);
  });
});

// ─────────────────────────── real data: SitePacks/gale-v1 (skipped when not built) ───────────────────────────

describe.skipIf(!sitePackOnDisk('gale-v1'))('regression: SitePacks/gale-v1 (real Gale DEM)', () => {
  const pack = loadSitePackFromDisk('gale-v1');
  const req = goldenPlanRequest(pack);
  it('default request (EVA from Hab-1): any OK plan is verified, every drop is explained, ST12 is never selected', () => {
    const r = plan(pack, req);
    const hist: Record<string, number> = {};
    for (const d of r.dropped) hist[d.rule] = (hist[d.rule] ?? 0) + 1;
    console.log(`gale-v1 default: ${r.status} [${r.order}] binding: ${r.binding?.text}; dropped by rule ${JSON.stringify(hist)}`);
    if (r.status === 'OK') verifyOk(pack, req, r);
    for (const s of req.stations) if (!r.order.includes(s.id)) expect(r.dropped.find((d) => d.id === s.id)?.text).toMatch(new RegExp(`^${s.id} dropped: `));
    expect(r.order).not.toContain('ST12');
    expect(r.dropped.find((d) => d.id === 'ST12')?.rule).toBe('walk_radius_max_m'); // 2.5 km from Hab-1
  });
  it('EVA staged from the pressurized rover (manifest position): OK with ≥ 3 of ST01–ST07, explained drops', () => {
    const sreq = stageFromShelter(req, 'ROVER1');
    const r = plan(pack, sreq);
    console.log(`gale-v1 staged from ROVER1: ${r.status} [${r.order}] value ${r.totals.scienceValue}, ${r.totals.durationMin.toFixed(0)} min; ${r.binding?.text}`);
    expect(r.status).toBe('OK');
    expect(r.order.filter((id) => ['ST01', 'ST02', 'ST03', 'ST04', 'ST05', 'ST06', 'ST07'].includes(id)).length).toBeGreaterThanOrEqual(3);
    verifyOk(pack, sreq, r);
    expect(r.binding?.text).toMatch(/^Limited by /);
    for (const id of ['ST10', 'ST11', 'ST12']) expect(r.dropped.find((d) => d.id === id)?.rule).toBe('walk_radius_max_m');
  });
  it('a STAY_IN from Hab-1 points the EVA officer at the rover-staged alternative', () => {
    const r = plan(pack, req);
    if (r.status === 'STAY_IN') expect(r.notes.join(' ')).toMatch(/Staging the EVA from .+ gives an OK plan/);
  });
});

// ─────────────────────────── property: no unsafe OK plan ───────────────────────────

describe('property: every OK plan satisfies every hard rule (1,000 random small terrains)', () => {
  it('holds', () => {
    const packs = new Map<string, LoadedSitePack>();
    const packFor = (seed: number, size: number, cellM: number) => {
      const k = `${seed}|${size}|${cellM}`;
      let p = packs.get(k);
      if (!p) {
        p = mockSitePack(seed, size, cellM);
        packs.set(k, p);
        if (packs.size > 40) packs.delete(packs.keys().next().value as string);
      }
      return p;
    };
    let ok = 0;
    const maybe = <T,>(arb: fc.Arbitrary<T>, pct: number): fc.Arbitrary<T | undefined> =>
      fc.oneof({ weight: 100 - pct, arbitrary: fc.constant(undefined) }, { weight: pct, arbitrary: arb });
    const unit = fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1, noNaN: true }));
    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 1, max: 60 }),
          size: fc.constantFrom(40, 48, 56),
          cellM: fc.constantFrom(20, 25), // smaller cells put the mock hab inside the 400 m plume keep-out
          shelter: fc.double({ min: 12, max: 60, noNaN: true }),
          radius: fc.double({ min: 300, max: 2500, noNaN: true }),
          gap: maybe(fc.double({ min: 4, max: 60, noNaN: true }), 80),
          heat: fc.double({ min: 300, max: 520, noNaN: true }),
          sun: fc.double({ min: -5, max: 25, noNaN: true }),
          eva: fc.double({ min: 150, max: 480, noNaN: true }),
          startH: fc.double({ min: 6, max: 17, noNaN: true }),
          cut: maybe(fc.integer({ min: 1, max: 200 }), 30),
          hazard: maybe(fc.array(fc.nat(), { maxLength: 30 }), 25),
          resume: maybe(fc.record({ cellFrac: fc.double({ min: 0, max: 1, noNaN: true }), elapsed: fc.double({ min: 0, max: 250, noNaN: true }), o2: fc.double({ min: 0, max: 90, noNaN: true }), nVisited: fc.nat(4) }), 20),
          sep: maybe(fc.double({ min: 1, max: 60, noNaN: true }), 8),
          astar: fc.boolean(),
          // operator route priorities (any weights must leave every OK plan safe)
          prefs: maybe(fc.record({ distance: unit, slope: unit, rough: unit, thermal: unit, radio: unit, science: unit }), 50),
        }),
        (p) => {
          const pack = packFor(p.seed, p.size, p.cellM);
          const base = goldenPlanRequest(pack);
          const n = p.size * p.size;
          const rules = DEFAULT_RULES.map((r) => {
            switch (r.id) {
              case 'shelter_time_max_min': return { ...r, value: p.shelter };
              case 'walk_radius_max_m': return { ...r, value: p.radius };
              case 'los_gap_max_min': return p.gap === undefined ? { ...r, enabled: false } : { ...r, value: p.gap };
              case 'heat_avg_max_w': return { ...r, value: p.heat };
              case 'daylight_min_sun_elev_deg': return { ...r, value: p.sun };
              case 'eva_duration_max_min': return { ...r, value: p.eva };
              default: return r;
            }
          });
          const events: PlanRequest['events'] = [];
          if (p.cut !== undefined) events.push({ t: 'EVA_CUT', min: p.cut });
          if (p.hazard) events.push({ t: 'HAZARD', cells: p.hazard.map((x) => x % n).filter((c) => c !== base.hab) });
          if (p.sep !== undefined) events.push({ t: 'SEP_NOWCAST', leadMin: p.sep });
          const req: PlanRequest = { ...base, rules, events, startLtstMin: p.startH * 60, planner: p.astar ? { pathSearch: 'astar', costModel: 'pandolf-santee-mars' } : undefined, prefs: p.prefs };
          if (p.resume) {
            const cell = Math.min(n - 1, Math.floor(p.resume.cellFrac * n));
            req.resume = { cell, elapsedMin: p.resume.elapsed, o2UsedPct: p.resume.o2, visited: base.stations.slice(0, p.resume.nVisited).map((s) => s.id) };
          }
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
      { numRuns: 1000, seed: 20261114 },
    );
    console.log(`property: ${ok} OK plans of 1000 cases, all independently verified`);
    expect(ok).toBeGreaterThan(150); // the property is not vacuous
  }, 600_000);
});

describe('evaluateOrder', () => {
  const pack = mockSitePack(412, 600);
  const req = goldenPlanRequest(pack);
  const res = plan(pack, req);
  it('agrees with plan(): the planned order passes, with the same science value', () => {
    expect(res.status).toBe('OK');
    const ev = evaluateOrder(pack, req, res.order);
    expect(ev.pass).toBe(true);
    expect(ev.scienceValue).toBe(res.totals.scienceValue);
    expect(ev.durationMin).toBeCloseTo(res.totals.durationMin, 6);
  });
  it('flags a fixed order that breaks a hard rule (all stations in one EVA)', () => {
    const ev = evaluateOrder(pack, req, req.stations.map((s) => s.id));
    expect(ev.pass).toBe(false);
    expect(ev.failures.length > 0 || !!ev.reason).toBe(true);
  });
});
