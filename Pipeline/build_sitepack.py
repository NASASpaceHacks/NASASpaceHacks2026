#!/usr/bin/env python3
"""Build a Marswalk site pack from real NASA data.

    Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1                 # all stages
    Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1 --steps stations   # just refresh stations from Content/
    Pipeline/.venv/bin/python Pipeline/build_sitepack.py gale-v1 --steps images,conditions --force

The manifest is rewritten (with fresh sha256s) after every step, so a partially built pack is always valid.
Network results are cached in Pipeline/cache/ (git-ignored); --force re-runs steps whose outputs already exist.
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mwpipe.common import CACHE_DIR, SITEPACKS_DIR, SITES, load_manifest, write_manifest  # noqa: E402

STAGES = {
    1: ["terrain", "traverse", "siting"],   # siting is DEM-only; the schema needs exactly one hab
    2: ["ortho", "stations"],
    3: ["ti", "landmarks", "images", "conditions"],
}
ALL_STEPS = [s for k in sorted(STAGES) for s in STAGES[k]] + ["qa"]
SCENARIO = {"sol": 412, "startLtstMin": 580, "label": "Sol 412 — 09:40 LTST"}  # fictional crewed-mission sol


def skeleton(site) -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "schema": "sitepack/1", "id": site.id, "name": site.name, "body": "mars", "createdUtc": now,
        "grid": site.grid_spec(), "rasters": {}, "imagery": [], "stations": [], "landmarks": [], "shelters": [],
        "keepouts": [], "images": [], "conditions": {"fetchedUtc": now}, "scenario": dict(SCENARIO), "files": {},
    }


def restore_internal(m: dict) -> dict:
    """Re-derive pipeline-internal bookkeeping (keys starting with '_') after loading a manifest from disk."""
    refs = {l["file"] for l in m["rasters"].values()} | {i["file"] for i in m["imagery"]} | {i["file"] for i in m["images"]}
    m["_extraFiles"] = [f for f in m.get("files", {}) if f not in refs]
    return m


def step_done(step: str, pack: Path, m: dict) -> bool:
    r = m["rasters"]
    return {
        "terrain": all(k in r for k in ("dem", "slope", "rough", "normals")),
        "traverse": "traverse" in m,
        "ortho": any(i["id"] == "ortho" for i in m["imagery"]),
        "siting": any(s["kind"] == "hab" for s in m["shelters"]),
        "stations": False,     # cheap; always refresh (picks up Content/stations.gale.json when it lands)
        "ti": "ti" in r,
        "landmarks": any(l["id"] != "LZ1" for l in m["landmarks"]),
        "images": len(m["images"]) > 0,
        "conditions": "rems" in m["conditions"] and "spaceWeather" in m["conditions"],
        "qa": False,
    }[step]


def run_step(step: str, site, pack: Path, m: dict) -> dict:
    if step in ("terrain", "traverse"):
        from mwpipe import terrain
        return terrain.build_terrain(site, pack, m) if step == "terrain" else terrain.build_traverse(site, pack, m)
    if step == "ortho":
        from mwpipe import ortho
        return ortho.build_ortho(site, pack, m)
    if step in ("siting", "stations"):
        from mwpipe import siting
        return siting.build_siting(site, pack, m) if step == "siting" else siting.build_stations(site, pack, m)
    if step in ("ti", "landmarks", "images", "conditions"):
        from mwpipe import context
        return getattr(context, f"build_{step}")(site, pack, m)
    if step == "qa":
        from mwpipe import qa
        qa.run_qa(site, pack, m)
        return m
    raise ValueError(step)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site", choices=sorted(SITES))
    ap.add_argument("--steps", help=f"comma list from {','.join(ALL_STEPS)} or stage numbers 1,2,3 (default: all)")
    ap.add_argument("--force", action="store_true", help="re-run steps even if their outputs exist")
    args = ap.parse_args()

    site = SITES[args.site]
    pack = SITEPACKS_DIR / site.id
    pack.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    steps = ALL_STEPS
    if args.steps:
        steps = []
        for tok in args.steps.split(","):
            tok = tok.strip()
            steps += STAGES[int(tok)] if tok.isdigit() else [tok]
        unknown = [s for s in steps if s not in ALL_STEPS]
        if unknown:
            ap.error(f"unknown steps {unknown}")

    old = load_manifest(pack)
    m = restore_internal(old) if old else skeleton(site)
    m["grid"] = site.grid_spec()
    m["scenario"] = dict(SCENARIO)
    failed = []
    for step in steps:
        if not args.force and step_done(step, pack, m):
            print(f"[{step}] up to date (use --force to rebuild)")
            continue
        print(f"[{step}] ...", flush=True)
        try:
            m = run_step(step, site, pack, m)
        except Exception as e:  # noqa: BLE001 — keep going: every step leaves a valid manifest
            traceback.print_exc()
            failed.append(f"{step}: {e}")
            continue
        m["createdUtc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_manifest(pack, m)
        print(f"[{step}] manifest written", flush=True)
    if failed:
        print("FAILED steps:\n  " + "\n  ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
