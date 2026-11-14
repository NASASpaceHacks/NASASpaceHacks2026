# Mars datasets and service inventory

Checked **2026-11-14**. HTTP results, UTC times, headers, bounded response samples and hashes are in [http_checks.json](evidence/http_checks.json). A successful landing page does not establish numeric-data access. No API key was used. Sources are ranked for this pedestrian prototype, not by scientific importance.

## Practical ranking

| Rank / source | Quantitative content and coverage | Resolution / reference system | Access, authentication and terms | Routing usefulness / cost |
|---|---|---|---|---|
| 1. USGS Mars 2020 HiRISE TRN DTM | Stereo elevation mosaic over western Jezero landing area | 1 m projected posting; planetocentric, east-positive; sphere R=3,396,190 m; equatorial equirectangular | Direct GeoTIFF + FGDC XML + PDS3 label on public S3; no key; product metadata access/use constraints: none | Best tested source; native small window works. Limited coverage and unresolved foot-scale hazards; moderate data cost, low implementation difficulty |
| 2. HiRISE individual DTMs + orthophotos | Local stereo footprints, including Jezero; elevation distinct from accompanying shaded relief | Example 1 m DTM; product-specific projection/reference; orthophotos finer | Public PDS IMG and JP2 downloads; no key; [HiRISE usage policy](https://www.uahirise.org/media/usage.php) says public domain, credit requested | High terrain detail, conversion and large-file overhead; posting does not imply 1 m independent accuracy |
| 3. USGS CTX Jezero science DEM | Stereo elevation covering entire crater, larger extent than HiRISE | 20 m DTM, companion 5 m image; catalog says planetocentric/east/equirectangular | Direct GeoTIFF; anonymous; USGS product attribution | Good corridor/coverage fallback; unusable for detecting pedestrian obstacles; numeric asset HEAD verified, pixels not read |
| 4. HRSC HMC-30 / Mars Express | Regional stereo mosaics; availability varies by quadrangle, includes MC13E | Common DTM 50 m; areoid `da5` vs spheroid `dt5`; product-specific CRS | DLR GeoTIFF catalog, ESA PSA archives; no public key shown; cite ESA/DLR/FU Berlin; precise redistribution terms not independently resolved | Regional screening; coarse for walking. Moderate integration; Python TLS issue blocks acquisition here |
| 5. MOLA MEGDR | Global binned laser-altimeter radius, areoid/topography and observation counts | Global 4–128 ppd (~14.8 km to 463 m at equator), finer polar grids; label-defined simple cylindrical/polar systems, 0–360° east in filenames | PDS4 bundle with IMG/XML/HDR and legacy LBL; anonymous HTTP | Best global control/context; very weak local hazard detector. Do not confuse radius with elevation or gridding with dense sampling |
| 6. HiRISE/CTX visible imagery | Rocks, dunes, scarps and mapped geology; orbital footprints/mosaics | HiRISE commonly sub-metre imagery, CTX several metres; exact scale and orthorectification product dependent | PDS bulk files, USGS products; Trek WMTS for display | Human-reviewed exclusion polygons useful; no elevation from images/hillshade; segmentation requires validation |
| 7. THEMIS thermal products | Thermal IR and derived thermal inertia across broad Mars coverage | IR mosaics typically 100 m; thermal-inertia models also published at 100 m; projection/product varies | ASU/PDS downloads and USGS ARD STAC; inspect asset units, scale and license | Material context, not measured boot traction or metre-scale weather; moderate scientific interpretation cost |
| 8. MEDA / REMS | Measured pressure, air/ground temperature, wind, humidity, dust/radiative observations along rover traverses | Time series at instrument/rover positions: Jezero/Gale; no global raster resolution | PDS labels + CSV/scientific products, public archive; no key | Valuable environmental validation at observed times; cannot interpolate a moving station into a precise local weather map |
| 9. Mars Climate Database | Global modeled seasonal/diurnal atmosphere and dust scenarios | Coarse GCM fields; version-dependent grid. 32 ppd MOLA-based pressure refinement is not 32 ppd measured weather | Moderate-use web form; registered downloadable NetCDF + Fortran access routines with Python examples; restrictions below | Scenario context only. No forecast guarantee or extremes guarantee; higher integration and terms burden |
| 10. CRISM | Mineralogical spectroscopy for scientific targets, patchy targeted coverage plus coarser mapping | Targeted nominal 18/36 m; product-dependent geometry | PDS/ODE files; no key; archive citation and asset terms | POI evidence, not automatic science value or terrain safety; substantial preprocessing |
| 11. MSL RAD | Measured ionizing-radiation environment at Gale | Instrument time series, not global geographic raster | PDS mission archives / published measurements; specific product acquisition not executed | Mission-level exposure modeling; not a fine-scale Jezero risk map |
| 12. NAIF SPICE | Body/Sun/spacecraft geometry, timing, orientation | Kernel-dependent frames/time validity; no terrain raster | Public kernel files and local toolkit, no key for public holdings | Essential future illumination/relay geometry; requires DEM horizons and correct epochs |

[NASA's science-data policy](https://science.data.nasa.gov/about/license) generally applies CC0 to NASA-led mission data without restrictive notices; this is not a substitute for checking individual third-party assets. [PDS citation guidance](https://pds.nasa.gov/datastandards/citing/) applies to provenance. No blanket license is asserted for every file on a public website.

## Exact access and documentation

**Selected USGS asset.** Documentation: [dataset DOI 10.5066/P9REJ9JN](https://doi.org/10.5066/P9REJ9JN), [source directory](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/index.html). Numeric asset:

```text
https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif
```

Replace `.tif` with `.xml` for FGDC metadata or `_pds3.lbl` for its planetary projection label. The `.xml` is **FGDC metadata**, not automatically PDS4 because of its extension. Downloaded copies are in `evidence/`. Full source: 21,488 rows × 21,400 columns, one Float32 band, 1 m projected pixels, NoData `-3.4028226550889045e38`, north-up transform `(1,0,4577366; 0,-1,1106618)`. Range response reports **1,839,545,409 bytes**; block shape is 1 × 21,400, not tiled COG. Coverage from label: 77.222933–77.583964°E, 18.306799–18.669315°N. Preserve MOLA/DeltaGeoid processing and do not reinterpret elevations as radius or terrestrial sea level.

**HiRISE original recommendation.** [Product page](https://hirise.lpl.arizona.edu/dtm/ESP_023524_1985), [DTM guide](https://hirise.lpl.arizona.edu/dtm/about.php). The page confirms `DTEEC_023524_1985_023379_1985_U01`, 1 m/pixel, posted size 700 MB. It is a different product from the 1.84 GB USGS mosaic. The IMG link is downloadable elevation; color altimetry and shaded relief are visualization products. No full individual IMG downloaded.

**CTX.** [Catalog](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic); asset:

```text
https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif
```

Catalog lists 5,067 × 4,456, 32 bit, 20 m, approximately 76.99–78.58°E and 17.58–19.29°N. Its minimum/maximum latitude fields are reversed and it lists radius 3,396,160 m, differing from the HiRISE header. **Do not copy those values into a shared CRS without inspecting this asset's actual header/label.** This run tested HEAD only. Bulk resampling CTX to 1 m adds no pedestrian information.

**MOLA.** [Documentation](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html); maintained [PDS4 bundle](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/), with `meg004/`, `meg016/`, `meg032/`, `meg064/`, `meg128/`, `polar/`. The documentation records the August 2026 migration to PDS4; the older PDS3 archive remains available. Labels, scales, byte order, topography vs radius and counts must be parsed per product. No global raster downloaded.

**HRSC.** [DLR HMC-30 GeoTIFF catalog](https://hrscteam.dlr.de/public/data/regionaldtms.php), [FU Berlin map portal](https://maps.planet.fu-berlin.de/). Gwinner et al. (2016), *Planetary and Space Science* 126:93–138, [DOI 10.1016/j.pss.2016.02.014](https://doi.org/10.1016/j.pss.2016.02.014), describes processing. The catalog distinguishes numeric `da5`/`dt5` DTMs from rendered `da5cs` relief. No pixel sample or specific asset license verified here; web documentation available but Python TLS fails.

**THEMIS and CRISM.** [ASU global products](https://www.mars.asu.edu/data/), [THEMIS portal](https://themis.asu.edu/), [CRISM archive](https://pds-geosciences.wustl.edu/missions/mro/crism.htm). Fergason et al. (2006), [DOI 10.1029/2006JE002735](https://agupubs.onlinelibrary.wiley.com/doi/abs/10.1029/2006je002735), supports derived thermal inertia, not a direct soil-strength measurement. Seelos et al., [CRISM product overview, DOI 10.1016/j.icarus.2023.115612](https://doi.org/10.1016/j.icarus.2023.115612), supports spectral product distinctions. No terrain classifications were downloaded or inferred.

**Weather and geometry.** [MEDA PDS archive](https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/), [MEDA product guide](https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda_old.html), [REMS reduced products](https://pds-atmospheres.nmsu.edu/PDS/data/mslrem_1001/), [NAIF public kernels](https://naif.jpl.nasa.gov/naif/kernelsavailability.html). MEDA RDS measures radiative/dust properties; it is **not** the same ionizing-radiation instrument as MSL RAD. MEDA directory was tested; no time series processed.

**MCD.** [Access/terms](https://www-mars.lmd.jussieu.fr/mars/access), [registration](https://www-mars.lmd.jussieu.fr/MCD_pro/mcd_pro.html), [documentation](https://www-mars.lmd.jussieu.fr/mars/info_web/), [v6.1 manual](https://www-mars.lmd.jussieu.fr/mars/info_web/user_manual_6.1.pdf). Access page advertises v6.2; documentation still links v6.1. Verify the distributed version before integration. Scientific use requires attribution and informing maintainers; commercial use requires authorization; registration includes non-redistribution terms. No registration submitted, no package downloaded, no stable public REST contract verified. Its topographic pressure refinement must not be represented as fine-scale weather observations.

## Service taxonomy and probes

| Service / exact endpoint | Actual contract | Latest test outcome | What it establishes |
|---|---|---|---|
| [Mars Trek docs](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) | HTML documentation for OGC RESTful WMTS | GET 200 | Tiles interface documented; no general astronaut-routing or DEM-subsetting REST API established |
| [Trek CTX capabilities](https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml) | OGC WMTS 1.0 XML | GET 200, 8,057 bytes; service type parsed/inspected | Display layer identified as uncontrolled CTX beta mosaic; do not mistake for elevation or controlled registration |
| [PDS Search](https://pds.nasa.gov/api/search/1/products?limit=1) / [docs](https://nasa-pds.github.io/pds-api/) | REST JSON metadata search | GET 200, 4,782 bytes; summary/products response inspected | Actual metadata service; sample was generic, not a Mars elevation query |
| [ODE sample](https://oderest.rsl.wustl.edu/live2/?query=product&target=mars&ihid=mro&iid=hirise&pt=dtm&results=cm&limit=1&output=json) / [docs](https://oderest.rsl.wustl.edu/) | REST product metadata and footprints; separate GDS for selected point datasets | GET 200, 2,755 bytes; one HiRISE DTM record at Eberswalde returned | Product discovery works; this is not a Jezero raster crop response |
| [USGS planetary STAC root](https://stac.astrogeology.usgs.gov/api/) / [collections](https://stac.astrogeology.usgs.gov/api/collections) / [official guide](https://www.usgs.gov/centers/astrogeology-science-center/welcome-usgs-astrogeology-science-center-analysis-ready-data) | STAC catalog/API and asset links | GET 200 for both; 2,987 / 64,658 bytes | Root declares STAC 1.1.0; collections are multi-body. Do not assume every asset is Mars or a DEM |
| Selected HiRISE TIFF | Static file with HTTP byte ranges | GET Range 206, 4,096 bytes | Numeric header then real pixel window read successfully |
| HiRISE XML / PDS3 label | Static scientific metadata | GET 200, 18,939 / 2,296 bytes | Frame, dimensions and lineage verified |
| CTX TIFF | Static file | HEAD 200 | Availability only; no quantitative content validation in this run |
| MOLA page / MEDA directory / MCD access page | HTML archive/documentation | GET 200 | Public access and linked archive/terms confirmed |
| HRSC DLR page | HTML download catalog | TLS certificate-validation error in Python; web tool can read page | Not evidence of permanent service outage; no trusted Python download demonstrated |

Initial Python probes also encountered certificate-chain errors for ODE, MOLA and MEDA; a repeat with normal TLS verification succeeded. Latest evidence is saved; verification was never disabled. Availability checks are one-session observations, not an uptime study.

WMS returns rendered map images; WMTS returns tiled renderings. WCS can deliver numeric coverages, but **no suitable public Mars WCS was verified**. ArcGIS REST MapServer and ImageServer have different capabilities; no suitable elevation ImageServer was verified. STAC catalogs point to assets; they do not turn an image asset into elevation. PDS archives are labeled files, with PDS/ODE search layered on top. S3 is storage, not an elevation API. Neither the presence of Esri client examples in Trek nor a searchable website establishes an ArcGIS elevation service.

## Pipeline recommendation

Use the exact HiRISE source adapter and crop now. Add ODE or STAC discovery when new regions are needed, followed by explicit product-type, body, units and CRS validation. Use CTX/HRSC/MOLA for context, not to mark unresolved pedestrian terrain safe. Add co-registered HiRISE ortho-derived hazard masks next. Cache small numeric products and provenance; avoid global bulk downloads and starting with raw stereo reconstruction.
