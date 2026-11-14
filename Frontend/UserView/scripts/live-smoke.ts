// Live-link smoke: hab server (golden engine) + visor dev server proxied to it.
// tsx Frontend/UserView/scripts/live-smoke.ts <habUrl> <visorUrl>
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { goldenPlanRequest, type SitePackManifest } from '../../../Shared/src/contracts/index';

const hab = process.argv[2] ?? 'http://localhost:18787';
const visor = process.argv[3] ?? 'http://localhost:15175';
const out = resolve(import.meta.dirname, '../docs');
const j = async (path: string, body?: unknown) => {
  const r = await fetch(hab + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(`${visor}/?reset=1`);
await page.waitForFunction(() => document.body.innerText.includes('AWAITING ROUTE') && document.body.innerText.includes('LISTENING'), null, { timeout: 30000 });

const manifest = (await (await fetch(`${hab}/sitepacks/gale-v1/manifest.json`)).json()) as SitePackManifest;
const req = goldenPlanRequest({ manifest, rasters: {}, base: '' });
const plan = await j('/api/plan', req);
console.log('plan', plan.status, plan.body?.status, plan.body?.order, plan.body?.reqHash);
console.log('sim', (await j('/api/sim', { running: true, speed: 30 })).status);
const conf = await j('/api/confirm', { reqHash: plan.body.reqHash });
console.log('confirm', conf.status, conf.body);
await page.waitForFunction(() => document.body.innerText.includes('PRESS'), null, { timeout: 15000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/live-02-new-route.png` });
await page.keyboard.press('a');
await page.waitForTimeout(9000);
const st = await j('/api/state');
console.log('state.routeAcked', st.body?.routeAcked, 'visorLink', st.body?.visorLink, 'lastTelem', JSON.stringify(st.body?.lastTelem));
await page.screenshot({ path: `${out}/live-03-nav.png` });
console.log('impl', await page.evaluate(() => (window as any).__visor && JSON.stringify({ core: (window as any).__visor.core ? 'ok' : null })), await page.evaluate(() => document.querySelector('body')!.innerText.includes('NAV')));
console.log(errors.length ? `CONSOLE (${errors.length}):\n` + errors.join('\n') : 'CONSOLE: clean (no errors or warnings)');
await browser.close();
