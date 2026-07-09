import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildCrossKindEmptyState,
  dedupeAssetsById,
  getRecordCardAction,
  normalizeWorkspaceAssets,
} from "../web_lite3/static/js/workspace_ui_helpers.js";

test("dedupeAssetsById keeps first occurrence order", () => {
  const shared = { id: "asset-1", display_name: "A" };
  const deduped = dedupeAssetsById([
    shared,
    { id: "asset-2", display_name: "B" },
    { id: "asset-1", display_name: "A-duplicate" },
    null,
    { id: "", display_name: "ignored" },
  ]);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["asset-1", "asset-2"],
  );
  assert.equal(deduped[0], shared);

  const contentDeduped = dedupeAssetsById([
    { id: "asset-a", content_hash: "same-hash" },
    { id: "asset-b", content_hash: "same-hash" },
    { id: "asset-c", content_hash: "other-hash" },
  ]);
  assert.deepEqual(
    contentDeduped.map((item) => item.id),
    ["asset-a", "asset-c"],
  );
});

test("normalizeWorkspaceAssets removes duplicates and lets primary win over references", () => {
  const normalized = normalizeWorkspaceAssets({
    imagePrimary: { id: "asset-1", content_hash: "primary-hash", display_name: "主图" },
    imageReferences: [
      { id: "asset-1", display_name: "主图-重复" },
      { id: "asset-1-copy", content_hash: "primary-hash", display_name: "主图-同图副本" },
      { id: "asset-2", display_name: "参考一" },
      { id: "asset-2", display_name: "参考一-重复" },
      { id: "asset-2-copy", content_hash: "ref-hash", display_name: "参考一-同图" },
      { id: "asset-2-other", content_hash: "ref-hash", display_name: "参考一-同图副本" },
    ],
    videoFirst: null,
    videoLast: null,
    videoReferences: [
      { id: "asset-3", display_name: "视频参考" },
      { id: "asset-3", display_name: "视频参考-重复" },
    ],
  });

  assert.equal(normalized.imagePrimary.id, "asset-1");
  assert.deepEqual(
    normalized.imageReferences.map((item) => item.id),
    ["asset-2", "asset-2-copy"],
  );
  assert.deepEqual(
    normalized.videoReferences.map((item) => item.id),
    ["asset-3"],
  );
});

test("getRecordCardAction maps live and terminal statuses correctly", () => {
  assert.deepEqual(getRecordCardAction("running"), {
    action: "cancel-record",
    label: "取消任务",
    disabled: false,
    className: "is-cancel",
  });
  assert.deepEqual(getRecordCardAction("cancel_requested"), {
    action: "cancel-record",
    label: "取消中",
    disabled: true,
    className: "is-cancel-pending",
  });
  assert.deepEqual(getRecordCardAction("succeeded"), {
    action: "delete-record",
    label: "删除",
    disabled: false,
    className: "is-delete",
  });
  assert.equal(getRecordCardAction("unknown"), null);
});

test("buildCrossKindEmptyState explains cross-kind history availability", () => {
  assert.deepEqual(
    buildCrossKindEmptyState("video", { image: 4, video: 0 }),
    {
      message: "当前资产包没有生视频记录，但有 4 条生图记录。",
      actionLabel: "查看生图记录",
      actionHref: "/image",
      statusText: "当前资产包有 4 条生图记录，当前页没有生视频记录",
    },
  );
  assert.deepEqual(
    buildCrossKindEmptyState("image", { image: 0, video: 2 }),
    {
      message: "当前资产包没有生图记录，但有 2 条生视频记录。",
      actionLabel: "查看生视频记录",
      actionHref: "/video",
      statusText: "当前资产包有 2 条生视频记录，当前页没有生图记录",
    },
  );
  assert.deepEqual(
    buildCrossKindEmptyState("image", { image: 0, video: 0 }),
    {
      message: "当前资产包暂无任务记录。",
      actionLabel: "",
      actionHref: "",
      statusText: "当前资产包暂无任务记录",
    },
  );
});

test("virtual shooting hides unfinished image staging entry points", () => {
  const toolbar = fs.readFileSync(new URL("../web_lite3/blender_app/src/components/Toolbar.tsx", import.meta.url), "utf8");
  const inspector = fs.readFileSync(new URL("../web_lite3/blender_app/src/components/Inspector.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(toolbar, /识图搭景/);
  assert.doesNotMatch(toolbar, /onAnalyzeReferenceImage/);
  assert.doesNotMatch(inspector, /识图搭景/);
  assert.doesNotMatch(inspector, /onAnalyzeReferenceImage/);
});

test("workspace.js keeps only one top-level declaration for critical record functions", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/workspace.js", import.meta.url), "utf8");
  const expectedSingleDeclarations = [
    "onRecordGridClick",
    "onRecordGridKeydown",
    "bindEvents",
    "syncQuietModeButton",
    "createRecordCard",
    "filteredStatusText",
    "renderRecordViewport",
    "refreshHistory",
    "loadMoreHistory",
  ];
  for (const name of expectedSingleDeclarations) {
    const isAsync = name === "refreshHistory" || name === "loadMoreHistory";
    const pattern = new RegExp(`^${isAsync ? "async " : ""}function ${name}\\(`, "gm");
    const matches = source.match(pattern) || [];
    assert.equal(matches.length, 1, `${name} should have exactly one top-level function declaration`);
  }
});

test("record card viewport skips unchanged card updates", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/workspace.js", import.meta.url), "utf8");
  assert.match(source, /function recordCardMetaEqual\(previous, next\)/);
  assert.match(source, /recordId: record[.]id \|\| ""/);
  assert.match(source, /modeKey: mode[?][.]key \|\| ""/);
  const metaBlock = source.match(/function buildRecordCardMeta\(record\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(metaBlock, /prompt:/);
  assert.match(source, /function updateRecordCard\(card, record, previousMeta = null\) \{[\s\S]*const nextMeta = buildRecordCardMeta\(record\);/);
  assert.match(source, /if \(recordCardMetaEqual\(previousMeta, nextMeta\)\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /card[.]__recordMeta = nextMeta;/);
  assert.doesNotMatch(source, /record-card-title/);
  assert.doesNotMatch(source, /promptNode/);
});

test("canvas task output deletion tolerates missing failed-task history records", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /function isMissingHistoryDeleteError\(/);
  assert.match(source, /history record not found/);
  assert.match(source, /function deleteHistoryOutputsIfPresent\(/);
  assert.match(source, /history_missing/);
});

test("canvas grid menu uses a concrete menu surface", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/css/app.css", import.meta.url), "utf8");
  const menuBlock = source.match(/[.]canvas-grid-menu \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(menuBlock, /background: var\(--modal-surface\)/);
  assert.doesNotMatch(menuBlock, /--panel-bg/);
});

test("canvas image upscale uses Seedream reference mode and original ratio", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /function preferredUpscaleImageModelVariant\(/);
  assert.match(source, /"seedream_v5_0"/);
  assert.match(source, /function imageEditConfigForSourceAndModel\(/);
  assert.match(source, /sourceAspectRatioForModel\(sourceNode, model\)/);
  assert.match(source, /mode: modelSupportsImageMode\(model, "image_edit"\)/);
  assert.match(source, /modelSupportsImageMode\(model, "reference_only"\)/);
  assert.match(source, /function createUpscaleImageTask\(/);
  assert.match(source, /data-canvas-menu-action="upscale-image"|upscale-image/);
});

test("workspace keeps provider-specific advanced image controls guarded", () => {
  const template = fs.readFileSync(new URL("../web_lite3/templates/workspace.html", import.meta.url), "utf8");
  const source = fs.readFileSync(new URL("../web_lite3/static/js/workspace.js", import.meta.url), "utf8");
  assert.match(template, /id="imageQuality"/);
  assert.match(template, /id="imageBackground"/);
  assert.match(template, /id="imageModeration"/);
  assert.match(template, /id="imageOutputCompression"/);
  assert.doesNotMatch(template, /id="imageRecipeButton"/);
  assert.doesNotMatch(template, /id="imageRecipeModal"/);
  assert.doesNotMatch(template, /id="imageRecipePromptConflictModal"/);
  assert.doesNotMatch(source, /image_recipe_helpers/);
  assert.doesNotMatch(source, /bindImageRecipePicker|requestApplyImageRecipe|imageRecipePromptConflictModal/);
  assert.match(source, /function isUnifiedImageInputModel\(/);
  assert.match(source, /return "volcengine";/);
  assert.doesNotMatch(source, /startsWith\("gpt_image"\)/);
  assert.doesNotMatch(source, /startsWith\("nano_banana"\)/);
  assert.match(source, /quality: \$\("#imageQuality"\)/);
  assert.match(source, /background: \$\("#imageBackground"\)/);
  assert.match(source, /moderation: \$\("#imageModeration"\)/);
  assert.match(source, /output_compression: Number\(\$\("#imageOutputCompression"\)/);
});

test("canvas grid templates use standalone optimized prompts", () => {
  const template = fs.readFileSync(new URL("../web_lite3/templates/canvas.html", import.meta.url), "utf8");
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(template, /id="canvasGridMenuButton"/);
  assert.match(template, /data-grid-template="multi_camera_9"/);
  assert.match(template, />多机位宫格</);
  assert.doesNotMatch(template, /多机位九宫格/);
  assert.match(template, /id="canvasMultiCameraGridModal"/);
  assert.match(template, /<option value="3x3" selected>3x3<\/option>/);
  assert.match(template, /<option value="2x2">2x2<\/option>/);
  assert.match(template, /<option value="source" selected>原图比例<\/option>/);
  assert.match(template, /<option value="1:1">1:1<\/option>/);
  assert.match(template, /<option value="16:9">16:9<\/option>/);
  assert.match(template, /<option value="21:9">21:9<\/option>/);
  assert.match(template, /data-canvas-menu-template="plot_9"/);
  assert.doesNotMatch(template, /id="canvasRecipeButton"/);
  assert.doesNotMatch(template, /id="canvasRecipeModal"/);
  assert.doesNotMatch(template, /data-canvas-menu-action="recipe-task"/);
  assert.match(source, /const GRID_TEMPLATES = \{/);
  assert.match(source, /multi_camera_9: \{/);
  assert.match(source, /function multiCameraGridPrompt\(gridType = "3x3", aspectRatio = "1:1"\)/);
  assert.match(source, /storyboard shot burst in \$\{safeAspectRatio\}/);
  assert.match(source, /multiCameraGridPrompt\(gridType, aspectRatio\)/);
  assert.match(source, /function multiCameraImageModeForModel\(model\)/);
  assert.match(source, /function isMultiCameraGridTask\(node\)/);
  assert.match(source, /if \(!source\) \{[\s\S]*showToast\("请先选择一张参考图"\);[\s\S]*return;/);
  assert.match(source, /function imageAspectRatioValues\(model\)/);
  assert.match(source, /imageAspectRatioValues\(model\)[.]includes\(normalized\)/);
  assert.match(source, /configOverrides[.]mode = inputMode/);
  assert.match(source, /configOverrides[.]aspect_ratio = aspectRatio/);
  assert.match(source, /preferredImageSizeForRatio\(model, aspectRatio, base[.]size\)/);
  assert.match(source, /const connected = connectImageNodeToTask\(source[.]id, task, "reference_image"\)/);
  assert.match(source, /state[.]nodes = state[.]nodes[.]filter\(\(node\) => node[.]id !== task[.]id\)/);
  assert.doesNotMatch(source, /未连接源图，将按默认模型比例创建任务/);
  assert.match(source, /3x3 连续剧情九宫格/);
  assert.match(source, /canvas_template: templateKey/);
  assert.doesNotMatch(source, /image_recipe_helpers|normalizeImageRecipes|applyImageRecipeTemplate|bindCanvasRecipePicker|openCanvasRecipePicker/);
});

test("canvas image task model switching preserves reference input mode", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const modelChangeBlock = source.match(/const modelSelect = selectField\("模型", imageModels\(\), node[.]config[.]model_variant, \(value\) => \{[\s\S]*?scheduleSave\(\);[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.match(source, /function modeUsesReferenceImage\(mode\) \{/);
  assert.match(source, /function referenceImageModeForModel\(model, \{ currentMode = "", referenceCount = 0 \} = \{\}\) \{/);
  assert.match(source, /modeUsesReferenceImage\(currentMode\) && modelSupportsImageMode\(model, currentMode\)/);
  assert.match(source, /Number\(referenceCount \|\| 0\) > 1 \? \["multi_image"\] : \[\]/);
  assert.match(source, /function referenceImageEdgesForTask\(taskNode\) \{/);
  assert.match(source, /edge[.]target_node_id === taskNode[.]id[\s\S]*edge[.]target_port === "reference_image"/);
  assert.match(source, /return referenceImageModeForModel\(model, \{ referenceCount: 1 \}\);/);
  assert.match(modelChangeBlock, /const previousModelVariant = node[.]config[.]model_variant;/);
  assert.match(modelChangeBlock, /const previousMode = node[.]config[.]mode;/);
  assert.match(modelChangeBlock, /const referenceCount = referenceImageEdgesForTask\(node\)[.]length;/);
  assert.match(modelChangeBlock, /const nextMode = referenceCount[\s\S]*referenceImageModeForModel\(model, \{ currentMode: previousMode, referenceCount \}\)[\s\S]*: \(model[.]default_mode \|\| "text_only"\);/);
  assert.match(modelChangeBlock, /if \(referenceCount && !nextMode\) \{/);
  assert.match(modelChangeBlock, /node[.]config[.]model_variant = previousModelVariant;/);
  assert.match(modelChangeBlock, /node[.]config[.]mode = previousMode;/);
  assert.match(modelChangeBlock, /showToast\("当前生图模型不支持参考图输入"\);/);
  assert.match(modelChangeBlock, /node[.]config[.]mode = nextMode;/);
  assert.doesNotMatch(modelChangeBlock, /node[.]config[.]mode = model[.]default_mode \|\| "text_only";/);
  assert.match(source, /if \(isMultiCameraGridTask\(node\)\) \{[\s\S]*referenceImageModeForModel\(model, \{[\s\S]*currentMode: node[.]config[.]mode,[\s\S]*referenceCount: Math[.]max\(1, referenceImageEdgesForTask\(node\)[.]length\),[\s\S]*\}\);[\s\S]*node[.]config[.]mode = inputMode;[\s\S]*\} else \{[\s\S]*selectField\("生成方式"/);
});

test("canvas inspector prompt keeps keyboard input inside textarea", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /textEditing: false/);
  assert.match(source, /function isTextEditingTarget\(target\) \{[\s\S]*target[?][.]nodeType === 3 \? target[.]parentElement : target;[\s\S]*element[?][.]isContentEditable[\s\S]*element[?][.]closest[?][.]\("input, textarea, select, \[contenteditable\], \[role='textbox'\]"\)/);
  assert.match(source, /function isTextEditingEvent\(event\) \{[\s\S]*state[.]textEditing[\s\S]*isTextEditingTarget\(event[?][.]target\)[\s\S]*isTextEditingTarget\(document[.]activeElement\);[\s\S]*\}/);
  assert.match(source, /function bindTextEditingGuards\(\) \{[\s\S]*document[.]addEventListener\("focusin"[\s\S]*state[.]textEditing = true;[\s\S]*document[.]addEventListener\("focusout"[\s\S]*state[.]textEditing = isTextEditingTarget\(document[.]activeElement\);[\s\S]*\}/);
  assert.match(source, /const isEditingText = isTextEditingEvent\(event\);[\s\S]*if \(isEditingText\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /field[.]addEventListener\("click", \(event\) => \{[\s\S]*input[.]focus\(\);[\s\S]*\}\);/);
  assert.match(source, /const menuOpen = Boolean\(menu && !menu[.]hidden && state[.]mention[.]textarea === textarea\);[\s\S]*if \(!menuOpen\) \{[\s\S]*return;/);
  assert.match(source, /if \(event[.]key === "Delete" \|\| event[.]key === "Backspace"\) \{[\s\S]*if \(isTextEditingTarget\(event[.]target\)\) return;[\s\S]*deleteSelected\(\);/);
});

test("image model switching silently refreshes dependent select options", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/workspace.js", import.meta.url), "utf8");
  const block = source.match(/\$\("#modelVariant"\)[.]addEventListener\("change", \(\) => \{[\s\S]*?persistWorkspaceDraft\(\);[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.match(block, /syncImageModelOptions\(\);/);
  assert.doesNotMatch(block, /showSizeFallbackToast:\s*true/);
  assert.doesNotMatch(block, /showAspectRatioFallbackToast:\s*true/);
  assert.doesNotMatch(block, /showModeFallbackToast:\s*true/);
});

test("video mode controls use model scoped scene labels", () => {
  const workspaceSource = fs.readFileSync(new URL("../web_lite3/static/js/workspace.js", import.meta.url), "utf8");
  const canvasSource = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const commonSource = fs.readFileSync(new URL("../web_lite3/static/js/common.js", import.meta.url), "utf8");
  assert.match(workspaceSource, /model[?][.]scenes/);
  assert.match(workspaceSource, /function videoSceneLabelForModel\(/);
  assert.match(canvasSource, /Array[.]isArray\(model[.]scenes\)/);
  assert.match(canvasSource, /function videoSceneLabelForModel\(/);
  assert.match(commonSource, /function videoSceneLabel\(/);
});

test("workspace exposes sidebar resizing and failed-task bulk deletion", () => {
  const template = fs.readFileSync(new URL("../web_lite3/templates/base.html", import.meta.url), "utf8");
  const workspaceTemplate = fs.readFileSync(new URL("../web_lite3/templates/workspace.html", import.meta.url), "utf8");
  const source = fs.readFileSync(new URL("../web_lite3/static/js/common.js", import.meta.url), "utf8");
  const workspaceSource = fs.readFileSync(new URL("../web_lite3/static/js/workspace.js", import.meta.url), "utf8");
  assert.match(template, /id="sidebarResizer"/);
  assert.match(source, /function initResizableSidebar\(\)/);
  assert.match(source, /godreamai-plus-sidebar-width/);
  const css = fs.readFileSync(new URL("../web_lite3/static/css/app.css", import.meta.url), "utf8");
  assert.match(css, /[.]sidebar > :not\([.]sidebar-resizer\)/);
  assert.doesNotMatch(css, /[.]sidebar > [*] \{/);
  assert.match(workspaceTemplate, /id="deleteFailedHistoryButton"/);
  assert.match(workspaceSource, /function deleteFailedHistoryRecords\(\)/);
  assert.match(workspaceSource, /\/api\/history\/\$\{kind\}\/delete-failed/);
});

test("sidebar width is restored before stylesheet paint", () => {
  const template = fs.readFileSync(new URL("../web_lite3/templates/base.html", import.meta.url), "utf8");
  const earlyScriptIndex = template.indexOf("godreamai-plus-sidebar-width");
  const stylesheetIndex = template.indexOf("/static/css/app.css");
  assert.ok(earlyScriptIndex > -1, "base template restores sidebar width from localStorage");
  assert.ok(stylesheetIndex > -1, "base template links the app stylesheet");
  assert.ok(earlyScriptIndex < stylesheetIndex, "sidebar width restoration must run before CSS loads");
  assert.match(template, /rel="prefetch" href="\/canvas"/);
  assert.match(template, /rel="prefetch" href="\/library"/);
  assert.match(template, /rel="prefetch" href="\/settings"/);
});

test("global themes keep prompt text readable", () => {
  const css = fs.readFileSync(new URL("../web_lite3/static/css/app.css", import.meta.url), "utf8");
  const constants = fs.readFileSync(new URL("../web_lite3/constants.py", import.meta.url), "utf8");
  const settingsStore = fs.readFileSync(new URL("../web_lite3/settings_store.py", import.meta.url), "utf8");
  assert.match(css, /--input-text: var\(--text\)/);
  assert.match(css, /--prompt-plain-color: var\(--input-text, var\(--text\)\)/);
  assert.match(css, /body\[data-theme="graphite_pro"\] \{[\s\S]*--input-text: #f8fafc/);
  assert.match(css, /body\[data-theme="dopamine_pop"\]/);
  assert.match(css, /body\[data-theme="sketch_line"\]/);
  assert.match(css, /body\[data-theme="mono_pixel"\]/);
  assert.match(constants, /THEME_DOPAMINE_POP = "dopamine_pop"/);
  assert.match(constants, /THEME_SKETCH_LINE = "sketch_line"/);
  assert.match(constants, /THEME_MONO_PIXEL = "mono_pixel"/);
  assert.match(settingsStore, /THEME_DOPAMINE_POP/);
  assert.match(settingsStore, /THEME_SKETCH_LINE/);
  assert.match(settingsStore, /THEME_MONO_PIXEL/);
  assert.doesNotMatch(css, /--prompt-plain-color: #000000/);
});

test("settings network helper presents VPN guidance without advanced controls", () => {
  const template = fs.readFileSync(new URL("../web_lite3/templates/settings.html", import.meta.url), "utf8");
  const source = fs.readFileSync(new URL("../web_lite3/static/js/settings.js", import.meta.url), "utf8");
  assert.match(template, /VPN 状态助手/);
  assert.match(template, /火山引擎和可灵中国大陆接口通常直连/);
  assert.match(template, /Kling API Key/);
  assert.doesNotMatch(template, /Google API Key/);
  assert.doesNotMatch(template, /GPT API Key/);
  assert.doesNotMatch(template, /<details class="network-advanced">/);
  assert.doesNotMatch(template, /高级设置/);
  assert.doesNotMatch(template, /本地代理地址/);
  assert.match(source, /networkProviders = \["volcengine", "kling"\]/);
  assert.match(source, /可灵中国大陆接口通常直连。/);
  assert.match(source, /请关闭 VPN 后重试。/);
  assert.match(source, /我已切换 VPN，重新检测/);
  assert.match(source, /function focusApiKeyInput\(provider\)/);
  assert.doesNotMatch(source, /networkModeLabel/);
});

test("custom selects keep long option lists scrollable inside the viewport", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/common.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../web_lite3/static/css/app.css", import.meta.url), "utf8");
  const constants = fs.readFileSync(new URL("../web_lite3/constants.py", import.meta.url), "utf8");
  assert.match(source, /function initCustomSelects\(\)/);
  assert.match(source, /custom-select-layer/);
  assert.match(source, /select[?][.]closest[?][.]\("dialog\[open\]"\) \|\| document[.]body/);
  assert.match(source, /customSelectLayer[.]parentNode !== host/);
  assert.match(source, /const spaceBelow = Math[.]max\(0, window[.]innerHeight - rect[.]bottom/);
  assert.match(source, /const spaceAbove = Math[.]max\(0, rect[.]top/);
  assert.match(source, /const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;/);
  assert.match(source, /customSelectLayer[.]dataset[.]placement = openUpward \? "top" : "bottom";/);
  assert.match(source, /select[.]dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(source, /function handleCustomSelectScroll\(event\)/);
  assert.match(source, /target === customSelectLayer \|\| customSelectLayer[.]contains\(target\)/);
  assert.match(source, /window[.]addEventListener\("scroll", handleCustomSelectScroll, true\)/);
  assert.match(source, /selectedItem[?][.]scrollIntoView[?][.]\(\{ block: "nearest", inline: "nearest" \}\)/);
  assert.match(css, /[.]custom-select-native \{/);
  assert.match(css, /[.]custom-select-layer \{/);
  assert.match(css, /position: fixed;/);
  assert.match(css, /overscroll-behavior: contain;/);
  assert.match(css, /[.]canvas-multi-camera-grid-modal \{[\s\S]*?overflow: visible;/);
  assert.match(constants, /VIDEO_DURATION_OPTIONS = \[\{"value": second, "label": f"\{second\} 秒"\} for second in range\(3, 16\)\]/);
});

test("canvas inspector omits redundant summary card and history detail", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /if \(nodeRole\(node\) === "result"\) return "";/);
  assert.doesNotMatch(source, /inspectorSummary\(/);
  assert.doesNotMatch(source, /summary[.]append\(createElement\("strong", "", nodeTitle\(node\)\)\)/);
  assert.doesNotMatch(source, /查看历史详情/);
});

test("canvas cloned task starts below original task", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const cloneBlock = source.match(/function duplicateTaskNode\(taskNode\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(cloneBlock, /x: Number\(taskNode[.]x \|\| 0\),/);
  assert.match(cloneBlock, /y: Number\(taskNode[.]y \|\| 0\) \+ nodeSize\(taskNode\)[.]height \+ 36,/);
});

test("canvas nodes are resizable and auto layout resets custom sizes", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../web_lite3/static/css/app.css", import.meta.url), "utf8");
  assert.match(source, /nodeResize: null/);
  assert.match(source, /function startNodeResize\(event, node\)/);
  assert.match(source, /node[.]width = Math[.]max/);
  assert.match(source, /state[.]nodes[.]forEach\(resetNodeSize\);/);
  assert.match(source, /nodeEl[.]style[.]height = `[$][{]size[.]height[}]px`;/);
  assert.doesNotMatch(source, /if \(node[.]width \|\| node[.]height\) \{\s*nodeEl[.]style[.]height/);
  assert.match(css, /[.]canvas-node-resize-handle \{/);
  assert.match(css, /[.]canvas-node[.]is-input [.]canvas-node-media,[\s\S]*?[.]canvas-node[.]is-result [.]canvas-node-media \{[\s\S]*?height: 100%;/);
  assert.match(css, /[.]canvas-node \{[\s\S]*border: 2[.]5px solid color-mix\(in srgb, var\(--canvas-accent\) 82%, var\(--canvas-local-border\)\)/);
  assert.doesNotMatch(css, /[.]canvas-node::before \{[\s\S]*border-top:/);
  assert.match(css, /--canvas-accent-rgb: 139, 92, 246/);
  assert.match(css, /--canvas-accent-rgb: 6, 182, 212/);
  assert.match(css, /--canvas-accent-rgb: 245, 158, 11/);
  assert.match(css, /--canvas-accent-rgb: 34, 197, 94/);
  assert.match(css, /--canvas-accent-rgb: 59, 130, 246/);
});

test("canvas reference image nodes show image task order badges without selection", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../web_lite3/static/css/app.css", import.meta.url), "utf8");
  assert.match(source, /function imageReferenceIdentity\(node\)/);
  assert.match(source, /function supportsReferenceImageOrder\(taskNode\)/);
  assert.match(source, /function referenceOrderTaskForNode\(node\)/);
  assert.match(source, /function referenceOrderForNode\(node\)/);
  assert.match(source, /edge[.]target_port !== "reference_image"/);
  assert.match(source, /if \(!taskIds[.]length\) \{/);
  assert.match(source, /return nodeById\(taskIds\[0\]\);/);
  assert.match(source, /for \(const edge of state[.]edges\)/);
  assert.match(source, /seen[.]has\(identity\)/);
  assert.match(source, /`图[$][{]referenceOrder[}]`/);
  assert.match(source, /if \(referenceOrder\) return `图[$][{]referenceOrder[}]`;/);
  assert.match(css, /max-width: 44px;/);
});

test("canvas grid split outputs remain connected to source image context", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /function isGridSplitInputNode\(node\) \{/);
  assert.match(source, /function gridSplitCellLabel\(cell = \{\}\) \{/);
  assert.match(source, /if \(isGridSplitInputNode\(node\)\) return gridSplitCellLabel/);
  assert.match(source, /if \(isGridSplitInputNode\(node\)\) return "切分";/);
  assert.match(source, /label: gridSplitCellLabel\(item[.]grid_cell \|\| \{\}\),/);
  assert.match(source, /if \(node[?][.]type === "image_input"\) return \["input"\];/);
  assert.match(source, /function isImageContextConnection\(/);
  assert.match(source, /targetNode[?][.]type === "image_input"/);
  assert.match(source, /function connectImageContextNode\(/);
  assert.match(source, /connectImageContextNode\(source[.]id, splitNode\)/);
});

test("canvas grid split chooses direct or upscale after cell selection", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /gridSplitButton[?][.]addEventListener\("click", \(\) => openGridSplitModal\(\)\)/);
  assert.match(source, /function submitGridSplit\(\) \{[\s\S]*openGridSplitChoice\(\);[\s\S]*\}/);
  assert.match(source, /function createSelectedGridSplitNodes\(\{ upscale = false \} = \{\}\)/);
  assert.match(source, /createSelectedGridSplitNodes\(\{ upscale: true \}\)/);
  assert.doesNotMatch(source, /function createUpscaleGridSplitTask\(/);
});

test("canvas image results can be added to the library canvas category", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const template = fs.readFileSync(new URL("../web_lite3/templates/canvas.html", import.meta.url), "utf8");
  assert.match(template, /data-canvas-menu-action="add-to-library"/);
  assert.match(template, /id="canvasAddLibraryModal"/);
  assert.match(source, /const CANVAS_LIBRARY_CATEGORY = "画布库"/);
  assert.match(source, /function libraryCategoryOptions\(\)/);
  assert.match(source, /contextMenuResultActions[.]forEach/);
  assert.match(source, /sourceNode[?][.]type !== "image_result"/);
  assert.match(source, /function confirmAddToLibrary\(\)/);
  assert.match(source, /\/api\/canvas\/result-to-library/);
});

test("canvas image context can create a 720 panorama task", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const template = fs.readFileSync(new URL("../web_lite3/templates/canvas.html", import.meta.url), "utf8");
  assert.match(template, /data-canvas-menu-action="generate-720-panorama"/);
  assert.match(source, /const PANORAMA_720_PROMPT = /);
  assert.match(source, /function createPanorama720Task\(/);
  assert.match(source, /canvas_template: "panorama_720"/);
  assert.match(source, /closestSupportedAspectRatioFromRatio\(model, "2:1"\)/);
});

test("canvas image picker supports local upload and fast deduped paging", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  const template = fs.readFileSync(new URL("../web_lite3/templates/canvas.html", import.meta.url), "utf8");
  assert.match(template, /id="canvasPickerUploadButton"/);
  assert.match(template, /id="canvasPickerUploadFile" type="file" accept="image\/\*"/);
  assert.match(source, /function uploadPickerImage\(file\)/);
  assert.match(source, /formData[.]append\("kind", "image"\)/);
  assert.match(source, /selectPickerItem\(item\)/);
  assert.match(source, /function pickerItemKey\(item\)/);
  assert.match(source, /content_hash/);
  assert.match(source, /function mergePickerItems/);
  assert.match(source, /pickerCache: new Map\(\)/);
  assert.match(source, /limit: "36"/);
});

test("canvas batch runs create and poll one result node per submitted job", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /function taskRunEntriesFromPayload\(/);
  assert.match(source, /async function applyPersistedHistoryForPoll\(taskNode, kind, historyId\)/);
  assert.match(source, /function clearPollTimer\(jobId\)/);
  assert.match(source, /clearPollTimer\(jobId\);[\s\S]*const tick = async/);
  assert.match(source, /if \(!node\) \{[\s\S]*clearPollTimer\(jobId\);[\s\S]*return;/);
  assert.match(source, /const terminal = await applyPersistedHistoryForPoll\(node, kind \|\| nodeKind\(node\), fallbackHistoryId\);/);
  assert.match(source, /if \(!TERMINAL_STATUSES[.]has[\s\S]*setTimeout\(tick, 1600\)/);
  assert.match(source, /clearPollTimer\(jobId\);[\s\S]*if \(snapshot[.]status === "succeeded"\)/);
  assert.match(source, /function ensurePendingResultNodes\(/);
  assert.match(source, /node[.]job_ids = runEntries[.]map/);
  assert.match(source, /node[.]history_ids = runEntries[.]map/);
  assert.match(source, /runEntries[.]forEach/);
  assert.match(source, /pollJobForNode\(node[.]id, entry[.]jobId, runKind, entry[.]historyId, \{/);
  assert.match(source, /batchIndex: entry[.]batchIndex/);
  assert.match(source, /numberField\("数量", node[.]config[.]count \|\| 1, 1, 15/);
});

test("canvas auto layout keeps grid split context chains together", () => {
  const source = fs.readFileSync(new URL("../web_lite3/static/js/canvas.js", import.meta.url), "utf8");
  assert.match(source, /const AUTO_LAYOUT_NODE_GAP = 7;/);
  assert.match(source, /const AUTO_LAYOUT_COLUMN_GAP = 36;/);
  assert.match(source, /const AUTO_LAYOUT_COLLISION_GAP = 12;/);
  assert.match(source, /bSize[.]width \+ AUTO_LAYOUT_COLLISION_GAP/);
  assert.match(source, /function autoLayout\(\) \{/);
  assert.match(source, /const placedStages = new Map\(\);/);
  assert.match(source, /const originalNodeY = new Map\(state[.]nodes[.]map\(\(node\) => \[node[.]id, Number\(node[.]y \|\| 0\)\]\)\);/);
  assert.match(source, /const edgeOrder = new Map\(state[.]edges[.]map\(\(edge, index\) => \[edge, index\]\)\);/);
  assert.match(source, /const compareCanvasLayoutNodes = \(left, right\) => \(/);
  assert.match(source, /const incomingEdgesForNode = \(node\) => \{/);
  assert.match(source, /portOrder[.]get\(left[.]target_port\)/);
  assert.match(source, /edgeOrderValue\(left\) - edgeOrderValue\(right\)/);
  assert.match(source, /const downstreamContextInputs = \(resultNode\) => outgoingNodes\(resultNode\)/);
  assert.match(source, /const downstreamBranches = \(resultNode\) => \[/);
  assert.match(source, /const tasks = directDownstreamTasks\(contextNode\);/);
  assert.match(source, /tasks[.]map\(\(taskNode\) => \(\{ contextNode, taskNode \}\)\)/);
  assert.match(source, /: \[\{ contextNode, taskNode: null \}\]/);
  assert.match(source, /if \(branch[.]taskNode\) \{/);
  assert.match(source, /const isDerivedFromProducedResult = \(node, seen = new Set\(\)\) => \{/);
  assert.match(source, /hasProducedResultInput = \(taskNode\) => incomingNodes\(taskNode\)/);
  assert.match(source, /const taskAnchorY = \(taskNode\) => \{/);
  assert.match(source, /const compareTaskLayoutOrder = \(left, right\) => \(/);
  assert.match(source, /placedStages[.]set\(node[.]id, resolvedStage\);/);
  assert.match(source, /const stageAfterPlacedSources = \(taskNode, fallbackStage\) => \{/);
  assert.match(source, /[.]map\(\(source\) => placedStages[.]get\(source[.]id\)\)/);
  assert.match(source, /Math[.]max\(fallbackStage, Math[.]max\([.][.][.]sourceStages\) \+ 1\)/);
  assert.match(source, /const resolvedTaskStage = placed[.]has\(taskNode[.]id\)/);
  assert.match(source, /let resultCursorY = Number\(taskNode[.]y \|\| taskY\);/);
  assert.match(source, /const resultY = resultCursorY;/);
  assert.match(source, /downstreamBranches\(resultNode\)[.]sort/);
  assert.match(source, /compareTaskLayoutOrder\(left[.]taskNode, right[.]taskNode\)/);
  assert.match(source, /compareCanvasLayoutNodes\(leftNode, rightNode\)/);
  assert.match(source, /let branchCursorY = Number\(resultNode[.]y \|\| resultY\);/);
  assert.match(source, /const branchY = branchCursorY;/);
  assert.match(source, /let branchBottom = branchY;/);
  assert.match(source, /branchCursorY = Math[.]max\(branchCursorY \+ branchGap, branchBottom \+ AUTO_LAYOUT_NODE_GAP\);/);
  assert.match(source, /resultCursorY = Math[.]max\(resultCursorY \+ branchGap, resultBottom \+ AUTO_LAYOUT_NODE_GAP\);/);
  assert.match(source, /branch[.]contextNode \? 3 : 2/);
  assert.match(source, /resolvedTaskStage \+ \(branch[.]contextNode \? 3 : 2\)/);
  assert.match(source, /[.]sort\(compareTaskLayoutOrder\)/);
});
