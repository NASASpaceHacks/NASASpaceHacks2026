"""Gale study-site figure: four co-registered layers from the gale-v1 site pack."""
import json, sys
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, ListedColormap
from matplotlib.patches import Polygon
from PIL import Image

PACK = Path(sys.argv[1])
OUT = Path(sys.argv[2])
m = json.loads((PACK / "manifest.json").read_text())
g = m["grid"]; W, H, C = g["w"], g["h"], g["cellM"]
x0, y0 = g["originX"], g["originY"]          # top-left corner
ext = [x0, x0 + W * C, y0 - H * C, y0]       # left, right, bottom, top (m)

def raster(name):
    r = m["rasters"][name]
    dt = {"f32": np.float32, "u16": np.uint16, "i16": np.int16}[r["dtype"]]
    a = np.fromfile(PACK / r["file"], dtype=dt).astype(np.float64)
    a = a.reshape(H, W) if r["bands"] == 1 else a.reshape(H, W, r["bands"])
    nd = r.get("nodata")
    if nd is not None:
        a[a == nd] = np.nan
    return a * r["scale"] + r["offset"]

dem, slope, ti, sky = raster("dem"), raster("slope"), raster("ti"), raster("skyview")

# km coordinates relative to the habitat for readability
hab = next(s for s in m["shelters"] if s["kind"] == "hab")
ox, oy = hab["x"], hab["y"]
kext = [(ext[0] - ox) / 1e3, (ext[1] - ox) / 1e3, (ext[2] - oy) / 1e3, (ext[3] - oy) / 1e3]
K = lambda x, y: ((np.asarray(x) - ox) / 1e3, (np.asarray(y) - oy) / 1e3)

ortho = Image.open(PACK / "ortho.webp").convert("RGB")
ortho = ortho.resize((1600, 1600), Image.LANCZOS)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mplstyle import CYAN, CRIMSON, VIOLET, INK  # noqa: E402
plt.rcParams.update({"axes.spines.top": True, "axes.spines.right": True})

fig, axs2 = plt.subplots(2, 2, figsize=(6.3, 5.5), constrained_layout=True)
axs = axs2.ravel()

def decorate(ax, title, ylabel=False, xlabel=False):
    ax.set_title(title, loc="left", pad=3)
    ax.set_xticks([-2, -1, 0, 1, 2]); ax.set_yticks([-1, 0, 1, 2, 3])
    ax.set_xlim(kext[0], kext[1]); ax.set_ylim(kext[2], kext[3])
    if xlabel: ax.set_xlabel("East of Hab-1 (km)")
    else: ax.set_xticklabels([])
    if ylabel: ax.set_ylabel("North of Hab-1 (km)")
    else: ax.set_yticklabels([])
    ax.set_aspect("equal")

def overlays(ax, full=False):
    for line in m["traverse"]["lines"]:
        xs, ys = K([p[0] for p in line], [p[1] for p in line])
        ax.plot(xs, ys, color="white", lw=1.6, alpha=0.9, solid_capstyle="round")
        ax.plot(xs, ys, color=INK, lw=0.6, ls=(0, (2, 1.2)))
    for ko in m["keepouts"]:
        ring = np.array(ko["rings"][0]); kx, ky = K(ring[:, 0], ring[:, 1])
        ax.add_patch(Polygon(np.c_[kx, ky], closed=True, fill=False, ec=CRIMSON, lw=0.9, ls="--"))
    sx, sy = K([s["x"] for s in m["stations"]], [s["y"] for s in m["stations"]])
    ax.scatter(sx, sy, s=14, marker="o", fc=CYAN, ec="white", lw=0.6, zorder=5)
    for s in m["shelters"]:
        hx, hy = K(s["x"], s["y"])
        mk = "s" if s["kind"] == "hab" else "D"
        ax.scatter([hx], [hy], s=26 if mk == "s" else 20, marker=mk, fc="white", ec=INK, lw=0.9, zorder=6)
        if full:
            label = "Hab-1" if s["kind"] == "hab" else "PR-1"
            ax.annotate(label, (hx, hy), xytext=(4, -9 if s["kind"] == "hab" else 4), textcoords="offset points",
                        fontsize=7, color="white", fontweight="bold",
                        path_effects=[matplotlib.patheffects.withStroke(linewidth=1.6, foreground=INK)])

import matplotlib.patheffects  # noqa: E402

# (a) HiRISE colour orthoimage
axs[0].imshow(np.asarray(ortho), extent=kext, origin="upper", interpolation="lanczos")
overlays(axs[0], full=True)
decorate(axs[0], "(a) HiRISE colour orthoimage, plan context", ylabel=True)
kx, ky = K(*np.array(m["keepouts"][0]["rings"][0]).mean(axis=0))
axs[0].annotate("plume\nkeep-out", (kx, ky), ha="center", va="center", fontsize=6.5, color="white",
                path_effects=[matplotlib.patheffects.withStroke(linewidth=1.4, foreground=CRIMSON)])

# (b) slope with the 20 degree hard limit
grey = LinearSegmentedColormap.from_list("g", ["#f4f4f2", "#3a3a3a"])
im = axs[1].imshow(np.clip(slope, 0, 20), extent=kext, origin="upper", cmap=grey, vmin=0, vmax=20, interpolation="nearest")
blocked = np.where(slope > 20, 1.0, np.nan)
axs[1].imshow(blocked, extent=kext, origin="upper", cmap=ListedColormap([CRIMSON]), interpolation="nearest")
cb = fig.colorbar(im, ax=axs[1], shrink=0.92, pad=0.02, ticks=[0, 10, 20]); cb.set_label("Slope (°)", fontsize=7)
cb.ax.tick_params(labelsize=6.5, width=0.4, length=2); cb.outline.set_linewidth(0.4)
overlays(axs[1])
decorate(axs[1], "(b) Slope at 5 m; crimson exceeds 20°")

# (c) THEMIS thermal inertia (indicative)
blues = LinearSegmentedColormap.from_list("b", ["#eef6f9", "#0a5470"])
lo, hi = np.nanpercentile(ti, [2, 98])
im = axs[2].imshow(ti, extent=kext, origin="upper", cmap=blues, vmin=lo, vmax=hi, interpolation="nearest")
cb = fig.colorbar(im, ax=axs[2], shrink=0.92, pad=0.02); cb.set_label("TI (J m$^{-2}$ K$^{-1}$ s$^{-1/2}$)", fontsize=7)
cb.ax.tick_params(labelsize=6.5, width=0.4, length=2); cb.outline.set_linewidth(0.4)
overlays(axs[2])
decorate(axs[2], "(c) THEMIS thermal inertia (indicative)", ylabel=True, xlabel=True)

# (d) visible sky fraction (terrain shielding)
viol = LinearSegmentedColormap.from_list("v", ["#3b2f8f", "#f3f1fb"])
lo, hi = np.nanpercentile(sky, [1, 99.5])
im = axs[3].imshow(sky, extent=kext, origin="upper", cmap=viol, vmin=lo, vmax=hi, interpolation="nearest")
cb = fig.colorbar(im, ax=axs[3], shrink=0.92, pad=0.02); cb.set_label("Fraction of sky visible", fontsize=7)
cb.ax.tick_params(labelsize=6.5, width=0.4, length=2); cb.outline.set_linewidth(0.4)
overlays(axs[3])
decorate(axs[3], "(d) Visible sky fraction (dose shielding)", xlabel=True)

fig.savefig(OUT, dpi=300, bbox_inches=None)
fig.savefig(OUT.with_suffix(".png"), dpi=200)
print("stats: slope>20 %.2f%%  dem %.0f..%.0f m  ti %.0f..%.0f  sky %.3f..%.3f" % (
    100 * np.mean(slope > 20), np.nanmin(dem), np.nanmax(dem), np.nanmin(ti), np.nanmax(ti), np.nanmin(sky), np.nanmax(sky)))
print("shelters", [(s["id"], s["kind"]) for s in m["shelters"]])
