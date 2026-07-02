# 井鸽AI影视套件 开源版 WebUI

这是基于加强版 WebUI 孪生出的开源版。开源版保留本地 WebUI、火山引擎模型接入、无限画板、素材库、历史记录和 Blender 预演功能；不提供 Google 与 OpenAI 的 API 接口服务。

## 功能简介

- 生图：支持火山引擎 Seedream 系列模型，包含文生图、参考图、多图融合、组图生成等工作流。
- 生视频：支持火山引擎 Seedance 系列模型，包含文生视频、首帧图生视频、首尾帧和多模态参考。
- 无限画板：支持图输入、任务节点、结果节点、连线、自动整理、模板任务和本地历史复用。
- 素材库：支持导入、管理和复用本地图片/视频素材。
- Blender 预演：支持白模空间、镜头轨迹、物体轨迹、灯光、绿幕、贴图、全屏预览、视频导出和本地场景文件保存/载入。
- 本地运行：默认监听 `127.0.0.1:8766`，数据默认保存在本机目录。

开源版删减项：

- 模型列表仅保留火山引擎模型。
- 设置页仅保留火山引擎 API Key。
- 不包含 Google / OpenAI 网关实现。
- Blender 不提供导出帧切片功能。

## 使用指南

### 1. 安装依赖

建议使用 Python 3.11。

```bash
python3.11 -m pip install -r requirements.txt
```

开发和测试环境可额外安装：

```bash
python3.11 -m pip install -r requirements-dev.txt
```

### 2. 启动 WebUI

```bash
python3.11 -m web_lite3
```

启动后打开：

```text
http://127.0.0.1:8766/image
```

常用频道：

- 生图：`http://127.0.0.1:8766/image`
- 生视频：`http://127.0.0.1:8766/video`
- 无限画板：`http://127.0.0.1:8766/canvas`
- 素材库：`http://127.0.0.1:8766/library`
- Blender：`http://127.0.0.1:8766/blender`
- 设置：`http://127.0.0.1:8766/settings`

### 3. 配置火山引擎 API Key

进入设置页，只需要填写火山引擎 API Key。开源版不会要求配置 Google API Key 或 GPT API Key。

如果本机开启了 VPN 或代理，建议让 `127.0.0.1`、`localhost` 走直连，避免浏览器访问本地服务被代理拦截。

### 4. 使用生图和生视频

1. 在生图或生视频页面选择火山引擎模型。
2. 输入提示词和参数。
3. 上传或选择参考素材。
4. 点击生成。
5. 生成结果会进入历史记录，也可在无限画板中复用。

### 5. 使用无限画板

1. 打开 `/canvas`。
2. 添加图片输入、创建生图任务或生视频任务。
3. 用连线表达参考图、任务和结果之间的关系。
4. 使用自动整理让节点更紧凑。
5. 可通过任务详情复用参数或查看生成记录。

### 6. 使用 Blender 预演

1. 打开 `/blender`。
2. 从白模库添加人物、车辆、飞行器、绿幕等对象。
3. 设置对象位置、旋转、缩放、灯光和轨迹。
4. 设置镜头轨迹与镜头模式。
5. 使用预览或全屏预览检查镜头。
6. 导出 MP4 视频。

Blender 场景文件支持保存到本地，也支持从本地文件载入。第三方 3D 模型导入会根据浏览器和运行环境支持情况处理常见格式。

## 数据目录

默认数据目录：

```text
~/.godreamai-plus
```

如需覆盖：

```bash
GODREAMAI_PLUS_HOME=/custom/path python3.11 -m web_lite3
```

## 测试

```bash
python3.11 -m pytest -q tests/test_app.py tests/test_volcengine_gateway.py
node --test tests/test_workspace_ui.mjs
```

Blender 前端检查：

```bash
cd web_lite3/blender_app
npm test
```

## 发布包构建

源码归档：

```bash
python3.11 scripts/build_release.py
```

Windows release 包：

```bash
python3.11 scripts/build_windows_release.py
```

macOS payload 构建：

```bash
python3.11 scripts/build_macos_release.py payload --target macos-arm64 --output-dir .launcher-build/macos-payloads/macos-arm64
python3.11 scripts/build_macos_release.py payload --target macos-x86_64 --output-dir .launcher-build/macos-payloads/macos-x86_64
python3.11 scripts/build_macos_release.py assemble \
  --arm64-payload-dir .launcher-build/macos-payloads/macos-arm64 \
  --x86_64-payload-dir .launcher-build/macos-payloads/macos-x86_64
```

## 许可与版权

版权归井鸽（成都）人工智能科技有限公司所有。当前公开仓库未单独附加 MIT、Apache 等开源许可证，请按版权方授权范围使用。

官网：

```text
https://www.wellpigeon.com
```
