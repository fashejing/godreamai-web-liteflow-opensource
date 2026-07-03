from __future__ import annotations

import hashlib
import threading
import time
from typing import Any, Callable

from web_lite3.asset_annotations import (
    compile_prompt_mentions,
    resolve_asset_annotations,
)
from web_lite3.constants import (
    IMAGE_PROVIDER_API_KEY_FIELDS,
    IMAGE_MODELS,
    JOB_STATUS_FAILED,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCEEDED,
    VIDEO_MODELS,
    VIDEO_PROVIDER_API_KEY_FIELDS,
    video_model_provider,
)
from web_lite3.data_paths import ensure_storage_paths
from web_lite3.files import (
    create_image_thumbnail,
    create_video_thumbnail,
    download_remote_file,
    file_to_api_image_data_url,
    file_to_data_url,
    public_file_url,
    save_binary_payload,
)
from web_lite3.history_store import HistoryStore
from web_lite3.jobs import JobCancelledError, JobContext
from web_lite3.network import ProviderNetworkManager
from web_lite3.schemas import ImageGenerateRequest, VideoGenerateRequest
from web_lite3.settings_store import SettingsStore
from web_lite3.volcengine import (
    VolcengineGatewayError,
    VolcengineImageGateway,
    VolcengineVideoGateway,
    build_image_payload,
    build_video_payload,
)


VIDEO_TERMINAL_STATUSES = {"succeeded", "failed", "cancelled", "expired"}
VIDEO_POLL_INTERVALS = [2, 3, 5, 8, 10]
VIDEO_POLL_RETRYABLE_ERROR_LIMIT = 12


def _instantiate_gateway(factory, api_key: str, network_manager: ProviderNetworkManager):
    try:
        return factory(api_key, network_manager=network_manager)
    except TypeError as exc:
        if "network_manager" not in str(exc):
            raise
        return factory(api_key)


def _image_request_asset_ids(request: ImageGenerateRequest) -> list[str]:
    asset_ids: list[str] = []
    if request.input_asset_id:
        asset_ids.append(request.input_asset_id)
    asset_ids.extend(request.reference_asset_ids)
    return asset_ids


def _video_request_asset_ids(request: VideoGenerateRequest) -> list[str]:
    if request.scene_type == "first_frame":
        return [request.first_frame_asset_id] if request.first_frame_asset_id else []
    if request.scene_type == "first_last":
        ordered: list[str] = []
        if request.first_frame_asset_id:
            ordered.append(request.first_frame_asset_id)
        if request.last_frame_asset_id:
            ordered.append(request.last_frame_asset_id)
        return ordered
    if request.scene_type == "multimodal_reference":
        return list(request.reference_image_asset_ids)
    return []


def _normalized_asset_ids(asset_ids: list[str | None]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for asset_id in asset_ids:
        candidate = str(asset_id or "").strip()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def _load_asset_data_urls(history_store: HistoryStore, asset_ids: list[str | None]) -> dict[str, str]:
    normalized_ids = _normalized_asset_ids(asset_ids)
    if not normalized_ids:
        return {}
    assets = history_store.get_assets_by_ids(normalized_ids)
    missing_ids = [asset_id for asset_id in normalized_ids if asset_id not in assets]
    if missing_ids:
        raise ValueError("素材不存在")
    return {
        asset_id: file_to_api_image_data_url(assets[asset_id]["path"], assets[asset_id].get("mime_type"))
        for asset_id in normalized_ids
    }


def _load_assets(history_store: HistoryStore, asset_ids: list[str | None]) -> dict[str, dict[str, Any]]:
    normalized_ids = _normalized_asset_ids(asset_ids)
    if not normalized_ids:
        return {}
    assets = history_store.get_assets_by_ids(normalized_ids)
    missing_ids = [asset_id for asset_id in normalized_ids if asset_id not in assets]
    if missing_ids:
        raise ValueError("素材不存在")
    return {asset_id: dict(assets[asset_id]) for asset_id in normalized_ids}


class ImageGenerationService:
    def __init__(
        self,
        settings_store: SettingsStore,
        history_store_resolver: Callable[[str], HistoryStore],
        *,
        gateway_factory=VolcengineImageGateway,
    ) -> None:
        self.settings_store = settings_store
        self.history_store_resolver = history_store_resolver
        if isinstance(gateway_factory, dict):
            self.gateway_factories = {
                "volcengine": gateway_factory.get("volcengine", VolcengineImageGateway),
            }
        else:
            self.gateway_factories = {
                "volcengine": gateway_factory,
            }
        self._gateway_cache: dict[str, Any] = {}
        self._gateway_lock = threading.Lock()

    def _gateway_for(self, provider: str, api_key: str, network_manager: ProviderNetworkManager):
        normalized = str(api_key or "").strip()
        cache_key = f"{provider}:{normalized}:{network_manager.cache_key(provider)}"
        with self._gateway_lock:
            gateway = self._gateway_cache.get(cache_key)
            if gateway is None:
                gateway = _instantiate_gateway(self.gateway_factories[provider], normalized, network_manager)
                self._gateway_cache[cache_key] = gateway
            return gateway

    def _resolve_runtime(
        self, model_variant: str
    ) -> tuple[Any, Any, HistoryStore, Any, ProviderNetworkManager, str, dict[str, Any]]:
        settings = self.settings_store.load()
        model_spec = IMAGE_MODELS[model_variant]
        provider = str(model_spec.get("provider") or "volcengine").strip()
        if provider != "volcengine":
            raise ValueError("开源版仅支持火山引擎模型")
        field_name = IMAGE_PROVIDER_API_KEY_FIELDS.get(provider, "volcengine_api_key")
        api_key = str(getattr(settings, field_name, "") or "").strip()
        if not api_key:
            raise ValueError("请先在设置页配置 Volcengine API Key")
        storage = ensure_storage_paths(settings.storage_dir)
        history_store = self.history_store_resolver(settings.storage_dir)
        network_manager = ProviderNetworkManager(settings)
        return (
            settings,
            storage,
            history_store,
            self._gateway_for(provider, api_key, network_manager),
            network_manager,
            provider,
            model_spec,
        )

    def run(self, request: ImageGenerateRequest, ctx: JobContext) -> dict[str, Any]:
        prepared = self._prepare_request(request)
        storage = prepared["storage"]
        gateway = prepared["gateway"]
        download_session = prepared["download_session"]
        payload = prepared["payload"]
        provider = prepared["provider"]
        compiled_prompt = prepared["compiled_prompt"]
        resolved_annotations = prepared["resolved_annotations"]

        outputs: list[dict[str, Any]] = []
        seen_images: set[str] = set()
        safety_retries: list[dict[str, Any]] = []
        image_upload_retries: list[dict[str, Any]] = []

        def handle_partial(event: dict[str, Any]) -> None:
            if provider != "volcengine" or ctx.is_cancelled():
                return
            if event.get("type") != "image_generation.partial_succeeded":
                return
            artifact = self._materialize_generated_image(
                {"url": str(event.get("url") or "").strip()},
                storage,
                seen_images,
                download_session,
            )
            if not artifact:
                return
            outputs.append(artifact)
            ctx.publish(
                status=JOB_STATUS_RUNNING,
                message=f"已返回 {len(outputs)}/{request.count} 张图片",
                artifact=artifact,
            )

        if request.sequential_mode and request.count > 1:
            if provider != "volcengine":
                raise ValueError("当前模型不支持组图模式")
            payload["stream"] = True
            ctx.publish(status=JOB_STATUS_RUNNING, message="组图任务已提交")
            result = gateway.generate(payload, on_event=handle_partial)
            self._collect_final_images(result, storage, outputs, seen_images, ctx, download_session)
        else:
            total = max(1, request.count)
            for index in range(total):
                if ctx.is_cancelled():
                    raise JobCancelledError()
                ctx.publish(status=JOB_STATUS_RUNNING, message=f"正在生成第 {index + 1}/{total} 张图片")
                result = gateway.generate(payload)
                if isinstance(result.get("safety_retry"), dict):
                    safety_retries.append(dict(result["safety_retry"]))
                if isinstance(result.get("image_upload_retry"), dict):
                    image_upload_retries.append(dict(result["image_upload_retry"]))
                self._collect_final_images(result, storage, outputs, seen_images, ctx, download_session)

        if ctx.is_cancelled():
            raise JobCancelledError()
        return self._finalize_outputs(
            request=request,
            payload=payload,
            outputs=outputs,
            compiled_prompt=compiled_prompt,
            resolved_annotations=resolved_annotations,
            safety_retries=safety_retries,
            image_upload_retries=image_upload_retries,
        )

    def run_group_batch(
        self,
        request: ImageGenerateRequest,
        *,
        on_artifact: Callable[[dict[str, Any], int], None],
        should_cancel: Callable[[], bool],
    ) -> dict[str, Any]:
        prepared = self._prepare_request(request)
        if prepared["provider"] != "volcengine":
            raise ValueError("当前模型不支持组图模式")
        storage = prepared["storage"]
        gateway = prepared["gateway"]
        download_session = prepared["download_session"]
        payload = dict(prepared["payload"])
        compiled_prompt = prepared["compiled_prompt"]
        resolved_annotations = prepared["resolved_annotations"]
        outputs: list[dict[str, Any]] = []
        seen_images: set[str] = set()

        def emit(image: dict[str, Any]) -> None:
            artifact = self._materialize_generated_image(image, storage, seen_images, download_session)
            if not artifact:
                return
            outputs.append(artifact)
            on_artifact(artifact, len(outputs))

        def handle_partial(event: dict[str, Any]) -> None:
            if should_cancel():
                raise JobCancelledError()
            if event.get("type") != "image_generation.partial_succeeded":
                return
            emit({"url": str(event.get("url") or "")})

        payload["stream"] = True
        result = gateway.generate(payload, on_event=handle_partial)
        for image in result.get("data", {}).get("images", []):
            if should_cancel():
                raise JobCancelledError()
            emit(image)
        return {
            "generated_count": len(outputs),
            "params_actual": {
                "payload": payload,
                "generated_count": len(outputs),
                "compiled_prompt": compiled_prompt,
                "asset_annotations": resolved_annotations,
            },
            "artifacts": outputs,
        }

    def _prepare_request(self, request: ImageGenerateRequest) -> dict[str, Any]:
        _, storage, history_store, gateway, network_manager, provider, model_spec = self._resolve_runtime(request.model_variant)
        raw_annotations = [item.model_dump() for item in request.asset_annotations]
        requires_prompt_annotations = "@" in str(request.prompt or "")
        resolved_annotations = (
            resolve_asset_annotations(_image_request_asset_ids(request), raw_annotations)
            if requires_prompt_annotations
            else []
        )
        compiled_prompt = compile_prompt_mentions(
            request.prompt,
            resolved_annotations,
            alias_prefix="图",
        )
        provider_request = request.model_copy(update={"prompt": compiled_prompt})
        assets = _load_assets(
            history_store,
            [request.input_asset_id, *request.reference_asset_ids],
        )
        input_asset_id = str(request.input_asset_id or "").strip()
        asset_urls = {
            asset_id: file_to_api_image_data_url(assets[asset_id]["path"], assets[asset_id].get("mime_type"))
            for asset_id in assets
        }
        input_image = asset_urls.get(input_asset_id)
        if request.input_asset_id and not input_image:
            input_image = asset_urls.get(str(request.input_asset_id))
        reference_images = [
            asset_urls[str(asset_id).strip()]
            for asset_id in request.reference_asset_ids
            if str(asset_id or "").strip()
        ]
        payload = build_image_payload(provider_request, input_image=input_image, reference_images=reference_images)
        return {
            "storage": storage,
            "history_store": history_store,
            "gateway": gateway,
            "download_session": network_manager.create_session(provider),
            "payload": payload,
            "provider": provider,
            "api_model_id": str(model_spec.get("api_model_id") or ""),
            "compiled_prompt": compiled_prompt,
            "resolved_annotations": resolved_annotations,
        }

    def _finalize_outputs(
        self,
        *,
        request: ImageGenerateRequest,
        payload: dict[str, Any],
        outputs: list[dict[str, Any]],
        compiled_prompt: str,
        resolved_annotations: list[dict[str, Any]],
        safety_retries: list[dict[str, Any]] | None = None,
        image_upload_retries: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if not outputs:
            return {
                "status": JOB_STATUS_FAILED,
                "message": "未生成任何图片",
                "outputs": [],
                "params_actual": {
                    "payload": payload,
                    "compiled_prompt": compiled_prompt,
                    "asset_annotations": resolved_annotations,
                    "safety_retries": safety_retries or [],
                    "image_upload_retries": image_upload_retries or [],
                },
                "result_payload": {},
                "local_paths": [],
                "thumbnail_path": None,
            }
        local_paths = [item["local_path"] for item in outputs if item.get("local_path")]
        thumbnail_path = outputs[0].get("thumbnail_path") or outputs[0].get("local_path")
        return {
            "status": JOB_STATUS_SUCCEEDED,
            "message": f"生成完成，共 {len(outputs)} 张图片",
            "outputs": outputs,
            "params_actual": {
                "payload": payload,
                "generated_count": len(outputs) if request.count > 1 else 1,
                "compiled_prompt": compiled_prompt,
                "asset_annotations": resolved_annotations,
                "safety_retries": safety_retries or [],
                "image_upload_retries": image_upload_retries or [],
            },
            "result_payload": {"artifacts": outputs},
            "local_paths": local_paths,
            "thumbnail_path": thumbnail_path,
        }

    def _collect_final_images(
        self,
        result: dict[str, Any],
        storage,
        outputs: list[dict[str, Any]],
        seen_images: set[str],
        ctx: JobContext,
        download_session,
    ) -> None:
        for image in result.get("data", {}).get("images", []):
            artifact = self._materialize_generated_image(image, storage, seen_images, download_session)
            if not artifact:
                continue
            outputs.append(artifact)
            ctx.publish(
                status=JOB_STATUS_RUNNING,
                message=f"已收到 {len(outputs)} 张图片",
                artifact=artifact,
            )

    def _materialize_generated_image(
        self,
        image: dict[str, Any],
        storage,
        seen_images: set[str],
        download_session,
    ) -> dict[str, Any] | None:
        source_url = str(image.get("url") or "").strip()
        if source_url:
            identity = f"url:{source_url}"
            if identity in seen_images:
                return None
            seen_images.add(identity)
            return self._materialize_remote_image(source_url, storage, download_session)
        payload = image.get("bytes")
        if not isinstance(payload, (bytes, bytearray)) or not payload:
            return None
        identity = f"inline:{hashlib.sha1(bytes(payload)).hexdigest()}"
        if identity in seen_images:
            return None
        seen_images.add(identity)
        return self._materialize_inline_image(bytes(payload), str(image.get("mime_type") or "image/png"), storage)

    def _materialize_remote_image(self, source_url: str, storage, download_session) -> dict[str, Any]:
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
        return {
            "kind": "image",
            "source_url": source_url,
            "public_url": public_url,
            "thumbnail_url": public_thumb,
            "local_path": str(local_path),
            "thumbnail_path": str(local_thumb) if local_thumb else str(local_path),
        }

    def _materialize_inline_image(self, payload: bytes, mime_type: str, storage) -> dict[str, Any]:
        extension = {
            "image/png": ".png",
            "image/webp": ".webp",
        }.get(mime_type, ".jpg")
        local_path = save_binary_payload(
            payload,
            filename=f"image-output{extension}",
            target_dir=storage.images_dir,
            mime_type=mime_type,
            prefix="image",
        )
        public_url = public_file_url(local_path, storage.root_dir)
        local_thumb = create_image_thumbnail(local_path, target_dir=storage.thumbs_dir, prefix="thumb")
        public_thumb = public_file_url(local_thumb, storage.root_dir) if local_thumb else public_url
        return {
            "kind": "image",
            "source_url": "",
            "public_url": public_url,
            "thumbnail_url": public_thumb,
            "local_path": str(local_path),
            "thumbnail_path": str(local_thumb) if local_thumb else str(local_path),
            "mime_type": mime_type,
        }


class VideoGenerationService:
    def __init__(
        self,
        settings_store: SettingsStore,
        history_store_resolver: Callable[[str], HistoryStore],
        *,
        gateway_factory=VolcengineVideoGateway,
    ) -> None:
        self.settings_store = settings_store
        self.history_store_resolver = history_store_resolver
        if isinstance(gateway_factory, dict):
            self.gateway_factories = {
                "volcengine": gateway_factory.get("volcengine", VolcengineVideoGateway),
            }
        else:
            self.gateway_factories = {
                "volcengine": gateway_factory,
            }
        self._gateway_cache: dict[str, Any] = {}
        self._gateway_lock = threading.Lock()

    def _gateway_for(self, provider: str, api_key: str, network_manager: ProviderNetworkManager):
        normalized = str(api_key or "").strip()
        cache_key = f"{provider}:{normalized}:{network_manager.cache_key(provider)}"
        with self._gateway_lock:
            gateway = self._gateway_cache.get(cache_key)
            if gateway is None:
                gateway = _instantiate_gateway(self.gateway_factories[provider], normalized, network_manager)
                self._gateway_cache[cache_key] = gateway
            return gateway

    def _resolve_runtime(self, model_variant: str) -> tuple[Any, Any, HistoryStore, Any, ProviderNetworkManager, str]:
        settings = self.settings_store.load()
        provider = video_model_provider(model_variant)
        if provider != "volcengine":
            raise ValueError("开源版仅支持火山引擎模型")
        field_name = VIDEO_PROVIDER_API_KEY_FIELDS.get(provider, "volcengine_api_key")
        api_key = str(getattr(settings, field_name, "") or "").strip()
        if not api_key:
            raise ValueError("请先在设置页配置 Volcengine API Key")
        storage = ensure_storage_paths(settings.storage_dir)
        history_store = self.history_store_resolver(settings.storage_dir)
        network_manager = ProviderNetworkManager(settings)
        return settings, storage, history_store, self._gateway_for(provider, api_key, network_manager), network_manager, provider

    def run(self, request: VideoGenerateRequest, ctx: JobContext) -> dict[str, Any]:
        _, storage, history_store, gateway, network_manager, provider = self._resolve_runtime(request.model_variant)
        download_session = network_manager.create_session(provider)
        resolved_annotations = []
        if request.scene_type == "multimodal_reference" and "@" in str(request.prompt or ""):
            resolved_annotations = resolve_asset_annotations(
                _video_request_asset_ids(request),
                [item.model_dump() for item in request.asset_annotations],
            )
        compiled_prompt = compile_prompt_mentions(
            request.prompt,
            resolved_annotations,
            alias_prefix="图",
        )
        provider_request = request.model_copy(update={"prompt": compiled_prompt})
        asset_urls = _load_asset_data_urls(
            history_store,
            [request.first_frame_asset_id, request.last_frame_asset_id, *request.reference_image_asset_ids],
        )
        first_frame = asset_urls.get(str(request.first_frame_asset_id or "").strip())
        last_frame = asset_urls.get(str(request.last_frame_asset_id or "").strip())
        reference_images = [
            asset_urls[str(asset_id).strip()]
            for asset_id in request.reference_image_asset_ids
            if str(asset_id or "").strip()
        ]
        payload = self._build_provider_payload(
            provider,
            provider_request,
            first_frame=first_frame,
            last_frame=last_frame,
            reference_images=reference_images,
        )
        created = gateway.create_task(payload)
        remote_task_id = str(created["task_id"])
        params_actual = self._video_params_actual(
            payload=payload,
            remote_task_id=remote_task_id,
            compiled_prompt=compiled_prompt,
            resolved_annotations=resolved_annotations,
        )
        self._persist_running_state(
            history_store,
            gateway,
            ctx,
            params_actual,
            remote_status={
                "task_id": remote_task_id,
                "status": str(created.get("status") or "queued"),
                "raw": created.get("raw") or {},
            },
        )
        return self._poll_remote_video_task(
            gateway=gateway,
            history_store=history_store,
            storage=storage,
            ctx=ctx,
            remote_task_id=remote_task_id,
            params_actual=params_actual,
            started_message=f"已创建远程任务 {remote_task_id}",
            download_session=download_session,
        )

    def resume(self, record: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
        params_actual = dict(record.get("params_actual") or {})
        model_variant = str(record.get("model_variant") or "").strip()
        if model_variant not in VIDEO_MODELS:
            requested = record.get("params_requested") if isinstance(record.get("params_requested"), dict) else {}
            model_variant = str(requested.get("model_variant") or "").strip()
        if model_variant not in VIDEO_MODELS:
            model_variant = next(iter(VIDEO_MODELS.keys()))
        _, storage, history_store, gateway, network_manager, provider = self._resolve_runtime(model_variant)
        download_session = network_manager.create_session(provider)
        remote_task_id = str(params_actual.get("remote_task_id") or "").strip()
        if not remote_task_id:
            raise ValueError("missing remote_task_id for resumable video task")
        recovered_status = dict((record.get("result_payload") or {}).get("status") or {})
        if not recovered_status:
            recovered_status = {
                "task_id": remote_task_id,
                "status": str(record.get("status") or JOB_STATUS_RUNNING),
            }
        self._persist_running_state(history_store, gateway, ctx, params_actual, remote_status=recovered_status)
        return self._poll_remote_video_task(
            gateway=gateway,
            history_store=history_store,
            storage=storage,
            ctx=ctx,
            remote_task_id=remote_task_id,
            params_actual=params_actual,
            started_message="服务重启后已恢复远程任务轮询",
            download_session=download_session,
        )

    @staticmethod
    def _build_provider_payload(
        provider: str,
        request: VideoGenerateRequest,
        *,
        first_frame: str | None,
        last_frame: str | None,
        reference_images: list[str],
    ) -> dict[str, Any]:
        return build_video_payload(
            request,
            first_frame=first_frame,
            last_frame=last_frame,
            reference_images=reference_images,
        )

    @staticmethod
    def _video_params_actual(
        *,
        payload: dict[str, Any],
        remote_task_id: str,
        compiled_prompt: str,
        resolved_annotations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "payload": payload,
            "remote_task_id": remote_task_id,
            "compiled_prompt": compiled_prompt,
            "asset_annotations": resolved_annotations,
        }

    def _persist_running_state(
        self,
        history_store: HistoryStore,
        gateway,
        ctx: JobContext,
        params_actual: dict[str, Any],
        *,
        remote_status: dict[str, Any] | None = None,
    ) -> None:
        remote_task_id = str(params_actual.get("remote_task_id") or "").strip()
        if not remote_task_id:
            return
        ctx.set_remote_task_id(remote_task_id)
        ctx.attach_remote_cancel(gateway.cancel_task)
        persisted_status = str((remote_status or {}).get("status") or JOB_STATUS_RUNNING).strip().lower()
        if persisted_status not in {"queued", JOB_STATUS_RUNNING}:
            persisted_status = JOB_STATUS_RUNNING
        result_payload = {"remote_task_id": remote_task_id}
        if remote_status:
            result_payload["status"] = remote_status
        history_store.update_history_record(
            ctx.history_id,
            status=persisted_status,
            params_actual=params_actual,
            result_payload=result_payload,
            error_message="",
        )

    def _persist_remote_poll_snapshot(
        self,
        history_store: HistoryStore,
        ctx: JobContext,
        params_actual: dict[str, Any],
        remote_task_id: str,
        remote_status: dict[str, Any],
    ) -> None:
        persisted_status = str(remote_status.get("status") or JOB_STATUS_RUNNING).strip().lower()
        if persisted_status not in {"queued", JOB_STATUS_RUNNING}:
            persisted_status = JOB_STATUS_RUNNING
        history_store.update_history_record(
            ctx.history_id,
            status=persisted_status,
            params_actual=params_actual,
            result_payload={"status": remote_status, "remote_task_id": remote_task_id},
            error_message="",
        )

    def _poll_remote_video_task(
        self,
        *,
        gateway,
        history_store: HistoryStore,
        storage,
        ctx: JobContext,
        remote_task_id: str,
        params_actual: dict[str, Any],
        started_message: str,
        download_session,
    ) -> dict[str, Any]:
        ctx.set_remote_task_id(remote_task_id)
        ctx.attach_remote_cancel(gateway.cancel_task)
        ctx.publish(status=JOB_STATUS_RUNNING, message=started_message)

        cancel_sent = False
        consecutive_query_failures = 0
        for index in range(180):
            if ctx.is_cancelled() and not cancel_sent:
                cancel_sent = True
                gateway.cancel_task(remote_task_id)
                raise JobCancelledError()
            try:
                status = gateway.query_task(remote_task_id)
            except VolcengineGatewayError as exc:
                if exc.retryable and consecutive_query_failures < VIDEO_POLL_RETRYABLE_ERROR_LIMIT:
                    consecutive_query_failures += 1
                    retry_message = (
                        "查询远程任务状态失败，正在重试 "
                        f"({consecutive_query_failures}/{VIDEO_POLL_RETRYABLE_ERROR_LIMIT})"
                    )
                    ctx.publish(status=JOB_STATUS_RUNNING, message=retry_message)
                    self._persist_running_state(history_store, gateway, ctx, params_actual)
                    time.sleep(VIDEO_POLL_INTERVALS[min(index, len(VIDEO_POLL_INTERVALS) - 1)])
                    continue
                raise
            consecutive_query_failures = 0
            current_status = str(status.get("status") or "unknown")
            ctx.publish(status=current_status, message=f"任务状态 {current_status}")
            if current_status in VIDEO_TERMINAL_STATUSES:
                if current_status == "cancelled":
                    raise JobCancelledError()
                if current_status != "succeeded":
                    return {
                        "status": JOB_STATUS_FAILED,
                        "message": f"视频任务结束，状态为 {current_status}",
                        "outputs": [],
                        "params_actual": params_actual,
                        "result_payload": {"status": status, "remote_task_id": remote_task_id},
                        "local_paths": [],
                        "thumbnail_path": None,
                    }
                artifact = self._materialize_video(status, storage, download_session)
                ctx.publish(status=JOB_STATUS_SUCCEEDED, message="视频已生成完成", artifact=artifact)
                return {
                    "status": JOB_STATUS_SUCCEEDED,
                    "message": "视频生成完成",
                    "outputs": [artifact],
                    "params_actual": params_actual,
                    "result_payload": {"status": status, "artifacts": [artifact], "remote_task_id": remote_task_id},
                    "local_paths": [artifact["local_path"]] if artifact.get("local_path") else [],
                    "thumbnail_path": artifact.get("thumbnail_path"),
                }
            self._persist_remote_poll_snapshot(history_store, ctx, params_actual, remote_task_id, status)
            time.sleep(VIDEO_POLL_INTERVALS[min(index, len(VIDEO_POLL_INTERVALS) - 1)])
        return {
            "status": JOB_STATUS_FAILED,
            "message": "视频轮询超时",
            "outputs": [],
            "params_actual": params_actual,
            "result_payload": {"remote_task_id": remote_task_id},
            "local_paths": [],
            "thumbnail_path": None,
        }

    def _materialize_video(self, result: dict[str, Any], storage, download_session) -> dict[str, Any]:
        source_url = str(result.get("video_url") or "").strip()
        if not source_url:
            raise ValueError("视频生成完成但未返回视频地址")
        download_headers = result.get("download_headers") if isinstance(result.get("download_headers"), dict) else None
        video_download_kwargs = {
            "target_dir": storage.videos_dir,
            "prefix": "video",
            "timeout": 300,
            "session": download_session,
        }
        if download_headers:
            video_download_kwargs["headers"] = download_headers
        local_video = download_remote_file(source_url, **video_download_kwargs)
        public_video = public_file_url(local_video, storage.root_dir)

        thumb_source = str(result.get("thumbnail_url") or result.get("preview_url") or "").strip()
        local_thumb = None
        public_thumb = None
        if thumb_source:
            try:
                thumb_download_kwargs = {
                    "target_dir": storage.thumbs_dir,
                    "prefix": "thumb",
                    "timeout": 180,
                    "session": download_session,
                }
                if download_headers:
                    thumb_download_kwargs["headers"] = download_headers
                local_thumb = download_remote_file(thumb_source, **thumb_download_kwargs)
                public_thumb = public_file_url(local_thumb, storage.root_dir)
            except Exception:  # noqa: BLE001
                local_thumb = None
        if local_thumb is None:
            local_thumb = create_video_thumbnail(local_video, target_dir=storage.thumbs_dir, prefix="thumb")
            public_thumb = public_file_url(local_thumb, storage.root_dir) if local_thumb else None

        return {
            "kind": "video",
            "source_url": source_url,
            "public_url": public_video,
            "thumbnail_url": public_thumb,
            "local_path": str(local_video),
            "thumbnail_path": str(local_thumb) if local_thumb else None,
        }
