# UserView_AR — phone AR visor

A minimal HUD for an iPhone: the rear camera fills the screen and only the glanceable cues are drawn over it.

- Chevrons on the ground, bending toward the next steer point
- One instruction card: turn ("Bear right"), distance · ETA · target
- Heading pill, O₂ % + walkback margin, link dot, EVA elapsed time
- State colours: green = nominal, amber = off route / link lost, pink = RETURN NOW (with reason banner)
- Tap cards for: accept a new route, tick a station task / depart

It reuses UserView's `VisorController` unchanged (`@mw/visor/src/core/visor`): the same hab link the AdminView console
pushes routes over, the same local route model, simulator and onboard safety core. Only the UI is different.

## Run

```bash
pnpm install
pnpm dev:backend      # hab server :8787 (AdminView pushes routes through it)
pnpm dev:ar           # https://<your-mac-ip>:5175
```

Open `https://<your-mac-ip>:5175` on the iPhone (same Wi-Fi), accept the self-signed certificate warning, then tap
**Start AR visor**. iOS only allows camera and compass on HTTPS. Use `MW_HTTPS=0` to serve plain HTTP on a desktop.

Without the backend: `https://<ip>:5175/?mock=1&pack=gale-v1` (local mock hab; add `&reset=1` to cold start).

## Heading

- **SIM HDG** (default on desktop): the arrow is relative to the simulated crew's walking direction.
- **COMPASS** (default on phone once motion permission is granted): the arrow is relative to where the phone points,
  so turning your body turns the chevrons. Tap the chip at top right to switch.

## Position estimate and local reroute (`src/nav.ts`)

Mars has no GPS, so the visor dead-reckons. `NavModel` plugs into the controller (`ctl.posModel`) and keeps the
**true** position apart from the **estimated** one. The estimate is what the HUD shows, what the safety core reads,
and what off-route detection uses.

- Drift: while walking, the error grows by about `DRIFT_M_PER_MIN` (2 m/min) in a slowly wandering direction.
- Fixes: every `FIX_INTERVAL_MIN` (10) mission minutes a landmark sighting or radio ranging to the rover pulls
  the estimate back to within ~1.5 m. Arriving at a station is also a fix. A "Position corrected" note shows.
- Minimap: faint dot = true position, arrow = estimate, dashed amber circle = current error.
- Off route: estimate more than `OFF_ROUTE_M` (25 m) from the active route for 3 mission seconds → engine A*
  from the estimated cell to the next unvisited stop (or the shelter on the return leg). The old remaining route
  is drawn faded, the new one in amber. If A* finds nothing: "No safe route from here", and the last route stays.
- Demo: the **Push off route** button moves the true position 40 m to the right of travel.
