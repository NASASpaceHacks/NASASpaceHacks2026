"""Windowed /vsicurl/ reads of the USGS Gale 1 m DEM into a local cache (never whole file).
Near windows: 1 m, +-1.5 km around each site cluster. Far field: every 8th row/col (8 m point sample)."""
import sys, os, numpy as np, rasterio, math
from rasterio.windows import Window
URL='/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
R=3396190.0
CL={'A':(137.384,-4.735),'B':(137.4125,-4.7354),'C':(137.3945,-4.748),'D':(137.399,-4.759),'E':(137.3535,-4.695)}
OUT=os.environ.get('V1_CACHE','cache'); os.makedirs(OUT,exist_ok=True)
def xy(lon,lat): return R*math.radians(lon), R*math.radians(lat)   # eqc, lat_ts=0 (file CRS)
which=sys.argv[1]
env=dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',GDAL_HTTP_MAX_RETRY='5',GDAL_HTTP_RETRY_DELAY='2',VSI_CACHE='TRUE')
with rasterio.Env(**env):
    d=rasterio.open(URL); T=d.transform
    if which.startswith('far'):
        # far field in chunks (parallel): 'far0'..'far9' -> far_<i>.npy; run.py concatenates
        i=int(which[3:]); step=8; r0=13000; nrow=(d.height-r0)//step; per=-(-nrow//10)
        a0=i*per; a1=min(nrow,(i+1)*per); w=Window(0,r0+a0*step,d.width-d.width%step,(a1-a0)*step)
        a=d.read(1,window=w,out_shape=(a1-a0,w.width//step),resampling=rasterio.enums.Resampling.nearest)
        np.save(f'{OUT}/far_{i}.npy',a); print('far',i,a.shape)
    else:
        lon,lat=CL[which]; x,y=xy(lon,lat)
        c=int((x-T.c)/T.a); r=int((T.f-y)/-T.e); h=1500
        w=Window(c-h,r-h,2*h,2*h)
        a=d.read(1,window=w); np.save(f'{OUT}/near_{which}.npy',a); print(which,a.shape,'col0',c-h,'row0',r-h)
