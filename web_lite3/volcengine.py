from __future__ import annotations

import json
from dataclasses import dataclass
import time
from typing import Any, Callable

import requests

from web_lite3.constants import (
    APP_DISPLAY_NAME,
    IMAGE_MODELS,
    SEEDREAM_MAX_ASPECT_RATIO,
    SEEDREAM_MAX_TOTAL_PIXELS,
    SEEDREAM_MIN_EDGE,
    SEEDREAM_MIN_TOTAL_PIXELS,
    VIDEO_MODELS,
)
from web_lite3.network import ProviderNetworkManager
from web_lite3.schemas import ImageGenerateRequest, VideoGenerateRequest


SEEDANCE_SCENE_TEXT = "text_to_video"
SEEDANCE_SCENE_FIRST_FRAME = "first_frame"
SEEDANCE_SCENE_FIRST_LAST = "first_last_frame"
SEEDANCE_SCENE_MULTIMODAL = "multimodal_reference"
RETRYABLE_GATEWAY_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
VIDEO_EXECUTION_EXPIRES_AFTER_SECONDS = 172800
IMAGE_REQUEST_MAX_ATTEMPTS = 3
IMAGE_REQUEST_RETRY_DELAYS = (0.75, 1.5)
IMAGE_REQUEST_TRANSPORT_ERROR_MESSAGE = "图片生成请求失败：与方舟图片网关建立安全连接失败，请检查代理/VPN/网络拦截后重试"
IMAGE_REQUEST_CONNECTION_ERROR_MESSAGE = "图片生成请求失败：连接方舟图片网关超时或中断，请稍后重试"
IMAGE_REQUEST_UPSTREAM_ERROR_MESSAGE = "图片生成请求失败：方舟图片网关暂时不可用，请稍后重试"
IMAGE_STREAM_INTERRUPTED_ERROR_MESSAGE = "图片流式生成请求中断，请稍后重试"
VIDEO_CREATE_MAX_ATTEMPTS = 3
VIDEO_CREATE_RETRY_DELAYS = (0.75, 1.5)
VIDEO_CREATE_TRANSPORT_ERROR_MESSAGE = (
    "创建视频任务失败：与方舟视频网关建立安全连接失败，请检查代理/VPN/网络拦截后重试"
)
VIDEO_CREATE_CONNECTION_ERROR_MESSAGE = "创建视频任务失败：连接方舟视频网关超时或中断，请稍后重试"
VIDEO_CREATE_UPSTREAM_ERROR_MESSAGE = "创建视频任务失败：方舟视频网关暂时不可用，请稍后重试"


class VolcengineGatewayError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        retryable: bool = False,
        detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable
        self.detail = detail


def _normalize_seedream_size(size: str, allowed_resolutions: set[str], error_message: str) -> str:
    normalized = str(size or "").strip().lower()
    if normalized in allowed_resolutions:
        return normalized
    if "x" not in normalized:
        raise ValueError(error_message)
    try:
        width_raw, height_raw = normalized.split("x", 1)
        width = int(float(width_raw))
        height = int(float(height_raw))
    except Exception as exc:
        raise ValueError(error_message) from exc
    total_pixels = width * height
    ratio = width / height if height else 0
    if width < SEEDREAM_MIN_EDGE or height < SEEDREAM_MIN_EDGE:
        raise ValueError(error_message)
    if not (1 / SEEDREAM_MAX_ASPECT_RATIO <= ratio <= SEEDREAM_MAX_ASPECT_RATIO):
        raise ValueError(error_message)
    if not (SEEDREAM_MIN_TOTAL_PIXELS <= total_pixels <= SEEDREAM_MAX_TOTAL_PIXELS):
        raise ValueError(error_message)
    return f"{width}x{height}"


def normalize_seedream_4_5_size(size: str) -> str:
    return _normalize_seedream_size(size, {"2k", "4k"}, "Seedream 4.5 尺寸不受支持")


def normalize_seedream_5_size(size: str) -> str:
    return _normalize_seedream_size(size, {"2k", "3k", "4k"}, "Seedream 5.0 尺寸不受支持")


def build_image_payload(
    request: ImageGenerateRequest,
    *,
    input_image: str | None,
    reference_images: list[str],
) -> dict[str, Any]:
    image_inputs: list[str] = []
    if input_image:
        image_inputs.append(input_image)
    image_inputs.extend(reference_images)
    if request.model_variant == "seedream_v4_5":
        payload: dict[str, Any] = {
            "model": IMAGE_MODELS["seedream_v4_5"]["api_model_id"],
            "prompt": request.prompt,
            "size": normalize_seedream_4_5_size(request.size),
            "response_format": "url",
            "watermark": False,
            "sequential_image_generation": "auto" if request.sequential_mode else "disabled",
            "optimize_prompt_options": {"mode": "standard"},
        }
        if image_inputs:
            payload["image"] = image_inputs if len(image_inputs) > 1 else image_inputs[0]
        if request.sequential_mode and request.count > 1:
            payload["sequential_image_generation_options"] = {"max_images": request.count}
        return payload

    payload = {
        "model": IMAGE_MODELS["seedream_v5_0"]["api_model_id"],
        "prompt": request.prompt,
        "size": normalize_seedream_5_size(request.size),
        "response_format": "url",
        "watermark": False,
        "sequential_image_generation": "auto" if request.sequential_mode else "disabled",
        "optimize_prompt_options": {"mode": "standard"},
    }
    if image_inputs:
        payload["image"] = image_inputs if len(image_inputs) > 1 else image_inputs[0]
    if request.sequential_mode and request.count > 1:
        payload["sequential_image_generation_options"] = {"max_images": request.count}
    if request.enable_web_search:
        payload["tools"] = [{"type": "web_search"}]
    if request.output_format in {"jpeg", "png"}:
        payload["output_format"] = request.output_format
    return payload


@dataclass(frozen=True)
class SeedanceMediaItem:
    media_type: str
    source: str
    role: str | None = None

    def to_content_item(self) -> dict[str, Any]:
        media_key = f"{self.media_type}_url"
        payload = {
            "type": media_key,
            media_key: {"url": self.source},
        }
        if self.role:
            payload["role"] = self.role
        return payload


def build_video_payload(
    request: VideoGenerateRequest,
    *,
    first_frame: str | None = None,
    last_frame: str | None = None,
    reference_images: list[str] | None = None,
) -> dict[str, Any]:
    images: list[SeedanceMediaItem] = []
    videos: list[SeedanceMediaItem] = []
    audios: list[SeedanceMediaItem] = []
    scene = SEEDANCE_SCENE_TEXT
    if request.scene_type == "first_frame":
        scene = SEEDANCE_SCENE_FIRST_FRAME
        if not first_frame:
            raise ValueError("请上传首帧图片")
        images.append(SeedanceMediaItem("image", first_frame, "first_frame"))
    elif request.scene_type == "first_last":
        scene = SEEDANCE_SCENE_FIRST_LAST
        if not first_frame or not last_frame:
            raise ValueError("请同时上传首帧和尾帧图片")
        images.extend(
            [
                SeedanceMediaItem("image", first_frame, "first_frame"),
                SeedanceMediaItem("image", last_frame, "last_frame"),
            ]
        )
    elif request.scene_type == "multimodal_reference":
        scene = SEEDANCE_SCENE_MULTIMODAL
        for item in reference_images or []:
            images.append(SeedanceMediaItem("image", item, "reference_image"))
        for item in request.trusted_asset_uris:
            images.append(SeedanceMediaItem("image", item, "reference_image"))
        for item in request.reference_video_urls:
            videos.append(SeedanceMediaItem("video", item, "reference_video"))
        for item in request.reference_audio_urls:
            audios.append(SeedanceMediaItem("audio", item, "reference_audio"))
        if not (request.prompt.strip() or images or videos or audios):
            raise ValueError("多模态参考模式至少需要提示词或素材")
    elif not request.prompt.strip():
        raise ValueError("请输入提示词")

    content: list[dict[str, Any]] = []
    if request.prompt.strip():
        content.append({"type": "text", "text": request.prompt.strip()})
    content.extend(item.to_content_item() for item in images)
    content.extend(item.to_content_item() for item in videos)
    content.extend(item.to_content_item() for item in audios)
    if not content:
        raise ValueError("至少需要文本或素材")

    payload: dict[str, Any] = {
        "model": VIDEO_MODELS[request.model_variant]["api_model_id"],
        "content": content,
        "resolution": request.resolution_grade,
        "ratio": request.ratio,
        "duration": request.duration,
        "generate_audio": bool(request.generate_audio),
        "watermark": bool(request.watermark),
        "return_last_frame": False,
        "execution_expires_after": VIDEO_EXECUTION_EXPIRES_AFTER_SECONDS,
    }
    if request.seed >= 0:
        payload["seed"] = request.seed
    if request.enable_web_search:
        payload["tools"] = [{"type": "web_search"}]
    return payload


class VolcengineImageGateway:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://ark.cn-beijing.volces.com/api/v3",
        timeout: int = 120,
        network_manager: ProviderNetworkManager | None = None,
    ) -> None:
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = network_manager.create_session("volcengine") if network_manager else requests.Session()
        if network_manager is None:
            self.session.trust_env = False

    def generate(
        self,
        payload: dict[str, Any],
        *,
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}/images/generations"
        if payload.get("stream") and on_event is not None:
            return self._post_sse(url, payload, on_event)
        for attempt in range(1, IMAGE_REQUEST_MAX_ATTEMPTS + 1):
            try:
                response = self.session.post(
                    url,
                    headers=self._headers(),
                    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    timeout=(30, self.timeout),
                )
                return self._decode_image_response(response)
            except requests.RequestException as exc:
                normalized_error = self._normalize_image_transport_error(exc)
                if attempt >= IMAGE_REQUEST_MAX_ATTEMPTS:
                    raise normalized_error from exc
            except VolcengineGatewayError as exc:
                normalized_error = self._normalize_image_gateway_error(exc)
                if not normalized_error.retryable or attempt >= IMAGE_REQUEST_MAX_ATTEMPTS:
                    raise normalized_error from exc
            time.sleep(IMAGE_REQUEST_RETRY_DELAYS[min(attempt - 1, len(IMAGE_REQUEST_RETRY_DELAYS) - 1)])
        raise VolcengineGatewayError(IMAGE_REQUEST_UPSTREAM_ERROR_MESSAGE, retryable=True)

    def _post_sse(
        self,
        url: str,
        payload: dict[str, Any],
        on_event: Callable[[dict[str, Any]], None],
    ) -> dict[str, Any]:
        headers = self._headers()
        headers["Accept"] = "text/event-stream"
        for attempt in range(1, IMAGE_REQUEST_MAX_ATTEMPTS + 1):
            images: list[dict[str, Any]] = []
            errors: list[dict[str, Any]] = []
            usage: dict[str, Any] = {}
            received_partial = False
            try:
                with self.session.post(
                    url,
                    headers=headers,
                    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    timeout=(30, self.timeout),
                    stream=True,
                ) as response:
                    if not response.ok:
                        raise self._response_error(response)
                    for raw_line in response.iter_lines(decode_unicode=True):
                        if not raw_line or not raw_line.startswith("data:"):
                            continue
                        content = raw_line[5:].strip()
                        if content == "[DONE]":
                            break
                        event = json.loads(content)
                        event_type = event.get("type", "")
                        if event_type == "image_generation.partial_succeeded":
                            images.append({"url": event.get("url", "")})
                            received_partial = True
                        elif event_type == "image_generation.partial_failed":
                            errors.append({"index": event.get("image_index", -1), "error": event.get("error", {})})
                            received_partial = True
                        elif event_type == "image_generation.completed":
                            usage = dict(event.get("usage") or {})
                        on_event(event)
                return {
                    "data": {"images": images, "errors": errors},
                    "usage": usage,
                }
            except requests.RequestException as exc:
                if received_partial:
                    raise VolcengineGatewayError(
                        IMAGE_STREAM_INTERRUPTED_ERROR_MESSAGE,
                        retryable=True,
                        detail=str(exc),
                    ) from exc
                normalized_error = self._normalize_image_transport_error(exc)
                if attempt >= IMAGE_REQUEST_MAX_ATTEMPTS:
                    raise normalized_error from exc
            except VolcengineGatewayError as exc:
                if received_partial:
                    raise VolcengineGatewayError(
                        IMAGE_STREAM_INTERRUPTED_ERROR_MESSAGE,
                        status_code=exc.status_code,
                        retryable=exc.retryable,
                        detail=exc.detail or str(exc),
                    ) from exc
                normalized_error = self._normalize_image_gateway_error(exc)
                if not normalized_error.retryable or attempt >= IMAGE_REQUEST_MAX_ATTEMPTS:
                    raise normalized_error from exc
            time.sleep(IMAGE_REQUEST_RETRY_DELAYS[min(attempt - 1, len(IMAGE_REQUEST_RETRY_DELAYS) - 1)])
        raise VolcengineGatewayError(IMAGE_REQUEST_UPSTREAM_ERROR_MESSAGE, retryable=True)

    def _decode_image_response(self, response: requests.Response) -> dict[str, Any]:
        if not response.ok:
            raise self._response_error(response)
        body = response.json()
        items = body.get("data") or []
        images: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for index, item in enumerate(items):
            if "url" in item:
                images.append({"url": item["url"]})
            elif "error" in item:
                errors.append({"index": index, "error": item["error"]})
        return {
            "data": {"images": images, "errors": errors},
            "usage": body.get("usage") or {},
        }

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise ValueError("缺少 Volcengine API Key")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": f"{APP_DISPLAY_NAME}/0.1",
        }

    @staticmethod
    def _extract_error(response: requests.Response) -> str:
        try:
            payload = response.json()
            return payload.get("error", {}).get("message") or json.dumps(payload, ensure_ascii=False)
        except Exception:
            return response.text[:500]

    @classmethod
    def _response_error(cls, response: requests.Response) -> VolcengineGatewayError:
        return VolcengineGatewayError(
            cls._extract_error(response),
            status_code=response.status_code,
            retryable=response.status_code in RETRYABLE_GATEWAY_STATUS_CODES,
        )

    @staticmethod
    def _normalize_image_transport_error(exc: requests.RequestException) -> VolcengineGatewayError:
        detail = str(exc)
        if isinstance(exc, (requests.exceptions.SSLError, requests.exceptions.ProxyError)):
            return VolcengineGatewayError(
                IMAGE_REQUEST_TRANSPORT_ERROR_MESSAGE,
                retryable=True,
                detail=detail,
            )
        if isinstance(exc, (requests.exceptions.ConnectionError, requests.exceptions.ReadTimeout)):
            return VolcengineGatewayError(
                IMAGE_REQUEST_CONNECTION_ERROR_MESSAGE,
                retryable=True,
                detail=detail,
            )
        return VolcengineGatewayError(
            IMAGE_REQUEST_CONNECTION_ERROR_MESSAGE,
            retryable=True,
            detail=detail,
        )

    @staticmethod
    def _normalize_image_gateway_error(exc: VolcengineGatewayError) -> VolcengineGatewayError:
        if exc.retryable:
            return VolcengineGatewayError(
                IMAGE_REQUEST_UPSTREAM_ERROR_MESSAGE,
                status_code=exc.status_code,
                retryable=True,
                detail=exc.detail or str(exc),
            )
        return exc


class VolcengineVideoGateway:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://ark.cn-beijing.volces.com/api/v3",
        network_manager: ProviderNetworkManager | None = None,
    ) -> None:
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.session = network_manager.create_session("volcengine") if network_manager else requests.Session()
        if network_manager is None:
            self.session.trust_env = False

    def create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(1, VIDEO_CREATE_MAX_ATTEMPTS + 1):
            try:
                response = self.session.post(
                    f"{self.base_url}/contents/generations/tasks",
                    headers=self._headers(),
                    json=payload,
                    timeout=60,
                )
                body = self._decode_response(response)
                task_id = body.get("id")
                if not task_id:
                    raise ValueError("未获取到远程任务 ID")
                return {"task_id": task_id, "status": body.get("status", "queued"), "raw": body}
            except requests.RequestException as exc:
                normalized_error = self._normalize_create_task_transport_error(exc)
                if attempt >= VIDEO_CREATE_MAX_ATTEMPTS:
                    raise normalized_error from exc
            except VolcengineGatewayError as exc:
                normalized_error = self._normalize_create_task_gateway_error(exc)
                if not normalized_error.retryable or attempt >= VIDEO_CREATE_MAX_ATTEMPTS:
                    raise normalized_error from exc
            time.sleep(VIDEO_CREATE_RETRY_DELAYS[min(attempt - 1, len(VIDEO_CREATE_RETRY_DELAYS) - 1)])
        raise VolcengineGatewayError(VIDEO_CREATE_UPSTREAM_ERROR_MESSAGE, retryable=True)

    def query_task(self, task_id: str) -> dict[str, Any]:
        try:
            response = self.session.get(
                f"{self.base_url}/contents/generations/tasks/{task_id}",
                headers=self._headers(),
                timeout=30,
            )
        except requests.RequestException as exc:
            raise VolcengineGatewayError(f"查询视频任务状态失败：{exc}", retryable=True) from exc
        body = self._decode_response(response)
        content = dict(body.get("content") or {})
        return {
            "task_id": task_id,
            "status": self._normalize_remote_task_status(body.get("status", "unknown")),
            "video_url": content.get("video_url"),
            "thumbnail_url": content.get("thumbnail_url") or body.get("thumbnail_url"),
            "preview_url": content.get("preview_url") or body.get("preview_url"),
            "model": body.get("model"),
            "resolution": body.get("resolution"),
            "ratio": body.get("ratio"),
            "duration": body.get("duration"),
            "fps": body.get("framespersecond"),
            "seed": body.get("seed"),
            "generate_audio": body.get("generate_audio"),
            "raw": body,
        }

    def cancel_task(self, task_id: str) -> dict[str, Any]:
        try:
            response = self.session.delete(
                f"{self.base_url}/contents/generations/tasks/{task_id}",
                headers=self._headers(),
                timeout=10,
            )
        except requests.RequestException as exc:
            return {"success": False, "status": "error", "error": f"取消视频任务请求失败：{exc}"}
        if response.status_code == 200:
            return {"success": True, "status": "cancelled"}
        if response.status_code == 400:
            return {"success": False, "status": "rejected", "error": self._extract_error(response)}
        return {"success": False, "status": "error", "error": response.text[:500]}

    def list_tasks(
        self,
        *,
        page_index: int = 1,
        page_size: int = 50,
        status: str | None = None,
        task_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "page_index": max(1, int(page_index)),
            "page_size": max(1, min(int(page_size), 100)),
        }
        normalized_status = str(status or "").strip()
        normalized_task_ids = [str(item or "").strip() for item in (task_ids or []) if str(item or "").strip()]
        if normalized_status:
            params["filter.status"] = normalized_status
        if normalized_task_ids:
            params["filter.task_ids"] = ",".join(normalized_task_ids)
        try:
            response = self.session.get(
                f"{self.base_url}/contents/generations/tasks",
                headers=self._headers(),
                params=params,
                timeout=30,
            )
        except requests.RequestException as exc:
            raise VolcengineGatewayError(f"查询视频任务列表失败：{exc}", retryable=True) from exc
        body = self._decode_response(response)
        items = []
        for raw_item in body.get("items") or []:
            item = dict(raw_item or {})
            content = dict(item.get("content") or {})
            item["task_id"] = item.get("task_id") or item.get("id")
            item["status"] = self._normalize_remote_task_status(item.get("status"))
            item["video_url"] = item.get("video_url") or content.get("video_url")
            item["thumbnail_url"] = item.get("thumbnail_url") or content.get("thumbnail_url")
            item["preview_url"] = item.get("preview_url") or content.get("preview_url")
            item["model"] = item.get("model") or content.get("model")
            item["resolution"] = item.get("resolution") or content.get("resolution")
            item["ratio"] = item.get("ratio") or content.get("ratio")
            item["duration"] = item.get("duration") or content.get("duration")
            item["seed"] = item.get("seed") if item.get("seed") is not None else content.get("seed")
            item["generate_audio"] = (
                item.get("generate_audio")
                if item.get("generate_audio") is not None
                else content.get("generate_audio")
            )
            item["raw"] = dict(raw_item or {})
            items.append(item)
        return {
            "total": int(body.get("total") or len(items)),
            "items": items,
            "raw": body,
        }

    def delete_task(self, task_id: str) -> dict[str, Any]:
        try:
            response = self.session.delete(
                f"{self.base_url}/contents/generations/tasks/{task_id}",
                headers=self._headers(),
                timeout=10,
            )
        except requests.RequestException as exc:
            return {"success": False, "status": "error", "error": f"删除远端视频任务请求失败：{exc}"}
        if response.status_code == 200:
            return {"success": True, "status": "deleted"}
        if response.status_code == 400:
            return {"success": False, "status": "rejected", "error": self._extract_error(response)}
        return {"success": False, "status": "error", "error": response.text[:500]}

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise ValueError("缺少 Volcengine API Key")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": f"{APP_DISPLAY_NAME}/0.1",
        }

    @staticmethod
    def _normalize_remote_task_status(value: Any) -> str:
        normalized = str(value or "").strip().lower()
        status_map = {
            "pending": "queued",
            "processing": "running",
            "completed": "succeeded",
        }
        return status_map.get(normalized, normalized or "unknown")

    @staticmethod
    def _decode_response(response: requests.Response) -> dict[str, Any]:
        if not response.ok:
            raise VolcengineGatewayError(
                VolcengineVideoGateway._extract_error(response),
                status_code=response.status_code,
                retryable=response.status_code in RETRYABLE_GATEWAY_STATUS_CODES,
            )
        return response.json()

    @staticmethod
    def _extract_error(response: requests.Response) -> str:
        try:
            payload = response.json()
            return payload.get("error", {}).get("message") or json.dumps(payload, ensure_ascii=False)
        except Exception:
            return response.text[:500]

    @staticmethod
    def _normalize_create_task_transport_error(exc: requests.RequestException) -> VolcengineGatewayError:
        detail = str(exc)
        if isinstance(exc, (requests.exceptions.SSLError, requests.exceptions.ProxyError)):
            return VolcengineGatewayError(
                VIDEO_CREATE_TRANSPORT_ERROR_MESSAGE,
                retryable=True,
                detail=detail,
            )
        if isinstance(exc, (requests.exceptions.ConnectionError, requests.exceptions.ReadTimeout)):
            return VolcengineGatewayError(
                VIDEO_CREATE_CONNECTION_ERROR_MESSAGE,
                retryable=True,
                detail=detail,
            )
        return VolcengineGatewayError(
            VIDEO_CREATE_CONNECTION_ERROR_MESSAGE,
            retryable=True,
            detail=detail,
        )

    @staticmethod
    def _normalize_create_task_gateway_error(exc: VolcengineGatewayError) -> VolcengineGatewayError:
        if exc.retryable:
            return VolcengineGatewayError(
                VIDEO_CREATE_UPSTREAM_ERROR_MESSAGE,
                status_code=exc.status_code,
                retryable=True,
                detail=str(exc.detail or exc),
            )
        return exc
