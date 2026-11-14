# Mars EVA Navigator: Frontend MVP

There are two views for one ~1 km² EVA area on the Jezero crater floor, centred on the Perseverance landing site:

- **AdminView**: Habitat Mission Control. Explore the data layers, place waypoints, set priorities, compare routes, deploy a route and monitor the EVA.
- **UserView**: Astronaut HUD. A visor display with heading, waypoint guidance, hazard look-ahead, resources, off-route guidance and emergency return.

```bash
cd Frontend && npm install && npm run dev
```

Open `http://localhost:5173/`, then open both views in separate tabs or windows. Deploy from Mission Control, then press **Space** in the HUD to start the EVA. Press **H** in the HUD to see the controls. If Mission Control is not open, the HUD can load a demo mission that it plans locally.

## The problem we're solving

The challenge asks for a layered map built from several NASA missions that helps an astronaut plan and carry out a Marswalk safely. NASA's Joint AR study (Smith et al., *IEEE Aerospace 2026*, `Research/docs/research/IEEE 2026 JointAR Final.pdf`) measured what goes wrong without one:

- In the JETT3 analog, about 30% of spoken words and 20% of loop time were about navigation. Crew spent 13% of their time consulting map books and made no progress while doing it.
- On Apollo 14 EVA 2, the crew could not find Cone Crater's rim from about 20 m away.
- With a paper map, the median waypoint miss was 4.47 m (up to 78 m). With the AR HUD it was 1.79 m. Navigation time fell from 15.9 to 13.2 min, heading RMSE from 48° to 28°, and usability (NMSUS) rose from 53 to 84.

Mars makes this harder than the Moon: there is no GPS, the one-way light time to Earth is 4–24 min, and nobody has ever walked there in a suit at 0.38 g.

## What we kept from Joint AR

The study found these features worked, so the HUD keeps them: a heading cone and directional arrow, planned path drawn dashed and the walked track drawn solid, distance to the next waypoint with a progress bar, automatic waypoint sequencing, phase elapsed time (PET), a mainly green monochrome display, and controls limited to a dial and two buttons (Q/E for the dial, Space and Tab for the buttons).

## What we do better

Each row starts from a weakness or request reported by crew in the paper.

| Crew finding (paper) | What we built |
|---|---|
| "No navigation hazards depicted" | Hazard layers come from the HiRISE 1 m DTM: slope, detrended roughness, and an exclusion mask with a hatched texture. The router fails closed on excluded terrain. The HUD looks 40 m ahead along the path ("Slope 13° in 25 m") and reports excluded terrain nearby by clock position. |
| Asked for an indication of system accuracy | The HUD shows position ±1σ, modelled as visual-odometry drift of 2% of distance walked. A **landmark fix** (F) resets it. When uncertainty is larger than the task tolerance (3 m for a sample, 0.5 m for an instrument, per xEVAS ConOps) the HUD warns before arrival is declared. |
| Asked for landmarks, which paper maps did well | The 52 localized Perseverance stops serve as surveyed landmarks, with clock bearings on the HUD. Each one has a real Navcam image, shown as the expected view at a waypoint (SCIENCE page) and as the HUD backdrop. |
| Asked for auto-scaling, range ticks and a bullseye | The minimap auto-scales to the next waypoint and has labelled range rings, heading-up or north-up display, and a north bezel marker. |
| "Risk of technology dependence" | All data, routing and re-planning run locally in both views. The HUD can re-plan a leg (G) or plan an emergency return (R R) with no habitat link. Earth is never in the loop. |
| Paper map was better for "studying the route pre-EVA" | Mission Control is the pre-EVA study tool. It compares routes (Fastest, Safest, Science-rich, Custom) and shows an elevation profile and a **return-margin** chart with the turn-back limit. |
| AR arrow pointed straight at the waypoint | The HUD arrow follows the **safe path** (10 m look-ahead). A second caret shows the direct bearing, so crew know when the path bends around terrain. |
| Distance estimation was poor with paper maps | The HUD shows path distance, direct distance, distance left for the whole EVA, ETA and walk-back time. |
| Ground and crew were both unsure where the crew was | The HUD sends telemetry once a second (position, uncertainty, status, margin, consumables). Crew can drop **hazard or science pins** that become no-go zones in Mission Control. |
| A monochrome display was chosen to save power | The display stays green, but amber and red are reserved for cautions and warnings. These also differ by dashed or thick borders and ▲/△ symbols, so severity never depends on colour alone. **C** switches to strict monochrome. |

Some features have no counterpart in Joint AR. **Return-margin monitoring** checks at every point on the route that elapsed time plus walk-back time plus reserve stays within the EVA budget, so the turn-back point is known before stepping out. The HUD also shows the Mars local time (LMST), Sun elevation and Earth light time, computed locally with the Mars24 algorithm and an approximate ephemeris.

## NASA data used (all bundled for offline use)

| Layer | Mission / source | Evidence |
|---|---|---|
| Optical, 50 cm | MRO HiRISE orthomosaic (USGS Mars 2020 TRN) | measured |
| Elevation, 1 m; slope and roughness | MRO HiRISE stereo DTM, DOI 10.5066/P9REJ9JN | measured / derived |
| Thermal | Mars Odyssey THEMIS night IR (Mars Trek WMTS), used as a proxy for thermal inertia | measured, ~100 m |
| Spectral | MRO CRISM targeted observation footprints (PDS ODE REST) | measured (coverage only) |
| Landmarks, traverse, POV images | Mars 2020 Perseverance MMGIS waypoints and raw image API | measured |

`Research/scripts/export_frontend_data.py` regenerates `public/data/`. It reads small windows over HTTP range requests and records provenance in `meta.json`. Rover-reported elevations match the DTM (median difference 0.00 m), which confirms the layers are co-registered.

## Honest limits

- The walking speed (0.5 m/s), grade coefficients, the 15° slope and 10 cm roughness limits, and the budget and reserve are **engineering assumptions** carried over from the research prototype. They are not suit-certified values.
- O₂, battery, position drift and the astronaut's motion are **simulated** in the HUD. Radiation uses the MSL RAD average measured at Gale (0.64 mSv/day), not a measurement at Jezero.
- THEMIS covers only about 12 pixels across this area. CRISM is shown as coverage footprints only; the spectral cubes are not processed.
- In this MVP the habitat–suit link is a browser BroadcastChannel, so both views must run in the same browser.

## Layout

```
Frontend/
  index.html            launcher
  AdminView/            Mission Control (App.tsx, admin.css)
  UserView/             HUD (Hud.tsx, MiniMap.tsx, sim.ts, hud.css)
  shared/               data loading, router (A*, Dijkstra, ordering), map canvas, Mars time, link
  public/data/          baked NASA layers (generated)
```
