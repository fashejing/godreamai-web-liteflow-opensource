from __future__ import annotations

import subprocess
from subprocess import CompletedProcess

from web_lite3.constants import APP_HEALTH_NAME, DEFAULT_PORT
from web_lite3.launcher_backend import LauncherBackend, LauncherResult, ProbeResult, _print_result_json


def ready_result(backend: LauncherBackend) -> LauncherResult:
    return LauncherResult(
        ok=True,
        code="ready",
        status_text="ready",
        enable_launch=True,
        target_url=backend.target_url,
    )


def missing_runtime_result(backend: LauncherBackend) -> LauncherResult:
    return LauncherResult(
        ok=False,
        code="missing_runtime",
        status_text="missing runtime",
        show_install=True,
        enable_launch=False,
        target_url=backend.target_url,
    )


def probe(state: str, runtime_id: str = "") -> ProbeResult:
    return ProbeResult(state=state, runtime_id=runtime_id)


class DummyHandle:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def write(self, data):
        return len(data)

    def flush(self):
        return None


class DummyLogFile:
    def exists(self):
        return False

    def open(self, *args, **kwargs):
        return DummyHandle()


def install_dummy_log(backend: LauncherBackend) -> None:
    backend.log_file = DummyLogFile()


def test_print_result_json_falls_back_to_ascii_when_console_encoding_rejects_unicode(monkeypatch):
    calls: list[str] = []

    def fake_print(value):
        calls.append(value)
        if len(calls) == 1:
            raise UnicodeEncodeError("cp1252", "中文", 0, 1, "cannot encode")

    monkeypatch.setattr("builtins.print", fake_print)

    _print_result_json({"status_text": "中文"})

    assert calls == ['{"status_text": "中文"}', '{"status_text": "\\u4e2d\\u6587"}']


def test_check_environment_reports_missing_runtime(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "_python_exists", lambda: True)
    monkeypatch.setattr(backend, "_python_version_ok", lambda: True)
    monkeypatch.setattr(backend, "_windows_runtime_probe", lambda: (True, "", ""))
    monkeypatch.setattr(backend, "_runtime_import_probe", lambda: (False, "依赖缺失"))

    result = backend.check_environment()

    assert result.ok is False
    assert result.code == "missing_runtime"
    assert result.show_install is True
    assert result.enable_launch is False


def test_check_environment_ready(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "_python_exists", lambda: True)
    monkeypatch.setattr(backend, "_python_version_ok", lambda: True)
    monkeypatch.setattr(backend, "_windows_runtime_probe", lambda: (True, "", ""))
    monkeypatch.setattr(backend, "_runtime_import_probe", lambda: (True, ""))
    monkeypatch.setattr(backend, "_probe_running_project", lambda: probe("absent"))

    result = backend.check_environment()

    assert result.ok is True
    assert result.code == "ready"
    assert result.enable_launch is True


def test_check_environment_detects_stale_instance_without_cleanup(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    cleanup_calls: list[str] = []
    monkeypatch.setattr(backend, "_python_exists", lambda: True)
    monkeypatch.setattr(backend, "_python_version_ok", lambda: True)
    monkeypatch.setattr(backend, "_windows_runtime_probe", lambda: (True, "", ""))
    monkeypatch.setattr(backend, "_runtime_import_probe", lambda: (True, ""))
    monkeypatch.setattr(backend, "_probe_running_project", lambda: probe("stale", "old-runtime"))
    monkeypatch.setattr(
        backend,
        "_terminate_conflicting_processes",
        lambda: cleanup_calls.append("called") or (True, "should not run"),
    )

    result = backend.check_environment()

    assert result.ok is True
    assert result.code == "stale_instance_detected"
    assert result.enable_launch is True
    assert cleanup_calls == []
    assert "old-runtime" in result.detail_text
    assert backend.runtime_id in result.detail_text


def test_install_environment_success(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: missing_runtime_result(backend))
    monkeypatch.setattr(
        backend,
        "_run_command",
        lambda command, timeout=None: CompletedProcess(command, 0, stdout="", stderr=""),
    )
    monkeypatch.setattr(backend, "_replace_venv_atomically", lambda install_dir: None)

    result = backend.install_environment()

    assert result.ok is True
    assert result.code == "installed"
    assert result.show_install is False


def test_launch_reuses_current_instance(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    monkeypatch.setattr(backend, "_probe_running_project", lambda: probe("current", backend.runtime_id))
    opened: list[str] = []
    monkeypatch.setattr(backend, "_open_browser", lambda: opened.append("ok"))

    result = backend.launch()

    assert result.ok is True
    assert result.code == "reused"
    assert opened == ["ok"]
    assert result.detail_text == backend.target_url


def test_launch_reuse_stays_successful_when_browser_open_fails(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    monkeypatch.setattr(backend, "_probe_running_project", lambda: probe("current", backend.runtime_id))
    monkeypatch.setattr(backend, "_open_browser", lambda: (_ for _ in ()).throw(OSError("browser disabled")))

    result = backend.launch()

    assert result.ok is True
    assert result.code == "reused"
    assert "手动打开" in result.status_text
    assert backend.target_url in result.detail_text


def test_probe_running_project_accepts_matching_health_payload(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)

    class DummyResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self, _size=-1):
            return f'{{"ok": true, "app": "{APP_HEALTH_NAME}", "runtime_id": "{backend.runtime_id}"}}'.encode()

    class DummyOpener:
        def __init__(self):
            self.calls = []

        def open(self, request, timeout=0):
            self.calls.append((request.full_url, timeout))
            return DummyResponse()

    opener = DummyOpener()
    monkeypatch.setattr("urllib.request.build_opener", lambda *args: opener)

    assert backend._probe_running_project() == probe("current", backend.runtime_id)
    assert opener.calls == [(backend.health_url, 0.8)]


def test_probe_running_project_marks_missing_runtime_id_as_stale(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)

    class DummyResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self, _size=-1):
            return f'{{"ok": true, "app": "{APP_HEALTH_NAME}"}}'.encode()

    class DummyOpener:
        def open(self, request, timeout=0):
            return DummyResponse()

    monkeypatch.setattr("urllib.request.build_opener", lambda *args: DummyOpener())

    assert backend._probe_running_project() == probe("stale")


def test_probe_running_project_bypasses_proxy_for_loopback(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    seen = {}

    class DummyOpener:
        def open(self, request, timeout=0):
            seen["url"] = request.full_url
            raise OSError("stop after opener selection")

    def fake_build_opener(proxy_handler):
        seen["proxy_handler_type"] = type(proxy_handler).__name__
        seen["proxy_mapping"] = getattr(proxy_handler, "proxies", None)
        return DummyOpener()

    monkeypatch.setattr("urllib.request.build_opener", fake_build_opener)
    monkeypatch.setattr("socket.create_connection", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("no socket")))

    assert backend._probe_running_project() == probe("absent")
    assert seen["url"] == backend.health_url
    assert seen["proxy_handler_type"] == "ProxyHandler"
    assert seen["proxy_mapping"] == {}


def test_launch_reports_port_conflict(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    monkeypatch.setattr(backend, "_probe_running_project", lambda: probe("conflict"))
    monkeypatch.setattr(backend, "_terminate_conflicting_processes", lambda: (False, "occupied"))

    result = backend.launch()

    assert result.ok is False
    assert result.code == "port_conflict"


def test_launch_reports_stale_instance_cleanup_failure(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    monkeypatch.setattr(backend, "_probe_running_project", lambda: probe("stale", "old-runtime"))
    monkeypatch.setattr(backend, "_terminate_conflicting_processes", lambda: (False, "cleanup failed"))

    result = backend.launch()

    assert result.ok is False
    assert result.code == "stale_instance_conflict"
    assert "旧实例" in result.status_text


def test_launch_replaces_stale_instance_before_starting_current_runtime(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    states = iter([probe("stale", "old-runtime"), probe("current", backend.runtime_id)])
    monkeypatch.setattr(backend, "_probe_running_project", lambda: next(states))
    cleanup_calls: list[str] = []

    def fake_cleanup():
        cleanup_calls.append("cleanup")
        return True, "cleared old runtime"

    monkeypatch.setattr(backend, "_terminate_conflicting_processes", fake_cleanup)
    install_dummy_log(backend)
    launched = []
    opened: list[str] = []

    class DummyPopen:
        def __init__(self, *args, **kwargs):
            launched.append((args, kwargs))

        def poll(self):
            return None

    monkeypatch.setattr("subprocess.Popen", DummyPopen)
    monkeypatch.setattr(backend, "_open_browser", lambda: opened.append("ok"))

    result = backend.launch()

    assert result.ok is True
    assert result.code == "launched_after_cleanup"
    assert cleanup_calls == ["cleanup"]
    assert "cleared old runtime" in result.detail_text
    assert opened == ["ok"]
    assert launched


def test_launch_waits_for_current_runtime_before_succeeding(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    probe_calls: list[str] = []
    states = iter([probe("absent"), probe("conflict"), probe("current", backend.runtime_id)])

    def fake_probe():
        current = next(states)
        probe_calls.append(current.state)
        return current

    monkeypatch.setattr(backend, "_probe_running_project", fake_probe)
    monkeypatch.setattr(backend, "_log_contains", lambda marker, start=0: False)
    install_dummy_log(backend)
    opened: list[str] = []
    launched = []

    class DummyPopen:
        def __init__(self, *args, **kwargs):
            launched.append((args, kwargs))

        def poll(self):
            return None

    monkeypatch.setattr("subprocess.Popen", DummyPopen)
    monkeypatch.setattr(backend, "_open_browser", lambda: opened.append("ok"))

    result = backend.launch()

    assert result.ok is True
    assert result.code == "launched"
    assert probe_calls == ["absent", "conflict", "current"]
    assert opened == ["ok"]
    assert launched


def test_launch_accepts_started_same_app_with_different_runtime_id(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    states = iter([probe("absent"), probe("stale", "packaged-runtime")])
    monkeypatch.setattr(backend, "_probe_running_project", lambda: next(states))
    install_dummy_log(backend)
    opened: list[str] = []

    class DummyPopen:
        def __init__(self, *args, **kwargs):
            pass

        def poll(self):
            return None

    monkeypatch.setattr("subprocess.Popen", DummyPopen)
    monkeypatch.setattr(backend, "_open_browser", lambda: opened.append("ok"))

    result = backend.launch()

    assert result.ok is True
    assert result.code == "launched"
    assert opened == ["ok"]


def test_launch_accepts_current_server_log_when_probe_reports_conflict(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    states = iter([probe("absent"), probe("conflict")])
    monkeypatch.setattr(backend, "_probe_running_project", lambda: next(states))
    monkeypatch.setattr(backend, "_log_contains", lambda marker, start=0: True)
    install_dummy_log(backend)
    opened: list[str] = []

    class DummyPopen:
        def __init__(self, *args, **kwargs):
            pass

        def poll(self):
            return None

    monkeypatch.setattr("subprocess.Popen", DummyPopen)
    monkeypatch.setattr(backend, "_open_browser", lambda: opened.append("ok"))

    result = backend.launch()

    assert result.ok is True
    assert result.code == "launched"
    assert opened == ["ok"]


def test_windows_backend_uses_scripts_python_path(tmp_path, monkeypatch):
    monkeypatch.setattr("web_lite3.launcher_backend._is_windows_platform", lambda: True)
    backend = LauncherBackend(root_dir=tmp_path)

    assert backend.is_windows is True
    assert backend.venv_python == tmp_path / ".venv" / "Scripts" / "python.exe"


def test_windows_open_browser_uses_startfile(tmp_path, monkeypatch):
    monkeypatch.setattr("web_lite3.launcher_backend._is_windows_platform", lambda: True)
    backend = LauncherBackend(root_dir=tmp_path)
    opened: list[str] = []
    monkeypatch.setattr("os.startfile", lambda url: opened.append(url), raising=False)

    backend._open_browser()

    assert opened == [backend.target_url]


def test_windows_list_conflict_pids_parses_netstat(tmp_path, monkeypatch):
    monkeypatch.setattr("web_lite3.launcher_backend._is_windows_platform", lambda: True)
    backend = LauncherBackend(root_dir=tmp_path)
    sample = "\n".join(
        [
            f"  TCP    127.0.0.1:{DEFAULT_PORT}     0.0.0.0:0      LISTENING       123",
            f"  TCP    [::]:{DEFAULT_PORT}          [::]:0         LISTENING       456",
            "  TCP    127.0.0.1:3000     0.0.0.0:0      LISTENING       999",
        ]
    )
    monkeypatch.setattr(
        backend,
        "_run_command",
        lambda command, timeout=None: CompletedProcess(command, 0, stdout=sample, stderr=""),
    )

    assert backend._list_conflict_pids() == [123, 456]


def test_check_environment_reports_missing_wheelhouse_on_windows(tmp_path, monkeypatch):
    monkeypatch.setattr("web_lite3.launcher_backend._is_windows_platform", lambda: True)
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "_python_exists", lambda: True)
    monkeypatch.setattr(backend, "_python_version_ok", lambda: True)
    monkeypatch.setattr(backend, "_runtime_import_probe", lambda: (False, "依赖缺失"))
    monkeypatch.setattr(
        backend,
        "_windows_runtime_probe",
        lambda: (False, "missing_wheelhouse", "missing wheelhouse"),
    )

    result = backend.check_environment()

    assert result.ok is False
    assert result.code == "missing_wheelhouse"
    assert result.show_install is False
    assert result.enable_launch is False


def test_bundled_runtime_probe_requires_ffmpeg_for_packaged_macos_runtime(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "_has_embedded_runtime", lambda: True)
    monkeypatch.setattr(backend, "_embedded_python_path", lambda: tmp_path / "python" / "bin" / "python3.11")
    monkeypatch.setattr("web_lite3.launcher_backend.sys.version_info", (3, 11, 0), raising=False)
    (tmp_path / "python" / "bin").mkdir(parents=True, exist_ok=True)
    (tmp_path / "python" / "bin" / "python3.11").write_text("python", encoding="utf-8")
    (tmp_path / "python" / "bin" / "python3.11").chmod(0o755)
    (tmp_path / "wheelhouse").mkdir(parents=True, exist_ok=True)
    (tmp_path / "wheelhouse" / "fastapi.whl").write_text("wheel", encoding="utf-8")

    ok, code, detail = backend._bundled_runtime_probe()

    assert ok is False
    assert code == "missing_ffmpeg"
    assert "ffmpeg" in detail


def test_bundled_runtime_probe_rejects_non_executable_python(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    python_path = tmp_path / "python" / "bin" / "python3.11"
    backend.is_windows = False
    monkeypatch.setattr(backend, "_has_embedded_runtime", lambda: True)
    monkeypatch.setattr(backend, "_embedded_python_path", lambda: python_path)
    monkeypatch.setattr(backend, "_path_is_executable", lambda path: False if path == python_path else True)
    monkeypatch.setattr("web_lite3.launcher_backend.sys.version_info", (3, 11, 0), raising=False)
    python_path.parent.mkdir(parents=True, exist_ok=True)
    python_path.write_text("python", encoding="utf-8")

    ok, code, detail = backend._bundled_runtime_probe()

    assert ok is False
    assert code == "runtime_python_not_executable"
    assert "不可执行" in detail


def test_bundled_runtime_probe_rejects_non_executable_ffmpeg(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    python_path = tmp_path / "python" / "bin" / "python3.11"
    ffmpeg_path = tmp_path / "ffmpeg" / "bin" / "ffmpeg"
    ffprobe_path = tmp_path / "ffmpeg" / "bin" / "ffprobe"
    backend.is_windows = False
    monkeypatch.setattr(backend, "_has_embedded_runtime", lambda: True)
    monkeypatch.setattr(backend, "_embedded_python_path", lambda: python_path)
    monkeypatch.setattr(backend, "_path_is_executable", lambda path: False if path == ffmpeg_path else True)
    monkeypatch.setattr("web_lite3.launcher_backend.sys.version_info", (3, 11, 0), raising=False)
    python_path.parent.mkdir(parents=True, exist_ok=True)
    python_path.write_text("python", encoding="utf-8")
    (tmp_path / "wheelhouse").mkdir(parents=True, exist_ok=True)
    (tmp_path / "wheelhouse" / "fastapi.whl").write_text("wheel", encoding="utf-8")
    ffmpeg_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg_path.write_text("ffmpeg", encoding="utf-8")
    ffprobe_path.write_text("ffprobe", encoding="utf-8")

    ok, code, detail = backend._bundled_runtime_probe()

    assert ok is False
    assert code == "runtime_ffmpeg_not_executable"
    assert "ffmpeg" in detail


def test_install_environment_windows_uses_offline_wheelhouse(tmp_path, monkeypatch):
    monkeypatch.setattr("web_lite3.launcher_backend._is_windows_platform", lambda: True)
    backend = LauncherBackend(root_dir=tmp_path)
    backend.wheelhouse_dir.mkdir(parents=True, exist_ok=True)
    (backend.wheelhouse_dir / "fastapi.whl").write_text("wheel", encoding="utf-8")
    monkeypatch.setattr(backend, "check_environment", lambda: missing_runtime_result(backend))
    commands: list[list[str]] = []

    def fake_run(command, timeout=None):
        commands.append(command)
        return CompletedProcess(command, 0, stdout="", stderr="")

    replace_calls = []
    monkeypatch.setattr(backend, "_run_command", fake_run)
    monkeypatch.setattr(backend, "_replace_venv_atomically", lambda install_dir: replace_calls.append(install_dir))

    result = backend.install_environment()

    assert result.ok is True
    assert result.code == "installed"
    assert commands[0] == [str(backend.bootstrap_python), "-m", "venv", str(backend.venv_install_dir)]
    assert commands[1] == [str(backend.venv_install_dir / "Scripts/python.exe"), "-m", "ensurepip", "--upgrade"]
    assert "--no-index" in commands[2]
    assert "--find-links" in commands[2]
    assert str(backend.wheelhouse_dir) in commands[2]
    assert replace_calls == [backend.venv_install_dir]


def test_install_environment_macos_uses_offline_wheelhouse_when_present(tmp_path, monkeypatch):
    backend = LauncherBackend(root_dir=tmp_path)
    backend.wheelhouse_dir.mkdir(parents=True, exist_ok=True)
    (backend.wheelhouse_dir / "fastapi.whl").write_text("wheel", encoding="utf-8")
    monkeypatch.setattr(backend, "check_environment", lambda: missing_runtime_result(backend))
    commands: list[list[str]] = []

    def fake_run(command, timeout=None):
        commands.append(command)
        return CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(backend, "_run_command", fake_run)
    monkeypatch.setattr(backend, "_replace_venv_atomically", lambda install_dir: None)

    result = backend.install_environment()

    assert result.ok is True
    assert commands[1] == [str(backend.venv_install_dir / "bin/python"), "-m", "ensurepip", "--upgrade"]
    assert "--no-index" in commands[2]
    assert str(backend.wheelhouse_dir) in commands[2]


def test_launch_windows_uses_hidden_process_flags(tmp_path, monkeypatch):
    monkeypatch.setattr("web_lite3.launcher_backend._is_windows_platform", lambda: True)
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    states = iter([probe("absent"), probe("current", backend.runtime_id)])
    monkeypatch.setattr(backend, "_probe_running_project", lambda: next(states))
    opened: list[str] = []
    monkeypatch.setattr(backend, "_open_browser", lambda: opened.append("ok"))
    monkeypatch.setattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200, raising=False)
    monkeypatch.setattr(subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    monkeypatch.setattr(subprocess, "STARTF_USESHOWWINDOW", 0x00000001, raising=False)
    monkeypatch.setattr(subprocess, "SW_HIDE", 0, raising=False)

    class DummyStartupInfo:
        def __init__(self):
            self.dwFlags = 0
            self.wShowWindow = None

    monkeypatch.setattr(subprocess, "STARTUPINFO", DummyStartupInfo, raising=False)
    install_dummy_log(backend)
    launched = []

    class DummyPopen:
        def __init__(self, *args, **kwargs):
            launched.append((args, kwargs))

        def poll(self):
            return None

    monkeypatch.setattr("subprocess.Popen", DummyPopen)

    result = backend.launch()

    assert result.ok is True
    assert result.code == "launched"
    assert opened == ["ok"]
    assert launched
    assert launched[0][1]["creationflags"] == 0x00000200 | 0x08000000
    assert launched[0][1]["startupinfo"].dwFlags == 0x00000001
    assert launched[0][1]["startupinfo"].wShowWindow == 0


def test_launch_injects_no_proxy_for_subprocess(tmp_path, monkeypatch):
    monkeypatch.setattr("web_lite3.launcher_backend._is_windows_platform", lambda: True)
    backend = LauncherBackend(root_dir=tmp_path)
    monkeypatch.setattr(backend, "check_environment", lambda: ready_result(backend))
    states = iter([probe("absent"), probe("current", backend.runtime_id)])
    monkeypatch.setattr(backend, "_probe_running_project", lambda: next(states))
    monkeypatch.setattr(backend, "_open_browser", lambda: None)
    monkeypatch.setattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200, raising=False)
    monkeypatch.setattr(subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    monkeypatch.setattr(subprocess, "STARTF_USESHOWWINDOW", 0x00000001, raising=False)
    monkeypatch.setattr(subprocess, "SW_HIDE", 0, raising=False)

    class DummyStartupInfo:
        def __init__(self):
            self.dwFlags = 0
            self.wShowWindow = None

    monkeypatch.setattr(subprocess, "STARTUPINFO", DummyStartupInfo, raising=False)
    install_dummy_log(backend)
    popen_envs: list[dict[str, str]] = []

    class DummyPopen:
        def __init__(self, *args, **kwargs):
            popen_envs.append(kwargs["env"])

        def poll(self):
            return None

    monkeypatch.setattr("subprocess.Popen", DummyPopen)
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:7897")
    monkeypatch.setenv("https_proxy", "http://127.0.0.1:7897")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)

    result = backend.launch()

    assert result.ok is True
    assert result.code == "launched"
    assert popen_envs
    assert popen_envs[0]["NO_PROXY"] == "127.0.0.1,localhost,::1"
    assert popen_envs[0]["no_proxy"] == "127.0.0.1,localhost,::1"
