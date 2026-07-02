#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web_lite3.constants import (
    APP_RUNTIME_COMMON_DIRNAME,
    APP_RUNTIME_MACOS_ARM64_TARGET,
    APP_RUNTIME_MACOS_TARGETS,
    APP_RUNTIME_MACOS_X86_64_TARGET,
)


COMMON_RUNTIME_INCLUDE_PATHS = [
    "README.md",
    "requirements.txt",
    "scripts/launcher_backend.py",
    "scripts/check_python_runtime.py",
    "scripts/start_lite3.sh",
    "scripts/start_lite3.bat",
    "web_lite3",
]
WINDOWS_TOP_LEVEL_INCLUDE_PATHS = [
    "launcher-win-source/START-HERE.txt",
]

WINDOWS_PYTHON_NUGET_VERSION = "3.11.9"
WINDOWS_FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

MACOS_PYTHON_STANDALONE_RELEASE = "20260408"
MACOS_PYTHON_STANDALONE_VERSION = "3.11.15"
MACOS_PYTHON_STANDALONE_URLS = {
    APP_RUNTIME_MACOS_ARM64_TARGET: (
        "https://github.com/astral-sh/python-build-standalone/releases/download/"
        "20260408/cpython-3.11.15%2B20260408-aarch64-apple-darwin-install_only_stripped.tar.gz"
    ),
    APP_RUNTIME_MACOS_X86_64_TARGET: (
        "https://github.com/astral-sh/python-build-standalone/releases/download/"
        "20260408/cpython-3.11.15%2B20260408-x86_64-apple-darwin-install_only_stripped.tar.gz"
    ),
}


def run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    subprocess.run(command, cwd=str(cwd) if cwd else None, env=env, check=True)


def clean_path(path: Path) -> None:
    if not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def copy_tree(source: Path, target: Path) -> None:
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def build_common_runtime(root: Path, target_dir: Path) -> Path:
    clean_path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    for relative in COMMON_RUNTIME_INCLUDE_PATHS:
        source = root / relative
        if not source.exists():
            raise FileNotFoundError(f"missing runtime source path: {source}")
        copy_tree(source, target_dir / relative)
    return target_dir


def copy_windows_top_level(root: Path, target_dir: Path) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    for relative in WINDOWS_TOP_LEVEL_INCLUDE_PATHS:
        source = root / relative
        if not source.exists():
            raise FileNotFoundError(f"missing windows top-level path: {source}")
        copy_tree(source, target_dir / source.name)
    return target_dir


def write_zip_from_directory(source_dir: Path, archive_path: Path) -> Path:
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists():
        archive_path.unlink()
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as handle:
        for file_path in sorted(source_dir.rglob("*")):
            if file_path.is_dir():
                continue
            handle.write(file_path, arcname=file_path.relative_to(source_dir))
    return archive_path


def write_tar_gz_from_directory(source_dir: Path, archive_path: Path, *, arcname: str | None = None) -> Path:
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists():
        archive_path.unlink()
    with tarfile.open(archive_path, "w:gz") as handle:
        handle.add(source_dir, arcname=arcname or source_dir.name)
    return archive_path


def download(url: str, target_path: Path) -> Path:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if not target_path.exists():
        urllib.request.urlretrieve(url, target_path)
    return target_path


def extract_zip(archive_path: Path, output_dir: Path) -> Path:
    clean_path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as handle:
        handle.extractall(output_dir)
    return output_dir


def extract_tar_gz(archive_path: Path, output_dir: Path) -> Path:
    clean_path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "r:gz") as handle:
        handle.extractall(output_dir)
    return output_dir


def build_wheelhouse(root: Path, python_exe: Path, wheelhouse_dir: Path) -> Path:
    clean_path(wheelhouse_dir)
    wheelhouse_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    run([str(python_exe), "-m", "ensurepip", "--upgrade"], cwd=root, env=env)
    run(
        [
            str(python_exe),
            "-m",
            "pip",
            "download",
            "--only-binary=:all:",
            "--dest",
            str(wheelhouse_dir),
            "-r",
            str(root / "requirements.txt"),
        ],
        cwd=root,
        env=env,
    )
    if not any(wheelhouse_dir.glob("*.whl")):
        raise SystemExit(f"wheelhouse build produced no wheels: {wheelhouse_dir}")
    return wheelhouse_dir


def _find_binary(root: Path, name: str) -> Path:
    matches = sorted(root.rglob(name))
    if not matches:
        raise FileNotFoundError(f"missing {name} in {root}")
    return matches[0]


def build_windows_python_runtime(cache_dir: Path) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive_path = cache_dir / f"python-{WINDOWS_PYTHON_NUGET_VERSION}.nupkg"
    extract_dir = cache_dir / f"python-{WINDOWS_PYTHON_NUGET_VERSION}"
    if not archive_path.exists():
        url = f"https://www.nuget.org/api/v2/package/python/{WINDOWS_PYTHON_NUGET_VERSION}"
        urllib.request.urlretrieve(url, archive_path)
    extract_zip(archive_path, extract_dir)
    tools_dir = extract_dir / "tools"
    python_exe = tools_dir / "python.exe"
    if not python_exe.exists():
        raise SystemExit(f"downloaded Python runtime is missing python.exe: {tools_dir}")
    return tools_dir


def prepare_windows_video_tools(cache_dir: Path) -> Path:
    archive_path = download(WINDOWS_FFMPEG_URL, cache_dir / "ffmpeg-windows.zip")
    extract_dir = extract_zip(archive_path, cache_dir / "ffmpeg-windows")
    ffmpeg_binary = _find_binary(extract_dir, "ffmpeg.exe")
    ffprobe_binary = _find_binary(extract_dir, "ffprobe.exe")
    tools_dir = cache_dir / "runtime-ffmpeg-windows" / "bin"
    clean_path(tools_dir.parent)
    tools_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ffmpeg_binary, tools_dir / "ffmpeg.exe")
    shutil.copy2(ffprobe_binary, tools_dir / "ffprobe.exe")
    return tools_dir.parent


def normalize_macos_runtime_target(value: str) -> str:
    normalized = str(value or "").strip()
    if normalized not in APP_RUNTIME_MACOS_TARGETS:
        raise ValueError(f"unsupported macOS runtime target: {value}")
    return normalized


def macos_runtime_target_for_machine(machine: str) -> str:
    normalized = str(machine or "").strip().lower()
    if normalized in {"arm64", "aarch64"}:
        return APP_RUNTIME_MACOS_ARM64_TARGET
    if normalized in {"x86_64", "amd64"}:
        return APP_RUNTIME_MACOS_X86_64_TARGET
    raise ValueError(f"unsupported macOS machine architecture: {machine}")


def current_macos_runtime_target() -> str:
    return macos_runtime_target_for_machine(os.uname().machine)


def build_macos_python_runtime(cache_dir: Path, target: str) -> Path:
    runtime_target = normalize_macos_runtime_target(target)
    archive_url = MACOS_PYTHON_STANDALONE_URLS[runtime_target]
    archive_name = archive_url.rsplit("/", 1)[-1].replace("%2B", "+")
    archive_path = download(archive_url, cache_dir / archive_name)
    extract_dir = extract_tar_gz(archive_path, cache_dir / runtime_target)
    python_dir = extract_dir / "python"
    python_exe = python_dir / "bin" / "python3.11"
    if not python_exe.exists():
        raise SystemExit(f"downloaded macOS runtime is missing python3.11: {python_dir}")
    return python_dir


def prepare_macos_video_tools(output_dir: Path) -> Path:
    ffmpeg_raw = os.environ.get("GODREAMAI_MACOS_FFMPEG_BIN") or shutil.which("ffmpeg")
    ffprobe_raw = os.environ.get("GODREAMAI_MACOS_FFPROBE_BIN") or shutil.which("ffprobe")
    if not ffmpeg_raw:
        raise SystemExit("unable to locate ffmpeg for macOS packaging; set GODREAMAI_MACOS_FFMPEG_BIN or install ffmpeg")
    if not ffprobe_raw:
        raise SystemExit("unable to locate ffprobe for macOS packaging; set GODREAMAI_MACOS_FFPROBE_BIN or install ffprobe")
    ffmpeg_source = Path(ffmpeg_raw).expanduser().resolve()
    ffprobe_source = Path(ffprobe_raw).expanduser().resolve()
    if not ffmpeg_source.exists():
        raise SystemExit("unable to locate ffmpeg for macOS packaging; set GODREAMAI_MACOS_FFMPEG_BIN or install ffmpeg")
    if not ffprobe_source.exists():
        raise SystemExit("unable to locate ffprobe for macOS packaging; set GODREAMAI_MACOS_FFPROBE_BIN or install ffprobe")
    tools_dir = output_dir / "bin"
    clean_path(output_dir)
    tools_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ffmpeg_source, tools_dir / "ffmpeg")
    shutil.copy2(ffprobe_source, tools_dir / "ffprobe")
    for item in (tools_dir / "ffmpeg", tools_dir / "ffprobe"):
        item.chmod(0o755)
    return output_dir


def ensure_directory_file_mode(root: Path, *, mode: int) -> None:
    if not root.exists():
        return
    for item in sorted(root.rglob("*")):
        if item.is_file():
            item.chmod(mode)


def ensure_macos_payload_executables(root_dir: Path) -> None:
    ensure_directory_file_mode(root_dir / "python" / "bin", mode=0o755)
    ensure_directory_file_mode(root_dir / "ffmpeg" / "bin", mode=0o755)


def stage_flat_runtime(common_dir: Path, payload_dir: Path, target_dir: Path) -> Path:
    clean_path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    for file_path in sorted(common_dir.rglob("*")):
        if file_path.is_dir():
            continue
        copy_tree(file_path, target_dir / file_path.relative_to(common_dir))
    for relative in ("python", "wheelhouse", "ffmpeg"):
        source = payload_dir / relative
        if not source.exists():
            raise FileNotFoundError(f"missing payload path: {source}")
        copy_tree(source, target_dir / relative)
    return target_dir


def embedded_runtime_layout(root_dir: Path) -> Path:
    return root_dir / "runtime" / APP_RUNTIME_COMMON_DIRNAME
