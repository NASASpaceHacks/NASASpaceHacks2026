# Project page draft (NASA Space Apps 2026): Marswalk (working name)

Status: draft v0 by C1. Replace bracketed items. Keep claims to what the repo shows.

## Project name
Marswalk (working name)

## Summary (about 250 characters)
A two-device Mars EVA route planner. The habitat console computes constraint-safe walking routes from NASA flight rules and multi-mission data; the astronaut's visor guides her and keeps working if the link to the habitat drops.

## Detailed description
**The problem.** On Mars the habitat crew is the primary EVA support: Earth is 3 to 22 minutes away and unreachable for about 13 days at conjunction (Mars DRA 5.0). NASA's Flight Operations constraints for a traverse include maximum distance from the lander, safe slope, time without line of sight to the lander, lighting and consumables, and NASA's own papers name the gaps: real-time suit data is not tied to traverse planning, plans and actuals are poorly coupled, and science priorities conflict with the achievable route (NTRS 20250006063, 20260001895).

**What we built.**
1. A habitat console (Admin view) that generates routes where every flight rule is a hard constraint. Each plan states its margins, the binding constraint ("limited by shelter time at St 3"), bingo times, and why any science station was dropped.
2. An astronaut visor (User view): a glass cockpit with heading, next stop, walkback and shelter margin. It runs its own safety core and keeps guiding when the link is lost.
3. A surface link between them: CONFIRM, push, ACK; replanning in under one second for a solar-storm nowcast, a shortened EVA, or an astronaut-reported hazard. [verify latency]
4. A science traceability matrix tied to the Curiosity team's 2025-2026 boxwork campaign at Gale crater: 12 stations, each traced to an objective and a cited NASA mission blog post.
5. A benchmark harness for route-search algorithms and cost models. Research results (A*, D* Lite, Theta*, CVaR risk models) replace the baseline only if they win with zero constraint violations.

**Site.** A 5 km by 5 km area of Gale crater centred on 137.388 E, 4.805 S, covering Curiosity's boxwork-era traverse (sols about 4400-5073). Jezero is planned as a second site. The engine is site-agnostic.

**Honest limits.** Models are calibrated or reproduce published data, and are not validated for flight. Station values are team priorities. Station coordinates are Curiosity rover positions matched to blog posts, good to about 10-20 m. Habitat-to-visor networking is simulated in the public demo build. The visor is a screen UI, not hardware.

## NASA data used
[Confirm the final list against `SitePacks/gale-v1/manifest.json` provenance before submitting.]
- Curiosity rover waypoints and imagery, MSL MMGIS: https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json
- Curiosity mission blog (science.nasa.gov), cited per station in `Content/stations.gale.json`; e.g. https://science.nasa.gov/blog/curiosity-blog-sols-4689-4694-drill-in-the-boxwork-unit-is-go/
- HiRISE / CTX / MOLA / THEMIS elevation and imagery of Gale via the Planetary Data System: https://pds-geosciences.wustl.edu/ and https://hirise.lpl.arizona.edu/dtm/ [list the exact products used]
- Curiosity REMS weather and RAD radiation data (PDS) [confirm used]
- USGS Gazetteer of Planetary Nomenclature (names): https://planetarynames.wr.usgs.gov
- NASA Technical Reports Server papers (flight rules, ConOps): https://ntrs.nasa.gov (ids in `Shared/src/contracts/rules.ts`)
- AI4Mars (NASA Open Data, license not specified, research only): https://data.nasa.gov/dataset/ai4mars-a-dataset-for-terrain-aware-autonomous-driving-on-mars [only if used]

## Partner / references
- Caswell et al. 2025, ASCEND, NTRS 20250006063
- NTRS 20230014957; 20260001895; 20230005904; 20240002135; 20230008183
- Norcross et al. 2010, NASA/TP-2010-216125 (suited metabolic data)
- Carsten et al. 2009, https://doi.org/10.1002/rob.20287; Endo et al. 2023, https://doi.org/10.1109/ICRA48891.2023.10161466; Candela and Wettergreen 2022, https://doi.org/10.1109/LRA.2022.3191949
- Allison and McEwen 2000 (Mars24 time algorithm)
- No partner organisations. NASA logos are not used.

## Use of artificial intelligence
[Edit to match what the team actually did.] Large parts of the code (engine, backend, both frontends, tests, data pipeline) were written by AI coding agents (Anthropic Claude via Claude Code) under human direction; humans set the concept, reviewed and merged the code, chose the research directions, and wrote the pitch. AI also drafted the science content, station list, flight-rule mirror and pitch scripts; humans must check every citation against its source. No generative AI imagery or video is presented as NASA data. Every NASA image and dataset is credited to its mission.

## Links
- Repository: [https://github.com/NASASpaceHacks/NASASpaceHacks2026]
- Video (30 s): [URL]
- Live demo: [URL]
