# Habitat Console — UX redesign spec

**Problem (user feedback):** "The admin interface is so complex… I felt overwhelmed." The current console shows every layer toggle, legend, metric and tab at once, in engineering jargon. It's a debugging dashboard, not an operator's tool.

## 1. Who uses it
**The habitat EVA officer** (the intravehicular crew member) on Mars. They support 1–2 suited crew outside, with Earth 3–22 minutes away and maybe unreachable. They are often tired, multitasking, and **not** a GIS expert. NASA's own analog lessons say the same: *"When Science Team gets busy, they need a quick way of catching up"* (BASALT, Deans 2017). Workload target: Bedford ≤ 3 in normal operations (NASA-STD-3001).

## 2. What they do: four moments, each with one job
| Moment | Their question | Time budget | Primary action |
|---|---|---|---|
| **PLAN** (before the EVA) | "Where do we go today, is it safe, and what do we get?" | ≤ 30 s for the recommended plan; ≤ 3 min if adjusting | Accept or adjust the recommended plan |
| **SEND** (approve) | "Am I sure? What do I tell the crew?" | ≤ 10 s | **Send to crew** |
| **MONITOR** (hours) | "Is my crew OK? Are we on time? What's next?" | Glanceable, < 3 s per look | Usually none; it's watching |
| **RESPOND** (rare, urgent) | "Something happened. What do we do now?" | ≤ 2 clicks + confirm | Send the engine's recommended response |

## 3. Design principles
1. **One mode at a time.** A top stepper: **① Plan → ② Send → ③ EVA live**. Each mode shows only what matters for it, with one big primary button.
2. **Start with a ready answer.** On load, auto-generate the **recommended plan**: base = rover if it exists, start = scenario time, all stations. The officer edits only what they disagree with. **Zero clicks to see a plan.**
3. **Verdict first, details on demand.** A large **GO / CAUTION / NO-GO** verdict with 3–5 plain-language checklist lines. Every number elsewhere supports that verdict.
4. **Plain words.** No jargon on the main path; technical terms move into a "Details" drawer.
   | Current | New |
   |---|---|
   | Binding constraint | What limits this walk |
   | Bingo | Leave-by time |
   | Burndowns | Margins over time |
   | LTST | Mars local time |
   | STAY IN | No safe walk from here |
   | SEP nowcast | Radiation spike on board |
   | Walkback margin | Spare time to get home |
   | Shelter time | Minutes to shelter |
5. **A calm map.** By default show only the colour imagery, the route, numbered stops, the base and rover, the crew, and **one clean outline of the safe area**. No hatching, contours or symbol legend. Other layers sit behind one "Layers" button (presets: Safety, Science, Radio, Terrain). Each overlay brings its own one-line legend while it's on.
6. **The timeline is the spine.** A horizontal EVA timeline along the bottom, which is how NASA flight controllers think:
   - airlock out → walk → stop (dwell) → walk → … → back in
   - **rest blocks** from the suit-heat rule
   - **leave-by** ticks
   - the **walk-back deadline** line
   - in EVA live, a **"now" cursor** and an **ahead/behind** readout
7. **Stations as a short checklist,** not cards. Each row shows:
   - ✓ included / ✕ left out
   - name, science value bar
   - one-line reason if left out ("too steep to reach", "+7 min beyond shelter limit")
   - a **"must visit"** pin
   Toggling a row re-plans instantly.
8. **Emergencies are guided.** A small action dock in EVA live:
   - **Radiation spike** · **Hazard reported** · **Shorten EVA** · **Recall crew** · **Link test**
   - Each opens a sheet that shows the engine's recommended new plan *as a change* ("Return to PR-1 now · 18 min · via current path"), with **Send to crew** as the only button.
   - Alerts appear in a top banner queue, colour-coded by severity, and can be acknowledged.
9. **Expert depth stays, but is hidden.** A "Details" drawer, opened on demand, holds:
   - rules with values, citations and evidence chips (and on/off toggles)
   - full constraint report (margins per rule, drop reasons)
   - margins-over-time charts
   - space weather (all three tiers)
   - data sources
   - the Evidence panel
   - "Why this area?" (the safe-zone explanation animation)
10. **Big targets, few clicks, keyboard.** Primary buttons at least 44 px. `Enter` runs the primary action of the current mode. `Esc` closes sheets.

## 4. Layouts (desktop 1440 × 900; must still work at 1280)

### ① PLAN
```
┌ MARSWALK · Gale · Sol 412 · Mars local 09:40 ──── ①Plan ②Send ③EVA live ──── Crew link ● · Data ⓘ ┐
│ ┌────────────────────────── MAP (calm) ──────────────────────────┐ ┌──── VERDICT ────────────┐ │
│ │ imagery + route + numbered stops + base/rover + safe outline   │ │  ✅ GO                   │ │
│ │                                                                │ │  6 stops · 4 h 03 min    │ │
│ │                                    [Layers ▾] [Why this area?] │ │  Back 1 h 57 min before  │ │
│ └────────────────────────────────────────────────────────────────┘ │  the walk-back deadline  │ │
│ TIMELINE  ▕airlock▏walk▕ST04 20m▏walk▕rest▏▕ST02 30m▏ … ▕back in▏  │  ✓ Space weather clear   │ │
│           09:40      leave-by ▾        walk-back deadline ┆        │  ✓ Daylight until 17:58  │ │
│                                                                    │  ✓ Suit heat: 3 rests    │ │
│                                                                    │  ! Limits: radio gap at  │ │
│                                                                    │    ST01 (2 min spare)    │ │
│                                                                    │ Start from  [Rover PR-1▾]│ │
│                                                                    │ Start time  [09:40 ▾]    │ │
│                                                                    │ STOPS (6 of 12)          │ │
│                                                                    │ ✓ ST04 Peace-sign ▮▮▮ 70 │ │
│                                                                    │ ✕ ST12 too steep  ▮▮▮▮92 │ │
│                                                                    │ [ Review & send → ]  ⏎   │ │
│                                                                    └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────── Details ▸ ──────────────┘
```
- **NO-GO** (e.g. from Hab-1): the verdict card turns red, says "No safe walk from the habitat", gives the plain physical reason in one sentence, and offers a big **"Start from rover instead"** button.

### ② SEND
A focused review sheet over the map. It is the **crew brief** the officer reads out:
- route summary (stops in order with leave-by times)
- what limits the walk
- the 3 things to watch
- package size vs uplink ("11 KB · fits")
- **[Send to crew]**
After sending: "Waiting for crew to accept…" → "✓ Accepted by EV1 at 09:41", which moves straight to EVA live.

### ③ EVA live
```
┌ banner: (alerts queue, if any) ───────────────────────────────────────────────────────────────┐
│ MAP follows the crew (calm)                                 │ CREW EV1          ● link OK     │
│                                                             │ ON PLAN · 2 min ahead           │
│                                                             │ Next: leave ST02 by 11:04       │
│                                                             │ Spare time to get home  2 h 41m │
│                                                             │ Minutes to shelter      3       │
│                                                             │ Oxygen (planned)        78 %    │
│                                                             │ Suit heat               312/352 W│
│ TIMELINE with NOW cursor ────────────────────────────────── │ ACTIONS                        │
│                                                             │ [Radiation spike] [Hazard]      │
│                                                             │ [Shorten EVA] [Recall crew]     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```
Each value has a colour state (normal / watch / act) so problems stand out without reading numbers. Demo controls (simulated astronaut speed, drop link) move into a small **"Simulation"** menu, clearly separated from real operations.

## 5. Success criteria (testable)
- First visit to the plan verdict: **0 clicks**, ≤ 3 s after load.
- Plan → crew acceptance: **≤ 3 clicks**: Review & send → Send to crew (+ the visor's A).
- In EVA live, the crew's status, next event and the biggest risk are readable without scrolling, opening anything, or knowing any jargon.
- Emergency (radiation spike) → new route sent: **2 clicks** (action → Send to crew).
- Default map: at most 6 visual element types; no hatching or contours unless the user turns them on.
- Every capability that exists today is still reachable (in Details or the Layers menu): nothing is lost.
- The end-to-end test is updated to the new flow and stays green.
