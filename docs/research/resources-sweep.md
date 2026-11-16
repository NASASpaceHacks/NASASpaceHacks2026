# Resources-tab sweep (2026-11-15)

> **Lead's note (2026-11-15):** this sweep compared against `nasa-data-audit.md`, which predates three additions already shipped: the CRISM spectral layer (gale-v1), measured MSL RAD dose comparison (`Validation/v5_rad_dose/`), and the REMS/MEDA surface-weather block. Ranks 1–3 below are therefore done; rank 5 (rock/boulder hazard) remains open. See `docs/CRITERIA_ANSWERS.md`.


Method: fetched the challenge page with curl. `WebFetch` failed on spaceappschallenge.org ("unable to get local issuer certificate"). The page is client-rendered, so I parsed the Next.js payload embedded in the HTML. The Resources tab text is the `resourcesTabContent` field. Other URLs were checked with HTTP requests on 2026-11-15 and are marked "checked" (HTTP status or content seen). Anything I did not open is marked **unverified**.

Challenge page: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/ (last published 2026-11-13 according to the page payload). The tab says "More resources may be added before the hackathon begins", so re-check it.

## 1. Everything on the Resources tab (from the page, 5 items)

| # | Name (as on page) | URL | Used by us? |
|---|---|---|---|
| 1 | JPL Mars Trek | https://trek.nasa.gov/mars/ | **Partly.** Viking MDIM tiles from `trek.nasa.gov/tiles/Mars/EQ/...` feed the locator (audit Part A). We use no other Trek layer. |
| 2 | USGS-NASA Planetary Geologic Mapping Program ("High-quality standardized geologic map of Mars") | https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars | **No.** We use the USGS Astrogeology Gale DEM, but not the geologic-map hub. |
| 3 | Curiosity route map example ("Curiosity's proposed path up Mount Sharp") | https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/ | **No** (an animation and video, not data). Useful as a judge-facing precedent and for science-target names. |
| 4 | NASA Worldview | https://worldview.earthdata.nasa.gov/ | **No, and not applicable.** Earth imagery, nothing for Mars. |
| 5 | Mars Perseverance Raw Images Gallery | https://mars.nasa.gov/mars2020/multimedia/raw-images/ | **Yes** (Jezero Mastcam-Z/Navcam raw images for POV, audit Part A). |

**Count: 5 resources. We use 2 (1 fully, 1 partly).** The challenge text also names the data kinds (optical, thermal, spectral, topographic, geophysical, atmospheric, radiation, chemical), POV imagery, space weather, "updates on current conditions", and avoiding "large rock formations". These drive the ranking below.

## 2. Resources we do not use (tab items and found elsewhere)

Source label: **page** = on the Resources tab; **elsewhere** = found by me.
"Covers" is Gale / Jezero at 5 m grid usefulness. Effort is for a Python GDAL pipeline.

| Resource | Source | What it is | Improves | Access | Covers | Effort |
|---|---|---|---|---|---|---|
| USGS-NASA Planetary Geologic Mapping hub (https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) | page | Vector geologic unit maps | Science value (unit labels at stations), context | ArcGIS hub; download format per map **unverified** | The global Mars map is regional scale. I found no confirmed published Gale-wide USGS map. A search showed only a 2023 abstract of a 1:60,000 western Mount Sharp map "to be submitted" (https://gsa.confex.com/gsa/2023AM/webprogram/Paper394643.html) and a 2016 refined lower Mount Sharp map (https://pmc.ncbi.nlm.nih.gov/articles/PMC5101845). Jezero: **unverified**. | M (if a GIS file exists), otherwise L |
| Mars Trek WMTS layers (catalog https://api.nasa.gov/mars-wmts/catalog, docs https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) | page | OGC RESTful WMTS tiles; I confirmed the Viking GetCapabilities XML returns 200. | Display/context only. I could not confirm which analysis layers (slope, rock) are exposed as tiles; the catalog request timed out. | Tile API, no key found needed for tiles (checked for Viking only). Licence **unverified**. | Global tiles, mostly coarser than our 5 m grid. | S |
| CRISM MTRDR mineral/parameter maps, ~18-20 m (PDS4 bundle https://pds.nasa.gov/data/pds4/releases/geo/mro_crism_mtrdr-20250413/readme.txt; product primer https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Mars%20Reconnaissance%20Orbiter/CRISM/CRISM%20Product%20Primer/CRISM%20MTRDR.htm) | elsewhere | Map-projected targeted spectral cubes and derived parameter browse products (spectral/mineralogy). The bundle readme was checked. | **Science value** (station ranking by sulfate/clay/hematite signal), fills the missing "spectral" and "chemical" kinds. | PDS download, no key. Search via ODE (below). Per-tile size **unverified** (cubes are 32-bit, browse products are 8-bit per the PDS handout https://pds-geosciences-test.wustl.edu/workshops/CRISM_Workshop_Mar12_presentations/RetrievingDataProducts.pdf). PDS data are public. | Gale: audit says the AOI is on boxwork (sulfate-bearing). Tile coverage of our exact AOI **unverified**. Jezero: **unverified**. 18-20 m gives about 4 pixels per 5 m cell edge, so state it is upsampled and indicative. | M |
| PDS Geosciences Orbital Data Explorer REST API (https://oderest.rsl.wustl.edu/, UI https://ode.rsl.wustl.edu/mars/) | elsewhere | JSON/XML search by lat/lon bounding box across PDS Mars products, with download URLs. Checked: page loads and lists bounding-box and product-metadata queries. | Pipeline access path for CRISM, HiRISE, CTX and others. | REST, no key seen | Both sites | S (it is a finder, not data) |
| MSL RAD dose-rate archive (https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/AAREADME.TXT) | elsewhere | Measured radiation (ASCII RDR with PDS3 labels). Checked: the DATA directory lists sol blocks up to `SOL_04710_04843`. | **Safety**: calibrate or replace the dose-vs-pressure model (`radiation.ts`, audit headline 2). Gives a measured dose-rate range for the Gale stay, and SEP/Forbush events. | File download, no key. Size **unverified**. Public PDS. | Gale only (Curiosity). Point measurement, not a map. Archive runs to sol 4843 (about March 2026 by my sol-date arithmetic from REMS sol 4995 = 2026-08-25). | S to M |
| Perseverance MEDA via PDS Atmospheres (nmsu path I tried returned 404; correct URL **unverified**) | elsewhere | Jezero weather record. | Current conditions and pressure input at Jezero. | PDS download | Jezero only | M |
| MSL REMS archive, PDS Atmospheres (https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html) | elsewhere | Full-resolution REMS: wind, pressure, humidity, air and ground temperature, UV. Checked: certified through sol 4488 (22 Mar 2025), "ongoing". | Pressure input for dose, thermal/suit-heat constants from real diurnal cycles, UV. | PDS download | Gale only | S to M |
| NASA Mars Explorer App / Planetary Spectrum Generator (https://psg.gsfc.nasa.gov/apps/mars/) | elsewhere | Goddard model-based current and forecast Mars conditions for a chosen place and time: temperature, wind, pressure, dust and ice opacity, visibility, UV risk, sunrise/sunset. The page says it is in development and "should be only used for testing purposes" (checked). | Current-conditions forecast, dust, visibility. | I found no API on the page. `psg.gsfc.nasa.gov/help.php` returned only 127 bytes. An API **unverified**. | Any location on Mars. Modelled, not measured. | S as a link-out, L if an API exists and we integrate |
| MAVEN SEP (via PDS PPI search https://pds-ppi.igpp.ucla.edu/search/?sc=MAVEN&i=SEP) | elsewhere | Solar energetic particle measurements near Mars. The search page loads. Dataset IDs and latency **unverified**. | Space-weather ground truth for events DONKI forecasts. | PDS download | Mars-wide, not site-specific | M |
| NOAA SWPC GOES X-ray JSON (https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json) | elsewhere | Live Earth-orbit solar flare flux (HTTP 200 checked). NOAA, not NASA. | Flare nowcast. It is a view from Earth's direction, so it does not describe Mars exposure directly. | Free JSON | Not site-specific | S |
| HiRISE DTM catalog (https://www.uahirise.org/dtm/) | elsewhere | HiRISE stereo terrain models (page lists releases up to 3 Nov 2026). | Duplicate of the DEM we use (Gale). Jezero already uses the HiRISE TRN DTM. | Public domain per https://hirise.lpl.arizona.edu/ESP_073912_1985 search result (**unverified** beyond the search summary) | Both | S, no gain |
| MARCI / MSSS Mars weather (https://www.msss.com/msss_images/) | elsewhere | Daily global weather maps and weekly reports from the MRO MARCI camera (https://www.jpl.nasa.gov/images/pia11418-mro-marci-weather-report-for-the-week-of-3-november-2008-9-november-2008/ describes the product). The MSSS index I fetched lists releases only through February 2026, so I could not confirm a live feed. | Regional dust/storm awareness (narrative). | Web images, no API found | Global | M |
| NAIF SPICE (https://naif.jpl.nasa.gov/naif/data.html) | elsewhere | Planetary ephemeris kernels. Page loads. | Earth-Mars comms light-time, exact sun. | File download | Global | M |
| Mars Climate Database (https://www-mars.lmd.jussieu.fr/mars/access.html) | elsewhere | LMD (not NASA) climate model. Audit notes "moderate use" web access. | Atmospheric model | Web | Global | M |

Rock hazard data: the challenge asks to avoid "large rock formations". I could not confirm a rock-abundance or boulder-map product at our scale. A search found only the Viking-era 60 km rock map (https://www.mars.asu.edu/data/irtm_rocks) and TES products, both far too coarse. Treat any rock layer as **unverified**.

## 3. Current conditions: what is live and what is an archive

| Source | Status on 2026-11-15 (what I checked) | Live? |
|---|---|---|
| DONKI CME API (`https://api.nasa.gov/DONKI/CME?...`, key DEMO_KEY) | Returned 39 events for 1-14 Nov 2026, newest start time 2026-11-14T22:15Z. | **Live** (Earth-observed CMEs, with Mars arrival modelling from CME analyses in the records we already ingest) |
| DONKI SEP | Returned an empty list for 1 Oct to 14 Nov 2026. | Live, no events in that window |
| NOAA SWPC GOES X-ray JSON | HTTP 200. | **Live**, Earth-orbit |
| REMS outreach feed (`mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json`) | HTTP 200. Newest record is sol 4995, 2026-08-25, about 82 days old. | **Stale** (near-archive) |
| MEDA outreach feed (`...category=mars2020...`) | HTTP 200 but only 7 records, 21-27 Apr 2024 (sols 1127-1133). | **Stale archive**. Audit says our Jezero pack holds MEDA data; do not call it live. |
| MSL RAD PDS | Last data directory SOL_04710_04843. | Archive with months of lag |
| PDS REMS (nmsu) | Certified through sol 4488. | Archive |
| Mars Explorer App (PSG) | Model forecast, not measurement, no documented API. | Live model, unverified API |
| MARCI/MSSS | Index shows releases through Feb 2026 only. | Not confirmed live |
| Space Apps raw images for Perseverance | Gallery URL loads. A live JSON feed I tried (`feed=raw_images`) did not respond. | **Unverified** |

Takeaway for the pitch: DONKI is the only NASA source I confirmed as truly live. Mars surface weather is near-archive, so label it "latest available" with its date.

## 4. Top 5 additions, ranked by (astronaut usefulness + judge value) / effort

| Rank | Addition | Why | Effort |
|---|---|---|---|
| 1 | **CRISM MTRDR parameter raster** for Gale (and Jezero if tiles exist), found via ODE REST | Only way to cover the "spectral" and "chemical" data kinds the challenge lists. Replaces the heuristic station science value with data. Audit already ranks it first. Caveats: 18-20 m native, tile coverage unverified. | M |
| 2 | **Measured MSL RAD dose rate** (PDS PPI) to check `radiation.ts` against real data | Turns "literature model, Indicative" into a measured comparison. Strong safety story for judges. Only Gale. | S to M |
| 3 | **Surface-conditions panel from data we already hold, plus REMS/PDS pressure and UV, with dates** | Fixes audit headlines 4 and 5 (REMS shown only as Ls, MEDA labelled REMS). Add honest staleness badges from section 3. A link-out to the NASA Mars Explorer App adds a model forecast with near-zero effort. | S |
| 4 | **Expand DONKI use** (CME and SEP queries, live) and show an Earth-side flare nowcast from NOAA SWPC | The only truly live feed, and the challenge names space weather. Judge value is high. NOAA is not NASA, and it views from Earth, so label it clearly. | S |
| 5 | **Rock/boulder hazard layer derived from the HiRISE ortho and DEM we already ship** | Not a new dataset. The challenge asks to avoid "large rock formations", and audit headline 7 says roughness does not enter cost or blocking. This needs no new download. | M |

Not ranked: a geologic-unit overlay would add judge value because it is on the Resources tab. Skip it unless a Gale or Jezero GIS file is confirmed.

## 5. Not worth adding

| Resource | Why not |
|---|---|
| NASA Worldview | Earth imagery. Nothing for Mars. |
| Curiosity route-map animation | Not data. Use as a reference in the pitch only. |
| HiRISE DTM catalog | Duplicates the DEM we use at both sites. |
| Mars Trek WMTS tiles for analysis | Global scale, coarser than our grid, and I could not confirm useful analysis layers. Fine for context only. |
| Viking-era and TES rock-abundance maps | 60 km class, wrong scale for 5 m cells. |
| MARCI/MSSS weather | Global weather images, not a 5 km product, and liveness unconfirmed. |
| Mars Climate Database | Not NASA, and licence limits use. |
| NAIF SPICE | Our Mars24 sun is within about 0.01 degree already (audit). Light-time is a nice extra, not a decision input. |
| MAVEN SEP | Adds a second space-weather source, but the integration is heavier than DONKI and it is not site-specific. |
| Perseverance MEDA via PDS | Jezero is the second site and the MEDA feed we hold is stale. Revisit only if Jezero gets more attention. |
