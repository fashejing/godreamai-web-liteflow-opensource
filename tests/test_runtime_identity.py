from __future__ import annotations

from pathlib import Path

from web_lite3.runtime_identity import compute_runtime_id


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def make_runtime_tree(root: Path) -> None:
    write_file(root / "README.md", "readme")
    write_file(root / "requirements.txt", "fastapi==1.0")
    write_file(root / "scripts" / "build.py", "print('build')")
    write_file(root / "web_lite3" / "__init__.py", "__all__ = []")


def test_compute_runtime_id_ignores_runtime_generated_dirs(tmp_path):
    make_runtime_tree(tmp_path)
    before = compute_runtime_id(tmp_path)

    write_file(tmp_path / "__pycache__" / "cache.pyc", "cache")
    write_file(tmp_path / ".launcher-runtime" / "server.log", "runtime log")
    write_file(tmp_path / ".venv" / "Scripts" / "python.exe", "embedded python")
    write_file(tmp_path / "web_lite3" / "__pycache__" / "mod.pyc", "cache")

    after = compute_runtime_id(tmp_path)

    assert after == before


def test_compute_runtime_id_changes_with_static_payload(tmp_path):
    make_runtime_tree(tmp_path)
    before = compute_runtime_id(tmp_path)

    write_file(tmp_path / "web_lite3" / "app.py", "print('v1')")
    changed = compute_runtime_id(tmp_path)
    write_file(tmp_path / "web_lite3" / "app.py", "print('v2')")
    after = compute_runtime_id(tmp_path)

    assert changed != before
    assert after != changed


def test_compute_runtime_id_includes_ffmpeg_payload(tmp_path):
    make_runtime_tree(tmp_path)
    before = compute_runtime_id(tmp_path)

    write_file(tmp_path / "ffmpeg" / "bin" / "ffmpeg.exe", "ffmpeg-v1")
    changed = compute_runtime_id(tmp_path)
    write_file(tmp_path / "ffmpeg" / "bin" / "ffprobe.exe", "ffprobe-v2")
    after = compute_runtime_id(tmp_path)

    assert changed != before
    assert after != changed
