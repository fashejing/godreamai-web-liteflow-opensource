# opensource-v13.11-blender-Dual

## 功能简介

井鸽AI影视套件开源版 WebUI 是一个本地运行的 AI 视觉创作工具，保留火山引擎生图/生视频、无限画板、素材库、历史记录和 Blender 预演功能。

本公开序列的重点：

- 独立公开源码仓库，不携带加强版私有仓库历史。
- 模型入口仅保留火山引擎。
- 设置页仅保留火山引擎 API Key。
- 删除 Google / OpenAI 网关实现。
- Blender 保留预演、轨迹、绿幕、贴图、视频导出和本地文件保存/载入，不提供导出帧切片。

## 使用指南

1. 安装 Python 3.11。
2. 在仓库目录运行 `python3.11 -m pip install -r requirements.txt`。
3. 运行 `python3.11 -m web_lite3`。
4. 打开 `http://127.0.0.1:8766/image`。
5. 到设置页填写火山引擎 API Key。
6. 使用 `/image`、`/video`、`/canvas`、`/library`、`/blender` 完成创作。

默认数据目录是 `~/.godreamai-plus`，也可以用 `GODREAMAI_PLUS_HOME=/custom/path` 指定。
