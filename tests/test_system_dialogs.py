from __future__ import annotations

import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import web_lite3.app as app_module
import web_lite3.system_dialogs as system_dialogs
from web_lite3.app import create_app


def test_pick_directory_windows_returns_selected_path(tmp_path, monkeypatch):
    selected_dir = tmp_path / "chosen"
    selected_dir.mkdir()
    initial_dir = tmp_path / "missing" / "child"
    captured: dict[str, object] = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(command, 0, stdout=str(selected_dir), stderr="")

    monkeypatch.setattr(system_dialogs.sys, "platform", "win32")
    monkeypatch.setattr(system_dialogs.subprocess, "run", fake_run)
    monkeypatch.setattr(system_dialogs.subprocess, "STARTUPINFO", lambda: SimpleNamespace(dwFlags=0), raising=False)
    monkeypatch.setattr(system_dialogs.subprocess, "STARTF_USESHOWWINDOW", 1, raising=False)
    monkeypatch.setattr(system_dialogs.subprocess, "CREATE_NO_WINDOW", 134217728, raising=False)

    result = system_dialogs.pick_directory(initial_dir, prompt="选择本地素材库路径")

    assert result == str(selected_dir.resolve())
    assert captured["command"] == [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        captured["command"][5],
    ]
    assert captured["kwargs"]["env"]["GODREAMAI_PICKER_INITIAL_DIR"] == str(tmp_path.resolve())
    assert captured["kwargs"]["env"]["GODREAMAI_PICKER_PROMPT"] == "选择本地素材库路径"
    assert captured["kwargs"]["creationflags"] == 134217728
    assert captured["kwargs"]["startupinfo"].dwFlags & 1 == 1


def test_pick_directory_windows_returns_empty_string_when_cancelled(monkeypatch):
    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(system_dialogs.sys, "platform", "win32")
    monkeypatch.setattr(system_dialogs.subprocess, "run", fake_run)
    monkeypatch.setattr(system_dialogs.subprocess, "STARTUPINFO", lambda: SimpleNamespace(dwFlags=0), raising=False)
    monkeypatch.setattr(system_dialogs.subprocess, "STARTF_USESHOWWINDOW", 1, raising=False)
    monkeypatch.setattr(system_dialogs.subprocess, "CREATE_NO_WINDOW", 134217728, raising=False)

    assert system_dialogs.pick_directory(prompt="选择目录") == ""


def test_pick_directory_windows_raises_runtime_error_on_failure(monkeypatch):
    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 1, stdout="", stderr="dialog failed")

    monkeypatch.setattr(system_dialogs.sys, "platform", "win32")
    monkeypatch.setattr(system_dialogs.subprocess, "run", fake_run)
    monkeypatch.setattr(system_dialogs.subprocess, "STARTUPINFO", lambda: SimpleNamespace(dwFlags=0), raising=False)
    monkeypatch.setattr(system_dialogs.subprocess, "STARTF_USESHOWWINDOW", 1, raising=False)
    monkeypatch.setattr(system_dialogs.subprocess, "CREATE_NO_WINDOW", 134217728, raising=False)

    with pytest.raises(RuntimeError, match="dialog failed"):
        system_dialogs.pick_directory(prompt="选择目录")


def test_pick_directory_api_returns_selected_path(tmp_path, monkeypatch):
    selected_dir = tmp_path / "storage"
    selected_dir.mkdir()

    monkeypatch.setattr(app_module, "pick_directory", lambda initial_dir, prompt: str(selected_dir))

    client = TestClient(create_app(home_dir=tmp_path / "app-home"))
    response = client.post(
        "/api/system/pick-directory",
        json={"initial_dir": str(tmp_path / "initial"), "prompt": "选择资产存储目录"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "storage_dir": str(selected_dir),
        "selected_dir": str(selected_dir),
    }


def test_pick_directory_api_surfaces_backend_error(tmp_path, monkeypatch):
    def raise_runtime_error(initial_dir, prompt):
        raise RuntimeError("当前环境不支持系统目录选择")

    monkeypatch.setattr(app_module, "pick_directory", raise_runtime_error)

    client = TestClient(create_app(home_dir=tmp_path / "app-home"))
    response = client.post("/api/system/pick-directory", json={})

    assert response.status_code == 500
    assert response.json() == {"detail": "当前环境不支持系统目录选择"}