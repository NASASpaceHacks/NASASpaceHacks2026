"""Digitize Norcross et al. 2010 (NASA/TP-2010-216125) Figure 36 (p.37; pdf page 52):
suited VO2 (mL/kg/min) vs treadmill grade for 5 offload levels, Mark III, 121 kg, 29.6 kPa.
The report has NO numeric table for these means, so we read the plotted per-gravity polynomial trend lines
(raster colour tracking at 300 dpi), fit a quadratic to the traced line centres, and evaluate at 0/10/20/30 % grade.
Estimated digitization error ~ +-0.5 mL/kg/min. Usage: digitize_fig36.py <nor.pdf> <outdir>"""
import sys, subprocess, numpy as np, csv, os
from PIL import Image
pdf, out = sys.argv[1], sys.argv[2]
subprocess.run(['pdftoppm','-f','52','-l','52','-r','300','-png',pdf,os.path.join(out,'h52')],check=True)
im = np.array(Image.open(os.path.join(out,'h52-052.png')).convert('RGB')).astype(int)
# axis calibration from the plot gridlines/ticks at 300 dpi: y(0)=1571 px, 15.47 px per unit; x(0%)=660 px, 40 px per % grade
Y0, YS, X0, XS = 1571.0, 15.47, 660.0, 40.0
COL = {0.12:(79,129,189), 0.17:(192,80,77), 0.22:(155,187,89), 0.27:(128,100,162), 0.32:(75,172,198)}
marker_g = [0,10,15,20,30]
rows = []
for g, c in COL.items():
    xs, ys = [], []
    for gr in np.arange(1.5, 29, 0.5):
        if min(abs(gr-m) for m in marker_g) < 1.6: continue   # skip columns occluded by data markers
        x = int(X0 + gr*XS)
        hit = [y for y in range(880, 1560) if max(abs(im[y,x]-np.array(c))) <= 6]
        if len(hit) >= 4:
            xs.append(gr); ys.append((Y0 - np.mean(hit))/YS)
    p = np.polyfit(xs, ys, 2)
    for grade in (0, 10, 20, 30):
        rows.append((g, grade, round(float(np.polyval(p, grade)),2), len(xs)))
with open('digitized_fig36.csv','w',newline='') as f:
    w = csv.writer(f); w.writerow(['gravity_g','grade_pct','vo2_ml_kg_min','n_trace_points']); w.writerows(rows)
for r in rows: print(r)
