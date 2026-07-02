#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web_lite3.constants import APP_RELEASE_PACKAGE_NAME

PACKAGE_NAME = APP_RELEASE_PACKAGE_NAME
INCLUDE_PATHS = [
    "README.md",
    "requirements.txt",
    "launcher",
    "launcher-win-source",
    ".github/workflows/hybrid-release.yml",
    "scripts/build_macos_release.py",
    "scripts/build_launcher_app.py",
    "scripts/build_windows_release.py",
    "scripts/build_release.py",
    "scripts/runtime_packaging.py",
    "scripts/runtime_video_tools.py",
    "tests",
    "web_lite3",
]


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    dist_dir = root / "dist"
    staging_dir = dist_dir / PACKAGE_NAME
    archive_base = dist_dir / PACKAGE_NAME
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    if dist_dir.exists():
        for suffix in (".zip", ".tar.gz"):
            candidate = archive_base.with_suffix(suffix)
            if candidate.exists():
                candidate.unlink()
    staging_dir.mkdir(parents=True, exist_ok=True)
    for relative in INCLUDE_PATHS:
        source = root / relative
        target = staging_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)
    archive_path = shutil.make_archive(str(archive_base), "zip", root_dir=dist_dir, base_dir=PACKAGE_NAME)
    print(f"Created release archive: {archive_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
