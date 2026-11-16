# Marswalk research paper

`marswalk-paper.pdf` is the compiled paper: *Marswalk: Earth-Independent Planning and Guidance for Walking EVAs on Mars*.

## Before sharing

- **Authors.** The authors and their emails are in the `\PaperAuthors` macro at the top of `tex/marswalk-paper.tex`.
- **Repository link.** The paper points to `https://github.com/NASASpaceHacks/NASASpaceHacks2026`. Make sure that the code behind the paper is pushed there (branch `marswalk/core`) and public. A tagged release (and, ideally, a Zenodo DOI) pins the exact version the numbers come from.

## Rebuild the PDF

```sh
cd docs/paper/tex
tectonic marswalk-paper.tex      # https://tectonic-typesetting.github.io ; downloads packages on first run
```

The fonts (Libertinus) come from the TeX distribution. The figures are in `figs/`.

## Where the numbers come from

Every number in the paper traces to the repository:

- **Model and impact checks (V1–V5):** `Validation/` (`numbers.json` and each study's README and summary JSON).
- **Planner benchmark:** `Research/bench/results/latest/`.
- **End-to-end timings:** `qa/screens/timings.json`.
- **Unit tests:** `pnpm vitest run`. 138 of 138 passed on 2026-11-15 (122 in Shared and Research, 16 in Backend and qa).

`scripts/` regenerates the figures and the scenario analyses:

| Script | What it does |
|---|---|
| `make_csvs.py` | Builds `data/*.csv` from `Validation/` |
| `fig_site.py`, `fig_eval.py` | Gale site maps; model and impact charts |
| `export_scenario.mts` | Runs the real engine on the default Gale scenario (Hab-1 and PR-1) and exports the plans and safety fields |
| `sensitivity.mts` | One-at-a-time sensitivity of that scenario, plus the PR-1 plan's burndown |
| `fig_scenario.py`, `fig_anatomy.py` | Scenario map, plan anatomy, and the constraint-ablation table data |

How to run them:

- Run the Python scripts with `Pipeline/.venv/bin/python -I`. They use matplotlib and numpy.
- Run the `.mts` scripts from the repository root with `npx tsx <script> <outdir>`. They only read the repository.
- The engine exports large binary fields (about 40 MB), so they are not kept here. Rerun `export_scenario.mts` to recreate them.
