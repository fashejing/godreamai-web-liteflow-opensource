#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

cd "$ROOT_DIR"
if [[ -x "$PYTHON_BIN" ]]; then
  exec "$PYTHON_BIN" -m web_lite3
fi
for CANDIDATE in python3.12 python3.11 python3.10; do
  if command -v "$CANDIDATE" >/dev/null 2>&1; then
    exec "$CANDIDATE" -m web_lite3
  fi
done
exec python3 -m web_lite3
