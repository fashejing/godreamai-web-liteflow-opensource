from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from web_lite3.constants import (
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
)
from web_lite3.data_paths import AppPaths, ensure_storage_paths
from web_lite3.network import (
    DEFAULT_PROVIDER_NETWORK_MODES,
    NETWORK_MODE_DIRECT,
    NETWORK_MODE_PROXY,
    normalize_network_mode,
    normalize_proxy_url,
)

DEFAULT_PROMPT_FONT_SIZE = 16
MIN_PROMPT_FONT_SIZE = 14
MAX_PROMPT_FONT_SIZE = 28


def _deep_merge(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


@dataclass
class AppSettings:
    auto_open_browser: bool = True
    prompt_font_size: int = DEFAULT_PROMPT_FONT_SIZE
    record_card_size: str = "medium"
    theme: str = "light"
    api_network_auto_switch: bool = True
    api_proxy_url: str = ""
    openai_network_mode: str = NETWORK_MODE_PROXY
    google_network_mode: str = NETWORK_MODE_PROXY
    volcengine_network_mode: str = NETWORK_MODE_DIRECT
    storage_dir: str = ""
    volcengine_api_key: str = ""
    volcengine_api_key_history: list[str] | None = None
    google_api_key: str = ""
    google_api_key_history: list[str] | None = None
    openai_api_key: str = ""
    openai_api_key_history: list[str] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "auto_open_browser": self.auto_open_browser,
            "prompt_font_size": self.prompt_font_size,
            "record_card_size": self.record_card_size,
            "theme": self.theme,
            "api_network_auto_switch": self.api_network_auto_switch,
            "api_proxy_url": self.api_proxy_url,
            "openai_network_mode": self.openai_network_mode,
            "google_network_mode": self.google_network_mode,
            "volcengine_network_mode": self.volcengine_network_mode,
            "storage_dir": self.storage_dir,
            "volcengine_api_key": self.volcengine_api_key,
            "volcengine_api_key_history": list(self.volcengine_api_key_history or []),
            "google_api_key": self.google_api_key,
            "google_api_key_history": list(self.google_api_key_history or []),
            "openai_api_key": self.openai_api_key,
            "openai_api_key_history": list(self.openai_api_key_history or []),
        }


class SettingsStore:
    def __init__(self, paths: AppPaths) -> None:
        self.paths = paths
        self._lock = threading.Lock()
        self._cache: AppSettings | None = None
        self._cache_mtime_ns: int | None = None

    @staticmethod
    def _normalize_theme(value: Any) -> str:
        theme = str(value or THEME_LIGHT).strip().lower()
        if theme == "dark":
            return THEME_HIGH_CONTRAST
        if theme in {
            THEME_HIGH_CONTRAST,
            THEME_UTOPIA_AURORA,
            THEME_RETRO_STARSHIP,
            THEME_MOONLIGHT_STUDIO,
            THEME_CANDY_GLASS,
            THEME_GRAPHITE_PRO,
            THEME_DOPAMINE_POP,
            THEME_SKETCH_LINE,
            THEME_MONO_PIXEL,
        }:
            return theme
        return THEME_LIGHT

    @staticmethod
    def _normalize_record_card_size(value: Any) -> str:
        normalized = str(value or RECORD_CARD_SIZE_MEDIUM).strip().lower()
        if normalized not in {
            RECORD_CARD_SIZE_SMALL,
            RECORD_CARD_SIZE_MEDIUM,
            RECORD_CARD_SIZE_LARGE,
        }:
            return RECORD_CARD_SIZE_MEDIUM
        return normalized

    @staticmethod
    def _normalize_prompt_font_size(value: Any) -> int:
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            return DEFAULT_PROMPT_FONT_SIZE
        return max(MIN_PROMPT_FONT_SIZE, min(MAX_PROMPT_FONT_SIZE, normalized))

    @staticmethod
    def _normalize_provider_network_mode(provider: str, value: Any) -> str:
        return normalize_network_mode(
            value,
            default=DEFAULT_PROVIDER_NETWORK_MODES.get(provider, "system"),
        )

    def default_settings(self) -> AppSettings:
        return AppSettings(
            storage_dir=str(self.paths.storage_dir),
            prompt_font_size=DEFAULT_PROMPT_FONT_SIZE,
            api_network_auto_switch=True,
            api_proxy_url="",
            openai_network_mode=NETWORK_MODE_PROXY,
            google_network_mode=NETWORK_MODE_PROXY,
            volcengine_network_mode=NETWORK_MODE_DIRECT,
            volcengine_api_key_history=[],
            google_api_key_history=[],
            openai_api_key_history=[],
        )

    @staticmethod
    def _clone_settings(settings: AppSettings) -> AppSettings:
        return AppSettings(**settings.to_dict())

    @staticmethod
    def _normalize_path(value: Any) -> str:
        raw_value = str(value or "").strip()
        if not raw_value:
            return ""
        return str(Path(raw_value).expanduser().resolve())

    @staticmethod
    def _normalize_api_key_history(value: Any) -> list[str]:
        items = value if isinstance(value, list) else []
        history: list[str] = []
        seen: set[str] = set()
        for item in items:
            normalized = str(item or "").strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            history.append(normalized)
        return history[:10]

    def _stat_mtime_ns(self) -> int | None:
        try:
            return self.paths.settings_file.stat().st_mtime_ns
        except FileNotFoundError:
            return None

    def _build_settings(self, raw: dict[str, Any] | None = None) -> AppSettings:
        defaults = self.default_settings()
        merged = _deep_merge(defaults.to_dict(), raw if isinstance(raw, dict) else {})
        return AppSettings(
            auto_open_browser=bool(merged.get("auto_open_browser", True)),
            prompt_font_size=self._normalize_prompt_font_size(merged.get("prompt_font_size")),
            record_card_size=self._normalize_record_card_size(merged.get("record_card_size")),
            theme=self._normalize_theme(merged.get("theme")),
            api_network_auto_switch=bool(merged.get("api_network_auto_switch", True)),
            api_proxy_url=normalize_proxy_url(merged.get("api_proxy_url")),
            openai_network_mode=self._normalize_provider_network_mode("openai", merged.get("openai_network_mode")),
            google_network_mode=self._normalize_provider_network_mode("google", merged.get("google_network_mode")),
            volcengine_network_mode=self._normalize_provider_network_mode("volcengine", merged.get("volcengine_network_mode")),
            storage_dir=str(merged.get("storage_dir") or self.paths.storage_dir),
            volcengine_api_key=str(merged.get("volcengine_api_key") or ""),
            volcengine_api_key_history=self._normalize_api_key_history(merged.get("volcengine_api_key_history")),
            google_api_key=str(merged.get("google_api_key") or ""),
            google_api_key_history=self._normalize_api_key_history(merged.get("google_api_key_history")),
            openai_api_key=str(merged.get("openai_api_key") or ""),
            openai_api_key_history=self._normalize_api_key_history(merged.get("openai_api_key_history")),
        )

    def _write_settings(self, merged: dict[str, Any]) -> AppSettings:
        self.paths.settings_file.write_text(
            json.dumps(merged, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        settings = self._build_settings(merged)
        ensure_storage_paths(settings.storage_dir)
        self._cache = settings
        self._cache_mtime_ns = self._stat_mtime_ns()
        return self._clone_settings(settings)

    def _load_unlocked(self) -> AppSettings:
        current_mtime_ns = self._stat_mtime_ns()
        if self._cache is not None and current_mtime_ns == self._cache_mtime_ns:
            return self._clone_settings(self._cache)
        if current_mtime_ns is None:
            return self._write_settings(self.default_settings().to_dict())
        raw = json.loads(self.paths.settings_file.read_text(encoding="utf-8") or "{}")
        settings = self._build_settings(raw if isinstance(raw, dict) else {})
        ensure_storage_paths(settings.storage_dir)
        self._cache = settings
        self._cache_mtime_ns = current_mtime_ns
        return self._clone_settings(settings)

    def load(self) -> AppSettings:
        with self._lock:
            return self._load_unlocked()

    def save(self, payload: dict[str, Any]) -> AppSettings:
        with self._lock:
            current = self._load_unlocked()
            merged = _deep_merge(current.to_dict(), payload if isinstance(payload, dict) else {})
            merged["auto_open_browser"] = bool(merged.get("auto_open_browser", True))
            merged["prompt_font_size"] = self._normalize_prompt_font_size(merged.get("prompt_font_size"))
            merged["record_card_size"] = self._normalize_record_card_size(merged.get("record_card_size"))
            merged["theme"] = self._normalize_theme(merged.get("theme"))
            merged["api_network_auto_switch"] = bool(merged.get("api_network_auto_switch", True))
            merged["api_proxy_url"] = normalize_proxy_url(merged.get("api_proxy_url"))
            merged["openai_network_mode"] = self._normalize_provider_network_mode("openai", merged.get("openai_network_mode"))
            merged["google_network_mode"] = self._normalize_provider_network_mode("google", merged.get("google_network_mode"))
            merged["volcengine_network_mode"] = self._normalize_provider_network_mode("volcengine", merged.get("volcengine_network_mode"))
            merged["storage_dir"] = self._normalize_path(merged.get("storage_dir") or self.paths.storage_dir)
            merged.pop("material_storage_dir", None)
            for provider in ("volcengine", "google", "openai"):
                active_key = str(merged.get(f"{provider}_api_key") or "").strip()
                history = self._normalize_api_key_history(merged.get(f"{provider}_api_key_history"))
                if active_key:
                    history = [active_key, *[item for item in history if item != active_key]]
                merged[f"{provider}_api_key_history"] = history[:10]
            ensure_storage_paths(merged["storage_dir"])
            return self._write_settings(merged)
