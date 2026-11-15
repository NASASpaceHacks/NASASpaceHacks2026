import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The live pitch demo, end to end, on the real gale-v1 site pack with the real engine, driven through
 * the redesigned habitat console (① Plan → ② Send → ③ EVA live; docs/designs/console-ux.md):
 *   1 recommended plan on load, 0 clicks (rover-staged, GO) · 1b Hab-1 NO-GO explained → "Start from
 *   rover instead" · 1c rover drag · calm map + Layers panel · 2 "Why this area?" on the engine LOS
 *   field · 3 Review & send → Send to crew (package size) · 4 visor verifies Ed25519, A → ACK → EVA live
 *   (≤ 3 clicks) · 5 sim walks, crew card + timeline NOW · 6 ST04 station card, margins over time ·
 *   7 Radiation spike → v2 in 2 clicks → RETURN guidance · 8 drop link → AUTONOMOUS → restore → resync ·
 *   9 visor reload restores state · 10 credibility in Details: space weather, rule evidence, Evidence panel.
 * Console screenshots go to qa/screens/ux/, visor and evidence screenshots to qa/screens/; timings to
 * qa/screens/timings.json (read by the console's Evidence panel).
 */

const CONSOLE = 'http://localhost:15173';
const VISOR = 'http://localhost:15174';
const SCREENS = fileURLToPath(new URL('../screens/', import.meta.url));
const UX = `${SCREENS}ux/`;
const VIEW = { width: 1440, height: 900 };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** Console store snapshot (window.marswalk is the console's QA hook). */
const con$ = <T,>(p: Page, fn: (s: Any) => T): Promise<T> =>
  p.evaluate(`(${fn.toString()})(window.marswalk.state())`) as Promise<T>;
/** Visor 10 Hz snapshot (window.__visorSnap, dev builds). */
const vis$ = <T,>(p: Page, fn: (s: Any) => T): Promise<T> =>
  p.evaluate(`(${fn.toString()})(window.__visorSnap())`) as Promise<T>;

/** Screenshot with CSS animations settled (finite fades completed, blinking alerts at full contrast). */
const shot = async (p: Page, path: string) => {
  await p.screenshot({ path, animations: 'disabled' });
};

/** Wait until the console has finished a plan matching `pred` (evaluated in the page). */
const planReady = (p: Page, pred: string, timeout = 90_000) =>
  p.waitForFunction(`(() => { const s = window.marswalk && window.marswalk.state(); return !!s && s.planStatus === 'ready' && !s.dirty && (${pred}); })()`, null, { timeout });

test('Marswalk demo flow on gale-v1 (real engine): hab console ↔ surface link ↔ visor', async ({ browser }) => {
  mkdirSync(UX, { recursive: true });
  const timings: Record<string, number | string> = {};
  const errors: string[] = [];
  const conCtx = await browser.newContext({ viewport: VIEW });
  const visCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const con = await conCtx.newPage();
  const vis = await visCtx.newPage();
  for (const [name, p] of [['console', con], ['visor', vis]] as const) {
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  }
  /** Officer clicks on the main path, counted against the spec's success criteria. */
  let clicks = 0;
  const click = async (testId: string) => {
    clicks++;
    await con.getByTestId(testId).click();
  };

  await test.step('visor boots, links up and waits for a route', async () => {
    await vis.goto(`${VISOR}/?reset=1`);
    await expect(vis.getByText('AWAITING ROUTE').first()).toBeVisible();
    await expect.poll(() => vis$(vis, (s) => s.link), { timeout: 20_000 }).toBe('up');
  });

  // ── 1 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('1. the recommended plan appears on load with 0 clicks: GO, staged from PR-1 (real engine)', async () => {
    const t0 = Date.now();
    await con.goto(CONSOLE);
    const tLoad = Date.now();
    await expect(con.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
    timings.loadToVerdictMs = Date.now() - tLoad;
    timings.bootToFirstPlanMs = Date.now() - t0;
    await planReady(con, `s.plan && s.evaBase === 'ROVER1'`);
    expect(clicks).toBe(0);
    console.log(`[1] verdict visible ${timings.loadToVerdictMs} ms after load, 0 clicks`);
    expect(timings.loadToVerdictMs as number).toBeLessThanOrEqual(3_000); // success criterion: ≤ 3 s, 0 clicks
    const s = await con$(con, (s) => ({
      source: s.sourceLabel, site: s.pack.manifest.id, base: s.evaBase, status: s.plan.status, order: s.plan.order, mode: s.uiMode,
      fields: s.fieldsSource, planner: s.plannerLabel, solveMs: s.plan.solveMs, binding: s.plan.binding?.text, notes: s.plan.notes,
      durationMin: s.plan.totals.durationMin, value: s.plan.totals.scienceValue, start: s.startLtstMin, scenario: s.pack.manifest.scenario.startLtstMin,
      allOn: Object.values(s.stationOn).every(Boolean), overlays: s.overlays, vectors: s.vectors,
    }));
    console.log(`[1] ${s.status} from ${s.base}: ${s.order.join(' → ')} · value ${s.value} · ${Math.round(s.durationMin)} min · solve ${Math.round(s.solveMs)} ms · ${s.binding}`);
    expect(s.source).toBe('Hab server');
    expect(s.site).toBe('gale-v1');
    expect(s.mode).toBe('plan');
    expect(s.base).toBe('ROVER1'); // recommended plan: base = the pressurized rover
    expect(s.start).toBe(s.scenario); // … at the scenario start time
    expect(s.allOn).toBe(true); // … with every station offered
    expect(s.status).toBe('OK');
    expect(s.order.length).toBeGreaterThanOrEqual(3);
    expect(s.fields).toBe('server');
    expect(s.planner).toMatch(/pandolf-santee-mars/);
    expect(s.notes.join(' ')).not.toMatch(/golden fixture|engine unavailable/);
    // Verdict card: GO/CAUTION word, stops and duration, then the plain checklist.
    await expect(con.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await expect(con.getByTestId('verdict-headline')).toHaveText(new RegExp(`^${s.order.length} stops · \\d h \\d\\d min`));
    for (const line of ['spare', 'weather', 'daylight', 'heat', 'limit']) await expect(con.locator(`[data-line="${line}"]`)).toBeVisible();
    await expect(con.locator('[data-line="spare"]')).toContainText(/airlock \d\d:\d\d · latest safe return \d\d:\d\d/);
    await expect(con.locator('[data-line="limit"]')).toContainText(/^Limits: /);
    // Calm default map: no shading, contours, hatching or value labels until the officer asks.
    expect(s.overlays).toEqual([]);
    expect(s.vectors).toMatchObject({ outline: true, route: true, stations: true, shelters: true, imagery: true, contours: false, keepouts: false, traverse: false, stationDetail: false });
    // Timeline: one block per stop, a leave-by tick per stop, the deadline.
    await expect(con.getByTestId('timeline')).toBeVisible();
    await expect(con.getByTestId('stops-count')).toHaveText(`${s.order.length} of 12`);
    timings.planSolveMs = Math.round(s.solveMs);
    timings.planStations = s.order.length;
    // Re-plan (G): plan → fields → zone, timed in the browser.
    const t1 = Date.now();
    await con.keyboard.press('g');
    await planReady(con, `s.plan && s.plan.status === 'OK'`);
    timings.regenerateWallMs = Date.now() - t1;
    await con.waitForTimeout(700);
    await shot(con, `${UX}01-plan-go.png`);
    // Must still work at 1280 × 800: verdict and the primary action visible without scrolling.
    await con.setViewportSize({ width: 1280, height: 800 });
    await con.waitForTimeout(500);
    await expect(con.getByTestId('verdict')).toBeInViewport();
    await expect(con.getByTestId('review-send')).toBeInViewport();
    await shot(con, `${UX}01-plan-go-1280.png`);
    await con.setViewportSize(VIEW);
    await con.waitForTimeout(300);
  });

  await test.step('1b. from Hab-1: NO-GO with the physical reason in one sentence; Enter starts from the rover', async () => {
    await con.getByTestId('eva-base-HAB').click();
    await planReady(con, `s.evaBase === 'HAB' && s.plan && s.plan.status === 'STAY_IN'`);
    const card = con.getByTestId('stayin-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-verdict', 'NO-GO');
    await expect(card).toContainText('No safe walk from Hab-1');
    await expect(con.getByTestId('stayin-reason')).toContainText(/below Hab-1: the climb back costs ≈\d+ W against the suit's 352 W cooling limit/);
    await expect(con.getByTestId('stayin-binding')).toContainText('PR-1'); // engine: "staging from ROVER1 allows …", relabelled
    await expect(con.getByTestId('stayin-why')).toContainText(/suit-heat budget/); // full physics behind "Show the physics"
    await expect(con.getByTestId('stage-from-rover')).toHaveText(/Start from rover instead/);
    await expect(con.getByTestId('review-send')).toHaveCount(0); // nothing to send from here
    console.log(`[1b] ${await con.getByTestId('stayin-reason').textContent()}`);
    await con.waitForTimeout(400);
    await shot(con, `${UX}02-plan-nogo-hab.png`);
    // Enter = the primary action of the current mode (here: start from the rover).
    await con.evaluate(`document.activeElement && document.activeElement.blur()`);
    await con.keyboard.press('Enter');
    await planReady(con, `s.evaBase === 'ROVER1' && s.plan && s.plan.status === 'OK'`);
  });

  await test.step('1c. dragging the rover on the map re-plans with the rover as the EVA base', async () => {
    await con.getByTestId('eva-base-HAB').click();
    await planReady(con, `s.evaBase === 'HAB' && s.plan && s.plan.status === 'STAY_IN'`);
    // Pixel of PR-1 on the OpenLayers map (page coordinates).
    const px = (await con.evaluate(`(() => {
      const s = window.marswalk.state();
      const r = s.pack.manifest.shelters.find((x) => x.id === 'ROVER1');
      const c = s.shelterCells.ROVER1, g = s.pack.manifest.grid;
      const x = g.originX + ((c % g.w) + 0.5) * g.cellM, y = g.originY - (Math.floor(c / g.w) + 0.5) * g.cellM;
      const m = window.marswalk.actions.getMap().map;
      const p = m.getPixelFromCoordinate([x, y]);
      const b = m.getTargetElement().getBoundingClientRect();
      return [b.left + p[0], b.top + p[1], r.cell];
    })()`)) as [number, number, number];
    await con.mouse.move(px[0], px[1]);
    await con.mouse.down();
    await con.mouse.move(px[0] + 40, px[1] + 25, { steps: 6 });
    await con.mouse.move(px[0], px[1], { steps: 6 }); // drop it back where it was
    await con.mouse.up();
    await planReady(con, `s.evaBase === 'ROVER1' && s.plan && s.plan.status === 'OK'`);
    const log = await con$(con, (s) => s.log.slice(0, 4).map((l: { text: string }) => l.text).join(' | '));
    expect(log).toMatch(/Replanned after rover move: \d+ stations from PR-1/);
  });

  await test.step('1d. Layers: real data layers in groups; a layer shows its legend when on', async () => {
    await con.getByTestId('layers-button').click();
    await con.getByTestId('layer-shelter').getByRole('switch').click();
    expect(await con$(con, (s) => s.overlays)).toEqual(['shelter']);
    await expect(con.getByTestId('layer-shelter').getByTestId('layer-legend')).toContainText(/min/);
    await con.waitForTimeout(500);
    await shot(con, `${UX}03-layers-open.png`);
    for (const l of ['Radio coverage (line of sight to Hab-1 / PR-1)', 'Slope', 'Walk-back time', 'Keep-out zones', 'Curiosity traverse']) await expect(con.getByTestId('layers-panel').getByText(l, { exact: true }).first()).toBeVisible();
    await con.getByTestId('layer-shelter').getByRole('switch').click(); // back to the calm view
    await con.keyboard.press('Escape');
    expect(await con$(con, (s) => [s.overlays.length, s.layersOpen])).toEqual([0, false]);
  });

  // ── 2 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('2. "Why this area?" — the explanation uses the engine LOS field from /api/fields/:reqHash/los', async () => {
    const r = (await con.evaluate(`(async () => {
      const s = window.marswalk.state();
      const res = await fetch('/api/fields/' + s.plan.reqHash + '/los');
      const los = new Uint8Array(await res.arrayBuffer());
      let ones = 0, fieldMismatch = 0, zoneMismatch = 0;
      for (let i = 0; i < los.length; i++) {
        if (los[i] === 1) ones++;
        if (s.fields.los[i] !== los[i]) fieldMismatch++;
        if ((s.zone.losGap[i] === 0) !== (los[i] === 1)) zoneMismatch++;
      }
      return { n: los.length, ones, fieldMismatch, zoneMismatch, losSource: s.losSource };
    })()`)) as { n: number; ones: number; fieldMismatch: number; zoneMismatch: number; losSource: string };
    console.log(`[2] engine LOS: ${r.ones} of ${r.n} cells in comm line of sight · zone gap source ${r.losSource}`);
    expect(r.n).toBe(1_000_000);
    expect(r.ones).toBeGreaterThan(1000);
    expect(r.fieldMismatch).toBe(0);
    expect(r.zoneMismatch).toBe(0);
    expect(r.losSource).toBe('engine');

    await con.getByTestId('why-area').click();
    await con.waitForFunction(`window.marswalk.state().explain.step === 5`, null, { timeout: 30_000 });
    expect(await con$(con, (s) => s.explain.detail)).toMatch(/Engine comm line of sight/);
    await con.waitForFunction(`window.marswalk.state().explain.step === 7`, null, { timeout: 30_000 });
    expect(await con$(con, (s) => s.explain.caption)).toMatch(/Route from PR-1/);
    await con.waitForTimeout(1900); // route draws itself inside the safe region
    await shot(con, `${UX}03b-why-this-area.png`);
    await con.waitForFunction(`!window.marswalk.state().explain.running`, null, { timeout: 15_000 });
  });

  // ── 3 / 4 ────────────────────────────────────────────────────────────────────────────────────────
  let tConfirm = 0;
  await test.step('3. Review & send → the crew brief → Send to crew pushes route v1 (package size shown)', async () => {
    clicks = 0;
    await click('review-send');
    const brief = con.getByTestId('crew-brief');
    await expect(brief).toBeVisible();
    expect(await con$(con, (s) => s.uiMode)).toBe('send');
    await expect(con.getByTestId('review-route')).toHaveText(/^PR-1 → .+ → PR-1$/);
    await expect(con.getByTestId('watch-list').locator('li')).toHaveCount(3);
    await expect(brief.getByText(/Leave by/).first()).toBeVisible();
    await expect(con.getByTestId('package-size')).toContainText(/Route package ≈[\d.]+ KB · fits/);
    await con.waitForTimeout(500);
    await shot(con, `${UX}04-send-brief.png`);
    tConfirm = Date.now();
    await click('send-to-crew');
    await expect(con.getByTestId('route-sent').or(con.getByTestId('route-acked')).first()).toBeVisible();
    await expect(con.getByTestId('package-size')).toContainText(/Route package [\d.]+ KB · fits/);
    const route = await con$(con, (s) => s.route);
    console.log(`[3] v${route.seq} pushed · ${route.bytes} B${route.estimated ? ' (estimate)' : ''}`);
    expect(route.seq).toBe(1);
    expect(route.estimated).toBeFalsy();
    expect(route.bytes).toBeGreaterThan(500);
    expect(route.bytes).toBeLessThanOrEqual(25_000);
    timings.packageBytes = route.bytes;
  });

  await test.step('4. visor receives v1 and verifies the signature; A → "Accepted by EV1" → EVA live (≤ 3 clicks)', async () => {
    await expect(vis.getByText('ED25519 ✓ VERIFIED').first()).toBeVisible();
    timings.confirmToVisorVerifiedMs = Date.now() - tConfirm;
    await expect(vis.getByText(/^PR-1\s+›\s+ST\d\d.*›\s+PR-1$/)).toBeVisible();
    await shot(vis, `${SCREENS}04b-visor-new-route.png`);
    const tA = Date.now();
    clicks++; // the visor's A
    await vis.keyboard.press('a');
    await expect(con.getByTestId('route-acked').first()).toContainText('Accepted by EV1');
    timings.acceptToAckMs = Date.now() - tA;
    timings.confirmToAckMs = Date.now() - tConfirm;
    expect(await vis$(vis, (s) => [s.seq, s.display, s.homeName])).toEqual([1, 'NAV', 'PR-1']);
    await expect.poll(() => con$(con, (s) => s.uiMode), { timeout: 6_000 }).toBe('live'); // straight into EVA live
    console.log(`[4] plan → crew acceptance in ${clicks} clicks`);
    expect(clicks).toBeLessThanOrEqual(3); // success criterion
    timings.planToAcceptClicks = clicks;
  });

  // ── 5 ────────────────────────────────────────────────────────────────────────────────────────────
  let firstStop = '';
  await test.step('5. the visor sim walks (Simulation menu); the crew card and timeline NOW follow it', async () => {
    firstStop = await con$(con, (s) => s.plan.order[0]);
    await con.getByTestId('sim-menu').click();
    await con.getByRole('button', { name: '30×' }).click();
    const t0 = Date.now();
    await con.getByTestId('sim-run').click();
    await con.waitForFunction(`window.marswalk.state().telem.length >= 3`, null, { timeout: 30_000 });
    timings.runToTelemMs = Date.now() - t0;
    await con.keyboard.press('Escape');
    await expect(con.getByTestId('telemetry')).toBeVisible();
    await expect(con.getByTestId('crew-status')).toHaveText(/^(On plan|\d+ min (ahead|behind)|Tracking)$/);
    await expect(con.getByTestId('crew-next')).toContainText(/^Next: /);
    for (const k of ['spare', 'shelter', 'o2', 'heat', 'link']) await expect(con.locator(`[data-testid="telemetry"] [data-key="${k}"]`)).toBeVisible();
    await expect(con.getByTestId('timeline-now')).toBeVisible();
    await expect(con.getByTestId('timeline-delta')).toContainText(/NOW \d\d:\d\d · /);
    const v = await vis$(vis, (s) => ({ display: s.display, next: s.next?.id, t: s.t }));
    console.log(`[5] TELEM flowing after ${timings.runToTelemMs} ms · visor ${v.display} → ${v.next} at T+${v.t.toFixed(1)} min`);
    expect(v.display).toBe('NAV');
    expect(v.next).toBe(firstStop);
    await shot(vis, `${SCREENS}05-visor-nav.png`);
  });

  await test.step('5b. Details → Space weather: three labelled tiers (ENLIL forecast, light-delayed alert, onboard nowcast)', async () => {
    await con.getByTestId('open-details').click();
    await con.getByTestId('details-tab-weather').click();
    const forecast = con.getByTestId('tier-forecast');
    await expect(forecast).toContainText(/WSA-ENLIL/);
    await expect(con.getByTestId('forecast-status')).toHaveText(/^(Go|Caution)$/i);
    await expect(con.getByTestId('forecast-verdict')).toContainText(/±24 h of the EVA start/);
    expect(await forecast.locator('a[href*="ccmc.gsfc.nasa.gov/DONKI"]').count()).toBeGreaterThanOrEqual(3);
    // Alert tier: one-way light time from the hab server Earth relay (JPL approximate positions).
    await expect(con.getByTestId('light-time')).toHaveText(/^\d{1,2}\.\d{2}\s*min$/, { timeout: 10_000 });
    const lt = Number((await con.getByTestId('light-time').textContent())!.replace(/[^\d.]/g, ''));
    expect(lt).toBeGreaterThan(3);
    expect(lt).toBeLessThan(23); // Earth–Mars one-way light time is 3–22 min
    await expect(con.getByTestId('tier-nowcast')).toContainText(/only tier that orders return now/i);
    timings.lightTimeMin = lt;
    console.log(`[5b] forecast ${await con.getByTestId('forecast-status').textContent()} · light time ${lt} min`);
    await con.keyboard.press('Escape');
    await expect(con.getByTestId('details')).toBeHidden();
  });

  // ── 6 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('6. arrival at the first station: science + Curiosity photo; margins over time, plan vs actual', async () => {
    await expect.poll(() => vis$(vis, (s) => s.display), { timeout: 90_000, intervals: [200] }).toBe('STATION');
    await con.evaluate(`window.marswalk.actions.setSim({ speed: 5 })`); // linger at the station
    const st = await vis$(vis, (s) => s.station);
    expect(st.id).toBe(firstStop);
    expect(st.objectives.length).toBeGreaterThan(0);
    expect(st.image?.url).toMatch(/\/sitepacks\/gale-v1\/images\/.+\.jpg$/);
    await expect(vis.getByText(st.name).first()).toBeVisible();
    const img = vis.locator(`img[src="${st.image.url}"]`);
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(100);
    await expect.poll(() => vis$(vis, (s) => s.toasts.length), { timeout: 10_000 }).toBe(0); // arrival toast clears
    await shot(vis, `${SCREENS}06-station.png`);
    await expect(con.getByTestId('crew-next')).toContainText(new RegExp(`Leave ${firstStop} at \\d\\d:\\d\\d`));
    await con.waitForTimeout(600);
    await shot(con, `${UX}05-eva-live.png`);
    // In EVA live the crew status, next event and biggest risk are readable without scrolling (also at 1280 × 800).
    await con.setViewportSize({ width: 1280, height: 800 });
    await con.waitForTimeout(500);
    for (const id of ['crew-status', 'crew-next', 'crew-risk', 'action-dock']) await expect(con.getByTestId(id)).toBeInViewport();
    await shot(con, `${UX}05-eva-live-1280.png`);
    await con.setViewportSize(VIEW);
    await con.waitForTimeout(300);

    await con.getByTestId('open-details').click();
    await con.getByTestId('details-tab-margins').click();
    await expect(con.getByTestId('burndown-met')).toBeVisible();
    await expect.poll(async () => Number(await con.getByTestId('burndown-heat').getAttribute('data-actual-points'))).toBeGreaterThan(3);
    await shot(con, `${UX}07b-details-margins.png`);
    await con.keyboard.press('Escape');

    // Plan vs actual: the visor sim uses the engine's metabolic power and heat governor, so its TELEM
    // tracks the plan's burndown (heat average) instead of a constant placeholder.
    const cmp = await con$(con, (s) => {
      const b = s.plan.burndown as { tMin: number; heatAvgW: number; metW: number }[];
      const out: { t: number; act: number; plan: number; met: number }[] = [];
      for (const t of s.telem as { t: number; heatAvgW: number; metW: number }[]) {
        let best = b[0];
        for (const p of b) if (Math.abs(p.tMin - t.t) < Math.abs(best.tMin - t.t)) best = p;
        if (Math.abs(best.tMin - t.t) <= 1) out.push({ t: t.t, act: t.heatAvgW, plan: best.heatAvgW, met: t.metW });
      }
      return out;
    });
    const diffs = cmp.map((c) => Math.abs(c.act - c.plan)).sort((a, b) => a - b);
    const median = diffs[Math.floor(diffs.length / 2)];
    const mets = cmp.map((c) => c.met);
    console.log(`[6] heat avg plan vs actual: ${cmp.length} samples, median |Δ| ${median?.toFixed(1)} W, max ${diffs[diffs.length - 1]?.toFixed(1)} W; TELEM metW ${Math.min(...mets)}–${Math.max(...mets)} W`);
    expect(cmp.length).toBeGreaterThan(3);
    expect(median).toBeLessThan(30);
    expect(Math.max(...mets)).toBeGreaterThan(400); // Pandolf–Santee walking power, not the old ~290 W placeholder
    timings.heatPlanVsActualMedianW = Math.round(median * 10) / 10;
  });

  // ── 7 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('7. Radiation spike → engine return route as a change → Send to crew (2 clicks) → v2 → RETURN guidance', async () => {
    clicks = 0;
    const t0 = Date.now();
    await click('action-sep'); // nowcast tier: onboard dose rate +25 %
    await expect(con.getByTestId('action-sheet')).toBeVisible();
    await con.waitForFunction(`(() => { const s = window.marswalk.state(); return !s.busyEvent && s.planStatus === 'ready' && s.plan && /SEP/.test(s.plan.binding ? s.plan.binding.text : ''); })()`, null, { timeout: 15_000 });
    timings.sepReplanWallMs = Date.now() - t0;
    const p = await con$(con, (s) => ({ status: s.plan.status, solveMs: s.plan.solveMs, from: s.plan.segments[0]?.from, to: s.plan.segments[s.plan.segments.length - 1]?.to, binding: s.plan.binding.text }));
    console.log(`[7] SEP replan: ${p.status} ${p.from} → ${p.to} · solve ${Math.round(p.solveMs)} ms · wall ${timings.sepReplanWallMs} ms · ${p.binding}`);
    timings.sepReplanSolveMs = Math.round(p.solveMs);
    expect(p.status).toBe('OK');
    expect(p.from).toBe('HERE');
    expect(p.solveMs).toBeLessThan(1000);
    expect(timings.sepReplanWallMs as number).toBeLessThan(1500);
    // The hab warns the crew at once (ALERT, from: 'hab'), before v2 is even sent.
    await expect(vis.getByText('RETURN NOW', { exact: true }).first()).toBeVisible();
    await expect(vis.getByText(/HAB ALERT · SEP NOWCAST/)).toBeVisible();
    await expect(con.getByTestId('sheet-change')).toContainText(/Return to (PR-1|Hab-1) now · \d+ min/);
    await expect.poll(() => con$(con, (s) => s.alerts.some((a: { title: string }) => /radiation spike/i.test(a.title))), { timeout: 5_000 }).toBe(true); // alert banner queue
    await expect(con.getByRole('alert').first()).toBeVisible();
    await con.waitForTimeout(400);
    await shot(con, `${UX}06-emergency-sheet.png`);

    const t1 = Date.now();
    await click('sheet-send');
    await expect(vis.getByText('NEW ROUTE').first()).toBeVisible();
    await expect(vis.getByText('ED25519 ✓ VERIFIED').first()).toBeVisible();
    await expect(vis.getByText(/^HERE\s+›\s+(PR-1|HAB-1)$/)).toBeVisible();
    expect(clicks).toBe(2); // success criterion: emergency → new route sent in 2 clicks
    timings.emergencyClicks = clicks;
    await vis.keyboard.press('a');
    await expect(con.getByTestId('route-acked').first()).toContainText('v2');
    timings.confirmV2ToAckMs = Date.now() - t1;
    await expect(vis.getByText('RETURN NOW', { exact: true }).first()).toBeVisible();
    await expect(vis.getByText(/Distance to (PR-1|HAB-1) along confirmed route/i)).toBeVisible();
    const v = await vis$(vis, (s) => ({ seq: s.seq, display: s.display, target: s.ret?.target }));
    expect(v.seq).toBe(2);
    expect(v.display).toBe('RETURN_NOW');
    await expect(con.getByTestId('action-sheet')).toBeHidden({ timeout: 6_000 });
    await expect(con.getByTestId('crew-status')).toContainText(/Returning to (PR-1|Hab-1)/);
    await con.evaluate(`window.marswalk.actions.setSim({ speed: 10 })`);
    await vis.waitForTimeout(1200);
    await shot(vis, `${SCREENS}07-sep-replan.png`);
  });

  // ── 8 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('8. drop link (Simulation menu) → visor AUTONOMOUS within ~3 s and keeps guiding; restore → resync', async () => {
    await con.getByTestId('sim-menu').click();
    const t0 = Date.now();
    await con.getByRole('button', { name: 'Drop link' }).click();
    await expect(vis.getByText(/LINK LOST — AUTONOMOUS/).first()).toBeVisible({ timeout: 8_000 });
    timings.dropToAutonomousMs = Date.now() - t0;
    expect(timings.dropToAutonomousMs as number).toBeLessThan(4_500);
    const simT1 = await vis$(vis, (s) => s.t);
    await vis.waitForTimeout(1500);
    const v = await vis$(vis, (s) => ({ t: s.t, display: s.display, outbox: s.outbox, autonomous: s.autonomous }));
    expect(v.autonomous).toBe(true);
    expect(v.t).toBeGreaterThan(simT1); // still walking and guiding on board
    expect(v.display).toBe('RETURN_NOW');
    await expect.poll(() => con$(con, (s) => s.link), { timeout: 10_000 }).toBe('down');
    await expect(con.getByTestId('crew-link')).toHaveAttribute('data-link', 'down');
    await expect(con.getByRole('alert').filter({ hasText: 'Crew link lost' })).toBeVisible();
    await shot(vis, `${SCREENS}08-autonomous.png`);

    const lastT = await con$(con, (s) => s.telem[s.telem.length - 1].t);
    await vis.waitForTimeout(2500); // let a few TELEM queue up on board
    const simAtRestore = await vis$(vis, (s) => s.t);
    const t1 = Date.now();
    await con.getByRole('button', { name: 'Restore link' }).click();
    await con.waitForFunction(`(() => { const s = window.marswalk.state(); const l = s.telem[s.telem.length - 1]; return s.link === 'up' && !!l && l.t >= ${simAtRestore}; })()`, null, { timeout: 20_000 });
    timings.restoreToResyncMs = Date.now() - t1;
    // TELEM sampled while the link was down arrives through the store-and-forward queue (gap back-filled).
    const backfill = (await con.evaluate(`window.marswalk.state().telem.filter((x) => x.t > ${lastT} && x.t < ${simAtRestore}).length`)) as number;
    console.log(`[8] AUTONOMOUS after ${timings.dropToAutonomousMs} ms · resync ${timings.restoreToResyncMs} ms · ${backfill} queued TELEM back-filled`);
    expect(backfill).toBeGreaterThan(0);
    await expect.poll(() => vis$(vis, (s) => [s.autonomous, s.outbox]), { timeout: 10_000 }).toEqual([false, 0]);
    await con.keyboard.press('Escape');
  });

  // ── 9 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('9. reload the visor: route, position and return order restore', async () => {
    const before = await vis$(vis, (s) => ({ seq: s.seq, t: s.t, display: s.display, home: s.homeName }));
    await vis.reload();
    await expect(vis.getByText(/WARM RESTART/).first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => vis$(vis, (s) => s.ready)).toBe(true);
    await vis.waitForTimeout(1500); // boot splash fades out
    const after = await vis$(vis, (s) => ({ seq: s.seq, t: s.t, display: s.display, home: s.homeName, ms: s.restoredInMs }));
    console.log(`[9] restored v${after.seq} at T+${after.t.toFixed(1)} min (${after.display}) in ${Math.round(after.ms)} ms`);
    expect(after.seq).toBe(before.seq);
    expect(after.home).toBe(before.home);
    expect(after.t).toBeGreaterThanOrEqual(before.t - 0.5);
    expect(after.display).toBe(before.display);
    timings.visorRestoreMs = Math.round(after.ms);
    await shot(vis, `${SCREENS}09-warm-restart.png`);
  });

  // ── 10 ───────────────────────────────────────────────────────────────────────────────────────────
  await test.step('10. credibility in Details: rule evidence chips, Evidence panel (V1, V2, V7, live timings), limitations', async () => {
    await con.evaluate(`window.marswalk.actions.setSim({ running: false })`);
    await con.evaluate(`window.marswalk.actions.ackAllAlerts()`);
    await con.getByTestId('open-details').click();
    await con.getByTestId('details-tab-rules').click();
    const rules = con.getByTestId('rules');
    const chips = await rules.locator('[data-evidence]').evaluateAll((els) => els.map((e) => e.getAttribute('data-evidence')));
    const expected = await con$(con, (s) => s.rules.filter((r: { evidence?: string }) => r.evidence).map((r: { evidence: string }) => r.evidence));
    expect(chips).toEqual(expected);
    expect(new Set(chips).size).toBeGreaterThanOrEqual(3);
    await expect(con.getByTestId('evidence-legend').first()).toContainText(/Measured.*Analog.*NASA requirement.*Simulated.*Team assumption/);
    await con.waitForTimeout(400);
    await shot(con, `${UX}07-details-drawer.png`);
    // Everything that used to sit on screen is still one click away in Details.
    for (const t of ['report', 'margins', 'weather', 'science', 'sources', 'log']) await expect(con.getByTestId(`details-tab-${t}`)).toBeVisible();

    await con.keyboard.press('e');
    const panel = con.getByTestId('evidence-panel');
    await expect(panel).toBeVisible();
    await expect(con.getByTestId('evidence-v1')).toContainText('2.0');
    await expect(con.getByTestId('evidence-v1')).toContainText(/r = 0\.94 · n = 15/);
    await expect(con.getByTestId('evidence-v1')).toContainText('4.3');
    await expect(con.getByTestId('evidence-v2')).toContainText('10.6');
    await expect(con.getByTestId('evidence-v7')).toContainText('0.000');
    await expect(con.getByTestId('evidence-v7')).toContainText(/140–166/);
    await expect(con.getByTestId('evidence-live')).toContainText(/KB of 28 KB/);
    const fig = con.locator('[data-testid="evidence-v1"] img');
    await expect.poll(() => fig.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(500);
    expect(await panel.textContent()).not.toMatch(/\bvalidated?\b/i); // wording: reproduces / calibrated
    await con.waitForTimeout(400);
    await shot(con, `${SCREENS}12-evidence.png`);
    await con.getByTestId('evidence-limitations').scrollIntoViewIfNeeded();
    await expect(con.getByTestId('limitations').locator('li')).toHaveCount(7);
    await expect(con.getByTestId('limitations')).toContainText(/fail closed/);
    await con.waitForTimeout(300);
    await shot(con, `${SCREENS}13-limitations.png`);
    await con.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await con.keyboard.press('Escape');
    await expect(con.getByTestId('details')).toBeHidden();
  });

  timings.runUtc = new Date().toISOString();
  writeFileSync(`${SCREENS}timings.json`, JSON.stringify(timings, null, 2) + '\n');
  console.log('[timings]', JSON.stringify(timings));
  expect(errors).toEqual([]);
  await conCtx.close();
  await visCtx.close();
});
