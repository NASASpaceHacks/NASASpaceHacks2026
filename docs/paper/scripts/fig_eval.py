"""Evaluation figures from the CSVs in ../data (built from the repo's Validation/ outputs)."""
import csv, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mplstyle import CYAN, CRIMSON, VIOLET, INK, MUTED, GRID  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

D = Path(__file__).resolve().parent.parent / "data"
OUT = Path(__file__).resolve().parent.parent / "figs"

def rows(name):
    with open(D / name) as f:
        return list(csv.DictReader(f))

def f(x):
    return float(x) if x not in ("", None) else np.nan

def panel_label(ax, s):
    ax.set_title(s, loc="left", pad=4, fontsize=8.5)

# ---------------------------------------------------------------- models
fig, axs = plt.subplots(1, 3, figsize=(6.5, 2.25), constrained_layout=True)

# (a) V2 metabolic parity
ax = axs[0]
v2 = [r for r in rows("v2_metabolic.csv") if r["row_type"] == "measured_digitized"]
lo = [r for r in v2 if f(r["gravity_g"]) < 0.2]
hi = [r for r in v2 if f(r["gravity_g"]) > 0.2]
lim = (100, 950)
xs = np.linspace(*lim, 2)
ax.fill_between(xs, xs * 0.85, xs * 1.15, color=GRID, lw=0, zorder=0)
ax.plot(xs, xs, color=MUTED, lw=0.6, zorder=1)
ax.scatter([f(r["measured_W"]) for r in lo], [f(r["model_W"]) for r in lo], s=16, marker="s", fc="white", ec=VIOLET, lw=1.0, zorder=3)
ax.scatter([f(r["measured_W"]) for r in hi], [f(r["model_W"]) for r in hi], s=16, marker="o", fc=CYAN, ec="white", lw=0.5, zorder=4)
ax.set_xlim(*lim); ax.set_ylim(*lim); ax.set_aspect("equal")
ax.set_xlabel("NASA suited data, digitized (W)"); ax.set_ylabel("Model (W)")
ax.legend(handles=[Line2D([], [], marker="o", ls="", mfc=CYAN, mec="white", ms=4.5, label="0.22–0.32 $g$, MAPE 10.6%"),
                   Line2D([], [], marker="s", ls="", mfc="white", mec=VIOLET, ms=4.2, label="0.12–0.17 $g$, MAPE 36.0%")],
          loc="upper left", handletextpad=0.2, borderaxespad=0.2, fontsize=6.8)
ax.text(820, 690, "±15%", fontsize=6.3, color=MUTED, ha="left", va="center")
panel_label(ax, "(a) Walking metabolic rate (V2)")

# (b) V1 obstructed sky parity
ax = axs[1]
v1 = rows("v1_skyview.csv")
main = [r for r in v1 if r["in_15_period_MAE"] == "1"]
held = [r for r in v1 if r["in_15_period_MAE"] == "0"]
lim = (0, 42)
xs = np.linspace(*lim, 2)
ax.plot(xs, xs, color=MUTED, lw=0.6, zorder=1)
park = [r for r in main if r["is_background_period"] == "0"]
bg = [r for r in main if r["is_background_period"] == "1"]
ax.scatter([f(r["paper_obstructed_pct_Guo2026_Table1"]) for r in park], [f(r["ours_obstructed_pct_solid_angle"]) for r in park],
           s=16, marker="o", fc=CYAN, ec="white", lw=0.5, zorder=4)
ax.scatter([f(r["paper_obstructed_pct_Guo2026_Table1"]) for r in bg], [f(r["ours_obstructed_pct_solid_angle"]) for r in bg],
           s=16, marker="s", fc="white", ec=VIOLET, lw=1.0, zorder=3)
ax.scatter([f(r["paper_obstructed_pct_Guo2026_Table1"]) for r in held], [f(r["ours_obstructed_pct_solid_angle"]) for r in held],
           s=22, marker="D", fc="white", ec=INK, lw=0.8, zorder=5)
p6 = next(r for r in v1 if r["period"] == "P6")
ax.annotate("P6 (Maria\nGordon Notch)", (f(p6["paper_obstructed_pct_Guo2026_Table1"]), f(p6["ours_obstructed_pct_solid_angle"])),
            xytext=(3, -9), textcoords="offset points", ha="right", va="top", fontsize=6.3, color=INK, linespacing=1.0,
            bbox=dict(boxstyle="square,pad=0.1", fc="white", ec="none"),
            arrowprops=dict(arrowstyle="-", lw=0.4, color=MUTED))
ax.set_xlim(*lim); ax.set_ylim(*lim); ax.set_aspect("equal")
ax.set_xlabel("Guo et al. (2026), sky obstructed (%)"); ax.set_ylabel("Our DEM pipeline (%)")
ax.text(40, 3, "MAE 2.0 pp, r = 0.94\n(15 periods)", ha="right", va="bottom", fontsize=6.8)
ax.legend(handles=[Line2D([], [], marker="o", ls="", mfc=CYAN, mec="white", ms=4.5, label="parking"),
                   Line2D([], [], marker="s", ls="", mfc="white", mec=VIOLET, ms=4.2, label="background"),
                   Line2D([], [], marker="D", ls="", mfc="white", mec=INK, ms=4.2, label="Murray Buttes (held out)")],
          loc="upper left", handletextpad=0.2, borderaxespad=0.2, fontsize=6.8)
panel_label(ax, "(b) Terrain sky obstruction (V1)")

# (c) V5 dose by sol, year 1
ax = axs[2]
v5 = rows("v5_dose.csv")
sol = np.array([f(r["sol"]) for r in v5]); meas = np.array([f(r["measured_E_plastic_uGy_day"]) for r in v5])
mod = np.array([f(r["model_E_uGy_day_phi600_at_measured_P"]) for r in v5])
seg = [sol < 230, sol > 230]
for m_ in seg:
    ax.plot(sol[m_], mod[m_], color=CYAN, lw=1.4, zorder=3)
ax.scatter(sol, meas, s=11, fc=INK, ec="white", lw=0.4, zorder=4)
ax.set_xlabel("Sol (mission year 1)"); ax.set_ylabel("Absorbed dose rate (µGy/day)")
ax.set_ylim(170, 240); ax.set_xlim(0, 540)
ax.text(18, 236, "mean: model 198.8 vs\nmeasured 207.8 (−4.3%)", va="top", fontsize=6.8)
ax.legend(handles=[Line2D([], [], marker="o", ls="", mfc=INK, mec="white", ms=4, label="RAD measured (plastic)"),
                   Line2D([], [], color=CYAN, lw=1.4, label="model at REMS pressure")],
          loc="lower right", handletextpad=0.3, borderaxespad=0.2, fontsize=6.8)
panel_label(ax, "(c) Surface dose vs Curiosity RAD (V5)")

fig.savefig(OUT / "eval_models.pdf"); fig.savefig(OUT / "eval_models.png", dpi=220)

# ---------------------------------------------------------------- impact
fig, axs = plt.subplots(1, 3, figsize=(6.5, 2.3), constrained_layout=True, gridspec_kw={"width_ratios": [1.25, 1, 1]})

# (a) slope-only violations by rule (PR-1, n=200)
ax = axs[0]
viol = next(r for r in rows("v3_violations.csv") if r["set"] == "PR1" and r["planner"].startswith("Naive"))
labels = {
    "plans_violating_los_gap_max_min": "radio gap > 10 min",
    "plans_violating_walkback_speed_factor": "walk-back at half speed",
    "plans_violating_shelter_time_max_min": "shelter > 30 min",
    "plans_violating_eva_duration_max_min": "EVA > 6 h",
    "plans_violating_daylight_min_sun_elev_deg": "daylight",
    "plans_violating_walk_radius_max_m": "radius > 2 km",
    "plans_violating_unsafe_edge_grade_gt_20deg": "slope or step > 20°",
    "plans_violating_plume_keepout_m": "plume keep-out",
}
items = sorted(((labels[k], int(viol[k])) for k in labels), key=lambda t: t[1])
y = np.arange(len(items))
ax.barh(y, [v for _, v in items], height=0.62, color=CRIMSON, lw=0)
for yi, (_, v) in zip(y, items):
    ax.text(v + 3, yi, str(v), va="center", fontsize=6.5, color=INK)
ax.set_yticks(y); ax.set_yticklabels([k for k, _ in items], fontsize=6.6)
ax.tick_params(axis="y", length=0)
ax.set_xlim(0, 230); ax.set_xlabel("Slope-only plans breaking the rule (of 200)")
ax.spines["left"].set_visible(False)
panel_label(ax, "(a) Slope-only plans: 199 of 200 break a rule")

# (b) oversubscribed science, A vs B
ax = axs[1]
sci = [r for r in rows("v3_science.csv") if r["family"] == "oversub"]
A = np.array([f(r["marswalk_value_A"]) for r in sci]); B = np.array([f(r["nearest_first_value_B"]) for r in sci])
lim = (min(B.min(), A.min()) - 20, max(A.max(), B.max()) + 20)
xs = np.linspace(*lim, 2)
ax.plot(xs, xs, color=MUTED, lw=0.6, zorder=1)
eq = np.isclose(A, B)
rng = np.random.default_rng(1)
jit = lambda n: rng.uniform(-3, 3, n)
ax.scatter(B[eq] + jit(eq.sum()), A[eq] + jit(eq.sum()), s=9, fc="white", ec=VIOLET, lw=0.7, zorder=3, label="equal (37.5%)")
ax.scatter(B[~eq] + jit((~eq).sum()), A[~eq] + jit((~eq).sum()), s=9, fc=CYAN, ec="white", lw=0.3, zorder=4, label="Marswalk higher (62.5%)")
ax.set_xlim(*lim); ax.set_ylim(*lim); ax.set_aspect("equal")
ax.set_xlabel("Science value, nearest-first"); ax.set_ylabel("Science value, Marswalk (exact)")
ax.legend(loc="lower right", handletextpad=0.1, borderaxespad=0.2, fontsize=6.5, markerscale=1.3)
ax.text(lim[0] + 8, lim[1] - 8, "mean +5%\nnever lower", ha="left", va="top", fontsize=6.8)
panel_label(ax, "(b) Science, 1.5–3.5 h on surface")

# (c) timing ECDF (PR-1 plans and re-plans)
ax = axs[2]
tim = rows("v3_timing.csv")
plan = np.sort([f(r["ms"]) for r in tim if r["family"] == "PR1_full_eva" and r["kind"] == "plan"])
rep = np.sort([f(r["ms"]) for r in tim if r["family"] == "PR1_full_eva" and r["kind"] == "replan"])
for arr, col, lab in ((rep, CYAN, "mid-EVA re-plan"), (plan, VIOLET, "full plan")):
    ax.step(arr, np.arange(1, len(arr) + 1) / len(arr), where="post", color=col, lw=1.4, label=lab)
ax.set_xscale("log"); ax.set_xlim(1, 2000); ax.set_ylim(0, 1.02)
ax.set_xticks([1, 10, 100, 1000]); ax.set_xticklabels(["1", "10", "100", "1000"])
ax.set_xlabel("Solve time on a laptop (ms)"); ax.set_ylabel("Fraction of solves")
ax.axhline(0.5, color=GRID, lw=0.6, zorder=0)
ax.plot([np.median(rep), np.median(plan)], [0.5, 0.5], ls="", marker="o", ms=3.2, mfc=INK, mec="white", mew=0.5, zorder=5)
ax.text(np.median(rep) * 0.82, 0.5, "8.3 ms", fontsize=6.5, ha="right", va="center", color=INK)
ax.text(np.median(plan) * 1.2, 0.5, "37.9 ms", fontsize=6.5, ha="left", va="center", color=INK)
ax.legend(loc="upper left", handlelength=1.4, borderaxespad=0.2, fontsize=6.5)
panel_label(ax, "(c) Solve time, rover-staged set")

fig.savefig(OUT / "eval_impact.pdf"); fig.savefig(OUT / "eval_impact.png", dpi=220)
print("plan n", len(plan), "median", np.median(plan), "replan n", len(rep), "median", np.median(rep))
print("oversub n", len(A), "A>B", np.mean(A > B + 1e-9), "A<B", np.mean(A < B - 1e-9), "ratio mean", np.mean(A / B))
