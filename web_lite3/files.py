from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import os
import shutil
import subprocess
import threading
import uuid
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urlparse
from typing import BinaryIO

import requests
from PIL import Image, ImageOps, UnidentifiedImageError


_DOWNLOAD_SESSION = requests.Session()
_DATA_URL_CACHE_LOCK = threading.Lock()
_DATA_URL_CACHE_MAX_ITEMS = 24
_DATA_URL_CACHE_MAX_BYTES = 24 * 1024 * 1024
_DATA_URL_CACHE: "OrderedDict[tuple[str, int, int, str], tuple[str, int]]" = OrderedDict()
_DATA_URL_CACHE_BYTES = 0
_API_IMAGE_DATA_URL_MAX_BYTES = 9 * 1024 * 1024


def _default_runtime_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _guess_extension(filename: str, mime_type: str | None = None) -> str:
    candidate = str(filename or "").strip()
    if candidate.startswith("http://") or candidate.startswith("https://"):
        candidate = urlparse(candidate).path
    suffix = Path(candidate).suffix.strip()
    if suffix:
        return suffix.lower()
    guessed = mimetypes.guess_extension(mime_type or "")
    return guessed or ".bin"


def save_upload_stream(
    *,
    source: BinaryIO,
    filename: str,
    target_dir: str | Path,
    mime_type: str | None = None,
    prefix: str = "asset",
) -> Path:
    target_root = Path(target_dir)
    target_root.mkdir(parents=True, exist_ok=True)
    extension = _guess_extension(filename, mime_type)
    target_path = target_root / f"{prefix}_{uuid.uuid4().hex}{extension}"
    with target_path.open("wb") as handle:
        shutil.copyfileobj(source, handle)
    return target_path


def file_sha256(path: str | Path, *, chunk_size: int = 1024 * 1024) -> str | None:
    resolved = Path(path).expanduser().resolve()
    if not resolved.exists() or not resolved.is_file():
        return None
    digest = hashlib.sha256()
    with resolved.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            if chunk:
                digest.update(chunk)
    return digest.hexdigest()


def file_to_data_url(path: str | Path, mime_type: str | None = None) -> str:
    resolved = Path(path).resolve()
    resolved_mime = mime_type or mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    stat = resolved.stat()
    cache_key = (str(resolved), stat.st_mtime_ns, stat.st_size, resolved_mime)
    with _DATA_URL_CACHE_LOCK:
        cached = _DATA_URL_CACHE.get(cache_key)
        if cached is not None:
            _DATA_URL_CACHE.move_to_end(cache_key)
            return cached[0]
    payload = resolved.read_bytes()
    encoded = base64.b64encode(payload).decode("ascii")
    data_url = f"data:{resolved_mime};base64,{encoded}"
    payload_size = len(data_url)
    if payload_size > _DATA_URL_CACHE_MAX_BYTES:
        return data_url
    with _DATA_URL_CACHE_LOCK:
        global _DATA_URL_CACHE_BYTES
        stale_keys = [key for key in _DATA_URL_CACHE.keys() if key[0] == cache_key[0] and key != cache_key]
        for stale_key in stale_keys:
            _, stale_size = _DATA_URL_CACHE.pop(stale_key)
            _DATA_URL_CACHE_BYTES -= stale_size
        _DATA_URL_CACHE[cache_key] = (data_url, payload_size)
        _DATA_URL_CACHE.move_to_end(cache_key)
        _DATA_URL_CACHE_BYTES += payload_size
        while _DATA_URL_CACHE and (
            len(_DATA_URL_CACHE) > _DATA_URL_CACHE_MAX_ITEMS or _DATA_URL_CACHE_BYTES > _DATA_URL_CACHE_MAX_BYTES
        ):
            _, (_, evicted_size) = _DATA_URL_CACHE.popitem(last=False)
            _DATA_URL_CACHE_BYTES -= evicted_size
    return data_url


def file_to_api_image_data_url(
    path: str | Path,
    mime_type: str | None = None,
    *,
    max_bytes: int = _API_IMAGE_DATA_URL_MAX_BYTES,
) -> str:
    """Return an image data URL small enough for upstream provider image-input limits.

    The source file is never modified. Large PNG/JPEG references are recompressed
    as JPEG in-memory because Ark image inputs currently reject files above 10 MiB.
    """
    resolved = Path(path).expanduser().resolve()
    resolved_mime = mime_type or mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    if not str(resolved_mime).lower().startswith("image/"):
        return file_to_data_url(resolved, resolved_mime)
    try:
        if resolved.stat().st_size <= max_bytes:
            return file_to_data_url(resolved, resolved_mime)
    except OSError:
        return file_to_data_url(resolved, resolved_mime)

    try:
        with Image.open(resolved) as raw_image:
            image = ImageOps.exif_transpose(raw_image)
            if "A" in image.getbands():
                background = Image.new("RGBA", image.size, (255, 255, 255, 255))
                background.alpha_composite(image.convert("RGBA"))
                image = background.convert("RGB")
            else:
                image = image.convert("RGB")
            original_width, original_height = image.size
            best_payload: bytes | None = None
            for max_side in (4096, 3072, 2560, 2048, 1600, 1280, 1024):
                working = image
                largest_side = max(original_width, original_height)
                if largest_side > max_side:
                    scale = max_side / largest_side
                    next_size = (
                        max(1, int(original_width * scale)),
                        max(1, int(original_height * scale)),
                    )
                    working = image.resize(next_size, Image.Resampling.LANCZOS)
                for quality in (88, 82, 76, 70, 64, 58, 52):
                    buffer = io.BytesIO()
                    working.save(buffer, format="JPEG", quality=quality, optimize=True)
                    payload = buffer.getvalue()
                    if best_payload is None or len(payload) < len(best_payload):
                        best_payload = payload
                    if len(payload) <= max_bytes:
                        encoded = base64.b64encode(payload).decode("ascii")
                        return f"data:image/jpeg;base64,{encoded}"
    except (OSError, UnidentifiedImageError):
        return file_to_data_url(resolved, resolved_mime)

    if best_payload:
        encoded = base64.b64encode(best_payload).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
    return file_to_data_url(resolved, resolved_mime)


def download_remote_file(
    url: str,
    *,
    target_dir: str | Path,
    prefix: str,
    timeout: int = 180,
    session: requests.Session | None = None,
    headers: dict[str, str] | None = None,
) -> Path:
    active_session = session or _DOWNLOAD_SESSION
    with active_session.get(url, stream=True, timeout=timeout, headers=headers) as response:
        response.raise_for_status()
        extension = _guess_extension(url, response.headers.get("Content-Type"))
        target_root = Path(target_dir)
        target_root.mkdir(parents=True, exist_ok=True)
        target_path = target_root / f"{prefix}_{uuid.uuid4().hex}{extension}"
        with target_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 64):
                if chunk:
                    handle.write(chunk)
    return target_path


def copy_local_file(
    source_path: str | Path,
    *,
    target_dir: str | Path,
    prefix: str,
) -> Path:
    source = Path(source_path).expanduser().resolve()
    extension = _guess_extension(source.name, mimetypes.guess_type(str(source))[0])
    target_root = Path(target_dir)
    target_root.mkdir(parents=True, exist_ok=True)
    target_path = target_root / f"{prefix}_{uuid.uuid4().hex}{extension}"
    shutil.copy2(source, target_path)
    return target_path


def save_binary_payload(
    payload: bytes,
    *,
    filename: str,
    target_dir: str | Path,
    mime_type: str | None = None,
    prefix: str = "asset",
) -> Path:
    target_root = Path(target_dir)
    target_root.mkdir(parents=True, exist_ok=True)
    extension = _guess_extension(filename, mime_type)
    target_path = target_root / f"{prefix}_{uuid.uuid4().hex}{extension}"
    target_path.write_bytes(payload)
    return target_path


def create_image_thumbnail(
    source_path: str | Path,
    *,
    target_dir: str | Path,
    prefix: str = "thumb",
    max_size: tuple[int, int] = (512, 512),
) -> Path | None:
    source = Path(source_path).expanduser().resolve()
    if not source.exists() or not source.is_file():
        return None
    target_root = Path(target_dir)
    target_root.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(source) as raw_image:
            image = ImageOps.exif_transpose(raw_image)
            has_alpha = "A" in image.getbands()
            if has_alpha:
                output = image.convert("RGBA")
                extension = ".png"
                save_kwargs = {"format": "PNG", "optimize": True}
            else:
                output = image.convert("RGB")
                extension = ".jpg"
                save_kwargs = {"format": "JPEG", "quality": 86, "optimize": True}
            output.thumbnail(max_size, Image.Resampling.LANCZOS)
            target_path = target_root / f"{prefix}_{uuid.uuid4().hex}{extension}"
            output.save(target_path, **save_kwargs)
            return target_path
    except (OSError, UnidentifiedImageError):
        return None


def resolve_runtime_tool(tool_name: str, *, root_dir: str | Path | None = None) -> Path | None:
    normalized = str(tool_name or "").strip()
    if not normalized:
        return None
    candidate_names = [normalized]
    if os.name == "nt" and not normalized.lower().endswith(".exe"):
        candidate_names.insert(0, f"{normalized}.exe")
    resolved_root = Path(root_dir or _default_runtime_root()).expanduser().resolve()
    for name in candidate_names:
        packaged = resolved_root / "ffmpeg" / "bin" / name
        if packaged.exists() and packaged.is_file():
            return packaged
    for name in candidate_names:
        found = shutil.which(name)
        if found:
            return Path(found).expanduser().resolve()
    return None


def _probe_video_duration_seconds(source_path: Path, *, root_dir: str | Path | None = None) -> float | None:
    ffprobe = resolve_runtime_tool("ffprobe", root_dir=root_dir)
    if ffprobe is None:
        return None
    try:
        completed = subprocess.run(
            [
                str(ffprobe),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(source_path),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    try:
        payload = json.loads(completed.stdout or "{}")
        duration = float(((payload.get("format") or {}).get("duration")) or 0)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if duration <= 0:
        return None
    return duration


def create_video_thumbnail(
    source_path: str | Path,
    *,
    target_dir: str | Path,
    prefix: str = "thumb",
    max_width: int = 512,
    root_dir: str | Path | None = None,
) -> Path | None:
    source = Path(source_path).expanduser().resolve()
    if not source.exists() or not source.is_file():
        return None
    ffmpeg = resolve_runtime_tool("ffmpeg", root_dir=root_dir)
    if ffmpeg is None:
        return None
    target_root = Path(target_dir)
    target_root.mkdir(parents=True, exist_ok=True)
    target_path = target_root / f"{prefix}_{uuid.uuid4().hex}.jpg"
    duration_seconds = _probe_video_duration_seconds(source, root_dir=root_dir)
    seek_seconds = 0.35
    if duration_seconds is not None:
        seek_seconds = min(max(duration_seconds * 0.08, 0.15), 1.5)
    command = [
        str(ffmpeg),
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{seek_seconds:.3f}",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        f"scale={max_width}:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        str(target_path),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0 or not target_path.exists() or target_path.stat().st_size <= 0:
        if target_path.exists():
            try:
                target_path.unlink()
            except OSError:
                pass
        return None
    return target_path


def is_supported_image_file(path: str | Path) -> bool:
    candidate = Path(path)
    if not candidate.is_file():
        return False
    mime_type, _ = mimetypes.guess_type(str(candidate))
    if mime_type and mime_type.startswith("image/"):
        return True
    return candidate.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


def public_file_url(local_path: str | Path, storage_root: str | Path) -> str:
    relative = Path(local_path).resolve().relative_to(Path(storage_root).resolve())
    return f"/app-files/{relative.as_posix()}"


def resolve_public_file(storage_root: str | Path, relative_path: str) -> Path:
    root = Path(storage_root).resolve()
    candidate = (root / relative_path).resolve()
    if root not in candidate.parents and candidate != root:
        raise PermissionError("forbidden path")
    return candidate
