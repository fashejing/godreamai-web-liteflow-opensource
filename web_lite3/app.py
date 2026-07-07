from __future__ import annotations

import datetime as dt
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from web_lite3.constants import (
    APP_NAME,
    APP_BRAND_SIDEBAR_TITLE,
    APP_BRAND_SIDEBAR_TITLE_EMPHASIS,
    APP_BRAND_SIDEBAR_TITLE_REST,
    APP_BRAND_SIDEBAR_SUBTITLE,
    APP_BRAND_SUBTITLE,
    APP_BRAND_TITLE,
    APP_BRAND_TITLE_EMPHASIS,
    APP_BRAND_TITLE_REST,
    APP_DISPLAY_RELEASE_VERSION,
    APP_HEALTH_NAME,
    DEFAULT_IMAGE_MODEL_VARIANT,
    DOMESTIC_DOC_LINKS,
    IMAGE_KIND,
    IMAGE_MODELS,
    IMAGE_PROVIDER_API_KEY_FIELDS,
    IMAGE_PRICING_HINT,
    JOB_STATUS_CANCEL_REQUESTED,
    JOB_STATUS_CANCELLED,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCEEDED,
    JOB_TERMINAL_STATUSES,
    KLING_IMAGE_MODES,
    RECORD_CARD_SIZE_OPTIONS,
    SEEDREAM_IMAGE_MODES,
    THEMES,
    THEME_OPTIONS,
    VIDEO_KIND,
    VIDEO_MODELS,
    VIDEO_PROVIDER_API_KEY_FIELDS,
    VIDEO_PRICING_HINT,
    VIDEO_SCENES,
    image_mode_label,
    image_model_provider,
    image_model_size_options,
    video_model_provider,
    video_scene_label,
)
from web_lite3.data_paths import ensure_app_paths, ensure_storage_paths
from web_lite3.files import (
    copy_local_file,
    create_image_thumbnail,
    create_video_thumbnail,
    download_remote_file,
    file_sha256,
    is_supported_image_file,
    public_file_url,
    resolve_runtime_tool,
    resolve_public_file,
    save_upload_stream,
)
from web_lite3.history_repair import HistoryRepairService
from web_lite3.history_store import HistoryStore, HistoryStoreRegistry
from web_lite3.jobs import JobCancelledError, JobRegistry
from web_lite3.network import ProviderNetworkManager
from web_lite3.runtime_identity import compute_runtime_id
from web_lite3.schemas import (
    CanvasGridSplitPayload,
    CanvasResultToLibraryPayload,
    CanvasRunPayload,
    CanvasStatePayload,
    DeleteHistoryPayload,
    ImageGenerateRequest,
    LibrarySourceConnectPayload,
    SettingsPayload,
    VideoGenerateRequest,
    image_ui_schema,
    video_ui_schema,
)
from web_lite3.services import ImageGenerationService, VideoGenerationService
from web_lite3.settings_store import AppSettings, SettingsStore
from web_lite3.system_dialogs import pick_directory


def create_app(
    *,
    home_dir: str | Path | None = None,
    image_gateway_factory=None,
    video_gateway_factory=None,
) -> FastAPI:
    package_dir = Path(__file__).resolve().parent
    runtime_root = package_dir.parent
    runtime_id = compute_runtime_id(runtime_root)
    paths = ensure_app_paths(home_dir)
    settings_store = SettingsStore(paths)
    history_store_registry = HistoryStoreRegistry()
    history_repair = HistoryRepairService()
    jobs = JobRegistry()
    blender_render_jobs: dict[str, dict[str, Any]] = {}
    blender_render_jobs_lock = threading.Lock()
    orphan_candidate_statuses = {
        JOB_STATUS_PENDING,
        JOB_STATUS_RUNNING,
        JOB_STATUS_CANCEL_REQUESTED,
        "queued",
    }
    orphan_grace_seconds = 300
    orphan_status_grace_overrides = {
        JOB_STATUS_PENDING: 300,
        "queued": 2700,
        JOB_STATUS_RUNNING: 2700,
        JOB_STATUS_CANCEL_REQUESTED: 900,
    }
    orphan_error_message = "任务状态丢失，服务可能已重启，请重试或删除该记录"

    def _normalize_storage_dir(value: str | Path | None) -> str:
        raw_value = str(value or "").strip()
        target = raw_value or str(paths.storage_dir)
        return str(Path(target).expanduser().resolve())

    def _history_store_for_storage_dir(storage_dir: str | Path) -> HistoryStore:
        return history_store_registry.for_storage_dir(_normalize_storage_dir(storage_dir))

    def _current_settings():
        return settings_store.load()

    def _current_api_key_presence(settings=None) -> dict[str, bool]:
        current = settings or _current_settings()
        return {
            "volcengine": bool(str(getattr(current, "volcengine_api_key", "") or "").strip()),
            "kling": bool(str(getattr(current, "kling_api_key", "") or "").strip()),
        }

    def _current_api_keys(settings=None) -> dict[str, str]:
        current = settings or _current_settings()
        return {
            "volcengine": str(getattr(current, "volcengine_api_key", "") or "").strip(),
            "kling": str(getattr(current, "kling_api_key", "") or "").strip(),
        }

    def _network_status_payload(settings=None) -> dict[str, Any]:
        current = settings or _current_settings()
        manager = ProviderNetworkManager(current)
        payload = manager.status_payload(api_keys=_current_api_key_presence(current))
        providers = payload.get("providers") or {}
        payload["providers"] = {
            "volcengine": providers.get("volcengine", {}),
            "kling": providers.get("kling", {}),
        }
        return payload

    def _preview_settings(payload: SettingsPayload | None) -> AppSettings:
        if payload is None:
            current = _current_settings()
            return AppSettings(**current.to_dict())
        merged = _current_settings().to_dict()
        merged.update(payload.model_dump())
        merged["openai_network_mode"] = "proxy"
        merged["google_network_mode"] = "proxy"
        merged["volcengine_network_mode"] = "direct"
        merged["kling_network_mode"] = "direct"
        return AppSettings(**merged)

    def _current_history_store() -> HistoryStore:
        return _history_store_for_storage_dir(_current_settings().storage_dir)

    def _theme_tokens(theme_name: str) -> dict:
        theme_file = package_dir / "themes" / THEMES[theme_name]
        return json.loads(theme_file.read_text(encoding="utf-8"))

    def _public_storage_file_url(path: str | Path | None, storage_dir: str | Path) -> str | None:
        if not path:
            return None
        storage = ensure_storage_paths(storage_dir)
        try:
            resolved = Path(path).expanduser().resolve()
            resolved.relative_to(storage.root_dir.resolve())
        except Exception:
            return None
        if not resolved.exists() or not resolved.is_file():
            return None
        return public_file_url(resolved, storage.root_dir)

    def _storage_file_from_public_url(value: Any, storage_dir: str | Path) -> Path | None:
        text = str(value or "").strip()
        if not text:
            return None
        parsed_path = urlsplit(text).path if "://" in text else text
        if not parsed_path.startswith("/app-files/"):
            return None
        relative_path = unquote(parsed_path.removeprefix("/app-files/"))
        if not relative_path:
            return None
        try:
            candidate = resolve_public_file(storage_dir, relative_path).resolve()
        except Exception:
            return None
        if candidate.exists() and candidate.is_file():
            return candidate
        return None

    def _existing_storage_file(path: str | Path | None, storage_dir: str | Path) -> Path | None:
        if not path:
            return None
        storage = ensure_storage_paths(storage_dir)
        try:
            candidate = Path(path).expanduser().resolve()
            candidate.relative_to(storage.root_dir.resolve())
        except Exception:
            return None
        if candidate.exists() and candidate.is_file():
            return candidate
        return None

    def _looks_like_remote_url(value: str | Path | None) -> bool:
        text = str(value or "").strip().lower()
        return text.startswith("https://") or text.startswith("http://")

    def _ensure_image_thumbnail_file(
        source_path: str | Path | None,
        storage_dir: str | Path,
        *,
        existing_thumbnail_path: str | Path | None = None,
        prefix: str = "thumb",
        repair: bool = True,
    ) -> tuple[str | None, str | None, bool]:
        storage = ensure_storage_paths(storage_dir)
        resolved_source = None
        if source_path:
            try:
                candidate = Path(source_path).expanduser().resolve()
                candidate.relative_to(storage.root_dir.resolve())
                if candidate.exists() and candidate.is_file():
                    resolved_source = candidate
            except Exception:
                resolved_source = None

        resolved_thumb = None
        if existing_thumbnail_path:
            try:
                candidate = Path(existing_thumbnail_path).expanduser().resolve()
                candidate.relative_to(storage.root_dir.resolve())
                if candidate.exists() and candidate.is_file() and (resolved_source is None or candidate != resolved_source):
                    resolved_thumb = candidate
            except Exception:
                resolved_thumb = None

        if resolved_thumb is not None:
            return str(resolved_thumb), public_file_url(resolved_thumb, storage.root_dir), False

        if resolved_source is None:
            fallback_url = _public_storage_file_url(existing_thumbnail_path, storage.root_dir)
            normalized_path = str(existing_thumbnail_path).strip() if existing_thumbnail_path else None
            return normalized_path or None, fallback_url, False

        if not repair:
            return str(resolved_source), public_file_url(resolved_source, storage.root_dir), False

        created_thumb = create_image_thumbnail(resolved_source, target_dir=storage.thumbs_dir, prefix=prefix)
        if created_thumb is not None:
            return str(created_thumb), public_file_url(created_thumb, storage.root_dir), True

        fallback_url = public_file_url(resolved_source, storage.root_dir)
        return str(existing_thumbnail_path or resolved_source), fallback_url, False

    def _ensure_video_thumbnail_file(
        source_path: str | Path | None,
        storage_dir: str | Path,
        *,
        existing_thumbnail_path: str | Path | None = None,
        existing_thumbnail_url: str | None = None,
        prefix: str = "thumb",
        repair: bool = True,
    ) -> tuple[str | None, str | None, bool]:
        storage = ensure_storage_paths(storage_dir)
        resolved_source = None
        if source_path:
            try:
                candidate = Path(source_path).expanduser().resolve()
                candidate.relative_to(storage.root_dir.resolve())
                if candidate.exists() and candidate.is_file():
                    resolved_source = candidate
            except Exception:
                resolved_source = None

        resolved_thumb = None
        if existing_thumbnail_path:
            try:
                candidate = Path(existing_thumbnail_path).expanduser().resolve()
                candidate.relative_to(storage.root_dir.resolve())
                if candidate.exists() and candidate.is_file():
                    resolved_thumb = candidate
            except Exception:
                resolved_thumb = None

        if resolved_thumb is not None:
            return str(resolved_thumb), public_file_url(resolved_thumb, storage.root_dir), False

        created_thumb = None
        if repair and resolved_source is not None:
            created_thumb = create_video_thumbnail(
                resolved_source,
                target_dir=storage.thumbs_dir,
                prefix=prefix,
                root_dir=runtime_root,
            )
        if created_thumb is not None:
            return str(created_thumb), public_file_url(created_thumb, storage.root_dir), True

        fallback_path = str(existing_thumbnail_path).strip() if existing_thumbnail_path else None
        fallback_url = _public_storage_file_url(existing_thumbnail_path, storage.root_dir)
        normalized_remote_thumb = str(existing_thumbnail_url or "").strip() or None
        return fallback_path, fallback_url or normalized_remote_thumb, False

    def _ensure_asset_thumbnail(
        history_store: HistoryStore | None,
        storage_dir: str,
        asset: dict[str, Any],
        *,
        repair: bool = True,
    ) -> dict[str, Any]:
        item = dict(asset)
        if str(item.get("kind") or "").strip() != "image":
            return item
        thumbnail_path, _thumbnail_url, changed = _ensure_image_thumbnail_file(
            item.get("path"),
            storage_dir,
            existing_thumbnail_path=item.get("thumbnail_path"),
            prefix="asset_thumb",
            repair=repair,
        )
        if not changed:
            if thumbnail_path and not item.get("thumbnail_path"):
                item["thumbnail_path"] = thumbnail_path
            return item
        item["thumbnail_path"] = thumbnail_path
        if history_store is None or not item.get("id"):
            return item
        try:
            return history_store.update_asset_thumbnail(str(item["id"]), thumbnail_path)
        except KeyError:
            return item

    def _asset_payload(
        asset: dict[str, Any],
        storage_dir: str,
        *,
        history_store: HistoryStore | None = None,
        source_categories: list[str] | None = None,
        repair: bool = True,
    ) -> dict[str, Any]:
        item = dict(asset)
        item = _ensure_asset_thumbnail(history_store, storage_dir, item, repair=repair)
        if source_categories:
            item["tag_category"] = _resolve_runtime_tag_category(item.get("tag_category"), source_categories)
        asset_path = Path(item["path"])
        item["public_url"] = f"/asset-files/{item['id']}"
        item["thumbnail_url"] = _public_storage_file_url(item.get("thumbnail_path"), storage_dir) or item["public_url"]
        display_name = str(item.get("display_name") or "").strip()
        item["display_name"] = display_name or Path(item.get("original_name") or asset_path.name).stem or item["id"]
        origin = str(item.get("origin") or "workspace").strip()
        if origin != "workspace":
            item["mention_name"] = f"{item['display_name']}（素材库）"
        else:
            item["mention_name"] = item["display_name"]
        return item

    def _content_hash_for_asset(asset: dict[str, Any], history_store: HistoryStore | None = None) -> str:
        existing = str(asset.get("content_hash") or "").strip().lower()
        if existing:
            return existing
        asset_id = str(asset.get("id") or "").strip()
        asset_path = str(asset.get("path") or "").strip()
        if not asset_id or not asset_path:
            return ""
        try:
            digest = file_sha256(asset_path) or ""
        except OSError:
            return ""
        if digest and history_store is not None:
            try:
                history_store.update_asset_content_hash(asset_id, digest)
                asset["content_hash"] = digest
            except KeyError:
                pass
        return digest

    def _asset_identity_key(asset: dict[str, Any], history_store: HistoryStore | None = None) -> str:
        if str(asset.get("origin") or "").strip() == "library_source":
            asset_path = str(asset.get("path") or "").strip()
            if asset_path:
                try:
                    return f"path:{Path(asset_path).expanduser().resolve()}"
                except OSError:
                    return f"path:{asset_path}"
            asset_id = str(asset.get("id") or "").strip()
            return f"id:{asset_id}" if asset_id else ""
        digest = _content_hash_for_asset(asset, history_store)
        if digest:
            return f"hash:{digest}"
        asset_path = str(asset.get("path") or "").strip()
        if asset_path:
            try:
                return f"path:{Path(asset_path).expanduser().resolve()}"
            except OSError:
                return f"path:{asset_path}"
        asset_id = str(asset.get("id") or "").strip()
        return f"id:{asset_id}" if asset_id else ""

    def _image_dimension_payload(raw_path: Any) -> dict[str, int]:
        image_path = str(raw_path or "").strip()
        if not image_path:
            return {}
        try:
            path = Path(image_path).expanduser().resolve()
            if not path.exists() or not path.is_file():
                return {}
            with Image.open(path) as raw_image:
                image = ImageOps.exif_transpose(raw_image)
                width, height = image.size
        except (OSError, UnidentifiedImageError, ValueError):
            return {}
        if width <= 0 or height <= 0:
            return {}
        return {"width": int(width), "height": int(height)}

    def _mask_api_key(value: str) -> str:
        normalized = str(value or "").strip()
        if len(normalized) <= 8:
            return normalized
        return f"{normalized[:3]}****{normalized[-4:]}"

    def _classify_image_mode(params_requested: dict[str, Any]) -> tuple[str, str]:
        model_variant = str(params_requested.get("model_variant") or "").strip()
        provider = image_model_provider(model_variant) if model_variant in IMAGE_MODELS else "volcengine"
        input_asset_id = str(params_requested.get("input_asset_id") or "").strip()
        reference_asset_ids = [item for item in (params_requested.get("reference_asset_ids") or []) if str(item).strip()]
        if input_asset_id and reference_asset_ids:
            return "multi_image", image_mode_label("multi_image", provider=provider)
        if len(reference_asset_ids) > 1:
            return "multi_image", image_mode_label("multi_image", provider=provider)
        if input_asset_id:
            return "base_only", image_mode_label("base_only", provider=provider)
        if reference_asset_ids:
            return "reference_only", image_mode_label("reference_only", provider=provider)
        return "text_only", image_mode_label("text_only", provider=provider)

    def _normalize_image_mode(mode_key: Any, params_requested: dict[str, Any]) -> tuple[str, str]:
        model_variant = str(params_requested.get("model_variant") or "").strip()
        normalized = str(mode_key or "").strip()
        supported_modes = IMAGE_MODELS.get(model_variant, {}).get("supported_modes") or []
        if normalized in supported_modes:
            return normalized, image_mode_label(normalized, model_variant=model_variant)
        return _classify_image_mode(params_requested)

    def _classify_video_mode(params_requested: dict[str, Any]) -> tuple[str, str]:
        model_variant = str(params_requested.get("model_variant") or "").strip()
        mode_key = str(params_requested.get("scene_type") or "text_only").strip() or "text_only"
        return mode_key, video_scene_label(mode_key, model_variant=model_variant)

    def _history_mode_key(kind: str, params_requested: dict[str, Any]) -> str:
        if kind == IMAGE_KIND:
            return _classify_image_mode(params_requested)[0]
        return _classify_video_mode(params_requested)[0]

    def _asset_display_name(asset: dict[str, Any] | None) -> str | None:
        if not asset:
            return None
        display_name = str(asset.get("display_name") or "").strip()
        if display_name:
            return display_name
        original_name = str(asset.get("original_name") or "").strip()
        if original_name:
            return Path(original_name).stem
        asset_path = str(asset.get("path") or "").strip()
        if asset_path:
            return Path(asset_path).stem
        return str(asset.get("id") or "").strip() or None

    def _asset_name_map(history_store: HistoryStore, asset_ids: list[str | None]) -> dict[str, str]:
        normalized_ids = []
        seen_ids: set[str] = set()
        for asset_id in asset_ids:
            normalized = str(asset_id or "").strip()
            if not normalized or normalized in seen_ids:
                continue
            seen_ids.add(normalized)
            normalized_ids.append(normalized)
        assets = history_store.get_assets_by_ids(normalized_ids)
        return {
            asset_id: _asset_display_name(asset) or ""
            for asset_id, asset in assets.items()
        }

    def _video_asset_name_snapshot(history_store: HistoryStore, payload: VideoGenerateRequest) -> dict[str, Any]:
        name_map = _asset_name_map(
            history_store,
            [payload.first_frame_asset_id, payload.last_frame_asset_id, *payload.reference_image_asset_ids],
        )
        return {
            "first_frame_asset_name": name_map.get(str(payload.first_frame_asset_id or "").strip()) or None,
            "last_frame_asset_name": name_map.get(str(payload.last_frame_asset_id or "").strip()) or None,
            "reference_image_asset_names": [
                name_map[str(asset_id).strip()]
                for asset_id in payload.reference_image_asset_ids
                if str(asset_id or "").strip() and name_map.get(str(asset_id).strip())
            ],
        }

    def _hydrate_history_asset_name_snapshots(history_store: HistoryStore, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        asset_ids: list[str] = []
        for item in items:
            params_requested = item.get("params_requested") or {}
            if item.get("kind") == VIDEO_KIND:
                if not str(params_requested.get("first_frame_asset_name") or "").strip():
                    asset_ids.append(params_requested.get("first_frame_asset_id"))
                if not str(params_requested.get("last_frame_asset_name") or "").strip():
                    asset_ids.append(params_requested.get("last_frame_asset_id"))
                reference_names = params_requested.get("reference_image_asset_names")
                if not (isinstance(reference_names, list) and any(str(name or "").strip() for name in reference_names)):
                    asset_ids.extend(params_requested.get("reference_image_asset_ids") or [])
            elif item.get("kind") == IMAGE_KIND:
                if not str(params_requested.get("input_asset_name") or "").strip():
                    asset_ids.append(params_requested.get("input_asset_id"))
                reference_names = params_requested.get("reference_asset_names")
                if not (isinstance(reference_names, list) and any(str(name or "").strip() for name in reference_names)):
                    asset_ids.extend(params_requested.get("reference_asset_ids") or [])
        name_map = _asset_name_map(history_store, asset_ids)
        enriched_items: list[dict[str, Any]] = []
        updates: list[dict[str, Any]] = []
        for item in items:
            params_requested = dict(item.get("params_requested") or {})
            changed = False
            mode_key = str(item.get("mode_key") or "").strip()
            if item.get("kind") == IMAGE_KIND:
                normalized_mode_key, _mode_label = _normalize_image_mode(mode_key, params_requested)
                if normalized_mode_key != mode_key:
                    mode_key = normalized_mode_key
                    changed = True
            elif not mode_key:
                mode_key = _history_mode_key(str(item.get("kind") or ""), params_requested)
                changed = True
            if item.get("kind") == VIDEO_KIND:
                first_frame_asset_id = str(params_requested.get("first_frame_asset_id") or "").strip()
                if first_frame_asset_id and not str(params_requested.get("first_frame_asset_name") or "").strip():
                    params_requested["first_frame_asset_name"] = name_map.get(first_frame_asset_id) or None
                    changed = True
                last_frame_asset_id = str(params_requested.get("last_frame_asset_id") or "").strip()
                if last_frame_asset_id and not str(params_requested.get("last_frame_asset_name") or "").strip():
                    params_requested["last_frame_asset_name"] = name_map.get(last_frame_asset_id) or None
                    changed = True
                reference_names = params_requested.get("reference_image_asset_names")
                if not (isinstance(reference_names, list) and any(str(name or "").strip() for name in reference_names)):
                    params_requested["reference_image_asset_names"] = [
                        name_map[asset_id]
                        for asset_id in [
                            str(asset_id or "").strip()
                            for asset_id in (params_requested.get("reference_image_asset_ids") or [])
                            if str(asset_id or "").strip()
                        ]
                        if name_map.get(asset_id)
                    ]
                    changed = True
            elif item.get("kind") == IMAGE_KIND:
                input_asset_id = str(params_requested.get("input_asset_id") or "").strip()
                if input_asset_id and not str(params_requested.get("input_asset_name") or "").strip():
                    params_requested["input_asset_name"] = name_map.get(input_asset_id) or None
                    changed = True
                reference_names = params_requested.get("reference_asset_names")
                if not (isinstance(reference_names, list) and any(str(name or "").strip() for name in reference_names)):
                    params_requested["reference_asset_names"] = [
                        name_map[asset_id]
                        for asset_id in [
                            str(asset_id or "").strip()
                            for asset_id in (params_requested.get("reference_asset_ids") or [])
                            if str(asset_id or "").strip()
                        ]
                        if name_map.get(asset_id)
                    ]
                    changed = True
            enriched = dict(item)
            enriched["mode_key"] = mode_key
            enriched["params_requested"] = params_requested
            enriched_items.append(enriched)
            if changed:
                updates.append(
                    {
                        "id": item["id"],
                        "mode_key": mode_key,
                        "params_requested": params_requested,
                    }
                )
        if updates:
            history_store.persist_history_snapshots(updates)
        return enriched_items

    def _normalize_history_artifact(
        artifact: dict[str, Any],
        storage_dir: str,
        *,
        repair: bool = False,
    ) -> tuple[dict[str, Any], bool]:
        item = dict(artifact)
        changed = False
        kind = str(item.get("kind") or "").strip()
        local_path = str(item.get("local_path") or "").strip() or None
        if _existing_storage_file(local_path, storage_dir) is None:
            recovered_path = (
                _storage_file_from_public_url(item.get("public_url"), storage_dir)
                or _storage_file_from_public_url(item.get("thumbnail_url"), storage_dir)
            )
            if recovered_path is not None:
                local_path = str(recovered_path)
                if local_path != item.get("local_path"):
                    item["local_path"] = local_path
                    changed = True
        local_public_url = _public_storage_file_url(local_path, storage_dir)
        public_url = (
            local_public_url
            or str(item.get("public_url") or "").strip()
            or str(item.get("source_url") or "").strip()
        )
        if public_url != item.get("public_url"):
            item["public_url"] = public_url
            changed = True

        if kind == "image":
            thumbnail_path, thumbnail_url, thumb_changed = _ensure_image_thumbnail_file(
                local_path,
                storage_dir,
                existing_thumbnail_path=item.get("thumbnail_path"),
                prefix="history_thumb",
                repair=repair,
            )
            if thumbnail_path != item.get("thumbnail_path"):
                item["thumbnail_path"] = thumbnail_path
                changed = True
            next_thumbnail_url = thumbnail_url or public_url or str(item.get("source_url") or "").strip() or None
            if next_thumbnail_url != item.get("thumbnail_url"):
                item["thumbnail_url"] = next_thumbnail_url
                changed = True
            changed = changed or thumb_changed
            return item, changed

        if kind == "video":
            thumbnail_path, thumbnail_url, thumb_changed = _ensure_video_thumbnail_file(
                local_path,
                storage_dir,
                existing_thumbnail_path=item.get("thumbnail_path"),
                existing_thumbnail_url=str(item.get("thumbnail_url") or "").strip() or None,
                prefix="history_thumb",
                repair=repair,
            )
            if thumbnail_path != item.get("thumbnail_path"):
                item["thumbnail_path"] = thumbnail_path
                changed = True
            next_thumbnail_url = thumbnail_url or str(item.get("thumbnail_url") or "").strip() or None
            if next_thumbnail_url != item.get("thumbnail_url"):
                item["thumbnail_url"] = next_thumbnail_url
                changed = True
            changed = changed or thumb_changed
            return item, changed

        thumbnail_url = (
            _public_storage_file_url(item.get("thumbnail_path"), storage_dir)
            or str(item.get("thumbnail_url") or "").strip()
            or public_url
            or str(item.get("source_url") or "").strip()
            or None
        )
        if thumbnail_url != item.get("thumbnail_url"):
            item["thumbnail_url"] = thumbnail_url
            changed = True
        return item, changed

    def _history_artifact_summary(artifact: dict[str, Any]) -> dict[str, Any]:
        return {
            "kind": str(artifact.get("kind") or "").strip() or "image",
            "public_url": str(artifact.get("public_url") or "").strip() or None,
            "source_url": str(artifact.get("source_url") or "").strip() or None,
            "thumbnail_url": str(artifact.get("thumbnail_url") or "").strip() or None,
        }

    def _is_local_repair_failure_message(value: Any) -> bool:
        return str(value or "").startswith("本地补救失败:")

    def _hide_noncritical_local_repair_error(
        history_store: HistoryStore,
        item: dict[str, Any],
        result_payload: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        if str(item.get("status") or "").strip() != JOB_STATUS_SUCCEEDED:
            return result_payload, False
        error_message = str(item.get("error_message") or "")
        if not _is_local_repair_failure_message(error_message):
            return result_payload, False
        next_payload = dict(result_payload)
        next_payload["_local_repair"] = {
            "status": "failed",
            "message": error_message.removeprefix("本地补救失败:").strip()[:800],
        }
        item["error_message"] = ""
        if not item.get("is_live") and item.get("id"):
            try:
                history_store.update_history_record(
                    str(item["id"]),
                    result_payload=next_payload,
                    error_message="",
                )
            except KeyError:
                pass
        return next_payload, True

    def _history_record_payload(
        history_store: HistoryStore,
        storage_dir: str,
        record: dict[str, Any],
        *,
        view: str,
        repair: bool = False,
    ) -> dict[str, Any]:
        item = dict(record)
        raw_result_payload = dict(item.get("result_payload") or {})
        raw_result_payload, _repair_error_hidden = _hide_noncritical_local_repair_error(
            history_store,
            item,
            raw_result_payload,
        )
        artifacts = list(raw_result_payload.get("artifacts") or [])
        record_local_paths = [
            str(path or "").strip()
            for path in (item.get("local_paths") or [])
            if str(path or "").strip()
        ]
        record_thumbnail_path = str(item.get("thumbnail_path") or "").strip() or None
        normalized_artifacts: list[dict[str, Any]] = []
        artifacts_changed = False
        for index, artifact in enumerate(artifacts):
            artifact_item = dict(artifact)
            local_path = str(artifact_item.get("local_path") or "").strip()
            local_fallback = record_local_paths[index] if index < len(record_local_paths) else None
            if not local_path and local_fallback:
                artifact_item["local_path"] = local_fallback
                artifacts_changed = True
            if index == 0 and record_thumbnail_path and not str(artifact_item.get("thumbnail_path") or "").strip():
                artifact_item["thumbnail_path"] = record_thumbnail_path
                artifacts_changed = True
            normalized, changed = _normalize_history_artifact(artifact_item, storage_dir, repair=repair)
            normalized_artifacts.append(normalized)
            artifacts_changed = artifacts_changed or changed
        if not normalized_artifacts:
            for index, local_path in enumerate(record_local_paths):
                if not local_path:
                    continue
                fallback_artifact = {
                    "kind": str(item.get("kind") or "").strip() or "image",
                    "local_path": str(local_path),
                }
                if index == 0 and record_thumbnail_path:
                    fallback_artifact["thumbnail_path"] = record_thumbnail_path
                normalized_fallback, _fallback_changed = _normalize_history_artifact(
                    fallback_artifact,
                    storage_dir,
                    repair=repair,
                )
                normalized_artifacts.append(normalized_fallback)
                artifacts_changed = True
        if artifacts_changed:
            raw_result_payload["artifacts"] = normalized_artifacts
            item["result_payload"] = raw_result_payload
            item["thumbnail_path"] = normalized_artifacts[0].get("thumbnail_path") if normalized_artifacts else item.get("thumbnail_path")
            if repair and not item.get("is_live") and item.get("id"):
                try:
                    repaired_local_paths = [
                        str(artifact.get("local_path") or "").strip()
                        for artifact in normalized_artifacts
                        if str(artifact.get("local_path") or "").strip()
                    ]
                    history_store.update_history_record(
                        str(item["id"]),
                        result_payload=raw_result_payload,
                        local_paths=repaired_local_paths or None,
                        thumbnail_path=item.get("thumbnail_path"),
                        error_message="",
                    )
                    item["error_message"] = ""
                except KeyError:
                    pass
        else:
            item["result_payload"] = raw_result_payload

        if view != "summary":
            return item

        summary_artifacts = list(normalized_artifacts)

        return {
            "id": item.get("id"),
            "job_id": item.get("job_id"),
            "batch_session_id": item.get("batch_session_id"),
            "batch_position": item.get("batch_position"),
            "kind": item.get("kind"),
            "status": item.get("status"),
            "model_variant": item.get("model_variant"),
            "mode_key": item.get("mode_key"),
            "prompt": item.get("prompt"),
            "params_requested": item.get("params_requested") or {},
            "result_payload": {
                "artifacts": [_history_artifact_summary(artifact) for artifact in summary_artifacts],
            },
            "error_message": item.get("error_message"),
            "elapsed_ms": item.get("elapsed_ms"),
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
            "message": item.get("message"),
            "is_live": bool(item.get("is_live")),
        }

    def _image_asset_name_snapshot(history_store: HistoryStore, payload: ImageGenerateRequest) -> dict[str, Any]:
        name_map = _asset_name_map(
            history_store,
            [payload.input_asset_id, *payload.reference_asset_ids],
        )
        return {
            "input_asset_name": name_map.get(str(payload.input_asset_id or "").strip()) or None,
            "reference_asset_names": [
                name_map[str(asset_id).strip()]
                for asset_id in payload.reference_asset_ids
                if str(asset_id or "").strip() and name_map.get(str(asset_id).strip())
            ],
        }

    def _normalized_asset_id(value: Any) -> str:
        return str(value or "").strip()

    def _ordered_asset_ids(values: Any) -> list[str]:
        if not isinstance(values, (list, tuple)):
            return []
        return [_normalized_asset_id(item) for item in values if _normalized_asset_id(item)]

    def _unique_asset_ids(values: list[str | None]) -> list[str]:
        ordered: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = _normalized_asset_id(value)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            ordered.append(normalized)
        return ordered

    def _snapshot_asset_for_original_id(
        *,
        history_store: HistoryStore,
        storage_dir: str,
        original_asset_id: str,
        original_asset_map: dict[str, dict[str, Any]],
        snapshot_cache: dict[str, dict[str, Any] | None],
    ) -> dict[str, Any] | None:
        normalized_id = _normalized_asset_id(original_asset_id)
        if not normalized_id:
            return None
        if normalized_id in snapshot_cache:
            return snapshot_cache[normalized_id]
        asset = original_asset_map.get(normalized_id)
        if not asset:
            snapshot_cache[normalized_id] = None
            return None
        if str(asset.get("source_mode") or "").strip() == "history_snapshot":
            snapshot_cache[normalized_id] = asset
            return asset
        source_path = _storage_asset_path(asset.get("path"), storage_dir)
        if source_path is None or not source_path.is_file():
            snapshot_cache[normalized_id] = None
            return None
        storage = ensure_storage_paths(storage_dir)
        copied_path = copy_local_file(
            source_path,
            target_dir=storage.request_assets_dir,
            prefix="request_asset",
        )
        copied_thumbnail = create_image_thumbnail(copied_path, target_dir=storage.thumbs_dir, prefix="request_asset_thumb")
        snapshot_asset = history_store.register_asset(
            kind=str(asset.get("kind") or "image"),
            original_name=str(asset.get("original_name") or source_path.name),
            display_name=str(asset.get("display_name") or "").strip() or None,
            tag_category=str(asset.get("tag_category") or "").strip() or None,
            origin=str(asset.get("origin") or "workspace").strip() or "workspace",
            library_visible=False,
            source_mode="history_snapshot",
            path=str(copied_path),
            thumbnail_path=str(copied_thumbnail) if copied_thumbnail else None,
            mime_type=asset.get("mime_type"),
            content_hash=file_sha256(copied_path),
        )
        snapshot_cache[normalized_id] = snapshot_asset
        return snapshot_asset

    def _image_request_snapshot_fields(history_store: HistoryStore, storage_dir: str, params_requested: dict[str, Any]) -> dict[str, Any]:
        input_asset_id = _normalized_asset_id(params_requested.get("input_asset_id"))
        reference_asset_ids = _ordered_asset_ids(params_requested.get("reference_asset_ids"))
        original_asset_map = history_store.get_assets_by_ids(_unique_asset_ids([input_asset_id, *reference_asset_ids]))
        snapshot_cache: dict[str, dict[str, Any] | None] = {}
        input_snapshot_asset = _snapshot_asset_for_original_id(
            history_store=history_store,
            storage_dir=storage_dir,
            original_asset_id=input_asset_id,
            original_asset_map=original_asset_map,
            snapshot_cache=snapshot_cache,
        )
        reference_snapshot_assets = [
            _snapshot_asset_for_original_id(
                history_store=history_store,
                storage_dir=storage_dir,
                original_asset_id=asset_id,
                original_asset_map=original_asset_map,
                snapshot_cache=snapshot_cache,
            )
            for asset_id in reference_asset_ids
        ]
        return {
            "input_snapshot_asset_id": input_snapshot_asset["id"] if input_snapshot_asset else None,
            "reference_snapshot_asset_ids": [asset["id"] for asset in reference_snapshot_assets if asset],
        }

    def _video_request_snapshot_fields(history_store: HistoryStore, storage_dir: str, params_requested: dict[str, Any]) -> dict[str, Any]:
        first_frame_asset_id = _normalized_asset_id(params_requested.get("first_frame_asset_id"))
        last_frame_asset_id = _normalized_asset_id(params_requested.get("last_frame_asset_id"))
        reference_asset_ids = _ordered_asset_ids(params_requested.get("reference_image_asset_ids"))
        original_asset_map = history_store.get_assets_by_ids(
            _unique_asset_ids([first_frame_asset_id, last_frame_asset_id, *reference_asset_ids])
        )
        snapshot_cache: dict[str, dict[str, Any] | None] = {}
        first_frame_snapshot = _snapshot_asset_for_original_id(
            history_store=history_store,
            storage_dir=storage_dir,
            original_asset_id=first_frame_asset_id,
            original_asset_map=original_asset_map,
            snapshot_cache=snapshot_cache,
        )
        last_frame_snapshot = _snapshot_asset_for_original_id(
            history_store=history_store,
            storage_dir=storage_dir,
            original_asset_id=last_frame_asset_id,
            original_asset_map=original_asset_map,
            snapshot_cache=snapshot_cache,
        )
        reference_snapshots = [
            _snapshot_asset_for_original_id(
                history_store=history_store,
                storage_dir=storage_dir,
                original_asset_id=asset_id,
                original_asset_map=original_asset_map,
                snapshot_cache=snapshot_cache,
            )
            for asset_id in reference_asset_ids
        ]
        return {
            "first_frame_snapshot_asset_id": first_frame_snapshot["id"] if first_frame_snapshot else None,
            "last_frame_snapshot_asset_id": last_frame_snapshot["id"] if last_frame_snapshot else None,
            "reference_image_snapshot_asset_ids": [asset["id"] for asset in reference_snapshots if asset],
        }

    def _persist_history_params_requested(
        history_store: HistoryStore,
        record: dict[str, Any],
        params_requested: dict[str, Any],
    ) -> None:
        mode_key = str(record.get("mode_key") or "").strip() or _history_mode_key(
            str(record.get("kind") or ""),
            params_requested,
        )
        history_store.persist_history_snapshots(
            [
                {
                    "id": record["id"],
                    "mode_key": mode_key,
                    "params_requested": params_requested,
                }
            ]
        )

    def _image_missing_reuse_labels(params_requested: dict[str, Any], *, input_missing: bool, missing_reference_indexes: list[int]) -> list[str]:
        labels: list[str] = []
        input_name = str(params_requested.get("input_asset_name") or "").strip()
        if input_missing:
            labels.append(f"基础图：{input_name}" if input_name else "基础图")
        reference_names = params_requested.get("reference_asset_names")
        normalized_reference_names = reference_names if isinstance(reference_names, list) else []
        reference_asset_ids = _ordered_asset_ids(params_requested.get("reference_asset_ids"))
        for index in missing_reference_indexes:
            fallback_name = str(normalized_reference_names[index] or "").strip() if index < len(normalized_reference_names) else ""
            if fallback_name:
                labels.append(f"参考图：{fallback_name}")
                continue
            suffix = str(index + 1) if len(reference_asset_ids) > 1 else ""
            labels.append(f"参考图{suffix}")
        return labels

    def _video_missing_reuse_labels(
        params_requested: dict[str, Any],
        *,
        first_missing: bool,
        last_missing: bool,
        missing_reference_indexes: list[int],
    ) -> list[str]:
        labels: list[str] = []
        first_name = str(params_requested.get("first_frame_asset_name") or "").strip()
        last_name = str(params_requested.get("last_frame_asset_name") or "").strip()
        if first_missing:
            labels.append(f"首帧：{first_name}" if first_name else "首帧")
        if last_missing:
            labels.append(f"尾帧：{last_name}" if last_name else "尾帧")
        reference_names = params_requested.get("reference_image_asset_names")
        normalized_reference_names = reference_names if isinstance(reference_names, list) else []
        reference_asset_ids = _ordered_asset_ids(params_requested.get("reference_image_asset_ids"))
        for index in missing_reference_indexes:
            fallback_name = str(normalized_reference_names[index] or "").strip() if index < len(normalized_reference_names) else ""
            if fallback_name:
                labels.append(f"参考图：{fallback_name}")
                continue
            suffix = str(index + 1) if len(reference_asset_ids) > 1 else ""
            labels.append(f"参考图{suffix}")
        return labels

    def _image_reuse_assets(history_store: HistoryStore, storage_dir: str, record: dict[str, Any]) -> dict[str, Any]:
        params_requested = dict(record.get("params_requested") or {})
        input_asset_id = _normalized_asset_id(params_requested.get("input_asset_id"))
        reference_asset_ids = _ordered_asset_ids(params_requested.get("reference_asset_ids"))
        existing_snapshot_ids = _unique_asset_ids(
            [
                params_requested.get("input_snapshot_asset_id"),
                *(
                    params_requested.get("reference_snapshot_asset_ids")
                    if isinstance(params_requested.get("reference_snapshot_asset_ids"), list)
                    else []
                ),
            ]
        )
        original_asset_map = history_store.get_assets_by_ids(_unique_asset_ids([input_asset_id, *reference_asset_ids]))
        snapshot_asset_map = history_store.get_assets_by_ids(existing_snapshot_ids)
        snapshot_cache: dict[str, dict[str, Any] | None] = {}
        changed = False
        input_snapshot_id = _normalized_asset_id(params_requested.get("input_snapshot_asset_id"))
        input_snapshot_asset = snapshot_asset_map.get(input_snapshot_id) if input_snapshot_id else None
        if not input_snapshot_asset and input_asset_id:
            input_snapshot_asset = _snapshot_asset_for_original_id(
                history_store=history_store,
                storage_dir=storage_dir,
                original_asset_id=input_asset_id,
                original_asset_map=original_asset_map,
                snapshot_cache=snapshot_cache,
            )
        next_input_snapshot_id = input_snapshot_asset["id"] if input_snapshot_asset else None
        if next_input_snapshot_id != (input_snapshot_id or None):
            params_requested["input_snapshot_asset_id"] = next_input_snapshot_id
            changed = True

        current_reference_snapshot_ids = _ordered_asset_ids(params_requested.get("reference_snapshot_asset_ids"))
        next_reference_snapshot_ids: list[str] = []
        reference_assets: list[dict[str, Any]] = []
        missing_reference_indexes: list[int] = []
        for index, original_asset_id in enumerate(reference_asset_ids):
            current_snapshot_id = current_reference_snapshot_ids[index] if index < len(current_reference_snapshot_ids) else ""
            snapshot_asset = snapshot_asset_map.get(current_snapshot_id) if current_snapshot_id else None
            if not snapshot_asset and original_asset_id:
                snapshot_asset = _snapshot_asset_for_original_id(
                    history_store=history_store,
                    storage_dir=storage_dir,
                    original_asset_id=original_asset_id,
                    original_asset_map=original_asset_map,
                    snapshot_cache=snapshot_cache,
                )
            if snapshot_asset:
                next_reference_snapshot_ids.append(snapshot_asset["id"])
                reference_assets.append(snapshot_asset)
            else:
                missing_reference_indexes.append(index)
        if next_reference_snapshot_ids != current_reference_snapshot_ids:
            params_requested["reference_snapshot_asset_ids"] = next_reference_snapshot_ids
            changed = True

        if changed:
            _persist_history_params_requested(history_store, record, params_requested)

        source_categories = _source_asset_tag_categories(history_store)
        return {
            "params_requested": params_requested,
            "assets": {
                "imagePrimary": (
                    _asset_payload(
                        input_snapshot_asset,
                        storage_dir,
                        history_store=history_store,
                        source_categories=source_categories,
                        repair=False,
                    )
                    if input_snapshot_asset
                    else None
                ),
                "imageReferences": [
                    _asset_payload(
                        asset,
                        storage_dir,
                        history_store=history_store,
                        source_categories=source_categories,
                        repair=False,
                    )
                    for asset in reference_assets
                ],
                "videoFirst": None,
                "videoLast": None,
                "videoReferences": [],
            },
            "missing_labels": _image_missing_reuse_labels(
                params_requested,
                input_missing=bool(input_asset_id and not input_snapshot_asset),
                missing_reference_indexes=missing_reference_indexes,
            ),
        }

    def _video_reuse_assets(history_store: HistoryStore, storage_dir: str, record: dict[str, Any]) -> dict[str, Any]:
        params_requested = dict(record.get("params_requested") or {})
        first_frame_asset_id = _normalized_asset_id(params_requested.get("first_frame_asset_id"))
        last_frame_asset_id = _normalized_asset_id(params_requested.get("last_frame_asset_id"))
        reference_asset_ids = _ordered_asset_ids(params_requested.get("reference_image_asset_ids"))
        existing_snapshot_ids = _unique_asset_ids(
            [
                params_requested.get("first_frame_snapshot_asset_id"),
                params_requested.get("last_frame_snapshot_asset_id"),
                *(
                    params_requested.get("reference_image_snapshot_asset_ids")
                    if isinstance(params_requested.get("reference_image_snapshot_asset_ids"), list)
                    else []
                ),
            ]
        )
        original_asset_map = history_store.get_assets_by_ids(
            _unique_asset_ids([first_frame_asset_id, last_frame_asset_id, *reference_asset_ids])
        )
        snapshot_asset_map = history_store.get_assets_by_ids(existing_snapshot_ids)
        snapshot_cache: dict[str, dict[str, Any] | None] = {}
        changed = False

        first_snapshot_id = _normalized_asset_id(params_requested.get("first_frame_snapshot_asset_id"))
        first_snapshot_asset = snapshot_asset_map.get(first_snapshot_id) if first_snapshot_id else None
        if not first_snapshot_asset and first_frame_asset_id:
            first_snapshot_asset = _snapshot_asset_for_original_id(
                history_store=history_store,
                storage_dir=storage_dir,
                original_asset_id=first_frame_asset_id,
                original_asset_map=original_asset_map,
                snapshot_cache=snapshot_cache,
            )
        next_first_snapshot_id = first_snapshot_asset["id"] if first_snapshot_asset else None
        if next_first_snapshot_id != (first_snapshot_id or None):
            params_requested["first_frame_snapshot_asset_id"] = next_first_snapshot_id
            changed = True

        last_snapshot_id = _normalized_asset_id(params_requested.get("last_frame_snapshot_asset_id"))
        last_snapshot_asset = snapshot_asset_map.get(last_snapshot_id) if last_snapshot_id else None
        if not last_snapshot_asset and last_frame_asset_id:
            last_snapshot_asset = _snapshot_asset_for_original_id(
                history_store=history_store,
                storage_dir=storage_dir,
                original_asset_id=last_frame_asset_id,
                original_asset_map=original_asset_map,
                snapshot_cache=snapshot_cache,
            )
        next_last_snapshot_id = last_snapshot_asset["id"] if last_snapshot_asset else None
        if next_last_snapshot_id != (last_snapshot_id or None):
            params_requested["last_frame_snapshot_asset_id"] = next_last_snapshot_id
            changed = True

        current_reference_snapshot_ids = _ordered_asset_ids(params_requested.get("reference_image_snapshot_asset_ids"))
        next_reference_snapshot_ids: list[str] = []
        reference_assets: list[dict[str, Any]] = []
        missing_reference_indexes: list[int] = []
        for index, original_asset_id in enumerate(reference_asset_ids):
            current_snapshot_id = current_reference_snapshot_ids[index] if index < len(current_reference_snapshot_ids) else ""
            snapshot_asset = snapshot_asset_map.get(current_snapshot_id) if current_snapshot_id else None
            if not snapshot_asset and original_asset_id:
                snapshot_asset = _snapshot_asset_for_original_id(
                    history_store=history_store,
                    storage_dir=storage_dir,
                    original_asset_id=original_asset_id,
                    original_asset_map=original_asset_map,
                    snapshot_cache=snapshot_cache,
                )
            if snapshot_asset:
                next_reference_snapshot_ids.append(snapshot_asset["id"])
                reference_assets.append(snapshot_asset)
            else:
                missing_reference_indexes.append(index)
        if next_reference_snapshot_ids != current_reference_snapshot_ids:
            params_requested["reference_image_snapshot_asset_ids"] = next_reference_snapshot_ids
            changed = True

        if changed:
            _persist_history_params_requested(history_store, record, params_requested)

        source_categories = _source_asset_tag_categories(history_store)
        return {
            "params_requested": params_requested,
            "assets": {
                "imagePrimary": None,
                "imageReferences": [],
                "videoFirst": (
                    _asset_payload(
                        first_snapshot_asset,
                        storage_dir,
                        history_store=history_store,
                        source_categories=source_categories,
                        repair=False,
                    )
                    if first_snapshot_asset
                    else None
                ),
                "videoLast": (
                    _asset_payload(
                        last_snapshot_asset,
                        storage_dir,
                        history_store=history_store,
                        source_categories=source_categories,
                        repair=False,
                    )
                    if last_snapshot_asset
                    else None
                ),
                "videoReferences": [
                    _asset_payload(
                        asset,
                        storage_dir,
                        history_store=history_store,
                        source_categories=source_categories,
                        repair=False,
                    )
                    for asset in reference_assets
                ],
            },
            "missing_labels": _video_missing_reuse_labels(
                params_requested,
                first_missing=bool(first_frame_asset_id and not first_snapshot_asset),
                last_missing=bool(last_frame_asset_id and not last_snapshot_asset),
                missing_reference_indexes=missing_reference_indexes,
            ),
        }

    def _path_within_root(candidate: str | Path | None, root: str | Path) -> Path | None:
        if not candidate:
            return None
        try:
            resolved = Path(candidate).expanduser().resolve()
            resolved.relative_to(Path(root).expanduser().resolve())
        except Exception:
            return None
        return resolved

    def _is_within_root(candidate: str | Path | None, root: str | Path) -> bool:
        return _path_within_root(candidate, root) is not None

    def _history_output_paths(record: dict[str, Any]) -> list[Any]:
        paths: list[Any] = [*(record.get("local_paths") or []), record.get("thumbnail_path")]
        artifacts = (record.get("result_payload") or {}).get("artifacts") or []
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                continue
            paths.extend([artifact.get("local_path"), artifact.get("thumbnail_path")])
        return paths

    def _delete_history_outputs(
        record: dict[str, Any],
        storage_dir: str | Path,
        *,
        history_store: HistoryStore | None = None,
    ) -> int:
        storage = ensure_storage_paths(storage_dir)
        allowed_dirs = [
            storage.images_dir.resolve(),
            storage.videos_dir.resolve(),
            storage.thumbs_dir.resolve(),
        ]
        deleted_count = 0
        seen: set[Path] = set()
        deletable_paths: list[Path] = []
        for raw_path in _history_output_paths(record):
            file_path = _path_within_root(raw_path, storage.root_dir)
            if not file_path or file_path in seen:
                continue
            seen.add(file_path)
            if not any(file_path == base or base in file_path.parents for base in allowed_dirs):
                continue
            deletable_paths.append(file_path)
            try:
                file_path.unlink(missing_ok=True)
                deleted_count += 1
            except Exception:
                continue
        if history_store is not None:
            history_store.delete_assets_by_paths([str(path) for path in deletable_paths])
        return deleted_count

    def _storage_asset_path(path: str | Path | None, storage_dir: str, *, within: Path | None = None) -> Path | None:
        storage = ensure_storage_paths(storage_dir)
        candidate = _path_within_root(path, storage.root_dir)
        if not candidate:
            return None
        if within is not None:
            try:
                candidate.relative_to(within.expanduser().resolve())
            except Exception:
                return None
        return candidate

    def _source_asset_path(asset: dict[str, Any]) -> Path | None:
        source_path = str(asset.get("source_path") or "").strip()
        source_root = str(asset.get("source_root") or "").strip()
        if not source_path or not source_root:
            return None
        try:
            root = Path(source_root).expanduser().resolve()
            candidate = Path(source_path).expanduser().resolve()
            candidate.relative_to(root)
        except Exception:
            return None
        return candidate

    def _unlink_checked(path: Path) -> bool:
        try:
            path.unlink()
            return True
        except FileNotFoundError:
            return False

    def _delete_library_asset_payload(asset: dict[str, Any], storage_dir: str) -> dict[str, Any]:
        origin = str(asset.get("origin") or "").strip() or "workspace"
        deleted_source_file = False
        deleted_storage_file = False
        deleted_thumbnail_file = False
        partial_cleanup = False
        warning = None

        primary_path: Path | None = None
        secondary_path: Path | None = None

        if origin == "library_source":
            primary_path = _source_asset_path(asset)
            if primary_path is None:
                raise HTTPException(status_code=409, detail="素材来源路径无效，无法删除本地素材目录中的原文件")
            secondary_path = _storage_asset_path(
                asset.get("path"),
                storage_dir,
                within=ensure_storage_paths(storage_dir).source_dir,
            )
            try:
                deleted_source_file = _unlink_checked(primary_path)
            except OSError as exc:
                raise HTTPException(status_code=409, detail=f"删除本地素材目录中的原文件失败：{exc}") from exc
        elif origin in {"library_upload", "library", "workspace"}:
            primary_path = _storage_asset_path(asset.get("path"), storage_dir)
            if primary_path is None:
                raise HTTPException(status_code=409, detail="素材存储路径无效，无法删除当前资产包中的素材文件")
            try:
                deleted_storage_file = _unlink_checked(primary_path)
            except OSError as exc:
                raise HTTPException(status_code=409, detail=f"删除当前资产包中的素材文件失败：{exc}") from exc
        else:
            primary_path = _storage_asset_path(asset.get("path"), storage_dir)
            if primary_path is not None:
                try:
                    deleted_storage_file = _unlink_checked(primary_path)
                except OSError as exc:
                    raise HTTPException(status_code=409, detail=f"删除当前资产包中的素材文件失败：{exc}") from exc

        history_store = _history_store_for_storage_dir(storage_dir)
        history_store.delete_asset(str(asset.get("id") or ""))

        if secondary_path is not None:
            try:
                deleted_storage_file = _unlink_checked(secondary_path) or deleted_storage_file
            except OSError:
                partial_cleanup = True
                warning = "素材记录已删除，但资产包镜像清理失败"

        thumbnail_path = _storage_asset_path(asset.get("thumbnail_path"), storage_dir)
        if thumbnail_path is not None:
            try:
                deleted_thumbnail_file = _unlink_checked(thumbnail_path)
            except OSError:
                partial_cleanup = True
                warning = warning or "素材记录已删除，但缩略图清理失败"

        return {
            "deleted": True,
            "asset_id": str(asset.get("id") or ""),
            "deleted_source_file": deleted_source_file,
            "deleted_storage_file": deleted_storage_file,
            "deleted_thumbnail_file": deleted_thumbnail_file,
            "partial_cleanup": partial_cleanup,
            "warning": warning,
        }

    def _unique_library_name(
        history_store: HistoryStore,
        category: str,
        desired_name: str,
        *,
        exclude_asset_id: str | None = None,
    ) -> str:
        normalized = str(desired_name or "").strip() or history_store.next_default_asset_name(category)
        names = {
            (str(item.get("display_name") or "").strip(), str(item.get("id") or ""))
            for item in history_store.list_library_assets()
            if item.get("tag_category") == category
        }
        if not any(name == normalized and asset_id != exclude_asset_id for name, asset_id in names):
            return normalized
        index = 2
        while True:
            candidate = f"{normalized}({index})"
            if not any(name == candidate and asset_id != exclude_asset_id for name, asset_id in names):
                return candidate
            index += 1

    def _normalize_tag_category(value: str | None) -> str:
        return str(value or "").strip()

    def _category_semantic_terms(value: str | None) -> set[str]:
        normalized = _normalize_tag_category(value)
        if not normalized:
            return set()
        terms: set[str] = {normalized}
        chinese_index = next((index for index, char in enumerate(normalized) if "\u4e00" <= char <= "\u9fff"), -1)
        semantic = normalized[chinese_index:] if chinese_index >= 0 else normalized
        semantic = semantic.strip("_- ")
        if semantic:
            terms.add(semantic)
        for candidate in list(terms):
            stripped = str(candidate).removesuffix("素材").strip()
            if stripped:
                terms.add(stripped)

        expanded = set(terms)
        for term in list(terms):
            if term in {"角色", "人物"}:
                expanded.update({"角色", "人物"})
            elif term in {"环境", "场景"}:
                expanded.update({"环境", "场景"})
            elif term in {"道具", "物件"}:
                expanded.update({"道具", "物件"})
            elif term in {"其他", "杂项"}:
                expanded.update({"其他", "杂项"})
        return {item for item in expanded if item}

    def _resolve_runtime_tag_category(value: str | None, source_categories: list[str]) -> str:
        normalized = _normalize_tag_category(value)
        if not normalized or not source_categories:
            return normalized
        if normalized in source_categories:
            return normalized

        value_terms = _category_semantic_terms(normalized)
        best_category = normalized
        best_score = 0
        for category in source_categories:
            category_terms = _category_semantic_terms(category)
            score = 0
            overlap = value_terms & category_terms
            if overlap:
                score = 100 + max(len(item) for item in overlap)
            else:
                for left in value_terms:
                    for right in category_terms:
                        if len(left) < 2 or len(right) < 2:
                            continue
                        if left in right or right in left:
                            score = max(score, 10 + min(len(left), len(right)))
            if score > best_score:
                best_score = score
                best_category = category
        return best_category if best_score > 0 else normalized

    def _source_direct_categories(source_dir: str | Path | None) -> list[str]:
        if not source_dir:
            return []
        try:
            root = Path(source_dir).expanduser().resolve()
        except Exception:
            return []
        if not root.exists() or not root.is_dir():
            return []
        categories: list[str] = []
        seen: set[str] = set()
        for child in sorted(root.iterdir(), key=lambda item: (item.name.casefold(), item.name)):
            if not child.is_dir():
                continue
            category = _normalize_tag_category(child.name)
            if not category or category in seen:
                continue
            seen.add(category)
            categories.append(category)
        return categories

    def _source_asset_tag_categories(history_store: HistoryStore | None = None) -> list[str]:
        store = history_store or _current_history_store()
        source_meta = store.get_library_source() or {}
        return _source_direct_categories(source_meta.get("source_dir"))

    def _asset_tag_categories(history_store: HistoryStore | None = None) -> list[str]:
        store = history_store or _current_history_store()
        source_meta = store.get_library_source()
        source_categories = _source_direct_categories((source_meta or {}).get("source_dir"))
        if source_meta is not None:
            return source_categories
        categories: list[str] = []
        seen: set[str] = set()
        for category in store.list_distinct_asset_categories():
            normalized = _normalize_tag_category(category)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            categories.append(normalized)
        return categories

    def _ensure_library_category_dir(history_store: HistoryStore, category: str) -> None:
        normalized = _normalize_tag_category(category)
        if not normalized:
            return
        source_meta = history_store.get_library_source() or {}
        source_dir = str(source_meta.get("source_dir") or "").strip()
        if not source_dir:
            return
        try:
            root = Path(source_dir).expanduser().resolve()
            root.mkdir(parents=True, exist_ok=True)
            (root / normalized).mkdir(parents=True, exist_ok=True)
        except OSError:
            # The asset metadata still makes the item visible in the in-app library.
            return

    def _library_query_tag_categories(
        history_store: HistoryStore,
        tag_category: str | None,
        source_categories: list[str],
    ) -> list[str]:
        normalized_category = _normalize_tag_category(tag_category)
        if not normalized_category:
            return []
        if not source_categories or normalized_category not in source_categories:
            return [normalized_category]
        query_categories: list[str] = []
        seen: set[str] = set()
        for raw_category in history_store.list_distinct_asset_categories():
            normalized_raw = _normalize_tag_category(raw_category)
            if not normalized_raw:
                continue
            resolved = _resolve_runtime_tag_category(normalized_raw, source_categories)
            if resolved != normalized_category or normalized_raw in seen:
                continue
            seen.add(normalized_raw)
            query_categories.append(normalized_raw)
        if not query_categories:
            query_categories.append(normalized_category)
        return query_categories

    def _scan_material_source(source_dir: str) -> list[dict[str, Any]]:
        root = Path(source_dir).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise ValueError("素材存储目录不存在")
        items: list[dict[str, Any]] = []
        for category_dir in sorted(root.iterdir(), key=lambda item: (item.name.casefold(), item.name)):
            if not category_dir.is_dir():
                continue
            category = _normalize_tag_category(category_dir.name)
            if not category:
                continue
            for path in sorted(category_dir.iterdir(), key=lambda item: item.name.lower()):
                if not is_supported_image_file(path):
                    continue
                items.append(
                    {
                        "tag_category": category,
                        "path": str(path.resolve()),
                        "original_name": path.name,
                        "display_name": path.stem,
                        "mime_type": mimetypes.guess_type(str(path))[0],
                    }
                )
        return items

    def _source_category_dir(storage, category: str) -> Path:
        return storage.source_dir / _normalize_tag_category(category)

    def _copy_source_asset_to_storage(*, source_path: str | Path, storage, category: str, filename: str) -> Path:
        target_dir = _source_category_dir(storage, category)
        target_path = target_dir / filename
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(Path(source_path).expanduser().resolve(), target_path)
        return target_path

    def _stage_material_source_snapshot(*, scanned_items: list[dict[str, Any]], storage) -> tuple[Path, list[dict[str, Any]], set[str]]:
        staged_root = storage.root_dir / f".source-next-{uuid.uuid4().hex}"
        staged_root.mkdir(parents=True, exist_ok=False)
        staged_items: list[dict[str, Any]] = []
        target_relative_paths: set[str] = set()
        try:
            for item in scanned_items:
                relative_path = Path(_normalize_tag_category(item["tag_category"])) / item["original_name"]
                staged_path = staged_root / relative_path
                staged_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(Path(item["path"]).expanduser().resolve(), staged_path)
                target_relative_paths.add(str(relative_path))
                staged_items.append(
                    {
                        **item,
                        "mirrored_path": str((storage.source_dir / relative_path).resolve()),
                    }
                )
        except Exception:
            shutil.rmtree(staged_root, ignore_errors=True)
            raise
        return staged_root, staged_items, target_relative_paths

    def _swap_staged_source_snapshot(storage, staged_root: Path) -> Path | None:
        backup_root = storage.root_dir / f".source-backup-{uuid.uuid4().hex}"
        existing_source = storage.source_dir
        if existing_source.exists():
            existing_source.rename(backup_root)
        try:
            staged_root.rename(existing_source)
        except Exception:
            if backup_root.exists():
                backup_root.rename(existing_source)
            raise
        return backup_root if backup_root.exists() else None

    def _restore_source_snapshot(storage, backup_root: Path | None) -> None:
        if storage.source_dir.exists():
            shutil.rmtree(storage.source_dir, ignore_errors=True)
        if backup_root and backup_root.exists():
            backup_root.rename(storage.source_dir)
        else:
            storage.source_dir.mkdir(parents=True, exist_ok=True)

    def _discard_source_snapshot(path: Path | None) -> None:
        if path and path.exists():
            shutil.rmtree(path, ignore_errors=True)

    def _reserved_library_names(history_store: HistoryStore) -> dict[str, set[str]]:
        reserved: dict[str, set[str]] = {}
        for item in history_store.list_library_assets():
            if str(item.get("origin") or "").strip() == "library_source":
                continue
            category = _normalize_tag_category(item.get("tag_category"))
            display_name = str(item.get("display_name") or "").strip()
            if not category or not display_name:
                continue
            reserved.setdefault(category, set()).add(display_name)
        return reserved

    def _allocate_library_source_name(
        reserved_names: dict[str, set[str]],
        category: str,
        desired_name: str,
    ) -> str:
        normalized_category = _normalize_tag_category(category)
        base_name = str(desired_name or "").strip() or f"默认{normalized_category}"
        used = reserved_names.setdefault(normalized_category, set())
        if base_name not in used:
            used.add(base_name)
            return base_name
        index = 2
        while True:
            candidate = f"{base_name}({index})"
            if candidate not in used:
                used.add(candidate)
                return candidate
            index += 1

    def _remove_mirrored_source_asset(asset: dict[str, Any], storage_dir: str) -> None:
        try:
            storage = ensure_storage_paths(storage_dir)
            candidate = Path(str(asset.get("path") or "")).expanduser().resolve()
            source_root = storage.source_dir.resolve()
            candidate.relative_to(source_root)
        except Exception:
            return
        candidate.unlink(missing_ok=True)

    def _sync_material_source(*, source_dir: str) -> dict[str, Any]:
        settings = _current_settings()
        storage = ensure_storage_paths(settings.storage_dir)
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        source_root = str(Path(source_dir).expanduser().resolve())
        source_categories = _source_direct_categories(source_root)
        scanned_items = _scan_material_source(source_root)
        seen_source_paths: set[str] = set()
        existing_mirrors = history_store.list_library_source_assets()
        existing_by_source = {
            (str(asset.get("source_root") or ""), str(asset.get("source_path") or "")): asset
            for asset in existing_mirrors
        }
        for item in scanned_items:
            seen_source_paths.add(item["path"])

        removed_assets = [
            asset
            for asset in existing_mirrors
            if not (
                str(asset.get("source_root") or "") == source_root
                and str(asset.get("source_path") or "") in seen_source_paths
            )
        ]
        reserved_names = _reserved_library_names(history_store)
        staged_root, staged_items, _target_relative_paths = _stage_material_source_snapshot(
            scanned_items=scanned_items,
            storage=storage,
        )
        upserts: list[dict[str, Any]] = []
        added_count = 0
        updated_count = 0
        for item in staged_items:
            source_path = item["path"]
            existing = existing_by_source.get((source_root, source_path))
            desired_name = _allocate_library_source_name(
                reserved_names,
                item["tag_category"],
                item["display_name"],
            )
            upserts.append(
                {
                    "existing_id": existing.get("id") if existing else None,
                    "original_name": item["original_name"],
                    "display_name": desired_name,
                    "tag_category": item["tag_category"],
                    "path": item["mirrored_path"],
                    "mime_type": item["mime_type"],
                    "source_path": source_path,
                    "source_root": source_root,
                }
            )
            if existing:
                updated_count += 1
            else:
                added_count += 1

        backup_root: Path | None = None
        synced_items: list[dict[str, Any]] = []
        source_meta: dict[str, Any] = {}
        try:
            backup_root = _swap_staged_source_snapshot(storage, staged_root)
            synced_items, source_meta = history_store.apply_library_source_snapshot(
                source_dir=source_root,
                upserts=upserts,
                delete_asset_ids=[str(asset.get("id") or "") for asset in removed_assets],
            )
        except Exception:
            if backup_root is not None or storage.source_dir.exists():
                _restore_source_snapshot(storage, backup_root)
            raise
        finally:
            _discard_source_snapshot(staged_root)
        _discard_source_snapshot(backup_root)

        removed_count = len(removed_assets)
        return {
            "items": [
                _asset_payload(
                    asset,
                    settings.storage_dir,
                    history_store=history_store,
                    source_categories=source_categories,
                )
                for asset in synced_items
            ],
            "source": source_meta,
            "categories": _asset_tag_categories(history_store),
            "imported_count": added_count + updated_count,
            "added_count": added_count,
            "updated_count": updated_count,
            "removed_count": removed_count,
        }

    def _merge_live_snapshot(record: dict, snapshot: dict) -> dict:
        merged = dict(record)
        merged["status"] = snapshot["status"]
        merged["message"] = snapshot.get("message") or merged.get("message")
        merged["error_message"] = snapshot.get("error_message") or merged.get("error_message")
        merged["elapsed_ms"] = snapshot.get("elapsed_ms")
        merged["is_live"] = True
        outputs = list(snapshot.get("outputs") or [])
        if outputs:
            result_payload = dict(merged.get("result_payload") or {})
            result_payload["artifacts"] = outputs
            merged["result_payload"] = result_payload
            merged["local_paths"] = [item["local_path"] for item in outputs if item.get("local_path")]
            merged["thumbnail_path"] = outputs[0].get("thumbnail_path")
        return merged

    def _serialize_live_only(snapshot: dict) -> dict:
        outputs = list(snapshot.get("outputs") or [])
        return {
            "id": snapshot["history_id"],
            "job_id": snapshot["job_id"],
            "kind": snapshot["kind"],
            "status": snapshot["status"],
            "model_variant": "",
            "prompt": "",
            "params_requested": {},
            "params_actual": {},
            "result_payload": {"artifacts": outputs},
            "local_paths": [item["local_path"] for item in outputs if item.get("local_path")],
            "thumbnail_path": outputs[0].get("thumbnail_path") if outputs else None,
            "error_message": snapshot.get("error_message"),
            "elapsed_ms": snapshot.get("elapsed_ms"),
            "created_at": snapshot["created_at"],
            "updated_at": snapshot["updated_at"],
            "message": snapshot.get("message"),
            "is_live": True,
        }

    def _recover_restartable_video_jobs(storage_dir: str | Path | None = None) -> int:
        target_storage_dir = _normalize_storage_dir(storage_dir or _current_settings().storage_dir)
        history_store = _history_store_for_storage_dir(target_storage_dir)
        recovered = 0
        offset = 0
        batch_size = 240
        while True:
            batch = history_store.list_recoverable_video_jobs(
                candidate_statuses=orphan_candidate_statuses,
                limit=batch_size,
                offset=offset,
            )
            if not batch:
                break
            offset += batch_size
            for record in batch:
                job_id = str(record.get("job_id") or "").strip()
                if not job_id or jobs.get(job_id):
                    continue
                params_actual = dict(record.get("params_actual") or {})
                remote_task_id = str(params_actual.get("remote_task_id") or "").strip()
                if not remote_task_id:
                    continue
                jobs.restore(
                    job_id=job_id,
                    kind=VIDEO_KIND,
                    history_id=str(record.get("id") or ""),
                    status=str(record.get("status") or JOB_STATUS_RUNNING),
                    message="服务重启后正在恢复远程任务轮询",
                    created_at=record.get("created_at"),
                    updated_at=record.get("updated_at"),
                    remote_task_id=remote_task_id,
                    outputs=list((record.get("result_payload") or {}).get("artifacts") or []),
                    error_message=record.get("error_message"),
                    elapsed_ms=record.get("elapsed_ms"),
                )

                def _resume_runner(ctx, recovered_record=record, recovered_store=history_store):
                    started = time.monotonic()
                    try:
                        result = video_service.resume(recovered_record, ctx)
                        elapsed_ms = int((time.monotonic() - started) * 1000)
                        result["elapsed_ms"] = int(result.get("elapsed_ms") or elapsed_ms)
                        _update_history_record(
                            recovered_store,
                            str(recovered_record.get("id") or ""),
                            status=str(result.get("status") or JOB_STATUS_SUCCEEDED),
                            params_actual=result.get("params_actual"),
                            result_payload=result.get("result_payload"),
                            local_paths=result.get("local_paths"),
                            thumbnail_path=result.get("thumbnail_path"),
                            error_message=result.get("error_message"),
                            elapsed_ms=result.get("elapsed_ms"),
                        )
                        return result
                    except JobCancelledError:
                        elapsed_ms = int((time.monotonic() - started) * 1000)
                        _update_history_record(
                            recovered_store,
                            str(recovered_record.get("id") or ""),
                            status=JOB_STATUS_CANCELLED,
                            error_message="任务已取消",
                            elapsed_ms=elapsed_ms,
                        )
                        raise
                    except Exception as exc:
                        elapsed_ms = int((time.monotonic() - started) * 1000)
                        _update_history_record(
                            recovered_store,
                            str(recovered_record.get("id") or ""),
                            status=JOB_STATUS_FAILED,
                            error_message=str(exc),
                            elapsed_ms=elapsed_ms,
                        )
                        raise

                jobs.launch(
                    job_id=job_id,
                    runner=_resume_runner,
                )
                recovered += 1
            if len(batch) < batch_size:
                break
        return recovered

    def _history_items_with_live(
        kind: str,
        *,
        limit: int,
        offset: int,
        view: str = "full",
        repair: bool = False,
    ) -> tuple[list[dict], int, bool]:
        history_store = _current_history_store()
        storage_dir = _current_settings().storage_dir
        if kind == VIDEO_KIND:
            _recover_restartable_video_jobs(storage_dir)
        live_snapshot_list = jobs.list_snapshots(kind=kind, active_only=True)
        history_store.reconcile_orphan_history_records(
            kind,
            active_job_ids={snapshot["job_id"] for snapshot in live_snapshot_list},
            orphan_after_seconds=orphan_grace_seconds,
            candidate_statuses=orphan_candidate_statuses,
            resolved_status=JOB_STATUS_FAILED,
            error_message=orphan_error_message,
            status_grace_overrides=orphan_status_grace_overrides,
        )
        items, total = history_store.list_history_page(kind, limit=limit, offset=offset)
        items = _hydrate_history_asset_name_snapshots(history_store, items)
        live_snapshots = {
            snapshot["history_id"]: snapshot
            for snapshot in live_snapshot_list
        }
        merged_items: list[dict] = []
        seen_history_ids: set[str] = set()
        for item in items:
            seen_history_ids.add(item["id"])
            snapshot = live_snapshots.get(item["id"])
            if snapshot:
                merged_items.append(_merge_live_snapshot(item, snapshot))
            else:
                stable = dict(item)
                stable["is_live"] = False
                merged_items.append(stable)
        if offset == 0:
            for history_id, snapshot in live_snapshots.items():
                if history_id not in seen_history_ids:
                    merged_items.append(_serialize_live_only(snapshot))
        merged_items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        merged_items.sort(key=lambda item: 0 if item.get("is_live") else 1)
        merged_items = [
            _history_record_payload(history_store, storage_dir, item, view=view, repair=repair)
            for item in merged_items
        ]
        has_more = offset + len(items) < total
        return merged_items, total, has_more

    def _history_counts() -> dict[str, int]:
        history_store = _current_history_store()
        return {
            IMAGE_KIND: history_store.count_history(IMAGE_KIND),
            VIDEO_KIND: history_store.count_history(VIDEO_KIND),
        }

    def _duration_stats(kind: str) -> dict[str, Any]:
        history_store = _current_history_store()
        points = history_store.list_duration_records(kind)
        updates: list[dict[str, Any]] = []
        label_map = IMAGE_MODELS if kind == IMAGE_KIND else VIDEO_MODELS
        grouped_models: dict[str, list[int]] = {}
        grouped_modes: dict[tuple[str, str], dict[str, Any]] = {}
        grouped_series: dict[tuple[str, str], dict[str, Any]] = {}
        for point in points:
            elapsed_ms = point.get("elapsed_ms")
            if elapsed_ms is None:
                continue
            mode_key = str(point.get("mode_key") or "").strip()
            params_requested = point.get("params_requested") or {}
            model_variant = point["model_variant"]
            if kind == IMAGE_KIND:
                mode_key, mode_label = _normalize_image_mode(mode_key, params_requested)
                if mode_key != str(point.get("mode_key") or "").strip():
                    updates.append(
                        {
                            "id": point["history_id"],
                            "mode_key": mode_key,
                            "params_requested": params_requested,
                        }
                    )
            elif not mode_key:
                mode_key, mode_label = _classify_video_mode(params_requested)
                updates.append(
                    {
                        "id": point["history_id"],
                        "mode_key": mode_key,
                        "params_requested": params_requested,
                    }
                )
            else:
                mode_label = video_scene_label(mode_key, model_variant=model_variant)
            provider = image_model_provider(model_variant) if kind == IMAGE_KIND and model_variant in IMAGE_MODELS else ""
            grouped_models.setdefault(model_variant, []).append(int(elapsed_ms))
            mode_group_key = (provider, mode_key) if kind == IMAGE_KIND else ("", mode_key)
            mode_bucket = grouped_modes.setdefault(
                mode_group_key,
                {
                    "provider": provider or None,
                    "mode_key": mode_key,
                    "mode_label": mode_label,
                    "values": [],
                },
            )
            mode_bucket["values"].append(int(elapsed_ms))
            point["mode_key"] = mode_key
            point["mode_label"] = mode_label
            series_bucket = grouped_series.setdefault(
                (model_variant, mode_key),
                {
                    "model_variant": model_variant,
                    "mode_key": mode_key,
                    "mode_label": mode_label,
                    "label": f"{label_map.get(model_variant, {}).get('label', model_variant)} · {mode_label}",
                    "points": [],
                },
            )
            series_bucket["points"].append(point)

        model_items = []
        total_elapsed = 0
        total_count = 0
        for model_variant, elapsed_values in grouped_models.items():
            success_count = len(elapsed_values)
            total_count += success_count
            total_elapsed += sum(elapsed_values)
            model_items.append(
                {
                    "model_variant": model_variant,
                    "label": label_map.get(model_variant, {}).get("label", model_variant),
                    "average_elapsed_ms": int(sum(elapsed_values) / success_count) if success_count else None,
                    "success_count": success_count,
                }
            )
        order = list(label_map.keys())
        mode_order = list(VIDEO_SCENES.keys()) if kind == VIDEO_KIND else []
        model_items.sort(key=lambda item: order.index(item["model_variant"]) if item["model_variant"] in order else 999)
        if kind == IMAGE_KIND:
            image_mode_order_lookup = {
                "volcengine": {mode: index for index, mode in enumerate(SEEDREAM_IMAGE_MODES)},
                "kling": {mode: index for index, mode in enumerate(KLING_IMAGE_MODES)},
            }
            mode_items = [
                {
                    "provider": bucket["provider"],
                    "mode_key": bucket["mode_key"],
                    "mode_label": bucket["mode_label"],
                    "average_elapsed_ms": int(sum(bucket["values"]) / len(bucket["values"])) if bucket["values"] else None,
                    "success_count": len(bucket["values"]),
                }
                for bucket in grouped_modes.values()
            ]
            mode_items.sort(
                key=lambda item: (
                    0 if str(item.get("provider") or "") == "volcengine" else 1,
                    image_mode_order_lookup.get(str(item.get("provider") or ""), {}).get(str(item.get("mode_key") or ""), 999),
                    str(item.get("mode_key") or ""),
                )
            )
        else:
            mode_items = [
                {
                    "mode_key": bucket["mode_key"],
                    "mode_label": bucket["mode_label"],
                    "average_elapsed_ms": int(sum(bucket["values"]) / len(bucket["values"])) if bucket["values"] else None,
                    "success_count": len(bucket["values"]),
                }
                for bucket in grouped_modes.values()
            ]
            mode_items.sort(key=lambda item: mode_order.index(item["mode_key"]) if item["mode_key"] in mode_order else 999)
        series_items = []
        for (model_variant, mode_key), bucket in grouped_series.items():
            elapsed_values = [int(item["elapsed_ms"]) for item in bucket["points"] if item.get("elapsed_ms") is not None]
            series_items.append(
                {
                    "model_variant": model_variant,
                    "mode_key": mode_key,
                    "mode_label": bucket["mode_label"],
                    "label": bucket["label"],
                    "average_elapsed_ms": int(sum(elapsed_values) / len(elapsed_values)) if elapsed_values else None,
                    "success_count": len(elapsed_values),
                    "points": bucket["points"],
                }
            )
        series_items.sort(
            key=lambda item: (
                order.index(item["model_variant"]) if item["model_variant"] in order else 999,
                mode_order.index(item["mode_key"]) if mode_order and item["mode_key"] in mode_order else 999,
            )
        )
        if updates:
            history_store.persist_history_snapshots(updates)
        return {
            "average_elapsed_ms": int(total_elapsed / total_count) if total_count else None,
            "success_count": total_count,
            "model_averages": model_items,
            "mode_averages": mode_items,
            "series": series_items,
        }

    image_service = ImageGenerationService(
        settings_store,
        history_store_resolver=_history_store_for_storage_dir,
        gateway_factory=image_gateway_factory or __import__("web_lite3.volcengine", fromlist=["VolcengineImageGateway"]).VolcengineImageGateway,
    )
    video_service = VideoGenerationService(
        settings_store,
        history_store_resolver=_history_store_for_storage_dir,
        gateway_factory=video_gateway_factory or __import__("web_lite3.volcengine", fromlist=["VolcengineVideoGateway"]).VolcengineVideoGateway,
    )
    app = FastAPI(title=APP_NAME)
    app.state.paths = paths
    app.state.runtime_id = runtime_id
    app.state.settings_store = settings_store
    app.state.history_store_registry = history_store_registry
    app.state.history_repair = history_repair
    app.state.jobs = jobs
    app.state.image_service = image_service
    app.state.video_service = video_service

    @app.on_event("startup")
    async def _recover_video_jobs_on_startup() -> None:
        _recover_restartable_video_jobs()

    templates = Jinja2Templates(directory=str(package_dir / "templates"))
    templates.env.globals.update(
        app_brand_title=APP_BRAND_TITLE,
        app_brand_title_emphasis=APP_BRAND_TITLE_EMPHASIS,
        app_brand_title_rest=APP_BRAND_TITLE_REST,
        app_brand_sidebar_title=APP_BRAND_SIDEBAR_TITLE,
        app_brand_sidebar_title_emphasis=APP_BRAND_SIDEBAR_TITLE_EMPHASIS,
        app_brand_sidebar_title_rest=APP_BRAND_SIDEBAR_TITLE_REST,
        app_brand_subtitle=APP_BRAND_SUBTITLE,
        app_brand_sidebar_subtitle=APP_BRAND_SIDEBAR_SUBTITLE,
        app_display_name=APP_HEALTH_NAME,
        app_release_version=APP_DISPLAY_RELEASE_VERSION,
        static_asset_version=runtime_id,
    )
    app.mount("/static", StaticFiles(directory=str(package_dir / "static")), name="static")

    def _workspace_page_config(kind: str) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        asset_tag_categories = _asset_tag_categories(history_store)
        if kind == IMAGE_KIND:
            ui = image_ui_schema()
            ui["asset_tag_categories"] = asset_tag_categories
            ui["doc_links"] = DOMESTIC_DOC_LINKS
            return {
                "kind": IMAGE_KIND,
                "title": "生图",
                "theme": settings.theme,
                "settings": settings.to_dict(),
                "ui": ui,
                "models": [{"value": item["value"], "label": item["label"]} for item in ui["models"]],
            }
        ui = video_ui_schema()
        ui["asset_tag_categories"] = asset_tag_categories
        ui["doc_links"] = DOMESTIC_DOC_LINKS
        return {
            "kind": VIDEO_KIND,
            "title": "生视频",
            "theme": settings.theme,
            "settings": settings.to_dict(),
            "ui": ui,
            "models": [{"value": key, "label": value["label"]} for key, value in VIDEO_MODELS.items()],
        }

    def _settings_page_config() -> dict:
        settings = _current_settings()
        return {
            "theme": settings.theme,
            "settings": settings.to_dict(),
            "available_themes": THEME_OPTIONS,
            "record_card_sizes": RECORD_CARD_SIZE_OPTIONS,
            "network_status": _network_status_payload(settings),
            "masked_api_key_history": {
                "volcengine": [
                    {"value": item, "label": _mask_api_key(item)}
                    for item in settings.volcengine_api_key_history or []
                ],
                "kling": [
                    {"value": item, "label": _mask_api_key(item)}
                    for item in settings.kling_api_key_history or []
                ],
            },
        }

    def _library_page_config() -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        return {
            "theme": settings.theme,
            "settings": settings.to_dict(),
            "asset_tag_categories": _asset_tag_categories(history_store),
        }

    def _canvas_page_config() -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        return {
            "theme": settings.theme,
            "settings": settings.to_dict(),
            "image_ui": image_ui_schema(),
            "video_ui": video_ui_schema(),
            "asset_tag_categories": _asset_tag_categories(history_store),
            "hotkeys": {
                "save": "Ctrl/Cmd + S",
                "run": "Ctrl/Cmd + Enter",
                "delete": "Delete / Backspace",
            },
        }

    def _blender_page_config() -> dict:
        settings = _current_settings()
        return {
            "theme": settings.theme,
            "settings": settings.to_dict(),
        }

    def _blender_roots() -> tuple[Any, Path, Path, Path, Path]:
        storage = ensure_storage_paths(_current_settings().storage_dir)
        imports_dir = storage.blender_dir / "imports"
        textures_dir = storage.blender_dir / "textures"
        exports_dir = storage.blender_dir / "exports"
        jobs_dir = storage.blender_dir / "render-jobs"
        imports_dir.mkdir(parents=True, exist_ok=True)
        textures_dir.mkdir(parents=True, exist_ok=True)
        exports_dir.mkdir(parents=True, exist_ok=True)
        jobs_dir.mkdir(parents=True, exist_ok=True)
        return storage, imports_dir, textures_dir, exports_dir, jobs_dir

    blender_builtin_assets = [
        {"id": "person-whitebox", "label": "Person", "category": "character", "kind": "primitive", "prefab": "person", "dimensions": [0.7, 1.8, 0.7]},
        {"id": "block-building", "label": "Building", "category": "building", "kind": "primitive", "prefab": "block-building", "dimensions": [3, 3.2, 2.2]},
        {"id": "tower-building", "label": "Tower", "category": "building", "kind": "primitive", "prefab": "tower", "dimensions": [1.6, 5, 1.6]},
        {"id": "lowpoly-tree", "label": "Tree", "category": "plant", "kind": "primitive", "prefab": "tree", "dimensions": [1.2, 2.6, 1.2]},
        {"id": "prop-crate", "label": "Crate", "category": "prop", "kind": "primitive", "prefab": "crate", "dimensions": [1, 1, 1]},
        {"id": "prop-wall", "label": "Wall", "category": "prop", "kind": "primitive", "prefab": "wall", "dimensions": [3, 1.6, 0.2]},
        {"id": "greenscreen-panel", "label": "Green Screen", "category": "prop", "kind": "primitive", "prefab": "greenscreen", "dimensions": [4, 2.25, 0.08]},
        {"id": "vehicle-car", "label": "Car", "category": "vehicle", "kind": "primitive", "prefab": "car", "dimensions": [1.8, 0.9, 3.4]},
        {"id": "vehicle-truck", "label": "Truck", "category": "vehicle", "kind": "primitive", "prefab": "truck", "dimensions": [2.1, 1.4, 4.6]},
        {"id": "vehicle-motorcycle", "label": "Motorcycle", "category": "vehicle", "kind": "primitive", "prefab": "motorcycle", "dimensions": [0.7, 1, 2]},
        {"id": "vehicle-boat", "label": "Boat", "category": "vehicle", "kind": "primitive", "prefab": "boat", "dimensions": [1.5, 0.7, 3.2]},
        {"id": "aircraft-airplane", "label": "Airplane", "category": "aircraft", "kind": "primitive", "prefab": "airplane", "dimensions": [3.6, 0.8, 3.2]},
        {"id": "aircraft-drone", "label": "Drone", "category": "aircraft", "kind": "primitive", "prefab": "drone", "dimensions": [1.7, 0.35, 1.7]},
        {"id": "aircraft-helicopter", "label": "Helicopter", "category": "aircraft", "kind": "primitive", "prefab": "helicopter", "dimensions": [2.3, 1, 3.5]},
    ]

    blender_supported_model_formats = {
        ".glb": "gltf",
        ".gltf": "gltf",
        ".obj": "obj",
        ".stl": "stl",
        ".fbx": "fbx",
        ".dae": "dae",
        ".ply": "ply",
        ".3mf": "3mf",
        ".3ds": "3ds",
    }
    blender_supported_blend_suffix = ".blend"
    blender_supported_upload_suffixes = {*blender_supported_model_formats.keys(), blender_supported_blend_suffix}
    blender_supported_model_label = "GLB, GLTF, OBJ, STL, FBX, DAE, PLY, 3MF, 3DS and BLEND"
    blender_supported_texture_formats = {".png", ".jpg", ".jpeg", ".webp"}
    blender_supported_texture_label = "PNG, JPG, JPEG and WebP"

    def _blender_safe_name(value: str, fallback: str = "asset") -> str:
        stem = Path(str(value or fallback)).stem
        normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", stem).strip("-") or fallback
        return normalized[:60]

    def _find_blender_binary() -> Path | None:
        candidates: list[Path] = []
        configured = str(os.environ.get("BLENDER_BIN") or "").strip()
        if configured:
            candidates.append(Path(configured))
        resolved = shutil.which("blender")
        if resolved:
            candidates.append(Path(resolved))
        applications_dir = Path("/Applications")
        if applications_dir.exists():
            candidates.extend(applications_dir.glob("Blender*.app/Contents/MacOS/Blender"))
            candidates.append(applications_dir / "Blender.app" / "Contents" / "MacOS" / "Blender")

        seen: set[Path] = set()
        for candidate in candidates:
            resolved_candidate = candidate.expanduser()
            if resolved_candidate in seen:
                continue
            seen.add(resolved_candidate)
            if resolved_candidate.is_file() and os.access(resolved_candidate, os.X_OK):
                return resolved_candidate
        return None

    def _convert_blend_to_glb(source_path: Path, target_path: Path) -> None:
        blender_binary = _find_blender_binary()
        if blender_binary is None:
            raise HTTPException(
                status_code=400,
                detail="当前系统未检测到 Blender 命令行。.blend 文件需要安装 Blender 后自动转成 GLB，或先在 Blender 中导出 GLB/GLTF 再导入。",
            )

        script_path = target_path.with_suffix(".convert.py")
        script_path.write_text(
            "\n".join([
                "import bpy",
                "import sys",
                "source_path = sys.argv[-2]",
                "target_path = sys.argv[-1]",
                "bpy.ops.wm.open_mainfile(filepath=source_path)",
                "bpy.ops.export_scene.gltf(filepath=target_path, export_format='GLB')",
            ]),
            encoding="utf-8",
        )
        try:
            completed = subprocess.run(
                [
                    str(blender_binary),
                    "--background",
                    "--python",
                    str(script_path),
                    "--",
                    str(source_path),
                    str(target_path),
                ],
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
            if completed.returncode != 0 or not target_path.exists():
                detail = (completed.stderr or completed.stdout or "Blender 未生成 GLB 文件。").strip()
                raise HTTPException(status_code=400, detail=f".blend 转换失败：{detail[-800:]}")
        finally:
            script_path.unlink(missing_ok=True)

    def _blender_imported_asset(path: Path) -> dict[str, Any]:
        label = _blender_safe_name(path.name, "Imported")
        return {
            "id": f"import-{label}",
            "label": label,
            "category": "prop",
            "kind": "imported",
            "url": f"/uploads/{path.name}",
            "format": blender_supported_model_formats.get(path.suffix.lower()),
            "dimensions": [1, 1, 1],
        }

    def _blender_assets() -> list[dict[str, Any]]:
        _, imports_dir, _, _, _ = _blender_roots()
        imported = [
            _blender_imported_asset(path)
            for path in sorted(imports_dir.iterdir())
            if path.is_file() and path.suffix.lower() in blender_supported_model_formats
        ]
        return [*blender_builtin_assets, *imported]

    def _resolve_blender_file(root: Path, relative_path: str) -> Path:
        candidate = (root / unquote(relative_path)).resolve()
        root_resolved = root.resolve()
        if candidate != root_resolved and root_resolved not in candidate.parents:
            raise HTTPException(status_code=404, detail="file not found")
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        return candidate

    def _blender_now() -> str:
        return dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")

    def _public_blender_render_job(job: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": job["id"],
            "status": job["status"],
            "progress": job["progress"],
            "kind": job.get("kind", "video"),
            "outputPath": job.get("outputPath"),
            "downloadUrl": job.get("downloadUrl"),
            "frameCount": job.get("frameCount"),
            "error": job.get("error"),
            "createdAt": job["createdAt"],
            "updatedAt": job["updatedAt"],
        }

    def _update_blender_render_job(job_id: str, patch: dict[str, Any]) -> None:
        with blender_render_jobs_lock:
            current = blender_render_jobs.get(job_id)
            if not current:
                return
            current.update(patch)
            current["updatedAt"] = _blender_now()

    def _validate_blender_scene(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise HTTPException(status_code=400, detail="Invalid scene document")
        if value.get("version") != 1:
            raise HTTPException(status_code=400, detail="Invalid scene document version")
        if not isinstance(value.get("objects"), list):
            raise HTTPException(status_code=400, detail="Scene objects are required")
        if not isinstance(value.get("cameras"), list) or not value["cameras"]:
            raise HTTPException(status_code=400, detail="At least one camera is required")
        if not isinstance(value.get("renderSettings"), dict):
            raise HTTPException(status_code=400, detail="Render settings are required")
        return value

    def _blender_render_settings(scene: dict[str, Any]) -> tuple[int, int, int, float]:
        settings = scene.get("renderSettings") if isinstance(scene.get("renderSettings"), dict) else {}
        width = max(320, min(3840, int(settings.get("width") or 1920)))
        height = max(240, min(2160, int(settings.get("height") or 1080)))
        width -= width % 2
        height -= height % 2
        fps = int(settings.get("fps") or 30)
        if fps not in {24, 30, 60}:
            fps = 30
        duration = max(1.0, min(300.0, float(settings.get("durationSec") or 10.0)))
        return width, height, fps, duration

    def _blender_float(value: Any, default: float = 0.0) -> float:
        try:
            result = float(value)
        except (TypeError, ValueError):
            return default
        if not math.isfinite(result):
            return default
        return result

    def _blender_clamp(value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(maximum, value))

    def _blender_apply_speed_curve(progress: float, curve: Any) -> float:
        t = _blender_clamp(progress, 0.0, 1.0)
        curve_key = str(curve or "linear")
        if curve_key == "ease-in":
            return t * t
        if curve_key == "ease-out":
            return 1.0 - (1.0 - t) * (1.0 - t)
        if curve_key == "ease-in-out":
            return 2.0 * t * t if t < 0.5 else 1.0 - math.pow(-2.0 * t + 2.0, 2.0) / 2.0
        if curve_key == "strong-ease-in":
            return t * t * t
        if curve_key == "strong-ease-out":
            return 1.0 - math.pow(1.0 - t, 3.0)
        return t

    def _blender_vec3(value: Any, default: list[float] | None = None) -> list[float]:
        fallback = default or [0.0, 0.0, 0.0]
        if not isinstance(value, list):
            return list(fallback)
        return [
            _blender_float(value[index] if len(value) > index else fallback[index], fallback[index])
            for index in range(3)
        ]

    def _blender_vec_subtract(a: list[float], b: list[float]) -> list[float]:
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

    def _blender_vec_add(a: list[float], b: list[float]) -> list[float]:
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

    def _blender_vec_lerp(a: list[float], b: list[float], progress: float) -> list[float]:
        return [
            a[index] + (b[index] - a[index]) * progress
            for index in range(3)
        ]

    def _blender_vec_dot(a: list[float], b: list[float]) -> float:
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    def _blender_vec_cross(a: list[float], b: list[float]) -> list[float]:
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]

    def _blender_vec_normalize(value: list[float], fallback: list[float]) -> list[float]:
        length = math.sqrt(_blender_vec_dot(value, value))
        if length < 0.0001:
            return list(fallback)
        return [value[0] / length, value[1] / length, value[2] / length]

    def _blender_sorted_camera_keyframes(scene: dict[str, Any]) -> list[dict[str, Any]]:
        cameras = [item for item in scene.get("cameras", []) if isinstance(item, dict)]
        keyframes: list[dict[str, Any]] = []
        active_camera_id = scene.get("activeCameraId")
        for camera in cameras:
            if camera.get("id") == active_camera_id or not keyframes:
                keyframes = [item for item in camera.get("keyframes", []) if isinstance(item, dict)]
                if camera.get("id") == active_camera_id:
                    break
        return sorted(keyframes, key=lambda item: _blender_float(item.get("timeSec"), 0.0))

    def _blender_camera_target(scene: dict[str, Any], fallback: list[float]) -> list[float]:
        aim_anchor = scene.get("cameraAimAnchor") if isinstance(scene.get("cameraAimAnchor"), dict) else {}
        if aim_anchor.get("enabled"):
            return _blender_vec3(aim_anchor.get("position"), fallback)
        return fallback

    def _blender_shot_duration(keyframe: dict[str, Any]) -> float:
        return _blender_clamp(_blender_float(keyframe.get("shotDurationSec"), 2.0), 0.5, 30.0)

    def _blender_shake_wave(time_sec: float, frequency: float, phase: float) -> float:
        return math.sin(time_sec * frequency * math.pi * 2.0 + phase)

    def _blender_apply_camera_motion(scene: dict[str, Any], time_sec: float, sample: dict[str, Any]) -> dict[str, Any]:
        camera_motion = scene.get("cameraMotion") if isinstance(scene.get("cameraMotion"), dict) else {}
        mode = str(camera_motion.get("mode") or "stable")
        if mode not in {"handheld", "drone"}:
            return sample
        strength = _blender_clamp(_blender_float(camera_motion.get("shakeStrength"), 0.0), 0.0, 2.0)
        if strength <= 0:
            return sample
        handheld = mode == "handheld"
        position_amplitude = (0.035 if handheld else 0.012) * strength
        target_amplitude = (0.018 if handheld else 0.006) * strength
        fov_amplitude = (0.12 if handheld else 0.035) * strength
        base_frequency = 5.8 if handheld else 0.85
        position_offset = [
            _blender_shake_wave(time_sec, base_frequency, 0.2) * position_amplitude,
            _blender_shake_wave(time_sec, base_frequency * 1.7, 1.4) * position_amplitude * 0.65,
            _blender_shake_wave(time_sec, base_frequency * 1.27, 2.1) * position_amplitude,
        ]
        target_offset = [
            _blender_shake_wave(time_sec, base_frequency * 1.35, 2.7) * target_amplitude,
            _blender_shake_wave(time_sec, base_frequency * 1.95, 0.8) * target_amplitude,
            _blender_shake_wave(time_sec, base_frequency * 1.1, 1.9) * target_amplitude,
        ]
        return {
            "position": _blender_vec_add(_blender_vec3(sample.get("position"), [6.0, 4.0, 6.0]), position_offset),
            "target": _blender_vec_add(_blender_vec3(sample.get("target"), [0.0, 1.0, 0.0]), target_offset),
            "fov": _blender_clamp(
                _blender_float(sample.get("fov"), 45.0) +
                _blender_shake_wave(time_sec, base_frequency * 0.7, 0.5) * fov_amplitude,
                20.0,
                90.0,
            ),
        }

    def _blender_sample_camera(scene: dict[str, Any], time_sec: float) -> dict[str, Any]:
        keyframes = _blender_sorted_camera_keyframes(scene)
        timeline = scene.get("timeline") if isinstance(scene.get("timeline"), dict) else {}

        if timeline.get("mode") == "shots" and keyframes:
            cursor = 0.0
            active = keyframes[-1]
            for keyframe in keyframes:
                duration = _blender_shot_duration(keyframe)
                if time_sec < cursor + duration:
                    active = keyframe
                    break
                cursor += duration
            target = _blender_vec3(active.get("target"), [0.0, 1.0, 0.0])
            return _blender_apply_camera_motion(scene, time_sec, {
                "position": _blender_vec3(active.get("position"), [6.0, 4.0, 6.0]),
                "target": _blender_camera_target(scene, target),
                "fov": _blender_clamp(_blender_float(active.get("fov"), 45.0), 20.0, 90.0),
            })

        if not keyframes:
            return _blender_apply_camera_motion(
                scene,
                time_sec,
                {"position": [6.0, 4.0, 6.0], "target": [0.0, 1.0, 0.0], "fov": 45.0},
            )

        if len(keyframes) == 1 or time_sec <= _blender_float(keyframes[0].get("timeSec"), 0.0):
            keyframe = keyframes[0]
            target = _blender_vec3(keyframe.get("target"), [0.0, 1.0, 0.0])
            return _blender_apply_camera_motion(scene, time_sec, {
                "position": _blender_vec3(keyframe.get("position"), [6.0, 4.0, 6.0]),
                "target": _blender_camera_target(scene, target),
                "fov": _blender_clamp(_blender_float(keyframe.get("fov"), 45.0), 20.0, 90.0),
            })

        last = keyframes[-1]
        if time_sec >= _blender_float(last.get("timeSec"), 0.0):
            target = _blender_vec3(last.get("target"), [0.0, 1.0, 0.0])
            return _blender_apply_camera_motion(scene, time_sec, {
                "position": _blender_vec3(last.get("position"), [6.0, 4.0, 6.0]),
                "target": _blender_camera_target(scene, target),
                "fov": _blender_clamp(_blender_float(last.get("fov"), 45.0), 20.0, 90.0),
            })

        next_index = next(
            index
            for index, keyframe in enumerate(keyframes)
            if _blender_float(keyframe.get("timeSec"), 0.0) >= time_sec
        )
        start = keyframes[next_index - 1]
        end = keyframes[next_index]
        start_time = _blender_float(start.get("timeSec"), 0.0)
        end_time = _blender_float(end.get("timeSec"), start_time + 0.001)
        progress = _blender_clamp((time_sec - start_time) / max(0.001, end_time - start_time), 0.0, 1.0)
        speed = _blender_clamp(_blender_float(start.get("speedToNext"), 1.0), 0.25, 3.0)
        speed_adjusted = progress if abs(speed - 1.0) < 0.001 else 1.0 - math.pow(1.0 - progress, speed)
        adjusted = _blender_apply_speed_curve(speed_adjusted, start.get("speedCurveToNext"))
        target = _blender_vec_lerp(
            _blender_vec3(start.get("target"), [0.0, 1.0, 0.0]),
            _blender_vec3(end.get("target"), [0.0, 1.0, 0.0]),
            adjusted,
        )
        return _blender_apply_camera_motion(scene, time_sec, {
            "position": _blender_vec_lerp(
                _blender_vec3(start.get("position"), [6.0, 4.0, 6.0]),
                _blender_vec3(end.get("position"), [6.0, 4.0, 6.0]),
                adjusted,
            ),
            "target": _blender_camera_target(scene, target),
            "fov": _blender_clamp(
                _blender_float(start.get("fov"), 45.0) +
                (_blender_float(end.get("fov"), 45.0) - _blender_float(start.get("fov"), 45.0)) * adjusted,
                20.0,
                90.0,
            ),
        })

    def _blender_object_transform_at(item: dict[str, Any], time_sec: float) -> dict[str, list[float]]:
        transform = item.get("transform") if isinstance(item.get("transform"), dict) else {}
        raw_position = transform.get("position") if isinstance(transform.get("position"), list) else [0, 0, 0]
        raw_rotation = transform.get("rotation") if isinstance(transform.get("rotation"), list) else [0, 0, 0]
        raw_scale = transform.get("scale") if isinstance(transform.get("scale"), list) else [1, 1, 1]
        position = [
            _blender_float(raw_position[index] if len(raw_position) > index else 0)
            for index in range(3)
        ]
        rotation = [
            _blender_float(raw_rotation[index] if len(raw_rotation) > index else 0)
            for index in range(3)
        ]
        scale = [
            _blender_float(raw_scale[index] if len(raw_scale) > index else 1, 1.0)
            for index in range(3)
        ]
        motion = item.get("motion") if isinstance(item.get("motion"), dict) else {}
        mode = str(motion.get("mode") or "none")
        enabled = bool(motion.get("enabled")) and mode != "none"

        if not enabled:
            return {"position": position, "rotation": rotation, "scale": scale}

        start_sec = _blender_clamp(_blender_float(motion.get("startSec"), 0.0), 0.0, 300.0)
        duration_sec = _blender_clamp(_blender_float(motion.get("durationSec"), 4.0), 0.25, 300.0)
        progress = _blender_apply_speed_curve(
            _blender_clamp((time_sec - start_sec) / duration_sec, 0.0, 1.0),
            motion.get("speedCurve"),
        )
        direction_deg = _blender_clamp(_blender_float(motion.get("directionDeg"), 0.0), -180.0, 180.0)
        direction_rad = math.radians(direction_deg)
        face_offset_rad = math.radians(
            _blender_clamp(_blender_float(motion.get("faceOffsetDeg"), 0.0), -180.0, 180.0)
        )
        direction = (math.sin(direction_rad), math.cos(direction_rad))
        side = (math.cos(direction_rad), -math.sin(direction_rad))
        distance = _blender_clamp(_blender_float(motion.get("distance"), 0.0), 0.0, 60.0)
        height_delta = _blender_clamp(_blender_float(motion.get("heightDelta"), 0.0), -20.0, 20.0)
        radius = _blender_clamp(_blender_float(motion.get("radius"), 0.0), 0.0, 30.0)
        loops = _blender_clamp(_blender_float(motion.get("loops"), 1.0), 0.25, 12.0)
        auto_face = bool(motion.get("autoFace"))

        def apply_forward(amount: float) -> None:
            position[0] += direction[0] * amount
            position[2] += direction[1] * amount

        def apply_side(amount: float) -> None:
            position[0] += side[0] * amount
            position[2] += side[1] * amount

        def apply_facing_yaw(yaw: float) -> None:
            rotation[1] = rotation[1] + yaw + face_offset_rad

        if mode == "linear":
            apply_forward(distance * progress)
        elif mode == "pingpong":
            phase = (progress * loops * 2.0) % 2.0
            wave = phase if phase <= 1.0 else 2.0 - phase
            apply_forward(distance * wave)
        elif mode == "orbit":
            angle = direction_rad + progress * loops * math.pi * 2.0
            position[0] += math.cos(angle) * radius
            position[2] += math.sin(angle) * radius
            position[1] += math.sin(progress * loops * math.pi * 2.0) * height_delta
            if auto_face:
                apply_facing_yaw(-angle + math.pi / 2.0)
        elif mode == "takeoff":
            eased = progress * progress * (3.0 - 2.0 * progress)
            apply_forward(distance * progress)
            position[1] += height_delta * eased
        elif mode == "hover":
            apply_forward(distance * progress)
            position[1] += math.sin(progress * loops * math.pi * 2.0) * height_delta
        elif mode == "lane_change":
            apply_forward(distance * progress)
            apply_side(radius * (progress * progress * (3.0 - 2.0 * progress)))
        elif mode == "weave":
            apply_forward(distance * progress)
            apply_side(math.sin(progress * loops * math.pi * 2.0) * radius)
        elif mode == "pursuit":
            eased = progress * progress * (3.0 - 2.0 * progress)
            apply_forward(distance * (0.9 * progress + 0.1 * eased))
            apply_side(math.sin(progress * math.pi) * radius)
        elif mode == "bank_turn":
            eased = progress * progress * (3.0 - 2.0 * progress)
            bank = math.sin(progress * loops * math.pi)
            apply_forward(distance * progress)
            apply_side(bank * radius)
            position[1] += eased * height_delta
            rotation[2] += -bank * 0.35
        elif mode == "jump":
            apply_forward(distance * progress)
            position[1] += math.sin(progress * math.pi) * height_delta

        if auto_face and mode != "orbit":
            apply_facing_yaw(direction_rad)

        return {"position": position, "rotation": rotation, "scale": scale}

    def _blender_object_motion_path_points(item: dict[str, Any]) -> list[tuple[float, float]]:
        motion = item.get("motion") if isinstance(item.get("motion"), dict) else {}
        if not bool(motion.get("enabled")) or str(motion.get("mode") or "none") == "none":
            return []
        start_sec = _blender_clamp(_blender_float(motion.get("startSec"), 0.0), 0.0, 300.0)
        duration_sec = _blender_clamp(_blender_float(motion.get("durationSec"), 4.0), 0.25, 300.0)
        points = []
        for index in range(25):
            sampled = _blender_object_transform_at(
                item,
                start_sec + duration_sec * index / 24.0,
            )["position"]
            points.append((sampled[0], sampled[2]))
        return points

    def _blender_draw_scene_frame(scene: dict[str, Any], width: int, height: int, time_sec: float = 0.0) -> Image.Image:
        image = Image.new("RGB", (width, height), "#111318")
        draw = ImageDraw.Draw(image)
        margin = max(32, min(width, height) // 18)
        draw.rectangle((0, 0, width, height), fill="#111318")
        draw.rectangle((margin, margin, width - margin, height - margin), fill="#171b22", outline="#2a303a", width=max(1, width // 640))

        objects = [item for item in scene.get("objects", []) if isinstance(item, dict) and item.get("visible", True)]
        keyframes = _blender_sorted_camera_keyframes(scene)
        camera_sample = _blender_sample_camera(scene, time_sec)
        camera_position = camera_sample["position"]
        camera_target = camera_sample["target"]
        forward = _blender_vec_normalize(
            _blender_vec_subtract(camera_target, camera_position),
            [0.0, 0.0, -1.0],
        )
        right = _blender_vec_normalize(
            _blender_vec_cross(forward, [0.0, 1.0, 0.0]),
            [1.0, 0.0, 0.0],
        )
        camera_up = _blender_vec_normalize(
            _blender_vec_cross(right, forward),
            [0.0, 1.0, 0.0],
        )
        fov = _blender_clamp(_blender_float(camera_sample.get("fov"), 45.0), 20.0, 90.0)
        focal = min(width, height) / (2.0 * math.tan(math.radians(fov) / 2.0))

        def project_world(point: list[float]) -> tuple[float, float, float] | None:
            relative = _blender_vec_subtract(point, camera_position)
            depth = _blender_vec_dot(relative, forward)
            if depth <= 0.08:
                return None
            px = width / 2 + (_blender_vec_dot(relative, right) * focal / depth)
            py = height / 2 - (_blender_vec_dot(relative, camera_up) * focal / depth)
            return px, py, depth

        def project_ground(x: float, z: float) -> tuple[float, float] | None:
            projected = project_world([x, 0.0, z])
            if not projected:
                return None
            return projected[0], projected[1]

        points: list[tuple[float, float]] = []
        for item in objects:
            sampled = _blender_object_transform_at(item, time_sec)["position"]
            points.append((sampled[0], sampled[2]))
            points.extend(_blender_object_motion_path_points(item))
        for frame in keyframes:
            for key in ("position", "target"):
                value = frame.get(key)
                if isinstance(value, list) and len(value) >= 3:
                    points.append((float(value[0] or 0), float(value[2] or 0)))
        if not points:
            points = [(0, 0)]
        min_x = min(point[0] for point in points)
        max_x = max(point[0] for point in points)
        min_z = min(point[1] for point in points)
        max_z = max(point[1] for point in points)
        span = max(max_x - min_x, max_z - min_z, 8.0)
        center_x = (min_x + max_x) / 2
        center_z = (min_z + max_z) / 2

        grid_step = max(1, int(span // 10) or 1)
        start = int(center_x - span)
        end = int(center_x + span)
        for value in range(start, end + 1, grid_step):
            p1 = project_ground(value, center_z - span)
            p2 = project_ground(value, center_z + span)
            if p1 and p2:
                draw.line((p1[0], p1[1], p2[0], p2[1]), fill="#232934", width=1)
        start_z = int(center_z - span)
        end_z = int(center_z + span)
        for value in range(start_z, end_z + 1, grid_step):
            p1 = project_ground(center_x - span, value)
            p2 = project_ground(center_x + span, value)
            if p1 and p2:
                draw.line((p1[0], p1[1], p2[0], p2[1]), fill="#232934", width=1)

        if keyframes:
            path = []
            for frame in keyframes:
                position = frame.get("position") if isinstance(frame.get("position"), list) else [0, 0, 0]
                if len(position) >= 3:
                    projected = project_ground(float(position[0] or 0), float(position[2] or 0))
                    if projected:
                        path.append(projected)
            if len(path) > 1:
                draw.line(path, fill="#ccff00", width=max(2, width // 360))
            for index, point in enumerate(path, start=1):
                radius = max(5, width // 180)
                draw.ellipse((point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius), fill="#ccff00", outline="#111318", width=2)
                draw.text((point[0] + radius + 3, point[1] - radius), str(index), fill="#f5f5f1")

        asset_by_id = {item["id"]: item for item in blender_builtin_assets}
        for item in objects:
            motion_path = [
                projected
                for x, z in _blender_object_motion_path_points(item)
                if (projected := project_ground(x, z)) is not None
            ]
            if len(motion_path) > 1:
                draw.line(motion_path, fill="#ffb84d", width=max(2, width // 440))

        visible_objects: list[tuple[float, dict[str, Any], tuple[float, float, float], list[float], list[float], dict[str, Any]]] = []
        for item in objects:
            sampled_transform = _blender_object_transform_at(item, time_sec)
            position = sampled_transform["position"]
            object_scale = sampled_transform["scale"]
            asset = asset_by_id.get(str(item.get("assetId") or ""), {})
            dimensions = asset.get("dimensions") if isinstance(asset.get("dimensions"), list) else [1, 1, 1]
            sx = max(0.2, float(object_scale[0] if len(object_scale) > 0 else 1))
            sy = max(0.2, float(object_scale[1] if len(object_scale) > 1 else 1))
            h_dimension = dimensions[1] if len(dimensions) > 1 else 1
            center = [
                float(position[0] or 0),
                float(position[1] or 0) + float(h_dimension) * sy * 0.5,
                float(position[2] or 0),
            ]
            projected_center = project_world(center)
            if projected_center:
                visible_objects.append((projected_center[2], item, projected_center, position, object_scale, asset))

        for _, item, projected_center, position, object_scale, asset in sorted(visible_objects, key=lambda entry: entry[0], reverse=True):
            dimensions = asset.get("dimensions") if isinstance(asset.get("dimensions"), list) else [1, 1, 1]
            material = item.get("material") if isinstance(item.get("material"), dict) else {}
            is_green_screen = asset.get("prefab") == "greenscreen"
            color = "#00b140" if is_green_screen else str(material.get("color") or "#f2f4f7")
            px, py, depth = projected_center
            sx = max(0.2, float(object_scale[0] if len(object_scale) > 0 else 1))
            sy = max(0.2, float(object_scale[1] if len(object_scale) > 1 else 1))
            sz = max(0.2, float(object_scale[2] if len(object_scale) > 2 else 1))
            pixels_per_unit = _blender_clamp((min(width, height) * 0.34) / max(depth, 0.3), 10.0, min(width, height) * 0.48)
            w = max(12, float(dimensions[0] if len(dimensions) > 0 else 1) * sx * pixels_per_unit)
            h_dimension = dimensions[1] if len(dimensions) > 1 else 1
            h_scale = sy if is_green_screen else max(sy, sz * 0.75)
            h = max(12, float(h_dimension) * h_scale * pixels_per_unit)
            bbox = (px - w / 2, py - h / 2, px + w / 2, py + h / 2)
            shadow = (bbox[0] + 5, bbox[1] + 6, bbox[2] + 5, bbox[3] + 6)
            draw.rounded_rectangle(shadow, radius=8, fill="#090a0d")
            if asset.get("prefab") == "person":
                radius = max(8, min(w, h) / 2)
                draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill=color, outline="#f5f5f1", width=2)
            elif is_green_screen:
                metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
                texture_url = str(metadata.get("textureUrl") or "")
                texture_drawn = False
                if texture_url.startswith("/textures/"):
                    try:
                        _, _, textures_dir, _, _ = _blender_roots()
                        texture_path = _resolve_blender_file(textures_dir, texture_url.removeprefix("/textures/"))
                        texture = Image.open(texture_path).convert("RGB")
                        texture = ImageOps.fit(texture, (max(1, int(w)), max(1, int(h))))
                        image.paste(texture, (int(bbox[0]), int(bbox[1])))
                        texture_drawn = True
                    except (OSError, UnidentifiedImageError, HTTPException):
                        texture_drawn = False
                if not texture_drawn:
                    draw.rounded_rectangle(bbox, radius=8, fill=color, outline="#eafff0", width=2)
                else:
                    draw.rounded_rectangle(bbox, radius=8, outline="#00b140", width=3)
            else:
                draw.rounded_rectangle(bbox, radius=8, fill=color, outline="#f5f5f1", width=2)

        draw.text((margin, max(8, margin // 2)), "井鸽AI影视套件 Render Preview", fill="#f5f5f1")
        return image

    def _run_blender_render_job(job_id: str, scene: dict[str, Any]) -> None:
        try:
            width, height, fps, duration = _blender_render_settings(scene)
            ffmpeg = resolve_runtime_tool("ffmpeg", root_dir=runtime_root)
            if ffmpeg is None:
                raise RuntimeError("当前运行时未找到 ffmpeg，无法导出 MP4")
            storage, _, _, exports_dir, jobs_dir = _blender_roots()
            output_path = exports_dir / f"{job_id}.mp4"
            frame_dir = jobs_dir / job_id
            frame_dir.mkdir(parents=True, exist_ok=True)
            sample_fps = min(fps, 12)
            frame_count = max(1, int(math.ceil(duration * sample_fps)))
            _update_blender_render_job(job_id, {"status": "rendering", "progress": 0.08})
            for index in range(frame_count):
                time_sec = min(duration, index / sample_fps)
                frame = _blender_draw_scene_frame(scene, width, height, time_sec)
                frame.save(frame_dir / f"frame-{index:06d}.png", format="PNG", optimize=True)
                if index % max(1, frame_count // 10) == 0:
                    progress = 0.08 + (index / frame_count) * 0.62
                    _update_blender_render_job(job_id, {"progress": progress})
            _update_blender_render_job(job_id, {"progress": 0.72})
            command = [
                str(ffmpeg),
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-framerate",
                str(sample_fps),
                "-start_number",
                "0",
                "-i",
                str(frame_dir / "frame-%06d.png"),
                "-r",
                str(fps),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
            completed = subprocess.run(command, capture_output=True, text=True, check=False, timeout=240)
            if completed.returncode != 0 or not output_path.exists():
                raise RuntimeError((completed.stderr or "Blender render failed").strip())
            shutil.rmtree(frame_dir, ignore_errors=True)
            create_video_thumbnail(output_path, target_dir=storage.thumbs_dir, prefix="blender_thumb", root_dir=runtime_root)
            _update_blender_render_job(
                job_id,
                {
                    "status": "completed",
                    "progress": 1,
                    "outputPath": f"/exports/{output_path.name}",
                    "downloadUrl": f"/api/render-jobs/{job_id}/download",
                    "absoluteOutputPath": str(output_path),
                },
            )
        except Exception as exc:
            _update_blender_render_job(job_id, {"status": "failed", "progress": 1, "error": str(exc)})

    def _queue_blender_render_job(scene: dict[str, Any]) -> dict[str, Any]:
        job_id = f"render-{uuid.uuid4()}"
        now = _blender_now()
        job = {
            "id": job_id,
            "kind": "video",
            "status": "queued",
            "progress": 0,
            "createdAt": now,
            "updatedAt": now,
        }
        with blender_render_jobs_lock:
            blender_render_jobs[job_id] = job
        thread = threading.Thread(target=_run_blender_render_job, args=(job_id, scene), daemon=True)
        thread.start()
        return _public_blender_render_job(job)

    async def _save_captured_png_frames(
        files: list[UploadFile],
        frame_dir: Path,
        expected_width: int | None = None,
        expected_height: int | None = None,
    ) -> int:
        if not files:
            raise HTTPException(status_code=400, detail="At least one captured frame is required.")
        frame_dir.mkdir(parents=True, exist_ok=True)
        for index, file in enumerate(files, start=1):
            data = await file.read()
            if not data:
                raise HTTPException(status_code=400, detail="Captured frame is empty.")
            try:
                image = Image.open(BytesIO(data)).convert("RGB")
            except (OSError, UnidentifiedImageError) as exc:
                raise HTTPException(status_code=400, detail="Captured frames must be PNG images.") from exc
            if expected_width is not None and expected_height is not None:
                if image.size != (expected_width, expected_height):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Captured frame size {image.size[0]}x{image.size[1]} "
                            f"does not match export size {expected_width}x{expected_height}."
                        ),
                    )
            image.save(frame_dir / f"frame_{index:06d}.png", format="PNG", optimize=True)
        return len(files)

    def _register_blender_render_job(job: dict[str, Any]) -> dict[str, Any]:
        with blender_render_jobs_lock:
            blender_render_jobs[job["id"]] = job
        return _public_blender_render_job(job)

    def _validate_captured_frame_fps(value: int) -> int:
        if value < 1 or value > 60:
            raise HTTPException(status_code=400, detail="Captured frame FPS must be between 1 and 60.")
        return value

    def _validate_captured_frame_size(width: int, height: int) -> tuple[int, int]:
        if width < 320 or width > 3840 or height < 240 or height > 2160:
            raise HTTPException(status_code=400, detail="Captured frame size is outside the export limits.")
        width -= width % 2
        height -= height % 2
        return width, height

    def _resolve_captured_frame_size(width: int | None, height: int | None) -> tuple[int | None, int | None]:
        if width is None and height is None:
            return None, None
        if width is None or height is None:
            raise HTTPException(status_code=400, detail="Captured frame width and height must be provided together.")
        return _validate_captured_frame_size(width, height)

    def _default_canvas_state() -> dict[str, Any]:
        return {
            "version": 2,
            "nodes": [],
            "edges": [],
            "viewport": {"x": 120, "y": 80, "scale": 1},
            "canvas_theme": "white",
        }

    def _normalize_canvas_state(payload: dict[str, Any]) -> dict[str, Any]:
        raw_payload = dict(payload or {})
        if not raw_payload.get("canvas_theme") and raw_payload.get("canvasTheme"):
            raw_payload["canvas_theme"] = raw_payload.get("canvasTheme")
        state = CanvasStatePayload.model_validate(raw_payload).model_dump()
        state["version"] = 2
        allowed_node_types = {"image_input", "image_task", "video_task", "image_result", "video_result"}
        nodes = [
            item
            for item in state.get("nodes") or []
            if isinstance(item, dict) and str(item.get("type") or "").strip() in allowed_node_types
        ][:1000]
        node_ids = {str(item.get("id") or "").strip() for item in nodes}
        state["nodes"] = nodes
        state["edges"] = [
            item
            for item in state.get("edges") or []
            if isinstance(item, dict)
            and str(item.get("source_node_id") or item.get("source") or "").strip() in node_ids
            and str(item.get("target_node_id") or item.get("target") or "").strip() in node_ids
        ][:2000]
        nodes_by_id = {str(item.get("id") or "").strip(): item for item in state["nodes"]}
        result_ids_by_task: dict[str, list[str]] = {}
        for edge in state["edges"]:
            source_id = str(edge.get("source_node_id") or edge.get("source") or "").strip()
            target_id = str(edge.get("target_node_id") or edge.get("target") or "").strip()
            source_port = str(edge.get("source_port") or edge.get("sourcePort") or "out").strip() or "out"
            target_port = str(edge.get("target_port") or edge.get("targetPort") or "").strip()
            source_type = str(nodes_by_id.get(source_id, {}).get("type") or "").strip()
            target_type = str(nodes_by_id.get(target_id, {}).get("type") or "").strip()
            if (
                source_type in {"image_task", "video_task"}
                and target_type in {"image_result", "video_result"}
                and source_port in {"out", "output"}
                and target_port in {"in", "input"}
            ):
                result_ids_by_task.setdefault(source_id, []).append(target_id)

        def _result_has_artifact(node: dict[str, Any]) -> bool:
            return bool(str(node.get("public_url") or "").strip() or str(node.get("thumbnail_url") or "").strip())

        stale_result_ids: set[str] = set()
        for task_id, result_ids in result_ids_by_task.items():
            task = nodes_by_id.get(task_id) or {}
            results = [nodes_by_id[result_id] for result_id in result_ids if result_id in nodes_by_id]
            task_succeeded = str(task.get("status") or "").strip() == JOB_STATUS_SUCCEEDED
            has_artifact_result = any(_result_has_artifact(result) for result in results)
            if not task_succeeded and not has_artifact_result:
                continue
            for result in results:
                result_id = str(result.get("id") or "").strip()
                if result_id and not _result_has_artifact(result):
                    stale_result_ids.add(result_id)
        if stale_result_ids:
            state["nodes"] = [
                item for item in state["nodes"]
                if str(item.get("id") or "").strip() not in stale_result_ids
            ]
            state["edges"] = [
                item for item in state["edges"]
                if str(item.get("source_node_id") or item.get("source") or "").strip() not in stale_result_ids
                and str(item.get("target_node_id") or item.get("target") or "").strip() not in stale_result_ids
            ]
        viewport = state.get("viewport") if isinstance(state.get("viewport"), dict) else {}
        state["viewport"] = {
            "x": float(viewport.get("x") or 120),
            "y": float(viewport.get("y") or 80),
            "scale": max(0.2, min(3.0, float(viewport.get("scale") or 1))),
        }
        return state

    CANVAS_NODE_TYPES = {
        "image_input",
        "image_task",
        "video_task",
        "image_result",
        "video_result",
    }
    CANVAS_SOURCE_KINDS = {
        "image_input": "image",
        "image_result": "image",
        "video_result": "video",
    }
    CANVAS_OUTPUT_EDGES = {
        ("image_task", "image_result"),
        ("video_task", "video_result"),
    }
    CANVAS_IMAGE_CONTEXT_EDGES = {
        ("image_input", "image_input"),
        ("image_result", "image_input"),
    }

    def _canvas_image_task_ports(node: dict[str, Any]) -> set[str]:
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        mode = str(config.get("mode") or config.get("image_mode") or "text_only").strip() or "text_only"
        if mode == "base_only":
            return {"base_image"}
        if mode in {"reference_only", "multi_image", "image_edit"}:
            return {"reference_image"}
        return set()

    def _canvas_video_task_ports(node: dict[str, Any]) -> set[str]:
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        scene_type = str(config.get("scene_type") or "text_only").strip() or "text_only"
        if scene_type == "first_frame":
            return {"first_frame"}
        if scene_type == "first_last":
            return {"first_frame", "last_frame"}
        if scene_type == "multimodal_reference":
            return {"reference_image"}
        return set()

    def _canvas_task_input_ports(node: dict[str, Any]) -> dict[str, set[str]]:
        node_type = _canvas_node_type(node)
        if node_type == "image_task":
            return {port: {"image"} for port in _canvas_image_task_ports(node)}
        if node_type == "video_task":
            return {port: {"image"} for port in _canvas_video_task_ports(node)}
        return {}

    def _canvas_node_id(node: dict[str, Any]) -> str:
        return str(node.get("id") or "").strip()

    def _canvas_node_type(node: dict[str, Any]) -> str:
        return str(node.get("type") or "").strip()

    def _canvas_edge_source_id(edge: dict[str, Any]) -> str:
        return str(edge.get("source_node_id") or edge.get("source") or "").strip()

    def _canvas_edge_target_id(edge: dict[str, Any]) -> str:
        return str(edge.get("target_node_id") or edge.get("target") or "").strip()

    def _canvas_edge_source_port(edge: dict[str, Any]) -> str:
        return str(edge.get("source_port") or edge.get("sourcePort") or "out").strip() or "out"

    def _canvas_edge_target_port(edge: dict[str, Any]) -> str:
        return str(edge.get("target_port") or edge.get("targetPort") or "").strip()

    def _canvas_validate_graph(graph: CanvasStatePayload) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
        nodes_by_id: dict[str, dict[str, Any]] = {}
        for node in graph.nodes:
            node_id = _canvas_node_id(node)
            node_type = _canvas_node_type(node)
            if not node_id:
                raise HTTPException(status_code=400, detail="画板节点缺少 ID")
            if node_type not in CANVAS_NODE_TYPES:
                raise HTTPException(status_code=400, detail=f"不支持的画板节点类型：{node_type or '-'}")
            if node_id in nodes_by_id:
                raise HTTPException(status_code=400, detail=f"画板节点 ID 重复：{node_id}")
            nodes_by_id[node_id] = node

        normalized_edges: list[dict[str, Any]] = []
        for edge in graph.edges:
            source_id = _canvas_edge_source_id(edge)
            target_id = _canvas_edge_target_id(edge)
            source_port = _canvas_edge_source_port(edge)
            target_port = _canvas_edge_target_port(edge)
            source_node = nodes_by_id.get(source_id)
            target_node = nodes_by_id.get(target_id)
            if not source_node or not target_node:
                raise HTTPException(status_code=400, detail="画板连线引用了不存在的节点")
            source_type = _canvas_node_type(source_node)
            target_type = _canvas_node_type(target_node)
            if (source_type, target_type) in CANVAS_OUTPUT_EDGES:
                if source_port not in {"out", "output"} or target_port not in {"in", "input"}:
                    raise HTTPException(status_code=400, detail="任务输出连线端口不合法")
            elif (source_type, target_type) in CANVAS_IMAGE_CONTEXT_EDGES:
                if source_port not in {"out", "output"} or target_port not in {"in", "input"}:
                    raise HTTPException(status_code=400, detail="图片上下文连线端口不合法")
            else:
                source_kind = CANVAS_SOURCE_KINDS.get(source_type)
                allowed_kinds = _canvas_task_input_ports(target_node).get(target_port)
                if not source_kind or not allowed_kinds or source_kind not in allowed_kinds:
                    raise HTTPException(status_code=400, detail="画板连线类型不匹配")
            normalized_edges.append(
                {
                    **edge,
                    "source_node_id": source_id,
                    "source_port": source_port,
                    "target_node_id": target_id,
                    "target_port": target_port,
                }
            )
        return nodes_by_id, normalized_edges

    def _canvas_source_label(asset: dict[str, Any]) -> str:
        origin = str(asset.get("origin") or "").strip()
        source_mode = str(asset.get("source_mode") or "").strip()
        if source_mode == "history_snapshot":
            return "请求快照素材"
        if origin == "library_source":
            return "当前素材库"
        if origin in {"library", "library_upload"} or asset.get("library_visible"):
            return "当前素材库"
        return "上传资源"

    def _canvas_node_type_for_kind(kind: str, *, is_result: bool = False) -> str:
        normalized = str(kind or "").strip().lower()
        if is_result and normalized == "video":
            return "video_result"
        return "image_result" if is_result else "image_input"

    def _canvas_asset_item_from_asset(
        asset: dict[str, Any],
        *,
        storage_dir: str,
        history_store: HistoryStore,
        source_categories: list[str],
    ) -> dict[str, Any]:
        payload = _asset_payload(
            asset,
            storage_dir,
            history_store=history_store,
            source_categories=source_categories,
            repair=False,
        )
        display_name = str(payload.get("display_name") or payload.get("original_name") or payload.get("id") or "").strip()
        dimensions = _image_dimension_payload(payload.get("path")) if str(payload.get("kind") or "") == IMAGE_KIND else {}
        return {
            "id": f"asset:{payload['id']}",
            "node_type": _canvas_node_type_for_kind(payload.get("kind") or "image"),
            "asset_id": payload["id"],
            "kind": payload.get("kind") or "image",
            "label": display_name,
            "source_group": _canvas_source_label(payload),
            "thumbnail_url": payload.get("thumbnail_url"),
            "public_url": payload.get("public_url"),
            **dimensions,
            "tag_category": payload.get("tag_category"),
            "origin": payload.get("origin"),
            "created_at": payload.get("created_at"),
            "payload": payload,
        }

    def _canvas_result_item_from_history(
        record: dict[str, Any],
        artifact: dict[str, Any],
        artifact_index: int,
    ) -> dict[str, Any]:
        artifact_kind = str(artifact.get("kind") or record.get("kind") or "image").strip() or "image"
        label_source = (
            artifact.get("display_name")
            or Path(str(artifact.get("local_path") or artifact.get("public_url") or artifact.get("source_url") or "")).stem
            or f"{record.get('model_variant') or '生成结果'} #{artifact_index + 1}"
        )
        dimensions = _image_dimension_payload(artifact.get("local_path")) if artifact_kind == IMAGE_KIND else {}
        return {
            "id": f"result:{record['id']}:{artifact_index}",
            "node_type": _canvas_node_type_for_kind(artifact_kind, is_result=True),
            "history_id": record["id"],
            "job_id": record.get("job_id"),
            "artifact_index": artifact_index,
            "kind": artifact_kind,
            "label": str(label_source).strip() or "生成结果",
            "source_group": "当前资产包生成结果",
            "thumbnail_url": artifact.get("thumbnail_url") or artifact.get("public_url") or artifact.get("source_url"),
            "public_url": artifact.get("public_url") or artifact.get("source_url"),
            **dimensions,
            "created_at": record.get("created_at"),
            "status": record.get("status"),
            "model_variant": record.get("model_variant"),
            "prompt": record.get("prompt"),
            "payload": {
                "record": {
                    "id": record.get("id"),
                    "kind": record.get("kind"),
                    "status": record.get("status"),
                    "model_variant": record.get("model_variant"),
                    "prompt": record.get("prompt"),
                    "created_at": record.get("created_at"),
                },
                "artifact": artifact,
            },
        }

    def _canvas_history_result_items(history_store: HistoryStore, storage_dir: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for kind in (IMAGE_KIND, VIDEO_KIND):
            history_items, _total = history_store.list_history_page(kind, limit=240, offset=0)
            for record in history_items:
                if str(record.get("status") or "") != JOB_STATUS_SUCCEEDED:
                    continue
                raw_result_payload = dict(record.get("result_payload") or {})
                artifacts = list(raw_result_payload.get("artifacts") or [])
                for index, artifact in enumerate(artifacts):
                    normalized, _changed = _normalize_history_artifact(artifact, storage_dir, repair=False)
                    if str(normalized.get("kind") or record.get("kind") or "").strip() != IMAGE_KIND:
                        continue
                    items.append(_canvas_result_item_from_history(record, normalized, index))
        items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return items

    def _canvas_assets_payload(
        *,
        q: str = "",
        kind: str = "",
        source: str = "",
        limit: int = 60,
        offset: int = 0,
    ) -> dict[str, Any]:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        source_categories = _source_asset_tag_categories(history_store)
        normalized_kind = str(kind or IMAGE_KIND).strip().lower()
        source_options = [
            "当前素材库",
            "当前资产包生成结果",
            "上传资源",
            "请求快照素材",
        ]
        if normalized_kind and normalized_kind != IMAGE_KIND:
            return {
                "items": [],
                "total": 0,
                "has_more": False,
                "next_offset": None,
                "sources": source_options,
            }
        query = str(q or "").strip().lower()
        normalized_source = str(source or "").strip()

        def asset_search_text(asset: dict[str, Any]) -> str:
            return " ".join(
                str(value or "")
                for value in (
                    asset.get("display_name"),
                    asset.get("original_name"),
                    Path(str(asset.get("path") or "")).stem,
                    asset.get("tag_category"),
                    asset.get("origin"),
                )
            ).lower()

        def result_search_text(record: dict[str, Any], artifact: dict[str, Any]) -> str:
            label = (
                artifact.get("display_name")
                or Path(str(artifact.get("local_path") or artifact.get("public_url") or artifact.get("source_url") or "")).stem
            )
            return " ".join(
                str(value or "")
                for value in (
                    label,
                    record.get("prompt"),
                    record.get("model_variant"),
                    record.get("mode_key"),
                )
            ).lower()

        def raw_asset_key(asset: dict[str, Any]) -> str:
            digest = str(asset.get("content_hash") or "").strip().lower()
            if digest:
                return f"hash:{digest}"
            path = str(asset.get("path") or "").strip()
            if path:
                try:
                    return f"path:{Path(path).expanduser().resolve()}"
                except OSError:
                    return f"path:{path}"
            return f"asset:{asset.get('id') or ''}"

        def raw_result_key(artifact: dict[str, Any], record_id: str, artifact_index: int) -> str:
            path = str(artifact.get("local_path") or "").strip()
            if path:
                try:
                    return f"path:{Path(path).expanduser().resolve()}"
                except OSError:
                    return f"path:{path}"
            public_url = str(artifact.get("public_url") or artifact.get("source_url") or "").strip()
            return f"url:{public_url}" if public_url else f"result:{record_id}:{artifact_index}"

        entries: list[tuple[str, dict[str, Any], Any]] = []
        seen_keys: set[str] = set()
        include_assets = not normalized_source or normalized_source != "当前资产包生成结果"
        include_results = not normalized_source or normalized_source == "当前资产包生成结果"
        next_offset = max(0, int(offset or 0))
        next_limit = max(1, min(int(limit or 60), 80))

        if not query:
            result_items = _canvas_history_result_items(history_store, settings.storage_dir) if include_results else []
            asset_total = (
                history_store.count_canvas_assets(kind=IMAGE_KIND, source_group=normalized_source)
                if include_assets
                else 0
            )
            total = asset_total + len(result_items)
            page: list[dict[str, Any]] = []
            if include_assets and next_offset < asset_total:
                asset_limit = min(next_limit, asset_total - next_offset)
                for asset in history_store.list_canvas_assets_page(
                    kind=IMAGE_KIND,
                    source_group=normalized_source,
                    limit=asset_limit,
                    offset=next_offset,
                ):
                    page.append(
                        _canvas_asset_item_from_asset(
                            asset,
                            storage_dir=settings.storage_dir,
                            history_store=history_store,
                            source_categories=source_categories,
                        )
                    )
            remaining = next_limit - len(page)
            if include_results and remaining > 0:
                result_offset = max(0, next_offset - asset_total)
                page.extend(result_items[result_offset:result_offset + remaining])
            return {
                "items": page,
                "total": total,
                "has_more": next_offset + len(page) < total,
                "next_offset": next_offset + len(page) if next_offset + len(page) < total else None,
                "sources": source_options,
            }

        if include_assets:
            for asset in history_store.list_assets():
                if str(asset.get("kind") or "").strip() != IMAGE_KIND:
                    continue
                source_label = _canvas_source_label(asset)
                if normalized_source and source_label != normalized_source:
                    continue
                if query and query not in asset_search_text(asset):
                    continue
                key = raw_asset_key(asset)
                if key and key in seen_keys:
                    continue
                if key:
                    seen_keys.add(key)
                entries.append(("asset", asset, None))

        if include_results:
            history_items, _total = history_store.list_history_page(IMAGE_KIND, limit=240, offset=0)
            for record in history_items:
                if str(record.get("status") or "") != JOB_STATUS_SUCCEEDED:
                    continue
                artifacts = list((record.get("result_payload") or {}).get("artifacts") or [])
                for index, artifact in enumerate(artifacts):
                    artifact_kind = str(artifact.get("kind") or record.get("kind") or "").strip()
                    if artifact_kind != IMAGE_KIND:
                        continue
                    if query and query not in result_search_text(record, artifact):
                        continue
                    key = raw_result_key(artifact, str(record.get("id") or ""), index)
                    if key and key in seen_keys:
                        continue
                    if key:
                        seen_keys.add(key)
                    entries.append(("result", record, (index, artifact)))

        total = len(entries)
        page_entries = entries[next_offset:next_offset + next_limit]
        page: list[dict[str, Any]] = []
        for entry_type, item, extra in page_entries:
            if entry_type == "asset":
                page.append(
                    _canvas_asset_item_from_asset(
                        item,
                        storage_dir=settings.storage_dir,
                        history_store=history_store,
                        source_categories=source_categories,
                    )
                )
                continue
            index, artifact = extra
            normalized, _changed = _normalize_history_artifact(artifact, settings.storage_dir, repair=False)
            page.append(_canvas_result_item_from_history(item, normalized, int(index)))
        return {
            "items": page,
            "total": total,
            "has_more": next_offset + len(page) < total,
            "next_offset": next_offset + len(page) if next_offset + len(page) < total else None,
            "sources": source_options,
        }

    def _canvas_grid_split_item(
        asset: dict[str, Any],
        *,
        history_store: HistoryStore,
        storage_dir: str,
    ) -> dict[str, Any]:
        source_categories = _source_asset_tag_categories(history_store)
        item = _canvas_asset_item_from_asset(
            asset,
            storage_dir=storage_dir,
            history_store=history_store,
            source_categories=source_categories,
        )
        item["source_group"] = "宫格切分"
        return item

    def _canvas_grid_split_source_asset(
        payload: CanvasGridSplitPayload,
        *,
        history_store: HistoryStore,
        storage_dir: str,
    ) -> dict[str, Any]:
        nodes_by_id, _edges = _canvas_validate_graph(payload.graph)
        source_node = nodes_by_id.get(payload.source_node_id)
        if not source_node:
            raise HTTPException(status_code=400, detail="未找到要切分的图片节点")
        if _canvas_node_type(source_node) not in {"image_input", "image_result"}:
            raise HTTPException(status_code=400, detail="宫格切分只支持图片输入或图片结果节点")
        resolved = _canvas_resolve_source_node(source_node, history_store=history_store, storage_dir=storage_dir)
        asset = dict(resolved.get("asset") or {}) if resolved else {}
        asset_path = str(asset.get("path") or "").strip()
        if not asset_path:
            raise HTTPException(status_code=400, detail="该图片没有可切分的本地文件")
        source_path = Path(asset_path).expanduser().resolve()
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=400, detail="源图片文件不存在")
        return asset

    def _canvas_grid_split_assets(payload: CanvasGridSplitPayload) -> list[dict[str, Any]]:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        storage = ensure_storage_paths(settings.storage_dir)
        source_asset = _canvas_grid_split_source_asset(
            payload,
            history_store=history_store,
            storage_dir=settings.storage_dir,
        )
        source_path = Path(str(source_asset.get("path"))).expanduser().resolve()
        source_name = str(source_asset.get("display_name") or source_asset.get("original_name") or source_path.stem).strip() or source_path.stem
        rows = int(payload.rows)
        cols = int(payload.cols)
        created: list[dict[str, Any]] = []
        try:
            with Image.open(source_path) as raw_image:
                image = ImageOps.exif_transpose(raw_image)
                width, height = image.size
                for cell in payload.cells:
                    left = round((cell.col - 1) * width / cols)
                    right = round(cell.col * width / cols)
                    top = round((cell.row - 1) * height / rows)
                    bottom = round(cell.row * height / rows)
                    crop = image.crop((left, top, right, bottom))
                    has_alpha = "A" in crop.getbands()
                    extension = ".png" if has_alpha else ".jpg"
                    filename = f"grid_{uuid.uuid4().hex}{extension}"
                    target_path = storage.images_dir / filename
                    if has_alpha:
                        crop.convert("RGBA").save(target_path, format="PNG", optimize=True)
                        mime_type = "image/png"
                    else:
                        crop.convert("RGB").save(target_path, format="JPEG", quality=94, optimize=True)
                        mime_type = "image/jpeg"
                    crop_width, crop_height = crop.size
                    thumb_path = create_image_thumbnail(target_path, target_dir=storage.thumbs_dir, prefix="grid_thumb")
                    display_name = f"{source_name} {cell.row}-{cell.col}"
                    asset = history_store.register_asset(
                        kind=IMAGE_KIND,
                        original_name=target_path.name,
                        display_name=display_name,
                        tag_category="宫格切分",
                        origin="workspace",
                        library_visible=False,
                        source_mode="canvas_grid_split",
                        source_path=str(source_path),
                        source_root=str(storage.root_dir),
                        path=str(target_path),
                        thumbnail_path=str(thumb_path) if thumb_path else None,
                        mime_type=mime_type,
                        content_hash=file_sha256(target_path),
                    )
                    item = _canvas_grid_split_item(asset, history_store=history_store, storage_dir=settings.storage_dir)
                    item["grid_cell"] = {"row": cell.row, "col": cell.col, "rows": rows, "cols": cols}
                    item["width"] = int(crop_width)
                    item["height"] = int(crop_height)
                    created.append(item)
        except UnidentifiedImageError as exc:
            raise HTTPException(status_code=400, detail="源图片无法识别，不能切分") from exc
        except OSError as exc:
            raise HTTPException(status_code=400, detail="源图片切分失败") from exc
        return created

    def _canvas_history_artifact_asset(
        history_store: HistoryStore,
        storage_dir: str,
        node: dict[str, Any],
    ) -> dict[str, Any] | None:
        history_id = str(node.get("history_id") or node.get("config", {}).get("history_id") or "").strip()
        if not history_id:
            return None
        record = history_store.get_history(history_id)
        if not record:
            return None
        try:
            index = int(node.get("artifact_index") or node.get("config", {}).get("artifact_index") or 0)
        except (TypeError, ValueError):
            index = 0
        artifacts = list((record.get("result_payload") or {}).get("artifacts") or [])
        if index < 0 or index >= len(artifacts):
            return None
        artifact, _changed = _normalize_history_artifact(artifacts[index], storage_dir, repair=False)
        kind = str(artifact.get("kind") or record.get("kind") or "").strip()
        local_path = str(artifact.get("local_path") or "").strip()
        if kind == "image" and local_path:
            existing = history_store.find_asset_by_path(local_path)
            if existing:
                return existing
            path = Path(local_path)
            if not path.exists() or not path.is_file():
                return None
            content_hash = file_sha256(path)
            if content_hash:
                existing_by_hash = history_store.find_asset_by_content_hash(content_hash, kind="image")
                if existing_by_hash and str(existing_by_hash.get("origin") or "") != "library_source":
                    return existing_by_hash
            return history_store.register_asset(
                kind="image",
                original_name=path.name,
                display_name=path.stem,
                origin="workspace",
                library_visible=False,
                path=str(path),
                thumbnail_path=str(artifact.get("thumbnail_path") or "") or None,
                mime_type=mimetypes.guess_type(str(path))[0],
                content_hash=content_hash,
            )
        return {
            "id": "",
            "kind": kind,
            "display_name": node.get("label") or Path(local_path).stem,
            "public_url": artifact.get("public_url") or artifact.get("source_url") or node.get("public_url"),
            "thumbnail_url": artifact.get("thumbnail_url") or node.get("thumbnail_url"),
        }

    def _canvas_resolve_source_node(
        node: dict[str, Any],
        *,
        history_store: HistoryStore,
        storage_dir: str,
    ) -> dict[str, Any] | None:
        node_type = _canvas_node_type(node)
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        if node_type in {"image_input", "image_result", "video_result"} and (
            node.get("history_id") or config.get("history_id")
        ):
            asset = _canvas_history_artifact_asset(history_store, storage_dir, node)
            if not asset:
                return None
            return {
                "kind": str(asset.get("kind") or ("video" if node_type == "video_result" else "image")).strip(),
                "asset": asset,
                "asset_id": str(asset.get("id") or "").strip(),
                "public_url": asset.get("public_url") or node.get("public_url"),
                "label": str(node.get("label") or "").strip() or _asset_display_name(asset),
            }
        asset_id = str(node.get("asset_id") or config.get("asset_id") or "").strip()
        asset = history_store.get_asset(asset_id) if asset_id else None
        if asset:
            payload = _asset_payload(
                asset,
                storage_dir,
                history_store=history_store,
                source_categories=_source_asset_tag_categories(history_store),
                repair=False,
            )
            return {
                "kind": str(payload.get("kind") or CANVAS_SOURCE_KINDS.get(node_type) or "").strip(),
                "asset": asset,
                "asset_id": str(asset.get("id") or asset_id).strip(),
                "public_url": payload.get("public_url") or node.get("public_url"),
                "label": _asset_display_name(asset) or str(node.get("label") or "").strip(),
            }
        return {
            "kind": CANVAS_SOURCE_KINDS.get(node_type) or "",
            "asset": {},
            "asset_id": "",
            "public_url": str(node.get("public_url") or config.get("public_url") or "").strip(),
            "label": str(node.get("label") or "").strip(),
        }

    def _canvas_task_inputs(
        target_node_id: str,
        nodes_by_id: dict[str, dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> dict[str, list[dict[str, Any]]]:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        by_port: dict[str, list[dict[str, Any]]] = {}
        seen_by_port: dict[str, set[str]] = {}
        for edge in edges:
            if edge["target_node_id"] != target_node_id:
                continue
            source_node = nodes_by_id.get(edge["source_node_id"])
            if not source_node:
                continue
            resolved = _canvas_resolve_source_node(source_node, history_store=history_store, storage_dir=settings.storage_dir)
            if not resolved:
                continue
            port = str(edge["target_port"] or "").strip()
            key = str(resolved.get("asset_id") or resolved.get("public_url") or edge["source_node_id"]).strip()
            if not key:
                continue
            seen = seen_by_port.setdefault(port, set())
            if key in seen:
                continue
            seen.add(key)
            by_port.setdefault(port, []).append(resolved)
        return by_port

    def _first_image_model_variant(value: Any = None) -> str:
        normalized = str(value or "").strip()
        if normalized in IMAGE_MODELS:
            return normalized
        if DEFAULT_IMAGE_MODEL_VARIANT in IMAGE_MODELS:
            return DEFAULT_IMAGE_MODEL_VARIANT
        return next(iter(IMAGE_MODELS.keys()))

    def _first_video_model_variant(value: Any = None) -> str:
        normalized = str(value or "").strip()
        if normalized in VIDEO_MODELS:
            return normalized
        return next(iter(VIDEO_MODELS.keys()))

    def _safe_int(value: Any, default: int, *, minimum: int, maximum: int) -> int:
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            normalized = default
        return max(minimum, min(maximum, normalized))

    def _canvas_required_asset_id(source: dict[str, Any], *, port_label: str) -> str:
        asset_id = str(source.get("asset_id") or "").strip()
        if not asset_id:
            raise HTTPException(status_code=400, detail=f"{port_label} 必须绑定当前资产包内的图片素材")
        return asset_id

    def _canvas_source_tag_category(source: dict[str, Any], fallback: str) -> str:
        asset = source.get("asset") if isinstance(source.get("asset"), dict) else {}
        return str(asset.get("tag_category") or "").strip() or fallback

    def _canvas_asset_annotations(sources: list[tuple[dict[str, Any], str, str]]) -> list[dict[str, Any]]:
        annotations: list[dict[str, Any]] = []
        seen: set[str] = set()
        for source, asset_id, fallback_category in sources:
            normalized_id = str(asset_id or "").strip()
            if not normalized_id or normalized_id in seen:
                continue
            seen.add(normalized_id)
            label = str(source.get("label") or "").strip()
            annotations.append(
                {
                    "asset_id": normalized_id,
                    "tag_category": _canvas_source_tag_category(source, fallback_category),
                    "tag_sequence": 1,
                    "mention_name": label or None,
                }
            )
        return annotations

    def _canvas_image_request(payload: CanvasRunPayload) -> ImageGenerateRequest:
        nodes_by_id, edges = _canvas_validate_graph(payload.graph)
        target_node = nodes_by_id.get(payload.target_node_id)
        if not target_node or _canvas_node_type(target_node) != "image_task":
            raise HTTPException(status_code=400, detail="请选择一个生图任务节点运行")
        params = dict(target_node.get("config") or {})
        model_variant = _first_image_model_variant(params.get("model_variant"))
        spec = IMAGE_MODELS[model_variant]
        aspect_ratio = str(params.get("aspect_ratio") or spec.get("default_aspect_ratio") or "1:1").strip()
        size = str(params.get("size") or spec.get("default_size") or "").strip()
        if not size:
            options = spec.get("size_options_by_ratio", {}).get(aspect_ratio) or spec.get("size_options") or []
            size = str((options[0] if options else {}).get("value") or "").strip()
        inputs = _canvas_task_inputs(payload.target_node_id, nodes_by_id, edges)
        base_sources = inputs.get("base_image") or []
        if len(base_sources) > 1:
            raise HTTPException(status_code=400, detail="生图任务只能连接一张基础图")
        base_id = _canvas_required_asset_id(base_sources[0], port_label="基础图") if base_sources else ""
        reference_pairs = [
            (item, _canvas_required_asset_id(item, port_label="参考图"))
            for item in inputs.get("reference_image") or []
        ]
        canvas_template = str(params.get("canvas_template") or params.get("grid_template") or "").strip()
        if canvas_template == "multi_camera_9" and not base_sources and not reference_pairs:
            raise HTTPException(status_code=400, detail="多机位宫格需要连接参考图")
        reference_ids = [asset_id for _source, asset_id in reference_pairs]
        reference_ids = [item for item in dict.fromkeys(reference_ids) if item and item != base_id]
        promoted_edit_source: tuple[dict[str, Any], str] | None = None
        mode = str(params.get("mode") or params.get("image_mode") or spec.get("default_mode") or "text_only").strip()
        prompt = str(params.get("prompt") or target_node.get("prompt") or "").strip()
        if not prompt:
            raise HTTPException(status_code=400, detail="生图任务需要填写提示词")
        annotation_sources: list[tuple[dict[str, Any], str, str]] = []
        if base_sources and base_id:
            annotation_sources.append((base_sources[0], base_id, "基础图"))
        elif promoted_edit_source:
            annotation_sources.append((promoted_edit_source[0], promoted_edit_source[1], "编辑图"))
        annotation_sources.extend(
            (source, asset_id, "参考图")
            for source, asset_id in reference_pairs
            if asset_id in reference_ids
        )
        return ImageGenerateRequest(
            model_variant=model_variant,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            size=size,
            count=_safe_int(params.get("count"), 1, minimum=1, maximum=15),
            sequential_mode=bool(params.get("sequential_mode") or False),
            output_format=str(params.get("output_format") or spec.get("default_output_format") or "jpeg"),
            quality=str(params.get("quality") or spec.get("default_quality") or "auto"),
            background=str(params.get("background") or spec.get("default_background") or "auto"),
            moderation=str(params.get("moderation") or spec.get("default_moderation") or "auto"),
            output_compression=_safe_int(
                params.get("output_compression"),
                int(spec.get("default_output_compression") or 100),
                minimum=0,
                maximum=100,
            ),
            enable_web_search=bool(params.get("enable_web_search") or False),
            input_asset_id=base_id or None,
            reference_asset_ids=reference_ids,
            asset_annotations=_canvas_asset_annotations(annotation_sources),
        )

    def _canvas_video_request(payload: CanvasRunPayload) -> VideoGenerateRequest:
        nodes_by_id, edges = _canvas_validate_graph(payload.graph)
        target_node = nodes_by_id.get(payload.target_node_id)
        if not target_node or _canvas_node_type(target_node) != "video_task":
            raise HTTPException(status_code=400, detail="请选择一个生视频任务节点运行")
        params = dict(target_node.get("config") or {})
        model_variant = _first_video_model_variant(params.get("model_variant"))
        inputs = _canvas_task_inputs(payload.target_node_id, nodes_by_id, edges)
        first_sources = inputs.get("first_frame") or []
        last_sources = inputs.get("last_frame") or []
        if len(first_sources) > 1:
            raise HTTPException(status_code=400, detail="生视频任务只能连接一张首帧图")
        if len(last_sources) > 1:
            raise HTTPException(status_code=400, detail="生视频任务只能连接一张尾帧图")
        first_frame = _canvas_required_asset_id(first_sources[0], port_label="首帧") if first_sources else ""
        last_frame = _canvas_required_asset_id(last_sources[0], port_label="尾帧") if last_sources else ""
        reference_pairs = [
            (item, _canvas_required_asset_id(item, port_label="参考图"))
            for item in inputs.get("reference_image") or []
        ]
        reference_ids = [asset_id for _source, asset_id in reference_pairs]
        scene_type = str(params.get("scene_type") or "text_only").strip() or "text_only"
        if scene_type == "text_only":
            first_frame = ""
            last_frame = ""
            reference_ids = []
        elif scene_type == "first_frame":
            last_frame = ""
            reference_ids = []
        elif scene_type == "first_last":
            reference_ids = []
        elif scene_type == "multimodal_reference":
            first_frame = ""
            last_frame = ""
        annotation_sources: list[tuple[dict[str, Any], str, str]] = []
        if first_sources and first_frame:
            annotation_sources.append((first_sources[0], first_frame, "首帧"))
        if last_sources and last_frame:
            annotation_sources.append((last_sources[0], last_frame, "尾帧"))
        annotation_sources.extend(
            (source, asset_id, "参考图")
            for source, asset_id in reference_pairs
            if asset_id in reference_ids
        )
        video_ui = video_ui_schema()
        default_resolution = next((item["value"] for item in video_ui.get("resolutions", []) if item["value"] == "720p"), "")
        default_resolution = default_resolution or str((video_ui.get("resolutions") or [{"value": "720p"}])[0]["value"])
        return VideoGenerateRequest(
            model_variant=model_variant,
            prompt=str(params.get("prompt") or target_node.get("prompt") or "").strip(),
            scene_type=scene_type,
            resolution_grade=str(params.get("resolution_grade") or default_resolution),
            ratio=str(params.get("ratio") or "adaptive"),
            duration=_safe_int(params.get("duration"), 5, minimum=4, maximum=15),
            count=_safe_int(params.get("count"), 1, minimum=1, maximum=15),
            seed=_safe_int(params.get("seed"), -1, minimum=-1, maximum=2147483647),
            generate_audio=bool(params.get("generate_audio", True)),
            first_frame_asset_id=first_frame or None,
            last_frame_asset_id=last_frame or None,
            reference_image_asset_ids=[item for item in dict.fromkeys(reference_ids) if item],
            trusted_asset_uris=[],
            reference_video_urls=[],
            reference_audio_urls=[],
            asset_annotations=_canvas_asset_annotations(annotation_sources),
        )

    def _json_response_payload(response: JSONResponse) -> dict[str, Any]:
        try:
            return json.loads(response.body.decode("utf-8"))
        except Exception:
            return {}

    def _require_kind(kind: str) -> None:
        if kind not in {IMAGE_KIND, VIDEO_KIND}:
            raise HTTPException(status_code=404, detail="unsupported history kind")

    def _require_image_api_key(model_variant: str) -> None:
        settings = _current_settings()
        provider = str(IMAGE_MODELS[model_variant].get("provider") or "volcengine").strip()
        field_name = IMAGE_PROVIDER_API_KEY_FIELDS.get(provider, "volcengine_api_key")
        api_key = str(getattr(settings, field_name, "") or "").strip()
        if api_key:
            return
        key_names = {
            "volcengine": "Volcengine API Key",
            "kling": "Kling API Key",
        }
        detail = f"请先在设置页配置 {key_names.get(provider, 'Volcengine API Key')}"
        raise HTTPException(status_code=400, detail=detail)

    def _require_video_api_key(model_variant: str) -> None:
        settings = _current_settings()
        provider = video_model_provider(model_variant) if model_variant in VIDEO_MODELS else "volcengine"
        field_name = VIDEO_PROVIDER_API_KEY_FIELDS.get(provider, "volcengine_api_key")
        api_key = str(getattr(settings, field_name, "") or "").strip()
        if api_key:
            return
        key_names = {
            "volcengine": "Volcengine API Key",
            "kling": "Kling API Key",
        }
        raise HTTPException(status_code=400, detail=f"请先在设置页配置 {key_names.get(provider, 'Volcengine API Key')}")

    def _update_history_record(
        history_store: HistoryStore,
        record_id: str,
        *,
        status: str,
        params_actual: dict[str, Any] | None = None,
        result_payload: dict[str, Any] | None = None,
        local_paths: list[str] | None = None,
        thumbnail_path: str | None = None,
        error_message: str | None = None,
        elapsed_ms: int | None = None,
    ) -> None:
        history_store.update_history_record(
            record_id,
            status=status,
            params_actual=params_actual,
            result_payload=result_payload,
            local_paths=local_paths,
            thumbnail_path=thumbnail_path,
            error_message=error_message,
            elapsed_ms=elapsed_ms,
        )

    def _start_job(
        *,
        kind: str,
        model_variant: str,
        prompt: str,
        params_requested: dict[str, Any],
        runner,
        batch_session_id: str | None = None,
        batch_position: int | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any], HistoryStore]:
        job_id = uuid.uuid4().hex
        storage_dir = _current_settings().storage_dir
        history_store = _history_store_for_storage_dir(storage_dir)
        record = history_store.create_history_record(
            job_id=job_id,
            batch_session_id=batch_session_id,
            batch_position=batch_position,
            kind=kind,
            status=JOB_STATUS_PENDING,
            model_variant=model_variant,
            mode_key=_history_mode_key(kind, params_requested),
            prompt=prompt,
            params_requested=params_requested,
        )

        def _managed_runner(ctx):
            started = time.monotonic()
            try:
                result = runner(ctx)
                elapsed_ms = int((time.monotonic() - started) * 1000)
                result["elapsed_ms"] = int(result.get("elapsed_ms") or elapsed_ms)
                _update_history_record(
                    history_store,
                    record["id"],
                    status=str(result.get("status") or JOB_STATUS_SUCCEEDED),
                    params_actual=result.get("params_actual"),
                    result_payload=result.get("result_payload"),
                    local_paths=result.get("local_paths"),
                    thumbnail_path=result.get("thumbnail_path"),
                    error_message=result.get("error_message"),
                    elapsed_ms=result.get("elapsed_ms"),
                )
                return result
            except JobCancelledError:
                elapsed_ms = int((time.monotonic() - started) * 1000)
                _update_history_record(
                    history_store,
                    record["id"],
                    status=JOB_STATUS_CANCELLED,
                    error_message="任务已取消",
                    elapsed_ms=elapsed_ms,
                )
                raise
            except Exception as exc:
                elapsed_ms = int((time.monotonic() - started) * 1000)
                _update_history_record(
                    history_store,
                    record["id"],
                    status=JOB_STATUS_FAILED,
                    error_message=str(exc),
                    elapsed_ms=elapsed_ms,
                )
                raise

        snapshot = jobs.submit(
            job_id=job_id,
            kind=kind,
            history_id=record["id"],
            runner=_managed_runner,
        )
        return snapshot, record, history_store

    def _submit_image_batch(payload: ImageGenerateRequest) -> JSONResponse:
        history_store = _current_history_store()
        storage_dir = _current_settings().storage_dir
        requested_payload = payload.model_dump()
        requested_payload.update(_image_asset_name_snapshot(history_store, payload))
        requested_payload.update(_image_request_snapshot_fields(history_store, storage_dir, requested_payload))
        if payload.count <= 1:
            params_requested = dict(requested_payload)
            snapshot, record, _ = _start_job(
                kind=IMAGE_KIND,
                model_variant=payload.model_variant,
                prompt=payload.prompt,
                params_requested=params_requested,
                runner=lambda ctx: image_service.run(payload, ctx),
            )
            snapshot["submitted_count"] = 1
            snapshot["job_ids"] = [snapshot["job_id"]]
            snapshot["history_ids"] = [record["id"]]
            snapshot["batch_session_id"] = None
            snapshot["kind"] = IMAGE_KIND
            return JSONResponse(snapshot, status_code=202)

        batch_session_id = uuid.uuid4().hex

        if not payload.sequential_mode:
            job_ids: list[str] = []
            history_ids: list[str] = []
            first_snapshot: dict[str, Any] | None = None
            for index in range(payload.count):
                child_request = payload.model_copy(update={"count": 1, "sequential_mode": False})
                params_requested = {
                    **requested_payload,
                    "count": 1,
                    "sequential_mode": False,
                    "batch_requested_count": payload.count,
                }
                snapshot, record, _ = _start_job(
                    kind=IMAGE_KIND,
                    model_variant=payload.model_variant,
                    prompt=payload.prompt,
                    params_requested=params_requested,
                    runner=lambda ctx, request=child_request: image_service.run(request, ctx),
                    batch_session_id=batch_session_id,
                    batch_position=index + 1,
                )
                if first_snapshot is None:
                    first_snapshot = snapshot
                job_ids.append(snapshot["job_id"])
                history_ids.append(record["id"])
            jobs.register_batch(batch_session_id, job_ids)
            return JSONResponse(
                {
                    **(first_snapshot or {}),
                    "submitted_count": len(job_ids),
                    "job_ids": job_ids,
                    "history_ids": history_ids,
                    "batch_session_id": batch_session_id,
                    "kind": IMAGE_KIND,
                    "message": f"已提交 {len(job_ids)} 个独立图片任务",
                },
                status_code=202,
            )

        entries: list[dict[str, Any]] = []
        job_ids: list[str] = []
        history_ids: list[str] = []
        started = time.monotonic()
        for index in range(payload.count):
            job_id = uuid.uuid4().hex
            record = history_store.create_history_record(
                job_id=job_id,
                batch_session_id=batch_session_id,
                batch_position=index + 1,
                kind=IMAGE_KIND,
                status=JOB_STATUS_PENDING,
                model_variant=payload.model_variant,
                mode_key=_history_mode_key(IMAGE_KIND, {
                    **requested_payload,
                    "count": 1,
                    "sequential_mode": True,
                    "batch_requested_count": payload.count,
                }),
                prompt=payload.prompt,
                params_requested={
                    **requested_payload,
                    "count": 1,
                    "sequential_mode": True,
                    "batch_requested_count": payload.count,
                },
            )
            jobs.create(job_id=job_id, kind=IMAGE_KIND, history_id=record["id"])
            entries.append({"job_id": job_id, "record": record})
            job_ids.append(job_id)
            history_ids.append(record["id"])
        jobs.register_batch(batch_session_id, job_ids)

        def _finalize_entry(entry: dict[str, Any], result: dict[str, Any]) -> None:
            _update_history_record(
                history_store,
                entry["record"]["id"],
                status=str(result.get("status") or JOB_STATUS_SUCCEEDED),
                params_actual=result.get("params_actual"),
                result_payload=result.get("result_payload"),
                local_paths=result.get("local_paths"),
                thumbnail_path=result.get("thumbnail_path"),
                error_message=result.get("error_message"),
                elapsed_ms=result.get("elapsed_ms"),
            )
            jobs.finalize_manual(entry["job_id"], result)

        def _fail_pending_entries(message: str, *, status: str = JOB_STATUS_FAILED) -> None:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            for entry in entries:
                snapshot = jobs.get(entry["job_id"])
                if not snapshot or snapshot["status"] in JOB_TERMINAL_STATUSES:
                    continue
                _update_history_record(
                    history_store,
                    entry["record"]["id"],
                    status=status,
                    error_message=message,
                    elapsed_ms=elapsed_ms,
                )
                jobs.fail_manual(
                    entry["job_id"],
                    message=message,
                    error_message=message,
                    status=status,
                )

        def _coordinator() -> None:
            for position, entry in enumerate(entries, start=1):
                jobs.publish_manual(
                    entry["job_id"],
                    status="running",
                    message=f"组图任务进行中 {position}/{len(entries)}",
                )
            try:
                def _on_artifact(artifact: dict[str, Any], position: int) -> None:
                    if position > len(entries):
                        return
                    entry = entries[position - 1]
                    elapsed_ms = int((time.monotonic() - started) * 1000)
                    result = {
                        "status": JOB_STATUS_SUCCEEDED,
                        "message": f"组图返回第 {position}/{len(entries)} 张",
                        "outputs": [artifact],
                        "params_actual": {
                            "payload_mode": "group_batch",
                            "compiled_prompt": payload.prompt,
                            "generated_count": 1,
                        },
                        "result_payload": {"artifacts": [artifact]},
                        "local_paths": [artifact["local_path"]] if artifact.get("local_path") else [],
                        "thumbnail_path": artifact.get("thumbnail_path") or artifact.get("local_path"),
                        "elapsed_ms": elapsed_ms,
                    }
                    _finalize_entry(entry, result)

                group_request = payload.model_copy(update={"count": payload.count, "sequential_mode": True})
                result = image_service.run_group_batch(
                    group_request,
                    on_artifact=_on_artifact,
                    should_cancel=lambda: jobs.any_cancel_requested(job_ids),
                )
                if result["generated_count"] < len(entries):
                    _fail_pending_entries("组图返回数量不足")
            except JobCancelledError:
                _fail_pending_entries("任务已取消", status=JOB_STATUS_CANCELLED)
            except Exception as exc:
                _fail_pending_entries(str(exc), status=JOB_STATUS_FAILED)

        jobs.executor.submit(_coordinator)
        first_snapshot = jobs.get(job_ids[0]) or {}
        return JSONResponse(
            {
                **first_snapshot,
                "submitted_count": len(job_ids),
                "job_ids": job_ids,
                "history_ids": history_ids,
                "batch_session_id": batch_session_id,
                "kind": IMAGE_KIND,
                "message": f"已提交 {len(job_ids)} 个组图子任务",
            },
            status_code=202,
        )

    def _submit_video(payload: VideoGenerateRequest) -> JSONResponse:
        history_store = _current_history_store()
        storage_dir = _current_settings().storage_dir
        requested_payload = payload.model_dump()
        requested_payload.update(_video_asset_name_snapshot(history_store, payload))
        requested_payload.update(_video_request_snapshot_fields(history_store, storage_dir, requested_payload))
        if payload.count <= 1:
            params_requested = dict(requested_payload)
            snapshot, record, _ = _start_job(
                kind=VIDEO_KIND,
                model_variant=payload.model_variant,
                prompt=payload.prompt,
                params_requested=params_requested,
                runner=lambda ctx: video_service.run(payload, ctx),
            )
            snapshot["submitted_count"] = 1
            snapshot["job_ids"] = [snapshot["job_id"]]
            snapshot["history_ids"] = [record["id"]]
            snapshot["batch_session_id"] = None
            snapshot["kind"] = VIDEO_KIND
            return JSONResponse(snapshot, status_code=202)

        batch_session_id = uuid.uuid4().hex
        job_ids: list[str] = []
        history_ids: list[str] = []
        first_snapshot: dict[str, Any] | None = None
        for index in range(payload.count):
            child_request = payload.model_copy(update={"count": 1})
            params_requested = {
                **requested_payload,
                "count": 1,
                "batch_requested_count": payload.count,
            }
            snapshot, record, _ = _start_job(
                kind=VIDEO_KIND,
                model_variant=payload.model_variant,
                prompt=payload.prompt,
                params_requested=params_requested,
                runner=lambda ctx, request=child_request: video_service.run(request, ctx),
                batch_session_id=batch_session_id,
                batch_position=index + 1,
            )
            if first_snapshot is None:
                first_snapshot = snapshot
            job_ids.append(snapshot["job_id"])
            history_ids.append(record["id"])
        jobs.register_batch(batch_session_id, job_ids)
        return JSONResponse(
            {
                **(first_snapshot or {}),
                "submitted_count": len(job_ids),
                "job_ids": job_ids,
                "history_ids": history_ids,
                "batch_session_id": batch_session_id,
                "kind": VIDEO_KIND,
                "message": f"已提交 {len(job_ids)} 个独立视频任务",
            },
            status_code=202,
        )

    @app.get("/", response_class=RedirectResponse)
    async def home() -> RedirectResponse:
        return RedirectResponse(url="/image", status_code=302)

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "app": APP_HEALTH_NAME, "runtime_id": app.state.runtime_id}

    @app.get("/image", response_class=HTMLResponse)
    async def image_page(request: Request) -> HTMLResponse:
        page_config = _workspace_page_config(IMAGE_KIND)
        return templates.TemplateResponse(
            request,
            "workspace.html",
            {
                "request": request,
                "page_title": "生图",
                "active_tab": IMAGE_KIND,
                "page_config": page_config,
                "theme": page_config["theme"],
                "theme_tokens": _theme_tokens(page_config["theme"]),
            },
        )

    @app.get("/video", response_class=HTMLResponse)
    async def video_page(request: Request) -> HTMLResponse:
        page_config = _workspace_page_config(VIDEO_KIND)
        return templates.TemplateResponse(
            request,
            "workspace.html",
            {
                "request": request,
                "page_title": "生视频",
                "active_tab": VIDEO_KIND,
                "page_config": page_config,
                "theme": page_config["theme"],
                "theme_tokens": _theme_tokens(page_config["theme"]),
            },
        )

    @app.get("/canvas", response_class=HTMLResponse)
    async def canvas_page(request: Request) -> HTMLResponse:
        page_config = _canvas_page_config()
        return templates.TemplateResponse(
            request,
            "canvas.html",
            {
                "request": request,
                "page_title": "无限画布",
                "active_tab": "canvas",
                "page_config": page_config,
                "theme": page_config["theme"],
                "theme_tokens": _theme_tokens(page_config["theme"]),
            },
        )

    @app.get("/blender", response_class=HTMLResponse)
    async def blender_page(request: Request) -> HTMLResponse:
        page_config = _blender_page_config()
        return templates.TemplateResponse(
            request,
            "blender.html",
            {
                "request": request,
                "page_title": "Blender",
                "active_tab": "blender",
                "page_config": page_config,
                "theme": page_config["theme"],
                "theme_tokens": _theme_tokens(page_config["theme"]),
            },
        )

    @app.get("/blender/app", response_class=HTMLResponse)
    async def blender_app() -> HTMLResponse:
        index_path = package_dir / "static" / "blender-app" / "index.html"
        if not index_path.exists():
            raise HTTPException(status_code=500, detail="井鸽AI影视套件构建产物缺失")
        return HTMLResponse(index_path.read_text(encoding="utf-8"))

    @app.get("/library", response_class=HTMLResponse)
    async def library_page(request: Request) -> HTMLResponse:
        page_config = _library_page_config()
        return templates.TemplateResponse(
            request,
            "library.html",
            {
                "request": request,
                "page_title": "素材库",
                "active_tab": "library",
                "page_config": page_config,
                "theme": page_config["theme"],
                "theme_tokens": _theme_tokens(page_config["theme"]),
            },
        )

    @app.get("/settings", response_class=HTMLResponse)
    async def settings_page(request: Request) -> HTMLResponse:
        page_config = _settings_page_config()
        return templates.TemplateResponse(
            request,
            "settings.html",
            {
                "request": request,
                "page_title": "设置",
                "active_tab": "settings",
                "page_config": page_config,
                "theme": page_config["theme"],
                "theme_tokens": _theme_tokens(page_config["theme"]),
            },
        )

    @app.get("/api/history/{kind}")
    async def api_history(kind: str, limit: int = 120, offset: int = 0, repair: bool = True, view: str = "full") -> dict:
        _require_kind(kind)
        normalized_view = str(view or "full").strip().lower()
        if normalized_view not in {"full", "summary"}:
            raise HTTPException(status_code=400, detail="unsupported history view")
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        repair_scheduled = (
            history_repair.schedule(settings.storage_dir, kind, history_store, settings=settings) if repair else False
        )
        items, total, has_more = _history_items_with_live(
            kind,
            limit=max(1, min(limit, 240)),
            offset=max(0, offset),
            view=normalized_view,
            repair=repair,
        )
        return {
            "items": items,
            "total": total,
            "has_more": has_more,
            "history_counts": _history_counts(),
            "repair_scheduled": repair_scheduled,
        }

    @app.get("/api/canvas/state")
    async def api_canvas_state() -> dict:
        history_store = _current_history_store()
        raw_state = history_store.get_canvas_state() or _default_canvas_state()
        state = _normalize_canvas_state(raw_state)
        if state != raw_state:
            state = history_store.save_canvas_state(state)
        return {"state": state}

    @app.put("/api/canvas/state")
    async def api_save_canvas_state(payload: CanvasStatePayload) -> dict:
        history_store = _current_history_store()
        state = history_store.save_canvas_state(_normalize_canvas_state(payload.model_dump()))
        return {"state": state}

    @app.get("/api/canvas/assets")
    async def api_canvas_assets(
        q: str = "",
        kind: str = "",
        source: str = "",
        limit: int = 60,
        offset: int = 0,
    ) -> dict:
        return _canvas_assets_payload(
            q=q,
            kind=kind,
            source=source,
            limit=limit,
            offset=offset,
        )

    @app.post("/api/canvas/result-to-library")
    async def api_canvas_result_to_library(payload: CanvasResultToLibraryPayload) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        category = _normalize_tag_category(payload.tag_category) or "画布库"
        record = history_store.get_history(payload.history_id)
        if not record:
            raise HTTPException(status_code=404, detail="history record not found")
        if str(record.get("kind") or "").strip() != IMAGE_KIND:
            raise HTTPException(status_code=400, detail="只有图片结果可以加入素材库")
        asset = _canvas_history_artifact_asset(
            history_store,
            settings.storage_dir,
            {
                "history_id": payload.history_id,
                "artifact_index": payload.artifact_index,
            },
        )
        if not asset or not str(asset.get("id") or "").strip():
            raise HTTPException(status_code=400, detail="图片结果文件不可用，无法加入素材库")
        _ensure_library_category_dir(history_store, category)
        display_name = _unique_library_name(
            history_store,
            category,
            payload.display_name or _asset_display_name(asset),
            exclude_asset_id=str(asset.get("id") or ""),
        )
        try:
            updated = history_store.update_asset_metadata(
                str(asset["id"]),
                display_name=display_name,
                tag_category=category,
                origin="workspace",
                library_visible=True,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="asset not found") from exc
        return {
            "asset": _asset_payload(
                updated,
                settings.storage_dir,
                history_store=history_store,
                source_categories=_source_asset_tag_categories(history_store),
            ),
            "categories": _asset_tag_categories(history_store),
        }

    @app.post("/api/canvas/grid-split")
    async def api_canvas_grid_split(payload: CanvasGridSplitPayload) -> dict:
        items = _canvas_grid_split_assets(payload)
        return {"items": items, "count": len(items)}

    @app.post("/api/canvas/runs")
    async def api_canvas_run(payload: CanvasRunPayload) -> JSONResponse:
        nodes_by_id, _edges = _canvas_validate_graph(payload.graph)
        target_node = nodes_by_id.get(payload.target_node_id)
        target_type = _canvas_node_type(target_node or {})
        try:
            if target_type == "image_task":
                request_payload = _canvas_image_request(payload)
                _require_image_api_key(request_payload.model_variant)
                response = _submit_image_batch(request_payload)
                run_kind = IMAGE_KIND
            elif target_type == "video_task":
                request_payload = _canvas_video_request(payload)
                _require_video_api_key(request_payload.model_variant)
                response = _submit_video(request_payload)
                run_kind = VIDEO_KIND
            else:
                raise HTTPException(status_code=400, detail="请选择一个生图或生视频任务节点运行")
        except ValidationError as exc:
            first_error = exc.errors()[0] if exc.errors() else {}
            raise HTTPException(status_code=422, detail=first_error.get("msg") or "画板任务参数不合法") from exc
        body = _json_response_payload(response)
        body["canvas"] = {
            "kind": run_kind,
            "target_node_id": payload.target_node_id,
            "params_requested": request_payload.model_dump(),
        }
        return JSONResponse(body, status_code=response.status_code)

    @app.get("/api/stats/durations")
    async def api_duration_stats() -> dict:
        return {
            "image": _duration_stats(IMAGE_KIND),
            "video": _duration_stats(VIDEO_KIND),
        }

    @app.get("/api/network/status")
    async def api_network_status() -> dict:
        return _network_status_payload()

    @app.post("/api/network/check")
    async def api_network_check(payload: SettingsPayload | None = Body(default=None)) -> dict:
        settings = _preview_settings(payload)
        manager = ProviderNetworkManager(settings, force_proxy_refresh=True)
        api_keys = _current_api_keys(settings)
        return {
            "api_network_auto_switch": manager.auto_switch,
            "api_proxy_url": manager.configured_proxy_url,
            "detected_proxy_url": manager.detected_proxy_url,
            "active_proxy_url": manager.proxy_url,
            "proxy_source": manager.proxy_source,
            "proxy_detected": bool(manager.proxy_url),
            "results": {
                "volcengine": manager.check_provider(
                    "volcengine",
                    api_key=api_keys.get("volcengine", ""),
                ),
                "kling": manager.check_provider(
                    "kling",
                    api_key=api_keys.get("kling", ""),
                ),
            },
        }

    @app.post("/api/settings")
    async def api_settings(payload: SettingsPayload) -> dict:
        current_settings = _current_settings()
        next_storage_dir = _normalize_storage_dir(payload.storage_dir)
        current_storage_dir = _normalize_storage_dir(current_settings.storage_dir)
        if next_storage_dir != current_storage_dir and jobs.has_active_jobs():
            raise HTTPException(status_code=409, detail="当前有任务正在运行，请等待任务完成后再切换资产包路径")
        saved = settings_store.save(payload.model_dump())
        return {"settings": saved.to_dict()}

    @app.post("/api/system/pick-directory")
    async def api_pick_directory(payload: dict[str, Any] = Body(default={})) -> dict:
        initial_dir = str((payload or {}).get("initial_dir") or _current_settings().storage_dir)
        prompt = str((payload or {}).get("prompt") or "选择目录")
        try:
            selected = pick_directory(initial_dir, prompt=prompt)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"storage_dir": selected, "selected_dir": selected}

    @app.post("/api/history/{history_id}/delete")
    async def api_delete_history(history_id: str, payload: DeleteHistoryPayload) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        record = history_store.get_history(history_id)
        if not record:
            raise HTTPException(status_code=404, detail="history record not found")
        snapshot = jobs.get(record["job_id"])
        if snapshot and snapshot["status"] not in JOB_TERMINAL_STATUSES:
            raise HTTPException(status_code=409, detail="任务仍在运行，请先取消后再删除")
        deleted_record = history_store.delete_history_record(history_id)
        if not deleted_record:
            raise HTTPException(status_code=404, detail="history record not found")
        deleted_outputs_count = 0
        if payload.delete_outputs:
            deleted_outputs_count = _delete_history_outputs(
                deleted_record,
                settings.storage_dir,
                history_store=history_store,
            )
        return {
            "deleted": True,
            "history_id": history_id,
            "deleted_outputs_count": deleted_outputs_count,
        }

    @app.post("/api/history/{kind}/delete-failed")
    async def api_delete_failed_history(kind: str, payload: DeleteHistoryPayload) -> dict:
        _require_kind(kind)
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        records = history_store.list_failed_history(kind)
        deleted_count = 0
        skipped_active_count = 0
        deleted_outputs_count = 0
        deleted_ids: list[str] = []
        for record in records:
            snapshot = jobs.get(record["job_id"])
            if snapshot and snapshot["status"] not in JOB_TERMINAL_STATUSES:
                skipped_active_count += 1
                continue
            deleted_record = history_store.delete_history_record(str(record["id"]))
            if not deleted_record:
                continue
            deleted_count += 1
            deleted_ids.append(str(record["id"]))
            if payload.delete_outputs:
                deleted_outputs_count += _delete_history_outputs(
                    deleted_record,
                    settings.storage_dir,
                    history_store=history_store,
                )
        return {
            "deleted": deleted_count,
            "deleted_ids": deleted_ids,
            "skipped_active_count": skipped_active_count,
            "deleted_outputs_count": deleted_outputs_count,
            "history_counts": _history_counts(),
        }

    @app.get("/api/library/assets")
    async def api_library_assets(
        tag_category: str | None = None,
        limit: int | None = None,
        offset: int = 0,
        include_category_counts: bool = False,
    ) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        source_categories = _source_asset_tag_categories(history_store)
        normalized_category = str(tag_category or "").strip() or None
        next_limit = None if limit is None else max(0, min(int(limit), 240))
        next_offset = max(0, int(offset or 0))
        categories = _asset_tag_categories(history_store)
        query_categories = _library_query_tag_categories(
            history_store,
            normalized_category,
            source_categories,
        )
        unique_assets: list[dict[str, Any]] = []
        seen_asset_keys: set[str] = set()
        for asset in history_store.list_library_assets(
            tag_categories=query_categories,
            limit=next_limit,
            offset=next_offset,
        ):
            key = _asset_identity_key(asset, history_store)
            if key and key in seen_asset_keys:
                continue
            if key:
                seen_asset_keys.add(key)
            unique_assets.append(asset)
        items = [
            _asset_payload(
                asset,
                settings.storage_dir,
                history_store=history_store,
                source_categories=source_categories,
                repair=False,
            )
            for asset in unique_assets
        ]
        response = {"items": items, "categories": categories}
        paged_request = normalized_category is not None or next_limit is not None or next_offset > 0
        if paged_request:
            total = history_store.count_library_assets(tag_categories=query_categories)
            has_more = False
            next_page_offset: int | None = None
            if next_limit is not None:
                has_more = next_offset + len(items) < total
                next_page_offset = next_offset + len(items) if has_more else None
            response.update(
                {
                    "total": total,
                    "has_more": has_more,
                    "next_offset": next_page_offset,
                }
            )
        if include_category_counts and normalized_category is None:
            raw_counts = history_store.list_library_asset_category_counts()
            counts = {category: 0 for category in categories}
            for raw_category, total in raw_counts.items():
                resolved = _resolve_runtime_tag_category(raw_category, source_categories)
                if not resolved:
                    continue
                counts[resolved] = int(counts.get(resolved, 0)) + int(total)
            response["category_counts"] = {
                category: int(counts.get(category, 0))
                for category in categories
            }
            if "total" not in response:
                response["total"] = history_store.count_library_assets()
        return response

    @app.post("/api/assets/resolve")
    async def api_resolve_assets(payload: dict[str, Any] = Body(default={})) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        source_categories = _source_asset_tag_categories(history_store)
        raw_ids = payload.get("asset_ids") or []
        requested_ids: list[str] = []
        seen_ids: set[str] = set()
        if isinstance(raw_ids, list):
            for item in raw_ids:
                asset_id = str(item or "").strip()
                if not asset_id or asset_id in seen_ids:
                    continue
                requested_ids.append(asset_id)
                seen_ids.add(asset_id)
        asset_map = history_store.get_assets_by_ids(requested_ids)
        items = []
        missing_ids = []
        for asset_id in requested_ids:
            asset = asset_map.get(asset_id)
            if not asset:
                missing_ids.append(asset_id)
                continue
            items.append(
                _asset_payload(
                    asset,
                    settings.storage_dir,
                    history_store=history_store,
                    source_categories=source_categories,
                    repair=False,
                )
            )
        return {"items": items, "missing_ids": missing_ids}

    @app.post("/api/history/{history_id}/reuse-assets")
    async def api_reuse_history_assets(history_id: str) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        record = history_store.get_history(history_id)
        if not record:
            raise HTTPException(status_code=404, detail="history record not found")
        record = _hydrate_history_asset_name_snapshots(history_store, [record])[0]
        if str(record.get("kind") or "") == IMAGE_KIND:
            payload = _image_reuse_assets(history_store, settings.storage_dir, record)
        elif str(record.get("kind") or "") == VIDEO_KIND:
            payload = _video_reuse_assets(history_store, settings.storage_dir, record)
        else:
            raise HTTPException(status_code=400, detail="unsupported history kind")
        return {
            "assets": payload["assets"],
            "missing_labels": payload["missing_labels"],
        }

    @app.post("/api/history/{history_id}/provider-delete")
    async def api_provider_delete_history(history_id: str) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        record = history_store.get_history(history_id)
        if not record:
            raise HTTPException(status_code=404, detail="history record not found")
        if str(record.get("kind") or "") != VIDEO_KIND:
            raise HTTPException(status_code=400, detail="provider delete only supports video history")
        _require_video_api_key(str(record.get("model_variant") or ""))
        params_actual = dict(record.get("params_actual") or {})
        remote_task_id = str(params_actual.get("remote_task_id") or "").strip()
        if not remote_task_id:
            raise HTTPException(status_code=400, detail="history record is not bound to a remote task")
        gateway = video_gateway_factory(settings.volcengine_api_key) if video_gateway_factory else __import__(
            "web_lite3.volcengine",
            fromlist=["VolcengineVideoGateway"],
        ).VolcengineVideoGateway(settings.volcengine_api_key)
        if str(record.get("status") or "") in JOB_TERMINAL_STATUSES:
            result = gateway.delete_task(remote_task_id)
            if not result.get("success"):
                raise HTTPException(status_code=502, detail=str(result.get("error") or "provider delete failed"))
            params_actual["provider_deleted"] = True
            params_actual["provider_deleted_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            history_store.update_history_record(
                history_id,
                params_actual=params_actual,
            )
            return {"ok": True, "action": "delete", "history_id": history_id}
        result = gateway.cancel_task(remote_task_id)
        if not result.get("success"):
            raise HTTPException(status_code=502, detail=str(result.get("error") or "provider cancel failed"))
        history_store.update_history_record(
            history_id,
            status=JOB_STATUS_CANCEL_REQUESTED,
            params_actual=params_actual,
        )
        return {"ok": True, "action": "cancel", "history_id": history_id}

    @app.get("/api/library/source")
    async def api_library_source() -> dict:
        return {"source": _current_history_store().get_library_source()}

    @app.post("/api/library/source/connect")
    async def api_connect_library_source(payload: LibrarySourceConnectPayload) -> dict:
        try:
            source_dir = str(Path(payload.source_dir).expanduser().resolve())
            source_path = Path(source_dir)
            if not source_path.exists() or not source_path.is_dir():
                raise ValueError("素材存储目录不存在")
            storage_root = ensure_storage_paths(_current_settings().storage_dir).root_dir
            if _is_within_root(source_dir, storage_root):
                raise ValueError("本地素材库路径不能位于当前资产包内部")
            payload = _sync_material_source(source_dir=source_dir)
            payload["connected"] = True
            return payload
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/library/source/refresh")
    async def api_refresh_library_source() -> dict:
        current_source = _current_history_store().get_library_source()
        if not current_source:
            raise HTTPException(status_code=404, detail="当前资产包还没有连接本地素材库")
        try:
            return _sync_material_source(source_dir=str(current_source.get("source_dir") or ""))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/library/assets")
    async def api_library_upload(
        tag_category: str = Form(...),
        names: str = Form("[]"),
        files: list[UploadFile] = File(...),
    ) -> dict:
        normalized_category = str(tag_category or "").strip()
        settings = _current_settings()
        storage = ensure_storage_paths(settings.storage_dir)
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        current_categories = _asset_tag_categories(history_store)
        if normalized_category not in current_categories:
            raise HTTPException(status_code=400, detail="unsupported tag category")
        try:
            raw_names = json.loads(names or "[]")
        except Exception as exc:
            raise HTTPException(status_code=400, detail="names payload invalid") from exc
        resolved_names = raw_names if isinstance(raw_names, list) else []
        created_items = []
        for index, file in enumerate(files):
            saved_path = save_upload_stream(
                source=file.file,
                filename=file.filename or "upload.bin",
                mime_type=file.content_type,
                target_dir=storage.uploads_dir,
                prefix="library",
            )
            content_hash = file_sha256(saved_path)
            display_name = str(resolved_names[index]).strip() if index < len(resolved_names) else ""
            if not display_name:
                display_name = history_store.next_default_asset_name(normalized_category)
            existing = history_store.find_asset_by_content_hash(content_hash, kind="image") if content_hash else None
            if existing and str(existing.get("origin") or "") == "library_source":
                existing = None
            if existing:
                try:
                    saved_path.unlink(missing_ok=True)
                except OSError:
                    pass
                asset = history_store.update_asset_metadata(
                    str(existing["id"]),
                    display_name=display_name if not bool(existing.get("library_visible")) else None,
                    tag_category=normalized_category,
                    origin=str(existing.get("origin") or "library_upload"),
                    library_visible=True,
                )
                created_items.append(
                    _asset_payload(
                        asset,
                        settings.storage_dir,
                        history_store=history_store,
                        source_categories=current_categories,
                    )
                )
                continue
            thumbnail_path = create_image_thumbnail(saved_path, target_dir=storage.thumbs_dir, prefix="asset_thumb")
            asset = history_store.register_asset(
                kind="image",
                original_name=file.filename or saved_path.name,
                display_name=display_name,
                tag_category=normalized_category,
                origin="library_upload",
                library_visible=True,
                path=str(saved_path),
                thumbnail_path=str(thumbnail_path) if thumbnail_path else None,
                mime_type=file.content_type,
                content_hash=content_hash,
            )
            created_items.append(
                _asset_payload(
                    asset,
                    settings.storage_dir,
                    history_store=history_store,
                    source_categories=current_categories,
                )
            )
        return {"items": created_items, "categories": _asset_tag_categories(history_store)}

    @app.patch("/api/assets/{asset_id}/metadata")
    async def api_asset_metadata(asset_id: str, payload: dict[str, Any]) -> dict:
        settings = _current_settings()
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        current_asset = history_store.get_asset(asset_id)
        if not current_asset:
            raise HTTPException(status_code=404, detail="asset not found")
        if (
            str(current_asset.get("origin") or "").strip() == "library_source"
            and str(current_asset.get("source_mode") or "").strip() != "history_snapshot"
        ):
            raise HTTPException(status_code=409, detail="本地素材库镜像素材不支持在此改名")
        next_library_visible = payload.get("library_visible")
        if next_library_visible is True and str(current_asset.get("kind") or "").strip() == IMAGE_KIND:
            digest = _content_hash_for_asset(current_asset, history_store)
            existing = history_store.find_asset_by_content_hash(digest, kind=IMAGE_KIND, library_visible=True)
            if existing and str(existing.get("origin") or "") == "library_source":
                existing = None
            if existing and str(existing.get("id") or "") != str(current_asset.get("id") or ""):
                history_store.update_asset_metadata(asset_id, library_visible=False)
                return {
                    "asset": _asset_payload(
                        existing,
                        settings.storage_dir,
                        history_store=history_store,
                        source_categories=_source_asset_tag_categories(history_store),
                    ),
                    "deduped": True,
                }
        try:
            asset = history_store.update_asset_metadata(
                asset_id,
                display_name=str(payload.get("display_name") or "").strip() or None,
                tag_category=str(payload.get("tag_category") or "").strip() or None,
                origin=str(payload.get("origin") or "").strip() or None,
                library_visible=payload.get("library_visible"),
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="asset not found") from exc
        return {
            "asset": _asset_payload(
                asset,
                settings.storage_dir,
                history_store=history_store,
                source_categories=_source_asset_tag_categories(history_store),
            )
        }

    @app.delete("/api/library/assets/{asset_id}")
    async def api_delete_library_asset(asset_id: str) -> dict:
        settings = _current_settings()
        asset = _history_store_for_storage_dir(settings.storage_dir).get_asset(asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="asset not found")
        if not bool(asset.get("library_visible")):
            raise HTTPException(status_code=404, detail="asset not found")
        if str(asset.get("origin") or "").strip() == "library_source":
            raise HTTPException(status_code=409, detail="本地素材库镜像素材请在本地素材库中删除后再刷新")
        return _delete_library_asset_payload(asset, settings.storage_dir)

    @app.post("/api/uploads")
    async def api_upload(
        kind: str = Form(...),
        file: UploadFile = File(...),
    ) -> dict:
        if kind not in {"image", "video", "audio"}:
            raise HTTPException(status_code=400, detail="unsupported asset kind")
        settings = _current_settings()
        storage = ensure_storage_paths(settings.storage_dir)
        history_store = _history_store_for_storage_dir(settings.storage_dir)
        saved_path = save_upload_stream(
            source=file.file,
            filename=file.filename or "upload.bin",
            mime_type=file.content_type,
            target_dir=storage.uploads_dir,
            prefix=kind,
        )
        content_hash = file_sha256(saved_path) if kind == "image" else None
        thumbnail_path = None
        if kind == "image":
            thumbnail_path = create_image_thumbnail(saved_path, target_dir=storage.thumbs_dir, prefix="asset_thumb")
        asset = history_store.register_asset(
            kind=kind,
            original_name=file.filename or saved_path.name,
            path=str(saved_path),
            thumbnail_path=str(thumbnail_path) if thumbnail_path else None,
            mime_type=file.content_type,
            origin="workspace",
            library_visible=False,
            content_hash=content_hash,
        )
        return {
            "asset": _asset_payload(
                asset,
                settings.storage_dir,
                history_store=history_store,
                source_categories=_source_asset_tag_categories(history_store),
            )
        }

    @app.post("/api/generate/image")
    async def api_generate_image(payload: ImageGenerateRequest) -> JSONResponse:
        _require_image_api_key(payload.model_variant)
        return _submit_image_batch(payload)

    @app.post("/api/generate/video")
    async def api_generate_video(payload: VideoGenerateRequest) -> JSONResponse:
        _require_video_api_key(payload.model_variant)
        return _submit_video(payload)

    @app.get("/api/assets")
    async def api_blender_assets() -> list[dict[str, Any]]:
        return _blender_assets()

    @app.post("/api/assets/import")
    async def api_blender_import_asset(asset: UploadFile = File(...)) -> dict[str, Any]:
        suffix = Path(asset.filename or "").suffix.lower()
        if suffix not in blender_supported_upload_suffixes:
            raise HTTPException(
                status_code=400,
                detail=f"Only {blender_supported_model_label} files can be imported.",
            )
        _, imports_dir, _, _, _ = _blender_roots()
        safe_stem = _blender_safe_name(asset.filename or "asset", "asset")
        filename = f"{safe_stem}-{int(time.time() * 1000)}{suffix}"
        target_path = imports_dir / filename
        with target_path.open("wb") as handle:
            shutil.copyfileobj(asset.file, handle)
        if suffix == blender_supported_blend_suffix:
            glb_path = target_path.with_suffix(".glb")
            try:
                _convert_blend_to_glb(target_path, glb_path)
            finally:
                target_path.unlink(missing_ok=True)
            return _blender_imported_asset(glb_path)
        return _blender_imported_asset(target_path)

    @app.post("/api/textures/import")
    async def api_blender_import_texture(texture: UploadFile = File(...)) -> dict[str, Any]:
        suffix = Path(texture.filename or "").suffix.lower()
        if suffix not in blender_supported_texture_formats:
            raise HTTPException(
                status_code=400,
                detail=f"Only {blender_supported_texture_label} images can be used as textures.",
            )
        _, _, textures_dir, _, _ = _blender_roots()
        safe_stem = _blender_safe_name(texture.filename or "texture", "texture")
        filename = f"{safe_stem}-{int(time.time() * 1000)}{suffix}"
        target_path = textures_dir / filename
        with target_path.open("wb") as handle:
            shutil.copyfileobj(texture.file, handle)
        return {
            "name": safe_stem,
            "url": f"/textures/{target_path.name}",
        }

    @app.post("/api/render-jobs", status_code=202)
    async def api_blender_render_jobs(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        scene = _validate_blender_scene(payload)
        return _queue_blender_render_job(scene)

    @app.post("/api/render-jobs/captured-video", status_code=201)
    async def api_blender_captured_video(
        fps: int = Form(...),
        width: int | None = Form(None),
        height: int | None = Form(None),
        frames: list[UploadFile] = File(...),
    ) -> dict[str, Any]:
        captured_fps = _validate_captured_frame_fps(fps)
        expected_width, expected_height = _resolve_captured_frame_size(width, height)
        ffmpeg = resolve_runtime_tool("ffmpeg", root_dir=runtime_root)
        if ffmpeg is None:
            raise HTTPException(status_code=500, detail="当前运行时未找到 ffmpeg，无法导出 MP4")
        storage, _, _, exports_dir, jobs_dir = _blender_roots()
        job_id = f"render-{uuid.uuid4()}"
        frame_dir = jobs_dir / job_id
        output_path = exports_dir / f"{job_id}.mp4"
        shutil.rmtree(frame_dir, ignore_errors=True)
        frame_count = await _save_captured_png_frames(
            frames,
            frame_dir,
            expected_width,
            expected_height,
        )
        command = [
            str(ffmpeg),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-framerate",
            str(captured_fps),
            "-start_number",
            "1",
            "-i",
            str(frame_dir / "frame_%06d.png"),
            "-r",
            str(captured_fps),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False, timeout=240)
        if completed.returncode != 0 or not output_path.exists():
            raise HTTPException(status_code=500, detail=(completed.stderr or "Captured video encode failed").strip())
        shutil.rmtree(frame_dir, ignore_errors=True)
        create_video_thumbnail(output_path, target_dir=storage.thumbs_dir, prefix="blender_thumb", root_dir=runtime_root)
        now = _blender_now()
        return _register_blender_render_job(
            {
                "id": job_id,
                "kind": "video",
                "status": "completed",
                "progress": 1,
                "outputPath": f"/exports/{output_path.name}",
                "downloadUrl": f"/api/render-jobs/{job_id}/download",
                "absoluteOutputPath": str(output_path),
                "frameCount": frame_count,
                "createdAt": now,
                "updatedAt": now,
            }
        )

    @app.get("/api/render-jobs/{job_id}")
    async def api_blender_render_job(job_id: str) -> dict[str, Any]:
        with blender_render_jobs_lock:
            job = blender_render_jobs.get(job_id)
            if not job:
                raise HTTPException(status_code=404, detail="Render job not found.")
            return _public_blender_render_job(dict(job))

    @app.get("/api/render-jobs/{job_id}/download")
    async def api_blender_render_download(job_id: str) -> FileResponse:
        with blender_render_jobs_lock:
            job = blender_render_jobs.get(job_id)
            output_path = Path(str(job.get("absoluteOutputPath") or "")) if job else None
        if not output_path or not output_path.exists():
            raise HTTPException(status_code=404, detail="Rendered file not found.")
        return FileResponse(output_path, media_type="video/mp4", filename=output_path.name)

    @app.get("/api/jobs/{job_id}")
    async def api_job(job_id: str) -> dict:
        snapshot = jobs.get(job_id)
        if not snapshot:
            raise HTTPException(status_code=404, detail="job not found")
        return snapshot

    @app.post("/api/jobs/{job_id}/cancel")
    async def api_cancel_job(job_id: str) -> dict:
        snapshot = jobs.cancel(job_id)
        if not snapshot:
            raise HTTPException(status_code=404, detail="job not found")
        return snapshot

    @app.post("/api/batches/{batch_session_id}/cancel")
    async def api_cancel_batch(batch_session_id: str) -> dict:
        snapshots = jobs.cancel_batch(batch_session_id)
        if not snapshots:
            raise HTTPException(status_code=404, detail="batch not found")
        return {
            "batch_session_id": batch_session_id,
            "job_ids": [item["job_id"] for item in snapshots],
            "cancelled_count": len(snapshots),
        }

    @app.get("/app-files/{relative_path:path}")
    async def app_files(relative_path: str) -> FileResponse:
        file_path = resolve_public_file(_current_settings().storage_dir, relative_path)
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        return FileResponse(file_path)

    @app.get("/uploads/{relative_path:path}")
    async def blender_uploads(relative_path: str) -> FileResponse:
        _, imports_dir, _, _, _ = _blender_roots()
        return FileResponse(_resolve_blender_file(imports_dir, relative_path))

    @app.get("/textures/{relative_path:path}")
    async def blender_textures(relative_path: str) -> FileResponse:
        _, _, textures_dir, _, _ = _blender_roots()
        return FileResponse(_resolve_blender_file(textures_dir, relative_path))

    @app.get("/exports/{relative_path:path}")
    async def blender_exports(relative_path: str) -> FileResponse:
        _, _, _, exports_dir, _ = _blender_roots()
        return FileResponse(_resolve_blender_file(exports_dir, relative_path))

    @app.get("/asset-files/{asset_id}")
    async def asset_files(asset_id: str) -> FileResponse:
        history_store = _current_history_store()
        asset = history_store.get_asset(asset_id)
        if not asset:
            raise HTTPException(status_code=404, detail="asset not found")
        file_path = Path(asset["path"]).expanduser().resolve()
        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        return FileResponse(file_path)

    return app
