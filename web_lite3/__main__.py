from __future__ import annotations

import argparse
import threading
import webbrowser

import uvicorn

from web_lite3.app import create_app
from web_lite3.constants import APP_NAME, DEFAULT_HOST, DEFAULT_PORT


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"Start {APP_NAME}")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open the browser on startup")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    app = create_app()
    settings = app.state.settings_store.load()
    target_url = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/image"

    if settings.auto_open_browser and not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(target_url)).start()

    uvicorn.run(
        app,
        host=DEFAULT_HOST,
        port=DEFAULT_PORT,
        log_level="info",
    )


if __name__ == "__main__":
    main()
