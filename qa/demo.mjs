#!/usr/bin/env node
/**
 * `pnpm demo`: one command for a walkthrough or pitch, fully offline.
 *   hab server (Backend, SITEPACK=gale-v1, fresh MARSWALK_VAR_DIR) + habitat console + EVA visor,
 * then prints the two URLs to open (and LAN URLs for a second device on the same router).
 * Ctrl+C stops all three. Nothing already listening on a port is ever killed: if a port is busy the
 * launcher says so and exits.
 *
 * Ports: 8787 / 5173 / 5174 by default; override with DEMO_HAB_PORT, DEMO_CONSOLE_PORT, DEMO_VISOR_PORT
 * (e.g. DEMO_HAB_PORT=18787 DEMO_CONSOLE_PORT=15173 DEMO_VISOR_PORT=15174 pnpm demo).
 * Keep the hab state with DEMO_KEEP_VAR=1 (otherwise the fresh temp dir is removed on exit).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const port = (name, def) => {
  const v = Number(process.env[name] ?? def);
  if (!Number.isInteger(v) || v <= 0 || v > 65535) throw new Error(`${name} must be a TCP port, got ${process.env[name]}`);
  return v;
};
const HAB_PORT = port('DEMO_HAB_PORT', 8787);
const CONSOLE_PORT = port('DEMO_CONSOLE_PORT', 5173);
const VISOR_PORT = port('DEMO_VISOR_PORT', 5174);
const HAB = `http://localhost:${HAB_PORT}`;
const SITEPACK = process.env.SITEPACK ?? 'gale-v1';

const c = process.stdout.isTTY ? { dim: '\x1b[2m', b: '\x1b[1m', amber: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m', off: '\x1b[0m' } : { dim: '', b: '', amber: '', cyan: '', red: '', off: '' };

/** True when something accepts connections on the port (IPv4 or IPv6 loopback). */
function busy(p) {
  const probe = (host) =>
    new Promise((res) => {
      const s = connect({ port: p, host });
      s.setTimeout(400);
      s.once('connect', () => (s.destroy(), res(true)));
      s.once('timeout', () => (s.destroy(), res(false)));
      s.once('error', () => res(false));
    });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}

const children = [];
let stopping = false;
let varDir = '';

function start(name, args, env) {
  const child = spawn('pnpm', args, {
    cwd: ROOT,
    env: { ...process.env, ...env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so pnpm → tsx/vite → node all stop together
  });
  const tag = `${c.dim}[${name}]${c.off} `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim() && (process.env.DEMO_VERBOSE || /error|warn|fail/i.test(line))) out.write(tag + line + '\n');
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, sig) => {
    if (stopping) return;
    console.error(`${c.red}${name} exited (${sig ?? code}); stopping the demo.${c.off} Run with DEMO_VERBOSE=1 for its full output.`);
    void stop(1);
  });
  children.push({ name, child });
  return child;
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, 1200));
  for (const { child } of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  if (varDir && !process.env.DEMO_KEEP_VAR) rmSync(varDir, { recursive: true, force: true });
  process.exit(code);
}

async function waitFor(url, label, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    if (stopping) return;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label} did not come up at ${url} within ${timeoutMs / 1000} s`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

const taken = [];
for (const [p, what] of [[HAB_PORT, 'hab server'], [CONSOLE_PORT, 'console'], [VISOR_PORT, 'visor']]) if (await busy(p)) taken.push(`${p} (${what})`);
if (taken.length) {
  console.error(`${c.red}Port${taken.length > 1 ? 's' : ''} already in use: ${taken.join(', ')}.${c.off}`);
  console.error('Stop whatever is running there (another `pnpm demo` or `pnpm dev`?), or pick other ports:');
  console.error('  DEMO_HAB_PORT=18787 DEMO_CONSOLE_PORT=15173 DEMO_VISOR_PORT=15174 pnpm demo');
  process.exit(1);
}

varDir = mkdtempSync(join(tmpdir(), 'marswalk-demo-'));
console.log(`${c.b}MARSWALK${c.off} ${c.dim}demo launcher · site pack ${SITEPACK} · fresh hab state ${varDir}${c.off}`);
const t0 = Date.now();
start('hab', ['--filter', './Backend', 'start'], { PORT: String(HAB_PORT), SITEPACK, MARSWALK_VAR_DIR: varDir });
start('console', ['--filter', './Frontend/AdminView', 'exec', 'vite', '--port', String(CONSOLE_PORT), '--strictPort', '--host'], { HAB_URL: HAB });
start('visor', ['--filter', './Frontend/UserView', 'exec', 'vite', '--port', String(VISOR_PORT), '--strictPort', '--host'], { MW_HAB: HAB });

try {
  process.stdout.write(`${c.dim}starting hab server, console and visor…${c.off}\n`);
  await waitFor(`${HAB}/api/health`, 'hab server');
  const health = await (await fetch(`${HAB}/api/health`)).json();
  await Promise.all([waitFor(`http://localhost:${CONSOLE_PORT}/`, 'console'), waitFor(`http://localhost:${VISOR_PORT}/`, 'visor')]);
  if (stopping) process.exit(1);
  const pack = health.sitePack?.source === 'mock' ? `${c.red}synthetic pack (${health.sitePack.reason ?? 'gale-v1 missing'})${c.off}` : health.siteId;
  const lan = lanAddresses();
  const line = '─'.repeat(64);
  console.log(`\n${c.amber}${line}${c.off}`);
  console.log(`  ${c.b}Marswalk is up${c.off} in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${pack} · ${health.engine?.plan ? 'real engine' : `${c.red}golden fixture (engine unavailable)${c.off}`} · offline`);
  console.log('');
  console.log(`  ${c.b}Habitat console${c.off}  ${c.cyan}http://localhost:${CONSOLE_PORT}/${c.off}`);
  console.log(`  ${c.b}EVA visor${c.off}        ${c.cyan}http://localhost:${VISOR_PORT}/?reset=1${c.off}`);
  if (lan.length) {
    console.log('');
    console.log(`  ${c.dim}Second device on the same network:${c.off}`);
    for (const ip of lan.slice(0, 2)) console.log(`  ${c.dim}console http://${ip}:${CONSOLE_PORT}/   visor http://${ip}:${VISOR_PORT}/?reset=1${c.off}`);
  }
  console.log('');
  console.log(`  ${c.dim}Console keys: G plan · S explain safe zone · C review/confirm · E evidence · ? all keys${c.off}`);
  console.log(`  ${c.dim}Visor keys:   A accept route · N tick task · D demo panel · M mirror${c.off}`);
  console.log(`  ${c.dim}Hab server ${HAB} · Ctrl+C stops everything${c.off}`);
  console.log(`${c.amber}${line}${c.off}\n`);
} catch (err) {
  console.error(`${c.red}${err instanceof Error ? err.message : String(err)}${c.off}`);
  await stop(1);
}
