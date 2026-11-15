# Marswalk: impact evidence (research notes)

Compiled 2026-11-14. Method: NASA/NTRS PDFs were downloaded and text-extracted, and quotes below were checked against that text. Items from search snippets only, or that I could not open, are marked **UNVERIFIED**. "Team result" means measured by us, not independently validated.

NTRS ids: `https://ntrs.nasa.gov/citations/<id>`.

---

## 0. Impact statement (<=120 words)

> Mars crews will plan and fly EVAs under 4-to-20-minute communication delay, and NASA's own concept of operations says the crew will plan more of their EVAs than ISS crews do, with automated planning tools. Marswalk is an offline planner for that job. It enforces 12 flight-rule-style constraints as hard limits, models suited walking energy and suit heat, explains why a plan is limited, and keeps guiding without a link. In 200 simulated Gale EVAs, a slope-only planner broke at least one rule 99.5% of the time and Marswalk 0%. It flags that walking to the boxwork targets exceeds an assumed suit heat budget, consistent with NASA's reliance on pressurized rovers. It is a research prototype, not validated with suited subjects.

(About 115 words.)

---

## 1. Who would use this, and why, in NASA's words

| User | Documented need (verbatim where quoted) | Source |
|---|---|---|
| Crew (Earth independence) | "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions by interacting with and acting upon locally sourced information." Challenges named: "rendering a variety of data in meaningful and contextually useful ways for crew consumption". Note: this is a lunar-framed Aerospace Corp. white paper for the 2023 Moon to Mars Architecture Concept Review. | NTRS 20230014957, "Surface EVA Architectural Drivers" (N. Mary), sec. 8 |
| Crew and flight team (Mars, latency) | "With long duration missions at destinations with a long communication latency, the crew will likely be more involved in planning their EVAs than as is currently done on ISS. Multi-day EVA planning will incorporate crew input, ground based planners, and automated planning tools." Also: communication latency "~4 and 20 minutes"; "the EVA crew will rely on a navigation system to find the correct sampling area and find their way back to the habitat or rover." | EVA-EXP-0042 Rev B, Exploration EVA System ConOps (2020), sec. 8.0-8.1 |
| In-situ IV crewmember acting as flight team | The IV crewmember "essentially performs the roles of IV, Flight Director, partial EVA Officer, and partial BME", so "An EVA mission support system will be utilized due to the amount of information and tasking the IV crewmember must contend with." | Same, sec. 8.1 |
| Flight Operations Directorate (FOD) EVA controllers | FOD supplies the operational constraints for EVA plans: "maximum traverse distance, maximum distance from lander, traverse lighting requirements, maximum safe slope for walking, maximum time without line of sight to lander, consumables redlines". Stated goal: "generate an EVA plan that maximizes scientific return while keeping astronauts safe & productive". Flight rules are "Controlled by Flight Director Office, agreed to by all Stakeholders". | NTRS 20250006988 (Kostak, Caswell, Young), "EVA Development in Exploration-Driven Human Spaceflight" |
| Science team / Science Evaluation Room (SER) | In the JETT3 analog the SER supported all four EVAs and the Science Team gave a prioritized station list. The EVA Science Officer "designed EVAs iteratively with Task to address the objectives while complying with mission rules for distance, time, and safety." | NTRS 20230000146, Caswell et al., LPSC 2023 (JETT3) |
| Flight controllers and crew (decision support gap) | "Flight control teams and astronaut crew need robust decision support tools"; "Future work may integrate real-time EV data (e.g., suit consumables, physiological performance) with traverse planning." (Our brief's wording "integrate real-time EV data with traverse planning" is a paraphrase; use the exact text.) Also: "Despite over five decades of EVA experience, operational focus has remained almost exclusively on microgravity rather than planetary surface operations." | NTRS 20260001895, Elston et al., IEEE Aerospace 2026, slides 5, 14, 17 |
| Traverse-planning researchers (NASA JSC) | "Assistive tools to efficiently plan exploration EVAs will be necessary for mission success." The JSC model is Pandolf-type (modified field-use Pandolf load-carriage equation). Development was "supported by the NASA Mars Campaign Office." | Kim et al., IEEE EMBC 2024, NTRS 20240001423 |
| Mission and suit architects | Surface EVA needs "affect many aspects of the exploration architecture", including site planning. EVA ranges "must be considered when planning distances between stationary elements" so crew can reach "a pressurized safe haven within the limits of emergency consumables". | NTRS 20230014957 |
| Mars suit developers | Mars PLSS is in early definition. They will "assume that landing sites for EVAs will be at locations where surface pressures do not exceed 7-8 Torr". "The distance of EVAs from the habitat may also be restricted to reduce the mass required for secondary/safety systems." | ICES-2026-126, NTRS 20260003024 (Ogilvie et al.) |
| SRAG | SRAG supports the Flight Control Team, and its mission includes "Develop flight rules that define requirements regarding radiation sources". It supports ISS "during EVAs". Mars-specific SRAG EVA constraints: no NASA source found (**UNVERIFIED**). Radiation is a plausible 13th constraint class for Marswalk (SAC21 notes radiation keep-out zones may affect traverse time, "insufficient surface site data at this time"). | NTRS 20230004380 (Whitman et al.); HEOMD-415 (NTRS 20220000589) |

**Caution on "12 NASA flight rules".** Flight rules are controlled by the Flight Director Office (NTRS 20250006988), and I found no public Mars flight-rule set. The public sources give parameter types (distance, slope, line-of-sight, consumables, buddy pairs, VO2 limits). Phrase as "12 constraints drawn from publicly documented NASA EVA rules and ConOps", and only say "NASA flight rules" if each rule has a citation. Public examples to cite per rule:
- Buddy pairs: Tenets of Lunar EVAs for Artemis III (NTRS 20230008183), tenet 2: "NASA will not nominally plan or perform an EVA with only a single crewmember".
- Distance from the lander is bounded by emergency return capability (same document, tenet 5).
- Reserve: "EVA durations will not be nominally planned to exceed the suit design limit" (tenet 7).
- ICES-2026-127 (NTRS 20260005410): "VO2max ... minimum flight rule set at 36 ml/min/kg for EVA"; nominal VO2 should not exceed 35% of VO2max for an 8-hour workday.
- DRA 5.0: Mars EVAs by "a minimum of two people and a maximum of four".

---

## 2. Scale of the need

### Mars reference missions

| Item | Figure | Source (verified in text) |
|---|---|---|
| DRA 5.0 crew and sites | "a crew of six would be sent on each of these missions, and each crew would visit a different location on Mars"; three sites. | NASA/SP-2009-566 (Drake 2009) |
| Surface stay | ~500 days on Mars (conjunction class, "500 days or more"). | SP-2009-566 |
| DRA 5.0 EVA party | "Mars surface EVAs would be conducted by a minimum of two people and a maximum of four." | SP-2009-566, sec. 5.2.1 |
| DRA 5.0 EVAs per week | **Not stated in SP-2009-566** (searched the text for "week"). A figure of "up to 1,000 EVAs in a 540-day stay" came from a secondary search snippet only: **UNVERIFIED, do not use**. | none |
| Walking range / rovers (DRA 5.0) | Features of interest are "beyond what is currently considered a reasonable walking range for the crew (determined by the distance a crew member could walk during one charge of power and breathing gases in his/her PLSS - roughly 20 km total)". A typical traverse goes out "approximately 15 km, or EVA walk-back distance". Pressurized rovers: "notionally a crew of two, 100 km total distance before being re-supplied, and 1- to 2-week duration", placed "within easy extravehicular activity (EVA) walking distance". Seated rover travel lowers the metabolic rate: surface transport helps "to mitigate crew fatigue and to extend consumable supplies by allowing lower metabolic rates during seated travel." | SP-2009-566, sec. 2 and 5.2.1 |
| 2022 Mars reference surface activities (SAC21) | Crew of 2 on the surface initially (4 in the larger example). Notional 30-sol schedule with 2.5-3.5 h EVAs, one or two per sol. Example 300-sol, 4-crew mission: high-tempo blocks of ~12-13 EVAs (~56-61.5 EVA-hours) per crew member alternating with low-tempo blocks of 3 EVAs. "at least one non-EVA sol between EVAs wherever possible." Key line: "Because of anticipated limits on the range that crew will be able to walk in Mars EVA suits, it is assumed ... that the unpressurized rover accompanies the pressurized rover on any extended range traverse", with extended traverses limited to "no more than 20 kilometers radial distance from the landing site". | HEOMD-415 (NTRS 20220000589), sec. 4.3, 5.7, App. C7 |
| Mars EVA frequency (ConOps) | Mars details are "forward work", but the lunar-to-Mars precursor case uses "3-4 EVAs per week for 6 months", "2-8-hour excursions", and 2-4 crew on EVA. | EVA-EXP-0042 Rev B, sec. 8.2 and use-case tables |
| EVA workload ceiling | xEVA hardware is "designed for crews to perform up to 24 hours of EVA per person per week", i.e. "6-8 hour duration EVAs 3-4 times per week". "As many as 624 hours of EVA per crew member in a single mission" (6 months). | NTRS 20220004017, EVA Injury Evidence Report |

Order-of-magnitude takeaway: a 500-day, 6-person mission implies hundreds of EVAs per crew member if the 3-4 per week ceiling were sustained. SAC21 assumes a much lower sustained pace because of crew exhaustion. Our own arithmetic is not a NASA figure: 3-4 per week over ~70 weeks is ~210-285 per person. Say "hundreds, in the planning ceiling", not "1,000".

### Artemis

- Reference Artemis III concept: "Surface stay duration: 6.5 days (~156 hr)" and "2 - 5 surface EVAs" (NASA EVA Lunar Surface ConOps, 2020, nasa.gov topic_1 PDF). It is labelled notional. Current Artemis III EVA count: **UNVERIFIED** (a 2026 plan was not found in an official source).
- JETT3 ran "four EVAs over a five-day simulated mission" in a 2 km radius, "consistent with the current NASA Reference Artemis 3 mission" (Caswell 2023).
- Artemis constraint: distance from lander max 2 km from a 1 h emergency-return assumption (Tenets, NTRS 20230008183).

### Planning effort in analogs

I found **no published person-hours or elapsed-time figure** for EVA planning in JETT/BASALT/D-RATS. What exists:
- Qualitative: "Planning traversals on other planetary surfaces will be a time consuming task undertaken weeks and months" before the mission, and for Apollo "Pre-mission traversal planning ... was a time-consuming task that occurred during the weeks and months" (Marquez et al. 2005, AIAA, "Collaborative human computer decision support for planetary surface traversal"). Real-time replanning aids "will be required."
- Process structure: JETT3 traverse design was iterative between the EVA Science Officer, EVA Task and the Science Team, with commercial and prototype tools (Caswell 2023). The ASCEND deck lists five steps (objectives, POIs, constraint-driven range, group POIs into EVAs, iterate with stakeholders) but gives no durations.
- A search snippet said real SEXTANT-analog traverses took significantly longer than predicted (n=6, p<0.01). I did not open it: **UNVERIFIED**.

So "replan median 8.5 ms" cannot be compared with any published NASA replanning time. Compare only qualitatively.

---

## 3. Is the suit-heat finding relevant to current NASA work?

**Relevance: yes, the topic is active; the specific claim is not stated by NASA.**

What NASA publishes (2025-2026):
- Mars suit thermal control is an open design problem. ICES-2026-126: "use of SWME technology for thermal control is contingent on low enough atmospheric pressure"; SWME "has been evaluated at pressures up to 10 Torr"; existing tests "did not account for airflow within the suit's internal volume or for any filtration"; "If thermal loads remain comparable to current requirements, the SWME may need to be scaled up or supplemented with sweep gas." Counter-point: "alternative thermal control strategies or environmental factors on Mars may reduce the cooling demand placed on the SWME."
- NASA Mars PLSS briefings: Mars environment "Precludes use of venting technologies (SWME and RCA) without modification" (ICES-2026 presentation, NTRS 20260005204; the 2025 version says "Precludes use of venting technologies (SWME and RCA)", NTRS 20250006266).
- Sizing metabolic rates: average 350 W (1194 BTU/hr) and maximum 530 W (1810 BTU/hr) for an 8 h Mars EVA (ICES-2025-90, NTRS 20250003716). ICES-2026-127 (NTRS 20260005410): "expected 1200 BTU/hr for future mission sizing". 1200 BTU/hr = 352 W, which matches our "352 W design average"; cite that paper for it.
- Variable-emittance radiator in Mars environments (ICES-2025-90 Table 7): rejects 88-114 W (Mars hot case) and 220-330 W (nominal and cold), against ~320/~500 W (hot average/max) requirements. That is the radiator alone, not SWME.
- ICES-2026-158 (NTRS 20260002884): transient analysis suggests SWME use "could be limited to a very brief time interval" and it "could be sized down even further" (e.g. 30 W) for some schematics. So heat budgets are still moving.
- Mars walk-back physiology: the NASA 10-km walkback study at lunar and Mars gravity offload "Hits VO2max at 3.5mph on Mars", with ~14 ml/min/kg added by suit restriction; "aerobic maximums are used as a limiting factor for walk backs" (ICES-2026-127). It also notes the study was unpressurized (wetsuit), so suit-restriction numbers are estimates.
- Mars gravity is "2.3 times Lunar gravity (3/8th vs 1/6th Earth gravity)" (ICES-2026-127).

**Is "cooling limits walking range more than O2" stated anywhere?** I did not find it. NASA sources frame walk-back/range as limited by PLSS consumables ("power and breathing gases", DRA 5.0), emergency O2 return time (Artemis tenets), and aerobic capacity (ICES-2026-127). Thermal limits appear only in passing:
- Artemis tenets: "Thermal constraints may also further constrain EVA time in specific areas."
- A lunar-focused paper: "Thermal control performance in dark shadows will also affect EVA duration" (NTRS 20230014957).
- A 2023 ICES thermal study reportedly used 400 W and noted emergency walk-backs can exceed it: **UNVERIFIED** (could not open; the host returned 403).

Careful wording: "We did not find NASA literature that quantifies heat rejection as the binding constraint on Mars walking range. NASA treats it as an open Mars PLSS sizing question. Marswalk makes that interaction checkable per route." Do not claim novelty.

Caveats on our own number:
- "SWME rejects ~370 W in Mars conditions": I found no NASA document stating this. Treat it as a modelling assumption, and say that NASA has not validated SWME at Mars pressure with dust and suit airflow.
- "460-800 W" walking power: NASA's sizing maximum is 530 W for transient peaks, and the 8 h average is 350 W. Our upper range exceeds NASA's design maximum, so state that those cases are sustained-walking estimates from Pandolf-Santee x Mars g (an extrapolation; no suited Mars-gravity validation exists, and NASA says Mars-gravity suit data is limited).
- The finding is therefore conditional: "under the assumed heat budget, walking to the targets is infeasible", not "NASA suits cannot do it."

Consistency with pressurized-rover assumptions (verified): DRA 5.0 and SAC21 both assume pressurized rovers plus a suit-range limit (about 20 km radial). Seated rover travel "allowing lower metabolic rates" (DRA 5.0). So "consistent with NASA's use of pressurized rovers" is defensible. "Confirms" or "proves" is not.

LTV: the Artemis LTV is unpressurized (search results, secondary sources). Mars pressurized rover concepts are in DRA 5.0 and SAC21 (verified). I did not verify a pressurized lunar rover requirement: **UNVERIFIED**.

---

## 4. Adoption paths and what each would need

| Path | Evidence it is plausible | What adoption would require |
|---|---|---|
| Artemis lunar EVA planning (LRO/LOLA terrain) | NASA FOD constraints are the same kind we enforce (max slope, distance, LOS, consumables), and NASA uses GIS/least-cost-path tools (AEGIS, SEXTANT; NTRS 20260001895, 20250006988). A non-NASA study built LOLA-based minimum-workload traverses for the lunar south pole (Peña-Asensio et al., Acta Astronautica, via search snippet: **UNVERIFIED** in detail). | Swap g to 1.62 m/s2, vacuum thermal model, lunar hazards, lighting and comm layers, and flight-rule parameters from Artemis documents. Compare outputs against AEGIS/JETT traverse products. Feasibility of reuse is our engineering judgment, not NASA-stated. |
| NASA analogs: JETT, BASALT, D-RATS | JETT3/JETT5 tested integrated FCT and Science Team planning (Caswell 2023; USGS and NTRS pages for JETT5). SEXTANT/xGDS were deployed in BASALT; "Future work may integrate real-time EV data ... with traverse planning" (NTRS 20260001895). | Run as a decision-support side tool in a mock FCT. Compare predicted vs measured metabolic rate and traverse time. Needs analog partners and IRB-covered subject data. NASA's own field metabolic model had only 4 subjects at JSC Rock Yard (Kim 2024), so independent field data are scarce and valuable. |
| Mars landing-site / exploration-zone studies | EZ = Regions of Interest "within approximately 100 kilometers of a centralized landing site" (NTRS 20150019647, search snippet; **partially verified**). Mars reference sites are chosen for science and ISRU; walkable-reach analysis from a habitat is a natural screening layer. | Use real HiRISE/CTX/MOLA-derived DTMs for candidate EZs; compare reachability from the habitat vs from a rover staging point. Present as screening, not selection. |
| Suit and rover requirements | Mars PLSS thermal sizing is open; NASA is exploring dust, sweep gas and radiator options (ICES-2026-126/158). | Offer a parametric tool: for a given heat-rejection capability, which target sets are walkable. Needs NASA-supplied or measured suit thermal curves, and suited human testing at Mars g (NASA says such data are limited). |
| Education and open science | Public NASA data, open method. | Publish code, assumptions and test vectors under an open license; include a "limitations" page. |

**Validation needed before any operational use** (state this plainly): (1) suited human metabolic data in Mars-gravity offload for the Pandolf-Santee scaling; (2) suit thermal capacity data (SWME at Mars pressure with dust); (3) review of the 12 constraints by someone with real flight-rule experience; (4) the 24/24 AI-review agreement and 0% violation rate test internal consistency, not real-world safety.

---

## 5. Broader and community impact (modest)

- Open-source tool: NASA states analog decision-support tools are developed and iterated in field tests (Playbook, Maestro, SEXTANT, xGDS; NTRS 20260001895). An open, offline-capable, explainable planner that anyone can run fits that ecosystem. We have no evidence of users yet.
- Education: legitimate framing is "interactive way to see why Mars EVAs need rovers", using NASA sources. No data on learning outcomes.
- Citizen science: no credible link found. Do not claim it.
- Terrestrial remote fieldwork: the energy model is a load-carriage-on-slope model (Santee et al. 2001, Aviat Space Environ Med; cited in Kim 2024), so the terrain-energy part has terrestrial heritage. Whether it is used in search-and-rescue or field-geology planning was not verified. Say "could inform", only if you add a caveat; otherwise omit.
- Offline-first guidance under link loss has a real NASA basis (latency, "Earth may not have continuous comm", Artemis tenets 5; ConOps 8.1), but we found no source that quantifies value.

---

## 6. Impact claims we can defend

| Claim | Evidence | Source |
|---|---|---|
| Mars EVAs will need crew-side planning support because Earth help is delayed | ConOps: latency ~4-20 min; "crew will likely be more involved in planning their EVAs ... automated planning tools"; IV crew "essentially performs the roles of IV, Flight Director, partial EVA Officer" | EVA-EXP-0042 Rev B sec. 8.1 |
| NASA names Earth-independent EVA decision-making as an architectural driver | "Earth independence starts by giving crew members, particularly during EVA, the capacity to make informed decisions ..." | NTRS 20230014957 sec. 8 |
| NASA identifies integrating suit state with traverse planning as future work | "Future work may integrate real-time EV data (e.g., suit consumables, physiological performance) with traverse planning" | NTRS 20260001895 slide 14 |
| Constraint-based EVA plan generation is how FOD and Science work today (lunar) | FOD constraint list; goal "maximizes scientific return while keeping astronauts safe & productive"; iterative ESO/Task/Science planning | NTRS 20250006988; NTRS 20230000146 |
| Metabolic-cost traverse models are an active NASA need and still crude | "Assistive tools to efficiently plan exploration EVAs will be necessary"; SEXTANT assumes constant speed per slope (snippet, UNVERIFIED); NASA JSC uses Pandolf-type model | NTRS 20240001423 |
| Pandolf-Santee-based energy is aligned with NASA's own approach | JSC Crew State and Risk Model traverse model uses a modified field-use Pandolf equation | NTRS 20240001423 |
| Reference Mars missions are long, many-EVA campaigns | 6 crew, ~500 days; xEVA hardware designed for up to 24 EVA-hours/person/week; 300-sol example with ~12-13 EVAs per crew per high-tempo block | SP-2009-566; NTRS 20220004017; HEOMD-415 |
| Suit-limited walking range drives rover use on Mars | DRA 5.0 ~20 km (PLSS charge) and pressurized rover; SAC21 20 km radial limit, rovers accompany extended traverses | SP-2009-566; HEOMD-415 |
| Mars suit thermal capacity is unresolved, so thermal-aware planning is timely | SWME "may need to be scaled up"; "Precludes use of venting technologies ... without modification"; heat budget under transient analysis still changing | NTRS 20260003024; 20260005204; 20260002884 |
| 352 W design average corresponds to a NASA sizing figure | "1200 BTU/hr for future mission sizing" (= 352 W) | NTRS 20260005410 |
| Our planner results (team result, simulation only) | 99.5% vs 0% rule violations over 200 simulated Gale EVAs; 8.5 ms median replan; +5% science value vs safety-checked nearest-first; 24/24 blind AI review agreement | Our test logs (not independently reviewed) |
| Finding is consistent with pressurized-rover architecture | Walking-range limits and rover assumptions above; also seated travel lowers metabolic rate | SP-2009-566; HEOMD-415 |

---

## 7. Claims to avoid

- "NASA is adopting / endorsed / needs our tool." We have no NASA relationship; sources show a need class, not a request.
- "Enforces NASA flight rules" without qualification. Say "12 constraints drawn from public NASA EVA documents" unless every rule is cited. Mars flight rules are not public.
- "We discovered that cooling, not oxygen, limits Mars walking" or any novelty claim. NASA frames walk-back around consumables and aerobic capacity, and does not quantify heat as the binding limit; but the heat-budget concern is documented and under study. Our claim is a conditional model result.
- "SWME rejects 370 W on Mars" as fact. No NASA source found; NASA says SWME on Mars needs further testing and may be scaled.
- "460-800 W walking" as measured. It is a model extrapolation (Pandolf-Santee x 0.38 g), no suited Mars-g validation. It also exceeds NASA's 530 W design maximum at the top of the range.
- "Proves" habitat-to-boxwork walking is infeasible. Say "under our assumed suit heat budget".
- "Validated" or "safe for crew use". 0% violations and 24/24 AI agreement are internal checks.
- "AI review agreed, so it is correct". The reviewer saw the same constraint model; it shows consistency.
- "Saves X hours of planning". No published baseline planning time exists, and we have not timed users.
- "1,000 EVAs in DRA 5.0", "EVAs per week from DRA 5.0". Not in the primary document.
- Citizen-science or terrestrial-impact claims without a source.
- "+5% science value" without scope: it holds only when time is oversubscribed, against a safety-checked nearest-first baseline, on our science-value scoring, which is our own metric.
- Naming specific Artemis III EVA counts or crew as current plan (UNVERIFIED).

---

## 8. Source list (checked unless marked)

- NTRS 20230014957, Surface EVA Architectural Drivers (Aerospace Corp., 2023): checked.
- NTRS 20260001895, Review of Advanced Informatics and Display Systems for EVA Operations (Elston et al., IEEE Aerospace 2026): checked (slides).
- EVA-EXP-0042 Rev B, Exploration EVA System ConOps (2020): checked. `https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf`
- NASA/SP-2009-566, Mars DRA 5.0: checked. `https://www.nasa.gov/pdf/373665main_NASA-SP-2009-566.pdf`
- HEOMD-415 / NTRS 20220000589, Reference Surface Activities for Crewed Mars Mission Systems (2022): checked.
- NTRS 20250006988 (ASCEND, EVA development); NTRS 20230000146 (JETT3, LPSC 2023); NTRS 20230008183 (Tenets of Lunar EVAs for Artemis III): checked.
- NTRS 20220004017, EVA Injury Evidence Report: checked.
- ICES-2026-126 (NTRS 20260003024), ICES-2026-127 (NTRS 20260005410), ICES-2026-158 (NTRS 20260002884), ICES-2025-90 (NTRS 20250003716), presentations NTRS 20250006266 and 20260005204: checked.
- NTRS 20240001423 (Kim et al. 2024) and Marquez et al. 2005 (Vanderbilt-hosted PDF): checked.
- NTRS 20230004380 (SRAG tools): checked for SRAG role only.
- NASA EVA Lunar Surface ConOps topic_1 (2020): checked lines on 6.5 days and 2-5 EVAs.
- NTRS 20150019647 (Exploration Zone, 100 km), Peña-Asensio et al. LOLA traverses, SEXTANT field comparison, ICES-2023 400 W paper, Artemis III current EVA plan, Curiosity boxwork press items: search snippets only (**UNVERIFIED** in detail).
