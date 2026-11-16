"""Scenario figure: walking from Hab-1 (STAY IN) vs staging from the rover PR-1 (GO), from the real engine output."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mplstyle import CYAN, CRIMSON, VIOLET, INK, MUTED  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.patheffects as pe  # noqa: E402
from matplotlib.colors import LightSource, ListedColormap  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

PACK = Path("/Users/kumarsashank/dev/NASA-Martian-Map/NASASpaceHacks2026/SitePacks/gale-v1")
ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "scenario"
m = json.loads((PACK / "manifest.json").read_text())
g = m["grid"]; W, H, C = g["w"], g["h"], g["cellM"]; x0, y0 = g["originX"], g["originY"]
dem = np.fromfile(PACK / "dem.bin", dtype=np.float32).reshape(H, W).astype(float)
sc = json.loads((D / "scenario.json").read_text())
plt.rcParams.update({"axes.spines.top": True, "axes.spines.right": True})

hab = next(s for s in m["shelters"] if s["kind"] == "hab")
rov = next(s for s in m["shelters"] if s["kind"] == "rover")
ox, oy = hab["x"], hab["y"]
ext = [(x0 - ox) / 1e3, (x0 + W * C - ox) / 1e3, (y0 - H * C - oy) / 1e3, (y0 - oy) / 1e3]
cols, rows = np.meshgrid(np.arange(W), np.arange(H))
X = (x0 + (cols + 0.5) * C)
Y = (y0 - (rows + 0.5) * C)

def cell_xy(i):
    r, c = divmod(int(i), W)
    return ((x0 + (c + 0.5) * C - ox) / 1e3, (y0 - (r + 0.5) * C - oy) / 1e3)

def field(base, k, dt=np.float32):
    return np.fromfile(D / f"{base}_{k}", dtype=dt).reshape(H, W)

def zone(base, sx, sy):
    wb = field(base, "walkbackMin.f32"); sh = field(base, "shelterMin.f32"); ob = field(base, "outboundMin.f32")
    bl = field(base, "blocked.u8", np.uint8)
    dist = np.hypot(X - sx, Y - sy)
    return (bl == 0) & (dist <= 2000) & (sh <= 30) & (ob + wb <= 300) & np.isfinite(wb) & np.isfinite(ob)

ls = LightSource(azdeg=315, altdeg=40)
shade = ls.hillshade(dem, vert_exag=2.0, dx=C, dy=C)
los = field("rover", "los.u8", np.uint8)
stations = {s["id"]: s for s in m["stations"]}

fig, axs = plt.subplots(1, 2, figsize=(6.5, 3.95), constrained_layout=True)
xl, yl = (-2.05, 1.45), (-1.05, 2.75)
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
wb_cmap = LinearSegmentedColormap.from_list("wb", ["#e4f3f8", "#7cc3da", "#0f7ea3", "#073f52"])
VMAX = 180
ims = []

def base_map(ax, z, base):
    ax.imshow(shade, extent=ext, origin="upper", cmap="gray", vmin=0.15, vmax=1.0, interpolation="bilinear")
    wb = field(base, "walkbackMin.f32")
    ims.append(ax.imshow(np.where(z, np.clip(wb, 0, VMAX), np.nan), extent=ext, origin="upper", cmap=wb_cmap, vmin=0, vmax=VMAX,
                         alpha=0.78, interpolation="nearest"))
    ax.contour(np.where(los > 0, 1.0, 0.0), levels=[0.5], extent=ext, origin="upper", colors=[INK], linewidths=0.5, linestyles=[(0, (1.5, 1.5))])
    for s, mk, lab in ((hab, "s", "Hab-1"), (rov, "D", "PR-1")):
        sx, sy = (s["x"] - ox) / 1e3, (s["y"] - oy) / 1e3
        ax.scatter([sx], [sy], marker=mk, s=34 if mk == "s" else 28, fc="white", ec=INK, lw=1.0, zorder=8)
        ax.annotate(lab, (sx, sy), xytext=(6, -3), textcoords="offset points", fontsize=7, fontweight="bold", color=INK,
                    path_effects=[pe.withStroke(linewidth=2, foreground="white")], zorder=9)
    ax.set_xlim(*xl); ax.set_ylim(*yl); ax.set_aspect("equal")
    ax.set_xlabel("East of Hab-1 (km)")

# (a) From Hab-1: STAY IN, stations coloured by the rule that drops them
ax = axs[0]
base_map(ax, zone("hab", ox, oy), "hab")
reason_style = {
    "eva_duration_max_min": (CRIMSON, "o", "EVA duration (6 h)"),
    "shelter_time_max_min": (VIOLET, "s", "time to shelter (30 min)"),
    "walk_radius_max_m": (MUTED, "^", "distance from base (2 km)"),
}
for d in sc["hab"]["dropped"]:
    s = stations[d["id"]]; col, mk, _ = reason_style[d["rule"]]
    ax.scatter([(s["x"] - ox) / 1e3], [(s["y"] - oy) / 1e3], marker=mk, s=22, fc=col, ec="white", lw=0.6, zorder=7)
ax.set_ylabel("North of Hab-1 (km)")
ax.set_title("(a) From Hab-1: stay in (no feasible stop)", loc="left", pad=4)
ax.legend(handles=[Line2D([], [], marker=v[1], ls="", mfc=v[0], mec="white", ms=5, label=v[2]) for v in reason_style.values()],
          title="Station dropped by", title_fontsize=6.8, loc="lower left", fontsize=6.6, frameon=True, framealpha=0.92,
          edgecolor="none", borderpad=0.4, handletextpad=0.2)

# (b) From PR-1: GO, six stops
ax = axs[1]
base_map(ax, zone("rover", rov["x"], rov["y"]), "rover")
pts = []
for seg in sc["rover"]["segments"]:
    pts.extend(cell_xy(i) for i in seg["cells"])
pts = np.array(pts)
ax.plot(pts[:, 0], pts[:, 1], color="white", lw=2.6, zorder=5, solid_capstyle="round")
ax.plot(pts[:, 0], pts[:, 1], color=CRIMSON, lw=1.3, zorder=6, solid_capstyle="round")
chosen = sc["rover"]["order"]
for sid, s_ in stations.items():
    if sid not in chosen:
        ax.scatter([(s_["x"] - ox) / 1e3], [(s_["y"] - oy) / 1e3], marker="o", s=14, fc="white", ec=MUTED, lw=0.7, zorder=7)
for sid in chosen:
    s_ = stations[sid]
    ax.scatter([(s_["x"] - ox) / 1e3], [(s_["y"] - oy) / 1e3], marker="o", s=16, fc=CYAN, ec="white", lw=0.5, zorder=8)
# zoom inset around the route
zx, zy = (-0.96, -0.6), (0.0, 0.64)
from matplotlib.patches import Rectangle  # noqa: E402
ax.add_patch(Rectangle((zx[0], zy[0]), zx[1] - zx[0], zy[1] - zy[0], fill=False, ec=INK, lw=0.6, zorder=9))
ins = ax.inset_axes([0.015, 0.555, 0.43, 0.43])
ins.imshow(shade, extent=ext, origin="upper", cmap="gray", vmin=0.15, vmax=1.0, interpolation="bilinear")
ins.imshow(np.where(zone("rover", rov["x"], rov["y"]), np.clip(field("rover", "walkbackMin.f32"), 0, VMAX), np.nan), extent=ext,
           origin="upper", cmap=wb_cmap, vmin=0, vmax=VMAX, alpha=0.78, interpolation="nearest")
ins.plot(pts[:, 0], pts[:, 1], color="white", lw=2.4, solid_capstyle="round", zorder=5)
ins.plot(pts[:, 0], pts[:, 1], color=CRIMSON, lw=1.2, solid_capstyle="round", zorder=6)
rx, ry = (rov["x"] - ox) / 1e3, (rov["y"] - oy) / 1e3
ins.scatter([rx], [ry], marker="D", s=26, fc="white", ec=INK, lw=0.9, zorder=8)
labels = {0: ("1", (-4, 6)), 1: ("2, 3", (-17, -2)), 3: ("4", (6, -6)), 4: ("5", (6, -2)), 5: ("6", (6, 2))}
for k, sid in enumerate(chosen):
    s_ = stations[sid]; sx, sy = (s_["x"] - ox) / 1e3, (s_["y"] - oy) / 1e3
    ins.scatter([sx], [sy], marker="o", s=22, fc=CYAN, ec="white", lw=0.6, zorder=8)
    if k in labels:
        txt, off = labels[k]
        ins.annotate(txt, (sx, sy), xytext=off, textcoords="offset points", fontsize=6.8, fontweight="bold", ha="left",
                     color=INK, path_effects=[pe.withStroke(linewidth=2, foreground="white")], zorder=9)
ins.annotate("PR-1", (rx, ry), xytext=(6, 2), textcoords="offset points", fontsize=6.5, color=INK, fontweight="bold",
             path_effects=[pe.withStroke(linewidth=2, foreground="white")], zorder=9)
ins.set_xlim(*zx); ins.set_ylim(*zy); ins.set_aspect("equal"); ins.set_xticks([]); ins.set_yticks([])
for sp in ins.spines.values():
    sp.set_linewidth(0.6); sp.set_edgecolor(INK)
ax.set_yticklabels([])
ax.set_title("(b) From PR-1: go, six stops, 243 min", loc="left", pad=4)
ax.legend(handles=[Line2D([], [], color=INK, lw=0.6, ls=(0, (1.5, 1.5)), label="radio coverage edge"),
                   Line2D([], [], color=CRIMSON, lw=1.3, label="planned route"),
                   Line2D([], [], marker="o", ls="", mfc=CYAN, mec="white", ms=5, label="selected stop (order)"),
                   Line2D([], [], marker="o", ls="", mfc="white", mec=MUTED, ms=4.5, label="not selected")],
          loc="lower left", fontsize=6.6, frameon=True, framealpha=0.92, edgecolor="none", borderpad=0.4, handletextpad=0.3)

cb = fig.colorbar(ims[-1], ax=axs, location="bottom", shrink=0.55, pad=0.02, aspect=40, ticks=[0, 30, 60, 90, 120, 150, 180])
cb.set_label("Walk-back time to the EVA base at half pace (min), shown where walking is allowed", fontsize=7)
cb.ax.tick_params(labelsize=6.5, width=0.4, length=2); cb.outline.set_linewidth(0.4)
cb.ax.set_xticklabels(["0", "30", "60", "90", "120", "150", "≥180"])
out = ROOT / "figs" / "scenario.pdf"
fig.savefig(out, dpi=300); fig.savefig(out.with_suffix(".png"), dpi=200)
print(sc["hab"]["status"], [(d["id"], d["rule"]) for d in sc["hab"]["dropped"]])
print(sc["rover"]["status"], chosen, "zone km2 hab %.2f rover %.2f" % (zone("hab", ox, oy).sum() * 25e-6, zone("rover", rov["x"], rov["y"]).sum() * 25e-6))

for nm, base, sx, sy in (("hab", "hab", ox, oy), ("rover", "rover", rov["x"], rov["y"])):
    wb = field(base, "walkbackMin.f32")
    vals = []
    for sid in ["ST01","ST02","ST03","ST04","ST05","ST06","ST07"]:
        st = stations[sid]; vals.append(round(float(wb.ravel()[st["cell"]]), 1))
    print(nm, "walkback at ST01-07:", vals)
