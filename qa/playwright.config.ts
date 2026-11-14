import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end demo flow on the REAL gale-v1 site pack with the REAL engine (not the golden fixture):
 * hab server (Backend) + habitat console (AdminView) + EVA visor (UserView), each on a test port so a
 * developer's dev servers on 8787/5173/5174 are never touched. Chrome is used through `channel`
 * (no bundled browsers in this repo). Run: `pnpm e2e`.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const HAB_PORT = 18787;
export const CONSOLE_PORT = 15173;
export const VISOR_PORT = 15174;
const HAB = `http://localhost:${HAB_PORT}`;
// Fresh hab state (signing key + event log) per run, so no route is replayed from an earlier session.
// (Set once in the runner process; test workers inherit it instead of creating their own.)
process.env.MARSWALK_E2E_VAR_DIR ??= mkdtempSync(join(tmpdir(), 'marswalk-e2e-'));
const VAR_DIR = process.env.MARSWALK_E2E_VAR_DIR;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      name: 'hab',
      command: 'pnpm --filter ./Backend start',
      cwd: ROOT,
      url: `${HAB}/api/health`,
      env: { PORT: String(HAB_PORT), SITEPACK: 'gale-v1', MARSWALK_VAR_DIR: VAR_DIR },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'console',
      command: `pnpm --filter ./Frontend/AdminView exec vite --port ${CONSOLE_PORT} --strictPort`,
      cwd: ROOT,
      url: `http://localhost:${CONSOLE_PORT}/`,
      env: { HAB_URL: HAB },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      name: 'visor',
      command: `pnpm --filter ./Frontend/UserView exec vite --port ${VISOR_PORT} --strictPort`,
      cwd: ROOT,
      url: `http://localhost:${VISOR_PORT}/`,
      env: { MW_HAB: HAB },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
