# Backlog (deferred, not forgotten)

| Item | Why | Notes |
|---|---|---|
| **Crew-request approval flow** (BASALT model) | Matches how NASA runs EVAs under delay: crew proposes, habitat approves | Visor `R` → candidate leaderboard in the console with the re-plan delta (route, time, walk-back) → approve/reject → push before the bingo time. `REQUEST` link message already exists. See `docs/research/destination-selection.md`. |
| Geologic-unit layer for Gale | NASA Map Books include a geologic map | Only with a citable source at this scale; otherwise skip |
| Horizon views per station | Map Book item; helps the crew recognise the spot | DTM skyline silhouette + landmark labels |
| One-page-per-station Map Book export | NASA crews carry a paper Map Book | Printable station sheets (route segment, slope, photo, tasks) |
| Orbiter relay-pass windows + one-way light time in comms | Mars-specific comm planning | Light time already computed by the Earth relay |
| Claude "Earth science backroom" brief | Helps a busy science team catch up (Deans 2017) | Earth side only; proposals re-checked onboard |
| CRISM mineral layer | Adds the "spectral" data kind | MOCAAS Gale 10 m (licence/georef caveats) |
| Monte Carlo P50/P90 time bands | Uncertainty on walking speed and effort | Lognormal speed factor |
| Rover drive-route planning | "Move rover closer" currently suggests a spot only | Needs rover mobility limits |
| Update old `qa/e2e/demo-flow.spec.ts` | It still expects a plan at load | Do after UI direction sign-off |
| **Try more than one path before NO-GO** | V4 found one safe-side miss (W02): the engine's heat-aware route broke the radio limit by 0.2 min while the shortest-time path passed | Evaluate the shortest-time path (and later a radio-aware path) through the simulator before declaring a stop unreachable. Engine change: re-run v3/v4 after |
| Solar-cycle (Φ) input for the dose | V5: measured dose at Ls 240 spans 167–296 µGy/day across the solar cycle; one Φ can't cover it | Derive Φ per epoch from RAD/neutron-monitor data; today's single present-day point (sol 4180) is too thin |
