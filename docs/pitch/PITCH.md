# Marswalk (working name): pitch v0

Status: draft v0 by C1. The team picks the final product name. Numbers marked [verify] come from the design doc and must be checked against `numbers.json` / the running app before the pitch. Quotes must be re-checked against the NTRS PDFs.

## Live pitch, 4:00 max (design doc section 14)

Setup: two devices on a travel router (habitat console on the projector, astronaut visor on a second screen). Demo director seeded and offline. Backup video ready.

### 0:00 Hook (20 s)
**Speaker 1:** "A crew member steps onto Mars. Earth is 3 to 22 minutes away by radio, and at conjunction the link is gone for about 13 days. Today she walks across the boxwork terrain Curiosity explored in 2025. Who keeps her safe, and who decides where she goes?"
Screen: Gale crater map, Curiosity's real traverse overlaid.

### 0:20 NASA's own words (25 s)
**Speaker 1:** "NASA has already written the problem down."
- "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions... upon locally sourced information." (NTRS 20230014957)
- Flight Operations lists the constraints a traverse must obey: "max traverse distance, max distance from lander, lighting, max safe slope, max time without LOS to lander, consumables redlines." (NTRS 20250006063, Caswell et al., ASCEND 2025)
- And the gaps: "integrate real-time EV data (e.g., suit consumables...) with traverse planning" (NTRS 20260001895); "better coupling between timelines and plans", "planned vs. actual" (Deans 2017); "conflicts arise between science priorities and the achievable route" (Caswell 2025); "validation is still needed" (Miller 2024).
**Speaker 1:** "We built the missing tool, and we say where it is only calibrated, not validated."

### 0:45 Demo moment 1: Safe Zone (50 s)
**Speaker 2:** "This is the habitat console. Layers from six NASA missions on one Mars grid, each credited. Watch the reachable area as I turn constraints on, one at a time."
Actions: turn on slope limit, then walkback, then shelter time, then line of sight; the zone shrinks. The route snaps inside. Point at the binding constraint text ("limited by shelter time at St 3") and a dropped station ("St 7 dropped: walkback, -18 min").
**Speaker 2:** "On foot, time to shelter limits the EVA before oxygen does." (A 30 minute shelter rule at 0.56 m/s is about a 1 km radius, so the pressurized rover is the safe haven. [verify])
Action: drag the rover marker; the zone grows. Click CONFIRM.

### 1:35 Demo moment 2: Two devices, one link (45 s)
**Speaker 3:** "CONFIRM sends the route to the visor. She accepts route version 1."
Actions: visor shows the glass cockpit (heading, next stop, walkback margin). At the station, Curiosity's real photo shows what she will see. Show the helmet CAD render.
**Speaker 3:** "The visor keeps its own safety core. It does not need the habitat to know when to turn around."

### 2:20 Demo moment 3: Earth goes dark (40 s)
**Speaker 2:** "A solar particle event nowcast arrives."
Actions: trigger SEP nowcast; the plan reroutes in under one second [verify latency]; then cut the network.
**Speaker 3:** "The link is down. The visor is still guiding her home. Autonomy is the default, not the fallback."

### 3:00 Credibility (25 s)
**Speaker 1:** "Chips on screen: validation items V1, V2, V6, V7 [replace with the real results], a benchmark of five or more planners where research winners need zero constraint violations, and a route that fits in about 6 KB while Curiosity's daily uplink is about 28 KB [verify both]."
Wording on screen: "calibrated" / "reproduces", never "validated".

### 3:25 Impact (35 s)
**Speaker 1:** "The science list comes from the Curiosity team's own boxwork campaign: a hollow and a ridge drilled as a pair, to learn how boxwork formed and what groundwater did there. The engine takes any elevation model, so the same code can plan Artemis lunar EVAs. It is open source under Apache-2.0 [verify license]. The next step is hardware: this visor on a real helmet."
Close: "Marswalk (working name). Plan it on the ground; carry it on the helmet."
Total: 4:00. If over, cut the "gaps" quote list first.

## The 3 demo moments (one line each)
1. **Safe Zone**: reachable area shrinks as constraints turn on; route snaps inside; drag the rover and it grows.
2. **Two devices, one link**: CONFIRM, visor gets route v1, Curiosity's real photo at the station.
3. **Earth goes dark**: storm nowcast, reroute under 1 s, network cut, the visor still brings her home.

## 30-second video (must be 30.0 s or less)
Rules: real NASA imagery and our own screen recordings only; Space Apps brand assets; no NASA logos; captions on; music royalty-free with licence noted.

| Time | Picture | Voice-over / caption text |
|---|---|---|
| 0:00-0:02 | Title card with team names | Caption: "[Team name] presents" |
| 0:02-0:05 | Gale crater, Mount Sharp, a suited figure silhouette | Voice: "NASA Space Apps 2026: plan a Marswalk." Caption: "Challenge: a layered map for the first Mars EVA" |
| 0:05-0:10 | Safe zone animating on the 2D map | Caption: "Marswalk (working name). Walk far. Come back safe." (tagline is a draft) |
| 0:10-0:12.5 | Shot 1: six data layers stack on one grid | Caption: "Six NASA missions, one Mars grid" |
| 0:12.5-0:15 | Shot 2: constraints shrink the zone, binding constraint shown | Caption: "FOD flight rules as hard limits" |
| 0:15-0:17.5 | Shot 3: confirm on console, route appears on the visor | Caption: "Habitat plans, visor guides" |
| 0:17.5-0:20 | Shot 4: Earth goes dark, visor keeps guiding | Caption: "Link lost. She still gets home." |
| 0:20-0:27 | Future: any DEM, Artemis lunar EVAs, hardware visor render | Caption: "Any terrain. Moon next. Open source." |
| 0:27-0:30 | End card with URL | Caption: "[project URL]" |
Data credits for the end card: Curiosity (NASA/JPL-Caltech/MSSS), HiRISE (NASA/JPL/University of Arizona), MOLA, THEMIS, CTX, REMS, RAD [confirm against the actual layers used].
Note: the duration table above sums to exactly 30 s; export at 29.5 s to stay safely under the limit.

## Quote sources, for the slide footer
- NTRS 20230014957 (Earth independence, DRA 5.0 context)
- NTRS 20250006063 (Caswell et al., ASCEND 2025: FOD constraints, science vs route conflict)
- NTRS 20260001895 (EV data integration gap)
- Deans 2017 (timelines vs plans, planned vs actual) [NTRS id not in the design doc; add]
- Miller 2024 ("validation is still needed") [NTRS id not in the design doc; add]
- NTRS 20230005904 (Artemis III slope < 20 degrees), NTRS 20240002135 (EVA product set), NTRS 20230008183 (Tenets of Lunar EVA)
