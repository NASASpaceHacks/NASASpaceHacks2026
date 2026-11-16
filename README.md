# Marswalk

**Plan a safe walking EVA on real NASA Gale crater terrain, get a GO/NO-GO with reasons, and guide the astronaut on a phone-based AR navigator, even when the link drops.**

NASA Space Apps Challenge 2026 · *Interplanetary Survival Guide: Martian Map* · Team NASASpaceHacks (Toronto)

[Website](https://marswalk-gale.vercel.app) · [Slides](https://marswalk-gale.vercel.app/slides/) · [Paper](docs/paper/marswalk-paper.pdf) · [Hardware report](Mars%20Walk%20Design%20Concept%20Report.pdf) · 30-second film: coming soon

## The problem and what Marswalk does

On Mars, Earth is 3 to 22 light-minutes away, so nobody on Earth can plan or correct a walking EVA in real time. The crew needs a map they can trust and a planner that runs on Mars, offline.

Marswalk runs in the habitat (Hab-1). An EVA officer picks destinations on a map built from real NASA Gale crater data. The planner checks the walk against 12 hard constraints drawn from public NASA EVA documents, each cited (slope, walk radius, walk-back, shelter time, line of sight, daylight, EVA duration, heat and more) and answers GO or NO-GO with the reasons. On confirm, the habitat signs the route and sends it over the local link to the astronaut's phone, which shows an AR navigator. If the link drops, the navigator keeps guiding on the last signed route and its own safety checks. Earth is optional.

## How it works

```
 Habitat (Hab-1)                                  Astronaut
 +-------------------------------+   signed route  +-----------------------------+
 | Frontend/AdminView  console   |  over local     | Frontend/UserView_AR        |
 |   plan, GO/NO-GO, confirm     |  link (LAN)     |   phone AR navigator        |
 |        |                      | --------------> |   chevrons, next turn,      |
 | Backend  hab server           |                 |   PET, HDG, CRS, link dot   |
 |   route engine, event log,    | <-------------- |   keeps guiding offline on  |
 |   surface-link hub            |   telemetry     |   the last signed route     |
 +-------------------------------+                 +-----------------------------+
        ^ site pack (SitePacks/gale-v1): real NASA terrain, imagery, thermal inertia, REMS, DONKI
```

- **Habitat:** the hab server (`Backend/`) runs the route engine from `Shared/` on a site pack, keeps the event log, and relays over the surface link. The console (`Frontend/AdminView/`) is where the EVA officer plans, reads the constraint report and confirms.
- **Astronaut view:** the AR navigator (`Frontend/UserView_AR/`) is a phone web app. The rear camera fills the screen and only glanceable cues are drawn over it: ground chevrons, the next turn, distance and ETA, elapsed time (PET), heading and course, link state, and a RETURN NOW banner with its reason. Consumables (O2, walk-back margin) are checked by the planner and the onboard safety core, not drawn on the AR screen yet.
- **Offline and autonomous:** the navigator verifies the signed route, then runs on its own local route model, simulator and onboard safety core. With no link it keeps guiding and says so; when the link returns it resyncs. Mars has no GPS, so position is dead-reckoned with periodic landmark fixes and a local reroute if the crew drifts off route (see `Frontend/UserView_AR/README.md`).

## Key results

Each number comes from a file in this repo. These are reproductions and calibration checks against published NASA data, not flight validation.

| Result | Number | Source |
|---|---|---|
| Plan solve time, default Gale scenario | 1640 ms for a 6-station plan | `qa/screens/timings.json` (`planSolveMs`, `planStations`) |
| Page load to GO/NO-GO verdict | 2102 ms | `qa/screens/timings.json` (`loadToVerdictMs`) |
| Confirm to signed route verified on the navigator | 168 ms | `qa/screens/timings.json` (`confirmToVisorVerifiedMs`) |
| Link drop to autonomous guidance | 3394 ms | `qa/screens/timings.json` (`dropToAutonomousMs`) |
| Link restore to resync | 1763 ms | `qa/screens/timings.json` (`restoreToResyncMs`) |
| Verdict agreement with an independent re-check, 24 walks | 23 of 24 (95.8%); 0 cases where the engine said GO and the check said NO-GO | `Validation/v4_crosscheck/summary.json` |
| Naive slope-only plans that break at least one hard rule, 200 scenarios | 199 of 200 (99.5%) | `Validation/v3_impact/README.md`, `summary.json` |
| Terrain shielding reproduction (Guo et al. 2026) | 1.98 pp MAE on obstructed-sky ratio, r = 0.935 | `Validation/v1_shielding/summary.json` |
| Suited metabolic model vs NASA Mark III data | 20.8% MAPE over 20 conditions; under-predicts at 0.12 to 0.17 g | `Validation/v2_metabolic/summary.json`, `README.md` |
| Planner benchmark, `gale-v1` (40 static + 40 hidden-hazard scenarios, seed 1) | A* has 0.000% optimality gap vs a Dijkstra oracle and 0 violations; median 11.18 ms vs 35.99 ms for Dijkstra | `Research/bench/results/latest/leaderboard.md` |
| Unit tests | 138 of 138 passed on 2026-11-15 | `docs/paper/README.md` |

The v3 impact study found no optimality advantage over a nearest-first planner that uses the same safety checker. The measured value is the safety check and its speed. Caveats for every study are in its README under `Validation/`.

## Run it

**Prerequisites:** Node 22 or newer, pnpm 10.28.2 (`packageManager` in `package.json`). The pipeline also needs Python with `Pipeline/.venv`; the paper figures need matplotlib and numpy from that venv.

```sh
pnpm install
pnpm demo
```

`pnpm demo` (`qa/demo.mjs`) starts three processes, with a fresh hab state and the `gale-v1` site pack, fully offline:

| Process | Default port | Env override |
|---|---|---|
| Hab server (`Backend`) | 8787 | `DEMO_HAB_PORT` |
| Habitat console (`Frontend/AdminView`) | 5173 | `DEMO_CONSOLE_PORT` |
| Desktop visor (`Frontend/UserView`, dev view) | 5174 | `DEMO_VISOR_PORT` |

It prints the URLs (including LAN URLs) and stops all three on Ctrl+C. If a port is busy it says so and exits without killing anything. The AR navigator is not part of `pnpm demo`; start it as below.

### AR navigator on a phone

```sh
pnpm dev:backend      # hab server on :8787 (the console pushes routes through it)
pnpm dev:ar           # AR navigator on port 5175, served over HTTPS
```

Open `https://<your-computer-ip>:5175` on the phone (same Wi-Fi), accept the self-signed certificate warning, and tap **Start AR visor**. iOS only allows camera and compass on a secure origin, so HTTPS is the default. Use `MW_HTTPS=0` for plain HTTP on a desktop, and `MW_HAB=http://host:port` to point at a different hab server.

Mock mode, with no backend: `https://<ip>:5175/?mock=1&pack=gale-v1` (add `&reset=1` to cold start). Details: [`Frontend/UserView_AR/README.md`](Frontend/UserView_AR/README.md).

### Other commands

| Command | What it does |
|---|---|
| `pnpm dev` | Hab server, console and desktop visor in watch mode |
| `pnpm test` | Unit tests (vitest) |
| `pnpm ci` | Typecheck all packages, then unit tests |
| `pnpm e2e` | Full demo flow end to end (Playwright, real engine, real Gale data) |
| `pnpm test:ux` | Playwright interaction tests |
| `pnpm bench` | Planner benchmark; see [`Research/planners/README.md`](Research/planners/README.md) |
| `pnpm sitepack` | Site-pack builder (`Pipeline/.venv/bin/python Pipeline/build_sitepack.py`); needs the Pipeline venv and network access to NASA servers. Usage: [`Pipeline/README.md`](Pipeline/README.md) |

The two site packs (`gale-v1`, `jezero-v1`) are already committed in `SitePacks/`, so you do not need the pipeline to run the demo.

## Repo map

| Folder | What is in it |
|---|---|
| `Backend/` | Hab server: plan and confirm API, surface-link hub, event log, site-pack loader, simulated walker |
| `Frontend/AdminView/` | Habitat console: 2D Mars map, safe zone, constraint report, confirm |
| `Frontend/UserView_AR/` | Phone AR navigator: the astronaut view the team presents |
| `Frontend/UserView/` | Desktop visor cockpit; secondary/dev view that shares its controller with the AR navigator |
| `Shared/` | Contracts, route engine, map kit, surface link |
| `Pipeline/` | Python site-pack builder (HiRISE, THEMIS, MSL traverse, REMS, DONKI) |
| `SitePacks/` | Built packs for Gale (`gale-v1`) and Jezero (`jezero-v1`): terrain rasters, imagery, manifest with provenance |
| `Research/` | Route-planning research, pluggable planners, benchmark harness (`bench/`), per-teammate tracks |
| `Validation/` | Studies V1 to V5 reproducing published NASA results (shielding, metabolic cost, impact, cross-check, RAD dose) |
| `Content/` | EVA constraints (each cited), Science Traceability Matrix, stations and gazetteer for each site |
| `Website/` | Static project site (deployed to Vercel), slide viewer, PDFs |
| `docs/` | Design, explainer, walkthrough, paper, pitch material, research notes |
| `qa/` | Demo launcher, Playwright e2e and UX tests, screenshots and `timings.json` |

## Read more

Start with the website for the overview; the other materials each have one job.

| Material | Role |
|---|---|
| [Website](https://marswalk-gale.vercel.app) ([source](Website/), [README](Website/README.md)) | Main overview, start here |
| [Slides](https://marswalk-gale.vercel.app/slides/) · [PDF](Website/files/marswalk-slides.pdf) | The 10-slide visual pitch |
| [Research paper](docs/paper/marswalk-paper.pdf) ([sources and scripts](docs/paper/README.md)) | Detailed write-up: models, engine, evaluation |
| [Hardware concept report](Mars%20Walk%20Design%20Concept%20Report.pdf) | Helmet optics, localization, suit compute |
| 30-second film | Coming soon |

Docs in the repo:

- [`docs/EXPLAINER.md`](docs/EXPLAINER.md): plain-language explainer
- [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md): product walkthrough
- [`docs/designs/marswalk.md`](docs/designs/marswalk.md): design doc; [`docs/designs/console-ux.md`](docs/designs/console-ux.md): console UX
- [`docs/AGENTS.md`](docs/AGENTS.md): module boundaries and API specs
- [`docs/pitch/`](docs/pitch/): pitch script, project page text, Q&A, feature list
- [`docs/research/`](docs/research/): existing solutions, NASA data audit, parameter audit, impact evidence
- [`docs/reference/nasa-data-and-weights.md`](docs/reference/nasa-data-and-weights.md): NASA data sources and weights
- [`SitePacks/README.md`](SitePacks/README.md) and [`Pipeline/README.md`](Pipeline/README.md): site-pack format and build
- [`Research/tracks/README.md`](Research/tracks/README.md): research tracks and how results are judged; [`Research/planners/README.md`](Research/planners/README.md): planner interface and benchmark
- `Validation/v1_shielding/` to `Validation/v5_rad_dose/`: each has a README with method and caveats

## NASA data and credits

Site packs are built from public NASA and partner data; each raster's mission, product, URL, licence and citation are in `SitePacks/*/manifest.json`.

- HiRISE stereo DTMs and colour imagery: NASA/JPL-Caltech/University of Arizona (Mars Reconnaissance Orbiter)
- Gale merged DEM (HiRISE, CTX, HRSC, MOLA): USGS Astrogeology / NASA PDS Annex
- Curiosity traverse, Mastcam and Navcam images, REMS and RAD data: NASA/JPL-Caltech/MSSS (Mars Science Laboratory)
- THEMIS thermal inertia: NASA/JPL-Caltech/Arizona State University (2001 Mars Odyssey)
- Space weather: NASA CCMC DONKI
- Models are checked against published work, including Guo et al. 2026 (shielding) and Norcross et al. 2010 (suited metabolic cost); see `Validation/`

## Use of AI disclosure

The concept, architecture decisions and scope are the team's. Much of the code was generated with Claude Code (Anthropic) under the team's direction and review. No AI runs inside Marswalk: planning, safety checks and guidance are deterministic code. NASA logos are not used.

## Team

Kumar Sashank Ghanta, Ivan Chen, George Postica, Mirim Yu, Michelle Wang.

## License

Apache-2.0 (see [`LICENSE`](LICENSE)).
