# Context imagery (gale-v1)

Real NASA imagery, nothing synthesised.

- mars_global.jpg: Viking MDIM 2.1 colour mosaic, WMTS zoom 2 (8x4 tiles), whole planet, lon -180..180, lat 90..-90.
- gale_regional.jpg: same layer, zoom 7 (the layer's maximum), tiles stitched and cropped to lon 136.0-139.8 E, lat -7.4..-3.4 N.
- context.json: image extents, study-area (AOI) box derived from manifest.json grid, and crater labels.

Source: JPL Mars Trek WMTS, layer Mars_Viking_MDIM21_ClrMosaic_global_232m
(https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{row}/{col}.jpg).
Credit: NASA/USGS Viking MDIM 2.1 colour mosaic via JPL Mars Trek.
Regenerate: `cd Pipeline && .venv/bin/python -m mwpipe.context_imagery`.
