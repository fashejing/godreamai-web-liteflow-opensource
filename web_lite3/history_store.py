from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from web_lite3.data_paths import ensure_storage_paths


def _utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _fallback_elapsed_ms(created_at: str | None, updated_at: str | None) -> int | None:
    created = _parse_iso_datetime(created_at)
    updated = _parse_iso_datetime(updated_at)
    if not created or not updated:
        return None
    return max(0, int((updated - created).total_seconds() * 1000))


class HistoryStore:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 30000")
        connection.execute("PRAGMA synchronous = NORMAL")
        return connection

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS history (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    batch_session_id TEXT,
                    batch_position INTEGER,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    model_variant TEXT NOT NULL,
                    mode_key TEXT,
                    prompt TEXT NOT NULL,
                    params_requested TEXT NOT NULL,
                    params_actual TEXT NOT NULL DEFAULT '{}',
                    result_payload TEXT NOT NULL DEFAULT '{}',
                    local_paths TEXT NOT NULL DEFAULT '[]',
                    thumbnail_path TEXT,
                    error_message TEXT,
                    elapsed_ms INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            self._ensure_column(connection, "history", "elapsed_ms", "INTEGER")
            self._ensure_column(connection, "history", "batch_session_id", "TEXT")
            self._ensure_column(connection, "history", "batch_position", "INTEGER")
            self._ensure_column(connection, "history", "mode_key", "TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    original_name TEXT NOT NULL,
                    display_name TEXT,
                    tag_category TEXT,
                    origin TEXT NOT NULL DEFAULT 'workspace',
                    library_visible INTEGER NOT NULL DEFAULT 0,
                    source_mode TEXT,
                    source_path TEXT,
                    source_root TEXT,
                    path TEXT NOT NULL,
                    thumbnail_path TEXT,
                    mime_type TEXT,
                    content_hash TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                )
                """
            )
            self._ensure_column(connection, "assets", "display_name", "TEXT")
            self._ensure_column(connection, "assets", "tag_category", "TEXT")
            self._ensure_column(connection, "assets", "origin", "TEXT NOT NULL DEFAULT 'workspace'")
            self._ensure_column(connection, "assets", "library_visible", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "assets", "source_mode", "TEXT")
            self._ensure_column(connection, "assets", "source_path", "TEXT")
            self._ensure_column(connection, "assets", "source_root", "TEXT")
            self._ensure_column(connection, "assets", "thumbnail_path", "TEXT")
            self._ensure_column(connection, "assets", "content_hash", "TEXT")
            self._ensure_column(connection, "assets", "updated_at", "TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS library_source (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    source_dir TEXT,
                    connected_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_refreshed_at TEXT
                )
                """
            )
            self._ensure_column(connection, "library_source", "last_refreshed_at", "TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS canvas_state (
                    id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            self._create_indexes(connection)

    @staticmethod
    def _create_indexes(connection: sqlite3.Connection) -> None:
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_kind_created_at_desc ON history(kind, created_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_job_id ON history(job_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_kind_status_created_at_desc ON history(kind, status, created_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_history_kind_model_mode_created_at ON history(kind, model_variant, mode_key, created_at ASC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_library_visible_category_updated_at_desc ON assets(library_visible, tag_category, updated_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_source_root_path ON assets(source_root, source_path)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_kind_content_hash ON assets(kind, content_hash)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_kind_updated_at_desc ON assets(kind, updated_at DESC, created_at DESC)"
        )

    @staticmethod
    def _ensure_column(connection: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
        columns = {
            row["name"] if isinstance(row, sqlite3.Row) else row[1]
            for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

    def _history_item_from_values(
        self,
        *,
        record_id: str,
        job_id: str,
        batch_session_id: str | None,
        batch_position: int | None,
        kind: str,
        status: str,
        model_variant: str,
        mode_key: str | None,
        prompt: str,
        params_requested: dict[str, Any],
        params_actual: dict[str, Any] | None = None,
        result_payload: dict[str, Any] | None = None,
        local_paths: list[str] | None = None,
        thumbnail_path: str | None = None,
        error_message: str | None = None,
        elapsed_ms: int | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> dict[str, Any]:
        item = {
            "id": record_id,
            "job_id": job_id,
            "batch_session_id": batch_session_id,
            "batch_position": batch_position,
            "kind": kind,
            "status": status,
            "model_variant": model_variant,
            "mode_key": mode_key,
            "prompt": prompt,
            "params_requested": params_requested,
            "params_actual": params_actual or {},
            "result_payload": result_payload or {},
            "local_paths": list(local_paths or []),
            "thumbnail_path": thumbnail_path,
            "error_message": error_message,
            "elapsed_ms": elapsed_ms,
            "created_at": created_at,
            "updated_at": updated_at,
        }
        if item.get("elapsed_ms") is None:
            item["elapsed_ms"] = _fallback_elapsed_ms(item.get("created_at"), item.get("updated_at"))
        return item

    def _asset_item_from_values(
        self,
        *,
        asset_id: str,
        kind: str,
        original_name: str,
        display_name: str | None,
        tag_category: str | None,
        origin: str,
        library_visible: bool,
        source_mode: str | None,
        source_path: str | None,
        source_root: str | None,
        path: str,
        thumbnail_path: str | None,
        mime_type: str | None,
        content_hash: str | None,
        created_at: str,
        updated_at: str | None,
    ) -> dict[str, Any]:
        item = {
            "id": asset_id,
            "kind": kind,
            "original_name": original_name,
            "display_name": display_name,
            "tag_category": tag_category,
            "origin": origin,
            "library_visible": bool(library_visible),
            "source_mode": source_mode,
            "source_path": source_path,
            "source_root": source_root,
            "path": path,
            "thumbnail_path": thumbnail_path,
            "mime_type": mime_type,
            "content_hash": content_hash,
            "created_at": created_at,
            "updated_at": updated_at,
        }
        if not item.get("display_name"):
            original = str(item.get("original_name") or "").strip()
            item["display_name"] = Path(original).stem or original or asset_id
        return item

    def register_asset(
        self,
        *,
        kind: str,
        original_name: str,
        path: str,
        mime_type: str | None,
        display_name: str | None = None,
        tag_category: str | None = None,
        origin: str = "workspace",
        library_visible: bool = False,
        source_mode: str | None = None,
        source_path: str | None = None,
        source_root: str | None = None,
        thumbnail_path: str | None = None,
        content_hash: str | None = None,
    ) -> dict[str, Any]:
        asset_id = uuid.uuid4().hex
        created_at = _utc_now()
        normalized_content_hash = str(content_hash or "").strip().lower() or None
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO assets (
                    id, kind, original_name, display_name, tag_category,
                    origin, library_visible, source_mode, source_path, source_root,
                    path, thumbnail_path, mime_type, content_hash, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset_id,
                    kind,
                    original_name,
                    display_name,
                    tag_category,
                    origin,
                    1 if library_visible else 0,
                    source_mode,
                    source_path,
                    source_root,
                    path,
                    thumbnail_path,
                    mime_type,
                    normalized_content_hash,
                    created_at,
                    created_at,
                ),
            )
        return self._asset_item_from_values(
            asset_id=asset_id,
            kind=kind,
            original_name=original_name,
            display_name=display_name,
            tag_category=tag_category,
            origin=origin,
            library_visible=library_visible,
            source_mode=source_mode,
            source_path=source_path,
            source_root=source_root,
            path=path,
            thumbnail_path=thumbnail_path,
            mime_type=mime_type,
            content_hash=normalized_content_hash,
            created_at=created_at,
            updated_at=created_at,
        )

    def update_asset_metadata(
        self,
        asset_id: str,
        *,
        display_name: str | None = None,
        tag_category: str | None = None,
        origin: str | None = None,
        library_visible: bool | None = None,
    ) -> dict[str, Any]:
        current = self.get_asset(asset_id)
        if not current:
            raise KeyError(f"asset not found: {asset_id}")
        next_display_name = display_name if display_name is not None else current.get("display_name")
        next_tag_category = tag_category if tag_category is not None else current.get("tag_category")
        next_origin = origin if origin is not None else current.get("origin") or "workspace"
        if library_visible is None:
            next_library_visible = int(bool(current.get("library_visible")))
        else:
            next_library_visible = 1 if library_visible else 0
        updated_at = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE assets
                SET display_name = ?,
                    tag_category = ?,
                    origin = ?,
                    library_visible = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    next_display_name,
                    next_tag_category,
                    next_origin,
                    next_library_visible,
                    updated_at,
                    asset_id,
                ),
            )
        return self._asset_item_from_values(
            asset_id=asset_id,
            kind=str(current.get("kind") or ""),
            original_name=str(current.get("original_name") or ""),
            display_name=next_display_name,
            tag_category=next_tag_category,
            origin=next_origin,
            library_visible=bool(next_library_visible),
            source_mode=current.get("source_mode"),
            source_path=current.get("source_path"),
            source_root=current.get("source_root"),
            path=str(current.get("path") or ""),
            thumbnail_path=current.get("thumbnail_path"),
            mime_type=current.get("mime_type"),
            content_hash=current.get("content_hash"),
            created_at=str(current.get("created_at") or updated_at),
            updated_at=updated_at,
        )

    def update_asset_thumbnail(self, asset_id: str, thumbnail_path: str | None) -> dict[str, Any]:
        current = self.get_asset(asset_id)
        if not current:
            raise KeyError(f"asset not found: {asset_id}")
        updated_at = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE assets
                SET thumbnail_path = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    thumbnail_path,
                    updated_at,
                    asset_id,
                ),
            )
        return self._asset_item_from_values(
            asset_id=asset_id,
            kind=str(current.get("kind") or ""),
            original_name=str(current.get("original_name") or ""),
            display_name=current.get("display_name"),
            tag_category=current.get("tag_category"),
            origin=str(current.get("origin") or "workspace"),
            library_visible=bool(current.get("library_visible")),
            source_mode=current.get("source_mode"),
            source_path=current.get("source_path"),
            source_root=current.get("source_root"),
            path=str(current.get("path") or ""),
            thumbnail_path=thumbnail_path,
            mime_type=current.get("mime_type"),
            content_hash=current.get("content_hash"),
            created_at=str(current.get("created_at") or updated_at),
            updated_at=updated_at,
        )

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM assets WHERE id = ?",
                (asset_id,),
            ).fetchone()
        if row is None:
            return None
        return self._deserialize_asset_row(row)

    def get_assets_by_ids(self, asset_ids: list[str]) -> dict[str, dict[str, Any]]:
        normalized_ids = []
        seen_ids: set[str] = set()
        for asset_id in asset_ids:
            normalized = str(asset_id or "").strip()
            if not normalized or normalized in seen_ids:
                continue
            seen_ids.add(normalized)
            normalized_ids.append(normalized)
        if not normalized_ids:
            return {}
        placeholders = ", ".join("?" for _ in normalized_ids)
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM assets WHERE id IN ({placeholders})",
                tuple(normalized_ids),
            ).fetchall()
        return {
            item["id"]: item
            for item in (self._deserialize_asset_row(row) for row in rows)
        }

    def list_assets(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT *
                FROM assets
                ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
                """
            ).fetchall()
        return [self._deserialize_asset_row(row) for row in rows]

    @staticmethod
    def _canvas_asset_source_clause(source_group: str) -> str:
        normalized = str(source_group or "").strip()
        if normalized == "当前素材库":
            return "(origin = 'library_source' OR origin IN ('library', 'library_upload') OR library_visible = 1)"
        if normalized == "上传资源":
            return (
                "COALESCE(source_mode, '') != 'history_snapshot' "
                "AND COALESCE(origin, 'workspace') NOT IN ('library_source', 'library', 'library_upload') "
                "AND COALESCE(library_visible, 0) != 1"
            )
        if normalized == "请求快照素材":
            return "source_mode = 'history_snapshot'"
        return ""

    def count_canvas_assets(self, *, kind: str = "image", source_group: str = "") -> int:
        where = ["kind = ?"]
        params: list[Any] = [str(kind or "image").strip() or "image"]
        source_clause = self._canvas_asset_source_clause(source_group)
        if source_clause:
            where.append(source_clause)
        query = f"SELECT COUNT(1) AS total FROM assets WHERE {' AND '.join(where)}"
        with self._connect() as connection:
            row = connection.execute(query, params).fetchone()
        return int(row["total"] if isinstance(row, sqlite3.Row) else row[0])

    def list_canvas_assets_page(
        self,
        *,
        kind: str = "image",
        source_group: str = "",
        limit: int = 60,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        where = ["kind = ?"]
        params: list[Any] = [str(kind or "image").strip() or "image"]
        source_clause = self._canvas_asset_source_clause(source_group)
        if source_clause:
            where.append(source_clause)
        query = f"""
            SELECT *
            FROM assets
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
            LIMIT ? OFFSET ?
        """
        params.extend([max(0, int(limit or 0)), max(0, int(offset or 0))])
        with self._connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [self._deserialize_asset_row(row) for row in rows]

    def get_canvas_state(self, state_id: str = "default") -> dict[str, Any] | None:
        normalized_id = str(state_id or "default").strip() or "default"
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload_json, updated_at FROM canvas_state WHERE id = ?",
                (normalized_id,),
            ).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict):
            payload["updated_at"] = row["updated_at"]
            return payload
        return {"version": 2, "nodes": [], "edges": [], "viewport": {}, "updated_at": row["updated_at"]}

    def save_canvas_state(self, payload: dict[str, Any], state_id: str = "default") -> dict[str, Any]:
        normalized_id = str(state_id or "default").strip() or "default"
        now = _utc_now()
        normalized_payload = dict(payload or {})
        normalized_payload.pop("updated_at", None)
        payload_json = json.dumps(normalized_payload, ensure_ascii=False)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO canvas_state (id, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (normalized_id, payload_json, now, now),
            )
        saved = dict(normalized_payload)
        saved["updated_at"] = now
        return saved

    def find_asset_by_path(self, path: str | Path) -> dict[str, Any] | None:
        normalized = str(Path(path).expanduser().resolve())
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM assets WHERE path = ? LIMIT 1",
                (normalized,),
            ).fetchone()
        return self._deserialize_asset_row(row) if row is not None else None

    def find_asset_by_content_hash(
        self,
        content_hash: str | None,
        *,
        kind: str | None = None,
        library_visible: bool | None = None,
    ) -> dict[str, Any] | None:
        normalized = str(content_hash or "").strip().lower()
        if not normalized:
            return None
        where = ["content_hash = ?"]
        params: list[Any] = [normalized]
        if kind:
            where.append("kind = ?")
            params.append(str(kind).strip())
        if library_visible is not None:
            where.append("library_visible = ?")
            params.append(1 if library_visible else 0)
        query = f"""
            SELECT *
            FROM assets
            WHERE {' AND '.join(where)}
            ORDER BY library_visible DESC, COALESCE(updated_at, created_at) DESC, created_at DESC
            LIMIT 1
        """
        with self._connect() as connection:
            row = connection.execute(query, params).fetchone()
        return self._deserialize_asset_row(row) if row is not None else None

    def update_asset_content_hash(self, asset_id: str, content_hash: str | None) -> dict[str, Any]:
        current = self.get_asset(asset_id)
        if not current:
            raise KeyError(f"asset not found: {asset_id}")
        normalized = str(content_hash or "").strip().lower() or None
        updated_at = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE assets
                SET content_hash = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (normalized, updated_at, asset_id),
            )
        return self._asset_item_from_values(
            asset_id=asset_id,
            kind=str(current.get("kind") or ""),
            original_name=str(current.get("original_name") or ""),
            display_name=current.get("display_name"),
            tag_category=current.get("tag_category"),
            origin=str(current.get("origin") or "workspace"),
            library_visible=bool(current.get("library_visible")),
            source_mode=current.get("source_mode"),
            source_path=current.get("source_path"),
            source_root=current.get("source_root"),
            path=str(current.get("path") or ""),
            thumbnail_path=current.get("thumbnail_path"),
            mime_type=current.get("mime_type"),
            content_hash=normalized,
            created_at=str(current.get("created_at") or updated_at),
            updated_at=updated_at,
        )

    def delete_assets_by_paths(self, paths: list[str | Path]) -> list[dict[str, Any]]:
        normalized_paths = sorted({
            str(Path(path).expanduser().resolve())
            for path in paths
            if str(path or "").strip()
        })
        if not normalized_paths:
            return []
        placeholders = ",".join("?" for _ in normalized_paths)
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM assets WHERE path IN ({placeholders})",
                normalized_paths,
            ).fetchall()
            if rows:
                connection.execute(
                    f"DELETE FROM assets WHERE path IN ({placeholders})",
                    normalized_paths,
                )
        return [self._deserialize_asset_row(row) for row in rows]

    def delete_asset(self, asset_id: str) -> dict[str, Any] | None:
        asset = self.get_asset(asset_id)
        if not asset:
            return None
        with self._connect() as connection:
            connection.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
        return asset

    def list_library_assets(
        self,
        *,
        tag_category: str | None = None,
        tag_categories: list[str] | tuple[str, ...] | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        where = [
            "kind = 'image'",
            "library_visible = 1",
            "tag_category IS NOT NULL",
            "tag_category != ''",
        ]
        params: list[Any] = []
        normalized_categories: list[str] = []
        seen_categories: set[str] = set()
        for value in list(tag_categories or []):
            normalized = str(value or "").strip()
            if not normalized or normalized in seen_categories:
                continue
            seen_categories.add(normalized)
            normalized_categories.append(normalized)
        normalized_category = str(tag_category or "").strip()
        if normalized_category and not normalized_categories:
            normalized_categories.append(normalized_category)
        if normalized_categories:
            placeholders = ", ".join("?" for _ in normalized_categories)
            if len(normalized_categories) == 1:
                where.append("tag_category = ?")
            else:
                where.append(f"tag_category IN ({placeholders})")
            params.extend(normalized_categories)
        query = f"""
            SELECT * FROM assets
            WHERE {' AND '.join(where)}
            ORDER BY tag_category ASC, COALESCE(updated_at, created_at) DESC, created_at DESC
        """
        next_offset = max(0, int(offset or 0))
        if limit is not None:
            next_limit = max(0, int(limit))
            query += " LIMIT ? OFFSET ?"
            params.extend([next_limit, next_offset])
        elif next_offset:
            query += " LIMIT -1 OFFSET ?"
            params.append(next_offset)
        with self._connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [self._deserialize_asset_row(row) for row in rows]

    def count_library_assets(
        self,
        *,
        tag_category: str | None = None,
        tag_categories: list[str] | tuple[str, ...] | None = None,
    ) -> int:
        where = [
            "kind = 'image'",
            "library_visible = 1",
            "tag_category IS NOT NULL",
            "tag_category != ''",
        ]
        params: list[Any] = []
        normalized_categories: list[str] = []
        seen_categories: set[str] = set()
        for value in list(tag_categories or []):
            normalized = str(value or "").strip()
            if not normalized or normalized in seen_categories:
                continue
            seen_categories.add(normalized)
            normalized_categories.append(normalized)
        normalized_category = str(tag_category or "").strip()
        if normalized_category and not normalized_categories:
            normalized_categories.append(normalized_category)
        if normalized_categories:
            placeholders = ", ".join("?" for _ in normalized_categories)
            if len(normalized_categories) == 1:
                where.append("tag_category = ?")
            else:
                where.append(f"tag_category IN ({placeholders})")
            params.extend(normalized_categories)
        query = f"""
            SELECT COUNT(1) AS total
            FROM assets
            WHERE {' AND '.join(where)}
        """
        with self._connect() as connection:
            row = connection.execute(query, params).fetchone()
        return int(row["total"] if isinstance(row, sqlite3.Row) else row[0])

    def list_library_asset_category_counts(self) -> dict[str, int]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT tag_category, COUNT(1) AS total
                FROM assets
                WHERE kind = 'image'
                  AND library_visible = 1
                  AND tag_category IS NOT NULL
                  AND tag_category != ''
                GROUP BY tag_category
                ORDER BY tag_category ASC
                """
            ).fetchall()
        counts: dict[str, int] = {}
        for row in rows:
            category = str(row["tag_category"] if isinstance(row, sqlite3.Row) else row[0]).strip()
            if not category:
                continue
            total = int(row["total"] if isinstance(row, sqlite3.Row) else row[1])
            counts[category] = total
        return counts

    def list_distinct_asset_categories(self) -> list[str]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT DISTINCT tag_category
                FROM assets
                WHERE tag_category IS NOT NULL
                  AND tag_category != ''
                ORDER BY tag_category ASC
                """
            ).fetchall()
        return [
            str(row["tag_category"] if isinstance(row, sqlite3.Row) else row[0]).strip()
            for row in rows
            if str(row["tag_category"] if isinstance(row, sqlite3.Row) else row[0]).strip()
        ]

    def next_default_asset_name(self, tag_category: str) -> str:
        normalized = str(tag_category or "").strip()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(1) AS total
                FROM assets
                WHERE kind = 'image'
                  AND library_visible = 1
                  AND tag_category = ?
                """,
                (normalized,),
            ).fetchone()
        total = int(row["total"] if isinstance(row, sqlite3.Row) else row[0])
        return f"默认{normalized}{total + 1}"

    def set_library_source(self, source_dir: str) -> dict[str, Any]:
        now = _utc_now()
        current = self.get_library_source()
        same_source = current and str(current.get("source_dir") or "").strip() == source_dir
        connected_at = (
            str(current.get("connected_at") or "").strip()
            if same_source
            else now
        )
        last_refreshed_at = str(current.get("last_refreshed_at") or "").strip() if same_source else None
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO library_source (id, source_dir, connected_at, updated_at, last_refreshed_at)
                VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source_dir = excluded.source_dir,
                    connected_at = excluded.connected_at,
                    updated_at = excluded.updated_at
                """,
                (source_dir, connected_at, now, last_refreshed_at),
            )
        return self.get_library_source() or {}

    def touch_library_source_refreshed(self, source_dir: str) -> dict[str, Any]:
        now = _utc_now()
        current = self.get_library_source()
        connected_at = (
            str(current.get("connected_at") or "").strip()
            if current and str(current.get("source_dir") or "").strip() == source_dir
            else now
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO library_source (id, source_dir, connected_at, updated_at, last_refreshed_at)
                VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source_dir = excluded.source_dir,
                    connected_at = excluded.connected_at,
                    updated_at = excluded.updated_at,
                    last_refreshed_at = excluded.last_refreshed_at
                """,
                (source_dir, connected_at, now, now),
            )
        return self.get_library_source() or {}

    def get_library_source(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM library_source WHERE id = 1"
            ).fetchone()
        return dict(row) if row is not None else None

    def clear_library_source(self) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM library_source WHERE id = 1")

    def find_asset_by_source(self, *, source_root: str, source_path: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM assets
                WHERE source_root = ? AND source_path = ?
                LIMIT 1
                """,
                (source_root, source_path),
            ).fetchone()
        return self._deserialize_asset_row(row) if row is not None else None

    def list_assets_by_source_root(self, source_root: str, *, source_mode: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM assets WHERE source_root = ?"
        params: list[Any] = [source_root]
        if source_mode is not None:
            sql += " AND source_mode = ?"
            params.append(source_mode)
        with self._connect() as connection:
            rows = connection.execute(sql, tuple(params)).fetchall()
        return [self._deserialize_asset_row(row) for row in rows]

    def list_library_source_assets(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM assets
                WHERE origin = 'library_source'
                ORDER BY tag_category ASC, COALESCE(updated_at, created_at) DESC, created_at DESC
                """
            ).fetchall()
        return [self._deserialize_asset_row(row) for row in rows]

    def apply_library_source_snapshot(
        self,
        *,
        source_dir: str,
        upserts: list[dict[str, Any]],
        delete_asset_ids: list[str],
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        now = _utc_now()
        synced_assets: list[dict[str, Any]] = []
        source_meta: dict[str, Any] | None = None
        normalized_delete_ids = [
            str(asset_id or "").strip()
            for asset_id in delete_asset_ids
            if str(asset_id or "").strip()
        ]
        with self._connect() as connection:
            current_source = connection.execute(
                "SELECT * FROM library_source WHERE id = 1"
            ).fetchone()
            current_source_dir = (
                str(current_source["source_dir"] or "").strip()
                if current_source is not None
                else ""
            )
            connected_at = (
                str(current_source["connected_at"] or "").strip()
                if current_source is not None and current_source_dir == source_dir
                else now
            )

            for asset_id in normalized_delete_ids:
                connection.execute("DELETE FROM assets WHERE id = ?", (asset_id,))

            for item in upserts:
                existing_id = str(item.get("existing_id") or "").strip()
                original_name = str(item.get("original_name") or "").strip()
                display_name = str(item.get("display_name") or "").strip() or None
                tag_category = item.get("tag_category")
                path = str(item.get("path") or "").strip()
                mime_type = item.get("mime_type")
                content_hash = str(item.get("content_hash") or "").strip().lower() or None
                source_path = str(item.get("source_path") or "").strip() or None
                source_root = str(item.get("source_root") or "").strip() or None
                if existing_id:
                    row = connection.execute(
                        "SELECT * FROM assets WHERE id = ?",
                        (existing_id,),
                    ).fetchone()
                    if row is None:
                        raise KeyError(f"asset not found: {existing_id}")
                    created_at = str(row["created_at"] or now)
                    connection.execute(
                        """
                        UPDATE assets
                        SET original_name = ?,
                            display_name = ?,
                            tag_category = ?,
                            origin = ?,
                            library_visible = ?,
                            source_mode = ?,
                            source_path = ?,
                            source_root = ?,
                            path = ?,
                            thumbnail_path = ?,
                            mime_type = ?,
                            content_hash = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            original_name,
                            display_name,
                            tag_category,
                            "library_source",
                            1,
                            "copy_import",
                            source_path,
                            source_root,
                            path,
                            item.get("thumbnail_path"),
                            mime_type,
                            content_hash,
                            now,
                            existing_id,
                        ),
                    )
                    synced_assets.append(
                        self._asset_item_from_values(
                            asset_id=existing_id,
                            kind="image",
                            original_name=original_name,
                            display_name=display_name,
                            tag_category=tag_category,
                            origin="library_source",
                            library_visible=True,
                            source_mode="copy_import",
                            source_path=source_path,
                            source_root=source_root,
                            path=path,
                            thumbnail_path=item.get("thumbnail_path"),
                            mime_type=mime_type,
                            content_hash=content_hash,
                            created_at=created_at,
                            updated_at=now,
                        )
                    )
                    continue

                asset_id = uuid.uuid4().hex
                connection.execute(
                    """
                    INSERT INTO assets (
                        id, kind, original_name, display_name, tag_category,
                        origin, library_visible, source_mode, source_path, source_root,
                        path, thumbnail_path, mime_type, content_hash, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        asset_id,
                        "image",
                        original_name,
                        display_name,
                        tag_category,
                        "library_source",
                        1,
                        "copy_import",
                        source_path,
                        source_root,
                        path,
                        item.get("thumbnail_path"),
                        mime_type,
                        content_hash,
                        now,
                        now,
                    ),
                )
                synced_assets.append(
                    self._asset_item_from_values(
                        asset_id=asset_id,
                        kind="image",
                        original_name=original_name,
                        display_name=display_name,
                        tag_category=tag_category,
                        origin="library_source",
                        library_visible=True,
                        source_mode="copy_import",
                        source_path=source_path,
                        source_root=source_root,
                        path=path,
                        thumbnail_path=item.get("thumbnail_path"),
                        mime_type=mime_type,
                        content_hash=content_hash,
                        created_at=now,
                        updated_at=now,
                    )
                )

            connection.execute(
                """
                INSERT INTO library_source (id, source_dir, connected_at, updated_at, last_refreshed_at)
                VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source_dir = excluded.source_dir,
                    connected_at = excluded.connected_at,
                    updated_at = excluded.updated_at,
                    last_refreshed_at = excluded.last_refreshed_at
                """,
                (source_dir, connected_at, now, now),
            )
            row = connection.execute(
                "SELECT * FROM library_source WHERE id = 1"
            ).fetchone()
            source_meta = dict(row) if row is not None else None
        return synced_assets, (source_meta or {})

    def remove_missing_external_assets(self, source_root: str, keep_source_paths: set[str]) -> list[dict[str, Any]]:
        removable = [
            item
            for item in self.list_assets_by_source_root(source_root, source_mode="external_mount")
            if str(item.get("source_path") or "") not in keep_source_paths
        ]
        with self._connect() as connection:
            for item in removable:
                connection.execute("DELETE FROM assets WHERE id = ?", (item["id"],))
        return removable

    def update_asset_source_entry(
        self,
        asset_id: str,
        *,
        display_name: str | None = None,
        tag_category: str | None = None,
        origin: str | None = None,
        library_visible: bool | None = None,
        path: str | None = None,
        thumbnail_path: str | None = None,
        mime_type: str | None = None,
        source_mode: str | None = None,
        source_path: str | None = None,
        source_root: str | None = None,
        content_hash: str | None = None,
    ) -> dict[str, Any]:
        current = self.get_asset(asset_id)
        if not current:
            raise KeyError(f"asset not found: {asset_id}")
        next_display_name = display_name if display_name is not None else current.get("display_name")
        next_tag_category = tag_category if tag_category is not None else current.get("tag_category")
        next_origin = origin if origin is not None else current.get("origin")
        next_library_visible = (
            1 if library_visible else 0 if library_visible is not None else int(bool(current.get("library_visible")))
        )
        next_path = path if path is not None else current.get("path")
        next_thumbnail_path = thumbnail_path if thumbnail_path is not None else current.get("thumbnail_path")
        next_mime_type = mime_type if mime_type is not None else current.get("mime_type")
        next_content_hash = (
            str(content_hash or "").strip().lower()
            if content_hash is not None
            else current.get("content_hash")
        )
        next_source_mode = source_mode if source_mode is not None else current.get("source_mode")
        next_source_path = source_path if source_path is not None else current.get("source_path")
        next_source_root = source_root if source_root is not None else current.get("source_root")
        updated_at = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE assets
                SET display_name = ?,
                    tag_category = ?,
                    origin = ?,
                    library_visible = ?,
                    path = ?,
                    thumbnail_path = ?,
                    mime_type = ?,
                    content_hash = ?,
                    source_mode = ?,
                    source_path = ?,
                    source_root = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    next_display_name,
                    next_tag_category,
                    next_origin,
                    next_library_visible,
                    next_path,
                    next_thumbnail_path,
                    next_mime_type,
                    next_content_hash,
                    next_source_mode,
                    next_source_path,
                    next_source_root,
                    updated_at,
                    asset_id,
                ),
            )
        return self._asset_item_from_values(
            asset_id=asset_id,
            kind=str(current.get("kind") or ""),
            original_name=str(current.get("original_name") or ""),
            display_name=next_display_name,
            tag_category=next_tag_category,
            origin=str(next_origin or "workspace"),
            library_visible=bool(next_library_visible),
            source_mode=next_source_mode,
            source_path=next_source_path,
            source_root=next_source_root,
            path=str(next_path or ""),
            thumbnail_path=next_thumbnail_path,
            mime_type=next_mime_type,
            content_hash=next_content_hash,
            created_at=str(current.get("created_at") or updated_at),
            updated_at=updated_at,
        )

    def create_history_record(
        self,
        *,
        job_id: str,
        batch_session_id: str | None = None,
        batch_position: int | None = None,
        kind: str,
        status: str,
        model_variant: str,
        mode_key: str | None = None,
        prompt: str,
        params_requested: dict[str, Any],
    ) -> dict[str, Any]:
        record_id = uuid.uuid4().hex
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO history (
                    id, job_id, batch_session_id, batch_position, kind, status, model_variant, mode_key, prompt,
                    params_requested, params_actual, result_payload,
                    local_paths, thumbnail_path, error_message, elapsed_ms,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', '[]', NULL, NULL, NULL, ?, ?)
                """,
                (
                    record_id,
                    job_id,
                    batch_session_id,
                    batch_position,
                    kind,
                    status,
                    model_variant,
                    mode_key,
                    prompt,
                    json.dumps(params_requested, ensure_ascii=False),
                    now,
                    now,
                ),
            )
        return self._history_item_from_values(
            record_id=record_id,
            job_id=job_id,
            batch_session_id=batch_session_id,
            batch_position=batch_position,
            kind=kind,
            status=status,
            model_variant=model_variant,
            mode_key=mode_key,
            prompt=prompt,
            params_requested=params_requested,
            created_at=now,
            updated_at=now,
        )

    def update_history_record(
        self,
        record_id: str,
        *,
        status: str | None = None,
        params_actual: dict[str, Any] | None = None,
        result_payload: dict[str, Any] | None = None,
        local_paths: list[str] | None = None,
        thumbnail_path: str | None = None,
        error_message: str | None = None,
        elapsed_ms: int | None = None,
    ) -> dict[str, Any]:
        current = self.get_history(record_id)
        if not current:
            raise KeyError(f"history record not found: {record_id}")
        next_status = status or current["status"]
        next_params_actual = params_actual if params_actual is not None else current["params_actual"]
        next_result_payload = result_payload if result_payload is not None else current["result_payload"]
        next_local_paths = local_paths if local_paths is not None else current["local_paths"]
        next_thumb = thumbnail_path if thumbnail_path is not None else current["thumbnail_path"]
        next_error = error_message if error_message is not None else current["error_message"]
        next_elapsed_ms = elapsed_ms if elapsed_ms is not None else current.get("elapsed_ms")
        updated_at = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE history
                SET status = ?,
                    params_actual = ?,
                    result_payload = ?,
                    local_paths = ?,
                    thumbnail_path = ?,
                    error_message = ?,
                    elapsed_ms = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    next_status,
                    json.dumps(next_params_actual, ensure_ascii=False),
                    json.dumps(next_result_payload, ensure_ascii=False),
                    json.dumps(next_local_paths, ensure_ascii=False),
                    next_thumb,
                    next_error,
                    next_elapsed_ms,
                    updated_at,
                    record_id,
                ),
            )
        return self._history_item_from_values(
            record_id=record_id,
            job_id=str(current.get("job_id") or ""),
            batch_session_id=current.get("batch_session_id"),
            batch_position=current.get("batch_position"),
            kind=str(current.get("kind") or ""),
            status=next_status,
            model_variant=str(current.get("model_variant") or ""),
            mode_key=current.get("mode_key"),
            prompt=str(current.get("prompt") or ""),
            params_requested=current.get("params_requested") or {},
            params_actual=next_params_actual,
            result_payload=next_result_payload,
            local_paths=next_local_paths,
            thumbnail_path=next_thumb,
            error_message=next_error,
            elapsed_ms=next_elapsed_ms,
            created_at=str(current.get("created_at") or updated_at),
            updated_at=updated_at,
        )

    def reconcile_orphan_history_records(
        self,
        kind: str,
        *,
        active_job_ids: set[str],
        orphan_after_seconds: int,
        candidate_statuses: set[str],
        resolved_status: str,
        error_message: str,
        status_grace_overrides: dict[str, int] | None = None,
    ) -> int:
        if not candidate_statuses:
            return 0
        placeholders = ", ".join("?" for _ in candidate_statuses)
        grace_overrides = {
            str(status or "").strip(): max(0, int(seconds))
            for status, seconds in (status_grace_overrides or {}).items()
            if str(status or "").strip()
        }
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, job_id, status, created_at, updated_at, elapsed_ms
                FROM history
                WHERE kind = ?
                  AND status IN ({placeholders})
                """,
                (kind, *sorted(candidate_statuses)),
            ).fetchall()
        now = datetime.now(timezone.utc)
        updated = 0
        for row in rows:
            job_id = str(row["job_id"] or "")
            if job_id in active_job_ids:
                continue
            status = str(row["status"] or "").strip()
            created_at = _parse_iso_datetime(row["created_at"])
            activity_at = _parse_iso_datetime(row["updated_at"]) or _parse_iso_datetime(row["created_at"])
            if not activity_at:
                continue
            age_seconds = (now - activity_at).total_seconds()
            grace_seconds = grace_overrides.get(status, orphan_after_seconds)
            if age_seconds <= grace_seconds:
                continue
            created_age_ms = max(0, int((now - created_at).total_seconds() * 1000)) if created_at else 0
            elapsed_ms = max(int(row["elapsed_ms"] or 0), created_age_ms, max(0, int(age_seconds * 1000)))
            self.update_history_record(
                str(row["id"]),
                status=resolved_status,
                error_message=error_message,
                elapsed_ms=elapsed_ms,
            )
            updated += 1
        return updated

    def count_history(self, kind: str) -> int:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(1) AS total
                FROM history
                WHERE kind = ?
                  AND NOT (
                    status = 'succeeded'
                    AND job_id LIKE 'remote-sync:%'
                    AND (
                      error_message LIKE '本地补救失败:%'
                      OR result_payload LIKE ?
                    )
                  )
                """,
                (kind, '%"_local_repair": {"status": "failed"%'),
            ).fetchone()
        return int(row["total"] if isinstance(row, sqlite3.Row) else row[0])

    def list_history_page(self, kind: str, limit: int = 60, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM history
                WHERE kind = ?
                  AND NOT (
                    status = 'succeeded'
                    AND job_id LIKE 'remote-sync:%'
                    AND (
                      error_message LIKE '本地补救失败:%'
                      OR result_payload LIKE ?
                    )
                  )
                ORDER BY created_at DESC
                LIMIT ?
                OFFSET ?
                """,
                (kind, '%"_local_repair": {"status": "failed"%', limit, offset),
            ).fetchall()
            total_row = connection.execute(
                """
                SELECT COUNT(1) AS total
                FROM history
                WHERE kind = ?
                  AND NOT (
                    status = 'succeeded'
                    AND job_id LIKE 'remote-sync:%'
                    AND (
                      error_message LIKE '本地补救失败:%'
                      OR result_payload LIKE ?
                    )
                  )
                """,
                (kind, '%"_local_repair": {"status": "failed"%'),
            ).fetchone()
        total = int(total_row["total"] if isinstance(total_row, sqlite3.Row) else total_row[0])
        return [self._deserialize_history_row(row) for row in rows], total

    def list_history(self, kind: str, limit: int = 60, offset: int = 0) -> list[dict[str, Any]]:
        items, _ = self.list_history_page(kind, limit=limit, offset=offset)
        return items

    def list_failed_history(self, kind: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM history
                WHERE kind = ?
                  AND status = 'failed'
                ORDER BY created_at DESC
                """,
                (kind,),
            ).fetchall()
        return [self._deserialize_history_row(row) for row in rows]

    def list_duration_points(self, kind: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, created_at, updated_at, elapsed_ms, status, model_variant
                FROM history
                WHERE kind = ?
                  AND status = 'succeeded'
                ORDER BY created_at ASC
                """,
                (kind,),
            ).fetchall()
        items = []
        for index, row in enumerate(rows, start=1):
            elapsed_ms = row["elapsed_ms"]
            if elapsed_ms is None:
                elapsed_ms = _fallback_elapsed_ms(row["created_at"], row["updated_at"])
            items.append(
                {
                    "history_id": row["id"],
                    "created_at": row["created_at"],
                    "sequence": index,
                    "elapsed_ms": elapsed_ms,
                    "status": row["status"],
                    "model_variant": row["model_variant"],
                    "is_live": False,
                }
            )
        return items

    def list_duration_records(self, kind: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, created_at, updated_at, elapsed_ms, status, model_variant, mode_key, params_requested
                FROM history
                WHERE kind = ?
                  AND status = 'succeeded'
                ORDER BY created_at ASC
                """,
                (kind,),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for index, row in enumerate(rows, start=1):
            elapsed_ms = row["elapsed_ms"]
            if elapsed_ms is None:
                elapsed_ms = _fallback_elapsed_ms(row["created_at"], row["updated_at"])
            params_requested = json.loads(row["params_requested"] or "{}")
            items.append(
                {
                    "history_id": row["id"],
                    "created_at": row["created_at"],
                    "sequence": index,
                    "elapsed_ms": elapsed_ms,
                    "status": row["status"],
                    "model_variant": row["model_variant"],
                    "mode_key": row["mode_key"],
                    "params_requested": params_requested,
                    "is_live": False,
                }
            )
        return items

    def get_history(self, record_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM history WHERE id = ?",
                (record_id,),
            ).fetchone()
        if row is None:
            return None
        return self._deserialize_history_row(row)

    def find_video_history_by_remote_task_id(self, remote_task_id: str) -> dict[str, Any] | None:
        normalized = str(remote_task_id or "").strip()
        if not normalized:
            return None
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT *
                FROM history
                WHERE kind = 'video'
                  AND json_extract(params_actual, '$.remote_task_id') = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (normalized,),
            ).fetchone()
        if row is None:
            return None
        return self._deserialize_history_row(row)

    def delete_history_record(self, record_id: str) -> dict[str, Any] | None:
        record = self.get_history(record_id)
        if not record:
            return None
        with self._connect() as connection:
            connection.execute("DELETE FROM history WHERE id = ?", (record_id,))
        return record

    def persist_history_snapshots(self, updates: list[dict[str, Any]]) -> None:
        normalized_updates = []
        for item in updates:
            record_id = str(item.get("id") or "").strip()
            if not record_id:
                continue
            normalized_updates.append(
                (
                    item.get("mode_key"),
                    json.dumps(item.get("params_requested") or {}, ensure_ascii=False),
                    record_id,
                )
            )
        if not normalized_updates:
            return
        with self._connect() as connection:
            connection.executemany(
                """
                UPDATE history
                SET mode_key = ?,
                    params_requested = ?
                WHERE id = ?
                """,
                normalized_updates,
            )

    def _deserialize_history_row(self, row: sqlite3.Row) -> dict[str, Any]:
        raw = dict(row)
        return self._history_item_from_values(
            record_id=raw["id"],
            job_id=raw["job_id"],
            batch_session_id=raw.get("batch_session_id"),
            batch_position=raw.get("batch_position"),
            kind=raw["kind"],
            status=raw["status"],
            model_variant=raw["model_variant"],
            mode_key=raw.get("mode_key"),
            prompt=raw["prompt"],
            params_requested=json.loads(raw["params_requested"] or "{}"),
            params_actual=json.loads(raw["params_actual"] or "{}"),
            result_payload=json.loads(raw["result_payload"] or "{}"),
            local_paths=json.loads(raw["local_paths"] or "[]"),
            thumbnail_path=raw.get("thumbnail_path"),
            error_message=raw.get("error_message"),
            elapsed_ms=raw.get("elapsed_ms"),
            created_at=raw.get("created_at"),
            updated_at=raw.get("updated_at"),
        )

    def _deserialize_asset_row(self, row: sqlite3.Row) -> dict[str, Any]:
        raw = dict(row)
        return self._asset_item_from_values(
            asset_id=raw["id"],
            kind=raw["kind"],
            original_name=raw["original_name"],
            display_name=raw.get("display_name"),
            tag_category=raw.get("tag_category"),
            origin=raw.get("origin") or "workspace",
            library_visible=bool(raw.get("library_visible")),
            source_mode=raw.get("source_mode"),
            source_path=raw.get("source_path"),
            source_root=raw.get("source_root"),
            path=raw["path"],
            thumbnail_path=raw.get("thumbnail_path"),
            mime_type=raw.get("mime_type"),
            content_hash=raw.get("content_hash"),
            created_at=raw["created_at"],
            updated_at=raw.get("updated_at"),
        )

    @staticmethod
    def _record_has_existing_local_file(path_value: str | None) -> bool:
        candidate = str(path_value or "").strip()
        if not candidate:
            return False
        try:
            return Path(candidate).expanduser().resolve().is_file()
        except OSError:
            return False

    def _video_record_needs_repair(self, record: dict[str, Any]) -> bool:
        artifacts = list((record.get("result_payload") or {}).get("artifacts") or [])
        artifact = dict(artifacts[0]) if artifacts else {}
        local_candidates = [artifact.get("local_path"), *(record.get("local_paths") or [])]
        has_local_video = any(self._record_has_existing_local_file(item) for item in local_candidates)
        if not has_local_video:
            return True
        thumbnail_candidates = [artifact.get("thumbnail_path"), record.get("thumbnail_path")]
        return not any(self._record_has_existing_local_file(item) for item in thumbnail_candidates)

    @staticmethod
    def _record_has_local_repair_failure_marker(record: dict[str, Any]) -> bool:
        result_payload = dict(record.get("result_payload") or {})
        repair_state = dict(result_payload.get("_local_repair") or {})
        if str(repair_state.get("status") or "").strip() == "failed":
            return True
        return str(record.get("error_message") or "").startswith("本地补救失败:")

    def list_recoverable_video_jobs(
        self,
        *,
        candidate_statuses: set[str] | list[str] | tuple[str, ...],
        limit: int = 120,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        normalized_statuses = sorted({str(item or "").strip() for item in candidate_statuses if str(item or "").strip()})
        if not normalized_statuses:
            return []
        placeholders = ", ".join("?" for _ in normalized_statuses)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT * FROM history
                WHERE kind = 'video'
                  AND status IN ({placeholders})
                ORDER BY created_at DESC
                LIMIT ?
                OFFSET ?
                """,
                (*normalized_statuses, max(1, int(limit)), max(0, int(offset))),
            ).fetchall()
        records = [self._deserialize_history_row(row) for row in rows]
        return [
            item
            for item in records
            if str((item.get("params_actual") or {}).get("remote_task_id") or "").strip()
        ]

    def list_repair_candidates(self, kind: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM history
                WHERE kind = ?
                  AND status = 'succeeded'
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (kind, max(20, int(limit) * 6)),
            ).fetchall()
        records = [self._deserialize_history_row(row) for row in rows]
        records = [item for item in records if not self._record_has_local_repair_failure_marker(item)]
        if kind == "image":
            candidates = [item for item in records if not (item.get("local_paths") or [])]
        elif kind == "video":
            candidates = [item for item in records if self._video_record_needs_repair(item)]
        else:
            candidates = []
        return candidates[: max(1, int(limit))]


class HistoryStoreRegistry:
    def __init__(self) -> None:
        self._stores: dict[str, HistoryStore] = {}
        self._lock = threading.Lock()

    def for_storage_dir(self, storage_root: str | Path) -> HistoryStore:
        storage = ensure_storage_paths(storage_root)
        key = str(storage.repository_db)
        with self._lock:
            store = self._stores.get(key)
            if store is None:
                store = HistoryStore(storage.repository_db)
                self._stores[key] = store
            return store
