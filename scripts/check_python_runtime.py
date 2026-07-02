#!/usr/bin/env python3
from __future__ import annotations

import importlib
import os
import sys
import time
from pathlib import Path


MODULES = ["sqlite3", "fastapi", "uvicorn", "jinja2", "multipart", "pydantic", "requests", "socks"]


def import_timing(name: str) -> tuple[bool, float, str]:
    started = time.perf_counter()
    try:
        module = importlib.import_module(name)
    except Exception as exc:  # pragma: no cover - diagnostic script
        elapsed_ms = (time.perf_counter() - started) * 1000
        return False, elapsed_ms, f"{type(exc).__name__}: {exc}"
    elapsed_ms = (time.perf_counter() - started) * 1000
    version = getattr(module, "__version__", None)
    if version:
        return True, elapsed_ms, f"version={version}"
    return True, elapsed_ms, "version=unknown"


def main() -> int:
    print("Python Runtime Check")
    print(f"executable: {sys.executable}")
    print(f"version: {sys.version.splitlines()[0]}")
    print(f"cwd: {Path.cwd()}")
    print("sys.path:")
    for item in sys.path[:8]:
        print(f"  - {item}")
    print("imports:")
    failures = 0
    for name in MODULES:
        ok, elapsed_ms, detail = import_timing(name)
        status = "OK" if ok else "FAIL"
        print(f"  - {name}: {status} ({elapsed_ms:.1f} ms) {detail}")
        if not ok:
            failures += 1
    warning = os.environ.get("PYTHONWARNINGS", "").strip()
    print(f"pythonwarnings: {warning or '(empty)'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
