# Marswalk — habitat-to-helmet EVA planning for the first humans on Mars

NASA Space Apps Challenge 2026 · *Interplanetary Survival Guide: Martian Map* · Team NASASpaceHacks (Toronto)

> Working name: the team chooses the final product name.

The habitat EVA officer plans a constraint-safe Marswalk on a correct Mars map built from 6+ NASA missions, confirms it, and pushes it over the local surface link to the astronaut's visor. If the link drops, the visor still brings her home. Earth is 3–22 light-minutes away, so everything runs on Mars, offline.

- **Design doc**: [`docs/designs/marswalk.md`](docs/designs/marswalk.md)
- **Build agents + API specs**: [`docs/AGENTS.md`](docs/AGENTS.md)
- **Explainer (start here)**: [`docs/EXPLAINER.md`](docs/EXPLAINER.md)
- **Product walkthrough**: [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md)
- **Research tracks for humans**: [`Research/tracks/README.md`](Research/tracks/README.md)

## Layout
| Folder | What |
|---|---|
| `Backend/` | Hab server: plan/confirm API, surface-link hub, event log, sim walker |
| `Frontend/AdminView/` | Habitat console (2D Mars map, safe zone, constraint report, confirm) |
| `Frontend/UserView/` | Astronaut visor glass cockpit |
| `Shared/` | Contracts, route engine, map kit, link |
| `Pipeline/` | Python site-pack builder (HiRISE, THEMIS, MSL traverse, REMS, DONKI) |
| `Research/` | Route-planning research, research planners, benchmark harness |
| `Validation/` | Reproductions against NASA data (RAD shielding, suited metabolic data) |
| `Content/` | Flight rules, Science Traceability Matrix, stations (all cited) |

## Quick start
```sh
pnpm install
pnpm demo          # hab server (gale-v1) + Habitat Console :5173 + Visor :5174, fresh state; prints URLs
pnpm ci            # typecheck + unit tests
pnpm e2e           # full demo flow end-to-end (Playwright, real engine, real Gale data)
pnpm bench         # planner benchmark (see Research/planners/README.md)
```

## Data & credits
NASA/JPL-Caltech/University of Arizona (HiRISE), NASA/JPL-Caltech/MSSS (Curiosity), ASU (THEMIS), USGS Astrogeology, NASA CCMC (DONKI). Full citations: see the project page and `SitePacks/*/manifest.json` provenance.

## Use of AI ("Super Intelligence") disclosure
The concept, architecture decisions and scope are the team's. Much of the code was generated with Claude Code (Anthropic) under the team's direction and review. No AI-generated imagery is used. NASA logos are not used.

## License
Apache-2.0
