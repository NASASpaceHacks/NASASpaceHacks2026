import { describe, expect, it } from 'vitest';
import { goldenPlanRequest, mockSitePack } from '../contracts';
import type { GridSpec, PlanPackage } from '../contracts/types';
import { computeFields, createSafetyCore, decodePackage, encodePackage, plan, toPlanPackage } from './index';

describe('safety core on a real plan (1000×1000 mock)', () => {
  const pack = mockSitePack(412, 1000);
  const req = goldenPlanRequest(pack);
  const res = plan(pack, req);
  const fields = computeFields(pack, req);
  const g = pack.manifest.grid;
  const pkg = decodePackage(encodePackage(toPlanPackage(res, req, fields, g, { seq: 1, author: 'hab' })));
  const deadline = res.bingo.find((b) => b.id === 'HAB')!.tMin;
  // per-route-cell planned time (linear within each leg; stops hold at their arrival)
  const times: number[] = [];
  for (const s of res.segments) s.cells.forEach((_, k) => times.push(s.t0Min + ((s.t1Min - s.t0Min) * k) / Math.max(1, s.cells.length - 1)));

  it('coarse margins are conservative and match the dense fields within the coarse-cell tolerance', () => {
    const core = createSafetyCore(pkg, g);
    let within = 0;
    let worstGap = 0;
    for (let i = 0; i < pkg.route.length; i++) {
      const c = pkg.route[i];
      const st = core.update(c, times[i], 50);
      const denseWb = deadline - times[i] - fields.walkbackMin[c];
      const denseSh = 30 - fields.shelterMin[c];
      expect(st.walkbackMarginMin).toBeLessThanOrEqual(denseWb + 1e-6); // never optimistic
      expect(st.shelterMarginMin).toBeLessThanOrEqual(denseSh + 1e-6);
      const gap = denseWb - st.walkbackMarginMin;
      worstGap = Math.max(worstGap, gap);
      // tolerance: crossing a 50 m block diagonally at the walkback pace (0.5 × 0.56 m/s) + 1 min rounding
      if (gap <= (50 * Math.SQRT2) / (0.28 * 60) + 1) within++;
    }
    console.log(`safety core: ${((100 * within) / pkg.route.length).toFixed(1)} % of route cells within the coarse tolerance; worst gap ${worstGap.toFixed(1)} min`);
    expect(within / pkg.route.length).toBeGreaterThan(0.9);
  });

  it('tracks progress, stops, distance and bingo along the route', () => {
    const core = createSafetyCore(pkg, g);
    let lastIdx = -1;
    const seen: string[] = [];
    let prevDist = Infinity, prevStop: string | null = null;
    for (let i = 0; i < pkg.route.length; i++) {
      const st = core.update(pkg.route[i], times[i], 60);
      expect(st.offRouteM).toBe(0);
      expect(st.routeIdx).toBeGreaterThanOrEqual(lastIdx);
      lastIdx = st.routeIdx;
      if (st.nextStopId !== prevStop) {
        if (st.nextStopId) seen.push(st.nextStopId);
        prevStop = st.nextStopId;
        prevDist = Infinity;
      }
      expect(st.distToNextM).toBeLessThanOrEqual(prevDist + 1e-9);
      prevDist = st.distToNextM;
      if (st.nextStopId) expect(st.bingoInMin).toBeCloseTo(res.bingo.find((b) => b.id === st.nextStopId)!.tMin - times[i], 9);
    }
    expect(seen).toEqual(res.order);
  });

  it('status escalates as time runs out; update allocates nothing (same object)', () => {
    const core = createSafetyCore(pkg, g);
    const c = pkg.route[Math.floor(pkg.route.length / 2)];
    const a = core.update(c, 40, 90);
    expect(a.status).toBe('NOMINAL');
    const wb = deadline - pkg.coarse.walkbackMin[Math.floor(Math.floor(c / g.w) / 10) * 100 + Math.floor((c % g.w) / 10)];
    expect(core.update(c, wb - 10, 50).status).toBe('CAUTION');
    expect(core.update(c, wb + 1, 50).status).toBe('RETURN_NOW');
    expect(core.update(c, 40, 0).status).toBe('RETURN_NOW');
    expect(core.update(c, 41, 50)).toBe(a);
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) core.update(pkg.route[i % pkg.route.length], 100, 50);
    console.log(`safety core: ${((1000 * (performance.now() - t0)) / 100_000).toFixed(2)} µs / update`);
  });

  it('re-acquires the route after a large (> 50 m) jump', () => {
    const core = createSafetyCore(pkg, g);
    core.update(pkg.route[0], 31, 99);
    // a route cell > 50 m from every cell of the initial tracking window
    const win = pkg.route.slice(0, 121);
    const far = pkg.route.find((c) => win.every((x) => Math.hypot(Math.floor(c / g.w) - Math.floor(x / g.w), (c % g.w) - (x % g.w)) > 10.5));
    if (far === undefined) return; // compact route: nothing to test
    let st = core.update(far, 200, 40);
    for (let k = 0; k < Math.ceil(pkg.route.length / 256) + 1; k++) st = core.update(far, 200, 40);
    expect(st.offRouteM).toBe(0);
    expect(pkg.route[st.routeIdx]).toBe(far);
  });
});

describe('safety core geometry (synthetic flat route)', () => {
  const grid: GridSpec = { w: 100, h: 100, cellM: 5, proj4: '+proj=eqc +R=3396190', originX: 0, originY: 0, centerLonLat: [0, 0] };
  const row = 50;
  const route = [...Array.from({ length: 41 }, (_, k) => row * 100 + 10 + k), ...Array.from({ length: 41 }, (_, k) => row * 100 + 50 + k)]; // stop at col 50 (repeated)
  const coarse = { cellM: 50, w: 10, h: 10, walkbackMin: Array.from({ length: 100 }, (_, i) => Math.abs((i % 10) - 1) * 5 + Math.abs(Math.floor(i / 10) - 5) * 5), shelterMin: new Array(100).fill(10) };
  const pkg: PlanPackage = {
    v: 1, id: 'x', seq: 1, author: 'hab', createdUtc: '', siteId: 's', rulesHash: '', route, order: ['ST01'],
    stops: [{ id: 'ST01', arriveMin: 40, departMin: 60, arriveLtstMin: 640 }],
    bingo: [{ id: 'ST01', tMin: 90, ltstMin: 690, text: '' }, { id: 'HAB', tMin: 300, ltstMin: 900, text: '' }],
    startLtstMin: 600, sol: 1, coarse, sig: '',
  };
  it('bearings are clockwise from grid north; return bearing descends the walkback grid', () => {
    const core = createSafetyCore(pkg, grid);
    const st = core.update(row * 100 + 20, 35, 90);
    expect(st.nextStopId).toBe('ST01');
    expect(st.bearingToNextDeg).toBeCloseTo(90, 9); // due east
    expect(st.distToNextM).toBeCloseTo(30 * 5, 9);
    expect(st.returnBearingDeg).toBeCloseTo(270, 9); // walkback decreases toward col block 1 (west)
    const off = core.update(40 * 100 + 30, 36, 90); // 10 cells north of the route
    expect(off.offRouteM).toBeCloseTo(50, 9);
    expect(off.bearingToNextDeg).toBeCloseTo((Math.atan2(20, -10) * 180) / Math.PI, 9); // ESE… toward (row 50, col 50)
    const past = core.update(row * 100 + 70, 70, 80);
    expect(past.nextStopId).toBeNull();
    expect(past.bingoInMin).toBeCloseTo(300 - 70, 9);
  });
});
