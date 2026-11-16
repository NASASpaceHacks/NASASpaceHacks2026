"""Anatomy of the PR-1 plan (heat state, margins, radio) and the constraint-ablation areas, from the real engine output."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mplstyle import CYAN, CRIMSON, VIOLET, INK, MUTED, GRID  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data" / "scenario"
PACK = Path("/Users/kumarsashank/dev/NASA-Martian-Map/NASASpaceHacks2026/SitePacks/gale-v1")
rp = json.loads((D / "rover_plan.json").read_text())
bd = rp["burndown"]
t = np.array([p["tMin"] for p in bd]); met = np.array([p["metW"] for p in bd]); heat = np.array([p["heatAvgW"] for p in bd])
wbm = np.array([p["walkbackMarginMin"] for p in bd]); shm = np.array([p["shelterMarginMin"] for p in bd])
los = np.array([p["inLos"] for p in bd], dtype=bool)
# accumulate time spent on out-of-coverage samples; interval [t_i, t_i+1] takes the state of sample i+1 (the cell walked onto)
gap = np.zeros_like(t); g = 0.0
for i in range(1, len(t)):
    g = 0.0 if los[i] else g + (t[i] - t[i - 1])
    gap[i] = g
stops = rp["stops"]

fig, axs = plt.subplots(3, 1, figsize=(6.5, 4.3), sharex=True, constrained_layout=True, gridspec_kw={"height_ratios": [1.3, 1, 0.55]})
def shade_stops(ax):
    for k, s in enumerate(stops):
        ax.axvspan(s["arriveMin"], s["departMin"], color=GRID, lw=0, zorder=0)
for ax in axs: shade_stops(ax)
for k, s in enumerate(stops):
    axs[0].text((s["arriveMin"] + s["departMin"]) / 2, 1000, s["id"], ha="center", va="top", fontsize=6.3, color=MUTED)

ax = axs[0]
ax.step(t, met, where="post", color=MUTED, lw=0.8, label="metabolic power")
ax.plot(t, heat, color=CYAN, lw=1.6, label="30-min heat average $H$")
ax.axhline(352, color=CRIMSON, lw=0.9, ls=(0, (4, 2)))
ax.text(t[0] + 1, 360, "budget 352 W", color=CRIMSON, fontsize=6.5, va="bottom")
ax.set_ylabel("Power (W)"); ax.set_ylim(200, 1010)
ax.legend(loc="upper right", fontsize=6.5, ncol=2, bbox_to_anchor=(1.0, 0.86))
ax.set_title("(a) Suit heat: rests (power 250 W between stops) keep the 30-min average at or below the budget", loc="left", fontsize=8)

ax = axs[1]
ax.plot(t, wbm, color=VIOLET, lw=1.4, label="walk-back margin")
ax.plot(t, shm, color=CYAN, lw=1.4, label="margin to 30-min shelter limit")
ax.axhline(0, color=CRIMSON, lw=0.9, ls=(0, (4, 2)))
ax.set_ylabel("Margin (min)"); ax.set_ylim(-5, max(wbm.max(), 10) * 1.08)
ax.legend(loc="upper right", fontsize=6.5, ncol=2)
ax.set_title("(b) Contingency margins stay positive throughout", loc="left", fontsize=8)

ax = axs[2]
lm = rp["margins"]["los_gap_max_min"]; tb = lm["atMin"]; gmax = 10 - lm["min"]
ax.fill_between(t, 0, 1, where=~los, step="post", color="#e9b8cd", lw=0, label="outside radio coverage (1-min samples)")
ax.axvspan(tb - gmax, tb, ymin=0, ymax=1, color="none", ec=CRIMSON, lw=0.9, hatch=None)
ax.annotate("longest gap %.1f min (limit 10), the binding constraint" % gmax, (tb, 1.0), xytext=(tb + 4, 1.45), fontsize=6.5, color=INK,
            arrowprops=dict(arrowstyle="-", lw=0.5, color=MUTED), va="center")
ax.set_ylim(0, 1.9); ax.set_yticks([])
ax.set_xlabel("Mission elapsed time (min; egress ends at 30, ingress begins at 213)")
ax.legend(loc="upper left", fontsize=6.5)
ax.set_title("(c) Radio contact along the route (gap reported by the engine)", loc="left", fontsize=8)
ax.set_xlim(t[0], t[-1])
fig.savefig(ROOT / "figs" / "anatomy.pdf"); fig.savefig(ROOT / "figs" / "anatomy.png", dpi=200)
rest_total = sum(s["restMin"] for s in rp["segments"])
print("max gap %.2f, min wb %.1f, min sh %.1f, max heat %.1f, rest total %.1f, t0 %.1f t1 %.1f" % (gap.max(), wbm.min(), shm.min(), heat.max(), rest_total, t[0], t[-1]))

# ---------------- constraint ablation (per-cell rules) ----------------
m = json.loads((PACK / "manifest.json").read_text()); gr = m["grid"]; W, H, C = gr["w"], gr["h"], gr["cellM"]
cols, rows = np.meshgrid(np.arange(W), np.arange(H)); X = gr["originX"] + (cols + 0.5) * C; Y = gr["originY"] - (rows + 0.5) * C
def f(b, k, dtp=np.float32): return np.fromfile(D / f"{b}_{k}", dtype=dtp).reshape(H, W)
res = {}
st_cells = {s["id"]: s["cell"] for s in m["stations"]}
for b, sid in (("hab", "HAB"), ("rover", "ROVER1")):
    s = next(x for x in m["shelters"] if x["id"] == sid)
    bl = f(b, "blocked.u8", np.uint8) == 0
    rad = np.hypot(X - s["x"], Y - s["y"]) <= 2000
    sh = f(b, "shelterMin.f32") <= 30
    wb = (f(b, "outboundMin.f32") + f(b, "walkbackMin.f32")) <= 300
    lo = f(b, "los.u8", np.uint8) > 0
    steps = [("walkable cells (slope, keep-out, data)", bl), ("+ within 2 km of base", bl & rad), ("+ within 30 min of a shelter", bl & rad & sh),
             ("+ out-and-back within surface time", bl & rad & sh & wb), ("+ inside radio coverage", bl & rad & sh & wb & lo)]
    res[b] = [(name, float(mask.sum() * C * C / 1e6), int(sum(mask.ravel()[c] for c in st_cells.values()))) for name, mask in steps]
for i in range(5):
    print("%-42s hab %.2f km2 (%d st)  rover %.2f km2 (%d st)" % (res["hab"][i][0], res["hab"][i][1], res["hab"][i][2], res["rover"][i][1], res["rover"][i][2]))
(D / "ablation.json").write_text(json.dumps(res, indent=1))
