from __future__ import annotations

import json
import os
import signal
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

from web_lite3.constants import APP_HEALTH_NAME, APP_NAME, DEFAULT_HOST, DEFAULT_PORT
from web_lite3.runtime_identity import compute_runtime_id


MIN_PYTHON = (3, 11)
RUNTIME_IMPORTS = ("fastapi", "uvicorn", "jinja2", "multipart", "pydantic", "requests", "socks")
SERVER_START_TIMEOUT_SECONDS = 60.0
SERVER_START_POLL_INTERVAL_SECONDS = 0.5
PORT_CLEAR_TIMEOUT_SECONDS = 5.0
HEALTH_SIGNATURE = APP_HEALTH_NAME
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


def _is_windows_platform() -> bool:
    return os.name == "nt"


@dataclass
class LauncherResult:
    ok: bool
    code: str
    status_text: str
    detail_text: str = ""
    show_install: bool = False
    enable_launch: bool = False
    target_url: str = ""

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class ProbeResult:
    state: str
    runtime_id: str = ""


class LauncherBackend:
    def __init__(self, root_dir: str | Path | None = None) -> None:
        self.root_dir = Path(root_dir or Path(__file__).resolve().parent.parent).resolve()
        self.runtime_id = compute_runtime_id(self.root_dir)
        self.is_windows = _is_windows_platform()
        self.requirements_file = self.root_dir / "requirements.txt"
        self.venv_dir = self.root_dir / ".venv"
        self.venv_install_dir = self.root_dir / ".venv-installing"
        self.venv_backup_dir = self.root_dir / ".venv-backup"
        self.venv_python = self.venv_dir / ("Scripts/python.exe" if self.is_windows else "bin/python")
        self.runtime_dir = self.root_dir / ".launcher-runtime"
        self.log_file = self.runtime_dir / "server.log"
        self.target_url = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/image"
        self.health_url = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/api/health"
        self.bootstrap_python = Path(sys.executable).resolve()
        self.embedded_python_dir = self.root_dir / "python"
        self.wheelhouse_dir = self.root_dir / "wheelhouse"
        self.ffmpeg_dir = self.root_dir / "ffmpeg"

    def _join_detail_lines(self, *parts: str) -> str:
        return "\n".join(part for part in parts if part).strip()

    def _apply_loopback_no_proxy(self, env: dict[str, str]) -> dict[str, str]:
        merged = dict(env)
        for key in ("NO_PROXY", "no_proxy"):
            existing = [item.strip() for item in merged.get(key, "").split(",") if item.strip()]
            normalized = {item.lower() for item in existing}
            existing.extend(host for host in LOOPBACK_HOSTS if host.lower() not in normalized)
            merged[key] = ",".join(existing)
        return merged

    def _url_targets_loopback(self, url: str) -> bool:
        host = (urllib.parse.urlsplit(url).hostname or "").strip().lower()
        return host in {entry.lower() for entry in LOOPBACK_HOSTS}

    def _open_probe_request(self, request: urllib.request.Request, *, timeout: float):
        if self._url_targets_loopback(request.full_url):
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            return opener.open(request, timeout=timeout)
        return urllib.request.urlopen(request, timeout=timeout)

    def _open_browser_safe(self) -> tuple[bool, str]:
        try:
            self._open_browser()
        except Exception as exc:
            detail = self._join_detail_lines(
                f"请手动打开：{self.target_url}",
                f"浏览器自动打开失败：{type(exc).__name__}: {exc}",
            )
            return False, detail
        return True, self.target_url

    def _python_exists(self) -> bool:
        return self.bootstrap_python.exists()

    def _python_version_ok(self) -> bool:
        return sys.version_info[:2] >= MIN_PYTHON

    def _has_embedded_runtime(self) -> bool:
        return any(path.exists() for path in (self.embedded_python_dir, self.wheelhouse_dir, self.ffmpeg_dir))

    def _embedded_python_path(self) -> Path:
        candidates = [self.embedded_python_dir / "python.exe"] if self.is_windows else [
            self.embedded_python_dir / "bin" / "python3.11",
            self.embedded_python_dir / "bin" / "python3",
            self.embedded_python_dir / "bin" / "python",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return candidates[0]

    def _path_is_executable(self, path: Path) -> bool:
        return path.exists() and os.access(path, os.X_OK)

    def _runtime_import_probe(self) -> tuple[bool, str]:
        if not self.venv_python.exists():
            return False, "未检测到本地 .venv 解释器"
        probe_code = "; ".join(f"import {name}" for name in RUNTIME_IMPORTS)
        try:
            completed = subprocess.run(
                [str(self.venv_python), "-c", probe_code],
                cwd=str(self.root_dir),
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )
        except Exception as exc:
            return False, f"运行时依赖检测失败：{type(exc).__name__}: {exc}"
        if completed.returncode == 0:
            return True, ""
        detail = (completed.stderr or completed.stdout or "").strip() or "运行时依赖缺失"
        return False, detail

    def _bundled_runtime_probe(self) -> tuple[bool, str, str]:
        if not self._has_embedded_runtime():
            return True, "", ""
        bundled_python = self._embedded_python_path()
        if not bundled_python.exists():
            return False, "runtime_python_missing", "未找到内置 Python 运行时。"
        if not self._path_is_executable(bundled_python):
            return (
                False,
                "runtime_python_not_executable",
                f"内置 Python 存在但不可执行：{bundled_python}。发布包权限异常或已损坏，请重新下载。",
            )
        version = sys.version_info[:2]
        if version != (3, 11):
            current = ".".join(str(item) for item in sys.version_info[:3])
            return False, "runtime_python_invalid", f"内置 Python 版本异常：{current}，预期 3.11.x。"
        if struct.calcsize("P") * 8 != 64:
            return False, "runtime_python_invalid", "内置 Python 不是 64 位版本。"
        if not self.wheelhouse_dir.exists():
            return False, "missing_wheelhouse", "未找到离线依赖包 wheelhouse，发布包可能不完整。"
        if not any(self.wheelhouse_dir.glob("*.whl")):
            return False, "missing_wheelhouse", "wheelhouse 目录为空，发布包可能不完整。"
        ffmpeg_path = self.ffmpeg_dir / "bin"
        if not ffmpeg_path.exists():
            return False, "missing_ffmpeg", "未找到 ffmpeg 运行时目录，发布包可能不完整。"
        expected_ffmpeg_tools = ("ffmpeg.exe", "ffprobe.exe") if self.is_windows else ("ffmpeg", "ffprobe")
        for tool_name in expected_ffmpeg_tools:
            tool_path = ffmpeg_path / tool_name
            if not tool_path.exists():
                return False, "missing_ffmpeg", f"未找到 {tool_name}，发布包可能不完整。"
            if not self._path_is_executable(tool_path):
                return (
                    False,
                    "runtime_ffmpeg_not_executable",
                    f"内置 {tool_name} 存在但不可执行：{tool_path}。发布包权限异常或已损坏，请重新下载。",
                )
        return True, "", ""

    def _windows_runtime_probe(self) -> tuple[bool, str, str]:
        return self._bundled_runtime_probe()

    def _run_command(self, command: list[str], *, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            command,
            cwd=str(self.root_dir),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

    def _cleanup_dir(self, path: Path) -> None:
        if not path.exists():
            return
        shutil.rmtree(path, ignore_errors=True)

    def _replace_venv_atomically(self, install_dir: Path) -> None:
        self._cleanup_dir(self.venv_backup_dir)
        if self.venv_dir.exists():
            self.venv_dir.rename(self.venv_backup_dir)
        try:
            install_dir.rename(self.venv_dir)
        except Exception:
            if self.venv_backup_dir.exists() and not self.venv_dir.exists():
                self.venv_backup_dir.rename(self.venv_dir)
            raise
        else:
            self._cleanup_dir(self.venv_backup_dir)

    def check_environment(self) -> LauncherResult:
        if not self._python_exists():
            return LauncherResult(
                ok=False,
                code="missing_python",
                status_text="未找到启动器 Python 运行时",
                detail_text="当前启动器未能启动内置 Python，请重新下载发布包或改用 Python 3.11 开发环境。",
                show_install=False,
                enable_launch=False,
                target_url=self.target_url,
            )
        if not self._python_version_ok():
            version = ".".join(str(item) for item in sys.version_info[:3])
            return LauncherResult(
                ok=False,
                code="python_too_old",
                status_text="Python 版本过低，请升级到 3.11+",
                detail_text=f"当前检测到 Python {version}。",
                show_install=False,
                enable_launch=False,
                target_url=self.target_url,
            )
        runtime_check_ok, runtime_code, runtime_detail = (
            self._windows_runtime_probe() if self.is_windows else self._bundled_runtime_probe()
        )
        ready, detail = self._runtime_import_probe()
        if ready:
            probe = self._probe_running_project()
            if probe.state == "stale":
                existing_runtime_id = probe.runtime_id or "legacy-no-runtime-id"
                return LauncherResult(
                    ok=True,
                    code="stale_instance_detected",
                    status_text="检测到旧实例，点击启动将自动替换",
                    detail_text=self._join_detail_lines(
                        f"当前运行时 ID：{self.runtime_id}",
                        f"已运行实例 ID：{existing_runtime_id}",
                        self.target_url,
                    ),
                    show_install=False,
                    enable_launch=True,
                    target_url=self.target_url,
                )
            if probe.state == "current":
                return LauncherResult(
                    ok=True,
                    code="current_instance_detected",
                    status_text="已检测到当前版本实例，点击启动将直接打开",
                    detail_text=self.target_url,
                    show_install=False,
                    enable_launch=True,
                    target_url=self.target_url,
                )
            return LauncherResult(
                ok=True,
                code="ready",
                status_text="环境OK，直接启动",
                detail_text=f"已检测到可用运行环境：{self.venv_python}",
                show_install=False,
                enable_launch=True,
                target_url=self.target_url,
            )
        if not runtime_check_ok:
            return LauncherResult(
                ok=False,
                code=runtime_code,
                status_text="内置运行时不完整，请重新下载发布包",
                detail_text=runtime_detail,
                show_install=False,
                enable_launch=False,
                target_url=self.target_url,
            )
        return LauncherResult(
            ok=False,
            code="missing_runtime",
            status_text="环境有缺失，点击自动安装",
            detail_text=detail or "本地 .venv 不存在或运行时依赖不完整。",
            show_install=True,
            enable_launch=False,
            target_url=self.target_url,
        )

    def install_environment(self) -> LauncherResult:
        environment = self.check_environment()
        if environment.code in {
            "missing_python",
            "python_too_old",
            "runtime_python_missing",
            "runtime_python_not_executable",
            "runtime_python_invalid",
            "missing_wheelhouse",
            "missing_ffmpeg",
            "runtime_ffmpeg_not_executable",
        }:
            return environment
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self._cleanup_dir(self.venv_install_dir)
        self._cleanup_dir(self.venv_backup_dir)
        create_venv = self._run_command([str(self.bootstrap_python), "-m", "venv", str(self.venv_install_dir)], timeout=120)
        if create_venv.returncode != 0:
            detail = (create_venv.stderr or create_venv.stdout or "").strip() or "创建 .venv 失败"
            self._cleanup_dir(self.venv_install_dir)
            return LauncherResult(
                ok=False,
                code="venv_create_failed",
                status_text="环境安装失败，请稍后重试",
                detail_text=detail,
                show_install=True,
                enable_launch=False,
                target_url=self.target_url,
            )
        install_python = self.venv_install_dir / ("Scripts/python.exe" if self.is_windows else "bin/python")
        ensure_pip = self._run_command([str(install_python), "-m", "ensurepip", "--upgrade"], timeout=300)
        if ensure_pip.returncode != 0:
            detail = (ensure_pip.stderr or ensure_pip.stdout or "").strip() or "初始化 pip 失败"
            self._cleanup_dir(self.venv_install_dir)
            return LauncherResult(
                ok=False,
                code="pip_bootstrap_failed",
                status_text="环境安装失败，请稍后重试",
                detail_text=detail,
                show_install=True,
                enable_launch=False,
                target_url=self.target_url,
            )
        if self.wheelhouse_dir.exists() and any(self.wheelhouse_dir.glob("*.whl")):
            install_command = [
                str(install_python),
                "-m",
                "pip",
                "install",
                "--no-index",
                "--find-links",
                str(self.wheelhouse_dir),
                "-r",
                str(self.requirements_file),
            ]
        else:
            upgrade_pip = self._run_command([str(install_python), "-m", "pip", "install", "--upgrade", "pip"], timeout=300)
            if upgrade_pip.returncode != 0:
                detail = (upgrade_pip.stderr or upgrade_pip.stdout or "").strip() or "升级 pip 失败"
                self._cleanup_dir(self.venv_install_dir)
                return LauncherResult(
                    ok=False,
                    code="pip_upgrade_failed",
                    status_text="环境安装失败，请稍后重试",
                    detail_text=detail,
                    show_install=True,
                    enable_launch=False,
                    target_url=self.target_url,
                )
            install_command = [
                str(install_python),
                "-m",
                "pip",
                "install",
                "-r",
                str(self.requirements_file),
            ]
        install_requirements = self._run_command(install_command, timeout=600)
        if install_requirements.returncode != 0:
            detail = (install_requirements.stderr or install_requirements.stdout or "").strip() or "安装 requirements.txt 失败"
            self._cleanup_dir(self.venv_install_dir)
            return LauncherResult(
                ok=False,
                code="requirements_install_failed",
                status_text="环境安装失败，请稍后重试",
                detail_text=detail,
                show_install=True,
                enable_launch=False,
                target_url=self.target_url,
            )
        try:
            self._replace_venv_atomically(self.venv_install_dir)
        except Exception as exc:
            self._cleanup_dir(self.venv_install_dir)
            return LauncherResult(
                ok=False,
                code="venv_activate_failed",
                status_text="环境安装失败，请稍后重试",
                detail_text=f"替换正式 .venv 失败：{type(exc).__name__}: {exc}",
                show_install=True,
                enable_launch=False,
                target_url=self.target_url,
            )
        return LauncherResult(
            ok=True,
            code="installed",
            status_text="环境安装完毕，点击检测环境",
            detail_text="依赖已安装到当前解压目录内的 .venv。",
            show_install=False,
            enable_launch=False,
            target_url=self.target_url,
        )

    def _probe_running_project(self) -> ProbeResult:
        request = urllib.request.Request(self.health_url, headers={"User-Agent": f"{APP_NAME} Launcher"})
        try:
            with self._open_probe_request(request, timeout=0.8) as response:
                payload = json.loads(response.read(4096).decode("utf-8", errors="ignore"))
                if response.status == 200 and payload.get("ok") is True and payload.get("app") == HEALTH_SIGNATURE:
                    runtime_id = str(payload.get("runtime_id") or "").strip()
                    if runtime_id and runtime_id == self.runtime_id:
                        return ProbeResult("current", runtime_id=runtime_id)
                    return ProbeResult("stale", runtime_id=runtime_id)
        except urllib.error.URLError:
            pass
        except Exception:
            pass
        try:
            with socket.create_connection((DEFAULT_HOST, DEFAULT_PORT), timeout=0.5):
                return ProbeResult("conflict")
        except OSError:
            return ProbeResult("absent")

    def _open_browser(self) -> None:
        if os.environ.get("GODREAMAI_LAUNCHER_SKIP_BROWSER") == "1":
            return
        if self.is_windows:
            startfile = getattr(os, "startfile", None)
            if startfile is not None:
                startfile(self.target_url)
                return
            subprocess.run(["cmd", "/c", "start", "", self.target_url], check=False)
            return
        subprocess.run(["open", self.target_url], check=False)

    def _tail_log(self) -> str:
        if not self.log_file.exists():
            return "未生成启动日志。"
        lines = self.log_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        return "\n".join(lines[-20:]).strip() or "未生成启动日志。"

    def _log_contains(self, marker: str, *, start: int = 0) -> bool:
        if not self.log_file.exists():
            return False
        content = self.log_file.read_text(encoding="utf-8", errors="ignore")[start:]
        return marker in content

    def _list_conflict_pids(self) -> list[int]:
        if self.is_windows:
            try:
                completed = self._run_command(["netstat", "-ano", "-p", "tcp"], timeout=5)
            except Exception:
                return []
            if completed.returncode != 0:
                return []
            pids: list[int] = []
            for line in (completed.stdout or "").splitlines():
                parts = line.split()
                if len(parts) < 5 or parts[0].upper() != "TCP":
                    continue
                local_address = parts[1]
                state = parts[3].upper()
                if state != "LISTENING":
                    continue
                _, _, port = local_address.rpartition(":")
                if port != str(DEFAULT_PORT):
                    continue
                try:
                    pid = int(parts[4])
                except ValueError:
                    continue
                if pid != os.getpid():
                    pids.append(pid)
            return sorted(set(pids))
        try:
            completed = self._run_command(
                ["/usr/sbin/lsof", "-nP", "-t", f"-iTCP:{DEFAULT_PORT}", "-sTCP:LISTEN"],
                timeout=5,
            )
        except Exception:
            return []
        if completed.returncode != 0:
            return []
        pids: list[int] = []
        for line in (completed.stdout or "").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                pid = int(raw)
            except ValueError:
                continue
            if pid != os.getpid():
                pids.append(pid)
        return sorted(set(pids))

    def _wait_for_port_release(self, timeout_seconds: float) -> bool:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            if self._probe_running_project().state == "absent":
                return True
            time.sleep(SERVER_START_POLL_INTERVAL_SECONDS)
        return self._probe_running_project().state == "absent"

    def _terminate_conflicting_processes(self) -> tuple[bool, str]:
        pids = self._list_conflict_pids()
        if not pids:
            return False, f"未找到占用 {DEFAULT_PORT} 端口的监听进程。"
        if self.is_windows:
            soft_failures: list[str] = []
            for pid in pids:
                completed = self._run_command(["taskkill", "/PID", str(pid), "/T"], timeout=10)
                if completed.returncode != 0:
                    detail = (completed.stderr or completed.stdout or "").strip()
                    if detail:
                        soft_failures.append(detail)
            if self._wait_for_port_release(PORT_CLEAR_TIMEOUT_SECONDS):
                    return True, f"已自动结束占用 {DEFAULT_PORT} 端口的进程：{', '.join(str(pid) for pid in pids)}"
            hard_failures: list[str] = []
            for pid in pids:
                completed = self._run_command(["taskkill", "/PID", str(pid), "/T", "/F"], timeout=10)
                if completed.returncode != 0:
                    detail = (completed.stderr or completed.stdout or "").strip()
                    if detail:
                        hard_failures.append(detail)
            if self._wait_for_port_release(PORT_CLEAR_TIMEOUT_SECONDS):
                return True, f"已强制结束占用 {DEFAULT_PORT} 端口的进程：{', '.join(str(pid) for pid in pids)}"
            merged = "\n".join(item for item in [*soft_failures, *hard_failures] if item)
            return False, merged or f"已尝试自动清理端口占用，但 {DEFAULT_PORT} 仍未释放。"
        try:
            for pid in pids:
                os.kill(pid, signal.SIGTERM)
        except PermissionError:
            return False, f"端口 {DEFAULT_PORT} 被其他程序占用，但当前用户没有权限结束该进程。"
        except ProcessLookupError:
            pass
        except OSError as exc:
            return False, f"结束占用进程失败：{exc}"
        if self._wait_for_port_release(PORT_CLEAR_TIMEOUT_SECONDS):
            return True, f"已自动结束占用 {DEFAULT_PORT} 端口的进程：{', '.join(str(pid) for pid in pids)}"
        try:
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    continue
        except PermissionError:
            return False, f"端口 {DEFAULT_PORT} 被其他程序占用，已尝试结束但权限不足。"
        except OSError as exc:
            return False, f"强制结束占用进程失败：{exc}"
        if self._wait_for_port_release(PORT_CLEAR_TIMEOUT_SECONDS):
            return True, f"已强制结束占用 {DEFAULT_PORT} 端口的进程：{', '.join(str(pid) for pid in pids)}"
        return False, f"已尝试自动清理端口占用，但 {DEFAULT_PORT} 仍未释放。"

    def launch(self) -> LauncherResult:
        environment = self.check_environment()
        if not environment.ok:
            return environment
        cleared_port_detail = ""
        probe = self._probe_running_project()
        if probe.state == "current":
            browser_opened, browser_detail = self._open_browser_safe()
            return LauncherResult(
                ok=True,
                code="reused",
                status_text="已复用现有实例并打开前端" if browser_opened else "已复用现有实例，请手动打开前端",
                detail_text=browser_detail,
                show_install=False,
                enable_launch=True,
                target_url=self.target_url,
            )
        if probe.state in {"stale", "conflict"}:
            cleared, detail = self._terminate_conflicting_processes()
            if not cleared:
                return LauncherResult(
                    ok=False,
                    code="stale_instance_conflict" if probe.state == "stale" else "port_conflict",
                        status_text="检测到旧实例，但自动替换失败" if probe.state == "stale" else f"端口 {DEFAULT_PORT} 已被其他程序占用",
                    detail_text=detail,
                    show_install=False,
                    enable_launch=False,
                    target_url=self.target_url,
                )
            cleared_port_detail = detail
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        launch_log_start = self.log_file.stat().st_size if self.log_file.exists() else 0
        with self.log_file.open("a", encoding="utf-8") as handle:
            env = self._apply_loopback_no_proxy(dict(os.environ))
            env["PYTHONUNBUFFERED"] = "1"
            popen_kwargs = {
                "cwd": str(self.root_dir),
                "stdout": handle,
                "stderr": subprocess.STDOUT,
                "stdin": subprocess.DEVNULL,
                "env": env,
            }
            if self.is_windows:
                popen_kwargs["creationflags"] = (
                    getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                    | getattr(subprocess, "CREATE_NO_WINDOW", 0)
                )
                startupinfo_cls = getattr(subprocess, "STARTUPINFO", None)
                use_show_window = getattr(subprocess, "STARTF_USESHOWWINDOW", 0)
                hide_window = getattr(subprocess, "SW_HIDE", 0)
                if startupinfo_cls is not None and use_show_window:
                    startupinfo = startupinfo_cls()
                    startupinfo.dwFlags |= use_show_window
                    startupinfo.wShowWindow = hide_window
                    popen_kwargs["startupinfo"] = startupinfo
            else:
                popen_kwargs["start_new_session"] = True
            process = subprocess.Popen(
                [str(self.venv_python), "-m", "web_lite3", "--no-browser"],
                **popen_kwargs,
            )
        deadline = time.monotonic() + SERVER_START_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            probe = self._probe_running_project()
            process_running = process.poll() is None
            log_confirms_server = process_running and self._log_contains(
                f"Uvicorn running on http://{DEFAULT_HOST}:{DEFAULT_PORT}",
                start=launch_log_start,
            )
            server_started = probe.state == "current" or (probe.state == "stale" and process_running) or log_confirms_server
            if server_started:
                browser_opened, browser_detail = self._open_browser_safe()
                if cleared_port_detail:
                    status_text = "已清理端口占用并打开前端" if browser_opened else "已清理端口占用，前端已启动，请手动打开"
                else:
                    status_text = "前端已启动，浏览器已打开" if browser_opened else "前端已启动，请手动打开"
                return LauncherResult(
                    ok=True,
                    code="launched_after_cleanup" if cleared_port_detail else "launched",
                    status_text=status_text,
                    detail_text=self._join_detail_lines(cleared_port_detail, browser_detail),
                    show_install=False,
                    enable_launch=True,
                    target_url=self.target_url,
                )
            if not process_running:
                break
            time.sleep(SERVER_START_POLL_INTERVAL_SECONDS)
        return LauncherResult(
            ok=False,
            code="launch_timeout",
            status_text="启动失败，请查看日志",
            detail_text=self._tail_log(),
            show_install=False,
            enable_launch=True,
            target_url=self.target_url,
        )


def run_cli(action: str, root_dir: str | Path | None = None) -> LauncherResult:
    backend = LauncherBackend(root_dir=root_dir)
    if action == "check":
        return backend.check_environment()
    if action == "install":
        return backend.install_environment()
    if action == "launch":
        return backend.launch()
    raise ValueError(f"Unsupported launcher action: {action}")


def _print_result_json(payload: dict[str, object]) -> None:
    text = json.dumps(payload, ensure_ascii=False)
    try:
        print(text)
    except UnicodeEncodeError:
        print(json.dumps(payload, ensure_ascii=True))


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if len(args) != 1 or args[0] not in {"check", "install", "launch"}:
        payload = LauncherResult(
            ok=False,
            code="usage_error",
            status_text="用法错误",
            detail_text="launcher_backend.py 仅支持 check / install / launch。",
        )
        _print_result_json(payload.to_dict())
        return 2
    result = run_cli(args[0])
    _print_result_json(result.to_dict())
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
