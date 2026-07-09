import {
  createElement,
  fetchJson,
  getPageConfig,
  showToast,
} from "./common.js";

const config = getPageConfig();
const canvasPage = document.querySelector(".canvas-page");
const viewport = document.getElementById("canvasViewport");
const world = document.getElementById("canvasWorld");
const edgeLayer = document.getElementById("canvasEdges");
const selectionBox = document.getElementById("canvasSelectionBox");
const inspector = document.getElementById("canvasInspectorBody");
const statusText = document.getElementById("canvasStatusText");
const contextMenu = document.getElementById("canvasContextMenu");
const contextMenuImageActions = contextMenu?.querySelectorAll?.(".canvas-image-context-action") || [];
const contextMenuBlankActions = contextMenu?.querySelectorAll?.(".canvas-blank-context-action") || [];
const contextMenuTaskActions = contextMenu?.querySelectorAll?.(".canvas-task-context-action") || [];
const contextMenuResultActions = contextMenu?.querySelectorAll?.(".canvas-result-context-action") || [];
const upscaleButton = document.getElementById("canvasUpscaleButton");
const gridSplitButton = document.getElementById("canvasGridSplitButton");
const gridMenuButton = document.getElementById("canvasGridMenuButton");
const gridMenu = document.getElementById("canvasGridMenu");
const multiCameraGridModal = document.getElementById("canvasMultiCameraGridModal");
const multiCameraGridSummary = document.getElementById("canvasMultiCameraGridSummary");
const multiCameraGridTypeSelect = document.getElementById("canvasMultiCameraGridType");
const multiCameraAspectSelect = document.getElementById("canvasMultiCameraAspectRatio");
const multiCameraGridClose = document.getElementById("canvasMultiCameraGridCloseButton");
const multiCameraGridCancel = document.getElementById("canvasMultiCameraGridCancelButton");
const multiCameraGridConfirm = document.getElementById("canvasMultiCameraGridConfirmButton");
const picker = document.getElementById("canvasImagePicker");
const pickerList = document.getElementById("canvasPickerList");
const pickerSearch = document.getElementById("canvasPickerSearch");
const pickerSource = document.getElementById("canvasPickerSource");
const pickerLoadMore = document.getElementById("canvasPickerLoadMore");
const pickerUploadButton = document.getElementById("canvasPickerUploadButton");
const pickerUploadFile = document.getElementById("canvasPickerUploadFile");
const gridSplitModal = document.getElementById("canvasGridSplitModal");
const gridSplitSourceName = document.getElementById("canvasGridSplitSourceName");
const gridSplitRows = document.getElementById("canvasGridSplitRows");
const gridSplitCols = document.getElementById("canvasGridSplitCols");
const gridSplitCells = document.getElementById("canvasGridSplitCells");
const gridSplitRun = document.getElementById("canvasGridSplitRunButton");
const gridSplitClose = document.getElementById("canvasGridSplitCloseButton");
const gridSplitSelectAll = document.getElementById("canvasGridSplitSelectAllButton");
const gridSplitClear = document.getElementById("canvasGridSplitClearButton");
const gridSplitChoiceModal = document.getElementById("canvasGridSplitChoiceModal");
const gridSplitChoiceSummary = document.getElementById("canvasGridSplitChoiceSummary");
const gridSplitChoiceClose = document.getElementById("canvasGridSplitChoiceCloseButton");
const gridSplitDirectButton = document.getElementById("canvasGridSplitDirectButton");
const gridSplitUpscaleButton = document.getElementById("canvasGridSplitUpscaleButton");
const previewDialog = document.getElementById("canvasPreviewModal");
const previewTitle = document.getElementById("canvasPreviewTitle");
const previewMeta = document.getElementById("canvasPreviewMeta");
const previewImage = document.getElementById("canvasPreviewImage");
const previewVideo = document.getElementById("canvasPreviewVideo");
const previewClose = document.getElementById("canvasPreviewCloseButton");
const deleteTaskModal = document.getElementById("canvasDeleteTaskModal");
const deleteTaskSummary = document.getElementById("canvasDeleteTaskSummary");
const deleteTaskClose = document.getElementById("canvasDeleteTaskCloseButton");
const deleteCanvasOnlyButton = document.getElementById("canvasDeleteCanvasOnlyButton");
const deleteWithOutputsButton = document.getElementById("canvasDeleteWithOutputsButton");
const addLibraryModal = document.getElementById("canvasAddLibraryModal");
const addLibrarySummary = document.getElementById("canvasAddLibrarySummary");
const addLibraryCategorySelect = document.getElementById("canvasAddLibraryCategorySelect");
const addLibraryClose = document.getElementById("canvasAddLibraryCloseButton");
const addLibraryCancel = document.getElementById("canvasAddLibraryCancelButton");
const addLibraryConfirm = document.getElementById("canvasAddLibraryConfirmButton");

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "expired"]);
const SINGLE_INPUT_PORTS = new Set(["base_image", "first_frame", "last_frame"]);
const NODE_WIDTH = { input: 132, task: 176, result: 142 };
const NODE_HEIGHT = { input: 104, task: 88, result: 110 };
const NODE_MIN_WIDTH = { input: 112, task: 148, result: 124 };
const NODE_MIN_HEIGHT = { input: 92, task: 82, result: 96 };
const NODE_MAX_WIDTH = 420;
const NODE_MAX_HEIGHT = 320;
const CANVAS_LIBRARY_CATEGORY = "画布库";
const FALLBACK_LIBRARY_CATEGORIES = [CANVAS_LIBRARY_CATEGORY, "角色", "场景", "道具", "风格", "其他"];
const AUTO_LAYOUT_NODE_GAP = 7;
const AUTO_LAYOUT_COLUMN_GAP = 36;
const AUTO_LAYOUT_COLLISION_GAP = 12;
const CANVAS_THEME_STORAGE_KEY = "godreamai.canvas.theme";
const PORT_SIZE = 16;
const PORT_TOP = 38;
const PORT_GAP = 9;
const SNAP_DISTANCE = 10;
const MULTI_CAMERA_SOURCE_ASPECT = "source";

function multiCameraGridPrompt(gridType = "3x3", aspectRatio = "1:1") {
  const safeGridType = String(gridType || "3x3").trim() || "3x3";
  const safeAspectRatio = String(aspectRatio || "1:1").trim() || "1:1";
  return [
    `Use the attached image as the canonical visual anchor and generate a ${safeGridType} storyboard shot burst in ${safeAspectRatio}.`,
    "",
    "Preserve the exact aesthetic, colour palette, lighting, mood, subject design, wardrobe, environment, production design, and cinematic style from the source image.",
    "",
    "Create distinct frames from the same scene, using varied cinematic coverage including but not limited to:",
    "1. extreme wide",
    "2. centred master",
    "3. medium shot",
    "4. side profile",
    "5. rear angle",
    "6. close-up",
    "7. extreme close-up",
    "8. detail shot",
    "9. environmental mood shot",
    "",
    "Keep the same composition style, negative space, camera character, atmosphere, lens feeling, and visual restraint.",
    "",
    "No text, no labels, no redesign, no extra characters.",
    "",
    "Number each frame.",
    "",
    "The result should feel like a cinematographer's contact sheet from the same film scene.",
  ].join("\n");
}

const PANORAMA_720_PROMPT = [
  "基于参考图生成一张可用于虚拟拍摄背景的 720° 全景图。",
  "输出必须是 2:1 等距矩形全景图，覆盖完整 360° 水平方向和 180° 垂直方向，适合贴到球形天空盒中实时预览。",
  "严格保持原图的空间特征、建筑/场景细节、材质、光线方向、时间氛围、色彩体系和镜头质感。",
  "从当前画面自然延展出左、右、后方和天空/地面环境，让场景像同一个真实空间，而不是拼贴。",
  "画面中心保持可作为主视线方向的构图，左右边缘必须尽量无缝闭合。",
  "避免在离镜头极近的位置放置巨大主体，避免人物脸部畸变、文字、水印、边缘接缝、重复建筑、透视断裂和强烈 AI 伪影。",
].join("\n");

const GRID_TEMPLATES = {
  multi_camera_9: {
    label: "多机位宫格",
    title: "多机位宫格",
    prompt: multiCameraGridPrompt("3x3", "1:1"),
  },
  plot_4: {
    label: "剧情推演四宫格",
    title: "剧情推演四宫格",
    prompt: "基于参考图生成一张四宫格连续剧情板。严格保持主体身份、服装、材质、场景空间、光线方向、色彩体系、镜头质感和整体美术风格一致。四格按从左到右、从上到下的时间顺序呈现：起始状态、动作发生、关键变化、结果画面。只推进动作、表情、姿态和少量环境状态，不改变角色设计、场景设定、服装、时代、比例或渲染方式。每格都要清楚、可读、像同一条镜头序列。禁止跳戏、换画风、重设主体、乱码文字、水印和低质量伪影。",
  },
  plot_9: {
    label: "剧情推演九宫格",
    title: "剧情推演九宫格",
    prompt: "基于参考图生成一张 3x3 连续剧情九宫格。把参考图作为统一视觉锚点，严格保持主体身份、服装、材质、场景布局、光线方向、色彩体系、镜头焦段、景深、颗粒/笔触和整体美术风格。九格按时间顺序自然推进同一段动作：从当前画面前后的合理动作、表情、姿态、视线、道具状态和环境微变化展开，节奏连贯，动作幅度逐格递进。每格都像同一部作品的连续分镜，只推进叙事，不重新设计角色、场景、服装或色调。禁止身份漂移、风格漂移、时空跳跃、文字、水印、畸变和 AI 伪影。",
  },
  white_bg_triptych: {
    label: "白底三视图",
    title: "白底三视图",
    prompt: "基于参考图生成白底三视图角色/主体设定图。先准确提取参考图中的主要主体，忽略原背景、环境光、杂物和道具干扰，只保留主体本身。严格锁定主体身份、比例、轮廓、脸部/关键特征、服装结构、颜色、材质、纹理和原有美术风格。输出纯白背景上的正面、侧面、背面三视图，三者等高对齐、比例一致、站姿/摆放稳定，适合角色设定或产品设定表。禁止沿用原背景、重设主体、改服装、改材质、改画风、加入文字、水印或多余装饰。",
  },
  scene_after_3s: {
    label: "画面推演 - 3秒后",
    title: "画面推演 - 3秒后",
    prompt: "基于参考图推演 3 秒后的单帧画面。严格保持主体身份、服装、材质、场景空间、镜头角度、焦段、景深、光线方向、色彩体系、阴影和整体美术风格。只让动作、表情、姿态、视线、道具位置或局部环境状态自然延续到 3 秒后，变化应可信、克制、连续。不要改变画风、时代、场景、角色身份、服装、主体比例或色调。禁止新增无关元素、文字、水印、畸变和 AI 伪影。",
  },
  scene_before_5s: {
    label: "画面推演 - 5秒前",
    title: "画面推演 - 5秒前",
    prompt: "基于参考图反推 5 秒前的单帧画面。严格保持主体身份、服装、材质、场景空间、镜头角度、焦段、景深、光线方向、色彩体系、阴影和整体美术风格。只回溯当前画面发生前的合理动作、表情、姿态、视线、道具位置或局部环境状态，让它看起来像同一镜头的自然前一刻。不要改变画风、时代、场景、角色身份、服装、主体比例或色调。禁止新增无关元素、文字、水印、畸变和 AI 伪影。",
  },
  upscale_grid_split: {
    label: "放大切分",
    title: "放大切分",
    prompt: "将参考图进行高保真超分辨率放大，目标为 4K 级清晰度。严格保持原图主体身份、比例、表情、服装细节、场景构图、镜头视角、光线方向、阴影、反射、原始色彩体系和整体艺术风格不变；增强细节清晰度、边缘质量、纹理层次、皮肤/毛发/布料/建筑等细节，但保持自然锐化。不要改变构图，不要新增元素，不要改变画幅比例，不要重绘成另一种风格，不要过度磨皮，不要锐化光晕，不要畸变，不要文字、水印或 AI 伪影。输出适合后续宫格切分的高清原比例图。",
  },
};
const LEGACY_GRID_TEMPLATE_TITLES = new Set([
  "宫格切分",
  "25宫格连贯分镜",
  "电影级光影校正",
  "角色三视图生成",
]);
const CANVAS_THEMES = [
  { value: "white", label: "白" },
  { value: "black", label: "黑" },
  { value: "contrast", label: "高对比" },
];

const PORT_LABELS = {
  out: "输出",
  output: "输出",
  input: "输入",
  base_image: "基础图",
  reference_image: "参考图",
  first_frame: "首帧",
  last_frame: "尾帧",
};

const IMAGE_MODE_PORTS = {
  text_only: [],
  base_only: ["base_image"],
  reference_only: ["reference_image"],
  multi_image: ["reference_image"],
  image_edit: ["reference_image"],
};

const VIDEO_SCENE_PORTS = {
  text_only: [],
  first_frame: ["first_frame"],
  first_last: ["first_frame", "last_frame"],
  multimodal_reference: ["reference_image"],
};

const state = {
  nodes: [],
  edges: [],
  viewport: { x: 120, y: 80, scale: 1 },
  canvasTheme: "white",
  selectedNodeIds: new Set(),
  selectedEdgeId: "",
  spaceDown: false,
  textEditing: false,
  nodePointer: null,
  nodeResize: null,
  drag: null,
  pan: null,
  selection: null,
  connecting: null,
  pollTimers: new Map(),
  picker: { items: [], offset: 0, hasMore: false, loading: false, replaceNodeId: "", requestId: 0 },
  pickerCache: new Map(),
  pickerDropPoint: null,
  gridSplit: { sourceNodeId: "", rows: 3, cols: 3, selected: new Set() },
  gridSplitChoicePending: false,
  multiCameraGrid: { sourceNodeId: "", point: null },
  mention: { menu: null, textarea: null, taskNode: null, items: [], activeIndex: 0, start: -1, end: -1 },
  previewPointer: null,
  contextMenuPoint: null,
  contextMenuNodeId: "",
  addLibraryNodeId: "",
  deleteTaskNodeIds: [],
};

function uid(prefix = "node") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setStatus(message) {
  if (statusText) statusText.textContent = message;
}

function imageModels() {
  return config.image_ui?.models || [];
}

function videoModels() {
  return config.video_ui?.models || [];
}

function firstOption(items, fallback = "") {
  return (items && items[0] && items[0].value) || fallback;
}

function defaultImageModelVariant() {
  const configured = String(config.image_ui?.default_model || "").trim();
  if (configured && imageModels().some((item) => item.value === configured)) {
    return configured;
  }
  if (imageModels().some((item) => item.value === "seedream_v5_0")) {
    return "seedream_v5_0";
  }
  return imageModels()[0]?.value || "";
}

function defaultVideoModelVariant() {
  if (videoModels().some((item) => item.value === "seedance_2_0")) {
    return "seedance_2_0";
  }
  return videoModels()[0]?.value || "";
}

function imageModelSpec(modelVariant = defaultImageModelVariant()) {
  return imageModels().find((item) => item.value === modelVariant) || imageModels()[0] || {};
}

function videoModelSpec(modelVariant) {
  return videoModels().find((item) => item.value === modelVariant) || videoModels()[0] || {};
}

function videoResolutionOptionsForModel(modelVariant, scene = "text_only") {
  const model = videoModelSpec(modelVariant);
  const supportedModelResolutions = Array.isArray(model.supported_resolutions) ? model.supported_resolutions : [];
  const sceneValue = String(scene || "text_only").trim() || "text_only";
  return (config.video_ui?.resolutions || []).filter((item) => {
    const supportedScenes = Array.isArray(item.supported_scenes) && item.supported_scenes.length
      ? item.supported_scenes
      : null;
    const supportsScene = !supportedScenes || supportedScenes.includes(sceneValue);
    const supportsModel = !supportedModelResolutions.length || supportedModelResolutions.includes(item.value);
    return supportsScene && supportsModel;
  });
}

function videoSceneOptionsForModel(modelVariant) {
  const model = videoModelSpec(modelVariant);
  if (Array.isArray(model.scenes) && model.scenes.length) {
    return model.scenes;
  }
  const supported = Array.isArray(model.supported_scenes) ? model.supported_scenes : [];
  return (config.video_ui?.scenes || []).filter((item) => !supported.length || supported.includes(item.value));
}

function videoSceneLabelForModel(sceneKey, modelVariant) {
  const normalizedKey = String(sceneKey || "").trim() || "text_only";
  const model = videoModelSpec(modelVariant);
  const scene = (model.scenes || []).find((item) => item.value === normalizedKey);
  if (scene?.label) {
    return scene.label;
  }
  if (model.scene_labels?.[normalizedKey]) {
    return model.scene_labels[normalizedKey];
  }
  return (config.video_ui?.scenes || []).find((item) => item.value === normalizedKey)?.label || normalizedKey;
}

function videoRatioOptionsForModel(modelVariant) {
  const model = videoModelSpec(modelVariant);
  const supported = Array.isArray(model.supported_ratios) ? model.supported_ratios : [];
  return (config.video_ui?.ratios || []).filter((item) => !supported.length || supported.includes(item.value));
}

function videoDurationOptionsForModel(modelVariant, scene = "text_only", resolution = "720p") {
  const model = videoModelSpec(modelVariant);
  const supported = Array.isArray(model.supported_durations) ? model.supported_durations.map((item) => String(item)) : [];
  let options = (config.video_ui?.durations || []).filter((item) => !supported.length || supported.includes(String(item.value)));
  return options;
}

function fallbackVideoResolution(modelVariant, scene = "text_only") {
  const options = videoResolutionOptionsForModel(modelVariant, scene);
  return options.some((item) => item.value === "720p") ? "720p" : firstOption(options, "720p");
}

function ensureVideoNodeConfig(node) {
  const model = videoModelSpec(node.config.model_variant);
  const sceneOptions = videoSceneOptionsForModel(node.config.model_variant);
  if (!sceneOptions.some((item) => item.value === node.config.scene_type)) {
    node.config.scene_type = sceneOptions.some((item) => item.value === "text_only") ? "text_only" : firstOption(sceneOptions, "text_only");
  }
  if (!videoResolutionOptionsForModel(node.config.model_variant, node.config.scene_type).some((item) => item.value === node.config.resolution_grade)) {
    node.config.resolution_grade = fallbackVideoResolution(node.config.model_variant, node.config.scene_type);
  }
  const ratioOptions = videoRatioOptionsForModel(node.config.model_variant);
  if (!ratioOptions.some((item) => item.value === node.config.ratio)) {
    node.config.ratio = ratioOptions.some((item) => item.value === "adaptive") ? "adaptive" : firstOption(ratioOptions, "16:9");
  }
  const durationOptions = videoDurationOptionsForModel(node.config.model_variant, node.config.scene_type, node.config.resolution_grade);
  if (!durationOptions.some((item) => String(item.value) === String(node.config.duration || ""))) {
    node.config.duration = Number(firstOption(durationOptions, "5"));
  }
  if (!model.supports_web_search || node.config.scene_type !== "text_only") {
    node.config.enable_web_search = false;
  }
}

function sizeOptionsForImage(model, ratio) {
  return model.size_options_by_ratio?.[ratio] || model.size_options || [];
}

function modelSupportsImageMode(model, mode) {
  return (model.modes || []).some((item) => item.value === mode);
}

function modeUsesReferenceImage(mode) {
  return (IMAGE_MODE_PORTS[mode] || []).includes("reference_image");
}

function referenceImageModeForModel(model, { currentMode = "", referenceCount = 0 } = {}) {
  if (modeUsesReferenceImage(currentMode) && modelSupportsImageMode(model, currentMode)) {
    return currentMode;
  }
  const preferredModes = [
    "image_edit",
    ...(Number(referenceCount || 0) > 1 ? ["multi_image"] : []),
    "reference_only",
    "multi_image",
  ];
  return preferredModes.find((mode) => modelSupportsImageMode(model, mode)) || "";
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseAspectRatioValue(value) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const width = positiveNumber(match[1]);
  const height = positiveNumber(match[2]);
  return width && height ? width / height : 0;
}

function imageAspectRatioValues(model) {
  return (model.aspect_ratios || [])
    .map((item) => String(item?.value || item || "").trim())
    .filter(Boolean);
}

function supportedAspectRatio(model, ratio) {
  const normalized = String(ratio || "").trim();
  return imageAspectRatioValues(model).includes(normalized) ? normalized : "";
}

function closestSupportedAspectRatioForTarget(model, target) {
  if (!target) return "";
  let best = "";
  let bestDistance = Infinity;
  imageAspectRatioValues(model).forEach((ratio) => {
    const value = parseAspectRatioValue(ratio);
    if (!value) return;
    const distance = Math.abs(Math.log(value) - Math.log(target));
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  });
  return best;
}

function closestSupportedAspectRatio(model, width, height) {
  const target = positiveNumber(width) / positiveNumber(height);
  return closestSupportedAspectRatioForTarget(model, target);
}

function closestSupportedAspectRatioFromRatio(model, ratio) {
  return closestSupportedAspectRatioForTarget(model, parseAspectRatioValue(ratio));
}

function videoRatioValues({ excludeAdaptive = false } = {}) {
  return (config.video_ui?.ratios || [])
    .map((item) => String(item.value || "").trim())
    .filter((value) => value && (!excludeAdaptive || value !== "adaptive"));
}

function supportedVideoRatio(ratio) {
  const normalized = String(ratio || "").trim();
  return videoRatioValues().includes(normalized) ? normalized : "";
}

function closestSupportedVideoRatio(width, height) {
  const target = positiveNumber(width) / positiveNumber(height);
  if (!target) return "";
  return closestSupportedVideoRatioForTarget(target);
}

function closestSupportedVideoRatioForTarget(target) {
  let best = "";
  let bestDistance = Infinity;
  videoRatioValues({ excludeAdaptive: true }).forEach((ratio) => {
    const value = parseAspectRatioValue(ratio);
    if (!value) return;
    const distance = Math.abs(Math.log(value) - Math.log(target));
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  });
  return best;
}

function closestSupportedVideoRatioFromRatio(ratio) {
  const value = parseAspectRatioValue(ratio);
  return value ? closestSupportedVideoRatioForTarget(value) : "";
}

function nodeImageDimensions(node) {
  if (!node) return null;
  const candidates = [
    [node.width, node.height],
    [node.image_width, node.image_height],
    [node.config?.width, node.config?.height],
    [node.config?.image_width, node.config?.image_height],
  ];
  for (const [width, height] of candidates) {
    const parsedWidth = positiveNumber(width);
    const parsedHeight = positiveNumber(height);
    if (parsedWidth && parsedHeight) {
      return { width: parsedWidth, height: parsedHeight };
    }
  }
  const image = domNodeById(node.id)?.querySelector?.(".canvas-node-media img");
  if (positiveNumber(image?.naturalWidth) && positiveNumber(image?.naturalHeight)) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return null;
}

function sourceAspectRatioForModel(sourceNode, model) {
  const dimensions = nodeImageDimensions(sourceNode);
  if (dimensions) {
    return closestSupportedAspectRatio(model, dimensions.width, dimensions.height);
  }
  const directRatio = supportedAspectRatio(model, sourceNode?.config?.aspect_ratio);
  if (directRatio) return directRatio;
  const sourceTask = sourceNode?.type === "image_result" ? sourceTaskForResultNode(sourceNode) : null;
  return supportedAspectRatio(model, sourceTask?.config?.aspect_ratio);
}

function sourceAspectRatioForVideo(sourceNode) {
  const dimensions = nodeImageDimensions(sourceNode);
  if (dimensions) {
    return closestSupportedVideoRatio(dimensions.width, dimensions.height);
  }
  const directRatio = supportedVideoRatio(sourceNode?.config?.aspect_ratio);
  if (directRatio && directRatio !== "adaptive") return directRatio;
  const closestDirectRatio = closestSupportedVideoRatioFromRatio(sourceNode?.config?.aspect_ratio);
  if (closestDirectRatio) return closestDirectRatio;
  const sourceTask = sourceNode?.type === "image_result" ? sourceTaskForResultNode(sourceNode) : null;
  const sourceTaskRatio = supportedVideoRatio(sourceTask?.config?.aspect_ratio);
  if (sourceTaskRatio && sourceTaskRatio !== "adaptive") return sourceTaskRatio;
  const closestSourceTaskRatio = closestSupportedVideoRatioFromRatio(sourceTask?.config?.aspect_ratio);
  if (closestSourceTaskRatio) return closestSourceTaskRatio;
  return supportedVideoRatio("adaptive") || firstOption(config.video_ui?.ratios, "adaptive");
}

function imageSizeForRatio(model, ratio, fallbackSize = "") {
  const options = sizeOptionsForImage(model, ratio);
  return fallbackSize && options.some((item) => item.value === fallbackSize)
    ? fallbackSize
    : (model.default_size || firstOption(options, ""));
}

function preferredImageSizeForRatio(model, ratio, fallbackSize = "") {
  const options = sizeOptionsForImage(model, ratio);
  if (fallbackSize && options.some((item) => item.value === fallbackSize)) return fallbackSize;
  if (model.default_size && options.some((item) => item.value === model.default_size)) return model.default_size;
  return firstOption(options, "");
}

function defaultImageConfig() {
  const model = imageModelSpec();
  const ratio = model.default_aspect_ratio || firstOption(model.aspect_ratios, "1:1");
  const sizeOptions = sizeOptionsForImage(model, ratio);
  return {
    prompt: "",
    model_variant: model.value || "",
    mode: model.default_mode || "text_only",
    aspect_ratio: ratio,
    size: model.default_size || firstOption(sizeOptions, ""),
    count: 1,
    output_format: model.default_output_format || "jpeg",
    quality: model.default_quality || "auto",
    background: model.default_background || "auto",
    moderation: model.default_moderation || "auto",
    output_compression: model.default_output_compression || 100,
    sequential_mode: false,
    enable_web_search: false,
  };
}

function imageEditConfigForSource(sourceNode, overrides = {}) {
  const base = defaultImageConfig();
  if (!sourceNode) {
    return { ...base, ...overrides };
  }
  const model = imageModelSpec(base.model_variant);
  const ratio = sourceAspectRatioForModel(sourceNode, model) || base.aspect_ratio;
  return {
    ...base,
    mode: modelSupportsImageMode(model, "image_edit") ? "image_edit" : base.mode,
    aspect_ratio: ratio,
    size: imageSizeForRatio(model, ratio, base.size),
    ...overrides,
  };
}

function imageEditConfigForSourceAndModel(sourceNode, modelVariant, overrides = {}) {
  const base = defaultImageConfig();
  const model = imageModelSpec(modelVariant || base.model_variant);
  const ratio = sourceAspectRatioForModel(sourceNode, model)
    || supportedAspectRatio(model, base.aspect_ratio)
    || model.default_aspect_ratio
    || firstOption(model.aspect_ratios, "1:1");
  return {
    ...base,
    model_variant: model.value || modelVariant || base.model_variant,
    mode: modelSupportsImageMode(model, "image_edit")
      ? "image_edit"
      : (modelSupportsImageMode(model, "reference_only")
        ? "reference_only"
        : (modelSupportsImageMode(model, "multi_image") ? "multi_image" : (model.default_mode || base.mode))),
    aspect_ratio: ratio,
    size: imageSizeForRatio(model, ratio, model.default_size || base.size),
    ...overrides,
  };
}

function preferredUpscaleImageModelVariant() {
  return imageModels().some((item) => item.value === "seedream_v5_0")
    ? "seedream_v5_0"
    : defaultImageModelVariant();
}

function defaultVideoConfig() {
  const model = videoModelSpec(defaultVideoModelVariant());
  return {
    prompt: "",
    model_variant: model.value || "",
    scene_type: "text_only",
    resolution_grade: fallbackVideoResolution(model.value || "", "text_only"),
    ratio: firstOption(config.video_ui?.ratios, "adaptive"),
    duration: Number(firstOption(config.video_ui?.durations, 5)),
    count: 1,
    seed: -1,
    generate_audio: true,
    enable_web_search: false,
  };
}

function videoFirstFrameConfigForSource(sourceNode, overrides = {}) {
  const base = defaultVideoConfig();
  const prompt = promptForResultNode(sourceNode)
    || "基于首帧生成自然流畅的视频，保持主体、风格、画面比例和视觉质感一致。";
  return {
    ...base,
    prompt,
    model_variant: defaultVideoModelVariant() || base.model_variant,
    scene_type: "first_frame",
    video_mode: "first_frame",
    ratio: sourceAspectRatioForVideo(sourceNode) || base.ratio,
    ...overrides,
  };
}

function nodeRole(node) {
  if (!node) return "input";
  if (node.type === "image_task" || node.type === "video_task") return "task";
  if (node.type === "image_result" || node.type === "video_result") return "result";
  return "input";
}

function nodeKind(node) {
  if (!node) return "";
  if (node.type.startsWith("image_")) return "image";
  if (node.type.startsWith("video_")) return "video";
  return "";
}

function gridSplitCellLabel(cell = {}) {
  const row = Number(cell?.row || 0);
  const col = Number(cell?.col || 0);
  return row > 0 && col > 0 ? `切分 ${row}-${col}` : "切分";
}

function isGridSplitInputNode(node) {
  if (!node || node.type !== "image_input") return false;
  const sourceGroup = String(node.source_group || node.config?.source_group || "").trim();
  const cell = node.grid_cell || node.config?.grid_cell || {};
  return sourceGroup === "宫格切分" || Boolean(cell.row || cell.col);
}

function nodeTitle(node) {
  if (!node) return "";
  if (node.type === "image_task") return node.label || "生图任务";
  if (node.type === "video_task") return node.label || "生视频任务";
  if (node.type === "image_result") return node.label || "图片结果";
  if (node.type === "video_result") return node.label || "视频结果";
  if (isGridSplitInputNode(node)) return gridSplitCellLabel(node.grid_cell || node.config?.grid_cell);
  return node.label || "图输入";
}

function nodeSize(node) {
  const role = nodeRole(node);
  const defaultWidth = NODE_WIDTH[role] || 156;
  const defaultHeight = NODE_HEIGHT[role] || 124;
  const minWidth = NODE_MIN_WIDTH[role] || 104;
  const minHeight = NODE_MIN_HEIGHT[role] || 80;
  return {
    width: Math.max(minWidth, Math.min(NODE_MAX_WIDTH, Number(node?.width || defaultWidth))),
    height: Math.max(minHeight, Math.min(NODE_MAX_HEIGHT, Number(node?.height || defaultHeight))),
  };
}

function resetNodeSize(node) {
  delete node.width;
  delete node.height;
}

function nodeById(id) {
  return state.nodes.find((node) => node.id === id) || null;
}

function domNodeById(id) {
  const escaped = globalThis.CSS?.escape ? CSS.escape(id) : String(id).replaceAll('"', '\\"');
  return world.querySelector(`[data-node-id="${escaped}"]`);
}

function rememberLibraryCategory(category) {
  const normalized = String(category || "").trim();
  if (!normalized) return;
  if (!Array.isArray(config.asset_tag_categories)) {
    config.asset_tag_categories = [];
  }
  if (!config.asset_tag_categories.includes(normalized)) {
    config.asset_tag_categories.unshift(normalized);
  }
}

function libraryCategoryOptions() {
  const configured = Array.isArray(config.asset_tag_categories) ? config.asset_tag_categories : [];
  const seen = new Set();
  const options = [];
  [CANVAS_LIBRARY_CATEGORY, ...configured, ...FALLBACK_LIBRARY_CATEGORIES].forEach((item) => {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push(value);
  });
  return options;
}

function graphPayload() {
  return {
    version: 2,
    nodes: state.nodes,
    edges: state.edges,
    viewport: state.viewport,
    canvas_theme: state.canvasTheme,
  };
}

function normalizeCanvasTheme(value) {
  const normalized = String(value || "white").trim().toLowerCase();
  return CANVAS_THEMES.some((item) => item.value === normalized) ? normalized : "white";
}

function storedCanvasTheme() {
  try {
    const raw = localStorage.getItem(CANVAS_THEME_STORAGE_KEY);
    return raw ? normalizeCanvasTheme(raw) : "";
  } catch (_error) {
    return "";
  }
}

function rememberCanvasTheme(theme) {
  try {
    localStorage.setItem(CANVAS_THEME_STORAGE_KEY, normalizeCanvasTheme(theme));
  } catch (_error) {
    // Browser storage may be unavailable; server-side canvas state remains the source of truth.
  }
}

function canvasThemeLabel() {
  return CANVAS_THEMES.find((item) => item.value === state.canvasTheme)?.label || "白";
}

function applyCanvasTheme() {
  state.canvasTheme = normalizeCanvasTheme(state.canvasTheme);
  canvasPage?.setAttribute("data-canvas-theme", state.canvasTheme);
  const button = document.getElementById("canvasThemeToggle");
  if (button) {
    button.textContent = `画布：${canvasThemeLabel()}`;
  }
}

function cycleCanvasTheme() {
  const currentIndex = Math.max(0, CANVAS_THEMES.findIndex((item) => item.value === state.canvasTheme));
  state.canvasTheme = CANVAS_THEMES[(currentIndex + 1) % CANVAS_THEMES.length].value;
  rememberCanvasTheme(state.canvasTheme);
  applyCanvasTheme();
  saveState();
}

function worldPointFromEvent(event) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.viewport.x) / state.viewport.scale,
    y: (event.clientY - rect.top - state.viewport.y) / state.viewport.scale,
  };
}

function screenPointFromWorld(point) {
  return {
    x: point.x * state.viewport.scale + state.viewport.x,
    y: point.y * state.viewport.scale + state.viewport.y,
  };
}

function applyViewport() {
  world.style.transform = `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.scale})`;
  renderEdges();
}

function updateViewportModeClass() {
  viewport?.classList.toggle("is-space-selecting", Boolean(state.spaceDown));
  viewport?.classList.toggle("is-selecting", Boolean(state.selection));
}

let saveTimer = null;
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveState, 450);
}

async function saveState() {
  try {
    await fetchJson("/api/canvas/state", {
      method: "PUT",
      body: JSON.stringify(graphPayload()),
    });
    setStatus("画布已保存");
  } catch (error) {
    showToast(String(error?.message || error));
  }
}

async function loadState() {
  const payload = await fetchJson("/api/canvas/state");
  const saved = payload.state || {};
  const savedTheme = saved.canvas_theme || saved.canvasTheme;
  const localTheme = storedCanvasTheme();
  state.nodes = Array.isArray(saved.nodes) ? saved.nodes : [];
  state.edges = Array.isArray(saved.edges) ? saved.edges : [];
  state.viewport = {
    x: Number(saved.viewport?.x ?? 120),
    y: Number(saved.viewport?.y ?? 80),
    scale: Number(saved.viewport?.scale ?? 1),
  };
  state.canvasTheme = normalizeCanvasTheme(savedTheme || localTheme);
  applyCanvasTheme();
  const normalized = normalizeSavedGraph();
  render();
  if (normalized || (!savedTheme && localTheme)) scheduleSave();
  hydratePersistedHistoryResults().catch(() => {});
}

function normalizeSavedGraph() {
  const allowed = new Set(["image_input", "image_task", "video_task", "image_result", "video_result"]);
  const beforeNodeCount = state.nodes.length;
  const beforeEdgeCount = state.edges.length;
  state.nodes = state.nodes.filter((node) => allowed.has(node.type));
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  state.edges = state.edges.filter((edge) => (
    nodeIds.has(edge.source_node_id)
    && nodeIds.has(edge.target_node_id)
    && isValidConnection(edge.source_node_id, edge.source_port, edge.target_node_id, edge.target_port)
  ));
  const pruned = pruneResolvedTaskPlaceholders();
  spreadOverlappingNodes();
  return pruned || beforeNodeCount !== state.nodes.length || beforeEdgeCount !== state.edges.length;
}

function nodesOverlap(a, b) {
  const aSize = nodeSize(a);
  const bSize = nodeSize(b);
  const ax = Number(a.x || 0);
  const ay = Number(a.y || 0);
  const bx = Number(b.x || 0);
  const by = Number(b.y || 0);
  return ax < bx + bSize.width + AUTO_LAYOUT_COLLISION_GAP
    && ax + aSize.width + AUTO_LAYOUT_COLLISION_GAP > bx
    && ay < by + bSize.height + AUTO_LAYOUT_COLLISION_GAP
    && ay + aSize.height + AUTO_LAYOUT_COLLISION_GAP > by;
}

function findOpenPosition(base, node, placedNodes = null) {
  let x = Number(base.x || 0);
  let y = Number(base.y || 0);
  let probe = { ...node, x, y };
  let guard = 0;
  const collides = () => {
    const candidates = placedNodes || state.nodes;
    return candidates.some((other) => other.id !== node.id && nodesOverlap(probe, other));
  };
  while (collides() && guard < 120) {
    x += 42;
    y += 34;
    if (guard % 6 === 5) {
      x = Number(base.x || 0) + 220 + Math.floor(guard / 6) * 36;
      y += 120;
    }
    probe = { ...node, x, y };
    guard += 1;
  }
  return { x, y };
}

function spreadOverlappingNodes() {
  let changed = false;
  const placed = [];
  state.nodes.forEach((node, index) => {
    const fallback = {
      x: 80 + (index % 3) * 280,
      y: 80 + Math.floor(index / 3) * 170,
    };
    if (!Number.isFinite(Number(node.x))) node.x = fallback.x;
    if (!Number.isFinite(Number(node.y))) node.y = fallback.y;
    const position = findOpenPosition({ x: node.x, y: node.y }, node, placed);
    if (position.x !== node.x || position.y !== node.y) {
      node.x = position.x;
      node.y = position.y;
      changed = true;
    }
    placed.push(node);
  });
  if (changed) scheduleSave();
}

function imageTaskPorts(node) {
  const mode = String(node?.config?.mode || "text_only").trim() || "text_only";
  return IMAGE_MODE_PORTS[mode] || [];
}

function videoTaskPorts(node) {
  const scene = String(node?.config?.scene_type || "text_only").trim() || "text_only";
  return VIDEO_SCENE_PORTS[scene] || [];
}

function inputPortsForNode(node) {
  if (node?.type === "image_task") return imageTaskPorts(node);
  if (node?.type === "video_task") return videoTaskPorts(node);
  if (node?.type === "image_input") return ["input"];
  if (node?.type === "image_result" || node?.type === "video_result") return ["input"];
  return [];
}

function outputPortsForNode(node) {
  if (node?.type === "image_input" || node?.type === "image_result") return ["out"];
  if (node?.type === "image_task" || node?.type === "video_task") return ["output"];
  return [];
}

function isTaskOutputConnection(sourceNode, sourcePort, targetNode, targetPort) {
  const sourceType = sourceNode?.type;
  const targetType = targetNode?.type;
  const outputPort = sourcePort === "out" || sourcePort === "output";
  const inputPort = targetPort === "in" || targetPort === "input";
  return outputPort && inputPort && (
    (sourceType === "image_task" && targetType === "image_result")
    || (sourceType === "video_task" && targetType === "video_result")
  );
}

function isImageContextConnection(sourceNode, sourcePort, targetNode, targetPort) {
  return sourcePort === "out"
    && targetPort === "input"
    && (sourceNode?.type === "image_input" || sourceNode?.type === "image_result")
    && targetNode?.type === "image_input";
}

function isValidConnection(sourceId, sourcePort, targetId, targetPort) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const sourceNode = nodeById(sourceId);
  const targetNode = nodeById(targetId);
  if (!sourceNode || !targetNode) return false;
  if (!outputPortsForNode(sourceNode).includes(sourcePort)) return false;
  if (!inputPortsForNode(targetNode).includes(targetPort)) return false;
  if (isTaskOutputConnection(sourceNode, sourcePort, targetNode, targetPort)) return true;
  if (isImageContextConnection(sourceNode, sourcePort, targetNode, targetPort)) return true;
  if ((sourceNode.type === "image_input" || sourceNode.type === "image_result") && sourcePort === "out") {
    return (targetNode.type === "image_task" || targetNode.type === "video_task")
      && inputPortsForNode(targetNode).includes(targetPort);
  }
  return false;
}

function connectNodes(sourceId, sourcePort, targetId, targetPort) {
  if (!isValidConnection(sourceId, sourcePort, targetId, targetPort)) {
    showToast("这两个端口不能连接");
    return false;
  }
  const exists = state.edges.some((edge) => (
    edge.source_node_id === sourceId
    && edge.source_port === sourcePort
    && edge.target_node_id === targetId
    && edge.target_port === targetPort
  ));
  if (exists) {
    stopConnecting();
    return true;
  }
  if (SINGLE_INPUT_PORTS.has(targetPort)) {
    state.edges = state.edges.filter((edge) => !(edge.target_node_id === targetId && edge.target_port === targetPort));
  }
  state.edges.push({
    id: uid("edge"),
    source_node_id: sourceId,
    source_port: sourcePort,
    target_node_id: targetId,
    target_port: targetPort,
  });
  state.selectedEdgeId = "";
  stopConnecting();
  render();
  scheduleSave();
  return true;
}

function connectImageNodeToTask(sourceId, taskNode, targetPort) {
  if (!sourceId || !taskNode?.id || !targetPort) {
    return false;
  }
  if (!isValidConnection(sourceId, "out", taskNode.id, targetPort)) {
    return false;
  }
  const hasExistingSource = state.edges.some((edge) => (
    edge.source_node_id === sourceId
    && edge.target_node_id === taskNode.id
    && edge.target_port === targetPort
  ));
  if (hasExistingSource) {
    return true;
  }
  if (SINGLE_INPUT_PORTS.has(targetPort)) {
    state.edges = state.edges.filter((edge) => !(edge.target_node_id === taskNode.id && edge.target_port === targetPort));
  }
  state.edges.push({
    id: uid("edge"),
    source_node_id: sourceId,
    source_port: "out",
    target_node_id: taskNode.id,
    target_port: targetPort,
  });
  state.selectedEdgeId = "";
  state.connecting = null;
  renderEdges();
  scheduleSave();
  return true;
}

function connectImageContextNode(sourceId, imageNode) {
  if (!sourceId || !imageNode?.id || !isValidConnection(sourceId, "out", imageNode.id, "input")) {
    return false;
  }
  const exists = state.edges.some((edge) => (
    edge.source_node_id === sourceId
    && edge.source_port === "out"
    && edge.target_node_id === imageNode.id
    && edge.target_port === "input"
  ));
  if (exists) {
    return true;
  }
  state.edges.push({
    id: uid("edge"),
    source_node_id: sourceId,
    source_port: "out",
    target_node_id: imageNode.id,
    target_port: "input",
  });
  state.selectedEdgeId = "";
  state.connecting = null;
  renderEdges();
  scheduleSave();
  return true;
}

function preferredMentionPort(taskNode, sourceId) {
  const ports = inputPortsForNode(taskNode).filter((port) => ["base_image", "reference_image", "first_frame", "last_frame"].includes(port));
  if (!ports.length) {
    return "";
  }
  const available = ports.find((port) => (
    !SINGLE_INPUT_PORTS.has(port)
    || !state.edges.some((edge) => edge.target_node_id === taskNode.id && edge.target_port === port)
  ));
  const existing = ports.find((port) => state.edges.some((edge) => (
    edge.source_node_id === sourceId
    && edge.target_node_id === taskNode.id
    && edge.target_port === port
  )));
  return existing || available || ports[0];
}

function imageMentionSources(taskNode, query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const validPorts = inputPortsForNode(taskNode);
  const portOrder = new Map(validPorts.map((port, index) => [port, index]));
  const seen = new Set();
  const sourceNodes = state.edges
    .filter((edge) => edge.target_node_id === taskNode?.id && portOrder.has(edge.target_port))
    .sort((left, right) => (portOrder.get(left.target_port) || 0) - (portOrder.get(right.target_port) || 0))
    .map((edge) => nodeById(edge.source_node_id))
    .filter((node) => node && (node.type === "image_input" || node.type === "image_result"))
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
  return sourceNodes
    .map((node) => ({
      node,
      label: nodeTitle(node),
      thumbnail: node.thumbnail_url || node.public_url || "",
    }))
    .filter((item) => !normalizedQuery || item.label.toLowerCase().includes(normalizedQuery))
    .slice(0, 12);
}

function mentionRangeForTextarea(textarea) {
  const caret = textarea.selectionStart ?? 0;
  const beforeCaret = textarea.value.slice(0, caret);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0) {
    return null;
  }
  const query = beforeCaret.slice(atIndex + 1);
  if (/[\r\n]/.test(query) || /\s/.test(query)) {
    return null;
  }
  return { start: atIndex, end: caret, query };
}

function hideMentionMenu() {
  if (state.mention.menu) {
    state.mention.menu.hidden = true;
    state.mention.menu.innerHTML = "";
  }
  state.mention = { menu: null, textarea: null, taskNode: null, items: [], activeIndex: 0, start: -1, end: -1 };
}

function connectMentionSourceToTask(sourceNode, taskNode) {
  const targetPort = preferredMentionPort(taskNode, sourceNode.id);
  if (!targetPort) {
    showToast("当前生成方式不需要图片输入，已仅插入提示词引用");
    return false;
  }
  const ok = connectImageNodeToTask(sourceNode.id, taskNode, targetPort);
  if (!ok) {
    showToast("这张图不能连接到当前任务模式");
  }
  return ok;
}

function applyMentionSelection(item) {
  const textarea = state.mention.textarea;
  const taskNode = state.mention.taskNode;
  if (!textarea || !taskNode || !item?.node) {
    hideMentionMenu();
    return;
  }
  const before = textarea.value.slice(0, state.mention.start);
  const after = textarea.value.slice(state.mention.end);
  const insertion = `@${item.label} `;
  textarea.value = `${before}${insertion}${after}`;
  const caret = before.length + insertion.length;
  textarea.setSelectionRange(caret, caret);
  taskNode.config.prompt = textarea.value;
  syncTaskNodePromptPreview(taskNode);
  connectMentionSourceToTask(item.node, taskNode);
  scheduleSave();
  hideMentionMenu();
  textarea.focus();
}

function renderMentionMenu(menu, textarea, taskNode) {
  const range = mentionRangeForTextarea(textarea);
  if (!range) {
    hideMentionMenu();
    return;
  }
  const items = imageMentionSources(taskNode, range.query);
  state.mention = {
    menu,
    textarea,
    taskNode,
    items,
    activeIndex: Math.min(state.mention.activeIndex || 0, Math.max(items.length - 1, 0)),
    start: range.start,
    end: range.end,
  };
  menu.innerHTML = "";
  if (!items.length) {
    const hasConnectedImages = imageMentionSources(taskNode).length > 0;
    const empty = createElement(
      "div",
      "canvas-mention-empty",
      hasConnectedImages ? "没有匹配的已连接图片" : "请先把图片节点连接到当前任务"
    );
    menu.append(empty);
    menu.hidden = false;
    return;
  }
  items.forEach((item, index) => {
    const button = createElement("button", `canvas-mention-item${index === state.mention.activeIndex ? " is-active" : ""}`);
    button.type = "button";
    if (item.thumbnail) {
      const img = document.createElement("img");
      img.src = item.thumbnail;
      img.alt = item.label;
      button.append(img);
    } else {
      button.append(createElement("span", "canvas-mention-thumb-fallback", "图"));
    }
    const text = createElement("span", "canvas-mention-label", item.label);
    button.append(text);
    if (state.edges.some((edge) => edge.source_node_id === item.node.id && edge.target_node_id === taskNode.id)) {
      button.append(createElement("span", "canvas-mention-tag", "已连接"));
    }
    button.addEventListener("mouseenter", () => {
      state.mention.activeIndex = index;
      updateMentionActiveItem(menu);
    });
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyMentionSelection(item);
    });
    menu.append(button);
  });
  menu.hidden = false;
}

function updateMentionActiveItem(menu) {
  menu.querySelectorAll(".canvas-mention-item").forEach((item, index) => {
    item.classList.toggle("is-active", index === state.mention.activeIndex);
  });
}

function handleMentionKeydown(event, menu, textarea, taskNode) {
  const menuOpen = Boolean(menu && !menu.hidden && state.mention.textarea === textarea);
  if (!menuOpen) {
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const total = state.mention.items.length;
    if (!total) return;
    event.preventDefault();
    state.mention.activeIndex = (state.mention.activeIndex + direction + total) % total;
    updateMentionActiveItem(menu);
  } else if (event.key === "Enter" || event.key === "Tab") {
    const item = state.mention.items[state.mention.activeIndex];
    if (item) {
      event.preventDefault();
      applyMentionSelection(item);
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    hideMentionMenu();
  }
}

function pruneInvalidEdgesForNode(nodeId, { notify = false } = {}) {
  const before = state.edges.length;
  state.edges = state.edges.filter((edge) => (
    edge.target_node_id !== nodeId
    || isValidConnection(edge.source_node_id, edge.source_port, edge.target_node_id, edge.target_port)
  ));
  if (notify && before !== state.edges.length) {
    showToast("已移除与当前模式不匹配的连线");
  }
}

function portPoint(node, port, side) {
  const size = nodeSize(node);
  const ports = side === "input" ? inputPortsForNode(node) : outputPortsForNode(node);
  const index = Math.max(0, ports.indexOf(port));
  const top = PORT_TOP + (PORT_SIZE / 2) + index * (PORT_SIZE + PORT_GAP);
  return {
    x: Number(node.x || 0) + (side === "input" ? 0 : size.width),
    y: Number(node.y || 0) + top,
  };
}

function edgePath(start, end) {
  const dx = Math.max(70, Math.abs(end.x - start.x) * 0.45);
  return `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
}

function renderEdges() {
  edgeLayer.innerHTML = "";
  const rect = viewport.getBoundingClientRect();
  edgeLayer.setAttribute("width", String(rect.width));
  edgeLayer.setAttribute("height", String(rect.height));
  edgeLayer.setAttribute("viewBox", `${-state.viewport.x / state.viewport.scale} ${-state.viewport.y / state.viewport.scale} ${rect.width / state.viewport.scale} ${rect.height / state.viewport.scale}`);

  state.edges.forEach((edge) => {
    const source = nodeById(edge.source_node_id);
    const target = nodeById(edge.target_node_id);
    if (!source || !target) return;
    const start = portPoint(source, edge.source_port, "output");
    const end = portPoint(target, edge.target_port, "input");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", edgePath(start, end));
    path.classList.add("canvas-edge");
    if (state.selectedEdgeId === edge.id) path.classList.add("is-selected");
    path.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      state.selectedEdgeId = edge.id;
      state.selectedNodeIds.clear();
      render();
    });
    edgeLayer.append(path);
  });

  if (state.connecting?.preview) {
    const source = nodeById(state.connecting.source_node_id);
    if (source) {
      const start = portPoint(source, state.connecting.source_port, "output");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edgePath(start, state.connecting.preview));
      path.classList.add("canvas-edge", "canvas-edge-preview");
      edgeLayer.append(path);
    }
  }
}

function render() {
  world.innerHTML = "";
  state.nodes.forEach((node) => {
    world.append(renderNode(node));
  });
  applyViewport();
  renderInspector();
}

function renderNode(node) {
  const size = nodeSize(node);
  const nodeEl = createElement("article", `canvas-node is-${nodeRole(node)} is-${node.type}`);
  if (isGridTemplateTask(node)) {
    nodeEl.classList.add("is-grid-template-task");
    nodeEl.title = "九宫格相关任务";
  }
  nodeEl.style.left = `${Number(node.x || 0)}px`;
  nodeEl.style.top = `${Number(node.y || 0)}px`;
  nodeEl.style.width = `${size.width}px`;
  nodeEl.style.minHeight = `${size.height}px`;
  nodeEl.style.height = `${size.height}px`;
  nodeEl.dataset.nodeId = node.id;
  if (state.selectedNodeIds.has(node.id)) nodeEl.classList.add("is-selected");

  nodeEl.addEventListener("pointerdown", (event) => startNodePointer(event, node));

  const header = createElement("div", "canvas-node-header");
  header.append(createElement("strong", "", nodeTitle(node)));
  const badge = nodeBadge(node);
  if (badge) {
    header.append(createElement("span", "", badge));
  }
  nodeEl.append(header);

  const body = createElement("div", "canvas-node-body");
  if (nodeRole(node) === "task") {
    body.append(renderTaskBody(node));
  } else {
    body.append(renderMedia(node));
  }
  nodeEl.append(body);

  const inputs = inputPortsForNode(node);
  if (inputs.length) {
    const inputWrap = createElement("div", "canvas-node-ports is-inputs");
    inputs.forEach((port) => inputWrap.append(renderPort(node, port, "input")));
    nodeEl.append(inputWrap);
  }
  const outputs = outputPortsForNode(node);
  if (outputs.length) {
    const outputWrap = createElement("div", "canvas-node-ports is-outputs");
    outputs.forEach((port) => outputWrap.append(renderPort(node, port, "output")));
    nodeEl.append(outputWrap);
  }
  const resizeHandle = createElement("div", "canvas-node-resize-handle");
  resizeHandle.title = "调整节点大小";
  resizeHandle.setAttribute("aria-hidden", "true");
  resizeHandle.addEventListener("pointerdown", (event) => startNodeResize(event, node));
  nodeEl.append(resizeHandle);
  return nodeEl;
}

function nodeBadge(node) {
  const referenceOrder = referenceOrderForNode(node);
  if (referenceOrder) return `图${referenceOrder}`;
  if (isGridSplitInputNode(node)) return "切分";
  if (node.type === "image_input") return "图";
  if (nodeRole(node) === "result") return "";
  return statusLabel(node.status || "idle");
}

function isGridTemplateTask(node) {
  if (!node || node.type !== "image_task") return false;
  const templateKey = String(node.config?.canvas_template || node.config?.grid_template || "").trim();
  if (templateKey && GRID_TEMPLATES[templateKey]) return true;
  const title = String(node.label || "").trim();
  if (LEGACY_GRID_TEMPLATE_TITLES.has(title)) return true;
  return Object.values(GRID_TEMPLATES).some((template) => (
    title === template.title
    || title === template.label
    || String(node.config?.prompt || "").trim() === template.prompt
  ));
}

function statusLabel(status) {
  return {
    idle: "待运行",
    pending: "已提交",
    queued: "排队中",
    running: "生成中",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
    expired: "超时",
  }[status] || status || "待运行";
}

function modeLabel(node) {
  if (node.type === "image_task") {
    const spec = imageModelSpec(node.config?.model_variant);
    return (spec.modes || []).find((item) => item.value === node.config?.mode)?.label || node.config?.mode || "文生图";
  }
  if (node.type === "video_task") {
    return videoSceneLabelForModel(node.config?.scene_type, node.config?.model_variant) || "文生视频";
  }
  return "";
}

function safeClassName(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
}

function taskModeClass(node) {
  if (node.type === "image_task") {
    return `mode-${safeClassName(node.config?.mode || "text_only")}`;
  }
  if (node.type === "video_task") {
    return `mode-${safeClassName(node.config?.scene_type || "text_only")}`;
  }
  return "mode-default";
}

function renderTaskBody(node) {
  const wrap = createElement("div", "canvas-task-compact");
  const pill = createElement("span", `canvas-task-pill is-${node.status || "idle"} kind-${nodeKind(node)} ${taskModeClass(node)}`, modeLabel(node));
  wrap.append(pill);
  const modelLabel = node.type === "image_task"
    ? imageModelSpec(node.config?.model_variant).label
    : videoModelSpec(node.config?.model_variant).label;
  wrap.append(createElement("p", "", modelLabel || "选择模型"));
  if (node.type === "video_task") {
    const duration = Number(node.config?.duration || 0);
    wrap.append(createElement("p", "canvas-node-brief", duration ? `${duration} 秒` : "选择时长"));
  }
  return wrap;
}

function syncTaskNodePromptPreview(node) {
  const resultNodes = taskResultNodes(node || {});
  resultNodes.forEach((resultNode) => {
    resultNode.source_prompt = String(node?.config?.prompt || "").trim();
  });
}

function renderMedia(node) {
  const wrap = createElement("div", "canvas-node-media");
  const url = node.thumbnail_url || node.public_url;
  if (url) {
    const previewUrl = previewUrlForNode(node);
    if (previewUrl) {
      wrap.classList.add("is-previewable");
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "button");
      wrap.setAttribute("aria-label", `预览 ${nodeTitle(node)}`);
      wrap.title = "点击预览";
      wrap.dataset.previewNodeId = node.id;
      wrap.addEventListener("click", (event) => {
        if (viewport?.contains(wrap)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openCanvasMediaPreview(node);
      });
      wrap.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openCanvasMediaPreview(node);
      });
    }
    const img = document.createElement("img");
    img.src = url;
    img.alt = nodeTitle(node);
    img.loading = "lazy";
    img.draggable = false;
    wrap.append(img);
  } else {
    let placeholder = node.type === "image_input" ? "选择图片" : "等待结果";
    if (nodeRole(node) === "result" && ["pending", "queued", "running"].includes(String(node.status || ""))) {
      placeholder = "生成中";
    } else if (nodeRole(node) === "result" && String(node.status || "") === "failed") {
      placeholder = "生成失败";
    }
    wrap.append(createElement("div", `canvas-node-placeholder is-${node.status || "idle"}`, placeholder));
  }
  return wrap;
}

function previewKindForNode(node) {
  if (node?.type === "image_input" || node?.type === "image_result") return "image";
  if (node?.type === "video_result") return "video";
  return "";
}

function previewUrlForNode(node) {
  const kind = previewKindForNode(node);
  if (kind === "video") {
    return String(node.public_url || node.config?.public_url || node.source_url || node.video_url || "").trim();
  }
  if (kind === "image") {
    return String(node.public_url || node.config?.public_url || node.source_url || node.thumbnail_url || "").trim();
  }
  return "";
}

function previewMetaForNode(node) {
  if (node.type === "image_input") {
    return node.source_group || "图输入";
  }
  if (node.type === "video_result") {
    return node.history_id ? `来自任务记录：${node.history_id}` : "视频结果";
  }
  if (node.history_id) {
    return `来自任务记录：${node.history_id}`;
  }
  return "图片结果";
}

function openCanvasMediaPreview(node) {
  const url = previewUrlForNode(node);
  const kind = previewKindForNode(node);
  if (!url || !previewDialog || !previewImage || !previewVideo || !kind) {
    showToast("当前节点没有可预览的媒体");
    return;
  }
  if (previewTitle) previewTitle.textContent = nodeTitle(node);
  if (previewMeta) previewMeta.textContent = previewMetaForNode(node);
  previewImage.hidden = kind !== "image";
  previewVideo.hidden = kind !== "video";
  if (kind === "image") {
    previewVideo.pause();
    previewVideo.removeAttribute("src");
    previewImage.src = url;
    previewImage.alt = nodeTitle(node);
  } else {
    previewImage.removeAttribute("src");
    previewImage.alt = "";
    previewVideo.src = url;
    previewVideo.setAttribute("aria-label", nodeTitle(node));
  }
  if (!previewDialog.open) {
    previewDialog.showModal();
  }
}

function renderPort(node, port, side) {
  const label = PORT_LABELS[port] || port;
  const portEl = createElement("button", `canvas-port is-${side} port-${safeClassName(port)}`);
  portEl.type = "button";
  portEl.title = label;
  portEl.setAttribute("aria-label", label);
  portEl.dataset.nodeId = node.id;
  portEl.dataset.port = port;
  portEl.dataset.side = side;
  if (state.connecting && side === "input") {
    const ok = isValidConnection(state.connecting.source_node_id, state.connecting.source_port, node.id, port);
    portEl.classList.add(ok ? "can-connect" : "cannot-connect");
  }
  if (state.connecting?.source_node_id === node.id && state.connecting?.source_port === port) {
    portEl.classList.add("is-connecting");
  }
  portEl.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (side === "output") {
      startConnecting(node.id, port, event);
    } else if (state.connecting) {
      connectNodes(state.connecting.source_node_id, state.connecting.source_port, node.id, port);
    }
  });
  portEl.addEventListener("click", (event) => {
    event.stopPropagation();
    if (side === "output") {
      startConnecting(node.id, port, event);
    } else if (state.connecting) {
      connectNodes(state.connecting.source_node_id, state.connecting.source_port, node.id, port);
    }
  });
  return portEl;
}

function selectNode(nodeId, additive = false) {
  if (!additive) state.selectedNodeIds.clear();
  if (state.selectedNodeIds.has(nodeId) && additive) {
    state.selectedNodeIds.delete(nodeId);
  } else {
    state.selectedNodeIds.add(nodeId);
  }
  state.selectedEdgeId = "";
  render();
}

function selectedNode() {
  const [nodeId] = [...state.selectedNodeIds];
  return nodeId ? nodeById(nodeId) : null;
}

function selectedImageSourceNodes() {
  return [...state.selectedNodeIds]
    .map((nodeId) => nodeById(nodeId))
    .filter((node) => node && (node.type === "image_input" || node.type === "image_result"));
}

function imageReferenceIdentity(node) {
  if (!node) return "";
  const config = node.config || {};
  return String(
    node.asset_id
    || config.asset_id
    || (node.history_id ? `history:${node.history_id}:${Number(node.artifact_index || 0)}` : "")
    || node.public_url
    || config.public_url
    || node.source_url
    || node.id
    || "",
  ).trim();
}

function supportsReferenceImageOrder(taskNode) {
  return taskNode?.type === "image_task" && inputPortsForNode(taskNode).includes("reference_image");
}

function referenceOrderTaskForNode(node) {
  const selected = selectedNode();
  if (supportsReferenceImageOrder(selected)) {
    return selected;
  }
  if (node?.type !== "image_input" && node?.type !== "image_result") {
    return null;
  }
  const taskIds = [];
  state.edges.forEach((edge) => {
    if (edge.source_node_id !== node.id || edge.target_port !== "reference_image") {
      return;
    }
    const taskNode = nodeById(edge.target_node_id);
    if (supportsReferenceImageOrder(taskNode) && !taskIds.includes(taskNode.id)) {
      taskIds.push(taskNode.id);
    }
  });
  if (!taskIds.length) {
    return null;
  }
  if (selected && taskIds.includes(selected.id)) {
    return selected;
  }
  return nodeById(taskIds[0]);
}

function referenceOrderForNode(node) {
  if (!node || (node.type !== "image_input" && node.type !== "image_result")) {
    return 0;
  }
  const taskNode = referenceOrderTaskForNode(node);
  if (!taskNode) return 0;
  const targetIdentity = imageReferenceIdentity(node);
  if (!targetIdentity) return 0;
  const seen = new Set();
  let order = 0;
  for (const edge of state.edges) {
    if (edge.target_node_id !== taskNode.id || edge.target_port !== "reference_image") {
      continue;
    }
    const sourceNode = nodeById(edge.source_node_id);
    if (!sourceNode || (sourceNode.type !== "image_input" && sourceNode.type !== "image_result")) {
      continue;
    }
    const identity = imageReferenceIdentity(sourceNode);
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    order += 1;
    if (identity === targetIdentity) {
      return order;
    }
  }
  return 0;
}

function nodeBounds(node, override = null) {
  const size = nodeSize(node);
  const x = Number(override?.x ?? node?.x ?? 0);
  const y = Number(override?.y ?? node?.y ?? 0);
  return {
    left: x,
    centerX: x + size.width / 2,
    right: x + size.width,
    top: y,
    centerY: y + size.height / 2,
    bottom: y + size.height,
  };
}

function graphNodeBounds() {
  if (!state.nodes.length) return null;
  return state.nodes.reduce((bounds, node) => {
    const current = nodeBounds(node);
    if (!bounds) return { ...current };
    return {
      left: Math.min(bounds.left, current.left),
      centerX: 0,
      right: Math.max(bounds.right, current.right),
      top: Math.min(bounds.top, current.top),
      centerY: 0,
      bottom: Math.max(bounds.bottom, current.bottom),
    };
  }, null);
}

function snapDeltaForDrag(primaryNodeId, proposedPositions, draggedIds) {
  const primaryNode = nodeById(primaryNodeId) || nodeById(draggedIds[0]);
  const primaryPosition = proposedPositions.get(primaryNode?.id || "");
  if (!primaryNode || !primaryPosition) {
    return { x: 0, y: 0 };
  }
  const draggedSet = new Set(draggedIds);
  const active = nodeBounds(primaryNode, primaryPosition);
  const activeX = [active.left, active.centerX, active.right];
  const activeY = [active.top, active.centerY, active.bottom];
  let bestX = { distance: SNAP_DISTANCE + 1, delta: 0 };
  let bestY = { distance: SNAP_DISTANCE + 1, delta: 0 };

  state.nodes.forEach((node) => {
    if (!node || draggedSet.has(node.id)) return;
    const target = nodeBounds(node);
    [target.left, target.centerX, target.right].forEach((targetX) => {
      activeX.forEach((sourceX) => {
        const distance = Math.abs(targetX - sourceX);
        if (distance < bestX.distance && distance <= SNAP_DISTANCE) {
          bestX = { distance, delta: targetX - sourceX };
        }
      });
    });
    [target.top, target.centerY, target.bottom].forEach((targetY) => {
      activeY.forEach((sourceY) => {
        const distance = Math.abs(targetY - sourceY);
        if (distance < bestY.distance && distance <= SNAP_DISTANCE) {
          bestY = { distance, delta: targetY - sourceY };
        }
      });
    });
  });

  return {
    x: bestX.distance <= SNAP_DISTANCE ? bestX.delta : 0,
    y: bestY.distance <= SNAP_DISTANCE ? bestY.delta : 0,
  };
}

function canvasDefaultActionPoint() {
  const sourceNodes = selectedImageSourceNodes();
  if (sourceNodes.length) {
    const right = Math.max(...sourceNodes.map((node) => Number(node.x || 0) + nodeSize(node).width));
    const top = Math.min(...sourceNodes.map((node) => Number(node.y || 0)));
    return { x: right + 90, y: top };
  }
  return {
    x: (-state.viewport.x + viewport.clientWidth * 0.48) / state.viewport.scale,
    y: (-state.viewport.y + viewport.clientHeight * 0.36) / state.viewport.scale,
  };
}

function normalizeMultiCameraGridType(value) {
  return String(value || "").trim() === "2x2" ? "2x2" : "3x3";
}

function multiCameraImageModeForModel(model) {
  return referenceImageModeForModel(model, { referenceCount: 1 });
}

function isMultiCameraGridTask(node) {
  return node?.type === "image_task" && String(node.config?.canvas_template || node.config?.grid_template || "").trim() === "multi_camera_9";
}

function referenceImageEdgesForTask(taskNode) {
  if (taskNode?.type !== "image_task") return [];
  return state.edges.filter((edge) => (
    edge.target_node_id === taskNode.id
    && edge.target_port === "reference_image"
  ));
}

function multiCameraAspectConfig(sourceNode, aspectChoice) {
  const base = defaultImageConfig();
  const model = imageModelSpec(base.model_variant);
  const fallbackRatio = supportedAspectRatio(model, base.aspect_ratio)
    || model.default_aspect_ratio
    || firstOption(model.aspect_ratios, "1:1");
  const requested = String(aspectChoice || MULTI_CAMERA_SOURCE_ASPECT).trim();
  const aspectRatio = requested === MULTI_CAMERA_SOURCE_ASPECT
    ? (sourceAspectRatioForModel(sourceNode, model) || fallbackRatio)
    : (supportedAspectRatio(model, requested) || closestSupportedAspectRatioFromRatio(model, requested) || fallbackRatio);
  return {
    aspectRatio,
    size: preferredImageSizeForRatio(model, aspectRatio, base.size),
  };
}

function openMultiCameraGridDialog({ point = null, source = null } = {}) {
  if (!source) {
    showToast("请先选择一张参考图");
    return;
  }
  if (!multiCameraGridModal) {
    applyGridTemplate("multi_camera_9", point, {
      source,
      multiCamera: { gridType: "3x3", aspectChoice: MULTI_CAMERA_SOURCE_ASPECT },
    });
    return;
  }
  state.multiCameraGrid = {
    sourceNodeId: source?.id || "",
    point: point ? { x: Number(point.x || 0), y: Number(point.y || 0) } : null,
  };
  if (multiCameraGridTypeSelect) multiCameraGridTypeSelect.value = "3x3";
  if (multiCameraAspectSelect) multiCameraAspectSelect.value = MULTI_CAMERA_SOURCE_ASPECT;
  if (multiCameraGridSummary) {
    multiCameraGridSummary.textContent = `源图：${nodeTitle(source)}，选择宫格类型和画幅比例`;
  }
  multiCameraGridModal.showModal();
}

function closeMultiCameraGridDialog() {
  state.multiCameraGrid = { sourceNodeId: "", point: null };
  if (multiCameraGridModal?.open) {
    multiCameraGridModal.close();
  }
}

function confirmMultiCameraGridDialog() {
  const source = nodeById(state.multiCameraGrid.sourceNodeId);
  const point = state.multiCameraGrid.point;
  const gridType = normalizeMultiCameraGridType(multiCameraGridTypeSelect?.value);
  const aspectChoice = String(multiCameraAspectSelect?.value || MULTI_CAMERA_SOURCE_ASPECT).trim() || MULTI_CAMERA_SOURCE_ASPECT;
  closeMultiCameraGridDialog();
  applyGridTemplate("multi_camera_9", point, {
    source,
    multiCamera: { gridType, aspectChoice },
  });
}

function applyGridTemplate(templateKey, point = null, options = {}) {
  const template = GRID_TEMPLATES[templateKey];
  if (!template) return;
  const explicitSource = isGridSplitSourceNode(options.source) ? options.source : null;
  const sources = explicitSource ? [explicitSource] : selectedImageSourceNodes();
  const source = explicitSource || sources[0] || null;
  if (templateKey === "multi_camera_9" && !options.multiCamera) {
    openMultiCameraGridDialog({ point, source });
    return;
  }
  if (templateKey === "multi_camera_9" && !source) {
    showToast("请先选择一张参考图");
    return;
  }
  const basePoint = point || canvasDefaultActionPoint();
  const configOverrides = {
    prompt: template.prompt,
    count: 1,
    canvas_template: templateKey,
  };
  let toastDetail = "";
  if (templateKey === "multi_camera_9") {
    const base = defaultImageConfig();
    const model = imageModelSpec(base.model_variant);
    const inputMode = multiCameraImageModeForModel(model);
    if (!inputMode) {
      showToast("当前生图模型不支持参考图输入");
      return;
    }
    const gridType = normalizeMultiCameraGridType(options.multiCamera?.gridType);
    const { aspectRatio, size } = multiCameraAspectConfig(source, options.multiCamera?.aspectChoice);
    configOverrides.prompt = multiCameraGridPrompt(gridType, aspectRatio);
    configOverrides.mode = inputMode;
    configOverrides.aspect_ratio = aspectRatio;
    configOverrides.size = size;
    toastDetail = `${gridType} / ${aspectRatio}`;
  }
  const task = createNode("image_task", {
    x: basePoint.x,
    y: basePoint.y,
    label: template.title,
    config: imageEditConfigForSource(source, {
      ...configOverrides,
    }),
  });
  if (!task) return;
  if (source) {
    const connected = connectImageNodeToTask(source.id, task, "reference_image");
    if (templateKey === "multi_camera_9" && !connected) {
      state.nodes = state.nodes.filter((node) => node.id !== task.id);
      state.edges = state.edges.filter((edge) => edge.source_node_id !== task.id && edge.target_node_id !== task.id);
      state.selectedNodeIds = new Set();
      render();
      scheduleSave();
      showToast("多机位宫格需要连接参考图");
      return;
    }
  }
  state.selectedNodeIds = new Set([task.id]);
  render();
  scheduleSave();
  const detail = toastDetail ? `${toastDetail}，` : "";
  showToast(source ? `已创建「${template.label}」${detail}已连接参考图` : `已创建「${template.label}」${detail}任务节点`);
}

function createImageToVideoTask(sourceNode) {
  if (!isGridSplitSourceNode(sourceNode)) {
    showToast("请先在一张图片结果或图输入节点上右键选择图生视频");
    return;
  }
  const basePoint = {
    x: Number(sourceNode.x || 0) + nodeSize(sourceNode).width + 90,
    y: Number(sourceNode.y || 0),
  };
  const task = createNode("video_task", {
    x: basePoint.x,
    y: basePoint.y,
    label: "图生视频",
    config: videoFirstFrameConfigForSource(sourceNode),
  });
  if (!task) return;
  connectImageNodeToTask(sourceNode.id, task, "first_frame");
  state.selectedNodeIds = new Set([task.id]);
  render();
  scheduleSave();
  showToast("已创建图生视频节点，并将当前图片连接为首帧");
}

function isTextEditingTarget(target) {
  const element = target?.nodeType === 3 ? target.parentElement : target;
  return Boolean(
    element?.isContentEditable
    || element?.closest?.("input, textarea, select, [contenteditable], [role='textbox']"),
  );
}

function isTextEditingEvent(event) {
  return Boolean(
    state.textEditing
    || isTextEditingTarget(event?.target)
    || isTextEditingTarget(document.activeElement),
  );
}

function isBlankCanvasPointer(event) {
  if (event.button !== 0) return false;
  if (event.target.closest(".canvas-node, .canvas-port, .canvas-edge, .canvas-picker, .canvas-context-menu")) {
    return false;
  }
  return event.target === viewport || event.target === world || event.target === edgeLayer;
}

function startNodePointer(event, node) {
  if (event.target.closest(".canvas-port, .canvas-node-resize-handle") || event.target.closest("button, input, select, textarea")) return;
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const start = worldPointFromEvent(event);
  state.nodePointer = {
    nodeId: node.id,
    pointerId: event.pointerId,
    startClient: { x: event.clientX, y: event.clientY },
    start,
    original: { x: Number(node.x || 0), y: Number(node.y || 0) },
    selectedAtStart: state.selectedNodeIds.has(node.id),
    moved: false,
    shiftKey: event.shiftKey,
  };
  event.currentTarget?.setPointerCapture?.(event.pointerId);
}

function startNodeResize(event, node) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const size = nodeSize(node);
  state.nodeResize = {
    nodeId: node.id,
    pointerId: event.pointerId,
    start: worldPointFromEvent(event),
    width: size.width,
    height: size.height,
  };
  state.selectedNodeIds = new Set([node.id]);
  state.selectedEdgeId = "";
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  render();
}

function startConnecting(nodeId, port, event) {
  const point = worldPointFromEvent(event);
  state.connecting = {
    source_node_id: nodeId,
    source_port: port,
    preview: point,
  };
  render();
}

function stopConnecting() {
  state.connecting = null;
  render();
}

function startPan(event) {
  if (state.nodePointer || state.nodeResize || state.drag || state.connecting) {
    return;
  }
  if (state.spaceDown || !isBlankCanvasPointer(event)) return;
  event.preventDefault();
  state.selectedNodeIds.clear();
  state.selectedEdgeId = "";
  state.pan = {
    x: event.clientX,
    y: event.clientY,
    origin: { ...state.viewport },
  };
  render();
}

function startSelection(event) {
  if (state.nodePointer || state.nodeResize || state.drag || state.connecting || state.pan) return;
  if (!state.spaceDown || !isBlankCanvasPointer(event)) return;
  event.preventDefault();
  const point = worldPointFromEvent(event);
  const rect = viewport.getBoundingClientRect();
  state.selectedEdgeId = "";
  state.selectedNodeIds.clear();
  state.selection = {
    pointerId: event.pointerId,
    startWorld: point,
    currentWorld: point,
    startClient: { x: event.clientX - rect.left, y: event.clientY - rect.top },
    currentClient: { x: event.clientX - rect.left, y: event.clientY - rect.top },
  };
  selectionBox.hidden = false;
  updateSelectionBox();
  updateViewportModeClass();
  viewport.setPointerCapture?.(event.pointerId);
  render();
}

function updateSelectionBox() {
  if (!state.selection || !selectionBox) return;
  const left = Math.min(state.selection.startClient.x, state.selection.currentClient.x);
  const top = Math.min(state.selection.startClient.y, state.selection.currentClient.y);
  const width = Math.abs(state.selection.currentClient.x - state.selection.startClient.x);
  const height = Math.abs(state.selection.currentClient.y - state.selection.startClient.y);
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
}

function selectionWorldRect() {
  const selection = state.selection;
  if (!selection) return null;
  return {
    left: Math.min(selection.startWorld.x, selection.currentWorld.x),
    right: Math.max(selection.startWorld.x, selection.currentWorld.x),
    top: Math.min(selection.startWorld.y, selection.currentWorld.y),
    bottom: Math.max(selection.startWorld.y, selection.currentWorld.y),
  };
}

function nodeIntersectsRect(node, rect) {
  const size = nodeSize(node);
  const left = Number(node.x || 0);
  const top = Number(node.y || 0);
  const right = left + size.width;
  const bottom = top + size.height;
  return left <= rect.right && right >= rect.left && top <= rect.bottom && bottom >= rect.top;
}

function updateSelectionFromBox() {
  const rect = selectionWorldRect();
  if (!rect) return;
  state.selectedNodeIds = new Set(
    state.nodes
      .filter((node) => nodeIntersectsRect(node, rect))
      .map((node) => node.id),
  );
  state.selectedEdgeId = "";
}

function stopSelection() {
  if (!state.selection) return;
  state.selection = null;
  if (selectionBox) {
    selectionBox.hidden = true;
    selectionBox.style.width = "0px";
    selectionBox.style.height = "0px";
  }
  updateViewportModeClass();
}

function handlePointerMove(event) {
  if (state.nodeResize) {
    event.preventDefault();
    event.stopPropagation();
    const node = nodeById(state.nodeResize.nodeId);
    if (!node) {
      state.nodeResize = null;
      return;
    }
    const role = nodeRole(node);
    const point = worldPointFromEvent(event);
    const width = state.nodeResize.width + point.x - state.nodeResize.start.x;
    const height = state.nodeResize.height + point.y - state.nodeResize.start.y;
    node.width = Math.max(NODE_MIN_WIDTH[role] || 104, Math.min(NODE_MAX_WIDTH, Math.round(width)));
    node.height = Math.max(NODE_MIN_HEIGHT[role] || 80, Math.min(NODE_MAX_HEIGHT, Math.round(height)));
    const nodeEl = domNodeById(node.id);
    if (nodeEl) {
      nodeEl.style.width = `${node.width}px`;
      nodeEl.style.height = `${node.height}px`;
      nodeEl.style.minHeight = `${node.height}px`;
    }
    renderEdges();
    return;
  }
  if (state.nodePointer) {
    const distance = Math.hypot(
      event.clientX - state.nodePointer.startClient.x,
      event.clientY - state.nodePointer.startClient.y,
    );
    if (distance >= 5) {
      const dragIds = state.nodePointer.selectedAtStart
        ? [...state.selectedNodeIds]
        : [state.nodePointer.nodeId];
      state.drag = {
        nodeId: state.nodePointer.nodeId,
        nodeIds: dragIds,
        start: state.nodePointer.start,
        originals: new Map(dragIds.map((nodeId) => {
          const node = nodeById(nodeId);
          return [nodeId, { x: Number(node?.x || 0), y: Number(node?.y || 0) }];
        })),
      };
      state.nodePointer.moved = true;
      state.nodePointer = null;
    } else {
      return;
    }
  }
  if (state.drag) {
    event.preventDefault();
    event.stopPropagation();
    const point = worldPointFromEvent(event);
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    const proposedPositions = new Map();
    state.drag.nodeIds.forEach((nodeId) => {
      const node = nodeById(nodeId);
      const original = state.drag.originals.get(nodeId);
      if (!node || !original) return;
      proposedPositions.set(nodeId, {
        x: original.x + dx,
        y: original.y + dy,
      });
    });
    const snap = snapDeltaForDrag(state.drag.nodeId, proposedPositions, state.drag.nodeIds);
    state.drag.nodeIds.forEach((nodeId) => {
      const node = nodeById(nodeId);
      const proposed = proposedPositions.get(nodeId);
      if (!node || !proposed) return;
      node.x = proposed.x + snap.x;
      node.y = proposed.y + snap.y;
      const nodeEl = domNodeById(node.id);
      if (nodeEl) {
        nodeEl.style.left = `${node.x}px`;
        nodeEl.style.top = `${node.y}px`;
      }
    });
    renderEdges();
    return;
  }
  if (state.pan) {
    state.viewport.x = state.pan.origin.x + event.clientX - state.pan.x;
    state.viewport.y = state.pan.origin.y + event.clientY - state.pan.y;
    applyViewport();
    return;
  }
  if (state.selection) {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    state.selection.currentClient = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    state.selection.currentWorld = worldPointFromEvent(event);
    updateSelectionBox();
    updateSelectionFromBox();
    render();
    return;
  }
  if (state.connecting) {
    state.connecting.preview = worldPointFromEvent(event);
    renderEdges();
  }
}

function handlePointerUp(event) {
  if (state.nodeResize) {
    event.preventDefault();
    event.stopPropagation();
    state.nodeResize = null;
    render();
    scheduleSave();
    return;
  }
  if (state.nodePointer) {
    event.preventDefault();
    event.stopPropagation();
    const node = nodeById(state.nodePointer.nodeId);
    const shiftKey = state.nodePointer.shiftKey;
    state.nodePointer = null;
    if (node) {
      selectNode(node.id, shiftKey);
      if (node.type === "image_input" && !node.asset_id && !node.history_id) {
        openImagePicker({ replaceNodeId: node.id });
      }
    }
    return;
  }
  if (state.drag) {
    event.preventDefault();
    event.stopPropagation();
    state.selectedNodeIds = new Set(state.drag.nodeIds || [state.drag.nodeId]);
    state.selectedEdgeId = "";
    state.drag = null;
    render();
    scheduleSave();
    return;
  }
  if (state.connecting) {
    const inputPort = event.target.closest?.(".canvas-port.is-input");
    if (inputPort) {
      connectNodes(
        state.connecting.source_node_id,
        state.connecting.source_port,
        inputPort.dataset.nodeId,
        inputPort.dataset.port,
      );
    } else {
      stopConnecting();
    }
  }
  if (state.pan) {
    state.pan = null;
    scheduleSave();
  }
  if (state.selection) {
    event.preventDefault();
    updateSelectionFromBox();
    stopSelection();
    render();
    return;
  }
}

function handleWheel(event) {
  event.preventDefault();
  const before = worldPointFromEvent(event);
  const factor = event.deltaY < 0 ? 1.1 : 0.9;
  const nextScale = Math.max(0.08, Math.min(4, state.viewport.scale * factor));
  state.viewport.scale = nextScale;
  const rect = viewport.getBoundingClientRect();
  state.viewport.x = event.clientX - rect.left - before.x * nextScale;
  state.viewport.y = event.clientY - rect.top - before.y * nextScale;
  applyViewport();
  scheduleSave();
}

function handleViewportPointerDown(event) {
  startPan(event);
  startSelection(event);
}

function createNode(type, patch = {}) {
  if (type === "image_input" && !patch.asset_id && !patch.history_id) {
    if (Number.isFinite(Number(patch.x)) && Number.isFinite(Number(patch.y))) {
      state.pickerDropPoint = { x: Number(patch.x), y: Number(patch.y) };
    }
    openImagePicker();
    return null;
  }
  const center = {
    x: (-state.viewport.x + viewport.clientWidth * 0.45) / state.viewport.scale,
    y: (-state.viewport.y + viewport.clientHeight * 0.38) / state.viewport.scale,
  };
  const node = {
    id: uid(type),
    type,
    label: defaultNodeLabel(type),
    x: center.x,
    y: center.y,
    config: {},
    ...patch,
  };
  const openPosition = findOpenPosition({ x: node.x, y: node.y }, node);
  node.x = openPosition.x;
  node.y = openPosition.y;
  if (type === "image_task") {
    node.config = { ...defaultImageConfig(), ...(patch.config || {}) };
  }
  if (type === "video_task") {
    node.config = { ...defaultVideoConfig(), ...(patch.config || {}) };
  }
  state.nodes.push(node);
  state.selectedNodeIds = new Set([node.id]);
  state.selectedEdgeId = "";
  render();
  scheduleSave();
  return node;
}

function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function duplicateTaskNode(taskNode) {
  if (!taskNode || nodeRole(taskNode) !== "task") {
    showToast("请在生图或生视频任务节点上右键克隆");
    return;
  }
  const duplicate = createNode(taskNode.type, {
    label: taskNode.label || defaultNodeLabel(taskNode.type),
    x: Number(taskNode.x || 0),
    y: Number(taskNode.y || 0) + nodeSize(taskNode).height + 36,
    status: "idle",
    error_message: "",
    job_id: "",
    job_ids: [],
    history_id: "",
    history_ids: [],
    batch_session_id: "",
    submitted_count: 0,
    config: clonePlainObject(taskNode.config),
  });
  if (!duplicate) return;
  state.selectedNodeIds = new Set([duplicate.id]);
  render();
  scheduleSave();
  showToast("已克隆任务节点和提示信息");
}

function defaultNodeLabel(type) {
  return {
    image_input: "图输入",
    image_task: "生图任务",
    video_task: "生视频任务",
    image_result: "图片结果",
    video_result: "视频结果",
  }[type] || "节点";
}

function deleteSelected() {
  if (state.selectedEdgeId) {
    state.edges = state.edges.filter((edge) => edge.id !== state.selectedEdgeId);
    state.selectedEdgeId = "";
    render();
    scheduleSave();
    return;
  }
  if (!state.selectedNodeIds.size) return;
  const taskIds = [...state.selectedNodeIds]
    .map((nodeId) => nodeById(nodeId))
    .filter((node) => nodeRole(node) === "task")
    .map((node) => node.id);
  if (taskIds.length) {
    openDeleteTaskDialog(taskIds);
    return;
  }
  deleteCanvasNodes([...state.selectedNodeIds]);
}

function deleteCanvasNodes(nodeIds) {
  const ids = new Set(nodeIds);
  if (!ids.size) return;
  state.nodes = state.nodes.filter((node) => !ids.has(node.id));
  state.edges = state.edges.filter((edge) => !ids.has(edge.source_node_id) && !ids.has(edge.target_node_id));
  state.selectedNodeIds = new Set([...state.selectedNodeIds].filter((nodeId) => !ids.has(nodeId)));
  if (!state.selectedNodeIds.size) {
    state.selectedEdgeId = "";
  }
  render();
  scheduleSave();
}

function openDeleteTaskDialog(taskIds) {
  const ids = taskIds.filter((nodeId) => nodeRole(nodeById(nodeId)) === "task");
  if (!ids.length) return;
  state.deleteTaskNodeIds = ids;
  if (deleteTaskSummary) {
    deleteTaskSummary.textContent = ids.length === 1
      ? `任务：${nodeTitle(nodeById(ids[0]))}`
      : `已选择 ${ids.length} 个任务节点`;
  }
  deleteTaskModal?.showModal();
}

function closeDeleteTaskDialog() {
  if (deleteTaskModal?.open) {
    deleteTaskModal.close();
  }
  state.deleteTaskNodeIds = [];
}

function deleteTaskCanvasOnly() {
  const taskIds = state.deleteTaskNodeIds.filter((nodeId) => nodeRole(nodeById(nodeId)) === "task");
  if (!taskIds.length) {
    closeDeleteTaskDialog();
    return;
  }
  deleteCanvasNodes(taskIds);
  closeDeleteTaskDialog();
  showToast("已删除画布任务节点，生成结果已保留");
}

function taskGeneratedResultNodes(taskNode) {
  return taskNode ? taskResultNodes(taskNode) : [];
}

function historyIdsForTaskDeletion(taskNodes) {
  const ids = new Set();
  taskNodes.forEach((taskNode) => {
    if (taskNode.history_id) ids.add(taskNode.history_id);
    taskGeneratedResultNodes(taskNode).forEach((resultNode) => {
      if (resultNode.history_id) ids.add(resultNode.history_id);
    });
  });
  return [...ids];
}

function isMissingHistoryDeleteError(error) {
  return String(error?.message || error || "").toLowerCase().includes("history record not found");
}

async function deleteHistoryOutputsIfPresent(historyId) {
  try {
    return await fetchJson(`/api/history/${historyId}/delete`, {
      method: "POST",
      body: JSON.stringify({ delete_outputs: true }),
    });
  } catch (error) {
    if (isMissingHistoryDeleteError(error)) {
      return { deleted_outputs_count: 0, history_missing: true };
    }
    throw error;
  }
}

async function deleteTaskWithOutputs() {
  const taskNodes = state.deleteTaskNodeIds
    .map((nodeId) => nodeById(nodeId))
    .filter((node) => nodeRole(node) === "task");
  if (!taskNodes.length) {
    closeDeleteTaskDialog();
    return;
  }
  const historyIds = historyIdsForTaskDeletion(taskNodes);
  const deleteIds = new Set(taskNodes.map((node) => node.id));
  taskNodes.forEach((taskNode) => {
    taskGeneratedResultNodes(taskNode).forEach((resultNode) => deleteIds.add(resultNode.id));
  });
  try {
    let deletedOutputs = 0;
    let missingHistories = 0;
    for (const historyId of historyIds) {
      const result = await deleteHistoryOutputsIfPresent(historyId);
      deletedOutputs += Number(result.deleted_outputs_count || 0);
      if (result.history_missing) {
        missingHistories += 1;
      }
    }
    deleteCanvasNodes([...deleteIds]);
    closeDeleteTaskDialog();
    if (historyIds.length) {
      const deletedHistories = historyIds.length - missingHistories;
      const missingText = missingHistories ? `，${missingHistories} 个历史记录已不存在` : "";
      showToast(`已删除画布任务、${deletedHistories} 个任务卡片和 ${deletedOutputs} 个结果文件${missingText}`);
    } else {
      showToast("已删除画布任务和生成结果节点");
    }
  } catch (error) {
    showToast(String(error?.message || error));
  }
}

function autoLayout() {
  state.nodes.forEach(resetNodeSize);
  const placed = new Set();
  const placedBounds = [];
  const placedStages = new Map();
  const visitingTasks = new Set();
  const orderedNodes = new Map(state.nodes.map((node, index) => [node.id, index]));
  const originalNodeY = new Map(state.nodes.map((node) => [node.id, Number(node.y || 0)]));
  const originalNodeX = new Map(state.nodes.map((node) => [node.id, Number(node.x || 0)]));
  const edgeOrder = new Map(state.edges.map((edge, index) => [edge, index]));
  const widestNode = Math.max(...Object.values(NODE_WIDTH));
  const tallestNode = Math.max(...Object.values(NODE_HEIGHT));
  const columnX = (stage) => 48 + Math.max(0, stage) * (widestNode + AUTO_LAYOUT_COLUMN_GAP);
  const branchGap = tallestNode + AUTO_LAYOUT_NODE_GAP;
  const inputGap = NODE_HEIGHT.input + AUTO_LAYOUT_NODE_GAP;
  const componentGap = AUTO_LAYOUT_NODE_GAP * 2;
  const outgoing = new Map();
  const incoming = new Map();
  const producerByResultId = new Map();

  const stableSort = (items) => [...items].sort((left, right) => (
    (orderedNodes.get(left.id) ?? 0) - (orderedNodes.get(right.id) ?? 0)
  ));
  const edgeOrderValue = (edge) => edgeOrder.get(edge) ?? 0;
  const nodeOriginalY = (node) => Number(originalNodeY.get(node.id) ?? 0);
  const nodeOriginalX = (node) => Number(originalNodeX.get(node.id) ?? 0);
  const compareCanvasLayoutNodes = (left, right) => (
    nodeOriginalY(left) - nodeOriginalY(right)
    || nodeOriginalX(left) - nodeOriginalX(right)
    || (orderedNodes.get(left.id) ?? 0) - (orderedNodes.get(right.id) ?? 0)
  );

  state.edges.forEach((edge) => {
    if (!outgoing.has(edge.source_node_id)) outgoing.set(edge.source_node_id, []);
    if (!incoming.has(edge.target_node_id)) incoming.set(edge.target_node_id, []);
    outgoing.get(edge.source_node_id).push(edge);
    incoming.get(edge.target_node_id).push(edge);
    const source = nodeById(edge.source_node_id);
    const target = nodeById(edge.target_node_id);
    if (source && target && nodeRole(source) === "task" && nodeRole(target) === "result") {
      producerByResultId.set(target.id, source.id);
    }
  });

  const incomingEdgesForNode = (node) => {
    const portOrder = new Map(inputPortsForNode(node).map((port, index) => [port, index]));
    return [...(incoming.get(node.id) || [])].sort((left, right) => {
      const portDelta = (portOrder.get(left.target_port) ?? 999) - (portOrder.get(right.target_port) ?? 999);
      if (portDelta) return portDelta;
      return edgeOrderValue(left) - edgeOrderValue(right);
    });
  };
  const outgoingEdgesForNode = (node) => [...(outgoing.get(node.id) || [])].sort((left, right) => (
    edgeOrderValue(left) - edgeOrderValue(right)
  ));
  const uniqueNodesFromEdges = (edges, key) => {
    const seen = new Set();
    const nodes = [];
    edges.forEach((edge) => {
      const target = nodeById(edge[key]);
      if (!target || seen.has(target.id)) return;
      seen.add(target.id);
      nodes.push(target);
    });
    return nodes;
  };
  const incomingNodes = (node) => uniqueNodesFromEdges(incomingEdgesForNode(node), "source_node_id");
  const outgoingNodes = (node) => uniqueNodesFromEdges(outgoingEdgesForNode(node), "target_node_id");
  const taskResults = (taskNode) => outgoingNodes(taskNode)
    .filter((node) => nodeRole(node) === "result")
    .sort((left, right) => Number(left.artifact_index || 0) - Number(right.artifact_index || 0));
  const directDownstreamTasks = (sourceNode) => outgoingNodes(sourceNode)
    .filter((node) => nodeRole(node) === "task");
  const downstreamContextInputs = (resultNode) => outgoingNodes(resultNode)
    .filter((node) => nodeRole(node) === "input");
  const downstreamBranches = (resultNode) => [
    ...directDownstreamTasks(resultNode).map((taskNode) => ({ contextNode: null, taskNode })),
    ...downstreamContextInputs(resultNode).flatMap((contextNode) => {
      const tasks = directDownstreamTasks(contextNode);
      return tasks.length
        ? tasks.map((taskNode) => ({ contextNode, taskNode }))
        : [{ contextNode, taskNode: null }];
    }),
  ];
  const taskInputSources = (taskNode) => incomingNodes(taskNode)
    .filter((node) => nodeRole(node) === "input" || (nodeRole(node) === "result" && !producerByResultId.has(node.id)));
  const taskAnchorY = (taskNode) => {
    const sources = taskInputSources(taskNode);
    if (!sources.length) return nodeOriginalY(taskNode);
    return sources.reduce((total, source) => total + nodeOriginalY(source), 0) / sources.length;
  };
  const compareTaskLayoutOrder = (left, right) => (
    taskAnchorY(left) - taskAnchorY(right)
    || compareCanvasLayoutNodes(left, right)
  );
  const isDerivedFromProducedResult = (node, seen = new Set()) => {
    if (!node || seen.has(node.id)) return false;
    seen.add(node.id);
    if (nodeRole(node) === "result" && producerByResultId.has(node.id)) return true;
    return incomingNodes(node).some((source) => isDerivedFromProducedResult(source, seen));
  };
  const hasProducedResultInput = (taskNode) => incomingNodes(taskNode)
    .some((node) => isDerivedFromProducedResult(node));

  const boundsOverlap = (left, right, padding = AUTO_LAYOUT_NODE_GAP) => (
    left.left < right.right + padding
    && left.right + padding > right.left
    && left.top < right.bottom + padding
    && left.bottom + padding > right.top
  );

  const nextOpenLayoutPosition = (node, x, y) => {
    let nextY = Math.max(24, Math.round(y));
    let guard = 0;
    while (guard < 400) {
      const candidate = nodeBounds(node, { x, y: nextY });
      const collision = placedBounds.find((item) => boundsOverlap(candidate, item));
      if (!collision) {
        return { x, y: nextY, bounds: candidate };
      }
      nextY = Math.max(nextY + 1, Math.round(collision.bottom + AUTO_LAYOUT_NODE_GAP));
      guard += 1;
    }
    const fallbackY = placedBounds.reduce(
      (bottom, item) => Math.max(bottom, item.bottom),
      nextY,
    ) + AUTO_LAYOUT_NODE_GAP;
    return {
      x,
      y: fallbackY,
      bounds: nodeBounds(node, { x, y: fallbackY }),
    };
  };

  const placeNode = (node, stage, y) => {
    const resolvedStage = Math.max(0, Math.round(Number(stage) || 0));
    const x = columnX(resolvedStage);
    const position = nextOpenLayoutPosition(node, x, y);
    node.x = position.x;
    node.y = position.y;
    placedBounds.push({
      ...position.bounds,
      id: node.id,
    });
    placed.add(node.id);
    placedStages.set(node.id, resolvedStage);
  };

  const stageAfterPlacedSources = (taskNode, fallbackStage) => {
    const sourceStages = taskInputSources(taskNode)
      .map((source) => placedStages.get(source.id))
      .filter((stage) => Number.isFinite(stage));
    if (!sourceStages.length) return fallbackStage;
    return Math.max(fallbackStage, Math.max(...sourceStages) + 1);
  };

  const placeInputsForTask = (taskNode, taskStage, taskY) => {
    const sources = taskInputSources(taskNode);
    let bottom = taskY + nodeSize(taskNode).height;
    sources.forEach((source, index) => {
      if (!placed.has(source.id)) {
        placeNode(source, Math.max(0, taskStage - 1), taskY + index * inputGap);
      }
      bottom = Math.max(bottom, Number(source.y || taskY) + nodeSize(source).height);
    });
    return bottom;
  };

  const layoutTaskBranch = (taskNode, taskStage, taskY) => {
    if (!taskNode) return taskY;
    if (visitingTasks.has(taskNode.id)) return taskY + branchGap;
    visitingTasks.add(taskNode.id);
    const resolvedTaskStage = placed.has(taskNode.id)
      ? (placedStages.get(taskNode.id) ?? taskStage)
      : stageAfterPlacedSources(taskNode, taskStage);
    if (!placed.has(taskNode.id)) {
      placeNode(taskNode, resolvedTaskStage, taskY);
    }
    let bottom = Math.max(
      Number(taskNode.y || taskY) + nodeSize(taskNode).height,
      placeInputsForTask(taskNode, resolvedTaskStage, Number(taskNode.y || taskY)),
    );
    const results = taskResults(taskNode);
    if (!results.length) {
      visitingTasks.delete(taskNode.id);
      return Math.max(bottom, taskY + branchGap);
    }
    let resultCursorY = Number(taskNode.y || taskY);
    results.forEach((resultNode) => {
      const resultY = resultCursorY;
      if (!placed.has(resultNode.id)) {
        placeNode(resultNode, resolvedTaskStage + 1, resultY);
      }
      let resultBottom = Number(resultNode.y || resultY) + nodeSize(resultNode).height;
      const branches = downstreamBranches(resultNode).sort((left, right) => {
        const leftNode = left.contextNode || left.taskNode;
        const rightNode = right.contextNode || right.taskNode;
        if (!leftNode || !rightNode) return leftNode ? -1 : rightNode ? 1 : 0;
        if (left.taskNode && right.taskNode && !left.contextNode && !right.contextNode) {
          return compareTaskLayoutOrder(left.taskNode, right.taskNode);
        }
        return compareCanvasLayoutNodes(leftNode, rightNode);
      });
      let branchCursorY = Number(resultNode.y || resultY);
      branches.forEach((branch) => {
        const branchY = branchCursorY;
        let branchBottom = branchY;
        if (branch.contextNode && !placed.has(branch.contextNode.id)) {
          placeNode(branch.contextNode, taskStage + 2, branchY);
          branchBottom = Math.max(branchBottom, Number(branch.contextNode.y || branchY) + nodeSize(branch.contextNode).height);
        }
        if (branch.taskNode) {
          branchBottom = Math.max(
            branchBottom,
            layoutTaskBranch(
              branch.taskNode,
              resolvedTaskStage + (branch.contextNode ? 3 : 2),
              branch.contextNode ? Number(branch.contextNode.y || branchY) : branchY,
            ),
          );
        }
        resultBottom = Math.max(resultBottom, branchBottom);
        branchCursorY = Math.max(branchCursorY + branchGap, branchBottom + AUTO_LAYOUT_NODE_GAP);
      });
      bottom = Math.max(bottom, resultBottom);
      resultCursorY = Math.max(resultCursorY + branchGap, resultBottom + AUTO_LAYOUT_NODE_GAP);
    });
    visitingTasks.delete(taskNode.id);
    return Math.max(bottom, taskY + branchGap);
  };

  let rowY = 70;
  let rootTasks = state.nodes
    .filter((node) => nodeRole(node) === "task" && !hasProducedResultInput(node))
    .sort(compareTaskLayoutOrder);
  if (!rootTasks.length) {
    rootTasks = state.nodes.filter((node) => nodeRole(node) === "task").sort(compareTaskLayoutOrder);
  }
  rootTasks.forEach((taskNode) => {
    if (placed.has(taskNode.id)) return;
    const taskStage = taskInputSources(taskNode).length ? 1 : 0;
    const bottom = layoutTaskBranch(taskNode, taskStage, rowY);
    rowY = Math.max(rowY + branchGap, bottom + componentGap);
  });

  stableSort(state.nodes).forEach((node) => {
    if (placed.has(node.id)) return;
    const stage = nodeRole(node) === "task" ? 1 : nodeRole(node) === "result" ? 2 : 0;
    placeNode(node, stage, rowY);
    rowY += branchGap;
  });
  spreadOverlappingNodes();
  render();
  scheduleSave();
}

function resetView() {
  const bounds = graphNodeBounds();
  if (!bounds) {
    state.viewport = { x: 120, y: 80, scale: 1 };
    applyViewport();
    scheduleSave();
    return;
  }
  const viewportWidth = Math.max(1, Number(viewport?.clientWidth || window.innerWidth || 1));
  const viewportHeight = Math.max(1, Number(viewport?.clientHeight || window.innerHeight || 1));
  const margin = Math.max(24, Math.min(72, viewportWidth * 0.08, viewportHeight * 0.08));
  const contentWidth = Math.max(1, bounds.right - bounds.left);
  const contentHeight = Math.max(1, bounds.bottom - bounds.top);
  const availableWidth = Math.max(1, viewportWidth - margin * 2);
  const availableHeight = Math.max(1, viewportHeight - margin * 2);
  const scale = Math.max(0.02, Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight));
  state.viewport = {
    x: (viewportWidth - contentWidth * scale) / 2 - bounds.left * scale,
    y: (viewportHeight - contentHeight * scale) / 2 - bounds.top * scale,
    scale,
  };
  applyViewport();
  scheduleSave();
}

function isGridSplitSourceNode(node) {
  return Boolean(node && (node.type === "image_input" || node.type === "image_result"));
}

function selectedGridSplitSource() {
  const candidates = selectedImageSourceNodes()
    .filter((node) => isGridSplitSourceNode(node));
  return candidates[0] || null;
}

function selectedGridSplitCells() {
  return [...state.gridSplit.selected].map((key) => {
    const [row, col] = key.split(":").map((item) => Number(item));
    return { row, col };
  }).sort((left, right) => (left.row - right.row) || (left.col - right.col));
}

function openGridSplitChoice() {
  const source = nodeById(state.gridSplit.sourceNodeId);
  if (!source || !state.gridSplit.selected.size) return;
  state.gridSplitChoicePending = true;
  if (gridSplitChoiceSummary) {
    gridSplitChoiceSummary.textContent = `源图：${nodeTitle(source)}，已选择 ${state.gridSplit.selected.size} 个宫格`;
  }
  gridSplitChoiceModal?.showModal();
}

function closeGridSplitChoice() {
  if (gridSplitChoiceModal?.open) {
    gridSplitChoiceModal.close();
  }
  state.gridSplitChoicePending = false;
}

function createUpscaleImageTask(sourceNode = null, { label = "超分", canvasTemplate = "" } = {}) {
  const source = isGridSplitSourceNode(sourceNode) ? sourceNode : selectedGridSplitSource();
  if (!source) {
    showToast("请先选中一张图输入或图片结果，再使用超分");
    return;
  }
  const modelVariant = preferredUpscaleImageModelVariant();
  const basePoint = {
    x: Number(source.x || 0) + nodeSize(source).width + 90,
    y: Number(source.y || 0),
  };
  const task = createNode("image_task", {
    x: basePoint.x,
    y: basePoint.y,
    label,
    config: imageEditConfigForSourceAndModel(source, modelVariant, {
      prompt: GRID_TEMPLATES.upscale_grid_split.prompt,
      count: 1,
      ...(canvasTemplate ? { canvas_template: canvasTemplate } : {}),
    }),
  });
  if (!task) return;
  connectImageNodeToTask(source.id, task, "reference_image");
  state.selectedNodeIds = new Set([task.id]);
  render();
  scheduleSave();
  showToast(`已创建「${label}」任务，使用火山引擎图像参考模式并保持原图比例`);
}

function createPanorama720Task(sourceNode = null) {
  const source = isGridSplitSourceNode(sourceNode) ? sourceNode : selectedGridSplitSource();
  if (!source) {
    showToast("请先选中一张图输入或图片结果，再生成720全景");
    return;
  }
  const modelVariant = preferredUpscaleImageModelVariant();
  const model = imageModelSpec(modelVariant);
  const panoramaRatio = supportedAspectRatio(model, "2:1")
    || closestSupportedAspectRatioFromRatio(model, "2:1")
    || model.default_aspect_ratio
    || firstOption(model.aspect_ratios, "16:9");
  const task = createNode("image_task", {
    x: Number(source.x || 0) + nodeSize(source).width + 90,
    y: Number(source.y || 0),
    label: "720全景图",
    config: imageEditConfigForSourceAndModel(source, modelVariant, {
      prompt: PANORAMA_720_PROMPT,
      aspect_ratio: panoramaRatio,
      size: preferredImageSizeForRatio(model, panoramaRatio),
      count: 1,
      canvas_template: "panorama_720",
    }),
  });
  if (!task) return;
  connectImageNodeToTask(source.id, task, "reference_image");
  state.selectedNodeIds = new Set([task.id]);
  render();
  scheduleSave();
  showToast(`已创建720全景任务，画幅 ${panoramaRatio}，并连接参考图`);
}

function openGridSplitModal(sourceNode = null) {
  const source = isGridSplitSourceNode(sourceNode) ? sourceNode : selectedGridSplitSource();
  if (!source) {
    showToast("请先选中一张图输入或图片结果，再使用宫格切分");
    return;
  }
  state.gridSplit = {
    sourceNodeId: source.id,
    rows: 3,
    cols: 3,
    selected: new Set(),
  };
  if (gridSplitRows) gridSplitRows.value = "3";
  if (gridSplitCols) gridSplitCols.value = "3";
  if (gridSplitSourceName) gridSplitSourceName.textContent = `源图：${nodeTitle(source)}`;
  renderGridSplitCells();
  gridSplitModal?.showModal();
}

function closeGridSplitModal() {
  gridSplitModal?.close();
}

function gridSplitKey(row, col) {
  return `${row}:${col}`;
}

function renderGridSplitCells() {
  if (!gridSplitCells) return;
  const source = nodeById(state.gridSplit.sourceNodeId);
  const rows = Number(state.gridSplit.rows || 3);
  const cols = Number(state.gridSplit.cols || 3);
  const previewUrl = source ? (source.thumbnail_url || previewUrlForNode(source)) : "";
  gridSplitCells.innerHTML = "";
  gridSplitCells.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  gridSplitCells.style.gridTemplateRows = `repeat(${rows}, minmax(58px, 1fr))`;
  gridSplitCells.style.backgroundImage = previewUrl ? `url("${previewUrl}")` : "";
  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      const key = gridSplitKey(row, col);
      const button = createElement("button", "canvas-grid-cell", `${row}-${col}`);
      button.type = "button";
      button.classList.toggle("is-selected", state.gridSplit.selected.has(key));
      button.addEventListener("click", () => {
        if (state.gridSplit.selected.has(key)) {
          state.gridSplit.selected.delete(key);
        } else {
          state.gridSplit.selected.add(key);
        }
        renderGridSplitCells();
      });
      gridSplitCells.append(button);
    }
  }
  if (gridSplitRun) {
    gridSplitRun.disabled = !state.gridSplit.selected.size;
    gridSplitRun.textContent = state.gridSplit.selected.size
      ? `切分 ${state.gridSplit.selected.size} 个宫格`
      : "切分选中宫格";
  }
}

function setGridSplitSize(rows, cols) {
  state.gridSplit.rows = Number(rows || 3);
  state.gridSplit.cols = Number(cols || 3);
  state.gridSplit.selected = new Set(
    [...state.gridSplit.selected].filter((key) => {
      const [row, col] = key.split(":").map((item) => Number(item));
      return row >= 1 && row <= state.gridSplit.rows && col >= 1 && col <= state.gridSplit.cols;
    }),
  );
  if (gridSplitRows) gridSplitRows.value = String(state.gridSplit.rows);
  if (gridSplitCols) gridSplitCols.value = String(state.gridSplit.cols);
  renderGridSplitCells();
}

function selectAllGridCells() {
  const next = new Set();
  for (let row = 1; row <= Number(state.gridSplit.rows || 3); row += 1) {
    for (let col = 1; col <= Number(state.gridSplit.cols || 3); col += 1) {
      next.add(gridSplitKey(row, col));
    }
  }
  state.gridSplit.selected = next;
  renderGridSplitCells();
}

async function createSelectedGridSplitNodes({ upscale = false } = {}) {
  const source = nodeById(state.gridSplit.sourceNodeId);
  if (!source || !state.gridSplit.selected.size) return;
  const cells = selectedGridSplitCells();
  if (gridSplitRun) gridSplitRun.disabled = true;
  try {
    const payload = await fetchJson("/api/canvas/grid-split", {
      method: "POST",
      body: JSON.stringify({
        source_node_id: source.id,
        graph: graphPayload(),
        rows: Number(state.gridSplit.rows || 3),
        cols: Number(state.gridSplit.cols || 3),
        cells,
      }),
    });
    const baseX = Number(source.x || 0) + nodeSize(source).width + 90;
    const baseY = Number(source.y || 0);
    (payload.items || []).forEach((item, index) => {
      const width = positiveNumber(item.width);
      const height = positiveNumber(item.height);
      const model = imageModelSpec();
      const splitNode = createNode("image_input", {
        label: gridSplitCellLabel(item.grid_cell || {}),
        asset_id: item.asset_id || "",
        thumbnail_url: item.thumbnail_url || "",
        public_url: item.public_url || "",
        source_group: item.source_group || "宫格切分",
        width,
        height,
        x: baseX,
        y: baseY + index * 138,
        config: {
          asset_id: item.asset_id || "",
          public_url: item.public_url || "",
          width,
          height,
          aspect_ratio: closestSupportedAspectRatio(model, width, height) || "",
          grid_cell: item.grid_cell || {},
        },
      });
      if (splitNode) {
        connectImageContextNode(source.id, splitNode);
        if (upscale) {
          createUpscaleImageTask(splitNode, {
            label: GRID_TEMPLATES.upscale_grid_split.title,
            canvasTemplate: "upscale_grid_split",
          });
        }
      }
    });
    const createdCount = payload.count || (payload.items || []).length;
    closeGridSplitModal();
    render();
    scheduleSave();
    showToast(upscale
      ? `已切分 ${createdCount} 个宫格，并创建放大切分任务`
      : `已切分 ${createdCount} 个宫格`);
  } catch (error) {
    showToast(String(error?.message || error));
  } finally {
    renderGridSplitCells();
  }
}

function submitGridSplit() {
  const source = nodeById(state.gridSplit.sourceNodeId);
  if (!source || !state.gridSplit.selected.size) return;
  openGridSplitChoice();
}

function pickerQueryKey() {
  return JSON.stringify({
    q: pickerSearch?.value || "",
    source: pickerSource?.value || "",
  });
}

function pickerItemKey(item) {
  const payload = item?.payload || {};
  const contentHash = String(item?.content_hash || payload.content_hash || "").trim();
  if (contentHash) return `hash:${contentHash}`;
  const assetPath = String(item?.path || payload.path || payload.artifact?.local_path || "").trim();
  if (assetPath) return `path:${assetPath}`;
  const publicUrl = String(item?.public_url || payload.public_url || payload.artifact?.public_url || "").trim();
  if (publicUrl) return `url:${publicUrl}`;
  const assetId = String(item?.asset_id || payload.id || "").trim();
  if (assetId) return `asset:${assetId}`;
  return String(item?.id || "").trim();
}

function mergePickerItems(existingItems, nextItems) {
  const seen = new Set();
  const merged = [];
  [...(existingItems || []), ...(nextItems || [])].forEach((item) => {
    const key = pickerItemKey(item);
    if (key && seen.has(key)) {
      return;
    }
    if (key) {
      seen.add(key);
    }
    merged.push(item);
  });
  return merged;
}

function cachePickerState() {
  state.pickerCache.set(pickerQueryKey(), {
    items: [...state.picker.items],
    offset: state.picker.offset,
    hasMore: state.picker.hasMore,
    sources: Array.from(pickerSource?.options || []).map((option) => option.value).filter(Boolean),
  });
}

function restorePickerCache() {
  const cached = state.pickerCache.get(pickerQueryKey());
  if (!cached) {
    return false;
  }
  state.picker.items = [...(cached.items || [])];
  state.picker.offset = Number(cached.offset || state.picker.items.length);
  state.picker.hasMore = Boolean(cached.hasMore);
  renderPickerSources(cached.sources || []);
  renderPickerAssets();
  return true;
}

function pickerItemFromAsset(asset) {
  if (!asset?.id) {
    return null;
  }
  return {
    id: `asset:${asset.id}`,
    node_type: "image_input",
    asset_id: asset.id,
    kind: asset.kind || "image",
    label: asset.display_name || asset.original_name || "本地图片",
    source_group: asset.library_visible ? "当前素材库" : "上传资源",
    thumbnail_url: asset.thumbnail_url || asset.public_url || "",
    public_url: asset.public_url || "",
    tag_category: asset.tag_category || "",
    origin: asset.origin || "workspace",
    content_hash: asset.content_hash || "",
    created_at: asset.created_at || "",
    payload: asset,
  };
}

function openImagePicker({ replaceNodeId = "" } = {}) {
  state.picker = { items: [], offset: 0, hasMore: false, loading: false, replaceNodeId, requestId: state.picker.requestId || 0 };
  if (replaceNodeId) {
    state.pickerDropPoint = null;
  }
  pickerSearch.value = "";
  pickerSource.value = "";
  picker.hidden = false;
  const hadCache = restorePickerCache();
  loadPickerAssets({ reset: true, quiet: hadCache });
}

function closeImagePicker() {
  picker.hidden = true;
  state.pickerDropPoint = null;
}

async function loadPickerAssets({ reset = false, quiet = false } = {}) {
  if (state.picker.loading && !reset) return;
  if (reset) {
    state.picker.items = [];
    state.picker.offset = 0;
    state.picker.hasMore = false;
  }
  state.picker.loading = true;
  const requestId = (state.picker.requestId || 0) + 1;
  state.picker.requestId = requestId;
  if (!quiet && (reset || !state.picker.items.length)) {
    pickerList.innerHTML = '<div class="canvas-empty-inspector">正在加载图片...</div>';
  }
  if (pickerLoadMore) {
    pickerLoadMore.disabled = true;
  }
  try {
    const params = new URLSearchParams({
      kind: "image",
      q: pickerSearch.value || "",
      source: pickerSource.value || "",
      limit: "36",
      offset: String(state.picker.offset),
    });
    const payload = await fetchJson(`/api/canvas/assets?${params.toString()}`);
    if (requestId !== state.picker.requestId) {
      return;
    }
    state.picker.items = reset
      ? mergePickerItems([], payload.items || [])
      : mergePickerItems(state.picker.items, payload.items || []);
    state.picker.offset = Number(payload.next_offset ?? state.picker.items.length);
    state.picker.hasMore = Boolean(payload.has_more);
    renderPickerSources(payload.sources || []);
    renderPickerAssets();
    cachePickerState();
  } catch (error) {
    if (requestId !== state.picker.requestId) {
      return;
    }
    pickerList.innerHTML = "";
    pickerList.append(createElement("div", "canvas-empty-inspector", String(error?.message || error)));
  } finally {
    if (requestId === state.picker.requestId) {
      state.picker.loading = false;
      if (pickerLoadMore) {
        pickerLoadMore.disabled = false;
      }
    }
  }
}

function renderPickerSources(sources) {
  const current = pickerSource.value;
  if (pickerSource.options.length <= 1) {
    sources.forEach((source) => {
      const option = document.createElement("option");
      option.value = source;
      option.textContent = source;
      pickerSource.append(option);
    });
  }
  pickerSource.value = current;
}

function renderPickerAssets() {
  pickerList.innerHTML = "";
  if (!state.picker.items.length) {
    pickerList.append(createElement("div", "canvas-empty-inspector", "没有可选择的图片"));
  }
  state.picker.items.forEach((item) => {
    const button = createElement("button", "canvas-picker-item");
    button.type = "button";
    const thumb = createElement("div", "canvas-picker-thumb");
    if (item.thumbnail_url || item.public_url) {
      const img = document.createElement("img");
      img.src = item.thumbnail_url || item.public_url;
      img.alt = item.label || "图片";
      img.loading = "lazy";
      thumb.append(img);
    }
    const copy = createElement("div", "canvas-picker-copy");
    copy.append(createElement("strong", "", item.label || "图片"));
    copy.append(createElement("span", "", item.source_group || "图片"));
    button.append(thumb, copy);
    button.addEventListener("click", () => selectPickerItem(item));
    pickerList.append(button);
  });
  pickerLoadMore.hidden = !state.picker.hasMore;
}

async function uploadPickerImage(file) {
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    showToast("请选择图片文件");
    return;
  }
  const formData = new FormData();
  formData.append("kind", "image");
  formData.append("file", file);
  if (pickerUploadButton) {
    pickerUploadButton.disabled = true;
    pickerUploadButton.textContent = "上传中";
  }
  try {
    const response = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      let message = `上传失败：${response.status}`;
      try {
        const payload = await response.json();
        message = payload.detail || payload.message || message;
      } catch (error) {
        message = await response.text();
      }
      throw new Error(message);
    }
    const payload = await response.json();
    const item = pickerItemFromAsset(payload.asset);
    if (!item) {
      throw new Error("上传结果缺少图片信息");
    }
    state.picker.items = mergePickerItems([item], state.picker.items);
    cachePickerState();
    selectPickerItem(item);
    showToast("已上传并添加图片输入节点");
  } catch (error) {
    showToast(String(error?.message || error));
  } finally {
    if (pickerUploadButton) {
      pickerUploadButton.disabled = false;
      pickerUploadButton.textContent = "本地上传";
    }
    if (pickerUploadFile) {
      pickerUploadFile.value = "";
    }
  }
}

function selectPickerItem(item) {
  const width = positiveNumber(item.width);
  const height = positiveNumber(item.height);
  const model = imageModelSpec();
  const patch = {
    label: item.label || "图输入",
    asset_id: item.asset_id || "",
    history_id: item.history_id || "",
    artifact_index: Number(item.artifact_index || 0),
    thumbnail_url: item.thumbnail_url || "",
    public_url: item.public_url || "",
    source_group: item.source_group || "",
    width,
    height,
    config: {
      asset_id: item.asset_id || "",
      history_id: item.history_id || "",
      artifact_index: Number(item.artifact_index || 0),
      public_url: item.public_url || "",
      width,
      height,
      aspect_ratio: closestSupportedAspectRatio(model, width, height) || "",
    },
  };
  if (state.picker.replaceNodeId) {
    const node = nodeById(state.picker.replaceNodeId);
    if (node) Object.assign(node, patch);
  } else {
    if (state.pickerDropPoint) {
      patch.x = state.pickerDropPoint.x;
      patch.y = state.pickerDropPoint.y;
      state.pickerDropPoint = null;
    }
    createNode("image_input", patch);
  }
  closeImagePicker();
  render();
  scheduleSave();
}

function renderInspector() {
  inspector.innerHTML = "";
  if (state.selectedEdgeId) {
    const section = createElement("section", "canvas-inspector-section");
    section.append(createElement("strong", "", "连线"));
    section.append(createElement("div", "canvas-inspector-meta", "这条线表示输入和输出关系。"));
    const del = createElement("button", "ghost-button danger-button", "删除连线");
    del.type = "button";
    del.addEventListener("click", deleteSelected);
    section.append(del);
    inspector.append(section);
    return;
  }
  const node = selectedNode();
  if (!node) {
    inspector.append(createElement("div", "canvas-empty-inspector", "选择一个节点后，可在这里编辑参数、替换图片或运行任务。"));
    return;
  }
  inspector.append(renderNodeInspector(node));
}

function renderNodeInspector(node) {
  const wrap = createElement("div", "canvas-inspector-stack");

  if (node.type === "image_task") {
    wrap.append(renderImageTaskInspector(node));
  } else if (node.type === "video_task") {
    wrap.append(renderVideoTaskInspector(node));
  } else {
    wrap.append(renderAssetInspector(node));
  }

  const actions = createElement("section", "canvas-inspector-section");
  if (nodeRole(node) === "task") {
    const run = createElement("button", "primary-button", "运行这个任务");
    run.type = "button";
    run.addEventListener("click", runSelectedTask);
    actions.append(run);
  }
  const remove = createElement("button", "ghost-button danger-button", "删除画板节点");
  remove.type = "button";
  remove.addEventListener("click", deleteSelected);
  actions.append(remove);
  wrap.append(actions);
  return wrap;
}

function sourceTaskForResultNode(node) {
  const edge = state.edges.find((item) => item.target_node_id === node.id && item.target_port === "input");
  const source = edge ? nodeById(edge.source_node_id) : null;
  return source && nodeRole(source) === "task" ? source : null;
}

function promptForResultNode(node) {
  const ownPrompt = String(node.source_prompt || node.config?.source_prompt || "").trim();
  if (ownPrompt) return ownPrompt;
  const taskNode = sourceTaskForResultNode(node);
  return String(taskNode?.config?.prompt || "").trim();
}

function renderAssetInspector(node) {
  const section = createElement("section", "canvas-inspector-section");
  const media = renderMedia(node);
  media.classList.add("is-inspector-media");
  section.append(media);
  if (nodeRole(node) === "result") {
    const taskNode = sourceTaskForResultNode(node);
    const info = createElement("div", "canvas-result-info");
    info.append(createElement("strong", "", "生成提示"));
    info.append(createElement("p", "", promptForResultNode(node) || "未记录提示词"));
    if (taskNode) {
      info.append(createElement("span", "", `模型：${taskNode.type === "image_task" ? imageModelSpec(taskNode.config?.model_variant).label : videoModelSpec(taskNode.config?.model_variant).label || "-"}`));
      info.append(createElement("span", "", `方式：${modeLabel(taskNode)}`));
      if (taskNode.type === "video_task") {
        info.append(createElement("span", "", `时长：${Number(taskNode.config?.duration || 0) || "-"} 秒`));
      }
    }
    section.append(info);
  }
  if (node.type === "image_input") {
    const replace = createElement("button", "secondary-button", "替换图片");
    replace.type = "button";
    replace.addEventListener("click", () => openImagePicker({ replaceNodeId: node.id }));
    section.append(replace);
  }
  return section;
}

function renderImageTaskInspector(node) {
  const section = createElement("section", "canvas-inspector-section");
  const modelSelect = selectField("模型", imageModels(), node.config.model_variant, (value) => {
    const previousModelVariant = node.config.model_variant;
    const previousMode = node.config.mode;
    const model = imageModelSpec(value);
    const ratio = model.default_aspect_ratio || firstOption(model.aspect_ratios, "1:1");
    const referenceCount = referenceImageEdgesForTask(node).length;
    const nextMode = referenceCount
      ? referenceImageModeForModel(model, { currentMode: previousMode, referenceCount })
      : (model.default_mode || "text_only");
    if (referenceCount && !nextMode) {
      node.config.model_variant = previousModelVariant;
      node.config.mode = previousMode;
      showToast("当前生图模型不支持参考图输入");
      render();
      return;
    }
    node.config.model_variant = value;
    node.config.mode = nextMode;
    node.config.aspect_ratio = ratio;
    node.config.size = model.default_size || firstOption(sizeOptionsForImage(model, ratio), "");
    node.config.output_format = model.default_output_format || "jpeg";
    node.config.quality = model.default_quality || "auto";
    node.config.background = model.default_background || "auto";
    node.config.moderation = model.default_moderation || "auto";
    node.config.output_compression = model.default_output_compression || 100;
    pruneInvalidEdgesForNode(node.id, { notify: true });
    render();
    scheduleSave();
  });
  section.append(modelSelect);
  const model = imageModelSpec(node.config.model_variant);
  if (isMultiCameraGridTask(node)) {
    const inputMode = referenceImageModeForModel(model, {
      currentMode: node.config.mode,
      referenceCount: Math.max(1, referenceImageEdgesForTask(node).length),
    });
    if (inputMode && node.config.mode !== inputMode) {
      node.config.mode = inputMode;
    }
  } else {
    section.append(selectField("生成方式", model.modes || [], node.config.mode, (value) => {
      node.config.mode = value;
      pruneInvalidEdgesForNode(node.id, { notify: true });
      render();
      scheduleSave();
    }));
  }
  section.append(textAreaField("提示词", node.config.prompt || "", (value) => {
    node.config.prompt = value;
    syncTaskNodePromptPreview(node);
    scheduleSave();
  }, { mentionNode: node }));
  section.append(selectField("画幅", model.aspect_ratios || [], node.config.aspect_ratio, (value) => {
    node.config.aspect_ratio = value;
    const options = sizeOptionsForImage(model, value);
    if (!options.some((item) => item.value === node.config.size)) {
      node.config.size = firstOption(options, node.config.size);
    }
    render();
    scheduleSave();
  }));
  section.append(selectField("尺寸", sizeOptionsForImage(model, node.config.aspect_ratio), node.config.size, (value) => {
    node.config.size = value;
    scheduleSave();
  }));
  node.config.output_format = node.config.output_format || model.default_output_format || "jpeg";
  node.config.quality = node.config.quality || model.default_quality || "auto";
  node.config.background = node.config.background || model.default_background || "auto";
  node.config.moderation = node.config.moderation || model.default_moderation || "auto";
  node.config.output_compression = node.config.output_compression ?? model.default_output_compression ?? 100;
  if (model.supports_output_format) {
    section.append(selectField("格式", model.output_formats || [], node.config.output_format, (value) => {
      node.config.output_format = value;
      render();
      scheduleSave();
    }));
  }
  if (model.supports_quality) {
    section.append(selectField("清晰度", model.quality_options || [], node.config.quality, (value) => {
      node.config.quality = value;
      scheduleSave();
    }));
  }
  if (model.supports_background) {
    section.append(selectField("背景", model.background_options || [], node.config.background, (value) => {
      node.config.background = value;
      scheduleSave();
    }));
  }
  if (model.supports_moderation) {
    section.append(selectField("安全", model.moderation_options || [], node.config.moderation, (value) => {
      node.config.moderation = value;
      scheduleSave();
    }));
  }
  if (model.supports_output_compression && ["jpeg", "webp"].includes(String(node.config.output_format || ""))) {
    section.append(numberField("压缩", Number(node.config.output_compression ?? 100), 0, 100, (value) => {
      node.config.output_compression = value;
      scheduleSave();
    }));
  }
  section.append(numberField("数量", node.config.count || 1, 1, 15, (value) => {
    node.config.count = value;
    scheduleSave();
  }));
  return section;
}

function renderVideoTaskInspector(node) {
  ensureVideoNodeConfig(node);
  const section = createElement("section", "canvas-inspector-section");
  section.append(selectField("模型", videoModels(), node.config.model_variant, (value) => {
    node.config.model_variant = value;
    ensureVideoNodeConfig(node);
    render();
    scheduleSave();
  }));
  section.append(selectField("生成方式", videoSceneOptionsForModel(node.config.model_variant), node.config.scene_type, (value) => {
    node.config.scene_type = value;
    ensureVideoNodeConfig(node);
    pruneInvalidEdgesForNode(node.id, { notify: true });
    render();
    scheduleSave();
  }));
  section.append(textAreaField("提示词", node.config.prompt || "", (value) => {
    node.config.prompt = value;
    syncTaskNodePromptPreview(node);
    scheduleSave();
  }, { mentionNode: node }));
  section.append(selectField("分辨率", videoResolutionOptionsForModel(node.config.model_variant, node.config.scene_type), node.config.resolution_grade, (value) => {
    node.config.resolution_grade = value;
    ensureVideoNodeConfig(node);
    render();
    scheduleSave();
  }));
  section.append(selectField("画幅", videoRatioOptionsForModel(node.config.model_variant), node.config.ratio, (value) => {
    node.config.ratio = value;
    scheduleSave();
  }));
  section.append(selectField("时长", videoDurationOptionsForModel(node.config.model_variant, node.config.scene_type, node.config.resolution_grade), String(node.config.duration || 5), (value) => {
    node.config.duration = Number(value);
    scheduleSave();
  }));
  section.append(numberField("数量", node.config.count || 1, 1, 15, (value) => {
    node.config.count = value;
    scheduleSave();
  }));
  section.append(numberField("Seed", node.config.seed ?? -1, -1, 2147483647, (value) => {
    node.config.seed = value;
    scheduleSave();
  }));
  section.append(checkField("生成音频", Boolean(node.config.generate_audio), (value) => {
    node.config.generate_audio = value;
    scheduleSave();
  }));
  if (videoModelSpec(node.config.model_variant).supports_web_search && node.config.scene_type === "text_only") {
    section.append(checkField("联网搜索", Boolean(node.config.enable_web_search), (value) => {
      node.config.enable_web_search = value;
      scheduleSave();
    }));
  }
  return section;
}

function selectField(label, options, value, onChange) {
  const field = createElement("label", "canvas-mini-field");
  field.append(createElement("span", "", label));
  const select = document.createElement("select");
  (options || []).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label || item.value;
    select.append(option);
  });
  select.value = value || firstOption(options, "");
  select.addEventListener("change", () => onChange(select.value));
  field.append(select);
  return field;
}

function textAreaField(label, value, onInput, options = {}) {
  const hasMention = Boolean(options.mentionNode);
  const field = createElement(hasMention ? "div" : "label", `canvas-mini-field${hasMention ? " canvas-mention-field" : ""}`);
  field.append(createElement("span", "", label));
  const input = document.createElement("textarea");
  input.value = value || "";
  let menu = null;
  if (hasMention) {
    menu = createElement("div", "canvas-mention-menu");
    menu.hidden = true;
  }
  input.addEventListener("input", () => {
    onInput(input.value);
    if (hasMention) {
      renderMentionMenu(menu, input, options.mentionNode);
    }
  });
  if (hasMention) {
    input.addEventListener("keydown", (event) => handleMentionKeydown(event, menu, input, options.mentionNode));
    input.addEventListener("click", () => renderMentionMenu(menu, input, options.mentionNode));
    input.addEventListener("blur", () => window.setTimeout(() => {
      if (state.mention.textarea === input) {
        hideMentionMenu();
      }
    }, 120));
    field.addEventListener("click", (event) => {
      if (event.target === input || event.target?.closest?.(".canvas-mention-menu")) return;
      input.focus();
    });
  }
  field.append(input);
  if (menu) {
    field.append(menu);
  }
  return field;
}

function numberField(label, value, min, max, onInput) {
  const field = createElement("label", "canvas-mini-field");
  field.append(createElement("span", "", label));
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("input", () => onInput(Number(input.value)));
  field.append(input);
  return field;
}

function checkField(label, checked, onInput) {
  const field = createElement("label", "canvas-checkbox-field");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onInput(input.checked));
  field.append(input, createElement("span", "", label));
  return field;
}

function clampTaskCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(15, Math.round(parsed)));
}

function expectedResultCountForTask(taskNode) {
  if (!taskNode || !["image_task", "video_task"].includes(taskNode.type)) return 1;
  return clampTaskCount(taskNode.config?.count || 1);
}

function arrayFromPayload(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()) : [];
}

function taskRunEntriesFromPayload(payload, taskNode) {
  const jobIds = arrayFromPayload(payload?.job_ids);
  const historyIds = arrayFromPayload(payload?.history_ids);
  if (payload?.job_id && !jobIds.length) jobIds.push(String(payload.job_id).trim());
  if (payload?.history_id && !historyIds.length) historyIds.push(String(payload.history_id).trim());
  const submittedCount = clampTaskCount(payload?.submitted_count || Math.max(jobIds.length, historyIds.length, expectedResultCountForTask(taskNode)));
  const count = Math.max(1, submittedCount, jobIds.length, historyIds.length);
  return Array.from({ length: count }, (_unused, index) => ({
    jobId: jobIds[index] || "",
    historyId: historyIds[index] || "",
    batchIndex: index,
  }));
}

function clearPollTimer(jobId) {
  if (!jobId) return;
  window.clearTimeout(state.pollTimers.get(jobId));
  state.pollTimers.delete(jobId);
}

function taskHistoryIds(taskNode) {
  const ids = [];
  const push = (value) => {
    const normalized = String(value || "").trim();
    if (normalized && !ids.includes(normalized)) ids.push(normalized);
  };
  (Array.isArray(taskNode?.history_ids) ? taskNode.history_ids : []).forEach(push);
  push(taskNode?.history_id);
  return ids;
}

function batchIndexForHistory(taskNode, historyId) {
  const normalized = String(historyId || "").trim();
  const ids = taskHistoryIds(taskNode);
  const index = ids.indexOf(normalized);
  return index >= 0 ? index : 0;
}

async function applyPersistedHistoryForPoll(taskNode, kind, historyId) {
  const normalizedHistoryId = String(historyId || "").trim();
  if (!taskNode || !normalizedHistoryId) return false;
  const payload = await fetchJson(`/api/history/${kind}?repair=0&view=summary&limit=200`);
  const record = (payload.items || []).find((item) => item.id === normalizedHistoryId);
  if (!record) return false;
  const changed = applyHistoryRecordToCanvas(record, kind);
  if (changed) {
    render();
    scheduleSave();
  }
  return TERMINAL_STATUSES.has(String(record.status || ""));
}

async function runSelectedTask() {
  const node = selectedNode();
  if (!node || !["image_task", "video_task"].includes(node.type)) {
    showToast("请先选择一个生图或生视频任务节点");
    return;
  }
  const kind = nodeKind(node);
  try {
    node.status = "running";
    node.error_message = "";
    removeTaskResultPlaceholders(node);
    render();
    await saveState();
    const payload = await fetchJson("/api/canvas/runs", {
      method: "POST",
      body: JSON.stringify({ target_node_id: node.id, graph: graphPayload() }),
    });
    const runKind = payload.kind || nodeKind(node);
    const runEntries = taskRunEntriesFromPayload(payload, node);
    node.job_ids = runEntries.map((entry) => entry.jobId).filter(Boolean);
    node.history_ids = runEntries.map((entry) => entry.historyId).filter(Boolean);
    node.job_id = node.job_ids[0] || payload.job_id || "";
    node.history_id = node.history_ids[0] || payload.history_id || "";
    node.batch_session_id = payload.batch_session_id || "";
    node.submitted_count = runEntries.length;
    node.status = payload.status || "running";
    ensurePendingResultNodes(node, runKind, runEntries, {
      status: node.status,
    });
    setStatus(payload.message || "任务已提交");
    render();
    scheduleSave();
    runEntries.forEach((entry) => {
      if (entry.jobId) {
        pollJobForNode(node.id, entry.jobId, runKind, entry.historyId, {
          batchIndex: entry.batchIndex,
        });
      }
    });
  } catch (error) {
    node.status = "failed";
    node.error_message = String(error?.message || error);
    updateTaskResultStatus(node, kind, "failed", { errorMessage: node.error_message });
    render();
    showToast(node.error_message);
  }
}

function pollJobForNode(nodeId, jobId, kind, historyId = "", { batchIndex = 0 } = {}) {
  clearPollTimer(jobId);
  const tick = async () => {
    const node = nodeById(nodeId);
    if (!node) {
      clearPollTimer(jobId);
      return;
    }
    try {
      const snapshot = await fetchJson(`/api/jobs/${jobId}`);
      const nextHistoryId = snapshot.history_id || historyId || "";
      if (nextHistoryId) {
        const historyIds = taskHistoryIds(node);
        if (!historyIds.includes(nextHistoryId)) {
          historyIds[batchIndex] = nextHistoryId;
          node.history_ids = historyIds.filter(Boolean);
        }
        if (!node.history_id) node.history_id = nextHistoryId;
      }
      node.error_message = snapshot.error_message || "";
      updateTaskResultStatus(node, kind || snapshot.kind || nodeKind(node), snapshot.status || node.status, {
        jobId,
        historyId: nextHistoryId,
        errorMessage: node.error_message,
        batchIndex,
      });
      syncTaskAggregateStatus(node);
      render();
      if (!TERMINAL_STATUSES.has(String(snapshot.status || node.status))) {
        state.pollTimers.set(jobId, window.setTimeout(tick, 1600));
        return;
      }
      clearPollTimer(jobId);
      if (snapshot.status === "succeeded") {
        await appendResultNodes(node, kind || snapshot.kind || nodeKind(node), nextHistoryId, snapshot, {
          jobId,
          batchIndex,
        });
      } else {
        updateTaskResultStatus(node, kind || snapshot.kind || nodeKind(node), snapshot.status || node.status, {
          jobId,
          historyId: nextHistoryId,
          errorMessage: node.error_message,
          batchIndex,
        });
      }
      syncTaskAggregateStatus(node);
      scheduleSave();
    } catch (error) {
      if (!nodeById(nodeId)) {
        clearPollTimer(jobId);
        return;
      }
      try {
        const fallbackHistoryId = historyId || node.history_id || "";
        const terminal = await applyPersistedHistoryForPoll(node, kind || nodeKind(node), fallbackHistoryId);
        if (terminal) {
          clearPollTimer(jobId);
          return;
        }
      } catch (_historyError) {
        // Keep polling the live job endpoint; history fallback is best-effort.
      }
      state.pollTimers.set(jobId, window.setTimeout(tick, 2200));
    }
  };
  tick();
}

function resultNodeTypeForKind(kind) {
  return kind === "video" ? "video_result" : "image_result";
}

function resultNodeDefaultLabel(kind, status = "running") {
  if (status === "failed") {
    return kind === "video" ? "视频生成失败" : "图片生成失败";
  }
  if (["pending", "queued", "running"].includes(status)) {
    return kind === "video" ? "视频生成中" : "图片生成中";
  }
  return kind === "video" ? "视频结果" : "图片结果";
}

function taskResultNodes(taskNode) {
  const outputEdges = state.edges.filter((edge) => (
    edge.source_node_id === taskNode.id
    && edge.source_port === "output"
    && edge.target_port === "input"
  ));
  const ids = new Set(outputEdges.map((edge) => edge.target_node_id));
  return state.nodes.filter((node) => ids.has(node.id) && nodeRole(node) === "result");
}

function resultNodeHasArtifact(resultNode) {
  return Boolean(String(resultNode?.public_url || "").trim() || String(resultNode?.thumbnail_url || "").trim());
}

function syncTaskAggregateStatus(taskNode) {
  const results = taskResultNodes(taskNode);
  if (!results.length) return;
  const statuses = results.map((node) => String(node.status || "").trim()).filter(Boolean);
  if (statuses.some((status) => ["pending", "queued", "running"].includes(status))) {
    taskNode.status = "running";
    return;
  }
  if (statuses.length && statuses.every((status) => status === "succeeded")) {
    taskNode.status = "succeeded";
    taskNode.error_message = "";
    return;
  }
  if (statuses.some((status) => status === "failed")) {
    taskNode.status = "failed";
  }
}

function removeTaskResultNodes(taskNode, predicate) {
  const staleIds = new Set(
    taskResultNodes(taskNode)
      .filter((resultNode) => predicate(resultNode))
      .map((resultNode) => resultNode.id),
  );
  if (!staleIds.size) return false;
  state.nodes = state.nodes.filter((node) => !staleIds.has(node.id));
  state.edges = state.edges.filter((edge) => !staleIds.has(edge.source_node_id) && !staleIds.has(edge.target_node_id));
  state.selectedNodeIds = new Set([...state.selectedNodeIds].filter((nodeId) => !staleIds.has(nodeId)));
  return true;
}

function removeTaskResultPlaceholders(taskNode) {
  return removeTaskResultNodes(taskNode, (resultNode) => !resultNodeHasArtifact(resultNode));
}

function pruneResolvedTaskPlaceholders() {
  let changed = false;
  state.nodes
    .filter((node) => nodeRole(node) === "task")
    .forEach((taskNode) => {
      const results = taskResultNodes(taskNode);
      const hasArtifactResult = results.some((resultNode) => resultNodeHasArtifact(resultNode));
      if (!hasArtifactResult && String(taskNode.status || "") !== "succeeded") return;
      changed = removeTaskResultPlaceholders(taskNode) || changed;
    });
  return changed;
}

function findResultNodeForArtifact(taskNode, historyId, jobId, artifactIndex = 0, batchIndex = 0) {
  const index = Number(artifactIndex || 0);
  const slot = Number(batchIndex || 0);
  return taskResultNodes(taskNode).find((node) => (
    (
      (historyId && node.history_id === historyId && Number(node.artifact_index || 0) === index)
      || (jobId && node.job_id === jobId && Number(node.artifact_index || 0) === index)
      || (
        !historyId
        && !jobId
        && Number(node.batch_index || 0) === slot
        && Number(node.artifact_index || 0) === index
        && !node.public_url
        && !node.thumbnail_url
        && ["pending", "queued", "running"].includes(String(node.status || ""))
      )
    )
  )) || null;
}

function ensurePendingResultNode(taskNode, kind, { jobId = "", historyId = "", batchIndex = 0, artifactIndex = 0, status = "running" } = {}) {
  const existing = findResultNodeForArtifact(taskNode, historyId, jobId, artifactIndex, batchIndex);
  if (existing) {
    existing.job_id = jobId || existing.job_id || "";
    existing.history_id = historyId || existing.history_id || "";
    existing.batch_index = batchIndex;
    existing.artifact_index = artifactIndex;
    existing.status = status || "running";
    existing.label = resultNodeDefaultLabel(kind, existing.status);
    return existing;
  }
  const type = resultNodeTypeForKind(kind);
  const resultSize = nodeSize({ type });
  const basePosition = {
    x: Number(taskNode.x || 0) + 290,
    y: Number(taskNode.y || 0) + Number(batchIndex || 0) * (resultSize.height + 28),
  };
  const resultNode = {
    id: uid(type),
    type,
    label: resultNodeDefaultLabel(kind, status || "running"),
    x: basePosition.x,
    y: basePosition.y,
    history_id: historyId,
    job_id: jobId,
    artifact_index: artifactIndex,
    batch_index: batchIndex,
    thumbnail_url: "",
    public_url: "",
    status: status || "running",
    source_prompt: String(taskNode.config?.prompt || "").trim(),
    config: {
      history_id: historyId,
      artifact_index: artifactIndex,
      batch_index: batchIndex,
      source_prompt: String(taskNode.config?.prompt || "").trim(),
    },
  };
  const openPosition = findOpenPosition(basePosition, resultNode);
  resultNode.x = openPosition.x;
  resultNode.y = openPosition.y;
  state.nodes.push(resultNode);
  state.edges.push({
    id: uid("edge"),
    source_node_id: taskNode.id,
    source_port: "output",
    target_node_id: resultNode.id,
    target_port: "input",
  });
  return resultNode;
}

function ensurePendingResultNodes(taskNode, kind, entries, { status = "running" } = {}) {
  const normalizedEntries = entries && entries.length ? entries : taskRunEntriesFromPayload({}, taskNode);
  normalizedEntries.forEach((entry) => {
    ensurePendingResultNode(taskNode, kind, {
      jobId: entry.jobId,
      historyId: entry.historyId,
      batchIndex: entry.batchIndex,
      status,
    });
  });
}

function updateTaskResultStatus(taskNode, kind, status, { jobId = "", historyId = "", errorMessage = "", batchIndex = 0, artifactIndex = 0 } = {}) {
  const resultNode = ensurePendingResultNode(taskNode, kind, { jobId, historyId, batchIndex, artifactIndex, status });
  resultNode.status = status;
  resultNode.error_message = errorMessage || "";
  resultNode.history_id = historyId || resultNode.history_id || "";
  resultNode.job_id = jobId || resultNode.job_id || "";
  resultNode.batch_index = batchIndex;
  resultNode.artifact_index = artifactIndex;
  resultNode.config = {
    ...(resultNode.config || {}),
    history_id: resultNode.history_id,
    artifact_index: artifactIndex,
    batch_index: batchIndex,
    source_prompt: String(taskNode?.config?.prompt || resultNode.source_prompt || "").trim(),
  };
  resultNode.source_prompt = resultNode.config.source_prompt || resultNode.source_prompt || "";
  if (!resultNode.public_url && !resultNode.thumbnail_url) {
    resultNode.label = resultNodeDefaultLabel(kind, status);
  }
}

function applyArtifactToResultNode(resultNode, taskNode, kind, historyId, artifact, index, { jobId = "", batchIndex = 0 } = {}) {
  const type = resultNodeTypeForKind(kind);
  resultNode.type = type;
  resultNode.label = artifact.display_name || artifact.original_name || resultNodeDefaultLabel(kind, "succeeded");
  resultNode.history_id = historyId || resultNode.history_id || "";
  resultNode.job_id = jobId || resultNode.job_id || "";
  resultNode.artifact_index = index;
  resultNode.batch_index = batchIndex;
  resultNode.thumbnail_url = artifact.thumbnail_url || artifact.public_url || artifact.source_url || "";
  resultNode.public_url = artifact.public_url || artifact.source_url || "";
  resultNode.status = "succeeded";
  resultNode.error_message = "";
  resultNode.source_prompt = String(taskNode?.config?.prompt || resultNode.source_prompt || "").trim();
  resultNode.config = {
    ...(resultNode.config || {}),
    history_id: resultNode.history_id,
    artifact_index: index,
    batch_index: batchIndex,
    source_prompt: resultNode.source_prompt,
  };
}

function createArtifactResultNode(taskNode, kind, historyId, artifact, index, { jobId = "", batchIndex = 0 } = {}) {
  const type = resultNodeTypeForKind(kind);
  const basePosition = {
    x: Number(taskNode.x || 0) + 290,
    y: Number(taskNode.y || 0) + (Number(batchIndex || 0) + index) * 150,
  };
  const resultNode = {
    id: uid(type),
    type,
    label: artifact.display_name || artifact.original_name || resultNodeDefaultLabel(kind, "succeeded"),
    x: basePosition.x,
    y: basePosition.y,
    history_id: historyId,
    job_id: jobId || "",
    artifact_index: index,
    batch_index: batchIndex,
    thumbnail_url: artifact.thumbnail_url || artifact.public_url || artifact.source_url || "",
    public_url: artifact.public_url || artifact.source_url || "",
    status: "succeeded",
    source_prompt: String(taskNode?.config?.prompt || "").trim(),
    config: {
      history_id: historyId,
      artifact_index: index,
      batch_index: batchIndex,
      source_prompt: String(taskNode?.config?.prompt || "").trim(),
    },
  };
  const openPosition = findOpenPosition(basePosition, resultNode);
  resultNode.x = openPosition.x;
  resultNode.y = openPosition.y;
  state.nodes.push(resultNode);
  state.edges.push({
    id: uid("edge"),
    source_node_id: taskNode.id,
    source_port: "output",
    target_node_id: resultNode.id,
    target_port: "input",
  });
  return resultNode;
}

async function appendResultNodes(taskNode, kind, historyId, snapshot, { jobId = "", batchIndex = 0 } = {}) {
  let artifacts = snapshot?.result_payload?.artifacts || [];
  let record = null;
  if (historyId) {
    try {
      const payload = await fetchJson(`/api/history/${kind}?repair=0&view=summary&limit=120`);
      record = (payload.items || []).find((item) => item.id === historyId);
      artifacts = record?.result_payload?.artifacts || artifacts;
    } catch (_error) {
      // Job snapshot artifacts are enough for the canvas preview.
    }
  }
  if (!artifacts.length) return;
  artifacts.forEach((artifact, index) => {
    const existing = findResultNodeForArtifact(taskNode, historyId, jobId, index, batchIndex);
    if (existing) {
      applyArtifactToResultNode(existing, taskNode, kind, historyId, artifact, index, { jobId, batchIndex });
      return;
    }
    createArtifactResultNode(taskNode, kind, historyId, artifact, index, { jobId, batchIndex });
  });
  render();
}

function historyIdsForCanvasKind(kind) {
  const ids = new Set();
  state.nodes.forEach((node) => {
    if (nodeRole(node) === "task" && nodeKind(node) === kind) {
      taskHistoryIds(node).forEach((historyId) => ids.add(historyId));
    }
    if (nodeKind(node) === kind && node.history_id) {
      ids.add(node.history_id);
    }
  });
  return ids;
}

function applyHistoryRecordToCanvas(record, kind) {
  const historyId = record?.id;
  if (!historyId) return false;
  let changed = false;
  const artifacts = record.result_payload?.artifacts || [];
  const tasks = state.nodes.filter((node) => (
    nodeRole(node) === "task"
    && nodeKind(node) === kind
    && taskHistoryIds(node).includes(historyId)
  ));
  tasks.forEach((taskNode) => {
    const batchIndex = batchIndexForHistory(taskNode, historyId);
    taskNode.error_message = record.error_message || "";
    artifacts.forEach((artifact, index) => {
      const existing = findResultNodeForArtifact(taskNode, historyId, record.job_id || "", index, batchIndex);
      if (existing) {
        applyArtifactToResultNode(existing, taskNode, kind, historyId, artifact, index, {
          jobId: record.job_id || "",
          batchIndex,
        });
      } else if (record.status === "succeeded") {
        createArtifactResultNode(taskNode, kind, historyId, artifact, index, {
          jobId: record.job_id || "",
          batchIndex,
        });
      }
    });
    if (record.status && artifacts.length === 0) {
      updateTaskResultStatus(taskNode, kind, record.status, {
        jobId: record.job_id || "",
        historyId,
        errorMessage: record.error_message || "",
        batchIndex,
      });
    }
    syncTaskAggregateStatus(taskNode);
    changed = true;
  });
  state.nodes
    .filter((node) => nodeRole(node) === "result" && nodeKind(node) === kind && node.history_id === historyId)
    .forEach((resultNode) => {
      const artifact = artifacts[Number(resultNode.artifact_index || 0)];
      if (artifact) {
        const taskNode = tasks[0] || null;
        applyArtifactToResultNode(resultNode, taskNode, kind, historyId, artifact, Number(resultNode.artifact_index || 0), {
          jobId: record.job_id || "",
          batchIndex: Number(resultNode.batch_index || batchIndexForHistory(taskNode, historyId) || 0),
        });
        changed = true;
      } else if (record.status && resultNode.status !== record.status) {
        resultNode.status = record.status;
        resultNode.error_message = record.error_message || "";
        changed = true;
      }
    });
  return changed;
}

async function hydratePersistedHistoryResults() {
  let changed = false;
  for (const kind of ["image", "video"]) {
    const ids = historyIdsForCanvasKind(kind);
    if (!ids.size) continue;
    const payload = await fetchJson(`/api/history/${kind}?repair=0&view=summary&limit=200`);
    (payload.items || [])
      .filter((item) => ids.has(item.id))
      .forEach((record) => {
        changed = applyHistoryRecordToCanvas(record, kind) || changed;
      });
  }
  if (changed) {
    render();
    scheduleSave();
  }
}

function bindToolbar() {
  document.getElementById("canvasAddImageInput")?.addEventListener("click", () => openImagePicker());
  document.getElementById("canvasAddImageTask")?.addEventListener("click", () => createNode("image_task"));
  document.getElementById("canvasAddVideoTask")?.addEventListener("click", () => createNode("video_task"));
  upscaleButton?.addEventListener("click", () => createUpscaleImageTask());
  gridSplitButton?.addEventListener("click", () => openGridSplitModal());
  document.getElementById("canvasRunSelected")?.addEventListener("click", runSelectedTask);
  document.getElementById("canvasSave")?.addEventListener("click", saveState);
  document.getElementById("canvasAutoLayout")?.addEventListener("click", autoLayout);
  document.getElementById("canvasResetView")?.addEventListener("click", resetView);
  document.getElementById("canvasThemeToggle")?.addEventListener("click", cycleCanvasTheme);
}

function setGridMenuOpen(open) {
  if (!gridMenu || !gridMenuButton) return;
  gridMenu.hidden = !open;
  gridMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function bindGridMenu() {
  gridMenuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setGridMenuOpen(Boolean(gridMenu?.hidden));
  });
  gridMenu?.addEventListener("click", (event) => {
    const action = event.target?.closest?.("[data-grid-template]")?.dataset?.gridTemplate;
    if (!action) return;
    setGridMenuOpen(false);
    applyGridTemplate(action);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!gridMenu || gridMenu.hidden) return;
    if (gridMenu.contains(event.target) || gridMenuButton?.contains(event.target)) return;
    setGridMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setGridMenuOpen(false);
  });
}

function bindMultiCameraGridDialog() {
  multiCameraGridClose?.addEventListener("click", closeMultiCameraGridDialog);
  multiCameraGridCancel?.addEventListener("click", closeMultiCameraGridDialog);
  multiCameraGridConfirm?.addEventListener("click", confirmMultiCameraGridDialog);
  multiCameraGridModal?.addEventListener("click", (event) => {
    if (event.target === multiCameraGridModal) {
      closeMultiCameraGridDialog();
    }
  });
}

function isCanvasInteractiveTarget(target) {
  return Boolean(target?.closest?.(".canvas-node, .canvas-port, .canvas-edge, .canvas-picker, .canvas-context-menu"));
}

function contextImageSourceNode(target) {
  const nodeEl = target?.closest?.(".canvas-node");
  const node = nodeById(nodeEl?.dataset?.nodeId || "");
  return isGridSplitSourceNode(node) ? node : null;
}

function contextTaskNode(target) {
  const nodeEl = target?.closest?.(".canvas-node");
  const node = nodeById(nodeEl?.dataset?.nodeId || "");
  return nodeRole(node) === "task" ? node : null;
}

function hideCanvasContextMenu() {
  if (!contextMenu) return;
  contextMenu.hidden = true;
  state.contextMenuPoint = null;
  state.contextMenuNodeId = "";
}

function showCanvasContextMenu(event) {
  if (!contextMenu) {
    return;
  }
  const sourceNode = contextImageSourceNode(event.target);
  const taskNode = sourceNode ? null : contextTaskNode(event.target);
  if (!sourceNode && !taskNode && isCanvasInteractiveTarget(event.target)) {
    return;
  }
  event.preventDefault();
  if (sourceNode || taskNode) {
    state.selectedNodeIds = new Set([(sourceNode || taskNode).id]);
    state.selectedEdgeId = "";
    state.contextMenuNodeId = (sourceNode || taskNode).id;
  } else {
    state.contextMenuNodeId = "";
  }
  state.contextMenuPoint = worldPointFromEvent(event);
  contextMenuImageActions.forEach((item) => {
    item.hidden = !sourceNode;
  });
  contextMenuResultActions.forEach((item) => {
    item.hidden = sourceNode?.type !== "image_result";
  });
  contextMenuBlankActions.forEach((item) => {
    item.hidden = Boolean(sourceNode || taskNode);
  });
  contextMenuTaskActions.forEach((item) => {
    item.hidden = !taskNode;
  });
  contextMenu.hidden = false;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const menuRect = contextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, viewportWidth - menuRect.width - 8);
  const top = Math.min(event.clientY, viewportHeight - menuRect.height - 8);
  contextMenu.style.left = `${Math.max(8, left)}px`;
  contextMenu.style.top = `${Math.max(8, top)}px`;
}

function runCanvasMenuAction(action) {
  const point = state.contextMenuPoint;
  const contextNode = nodeById(state.contextMenuNodeId);
  hideCanvasContextMenu();
  if (action === "grid-split") {
    openGridSplitModal(contextNode);
    return;
  }
  if (action === "image-to-video") {
    createImageToVideoTask(contextNode);
    return;
  }
  if (action === "upscale-image") {
    createUpscaleImageTask(contextNode);
    return;
  }
  if (action === "generate-720-panorama") {
    createPanorama720Task(contextNode);
    return;
  }
  if (action === "add-to-library") {
    openAddToLibraryDialog(contextNode);
    return;
  }
  if (action === "copy-node") {
    duplicateTaskNode(contextNode);
    return;
  }
  if (action === "delete-node") {
    if (contextNode && nodeRole(contextNode) === "task") {
      state.selectedNodeIds = new Set([contextNode.id]);
      state.selectedEdgeId = "";
    }
    deleteSelected();
    return;
  }
  if (action === "image-input") {
    if (point) {
      state.pickerDropPoint = { x: point.x, y: point.y };
    }
    openImagePicker();
    return;
  }
  if (action === "image-task") {
    createNode("image_task", point ? { x: point.x, y: point.y } : {});
    return;
  }
  if (action === "video-task") {
    createNode("video_task", point ? { x: point.x, y: point.y } : {});
    return;
  }
  if (action === "auto-layout") {
    autoLayout();
    return;
  }
  if (action === "reset-view") {
    resetView();
  }
}

function populateAddLibraryCategories(selected = CANVAS_LIBRARY_CATEGORY) {
  if (!addLibraryCategorySelect) return;
  addLibraryCategorySelect.innerHTML = "";
  libraryCategoryOptions().forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    addLibraryCategorySelect.append(option);
  });
  addLibraryCategorySelect.value = selected || CANVAS_LIBRARY_CATEGORY;
}

function closeAddToLibraryDialog() {
  state.addLibraryNodeId = "";
  if (addLibraryModal?.open) {
    addLibraryModal.close();
  }
}

function openAddToLibraryDialog(node) {
  if (!node || node.type !== "image_result") {
    showToast("请选择图片结果节点");
    return;
  }
  if (!node.history_id && !node.asset_id) {
    showToast("当前图片结果缺少任务记录，无法加入素材库");
    return;
  }
  state.addLibraryNodeId = node.id;
  populateAddLibraryCategories(CANVAS_LIBRARY_CATEGORY);
  if (addLibrarySummary) {
    addLibrarySummary.textContent = `将“${nodeTitle(node)}”添加到素材库`;
  }
  addLibraryModal?.showModal();
}

async function confirmAddToLibrary() {
  const node = nodeById(state.addLibraryNodeId);
  if (!node || node.type !== "image_result") {
    closeAddToLibraryDialog();
    showToast("请选择图片结果节点");
    return;
  }
  const tagCategory = String(addLibraryCategorySelect?.value || CANVAS_LIBRARY_CATEGORY).trim() || CANVAS_LIBRARY_CATEGORY;
  try {
    if (addLibraryConfirm) addLibraryConfirm.disabled = true;
    const displayName = nodeTitle(node);
    const payload = node.asset_id
      ? await fetchJson(`/api/assets/${encodeURIComponent(node.asset_id)}/metadata`, {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName,
          tag_category: tagCategory,
          origin: "workspace",
          library_visible: true,
        }),
      })
      : await fetchJson("/api/canvas/result-to-library", {
        method: "POST",
        body: JSON.stringify({
          history_id: node.history_id || node.config?.history_id || "",
          artifact_index: Number(node.artifact_index ?? node.config?.artifact_index ?? 0),
          tag_category: tagCategory,
          display_name: displayName,
        }),
      });
    rememberLibraryCategory(tagCategory);
    (payload.categories || []).forEach(rememberLibraryCategory);
    if (payload.asset?.id) {
      node.asset_id = payload.asset.id;
      node.config = {
        ...(node.config || {}),
        asset_id: payload.asset.id,
      };
    }
    closeAddToLibraryDialog();
    showToast(`已添加到素材库：${tagCategory}`);
    scheduleSave();
  } catch (error) {
    showToast(String(error?.message || error));
  } finally {
    if (addLibraryConfirm) addLibraryConfirm.disabled = false;
  }
}

function bindContextMenu() {
  viewport?.addEventListener("contextmenu", showCanvasContextMenu);
  contextMenu?.addEventListener("click", (event) => {
    const template = event.target?.closest?.("[data-canvas-menu-template]")?.dataset?.canvasMenuTemplate;
    if (template) {
      const point = state.contextMenuPoint ? { ...state.contextMenuPoint } : null;
      const contextNode = nodeById(state.contextMenuNodeId);
      const source = isGridSplitSourceNode(contextNode) ? contextNode : null;
      hideCanvasContextMenu();
      applyGridTemplate(template, point, { source });
      return;
    }
    const action = event.target?.closest?.("[data-canvas-menu-action]")?.dataset?.canvasMenuAction;
    if (action) {
      runCanvasMenuAction(action);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!contextMenu || contextMenu.hidden || contextMenu.contains(event.target)) {
      return;
    }
    hideCanvasContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideCanvasContextMenu();
    }
  });
}

function bindPicker() {
  picker?.querySelectorAll("[data-picker-close]").forEach((node) => node.addEventListener("click", closeImagePicker));
  pickerSearch?.addEventListener("input", debounce(() => loadPickerAssets({ reset: true }), 220));
  pickerSource?.addEventListener("change", () => loadPickerAssets({ reset: true }));
  pickerLoadMore?.addEventListener("click", () => loadPickerAssets({ reset: false }));
  pickerUploadButton?.addEventListener("click", () => pickerUploadFile?.click());
  pickerUploadFile?.addEventListener("change", () => {
    const file = pickerUploadFile.files?.[0];
    uploadPickerImage(file);
  });
}

function bindGridSplit() {
  gridSplitChoiceClose?.addEventListener("click", closeGridSplitChoice);
  gridSplitDirectButton?.addEventListener("click", () => {
    closeGridSplitChoice();
    createSelectedGridSplitNodes({ upscale: false });
  });
  gridSplitUpscaleButton?.addEventListener("click", () => {
    closeGridSplitChoice();
    createSelectedGridSplitNodes({ upscale: true });
  });
  gridSplitChoiceModal?.addEventListener("click", (event) => {
    if (event.target === gridSplitChoiceModal) {
      closeGridSplitChoice();
    }
  });
  gridSplitClose?.addEventListener("click", closeGridSplitModal);
  gridSplitModal?.addEventListener("click", (event) => {
    if (event.target === gridSplitModal) {
      closeGridSplitModal();
    }
  });
  gridSplitRows?.addEventListener("change", () => setGridSplitSize(gridSplitRows.value, state.gridSplit.cols));
  gridSplitCols?.addEventListener("change", () => setGridSplitSize(state.gridSplit.rows, gridSplitCols.value));
  gridSplitModal?.querySelectorAll("[data-grid-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const size = Number(button.dataset.gridSize || 3);
      setGridSplitSize(size, size);
    });
  });
  gridSplitSelectAll?.addEventListener("click", selectAllGridCells);
  gridSplitClear?.addEventListener("click", () => {
    state.gridSplit.selected.clear();
    renderGridSplitCells();
  });
  gridSplitRun?.addEventListener("click", submitGridSplit);
}

function bindAddLibraryDialog() {
  addLibraryClose?.addEventListener("click", closeAddToLibraryDialog);
  addLibraryCancel?.addEventListener("click", closeAddToLibraryDialog);
  addLibraryConfirm?.addEventListener("click", confirmAddToLibrary);
  addLibraryModal?.addEventListener("click", (event) => {
    if (event.target === addLibraryModal) {
      closeAddToLibraryDialog();
    }
  });
}

function bindDeleteTaskDialog() {
  deleteTaskClose?.addEventListener("click", closeDeleteTaskDialog);
  deleteCanvasOnlyButton?.addEventListener("click", deleteTaskCanvasOnly);
  deleteWithOutputsButton?.addEventListener("click", deleteTaskWithOutputs);
  deleteTaskModal?.addEventListener("click", (event) => {
    if (event.target === deleteTaskModal) {
      closeDeleteTaskDialog();
    }
  });
}

function closeCanvasImagePreview() {
  if (previewDialog?.open) {
    previewDialog.close();
  }
}

function previewNodeFromEvent(event) {
  const media = event.target?.closest?.(".canvas-node-media.is-previewable");
  if (!media || !viewport?.contains(media)) {
    return null;
  }
  const nodeEl = media.closest(".canvas-node");
  return nodeById(nodeEl?.dataset?.nodeId || "");
}

function rememberPreviewPointer(event) {
  const node = previewNodeFromEvent(event);
  if (!node || event.button !== 0) {
    state.previewPointer = null;
    return;
  }
  state.previewPointer = {
    nodeId: node.id,
    x: event.clientX,
    y: event.clientY,
  };
}

function maybeOpenPreviewFromPointer(event) {
  const candidate = state.previewPointer;
  state.previewPointer = null;
  if (!candidate) {
    return;
  }
  const node = nodeById(candidate.nodeId);
  if (!node || !previewUrlForNode(node)) {
    return;
  }
  const moved = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y);
  if (moved > 6 || state.connecting) {
    return;
  }
  event.preventDefault();
  openCanvasMediaPreview(node);
}

function bindPreview() {
  previewClose?.addEventListener("click", closeCanvasImagePreview);
  previewDialog?.addEventListener("click", (event) => {
    if (event.target === previewDialog) {
      closeCanvasImagePreview();
    }
  });
  previewDialog?.addEventListener("close", () => {
    if (previewImage) {
      previewImage.removeAttribute("src");
      previewImage.alt = "";
    }
    if (previewVideo) {
      previewVideo.pause();
      previewVideo.removeAttribute("src");
      previewVideo.removeAttribute("aria-label");
      previewVideo.load();
    }
  });
  viewport?.addEventListener("pointerdown", rememberPreviewPointer, true);
  viewport?.addEventListener("pointerup", maybeOpenPreviewFromPointer, true);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function bindViewport() {
  viewport.addEventListener("pointerdown", handleViewportPointerDown);
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerUp);
  viewport.addEventListener("wheel", handleWheel, { passive: false });
}

function bindTextEditingGuards() {
  document.addEventListener("focusin", (event) => {
    if (isTextEditingTarget(event.target)) {
      state.textEditing = true;
    }
  });
  document.addEventListener("focusout", (event) => {
    if (!isTextEditingTarget(event.target)) return;
    window.setTimeout(() => {
      state.textEditing = isTextEditingTarget(document.activeElement);
    }, 0);
  });
}

function bindKeyboard() {
  document.addEventListener("keydown", (event) => {
    const isEditingText = isTextEditingEvent(event);
    if (isEditingText) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveState();
      }
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      state.spaceDown = true;
      updateViewportModeClass();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveState();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runSelectedTask();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (isTextEditingTarget(event.target)) return;
      event.preventDefault();
      deleteSelected();
    }
    if (event.key === "Escape" && state.connecting) {
      stopConnecting();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      state.spaceDown = false;
      updateViewportModeClass();
    }
  });
  window.addEventListener("blur", () => {
    state.spaceDown = false;
    updateViewportModeClass();
  });
}

bindToolbar();
bindGridMenu();
bindMultiCameraGridDialog();
bindPicker();
bindGridSplit();
bindAddLibraryDialog();
bindDeleteTaskDialog();
bindPreview();
bindContextMenu();
bindViewport();
bindTextEditingGuards();
bindKeyboard();
applyCanvasTheme();
loadState().catch((error) => showToast(String(error?.message || error)));
