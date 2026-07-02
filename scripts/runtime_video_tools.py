from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.runtime_packaging import prepare_macos_video_tools, prepare_windows_video_tools

__all__ = ["prepare_macos_video_tools", "prepare_windows_video_tools"]
