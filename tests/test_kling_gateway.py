from __future__ import annotations

from web_lite3.constants import HTTP_USER_AGENT
from web_lite3.kling import (
    KLING_BASE_URL,
    KLING_IMAGE_GENERATION_PATH,
    KlingImageGateway,
    KlingVideoGateway,
    KLING_IMAGE_OMNI_PATH,
    KLING_TURBO_IMAGE_TO_VIDEO_PATH,
    KLING_TURBO_QUERY_PATH,
    KLING_VIDEO_OMNI_PATH,
    build_kling_image_payload,
    build_kling_video_payload,
)
from web_lite3.schemas import ImageGenerateRequest, VideoGenerateRequest


def test_kling_user_agents_are_http_header_safe():
    gateways = [
        KlingImageGateway("kling-key"),
        KlingVideoGateway("kling-key"),
    ]
    for gateway in gateways:
        user_agent = gateway._headers()["User-Agent"]
        assert user_agent == HTTP_USER_AGENT
        assert user_agent.encode("latin-1").decode("latin-1") == user_agent


def test_kling_image_generation_uses_domestic_payload_shape():
    request = ImageGenerateRequest(
        model_variant="kling_image_v3",
        prompt="一只猫",
        aspect_ratio="16:9",
        size="2k",
        count=2,
        output_format="jpeg",
        reference_asset_ids=["asset-1"],
    )

    payload = build_kling_image_payload(
        request,
        input_image=None,
        reference_images=["data:image/png;base64,AAA"],
    )

    assert KLING_BASE_URL == "https://api-beijing.klingai.com"
    assert payload["_kling_endpoint"] == KLING_IMAGE_GENERATION_PATH
    assert payload["model_name"] == "kling-v3"
    assert payload["image"] == "AAA"
    assert payload["resolution"] == "2k"
    assert payload["n"] == 2


def test_kling_omni_image_uses_image_list_and_auto_ratio():
    request = ImageGenerateRequest(
        model_variant="kling_image_v3_omni",
        prompt="一组角色设定",
        aspect_ratio="auto",
        size="4k",
        count=1,
        output_format="jpeg",
        reference_asset_ids=["asset-1", "asset-2"],
    )

    payload = build_kling_image_payload(
        request,
        input_image=None,
        reference_images=["data:image/png;base64,AAA", "BBB"],
    )

    assert payload["_kling_endpoint"] == KLING_IMAGE_OMNI_PATH
    assert payload["model_name"] == "kling-v3-omni"
    assert payload["aspect_ratio"] == "auto"
    assert payload["resolution"] == "4k"
    assert payload["image_list"] == [{"image": "AAA"}, {"image": "BBB"}]


def test_kling_turbo_first_frame_uses_domestic_turbo_payload_shape():
    request = VideoGenerateRequest(
        model_variant="kling_3_0_turbo",
        prompt="镜头缓慢推进",
        scene_type="first_frame",
        resolution_grade="720p",
        ratio="16:9",
        duration=3,
        first_frame_asset_id="first",
        generate_audio=False,
    )

    payload = build_kling_video_payload(
        request,
        first_frame="data:image/png;base64,AAA",
        last_frame=None,
        reference_images=[],
    )

    assert payload["_kling_endpoint"] == KLING_TURBO_IMAGE_TO_VIDEO_PATH
    assert payload["_kling_query_endpoint"] == KLING_TURBO_QUERY_PATH
    assert payload["contents"] == [
        {"type": "prompt", "text": "镜头缓慢推进"},
        {"type": "first_frame", "url": "AAA"},
    ]
    assert payload["settings"] == {"resolution": "720p", "duration": 3}
    assert "model_name" not in payload
    assert "sound" not in payload


def test_kling_omni_first_last_uses_domestic_omni_payload_shape():
    request = VideoGenerateRequest(
        model_variant="kling_3_0_omni",
        prompt="从白天过渡到夜晚",
        scene_type="first_last",
        resolution_grade="4k",
        ratio="16:9",
        duration=5,
        first_frame_asset_id="first",
        last_frame_asset_id="last",
        generate_audio=True,
    )

    payload = build_kling_video_payload(
        request,
        first_frame="data:image/png;base64,AAA",
        last_frame="data:image/png;base64,BBB",
        reference_images=[],
    )

    assert payload["_kling_endpoint"] == KLING_VIDEO_OMNI_PATH
    assert payload["_kling_query_endpoint"] == KLING_VIDEO_OMNI_PATH
    assert payload["model_name"] == "kling-v3-omni"
    assert payload["mode"] == "4k"
    assert payload["sound"] == "on"
    assert payload["duration"] == "5"
    assert payload["image_list"] == [
        {"image_url": "AAA", "type": "first_frame"},
        {"image_url": "BBB", "type": "end_frame"},
    ]
