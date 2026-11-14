# Mars data availability and feasibility

Checked 2026-11-14. New bounded requests, status, headers, timestamps and response samples are in [planning_http_checks.json](evidence/planning_http_checks.json). Historical raster acquisition is independently represented by the [cached crop](../../examples/jezero_dem.json); no full raster or new large crop was downloaded in this audit. No credentials were used. Access success does not establish a reuse license or scientific suitability.

## Variable matrix

Types: **M** measured instrument data; **D** derived from observations; **P** modeled/scenario input; **U** unavailable at needed human-walking scale. Confidence below concerns availability/interpretation, not astronaut safety. Source IDs resolve to access details below.

| Variable | Routing relevance | Data source | Access method | Resolution | Coverage | Availability | Confidence |
|---|---|---|---|---|---|---|---|
| Elevation | Vertical terrain geometry | S1/S2 HiRISE; S3–S5 broader DEMs | GeoTIFF/PDS downloads | 1 m S1; product dependent elsewhere | Local Jezero; global only coarse | D, cached and transport verified | High for S1 |
| Slope / cross-slope / aspect | Grade, balance, exclusions | S1 DEM gradients and route heading | Local derivation | Baseline-dependent, not independent 1 m truth | Valid DEM neighborhoods | D, slope implemented; cross-slope future | High derivability; limits unvalidated |
| Distance / ascent / descent | Length and effort metrics | DEM + Mars frame | Local calculation | Grid-dependent | Prepared region | D, implemented | High within local approximation |
| Surface roughness / steps | Uneven footing | S1 detrended DEM residuals | Plane fit in declared physical window | Metres; sub-pixel relief unresolved | Local DEM support | D, not implemented | Medium proxy; U foot scale |
| Terrain type / dunes / bedrock | Suitability and substrate | S2/S6 imagery; S10 geology; S12 AI4Mars | Ortho download and expert mapping/classification | Sub-metre to many metres | Patchy footprints; AI4Mars ground views | D; no validated aligned layer in repo | Medium mapping, low human response |
| Rocks / cliffs / clearance | Collision/fall avoidance | S1 steps + S2 imagery | Review, masks and buffers | Image/DEM scale | Observed footprints only | D, optional mask interface only | Medium large features; low small hazards |
| Rock abundance | Surface complexity | S2 imagery/S7 thermal proxies | Derived classification/model | Product dependent | Patchy/regional | D/P; no selected numerical layer | Low for walking prediction |
| Boot traction / slip / sinkage / soil strength | Falls and immobilization | No adequate orbital source | Local measurements needed | Foot/contact scale | U across route | U; rover slip models not transferable | High confidence in gap |
| Thermal inertia / albedo | Material/thermal context | S7 THEMIS | Scientific raster downloads | Often 100 m IR products; verify inertia asset | Broad mosaics | D, documentation only | Medium; not traction |
| Air / ground temperature | Thermal operations | S8 MEDA/REMS; S9 MCD | Labeled time series; registered model files | Station/time or coarse model grid | Jezero/Gale history; modeled global | M/P, archives accessible; no live forecast | High archive, low route prediction |
| Pressure / density / wind / humidity | Thermal/dust environment | S8/S9 | Time series / model | Station or coarse grid | Same as above | M/P, not continuous measured maps | Medium |
| Dust opacity / deposition / visibility | Exposure, visibility, maintenance | S8/S9, orbital products via S7 | Archive channels / scenarios | Instrument/time/product dependent | Sparse history or modeled fields | M/P; visibility conversion unvalidated | Low local future conditions |
| Illumination / shadows / Sun angle | Visibility, suit heat | S11 SPICE + DEM horizons | Kernel download/local calculation | DEM and horizon dependent | Kernel validity and terrain extent | D/P, possible but unimplemented | Medium geometry |
| Ionizing radiation | Integrated exposure | S8 RAD, transport model | Archive/paper; asset not selected | Point/time, shielding dependent | Gale observations | M/P; U Jezero spatial dose map | Low route-local dose |
| Communications / blackout | Autonomy and support | S11 relay geometry + antenna/network inputs | Kernels and link-budget model | Time/geometry dependent | Selected relay/mission | D/P; LOS possible, actual service U | Medium geometry, low availability |
| Localization / map uncertainty | Clearance and endpoint confidence | Source lineage; future navigation inputs | Labels/quality masks and mission telemetry | Product/position dependent | Per product/crew | Partial D; no general covariance raster | Medium provenance, low full uncertainty |
| Walking speed / directional penalties | Scenario travel time | Human studies + supplied scenario | Configuration/calibration | Crew/suit/task | No Mars human field coverage | P, demonstration only | Low physiological validity |
| Energy / metabolic demand / fatigue | Endurance and resources | Human analog research + suit model | Calibration, history-dependent model | Person/time/task | Mission-specific | P/U; mechanical ascent work only exists | Low until calibrated |
| Suit mass / joint resistance / footprint | Mobility and clearance | Suit design/mission inputs | Configuration, no orbital API | Crew/suit-specific | Mission-specific | P/U | Unverified mission input |
| O2 / CO2 / cooling water / battery | Independent life-support budgets | Suit telemetry and validated rate models | Mission integration | Time/task | Mission-specific | U in public route-ready layers | High confidence in gap |
| Duration / reserve / dwell / rest | Schedule and return feasibility | User/mission policy | Request/configuration | Seconds | Per mission | P, time/reserve/dwell implemented | High availability, no safe defaults |
| Base / shelter / emergency mobility | Return requirements | User POIs and contingency model | Mission inputs + reverse routing | Point/time | Mission-selected | P; nominal return implemented | High algorithm, low operational validity |
| Scientific value / mineralogy / POIs | Optional target selection | S10 CRISM, geology, experts | Spectral products + curated POIs | Nominal 18/36 m targeted CRISM, product dependent | Patchy | D + policy utility; not implemented | Medium targets, subjective reward |
| Heading / turning effort | Suit maneuvering, cross-slope | Route geometry + human model | Calculation, heading state if optimized | Per transition | Route | D/P; no calibrated turn penalty | Low model confidence |
| Changing hazards / map uncertainty reduction | Replanning/scouting | Future local observations | No verified general service | Sensor-dependent | Observed areas | U for MVP; offline scenario possible | Low operational availability |

## Ranked sources and verified access mechanisms

### S1 — USGS Mars 2020 HiRISE TRN mosaic: first choice

[Dataset DOI](https://doi.org/10.5066/P9REJ9JN), [directory](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/index.html). Exact numeric asset:

```text
https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif
```

GET with `Range: bytes=0-4095` returned **206**, 4,096 bytes, total length **1,839,545,409 bytes**. `.xml` FGDC metadata and `_pds3.lbl` planetary label returned 200. Anonymous; source metadata access/use constraints are “None”; retain USGS credit and product disclaimer. XML extension alone does not imply PDS4.

Float32 GeoTIFF, 21,400 columns × 21,488 rows; 1 m projected posting; spherical equirectangular, standard parallel/central longitude 0°, radius 3,396,190 m, east longitude and planetocentric latitude. Label bounds: 77.222933–77.583964°E, 18.306799–18.669315°N. Elevation follows MOLA topography/DeltaGeoid processing, not Earth sea level or planetary radius. NoData is approximately -3.402822655e38.

Read source labels, preserve scale/offset, mask NoData before derivatives, window by Mars coordinates, and retain provenance/hash. The source is strip-organized, not a tiled COG: 256 rows can involve roughly 22 MB of strip payload despite a small output. Fresh network byte count remains uninstrumented. Cache prepared subsets; do not fetch this source per route request. Pixel spacing is not accuracy or obstacle detectability. This is the only candidate with a real local numeric crop verified by the test suite.

### S2 — Individual HiRISE DTMs and co-registered orthophotos: next input

[Jezero product](https://hirise.lpl.arizona.edu/dtm/ESP_023524_1985), [DTM guidance](https://hirise.lpl.arizona.edu/dtm/about.php), [usage policy](https://www.uahirise.org/media/usage.php). Product page freshly accessible and links `DTEEC_023524_1985_023379_1985_U01` (1 m/pixel, posted 700 MB) plus orthoimages. Local stereo footprints, not continuous planet-wide DTM coverage. PDS IMG elevation and JP2 imagery require label-specific projection/units and decoding; verify source registration before combining with S1. Public imagery policy requests attribution; confirm each derivative's terms. No full IMG/JP2 fetched. The displayed product center is not proof of overlap with the cached crop: use footprints before selecting an ortho. Prefer the S1 mosaic's matching 0.25 m ortho once its exact asset and window-access behavior are checked.

### S3 — USGS Jezero CTX DEM: regional context

[Catalog](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic), exact [20 m TIFF](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif). Fresh HEAD 200, no raster payload inspected. Prior catalog review reports 5,067 × 4,456 Float32 pixels, roughly 76.99–78.58°E and 17.58–19.29°N, with a 5 m companion image. Catalog latitude labels appear reversed and its radius differs from S1. Header/label verification is an ingestion gate, not a settled shared CRS. Anonymous download; retain USGS attribution and inspect asset terms. Resample only after reference alignment; 20 m data cannot resolve pedestrian hazards.

### S4 — HRSC HMC-30: regional context, acquisition blocked here

[DLR GeoTIFF catalog](https://hrscteam.dlr.de/public/data/regionaldtms.php), [FU Berlin portal](https://maps.planet.fu-berlin.de/). Web catalog accessible; Python request failed certificate-chain validation. Do not disable TLS or claim successful numeric access. Regional quadrangles, commonly 50 m DTMs; areoid `da5`, reference-spheroid `dt5`, rendered relief `da5cs` differ. Inspect per-product bounds, CRS, units, NoData and vertical reference. Public catalog shows no key requirement, but exact reuse terms and asset retrieval remain unverified. Cite ESA/DLR/FU Berlin when applicable. Too coarse for footing; defer until a justified larger-region requirement.

### S5 — MOLA MEGDR: global context and control

[Documentation/download index](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) returned 200; it links the maintained [PDS4 bundle](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/). Global products have 4–128 pixels/degree (128 ppd is approximately 463 m at the equator), with finer polar grids. Radius, areoid, topography and counts are distinct products. IMG/XML/HDR and legacy labels describe scale, endianness and cylindrical/polar mapping. Parse labels, select topography, preserve observation counts and sample gaps. Anonymous archive access; use PDS attribution and product notices. Suitable global background, not local walking exclusion. Numeric payload not downloaded here.

### S6 — Mars Trek: visualization, not the elevation pipeline

[API documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) and [tested WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml) returned 200. Parsed capabilities declare image/png, a tile matrix CRS string `urn:ogc:def:crs:EPSG::104905`, and this actual resource template:

```text
https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{TileMatrix}/{TileRow}/{TileCol}
```

This is a MapServer display tile reference, not an ImageServer elevation API. Do not assume the advertised CRS identifier is resolvable as a normal Earth EPSG entry; interpret matrix definitions and Mars projection explicitly. The tested layer is an uncontrolled CTX mosaic advertised at 5 m; use its capabilities extent/zoom definitions. No tile fetch or quantitative pixel decoding was tested. Anonymous capabilities access; retain layer credits and check hosting terms/rate limits before production use. No general route API, WCS or numeric DEM subset endpoint was verified.

### S7 — THEMIS/ASU: material and thermal context

[ASU global products](https://www.mars.asu.edu/data/) freshly readable; [THEMIS portal](https://themis.asu.edu/) and PDS supply observation/product downloads. Broad thermal IR mosaics often have 100 m posting; thermal inertia is a modeled derivative and must be selected explicitly rather than inferred from grayscale. Format, projection, scaling, quality, time and reuse conditions are asset-specific and unverified for ingestion. No credentials used for documentation; no quantitative product downloaded. Derive material context only with appropriate physical interpretation; no boot-traction or metre-scale air-temperature inference.

### S8 — MEDA, REMS and RAD: local historical environment

[MEDA archive](https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/) returned 200 directory HTML; [product guide](https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda_old.html) describes channels. [REMS reduced archive](https://pds-atmospheres.nmsu.edu/PDS/data/mslrem_1001/) and [RAD mission archive entry](https://pds-geosciences.wustl.edu/missions/msl/) are further investigation links; individual REMS/RAD assets were not probed. Calibrated tables, labels and quality flags need time conversion and rover-location association, not raster reprojection alone. Jezero/Gale point histories do not have a global map resolution. Public scientific archives; check product citation/reuse notices, no API key established. MEDA radiative/dust sensors are not RAD ionizing-dose measurements. No future weather guarantee.

### S9 — Mars Climate Database: modeled context, conditional terms

[Access page](https://www-mars.lmd.jussieu.fr/mars/access) returned 200 and currently advertises 6.2. Web interface is for moderate use; full NetCDF data and Fortran access code with Python examples require registration. Scientific use requires credit and informing the authors; commercial use needs specific authorization. No unrestricted production weather REST API was verified. The old repository links a 6.1 manual: do not pair its assumptions silently with a 6.2 installation. Resolve version-specific native grid and redistribution permissions before integration. Global seasonal/diurnal climatology is spatially/temporally interpolated; high-resolution pressure corrections do not create high-resolution weather observations. Defer from MVP.

### S10 — CRISM and geology: scientific targets

[PDS CRISM archive](https://pds-geosciences.wustl.edu/missions/mro/crism.htm) freshly accessible, with product-family links; ODE can discover footprints. Targeted nominal 18/36 m spectroscopy and coarser mapping differ; coverage is patchy. PDS scientific files require geometry, atmospheric/photometric correction and product quality handling; projected and raw observations have different CRS treatment. No selected spectrum/map payload or license notice inspected here; anonymous archive discovery works. Curate targets with scientists; do not assign automatic safety or universal reward from a mineral detection.

### S11 — NAIF SPICE: future geometry

[Kernel availability](https://naif.jpl.nasa.gov/naif/kernelsavailability.html) freshly accessible. Public mission/generic kernels plus local toolkit support body/Sun/spacecraft geometry. Download only required kernel coverage, retain version/time validity and toolkit notices; no account for public holdings. Formats are SPICE kernels, not map rasters. Illumination needs epoch, body frame, normals and surrounding horizon; communications additionally needs relay schedules, antenna/link budgets. No kernel calculation or operational relay service validated in this task.

### S12 — Learning/reconstructed terrain leads: defer

[AI4Mars NASA record](https://data.nasa.gov/dataset/ai4mars-a-dataset-for-terrain-aware-autonomous-driving-on-mars) freshly readable and still says license not specified. Ground-camera labels have no directly usable orbital CRS or uniform Jezero coverage. Archive download/terms must be resolved before training; mirror terms do not settle original terms. [Endo code](https://github.com/omron-sinicx/safe-rover-navi) and [scout code](https://github.com/ethz-asl/scouting-ipp) are research references from the existing audit, not public real-terrain routing APIs. MarsTM-3D's stable release, coverage and licensing remain unverified. No code, pretrained objects or large datasets were fetched.

## Verified discovery APIs

| Service and exact request | Fresh response | Contract and limits |
|---|---|---|
| [PDS](https://pds.nasa.gov/api/search/1/products?limit=1), [documentation](https://nasa-pds.github.io/pds-api/) | 200 JSON, top-level `summary`, `data` | Generic product discovery; this one-result query does not establish a Mars DEM subset operation. Follow returned links and documented pagination |
| [ODE](https://oderest.rsl.wustl.edu/live2/?query=product&target=mars&ihid=mro&iid=hirise&pt=dtm&results=cm&limit=1&output=json), [service docs](https://oderest.rsl.wustl.edu/) | 200 JSON `ODEResults`, `Status=Success`, `Count="1"`, `Products.Product` | Actual HiRISE DTM record at Eberswalde, not Jezero. Fields include footprints, `FilesURL`, `LabelURL`; numeric fields may be strings and singleton products objects. Inspect response cardinality and error status, not HTTP status alone |
| [USGS STAC root](https://stac.astrogeology.usgs.gov/api/), [collections](https://stac.astrogeology.usgs.gov/api/collections) | 200 JSON; root `stac_version`, `conformsTo`, `links`; collections array | Root advertises 1.1.0. Multi-body metadata; select Mars and asset semantics explicitly. Follow advertised search/item links; no asset/subset capability assumed |

All three sample requests were anonymous. No quotas, uptime guarantee, arbitrary spatial query, pagination behavior or selected STAC raster payload was tested. STAC/PDS discovery does not establish asset resolution, frame, license or numerical meaning: inspect each label. Save query, returned product identifiers and retrieval date. Source failures should leave cached supported regions usable, and undiscovered areas unavailable.

Practical order: **S1 → matching S2 ortho/quality → S3/S5 context → S4 regional expansion → S7/S8/S11 optional context → S9/S10 validated extensions → S12 research only**. A production backend does not need every source integrated.
