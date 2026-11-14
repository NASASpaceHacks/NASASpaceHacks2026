// Visor smoke run (mock mode): node Frontend/UserView/scripts/smoke.mjs [baseUrl]
// Walks WAITING → NEW_ROUTE → NAV → STATION → AUTONOMOUS → RETURN_NOW → warm restart and screenshots each state
// into Frontend/UserView/docs/. Requires a running dev server (default http://localhost:15174) and Chrome.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:15174';
const extra = process.argv[3] ?? '';
const prefix = process.argv[4] ?? '';
const stationOnly = process.env.SMOKE_ONLY === 'station';
const out = resolve(import.meta.dirname, '../docs');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${prefix}${name}.png` });
  console.log('shot', name);
};
const v = (fn, arg) => page.evaluate(fn, arg);
const waitFor = (fn, timeout = 60000) => page.waitForFunction(fn, null, { timeout, polling: 200 });

await page.goto(`${base}/?mock=1&reset=1&speed=60${extra}`);
await waitFor(() => window.__visor?.manifest && document.body.innerText.includes('AWAITING ROUTE'));
await shot('01-waiting-for-route');

await waitFor(() => !!window.__visor.pending);
await shot('02-new-route');

await page.keyboard.press('a');
await waitFor(() => window.__visor.sim && window.__visor.sim.s > 60);
await shot('03-nav');

await waitFor(() => window.__visor.sim.mode === 'DWELL', 120000);
await page.waitForTimeout(400);
await shot('04-station');
await page.keyboard.press('n');
await shot('05-station-task-ticked');
if (stationOnly) {
  await page.keyboard.press('n');
  await page.waitForTimeout(300);
  await shot('05b-station-tasks');
  console.log(errors.length ? `CONSOLE (${errors.length}):\n` + errors.join('\n') : 'CONSOLE: clean (no errors or warnings)');
  await browser.close();
  process.exit(0);
}

// leave the station and get a bit down the next leg
await waitFor(() => window.__visor.sim.mode === 'WALK' && window.__visor.sim.visited.length >= 1, 120000);
await page.waitForTimeout(2500);

// link drop via the demo panel
await page.keyboard.press('d');
await shot('06-demo-panel');
await page.keyboard.press('l');
await page.keyboard.press('d');
await page.waitForTimeout(3600);
await shot('07-autonomous');
const queued = await v(() => window.__visor.outbox?.length ?? null);

// restore link, then a hab SEP alert → RETURN NOW
await page.keyboard.press('d');
await page.keyboard.press('l');
await page.waitForTimeout(500);
await page.keyboard.press('s');
await page.keyboard.press('d');
await waitFor(() => document.body.innerText.includes('RETURN NOW'), 10000);
await page.waitForTimeout(1500);
await shot('08-return-now');

// simulated radiation upset: reload and measure the warm restart
const before = await v(() => ({ s: window.__visor.sim.s, t: window.__visor.sim.t, seq: window.__visor.pkg.seq }));
const t0 = Date.now();
await page.reload();
await waitFor(() => window.__visor?.sim && window.__visor.pkg);
const restoreMs = Date.now() - t0;
const after = await v(() => ({ s: window.__visor.sim.s, t: window.__visor.sim.t, seq: window.__visor.pkg.seq, restoredInMs: window.__visor.restoredInMs }));
await shot('09-warm-restart');

await page.keyboard.press('m');
await shot('10-mirror');
await page.keyboard.press('m');

console.log(JSON.stringify({ queuedWhileDown: queued, before, after, restoreMs, telemAtHab: await v(() => window.__visor.mockHab?.telemCount) }, null, 2));
console.log(errors.length ? `CONSOLE (${errors.length}):\n` + errors.join('\n') : 'CONSOLE: clean (no errors or warnings)');
await browser.close();
