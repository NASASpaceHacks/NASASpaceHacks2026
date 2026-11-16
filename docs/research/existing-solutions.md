# Existing solutions for "plan and carry out a human EVA on Mars using NASA data"

Research date: 2026-11-14 (the first day of the Space Apps 2026 hackathon, so the competitor set below is partial and still growing).
Convention: **UNVERIFIED** marks anything not confirmed from a primary or fetched source. "Not documented" means the sources I could read say nothing, which is weaker than "does not exist".

## 0. Method and limits

- Read in full (PDF text extracted): NASA JSC "Review of Advanced Informatics and Display Systems for EVA Operations" slides (Elston et al., NTRS 20260001895), the matching IEEE Aerospace paper (NTRS 20250011652), the 2026 EMSS/AEGIS paper slides (NTRS 20260001893), the ICES 2023 EMSS slides (NTRS 20230010012), Miller et al. LPSC 2023 (NTRS 20230000186), Broddrick et al. LPSC 2024 (NTRS 20240000165), Joint AR AIAA ASCEND paper (NTRS 20220013671), NASA Artemis Geospatial Data Team deck (NTRS 20230006633).
- Read as abstract or search summary only: MoonPath (Acta Astronautica 214, 2024; the UAB repository page was blocked, so the full paper was never opened), SEXTANT thesis (MIT DSpace abstract), Gilkey et al. SEXTANT evaluation (abstract via search), MLNav, ENav, Field D*, Cesium Mars, Google Mars, Worldview.
- Fetch failures: Esri ArcUser "Finding the best paths for rovers and humans on Mars" (HTTP 403, content UNVERIFIED), UC Davis RASAGE page (HTTP 403, content UNVERIFIED), the ICES 2026 Mars PLSS plan PDF (not read).
- Competitor survey: GitHub search API, repos created on or after 2026-08-01, 8 query strings x 2 pages (100/page cap). 211 unique repos; 151 mention "Martian Map", "Interplanetary Survival Guide" or "Marswalk" in the README; 135 of those have a README over 400 bytes. Feature counts below are **README keyword matches, not code audits**, and forks/duplicate team repos were not de-duplicated. Treat them as order-of-magnitude. Devpost was not reachable by search; no Devpost counts.

## (a) Capability matrix

Legend: Y = yes (documented), P = partial, N = no/not part of the tool, ND = not documented in sources read, n/a = not applicable.
Columns: Scale (G global / R regional / E EVA-local) | Users | Human EVA planning | Suit physiology/heat | NASA flight rules as hard checks | Explains why | Space weather | Offline/onboard | Crew execution (HUD/visor) | Validation evidence | Source.

### A1. NASA/JPL/USGS map tools

| Tool | Scale | Users | Human EVA planning | Suit phys./heat | Flight rules hard checks | Explains why | Space wx | Offline/onboard | Crew HUD | Validation | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JPL Mars Trek | G, R | Mission planners, science, commercial, public | N (measure, elevation plot, lighting and slope analysis; 3D-print export). Used for human landing-zone site analysis per JPL | N | N | N | N | N (web portal) | N | Mission use for landing-site analysis (JPL news) | https://trek.nasa.gov/mars/jpl/config/textAbout.html ; https://www.jpl.nasa.gov/news/new-online-exploring-tools-bring-nasas-journey-to-mars-to-new-generation/ |
| JPL Moon Trek | G, R | As Trek | P (planned): NASA text says new tools "will facilitate finding optimal traverse paths based on constraints such as slope, lighting, hazard avoidance, and communications"; status of that roadmap UNVERIFIED | ND | ND | ND | ND | N | N | ND | via search summary of EPSC 2017/2018 abstracts: https://meetingorganizer.copernicus.org/EPSC2018/EPSC2018-544.pdf (not opened by me) |
| MMGIS (NASA-AMMOS, Apache 2.0) | R, E | Mission ops GIS. Use by MSL/M2020 ops is UNVERIFIED (docs page names no mission) | N built in. Has Sightline, Viewshed, Isochrone, Measure tools; no traverse planner documented | N | N | N | N | Self-hostable via Docker; offline operation ND | N | Operational heritage claimed by project, ND on page | https://nasa-ammos.github.io/MMGIS/ ; https://github.com/NASA-AMMOS/MMGIS |
| USGS-NASA Planetary Geologic Mapping | G, R (e.g. 1:60,000 Gale Mt Sharp) | Scientists, site selection | N (geologic units, context). A Gale landing-ellipse map guided Curiosity's first traverse | N | N | n/a | N | Static products | N | Peer-reviewed cartographic review | https://www.usgs.gov/news/new-global-geologic-map-mars ; https://gsa.confex.com/gsa/2016AM/webprogram/Paper287163.html |
| NASA Worldview / GIBS | G (Earth only) | Earth-science public, wildfire/air/flood users | N (Earth, no relevance beyond UI pattern) | N | N | N | N | N | N | n/a | https://www.earthdata.nasa.gov/technology/global-imagery-browse-services-gibs |
| JMARS (ASU) | G, R | Scientists | ND (lists THEMIS among layers; no EVA planner found) | ND | ND | ND | ND | Desktop app; offline ND | N | ND | https://jmars.mars.asu.edu/index.php |

### A2. NASA EVA planning and informatics tools

| Tool | Scale | Users | Human EVA planning | Suit phys./heat | Flight rules hard checks | Explains why | Space wx | Offline/onboard | Crew HUD | Validation | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AEGIS (Artemis EVA GIS, JSC EMSS) | R, E (Moon) | Artemis flight controllers (backroom/MCC) | Y: "Estimated EVA times; traverse coverage of scientific goals; comparing path plans" | ND (no suit physiology listed) | ND (no rule checker listed; "Rules-based actions" and "Science Traceability Matrix" appear in UI screenshot labels) | P (science traceability matrix) | ND | N: ground tool; "Next Evolution: Extending EMSS capabilities directly to in-space assets" | N | Evolved from JETT3 (fall 2022) into "prime surface mission planning tool" for Artemis EVA in 3 yrs; JETT5, Artemis III mini-sim | https://ntrs.nasa.gov/api/citations/20260001895/downloads/IEEEAeroConfPresentation_LeAP%20-%20STRIVES.pdf ; https://ntrs.nasa.gov/api/citations/20260001893/downloads/IEEE_2026_EMSS_Paper.pdf |
| Maestro + CODA (EMSS siblings) | E (procedures, data replay) | MCC, IV crew | Procedures only | N | Enforces task dependencies across agents | N | N | Ground | N | Flown on ISS EVA (Nov-Dec 2022 first digital EVA procedure) | https://ntrs.nasa.gov/api/citations/20230000186/downloads/MMILLER_LPSC2023_AIST_DataandSoftware_Final.pdf |
| xGDS / Playbook / SEXTANT = "Minerva" (BASALT, Mars analog) | R, E | Analog science team, IV crew, EV crew | Y (traverse editor in xGDS, schedule in Playbook, path optimisation in SEXTANT) | P (SEXTANT metabolic mode) | ND | ND | N | Ground-support software; Playbook models data-transmission delay | Wrist-mounted Playbook Mission Log | "Supported for analog testing only" (NASA review table) | https://ntrs.nasa.gov/api/citations/20250011652/downloads/IEEE-aero-lit-review-EVA-informatics_final.pdf ; https://ntrs.nasa.gov/api/citations/20170002363/downloads/20170002363.pdf |
| MIT SEXTANT (Johnson 2010 thesis) / PATH | R, E (lunar south pole) | Engineers, astronauts, IV crew | Y: best path between Activity Points by distance, time or energy; walk-back from any point on the traverse | Y: metabolic energy; thermal load from sun/shadow along path; rover power | ND (no rule set) | ND | N | MATLAB; field iPad use evaluated | P (via NASA Ames iMAS guidance) | MDRS field study: actual traverse time and explorer energy exceeded SEXTANT predictions (n=6, p<0.01 for time; energy n=5, p<0.01 per abstract snippet) | https://dspace.mit.edu/handle/1721.1/59560 ; https://dspace.mit.edu/handle/1721.1/81410 |
| ESA Electronic Field Book (CAVES, PANGAEA) | E | EV/IV crew, ground | Y (waypoint traverse, EV position overlay) | N | N | N | N | Field-deployed | P (display) | Analog testing | NTRS 20250011652 (above) |
| Joint AR (NASA JSC, near-eye suit AR) | E | EV crew, with ground | P (navigation displays: GPS/IMU, camera/IMU, LiDAR, static maps) | P (consumables display envisaged) | ND | ND | ND | Onboard by design | Y (prototype) | JETT5 Advanced Artemis Runs, SF Volcanic Field 2024 | https://ntrs.nasa.gov/api/citations/20220013671/downloads/Joint_AR_AIAA_ASCEND_Manuscript.pdf ; https://astrobiology.com/2024/06/09/tricorder-tech-artemis-away-team-field-test/ |
| AxEMU / xEMU suit HUD | E | Artemis crew | P (suit status, checklists, navigation cues; final spec UNVERIFIED) | Suit telemetry | ND | ND | ND | Onboard | Y (planned) | Not flown on surface; detail UNVERIFIED | https://payloadspace.com/axiom-reveals-its-axemu-lunar-spacesuits/ |
| NEREUS (UC Irvine, SpaceCHI 2025) | E (Moon) | Mission-control operators | Y: reroute crews; A* with risk penalty; shortest/safest/balanced routes | N: "no dedicated physiological model" (energy/oxygen enter a Probability of Return model) | N | P | N | Ground | N (HMD planned future work) | 9 expert interviews, 4 usability tests | https://drops.dagstuhl.de/storage/01oasics/oasics-vol130-spacechi2025/html/OASIcs.SpaceCHI.2025.25/OASIcs.SpaceCHI.2025.25.html |

### A3. Academic planners and optimisers

| Tool | Scale | Users | Human EVA planning | Suit phys./heat | Flight rules hard checks | Explains why | Space wx | Offline/onboard | Crew HUD | Validation | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MoonPath (Peña-Asensio et al., Acta Astronautica 214, 2024) | R (Artemis III candidate region) | Mission planners, science | Y: Monte Carlo + Dijkstra minimising metabolic workload; round trip, <=2 km radius; slopes <20 deg per press coverage; 521 PSRs mapped | Y metabolic (model details UNVERIFIED; paper not opened); no heat, no comm | P (2 km, slope limits as constraints; not framed as flight rules) | N | N | Offline batch Python pipeline | N | Published; case study on 3 landing sites | https://phys.org/news/2023-10-lunar-astronauts-easy-trails-moon.html ; DOI 10.1016/j.actaastro.2023.10.010 |
| Broddrick et al. LPSC 2024 (NASA, MILP science yield) | E | Science Evaluation Room to Flight Control Team | Y: MILP maximising weighted "Science Yield" under time/speed constraints; mid-EVA replan <1 min | N | N (constraints: start/end at lander, duration, fixed 0.5 m/s speed) | P (rationale must be provided to FCT) | N | Ground | N | "has not yet been validated" (proof of concept: 3 objectives, 4 stations, 4 actions) | https://ntrs.nasa.gov/citations/20240000165 |
| NASA Artemis Geospatial Data Team (least-cost path) | R | Artemis planners | Y: "Basic and advanced least cost path traverse planning" with slope, boulders | Cost can be "energy expended" | ND | ND | N | Ground | N | Operational use in Artemis planning | https://ntrs.nasa.gov/api/citations/20230006633/downloads/Artemis%20Geospatial%20Data%20Team%20Capabilities%20-%20Strives%20(final).pdf |

### A4. Rover planners

| Tool | Scale | Users | Human EVA planning | Suit phys./heat | Flight rules hard checks | Explains why | Space wx | Offline/onboard | Crew HUD | Validation | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Field D* (CMU, flown on MER) | E (rover) | Rover ops | N | N | N | N | N | Onboard (20 MHz RAD6K) | n/a | Flight: 5 autonomous Opportunity runs; "at least as good as GESTALT alone and often better" | https://www.ri.cmu.edu/publications/field-d-an-interpolation-based-path-planner-and-replanner ; https://ntrs.nasa.gov/citations/20100010963 |
| ENav (Perseverance) | E (rover) | Rover | N | N | Hazard clearance (ACE) as safety check on ranked paths | N | N | Onboard | n/a | Flight heritage | https://arxiv.org/pdf/2011.06022 |
| MLNav (JPL, RA-L 2022) | E (rover) | Rover | N | N | Keeps model-based safety checker on top-ranked paths | N | N | Onboard (research) | n/a | Sim on real Perseverance terrain; about 10x fewer collision checks than ENav | https://arxiv.org/abs/2203.04563 |
| Perseverance AI-planned drives (Dec 2025, announced Jan 2026) | R/E (rover) | JPL Rover Ops | N | N | Digital-twin verification before upload (500,000+ telemetry variables, per NASA-derived coverage) | N | N | n/a | n/a | Flown, 210 m and 246 m drives | https://www.nasa.gov/centers-and-facilities/jpl/nasas-perseverance-rover-completes-first-ai-planned-drive-on-mars/ |

### A5. Commercial / other

| Tool | Scale | Users | Human EVA planning | Suit phys./heat | Flight rules | Explains why | Space wx | Offline/onboard | Crew HUD | Validation | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Cesium Mars (Cesium ion 3D Tiles) | G | Developers, visualisation | N | N | N | N | N | Self-hosted option exists | N | n/a. 232 m Viking mosaic + 200 m MOLA/HRSC DEM; HiRISE not confirmed | https://cesium.com/platform/cesium-ion/content/cesium-mars/ |
| Google Mars (legacy, in Google Earth) | G | Public | N | N | N | N | N | Earth Pro desktop support ends 2027-06-25 (per Android Authority, Jul 2026) | N | n/a | https://maps.googleblog.com/2009/02/google-earth-goes-to-mars.html |

### A6. Space Apps 2026 competitors (GitHub, README keyword counts, n = 135 repos with a README)

| Feature mentioned in README | Repos | Notes |
|---|---|---|
| Route / traverse / path | 122 | Nearly universal |
| Slope | 103 | |
| HiRISE | 85 | |
| Jezero | 85 | 54 mention Jezero but not Gale |
| Curiosity / Gale | 72 / 66 | |
| A* or Dijkstra | 81 | The default routing method |
| Space weather / radiation (generic) | 73 | |
| Comm / line of sight | 70 | |
| Mars Trek | 68 | Mostly as tile source |
| AI / LLM | 65 | Usually an explain-only assistant |
| THEMIS | 61 | |
| Suit heat / thermal (broad term, includes THEMIS "thermal") | 56 | Suit-specific heat terms (cooling water, heat balance): 4 |
| Visor / HUD / AR | 53 | |
| Offline / PWA | 42 | |
| Oxygen / consumables | 59 | |
| GO / NO-GO verdict | 27 | |
| Metabolic | 25 | Pandolf or Santee named in 10 |
| DONKI named | 20 | |
| Walk-back | 21 | |
| "flight rule" mentioned | 6 | 5 of 6 say their limits are "not flight rules" (AstralAtlas, Magurin, curry06240624, lordfire4455, varunmk28). ertan123456 labels a layer "against EVA flight rules", implementation unchecked |
| Digitally signed route / device push | 0 | One false hit on "signed"; no repo found with signed route payloads |
| Exact optimisation of science-stop order | about 2 | Magurin "exact search"; TimurK07 tests route search against exhaustive search |

Standouts (all README claims, not audited):
- **Magurin/marswalk-planner** (Jezero, React/Leaflet/three.js, live demo): the closest to us on features. A* on a 20 m grid; go/caution/no-go across slope, endurance, daylight, oxygen, walk-back, comms, shadow, temperature, ground, radiation; exact-search auto planner for science stops; reach map; best start time; 1 m HiRISE sharpening and THEMIS loose-ground. Its README says "Every number in it is an editable assumption, not a flight rule." Tiles come live from Mars Trek (needs internet). https://github.com/Magurin/marswalk-planner.
- **ertan123456/marswalk** (Gale, lower Mount Sharp, 6.77 x 14.62 km DTM strip): walk-back as the core check, multi-source Dijkstra from safe havens, REAL/DERIVED/MODELED provenance tags per layer, first-person helmet HUD, AI explains but "does not compute". https://github.com/ertan123456/marswalk
- **RISHI-1453/NASA_Space-Apps_Challenge_Martian_Map** (Code Huzzlers): widest layer set (Viking, CTX, HiRISE, THEMIS, TES, CRISM, OMEGA, MOLA, HRSC, USGS geology, Curiosity RAD, DONKI, NOAA GOES); Pandolf effort; buddy-pair O2, CO2, cooling water, battery; visor HUD; cuff checklist. Deployed on Cloud Run (online). https://github.com/RISHI-1453/NASA_Space-Apps_Challenge_Martian_Map
- **ortiz10m/nexo-code-nass** (NEXO-ARES): "white-box" Pandolf + Langmuir equations, 30% O2 reserve, dual cloud/offline-in-browser engine, AR helmet visor, DONKI.
- **ScopeMint/marswalk** (Gale boxwork, "installable, offline EVA planner") and **shivenlak/MarsWalker** (Gale, 1 m HiRISE DTM, 39 MB committed data, runs offline, 3D game-style walk): both Gale + offline.
- Pattern: the field converges on "A* on slope, layers from Mars Trek, GO/NO-GO, O2 gauge, AI explainer, 3D/HUD view." Differences are polish and rigor of constraints, not architecture.

Sources for A6: GitHub search API results and READMEs, e.g. https://github.com/AhsanulHoque22/Nasa-Space-Apps-Challenge-2026-Team-Protikriti , https://github.com/leo-noble/RedStep , https://github.com/pollob-kumar/nasa-space-apps-martian-map . A DEV Community entry (AstroMind/MarswalkAI, https://dev.to/walsal201/astromind-4ji4, posted Nov 9) quotes the challenge brief: "a layered, integrated view of a location or route on the Martian surface ... could help a human explorer plan and carry out a successful Marswalk". It uses MOLA/HiRISE/CRISM/THEMIS/MCS layers and an AI route plan; no repo link, claims unverified.

## (b) Gaps in current approaches

1. **EVA tooling is built for ISS and the Moon, not Mars surface.** "Despite over five decades of EVA experience, operational focus has remained almost exclusively on microgravity rather than planetary surface operations" and "Shifting from lunar 'proving ground' to heavy communication latency on Mars, tool development must align with specific jobs to be done." NASA JSC review slides 17, https://ntrs.nasa.gov/api/citations/20260001895/downloads/IEEEAeroConfPresentation_LeAP%20-%20STRIVES.pdf
2. **Physiology is not yet coupled to traverse planning.** "Future work may integrate real-time EV data (e.g., suit consumables, physiological performance) with traverse planning" (same deck, slide 14). The IEEE paper adds that "modeling challenges were experienced with crew metabolic rate expenditures and consumables usage during the Apollo EVAs, with astronauts frequently exceeding the rates predicted prior to mission execution." https://ntrs.nasa.gov/api/citations/20250011652/downloads/IEEE-aero-lit-review-EVA-informatics_final.pdf
3. **Metabolic path models under-predict in the field.** SEXTANT's MDRS evaluation found actual traverse time and explorer energy higher than predicted (abstract via search; full paper not opened). https://dspace.mit.edu/handle/1721.1/81410
4. **Single-criterion planning and unvalidated science optimisation.** "Future tools should look to incorporate multiple criteria in path optimization efforts" (IEEE paper, NTRS 20250011652). Broddrick et al.: traverse rate fixed at 0.5 m/s, sample mass and illumination "will be added in the future", and use in analogs "will provide needed validation." https://ntrs.nasa.gov/api/citations/20240000165/downloads/Broddrick_LPSC_24_abstract.pdf
5. **No public evidence of flight rules as hard, machine-checked constraints with a re-verification step.** AEGIS publicly lists time estimates, coverage and plan comparison only; MoonPath encodes 2 km and slope limits as terrain constraints; Broddrick's model has duration/speed only. NASA itself notes "only commercial and open-source GIS software tools were available for EVA operations. However, these tools lack the mission specific capabilities" (Jan 2023). https://ntrs.nasa.gov/api/citations/20230000186/downloads/MMILLER_LPSC2023_AIST_DataandSoftware_Final.pdf (This is an absence-of-evidence gap; AEGIS internals are not public and may check rules.)
6. **Operational planners are ground/backroom tools; crew-side execution is immature.** EMSS: "Current State: Empowering ground-based flight controllers"; "Next Evolution: Extending EMSS capabilities directly to in-space assets." https://ntrs.nasa.gov/api/citations/20260001893/downloads/IEEE_2026_EMSS_Paper.pdf ; Joint AR authors: "a seamless suit-integrated AR solution does not yet exist." https://ntrs.nasa.gov/api/citations/20220013671/downloads/Joint_AR_AIAA_ASCEND_Manuscript.pdf
7. **Helmet display is an open hardware problem and wrist displays stalled.** "Various implementation challenges still exist for on- or in-suit visual aids, such as enabling registered HUD displays, particularly surrounding optical projection, radiation tolerance, and bandwidth limitations"; wrist-display "enhancements stalled." NTRS 20250011652. Software-only visor guidance sidesteps optics but is not what NASA is building.
8. **Earth-independence under latency is the stated driver but tools assume ground support.** The review notes "Communication delays will decrease assistive capabilities and influence of ground support" (slide 5) and Broddrick's tool exists to support a Houston science backroom. Nothing found documents an onboard planner that keeps guiding when a link is lost.
9. **Explainability and usability are under-evaluated.** "an explicit lack of emphasis placed on evaluating the usability of the proposed tools" (NTRS 20250011652); PATH studies found automation improved performance but "decrease in operator situation awareness, suggesting user complacency"; NEREUS testers found the interface demanded "considerable mental effort". Same sources plus https://drops.dagstuhl.de/storage/01oasics/oasics-vol130-spacechi2025/html/OASIcs.SpaceCHI.2025.25/OASIcs.SpaceCHI.2025.25.html
10. **General Mars portals are viewers, not planners.** Mars Trek lists measuring, elevation plotting, lighting and slope analysis; no EVA budget or rules. Moon Trek's traverse tooling with comm and lighting constraints is described as upcoming. https://trek.nasa.gov/mars/jpl/config/textAbout.html
11. **Hackathon peers disclaim rule fidelity.** 5 of 6 repos that mention flight rules say their limits are "planning assumptions ... not flight rules" (e.g. https://github.com/curry06240624-dev/red-route).

## (c) Where Marswalk is genuinely different

Marswalk facts below come from the product brief given to me, not from inspecting the code.

**Probably new (not found in anything I read):**
- Combining, in one offline stack: Mars-gravity suited energy model, suit heat budget, 12 hard-coded flight-rule constraints (slope, walk-back at contingency speed, time-to-shelter, comm LOS gaps, daylight, range, keep-outs), exact science-stop optimisation, and an independent simulator that re-verifies every rule on the produced plan. No tool in A2/A3 documents all of these; hackathon peers cover subsets (Magurin: walk-back + comms + exact search; RISHI: Pandolf + buddy consumables + DONKI).
- Binding-constraint explanation, drop reasons, and "ways forward" on NO-GO. NASA literature calls for explainability (gap 9); peers mostly give a verdict plus an LLM narrator (ertan123456 explicitly "explains; does not compute", the same philosophy).
- Signed ~11 KB route pushed to a visor over a local link, with autonomous guidance on link loss. Zero repos in the sample have signed route payloads. NASA's crew-side work (Joint AR, AxEMU HUD) is hardware- and integration-bound; a software visor with a verified-route handoff is a different cut.
- Gale-specific stack: 1 m HiRISE DTM + colour, THEMIS thermal inertia, Curiosity traverse/photos/REMS, CCMC DONKI for Mars. Peers use pieces; 66 of 135 touch Gale, but few combine a 1 m DTM, REMS and DONKI offline (ertan123456, shivenlak, ScopeMint are the nearest).

**Re-uses known methods (say so in the pitch):**
- Least-cost-path/Dijkstra/A* over a slope grid: MoonPath, SEXTANT, Artemis Geospatial team all do it. Walk-back from any traverse point and a thermal load model were already in SEXTANT (2010). Metabolic-cost-driven routing is MoonPath's premise. MILP/exact science-yield optimisation follows Broddrick et al.
- Pandolf-Santee is a 1977-era load-carriage equation, same family used by competitors (about 10 name Pandolf or Santee). Its validity at Mars gravity with a pressurised suit is **UNVERIFIED** here; SEXTANT's field evaluation under-predicted energy and time, which is a warning for us too.
- Field-style rover planners (Field D*, ENav, MLNav) are a different problem: they optimise hazard clearance for a machine with no consumables or physiology. They transfer as graph-search machinery only; ENav/MLNav's pattern of ranking candidate paths and then running a model-based safety checker is analogous to our plan-then-re-verify design, and JPL's digital-twin check on the AI-planned drives is the same philosophy. (Interpretation, not a quoted claim.)

**Where existing tools are better than ours:**
- **AEGIS/EMSS**: real operational users, multi-user flight-control workflow, procedures (Maestro), data replay (CODA), validated across JETT3-5 and Artemis sims, ISS flight heritage. Marswalk is single-site and unvalidated against astronauts.
- **SEXTANT**: field-tested with human subjects at MDRS (we have no human-subject or analog validation; our simulator checks internal consistency of rules, not truth).
- **MMGIS / Mars Trek**: global data breadth, tiling, multi-user authoring, operational heritage. We cover one crater.
- **Joint AR / AxEMU**: real suit-integrated optics, safety-critical architecture, JETT5 field runs. Our visor is software on commodity hardware.
- **Rover planners**: flight-proven onboard autonomy (MER, Perseverance).
- **Peers like RISHI-1453**: broader layer catalogue, buddy-pair consumables, deployed live.

**Caveats to state if asked:**
- "NASA flight rules": I found no public Mars EVA flight-rule set. The public numbers I can source are 2 km radius and 20 deg slope (MoonPath/Artemis coverage). Each of the 12 rules should carry a citation or be labelled "NASA-derived constraints" in the deck; this is a defensibility risk. (Whether each of the 12 has a published source is UNVERIFIED.)
- Space weather for Mars: CCMC DONKI forecasts exist for Mars via modelled CME arrival; whether DONKI-for-Mars forecast skill is validated at the surface is UNVERIFIED here.
- Competitor counts are keyword matches on 135 READMEs on day one of the event.
