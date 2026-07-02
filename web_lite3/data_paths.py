from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from web_lite3.constants import APP_HOME_DEFAULT_DIRNAME, APP_HOME_ENV


@dataclass(frozen=True)
class AppPaths:
    home_dir: Path
    settings_file: Path
    storage_dir: Path


@dataclass(frozen=True)
class StoragePaths:
    root_dir: Path
    repository_dir: Path
    repository_db: Path
    images_dir: Path
    videos_dir: Path
    thumbs_dir: Path
    uploads_dir: Path
    source_dir: Path
    request_assets_dir: Path
    blender_dir: Path


def resolve_app_home(explicit_home: str | Path | None = None) -> Path:
    if explicit_home:
        return Path(explicit_home).expanduser().resolve()
    env_value = Path.home()
    raw_env = __import__("os").environ.get(APP_HOME_ENV, "").strip()
    if raw_env:
        env_value = Path(raw_env).expanduser()
    else:
        env_value = Path.home() / APP_HOME_DEFAULT_DIRNAME
    return env_value.resolve()


def ensure_app_paths(explicit_home: str | Path | None = None) -> AppPaths:
    home_dir = resolve_app_home(explicit_home)
    home_dir.mkdir(parents=True, exist_ok=True)
    storage_dir = home_dir / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    return AppPaths(
        home_dir=home_dir,
        settings_file=home_dir / "settings.json",
        storage_dir=storage_dir,
    )


def ensure_storage_paths(storage_root: str | Path) -> StoragePaths:
    root_dir = Path(storage_root).expanduser().resolve()
    root_dir.mkdir(parents=True, exist_ok=True)
    repository_dir = root_dir / "repository"
    images_dir = root_dir / "images"
    videos_dir = root_dir / "videos"
    thumbs_dir = root_dir / "thumbs"
    uploads_dir = root_dir / "uploads"
    source_dir = root_dir / "source"
    request_assets_dir = root_dir / "request-assets"
    blender_dir = root_dir / "blender"
    for item in (
        repository_dir,
        images_dir,
        videos_dir,
        thumbs_dir,
        uploads_dir,
        source_dir,
        request_assets_dir,
        blender_dir,
    ):
        item.mkdir(parents=True, exist_ok=True)
    return StoragePaths(
        root_dir=root_dir,
        repository_dir=repository_dir,
        repository_db=repository_dir / "lite3.db",
        images_dir=images_dir,
        videos_dir=videos_dir,
        thumbs_dir=thumbs_dir,
        uploads_dir=uploads_dir,
        source_dir=source_dir,
        request_assets_dir=request_assets_dir,
        blender_dir=blender_dir,
    )
