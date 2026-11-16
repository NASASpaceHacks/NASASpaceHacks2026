# Parameter audit: are our EVA-planner parameters enough?

*Research pass, 2026-11-15. Scope: compare the 12 Marswalk rules and the engine (`Content/flightrules.yaml`, `Shared/src/contracts/rules.ts`, `costModel.ts`, `heat.ts`, `radiation.ts`) with what NASA EVA planners document. No code was changed.*

## How to read the evidence labels
- **[read]** = I opened the source in this pass and the quoted statement is in it.
- **[repo]** = the citation is already in our repo; I did not re-open it. Treat as "as cited by the team".
- **[unverified]** = my background knowledge or a search snippet only. Do not put it on a slide until someone opens the source.
- Effort S/M/L, value and class are my judgement, not NASA's.

Honest framing for everyone: **Mars flight rules are not public.** Everything below is lunar (Artemis) or Apollo practice plus Mars study documents. Mars EVA constraint lists are design studies, not flight rules.

## Sources actually read in this pass
| ID | What | Link |
|---|---|---|
| NTRS 20250006063 | Caswell, Kostak, Young, ASCEND 2025, Artemis EVA planning. Table 1 gives FOD constraints: "maximum traverse distance, maximum distance from lander, traverse lighting requirements, maximum safe slope for walking, maximum time without line of sight to lander, consumables redlines". Also: ops team may limit "the length of EVA traverse that occurs in shadow to reduce the risk of the astronauts from unseen slopes or obstacles"; SMD supplies "terrain hazards"; crew Map Book shows "comm coverage, slopes, and anticipated lighting"; AEGIS pins "navigational references or hazards"; consumables = "oxygen, CO2 removal, and temperature control" | https://ntrs.nasa.gov/api/citations/20250006063/downloads/Caswell%20Kostak%20Young%20ASCEND%202025%20Rev%206-11-25.pdf |
| NTRS 20240005248 | EVA Ops 101 for Artemis III external teams: "EVAs are performed in buddy pairs", pairing "to help with both crew and suit system consumable contingency responses"; planning factors include comm/video range, emergency return, real-time suit health | https://ntrs.nasa.gov/api/citations/20240005248/downloads/EVA%20Ops%20101%20for%20Artemis%203%20External%20Teams.pdf |
| NTRS 20260005204 | ICES 2026 Mars PLSS schematic study (Oliver et al., ICES 402 Paper 158): Mars atmosphere ~0.15 psia 95% CO2 (venting tech needs modification, gaseous atmosphere adds thermal conductance); dust "major hazard...toxic particles - less abrasive than lunar soil but more reactive"; avg metabolic 350 W, max 530 W, suit 4.3 psia, EVA 2/4/6/8 h, pre/post EVA 2 h; hot/nominal/cold cases: air 299.8/212.0/162.6 K, wind 20.12/10.05/4.88 m/s | https://ntrs.nasa.gov/api/citations/20260005204/downloads/ICES_Mars_PLSS_Presentation_2026_1.pdf |
| NTRS 20230014957 | Surface EVA Architectural Drivers white paper (lunar, says Mars is "to even greater extent"): dust, prebreathe time "can affect the duration of the EVA", early missions "mainly utilize orienteering", "persistent long shadows", walk-back to safe haven, comm between EVA crew limited by "distance and/or line of sight" | https://ntrs.nasa.gov/api/citations/20230014957/downloads/Surface%20EVA%20Architectural%20Drivers.pdf |
| NTRS 19700009560 (NASA-CR-108134, Bellcomm TR-69-340-4) | Apollo J-mission traverse study. Ground rules: "Two men shall be out and shall remain within sight of one another", max 5 h in suit nominal / 6 h emergency, LRV failure: walk back "on the consumables remaining in the PLSS". Conclusions: time-in-suit limits riding traverses, "primary life support consumables are usually the limiting factor on walking missions"; walkback "minimized" by putting most stations after the max-radius point. Not considered in that study: "distance limitations to meet communications and navigation requirements" | https://ntrs.nasa.gov/api/citations/19700009560/downloads/19700009560.pdf |
| NTRS 20240011393 | Litaker et al., south-pole lighting studies (lunar, driving): up-sun drivers tacked +/-20-30 deg; shadowed terrain makes slope/depth hard to judge and slows travel; "constant transitioning between dark and light areas" taxing; stars unusable for navigation | https://ntrs.nasa.gov/api/citations/20240011393/downloads/Lighiting%20Study%20IEEE%20Paper%20FINAL-1.pdf |
| NASA OCHMO radiation brief (cites NASA-STD-3001) | [V1 4030] career effective dose "shall be less than 600 mSv"; [V1 4031] design-reference SPE (Oct 1989 spectrum) effective dose to "less than 250 mSv"; SPE warning: "dose-rates for the large majority of past SPEs show real-time responses". No 30-day limit appears in this brief | https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf |
| arXiv 2409.19455 (Lamarre and Kelly, i-SAIRAS 2024) | Apollo 15 crew "surprised by highly unconsolidated soil" on Hadley Delta; Apollo 16 parked LRV in a depression; walkback/rideback constraints "one of the points of contention" with crew | https://arxiv.org/abs/2409.19455 |
| Search snippets only [unverified body] | NASA human-performance slides (Estep, NTRS 20240005165 / 20240004073): analog EVAs reach ~60% of max metabolic rate; fatigue concern with higher EVA density. Rucker (JSC) on Mars storms, visibility in boulder fields, hidden sand pits. Pappa and Kerslake (NTRS 20170006908): tau ~6 design storm for solar arrays. REMS wind: "maximum wind speed of about 14 m/s" daytime, tail to the 20 m/s calibration limit; wind sensor damaged at landing | see search results; re-open before citing |

---

## 1. Missing parameters, ranked

Ranking = how likely a NASA reviewer or judge asks, times how cheap the fix is. "Class" key: MUST = credibility gap; SHOULD; NICE; OOS = out of scope, say so.

| # | Parameter (what it is) | NASA evidence it matters | Computable for a 5x5 km Mars site? Dataset | Effort | Value | Class |
|---|---|---|---|---|---|---|
| 1 | **Consumables driven by metabolic rate** (O2, CO2 scrub capacity, cooling water, battery). Today O2 is a time burndown (100% to 0 at the walkback deadline); the walking power we already compute never reduces a consumable | Caswell: FOD "consumables redlines"; planners monitor "oxygen, CO2 removal, and temperature control". Bellcomm: consumables "the limiting factor on walking missions". ICES 2026: 350 W avg / 530 W max sized, consumables per EVA | Yes, from our own metabolic W (costModel) plus a published sizing point (350 W avg, ICES 2026, NTRS 20260005204). No new dataset. Absolute kg/Wh of a real Mars PLSS are not public: show as % of an assumed capacity, labelled | S-M | High | **MUST** |
| 2 | **Two-person / buddy rule and rescue case** (both crew out together, in sight or in comms; partner incapacitated, who carries what, walkback speed) | EVA Ops 101: "EVAs are performed in buddy pairs". Apollo ground rule: "Two men...within sight of one another". Our design doc mentions "buddy pair walks the same route" but no rule models it | Rule-level: yes (state it, plan for 2, size walkback for assisted return). Physics of carrying a crewmate: no data | S (state + tie to walkback factor); L for rescue modelling | High | **MUST** (state and wire to walkback); rescue physics **OOS** |
| 3 | **Shadowed-traverse limit and sun direction vs heading** (glare when walking toward the sun; long shadows hide slopes) | Caswell: ops team may limit "length of EVA traverse that occurs in shadow". Litaker (lunar driving): up-sun glare, +/-20-30 deg tacking, slower travel. Lunar-derived: Mars sun is higher than lunar polar, so the effect is milder (my judgement) | Yes: DEM horizon shadows + Mars24 sun azimuth/elevation (both already in the stack: skyview, sun relief, marstime). Walk heading is known per edge | M | Med-High | **SHOULD** (top) |
| 4 | **Rock and boulder hazard / abundance** (obstacles the grid slope misses; slows walking; hidden from planners below ~1 m) | Caswell: SMD provides "terrain hazards"; planners know features "larger than about 1 meter" only [read, abstract via NTRS summary]. Golombek et al. HiRISE rock counts exist for landing sites, HiRISE resolves ~>1.5 m rocks, smaller by extrapolation [search snippet, unverified] | We use DEM roughness as a rock proxy. Better: HiRISE ortho rock detection (L) or published landing-site rock maps if the site has one [unverified for Gale/Jezero ellipses]; THEMIS TI-based abundance is coarse [unverified]. Roughness proxy is the honest fallback | M (calibrate roughness proxy against a published rock count) to L (detect rocks) | Med-High | **SHOULD** |
| 5 | **Soft soil / sinkage and fragile crust** (loose fines, hidden sand pits) | Apollo 15 "highly unconsolidated soil" [read: Lamarre]. Rucker: "hidden sand pits" [snippet] | Partly: THEMIS TI to eta is our existing assumption (labelled). Firmer: HiRISE texture/ripple classes, Curiosity wheel-slip logs, terrain classification (NOAH-H, AI4Mars) [unverified link to our case]. Crevasses: n/a at Gale/Jezero floor. Fragile crust: no data | M | Med | **SHOULD** (firm up eta); crust **OOS** |
| 6 | **Surface temperature and wind in the suit thermal budget** (convection on Mars changes suit heat leak; cold-soak at low sun; wind raises convective loss) | ICES 2026: environment cases hot/nominal/cold air 299.8/212.0/162.6 K, wind 20.1/10.1/4.9 m/s; "gaseous atmosphere adds significant thermal conductance"; GUS tool models "convective heat transfer contributions on Mars" | Air/ground temp and pressure: REMS/MEDA (already in Weather tab). Wind at Gale is poor (damaged sensor, snippet); MEDA better at Jezero [unverified]. Our heat budget is metabolic-only (352 W), with no environment term | M | Med | **SHOULD** (add a Hot/Nominal/Cold selector for the budget; cite ICES cases); numeric suit leak: **OOS** (no public suit model) |
| 7 | **Radiation vs NASA-STD-3001 limits** (we compute dose but do not compare it to the limit) | V1 4030: 600 mSv career; V1 4031: 250 mSv design-reference SPE [read]. 30-day limit: not found in the sources I read [unverified] | Yes, already computed (radiation.ts, RAD-checked). A 6 h EVA is a tiny fraction of 600 mSv (at 0.64 mSv/day, Hassler 2014 [repo], ~0.16 mSv); say so, do not pretend it binds | S | Med (cheap credibility) | **SHOULD** |
| 8 | **Prebreathe / DCS and suit pressure** | Arch drivers: prebreathe time "can affect the duration of the EVA"; suit 4.3 psia (ICES 2026). ICES assumes **2 h** pre/post-EVA vs our 60 min egress+ingress (xEVA ConOps) | Not a data problem; it is an ops constant. Show both values | S (note) | Low-Med | **NICE**; DCS physiology **OOS** |
| 9 | **Dust opacity, visibility, storms** | ICES 2026 names "dust, lighting, and visibility"; Rucker: poor visibility in boulder fields [snippet]; tau ~6 design storm (Pappa and Kerslake [snippet]) | Opacity time series: MEDA/REMS UV, orbiter dust-opacity products [unverified names]. No threshold for "too dusty to walk" found. Storm forecasts: not available at EVA time scale | S (show as advisory) | Low-Med | **NICE**; thresholds and forecasts **OOS** |
| 10 | **Task time (sampling, deployment)** | Caswell: Cuff Checklist timing per station (e.g. drive tube sampling); analogs BASALT/JETT time EVAs [snippet] | We have `dwellMin` and task power per station. Task-specific durations are team numbers | S | Med | **NICE**; label dwell as an assumption |
| 11 | **Crew fatigue and cognitive workload** | NASA human performance: ~60% max metabolic rate in analog planetary EVAs, fatigue with EVA density [snippet, unverified body] | Within-EVA: only via metabolic W. Multi-EVA recovery and cognition: no model or data | M | Low | **OOS**; say "planned per single EVA; no cumulative fatigue" |
| 12 | **Comm relay via orbiters (pass windows)** | Arch drivers: comm "limited by distance and/or line of sight"; Earth latency 4-20 min [repo, EVA-EXP-0042] | Pass windows from MRO ephemeris (SPICE) [unverified toolchain]. Matters for Earth link, not for the habitat-crew link we gate on | M | Low | **OOS** for EVA gating; say Earth link is not on the EVA critical path |
| 13 | **Dust devils and wind gusts as hazards** | Rucker/REMS: winds to 14-20 m/s [snippet]; no NASA EVA wind limit found | MEDA/REMS statistics only; no operational limit to enforce | S (show) | Low | **OOS** (no documented limit); mention in Weather tab |
| 14 | **Navigation aids** (flags, landmarks, hand-held map) | Caswell Fig. 4 shows "navigational references (flags)"; arch drivers: early missions "mainly utilize orienteering" | Already covered: orienteer.ts, DTM landmarks, sun-azimuth cue | - | - | **Covered** |
| 15 | **Rover rescue and contingency return** | DRA 5.0 rover-based architecture [repo]; Bellcomm LRV-failure walkback rule | Covered by walkback + "Move rover closer"; rover as moving safe haven is in design doc | - | - | **Covered** (state limits) |
| 16 | **Suit dust intrusion, health effects** | ICES 2026: toxic, "more reactive" than lunar | Hardware/toxicology, not a route parameter | - | - | **OOS** |

### MUST items, in one place
1. Metabolic-driven consumables burndown (O2, CO2 scrub, water, power) tied to the walking power the engine already computes. Without it the "consumables redlines" bullet in our own FOD mapping is only a clock.
2. Buddy-pair rule stated and wired to the walkback case (plan assumes two crew; walkback factor represents an assisted return).

### Top 3 SHOULD items
1. Shadow-length and sun-direction constraint (NASA names shadow-length limits; computable from data we already hold).
2. Rock/boulder hazard layer, at minimum a documented calibration of the roughness proxy (HiRISE counts where published).
3. Radiation shown against NASA-STD-3001 limits (cheap), then environment case selector for the heat budget (Hot/Nominal/Cold, ICES 2026).

---

## 2. Our 12 rules: strength of each

Strength: **Strong** = a NASA document gives this number for this use. **Medium** = NASA number exists but adapted (lunar to Mars, sizing to limit) or derived. **Weak** = team assumption. "Checked" says whether I opened the cited source.

| Rule (value) | Basis in repo | Strength | Checked in this pass | What would firm it up |
|---|---|---|---|---|
| slope_max_deg (20) | xEVA ConOps EVA-EXP-0042 Rev B; Artemis III (NTRS 20230005904) | Strong | No [repo] | Nothing urgent. Note it is a crew-safety limit, not a Mars-validated one |
| slope_soft_deg (16.7) | Norcross 2010, NASA/TP-2010-216125 data edge (30% grade = 16.7 deg) | Strong as a data-edge | No [repo]; the 30%-to-16.7 deg arithmetic is correct | None; keep labelled "data edge, not a NASA limit" |
| eva_duration_max_min (360) | EVA-EXP-0042 "6 +/- 2 h" | Strong | Partly: ICES 2026 studies 2/4/6/8 h EVAs; Apollo was 5 h nominal / 6 h emergency (Bellcomm) | Mention the 2-8 h range; 6 h is the middle |
| egress_ingress_min (60) | EVA-EXP-0042 ~1 h | Medium | ICES 2026 assumes **2 h** pre/post-EVA (different purpose: consumable sizing). Possible reviewer question | Show the 2 h figure as a sensitivity; explain 1 h is the ConOps number |
| contingency_o2_min (60) | EVA-EXP-0042 +1 h backup | Strong | No [repo]. Apollo analog: walkback on remaining PLSS (Bellcomm) | None |
| walkback_speed_factor (0.5) | Team assumption, Apollo walkback concept | **Weak** | Bellcomm confirms walkback is a ground-rule concept, gives no 0.5 | NASA-JSC suited 10 km walkback study (seen in search, ID not captured; find and cite), Norcross suited metabolic data for degraded pace, partner-assist case |
| shelter_time_max_min (30) | arXiv:2502.02469 nowcast; DRA5 Addendum | Medium-Weak | OCHMO brief confirms real-time response is feasible for "the large majority of past SPEs" and the 250 mSv SPE limit. It gives no 30 min | Derive from the dose-rate model vs the 250 mSv limit (V1 4031) rather than a fixed time; cite the NASA brief |
| los_gap_max_min (10) | FOD concept (Caswell); value is ours | **Weak** (value) / Strong (concept) | Caswell confirms the constraint exists, with no number. Bellcomm notes comm distance was not in its study | An Artemis or analog (JETT, BASALT) comm-outage rule if public; otherwise keep "assumption" badge |
| daylight_min_sun_elev_deg (5) | DRA5 Addendum "no nominal night EVAs"; threshold ours | **Weak** (value) | Caswell says NASA caps shadow *length* traversed, not a sun angle. Our 5 deg is a stand-in | Replace or supplement with a max-shadowed-distance rule (item 3 above) |
| heat_avg_max_w (352) | ICES-2026-127: suits sized for 1200 BTU/h; SWME tech brief | Medium | ICES 2026 Mars PLSS (NTRS 20260005204) uses **350 W avg / 530 W max** primary met rate: corroborates. But it is a sizing average, not an enforced limit; our 30 min window, 250 W rest/task, initial heat are team assumptions (heat.ts) | Cite 350 W / 530 W; say clearly "sizing figure used as a budget" |
| walk_radius_max_m (2000) | Artemis III tenets (NTRS 20230008183): 2 km, 1 h return on contingency O2 | Medium | No [repo]. Lunar rationale; Mars gravity/suit mass differ | State the derivation; our own walkback check is the Mars-specific test |
| plume_keepout_m (1000) | Hoffman et al. (NTRS 20160002370) 1 km | Medium | No [repo]. Workshop figure, not a flight rule | Compare with Mars landing-plume studies if time allows [unverified] |

**Cross-cutting model assumptions that are weaker than any rule** (not in the 12; say so openly):
- Terrain factor eta from THEMIS thermal inertia (350/100 thresholds) is a team mapping, labelled Indicative.
- Walking speed is constant (0.56 m/s, planning pace); slope changes power, not time. Broddrick (2024) is criticised on our own slides for fixed speed. We do the same.
- Mars gravity (0.38 g) is outside the 0.12-0.32 g calibration range of the metabolic data.
- Dose model is within about +/-30% (our own V5 check).

---

## 3. What to say if a judge asks "are your parameters enough?"

> "Enough for a first, honest planner, not for flight. We enforce NASA's published constraint list: slope, distance, duration, consumable time, shelter, line of sight, light, heat. Four values are our assumptions and badged. Not yet modelled: metabolic consumables, shadow length, rocks, thermal environment. Mars flight rules aren't public."

(about 58 words)
