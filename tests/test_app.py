from __future__ import annotations

import time
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from web_lite3.app import create_app
from web_lite3.constants import APP_DISPLAY_RELEASE_VERSION, APP_HEALTH_NAME, IMAGE_MODELS, VIDEO_MODELS
from web_lite3.data_paths import ensure_storage_paths
from web_lite3.files import resolve_runtime_tool


def test_model_whitelist_exact():
    assert sorted(IMAGE_MODELS.keys()) == [
        "kling_image_v3",
        "kling_image_v3_omni",
        "seedream_v4_5",
        "seedream_v5_0",
        "seedream_v5_0_pro",
    ]
    assert sorted(VIDEO_MODELS.keys()) == [
        "kling_3_0_omni",
        "kling_3_0_turbo",
        "seedance_2_0",
        "seedance_2_0_fast",
        "seedance_2_0_mini",
    ]


def test_pages_load(tmp_path):
    client = TestClient(create_app(home_dir=tmp_path / "app-home"))
    health = client.get("/api/health")
    second_health = client.get("/api/health")
    image_page = client.get("/image")
    video_page = client.get("/video")
    blender_page = client.get("/blender")
    canvas_page = client.get("/canvas")
    panorama_page = client.get("/panorama")
    library_page = client.get("/library")
    settings_page = client.get("/settings")

    assert health.status_code == 200
    health_payload = health.json()
    assert health_payload["ok"] is True
    assert health_payload["app"] == APP_HEALTH_NAME
    assert health_payload["runtime_id"] == client.app.state.runtime_id
    assert second_health.json()["runtime_id"] == health_payload["runtime_id"]

    assert image_page.status_code == 200
    assert video_page.status_code == 200
    assert blender_page.status_code == 200
    assert client.get("/storyboard").status_code == 404
    assert canvas_page.status_code == 200
    assert panorama_page.status_code == 404
    assert library_page.status_code == 200
    assert settings_page.status_code == 200
    assert "Seedream 5.0 Lite" in image_page.text
    assert "Seedream 5.0 Pro" in image_page.text
    assert "Kling Image 3.0" in image_page.text
    assert "图生图" in image_page.text
    assert "GoImage2" not in image_page.text
    assert "首尾帧图生视频" in video_page.text
    assert "Seedance 2.0 Mini" in video_page.text
    assert "Kling 3.0 Turbo" in video_page.text
    assert "\\u56fe\\u751f\\u89c6\\u9891\\uff08\\u9996\\u5e27+\\u5c3e\\u5e27\\uff09" in video_page.text
    assert "多模态参考生视频" in video_page.text
    assert "GPT API Key" not in settings_page.text

    assert "<title>生图 | 井鸽AI影视套件 WebUI</title>" in image_page.text
    assert "<strong>井鸽</strong>启动器" in image_page.text
    assert "开源版WebUI" in image_page.text
    assert f"版本 {APP_DISPLAY_RELEASE_VERSION}" not in image_page.text
    assert f"版本 {APP_DISPLAY_RELEASE_VERSION}" in settings_page.text
    assert 'href="/storyboard"' not in image_page.text
    assert 'rel="prefetch" href="/storyboard"' not in image_page.text
    assert 'href="/canvas"' in image_page.text
    assert 'href="/blender"' in image_page.text
    assert "godreamai-plus-sidebar-width" in image_page.text
    assert 'rel="prefetch" href="/blender"' in image_page.text
    assert 'rel="prefetch" href="/canvas"' in image_page.text
    assert 'rel="prefetch" href="/library"' in image_page.text
    assert 'rel="prefetch" href="/settings"' in image_page.text
    assert 'href="/panorama"' not in image_page.text
    assert 'id="canvasViewport"' in canvas_page.text
    assert 'id="canvasRunSelected"' in canvas_page.text
    assert 'id="canvasAddImageInput"' in canvas_page.text
    assert 'id="canvasThemeToggle"' in canvas_page.text
    assert 'id="canvasUpscaleButton"' in canvas_page.text
    assert 'id="canvasGridSplitButton"' in canvas_page.text
    assert 'id="canvasGridMenuButton"' in canvas_page.text
    assert 'id="canvasRecipeButton"' not in canvas_page.text
    assert 'id="canvasRecipeModal"' not in canvas_page.text
    assert 'data-canvas-menu-action="recipe-task"' not in canvas_page.text
    assert 'data-grid-template="grid_split"' not in canvas_page.text
    assert 'data-grid-template="multi_camera_9"' in canvas_page.text
    assert 'data-grid-template="plot_9"' in canvas_page.text
    assert 'data-grid-template="white_bg_triptych"' in canvas_page.text
    assert 'data-grid-template="storyboard_25"' not in canvas_page.text
    assert 'data-grid-template="cinematic_light"' not in canvas_page.text
    assert 'data-grid-template="character_triptych"' not in canvas_page.text
    assert 'id="canvasContextMenu"' in canvas_page.text
    assert 'class="canvas-blank-context-action" type="button" data-canvas-menu-action="image-input"' in canvas_page.text
    assert 'class="canvas-task-context-action" type="button" data-canvas-menu-action="copy-node"' in canvas_page.text
    assert "克隆节点" in canvas_page.text
    assert "复制节点" not in canvas_page.text
    assert 'class="canvas-task-context-action" type="button" data-canvas-menu-action="delete-node"' in canvas_page.text
    assert 'class="canvas-image-context-action" type="button" data-canvas-menu-action="image-to-video"' in canvas_page.text
    assert 'data-canvas-menu-action="upscale-image"' in canvas_page.text
    assert 'data-canvas-menu-action="add-to-library"' in canvas_page.text
    assert 'data-canvas-menu-action="grid-split"' in canvas_page.text
    assert 'data-canvas-menu-template="multi_camera_9"' in canvas_page.text
    assert 'data-canvas-menu-template="plot_9"' in canvas_page.text
    assert 'data-canvas-menu-template="white_bg_triptych"' in canvas_page.text
    assert 'data-canvas-menu-template="storyboard_25"' not in canvas_page.text
    assert 'data-canvas-menu-template="cinematic_light"' not in canvas_page.text
    assert 'data-canvas-menu-template="character_triptych"' not in canvas_page.text
    assert 'id="canvasSave"' not in canvas_page.text
    assert 'id="canvasImagePicker"' in canvas_page.text
    assert 'id="canvasPreviewModal"' in canvas_page.text
    assert 'id="canvasPreviewVideo"' in canvas_page.text
    assert 'id="canvasAddLibraryModal"' in canvas_page.text
    assert "提示参数" in canvas_page.text
    assert "检查器" not in canvas_page.text
    assert "画布库" in canvas_page.text
    assert 'id="canvasDeleteTaskModal"' in canvas_page.text
    assert 'id="canvasDeleteCanvasOnlyButton"' in canvas_page.text
    assert 'id="canvasGridSplitChoiceModal"' in canvas_page.text
    assert "查看历史详情" not in canvas_page.text
    assert 'id="canvasDeleteWithOutputsButton"' in canvas_page.text
    assert 'id="canvasAssetList"' not in canvas_page.text
    assert "资产抽屉" not in canvas_page.text
    assert "无限画布" in canvas_page.text
    assert 'id="generateButton"' in image_page.text
    assert 'id="clearButton"' in image_page.text
    assert 'id="imageRecipeButton"' not in image_page.text
    assert 'id="imageRecipeModal"' not in image_page.text
    assert 'id="imageRecipePromptConflictModal"' not in image_page.text
    assert '"image_recipes"' not in image_page.text
    assert '"image_recipes"' not in canvas_page.text
    assert '"multi_camera_9"' in canvas_page.text
    assert 'id="sidebarResizer"' in image_page.text
    assert 'id="deleteFailedHistoryButton"' in image_page.text
    assert 'id="cancelButton"' not in image_page.text
    assert 'id="quietModeButton"' in video_page.text
    assert 'class="preview-switch toolbar-button"' in video_page.text
    assert 'id="syncRemoteTasksButton"' not in video_page.text
    assert "同步远端任务" not in video_page.text
    assert 'id="trustedAssetUris"' in video_page.text
    assert 'id="videoPricingPanel"' not in video_page.text
    assert 'id="videoPricingHintSummary"' not in video_page.text
    assert "计费与能力说明" not in video_page.text
    assert 'id="refreshHistoryButton"' in image_page.text
    assert "GoBanana Pro" not in image_page.text
    assert "GoBanana 2" not in image_page.text
    assert "Nano Banana Pro" not in image_page.text
    assert "Nano Banana 2" not in image_page.text
    assert "Google API Key" not in settings_page.text
    assert "Volcengine API Key" in settings_page.text
    assert "Mint Circuit" in settings_page.text
    assert "Solar Dune" not in settings_page.text
    assert "Deep Ocean" not in settings_page.text
    assert 'id="googleApiKey"' not in settings_page.text
    assert 'id="googleApiKeyHistorySelect"' not in settings_page.text
    assert 'id="openaiApiKey"' not in settings_page.text
    assert 'id="openaiApiKeyHistorySelect"' not in settings_page.text
    assert 'id="klingApiKey"' in settings_page.text
    assert 'id="klingApiKeyHistorySelect"' not in settings_page.text
    assert 'src="/static/js/settings.js?v=' in settings_page.text
    assert '<select id="openaiNetworkMode">' not in settings_page.text
    assert '<select id="googleNetworkMode">' not in settings_page.text
    assert '<select id="volcengineNetworkMode">' not in settings_page.text
    assert 'id="openaiNetworkMode" type="hidden" value="proxy"' not in settings_page.text
    assert 'id="googleNetworkMode" type="hidden" value="proxy"' not in settings_page.text
    assert 'id="volcengineNetworkMode" type="hidden" value="direct"' in settings_page.text
    assert 'id="klingNetworkMode" type="hidden" value="direct"' in settings_page.text
    assert 'id="apiNetworkAutoSwitch" type="hidden" value="true"' in settings_page.text
    assert "VPN 状态助手" in settings_page.text
    assert "火山引擎和可灵中国大陆接口通常直连" in settings_page.text
    assert set(client.get("/api/network/status").json()["providers"]) == {"volcengine", "kling"}
    assert set(client.post("/api/network/check").json()["results"]) == {"volcengine", "kling"}
    assert "<summary>高级设置</summary>" not in settings_page.text
    assert "本地代理地址" not in settings_page.text
    assert "自动走本地代理" not in settings_page.text
    assert 'class="panel company-panel"' in settings_page.text
    assert "联络微信：fashejing" in settings_page.text
    assert "试用联络微信" not in settings_page.text
    assert "国内版能力与计费文档" not in settings_page.text
    assert "国内教程与示例" not in settings_page.text
    assert "国内 API 接入" not in settings_page.text
    assert "国内计费文档" not in settings_page.text
    assert 'value="1080p"' in video_page.text
    assert 'class="blender-app-frame"' in blender_page.text
    assert 'id="blenderAssetUploadButton"' in blender_page.text
    assert 'src="/static/js/blender_host.js?v=' in blender_page.text
    assert "虚拟拍摄" in blender_page.text
    assert "Poly Haven" in blender_page.text
    assert "Sketchfab" in blender_page.text
    assert "BlenderKit" in blender_page.text
    assert "Quaternius" in blender_page.text
    assert "Kenney" in blender_page.text
    assert 'data-blender-command=' not in blender_page.text
    assert 'src="/blender/app"' in blender_page.text
    assert "井鸽AI影视套件" in blender_page.text
    assert "GoDreamAI-Blender" not in blender_page.text
    blender_app = client.get("/blender/app")
    assert blender_app.status_code == 200
    assert 'id="root"' in blender_app.text
    assert "/static/blender-app/assets/" in blender_app.text


def test_blender_assets_and_export(tmp_path):
    client = TestClient(create_app(home_dir=tmp_path / "app-home"))

    assets = client.get("/api/assets")
    assert assets.status_code == 200
    assets_payload = assets.json()
    asset_ids = {item["id"] for item in assets_payload}
    assert {
        "person-whitebox",
        "block-building",
        "tower-building",
        "lowpoly-tree",
        "prop-crate",
        "prop-wall",
        "greenscreen-panel",
        "vehicle-car",
        "vehicle-truck",
        "vehicle-motorcycle",
        "vehicle-boat",
        "aircraft-airplane",
        "aircraft-drone",
        "aircraft-helicopter",
    } <= asset_ids
    assert all(item.get("dimensions") for item in assets_payload)

    rejected_import = client.post(
        "/api/assets/import",
        files={"asset": ("bad.txt", b"not a gltf", "text/plain")},
    )
    assert rejected_import.status_code == 400

    imported = client.post(
        "/api/assets/import",
        files={"asset": ("prop.gltf", b'{"asset":{"version":"2.0"}}', "model/gltf+json")},
    )
    assert imported.status_code == 200
    imported_payload = imported.json()
    assert imported_payload["kind"] == "imported"
    assert imported_payload["url"].startswith("/uploads/")
    assert imported_payload["format"] == "gltf"
    assert client.get(imported_payload["url"]).status_code == 200

    obj_import = client.post(
        "/api/assets/import",
        files={"asset": ("prop.obj", b"o cube\nv 0 0 0\n", "text/plain")},
    )
    assert obj_import.status_code == 200
    obj_payload = obj_import.json()
    assert obj_payload["kind"] == "imported"
    assert obj_payload["format"] == "obj"
    assert obj_payload["url"].startswith("/uploads/")
    assert client.get(obj_payload["url"]).status_code == 200

    package_buffer = BytesIO()
    with zipfile.ZipFile(package_buffer, "w") as archive:
        archive.writestr("plastic_crate_03_4k/plastic_crate_03_4k.gltf", b'{"asset":{"version":"2.0"}}')
        archive.writestr("plastic_crate_03_4k/textures/base_color.jpg", b"texture-bytes")
    package_import = client.post(
        "/api/assets/import",
        files={"asset": ("plastic_crate_03_4k.zip", package_buffer.getvalue(), "application/zip")},
    )
    assert package_import.status_code == 200
    package_payload = package_import.json()
    assert package_payload["kind"] == "imported"
    assert package_payload["format"] == "gltf"
    assert package_payload["label"] == "plastic_crate_03_4k"
    assert client.get(package_payload["url"]).status_code == 200

    blend_import = client.post(
        "/api/assets/import",
        files={"asset": ("prop.blend", b"not a real blend file", "application/octet-stream")},
    )
    assert blend_import.status_code == 400
    assert ".blend" in blend_import.text
    assert "Blender" in blend_import.text

    for filename, expected_format in [
        ("prop.stl", "stl"),
        ("prop.fbx", "fbx"),
        ("prop.dae", "dae"),
        ("prop.ply", "ply"),
        ("prop.3mf", "3mf"),
        ("prop.3ds", "3ds"),
    ]:
        format_import = client.post(
            "/api/assets/import",
            files={"asset": (filename, b"model-bytes", "application/octet-stream")},
        )
        assert format_import.status_code == 200
        assert format_import.json()["format"] == expected_format

    rejected_texture = client.post(
        "/api/textures/import",
        files={"texture": ("bad.txt", b"not an image", "text/plain")},
    )
    assert rejected_texture.status_code == 400

    texture = client.post(
        "/api/textures/import",
        files={"texture": ("plate.png", b"\x89PNG\r\n\x1a\n", "image/png")},
    )
    assert texture.status_code == 200
    texture_payload = texture.json()
    assert texture_payload["name"] == "plate"
    assert texture_payload["url"].startswith("/textures/")
    assert client.get(texture_payload["url"]).status_code == 200

    screenshot_buffer = BytesIO()
    Image.new("RGB", (16, 9), (120, 120, 120)).save(screenshot_buffer, format="PNG")
    screenshot = client.post(
        "/api/virtual-production/screenshots",
        data={"name": "测试截图", "width": "1920", "height": "1080", "time_sec": "1.25"},
        files={"file": ("shot.png", screenshot_buffer.getvalue(), "image/png")},
    )
    assert screenshot.status_code == 200
    screenshot_payload = screenshot.json()
    assert screenshot_payload["category"] == "虚拟拍摄截图"
    assert screenshot_payload["asset"]["tag_category"] == "虚拟拍摄截图"
    library_payload = client.get("/api/library/assets?tag_category=虚拟拍摄截图").json()
    assert library_payload["total"] == 1
    assert library_payload["items"][0]["display_name"] == "测试截图"

    invalid_render = client.post("/api/render-jobs", json={"version": 1, "objects": []})
    assert invalid_render.status_code == 400

    if resolve_runtime_tool("ffmpeg") is None:
        pytest.skip("ffmpeg is not available in this runtime")

    scene = {
        "version": 1,
        "objects": [
            {
                "id": "object-1",
                "assetId": "person-whitebox",
                "name": "Person",
                "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]},
                "visible": True,
                "material": {"color": "#f4f6fb", "roughness": 0.65},
            }
        ],
        "cameras": [
            {
                "id": "camera-1",
                "name": "Shot Camera",
                "keyframes": [
                    {"id": "kf-1", "timeSec": 0, "position": [-3, 2, 5], "target": [0, 0, 0], "fov": 45, "interpolation": "linear"},
                    {"id": "kf-2", "timeSec": 1, "position": [3, 2, 5], "target": [0, 0, 0], "fov": 45, "interpolation": "linear"},
                ],
            }
        ],
        "activeCameraId": "camera-1",
        "cameraAimAnchor": {"enabled": True, "position": [0, 1.3, 0], "snapEnabled": True},
        "lights": [
            {
                "id": "light-1",
                "name": "Key Light",
                "kind": "directional",
                "enabled": True,
                "intensity": 1.2,
                "colorTemperature": 5600,
                "azimuthDeg": 35,
                "elevationDeg": 45,
                "distance": 8,
                "position": [3, 5, 4],
                "target": [0, 0, 0],
            }
        ],
        "timeline": {"currentTimeSec": 0, "mode": "motion"},
        "renderSettings": {"durationSec": 1, "fps": 24, "width": 320, "height": 240, "format": "mp4"},
    }
    assert client.get("/api/projects").status_code == 404
    assert client.put("/api/projects/test-scene", json={"name": "测试工程", "scene": scene}).status_code == 404

    queued = client.post("/api/render-jobs", json=scene)
    assert queued.status_code == 202
    queued_payload = queued.json()
    assert queued_payload["status"] in {"queued", "rendering"}

    job_payload = queued_payload
    for _ in range(80):
        job = client.get(f"/api/render-jobs/{queued_payload['id']}")
        assert job.status_code == 200
        job_payload = job.json()
        if job_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert job_payload["status"] == "completed"
    assert job_payload["downloadUrl"] == f"/api/render-jobs/{queued_payload['id']}/download"
    assert job_payload["outputPath"].startswith("/exports/")
    assert client.get(job_payload["downloadUrl"]).status_code == 200
    assert client.get(job_payload["outputPath"]).status_code == 200

    assert client.post("/api/render-jobs/frame-slices?fps=3", json=scene).status_code in {404, 405}

    def frame_bytes(color: str) -> bytes:
        buffer = BytesIO()
        Image.new("RGB", (64, 36), color).save(buffer, format="PNG")
        return buffer.getvalue()

    assert client.post(
        "/api/render-jobs/captured-frame-slices",
        data={"fps": "2"},
        files=[
            ("frames", ("frame_000001.png", frame_bytes("#111111"), "image/png")),
            ("frames", ("frame_000002.png", frame_bytes("#f2f4f7"), "image/png")),
        ],
    ).status_code in {404, 405}

    captured_video = client.post(
        "/api/render-jobs/captured-video",
        data={"fps": "2"},
        files=[
            ("frames", ("frame_000001.png", frame_bytes("#111111"), "image/png")),
            ("frames", ("frame_000002.png", frame_bytes("#f2f4f7"), "image/png")),
        ],
    )
    assert captured_video.status_code == 201
    captured_video_payload = captured_video.json()
    assert captured_video_payload["kind"] == "video"
    assert captured_video_payload["status"] == "completed"
    assert captured_video_payload["frameCount"] == 2
    assert captured_video_payload["outputPath"].startswith("/exports/")
    assert client.get(captured_video_payload["downloadUrl"]).status_code == 200


def test_unsupported_model_rejected(tmp_path):
    client = TestClient(create_app(home_dir=tmp_path / "app-home"))
    response = client.post(
        "/api/generate/image",
        json={
            "model_variant": "kling",
            "prompt": "test",
            "size": "3072x3072",
            "count": 1,
            "sequential_mode": False,
            "output_format": "jpeg",
            "enable_web_search": False,
            "reference_asset_ids": [],
        },
    )
    assert response.status_code == 422


def test_history_api_returns_history_counts_for_empty_current_kind(tmp_path):
    app = create_app(home_dir=tmp_path / "app-home")
    client = TestClient(app)
    storage_dir = tmp_path / "app-storage"
    client.post(
        "/api/settings",
        json={
            "auto_open_browser": False,
            "prompt_font_size": 16,
            "record_card_size": "medium",
            "theme": "light",
            "storage_dir": str(storage_dir),
            "volcengine_api_key": "test-key",
        },
    )
    history_store = app.state.history_store_registry.for_storage_dir(str(storage_dir))
    history_store.create_history_record(
        job_id="image-only-job",
        kind="image",
        status="succeeded",
        model_variant="nano_banana_pro",
        prompt="legacy image record",
        params_requested={"model_variant": "nano_banana_pro", "prompt": "legacy image record"},
        mode_key="text_only",
    )

    payload = client.get("/api/history/video?view=summary&repair=0").json()
    assert payload["items"] == []
    assert payload["history_counts"] == {"image": 1, "video": 0}


def test_history_api_repairs_video_record_with_local_path_but_no_artifacts(tmp_path):
    app = create_app(home_dir=tmp_path / "app-home")
    client = TestClient(app)
    storage_dir = tmp_path / "app-storage"
    client.post(
        "/api/settings",
        json={
            "auto_open_browser": False,
            "prompt_font_size": 16,
            "record_card_size": "medium",
            "theme": "light",
            "storage_dir": str(storage_dir),
            "volcengine_api_key": "test-key",
        },
    )
    storage = ensure_storage_paths(storage_dir)
    local_video = storage.videos_dir / "legacy_video.mp4"
    local_video.write_bytes(b"not-a-real-video-but-existing")
    history_store = app.state.history_store_registry.for_storage_dir(str(storage_dir))
    record = history_store.create_history_record(
        job_id="legacy-video-job",
        kind="video",
        status="succeeded",
        model_variant="seedance_2_0",
        prompt="legacy video record",
        params_requested={"model_variant": "seedance_2_0", "prompt": "legacy video record"},
        mode_key="text_only",
    )
    history_store.update_history_record(
        record["id"],
        local_paths=[str(local_video)],
        result_payload={},
        error_message="本地补救失败: 旧版没有 artifact",
    )

    payload = client.get("/api/history/video?view=summary&repair=1").json()
    item = payload["items"][0]
    artifacts = item["result_payload"]["artifacts"]
    repaired_record = history_store.get_history(record["id"])

    assert item["error_message"] == ""
    assert artifacts[0]["kind"] == "video"
    assert artifacts[0]["public_url"].endswith("/videos/legacy_video.mp4")
    assert repaired_record["error_message"] == ""
    assert repaired_record["result_payload"]["artifacts"][0]["local_path"] == str(local_video)


def test_history_api_prefers_local_video_artifact_when_remote_artifact_is_stale(tmp_path):
    app = create_app(home_dir=tmp_path / "app-home")
    client = TestClient(app)
    storage_dir = tmp_path / "app-storage"
    client.post(
        "/api/settings",
        json={
            "auto_open_browser": False,
            "prompt_font_size": 16,
            "record_card_size": "medium",
            "theme": "light",
            "storage_dir": str(storage_dir),
            "volcengine_api_key": "test-key",
        },
    )
    storage = ensure_storage_paths(storage_dir)
    local_video = storage.videos_dir / "legacy_synced_video.mp4"
    local_thumb = storage.thumbs_dir / "legacy_synced_thumb.jpg"
    local_video.write_bytes(b"existing local video")
    local_thumb.write_bytes(b"existing local thumbnail")
    history_store = app.state.history_store_registry.for_storage_dir(str(storage_dir))
    record = history_store.create_history_record(
        job_id="legacy-provider-sync-job",
        kind="video",
        status="succeeded",
        model_variant="seedance_2_0",
        prompt="remote synced video with repaired local files",
        params_requested={"model_variant": "seedance_2_0", "prompt": "remote synced video"},
        mode_key="text_only",
    )
    history_store.update_history_record(
        record["id"],
        local_paths=[str(local_video)],
        thumbnail_path=str(local_thumb),
        result_payload={
            "provider_sync": True,
            "artifacts": [
                {
                    "kind": "video",
                    "source_url": "https://ark.example.invalid/expired.mp4",
                    "public_url": "https://ark.example.invalid/expired.mp4",
                }
            ],
        },
    )

    payload = client.get("/api/history/video?view=summary&repair=0").json()
    artifact = payload["items"][0]["result_payload"]["artifacts"][0]

    assert artifact["public_url"].endswith("/videos/legacy_synced_video.mp4")
    assert artifact["thumbnail_url"].endswith("/thumbs/legacy_synced_thumb.jpg")
    assert "ark.example.invalid" not in artifact["public_url"]


def test_history_api_hides_local_repair_failure_for_remote_sync_video(tmp_path):
    app = create_app(home_dir=tmp_path / "app-home")
    client = TestClient(app)
    storage_dir = tmp_path / "app-storage"
    client.post(
        "/api/settings",
        json={
            "auto_open_browser": False,
            "prompt_font_size": 16,
            "record_card_size": "medium",
            "theme": "light",
            "storage_dir": str(storage_dir),
            "volcengine_api_key": "test-key",
        },
    )
    history_store = app.state.history_store_registry.for_storage_dir(str(storage_dir))
    record = history_store.create_history_record(
        job_id="remote-sync:cgt-expired-url",
        kind="video",
        status="succeeded",
        model_variant="seedance_2_0",
        prompt="remote synced video",
        params_requested={"model_variant": "seedance_2_0", "prompt": "remote synced video"},
        mode_key="text_only",
    )
    history_store.update_history_record(
        record["id"],
        result_payload={
            "provider_sync": True,
            "artifacts": [
                {
                    "kind": "video",
                    "source_url": "https://ark.example.invalid/expired.mp4",
                    "public_url": "https://ark.example.invalid/expired.mp4",
                }
            ],
        },
        error_message="本地补救失败: 403 Client Error: Forbidden",
    )

    payload = client.get("/api/history/video?view=summary&repair=0").json()

    assert payload["items"] == []
    assert payload["total"] == 0
    assert history_store.list_repair_candidates("video") == []
