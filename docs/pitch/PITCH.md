# Marswalk: live pitch v1 (4:00 + Q&A)

*Replaces v0. Every number comes from `docs/CRITERIA_ANSWERS.md` or `Validation/numbers.json`. Every demo action is a flow in the app today: it's covered by `qa/e2e/interactions.spec.ts` (test number given) or shown in a dated screenshot in `qa/screens/`. Anything not yet confirmed on the current build is marked `[verify in app]`. Rehearse with a stopwatch: the full script is about 550 spoken words, about 140 words a minute with the demo pauses, and no beat faster than 155.*

**Words we never say:** "validated", "NASA flight rules", "safe for crew", "discovered". **Say instead:** "calibrated", "reproduces", "12 constraints from public NASA EVA documents, each cited", "our model's result".

## Speakers
| Role | Who | Does |
|---|---|---|
| **S1 · Story** | [name] | Hook, the problem, credibility. Runs the slides. |
| **S2 · Console** | [name] | Drives the habitat console and the Simulation menu; narrates the console part of the demo. |
| **S3 · Visor** | [name] | Presses keys on the visor; narrates the visor part, then impact and the close. |

With only two people, S1 also takes S3's lines and S2 presses **A** on the visor.

## Setup (do it 15 minutes before, then don't touch it)
1. Pitch laptop: `pnpm demo` from the repo root. Check `http://localhost:8787/api/health` returns `"ok":true` and `gale-v1`. Everything is local, so venue Wi-Fi doesn't matter.
2. **Console** `http://localhost:5173`, **Visor** `http://localhost:5174/?reset=1`. The visor shows **AWAITING ROUTE** and **LINK UP**.
3. Layout: put the slides in one macOS Space and the console (left, about 60%) plus the visor (right, about 40%) in a second Space. Switch with Ctrl+← / Ctrl+→. `[verify in app]`: both windows are readable from the back of the room at projector resolution. Zoom the browser if they aren't. If they still aren't, run the visor on a second laptop on the same router.
4. **Warm the engine:** plan once (type "Alta", press Enter), then **Clear**. The first plan of a session computes the safety fields once (about 1.7 s). After that, plans take about 38 ms (median). Reload the visor with `?reset=1` afterwards.
5. **Pre-find the radio-shadow spot:** Layers → **Radio coverage** on. Note a tinted spot about 250 m north of the Altadena drill site (the one in `qa/screens/ux7/pin-nogo.png` is at 4.7980°S 137.3838°E). Turn the layer off again. `[verify in app]`: the pin there gives NO-GO for radio from PR-1.
6. Console **Simulation** menu: check that the speeds 10×, 30×, 60× and 120× are there.
7. Backup ready in a third Space: the 30 s video, a 2-minute screen recording of this exact demo (record it at the dress rehearsal), and the slides.

---

## The script

### 0:00–0:20 · Hook · S1
**Screen:** Slide 1 (Gale crater console, dimmed).
> "Picture the first crew on Mars. One astronaut wants to walk to a rock Curiosity drilled in 2025. Earth is up to 22 light-minutes away. At solar conjunction, it's out of reach for about two weeks. So who checks that this walk brings her home? Not Mission Control. The crew."

### 0:20–0:45 · The problem, in NASA's words · S1
**Screen:** Slide 1 stays up. Its footer shows the source IDs.
> "NASA has written this down. Its EVA concept of operations says Mars crews 'will likely be more involved in planning their EVAs', using 'automated planning tools'. NASA's EVA planner today serves 'ground-based flight controllers'. On Mars, the planner has to live with the crew. That's what we built. It's called Marswalk."

Sources: EVA-EXP-0042 Rev B §8.1 (first two quotes); NTRS 20260001893 (AEGIS/EMSS, "empowering ground-based flight controllers").

### 0:45–1:00 · Demo 1: plan a walk · S2
**Action:** Ctrl+→ to the console. It shows Gale crater on real HiRISE imagery, with **SCENARIO · Sol 412 · Mars local 09:40** in the top bar. Click **From** and pick **Hab-1 · Habitat**. Click **To**, type `Alta` and press **Enter** (test 10).
> "This is the habitat console, on real Gale crater terrain from NASA orbiters. The habitat, rover and sol are scenario, and labelled. I ask for a walk from the habitat to the Altadena drill site."

### 1:00–1:25 · Demo 2: a NO-GO, explained · S2
**Action:** The verdict card turns red: **NO-GO · No safe walk from Hab-1**. Point with the cursor, line by line: *"Altadena drill site: the walk runs 41 min past the EVA time limit"*, then *"The red circle on the map marks where"*, then *"The stops are about 220 m below Hab-1: the climb back costs ≈817 W against the suit's 352 W cooling limit, so the closest one overruns the 6-hour EVA"* (`qa/screens/ux6/rover-suggestion.png`, regenerated 15 Nov). `[verify in app]`: read out the minutes and watts shown live (the console's wording is still being edited in the working tree), and check the red mark is in view (press **Z** to fit if it isn't).
> "NO-GO, and it tells us why. The drill site is about 220 metres below the habitat. Our model puts the climb back at about 800 watts, against NASA's 352-watt suit cooling figure. So the walk overruns the 6-hour EVA by 41 minutes. Even with unlimited cooling, radio contact, shelter time and distance still block every stop."

### 1:25–1:40 · Demo 3: the way forward is staging from the rover · S2
**Action:** Click the big **START FROM ROVER INSTEAD** button. The card turns **GO**, the route draws from PR-1 and the timeline fills (tests 10 and 15). The NO-GO card already previews it: "Starting from PR-1 gives an OK plan: Altadena drill site (science value 80, 115 min)". Expected headline: "1 stop · 1 h 55 min" (`qa/screens/ux8/report-radiation.png`) `[verify in app]`.
> "The way forward is on the card: start from the pressurized rover. GO. That matches how NASA's Mars reference plans use rovers as mobile bases. It's our model's result, not a NASA finding."

### 1:40–2:00 · Demo 4: it shows where a walk fails · S2 *(first cut if you're running long; saves 20 s)*
**Action:** Click the pre-found radio-shadow spot. The place card says **NO-GO · No radio contact for 13 min on the way (limit 10 min)**, and the map shows a red stretch labelled **No radio 13 min (limit 10)** (test 20; `qa/screens/ux7/pin-nogo.png`). Point at the links **Closest safe point** and **Move rover closer**. Press **Esc**: the GO route from the rover is still there. If the pin says GO, click a little further north, or just say "here's one that fails" and move on.
> "Now a spot in a radio shadow. Before I commit, the pin says NO-GO: 13 minutes without radio, limit 10. The red stretch shows where. And it offers a way out: closest safe point, or move the rover. One of 12 constraints from public NASA EVA documents, each cited."

### 2:00–2:15 · Demo 5: send the route to the visor · S2 → S3
**Action (S2):** Click **REVIEW & SEND** (bottom right). The crew brief shows the route, leave-by times, three things to watch and **Route package ≈11 KB · fits · of 28 KB Curiosity daily uplink**. Click **Send to crew**.
**Action (S3):** On the visor, **INCOMING ROUTE · ED25519 ✓ VERIFIED · NEW ROUTE v1 · PR-1 › ST01 › PR-1** appears (`qa/screens/visor2/02-new-route.png`). Click into the visor window and press **A**. The console shows **Accepted by EV1** and moves to **3 EVA LIVE**. `[verify in app]`: run this whole send → accept flow on the current console build. The code is there (`SendSheet.tsx`, `send-to-crew`), but the only screenshot of the send sheet predates the restyle (`qa/screens/ux/04-send-brief.png`, old orange look, don't show it).
> **S2:** "Review and send. The whole route is about 11 kilobytes. Curiosity's daily uplink is about 28."
> **S3:** "On the visor: new route, signature verified. I accept."

### 2:15–2:42 · Demo 6: visor guidance and Curiosity's photo · S3
**Action (S2):** **Simulation** → speed **120×** → **Run astronaut**. As soon as the visor switches to **STATION**, click **10×** so the card stays up.
**Visor (S3 points):** NAV screen (`qa/screens/visor2/03-nav.png`) with the heading-up map, distance and ETA to the next stop, **WALKBACK MGN**, **SHELTER ≤30**, **BINGO / LATEST DEPARTURE**, **HEAT 30-MIN AVG / 352 W** and **SUN AT n O'CLOCK**. Then the station card (`qa/screens/visor2/04-station.png`): objective, crew tasks, and **WHAT YOU'LL SEE** with the Curiosity photo and its credit line. `[verify in app]`: time to the first station at 120× (expect about 20 s: 30 sim-minutes of airlock plus the walk). Also check that ST01's photo shows (the manifest links ST01 to a Navcam image from sol 4559; the live screenshot is of ST04).
> "We run the walk at 120 times speed. The visor shows the distance to the stop, the walk-back margin, the minutes to shelter, the latest time she can leave, and suit heat against the 352-watt budget. Mars has no global magnetic field, so no compass: the heading comes from the sun. *[station card appears]* At the stop: the science objective, her tasks, and Curiosity's real photo of this spot."

### 2:42–2:50 · Demo 7: the link drops · S3
**Action (S2):** **Simulation** → **Drop link**. Within about 3 s the visor's top banner reads **LINK LOST — AUTONOMOUS — LAST CONFIRMED ROUTE v1** (the last measured run took 3.4 s, `qa/screens/timings.json`). `[verify in app]`: the only screenshots of this state are demo mode (`visor2/mock-07-autonomous.png`, synthetic terrain) or the old look (`qa/screens/08-autonomous.png`). Capture a live one at rehearsal.
> "Now we cut the habitat link. Within about three seconds: autonomous. It keeps guiding her home on the last confirmed route."

### 2:50–3:25 · NASA data and credibility · S1
**Action:** Ctrl+← to the slides. Show **slide 5** (NASA datasets and credits) for the first sentence, then **slide 6** (three validation charts).
> "Everything you saw is NASA data, credited layer by layer in the app. *[slide 6]* Why trust it? Each model is checked against measured NASA data. Walking energy: calibrated on NASA suited tests, about 11 percent error at 0.22 to 0.32 g. Mars gravity is an extrapolation. Dose: we reproduce Curiosity's measured first-year dose within 4 percent, and quote route doses at plus or minus 30 percent. An independent checker and blind AI reviewers matched the engine on 23 of 24 walks. The one miss: the engine was too cautious."

### 3:25–4:00 · Impact and what's next · S3
**Action:** Slide 7.
> "This is for the habitat crew member who, in NASA's words, 'essentially performs the roles of IV, Flight Director, partial EVA Officer'. Plans that only avoid steep ground broke a NASA EVA constraint in 99.5 percent of 200 simulated walks at Gale. Ours broke none. Against a planner with our same checks, we find 5 percent more science when time is short. It runs at a second site, Jezero. It's not yet tested with suited people. That's next. Marswalk: plan it in the habitat, walk it in the helmet, come home."

Sources: EVA-EXP-0042 Rev B §8.1 (IV quote); `Validation/v3_impact` (99.5%, 0%, +5%); `SitePacks/jezero-v1`.

**Stop. Say "Thank you", and wait for questions.** Leave slide 7 up. It holds the links and the AI disclosure.

---

## Timing guardrails
| Mark | You should be at | If you're late |
|---|---|---|
| 0:45 | Switching to the console | Drop the "automated planning tools" clause next time |
| 1:40 | GO from the rover on screen | **Skip Demo 4** (radio shadow) and go straight to Review & send |
| 2:15 | Visor accepted v1 | Run at 120× and narrate the NAV screen only; skip waiting for the station card |
| 2:50 | Link-loss banner seen | Skip the link drop and say the line over slide 5: "and if the link drops, the visor keeps guiding on its own" |
| 3:25 | Slide 7 | Cut the IV quote sentence; keep the 99.5% sentence together with the +5% sentence |

**One rule:** never say 99.5% without the next two sentences. Slope-only planning is the common baseline, and it's a strawman by construction (`Validation/v3_impact/README.md`, "Honest caveats"). The fair comparison is the +5%.

---

## 60-second version (fallback, or if the organisers cut time)
**S1 alone, over slides 1, 4, 2 and 7.** With a live console, do the actions in brackets instead of showing slide 4.
> "Picture the first crew on Mars. Earth is up to 22 light-minutes away, so the crew plans its own walks. NASA's EVA concept of operations says Mars crews 'will likely be more involved in planning their EVAs'. Marswalk is that tool. A habitat console plans a walk on real NASA data from Gale crater, checks it against 12 constraints from public NASA EVA documents, and explains the verdict. *[From Hab-1 to Altadena: NO-GO card.]* From the habitat it says NO-GO. The climb back overheats the suit, and radio contact, shelter time and distance block it too. *[Start from rover instead: GO.]* From the rover, GO. It sends a signed 11-kilobyte route to the astronaut's visor. The visor shows Curiosity's real photo at each stop and keeps guiding if the link drops. Each model is checked against NASA measurements, and the limits are stated. Marswalk: plan it in the habitat, walk it in the helmet, come home."

(About 150 words, 60 s at a calm pace.)

---

## If the live demo fails
Decide in **5 seconds**, not 30. Don't debug on stage. The script lines work over still images, so keep talking.

| What happens | Say | Do |
|---|---|---|
| Console won't load, or the verdict doesn't appear within 5 s | "Let me show you the recording of exactly this." | Ctrl+→ to the backup Space and play the 2-minute demo recording muted. Read the same lines over it. |
| No recording either | "Here's what that screen shows." | Use the slides: slide 3 (NO-GO, red stretch), slide 4 (habitat NO-GO and rover GO), slide 2 (visor with the Curiosity photo). Same words. |
| Radio-shadow pin says GO | "This spot is fine. Here's one that isn't." | Click about 100 m further north once. If it's still GO, skip to Review & send. |
| Visor shows nothing 5 s after Send to crew | "The surface link is being shy. Here's what she sees." | Slide 2 (`visor2/02-new-route.png`, `04-station.png`). Skip Demos 6 and 7 and go to credibility. |
| The walk takes too long to reach the station | Narrate the NAV screen, then: "At each stop she gets Curiosity's real photo." | Show slide 2. Move on at 2:42 whatever happens. |
| The visor tab crashes | "Electronics on Mars crash from radiation. Watch it come back." | Reload the visor tab without `?reset=1`. It shows **WARM RESTART** and restores state in 0.1–0.3 s (`timings.json`: 263 ms). That turns the failure into a feature. |
| Laptop dies | "Our 30-second video tells the story." | Play the video from a phone or the second laptop, then deliver the 60-second version. |

**Demo-mode fallback for the visor only:** `http://localhost:5174/?mock=1` runs the visor offline. It says **TERRAIN: SYNTHETIC - NOT REAL MARS DATA** on screen, and if you use it you must say so ("this is demo mode, synthetic terrain"). Never show it as real data.

---

## Optional beats (only if rehearsed and timed)
- **Radiation spike:** console Live → **Radiation spike**. The engine re-plans a return to shelter (measured solve 2 ms, wall time 668 ms in `timings.json`), and the visor shows **RETURN NOW**. Then **Send to crew** → **A** for v2. `[verify in app]` on the current build (it was last screenshotted before the restyle).
- **Why this area?** The reachable area shrinks one constraint at a time. `[verify in app]`: not in the current interaction tests.
- **Suggest best stops:** a multi-stop plan. `[verify in app]`: not in the current interaction tests.
- **Jezero:** click Jezero on the "Where on Mars" locator. The site name, study area and targets change (test 16; `qa/screens/sites/jezero.png`).
- **Phone AR visor** (`Frontend/UserView_AR`): same visor controller on an iPhone camera. `[verify in app]`: there are no screenshots, so don't demo it unless a teammate has run it end to end.

## Quote sources (slide footers)
- EVA-EXP-0042 Rev B §8.1, xEVA System ConOps: "will likely be more involved in planning their EVAs…", "automated planning tools", IV "essentially performs the roles of IV, Flight Director, partial EVA Officer"
- NTRS 20230014957: "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions… upon locally sourced information"
- NTRS 20260001893 (AEGIS/EMSS): "empowering ground-based flight controllers"
- NTRS 20260001895: "Future work may integrate real-time EV data (e.g., suit consumables, physiological performance) with traverse planning"
