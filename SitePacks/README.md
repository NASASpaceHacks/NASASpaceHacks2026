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
- **landmarks**: LZ-1, 6 unnamed DEM knobs, 5 named features from `Content/gazetteer.json` (rover-team names, `informal: true`), and the Aeolis Mons summit (IAU name, `informal: false`; highest MOLA sample within 0.45° of the IAU centre, 771 m) as a far heading cue.
- **traverse**: Curiosity's track in projected metres (AOI ± 3 km, simplified to 0.25 m).
- **conditions**: last 30 REMS sols. `spaceWeather` is absent in the current build because DONKI was rate-limited (see Pipeline/README).
- **scenario**: `Sol 412 — 09:40 LTST`, a fictional crewed-mission sol.

## How binaries are distributed
Only `manifest.json`, `traverse_waypoints.json` and the small `images/` JPEGs are committed. The root `.gitignore`
excludes `*.bin`, `*.tif`, `*.webp` and `*.png` under `SitePacks/*/`. The binaries ship as a **GitHub Release asset**
`gale-v1-data.tar.gz` (≈ 57 MB) on the tag `sitepack-gale-v1`:

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
(Mastcam). REMS: NASA/JPL-Caltech/CAB (outreach feed; "for outreach purposes only"). MOLA: NASA/GSFC. Each layer's
full citation is in its `provenance` entry in `manifest.json`.
