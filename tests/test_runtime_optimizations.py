from __future__ import annotations

import base64
import json
import time
from pathlib import Path

from web_lite3.data_paths import ensure_app_paths
from PIL import Image

from web_lite3.files import file_to_api_image_data_url, file_to_data_url
from web_lite3.history_store import HistoryStore
from web_lite3.jobs import JobRegistry
from web_lite3.settings_store import SettingsStore


def test_settings_store_cache_invalidates_after_external_write(tmp_path):
    paths = ensure_app_paths(tmp_path / "app-home")
    store = SettingsStore(paths)

    initial = store.load()
    assert initial.storage_dir

    saved = store.save(
        {
            "storage_dir": str(tmp_path / "storage-a"),
            "volcengine_api_key": "sk-a",
            "theme": "light",
        }
    )
    assert saved.volcengine_api_key == "sk-a"

    raw = json.loads(paths.settings_file.read_text(encoding="utf-8"))
    raw["theme"] = "high_contrast"
    raw["volcengine_api_key"] = "sk-b"
    paths.settings_file.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    reloaded = store.load()
    assert reloaded.theme == "high_contrast"
    assert reloaded.volcengine_api_key == "sk-b"


def test_job_registry_prunes_terminal_snapshots():
    registry = JobRegistry(max_workers=1)
    registry._max_terminal_snapshots = 1

    registry.create(job_id="job-1", kind="image", history_id="history-1")
    registry.finalize_manual("job-1", {"status": "succeeded", "message": "done"})
    time.sleep(0.01)
    registry.create(job_id="job-2", kind="image", history_id="history-2")
    registry.finalize_manual("job-2", {"status": "succeeded", "message": "done"})

    snapshots = registry.list_snapshots()
    assert [item["job_id"] for item in snapshots] == ["job-2"]
    assert registry.get("job-1") is None
    assert registry.get("job-2") is not None


def test_settings_store_defaults_record_card_size_to_medium(tmp_path):
    paths = ensure_app_paths(tmp_path / "app-home")
    store = SettingsStore(paths)

    store.load()
    raw = json.loads(paths.settings_file.read_text(encoding="utf-8"))
    raw.pop("record_card_size", None)
    paths.settings_file.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    reloaded = store.load()
    assert reloaded.record_card_size == "medium"


def test_settings_store_defaults_prompt_font_size_to_16(tmp_path):
    paths = ensure_app_paths(tmp_path / "app-home")
    store = SettingsStore(paths)

    store.load()
    raw = json.loads(paths.settings_file.read_text(encoding="utf-8"))
    raw.pop("prompt_font_size", None)
    paths.settings_file.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    reloaded = store.load()
    assert reloaded.prompt_font_size == 16


def test_file_to_data_url_uses_cache_until_file_changes(tmp_path, monkeypatch):
    asset_path = tmp_path / "asset.png"
    asset_path.write_bytes(b"cache-me")

    original_read_bytes = Path.read_bytes
    read_count = {"total": 0}

    def counting_read_bytes(self):
        read_count["total"] += 1
        return original_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", counting_read_bytes)

    first = file_to_data_url(asset_path, "image/png")
    second = file_to_data_url(asset_path, "image/png")
    assert first == second
    assert read_count["total"] == 1

    asset_path.write_bytes(b"cache-me-again")
    third = file_to_data_url(asset_path, "image/png")
    assert third != first
    assert read_count["total"] == 2


def test_file_to_api_image_data_url_recompresses_large_images(tmp_path):
    asset_path = tmp_path / "large-reference.bmp"
    Image.new("RGB", (2200, 2200), (80, 160, 220)).save(asset_path, format="BMP")

    data_url = file_to_api_image_data_url(asset_path, "image/bmp", max_bytes=120_000)

    assert data_url.startswith("data:image/jpeg;base64,")
    payload = base64.b64decode(data_url.split(",", 1)[1])
    assert len(payload) <= 120_000


def test_history_store_get_assets_by_ids_returns_unique_assets(tmp_path):
    store = HistoryStore(tmp_path / "history.db")
    asset_one = store.register_asset(
        kind="image",
        original_name="a.png",
        path=str(tmp_path / "a.png"),
        mime_type="image/png",
        display_name="A",
    )
    asset_two = store.register_asset(
        kind="image",
        original_name="b.png",
        path=str(tmp_path / "b.png"),
        mime_type="image/png",
        display_name="B",
    )

    resolved = store.get_assets_by_ids([asset_one["id"], "missing", asset_one["id"], asset_two["id"]])

    assert set(resolved.keys()) == {asset_one["id"], asset_two["id"]}
    assert resolved[asset_one["id"]]["display_name"] == "A"
    assert resolved[asset_two["id"]]["display_name"] == "B"
