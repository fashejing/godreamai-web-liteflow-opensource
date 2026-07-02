from __future__ import annotations

import re
import math
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator

from web_lite3.constants import (
    DEFAULT_IMAGE_MODEL_VARIANT,
    DEFAULT_VIDEO_RESOLUTION,
    IMAGE_MODELS,
    OUTPUT_FORMAT_OPTIONS,
    RECORD_CARD_SIZE_LARGE,
    RECORD_CARD_SIZE_MEDIUM,
    RECORD_CARD_SIZE_SMALL,
    THEME_CANDY_GLASS,
    THEME_DOPAMINE_POP,
    THEME_GRAPHITE_PRO,
    THEME_HIGH_CONTRAST,
    THEME_LIGHT,
    THEME_MONO_PIXEL,
    THEME_MOONLIGHT_STUDIO,
    THEME_RETRO_STARSHIP,
    THEME_SKETCH_LINE,
    THEME_UTOPIA_AURORA,
    VIDEO_DURATION_OPTIONS,
    VIDEO_MODELS,
    VIDEO_RATIO_OPTIONS,
    VIDEO_RESOLUTION_OPTIONS,
    VIDEO_RESOLUTION_SCENE_SUPPORT,
    VIDEO_SCENES,
    image_mode_label,
    image_model_provider,
    image_model_size_options,
    video_scene_label,
    video_scene_labels_for_model,
    video_model_provider,
)
from web_lite3.network import (
    DEFAULT_PROVIDER_NETWORK_MODES,
    NETWORK_MODE_DIRECT,
    NETWORK_MODE_PROXY,
    normalize_network_mode,
    normalize_proxy_url,
)


ALLOWED_VIDEO_SCENES = set(VIDEO_SCENES.keys())
ALLOWED_OUTPUT_FORMATS = {item["value"] for item in OUTPUT_FORMAT_OPTIONS}
ALLOWED_VIDEO_RATIOS = {item["value"] for item in VIDEO_RATIO_OPTIONS}
ALLOWED_VIDEO_RESOLUTIONS = {item["value"] for item in VIDEO_RESOLUTION_OPTIONS}
ALLOWED_VIDEO_DURATIONS = {int(item["value"]) for item in VIDEO_DURATION_OPTIONS}
ALLOWED_THEME_VALUES = {
    THEME_LIGHT,
    THEME_HIGH_CONTRAST,
    THEME_UTOPIA_AURORA,
    THEME_RETRO_STARSHIP,
    THEME_MOONLIGHT_STUDIO,
    THEME_CANDY_GLASS,
    THEME_GRAPHITE_PRO,
    THEME_DOPAMINE_POP,
    THEME_SKETCH_LINE,
    THEME_MONO_PIXEL,
    "dark",
}
ALLOWED_RECORD_CARD_SIZES = {
    RECORD_CARD_SIZE_SMALL,
    RECORD_CARD_SIZE_MEDIUM,
    RECORD_CARD_SIZE_LARGE,
}
DEFAULT_PROMPT_FONT_SIZE = 16
MIN_PROMPT_FONT_SIZE = 14
MAX_PROMPT_FONT_SIZE = 28
IMAGE_PROVIDER_SORT_ORDER = {
    "google": 0,
    "volcengine": 1,
    "openai": 2,
}
IMAGE_MODEL_SORT_ORDER = {
    "nano_banana_2": 0,
    "nano_banana_pro": 1,
    "nano_banana": 2,
    "seedream_v5_0": 0,
    "seedream_v4_5": 1,
    "gpt_image_2": 0,
}


class SettingsPayload(BaseModel):
    auto_open_browser: bool = True
    prompt_font_size: int = DEFAULT_PROMPT_FONT_SIZE
    record_card_size: str = RECORD_CARD_SIZE_MEDIUM
    theme: str = "light"
    api_network_auto_switch: bool = True
    api_proxy_url: str = ""
    openai_network_mode: str = NETWORK_MODE_PROXY
    google_network_mode: str = NETWORK_MODE_PROXY
    volcengine_network_mode: str = NETWORK_MODE_DIRECT
    storage_dir: str
    volcengine_api_key: str = ""
    google_api_key: str = ""
    openai_api_key: str = ""

    @field_validator("theme")
    @classmethod
    def validate_theme(cls, value: str) -> str:
        normalized = str(value or THEME_LIGHT).strip().lower()
        if normalized not in ALLOWED_THEME_VALUES:
            return THEME_LIGHT
        if normalized == "dark":
            return THEME_HIGH_CONTRAST
        return normalized

    @field_validator("record_card_size")
    @classmethod
    def validate_record_card_size(cls, value: str) -> str:
        normalized = str(value or RECORD_CARD_SIZE_MEDIUM).strip().lower()
        if normalized not in ALLOWED_RECORD_CARD_SIZES:
            return RECORD_CARD_SIZE_MEDIUM
        return normalized

    @field_validator("prompt_font_size", mode="before")
    @classmethod
    def validate_prompt_font_size(cls, value: Any) -> int:
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            return DEFAULT_PROMPT_FONT_SIZE
        return max(MIN_PROMPT_FONT_SIZE, min(MAX_PROMPT_FONT_SIZE, normalized))

    @field_validator("api_proxy_url", mode="before")
    @classmethod
    def validate_api_proxy_url(cls, value: Any) -> str:
        return normalize_proxy_url(value)

    @field_validator("openai_network_mode", "google_network_mode", "volcengine_network_mode", mode="before")
    @classmethod
    def validate_network_mode(cls, value: Any, info) -> str:
        provider = str(info.field_name or "").replace("_network_mode", "")
        return normalize_network_mode(
            value,
            default=DEFAULT_PROVIDER_NETWORK_MODES.get(provider, "system"),
        )


class DeleteHistoryPayload(BaseModel):
    delete_outputs: bool = False


class CanvasStatePayload(BaseModel):
    version: int = 2
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    viewport: dict[str, Any] = Field(default_factory=dict)
    canvas_theme: str = "white"

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: int) -> int:
        return 2 if int(value or 2) < 2 else int(value)

    @field_validator("nodes", "edges")
    @classmethod
    def validate_graph_lists(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [item for item in value if isinstance(item, dict)]

    @field_validator("canvas_theme", mode="before")
    @classmethod
    def validate_canvas_theme(cls, value: Any) -> str:
        normalized = str(value or "white").strip().lower()
        return normalized if normalized in {"white", "black", "contrast"} else "white"


class CanvasRunPayload(BaseModel):
    target_node_id: str = Field(..., min_length=1)
    graph: CanvasStatePayload

    @field_validator("target_node_id")
    @classmethod
    def normalize_target_node_id(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("target_node_id is required")
        return normalized


class CanvasGridCellPayload(BaseModel):
    row: int = Field(..., ge=1, le=25)
    col: int = Field(..., ge=1, le=25)


class CanvasGridSplitPayload(BaseModel):
    source_node_id: str = Field(..., min_length=1)
    graph: CanvasStatePayload
    rows: int = Field(3, ge=1, le=12)
    cols: int = Field(3, ge=1, le=12)
    cells: list[CanvasGridCellPayload] = Field(default_factory=list)

    @field_validator("source_node_id")
    @classmethod
    def normalize_source_node_id(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("source_node_id is required")
        return normalized

    @model_validator(mode="after")
    def validate_cells(self) -> "CanvasGridSplitPayload":
        if not self.cells:
            raise ValueError("请至少选择一个宫格")
        if len(self.cells) > 64:
            raise ValueError("一次最多切分 64 个宫格")
        for cell in self.cells:
            if cell.row > self.rows or cell.col > self.cols:
                raise ValueError("选择的宫格超出当前行列范围")
        return self


class CanvasResultToLibraryPayload(BaseModel):
    history_id: str = Field(..., min_length=1)
    artifact_index: int = Field(0, ge=0, le=999)
    tag_category: str = "画布库"
    display_name: str | None = None

    @field_validator("history_id")
    @classmethod
    def normalize_history_id(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("history_id is required")
        return normalized

    @field_validator("tag_category", mode="before")
    @classmethod
    def normalize_tag_category(cls, value: Any) -> str:
        return str(value or "画布库").strip() or "画布库"

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_display_name(cls, value: Any) -> str | None:
        normalized = str(value or "").strip()
        return normalized or None


class AssetAnnotationModel(BaseModel):
    asset_id: str
    tag_category: str
    tag_sequence: int = Field(..., ge=1)
    mention_name: Optional[str] = None

    @field_validator("tag_category")
    @classmethod
    def validate_tag_category(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("tag category is required")
        return normalized


def _is_valid_flexible_image_size(value: str, spec: dict[str, Any]) -> bool:
    if not bool(spec.get("supports_flexible_size")):
        return False
    normalized = str(value or "").strip().lower()
    if normalized == "auto":
        return True
    match = re.fullmatch(r"(\d+)x(\d+)", normalized)
    if not match:
        return False
    width = int(match.group(1))
    height = int(match.group(2))
    dimension_multiple = int(spec.get("dimension_multiple") or 1)
    max_edge = int(spec.get("max_edge") or 0)
    min_total_pixels = int(spec.get("min_total_pixels") or 0)
    max_total_pixels = int(spec.get("max_total_pixels") or 0)
    max_aspect_ratio = float(spec.get("max_aspect_ratio") or 0)
    min_edge = int(spec.get("min_edge") or 0)
    total_pixels = width * height
    if min_edge and (width < min_edge or height < min_edge):
        return False
    if dimension_multiple > 1 and (width % dimension_multiple or height % dimension_multiple):
        return False
    if max_edge and max(width, height) > max_edge:
        return False
    if min_total_pixels and total_pixels < min_total_pixels:
        return False
    if max_total_pixels and total_pixels > max_total_pixels:
        return False
    if max_aspect_ratio and (max(width, height) / max(1, min(width, height))) > max_aspect_ratio:
        return False
    return True


class ImageGenerateRequest(BaseModel):
    model_variant: str
    prompt: str = Field(..., min_length=1)
    aspect_ratio: str = "1:1"
    size: str
    count: int = Field(1, ge=1, le=15)
    sequential_mode: bool = False
    output_format: str = "jpeg"
    quality: str = "auto"
    background: str = "auto"
    moderation: str = "auto"
    output_compression: int = Field(100, ge=0, le=100)
    enable_web_search: bool = False
    input_asset_id: Optional[str] = None
    reference_asset_ids: list[str] = Field(default_factory=list)
    asset_annotations: list[AssetAnnotationModel] = Field(default_factory=list)

    @field_validator("model_variant")
    @classmethod
    def validate_model_variant(cls, value: str) -> str:
        if value not in IMAGE_MODELS:
            raise ValueError("unsupported image model")
        return value

    @field_validator("size", "aspect_ratio")
    @classmethod
    def validate_required_text_field(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("field is required")
        return normalized

    @field_validator("output_format")
    @classmethod
    def validate_output_format(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in ALLOWED_OUTPUT_FORMATS:
            raise ValueError("unsupported output format")
        return normalized

    @field_validator("quality", "background", "moderation")
    @classmethod
    def normalize_optional_image_option(cls, value: str) -> str:
        return str(value or "auto").strip().lower() or "auto"

    @model_validator(mode="after")
    def validate_model_capabilities(self) -> "ImageGenerateRequest":
        spec = IMAGE_MODELS[self.model_variant]
        supported_ratios = {str(item).strip() for item in spec.get("aspect_ratios") or []}
        if self.aspect_ratio not in supported_ratios:
            raise ValueError("unsupported aspect ratio for model")

        allowed_sizes = {
            item["value"]
            for item in image_model_size_options(self.model_variant, self.aspect_ratio)
        }
        legacy_size_options = spec.get("legacy_size_options_by_ratio") or {}
        allowed_legacy_sizes = {
            item["value"]
            for options in [legacy_size_options.get(self.aspect_ratio) or []]
            for item in options
        }
        if (
            self.size not in allowed_sizes
            and self.size not in allowed_legacy_sizes
            and not _is_valid_flexible_image_size(self.size, spec)
        ):
            raise ValueError("unsupported size for model")

        if self.sequential_mode and not bool(spec.get("supports_sequential_generation")):
            raise ValueError("sequential mode is not supported for model")
        if self.enable_web_search and not bool(spec.get("supports_web_search")):
            raise ValueError("web search is not supported for model")
        allowed_output_formats = {
            item["value"]
            for item in (spec.get("output_formats") or OUTPUT_FORMAT_OPTIONS)
        }
        if not bool(spec.get("supports_output_format")) and self.output_format != spec.get("default_output_format", "jpeg"):
            raise ValueError("output format is not supported for model")
        if self.output_format not in allowed_output_formats:
            raise ValueError("unsupported output format for model")
        allowed_quality = {
            item["value"]
            for item in (spec.get("quality_options") or [{"value": spec.get("default_quality", "auto")}])
        }
        if self.quality not in allowed_quality:
            raise ValueError("unsupported quality for model")
        if not bool(spec.get("supports_quality")) and self.quality != spec.get("default_quality", "auto"):
            raise ValueError("quality is not supported for model")
        allowed_backgrounds = {
            item["value"]
            for item in (spec.get("background_options") or [{"value": spec.get("default_background", "auto")}])
        }
        if self.background not in allowed_backgrounds:
            raise ValueError("unsupported background for model")
        if not bool(spec.get("supports_background")) and self.background != spec.get("default_background", "auto"):
            raise ValueError("background is not supported for model")
        if bool(spec.get("supports_moderation")) and self.moderation == "auto":
            self.moderation = str(spec.get("default_moderation") or "auto")
        allowed_moderation = {
            item["value"]
            for item in (spec.get("moderation_options") or [{"value": spec.get("default_moderation", "auto")}])
        }
        if self.moderation not in allowed_moderation:
            raise ValueError("unsupported moderation for model")
        if not bool(spec.get("supports_moderation")) and self.moderation != spec.get("default_moderation", "auto"):
            raise ValueError("moderation is not supported for model")
        if not bool(spec.get("supports_output_compression")) and self.output_compression != int(spec.get("default_output_compression", 100)):
            raise ValueError("output compression is not supported for model")
        provider = image_model_provider(self.model_variant)
        if provider == "google":
            total_image_inputs = (1 if self.input_asset_id else 0) + len(self.reference_asset_ids)
            max_input_images = int(spec.get("max_input_images") or 14)
            if total_image_inputs > max_input_images:
                raise ValueError(f"{spec.get('label', 'Google image model')} supports up to {max_input_images} input images")
        if provider == "volcengine":
            total_image_inputs = (1 if self.input_asset_id else 0) + len(self.reference_asset_ids)
            max_input_images = int(spec.get("max_input_images") or 14)
            max_total_images = int(spec.get("max_total_images") or 15)
            if total_image_inputs > max_input_images:
                raise ValueError(f"{spec.get('label', 'Seedream')} supports up to {max_input_images} input images")
            output_images = self.count if self.sequential_mode else 1
            if total_image_inputs + output_images > max_total_images:
                raise ValueError(f"{spec.get('label', 'Seedream')} input and output images must not exceed {max_total_images}")
        if provider == "openai":
            total_image_inputs = (1 if self.input_asset_id else 0) + len(self.reference_asset_ids)
            max_input_images = int(spec.get("max_input_images") or 16)
            if total_image_inputs > max_input_images:
                raise ValueError(f"OpenAI image models support up to {max_input_images} input images")
        return self


class VideoGenerateRequest(BaseModel):
    model_variant: str
    prompt: str = ""
    scene_type: str = "text_only"
    resolution_grade: str = DEFAULT_VIDEO_RESOLUTION
    ratio: str = "adaptive"
    duration: int = 5
    count: int = Field(1, ge=1, le=15)
    seed: int = -1
    generate_audio: bool = True
    watermark: bool = False
    enable_web_search: bool = False
    first_frame_asset_id: Optional[str] = None
    last_frame_asset_id: Optional[str] = None
    reference_image_asset_ids: list[str] = Field(default_factory=list)
    trusted_asset_uris: list[str] = Field(default_factory=list)
    reference_video_urls: list[str] = Field(default_factory=list)
    reference_audio_urls: list[str] = Field(default_factory=list)
    asset_annotations: list[AssetAnnotationModel] = Field(default_factory=list)

    @field_validator("model_variant")
    @classmethod
    def validate_model_variant(cls, value: str) -> str:
        if value not in VIDEO_MODELS:
            raise ValueError("unsupported video model")
        return value

    @field_validator("scene_type")
    @classmethod
    def validate_scene_type(cls, value: str) -> str:
        if value not in ALLOWED_VIDEO_SCENES:
            raise ValueError("unsupported scene type")
        return value

    @field_validator("resolution_grade")
    @classmethod
    def validate_resolution(cls, value: str) -> str:
        if value not in ALLOWED_VIDEO_RESOLUTIONS:
            raise ValueError("unsupported resolution")
        return value

    @field_validator("ratio")
    @classmethod
    def validate_ratio(cls, value: str) -> str:
        if value not in ALLOWED_VIDEO_RATIOS:
            raise ValueError("unsupported ratio")
        return value

    @field_validator("duration")
    @classmethod
    def validate_duration(cls, value: int) -> int:
        if value not in ALLOWED_VIDEO_DURATIONS:
            raise ValueError("unsupported duration")
        return value

    @field_validator("reference_video_urls", "reference_audio_urls")
    @classmethod
    def normalize_urls(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if str(item).strip()]

    @field_validator("trusted_asset_uris")
    @classmethod
    def normalize_trusted_asset_uris(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value if isinstance(value, list) else []:
            raw = str(item or "").strip()
            if not raw:
                continue
            if "://" not in raw:
                raw = f"asset://{raw}"
            if raw in seen:
                continue
            seen.add(raw)
            normalized.append(raw)
        return normalized

    @model_validator(mode="after")
    def validate_scene_requirements(self) -> "VideoGenerateRequest":
        prompt = self.prompt.strip()
        spec = VIDEO_MODELS[self.model_variant]
        provider = video_model_provider(self.model_variant)
        supported_model_scenes = spec.get("supported_scenes") or sorted(ALLOWED_VIDEO_SCENES)
        if self.scene_type not in supported_model_scenes:
            raise ValueError(f"{self.scene_type} is not supported for {self.model_variant}")
        supported_model_resolutions = spec.get("supported_resolutions") or sorted(ALLOWED_VIDEO_RESOLUTIONS)
        if self.resolution_grade not in supported_model_resolutions:
            raise ValueError(f"{self.resolution_grade} is not supported for {self.model_variant}")
        supported_model_ratios = spec.get("supported_ratios") or sorted(ALLOWED_VIDEO_RATIOS)
        if self.ratio not in supported_model_ratios:
            raise ValueError(f"{self.ratio} is not supported for {self.model_variant}")
        supported_model_durations = {
            int(item)
            for item in (spec.get("supported_durations") or sorted(ALLOWED_VIDEO_DURATIONS))
        }
        if self.duration not in supported_model_durations:
            raise ValueError(f"{self.duration} seconds is not supported for {self.model_variant}")
        if self.enable_web_search:
            if not bool(spec.get("supports_web_search")):
                raise ValueError("web search is not supported for model")
            if self.scene_type != "text_only":
                raise ValueError("video web search is only supported for text_only")
        supported_scenes = VIDEO_RESOLUTION_SCENE_SUPPORT.get(self.resolution_grade, ())
        if supported_scenes and self.scene_type not in supported_scenes:
            raise ValueError(f"{self.resolution_grade} is not supported for {self.scene_type}")
        if self.scene_type == "text_only" and not prompt:
            raise ValueError("prompt is required for text_only")
        if self.scene_type == "first_frame" and not self.first_frame_asset_id:
                raise ValueError("first_frame_asset_id is required for first_frame")
        if self.scene_type == "first_last":
            if not self.first_frame_asset_id or not self.last_frame_asset_id:
                raise ValueError("first_frame_asset_id and last_frame_asset_id are required for first_last")
        if self.scene_type == "multimodal_reference":
            total_reference_images = len(self.reference_image_asset_ids) + len(self.trusted_asset_uris)
            max_reference_images = int(spec.get("max_reference_images") or 9)
            if provider == "google" and total_reference_images > max_reference_images:
                raise ValueError(f"Veo supports up to {max_reference_images} reference images")
            if provider in {"google", "openai"} and self.trusted_asset_uris:
                raise ValueError("trusted assets are only supported for Seedance")
            if provider in {"google", "openai"} and self.reference_video_urls:
                raise ValueError("reference videos are only supported for Seedance")
            if provider in {"google", "openai"} and self.reference_audio_urls:
                raise ValueError("reference audios are only supported for Seedance")
            if total_reference_images > 9:
                raise ValueError("Seedance supports up to 9 reference images")
            if len(self.reference_video_urls) > 3:
                raise ValueError("Seedance supports up to 3 reference videos")
            if len(self.reference_audio_urls) > 3:
                raise ValueError("Seedance supports up to 3 reference audios")
            if self.reference_audio_urls and not (
                self.reference_image_asset_ids
                or self.trusted_asset_uris
                or self.reference_video_urls
            ):
                raise ValueError("reference_audio cannot be used without image or video references")
            if not (
                prompt
                or self.reference_image_asset_ids
                or self.trusted_asset_uris
                or self.reference_video_urls
                or self.reference_audio_urls
            ):
                raise ValueError("multimodal_reference needs prompt or references")
        if provider == "google":
            if self.resolution_grade in {"1080p", "4k"} and self.duration != 8:
                raise ValueError("Veo 1080p and 4k generation require 8 seconds")
            if self.scene_type in {"first_last", "multimodal_reference"} and self.duration != 8:
                raise ValueError("Veo first/last frame and reference-image generation require 8 seconds")
        return self


class LibrarySourceConnectPayload(BaseModel):
    source_dir: str = Field(..., min_length=1)


def image_ui_schema() -> dict[str, Any]:
    union_modes = []
    seen_mode_values: set[str] = set()
    image_model_items = sorted(
        IMAGE_MODELS.items(),
        key=lambda item: (
            IMAGE_PROVIDER_SORT_ORDER.get(str(item[1].get("provider") or ""), 99),
            IMAGE_MODEL_SORT_ORDER.get(item[0], 50),
            str(item[1].get("label") or item[0]),
        ),
    )
    for variant, spec in IMAGE_MODELS.items():
        for mode_value in spec.get("supported_modes") or []:
            if mode_value in seen_mode_values:
                continue
            seen_mode_values.add(mode_value)
            union_modes.append(
                {
                    "value": mode_value,
                    "label": image_mode_label(mode_value, model_variant=variant),
                }
            )
    return {
        "default_model": DEFAULT_IMAGE_MODEL_VARIANT,
        "models": [
            {
                "value": variant,
                "label": spec["label"],
                "provider": spec["provider"],
                "default_mode": (spec.get("supported_modes") or ["text_only"])[0],
                "modes": [
                    {
                        "value": mode_value,
                        "label": image_mode_label(mode_value, model_variant=variant),
                    }
                    for mode_value in spec.get("supported_modes") or []
                ],
                "aspect_ratios": [
                    {"value": ratio, "label": ratio}
                    for ratio in spec["aspect_ratios"]
                ],
                "default_aspect_ratio": spec.get("default_aspect_ratio") or (spec["aspect_ratios"][0] if spec["aspect_ratios"] else ""),
                "default_size": spec.get("default_size", ""),
                "size_options": spec.get("size_options") or [],
                "size_options_by_ratio": spec.get("size_options_by_ratio") or {},
                "supports_web_search": spec["supports_web_search"],
                "supports_output_format": spec["supports_output_format"],
                "supports_sequential_generation": spec.get("supports_sequential_generation", False),
                "default_output_format": spec.get("default_output_format", "jpeg"),
                "output_formats": spec.get("output_formats") or OUTPUT_FORMAT_OPTIONS,
                "supports_quality": bool(spec.get("supports_quality", False)),
                "quality_options": spec.get("quality_options") or [],
                "default_quality": spec.get("default_quality", "auto"),
                "supports_background": bool(spec.get("supports_background", False)),
                "background_options": spec.get("background_options") or [],
                "default_background": spec.get("default_background", "auto"),
                "supports_output_compression": bool(spec.get("supports_output_compression", False)),
                "default_output_compression": int(spec.get("default_output_compression", 100)),
                "supports_moderation": bool(spec.get("supports_moderation", False)),
                "moderation_options": spec.get("moderation_options") or [],
                "default_moderation": spec.get("default_moderation", "auto"),
                "supports_flexible_size": bool(spec.get("supports_flexible_size", False)),
                "max_input_images": int(spec.get("max_input_images", 14 if spec.get("provider") == "google" else 16)),
                "pricing_hint": spec.get("pricing_hint") or {},
            }
            for variant, spec in image_model_items
        ],
        "modes": union_modes,
        "output_formats": OUTPUT_FORMAT_OPTIONS,
    }


def video_ui_schema() -> dict[str, Any]:
    return {
        "models": [
            {
                "value": variant,
                "label": spec["label"],
                "provider": spec.get("provider") or "volcengine",
                "supported_scenes": list(spec.get("supported_scenes") or VIDEO_SCENES.keys()),
                "scene_labels": video_scene_labels_for_model(variant),
                "scenes": [
                    {
                        "value": scene_key,
                        "label": video_scene_label(scene_key, model_variant=variant),
                    }
                    for scene_key in list(spec.get("supported_scenes") or VIDEO_SCENES.keys())
                ],
                "supported_resolutions": list(spec.get("supported_resolutions") or ALLOWED_VIDEO_RESOLUTIONS),
                "supported_ratios": list(spec.get("supported_ratios") or ALLOWED_VIDEO_RATIOS),
                "supported_durations": list(spec.get("supported_durations") or ALLOWED_VIDEO_DURATIONS),
                "supports_audio": bool(spec.get("supports_audio", True)),
                "supports_web_search": bool(spec.get("supports_web_search", False)),
                "supports_watermark": bool(spec.get("supports_watermark", False)),
                "supports_trusted_assets": bool(spec.get("supports_trusted_assets", False)),
                "pricing_hint": spec.get("pricing_hint") or {},
            }
            for variant, spec in VIDEO_MODELS.items()
        ],
        "scenes": [{"value": key, "label": value} for key, value in VIDEO_SCENES.items()],
        "resolutions": VIDEO_RESOLUTION_OPTIONS,
        "ratios": VIDEO_RATIO_OPTIONS,
        "durations": VIDEO_DURATION_OPTIONS,
        "supports_trusted_assets": any(bool(spec.get("supports_trusted_assets")) for spec in VIDEO_MODELS.values()),
        "pricing_hint": next((spec.get("pricing_hint") for spec in VIDEO_MODELS.values() if spec.get("pricing_hint")), {}),
    }
