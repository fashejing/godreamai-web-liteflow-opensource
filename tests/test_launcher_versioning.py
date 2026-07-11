from __future__ import annotations

import plistlib
from pathlib import Path

from scripts import build_windows_release
from scripts.build_macos_release import write_info_plist
from web_lite3.constants import (
    APP_MACOS_APP_NAME,
    APP_MACOS_EXECUTABLE_NAME,
    APP_RELEASE_VERSION,
    HTTP_USER_AGENT,
    LAUNCHER_USER_AGENT,
    display_release_version,
    release_version_from_env,
)


def test_release_version_prefers_explicit_packaging_env():
    assert (
        release_version_from_env(
            {
                "GODREAMAI_RELEASE_VERSION": "v13.19-blender-opensource-Dual",
                "GITHUB_REF_NAME": "v13.18-blender-opensource-Dual",
            }
        )
        == "v13.19-blender-opensource-Dual"
    )


def test_release_version_uses_github_ref_name():
    assert release_version_from_env({"GITHUB_REF_NAME": "v13.19-blender-opensource-Dual"}) == "v13.19-blender-opensource-Dual"


def test_display_release_version_hides_internal_suffixes():
    assert display_release_version("v13.19-ui-check") == "v13.19"
    assert display_release_version("v13.19-blender-opensource-Dual") == "v13.19"


def test_http_user_agents_are_ascii_header_safe():
    for value in (HTTP_USER_AGENT, LAUNCHER_USER_AGENT):
        assert value.encode("latin-1").decode("latin-1") == value


def test_launcher_surfaces_callable_model_list():
    root = Path(__file__).resolve().parent.parent
    swift_source = (root / "launcher" / "GoDreamAILauncher.swift").read_text(encoding="utf-8")
    windows_source = (root / "launcher-win-source" / "LauncherForm.cs").read_text(encoding="utf-8")
    expected_labels = [
        "井鸽启动器",
        "AI视频创作套件",
        "可调用模型",
        "Seedream 5.0 Pro",
        "Seedream 5.0 Lite",
        "Seedream 4.5",
        "Kling Image 3.0",
        "Kling Image 3.0 Omni",
        "Seedance 2.0",
        "Seedance 2.0 Fast",
        "Seedance 2.0 Mini",
        "Kling 3.0 Turbo",
        "Kling 3.0 Omni",
    ]
    for label in expected_labels:
        assert label in swift_source
        assert label in windows_source
    assert "displayLauncherVersion" in swift_source
    assert "DisplayLauncherVersion" in windows_source


def test_macos_info_plist_records_launcher_version(tmp_path):
    bundle_dir = tmp_path / "GoDreamAI Plus.app"

    write_info_plist(bundle_dir)

    with (bundle_dir / "Contents" / "Info.plist").open("rb") as handle:
        info = plistlib.load(handle)
    assert info["CFBundleName"] == APP_MACOS_APP_NAME
    assert info["CFBundleExecutable"] == APP_MACOS_EXECUTABLE_NAME
    assert info["GoDreamAIReleaseVersion"] == APP_RELEASE_VERSION


def test_windows_publish_injects_launcher_version(tmp_path, monkeypatch):
    commands: list[list[str]] = []

    def fake_run(command: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
        commands.append(command)
        output_dir = Path(command[command.index("-o") + 1])
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / build_windows_release.LAUNCHER_NAME).write_text("launcher", encoding="utf-8")

    monkeypatch.setattr(build_windows_release, "run", fake_run)

    launcher = build_windows_release.publish_windows_launcher(tmp_path, tmp_path / "publish")

    assert launcher.name == build_windows_release.LAUNCHER_NAME
    assert f"-p:InformationalVersion={APP_RELEASE_VERSION}" in commands[0]
