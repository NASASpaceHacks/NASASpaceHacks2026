"""Shared matplotlib style for the paper: Libertinus to match the text, validated palette."""
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
from matplotlib import font_manager as fm
import matplotlib.pyplot as plt

FONTS = Path(__file__).resolve().parent.parent / "fonts"
for f in FONTS.glob("*.otf"):
    fm.fontManager.addfont(str(f))

CYAN, CRIMSON, VIOLET, INK, MUTED, GRID = "#0f7ea3", "#c2185b", "#6250d6", "#1f1f1f", "#6b6b68", "#e3e3df"

plt.rcParams.update({
    "font.family": "Libertinus Serif", "mathtext.fontset": "custom",
    "mathtext.rm": "Libertinus Serif", "mathtext.it": "Libertinus Serif:italic", "mathtext.bf": "Libertinus Serif:bold",
    "font.size": 8, "axes.labelsize": 8, "axes.titlesize": 8.5, "legend.fontsize": 7, "xtick.labelsize": 7, "ytick.labelsize": 7,
    "axes.linewidth": 0.5, "axes.edgecolor": "#8a8a86", "axes.labelcolor": INK, "text.color": INK,
    "xtick.color": "#4a4a47", "ytick.color": "#4a4a47", "xtick.major.width": 0.5, "ytick.major.width": 0.5,
    "xtick.major.size": 2.5, "ytick.major.size": 2.5, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": False, "grid.color": GRID, "grid.linewidth": 0.5, "legend.frameon": False,
    "pdf.fonttype": 42, "savefig.bbox": "tight", "savefig.pad_inches": 0.02, "lines.linewidth": 1.4,
})
