from __future__ import annotations

import os
import socket
import time
from dataclasses import dataclass
from typing import Any, Iterable
from urllib.parse import urlsplit
from urllib.request import getproxies

import requests


NETWORK_MODE_DIRECT = "direct"
NETWORK_MODE_PROXY = "proxy"
NETWORK_MODE_SYSTEM = "system"
ALLOWED_NETWORK_MODES = {
    NETWORK_MODE_DIRECT,
    NETWORK_MODE_PROXY,
    NETWORK_MODE_SYSTEM,
}
DEFAULT_PROVIDER_NETWORK_MODES = {
    "volcengine": NETWORK_MODE_DIRECT,
}
KEY_ERROR_CODES = {"missing_api_key", "api_key_error"}
NETWORK_ERROR_CODES = {"proxy_unreachable", "tls_error", "connect_timeout", "network_error"}
PROXY_VALIDATION_URLS: tuple[str, ...] = ()
COMMON_HTTP_PROXY_PORTS = (7890, 7897, 7899, 10809, 1087, 8080, 8888, 9090)
COMMON_SOCKS_PROXY_PORTS = (1080, 1081, 1082, 10808, 1086, 7891, 7892)
PROXY_DISCOVERY_SUCCESS_TTL_SECONDS = 120
PROXY_DISCOVERY_MISS_TTL_SECONDS = 5


@dataclass(frozen=True)
class ProxyCandidate:
    url: str
    source: str


@dataclass(frozen=True)
class ProxyDiscoveryResult:
    url: str = ""
    source: str = ""


_PROXY_DISCOVERY_CACHE: tuple[float, ProxyDiscoveryResult] | None = None


def normalize_network_mode(value: Any, *, default: str = NETWORK_MODE_SYSTEM) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in ALLOWED_NETWORK_MODES:
        return normalized
    return default if default in ALLOWED_NETWORK_MODES else NETWORK_MODE_SYSTEM


def normalize_proxy_url(value: Any, *, default_scheme: str = "http") -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    if "://" not in normalized:
        normalized = f"{default_scheme}://{normalized}"
    if normalized.lower().startswith("socks://"):
        normalized = f"socks5h://{normalized.split('://', 1)[1]}"
    return normalized


def _is_windows() -> bool:
    return os.name == "nt"


def _dedupe_candidates(candidates: Iterable[ProxyCandidate]) -> list[ProxyCandidate]:
    deduped: list[ProxyCandidate] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = normalize_proxy_url(candidate.url)
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        deduped.append(ProxyCandidate(normalized, candidate.source))
    return deduped


def _environment_proxy_candidates() -> list[ProxyCandidate]:
    candidates: list[ProxyCandidate] = []
    for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        detected = normalize_proxy_url(os.environ.get(name))
        if detected:
            candidates.append(ProxyCandidate(detected, "环境变量"))
    proxies = getproxies()
    for key in ("https", "http", "socks"):
        detected = normalize_proxy_url(
            proxies.get(key),
            default_scheme="socks5h" if key == "socks" else "http",
        )
        if detected:
            candidates.append(ProxyCandidate(detected, "系统代理"))
    return _dedupe_candidates(candidates)


def parse_windows_proxy_server(proxy_server: Any, *, source: str = "Windows 系统代理") -> list[ProxyCandidate]:
    text = str(proxy_server or "").strip()
    if not text:
        return []
    parts = [part.strip() for part in text.split(";") if part.strip()]
    keyed: dict[str, str] = {}
    for part in parts:
        if "=" in part:
            key, value = part.split("=", 1)
            keyed[key.strip().lower()] = value.strip()
    candidates: list[ProxyCandidate] = []
    if keyed:
        for key in ("https", "http", "socks"):
            value = keyed.get(key)
            if not value:
                continue
            scheme = "socks5h" if key == "socks" else "http"
            candidates.append(ProxyCandidate(normalize_proxy_url(value, default_scheme=scheme), source))
    else:
        candidates.append(ProxyCandidate(normalize_proxy_url(text), source))
    return _dedupe_candidates(candidates)


def _windows_registry_proxy_candidates() -> list[ProxyCandidate]:
    if not _is_windows():
        return []
    try:
        import winreg  # type: ignore[attr-defined]
    except ImportError:
        return []
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Internet Settings") as key:
            proxy_enabled, _ = winreg.QueryValueEx(key, "ProxyEnable")
            if int(proxy_enabled or 0) != 1:
                return []
            proxy_server, _ = winreg.QueryValueEx(key, "ProxyServer")
    except OSError:
        return []
    return parse_windows_proxy_server(proxy_server, source="Windows 系统代理")


def _loopback_port_open(proxy_url: str, *, timeout: float = 0.12) -> bool:
    parsed = urlsplit(proxy_url)
    host = parsed.hostname or ""
    port = parsed.port
    if host not in {"127.0.0.1", "localhost", "::1"} or not port:
        return True
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _common_windows_proxy_candidates() -> list[ProxyCandidate]:
    if not _is_windows():
        return []
    candidates: list[ProxyCandidate] = []
    for port in COMMON_HTTP_PROXY_PORTS:
        url = f"http://127.0.0.1:{port}"
        if _loopback_port_open(url):
            candidates.append(ProxyCandidate(url, "本地端口探测"))
    for port in COMMON_SOCKS_PROXY_PORTS:
        url = f"socks5h://127.0.0.1:{port}"
        if _loopback_port_open(url):
            candidates.append(ProxyCandidate(url, "本地端口探测"))
    return _dedupe_candidates(candidates)


def proxy_supports_https_connect(proxy_url: str, *, timeout: float = 2.0) -> bool:
    normalized = normalize_proxy_url(proxy_url)
    if not normalized:
        return False
    session = requests.Session()
    session.trust_env = False
    session.proxies.update({"http": normalized, "https": normalized})
    for url in PROXY_VALIDATION_URLS:
        try:
            response = session.get(url, timeout=(1.0, timeout))
        except requests.exceptions.RequestException:
            continue
        if 100 <= int(response.status_code) < 500:
            return True
    return False


def clear_proxy_discovery_cache() -> None:
    global _PROXY_DISCOVERY_CACHE
    _PROXY_DISCOVERY_CACHE = None


def discover_proxy_details(
    *,
    force_refresh: bool = False,
    validate: bool = True,
    extra_candidates: Iterable[ProxyCandidate] | None = None,
) -> ProxyDiscoveryResult:
    """Find a working local proxy without requiring users to understand proxy ports."""
    global _PROXY_DISCOVERY_CACHE
    now = time.monotonic()
    if not force_refresh and _PROXY_DISCOVERY_CACHE and _PROXY_DISCOVERY_CACHE[0] > now:
        return _PROXY_DISCOVERY_CACHE[1]

    candidates = _dedupe_candidates([
        *(extra_candidates or []),
        *_environment_proxy_candidates(),
        *_windows_registry_proxy_candidates(),
        *_common_windows_proxy_candidates(),
    ])
    for candidate in candidates:
        if not validate or proxy_supports_https_connect(candidate.url):
            result = ProxyDiscoveryResult(candidate.url, candidate.source)
            _PROXY_DISCOVERY_CACHE = (now + PROXY_DISCOVERY_SUCCESS_TTL_SECONDS, result)
            return result

    result = ProxyDiscoveryResult()
    _PROXY_DISCOVERY_CACHE = (now + PROXY_DISCOVERY_MISS_TTL_SECONDS, result)
    return result


def discover_proxy_url() -> str:
    """Find a local proxy URL from app/session environment without requiring UI choices."""
    return discover_proxy_details().url


@dataclass(frozen=True)
class ProviderNetworkConfig:
    provider: str
    configured_mode: str
    active_mode: str
    proxy_url: str
    status: str
    message: str
    proxy_source: str = ""

    @property
    def trust_env(self) -> bool:
        return self.active_mode == NETWORK_MODE_SYSTEM

    @property
    def proxies(self) -> dict[str, str]:
        if self.active_mode != NETWORK_MODE_PROXY or not self.proxy_url:
            return {}
        return {
            "http": self.proxy_url,
            "https": self.proxy_url,
        }

    def cache_key(self) -> str:
        return f"{self.provider}:{self.configured_mode}:{self.active_mode}:{self.proxy_url}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "configured_mode": self.configured_mode,
            "active_mode": self.active_mode,
            "proxy_url": self.proxy_url if self.active_mode == NETWORK_MODE_PROXY else "",
            "proxy_source": self.proxy_source if self.active_mode == NETWORK_MODE_PROXY else "",
            "status": self.status,
            "message": self.message,
            "trust_env": self.trust_env,
        }


class ProviderNetworkManager:
    def __init__(self, settings: Any, *, proxy_detector=discover_proxy_url, force_proxy_refresh: bool = False) -> None:
        self.settings = settings
        self.auto_switch = bool(getattr(settings, "api_network_auto_switch", True))
        self.configured_proxy_url = normalize_proxy_url(getattr(settings, "api_proxy_url", ""))
        self.detected_proxy_url = ""
        self.detected_proxy_source = ""
        if proxy_detector is discover_proxy_url and not (self.configured_proxy_url and not _is_windows()):
            extra = [ProxyCandidate(self.configured_proxy_url, "手动配置")] if self.configured_proxy_url and _is_windows() else []
            detected = discover_proxy_details(force_refresh=force_proxy_refresh, extra_candidates=extra)
            self.detected_proxy_url = normalize_proxy_url(detected.url)
            self.detected_proxy_source = detected.source
        elif callable(proxy_detector):
            detected_value = proxy_detector()
            if isinstance(detected_value, ProxyDiscoveryResult):
                self.detected_proxy_url = normalize_proxy_url(detected_value.url)
                self.detected_proxy_source = detected_value.source
            else:
                self.detected_proxy_url = normalize_proxy_url(detected_value)
                self.detected_proxy_source = "自动识别" if self.detected_proxy_url else ""
        self.proxy_url = self.configured_proxy_url if self.configured_proxy_url and not _is_windows() else self.detected_proxy_url
        self.proxy_source = "手动配置" if self.configured_proxy_url and self.proxy_url == self.configured_proxy_url else self.detected_proxy_source

    def provider_config(self, provider: str) -> ProviderNetworkConfig:
        normalized_provider = str(provider or "").strip().lower()
        default_mode = DEFAULT_PROVIDER_NETWORK_MODES.get(normalized_provider, NETWORK_MODE_SYSTEM)
        configured_mode = default_mode
        if not self.auto_switch:
            return ProviderNetworkConfig(
                provider=normalized_provider,
                configured_mode=default_mode,
                active_mode=NETWORK_MODE_SYSTEM,
                proxy_url="",
                status="system",
                message="API 网络自动切换已关闭，将使用系统网络环境。",
            )
        if configured_mode == NETWORK_MODE_DIRECT:
            return ProviderNetworkConfig(
                provider=normalized_provider,
                configured_mode=configured_mode,
                active_mode=NETWORK_MODE_DIRECT,
                proxy_url="",
                status="managed",
                message="GoDreamAI 将强制直连该平台，不读取系统代理环境。",
            )
        if configured_mode == NETWORK_MODE_PROXY:
            if self.proxy_url:
                return ProviderNetworkConfig(
                    provider=normalized_provider,
                    configured_mode=configured_mode,
                    active_mode=NETWORK_MODE_PROXY,
                    proxy_url=self.proxy_url,
                    proxy_source=self.proxy_source,
                    status="managed",
                    message="GoDreamAI 将自动通过本地代理访问该平台。",
                )
            return ProviderNetworkConfig(
                provider=normalized_provider,
                configured_mode=configured_mode,
                active_mode=NETWORK_MODE_SYSTEM,
                proxy_url="",
                status="unmanaged",
                message="尚未配置或识别到本地代理地址，将临时使用系统网络环境。",
            )
        return ProviderNetworkConfig(
            provider=normalized_provider,
            configured_mode=configured_mode,
            active_mode=NETWORK_MODE_SYSTEM,
            proxy_url="",
            status="system",
            message="该平台将使用系统网络环境。",
        )

    def create_session(self, provider: str) -> requests.Session:
        config = self.provider_config(provider)
        session = requests.Session()
        session.trust_env = config.trust_env
        if config.proxies:
            session.proxies.update(config.proxies)
        else:
            session.proxies.clear()
        return session

    def cache_key(self, provider: str) -> str:
        return self.provider_config(provider).cache_key()

    def status_payload(self, *, api_keys: dict[str, bool] | None = None) -> dict[str, Any]:
        keys = api_keys or {}
        providers = {}
        for provider in ("volcengine",):
            item = self.provider_config(provider).to_dict()
            item["api_key_configured"] = bool(keys.get(provider, False))
            item = self._with_user_guidance(provider, item)
            providers[provider] = item
        return {
            "api_network_auto_switch": self.auto_switch,
            "api_proxy_url": self.configured_proxy_url,
            "detected_proxy_url": self.detected_proxy_url,
            "active_proxy_url": self.proxy_url,
            "proxy_source": self.proxy_source,
            "proxy_detected": bool(self.proxy_url),
            "providers": providers,
        }

    def check_provider(self, provider: str, *, api_key: str = "", timeout: float = 8.0) -> dict[str, Any]:
        normalized_provider = str(provider or "").strip().lower()
        config = self.provider_config(normalized_provider)
        if not str(api_key or "").strip():
            return self._with_user_guidance(normalized_provider, {
                **config.to_dict(),
                "ok": False,
                "reachable": False,
                "code": "missing_api_key",
                "message": self._provider_key_message(normalized_provider),
            })
        session = self.create_session(normalized_provider)
        url, headers, params = self._check_request(normalized_provider, api_key)
        try:
            response = session.get(
                url,
                headers=headers,
                params=params,
                timeout=(4, timeout),
            )
        except requests.exceptions.ProxyError as exc:
            return self._network_error_payload(config, "proxy_unreachable", f"代理不可达：{exc}")
        except requests.exceptions.SSLError as exc:
            message = f"TLS 握手失败：{exc}"
            if normalized_provider == "volcengine" and config.active_mode == NETWORK_MODE_DIRECT:
                message = f"火山引擎直连失败，可能仍被全局 VPN/TUN 接管：{exc}"
            return self._network_error_payload(config, "tls_error", message)
        except requests.exceptions.ConnectTimeout as exc:
            return self._network_error_payload(config, "connect_timeout", f"连接超时：{exc}")
        except requests.exceptions.RequestException as exc:
            return self._network_error_payload(config, "network_error", f"网络请求失败：{exc}")
        return self._response_payload(config, response)

    def check_all(self, *, api_keys: dict[str, str], timeout: float = 8.0) -> dict[str, Any]:
        return {
            "api_network_auto_switch": self.auto_switch,
            "api_proxy_url": self.configured_proxy_url,
            "detected_proxy_url": self.detected_proxy_url,
            "active_proxy_url": self.proxy_url,
            "proxy_source": self.proxy_source,
            "proxy_detected": bool(self.proxy_url),
            "results": {
                provider: self.check_provider(provider, api_key=api_keys.get(provider, ""), timeout=timeout)
                for provider in ("volcengine",)
            },
        }

    @staticmethod
    def _provider_key_message(provider: str) -> str:
        labels = {"volcengine": "请先配置 Volcengine API Key。"}
        return labels.get(provider, "请先配置 API Key。")

    @staticmethod
    def _check_request(provider: str, api_key: str) -> tuple[str, dict[str, str], dict[str, str]]:
        token = str(api_key or "").strip()
        return "https://ark.cn-beijing.volces.com/api/v3/models", {"Authorization": f"Bearer {token}"}, {}

    @staticmethod
    def _network_error_payload(config: ProviderNetworkConfig, code: str, message: str) -> dict[str, Any]:
        return ProviderNetworkManager._with_user_guidance(config.provider, {
            **config.to_dict(),
            "ok": False,
            "reachable": False,
            "code": code,
            "message": message,
        })

    @staticmethod
    def _response_payload(config: ProviderNetworkConfig, response: requests.Response) -> dict[str, Any]:
        status_code = int(response.status_code)
        if 200 <= status_code < 300:
            return ProviderNetworkManager._with_user_guidance(config.provider, {
                **config.to_dict(),
                "ok": True,
                "reachable": True,
                "code": "ok",
                "status_code": status_code,
                "message": "连通性正常。",
            })
        if status_code in {401, 403}:
            return ProviderNetworkManager._with_user_guidance(config.provider, {
                **config.to_dict(),
                "ok": False,
                "reachable": True,
                "code": "api_key_error",
                "status_code": status_code,
                "message": f"网络已连通，但 API Key 或权限异常（HTTP {status_code}）。",
            })
        if status_code >= 500:
            return ProviderNetworkManager._with_user_guidance(config.provider, {
                **config.to_dict(),
                "ok": False,
                "reachable": True,
                "code": "provider_unavailable",
                "status_code": status_code,
                "message": f"网络已连通，但平台暂时不可用（HTTP {status_code}）。",
            })
        return ProviderNetworkManager._with_user_guidance(config.provider, {
            **config.to_dict(),
            "ok": False,
            "reachable": True,
            "code": "endpoint_error",
            "status_code": status_code,
            "message": f"网络已连通，但检测接口返回 HTTP {status_code}。",
        })

    @staticmethod
    def _vpn_instruction(provider: str) -> tuple[str, str]:
        if provider == "volcengine":
            return "需要关闭 VPN", "请关闭 VPN 后重试。"
        return "需要切换 VPN", "请切换 VPN 状态后重试。"

    @staticmethod
    def _initial_user_hint(provider: str) -> tuple[str, str]:
        if provider == "volcengine":
            return "等待检测", "火山引擎通常需要关闭 VPN。"
        return "等待检测", "点击检测连通性查看结果。"

    @staticmethod
    def _with_user_guidance(provider: str, payload: dict[str, Any]) -> dict[str, Any]:
        normalized_provider = str(provider or payload.get("provider") or "").strip().lower()
        code = str(payload.get("code") or "")
        ok = payload.get("ok")
        reachable = payload.get("reachable")

        if ok is True:
            guidance = {
                "user_status": "已连通",
                "user_hint": "连通正常。",
                "user_action": "",
                "user_action_label": "",
            }
        elif code in KEY_ERROR_CODES or payload.get("api_key_configured") is False:
            guidance = {
                "user_status": "检查 API Key",
                "user_hint": "请检查 API Key。",
                "user_action": "check_api_key",
                "user_action_label": "检查 API Key",
            }
        elif ok is False and (reachable is False or code in NETWORK_ERROR_CODES):
            status, hint = ProviderNetworkManager._vpn_instruction(normalized_provider)
            guidance = {
                "user_status": status,
                "user_hint": hint,
                "user_action": "recheck_after_vpn",
                "user_action_label": "我已切换 VPN，重新检测",
            }
        elif ok is False:
            guidance = {
                "user_status": "稍后重试",
                "user_hint": "平台已连通，但暂时返回异常，请稍后重新检测。",
                "user_action": "recheck",
                "user_action_label": "重新检测",
            }
        else:
            status, hint = ProviderNetworkManager._initial_user_hint(normalized_provider)
            guidance = {
                "user_status": status,
                "user_hint": hint,
                "user_action": "",
                "user_action_label": "",
            }
        return {**payload, **guidance}
