from __future__ import annotations

import json
import time
from typing import Any

import requests

from web_lite3.constants import HTTP_USER_AGENT, IMAGE_MODELS, VIDEO_MODELS
from web_lite3.network import ProviderNetworkManager
from web_lite3.schemas import ImageGenerateRequest, VideoGenerateRequest
from web_lite3.volcengine import VolcengineGatewayError


KLING_BASE_URL = "https://api-beijing.klingai.com"
KLING_IMAGE_GENERATION_PATH = "/v1/images/generations"
KLING_IMAGE_OMNI_PATH = "/v1/images/omni-image"
KLING_VIDEO_OMNI_PATH = "/v1/videos/omni-video"
KLING_TURBO_TEXT_TO_VIDEO_PATH = "/text-to-video/kling-3.0-turbo"
KLING_TURBO_IMAGE_TO_VIDEO_PATH = "/image-to-video/kling-3.0-turbo"
KLING_TURBO_QUERY_PATH = "/tasks"
KLING_RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}
KLING_POLL_INTERVALS = (2, 3, 5, 8, 10)
KLING_IMAGE_POLL_LIMIT = 120


class KlingGatewayError(VolcengineGatewayError):
    pass


def _strip_data_url(value: str | None) -> str:
    normalized = str(value or "").strip()
    if ";base64," in normalized:
        return normalized.split(";base64,", 1)[1]
    return normalized


def _without_private_keys(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in payload.items()
        if not key.startswith("_") and value not in (None, "", [], {})
    }


def _kling_status(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return {
        "submitted": "queued",
        "processing": "running",
        "succeed": "succeeded",
        "succeeded": "succeeded",
        "success": "succeeded",
        "failed": "failed",
    }.get(normalized, normalized or "unknown")


def _video_mode_for_resolution(resolution: str) -> str:
    normalized = str(resolution or "").strip().lower()
    if normalized == "4k":
        return "4k"
    if normalized == "1080p":
        return "pro"
    return "std"


def _image_model_id(request: ImageGenerateRequest) -> str:
    return str(IMAGE_MODELS[request.model_variant]["api_model_id"])


def _video_model_id(request: VideoGenerateRequest) -> str:
    return str(VIDEO_MODELS[request.model_variant]["api_model_id"])


def _extract_task_id(data: dict[str, Any]) -> str:
    return str(data.get("task_id") or data.get("id") or data.get("taskId") or "").strip()


def _extract_image_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    result = data.get("task_result") or {}
    if not isinstance(result, dict):
        return []
    images = [dict(item or {}) for item in result.get("images") or []]
    for series in result.get("series_images") or []:
        if isinstance(series, dict):
            images.extend(dict(item or {}) for item in series.get("images") or [])
        elif isinstance(series, list):
            images.extend(dict(item or {}) for item in series)
    return images


def _first_task_data(data: Any, task_id: str) -> dict[str, Any]:
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("tasks") or data.get("items") or data.get("records")
        if not isinstance(items, list):
            return data
    else:
        return {}
    normalized_task_id = str(task_id or "").strip()
    for item in items:
        if not isinstance(item, dict):
            continue
        item_task_id = str(item.get("task_id") or item.get("id") or item.get("taskId") or "").strip()
        if not normalized_task_id or item_task_id == normalized_task_id:
            return item
    return dict(items[0] or {}) if items else {}


def _extract_video_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    result = data.get("task_result") or {}
    videos = result.get("videos") if isinstance(result, dict) else []
    items = [dict(item or {}) for item in videos or []]
    for output in data.get("outputs") or []:
        if not isinstance(output, dict) or str(output.get("type") or "").strip().lower() != "video":
            continue
        items.append(
            {
                "url": output.get("url") or output.get("video_url"),
                "cover_url": output.get("cover_url") or output.get("thumbnail_url"),
                "duration": output.get("duration"),
            }
        )
    return items


def build_kling_image_payload(
    request: ImageGenerateRequest,
    *,
    input_image: str | None,
    reference_images: list[str],
) -> dict[str, Any]:
    model_id = _image_model_id(request)
    endpoint = KLING_IMAGE_OMNI_PATH if model_id == "kling-v3-omni" else KLING_IMAGE_GENERATION_PATH
    images = [_strip_data_url(item) for item in reference_images if str(item or "").strip()]
    if input_image and not images:
        images.append(_strip_data_url(input_image))
    payload: dict[str, Any] = {
        "_kling_endpoint": endpoint,
        "model_name": model_id,
        "prompt": request.prompt.strip(),
        "n": request.count,
        "aspect_ratio": request.aspect_ratio,
        "resolution": request.size.lower(),
        "watermark_info": {"enabled": False},
    }
    if model_id == "kling-v3-omni":
        if images:
            payload["image_list"] = [{"image": image} for image in images]
    elif images:
        payload["image"] = images[0]
    return payload


def build_kling_video_payload(
    request: VideoGenerateRequest,
    *,
    first_frame: str | None,
    last_frame: str | None,
    reference_images: list[str],
) -> dict[str, Any]:
    model_id = _video_model_id(request)
    if model_id == "kling-3.0-turbo":
        options = {"watermark_info": {"enabled": bool(request.watermark)}}
        if request.scene_type == "text_only":
            return {
                "_kling_endpoint": KLING_TURBO_TEXT_TO_VIDEO_PATH,
                "_kling_query_endpoint": KLING_TURBO_QUERY_PATH,
                "prompt": request.prompt.strip(),
                "settings": {
                    "duration": request.duration,
                    "resolution": request.resolution_grade,
                    "aspect_ratio": request.ratio,
                },
                "options": options,
            }
        if request.scene_type == "first_frame":
            if not first_frame:
                raise ValueError("请上传首帧图片")
            return {
                "_kling_endpoint": KLING_TURBO_IMAGE_TO_VIDEO_PATH,
                "_kling_query_endpoint": KLING_TURBO_QUERY_PATH,
                "contents": [
                    {"type": "prompt", "text": request.prompt.strip()},
                    {"type": "first_frame", "url": _strip_data_url(first_frame)},
                ],
                "settings": {
                    "resolution": request.resolution_grade,
                    "duration": request.duration,
                },
                "options": options,
            }
        raise ValueError("Kling 3.0 Turbo 暂不支持首尾帧图生视频")

    payload: dict[str, Any] = {
        "_kling_endpoint": KLING_VIDEO_OMNI_PATH,
        "_kling_query_endpoint": KLING_VIDEO_OMNI_PATH,
        "model_name": model_id,
        "prompt": request.prompt.strip(),
        "sound": "on" if request.generate_audio else "off",
        "mode": _video_mode_for_resolution(request.resolution_grade),
        "duration": str(request.duration),
        "watermark_info": {"enabled": bool(request.watermark)},
    }
    image_list: list[dict[str, str]] = []
    if request.scene_type == "first_frame":
        if not first_frame:
            raise ValueError("请上传首帧图片")
        image_list.append({"image_url": _strip_data_url(first_frame), "type": "first_frame"})
    elif request.scene_type == "first_last":
        if not first_frame or not last_frame:
            raise ValueError("请同时上传首帧和尾帧图片")
        image_list.append({"image_url": _strip_data_url(first_frame), "type": "first_frame"})
        image_list.append({"image_url": _strip_data_url(last_frame), "type": "end_frame"})
    else:
        payload["aspect_ratio"] = request.ratio
    image_list.extend(
        {"image_url": _strip_data_url(item)}
        for item in reference_images
        if str(item or "").strip()
    )
    if image_list:
        payload["image_list"] = image_list
    return payload


class KlingGatewayBase:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = KLING_BASE_URL,
        network_manager: ProviderNetworkManager | None = None,
    ) -> None:
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.session = network_manager.create_session("kling") if network_manager else requests.Session()
        if network_manager is None:
            self.session.trust_env = False

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise ValueError("缺少 Kling API Key")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": HTTP_USER_AGENT,
        }

    @staticmethod
    def _extract_error(response: requests.Response) -> str:
        try:
            payload = response.json()
            return str(payload.get("message") or payload.get("error") or json.dumps(payload, ensure_ascii=False))
        except Exception:
            return response.text[:500]

    @classmethod
    def _decode_response(cls, response: requests.Response) -> dict[str, Any]:
        if not response.ok:
            raise KlingGatewayError(
                cls._extract_error(response),
                status_code=response.status_code,
                retryable=response.status_code in KLING_RETRYABLE_STATUS_CODES,
            )
        body = response.json()
        code = body.get("code", 0)
        if code not in (0, "0", None):
            raise KlingGatewayError(
                str(body.get("message") or json.dumps(body, ensure_ascii=False)),
                status_code=response.status_code,
                retryable=False,
            )
        return body

    @staticmethod
    def _transport_error(exc: requests.RequestException) -> KlingGatewayError:
        return KlingGatewayError(f"Kling API 请求失败：{exc}", retryable=True, detail=str(exc))


class KlingImageGateway(KlingGatewayBase):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._task_endpoints: dict[str, str] = {}

    def generate(self, payload: dict[str, Any], *, on_event=None) -> dict[str, Any]:
        del on_event
        created = self._create_task(payload)
        task_id = created["task_id"]
        for index in range(KLING_IMAGE_POLL_LIMIT):
            status = self.query_task(task_id)
            if status["status"] == "succeeded":
                return {
                    "data": {"images": [{"url": item["url"]} for item in status.get("images", []) if item.get("url")]},
                    "raw": status.get("raw") or {},
                }
            if status["status"] in {"failed", "cancelled", "expired"}:
                raise KlingGatewayError(str(status.get("message") or "Kling image task failed"), retryable=False)
            time.sleep(KLING_POLL_INTERVALS[min(index, len(KLING_POLL_INTERVALS) - 1)])
        raise KlingGatewayError("Kling image task polling timed out", retryable=True)

    def _create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        endpoint = str(payload.get("_kling_endpoint") or KLING_IMAGE_GENERATION_PATH)
        try:
            response = self.session.post(
                f"{self.base_url}{endpoint}",
                headers=self._headers(),
                json=_without_private_keys(payload),
                timeout=60,
            )
        except requests.RequestException as exc:
            raise self._transport_error(exc) from exc
        data = self._decode_response(response).get("data") or {}
        task_id = _extract_task_id(data)
        if not task_id:
            raise ValueError("未获取到 Kling 图片任务 ID")
        self._task_endpoints[task_id] = endpoint
        return {"task_id": task_id, "status": _kling_status(data.get("task_status") or data.get("status")), "raw": data}

    def query_task(self, task_id: str) -> dict[str, Any]:
        endpoints = [self._task_endpoints[task_id]] if task_id in self._task_endpoints else []
        endpoints.extend(
            item for item in (KLING_IMAGE_OMNI_PATH, KLING_IMAGE_GENERATION_PATH)
            if item not in endpoints
        )
        last_error: KlingGatewayError | None = None
        for endpoint in endpoints:
            try:
                response = self.session.get(
                    f"{self.base_url}{endpoint}/{task_id}",
                    headers=self._headers(),
                    timeout=30,
                )
                data = self._decode_response(response).get("data") or {}
                self._task_endpoints[task_id] = endpoint
                return {
                    "task_id": str(data.get("task_id") or data.get("id") or task_id),
                    "status": _kling_status(data.get("task_status") or data.get("status")),
                    "message": data.get("task_status_msg") or data.get("message") or "",
                    "images": _extract_image_items(data),
                    "raw": data,
                }
            except KlingGatewayError as exc:
                last_error = exc
                if exc.status_code not in {400, 404}:
                    raise
        if last_error:
            raise last_error
        raise KlingGatewayError("Kling image task query failed", retryable=True)


class KlingVideoGateway(KlingGatewayBase):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._task_endpoints: dict[str, str] = {}
        self._task_query_endpoints: dict[str, str] = {}

    def create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        endpoint = str(payload.get("_kling_endpoint") or KLING_VIDEO_OMNI_PATH)
        query_endpoint = str(payload.get("_kling_query_endpoint") or endpoint)
        try:
            response = self.session.post(
                f"{self.base_url}{endpoint}",
                headers=self._headers(),
                json=_without_private_keys(payload),
                timeout=60,
            )
        except requests.RequestException as exc:
            raise self._transport_error(exc) from exc
        data = self._decode_response(response).get("data") or {}
        task_id = _extract_task_id(data)
        if not task_id:
            raise ValueError("未获取到 Kling 视频任务 ID")
        self._task_endpoints[task_id] = endpoint
        self._task_query_endpoints[task_id] = query_endpoint
        return {"task_id": task_id, "status": _kling_status(data.get("task_status") or data.get("status")), "raw": data}

    def query_task(self, task_id: str) -> dict[str, Any]:
        endpoints = [self._task_query_endpoints[task_id]] if task_id in self._task_query_endpoints else []
        endpoints.extend(
            item for item in (KLING_TURBO_QUERY_PATH, KLING_VIDEO_OMNI_PATH)
            if item not in endpoints
        )
        last_error: KlingGatewayError | None = None
        for endpoint in endpoints:
            try:
                data = self._query_task_data(endpoint, task_id)
                self._task_query_endpoints[task_id] = endpoint
                return self._task_payload(task_id, data)
            except KlingGatewayError as exc:
                last_error = exc
                if exc.status_code not in {400, 404}:
                    raise
        if last_error:
            raise last_error
        raise KlingGatewayError("Kling video task query failed", retryable=True)

    def _query_task_data(self, endpoint: str, task_id: str) -> dict[str, Any]:
        try:
            if endpoint == KLING_TURBO_QUERY_PATH:
                response = self.session.get(
                    f"{self.base_url}{endpoint}",
                    headers=self._headers(),
                    params={"task_ids": task_id},
                    timeout=30,
                )
            else:
                response = self.session.get(
                    f"{self.base_url}{endpoint}/{task_id}",
                    headers=self._headers(),
                    timeout=30,
                )
        except requests.RequestException as exc:
            raise self._transport_error(exc) from exc
        data = self._decode_response(response).get("data") or {}
        return _first_task_data(data, task_id) if endpoint == KLING_TURBO_QUERY_PATH else data

    def cancel_task(self, task_id: str) -> dict[str, Any]:
        return {"success": False, "status": "unsupported", "error": f"Kling API does not expose cancel for {task_id}"}

    def list_tasks(self, *, page_index=1, page_size=50, status=None, task_ids=None) -> dict[str, Any]:
        return {"total": 0, "items": [], "raw": {}}

    def delete_task(self, task_id: str) -> dict[str, Any]:
        return {"success": False, "status": "unsupported", "error": f"Kling API does not expose delete for {task_id}"}

    @staticmethod
    def _task_payload(task_id: str, data: dict[str, Any]) -> dict[str, Any]:
        videos = _extract_video_items(data)
        first_video = dict((videos or [{}])[0] or {})
        return {
            "task_id": str(data.get("task_id") or data.get("id") or task_id),
            "status": _kling_status(data.get("task_status") or data.get("status")),
            "message": data.get("task_status_msg") or data.get("message") or "",
            "video_url": first_video.get("url") or first_video.get("video_url"),
            "thumbnail_url": first_video.get("cover_url") or first_video.get("thumbnail_url"),
            "raw": data,
        }
