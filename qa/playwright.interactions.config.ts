import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * Real-interaction UX tests for the habitat console (`pnpm test:ux`): REAL gale-v1 site pack, REAL engine,
 * driven only by real mouse and keyboard input (no store calls, no dispatched events). Hab server and
 * console run on test ports, so a developer's dev servers on 8787/5173/5174 are never touched.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HAB_PORT = 18787;
const CONSOLE_PORT = 15173;
const HAB = `http://localhost:${HAB_PORT}`;
process.env.MARSWALK_UX_VAR_DIR ??= mkdtempSync(join(tmpdir(), 'marswalk-ux-'));
const VAR_DIR = process.env.MARSWALK_UX_VAR_DIR;

export default defineConfig({
  testDir: './e2e',
  testMatch: /interactions\.spec\.ts$/,
  outputDir: './test-results-ux',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: `http://localhost:${CONSOLE_PORT}`,
    viewport: { width: 1440, height: 900 },
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
  ],
});
