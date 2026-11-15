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
    await expect(page.getByTestId('dest-P1')).toContainText('Dropped pin');
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
});
