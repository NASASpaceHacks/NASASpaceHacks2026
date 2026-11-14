# Marswalk — product walkthrough (for testing and iteration)

Two screens, one habitat server, real NASA data (Gale crater / Mount Sharp boxwork), real route engine.
Put the **Habitat Console** and the **EVA Visor** side by side (two browser windows or two machines on the same LAN).

| App | URL | Who uses it |
|---|---|---|
| Habitat Console | http://localhost:5173 | Habitat EVA officer (plans, confirms, monitors) |
| EVA Visor | http://localhost:5174/?reset=1 | Astronaut (helmet navigation) |
| Hab server health | http://localhost:8787/api/health | — |

**Start it yourself** (from the repo root): `pnpm install && pnpm demo` (one command; Ctrl+C stops all). Or in three terminals:
```sh
PORT=8787 SITEPACK=gale-v1 pnpm --filter ./Backend start
HAB_URL=http://localhost:8787 pnpm --filter ./Frontend/AdminView exec vite --port 5173 --strictPort
MW_HAB=http://localhost:8787 pnpm --filter ./Frontend/UserView exec vite --port 5174 --strictPort
```
(`SitePacks/gale-v1` binaries must be present; they are built by the Pipeline or downloaded from the release asset.)

---

## The flow (about 10 minutes)

### 1. Look at the map (Console)
- Real HiRISE colour imagery of the boxwork, lit by the sun at the planned EVA time. **Left rail:** layer presets **1–4** (Plan / Safety / Science / Comms), **Sources** tab = every layer's mission, instrument, resolution, citation.
- Top bar: Sol / LTST, **"Data: N missions · M data kinds"**, visor link status, route version.
- Bottom-left: scale bar in true **Mars metres** + cursor lat/lon/elevation/slope.
- *Look for:* does it read like real flight software? Anything confusing?

### 2. Plan an EVA (Console → Plan tab)
- **EVA base** = **PR-1** (pressurized rover) by default. Press **Generate plan** (key **G**). Expect **OK**, ~6 stations, ~4 h. Press **Z** to zoom to the route.
- **Report tab:** the **binding constraint** ("Limited by …"), margins per rule, **dropped stations with reasons** (e.g. ST12: slope/walk radius), leaderboard, bingo times, totals.
- **Science coverage** (Plan tab): which STM objectives this plan covers / loses.

### 3. The insight: switch the base to Hab-1
- Click **EVA base → Hab-1**. Expect **STAY IN** with the physical reason: the boxwork is ~200 m below the habitat; the uphill walk back carrying 211 kg at Mars gravity costs ~800 W vs the suit's 352 W heat budget → the EVA overruns.
- Click **Stage from PR-1** → back to the OK plan. Try **dragging the rover** on the map: the safe zone and plan update (~1 s).

### 4. Explain the safe zone
- Click **Explain safe zone** (key **S**): the reachable area shrinks one NASA constraint at a time (slope → radius → walkback → shelter → comm LOS) and the route draws in.

### 5. Confirm and push (Console → Visor)
- Click **Review v1** → **Confirm & push v1**. The console shows the route package size vs Curiosity's ~28 KB daily uplink.
- **Visor:** "NEW ROUTE v1 · ED25519 ✓ VERIFIED" → press **A** to accept. Console shows the ACK.

### 6. Walk the EVA
- Console → **Live** tab → speed **30×** → **Run astronaut**. The visor's heading-up map, bearing, distance, walkback/shelter dials and bingo countdown update; the console receives telemetry.
- At the first station the visor shows the **station card**: science objective, crew task checklist (key **N** ticks), dwell timer, **real Curiosity photo**.
- Console → **Burndowns**: plan vs actual (heat, O₂, margins).

### 7. Solar storm
- Console → Live → **SEP nowcast** (onboard dose rate +25 %). Replan to the nearest shelter in <1 s; the visor shows **RETURN NOW**.
- **Review v2 → Confirm & push v2** → visor **A**.

### 8. Earth goes dark / link loss
- Console → Live → **Drop link**. Within ~3 s the visor shows **LINK LOST — AUTONOMOUS** and keeps guiding home on the last confirmed route. **Restore link** → telemetry back-fills.

### 9. Crash recovery
- Reload the visor tab: **WARM RESTART**, state restored in well under a second.

### Console keys
**G** plan · **S** explain safe zone · **C** confirm · **E** evidence panel · **Z** zoom to route · **1–4** presets · **?** all keys

### New panels
- **Live → Space weather**: three tiers. *Forecast* = real WSA-ENLIL CME runs predicting Mars arrivals (CCMC DONKI) → GO / CAUTION for the EVA date; *Alert* = flare notices light-delayed by today's one-way light time; *Nowcast* = onboard dose rate +25 % → the only return-now trigger.
- **Evidence** (key **E**): V1 radiation-shielding reproduction, V2 metabolic calibration, planner benchmark, live timings, limitations & assumptions.
- **Rules**: each flight rule has an evidence chip (M measured / A analog / D NASA requirement / S simulated / E team assumption).

### Visor keys
**A** accept route · **N** next/tick task · **H** report hazard here · **R** request reroute · **M** mirror (for beam-splitter HUDs) · **D** demo panel

---

## Notes for iteration (fill in as you test)
| # | Where | What happened / idea | Severity (bug / polish / idea) |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
