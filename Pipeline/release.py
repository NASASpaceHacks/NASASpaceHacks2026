#!/usr/bin/env python3
"""Distribute site-pack binaries as a GitHub Release asset (they are git-ignored; manifest.json is committed).

    Pipeline/.venv/bin/python Pipeline/release.py pack  gale-v1    # → Pipeline/dist/gale-v1-data.tar.gz (+ upload hint)
    Pipeline/.venv/bin/python Pipeline/release.py fetch gale-v1    # download + extract + verify sha256 against manifest.json
    Pipeline/.venv/bin/python Pipeline/release.py verify gale-v1   # just verify local files against manifest.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "NASASpaceHacks/NASASpaceHacks2026"


def sha(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def verify(pack: Path) -> bool:
    m = json.loads((pack / "manifest.json").read_text())
    bad = [rel for rel, h in m["files"].items() if not (pack / rel).exists() or sha(pack / rel) != h]
    for rel in bad:
        print(f"  MISMATCH/MISSING {rel}")
    print(f"{pack.name}: {len(m['files']) - len(bad)}/{len(m['files'])} files verified")
    return not bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["pack", "fetch", "verify"])
    ap.add_argument("site")
    ap.add_argument("--tag", help="release tag (default: sitepack-<site>)")
    a = ap.parse_args()
    pack = ROOT / "SitePacks" / a.site
    tag = a.tag or f"sitepack-{a.site}"
    asset = f"{a.site}-data.tar.gz"
    if a.cmd == "verify":
        return 0 if verify(pack) else 1
    if a.cmd == "pack":
        if not verify(pack):
            return 1
        m = json.loads((pack / "manifest.json").read_text())
        out = ROOT / "Pipeline" / "dist" / asset
        out.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(out, "w:gz") as t:
            for rel in sorted(m["files"]):
                t.add(pack / rel, arcname=rel)
        print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB). Upload with:\n"
              f"  gh release create {tag} --repo {REPO} --title '{a.site} site pack' --notes 'Built by Pipeline/build_sitepack.py' || true\n"
              f"  gh release upload {tag} {out} --repo {REPO} --clobber")
        return 0
    url = f"https://github.com/{REPO}/releases/download/{tag}/{asset}"
    dst = ROOT / "Pipeline" / "dist" / asset
    dst.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    urllib.request.urlretrieve(url, dst)
    m = json.loads((pack / "manifest.json").read_text())
    with tarfile.open(dst, "r:gz") as t:
        members = [x for x in t.getmembers() if x.isfile() and x.name in m["files"]]   # only files the manifest names
        t.extractall(pack, members=members, filter="data")
    return 0 if verify(pack) else 1


if __name__ == "__main__":
    sys.exit(main())
