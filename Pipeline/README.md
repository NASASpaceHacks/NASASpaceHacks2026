# Site-pack pipeline

Builds `SitePacks/<id>/` (see [SitePacks/README.md](../SitePacks/README.md)) from real NASA data. It reads only the
AOI window of every remote raster via GDAL `/vsicurl/` (nothing multi-GB is downloaded) and rewrites a **valid manifest
after every step**, so other components can use partial packs.

## Run
```sh
Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1                    # everything (~1.5 min with a warm cache, ~3 min cold)
Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1 --steps 1          # stage 1 only: terrain, traverse, siting
Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1 --steps stations   # refresh stations after Content/stations.gale.json changes
Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1 --steps conditions # refresh REMS + DONKI (set NASA_API_KEY)
Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1 --steps qa         # QA overlays + numbers → Pipeline/cache/qa_*
pnpm tsx Pipeline/validate.ts SitePacks/gale-v1/manifest.json                  # validate (exit 0 = VALID)
```
By default a step is skipped when its output already exists. Use `--force` to rebuild it. `stations` and `qa` always run.
Python env: `Pipeline/.venv` (rasterio 1.5 / GDAL 3.12, numpy, scipy, pillow, requests). No extra packages are needed.

## Steps
| Stage | Step | Source | Output |
|---|---|---|---|
| 1 | `terrain` | USGS MSL Gale merged DEM 1 m v3 (3.87 GB stripped GeoTIFF; a 5.4 km window is read once, 45 MB cached) | `dem.bin`, `slope.bin`, `rough.bin`, `normals.bin` |
| 1 | `traverse` | MMGIS `MSL_traverse.json`, `MSL_waypoints.json` | `manifest.traverse`, `traverse_waypoints.json` |
| 1 | `siting` | DEM-derived layers (+ TI/roughness if present) | hab, rover, landing pad LZ-1, 1 km plume keep-out |
| 2 | `ortho` | HiRISE 78-quad colour basemap COG (read from its 1 m and 0.5 m overviews) | `ortho.webp` (1 m), `ortho_cog.tif` (0.5 m, only if < 50 MB) |
| 2 | `stations` | `Content/stations.gale.json` (falls back to clearly labelled PLACEHOLDER stations on Curiosity stops if missing) | `manifest.stations` |
| 3 | `ti` | THEMIS quantitative TI mosaic `…30S120E_100mpp.cub` (ISIS3, tiled; tiny window) | `ti.bin` (indicative) |
| 3 | `landmarks` | DEM knobs, `Content/gazetteer.json`, MOLA 463 m (Aeolis Mons summit) | `manifest.landmarks` |
| 3 | `images` | mars.nasa.gov raw-image API | `images/*.jpg`, `manifest.images`, station `imageIds` |
| 3 | `conditions` | REMS weather feed; DONKI WSA-ENLIL/FLR/SEP (api.nasa.gov, then a keyless CCMC fallback) | `manifest.conditions` |
| – | `qa` | the pack | `Pipeline/cache/qa_overlay.png`, `qa_zoom.png`, `qa_hillshade.png`, `qa_images.png`, `qa_report.json` |

## Method notes
- **Reprojection is exact and affine.** The USGS DEM, the HiRISE COG, THEMIS and MOLA are all equirectangular on the
  same 3,396,190 m sphere. Re-expressing them in the site eqc is a pure x-scale (cos lat_ts) plus a shift, applied to
  the source geotransform (`mwpipe/common.py: eqc_source_to_local`). This avoids PROJ datum and celestial-body ambiguity.
  Resampling: bilinear to 1 m, then 5 × 5 block mean.
- **Roughness** is the RMS residual of a least-squares plane through the 25 one-metre heights of each 5 m cell. HiRISE
  DTMs resolve a few metres, so this under-represents sub-metre rocks.
- **Slope and normals** reproduce `hornSlopeDeg()` / `surfaceNormals()` from `Shared/src/contracts/sitepack.ts`.
  `validate.ts` checks this. At the grid edge the pipeline uses real DEM neighbours (10 m margin) instead of clamping.
- **Siting** is a documented heuristic (`mwpipe/siting.py`), not a NASA selection:
  - **HAB**: a < 5° cell (mean < 5° over 35 m) within 750 m of the AOI centre, chosen to maximise line of sight (6 m mast to 1.8 m helmet) over walkable terrain within 2 km.
  - **ROVER1**: flat, 700–900 m from the hab, closest to where Curiosity worked.
  - **LZ-1**: flat over 105 m with < 15 m of relief within ~155 m, low roughness, TI ≥ 300 (not sand), ≥ 1.6 km from the hab and near the AOI edge. The 1 km ring clears both shelters and covers as little walkable terrain as possible.
- **Rover images** come only from **stationary sols**: sols strictly between a waypoint's drive sol and the next drive.
  The rover did not move then, so the position is the waypoint. Each station gets the nearest such stop within 60 m.
  Raw Mastcam JPEGs are single-channel RGGB Bayer mosaics, which the pipeline demosaics bilinearly (raw colour, not
  white-balanced). Sky flats and dark frames are rejected by a texture test.
- **Honesty**: every layer has provenance. TI is flagged `indicative`. Placeholder stations would say so in their
  description. The scenario sol (412) is fictional.

## Disk + cache
`Pipeline/cache/` is git-ignored and holds ≈ 95 MB (the DEM window, the THEMIS window, downloaded JSON and raw
images, the 1 m ortho JPEG used by QA, and the QA images). Delete it at any time; the next run refetches only what it
needs. `Pipeline/dist/` holds release tarballs (`release.py pack`).

## Files
`build_sitepack.py` (CLI), `mwpipe/common.py` (grid, projection, I/O), `mwpipe/terrain.py`, `mwpipe/siting.py`,
`mwpipe/ortho.py`, `mwpipe/context.py`, `mwpipe/qa.py`, `validate.ts`, `release.py`.
