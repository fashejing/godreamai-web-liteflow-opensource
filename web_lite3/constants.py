from __future__ import annotations

import os
import re
from collections.abc import Mapping
from typing import Any


APP_BRAND_TITLE = "井鸽AI影视套件"
APP_BRAND_TITLE_EMPHASIS = "井鸽"
APP_BRAND_TITLE_REST = "AI影视套件"
APP_BRAND_EDITION = "开源版"
APP_BRAND_SUBTITLE = "WebUI"
APP_BRAND_SIDEBAR_TITLE = "井鸽启动器"
APP_BRAND_SIDEBAR_TITLE_EMPHASIS = "井鸽"
APP_BRAND_SIDEBAR_TITLE_REST = "启动器"
APP_BRAND_SIDEBAR_SUBTITLE = f"{APP_BRAND_EDITION}{APP_BRAND_SUBTITLE}"
APP_DISPLAY_NAME = f"{APP_BRAND_TITLE} {APP_BRAND_SUBTITLE}"
APP_NAME = APP_DISPLAY_NAME
APP_HEALTH_NAME = APP_DISPLAY_NAME
APP_HOME_ENV = "GODREAMAI_PLUS_HOME"
APP_HOME_DEFAULT_DIRNAME = ".godreamai-plus"


def release_version_from_env(env: Mapping[str, str] | None = None) -> str:
    source = env or os.environ
    for key in ("GODREAMAI_RELEASE_VERSION", "GITHUB_REF_NAME"):
        value = source.get(key, "").strip()
        if value:
            return value
    return "dev"


def display_release_version(version: str | None = None) -> str:
    resolved = (APP_RELEASE_VERSION if version is None else version).strip()
    if not resolved:
        return "dev"
    match = re.match(r"^v?\d+(?:\.\d+){1,2}", resolved)
    return match.group(0) if match else resolved


APP_RELEASE_VERSION = release_version_from_env()
APP_DISPLAY_RELEASE_VERSION = display_release_version(APP_RELEASE_VERSION)
APP_LAUNCHER_RUNTIME_DIRNAME = "GoDreamAI Plus Launcher"
APP_WINDOWS_LAUNCHER_NAME = APP_LAUNCHER_RUNTIME_DIRNAME
APP_WINDOWS_LAUNCHER_EXE = f"{APP_WINDOWS_LAUNCHER_NAME}.exe"
APP_WINDOWS_ARCHIVE_NAME = "GoDreamAI-Plus-Windows.zip"
APP_MACOS_APP_NAME = "GoDreamAI Plus"
APP_MACOS_BUNDLE_NAME = f"{APP_MACOS_APP_NAME}.app"
APP_MACOS_EXECUTABLE_NAME = APP_MACOS_APP_NAME
APP_MACOS_BUNDLE_IDENTIFIER = "com.wellpigeon.godreamai-plus-lite3-launcher"
APP_MACOS_ARCHIVE_NAME = "GoDreamAI-Plus-macOS.zip"
APP_RUNTIME_COMMON_DIRNAME = "common"
APP_RUNTIME_WINDOWS_TARGET = "windows-x64"
APP_RUNTIME_MACOS_ARM64_TARGET = "macos-arm64"
APP_RUNTIME_MACOS_X86_64_TARGET = "macos-x86_64"
APP_RUNTIME_MACOS_TARGETS = (
    APP_RUNTIME_MACOS_ARM64_TARGET,
    APP_RUNTIME_MACOS_X86_64_TARGET,
)
APP_RELEASE_PACKAGE_NAME = "godreamai-plus-web-lite3-release"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8766
THEME_LIGHT = "light"
THEME_HIGH_CONTRAST = "high_contrast"
THEME_UTOPIA_AURORA = "utopia_aurora"
THEME_RETRO_STARSHIP = "retro_starship"
THEME_SOLAR_DUNE = "solar_dune"
THEME_DEEP_OCEAN = "deep_ocean"
THEME_MOONLIGHT_STUDIO = "moonlight_studio"
THEME_CANDY_GLASS = "candy_glass"
THEME_GRAPHITE_PRO = "graphite_pro"
THEME_DOPAMINE_POP = "dopamine_pop"
THEME_SKETCH_LINE = "sketch_line"
THEME_MONO_PIXEL = "mono_pixel"
RECORD_CARD_SIZE_SMALL = "small"
RECORD_CARD_SIZE_MEDIUM = "medium"
RECORD_CARD_SIZE_LARGE = "large"

IMAGE_KIND = "image"
VIDEO_KIND = "video"

JOB_STATUS_PENDING = "pending"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_EXPIRED = "expired"
JOB_STATUS_CANCEL_REQUESTED = "cancel_requested"
JOB_STATUS_CANCELLED = "cancelled"

JOB_TERMINAL_STATUSES = {
    JOB_STATUS_SUCCEEDED,
    JOB_STATUS_FAILED,
    JOB_STATUS_EXPIRED,
    JOB_STATUS_CANCELLED,
}

SEEDREAM_IMAGE_MODE_LABELS = {
    "text_only": "文生图",
    "base_only": "基础图",
    "reference_only": "参考图",
    "multi_image": "多图融合",
}
KLING_IMAGE_MODE_LABELS = {
    "text_only": "文生图",
    "reference_only": "图生图",
}
IMAGE_MODE_LABELS = {
    **SEEDREAM_IMAGE_MODE_LABELS,
    **KLING_IMAGE_MODE_LABELS,
}
IMAGE_STATS_MODE_LABELS = IMAGE_MODE_LABELS


def _option(value: str, label: str | None = None) -> dict[str, str]:
    return {"value": value, "label": label or value}


def _duplicate_options(options: list[dict[str, str]]) -> list[dict[str, str]]:
    return [dict(item) for item in options]


def _repeat_size_options(ratios: list[str], options: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    return {ratio: _duplicate_options(options) for ratio in ratios}


SEEDREAM_IMAGE_MODES = list(SEEDREAM_IMAGE_MODE_LABELS.keys())
KLING_IMAGE_MODES = list(KLING_IMAGE_MODE_LABELS.keys())
DEFAULT_IMAGE_MODEL_VARIANT = "seedream_v5_0"

SEEDREAM_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"]
KLING_IMAGE_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]
KLING_IMAGE_OMNI_ASPECT_RATIOS = [*KLING_IMAGE_ASPECT_RATIOS, "auto"]
SEEDREAM_5_SIZE_OPTIONS = [_option("2K"), _option("3K"), _option("4K")]
SEEDREAM_4_5_SIZE_OPTIONS = [_option("2K"), _option("4K")]
KLING_IMAGE_3_SIZE_OPTIONS = [_option("1k", "1K"), _option("2k", "2K")]
KLING_IMAGE_3_OMNI_SIZE_OPTIONS = [_option("1k", "1K"), _option("2k", "2K"), _option("4k", "4K")]
SEEDREAM_MAX_INPUT_IMAGES = 14
SEEDREAM_MAX_TOTAL_IMAGES = 15
SEEDREAM_MIN_TOTAL_PIXELS = 2560 * 1440
SEEDREAM_MAX_TOTAL_PIXELS = 4096 * 4096
SEEDREAM_MIN_EDGE = 15
SEEDREAM_MAX_ASPECT_RATIO = 16

DOMESTIC_DOC_LINKS = {
    "guide": "https://www.volcengine.com/docs/82379/2291680?lang=zh",
    "api": "https://www.volcengine.com/docs/82379/1520757?lang=zh",
    "seedance_guide": "https://www.volcengine.com/docs/82379/2291680?lang=zh",
    "seedance_api": "https://www.volcengine.com/docs/82379/1520757?lang=zh",
    "seedream_guide": "https://www.volcengine.com/docs/82379/1824121?lang=zh",
    "seedream_api": "https://www.volcengine.com/docs/82379/1541523?lang=zh",
    "billing": "https://www.volcengine.com/docs/82379/1544106?lang=zh#02affcb8",
    "trusted_assets": "https://www.volcengine.com/docs/82379/2223965?lang=zh",
}

IMAGE_PRICING_HINT = {
    "title": "国内版计费说明",
    "description": "当前仅展示官方计费维度说明，不做费用试算。具体价格请以火山方舟国内文档为准。",
    "dimensions": ["模型", "尺寸", "画幅比例", "数量"],
    "links": [
        {"label": "Seedream 教程", "url": DOMESTIC_DOC_LINKS["seedream_guide"]},
        {"label": "Seedream API 接入", "url": DOMESTIC_DOC_LINKS["seedream_api"]},
        {"label": "国内计费文档", "url": DOMESTIC_DOC_LINKS["billing"]},
    ],
}

VIDEO_PRICING_HINT = {
    "title": "国内版计费说明",
    "description": "当前仅展示官方计费维度说明，不做费用试算。具体价格请以火山方舟国内文档为准。",
    "dimensions": ["模型", "分辨率", "时长", "是否带音频", "可信素材"],
    "links": [
        {"label": "Seedance 教程", "url": DOMESTIC_DOC_LINKS["seedance_guide"]},
        {"label": "Seedance API 接入", "url": DOMESTIC_DOC_LINKS["seedance_api"]},
        {"label": "国内计费文档", "url": DOMESTIC_DOC_LINKS["billing"]},
        {"label": "虚拟人像库", "url": DOMESTIC_DOC_LINKS["trusted_assets"]},
    ],
}

VIDEO_SCENES = {
    "text_only": "文生视频",
    "first_frame": "首帧",
    "first_last": "首尾帧",
    "multimodal_reference": "参考素材",
}
SEEDANCE_VIDEO_SCENE_LABELS = {
    "text_only": "文生视频",
    "first_frame": "首帧图生视频",
    "first_last": "首尾帧图生视频",
    "multimodal_reference": "多模态参考生视频",
}
KLING_VIDEO_SCENE_LABELS = {
    "text_only": "文生视频",
    "first_frame": "图生视频",
    "first_last": "图生视频（首帧+尾帧）",
}

IMAGE_MODELS = {
    "kling_image_v3": {
        "label": "Kling Image 3.0",
        "provider": "kling",
        "api_model_id": "kling-v3",
        "supported_modes": KLING_IMAGE_MODES,
        "mode_labels": KLING_IMAGE_MODE_LABELS,
        "aspect_ratios": KLING_IMAGE_ASPECT_RATIOS,
        "default_aspect_ratio": "16:9",
        "default_size": "2k",
        "size_options": KLING_IMAGE_3_SIZE_OPTIONS,
        "size_options_by_ratio": _repeat_size_options(KLING_IMAGE_ASPECT_RATIOS, KLING_IMAGE_3_SIZE_OPTIONS),
        "supports_web_search": False,
        "supports_output_format": False,
        "supports_sequential_generation": False,
        "max_input_images": 1,
        "max_count": 9,
        "default_output_format": "jpeg",
        "output_formats": [
            _option("jpeg", "JPEG"),
        ],
    },
    "kling_image_v3_omni": {
        "label": "Kling Image 3.0 Omni",
        "provider": "kling",
        "api_model_id": "kling-v3-omni",
        "supported_modes": KLING_IMAGE_MODES,
        "mode_labels": KLING_IMAGE_MODE_LABELS,
        "aspect_ratios": KLING_IMAGE_OMNI_ASPECT_RATIOS,
        "default_aspect_ratio": "auto",
        "default_size": "2k",
        "size_options": KLING_IMAGE_3_OMNI_SIZE_OPTIONS,
        "size_options_by_ratio": _repeat_size_options(KLING_IMAGE_OMNI_ASPECT_RATIOS, KLING_IMAGE_3_OMNI_SIZE_OPTIONS),
        "supports_web_search": False,
        "supports_output_format": False,
        "supports_sequential_generation": False,
        "max_input_images": 10,
        "max_count": 9,
        "default_output_format": "jpeg",
        "output_formats": [
            _option("jpeg", "JPEG"),
        ],
    },
    "seedream_v5_0": {
        "label": "Seedream 5.0 Lite",
        "provider": "volcengine",
        "api_model_id": "doubao-seedream-5-0-260128",
        "supported_modes": SEEDREAM_IMAGE_MODES,
        "mode_labels": SEEDREAM_IMAGE_MODE_LABELS,
        "aspect_ratios": SEEDREAM_ASPECT_RATIOS,
        "default_aspect_ratio": "1:1",
        "default_size": "3K",
        "size_options": SEEDREAM_5_SIZE_OPTIONS,
        "size_options_by_ratio": _repeat_size_options(SEEDREAM_ASPECT_RATIOS, SEEDREAM_5_SIZE_OPTIONS),
        "supports_flexible_size": True,
        "min_total_pixels": SEEDREAM_MIN_TOTAL_PIXELS,
        "max_total_pixels": SEEDREAM_MAX_TOTAL_PIXELS,
        "min_edge": SEEDREAM_MIN_EDGE,
        "max_aspect_ratio": SEEDREAM_MAX_ASPECT_RATIO,
        "max_input_images": SEEDREAM_MAX_INPUT_IMAGES,
        "max_total_images": SEEDREAM_MAX_TOTAL_IMAGES,
        "legacy_size_options_by_ratio": {
            "1:1": [
                _option("2048x2048", "2048 x 2048"),
                _option("3072x3072", "3072 x 3072"),
            ],
            "16:9": [
                _option("2560x1440", "2560 x 1440"),
                _option("4096x2304", "4096 x 2304"),
            ],
            "9:16": [
                _option("1440x2560", "1440 x 2560"),
                _option("2304x4096", "2304 x 4096"),
            ],
            "4:3": [
                _option("2304x1728", "2304 x 1728"),
                _option("3072x2304", "3072 x 2304"),
            ],
            "3:4": [
                _option("1728x2304", "1728 x 2304"),
                _option("2304x3072", "2304 x 3072"),
            ],
        },
        "supports_web_search": True,
        "supports_output_format": True,
        "supports_sequential_generation": True,
        "default_output_format": "jpeg",
        "output_formats": [
            _option("jpeg", "JPEG"),
            _option("png", "PNG"),
        ],
        "pricing_hint": IMAGE_PRICING_HINT,
    },
    "seedream_v4_5": {
        "label": "Seedream 4.5",
        "provider": "volcengine",
        "api_model_id": "doubao-seedream-4-5-251128",
        "supported_modes": SEEDREAM_IMAGE_MODES,
        "mode_labels": SEEDREAM_IMAGE_MODE_LABELS,
        "aspect_ratios": SEEDREAM_ASPECT_RATIOS,
        "default_aspect_ratio": "1:1",
        "default_size": "4K",
        "size_options": SEEDREAM_4_5_SIZE_OPTIONS,
        "size_options_by_ratio": _repeat_size_options(SEEDREAM_ASPECT_RATIOS, SEEDREAM_4_5_SIZE_OPTIONS),
        "legacy_size_options_by_ratio": {
            "1:1": [
                _option("2048x2048", "2048 x 2048"),
                _option("4096x4096", "4096 x 4096"),
            ],
            "16:9": [
                _option("2560x1440", "2560 x 1440"),
                _option("4096x2304", "4096 x 2304"),
            ],
            "9:16": [
                _option("1440x2560", "1440 x 2560"),
                _option("2304x4096", "2304 x 4096"),
            ],
            "4:3": [
                _option("2304x1728", "2304 x 1728"),
                _option("4096x3072", "4096 x 3072"),
            ],
            "3:4": [
                _option("1728x2304", "1728 x 2304"),
                _option("3072x4096", "3072 x 4096"),
            ],
        },
        "supports_web_search": False,
        "supports_output_format": False,
        "supports_sequential_generation": True,
        "supports_flexible_size": True,
        "min_total_pixels": SEEDREAM_MIN_TOTAL_PIXELS,
        "max_total_pixels": SEEDREAM_MAX_TOTAL_PIXELS,
        "min_edge": SEEDREAM_MIN_EDGE,
        "max_aspect_ratio": SEEDREAM_MAX_ASPECT_RATIO,
        "max_input_images": SEEDREAM_MAX_INPUT_IMAGES,
        "max_total_images": SEEDREAM_MAX_TOTAL_IMAGES,
        "default_output_format": "jpeg",
        "output_formats": [
            _option("jpeg", "JPEG"),
        ],
        "pricing_hint": IMAGE_PRICING_HINT,
    },
}

VIDEO_MODELS = {
    "seedance_2_0": {
        "label": "Seedance 2.0",
        "provider": "volcengine",
        "api_model_id": "doubao-seedance-2-0-260128",
        "supported_scenes": list(VIDEO_SCENES.keys()),
        "scene_labels": SEEDANCE_VIDEO_SCENE_LABELS,
        "supported_resolutions": ["480p", "720p", "1080p", "4k"],
        "supported_ratios": ["adaptive", "16:9", "9:16", "4:3", "1:1", "3:4", "21:9"],
        "supported_durations": list(range(4, 16)),
        "supports_audio": True,
        "supports_web_search": True,
        "supports_watermark": True,
        "supports_trusted_assets": True,
        "pricing_hint": VIDEO_PRICING_HINT,
    },
    "seedance_2_0_fast": {
        "label": "Seedance 2.0 Fast",
        "provider": "volcengine",
        "api_model_id": "doubao-seedance-2-0-fast-260128",
        "supported_scenes": list(VIDEO_SCENES.keys()),
        "scene_labels": SEEDANCE_VIDEO_SCENE_LABELS,
        "supported_resolutions": ["480p", "720p"],
        "supported_ratios": ["adaptive", "16:9", "9:16", "4:3", "1:1", "3:4", "21:9"],
        "supported_durations": list(range(4, 16)),
        "supports_audio": True,
        "supports_web_search": True,
        "supports_watermark": True,
        "supports_trusted_assets": True,
        "pricing_hint": VIDEO_PRICING_HINT,
    },
    "kling_3_0_turbo": {
        "label": "Kling 3.0 Turbo",
        "provider": "kling",
        "api_model_id": "kling-3.0-turbo",
        "supported_scenes": ["text_only", "first_frame"],
        "scene_labels": KLING_VIDEO_SCENE_LABELS,
        "supported_resolutions": ["720p", "1080p"],
        "supported_ratios": ["16:9", "9:16", "1:1"],
        "supported_durations": list(range(3, 16)),
        "supports_audio": False,
        "supports_web_search": False,
        "supports_watermark": True,
        "supports_trusted_assets": False,
    },
    "kling_3_0_omni": {
        "label": "Kling 3.0 Omni",
        "provider": "kling",
        "api_model_id": "kling-v3-omni",
        "supported_scenes": ["text_only", "first_frame", "first_last"],
        "scene_labels": KLING_VIDEO_SCENE_LABELS,
        "supported_resolutions": ["720p", "1080p", "4k"],
        "supported_ratios": ["16:9", "9:16", "1:1"],
        "supported_durations": list(range(3, 16)),
        "supports_audio": True,
        "supports_web_search": False,
        "supports_watermark": True,
        "supports_trusted_assets": False,
    },
}

VIDEO_RESOLUTION_SCENE_SUPPORT = {
    "480p": tuple(VIDEO_SCENES.keys()),
    "720p": tuple(VIDEO_SCENES.keys()),
    "1080p": tuple(VIDEO_SCENES.keys()),
    "1024p": ("text_only", "first_frame"),
    "4k": tuple(VIDEO_SCENES.keys()),
}

DEFAULT_VIDEO_RESOLUTION = "720p"

VIDEO_RESOLUTION_OPTIONS = [
    {
        "value": value,
        "label": value,
        "supported_scenes": list(VIDEO_RESOLUTION_SCENE_SUPPORT[value]),
    }
    for value in ("480p", "720p", "1080p", "4k")
]

VIDEO_RATIO_OPTIONS = [
    _option("adaptive", "Adaptive"),
    _option("16:9"),
    _option("9:16"),
    _option("4:3"),
    _option("1:1"),
    _option("3:4"),
    _option("21:9"),
]

VIDEO_DURATION_OPTIONS = [{"value": second, "label": f"{second} 秒"} for second in range(3, 16)]

OUTPUT_FORMAT_OPTIONS = [
    _option("jpeg", "JPEG"),
    _option("png", "PNG"),
    _option("webp", "WebP"),
]

IMAGE_ASPECT_RATIO_OPTIONS = [_option(ratio) for ratio in SEEDREAM_ASPECT_RATIOS]

ASSET_TAG_CATEGORIES = ["角色", "道具", "环境", "其他"]

LIBRARY_SOURCE_MODE_COPY = "copy_import"
LIBRARY_SOURCE_MODE_EXTERNAL = "external_mount"

THEMES = {
    THEME_LIGHT: "linear_light.json",
    THEME_HIGH_CONTRAST: "linear_high_contrast.json",
    THEME_UTOPIA_AURORA: "utopia_aurora.json",
    THEME_RETRO_STARSHIP: "retro_starship.json",
    THEME_SOLAR_DUNE: "solar_dune.json",
    THEME_DEEP_OCEAN: "deep_ocean.json",
    THEME_MOONLIGHT_STUDIO: "moonlight_studio.json",
    THEME_CANDY_GLASS: "candy_glass.json",
    THEME_GRAPHITE_PRO: "graphite_pro.json",
    THEME_DOPAMINE_POP: "dopamine_pop.json",
    THEME_SKETCH_LINE: "sketch_line.json",
    THEME_MONO_PIXEL: "mono_pixel.json",
}

THEME_OPTIONS = [
    _option(THEME_LIGHT, "Mint Circuit"),
    _option(THEME_DOPAMINE_POP, "Dopamine Pop"),
    _option(THEME_SKETCH_LINE, "Sketch Line"),
    _option(THEME_MONO_PIXEL, "Mono Pixel"),
    _option(THEME_UTOPIA_AURORA, "Utopia Aurora"),
    _option(THEME_RETRO_STARSHIP, "Retro Starship"),
    _option(THEME_MOONLIGHT_STUDIO, "Moonlight Studio"),
    _option(THEME_CANDY_GLASS, "Candy Glass"),
    _option(THEME_GRAPHITE_PRO, "Graphite Pro"),
    _option(THEME_HIGH_CONTRAST, "Precision Contrast"),
]

RECORD_CARD_SIZE_OPTIONS = [
    _option(RECORD_CARD_SIZE_LARGE, "大"),
    _option(RECORD_CARD_SIZE_MEDIUM, "中"),
    _option(RECORD_CARD_SIZE_SMALL, "小"),
]

IMAGE_PROVIDER_API_KEY_FIELDS = {
    "volcengine": "volcengine_api_key",
    "kling": "kling_api_key",
}

VIDEO_PROVIDER_API_KEY_FIELDS = {
    "volcengine": "volcengine_api_key",
    "kling": "kling_api_key",
}


def image_model_spec(model_variant: str) -> dict[str, Any]:
    return dict(IMAGE_MODELS[model_variant])


def image_model_provider(model_variant: str) -> str:
    return str(IMAGE_MODELS[model_variant].get("provider") or "volcengine").strip()


def video_model_provider(model_variant: str) -> str:
    return str(VIDEO_MODELS[model_variant].get("provider") or "volcengine").strip()


def video_scene_labels_for_model(model_variant: str) -> dict[str, str]:
    spec = VIDEO_MODELS[model_variant]
    return {
        str(key): str(value)
        for key, value in (spec.get("scene_labels") or {}).items()
        if str(key).strip() and str(value).strip()
    }


def video_scene_label(scene_key: str, *, model_variant: str | None = None, provider: str | None = None) -> str:
    normalized_key = str(scene_key or "").strip()
    if not normalized_key:
        return ""
    if model_variant and model_variant in VIDEO_MODELS:
        return video_scene_labels_for_model(model_variant).get(
            normalized_key,
            VIDEO_SCENES.get(normalized_key, normalized_key),
        )
    normalized_provider = str(provider or "").strip()
    if normalized_provider == "kling":
        return KLING_VIDEO_SCENE_LABELS.get(normalized_key, VIDEO_SCENES.get(normalized_key, normalized_key))
    if normalized_provider == "volcengine":
        return SEEDANCE_VIDEO_SCENE_LABELS.get(normalized_key, VIDEO_SCENES.get(normalized_key, normalized_key))
    return VIDEO_SCENES.get(normalized_key, normalized_key)


def image_mode_labels_for_model(model_variant: str) -> dict[str, str]:
    spec = IMAGE_MODELS[model_variant]
    return {
        str(key): str(value)
        for key, value in (spec.get("mode_labels") or {}).items()
        if str(key).strip() and str(value).strip()
    }


def image_mode_label(mode_key: str, *, model_variant: str | None = None, provider: str | None = None) -> str:
    normalized_key = str(mode_key or "").strip()
    if not normalized_key:
        return ""
    if model_variant and model_variant in IMAGE_MODELS:
        return image_mode_labels_for_model(model_variant).get(normalized_key, normalized_key)
    normalized_provider = str(provider or "").strip()
    if normalized_provider == "kling":
        return KLING_IMAGE_MODE_LABELS.get(normalized_key, normalized_key)
    if normalized_provider == "volcengine":
        return SEEDREAM_IMAGE_MODE_LABELS.get(normalized_key, normalized_key)
    return IMAGE_MODE_LABELS.get(normalized_key, normalized_key)


def image_model_size_options(model_variant: str, aspect_ratio: str | None = None) -> list[dict[str, str]]:
    spec = IMAGE_MODELS[model_variant]
    if spec.get("size_options_by_ratio"):
        ratio = str(aspect_ratio or spec.get("default_aspect_ratio") or "").strip()
        return _duplicate_options(spec["size_options_by_ratio"].get(ratio) or [])
    return _duplicate_options(spec.get("size_options") or [])
