from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from scripts.build_macos_release import create_macos_archive_with_ditto, normalize_bundle_runtime_executables


pytestmark = pytest.mark.skipif(sys.platform != "darwin", reason="macOS-only packaging test")


def write_file(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def file_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def test_create_macos_archive_with_ditto_preserves_runtime_executable_bits(tmp_path):
    bundle_dir = tmp_path / "GoDreamAI Plus.app"
    launcher_path = bundle_dir / "Contents" / "MacOS" / "GoDreamAI Plus"
    python311_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-arm64" / "python" / "bin" / "python3.11"
    python3_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-arm64" / "python" / "bin" / "python3"
    ffmpeg_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-arm64" / "ffmpeg" / "bin" / "ffmpeg"
    ffprobe_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-arm64" / "ffmpeg" / "bin" / "ffprobe"
    x86_python311_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "python" / "bin" / "python3.11"
    x86_python3_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "python" / "bin" / "python3"
    x86_ffmpeg_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "ffmpeg" / "bin" / "ffmpeg"
    x86_ffprobe_path = bundle_dir / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "ffmpeg" / "bin" / "ffprobe"

    for path in (
        launcher_path,
        python311_path,
        python3_path,
        ffmpeg_path,
        ffprobe_path,
        x86_python311_path,
        x86_python3_path,
        x86_ffmpeg_path,
        x86_ffprobe_path,
    ):
        write_file(path, path.name)
        path.chmod(0o644)

    launcher_path.chmod(0o755)
    normalize_bundle_runtime_executables(bundle_dir)

    archive_path = tmp_path / "GoDreamAI-Plus-macOS.zip"
    create_macos_archive_with_ditto(bundle_dir, archive_path)

    extract_dir = tmp_path / "extracted"
    subprocess.run(["/usr/bin/ditto", "-x", "-k", str(archive_path), str(extract_dir)], check=True)

    extracted_bundle = extract_dir / bundle_dir.name
    assert extracted_bundle.exists()
    assert file_mode(extracted_bundle / "Contents" / "MacOS" / "GoDreamAI Plus") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-arm64" / "python" / "bin" / "python3.11") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-arm64" / "python" / "bin" / "python3") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-arm64" / "ffmpeg" / "bin" / "ffmpeg") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-arm64" / "ffmpeg" / "bin" / "ffprobe") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "python" / "bin" / "python3.11") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "python" / "bin" / "python3") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "ffmpeg" / "bin" / "ffmpeg") == 0o755
    assert file_mode(extracted_bundle / "Contents" / "Resources" / "runtime" / "macos-x86_64" / "ffmpeg" / "bin" / "ffprobe") == 0o755
