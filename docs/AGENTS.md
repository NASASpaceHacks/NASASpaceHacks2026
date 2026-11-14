# Build agents — rules + interface specs (read fully before writing code)

Design doc: `docs/designs/marswalk.md`. Contracts: `Shared/src/contracts/` (FROZEN). Everyone builds against these.

## Rules for every agent
1. **One shared checkout**: `/Users/kumarsashank/dev/NASA-Martian-Map/NASASpaceHacks2026`, branch `marswalk/core`. Several agents work **at the same time**.
2. **Edit only the directories you own** (see the table). Never edit `Shared/src/contracts/**`, root `package.json`, `pnpm-lock.yaml`, or other agents' directories. If you need a contract change or a new dependency, **do not make it**. Put it under "Requests" in your final report and work around it.
3. **No git**: don't run `git add/commit/stash/checkout/reset`. The orchestrator commits.
4. **Dependencies are already installed.** Shared: zod, cbor-x, @noble/ed25519, fflate, proj4, ol, d3-contour. Backend: hono, @hono/node-server, ws. Frontends: react 19, react-dom, zustand, ol, proj4, uplot, motion, d3-contour, vite, tailwind v4. Root: vitest, fast-check, tsx, typescript, @playwright/test (no bundled browsers; use `channel: 'chrome'`). Python: `Pipeline/.venv` (rasterio, numpy, scipy, pyproj, requests, pillow).
5. **Scoped checks only**: `pnpm --filter <pkg> typecheck`, `pnpm vitest run <your paths>`. Other agents' work in progress may break global checks, so that isn't your problem unless it's in your directory.
6. **Ports**: Backend 8787, AdminView 5173, UserView 5174. To smoke-test a server, use a *different* port (e.g. 18787) and kill it when done. Never leave background processes running.
7. **Pure engine**: `Shared/src/engine` must not touch the DOM or Node-only APIs (it runs in Node, Web Workers and the visor).
8. **Honesty**: never fabricate data. Cite every model constant in code comments (NTRS/DOI/URL). Use "calibrated"/"reproduces", never "validated". Terrain is never a "shelter".
9. **Final report** (≤300 words): what you built, key files, how to run, test results (actual output), known gaps, Requests.

## Ownership
| Agent | Owns |
|---|---|
| B1 Pipeline | `Pipeline/`, `SitePacks/` |
| B2 Engine | `Shared/src/engine/` (keep `registry.ts` API), `Shared/src/engine/**/*.test.ts` |
| B4 Backend + link | `Backend/`, `Shared/src/link/` |
| B5 AdminView + map kit | `Frontend/AdminView/`, `Shared/src/map/` |
| B6 UserView | `Frontend/UserView/` |
| B8 Bench + Validation | `Research/bench/`, `Validation/` |
| C1 Content | `Content/`, `Research/tracks/` |
| B7 QA (later) | `qa/` |

## Engine public API (B2 implements in `Shared/src/engine/index.ts`; others code against it)
```ts
import type { LoadedSitePack, PlanRequest, PlanResult, FieldSet, CostGrid, PlanPackage, GridSpec, Cell } from '../contracts';
export function buildCostGrid(pack: LoadedSitePack, extraBlocked?: Cell[]): CostGrid;
export function computeFields(pack: LoadedSitePack, req: PlanRequest): FieldSet;        // walkback/shelter/outbound/los/blocked
export function plan(pack: LoadedSitePack, req: PlanRequest): PlanResult;               // sync, deterministic, <1.5 s on 1M cells
export function toPlanPackage(res: PlanResult, req: PlanRequest, fields: FieldSet, grid: GridSpec,
  opts: { seq: number; parent?: string; author: 'hab' | 'earth' }): PlanPackage;        // includes 50 m coarse safety grid
export function encodePackage(pkg: PlanPackage): Uint8Array;                            // canonical CBOR + deflate-raw; ≤25,000 B
export function decodePackage(bytes: Uint8Array): PlanPackage;
// Mars time & sun (Mars24, Allison & McEwen 2000; GISS algorithm steps)
export function marsTime(utcMs: number, lonEastDeg: number): { msd: number; mtcH: number; lmstH: number; ltstH: number; lsDeg: number; eotMin: number };
export function sunPosition(utcMs: number, lonEastDeg: number, latDeg: number): { elevDeg: number; azDeg: number }; // az clockwise from north
export function sunAtLtst(lsDeg: number, ltstMin: number, latDeg: number): { elevDeg: number; azDeg: number };
// Safety core: pure, O(1) per update, zero allocation after creation (runs on the visor)
export interface SafetyState { routeIdx: number; offRouteM: number; nextStopId: string | null; distToNextM: number;
  bearingToNextDeg: number; walkbackMarginMin: number; shelterMarginMin: number; bingoInMin: number | null;
  returnBearingDeg: number; status: 'NOMINAL' | 'CAUTION' | 'RETURN_NOW' }
export interface SafetyCore { update(cell: Cell, tMin: number, o2Pct: number): SafetyState }
export function createSafetyCore(pkg: PlanPackage, grid: GridSpec): SafetyCore;
```
Default registered planners: `PathSearch` ids `dijkstra` (Dial bucket queue) and `astar`; `CostModel` id `pandolf-santee-mars`.

## Surface link API (B4 implements in `Shared/src/link/index.ts`)
```ts
import type { LinkMsg } from '../contracts';
export type LinkStatus = 'up' | 'degraded' | 'down';
export interface Link { send(m: LinkMsg): void; onMessage(cb: (m: LinkMsg) => void): () => void;
  onStatus(cb: (s: LinkStatus) => void): () => void; status(): LinkStatus; close(): void }
export function encodeMsg(m: LinkMsg): Uint8Array;  // CBOR
export function decodeMsg(b: Uint8Array): LinkMsg;  // CBOR + zod validation (LinkMsgSchema)
export function connectWebSocketLink(url: string, role: 'console' | 'visor'): Link; // browser; auto-reconnect; HEARTBEAT 1 Hz; 'down' after 3 missed
export function createMemoryLinkPair(): [Link, Link]; // for the static public demo build (+ latency/loss injection)
```

## Hab server HTTP API (B4 implements; B5/B6 consume)
| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/health` | `{ ok, siteId, uptimeS }` |
| GET | `/api/sitepacks` | `[{ id, name }]` |
| GET | `/sitepacks/:id/*` | static site-pack files (manifest, `.bin`, imagery; HTTP Range supported) |
| POST | `/api/plan` | `PlanRequest` → `PlanResult` (also caches FieldSet under `reqHash`) |
| GET | `/api/fields/:reqHash/:name` | binary `Float32Array` (walkbackMin, shelterMin, outboundMin) or `Uint8Array` (los, blocked), little-endian |
| POST | `/api/confirm` | `{ reqHash }` → `{ id, seq, bytes }` and pushes `ROUTE_PUSH` to the visor |
| GET | `/api/state` | `{ route: PlanPackage \| null, routeAcked: boolean, visorLink: LinkStatus, lastTelem: Telem \| null, events: EventLogEntry[] }` |
| POST | `/api/events` | `{ type: 'SEP_NOWCAST', leadMin } \| { type: 'EVA_CUT', min } \| { type: 'HAZARD', cells }` → new `PlanResult` (replan from current position) |
| POST/GET | `/api/sim` | POST `{ running: boolean, speed: number, reset?: boolean }` stores the desired astronaut-simulator state; GET returns it (the visor polls and runs the simulator) |
| POST | `/api/link` | `{ latencyMs?, lossPct?, drop?: boolean }`: link degrade controls (demo) |
| WS | `/link?role=console\|visor` | binary CBOR `LinkMsg` frames; the server relays visor↔hab and sends HEARTBEAT |

Env: `PORT` (8787), `SITEPACK` (default `gale-v1`; falls back to the in-memory `mockSitePack()` if the pack is missing), `MARSWALK_PATH_SEARCH`, `MARSWALK_COST_MODEL`.

## Fixed area of interest (gale-v1)
- **AOI**: 5 km × 5 km centred on **137.388°E, −4.805°N** (planetocentric). Covers Curiosity's 2025–2026 boxwork-era traverse (sols ~4400–5073). Curiosity at sol 5073: 137.388886°E, −4.82602331°N, −3472 m (`MSL_waypoints_current.json`).
- **Projection** (all agents): `+proj=eqc +lat_ts=-4.8 +lat_0=0 +lon_0=137.39 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs`.
- **Engine grid**: 1000 × 1000 cells at 5 m.
- **Who simulates the astronaut**: the **visor** (UserView) runs the astronaut simulator. It walks the confirmed route with dead-reckoning drift and sends `TELEM` to the hab. When the link drops, the visor keeps walking and guiding autonomously, and the hab just stops receiving telemetry. That's the realistic architecture. The Backend stores the desired sim state (`POST /api/sim {running, speed}`; `GET /api/sim`), and the visor polls `GET /api/sim` while the link is up. The Backend replans "from current position" using the last received `TELEM`.

## Site pack layout (B1 produces; served at `/sitepacks/<id>/`)
`SitePacks/<id>/manifest.json` (validates against `SitePackManifestSchema`) + raw little-endian rasters on the engine grid (`dem.bin` f32, `slope.bin` u16×0.01, `rough.bin`, `ti.bin`, `normals.bin` 2-band, `skyview.bin` optional) + `ortho.webp` or `ortho_cog.tif` + `images/*.jpg`. Total <100 MB; each file <50 MB.

## Design language (both apps)
Mission-control aesthetic: dark graphite background, Mars-ochre and amber accents, cyan for safe/LOS, red only for violations. Monospace numerals (tabular), sans UI text. Every data layer shows its mission credit. No NASA logos. The visor uses pure black (#000) with amber/green vector graphics, large type (cap height ≥3.5 mm at 50 cm), ≤6 key actions, and a mirror toggle.
