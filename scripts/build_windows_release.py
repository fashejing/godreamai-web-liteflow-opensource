#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.runtime_packaging import (
    build_common_runtime,
    build_wheelhouse,
    build_windows_python_runtime,
    copy_tree,
    copy_windows_top_level,
    clean_path,
    prepare_windows_video_tools,
    stage_flat_runtime,
    write_zip_from_directory,
)
from web_lite3.constants import APP_WINDOWS_ARCHIVE_NAME, APP_WINDOWS_LAUNCHER_EXE


ARCHIVE_NAME = APP_WINDOWS_ARCHIVE_NAME
LAUNCHER_NAME = APP_WINDOWS_LAUNCHER_EXE

def run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    subprocess.run(command, cwd=str(cwd) if cwd else None, env=env, check=True)


def publish_windows_launcher(root: Path, output_dir: Path) -> Path:
    csproj = root / "launcher-win-source" / "GoDreamAILauncher.Win.csproj"
    clean_path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run(
        [
            "dotnet",
            "publish",
            str(csproj),
            "-c",
            "Release",
            "-r",
            "win-x64",
            "-p:PublishSingleFile=true",
            "-p:SelfContained=true",
            "-p:IncludeNativeLibrariesForSelfExtract=true",
            "-o",
            str(output_dir),
        ],
        cwd=root,
    )
    launcher_exe = output_dir / LAUNCHER_NAME
    if launcher_exe.exists():
        return launcher_exe
    matches = sorted(output_dir.glob("*.exe"))
    if len(matches) == 1:
        return matches[0]
    raise SystemExit(f"failed to locate published launcher exe in {output_dir}")


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    build_dir = root / ".launcher-build" / "windows"
    publish_dir = build_dir / "publish"
    python_cache_dir = build_dir / "python-cache"
    common_runtime_dir = build_dir / "runtime-common"
    payload_runtime_dir = build_dir / "runtime-windows-x64"
    wheelhouse_dir = build_dir / "wheelhouse"
    video_tools_cache_dir = build_dir / "video-tools"
    dist_dir = root / "dist"
    staging_dir = build_dir / "staging"
    archive_path = dist_dir / ARCHIVE_NAME

    launcher_exe = publish_windows_launcher(root, publish_dir)
    python_runtime_dir = build_windows_python_runtime(python_cache_dir)
    built_wheelhouse_dir = build_wheelhouse(root, python_runtime_dir / "python.exe", wheelhouse_dir)
    video_tools_dir = prepare_windows_video_tools(video_tools_cache_dir)
    build_common_runtime(root, common_runtime_dir)

    clean_path(payload_runtime_dir)
    payload_runtime_dir.mkdir(parents=True, exist_ok=True)
    copy_tree(python_runtime_dir, payload_runtime_dir / "python")
    copy_tree(built_wheelhouse_dir, payload_runtime_dir / "wheelhouse")
    copy_tree(video_tools_dir, payload_runtime_dir / "ffmpeg")

    clean_path(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(launcher_exe, staging_dir / LAUNCHER_NAME)

    stage_flat_runtime(common_runtime_dir, payload_runtime_dir, staging_dir / "runtime")
    copy_windows_top_level(root, staging_dir)

    final_archive = write_zip_from_directory(staging_dir, archive_path)
    print(f"Created Windows release archive: {final_archive}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
