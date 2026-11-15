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
