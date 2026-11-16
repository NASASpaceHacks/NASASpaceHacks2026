# Habitat console: real-use audit (U6)

Method: a first-time user who knows Google Maps, driving the console with **real mouse and keyboard input only**
(agent-browser `mouse move/down/up`, `keyboard type`, `press`). No store calls. 1440×900, gale-v1 site pack,
real engine (Backend on :18787, console on :15173). Screens are in `qa/screens/ux5/` (after the fixes).

Severity: **Blocker** = the task can't be finished the expected way · **Major** = finished only by trial and error ·
**Minor** = rough edge.

| # | Task | What I did | Expected (Google Maps convention) | What happened | Severity |
|---|---|---|---|---|---|
| 1 | Plan to a clicked spot | Clicked empty terrain, then clicked a second spot | The second click moves the dropped pin there | The second click only **closed** the card (toggle). It took two clicks per new spot. | Major |
| 2 | Plan to a clicked spot | Clicked with a 3 px hand jitter | Still a click | Ignored: OpenLayers' default 1 px move tolerance treats it as a drag, so nothing happens | Minor |
| 3 | Pin card | Pressed Esc with the pin card open | Card closes | Nothing happened | Major |
| 4 | Pin card | Read the coordinates | `4.8229°S` | `-4.8229°N` (a negative north) | Minor |
| 5 | Pin card | Pressed "Go here" with a 2-stop route | "Directions" sets a destination | "Go here" silently **wiped** the existing stops | Major |
| 6 | Search "Altadena" | Clicked To, typed "Alta", pressed ↓ and Enter | The first suggestion is highlighted; Enter picks it | ↓/Enter did nothing; there's no highlight, so I had to click | Major |
| 7 | Search | Looked for a way to pick a point on the map from the To field | The first dropdown item is "Choose on map" | There's no such item. The placeholder said "tap the map", but focusing the field changes nothing, so it was unclear whether a map click would fill the field. | Major |
| 8 | Add a second stop | Clicked "+ Add stop" | A new field opens with focus | The field opened without focus; I had to click into it | Minor |
| 9 | Markers | Compared the card and the map | The card's B, C match the map's B, C | The card said **B, C**; the map said **1, 2** (visit order), and every other science target was also numbered 1–12, so the "1" on a destination clashed with target "1" | Major |
| 10 | Move a destination | Dragged the P1 marker | The marker moves and the route re-plans | The map **panned** instead; you can't move a destination except by removing it and re-adding it | Blocker |
| 11 | Remove a stop | Clicked ✕ on a row | Removed | Works | — |
| 12 | Pan / zoom | Dragged the map, scrolled the wheel, double-clicked | Pans / zooms; no pins | Works: a drag never dropped a pin. Hover cursors exist for stations (pointer) and the rover (grab). | — |
| 13 | Science target | Clicked target 4 | One card with the name, value, why and a photo, plus Directions | **Two cards overlapped** (the hover tooltip plus the click popover); the click card was clipped by the bottom of the map, so its "Add to walk" button was off-screen | Major |
| 14 | Steep spot | Clicked a 24° slope | A plain reason | "Can't go here safely: too steep (24°)". Good. | — |
| 15 | Right-click | Right-clicked the map | A context menu: Directions to here / Add stop / What's here? | Nothing (the browser default) | Major |
| 16 | Hab-1 | Switched From to Hab-1 | NO-GO with the reason and a way out | Works (NO-GO, a physical reason, "Start from rover instead"), but the old target popover stayed open on top, and the destinations shrank to unlabeled grey dots | Minor |
| 17 | Instruction text | Read the screen | Affordances, not prose | Instruction overlays: "Pick the start in the From field, or click Hab-1 or PR-1 on the map. Drag the rover to move it.", "Stops are reordered for the fastest safe loop…" (shown twice), "The EVA timeline appears with the plan." | Minor |
| 18 | Send | Review & send | Opens the send step | Works | — |

**Counts:** 1 Blocker · 9 Major · 5 Minor (3 tasks fine as they are).

## Root causes
- Map clicks went through a toggle (`mapPopover ? null : …`), so a click on empty terrain closed the card instead of replacing it.
- No keyboard model on the To field (no active index, no Enter or Esc handling) and no explicit "Choose on map" mode.
- Destination markers lived in the generic stations layer, numbered by visit order, with no drag interaction.
- The hover tooltip and the click popover were two independent cards, both positioned at the clicked pixel with no viewport clamping.
- There was no `contextmenu` handler.

## What changed (U6 fixes, Google-Maps conventions)
| Finding | Fix | Covered by (`pnpm test:ux`) |
|---|---|---|
| 1 Toggle click | A click on empty terrain always drops or moves the temporary pin and opens its **place card** | test 8 |
| 2 Jitter | OpenLayers `moveTolerance: 5`: a press-move-release under 5 px is a click; anything more is a pan, never a pin | test 7 |
| 3 Esc | Esc closes the context menu, then the place card, then cancels "Choose on map"; the card also has ✕ | tests 4, 8 |
| 4 Lat format | `4.7990°S 137.3795°E` | test 1 |
| 5 Go here | The place card offers **Directions** (fresh route from the current base) and **+ Add stop** (only when a route exists); a stop already on the route shows **Remove stop** | tests 1, 9 |
| 6 Keyboard | The To field is a combobox: typing filters, the first match is highlighted, ↑/↓/Enter pick, Esc closes | tests 3, 10 |
| 7 Choose on map | The first dropdown item is **Choose on map**: the cursor becomes a crosshair, the field reads "Click a spot on the map", and the next map click sets it; Esc cancels. Focusing the field alone never changes what a map click does. | test 4 |
| 8 Add stop focus | "+ Add stop" opens the field with the caret in it | test 4 |
| 9 Numbers vs letters | Route stops are **B, C…** everywhere: the card, map markers (magenta ring, red when left out) and timeline blocks. Unchosen science targets are plain cyan points with names (no numbers). | tests 1, 6 |
| 10 Drag destination | Destination markers are draggable (grab / grabbing cursor). A drop snaps to the engine cell and re-plans; a dragged science target becomes a dropped pin. The map never pans during the drag. | test 6 |
| 13 Two cards | The hover tooltip hides while a place card or menu is open. The card is anchored to its spot, flips above or below to stay inside the map, and follows the map when it pans or zooms. | test 9 |
| 15 Right-click | Context menu: **Directions to here / Add as stop / What's here?** | test 5 |
| 16 Stale popover | Changing the base closes the card; the From field is now a field-like dropdown (click or ↓, ↑/↓/Enter/Esc) | test 10 |
| 17 Instruction text | Removed "Pick the start…", the duplicate "Stops are reordered…" in the directions card, and "The EVA timeline appears…" (now "No route yet") | — |
| Rover | Drag only by grabbing the icon (grab cursor); the map never pans at the same time (already true, now tested) | rover test |
