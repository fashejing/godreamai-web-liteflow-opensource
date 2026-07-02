from __future__ import annotations

import os
import tarfile
from pathlib import Path

from scripts.runtime_packaging import (
    build_common_runtime,
    ensure_macos_payload_executables,
    extract_tar_gz,
    macos_runtime_target_for_machine,
    stage_flat_runtime,
    write_tar_gz_from_directory,
)
from web_lite3.constants import APP_RUNTIME_MACOS_ARM64_TARGET, APP_RUNTIME_MACOS_X86_64_TARGET
from web_lite3.files import resolve_runtime_tool


def write_file(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def file_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def make_common_runtime_source(root: Path) -> None:
    write_file(root / "README.md", "readme")
    write_file(root / "requirements.txt", "fastapi==0.1")
    write_file(root / "scripts" / "launcher_backend.py", "print('launcher')")
    write_file(root / "scripts" / "check_python_runtime.py", "print('check')")
    write_file(root / "scripts" / "start_lite3.sh", "#!/bin/sh\n")
    write_file(root / "scripts" / "start_lite3.bat", "@echo off\r\n")
    write_file(root / "web_lite3" / "__init__.py", "__all__ = []")


def test_macos_runtime_target_for_machine_maps_supported_architectures():
    assert macos_runtime_target_for_machine("arm64") == APP_RUNTIME_MACOS_ARM64_TARGET
    assert macos_runtime_target_for_machine("aarch64") == APP_RUNTIME_MACOS_ARM64_TARGET
    assert macos_runtime_target_for_machine("x86_64") == APP_RUNTIME_MACOS_X86_64_TARGET
    assert macos_runtime_target_for_machine("amd64") == APP_RUNTIME_MACOS_X86_64_TARGET


def test_build_common_runtime_copies_shared_payload_tree(tmp_path):
    make_common_runtime_source(tmp_path)

    target_dir = build_common_runtime(tmp_path, tmp_path / "out")

    assert (target_dir / "README.md").exists()
    assert (target_dir / "requirements.txt").exists()
    assert (target_dir / "scripts" / "launcher_backend.py").exists()
    assert (target_dir / "scripts" / "start_lite3.sh").exists()
    assert (target_dir / "scripts" / "start_lite3.bat").exists()
    assert (target_dir / "web_lite3" / "__init__.py").exists()


def test_stage_flat_runtime_merges_common_and_platform_payload(tmp_path):
    common_dir = tmp_path / "common"
    payload_dir = tmp_path / "payload"
    target_dir = tmp_path / "runtime"
    write_file(common_dir / "README.md", "readme")
    write_file(common_dir / "web_lite3" / "__init__.py", "__all__ = []")
    write_file(payload_dir / "python" / "bin" / "python3.11", "python")
    write_file(payload_dir / "wheelhouse" / "fastapi.whl", "wheel")
    write_file(payload_dir / "ffmpeg" / "bin" / "ffmpeg", "ffmpeg")

    stage_flat_runtime(common_dir, payload_dir, target_dir)

    assert (target_dir / "README.md").exists()
    assert (target_dir / "web_lite3" / "__init__.py").exists()
    assert (target_dir / "python" / "bin" / "python3.11").exists()
    assert (target_dir / "wheelhouse" / "fastapi.whl").exists()
    assert (target_dir / "ffmpeg" / "bin" / "ffmpeg").exists()


def test_resolve_runtime_tool_prefers_packaged_macos_binary(tmp_path):
    ffmpeg_path = tmp_path / "ffmpeg" / "bin" / "ffmpeg"
    write_file(ffmpeg_path, "binary")

    assert resolve_runtime_tool("ffmpeg", root_dir=tmp_path) == ffmpeg_path.resolve()


def test_write_tar_gz_from_directory_preserves_executable_mode(tmp_path):
    if os.name == "nt":
        return
    payload_dir = tmp_path / "payload"
    python_path = payload_dir / "python" / "bin" / "python3.11"
    write_file(python_path, "python")
    python_path.chmod(0o755)

    archive_path = write_tar_gz_from_directory(payload_dir, tmp_path / "payload.tar.gz", arcname="macos-arm64")
    with tarfile.open(archive_path, "r:gz") as handle:
        member = handle.getmember("macos-arm64/python/bin/python3.11")
    assert member.mode == 0o755

    extract_dir = extract_tar_gz(archive_path, tmp_path / "extracted")
    extracted_python = extract_dir / "macos-arm64" / "python" / "bin" / "python3.11"
    assert extracted_python.exists()
    assert file_mode(extracted_python) == 0o755


def test_ensure_macos_payload_executables_only_updates_runtime_binaries(tmp_path):
    payload_dir = tmp_path / "payload"
    python_path = payload_dir / "python" / "bin" / "python3.11"
    ffmpeg_path = payload_dir / "ffmpeg" / "bin" / "ffmpeg"
    wheel_path = payload_dir / "wheelhouse" / "fastapi.whl"
    write_file(python_path, "python")
    write_file(ffmpeg_path, "ffmpeg")
    write_file(wheel_path, "wheel")
    python_path.chmod(0o644)
    ffmpeg_path.chmod(0o644)
    wheel_path.chmod(0o644)

    ensure_macos_payload_executables(payload_dir)

    assert file_mode(python_path) == 0o755
    assert file_mode(ffmpeg_path) == 0o755
    assert file_mode(wheel_path) == 0o644
