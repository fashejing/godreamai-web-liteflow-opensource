from __future__ import annotations

import hashlib
from pathlib import Path


RUNTIME_ID_INCLUDE_PATHS = (
    "README.md",
    "requirements.txt",
    "scripts",
    "web_lite3",
    "ffmpeg",
    "python",
    "wheelhouse",
)
RUNTIME_ID_EXCLUDED_DIR_NAMES = {"__pycache__", ".launcher-runtime"}
RUNTIME_ID_EXCLUDED_FILE_SUFFIXES = {".pyc", ".pyo"}


def _default_root_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def _should_skip_file(root_dir: Path, file_path: Path) -> bool:
    try:
        relative = file_path.relative_to(root_dir)
    except ValueError:
        return True
    parts = relative.parts
    if not parts:
        return True
    if parts[0].startswith(".venv"):
        return True
    if any(part in RUNTIME_ID_EXCLUDED_DIR_NAMES for part in parts[:-1]):
        return True
    if file_path.suffix.lower() in RUNTIME_ID_EXCLUDED_FILE_SUFFIXES:
        return True
    return False


def _iter_runtime_files(root_dir: Path):
    for relative_path in RUNTIME_ID_INCLUDE_PATHS:
        candidate = root_dir / relative_path
        if not candidate.exists():
            continue
        if candidate.is_file():
            if not _should_skip_file(root_dir, candidate):
                yield candidate
            continue
        for file_path in sorted(candidate.rglob("*")):
            if not file_path.is_file():
                continue
            if _should_skip_file(root_dir, file_path):
                continue
            yield file_path


def compute_runtime_id(root_dir: str | Path | None = None) -> str:
    resolved_root = Path(root_dir or _default_root_dir()).expanduser().resolve()
    digest = hashlib.sha256()
    for file_path in _iter_runtime_files(resolved_root):
        relative = file_path.relative_to(resolved_root).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        with file_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()[:16]
