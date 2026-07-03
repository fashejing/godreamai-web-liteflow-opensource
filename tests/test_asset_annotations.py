from __future__ import annotations

import pytest

from web_lite3.asset_annotations import (
    add_prompt_image_reference_legend,
    compile_prompt_image_aliases,
    compile_prompt_mentions,
    resolve_asset_annotations,
)


def test_compile_prompt_mentions_supports_names_with_spaces_and_suffixes():
    compiled = compile_prompt_mentions(
        "@熊猫 老师（素材库） 站在竹林里",
        [
            {
                "tag_label": "角色1",
                "mention_name": "熊猫 老师（素材库）",
                "image_index": 1,
            }
        ],
        alias_prefix="图",
    )

    assert compiled == "图1 站在竹林里"


def test_compile_prompt_mentions_prefers_longest_known_match():
    compiled = compile_prompt_mentions(
        "@熊猫老师 在画面中央，@熊猫 在左侧",
        [
            {
                "tag_label": "角色1",
                "mention_name": "熊猫",
                "image_index": 1,
            },
            {
                "tag_label": "角色2",
                "mention_name": "熊猫老师",
                "image_index": 2,
            },
        ],
        alias_prefix="图",
    )

    assert compiled == "图2 在画面中央，图1 在左侧"


def test_compile_prompt_mentions_reports_unknown_reference_conservatively():
    with pytest.raises(ValueError) as excinfo:
        compile_prompt_mentions(
            "@熊猫跑进竹林然后回头看镜头",
            [
                {
                    "tag_label": "角色1",
                    "mention_name": "熊猫",
                    "image_index": 1,
                }
            ],
            alias_prefix="图",
        )

    message = str(excinfo.value)
    assert "存在无效图片标签引用:" in message
    assert "熊猫跑进竹林然后回头看镜头" not in message


def test_compile_prompt_image_aliases_preserves_plain_image_references():
    compiled, annotations = compile_prompt_image_aliases(
        "图1站左侧，图2作为背景",
        ["asset-a", "asset-b"],
        [
            {"asset_id": "asset-a", "tag_category": "角色", "tag_sequence": 1, "mention_name": "熊猫"},
            {"asset_id": "asset-b", "tag_category": "环境", "tag_sequence": 1, "mention_name": "竹林"},
        ],
        alias_prefix="图",
    )

    assert compiled == "图1站左侧，图2作为背景"
    assert [item["image_index"] for item in annotations] == [1, 2]
    assert [item["mention_name"] for item in annotations] == ["熊猫", "竹林"]


def test_compile_prompt_image_aliases_normalizes_reference_prefixes():
    compiled, annotations = compile_prompt_image_aliases(
        "熊猫基于参考图１，背景基于参考图片2，光线参考图像 3",
        ["asset-a", "asset-b", "asset-c"],
        [
            {"asset_id": "asset-a", "tag_category": "角色", "tag_sequence": 1, "mention_name": "熊猫"},
            {"asset_id": "asset-b", "tag_category": "环境", "tag_sequence": 1, "mention_name": "竹林"},
            {"asset_id": "asset-c", "tag_category": "光线", "tag_sequence": 1, "mention_name": "夕阳"},
        ],
        alias_prefix="图",
    )

    assert compiled == "熊猫基于图1，背景基于图2，光线图3"
    assert [item["image_index"] for item in annotations] == [1, 2, 3]


def test_compile_prompt_image_aliases_rewrites_legacy_mentions():
    compiled, annotations = compile_prompt_image_aliases(
        "@熊猫 在 @竹林 前面",
        ["asset-a", "asset-b"],
        [
            {"asset_id": "asset-a", "tag_category": "角色", "tag_sequence": 1, "mention_name": "熊猫"},
            {"asset_id": "asset-b", "tag_category": "环境", "tag_sequence": 1, "mention_name": "竹林"},
        ],
        alias_prefix="图",
    )

    assert compiled == "图1 在 图2 前面"
    assert [item["tag_label"] for item in annotations] == ["角色1", "环境1"]


def test_add_prompt_image_reference_legend_normalizes_grid_directive():
    prompt = add_prompt_image_reference_legend(
        "in 2x2 grid，中国历史纪录片风格，金兵基于图1，宋兵基于图2",
        [
            {"image_index": 1, "mention_name": "金兵", "tag_label": "角色1"},
            {"image_index": 2, "mention_name": "宋兵", "tag_label": "角色2"},
        ],
        alias_prefix="图",
    )

    assert prompt == (
        "参考图顺序：图1=金兵，图2=宋兵。\n"
        "单张输出图采用2x2四宫格排版，中国历史纪录片风格，金兵基于图1，宋兵基于图2"
    )


def test_resolve_asset_annotations_reports_invalid_reference_without_tag_copy():
    with pytest.raises(ValueError) as excinfo:
        resolve_asset_annotations(["asset-a"], [])

    assert str(excinfo.value) == "存在无效图片标签引用"
