from __future__ import annotations

import pytest
import requests

from web_lite3.volcengine import (
    IMAGE_REQUEST_CONNECTION_ERROR_MESSAGE,
    IMAGE_REQUEST_MAX_ATTEMPTS,
    IMAGE_REQUEST_TRANSPORT_ERROR_MESSAGE,
    IMAGE_REQUEST_UPSTREAM_ERROR_MESSAGE,
    VIDEO_CREATE_CONNECTION_ERROR_MESSAGE,
    VIDEO_CREATE_MAX_ATTEMPTS,
    VIDEO_CREATE_TRANSPORT_ERROR_MESSAGE,
    VIDEO_CREATE_UPSTREAM_ERROR_MESSAGE,
    VolcengineGatewayError,
    VolcengineImageGateway,
    VolcengineVideoGateway,
)


class DummyResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload
        self.ok = 200 <= status_code < 300
        self.text = str(payload)

    def json(self):
        return self._payload


class DummyStreamResponse(DummyResponse):
    def __init__(self, status_code: int, payload: dict, lines: list[str] | None = None) -> None:
        super().__init__(status_code, payload)
        self._lines = lines or []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def iter_lines(self, decode_unicode=True):
        for line in self._lines:
            yield line


def test_image_gateway_uses_direct_session_without_env_proxy():
    gateway = VolcengineImageGateway("sk-test")
    assert gateway.session.trust_env is False


def test_image_gateway_retries_ssl_error_and_succeeds(monkeypatch):
    gateway = VolcengineImageGateway("sk-test")
    attempts = {"count": 0}
    sleep_calls: list[float] = []

    def fake_post(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise requests.exceptions.SSLError("EOF occurred in violation of protocol")
        return DummyResponse(200, {"data": [{"url": "https://fake.local/image.png"}], "usage": {}})

    monkeypatch.setattr(gateway.session, "post", fake_post)
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    payload = gateway.generate({"model": "demo", "prompt": "hello"})

    assert payload["data"]["images"][0]["url"] == "https://fake.local/image.png"
    assert attempts["count"] == 2
    assert sleep_calls == [0.75]


def test_image_gateway_exhausted_proxy_error_is_user_friendly(monkeypatch):
    gateway = VolcengineImageGateway("sk-test")
    sleep_calls: list[float] = []

    monkeypatch.setattr(
        gateway.session,
        "post",
        lambda *args, **kwargs: (_ for _ in ()).throw(requests.exceptions.ProxyError("proxy closed connection")),
    )
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    with pytest.raises(VolcengineGatewayError, match=IMAGE_REQUEST_TRANSPORT_ERROR_MESSAGE) as exc_info:
        gateway.generate({"model": "demo", "prompt": "hello"})

    assert exc_info.value.detail == "proxy closed connection"
    assert len(sleep_calls) == IMAGE_REQUEST_MAX_ATTEMPTS - 1


def test_image_gateway_retries_retryable_upstream_status(monkeypatch):
    gateway = VolcengineImageGateway("sk-test")
    responses = iter(
        [
            DummyResponse(503, {"error": {"message": "busy"}}),
            DummyResponse(200, {"data": [{"url": "https://fake.local/image.png"}], "usage": {}}),
        ]
    )
    sleep_calls: list[float] = []

    monkeypatch.setattr(gateway.session, "post", lambda *args, **kwargs: next(responses))
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    payload = gateway.generate({"model": "demo", "prompt": "hello"})

    assert payload["data"]["images"][0]["url"] == "https://fake.local/image.png"
    assert sleep_calls == [0.75]


def test_image_gateway_exhausted_connection_timeout_maps_to_connection_message(monkeypatch):
    gateway = VolcengineImageGateway("sk-test")
    sleep_calls: list[float] = []

    monkeypatch.setattr(
        gateway.session,
        "post",
        lambda *args, **kwargs: (_ for _ in ()).throw(requests.exceptions.ReadTimeout("timed out")),
    )
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    with pytest.raises(VolcengineGatewayError, match=IMAGE_REQUEST_CONNECTION_ERROR_MESSAGE) as exc_info:
        gateway.generate({"model": "demo", "prompt": "hello"})

    assert exc_info.value.detail == "timed out"
    assert len(sleep_calls) == IMAGE_REQUEST_MAX_ATTEMPTS - 1


def test_image_gateway_sse_connection_failure_is_sanitized(monkeypatch):
    gateway = VolcengineImageGateway("sk-test")
    sleep_calls: list[float] = []

    monkeypatch.setattr(
        gateway.session,
        "post",
        lambda *args, **kwargs: (_ for _ in ()).throw(requests.exceptions.SSLError("EOF occurred in violation of protocol")),
    )
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    with pytest.raises(VolcengineGatewayError, match=IMAGE_REQUEST_TRANSPORT_ERROR_MESSAGE) as exc_info:
        gateway.generate({"model": "demo", "prompt": "hello", "stream": True}, on_event=lambda event: None)

    assert "HTTPSConnectionPool" not in str(exc_info.value)
    assert len(sleep_calls) == IMAGE_REQUEST_MAX_ATTEMPTS - 1


def test_image_gateway_sse_does_not_retry_after_partial_output(monkeypatch):
    gateway = VolcengineImageGateway("sk-test")
    attempts = {"count": 0}
    sleep_calls: list[float] = []

    def fake_post(*args, **kwargs):
        attempts["count"] += 1
        return DummyStreamResponse(
            200,
            {},
            lines=[
                'data: {"type":"image_generation.partial_succeeded","url":"https://fake.local/image-1.png"}',
                'data: {"type":"image_generation.completed","usage":{"total_tokens":1}}',
            ],
        )

    response = fake_post()

    def broken_iter_lines(*args, **kwargs):
        yield 'data: {"type":"image_generation.partial_succeeded","url":"https://fake.local/image-1.png"}'
        raise requests.exceptions.ConnectionError("connection dropped")

    response.iter_lines = broken_iter_lines
    monkeypatch.setattr(gateway.session, "post", lambda *args, **kwargs: response)
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    with pytest.raises(VolcengineGatewayError, match="图片流式生成请求中断") as exc_info:
        gateway.generate({"model": "demo", "prompt": "hello", "stream": True}, on_event=lambda event: None)

    assert exc_info.value.detail == "connection dropped"
    assert attempts["count"] == 1
    assert sleep_calls == []


def test_video_gateway_uses_direct_session_without_env_proxy():
    gateway = VolcengineVideoGateway("sk-test")
    assert gateway.session.trust_env is False


def test_video_gateway_retries_ssl_error_and_succeeds(monkeypatch):
    gateway = VolcengineVideoGateway("sk-test")
    attempts = {"count": 0}
    sleep_calls: list[float] = []

    def fake_post(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise requests.exceptions.SSLError("EOF occurred in violation of protocol")
        return DummyResponse(200, {"id": "task-1", "status": "queued"})

    monkeypatch.setattr(gateway.session, "post", fake_post)
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    created = gateway.create_task({"model": "demo"})

    assert created["task_id"] == "task-1"
    assert attempts["count"] == 2
    assert sleep_calls == [0.75]


def test_video_gateway_exhausted_proxy_error_is_user_friendly(monkeypatch):
    gateway = VolcengineVideoGateway("sk-test")
    sleep_calls: list[float] = []

    def fake_post(*args, **kwargs):
        raise requests.exceptions.ProxyError("proxy closed connection")

    monkeypatch.setattr(gateway.session, "post", fake_post)
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    with pytest.raises(VolcengineGatewayError, match=VIDEO_CREATE_TRANSPORT_ERROR_MESSAGE) as exc_info:
        gateway.create_task({"model": "demo"})

    assert exc_info.value.detail == "proxy closed connection"
    assert len(sleep_calls) == VIDEO_CREATE_MAX_ATTEMPTS - 1


def test_video_gateway_retries_retryable_upstream_status(monkeypatch):
    gateway = VolcengineVideoGateway("sk-test")
    responses = iter(
        [
            DummyResponse(503, {"error": {"message": "busy"}}),
            DummyResponse(200, {"id": "task-2", "status": "queued"}),
        ]
    )
    sleep_calls: list[float] = []

    monkeypatch.setattr(gateway.session, "post", lambda *args, **kwargs: next(responses))
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    created = gateway.create_task({"model": "demo"})

    assert created["task_id"] == "task-2"
    assert sleep_calls == [0.75]


def test_video_gateway_exhausted_retryable_upstream_status_is_user_friendly(monkeypatch):
    gateway = VolcengineVideoGateway("sk-test")
    sleep_calls: list[float] = []

    monkeypatch.setattr(
        gateway.session,
        "post",
        lambda *args, **kwargs: DummyResponse(503, {"error": {"message": "busy"}}),
    )
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    with pytest.raises(VolcengineGatewayError, match=VIDEO_CREATE_UPSTREAM_ERROR_MESSAGE) as exc_info:
        gateway.create_task({"model": "demo"})

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "busy"
    assert len(sleep_calls) == VIDEO_CREATE_MAX_ATTEMPTS - 1


def test_video_gateway_connection_timeout_maps_to_connection_message(monkeypatch):
    gateway = VolcengineVideoGateway("sk-test")
    sleep_calls: list[float] = []

    monkeypatch.setattr(
        gateway.session,
        "post",
        lambda *args, **kwargs: (_ for _ in ()).throw(requests.exceptions.ReadTimeout("timed out")),
    )
    monkeypatch.setattr("web_lite3.volcengine.time.sleep", lambda delay: sleep_calls.append(delay))

    with pytest.raises(VolcengineGatewayError, match=VIDEO_CREATE_CONNECTION_ERROR_MESSAGE) as exc_info:
        gateway.create_task({"model": "demo"})

    assert exc_info.value.detail == "timed out"
    assert len(sleep_calls) == VIDEO_CREATE_MAX_ATTEMPTS - 1


def test_video_gateway_list_tasks_normalizes_content_urls(monkeypatch):
    gateway = VolcengineVideoGateway("sk-test")

    monkeypatch.setattr(
        gateway.session,
        "get",
        lambda *args, **kwargs: DummyResponse(
            200,
            {
                "total": 1,
                "items": [
                    {
                        "id": "remote-task-1",
                        "status": "completed",
                        "content": {
                            "video_url": "https://fake.local/video.mp4",
                            "thumbnail_url": "https://fake.local/thumb.jpg",
                            "preview_url": "https://fake.local/preview.jpg",
                            "model": "doubao-seedance-2-0-260128",
                            "resolution": "720p",
                            "ratio": "16:9",
                            "duration": 5,
                            "seed": 123,
                            "generate_audio": True,
                        },
                    }
                ],
            },
        ),
    )

    payload = gateway.list_tasks()
    item = payload["items"][0]

    assert item["task_id"] == "remote-task-1"
    assert item["status"] == "succeeded"
    assert item["video_url"] == "https://fake.local/video.mp4"
    assert item["thumbnail_url"] == "https://fake.local/thumb.jpg"
    assert item["preview_url"] == "https://fake.local/preview.jpg"
    assert item["raw"]["content"]["video_url"] == "https://fake.local/video.mp4"
