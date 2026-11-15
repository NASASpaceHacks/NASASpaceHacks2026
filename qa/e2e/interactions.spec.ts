import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Real-interaction tests: the console is used the way a person uses it, with real mouse and keyboard
 * input only (page.mouse / page.keyboard / locator clicks). No store calls, no dispatched events.
 * Map positions come from the console's read-only geometry hook `window.__mwTest` (the OpenLayers
 * coordinate→pixel transform), so the tests click exactly where a marker or a kind of terrain is.
 */
type XY = [number, number];
const SHOTS = fileURLToPath(new URL('../screens/ux5/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const SHOTS_SITES = fileURLToPath(new URL('../screens/sites/', import.meta.url));
mkdirSync(SHOTS_SITES, { recursive: true });
const SHOTS6 = fileURLToPath(new URL('../screens/ux6/', import.meta.url));
mkdirSync(SHOTS6, { recursive: true });

const SHOTS7 = fileURLToPath(new URL('../screens/ux7/', import.meta.url));
mkdirSync(SHOTS7, { recursive: true });

const SHOTS8 = fileURLToPath(new URL('../screens/ux8/', import.meta.url));
mkdirSync(SHOTS8, { recursive: true });

const geo = <T>(page: Page, expr: string) => page.evaluate(expr) as Promise<T>;
const station = (page: Page, id: string) => geo<XY>(page, `window.__mwTest.station(${JSON.stringify(id)})`);
const dest = (page: Page, letter: string) => geo<XY | null>(page, `window.__mwTest.dest(${JSON.stringify(letter)})`);
const shelter = (page: Page, id: string) => geo<XY>(page, `window.__mwTest.shelter(${JSON.stringify(id)})`);
const find = (page: Page, kind: 'steep' | 'flat', near?: XY, within?: number) =>
  geo<XY>(page, `window.__mwTest.find(${JSON.stringify(kind)}${near ? `, ${JSON.stringify(near)}, ${within ?? 200}` : ''})`);

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('directions')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => {
    const t = (window as unknown as { __mwTest?: { station(id: string): unknown } }).__mwTest;
    return !!t && !!t.station('ST01');
  });
  await page.waitForTimeout(400); // initial fit
}

async function click(page: Page, [x, y]: XY) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

async function drag(page: Page, [x0, y0]: XY, [x1, y1]: XY) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
  await page.mouse.up();
}

const verdict = (page: Page) => page.getByTestId('verdict').or(page.getByTestId('stayin-card'));

async function searchTo(page: Page, text: string) {
  await page.getByTestId('to-input').click();
  await page.keyboard.type(text);
  await expect(page.getByTestId('to-results')).toContainText('Altadena');
  await expect(page.locator('#to-results [aria-selected="true"]')).toContainText('Altadena');
  await page.keyboard.press('Enter');
}

test.describe('habitat console · real mouse and keyboard', () => {
  test('1–2 · click empty map → place card → Directions → route + verdict', async ({ page }) => {
    await open(page);
    const pr1 = await shelter(page, 'ROVER1');
    const spot = await find(page, 'flat', pr1, 90);
    await click(page, spot);
    const card = page.getByTestId('place-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-kind', 'terrain');
    await expect(page.getByTestId('place-title')).toHaveText('Dropped pin');
    await expect(page.getByTestId('place-coords')).toHaveText(/^\d+\.\d{4}°[NS] \d+\.\d{4}°[EW] · elev -?\d+ m · slope \d+°$/);
    await expect(page.getByTestId('place-safety')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}place-card.png` });
    await page.getByTestId('place-directions').click();
    await expect(page.getByTestId('dest-P1')).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await expect(page.getByTestId('timeline')).toBeVisible();
    expect(await dest(page, 'B')).not.toBeNull();
    await page.screenshot({ path: `${SHOTS}route.png` });
  });

  test('3 · type "Alta" → suggestion highlighted → Enter → route', async ({ page }) => {
    await open(page);
    await searchTo(page, 'Alta');
    await expect(page.getByTestId('dest-ST01')).toBeVisible();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await expect(page.getByTestId('verdict-headline')).toHaveText(/^1 stop · /);
  });

  test('4 · focusing To alone does not pin; "Choose on map" → next click sets the destination', async ({ page }) => {
    await open(page);
    const pr1 = await shelter(page, 'ROVER1');
    const spot = await find(page, 'flat', pr1, 120);
    // Focus the field, then click the map: an ordinary click (place card), not a destination.
    await page.getByTestId('to-input').click();
    await expect(page.getByTestId('to-results')).toBeVisible();
    await click(page, spot);
    await expect(page.getByTestId('place-card')).toBeVisible();
    await expect(page.locator('[data-testid^="dest-P"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Now explicitly: "Choose on map" is the first suggestion.
    await page.getByTestId('to-input').click();
    await expect(page.locator('#to-results [role="option"]').first()).toHaveText('Choose on map');
    await page.getByTestId('choose-on-map').click();
    await expect(page.getByTestId('to-input')).toHaveAttribute('placeholder', 'Click a spot on the map');
    await page.mouse.move(spot[0], spot[1]);
    await expect.poll(() => page.evaluate(() => (document.querySelector('.ol-viewport') as HTMLElement).style.cursor)).toBe('crosshair');
    await page.screenshot({ path: `${SHOTS}choose-on-map.png` });
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByTestId('dest-P1')).toBeVisible();
    await expect(page.getByTestId('place-card')).toHaveCount(0);
    await expect(verdict(page)).toBeVisible();
    // Esc cancels "Choose on map".
    await page.getByTestId('add-stop').click();
    await expect(page.getByTestId('to-input')).toBeFocused();
    await page.getByTestId('choose-on-map').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('to-input')).not.toHaveAttribute('placeholder', 'Click a spot on the map');
  });

  test('5 · right-click → "Directions to here"', async ({ page }) => {
    await open(page);
    const pr1 = await shelter(page, 'ROVER1');
    const spot = await find(page, 'flat', pr1, 120);
    await page.mouse.click(spot[0], spot[1], { button: 'right' });
    const menu = page.getByTestId('map-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Directions to here', 'Add as stop', "What's here?"]);
    await page.screenshot({ path: `${SHOTS}context-menu.png` });
    await menu.getByRole('menuitem', { name: 'Directions to here' }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId('dest-P1')).toBeVisible();
    await expect(verdict(page)).toBeVisible();
  });

  test('6 · drag marker B → the destination moves and re-plans', async ({ page }) => {
    await open(page);
    await searchTo(page, 'Alta');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await page.waitForTimeout(600); // route fit
    const b0 = (await dest(page, 'B'))!;
    const to = await find(page, 'flat', [b0[0] + 60, b0[1] + 60], 90);
    const st01Before = await station(page, 'ST01');
    await page.mouse.move(b0[0], b0[1]);
    await expect.poll(() => page.evaluate(() => (document.querySelector('.ol-viewport') as HTMLElement).style.cursor)).toBe('grab');
    await drag(page, b0, to);
    await expect(page.getByTestId('dest-ST01')).toHaveCount(0);
    await expect(page.getByTestId('dest-P1')).toBeVisible();
    await expect(page.getByTestId('dest-P1')).toContainText('Target of opportunity');
    const b1 = (await dest(page, 'B'))!;
    expect(Math.hypot(b1[0] - to[0], b1[1] - to[1])).toBeLessThan(8);
    // The map did not pan while the marker was dragged.
    const st01After = await station(page, 'ST01');
    expect(Math.hypot(st01After[0] - st01Before[0], st01After[1] - st01Before[1])).toBeLessThan(2);
    await expect(verdict(page)).toBeVisible();
    await expect(page.getByText('Re-planning…')).toHaveCount(0); // the new plan is in
    await expect(page.getByTestId('directions').getByText('ST01')).toHaveCount(0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}drag-marker.png` });
  });

  test('7 · a drag-pan never drops a pin; a 3 px jitter still clicks', async ({ page }) => {
    await open(page);
    // Wheel-zoom in over the map first (fully zoomed out, the view is pinned to the study area).
    const st = await station(page, 'ST01');
    await page.mouse.move(st[0], st[1]);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(800);
    await expect(page.getByTestId('place-card')).toHaveCount(0);
    const spot = await find(page, 'flat');
    const before = await station(page, 'ST01');
    await drag(page, spot, [spot[0] + 160, spot[1] + 90]);
    await page.waitForTimeout(600);
    await expect(page.getByTestId('place-card')).toHaveCount(0);
    const after = await station(page, 'ST01');
    expect(Math.round(after[0] - before[0])).toBeGreaterThan(140);
    // A click with a little hand jitter is still a click.
    const s2 = await find(page, 'flat');
    await page.mouse.move(s2[0], s2[1]);
    await page.mouse.down();
    await page.mouse.move(s2[0] + 2, s2[1] + 2);
    await page.mouse.up();
    await expect(page.getByTestId('place-card')).toBeVisible();
  });

  test('8 · Esc closes the place card; a click elsewhere moves the pin', async ({ page }) => {
    await open(page);
    const a = await find(page, 'flat');
    await click(page, a);
    await expect(page.getByTestId('place-card')).toBeVisible();
    const coords1 = await page.getByTestId('place-coords').textContent();
    // Another flat spot well clear of the open card (which hangs below the pin).
    let b: XY | null = null;
    for (const c of [[a[0] + 260, a[1]], [a[0] + 220, a[1] + 120], [a[0], a[1] + 320], [a[0] + 250, a[1] + 300]] as XY[]) {
      b = b ?? (await find(page, 'flat', c, 70));
    }
    expect(b).not.toBeNull();
    await click(page, b!);
    await expect(page.getByTestId('place-card')).toHaveCount(1);
    await expect(page.getByTestId('place-coords')).not.toHaveText(coords1!);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-card')).toHaveCount(0);
  });

  test('9 · clicking a science target opens its place card', async ({ page }) => {
    await open(page);
    await click(page, await station(page, 'ST04'));
    const card = page.getByTestId('place-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-kind', 'station');
    await expect(page.getByTestId('place-title')).toContainText('Peace-sign');
    await expect(page.getByTestId('place-value')).toHaveText(/^Science value \d+ of 100/);
    await expect(page.getByTestId('place-why')).not.toBeEmpty();
    await expect(page.getByTestId('place-directions')).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0); // no hover card stacked on top
    const box = (await card.boundingBox())!;
    const map = (await page.locator('.ol-viewport').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height + 1); // fully on screen
    await page.getByTestId('place-directions').click();
    await expect(page.getByTestId('dest-ST04')).toBeVisible();
  });

  test('10 · Hab-1: steep spot refused with a reason, NO-GO, switching to the rover recovers', async ({ page }) => {
    await open(page);
    await page.getByTestId('from-select').click();
    await page.getByTestId('from-opt-HAB').click();
    await expect(page.getByTestId('from-select')).toContainText('Hab-1');
    // A steep spot: the place card says why it is refused.
    await click(page, await find(page, 'steep'));
    await expect(page.getByTestId('place-safety')).toHaveText(/^Can't go here: too steep \(\d+°\)$/);
    await page.keyboard.press('Escape');
    // A real target from Hab-1: NO-GO with the physical reason.
    await searchTo(page, 'Alta');
    await expect(page.getByTestId('stayin-card')).toBeVisible();
    await expect(page.getByTestId('stayin-reason')).toContainText(/below Hab-1/);
    await expect(page.getByTestId('dest-reason-ST01')).toBeVisible();
    // Recover: switch the start to the rover with the From field (keyboard: ↓ opens, ↓ moves, Enter picks).
    await page.getByTestId('from-select').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('from-options')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('from-select')).toContainText('PR-1');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await expect(page.getByTestId('dest-reason-ST01')).toHaveCount(0);
  });

  test('rover · grab cursor; dragging the rover moves it and never pans the map', async ({ page }) => {
    await open(page);
    const r0 = await shelter(page, 'ROVER1');
    const st0 = await station(page, 'ST09');
    await page.mouse.move(r0[0], r0[1]);
    await expect.poll(() => page.evaluate(() => (document.querySelector('.ol-viewport') as HTMLElement).style.cursor)).toBe('grab');
    await drag(page, r0, [r0[0] + 30, r0[1] + 40]);
    await expect.poll(async () => { const r = await shelter(page, 'ROVER1'); return Math.hypot(r[0] - r0[0], r[1] - r0[1]); }).toBeGreaterThan(30);
    const st1 = await station(page, 'ST09');
    expect(Math.hypot(st1[0] - st0[0], st1[1] - st0[1])).toBeLessThan(2);
    await expect(page.getByTestId('place-card')).toHaveCount(0);
  });

  test('11 · 1280×720: no horizontal overflow, top bar visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(ov).toBeLessThanOrEqual(0);
    await expect(page.getByRole('navigation', { name: 'Console mode' })).toBeInViewport();
    await expect(page.getByText('MARSWALK', { exact: true })).toBeInViewport();
    await expect(page.getByTestId('directions')).toBeInViewport();
    await click(page, await find(page, 'flat'));
    await expect(page.getByTestId('place-card')).toBeInViewport();
  });

  test('12 · Layers: real data layers; Elevation and Slope show legends; at most 3 colour layers', async ({ page }) => {
    await open(page);
    await page.getByTestId('layers-button').click();
    const panel = page.getByTestId('layers-panel');
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText('Calm');
    for (const g of ['Mars data', 'Safety analysis', 'Mission features']) await expect(panel).toContainText(g);
    for (const k of ['imagery', 'relief', 'elevation', 'slope', 'rough', 'ti', 'outline', 'walkback', 'shelter', 'los', 'stations', 'traverse', 'keepouts', 'shelters']) {
      await expect(page.getByTestId(`layer-${k}`)).toBeVisible();
    }
    await expect(page.getByTestId('layer-ti')).toContainText('Indicative');
    await expect(page.getByTestId('layer-ti')).toContainText('THEMIS');
    await expect(page.getByTestId('layer-imagery')).toHaveAttribute('data-on', 'true');
    await expect(page.getByTestId('layer-elevation').getByTestId('layer-legend')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS6}layers-panel.png` });
    // Elevation on → its colour ramp with min/max in metres.
    await page.getByTestId('layer-elevation').getByRole('switch').click();
    const elev = page.getByTestId('layer-elevation').getByTestId('layer-legend');
    await expect(elev).toBeVisible();
    await expect(elev).toContainText(/-\d+ m.*-\d+ m/);
    await expect(page.locator('.mw-f-elevation')).toBeVisible();
    await page.screenshot({ path: `${SHOTS6}elevation-on.png` });
    // Slope on → legend with the 20° limit marked.
    await page.getByTestId('layer-elevation').getByRole('switch').click();
    await page.getByTestId('layer-slope').getByRole('switch').click();
    const slope = page.getByTestId('layer-slope').getByTestId('layer-legend');
    await expect(slope).toBeVisible();
    await expect(slope).toContainText('20°');
    await expect(page.getByTestId('layers-count')).toHaveText('1 on');
    await page.screenshot({ path: `${SHOTS6}slope-on.png` });
    // A 4th colour layer switches the oldest one off.
    for (const k of ['rough', 'ti', 'shelter']) await page.getByTestId(`layer-${k}`).getByRole('switch').click();
    await expect(page.getByTestId('layers-limit')).toHaveText('3/3 colour layers');
    await expect(page.getByTestId('layer-slope')).toHaveAttribute('data-on', 'false');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('13 · locator: Mars → Gale crater, both always shown; hover never switches; click collapses', async ({ page }) => {
    await open(page);
    const loc = page.getByTestId('locator');
    await expect(page.getByTestId('locator-mars')).toBeVisible();
    await expect(page.getByTestId('locator-gale')).toBeVisible();
    await expect(page.getByTestId('locator-mars')).toContainText('Mars');
    await expect(page.getByTestId('locator-gale')).toContainText('Gale');
    await expect(loc).toContainText('Viking');
    const box0 = (await loc.boundingBox())!;
    const src0 = await loc.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
    // Hover over each view: nothing switches or resizes.
    for (const t of ['locator-mars', 'locator-gale']) {
      const b = (await page.getByTestId(t).boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
      await page.waitForTimeout(250);
      expect(await loc.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))).toEqual(src0);
      const box1 = (await loc.boundingBox())!;
      expect([box1.width, box1.height]).toEqual([box0.width, box0.height]);
    }
    await loc.screenshot({ path: `${SHOTS6}locator.png` });
    await page.mouse.move(box0.x - 200, box0.y - 200);
    await page.getByTestId('locator-toggle').click();
    await expect(page.getByTestId('locator-mars')).toHaveCount(0);
    await page.getByTestId('locator-toggle').click();
    await expect(page.getByTestId('locator-gale')).toBeVisible();
  });

  test('14 · NO-GO destination → "Closest safe point" → GO', async ({ page }) => {
    await open(page);
    const pr1 = await shelter(page, 'ROVER1');
    const steep = (await find(page, 'steep', pr1, 260)) ?? (await find(page, 'steep'));
    await page.mouse.click(steep[0], steep[1], { button: 'right' });
    await page.getByTestId('map-context-menu').getByRole('menuitem', { name: 'Directions to here' }).click();
    await expect(page.getByTestId('dest-reason-P1')).toBeVisible();
    await expect(page.getByTestId('dest-reason-P1')).toContainText(/too steep/);
    await expect(page.getByTestId('verdict-dest-reason')).toContainText(/too steep/);
    await expect(page.getByTestId('fix-closest-P1')).toBeVisible();
    await expect(page.getByTestId('verdict-fix-closest')).toBeVisible();
    await page.screenshot({ path: `${SHOTS6}nogo-options.png` });
    await page.getByTestId('fix-closest-P1').click();
    const msg = page.getByTestId('fix-msg-P1');
    await expect(msg).toHaveAttribute('data-status', 'found', { timeout: 60_000 });
    await expect(msg).toHaveText(/^Closest safe point: \d+ m short of your pin\.$/);
    await expect.poll(() => geo<XY | null>(page, 'window.__mwTest.suggestion()')).not.toBeNull();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS6}closest-safe-point.png` });
    await page.getByTestId('fix-accept-P1').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await expect(page.locator('[data-testid^="dest-reason-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="dest-P"]').first()).toContainText('Closest safe point');
    await expect.poll(() => geo<XY | null>(page, 'window.__mwTest.suggestion()')).toBeNull();
  });

  test('15 · NO-GO from Hab-1 → "Move rover closer" → GO (or a clear message)', async ({ page }) => {
    await open(page);
    await page.getByTestId('from-select').click();
    await page.getByTestId('from-opt-HAB').click();
    await searchTo(page, 'Alta');
    await expect(page.getByTestId('stayin-card')).toBeVisible();
    await expect(page.getByTestId('dest-reason-ST01')).toBeVisible();
    await expect(page.getByTestId('stage-from-rover')).toBeVisible(); // still offered
    await page.getByTestId('verdict-fix-rover').click();
    const msg = page.getByTestId('fix-msg-ST01');
    await expect(msg).toHaveAttribute('data-status', /^(found|none)$/, { timeout: 75_000 });
    if ((await msg.getAttribute('data-status')) === 'none') {
      await expect(msg).toHaveText(/rover spot|park/);
      return;
    }
    await expect(msg).toContainText("The rover's own drive route isn't planned by Marswalk.");
    await expect.poll(() => geo<XY | null>(page, 'window.__mwTest.suggestion()')).not.toBeNull();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS6}rover-suggestion.png` });
    const r0 = await shelter(page, 'ROVER1');
    await page.getByTestId('verdict-fix-accept').click();
    await expect(page.getByTestId('from-select')).toContainText('PR-1');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await expect(page.getByTestId('dest-reason-ST01')).toHaveCount(0);
    const r1 = await shelter(page, 'ROVER1');
    expect(Math.hypot(r1[0] - r0[0], r1[1] - r0[1])).toBeGreaterThan(3);
  });
});

// ───────────────────────────── multi-site ─────────────────────────────

const SITE2 = process.env.UX_SITE2 ?? 'jezero-v1';
type SiteRow = { id: string; name: string; centerLonLat: [number, number]; available: boolean };

async function sites(page: Page) {
  return (await (await page.request.get('/api/sitepacks')).json()) as SiteRow[];
}

/** First science target of a site pack (id + name), read from the pack the hab server serves. */
async function firstTarget(page: Page, site: string) {
  const m = (await (await page.request.get(`/sitepacks/${site}/manifest.json`)).json()) as { stations: { id: string; name: string }[] };
  return m.stations[0];
}

const siteSelect = (page: Page) => page.getByTestId('site-select');

/** Click a target on the map → place card → Directions → a verdict (GO, CAUTION or a clear STAY-IN explanation). */
async function planToFirstTarget(page: Page, site: string) {
  const t = await firstTarget(page, site);
  await page.waitForFunction((id) => !!(window as unknown as { __mwTest?: { station(i: string): unknown } }).__mwTest?.station(id), t.id);
  await page.waitForTimeout(400);
  await click(page, await station(page, t.id));
  await expect(page.getByTestId('place-card')).toBeVisible();
  await page.getByTestId('place-directions').click();
  await expect(verdict(page)).toBeVisible({ timeout: 45_000 });
  return t;
}

test.describe('sites · picker, switching, deep link', () => {
  test('15 · the hab server lists every site pack; the console shows them on the locator and in the top bar', async ({ page }) => {
    const list = await sites(page);
    expect(list.find((s) => s.id === 'gale-v1')).toMatchObject({ available: true });
    const avail = list.filter((s) => s.available);
    test.skip(avail.length < 2, 'only one site pack present');
    await open(page);
    for (const s of avail) await expect(page.getByTestId(`locator-site-${s.id}`)).toBeVisible();
    await expect(page.getByTestId('locator-site-gale-v1')).toHaveAttribute('data-current', 'true');
    await expect(siteSelect(page)).toHaveValue('gale-v1');
    await expect(siteSelect(page).locator('option')).toHaveCount(avail.length);
    await page.getByTestId('locator').screenshot({ path: `${SHOTS_SITES}picker.png` });
    await page.screenshot({ path: `${SHOTS_SITES}gale.png` });
  });

  test('16 · click the other site on the locator → site name, study area and targets change → plan to a target → verdict', async ({ page }) => {
    const avail = (await sites(page)).filter((s) => s.available);
    test.skip(!avail.some((s) => s.id === SITE2), `${SITE2} is not present`);
    await open(page);
    const marker = page.getByTestId(`locator-site-${SITE2}`);
    await expect(marker).toHaveAttribute('data-current', 'false');
    // Hover alone does nothing; a click selects.
    const b = (await marker.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.waitForTimeout(250);
    await expect(siteSelect(page)).toHaveValue('gale-v1');
    await page.mouse.down();
    await page.mouse.up();
    await expect(siteSelect(page)).toHaveValue(SITE2, { timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`site=${SITE2}`));
    await expect(page.getByTestId(`locator-site-${SITE2}`)).toHaveAttribute('data-current', 'true');
    await expect(page.getByTestId('locator-site-gale-v1')).toHaveAttribute('data-current', 'false');
    const name = (await sites(page)).find((s) => s.id === SITE2)!.name.replace(/\s*[—–-]\s+.*$/, '');
    await expect(siteSelect(page).locator('option:checked')).toHaveText(name);
    await expect(page.getByTestId('locator-gale')).toContainText(new RegExp(name.split(' ')[0], 'i'));
    await expect(page.getByTestId('verdict')).toHaveCount(0); // plan and destinations were reset
    const t = await planToFirstTarget(page, SITE2);
    expect(t.id).toBeTruthy();
    await page.screenshot({ path: `${SHOTS_SITES}${SITE2.replace(/-v\d+$/, '')}.png` });
  });

  test('17 · site dropdown by keyboard switches back to Gale and clears the route', async ({ page }) => {
    const avail = (await sites(page)).filter((s) => s.available);
    test.skip(!avail.some((s) => s.id === SITE2), `${SITE2} is not present`);
    await page.goto(`/?site=${SITE2}`);
    await expect(siteSelect(page)).toHaveValue(SITE2, { timeout: 60_000 });
    await expect(page.getByTestId('directions')).toBeVisible({ timeout: 60_000 });
    await siteSelect(page).focus();
    await siteSelect(page).selectOption('gale-v1'); // the keyboard path of a native select: change event
    await expect(siteSelect(page)).toHaveValue('gale-v1', { timeout: 60_000 });
    await expect(page).toHaveURL(/site=gale-v1/);
    await expect(page.getByTestId('locator-site-gale-v1')).toHaveAttribute('data-current', 'true');
    await page.waitForFunction(() => !!(window as unknown as { __mwTest?: { station(i: string): unknown } }).__mwTest?.station('ST01'));
  });

  test('18 · deep link ?site=<other> opens that site; an unknown site falls back to the default', async ({ page }) => {
    const avail = (await sites(page)).filter((s) => s.available);
    test.skip(!avail.some((s) => s.id === SITE2), `${SITE2} is not present`);
    await page.goto(`/?site=${SITE2}`);
    await expect(siteSelect(page)).toHaveValue(SITE2, { timeout: 60_000 });
    await expect(page.getByTestId('locator-site-' + SITE2)).toHaveAttribute('data-current', 'true');
    await planToFirstTarget(page, SITE2);
    await page.goto('/?site=nowhere-v9');
    await expect(page.getByTestId('directions')).toBeVisible({ timeout: 60_000 });
    await expect(siteSelect(page)).toHaveValue('gale-v1');
  });

  // ───────────── ux7: one verdict for a pin, where a NO-GO fails, readable Details ─────────────
  const shadowSpot = (page: Page) => geo<XY | null>(page, 'window.__mwTest.shadow("ROVER1", 400)');
  const attemptInfo = (page: Page) => geo<{ xy: XY | null; label: string } | null>(page, 'window.__mwTest.attempt()');

  test('19 · pin on flat ground near PR-1 → card says GO with walk time and spare time', async ({ page }) => {
    await open(page);
    const pr1 = await shelter(page, 'ROVER1');
    const spot = await find(page, 'flat', pr1, 90);
    await click(page, spot);
    const v = page.getByTestId('place-verdict');
    await expect(v).toHaveAttribute('data-verdict', /^(GO|NO-GO)$/);
    await expect(v).toHaveAttribute('data-verdict', 'GO');
    await expect(v).toHaveText(/^GO · ~\d+ min walk each way · back with .+ spare$/);
    await expect(page.getByTestId('place-safety')).toHaveText(/^Safe to stand here \(slope \d+°\)$/);
    await page.screenshot({ path: `${SHOTS7}pin-go.png` });
    await page.getByTestId('place-directions').click();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
  });

  test('20 · pin in a radio shadow → NO-GO with the radio reason before any stop; the plan agrees; red stretch + label on the map', async ({ page }) => {
    await open(page);
    const spot = await shadowSpot(page);
    expect(spot).not.toBeNull();
    await click(page, spot!);
    const card = page.getByTestId('place-card');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-testid^="dest-P"]')).toHaveCount(0); // no stop added yet
    const v = page.getByTestId('place-verdict');
    await expect(v).toHaveAttribute('data-verdict', 'NO-GO');
    await expect(v).toHaveText(/^NO-GO · No radio contact for \d+ min on the way \(limit \d+ min\)$/);
    await expect(page.getByTestId('place-fix-closest')).toBeVisible();
    // The attempted walk is already on the map: red stretch with its label.
    await expect.poll(async () => (await attemptInfo(page))?.label ?? '').toMatch(/^No radio \d+ min \(limit \d+\)$/);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS7}pin-nogo.png` });
    // Add the stop: the plan reaches the same verdict for the same reason.
    await page.getByTestId('place-directions').click();
    await expect(page.getByTestId('stayin-card')).toBeVisible();
    await expect(page.getByTestId('verdict-dest-reason')).toContainText(/radio contact/i);
    await expect(page.getByTestId('verdict-where')).toContainText(/No radio contact for \d+ min/);
    await expect.poll(async () => (await attemptInfo(page))?.label ?? '').toMatch(/^No radio \d+ min \(limit \d+\)$/);
    await page.waitForTimeout(900); // the map fits the attempted walk
    const at = (await attemptInfo(page))!;
    expect(at.xy).not.toBeNull();
    await page.screenshot({ path: `${SHOTS7}nogo-highlight.png` });
    // The label's spot is painted red on the map canvas (the highlighted stretch).
    const red = await page.evaluate(([x, y]) => {
      for (const cv of Array.from(document.querySelectorAll<HTMLCanvasElement>('.ol-viewport canvas'))) {
        let ctx: CanvasRenderingContext2D | null = null;
        try { ctx = cv.getContext('2d'); } catch { /* webgl canvas */ }
        if (!ctx) continue;
        const r = cv.getBoundingClientRect();
        const k = cv.width / r.width;
        const d = ctx.getImageData(Math.max(0, Math.round((x - r.left - 40) * k)), Math.max(0, Math.round((y - r.top - 40) * k)), Math.round(80 * k), Math.round(80 * k)).data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 200) return true;
      }
      return false;
    }, at.xy!);
    expect(red).toBe(true);
    // Radio layer: covered ground clear, shadow tinted; legend says what it is.
    await page.getByTestId('layers-button').click();
    await page.getByTestId('layer-los').getByRole('switch').click();
    await expect(page.getByTestId('layer-los')).toContainText('Radio shadow: no line of sight to Hab-1 or PR-1');
    await expect(page.getByTestId('layer-los').getByTestId('layer-legend')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS7}radio-layer.png` });
  });

  test('21 · Details → Report for a NO-GO: attempted totals, where it failed, no internal IDs', async ({ page }) => {
    await open(page);
    const spot = await shadowSpot(page);
    await click(page, spot!);
    await page.getByTestId('place-directions').click();
    await expect(page.getByTestId('stayin-card')).toBeVisible();
    await page.getByTestId('open-details').click();
    const rep = page.getByTestId('report');
    await expect(rep).toBeVisible();
    await page.waitForTimeout(450); // drawer slide
    await expect(page.getByTestId('report-verdict')).toHaveText('NO-GO');
    const tried = page.getByTestId('report-tried');
    await expect(tried).toContainText('What was tried');
    await expect(tried).toContainText(/Distance/);
    await expect(tried).not.toContainText(/\b0\.00 km/);
    const km = await tried.innerText();
    expect(Number(/(\d+\.\d+)\s*km/.exec(km)?.[1] ?? '0')).toBeGreaterThan(0);
    await expect(page.getByTestId('report-why')).toContainText(/radio contact/i);
    await expect(page.getByTestId('report-ways')).toBeVisible();
    await expect(page.getByTestId('report-margins')).toContainText('over by');
    const main = await rep.evaluate((el) => {
      const c = el.cloneNode(true) as HTMLElement;
      c.querySelector('[data-testid="report-technical"]')?.remove();
      return c.innerText;
    });
    expect(main).not.toMatch(/dijkstra|pandolf|[0-9a-f]{12}|reqHash/i);
    await expect(page.getByTestId('report-technical')).toContainText('Technical');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS7}details-report-nogo.png` });
    // Margins tab for a NO-GO shows the attempted walk's curves.
    await page.getByTestId('details-tab-margins').click();
    await expect(page.getByTestId('margins-attempted')).toBeVisible();
    await expect(page.getByTestId('burndown-los')).toContainText('limit');
  });

  test('22 · Details → Report, Rules, Margins for an OK plan; Rules lists 12 rules with evidence chips', async ({ page }) => {
    await open(page);
    await searchTo(page, 'Alta');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await page.getByTestId('open-details').click();
    await page.waitForTimeout(450);
    await expect(page.getByTestId('report-verdict')).toHaveText('GO');
    await expect(page.getByTestId('report')).toContainText('What limits this walk');
    await expect(page.getByTestId('report-margins')).toContainText('to spare');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS7}details-report-ok.png` });
    await page.getByTestId('details-tab-rules').click();
    const rules = page.getByTestId('rules');
    await expect(rules.getByRole('switch')).toHaveCount(12);
    await expect(rules.locator('[data-evidence]')).toHaveCount(12);
    await expect(page.getByTestId('evidence-legend').locator('[data-evidence]')).toHaveCount(5);
    await expect(page.getByTestId('rules-note')).toContainText('analysis only');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS7}details-rules.png` });
    await page.getByTestId('details-tab-margins').click();
    for (const k of ['wb', 'sh', 'los', 'heat']) await expect(page.getByTestId(`burndown-${k}`)).toBeVisible();
    await expect(page.getByTestId('burndown-wb')).toContainText('Spare time to get home');
    await expect(page.getByTestId('burndown-sh')).toContainText('Minutes to shelter (limit 30)');
    await expect(page.getByTestId('burndown-heat')).toContainText('Suit heat, 30-min average vs 352 W budget');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS7}details-margins.png` });
    await page.getByTestId('details-tab-weather').click();
    await expect(page.getByTestId('weather-purpose')).toBeVisible();
    await page.getByTestId('details-tab-science').click();
    await expect(page.getByTestId('science-panel')).toContainText(/covered|lost|not chosen/);
    await page.getByTestId('details-tab-log').click();
    await expect(page.getByTestId('event-log')).not.toContainText('{');
  });

  test('23 · Details → Report shows terrain shielding on the route; Weather & radiation shows the latest Curiosity REMS reading', async ({ page }) => {
    await open(page);
    await searchTo(page, 'Alta');
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', /^(GO|CAUTION)$/);
    await page.getByTestId('open-details').click();
    await page.waitForTimeout(450);
    const sh = page.getByTestId('radiation-shielding');
    await expect(sh).toContainText(/Terrain shields [\d.]+% of the dose on this route/);
    await expect(sh).toContainText('Guo et al. 2026');
    await expect(sh).toContainText('never a shelter');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS8}report-radiation.png` });
    await page.getByTestId('details-tab-weather').click();
    const w = page.getByTestId('surface-weather');
    await expect(w).toContainText('Latest surface weather from Curiosity REMS');
    await expect(w).toContainText(/sol \d+, \d{4}-\d{2}-\d{2}/);
    await expect(w).toContainText('Pressure');
    await expect(w).toContainText('UV index');
    await expect(page.getByTestId('surface-weather-note')).toContainText('not the scenario sol');
    await expect(page.getByTestId('surface-weather-note')).toContainText('scenario is sol 412');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS8}weather-gale.png` });
  });

  test('24 · Jezero: the weather block reads Perseverance MEDA', async ({ page }) => {
    const avail = (await sites(page)).filter((s) => s.available);
    test.skip(!avail.some((s) => s.id === SITE2), `${SITE2} is not present`);
    await page.goto(`/?site=${SITE2}`);
    await expect(siteSelect(page)).toHaveValue(SITE2, { timeout: 60_000 });
    await planToFirstTarget(page, SITE2);
    await page.getByTestId('open-details').click();
    await page.waitForTimeout(450);
    await page.getByTestId('details-tab-weather').click();
    const w = page.getByTestId('surface-weather');
    await expect(w).toContainText('Latest surface weather from Perseverance MEDA');
    await expect(w).not.toContainText('REMS');
    await expect(page.getByTestId('surface-weather-note')).toContainText('not the scenario sol');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS8}weather-jezero.png` });
  });

  // ───────────── ux8: CRISM mineral (spectral) layer ─────────────
  test('23 · Layers → Minerals (CRISM): legend, source, Indicative badge; station card shows the sulfate signal', async ({ page }) => {
    await open(page);
    await page.getByTestId('layers-button').click();
    const row = page.getByTestId('layer-crism');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Minerals (CRISM)');
    await expect(row).toContainText('Indicative');
    await expect(row).toContainText('18 m');
    await row.getByRole('switch').click();
    await expect(row.getByTestId('layer-legend')).toBeVisible();
    await expect(page.locator('.mw-f-crism')).toBeVisible();
    await page.screenshot({ path: `${SHOTS8}crism-layer.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await click(page, await station(page, 'ST08'));
    await expect(page.getByTestId('place-card')).toBeVisible();
    await expect(page.getByTestId('place-mineral')).toContainText(/Hydrated sulfate signal: (strong|moderate|weak)/);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS8}crism-station.png` });
  });
});
