#!/usr/bin/env python3
from __future__ import annotations

import argparse
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.runtime_packaging import (
    build_common_runtime,
    build_macos_python_runtime,
    build_wheelhouse,
    clean_path,
    copy_tree,
    current_macos_runtime_target,
    ensure_macos_payload_executables,
    normalize_macos_runtime_target,
    prepare_macos_video_tools,
)
from web_lite3.constants import (
    APP_MACOS_APP_NAME,
    APP_MACOS_ARCHIVE_NAME,
    APP_MACOS_BUNDLE_IDENTIFIER,
    APP_MACOS_BUNDLE_NAME,
    APP_MACOS_EXECUTABLE_NAME,
    APP_RELEASE_VERSION,
    APP_RUNTIME_COMMON_DIRNAME,
    APP_RUNTIME_MACOS_ARM64_TARGET,
    APP_RUNTIME_MACOS_X86_64_TARGET,
)


APP_NAME = APP_MACOS_APP_NAME
APP_BUNDLE = APP_MACOS_BUNDLE_NAME
EXECUTABLE_NAME = APP_MACOS_EXECUTABLE_NAME
IDENTIFIER = APP_MACOS_BUNDLE_IDENTIFIER
MIN_MACOS = "11.0"


def compile_arch(source: Path, output: Path, arch: str) -> bool:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "/usr/bin/swiftc",
        str(source),
        "-framework",
        "Cocoa",
        "-target",
        f"{arch}-apple-macos{MIN_MACOS}",
        "-o",
        str(output),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode == 0:
        return True
    print(f"warning: failed to build launcher for {arch}: {(completed.stderr or completed.stdout).strip()}")
    return False


def build_launcher_executable(root: Path, output_path: Path, *, require_universal: bool) -> Path:
    source = root / "launcher" / "GoDreamAILauncher.swift"
    build_dir = root / ".launcher-build" / "macos-launcher"
    arch_outputs: list[Path] = []
    for arch in ("arm64", "x86_64"):
        candidate = build_dir / arch / EXECUTABLE_NAME
        if compile_arch(source, candidate, arch):
            arch_outputs.append(candidate)
    if require_universal and len(arch_outputs) != 2:
        raise SystemExit("failed to build universal macOS launcher for both arm64 and x86_64")
    if not arch_outputs:
        raise SystemExit("failed to build launcher for any architecture")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if len(arch_outputs) == 1:
        shutil.copy2(arch_outputs[0], output_path)
    else:
        subprocess.run(
            ["/usr/bin/lipo", "-create", *[str(item) for item in arch_outputs], "-output", str(output_path)],
            check=True,
        )
    output_path.chmod(0o755)
    return output_path


def write_info_plist(bundle_dir: Path) -> None:
    info = {
        "CFBundleDevelopmentRegion": "zh_CN",
        "CFBundleExecutable": EXECUTABLE_NAME,
        "CFBundleIdentifier": IDENTIFIER,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": APP_NAME,
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "GoDreamAIReleaseVersion": APP_RELEASE_VERSION,
        "LSMinimumSystemVersion": MIN_MACOS,
        "NSHighResolutionCapable": True,
    }
    plist_path = bundle_dir / "Contents" / "Info.plist"
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    with plist_path.open("wb") as handle:
        plistlib.dump(info, handle)


def build_payload(root: Path, target: str, output_dir: Path) -> Path:
    runtime_target = normalize_macos_runtime_target(target)
    cache_root = root / ".launcher-build" / "macos-payload-cache"
    python_cache_dir = cache_root / "python"

    python_runtime_dir = build_macos_python_runtime(python_cache_dir, runtime_target)
    python_exe = python_runtime_dir / "bin" / "python3.11"
    wheelhouse_dir = build_wheelhouse(root, python_exe, cache_root / "wheelhouse" / runtime_target)
    ffmpeg_dir = prepare_macos_video_tools(cache_root / "ffmpeg" / runtime_target)

    clean_path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    copy_tree(python_runtime_dir, output_dir / "python")
    copy_tree(wheelhouse_dir, output_dir / "wheelhouse")
    copy_tree(ffmpeg_dir, output_dir / "ffmpeg")
    ensure_macos_payload_executables(output_dir)
    return output_dir


def copy_embedded_runtime(
    root: Path,
    bundle_dir: Path,
    *,
    arm64_payload_dir: Path | None,
    x86_64_payload_dir: Path | None,
    require_all_payloads: bool,
) -> None:
    resources_runtime = bundle_dir / "Contents" / "Resources" / "runtime"
    common_dir = resources_runtime / APP_RUNTIME_COMMON_DIRNAME
    build_common_runtime(root, common_dir)

    payload_map = {
        APP_RUNTIME_MACOS_ARM64_TARGET: arm64_payload_dir,
        APP_RUNTIME_MACOS_X86_64_TARGET: x86_64_payload_dir,
    }
    missing = [target for target, payload_dir in payload_map.items() if payload_dir is None]
    if require_all_payloads and missing:
        raise SystemExit(f"missing macOS payload directories: {', '.join(missing)}")

    for target, payload_dir in payload_map.items():
        if payload_dir is None:
            continue
        copy_tree(payload_dir, resources_runtime / target)


def normalize_bundle_runtime_executables(bundle_dir: Path) -> None:
    runtime_root = bundle_dir / "Contents" / "Resources" / "runtime"
    for target in (APP_RUNTIME_MACOS_ARM64_TARGET, APP_RUNTIME_MACOS_X86_64_TARGET):
        ensure_macos_payload_executables(runtime_root / target)


def create_macos_archive_with_ditto(bundle_dir: Path, archive_path: Path) -> Path:
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    if archive_path.exists():
        archive_path.unlink()
    subprocess.run(
        [
            "/usr/bin/ditto",
            "-c",
            "-k",
            "--keepParent",
            "--sequesterRsrc",
            str(bundle_dir),
            str(archive_path),
        ],
        check=True,
    )
    return archive_path


def assemble_release(
    root: Path,
    *,
    arm64_payload_dir: Path | None,
    x86_64_payload_dir: Path | None,
    bundle_dir: Path,
    archive_path: Path | None,
    require_universal: bool,
    require_all_payloads: bool,
) -> Path:
    clean_path(bundle_dir)
    executable_path = bundle_dir / "Contents" / "MacOS" / EXECUTABLE_NAME
    build_launcher_executable(root, executable_path, require_universal=require_universal)
    write_info_plist(bundle_dir)
    copy_embedded_runtime(
        root,
        bundle_dir,
        arm64_payload_dir=arm64_payload_dir,
        x86_64_payload_dir=x86_64_payload_dir,
        require_all_payloads=require_all_payloads,
    )
    executable_path.chmod(0o755)
    normalize_bundle_runtime_executables(bundle_dir)

    if archive_path is not None:
        create_macos_archive_with_ditto(bundle_dir, archive_path)
    return bundle_dir


def build_local_app(root: Path) -> Path:
    target = current_macos_runtime_target()
    payload_dir = build_payload(root, target, root / ".launcher-build" / "macos-local" / target)
    kwargs = {
        "arm64_payload_dir": payload_dir if target == APP_RUNTIME_MACOS_ARM64_TARGET else None,
        "x86_64_payload_dir": payload_dir if target == APP_RUNTIME_MACOS_X86_64_TARGET else None,
    }
    return assemble_release(
        root,
        bundle_dir=root / APP_BUNDLE,
        archive_path=None,
        require_universal=False,
        require_all_payloads=False,
        **kwargs,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build GoDreamAI macOS payloads and release bundles.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    payload_parser = subparsers.add_parser("payload", help="Build one macOS runtime payload for the current runner architecture.")
    payload_parser.add_argument("--target", required=True, choices=[APP_RUNTIME_MACOS_ARM64_TARGET, APP_RUNTIME_MACOS_X86_64_TARGET])
    payload_parser.add_argument("--output-dir", required=True)

    assemble_parser = subparsers.add_parser("assemble", help="Assemble a Universal2 macOS app from prebuilt payload directories.")
    assemble_parser.add_argument("--arm64-payload-dir", required=True)
    assemble_parser.add_argument("--x86_64-payload-dir", required=True)
    assemble_parser.add_argument("--bundle-dir", default=str(ROOT / "dist" / APP_BUNDLE))
    assemble_parser.add_argument("--archive-path", default=str(ROOT / "dist" / APP_MACOS_ARCHIVE_NAME))

    local_parser = subparsers.add_parser("local", help="Build a single-runner local macOS app for smoke testing.")
    local_parser.add_argument("--bundle-dir", default=str(ROOT / APP_BUNDLE))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "payload":
        payload_dir = build_payload(ROOT, args.target, Path(args.output_dir).expanduser().resolve())
        print(f"Built macOS payload: {payload_dir}")
        return 0

    if args.command == "assemble":
        bundle_dir = assemble_release(
            ROOT,
            arm64_payload_dir=Path(args.arm64_payload_dir).expanduser().resolve(),
            x86_64_payload_dir=Path(args.x86_64_payload_dir).expanduser().resolve(),
            bundle_dir=Path(args.bundle_dir).expanduser().resolve(),
            archive_path=Path(args.archive_path).expanduser().resolve(),
            require_universal=True,
            require_all_payloads=True,
        )
        print(f"Built macOS release bundle: {bundle_dir}")
        return 0

    if args.command == "local":
        bundle_dir = build_local_app(ROOT)
        requested_bundle_dir = Path(args.bundle_dir).expanduser().resolve()
        if bundle_dir != requested_bundle_dir:
            clean_path(requested_bundle_dir)
            copy_tree(bundle_dir, requested_bundle_dir)
            bundle_dir = requested_bundle_dir
        print(f"Built local macOS app bundle: {bundle_dir}")
        return 0

    parser.error(f"unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
