from __future__ import annotations

import re
from typing import Any

GENERIC_MENTION_PATTERN = re.compile(r"@([^\s@]+)")
REFERENCE_ALIAS_PATTERN = re.compile(r"参考(?:图片|图像|图)?\s*([0-9０-９]+)")
GRID_DIRECTIVE_PATTERN = re.compile(r"^\s*in\s+([1-9])\s*x\s*([1-9])\s+grid\s*[,，]?\s*", re.IGNORECASE)
FULLWIDTH_DIGIT_TRANSLATION = str.maketrans("０１２３４５６７８９", "0123456789")
MENTION_BOUNDARY_PATTERN = re.compile(r"[\s@,.;:!?()\[\]{}<>\"'`~\\/|，。！？；：、】【（）《》〈〉、]")


def mention_labels(prompt: str) -> list[str]:
    return GENERIC_MENTION_PATTERN.findall(prompt or "")


def normalize_prompt_image_aliases(prompt: str, *, alias_prefix: str) -> str:
    text = str(prompt or "")
    if "参考" not in text:
        return text

    def replace(match: re.Match[str]) -> str:
        index = match.group(1).translate(FULLWIDTH_DIGIT_TRANSLATION)
        return f"{alias_prefix}{index}"

    return REFERENCE_ALIAS_PATTERN.sub(replace, text)


def normalize_prompt_grid_directive(prompt: str) -> str:
    text = str(prompt or "")

    def replace(match: re.Match[str]) -> str:
        return f"单张输出图采用{match.group(1)}x{match.group(2)}四宫格排版，"

    return GRID_DIRECTIVE_PATTERN.sub(replace, text)


def add_prompt_image_reference_legend(
    prompt: str,
    resolved_annotations: list[dict[str, Any]],
    *,
    alias_prefix: str,
) -> str:
    text = normalize_prompt_grid_directive(str(prompt or ""))
    if not resolved_annotations or text.lstrip().startswith("参考图顺序："):
        return text

    labels: list[str] = []
    for item in resolved_annotations:
        image_index = int(item.get("image_index") or 0)
        if image_index <= 0:
            continue
        name = str(item.get("mention_name") or item.get("tag_label") or "").strip()
        labels.append(f"{alias_prefix}{image_index}={name}" if name else f"{alias_prefix}{image_index}")
    if not labels:
        return text
    return f"参考图顺序：{'，'.join(labels)}。\n{text}"


def _is_mention_boundary(char: str) -> bool:
    return not char or bool(MENTION_BOUNDARY_PATTERN.match(char))


def _has_boundary(text: str, index: int) -> bool:
    return index >= len(text) or _is_mention_boundary(text[index])


def _read_unknown_candidate(text: str, start: int, max_length: int) -> tuple[str, int] | None:
    end = start
    while end < len(text) and not _is_mention_boundary(text[end]) and end - start < max_length:
        end += 1
    label = text[start:end].strip()
    if not label:
        return None
    return label, end


def _scan_prompt_mentions(
    prompt: str,
    known_labels: list[str],
) -> tuple[list[dict[str, str]], list[str]]:
    text = str(prompt or "")
    sorted_labels = sorted(
        [str(label or "").strip() for label in known_labels if str(label or "").strip()],
        key=lambda label: (-len(label), label),
    )
    max_label_length = max((len(sorted_labels[0]) if sorted_labels else 0) + 4, 6)
    segments: list[dict[str, str]] = []
    unknown: list[str] = []
    cursor = 0
    plain_start = 0

    while cursor < len(text):
        if text[cursor] != "@":
            cursor += 1
            continue

        start = cursor
        label_start = start + 1
        matched_label = None
        for label in sorted_labels:
            if text.startswith(label, label_start) and _has_boundary(text, label_start + len(label)):
                matched_label = label
                break

        if matched_label is not None:
            if plain_start < start:
                segments.append({"kind": "plain", "text": text[plain_start:start]})
            segments.append({"kind": "mention", "text": f"@{matched_label}", "label": matched_label})
            cursor = label_start + len(matched_label)
            plain_start = cursor
            continue

        candidate = _read_unknown_candidate(text, label_start, max_label_length)
        if candidate is not None:
            label, end = candidate
            if plain_start < start:
                segments.append({"kind": "plain", "text": text[plain_start:start]})
            segments.append({"kind": "plain", "text": text[start:end]})
            unknown.append(label)
            cursor = end
            plain_start = cursor
            continue

        cursor += 1

    if plain_start < len(text):
        segments.append({"kind": "plain", "text": text[plain_start:]})

    return segments, unknown


def resolve_asset_annotations(
    requested_asset_ids: list[str],
    asset_annotations: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    requested = [str(asset_id) for asset_id in requested_asset_ids if str(asset_id).strip()]
    if not requested:
        return []

    annotation_map: dict[str, dict[str, Any]] = {}
    for item in asset_annotations or []:
        asset_id = str(item.get("asset_id") or "").strip()
        if not asset_id or asset_id in annotation_map:
            continue
        annotation_map[asset_id] = item

    missing = [asset_id for asset_id in requested if asset_id not in annotation_map]
    if missing:
        raise ValueError("漏打标签")

    counters: dict[str, int] = {}
    resolved: list[dict[str, Any]] = []
    for index, asset_id in enumerate(requested, start=1):
        annotation = annotation_map[asset_id]
        category = str(annotation.get("tag_category") or "").strip()
        if not category:
            raise ValueError("存在无效标签类别")
        counters[category] = counters.get(category, 0) + 1
        tag_sequence = counters[category]
        resolved.append(
            {
                "asset_id": asset_id,
                "tag_category": category,
                "tag_sequence": tag_sequence,
                "tag_label": f"{category}{tag_sequence}",
                "image_index": index,
                "mention_name": str(annotation.get("mention_name") or "").strip() or None,
            }
        )
    return resolved


def compile_prompt_mentions(
    prompt: str,
    resolved_annotations: list[dict[str, Any]],
    *,
    alias_prefix: str,
) -> str:
    text = str(prompt or "")
    if not text or "@" not in text:
        return text

    alias_map: dict[str, str] = {}
    for item in resolved_annotations:
        alias = f"{alias_prefix}{int(item['image_index'])}"
        alias_map[str(item["tag_label"])] = alias
        mention_name = str(item.get("mention_name") or "").strip()
        if mention_name:
            alias_map[mention_name] = alias

    segments, unknown = _scan_prompt_mentions(text, list(alias_map))
    if unknown:
        raise ValueError(f"存在无效图片标签引用: {', '.join(sorted(set(unknown)))}")

    compiled_parts: list[str] = []
    for segment in segments:
        if segment["kind"] == "mention":
            compiled_parts.append(alias_map[segment["label"]])
        else:
            compiled_parts.append(segment["text"])
    return "".join(compiled_parts)


def compile_prompt_image_aliases(
    prompt: str,
    requested_asset_ids: list[str],
    asset_annotations: list[dict[str, Any]] | None,
    *,
    alias_prefix: str,
) -> tuple[str, list[dict[str, Any]]]:
    requested = [str(asset_id) for asset_id in requested_asset_ids if str(asset_id).strip()]
    if not requested:
        return str(prompt or ""), []

    annotation_map: dict[str, dict[str, Any]] = {}
    for item in asset_annotations or []:
        asset_id = str(item.get("asset_id") or "").strip()
        if asset_id and asset_id not in annotation_map:
            annotation_map[asset_id] = item

    resolved: list[dict[str, Any]] = []
    alias_map: dict[str, str] = {}
    for index, asset_id in enumerate(requested, start=1):
        annotation = annotation_map.get(asset_id) or {}
        category = str(annotation.get("tag_category") or "参考图").strip() or "参考图"
        alias = f"{alias_prefix}{index}"
        mention_name = str(annotation.get("mention_name") or "").strip()
        tag_sequence = int(annotation.get("tag_sequence") or index)
        tag_label = f"{category}{tag_sequence}"
        resolved.append(
            {
                "asset_id": asset_id,
                "tag_category": category,
                "tag_sequence": tag_sequence,
                "tag_label": tag_label,
                "image_index": index,
                "mention_name": mention_name or None,
            }
        )
        alias_map[tag_label] = alias
        alias_map[alias] = alias
        if mention_name:
            alias_map[mention_name] = alias

    text = normalize_prompt_image_aliases(str(prompt or ""), alias_prefix=alias_prefix)
    if "@" not in text:
        return text, resolved
    segments, unknown = _scan_prompt_mentions(text, list(alias_map))
    if unknown:
        raise ValueError(f"存在无效图片标签引用: {', '.join(sorted(set(unknown)))}")
    compiled_parts: list[str] = []
    for segment in segments:
        if segment["kind"] == "mention":
            compiled_parts.append(alias_map[segment["label"]])
        else:
            compiled_parts.append(segment["text"])
    return "".join(compiled_parts), resolved
