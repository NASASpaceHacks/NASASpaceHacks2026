import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The live pitch demo, end to end, on the real gale-v1 site pack with the real engine:
 *   1 plan (rover-staged, OK) · 1b Hab-1 STAY IN explained → stage from PR-1 · 2 explain safe zone on
 *   the engine LOS field · 3 CONFIRM v1 (package size) · 4 visor verifies Ed25519, A → ACK · 5 sim walks,
 *   TELEM + plan vs actual · 6 ST04 station card with Curiosity photo · 7 SEP nowcast → replan → v2 →
 *   RETURN guidance · 8 drop link → AUTONOMOUS → restore → TELEM resync · 9 visor reload restores state.
 * Screenshots of each demo moment go to qa/screens/ (committed); timings to qa/screens/timings.json.
 */

const CONSOLE = 'http://localhost:15173';
const VISOR = 'http://localhost:15174';
const SCREENS = fileURLToPath(new URL('../screens/', import.meta.url));
const VIEW = { width: 1600, height: 900 };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** Console store snapshot (window.marswalk is the console's QA hook). */
const con$ = <T,>(p: Page, fn: (s: Any) => T): Promise<T> =>
  p.evaluate(`(${fn.toString()})(window.marswalk.state())`) as Promise<T>;
/** Visor 10 Hz snapshot (window.__visorSnap, dev builds). */
const vis$ = <T,>(p: Page, fn: (s: Any) => T): Promise<T> =>
  p.evaluate(`(${fn.toString()})(window.__visorSnap())`) as Promise<T>;

/** Screenshot with CSS animations settled (finite fades completed, blinking alerts at full contrast). */
const shot = async (p: Page, name: string) => {
  await p.screenshot({ path: `${SCREENS}${name}.png`, animations: 'disabled' });
};

/** Wait until the console has finished a plan matching `pred` (evaluated in the page). */
const planReady = (p: Page, pred: string, timeout = 90_000) =>
  p.waitForFunction(`(() => { const s = window.marswalk && window.marswalk.state(); return !!s && s.planStatus === 'ready' && !s.dirty && (${pred}); })()`, null, { timeout });

test('Marswalk demo flow on gale-v1 (real engine): hab console ↔ surface link ↔ visor', async ({ browser }) => {
  mkdirSync(SCREENS, { recursive: true });
  const timings: Record<string, number | string> = {};
  const errors: string[] = [];
  const conCtx = await browser.newContext({ viewport: VIEW });
  const visCtx = await browser.newContext({ viewport: VIEW });
  const con = await conCtx.newPage();
  const vis = await visCtx.newPage();
  for (const [name, p] of [['console', con], ['visor', vis]] as const) {
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  }

  await test.step('visor boots, links up and waits for a route', async () => {
    await vis.goto(`${VISOR}/?reset=1`);
    await expect(vis.getByText('AWAITING ROUTE').first()).toBeVisible();
    await expect.poll(() => vis$(vis, (s) => s.link), { timeout: 20_000 }).toBe('up');
  });

  // ── 1 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('1. console generates an OK plan staged from PR-1 on gale-v1 (real engine)', async () => {
    const t0 = Date.now();
    await con.goto(CONSOLE);
    await planReady(con, `s.plan && s.evaBase === 'ROVER1'`);
    timings.bootToFirstPlanMs = Date.now() - t0;
    const s = await con$(con, (s) => ({
      source: s.sourceLabel, site: s.pack.manifest.id, base: s.evaBase, status: s.plan.status, order: s.plan.order,
      fields: s.fieldsSource, planner: s.plannerLabel, solveMs: s.plan.solveMs, binding: s.plan.binding?.text, notes: s.plan.notes,
      durationMin: s.plan.totals.durationMin, value: s.plan.totals.scienceValue,
    }));
    console.log(`[1] ${s.status} from ${s.base}: ${s.order.join(' → ')} · value ${s.value} · ${Math.round(s.durationMin)} min · solve ${Math.round(s.solveMs)} ms · ${s.binding}`);
    expect(s.source).toBe('Hab server');
    expect(s.site).toBe('gale-v1');
    expect(s.base).toBe('ROVER1'); // default EVA base = the pressurized rover
    expect(s.status).toBe('OK');
    expect(s.order.length).toBeGreaterThanOrEqual(3);
    expect(s.fields).toBe('server');
    expect(s.planner).toMatch(/pandolf-santee-mars/);
    expect(s.notes.join(' ')).not.toMatch(/golden fixture|engine unavailable/);
    timings.planSolveMs = Math.round(s.solveMs);
    timings.planStations = s.order.length;
    // Regenerate (G): plan → fields → zone, timed in the browser.
    const t1 = Date.now();
    await con.getByRole('button', { name: /Generate plan/ }).click();
    await planReady(con, `s.plan && s.plan.status === 'OK'`);
    timings.regenerateWallMs = Date.now() - t1;
    await con.keyboard.press('z'); // zoom to the route
    await con.waitForTimeout(900);
    await shot(con, '01-plan-ok');
  });

  await test.step('1b. from Hab-1: STAY IN with the physical reason; one click stages from PR-1', async () => {
    await con.getByTestId('eva-base-HAB').click();
    await planReady(con, `s.evaBase === 'HAB' && s.plan && s.plan.status === 'STAY_IN'`);
    const card = con.getByTestId('stayin-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('from Hab-1');
    await expect(con.getByTestId('stayin-binding')).toContainText('PR-1'); // engine: "staging from ROVER1 allows …", relabelled
    await expect(con.getByTestId('stayin-why')).toContainText(/suit-heat budget/);
    await expect(con.getByTestId('stage-from-rover')).toHaveText(/Stage from PR-1/);
    console.log(`[1b] ${await con.getByTestId('stayin-why').textContent()}`);
    await con.waitForTimeout(400);
    await shot(con, '02-hab-stay-in-explained');
    await con.getByTestId('stage-from-rover').click();
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

  // ── 2 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('2. explain safe zone — the zone uses the engine LOS field from /api/fields/:reqHash/los', async () => {
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

    await con.getByRole('button', { name: /Explain safe zone/ }).click();
    await con.waitForFunction(`window.marswalk.state().explain.step === 5`, null, { timeout: 30_000 });
    expect(await con$(con, (s) => s.explain.detail)).toMatch(/Engine comm line of sight/);
    await con.waitForFunction(`window.marswalk.state().explain.step === 7`, null, { timeout: 30_000 });
    expect(await con$(con, (s) => s.explain.caption)).toMatch(/Route from PR-1/);
    await con.waitForTimeout(1900); // route draws itself inside the safe region
    await shot(con, '03-safe-zone');
    await con.waitForFunction(`!window.marswalk.state().explain.running`, null, { timeout: 15_000 });
  });

  // ── 3 / 4 ────────────────────────────────────────────────────────────────────────────────────────
  let tConfirm = 0;
  await test.step('3. CONFIRM pushes route v1; the package size is shown', async () => {
    await con.getByRole('button', { name: /Review v1/ }).click();
    await expect(con.getByTestId('review-route')).toHaveText(/^PR-1 → .+ → PR-1$/);
    tConfirm = Date.now();
    await con.getByRole('button', { name: /Confirm & push v1/ }).click();
    await expect(con.getByTestId('route-sent').or(con.getByTestId('route-acked'))).toBeVisible();
    await expect(con.getByText(/Route package [\d.]+ KB/)).toBeVisible();
    const route = await con$(con, (s) => s.route);
    console.log(`[3] v${route.seq} pushed · ${route.bytes} B${route.estimated ? ' (estimate)' : ''}`);
    expect(route.seq).toBe(1);
    expect(route.estimated).toBeFalsy();
    expect(route.bytes).toBeGreaterThan(500);
    expect(route.bytes).toBeLessThanOrEqual(25_000);
    timings.packageBytes = route.bytes;
    await con.waitForTimeout(700); // confirm bar slide-in
    await shot(con, '04-confirm');
  });

  await test.step('4. visor receives v1 and verifies the signature; A → ACK on the console', async () => {
    await expect(vis.getByText('ED25519 ✓ VERIFIED').first()).toBeVisible();
    timings.confirmToVisorVerifiedMs = Date.now() - tConfirm;
    await expect(vis.getByText(/^PR-1\s+›\s+ST\d\d.*›\s+PR-1$/)).toBeVisible();
    await shot(vis, '04b-visor-new-route');
    const tA = Date.now();
    await vis.keyboard.press('a');
    await expect(con.getByTestId('route-acked')).toBeVisible();
    timings.acceptToAckMs = Date.now() - tA;
    timings.confirmToAckMs = Date.now() - tConfirm;
    expect(await vis$(vis, (s) => [s.seq, s.display, s.homeName])).toEqual([1, 'NAV', 'PR-1']);
  });

  // ── 5 ────────────────────────────────────────────────────────────────────────────────────────────
  let firstStop = '';
  await test.step('5. the visor sim walks; TELEM reaches the console', async () => {
    firstStop = await con$(con, (s) => s.plan.order[0]);
    await con.getByRole('tab', { name: /Live/ }).click();
    await con.getByRole('button', { name: '30×' }).click();
    const t0 = Date.now();
    await con.getByRole('button', { name: 'Run astronaut' }).click();
    await con.waitForFunction(`window.marswalk.state().telem.length >= 3`, null, { timeout: 30_000 });
    timings.runToTelemMs = Date.now() - t0;
    await expect(con.getByTestId('telemetry')).toBeVisible();
    const v = await vis$(vis, (s) => ({ display: s.display, next: s.next?.id, t: s.t }));
    console.log(`[5] TELEM flowing after ${timings.runToTelemMs} ms · visor ${v.display} → ${v.next} at T+${v.t.toFixed(1)} min`);
    expect(v.display).toBe('NAV');
    expect(v.next).toBe(firstStop);
    await shot(vis, '05-visor-nav');
  });

  // ── 6 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('6. arrival at the first station: science + Curiosity photo; plan vs actual on the burndowns', async () => {
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
    await shot(vis, '06-station');

    await con.getByRole('tab', { name: /Burndowns/ }).click();
    await expect(con.getByTestId('burndown-met')).toBeVisible();
    await expect.poll(async () => Number(await con.getByTestId('burndown-heat').getAttribute('data-actual-points'))).toBeGreaterThan(3);
    await shot(con, '06b-burndowns-plan-vs-actual');

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
  await test.step('7. SEP nowcast → replan from the crew position in < 1 s → v2 → visor RETURN guidance', async () => {
    await con.getByRole('tab', { name: /Live/ }).click();
    const t0 = Date.now();
    await con.getByRole('button', { name: 'SEP nowcast' }).click();
    await con.waitForFunction(`(() => { const s = window.marswalk.state(); return !s.busyEvent && s.planStatus === 'ready' && s.plan && /SEP/.test(s.plan.binding ? s.plan.binding.text : ''); })()`, null, { timeout: 15_000 });
    timings.sepReplanWallMs = Date.now() - t0;
    const p = await con$(con, (s) => ({ status: s.plan.status, solveMs: s.plan.solveMs, from: s.plan.segments[0]?.from, to: s.plan.segments[s.plan.segments.length - 1]?.to, binding: s.plan.binding.text }));
    console.log(`[7] SEP replan: ${p.status} ${p.from} → ${p.to} · solve ${Math.round(p.solveMs)} ms · wall ${timings.sepReplanWallMs} ms · ${p.binding}`);
    timings.sepReplanSolveMs = Math.round(p.solveMs);
    expect(p.status).toBe('OK');
    expect(p.from).toBe('HERE');
    expect(p.solveMs).toBeLessThan(1000);
    expect(timings.sepReplanWallMs as number).toBeLessThan(1500);
    // The hab warns the crew at once (ALERT), before v2 is even confirmed.
    await expect(vis.getByText('RETURN NOW', { exact: true }).first()).toBeVisible();

    await con.getByRole('button', { name: /Review v2/ }).click();
    await expect(con.getByTestId('review-route')).toHaveText(/^EV1 → (PR-1|Hab-1)$/);
    const t1 = Date.now();
    await con.getByRole('button', { name: /Confirm & push v2/ }).click();
    await expect(vis.getByText('NEW ROUTE').first()).toBeVisible();
    await expect(vis.getByText('ED25519 ✓ VERIFIED').first()).toBeVisible();
    await expect(vis.getByText(/^HERE\s+›\s+(PR-1|HAB-1)$/)).toBeVisible();
    await vis.keyboard.press('a');
    await expect(con.getByTestId('route-acked')).toContainText('v2');
    timings.confirmV2ToAckMs = Date.now() - t1;
    await expect(vis.getByText('RETURN NOW', { exact: true }).first()).toBeVisible();
    await expect(vis.getByText(/Distance to (PR-1|HAB-1) along confirmed route/i)).toBeVisible();
    const v = await vis$(vis, (s) => ({ seq: s.seq, display: s.display, target: s.ret?.target }));
    expect(v.seq).toBe(2);
    expect(v.display).toBe('RETURN_NOW');
    await con.evaluate(`window.marswalk.actions.setSim({ speed: 10 })`);
    await vis.waitForTimeout(1200);
    await shot(vis, '07-sep-replan');
  });

  // ── 8 ────────────────────────────────────────────────────────────────────────────────────────────
  await test.step('8. drop link → visor AUTONOMOUS within ~3 s and keeps guiding; restore → TELEM resync', async () => {
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
    await shot(vis, '08-autonomous');

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
    await shot(vis, '09-warm-restart');
  });

  timings.runUtc = new Date().toISOString();
  writeFileSync(`${SCREENS}timings.json`, JSON.stringify(timings, null, 2) + '\n');
  console.log('[timings]', JSON.stringify(timings));
  expect(errors).toEqual([]);
  await conCtx.close();
  await visCtx.close();
});
