# How we win every judging criterion

*Companion to `docs/JUDGING.md` (scorecard + defense bank). This file says what we'll do so that each criterion lands as a clear win in a 4-minute pitch, a 30-second video and the judges' questions.*

**Our one-sentence thesis:** *On Mars there is no Mission Control in the loop, so the habitat crew needs a map that thinks like NASA's flight controllers. Marswalk fuses 5+ NASA missions into a safe, explainable walk plan, and it found that on foot, suit cooling, not oxygen, sets how far astronauts can go.*

| # | Criterion | How we win it (the move) | Proof judges see | Status / owner |
|---|---|---|---|---|
| 1 | **Impact** | Turn impact into **numbers + a discovery**. (a) Safety: 99.5% of naive plans break NASA flight rules vs 0% for ours. (b) Speed: replan in 8.5 ms with no Earth. (c) **Mission-design insight:** walking from the habitat to the boxwork is infeasible because suit heat exceeds the 352 W design budget, so EVAs must be rover-staged (supports NASA DRA 5.0, informs Mars suit sizing). (d) Reach: same engine, any site → **Jezero** (second Mars site) and, if time allows, a **lunar Artemis site** with real LRO data. | Impact numbers on the Evidence panel; Hab-1 NO-GO → rover GO live; site picker | (a)(b)(c) ✔ measured · oversubscribed test ✔ (12 targets, 2–4 h: +5% science on average, never lower, 62.5% of cases better) · Jezero (G2, in progress) · Moon (G3, optional) |
| 2 | **Creativity / originality** | Name the conventional method, then show it failing and ours succeeding, live. Conventional: slope-or-distance shortest path, chatbot, regional map viewers. Ours: suit physiology (energy + heat), all 12 NASA flight rules simulator-verified, explains *why*, offers a way out of NO-GO, three-tier space weather with real CME forecasts for Mars, habitat ↔ visor that keeps working without Earth. | Differentiation table (`JUDGING.md` §4); benchmark slide; live NO-GO → "closest safe point / move rover" | ✔ content · NO-GO alternatives (U7, running) |
| 3 | **Scientifically & technically sound** | Lead with **method + validation**, not adjectives: cited models; reproduction of Curiosity RAD terrain shielding (MAE 2.0 pp); calibration on NASA suited-walking data (MAPE 10.6%); exact optimiser; A* exactly optimal; tests. State the limits before judges ask. | Evidence panel (V1/V2 figures, benchmark, limitations); `Validation/` | ✔ · update the old e2e test after UI sign-off |
| 4 | **Credible data** | "Every pixel and number is traceable": the Sources panel shows mission, instrument, resolution, licence and link; real vs scenario labelled; manifest checksums. | Data badge + Sources panel; locator credits | ✔ · real-data layer panel (U7, running) |
| 5 | **Belief** (you really did it) | Let judges **use it**: a public no-login demo link; open repo with history; a short screen recording of the real flow; team members who can each explain one part. | Public link; repo; video | **Public demo link (G9): next** · team Q&A drills |
| 6 | **Feasible, functional, practical** | It already works end to end, offline, at Mars-realistic sizes: route 11 KB vs Curiosity's 28 KB/day uplink; visor autonomy in ~3 s. Make it **obviously usable** (Google-Maps behaviour, real-input tests), and show it runs **at a second site**. | Live demo; `pnpm test:ux`; Jezero | Usability ✔ (U6) · layers (U7) · Jezero (G2) |
| 7 | **Relevance** | Mirror the challenge's own words: hyperlocal EVA scale (the gap they named), Mount Sharp boxwork (their example), plan **and** carry out, science along the way. | Challenge-alignment table | ✔ |
| 8 | **Meets requirements** | Make "≥3 kinds of data" **visible**: a Layers panel with real named datasets (imagery, elevation, slope, roughness, thermal inertia, lighting, radio coverage + safety maps), plus space weather, weather, Curiosity photos at stops, habitat display + helmet HUD. | Layers panel; station cards; visor | U7 (running) |
| 9 | **Problem → solution → importance** | Rehearse the 20-second version (`JUDGING.md` §1) until every teammate can say it. | Opening of the pitch | Team rehearsal |
| 10 | **Show the NASA data used** | One data frame in the video and one slide: missions → layers → where they appear in the app. | Video frame, slide 6 | After UI sign-off (G7) |
| 11 | **Acknowledge AI + sources** | Disclosure on the project page, README and final slide; full citation list (datasets, papers, libraries). | Project page | ✔ README · final wording at G7 |
| 12 | **Equal attention to presentation** | Freeze the UI direction, then spend real time on the story: ≤30 s video, ≤7 slides, 4-min live pitch, defense drills with the Q&A bank. | — | G7 (last block) |

## Priority order (what moves the score most per hour)
1. **Finish the usable product + real layers** (U7 running): criteria 6, 8, 5.
2. **Public no-login demo link** (static build, engine in the browser): criteria 5, 6, and required for global judging. *Needs the user's OK to publish.*
3. ~~Oversubscribed impact test~~ ✔ done: +5% mean science value vs a safety-checked nearest-first plan, never lower (`Validation/v3_impact/summary_oversub.json`).
4. **Jezero second site + site picker** (George's verified 1 m DTM): criteria 1, 6.
5. **Visor in the navigator look**: criterion 12 (one system, one look).
6. **Lunar Artemis site** with LRO LOLA data (optional, only if 1–5 are done): criterion 1 (impact beyond Mars).
7. **Presentation block**: project page, 30-s video, 7 slides, rehearsal + Q&A drills: criteria 9–12.

## Human team tasks (in parallel, no code)
- **Science credibility:** re-score the 12 station values with a written rationale; open and verify the 4 snippet-only citations (ST09–ST12).
- **Defense drills:** each teammate owns 3 questions from `JUDGING.md` §5 and practises answering in under 20 s with the proof.
- **Story:** draft the 20-second problem/solution/importance and the pitch outline; pick the final product name.
