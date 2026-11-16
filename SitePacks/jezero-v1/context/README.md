# Context imagery (jezero-v1)

Real NASA imagery, nothing synthesised.

- mars_global.jpg: Viking MDIM 2.1 colour mosaic, WMTS zoom 2 (8x4 tiles), whole planet, lon -180..180, lat 90..-90.
- jezero_regional.jpg: same layer, zoom 7 (the layer's maximum), tiles stitched and cropped to lon 75.8-79.4 E, lat 16.6-20.2 N.
- context.json: image extents, study-area (AOI) box derived from manifest.json grid, and labels.
  "Jezero crater" is placed at 77.58 E, 18.38 N (approximate crater centre; the crater is about 45 km across).
  "Octavia E. Butler Landing" is Perseverance's first localized position (M20_waypoints.json, sol 13: 77.4509 E, 18.4446 N).

Source: JPL Mars Trek WMTS, layer Mars_Viking_MDIM21_ClrMosaic_global_232m
(https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{row}/{col}.jpg).
Credit: NASA/USGS Viking MDIM 2.1 colour mosaic via JPL Mars Trek.
Regenerate: `Pipeline/.venv/bin/python Pipeline/build_sitepack.py jezero-v1 --steps context --force`.
