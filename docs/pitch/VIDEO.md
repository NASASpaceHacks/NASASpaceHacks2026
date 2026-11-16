# Marswalk: 30-second video storyboard

*Hard limit: **30.0 s**. Going over disqualifies the entry. The cut below is **28.0 s**, which leaves a 2 s margin. The video must work **muted**, so the captions carry the story and the voice-over is optional. Every shot is a screen recording of the real app on the real `gale-v1` site pack, edited for length. No stock footage, no AI imagery, no NASA logos. The Space Apps 2026 brand mark is allowed on the end card.*

## Recording setup
- `pnpm demo`. Console `http://localhost:5173` at 1440×900, visor `http://localhost:5174/?reset=1` at 1920×1080. Record each app on its own (macOS Cmd+Shift+5, or OBS) at 30 fps or more.
- Warm the engine first (plan once, then Clear) so no shot shows a cold 1.7 s solve.
- Record each shot as its own clip with 1 s of spare footage at each end; trim in the editor.
- Hide the mouse cursor except where a click matters. When it shows, use a large cursor.
- Speed-ups are allowed in the edit (the walk is a simulation), but say so on screen: shot 6 carries a small "simulated walk, sped up" tag.
- Don't record demo mode (`?mock=1`): it shows synthetic terrain.

## Caption style
- Burned in (not a separate subtitle file), white on a 70% black box, bottom third, about 48 px at 1080p. Nothing is more than 2 lines.
- At most about 3 words per second on screen. Each caption is up for at least 2.5 s.
- Fonts and colours match the console: cyan for the product name, green for GO, red for NO-GO. **No yellow or orange.**

## Shot list (total 28.0 s)

| # | Start–end (s) | Length | What to record (real app) | On-screen caption (muted-safe) | Optional voice-over |
|---|---|---|---|---|---|
| 1 | 0.0–3.0 | 3.0 | Console opening: click **WHERE ON MARS +** to expand the locator (Mars → Gale crater; it starts collapsed in the latest build, `qa/screens/ux6/rover-suggestion.png`), then a slow 1 s push-in on the HiRISE map with the SCENARIO tag visible. `[verify in app]` | **On Mars, the crew plans its own walks.** | "On Mars, the crew plans its own walks." |
| 2 | 3.0–6.5 | 3.5 | From → **Hab-1**, To → type `Alta`, Enter. The verdict card turns red: **NO-GO · No safe walk from Hab-1** (test 10). | **From the habitat: NO-GO.** *(second line)* It says why. | "Marswalk checks every plan against 12 cited NASA EVA constraints." |
| 3 | 6.5–9.5 | 3.0 | 1 s zoom on the reason line ("≈8xx W against the suit's 352 W cooling limit"), then click **START FROM ROVER INSTEAD** → green **GO** (tests 10, 15; `qa/screens/ux6/rover-suggestion.png`). | **Suit heat, radio, shelter, distance.** *(second line)* **From the rover: GO.** | "Staged from the rover, it's a go." |
| 4 | 9.5–12.5 | 3.0 | Click a radio-shadow spot → place card **NO-GO · No radio contact for 13 min** and the red stretch label **No radio 13 min (limit 10)** on the map (test 20; `qa/screens/ux7/pin-nogo.png`, `nogo-highlight.png`). | **It shows where a walk fails.** | "It shows where a walk fails." |
| 5 | 12.5–15.5 | 3.0 | Split screen. Console: **Review & send** → "Route package ≈11 KB · fits" → **Send to crew**. Visor: **ED25519 ✓ VERIFIED · NEW ROUTE v1** → press **A** (`qa/screens/visor2/02-new-route.png`). `[verify in app]` on the current console build. | **A signed 11 KB route goes to the helmet.** | "A signed, 11-kilobyte route goes to the helmet." |
| 6 | 15.5–19.5 | 4.0 | Visor NAV for 1.5 s (`visor2/03-nav.png`: distance, walk-back margin, shelter ≤30, heat vs 352 W), then the station card with Curiosity's photo for 2.5 s (`visor2/04-station.png`). Run at 120× in the console Simulation menu. Small corner tag: "simulated walk, sped up". | **Guidance, with Curiosity's real photo of each stop.** | "The visor guides her, with Curiosity's real photo of each stop." |
| 7 | 19.5–22.5 | 3.0 | Console **Simulation → Drop link**; the visor banner reads **LINK LOST — AUTONOMOUS — LAST CONFIRMED ROUTE v1**. `[verify in app]`: record this live; the existing stills are demo mode or the old look. Cut out the about 3 s wait, or show a small "+3 s" tag. | **Link lost? The visor still guides her home.** | "If the link drops, the visor still brings her home." |
| 8 | 22.5–25.0 | 2.5 | Data and credibility frame: open **Layers** (mission, instrument and resolution on each row, `qa/screens/ux6/layers-panel.png`), with a lower-third listing **MRO · Mars Odyssey · Curiosity · MGS · Viking · CCMC**. | **Real NASA data. Checked against Curiosity's measurements.** | "Real NASA data, checked against Curiosity's own measurements." |
| 9 | 25.0–28.0 | 3.0 | **End card** (static). | **MARSWALK** · Plan a Mars walk that brings the crew home. · [repo / demo URL] · Space Apps 2026 · Team NASASpaceHacks, Toronto | (silence) |

**Check the arithmetic:** 3.0 + 3.5 + 3.0 + 3.0 + 3.0 + 4.0 + 3.0 + 2.5 + 3.0 = **28.0 s**.

## End card (shot 9), exact text
- Line 1, large, cyan: **MARSWALK**
- Line 2: *Plan a Mars walk that brings the crew home.*
- Line 3: `[repo URL]` · `[demo URL]`
- Line 4, small: NASA Space Apps Challenge 2026 · Interplanetary Survival Guide: Martian Map · Team NASASpaceHacks (Toronto)
- Line 5, smallest: Images: NASA/JPL/University of Arizona (HiRISE) · NASA/JPL-Caltech/MSSS (Curiosity Mastcam) · NASA/USGS (Viking MDIM). Code partly written with AI coding agents; no AI imagery.

## Voice-over (if used)
About 70 words in 25 s (no shot above 3.3 words per second). Record in one take, calm pace, then trim pauses to fit the shot boundaries. Without voice-over, add a quiet royalty-free music bed and note its licence in the project page. Or use no audio at all: the captions are enough.

## Export and gate
- H.264 MP4, 1920×1080, 30 fps, AAC audio (or silent), file under about 50 MB.
- Gate before uploading: `ffprobe -v error -show_entries format=duration -of csv=p=0 marswalk-30s.mp4` must print **≤ 29.5**. If not, cut shot 8 first (−2.5 s) and fold its caption into the end card.
- Watch it once muted on a phone: can a stranger say what Marswalk does? If not, shorten the captions; don't add words.

## What not to put in the video
- No 99.5%. It needs two sentences of context, and a 30 s video can't give them.
- No "validated", "NASA flight rules" or "safe for crew".
- No frames from `qa/screens/ux/` or the root `qa/screens/0*.png` (old look), and no `visor2/mock-*` frames (synthetic terrain).
