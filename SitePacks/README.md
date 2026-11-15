# Site packs

A **site pack** is everything the engine, the habitat console and the visor need to plan and fly EVAs at one site,
built from real NASA data by [`Pipeline/build_sitepack.py`](../Pipeline/README.md). It is served by the hab server at
`/sitepacks/<id>/` and loaded with `loadSitePack()` from `Shared/src/contracts/sitepack.ts`.

## `gale-v1`: Gale Crater, Mount Sharp boxwork

- **AOI**: 5 km × 5 km centred on 137.388°E, −4.805°N (Curiosity's 2023–2026 traverse, sols 3706–5073 inside the AOI).
- **Projection**: `+proj=eqc +lat_ts=-4.8 +lat_0=0 +lon_0=137.39 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs` (IAU Mars 2000 sphere).
- **Engine grid**: 1000 × 1000 cells at 5 m. Top-left corner `originX = -2620`, `originY = -282315` (snapped to 5 m). Row 0 is north.

| File | Size | Encoding | Content |
|---|---|---|---|
| `manifest.json` | 0.17 MB | JSON, `SitePackManifestSchema` | grid, layer table, provenance, shelters, keep-outs, stations, landmarks, traverse, images, REMS, scenario, sha256 per file |
| `dem.bin` | 4.0 MB | f32 LE, m | Elevation (MOLA areoid): block mean of 25 × 1 m samples of the USGS MSL Gale merged DEM |
| `slope.bin` | 2.0 MB | u16 LE × 0.01, ° | Horn (1981) slope on the 5 m DEM. Identical to `hornSlopeDeg()` (max Δ 0.007°) |
| `rough.bin` | 2.0 MB | u16 LE × 0.001, m | Std-dev of plane-detrended 1 m heights inside each 5 m cell |
| `normals.bin` | 4.0 MB | i16 LE × 1/32767, 2 bands interleaved by pixel (nx, ny) | +y north, nx = −dz/dx, ny = −dz/dy. Identical to `surfaceNormals()` (max Δ 6e-5) |
| `ti.bin` | 2.0 MB | u16 LE × 0.1, nodata 65535, J m⁻² K⁻¹ s⁻½ | THEMIS quantitative thermal inertia (100 m, bilinear to 5 m). **Indicative** |
| `ortho.webp` | 4.9 MB | WebP q80, 5000 × 5000 px, 1 m | HiRISE colour basemap over the grid extent (`imagery[0]`, `extent` in projected m) |
| `ortho_cog.tif` | 39.1 MB | Cloud-optimised GeoTIFF, JPEG q85 (YCbCr), 0.5 m, 512² tiles + overviews | Same imagery at 0.5 m, georeferenced in the site eqc (`imagery[1]`, id `ortho_hr`) |
| `images/*.jpg` | 10 files, 2.6 MB | JPEG ≤ 1280 px | Curiosity Mastcam (raw Bayer, demosaicked to colour) and Navcam frames from stationary sols at each station's nearest rover stop |
| `traverse_waypoints.json` | 0.13 MB | JSON | Curiosity end-of-drive waypoints (sol, site/drive, x/y, cell) in the AOI ± 3 km. Used for image positions and sol labels |

Total ≈ 58 MB (budget < 100 MB, each file < 50 MB).

### What the manifest holds
- **rasters**: `dem`, `slope`, `rough`, `normals`, `ti`. Each has its full provenance (mission, instrument, product, URL, licence, citation, native resolution, accuracy).
- **imagery**: `ortho` (WebP, 1 m) and `ortho_hr` (COG, 0.5 m).
- **shelters**: `HAB` (fixed) and `ROVER1` (movable pressurized rover, 896 m from the hab).
- **keepouts**: `PLUME-LZ1`, a 1 km plume-ejecta ring around landing pad LZ-1. The pad is 3.6 km from the hab, and the ring clears both shelters.
- **stations**: 12 science stations from `Content/stations.gale.json` (C1 Content, cited), each linked to a rover image ≤ 60 m away.
  The matching science traceability matrix is shipped as `stm.json` (a copy of `Content/stm.json`).
- **landmarks**: LZ-1, 6 unnamed DEM knobs, 5 named features from `Content/gazetteer.json` (rover-team names, `informal: true`), and the Aeolis Mons summit (IAU name, `informal: false`; highest MOLA sample within 0.45° of the IAU centre, 771 m) as a far heading cue.
- **traverse**: Curiosity's track in projected metres (AOI ± 3 km, simplified to 0.25 m).
- **conditions**: last 30 REMS sols. `spaceWeather` is absent in the current build because DONKI was rate-limited (see Pipeline/README).
- **scenario**: `Sol 412 — 09:40 LTST`, a fictional crewed-mission sol.

## `jezero-v1`: Jezero Crater, western delta front

A second real site, built by the same pipeline (`build_sitepack.py jezero-v1`). It shows that Marswalk works at any
landing site that has HiRISE terrain.

- **AOI**: 5 km × 5 km centred on 77.392°E, 18.466°N. The box spans Perseverance's delta-front campaign (Hawksbill Gap,
  Wildcat Ridge, Amalik, Three Forks sample depot; sols 413–700) and the start of the upper-fan campaign (Berea, Emerald
  Lake, Dream Lake, margin unit; sols 749–923). 220 Perseverance waypoints (sols 400–998) fall inside it. It lies within
  the USGS Mars 2020 TRN HiRISE DTM mosaic (77.223–77.584°E, 18.307–18.669°N).
- **Projection**: `+proj=eqc +lat_ts=18.5 +lat_0=0 +lon_0=77.39 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs`.
- **Engine grid**: 1000 × 1000 cells at 5 m. Top-left corner `originX = -2390`, `originY = 1097065`. Row 0 is north.

| File | Size | Content |
|---|---|---|
| `manifest.json` | 0.23 MB | Same schema as gale-v1 (`SitePackManifestSchema`) |
| `dem.bin`, `slope.bin`, `rough.bin`, `normals.bin` | 4.0 / 2.0 / 2.0 / 4.0 MB | From the USGS **Mars 2020 TRN HiRISE DTM mosaic, 1 m** (Fergason et al. 2020, doi:10.5066/P9REJ9JN). Same encodings and derivations as gale-v1. Elevation −2574 to −2386 m (MOLA / DeltaGeoid) |
| `ti.bin` | 2.0 MB | THEMIS quantitative TI, tile `00N060E` (100 m), 136–475 J m⁻² K⁻¹ s⁻½. **Indicative** |
| `ortho.webp` | 3.1 MB | USGS **Mars 2020 TRN HiRISE orthomosaic, 25 cm** (doi:10.5066/P9QJDP48), block-averaged to 1 m. **Greyscale**, pre-landing (2020), so no rover tracks |
| `ortho_cog.tif` | 24.2 MB | Same imagery at 0.5 m, JPEG COG (`imagery[1]`, id `ortho_hr`) |
| `images/*.jpg` | 10 files, 1.7 MB | Perseverance raw frames (9 Mastcam-Z, 1 Navcam) taken at the exact localized rover position (image site/drive = waypoint site/drive) |
| `traverse_waypoints.json` | 0.07 MB | Perseverance end-of-drive waypoints in the AOI ± 3 km |
| `stm.json` | 0.01 MB | Science traceability matrix, a copy of `Content/stm.jezero.json` |
| `context/` | 0.6 MB | Viking MDIM global and Jezero regional images, plus `context.json` (AOI box, labels) |

Total ≈ 42 MB, with every file pinned by sha256 in `files{}`.

- **Stations**: 12 real Perseverance targets and sample sites from `Content/stations.jezero.json`, JZ01–JZ12. Each one is
  cited, with the position taken from the rover's localized waypoint on the sol it was studied. That is the rover's
  position, not the target itself (≈ 10–20 m). 10 of the 12 are linked to a rover image ≤ 60 m away.
- **Shelters / pad**: the same generic siting heuristic as gale-v1.
  - **HAB**: slope 1.5°, on a flat-topped delta remnant about 85 m above the crater floor. The heuristic maximises line of sight.
  - **ROVER1**: 420 m from the hab.
  - **LZ-1**: 3.0 km from the hab. The 1 km plume ring clears both shelters.
- **Landmarks**: 6 DEM knobs and Octavia E. Butler Landing (Perseverance's sol 13 position, 3.5 km east, informal).
  There is no gazetteer for this site yet.
- **Conditions**:
  - MEDA: the mars.nasa.gov outreach feed stopped updating in April 2024. Only 5 sols carry data (sols 1129–1133, 2024-04-23…27), and each is dated in the pack.
  - Space weather: DONKI, keyless CCMC API.
- **QA**:
  - DEM vs Perseverance waypoint elevations: median 0.00 m, std 0.07 m (n = 220). The best-fit horizontal offset is 0 within a 0.5 m search, while a 5 m shift raises the std to 0.25–0.49 m.
  - Ortho vs DEM: 0.7 m E / 0.2 m N.
- **Scenario**: `Sol 412 — 09:40 LTST`, the same fictional crewed-mission sol as gale-v1.

## How binaries are distributed
Only `manifest.json`, `traverse_waypoints.json` and the small `images/` JPEGs are committed. The root `.gitignore`
excludes `*.bin`, `*.tif`, `*.webp` and `*.png` under `SitePacks/*/`. The binaries ship as a **GitHub Release asset**
`<id>-data.tar.gz` (gale-v1 ≈ 57 MB, tag `sitepack-gale-v1`; jezero-v1 ≈ 40 MB, same commands with `jezero-v1`):

```sh
# maintainer: build, then package + upload
Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1
Pipeline/.venv/bin/python Pipeline/release.py pack gale-v1        # prints the gh release create/upload commands
# teammates / CI: download, extract and verify every sha256 against manifest.json
Pipeline/.venv/bin/python Pipeline/release.py fetch gale-v1
Pipeline/.venv/bin/python Pipeline/release.py verify gale-v1
pnpm tsx Pipeline/validate.ts SitePacks/gale-v1/manifest.json    # schema + sizes + sha256 + contract consistency
```
The manifest's `files` map pins every binary by sha256, so a stale or partial download is detected. If the pack is
missing, the Backend falls back to the in-memory `mockSitePack()`.

## Credits
HiRISE: NASA/JPL-Caltech/University of Arizona. MSL Gale DEM and colour basemap: USGS Astrogeology (Parker & Calef).
THEMIS: NASA/JPL-Caltech/Arizona State University. Curiosity images: NASA/JPL-Caltech (Navcam) and NASA/JPL-Caltech/MSSS
(Mastcam). REMS: NASA/JPL-Caltech/CAB (outreach feed; "for outreach purposes only"). MOLA: NASA/GSFC.
Jezero: Mars 2020 TRN HiRISE DTM and orthomosaic, USGS Astrogeology (Fergason et al. 2020). Perseverance images:
NASA/JPL-Caltech/ASU (Mastcam-Z) and NASA/JPL-Caltech (Navcam). MEDA outreach feed: NASA/JPL-Caltech. Each layer's
full citation is in its `provenance` entry in `manifest.json`.
