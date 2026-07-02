from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from web_lite3.constants import image_model_provider
from web_lite3.data_paths import ensure_storage_paths
from web_lite3.files import (
    create_image_thumbnail,
    create_video_thumbnail,
    download_remote_file,
    public_file_url,
)
from web_lite3.history_store import HistoryStore
from web_lite3.network import ProviderNetworkManager


def _is_remote_url(value: str | None) -> bool:
    text = str(value or "").strip().lower()
    return text.startswith("https://") or text.startswith("http://")


def _mark_local_repair_failed(record: dict[str, Any], message: str) -> dict[str, Any]:
    result_payload = dict(record.get("result_payload") or {})
    result_payload["_local_repair"] = {
        "status": "failed",
        "message": str(message or "").strip()[:800],
    }
    return result_payload


class HistoryRepairService:
    def __init__(self, max_workers: int = 2) -> None:
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._inflight: set[tuple[str, str]] = set()
        self._lock = threading.Lock()

    def schedule(self, storage_dir: str | Path, kind: str, history_store: HistoryStore, *, settings: Any = None) -> bool:
        storage = ensure_storage_paths(storage_dir)
        key = (str(storage.root_dir), kind)
        candidates = history_store.list_repair_candidates(kind, limit=20)
        if not candidates:
            return False
        with self._lock:
            if key in self._inflight:
                return False
            self._inflight.add(key)
        self._executor.submit(self._run, key, storage.root_dir, kind, history_store, candidates, settings)
        return True

    def _run(
        self,
        key: tuple[str, str],
        storage_dir: Path,
        kind: str,
        history_store: HistoryStore,
        candidates: list[dict[str, Any]],
        settings: Any = None,
    ) -> None:
        try:
            storage = ensure_storage_paths(storage_dir)
            network_manager = ProviderNetworkManager(settings) if settings is not None else None
            for record in candidates:
                try:
                    if kind == "image":
                        self._repair_image_record(history_store, record, storage, network_manager)
                    elif kind == "video":
                        self._repair_video_record(history_store, record, storage, network_manager)
                except Exception as exc:
                    history_store.update_history_record(
                        record["id"],
                        result_payload=_mark_local_repair_failed(record, str(exc)),
                        error_message="",
                    )
        finally:
            with self._lock:
                self._inflight.discard(key)

    def _download_session_for_record(
        self,
        kind: str,
        record: dict[str, Any],
        network_manager: ProviderNetworkManager | None,
    ):
        if network_manager is None:
            return None
        provider = "volcengine"
        if kind == "image":
            try:
                provider = image_model_provider(str(record.get("model_variant") or ""))
            except KeyError:
                provider = "volcengine"
        return network_manager.create_session(provider)

    def _repair_image_record(
        self,
        history_store: HistoryStore,
        record: dict[str, Any],
        storage,
        network_manager: ProviderNetworkManager | None = None,
    ) -> None:
        download_session = self._download_session_for_record("image", record, network_manager)
        artifacts = list(record.get("result_payload", {}).get("artifacts") or [])
        if not artifacts:
            raise ValueError("缺少可补救图片结果")
        repaired: list[dict[str, Any]] = []
        local_paths: list[str] = []
        for artifact in artifacts:
            source_url = self._pick_remote_source(artifact)
            if not source_url:
                raise ValueError("缺少可下载图片地址")
            local_path = download_remote_file(
                source_url,
                target_dir=storage.images_dir,
                prefix="image",
                timeout=180,
                session=download_session,
            )
            public_url = public_file_url(local_path, storage.root_dir)
            local_thumb = create_image_thumbnail(local_path, target_dir=storage.thumbs_dir, prefix="thumb")
            public_thumb = public_file_url(local_thumb, storage.root_dir) if local_thumb else public_url
            updated = dict(artifact)
            updated["public_url"] = public_url
            updated["thumbnail_url"] = public_thumb
            updated["local_path"] = str(local_path)
            updated["thumbnail_path"] = str(local_thumb) if local_thumb else str(local_path)
            repaired.append(updated)
            local_paths.append(str(local_path))
        result_payload = dict(record.get("result_payload") or {})
        result_payload["artifacts"] = repaired
        history_store.update_history_record(
            record["id"],
            result_payload=result_payload,
            local_paths=local_paths,
            thumbnail_path=repaired[0].get("thumbnail_path"),
            error_message="",
        )

    def _repair_video_record(
        self,
        history_store: HistoryStore,
        record: dict[str, Any],
        storage,
        network_manager: ProviderNetworkManager | None = None,
    ) -> None:
        download_session = self._download_session_for_record("video", record, network_manager)
        artifacts = list(record.get("result_payload", {}).get("artifacts") or [])
        if not artifacts:
            status = dict(record.get("result_payload", {}).get("status") or {})
            if status.get("video_url"):
                artifacts = [
                    {
                        "kind": "video",
                        "source_url": status.get("video_url"),
                        "thumbnail_url": status.get("thumbnail_url") or status.get("preview_url"),
                    }
                ]
            else:
                local_video = self._resolve_existing_local_file(record.get("local_paths") or [])
                if local_video is not None:
                    artifacts = [
                        {
                            "kind": "video",
                            "local_path": str(local_video),
                            "thumbnail_path": record.get("thumbnail_path"),
                        }
                    ]
        if not artifacts:
            raise ValueError("缺少可补救视频结果")
        artifact = dict(artifacts[0])
        local_video = self._resolve_existing_local_file([artifact.get("local_path"), *(record.get("local_paths") or [])])
        if local_video is None:
            source_url = self._pick_remote_source(artifact)
            if not source_url:
                raise ValueError("缺少可下载视频地址")
            local_video = download_remote_file(
                source_url,
                target_dir=storage.videos_dir,
                prefix="video",
                timeout=300,
                session=download_session,
            )
        public_video = public_file_url(local_video, storage.root_dir)

        local_thumb = self._resolve_existing_local_file([artifact.get("thumbnail_path"), record.get("thumbnail_path")])
        if local_thumb is None:
            thumb_source = self._pick_remote_source(
                {"source_url": artifact.get("thumbnail_url"), "public_url": artifact.get("thumbnail_url")}
            )
            if not thumb_source:
                status = dict(record.get("result_payload", {}).get("status") or {})
                thumb_source = self._pick_remote_source(
                    {
                        "source_url": status.get("thumbnail_url") or status.get("preview_url"),
                        "public_url": status.get("thumbnail_url") or status.get("preview_url"),
                    }
                )
            if thumb_source:
                try:
                    local_thumb = download_remote_file(
                        thumb_source,
                        target_dir=storage.thumbs_dir,
                        prefix="thumb",
                        timeout=180,
                        session=download_session,
                    )
                except Exception:
                    local_thumb = None
        if local_thumb is None:
            local_thumb = create_video_thumbnail(local_video, target_dir=storage.thumbs_dir, prefix="thumb")
        public_thumb = public_file_url(local_thumb, storage.root_dir) if local_thumb else None

        artifact["public_url"] = public_video
        artifact["thumbnail_url"] = public_thumb
        artifact["local_path"] = str(local_video)
        artifact["thumbnail_path"] = str(local_thumb) if local_thumb else None

        result_payload = dict(record.get("result_payload") or {})
        result_payload["artifacts"] = [artifact]
        history_store.update_history_record(
            record["id"],
            result_payload=result_payload,
            local_paths=[str(local_video)],
            thumbnail_path=artifact.get("thumbnail_path"),
            error_message="",
        )

    @staticmethod
    def _pick_remote_source(artifact: dict[str, Any]) -> str | None:
        for key in ("source_url", "public_url"):
            value = str(artifact.get(key) or "").strip()
            if _is_remote_url(value):
                return value
        return None

    @staticmethod
    def _resolve_existing_local_file(candidates: list[str | None]) -> Path | None:
        for candidate in candidates:
            raw = str(candidate or "").strip()
            if not raw:
                continue
            try:
                resolved = Path(raw).expanduser().resolve()
            except OSError:
                continue
            if resolved.exists() and resolved.is_file():
                return resolved
        return None
