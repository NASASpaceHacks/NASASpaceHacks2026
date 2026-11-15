"""jezero-v1: Jezero crater western delta front (Perseverance), sources + provenance.

AOI: 5 × 5 km centred on 77.392°E, 18.466°N, between the Three Forks sample depot / Hawksbill Gap (delta front,
Perseverance sols 413–700) and the start of the upper-fan campaign (sols 700–930). Inside the USGS Mars 2020 TRN
HiRISE DTM mosaic (77.223–77.584°E, 18.307–18.669°N).
Projection: +proj=eqc +lat_ts=18.5 +lat_0=0 +lon_0=77.39 +R=3396190 (lat_ts = centre lat to 1 decimal, lon_0 to 2).
"""
from __future__ import annotations

from .common import Site

TRN = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"   # S3 origin of planetarymaps.usgs.gov/mosaic/mars2020_trn/ (the planetarymaps proxy returned HTTP 502 to parallel range reads)
DEM_URL = TRN + "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
ORTHO_URL = TRN + "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif"
TRN_DOI = "https://doi.org/10.5066/P9REJ9JN"

DEM_PROV = {
    "mission": "Mars Reconnaissance Orbiter (+ Mars Global Surveyor MOLA control)",
    "instrument": "HiRISE stereo DTMs, mosaicked for Mars 2020 Terrain Relative Navigation",
    "product": "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif (HiRISE DTM mosaic, 1 m)",
    "url": DEM_URL,
    "license": "Public domain (USGS Astrogeology / NASA; FGDC metadata lists no access or use constraints)",
    "citation": "Fergason, R. L., Galuszka, D., Hare, T., Mayer, D., Redding, B. & Smith, E. (2020), High-Resolution Imaging "
                "Science Experiment Digital Terrain Model Mosaic for Mars 2020 Terrain Relative Navigation, U.S. Geological "
                "Survey Astrogeology Science Center. " + TRN_DOI,
    "resolutionM": 1.0,
    "accuracy": "1 m posting (21,400 × 21,488 px, equirectangular, Mars 2000 sphere R = 3,396,190 m). Mosaic of HiRISE stereo "
                "DTMs (effective resolution a few metres, so 1 m posting is not 1 m independent accuracy). Elevations are MOLA "
                "topography on the Mars 2020 'DeltaGeoid' areoid, as the product name states. Resampled here to the 5 m engine "
                "grid (block mean of 1 m samples).",
}

ORTHO_PROV = {
    "mission": "Mars Reconnaissance Orbiter",
    "instrument": "HiRISE (RED, panchromatic orthomosaic for Mars 2020 Terrain Relative Navigation)",
    "product": "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif (HiRISE orthomosaic, 25 cm)",
    "url": ORTHO_URL,
    "license": "Public domain (USGS Astrogeology / NASA; HiRISE: NASA/JPL-Caltech/UArizona)",
    "citation": "Fergason, R. L., Galuszka, D., Hare, T., Mayer, D., Redding, B. & Smith, E. (2020), High-Resolution Imaging "
                "Science Experiment Orthorectified Image Mosaic for Mars 2020 Terrain Relative Navigation, U.S. Geological "
                "Survey Astrogeology Science Center. https://doi.org/10.5066/P9QJDP48. HiRISE: McEwen et al. (2007), JGR 112, "
                "E05S04; NASA/JPL-Caltech/UArizona.",
    "resolutionM": 0.25,
    "accuracy": "Orthorectified on the TRN HiRISE DTM mosaic and on the same grid origin (4,577,366 m E, 1,106,618 m N, global "
                "eqc). Marswalk QA (phase correlation of DEM hillshade vs this image at 5 m) measures a median offset of "
                "0.7 m E / 0.2 m N, below one engine cell. Panchromatic (greyscale), not colour. Pre-landing product "
                "(published 2020-07-24, FGDC metadata), so Perseverance's tracks are not visible in it.",
}

THEMIS_URL = ("https://asc-astropedia.s3.us-west-2.amazonaws.com/Mars/Odyssey/THEMIS-Global-Thermal-Inertia-Mosaic/"
              "Quantitative-32-Bit/THEMIS_TI_Mosaic_Quant_00N060E_100mpp.cub")   # tile 0–30°N, 60–120°E

# Octavia E. Butler Landing: Perseverance's first localized position (M20_waypoints.json, sol 13, site 3 drive 0).
OEB_LANDING = {"id": "OEB-LANDING", "name": "Octavia E. Butler Landing (Perseverance landing site)",
               "lon": 77.45088572, "lat": 18.44462715, "elevM": -2569.9, "informal": True}

JEZERO = Site(
    id="jezero-v1", name="Jezero Crater — western delta front",
    lon=77.392, lat=18.466, lon0=77.39, lat_ts=18.5,
    cfg={
        "dem_url": DEM_URL, "dem_prov": DEM_PROV, "dem_direct_io": True,
        "ortho_mode": "strip_gray", "ortho_url": ORTHO_URL, "ortho_prov": ORTHO_PROV,
        "ortho_label": "HiRISE orthoimage (greyscale, 1 m)", "ortho_hr_label": "HiRISE orthoimage (greyscale, 0.5 m COG)",
        "ortho_cache": "ortho_1m_jezero-v1.jpg", "qa_prefix": "qa_jezero_",
        "themis_url": THEMIS_URL,
        "rover": "m20", "rover_name": "Perseverance", "mission": "Mars 2020 (Perseverance)",
        "mission_short": "Mars 2020 mission", "basemap": "Mars 2020 HiRISE base map",
        "traverse_url": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json",
        "waypoints_url": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json",
        "traverse_label": "Perseverance (Mars 2020) traverse",
        "stations_file": "stations.jezero.json", "stm_file": "stm.jezero.json",
        "gazetteer": False, "far_landmarks": [OEB_LANDING],
        "weather": "meda",
        "context": {
            "regional_bbox": (75.8, 79.4, 16.6, 20.2), "regional_file": "jezero_regional.jpg",
            "labels": [{"name": "Jezero crater", "lon": 77.58, "lat": 18.38},
                       {"name": "Octavia E. Butler Landing", "lon": 77.4509, "lat": 18.4446}],
        },
    },
)
