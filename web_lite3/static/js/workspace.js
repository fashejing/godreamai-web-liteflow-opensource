import {
  $,
  createElement,
  fetchJson,
  formatDate,
  formatElapsed,
  getPageConfig,
  openDetailModal,
  showToast,
} from "/static/js/common.js";
import {
  buildCrossKindEmptyState,
  dedupeAssetsById,
  getRecordCardAction,
  normalizeWorkspaceAssets,
} from "/static/js/workspace_ui_helpers.js";

const config = getPageConfig();
const kind = config.kind;
const configuredAssetTagCategories = Array.isArray(config.ui?.asset_tag_categories)
  ? config.ui.asset_tag_categories
  : [];
const mentionBoundaryPattern = /[\s@,.;:!?()[\]{}<>"'`~\\/|，。！？；：、】【（）《》〈〉、]/;
const promptPlaceholderPlain = "请输入生成提示词";
const promptPlaceholderMention = "请输入生成提示词，输入 @ 可引用已打标签的图片";
const terminalStatuses = ["succeeded", "failed", "cancelled", "expired"];
const pageSize = 120;
const recordGridGap = 12;
const recordOverscanRows = 2;
const promptFontSizeDefaults = {
  min: 14,
  max: 28,
  value: 16,
};
const recordCardSizeSpecs = {
  small: {
    minWidth: 208,
    cardHeight: 296,
    previewHeight: 156,
  },
  medium: {
    minWidth: 240,
    cardHeight: 336,
    previewHeight: 184,
  },
  large: {
    minWidth: 280,
    cardHeight: 384,
    previewHeight: 220,
  },
};
const statusLabels = {
  pending: "已提交",
  running: "生成中",
  queued: "排队中",
  succeeded: "成功",
  failed: "失败",
  expired: "超时",
  cancel_requested: "取消中",
  cancelled: "已取消",
};
const videoModeLabels = {
  text_only: "文生视频",
  first_frame: "首帧",
  first_last: "首尾帧",
  multimodal_reference: "参考素材",
};
const imageModeLabels = {
  text_only: "文生图",
  base_only: "基础图",
  reference_only: "参考图",
  image_edit: "图像编辑",
  multi_image: "多图合成",
};
const imageModeKeys = Object.keys(imageModeLabels);

const visibleTargets = kind === "image"
  ? ["imagePrimary", "imageReferences"]
  : ["videoFirst", "videoLast", "videoReferences"];
const promptBindingTargets = ["imagePrimary", "imageReferences", "videoReferences"];

function createPromptBindingState() {
  return {
    imagePrimary: new Set(),
    imageReferences: new Set(),
    videoReferences: new Set(),
  };
}

const state = {
  liveRefreshHandle: null,
  repairRefreshHandle: null,
  history: [],
  historyCounts: {
    image: 0,
    video: 0,
  },
  total: 0,
  nextOffset: 0,
  hasMore: false,
  loadingMore: false,
  historyRevision: 0,
  previewObserver: null,
  videoPreviewQuiet: false,
  deleteTarget: null,
  activeTarget: null,
  libraryAssets: [],
  historyLookup: new Map(),
  historyFilters: {
    modelVariant: "",
    modeKey: "",
  },
  renderFrame: null,
  loadMoreFrame: null,
  recordsWheelGuardUntil: 0,
  filteredHistoryCache: {
    revision: -1,
    key: "",
    records: [],
  },
  filteredStatusCache: {
    revision: -1,
    key: "",
    total: -1,
    text: "",
  },
  recordCardPool: [],
  viewportCache: {
    revision: -1,
    key: "",
    size: "",
    stageWidth: 0,
    stageHeight: 0,
    count: -1,
    columnCount: 1,
    visibleRows: 1,
    totalRows: 1,
    rowHeight: 0,
  },
  recordCardNodes: new Map(),
  quietPosterCache: new Map(),
  quietPosterPending: new Map(),
  assetLabelCacheKey: "",
  assetLabelCache: new Map(),
  dynamicAssetTagCategories: configuredAssetTagCategories.slice(),
  mentionCacheKey: "",
  mentionCacheValue: { error: null, categories: [] },
  promptMentionLookupCache: {
    key: "",
    map: new Map(),
  },
  promptBindings: createPromptBindingState(),
  promptBindingSyncing: false,
  assets: {
    imagePrimary: null,
    imageReferences: [],
    videoFirst: null,
    videoLast: null,
    videoReferences: [],
  },
  mention: {
    activeIndex: 0,
    anchorStart: null,
    anchorEnd: null,
    itemLookup: new Map(),
    items: [],
    layoutKey: null,
    level: "categories",
    selectedCategory: null,
    searchQuery: "",
    categorySearchQuery: "",
    contextKey: null,
    noticeKey: null,
  },
  videoReferenceOptionsOpen: false,
  videoReferenceOptionsUserToggled: false,
  canPersistDraft: false,
  isRestoringDraft: false,
};

function normalizeRecordCardSize(value) {
  const normalized = String(value || "medium").trim().toLowerCase();
  if (recordCardSizeSpecs[normalized]) {
    return normalized;
  }
  return "medium";
}

function currentRecordCardSize() {
  return normalizeRecordCardSize(config.settings?.record_card_size || "medium");
}

function currentRecordCardMetrics() {
  return recordCardSizeSpecs[currentRecordCardSize()] || recordCardSizeSpecs.medium;
}

function normalizePromptFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return promptFontSizeDefaults.value;
  }
  return Math.max(promptFontSizeDefaults.min, Math.min(promptFontSizeDefaults.max, Math.round(numeric)));
}

function currentPromptFontSize() {
  return normalizePromptFontSize(config.settings?.prompt_font_size);
}

function applyPromptFontSize() {
  const workspacePage = document.querySelector(".workspace-page");
  const target = workspacePage || document.documentElement;
  target.style.setProperty("--prompt-font-size", `${currentPromptFontSize()}px`);
}

function defaultImageModelVariant() {
  const configured = String(config.ui?.default_model || "").trim();
  if (configured && (config.ui?.models || []).some((item) => item.value === configured)) {
    return configured;
  }
  if ((config.ui?.models || []).some((item) => item.value === "seedream_v5_0")) {
    return "seedream_v5_0";
  }
  return config.models?.[0]?.value || "";
}

function currentImageUiModel(modelVariant = $("#modelVariant")?.value || defaultImageModelVariant()) {
  if (kind !== "image") {
    return null;
  }
  return (config.ui?.models || []).find((item) => item.value === modelVariant) || null;
}

function currentImageProvider(modelVariant = $("#modelVariant")?.value || defaultImageModelVariant()) {
  if (currentImageUiModel(modelVariant)?.provider) {
    return currentImageUiModel(modelVariant).provider;
  }
  return "volcengine";
}

function isGoogleImageModel(modelVariant = $("#modelVariant")?.value || defaultImageModelVariant()) {
  return false;
}

function isUnifiedImageInputModel(modelVariant = $("#modelVariant")?.value || defaultImageModelVariant()) {
  return false;
}

function currentImageMaxInputImages(modelVariant = $("#modelVariant")?.value || defaultImageModelVariant()) {
  const uiModel = currentImageUiModel(modelVariant);
  const configured = Number(uiModel?.max_input_images);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return 14;
}

function imageModeOptions(modelVariant = $("#modelVariant")?.value || defaultImageModelVariant()) {
  const uiModel = currentImageUiModel(modelVariant);
  const configured = Array.isArray(uiModel?.modes) && uiModel.modes.length
    ? uiModel.modes
        .map((item) => ({
          value: String(item?.value || "").trim().toLowerCase(),
          label: String(item?.label || imageModeLabels[String(item?.value || "").trim().toLowerCase()] || "").trim(),
        }))
        .filter((item) => item.value && item.label)
    : [];
  if (configured.length) {
    return configured;
  }
  const fallback = Array.isArray(config.ui?.modes)
    ? config.ui.modes
        .map((item) => ({
          value: String(item?.value || "").trim().toLowerCase(),
          label: String(item?.label || imageModeLabels[String(item?.value || "").trim().toLowerCase()] || "").trim(),
        }))
        .filter((item) => item.value && item.label)
    : [];
  if (fallback.length) {
    return fallback;
  }
  return imageModeKeys.map((value) => ({
    value,
    label: imageModeLabels[value],
  }));
}

function normalizeImageMode(value, modelVariant = $("#modelVariant")?.value || defaultImageModelVariant()) {
  const normalized = String(value || "text_only").trim().toLowerCase();
  const supportedModes = imageModeOptions(modelVariant).map((item) => item.value);
  if (supportedModes.includes(normalized)) {
    return normalized;
  }
  if (
    isUnifiedImageInputModel(modelVariant)
    && ["base_only", "reference_only"].includes(normalized)
    && supportedModes.includes("image_edit")
  ) {
    return "image_edit";
  }
  return supportedModes[0] || "text_only";
}

function classifyImageMode({ inputAssetId = "", referenceAssetIds = [], modelVariant = $("#modelVariant")?.value || defaultImageModelVariant() } = {}) {
  const normalizedInputAssetId = String(inputAssetId || "").trim();
  const normalizedReferenceAssetIds = Array.isArray(referenceAssetIds)
    ? referenceAssetIds.filter((item) => String(item || "").trim())
    : [];
  if (isUnifiedImageInputModel(modelVariant)) {
    const imageCount = (normalizedInputAssetId ? 1 : 0) + normalizedReferenceAssetIds.length;
    if (imageCount > 1) {
      return "multi_image";
    }
    if (imageCount === 1) {
      return "image_edit";
    }
    return "text_only";
  }
  if (normalizedInputAssetId && normalizedReferenceAssetIds.length) {
    return "multi_image";
  }
  if (normalizedReferenceAssetIds.length > 1) {
    return "multi_image";
  }
  if (normalizedInputAssetId) {
    return "base_only";
  }
  if (normalizedReferenceAssetIds.length) {
    return "reference_only";
  }
  return "text_only";
}

function deriveImageModeFromParams(params = {}) {
  return classifyImageMode({
    inputAssetId: params.input_asset_id,
    referenceAssetIds: params.reference_asset_ids,
    modelVariant: params.model_variant,
  });
}

function deriveImageModeFromDraftAssets(snapshot = {}) {
  const referenceItems = Array.isArray(snapshot.imageReferences) ? snapshot.imageReferences : [];
  return classifyImageMode({
    inputAssetId: snapshot.imagePrimary?.id,
    referenceAssetIds: referenceItems.map((item) => item?.id),
    modelVariant: $("#modelVariant")?.value || defaultImageModelVariant(),
  });
}

function recordRowHeight() {
  return currentRecordCardMetrics().cardHeight + recordGridGap;
}

function applyRecordCardMetrics() {
  const workspacePage = document.querySelector(".workspace-page");
  const metrics = currentRecordCardMetrics();
  const sizeKey = currentRecordCardSize();
  const target = workspacePage || document.documentElement;
  target.style.setProperty("--record-card-min-width", `${metrics.minWidth}px`);
  target.style.setProperty("--record-card-height", `${metrics.cardHeight}px`);
  target.style.setProperty("--record-card-preview-height", `${metrics.previewHeight}px`);
  target.classList.remove("is-record-card-small", "is-record-card-medium", "is-record-card-large");
  target.classList.add(`is-record-card-${sizeKey}`);
}

function clearDerivedCaches() {
  state.assetLabelCacheKey = "";
  state.assetLabelCache = new Map();
  state.mentionCacheKey = "";
  state.mentionCacheValue = { error: null, categories: [] };
  state.promptMentionLookupCache = {
    key: "",
    map: new Map(),
  };
}

function promptBindingSet(target) {
  if (!state.promptBindings[target]) {
    state.promptBindings[target] = new Set();
  }
  return state.promptBindings[target];
}

function resetPromptBindings() {
  state.promptBindings = createPromptBindingState();
}

function prunePromptBindings() {
  for (const target of promptBindingTargets) {
    const currentIds = new Set(
      getTargetItems(target)
        .map((item) => item?.id)
        .filter(Boolean),
    );
    const bindings = promptBindingSet(target);
    for (const assetId of Array.from(bindings)) {
      if (!currentIds.has(assetId)) {
        bindings.delete(assetId);
      }
    }
  }
}

function bindPromptAsset(target, assetId) {
  const normalized = String(assetId || "").trim();
  if (!normalized) {
    return false;
  }
  const bindings = promptBindingSet(target);
  if (bindings.has(normalized)) {
    return false;
  }
  bindings.add(normalized);
  return true;
}

function unbindPromptAsset(target, assetId) {
  const normalized = String(assetId || "").trim();
  if (!normalized) {
    return false;
  }
  return promptBindingSet(target).delete(normalized);
}

function isPromptBound(target, assetId) {
  const normalized = String(assetId || "").trim();
  return Boolean(normalized) && promptBindingSet(target).has(normalized);
}

function detachAssetFromTarget(target, assetId) {
  let changed = false;
  const current = state.assets[target];
  if (Array.isArray(current)) {
    const next = current.filter((item) => item.id !== assetId);
    if (next.length !== current.length) {
      state.assets[target] = next;
      changed = true;
    }
  } else if (current?.id === assetId) {
    state.assets[target] = null;
    changed = true;
  }
  if (changed) {
    unbindPromptAsset(target, assetId);
  }
  return changed;
}

function normalizeAssetTagCategories(values) {
  const categories = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    categories.push(normalized);
  }
  return categories;
}

function currentAssetTagCategories() {
  const categories = normalizeAssetTagCategories([
    ...state.dynamicAssetTagCategories,
    ...state.libraryAssets.map((asset) => asset?.tag_category),
    ...visibleTargets.flatMap((target) => getTargetItems(target).map((asset) => asset?.tag_category)),
  ]);
  state.dynamicAssetTagCategories = categories;
  return categories;
}

function promptColorCategories() {
  return normalizeAssetTagCategories([
    ...configuredAssetTagCategories,
    ...state.dynamicAssetTagCategories,
  ]);
}

function categoryColorSeed(category) {
  let seed = 0;
  const text = String(category || "");
  for (let index = 0; index < text.length; index += 1) {
    seed = (seed * 31 + text.charCodeAt(index)) % 3600;
  }
  return seed;
}

function promptMentionColor(category) {
  const categories = promptColorCategories();
  const index = categories.indexOf(category);
  const baseHue = index >= 0 ? (index * 67 + 18) % 360 : (categoryColorSeed(category) % 360);
  const isHighContrast = document.body?.dataset?.theme === "high_contrast";
  const saturation = isHighContrast ? 78 : 72;
  const lightness = isHighContrast ? 62 : 42;
  return `hsl(${baseHue} ${saturation}% ${lightness}%)`;
}

function historyFilterKey() {
  return `${state.historyFilters.modelVariant || ""}::${state.historyFilters.modeKey || ""}`;
}

function invalidateHistoryDerivedCaches() {
  state.filteredHistoryCache = {
    revision: -1,
    key: "",
    records: [],
  };
  state.filteredStatusCache = {
    revision: -1,
    key: "",
    total: -1,
    text: "",
  };
  state.viewportCache = {
    revision: -1,
    key: "",
    size: "",
    stageWidth: 0,
    stageHeight: 0,
    count: -1,
    columnCount: 1,
    visibleRows: 1,
    totalRows: 1,
    rowHeight: 0,
  };
}

function historyRecordEquivalent(previous, next) {
  if (!previous || !next) {
    return false;
  }
  if (previous === next) {
    return true;
  }
  const previousArtifact = previous.result_payload?.artifacts?.[0] || null;
  const nextArtifact = next.result_payload?.artifacts?.[0] || null;
  return previous.id === next.id
    && previous.status === next.status
    && previous.mode_key === next.mode_key
    && previous.model_variant === next.model_variant
    && previous.prompt === next.prompt
    && previous.message === next.message
    && previous.error_message === next.error_message
    && previous.elapsed_ms === next.elapsed_ms
    && (previousArtifact?.kind || "") === (nextArtifact?.kind || "")
    && (previousArtifact?.thumbnail_url || "") === (nextArtifact?.thumbnail_url || "")
    && (previousArtifact?.public_url || "") === (nextArtifact?.public_url || "")
    && previous.updated_at === next.updated_at
    && previous.is_live === next.is_live;
}

function historySequenceEqual(previous, next) {
  if (previous === next) {
    return true;
  }
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

function setHistoryState(nextHistory, { total, nextOffset, hasMore }) {
  const sameHistory = historySequenceEqual(state.history, nextHistory);
  const sameMeta = state.total === total && state.nextOffset === nextOffset && state.hasMore === hasMore;
  if (sameHistory && sameMeta) {
    return;
  }
  state.history = nextHistory;
  state.total = total;
  state.nextOffset = nextOffset;
  state.hasMore = hasMore;
  if (!sameHistory) {
    state.historyRevision += 1;
    state.historyLookup = new Map(nextHistory.map((item) => [item.id, item]));
    invalidateHistoryDerivedCaches();
    return;
  }
  state.filteredStatusCache.total = -1;
}

function collectReuseAssetIds(params = {}) {
  const ids = [];
  const push = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || ids.includes(normalized)) {
      return;
    }
    ids.push(normalized);
  };
  if (kind === "image") {
    push(params.input_asset_id);
    for (const assetId of Array.isArray(params.reference_asset_ids) ? params.reference_asset_ids : []) {
      push(assetId);
    }
    return ids;
  }
  push(params.first_frame_asset_id);
  push(params.last_frame_asset_id);
  for (const assetId of Array.isArray(params.reference_image_asset_ids) ? params.reference_image_asset_ids : []) {
    push(assetId);
  }
  return ids;
}

function buildResolvedAssetMap(items = []) {
  return new Map(
    (Array.isArray(items) ? items : [])
      .filter((item) => item?.id)
      .map((item) => [item.id, item]),
  );
}

function buildReuseAssetSnapshot(params = {}, assetMap = new Map()) {
  if (kind === "image") {
    const inputAssetId = String(params.input_asset_id || "").trim();
    const referenceAssetIds = Array.isArray(params.reference_asset_ids) ? params.reference_asset_ids : [];
    return {
      imagePrimary: inputAssetId ? assetMap.get(inputAssetId) || null : null,
      imageReferences: referenceAssetIds
        .map((assetId) => assetMap.get(String(assetId || "").trim()))
        .filter(Boolean),
    };
  }
  const firstFrameAssetId = String(params.first_frame_asset_id || "").trim();
  const lastFrameAssetId = String(params.last_frame_asset_id || "").trim();
  const referenceAssetIds = Array.isArray(params.reference_image_asset_ids) ? params.reference_image_asset_ids : [];
  return {
    videoFirst: firstFrameAssetId ? assetMap.get(firstFrameAssetId) || null : null,
    videoLast: lastFrameAssetId ? assetMap.get(lastFrameAssetId) || null : null,
    videoReferences: referenceAssetIds
      .map((assetId) => assetMap.get(String(assetId || "").trim()))
      .filter(Boolean),
  };
}

function collectMissingReuseAssetLabels(params = {}, missingIds = []) {
  const missingSet = new Set(
    (Array.isArray(missingIds) ? missingIds : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  );
  if (!missingSet.size) {
    return [];
  }
  const labels = [];
  const add = (assetId, fallbackLabel) => {
    const normalized = String(assetId || "").trim();
    if (!normalized || !missingSet.has(normalized)) {
      return;
    }
    labels.push(String(fallbackLabel || normalized).trim() || normalized);
  };
  if (kind === "image") {
    add(params.input_asset_id, params.input_asset_name ? `基础图：${params.input_asset_name}` : "基础图");
    const referenceIds = Array.isArray(params.reference_asset_ids) ? params.reference_asset_ids : [];
    const referenceNames = Array.isArray(params.reference_asset_names) ? params.reference_asset_names : [];
    referenceIds.forEach((assetId, index) => {
      const fallback = referenceNames[index]
        ? `参考图：${referenceNames[index]}`
        : `参考图${referenceIds.length > 1 ? index + 1 : ""}`;
      add(assetId, fallback);
    });
    return labels;
  }
  add(params.first_frame_asset_id, params.first_frame_asset_name ? `首帧：${params.first_frame_asset_name}` : "首帧");
  add(params.last_frame_asset_id, params.last_frame_asset_name ? `尾帧：${params.last_frame_asset_name}` : "尾帧");
  const referenceIds = Array.isArray(params.reference_image_asset_ids) ? params.reference_image_asset_ids : [];
  const referenceNames = Array.isArray(params.reference_image_asset_names) ? params.reference_image_asset_names : [];
  referenceIds.forEach((assetId, index) => {
    const fallback = referenceNames[index]
      ? `参考图：${referenceNames[index]}`
      : `参考图${referenceIds.length > 1 ? index + 1 : ""}`;
    add(assetId, fallback);
  });
  return labels;
}

function normalizeModeKey(record) {
  if (!record) {
    return "";
  }
  const explicit = String(record.mode_key || "").trim();
  if (record.kind === "image") {
    const normalized = normalizeImageMode(explicit, record.model_variant || "");
    if (explicit && normalized === explicit) {
      return explicit;
    }
    return classifyImageMode({
      inputAssetId: record.params_requested?.input_asset_id,
      referenceAssetIds: record.params_requested?.reference_asset_ids,
      modelVariant: record.model_variant,
    });
  }
  if (explicit) {
    return explicit;
  }
  if (record.kind === "video") {
    return String(record.params_requested?.scene_type || "text_only").trim() || "text_only";
  }
  const params = record.params_requested || {};
  const inputAssetId = String(params.input_asset_id || "").trim();
  const referenceAssetIds = Array.isArray(params.reference_asset_ids)
    ? params.reference_asset_ids.filter((item) => String(item || "").trim())
    : [];
  if (inputAssetId && referenceAssetIds.length) {
    return "multi_image";
  }
  if (referenceAssetIds.length > 1) {
    return "multi_image";
  }
  if (inputAssetId) {
    return "base_only";
  }
  if (referenceAssetIds.length) {
    return "reference_only";
  }
  return "text_only";
}

function hasHistoryFilters() {
  return Boolean(state.historyFilters.modelVariant || state.historyFilters.modeKey);
}

function filteredHistory() {
  const cacheKey = historyFilterKey();
  if (
    state.filteredHistoryCache.revision === state.historyRevision
    && state.filteredHistoryCache.key === cacheKey
  ) {
    return state.filteredHistoryCache.records;
  }
  const records = state.history.filter((record) => {
    if (state.historyFilters.modelVariant && record.model_variant !== state.historyFilters.modelVariant) {
      return false;
    }
    if (state.historyFilters.modeKey && normalizeModeKey(record) !== state.historyFilters.modeKey) {
      return false;
    }
    return true;
  });
  state.filteredHistoryCache = {
    revision: state.historyRevision,
    key: cacheKey,
    records,
  };
  return records;
}

function filteredStatusText() {
  const cacheKey = historyFilterKey();
  if (
    state.filteredStatusCache.revision === state.historyRevision
    && state.filteredStatusCache.key === cacheKey
    && state.filteredStatusCache.total === state.total
  ) {
    return state.filteredStatusCache.text;
  }
  const records = filteredHistory();
  const liveRecords = records.filter((item) => item.is_live && !terminalStatuses.includes(item.status));
  let text = "";
  if (liveRecords.length) {
    const firstLive = liveRecords[0];
    if (hasHistoryFilters()) {
      text = firstLive?.message || `当前筛选下有 ${liveRecords.length} 个任务进行中`;
    } else {
      text = firstLive?.message || `当前有 ${liveRecords.length} 个任务进行中`;
    }
  } else if (hasHistoryFilters()) {
    text = `当前筛选命中 ${records.length} / ${state.total} 条记录`;
  } else {
    text = `当前资产包共有 ${state.total} 条记录`;
  }
  state.filteredStatusCache = {
    revision: state.historyRevision,
    key: cacheKey,
    total: state.total,
    text,
  };
  return text;
}

async function ensureFilteredHistoryLoaded() {
  if (!hasHistoryFilters() || filteredHistory().length || !state.hasMore || state.loadingMore) {
    return;
  }
  let guard = 0;
  let previousOffset = state.nextOffset;
  while (!filteredHistory().length && state.hasMore && guard < 20) {
    await loadMoreHistory();
    guard += 1;
    if (state.nextOffset === previousOffset) {
      break;
    }
    previousOffset = state.nextOffset;
  }
}

async function applyHistoryFilters() {
  const stage = $("#recordsStage");
  if (stage) {
    stage.scrollTop = 0;
  }
  renderRecords();
  await ensureFilteredHistoryLoaded();
}

function draftStorage() {
  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
}

function currentStorageDir() {
  return String(config.settings?.storage_dir || "").trim();
}

function workspaceDraftKey() {
  return `godreamai-plus:draft:${kind}:${currentStorageDir()}`;
}

function cloneDraftValue(value) {
  if (value == null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeDraftAsset(value, multiple = false) {
  if (multiple) {
    return Array.isArray(value) ? value.map((item) => cloneDraftValue(item)).filter(Boolean) : [];
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  return cloneDraftValue(value);
}

function serializeAssetsDraft() {
  normalizeAssetState();
  return {
    imagePrimary: normalizeDraftAsset(state.assets.imagePrimary, false),
    imageReferences: normalizeDraftAsset(state.assets.imageReferences, true),
    videoFirst: normalizeDraftAsset(state.assets.videoFirst, false),
    videoLast: normalizeDraftAsset(state.assets.videoLast, false),
    videoReferences: normalizeDraftAsset(state.assets.videoReferences, true),
  };
}

function restoreDraftAssets(snapshot = {}) {
  state.assets.imagePrimary = normalizeDraftAsset(snapshot.imagePrimary, false);
  state.assets.imageReferences = normalizeDraftAsset(snapshot.imageReferences, true);
  state.assets.videoFirst = normalizeDraftAsset(snapshot.videoFirst, false);
  state.assets.videoLast = normalizeDraftAsset(snapshot.videoLast, false);
  state.assets.videoReferences = normalizeDraftAsset(snapshot.videoReferences, true);
  normalizeAssetState();
  if (kind === "image") {
    normalizeGoogleImageAssets(currentImageMode());
  }
  normalizeAssetState();
  clearDerivedCaches();
}

function serializeWorkspaceDraft() {
  const draft = {
    kind,
    storageDir: currentStorageDir(),
    prompt: $("#promptInput")?.value || "",
    assets: serializeAssetsDraft(),
  };
  if (kind === "image") {
    draft.model_variant = $("#modelVariant").value;
    draft.image_mode = currentImageMode();
    draft.aspect_ratio = $("#imageAspectRatio").value;
    draft.size = $("#imageSize").value;
    draft.count = Number($("#imageCount").value || 1);
    draft.sequential_mode = $("#imageSequential").checked;
    draft.output_format = $("#imageOutputFormat").value;
    draft.quality = $("#imageQuality")?.value || "auto";
    draft.background = $("#imageBackground")?.value || "auto";
    draft.moderation = $("#imageModeration")?.value || "auto";
    draft.output_compression = Number($("#imageOutputCompression")?.value || 100);
    draft.enable_web_search = $("#imageWebSearch").checked;
    } else {
      draft.model_variant = $("#modelVariant").value;
      draft.scene_type = $("#videoSceneType").value;
      draft.resolution_grade = $("#videoResolution").value;
      draft.ratio = $("#videoRatio").value;
      draft.duration = Number($("#videoDuration").value || 5);
      draft.seed = Number($("#videoSeed").value || -1);
      draft.generate_audio = $("#videoGenerateAudio").checked;
      draft.enable_web_search = $("#videoWebSearch")?.checked || false;
      draft.reference_video_urls = ($("#videoReferenceUrls").value || "").split("\n");
      draft.reference_audio_urls = ($("#audioReferenceUrls").value || "").split("\n");
      draft.trusted_asset_uris = ($("#trustedAssetUris")?.value || "").split("\n");
    }
  return draft;
}

function persistWorkspaceDraft() {
  if (!state.canPersistDraft || state.isRestoringDraft) {
    return;
  }
  const storage = draftStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(workspaceDraftKey(), JSON.stringify(serializeWorkspaceDraft()));
  } catch (_error) {
    // Ignore quota/storage failures and keep the page usable.
  }
}

function clearWorkspaceDraft() {
  const storage = draftStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(workspaceDraftKey());
  } catch (_error) {
    // Ignore storage failures when clearing drafts.
  }
}

function restoreWorkspaceDraft() {
  const storage = draftStorage();
  if (!storage) {
    return false;
  }
  let raw = "";
  try {
    raw = storage.getItem(workspaceDraftKey()) || "";
  } catch (_error) {
    return false;
  }
  if (!raw) {
    return false;
  }
  let draft;
  try {
    draft = JSON.parse(raw);
  } catch (_error) {
    clearWorkspaceDraft();
    return false;
  }
  if (draft?.kind !== kind || String(draft?.storageDir || "") !== currentStorageDir()) {
    return false;
  }
  state.isRestoringDraft = true;
  try {
    $("#promptInput").value = String(draft.prompt || "");
    if (kind === "image") {
      applyImageDefaults({
        ...draft,
        image_mode: draft.image_mode || deriveImageModeFromDraftAssets(draft.assets || {}),
      });
      } else {
        applyVideoDefaults(draft);
        $("#videoReferenceUrls").value = Array.isArray(draft.reference_video_urls)
          ? draft.reference_video_urls.join("\n")
          : "";
        $("#audioReferenceUrls").value = Array.isArray(draft.reference_audio_urls)
          ? draft.reference_audio_urls.join("\n")
          : "";
        if ($("#trustedAssetUris")) {
          $("#trustedAssetUris").value = Array.isArray(draft.trusted_asset_uris)
            ? draft.trusted_asset_uris.join("\n")
            : "";
        }
        syncVideoReferenceOptions({
          autoOpen: videoReferenceUrlsHaveValue(),
          resetUserChoice: true,
        });
        syncVideoPricingHint();
      }
    restoreDraftAssets(draft.assets || {});
    renderAllAssetLists();
    syncPromptBoundAssetsFromPrompt();
    hideMentionMenu();
    return true;
  } finally {
    state.isRestoringDraft = false;
  }
}

function assetStateSignature() {
  const scene = kind === "video" ? currentVideoScene() : currentImageMode();
  const parts = [scene];
  for (const target of visibleTargets) {
    const items = getTargetItems(target);
    parts.push(
      `${target}:${items.map((item) => [
        item.id,
        item.content_hash || "",
        item.tag_category || "",
        item.display_name || "",
        item.origin || "",
      ].join(":")).join("|")}`,
    );
  }
  return parts.join("||");
}

function libraryAssetsSignature() {
  return state.libraryAssets.map((asset) => [
    asset.id,
    asset.content_hash || "",
    asset.tag_category || "",
    asset.mention_name || "",
    asset.display_name || "",
    asset.origin || "",
  ].join(":")).join("|");
}

function setStatus(message) {
  $("#statusText").textContent = message || "等待任务";
}

function formatRuntimeElapsed(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `T=${seconds.toFixed(1)}s`;
  }
  return `T=${Math.round(seconds)}s`;
}

function syncQuietModeButton() {
  const button = $("#quietModeButton");
  if (!button) {
    return;
  }
  button.replaceChildren();
  const track = document.createElement("span");
  track.className = "preview-switch-track";
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("span");
  thumb.className = "preview-switch-thumb";
  track.appendChild(thumb);
  const label = document.createElement("span");
  label.className = "preview-switch-label";
  label.textContent = state.videoPreviewQuiet ? "动态预览 开" : "动态预览";
  button.append(track, label);
  button.classList.toggle("is-active", state.videoPreviewQuiet);
  button.setAttribute("aria-pressed", state.videoPreviewQuiet ? "true" : "false");
}

function cardElapsedLabel(record) {
  if (record.is_live && !terminalStatuses.includes(record.status)) {
    return formatRuntimeElapsed(record.elapsed_ms);
  }
  return formatElapsed(record.elapsed_ms);
}

function assetConfig(target) {
  return {
    imagePrimary: { listId: "#imagePrimaryList", multiple: false },
    imageReferences: { listId: "#imageReferenceList", multiple: true },
    videoFirst: { listId: "#videoFirstList", multiple: false },
    videoLast: { listId: "#videoLastList", multiple: false },
    videoReferences: { listId: "#videoReferenceList", multiple: true },
  }[target];
}

function getTargetItems(target) {
  const current = state.assets[target];
  return Array.isArray(current) ? current : current ? [current] : [];
}

function normalizeAssetState() {
  const normalized = normalizeWorkspaceAssets(state.assets);
  const nextPrimaryId = String(normalized.imagePrimary?.id || "");
  const nextSignature = [
    nextPrimaryId,
    normalized.imageReferences.map((item) => item.id).join("|"),
    String(normalized.videoFirst?.id || ""),
    String(normalized.videoLast?.id || ""),
    normalized.videoReferences.map((item) => item.id).join("|"),
  ].join("::");
  const currentSignature = [
    String(state.assets.imagePrimary?.id || ""),
    state.assets.imageReferences.map((item) => item.id).join("|"),
    String(state.assets.videoFirst?.id || ""),
    String(state.assets.videoLast?.id || ""),
    state.assets.videoReferences.map((item) => item.id).join("|"),
  ].join("::");
  if (nextSignature === currentSignature) {
    return false;
  }
  state.assets.imagePrimary = normalized.imagePrimary;
  state.assets.imageReferences = normalized.imageReferences;
  state.assets.videoFirst = normalized.videoFirst;
  state.assets.videoLast = normalized.videoLast;
  state.assets.videoReferences = normalized.videoReferences;
  clearDerivedCaches();
  return true;
}

function targetSupportsTagging(target) {
  if (kind === "image") {
    return target === "imagePrimary" || target === "imageReferences";
  }
  return currentVideoScene() === "multimodal_reference" && target === "videoReferences";
}

function normalizeGoogleImageAssets(mode = currentImageMode()) {
  if (kind !== "image" || !isUnifiedImageInputModel()) {
    return false;
  }
  let changed = false;
  if (mode === "multi_image") {
    const primary = state.assets.imagePrimary;
    if (primary) {
      const exists = state.assets.imageReferences.some((item) => item.id === primary.id);
      if (!exists) {
        state.assets.imageReferences = [primary, ...state.assets.imageReferences];
      }
      state.assets.imagePrimary = null;
      changed = true;
    }
  } else if (mode === "image_edit" && !state.assets.imagePrimary && state.assets.imageReferences.length) {
    state.assets.imagePrimary = state.assets.imageReferences[0];
    changed = true;
  }
  if (changed) {
    clearDerivedCaches();
  }
  return changed;
}

function setTargetCategory(target, assetId, category) {
  const current = state.assets[target];
  if (Array.isArray(current)) {
    state.assets[target] = current.map((item) =>
      item.id === assetId ? { ...item, tag_category: category || "" } : item,
    );
    clearDerivedCaches();
    return;
  }
  if (current?.id === assetId) {
    state.assets[target] = { ...current, tag_category: category || "" };
    clearDerivedCaches();
  }
}

function updateTargetAsset(target, assetId, updates) {
  const current = state.assets[target];
  if (Array.isArray(current)) {
    state.assets[target] = current.map((item) => (item.id === assetId ? { ...item, ...updates } : item));
    clearDerivedCaches();
    return;
  }
  if (current?.id === assetId) {
    state.assets[target] = { ...current, ...updates };
    clearDerivedCaches();
  }
}

function defaultAssetName(asset) {
  const original = String(asset.display_name || asset.original_name || asset.path || asset.id || "").trim();
  const normalized = original.split("/").pop() || original;
  return normalized.replace(/\.[^/.]+$/, "") || asset.id;
}

async function loadLibraryAssets({ silent = false } = {}) {
  try {
    const payload = await fetchJson("/api/library/assets");
    state.libraryAssets = payload.items || [];
    state.dynamicAssetTagCategories = normalizeAssetTagCategories(payload.categories);
    clearDerivedCaches();
    const synced = syncPromptBoundAssetsFromPrompt();
    if (!synced) {
      renderPromptMirror();
      updateMentionMenu();
      persistWorkspaceDraft();
    }
  } catch (error) {
    if (!silent) {
      showToast(String(error.message || error));
    }
  }
}

async function persistAssetMetadata(target, asset, category) {
  if (!targetSupportsTagging(target)) {
    return;
  }
  const nextCategory = String(category || "").trim();
  const payload = await fetchJson(`/api/assets/${asset.id}/metadata`, {
    method: "PATCH",
    body: JSON.stringify({
      display_name: asset.display_name || defaultAssetName(asset),
      tag_category: nextCategory || null,
      origin: asset.origin || "workspace",
      library_visible: Boolean(nextCategory),
    }),
  });
  updateTargetAsset(target, asset.id, payload.asset || {});
  await loadLibraryAssets({ silent: true });
}

function currentVideoScene() {
  return kind === "video" ? $("#videoSceneType").value : null;
}

function currentImageMode() {
  return kind === "image"
    ? normalizeImageMode($("#imageMode")?.value || "text_only", $("#modelVariant")?.value || "")
    : null;
}

function ensureImageModeOptions(preferredMode = null) {
  if (kind !== "image") {
    return "";
  }
  const select = $("#imageMode");
  if (!select) {
    return "";
  }
  const options = imageModeOptions();
  const currentValue = preferredMode || select.value;
  select.innerHTML = "";
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  }
  const nextValue = normalizeImageMode(currentValue, $("#modelVariant")?.value || "");
  select.value = nextValue;
  return nextValue;
}

function isMentionEnabled(modeOrScene = kind === "image" ? currentImageMode() : currentVideoScene()) {
  if (kind === "image") {
    return currentImageProvider() !== "openai" && modeOrScene !== "text_only";
  }
  return modeOrScene === "multimodal_reference";
}

function syncPromptPlaceholder(modeOrScene = kind === "image" ? currentImageMode() : currentVideoScene()) {
  const textarea = $("#promptInput");
  if (!textarea) {
    return;
  }
  textarea.placeholder = isMentionEnabled(modeOrScene)
    ? promptPlaceholderMention
    : promptPlaceholderPlain;
}

function getActiveImageAssets() {
  if (kind === "image") {
    const mode = currentImageMode();
    if (isUnifiedImageInputModel()) {
      if (mode === "image_edit") {
        return [...getTargetItems("imagePrimary"), ...getTargetItems("imageReferences").slice(0, state.assets.imagePrimary ? 0 : 1)];
      }
      if (mode === "multi_image") {
        return [...getTargetItems("imagePrimary"), ...getTargetItems("imageReferences")];
      }
      return [];
    }
    if (mode === "base_only") {
      return [...getTargetItems("imagePrimary")];
    }
    if (mode === "reference_only") {
      return [...getTargetItems("imageReferences")];
    }
    if (mode === "multi_image") {
      return [...getTargetItems("imagePrimary"), ...getTargetItems("imageReferences")];
    }
    return [];
  }
  return currentVideoScene() === "multimodal_reference"
    ? [...getTargetItems("videoReferences")]
    : [];
}

function deriveAssetLabels() {
  const cacheKey = assetStateSignature();
  if (cacheKey === state.assetLabelCacheKey) {
    return state.assetLabelCache;
  }
  const counters = new Map(currentAssetTagCategories().map((category) => [category, 0]));
  const labelMap = new Map();
  let imageIndex = 0;
  for (const asset of getActiveImageAssets()) {
    if (!asset?.id || !asset.tag_category) {
      continue;
    }
    imageIndex += 1;
    const sequence = (counters.get(asset.tag_category) || 0) + 1;
    counters.set(asset.tag_category, sequence);
    const baseName = asset.display_name || defaultAssetName(asset);
    const isLibraryAsset = asset.origin && asset.origin !== "workspace";
    labelMap.set(asset.id, {
      asset_id: asset.id,
      tag_category: asset.tag_category,
      tag_sequence: sequence,
      tag_label: `${asset.tag_category}${sequence}`,
      mention_name: isLibraryAsset ? `${baseName}（素材库）` : baseName,
      image_index: imageIndex,
    });
  }
  state.assetLabelCacheKey = cacheKey;
  state.assetLabelCache = labelMap;
  return labelMap;
}

function activeMentionItems() {
  return Array.from(deriveAssetLabels().values(), (item) => ({
    key: `active:${item.asset_id}`,
    label: item.tag_label,
    description: item.mention_name && item.mention_name !== item.tag_label ? item.mention_name : "当前请求素材",
    asset_id: item.asset_id,
    category: item.tag_category,
    source: "active",
    insertLabel: item.tag_label,
    searchText: `${item.tag_label} ${item.mention_name || ""}`.toLowerCase(),
  }));
}

function libraryMentionItems() {
  const activeAssetIds = new Set(getActiveImageAssets().map((asset) => asset.id));
  return state.libraryAssets
    .filter((asset) => asset?.id && asset.tag_category && !activeAssetIds.has(asset.id))
    .map((asset) => {
      const baseName = asset.display_name || defaultAssetName(asset);
      const mentionName = asset.mention_name || `${baseName}（素材库）`;
      return {
        key: `library:${asset.id}`,
        label: mentionName,
        description: "素材库素材",
        asset_id: asset.id,
        category: asset.tag_category,
        source: asset.origin || "library",
        insertLabel: mentionName,
        searchText: `${asset.tag_category} ${mentionName} ${asset.display_name || ""}`.toLowerCase(),
      };
    });
}

function renderAllAssetLists() {
  normalizeAssetState();
  prunePromptBindings();
  for (const target of visibleTargets) {
    renderAssetList(target);
  }
  renderPromptMirror();
  updateMentionMenu();
  persistWorkspaceDraft();
}

function renderAssetList(target) {
  const meta = assetConfig(target);
  const container = meta ? $(meta.listId) : null;
  if (!meta || !container) {
    return;
  }
  container.innerHTML = "";
  const derivedLabels = deriveAssetLabels();
  const items = getTargetItems(target);
  for (const asset of items) {
    const card = createElement("div", "asset-card");
    const header = createElement("div", "asset-card-head");
    const title = createElement("div", "asset-file-name", asset.display_name || defaultAssetName(asset));
    title.title = asset.display_name || asset.original_name || asset.path || asset.id;
    const removeButton = createElement("button", "asset-remove-button", "删除");
    removeButton.type = "button";
    removeButton.onclick = () => removeAsset(target, asset.id);
    header.append(title, removeButton);
    card.appendChild(header);

    if (asset.public_url) {
      const preview = document.createElement("img");
      preview.className = "asset-thumb";
      preview.alt = asset.original_name || "asset";
      preview.src = asset.public_url;
      card.appendChild(preview);
    }

    if (targetSupportsTagging(target)) {
      const controls = createElement("div", "asset-card-controls");
      const select = document.createElement("select");
      select.className = "asset-tag-select";
      const categories = currentAssetTagCategories();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = categories.length ? "选择标签" : "暂无可用分类";
      select.appendChild(placeholder);
      for (const category of categories) {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        option.selected = asset.tag_category === category;
        select.appendChild(option);
      }
      select.disabled = !categories.length;
      select.addEventListener("change", async () => {
        setTargetCategory(target, asset.id, select.value);
        try {
          await persistAssetMetadata(target, asset, select.value);
        } catch (error) {
          showToast(String(error.message || error));
        }
        renderAllAssetLists();
      });
      controls.appendChild(select);

      const derived = derivedLabels.get(asset.id);
      const badge = createElement(
        "div",
        `asset-tag-badge${derived ? "" : " is-muted"}`,
        derived?.tag_label || "未标记",
      );
      controls.appendChild(badge);
      card.appendChild(controls);
    }
    container.appendChild(card);
  }
}

function removeAsset(target, assetId) {
  const promptBound = isPromptBound(target, assetId);
  if (promptBound) {
    const catalog = currentPromptBindingCatalog();
    const aliases = Array.from(catalog.byAssetId.get(assetId)?.aliases || []);
    if (aliases.length) {
      removePromptMentionsForAliases(aliases);
    }
  }
  const changed = detachAssetFromTarget(target, assetId);
  if (!changed) {
    return;
  }
  clearDerivedCaches();
  if (promptBound) {
    const synced = syncPromptBoundAssetsFromPrompt();
    if (synced) {
      return;
    }
  }
  renderAllAssetLists();
}

async function uploadFiles(target, files) {
  const uploaded = [];
  for (const file of files) {
    const formData = new FormData();
    formData.append("kind", "image");
    formData.append("file", file);
    const response = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    uploaded.push({ ...payload.asset, tag_category: "" });
  }

  if (assetConfig(target).multiple) {
    state.assets[target] = [...state.assets[target], ...uploaded];
  } else {
    state.assets[target] = uploaded[0] || null;
  }
  normalizeAssetState();
  clearDerivedCaches();
  renderAllAssetLists();
}

function bindDropzone(dropzoneId, fileInputId, target, multiple = false) {
  const dropzone = $(dropzoneId);
  const fileInput = $(fileInputId);
  if (!dropzone || !fileInput) {
    return;
  }
  const openPicker = () => {
    state.activeTarget = target;
    fileInput.click();
  };
  dropzone.addEventListener("click", openPicker);
  fileInput.addEventListener("change", async () => {
    if (!fileInput.files?.length) {
      return;
    }
    try {
      await uploadFiles(target, Array.from(fileInput.files));
      showToast("素材上传成功");
    } catch (error) {
      showToast(String(error.message || error));
    } finally {
      fileInput.value = "";
    }
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      state.activeTarget = target;
      dropzone.classList.add("is-active");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.remove("is-active");
    });
  });
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) {
      return;
    }
    try {
      await uploadFiles(target, multiple ? files : [files[0]]);
      showToast("素材上传成功");
    } catch (error) {
      showToast(String(error.message || error));
    }
  });
}

function bindPasteUpload() {
  document.addEventListener("paste", async (event) => {
    const target = state.activeTarget;
    if (!target) {
      return;
    }
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) {
      return;
    }
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }
    try {
      await uploadFiles(target, [file]);
      showToast("已粘贴上传图片");
    } catch (error) {
      showToast(String(error.message || error));
    }
  });
}

function applyImageDefaults(params = {}) {
  const nextModelVariant = params.model_variant || defaultImageModelVariant() || "seedream_v5_0";
  $("#modelVariant").value = nextModelVariant;
  $("#imageCount").value = params.count || 1;
  $("#imageSequential").checked = Boolean(params.sequential_mode);
  $("#imageOutputFormat").value = params.output_format || currentImageUiModel(nextModelVariant)?.default_output_format || "jpeg";
  if ($("#imageQuality")) {
    $("#imageQuality").value = params.quality || currentImageUiModel(nextModelVariant)?.default_quality || "auto";
  }
  if ($("#imageBackground")) {
    $("#imageBackground").value = params.background || currentImageUiModel(nextModelVariant)?.default_background || "auto";
  }
  if ($("#imageModeration")) {
    $("#imageModeration").value = params.moderation || currentImageUiModel(nextModelVariant)?.default_moderation || "auto";
  }
  if ($("#imageOutputCompression")) {
    $("#imageOutputCompression").value = String(params.output_compression ?? currentImageUiModel(nextModelVariant)?.default_output_compression ?? 100);
  }
  $("#imageWebSearch").checked = Boolean(params.enable_web_search);
  syncImageModelOptions(params.aspect_ratio, params.size, {
    preferredMode: params.image_mode || deriveImageModeFromParams(params),
    showModeFallbackToast: Boolean(params.image_mode),
    showAspectRatioFallbackToast: Boolean(params.aspect_ratio),
    showSizeFallbackToast: Boolean(params.size),
    showSequentialFallbackToast: Boolean(params.sequential_mode),
  });
  syncImageMode();
}

function applyVideoDefaults(params = {}) {
  $("#modelVariant").value = params.model_variant || config.models?.[0]?.value || "seedance_2_0";
  syncVideoModelOptions({
    preferredScene: params.scene_type || "text_only",
    preferredResolution: params.resolution_grade || "720p",
    preferredRatio: params.ratio || "adaptive",
    preferredDuration: String(params.duration || 5),
  });
  $("#videoSeed").value = params.seed ?? -1;
  $("#videoGenerateAudio").checked = params.generate_audio !== false;
  if ($("#videoWebSearch")) {
    $("#videoWebSearch").checked = Boolean(params.enable_web_search);
  }
  syncVideoScene();
}

function trustedAssetUriLines() {
  if (kind !== "video") {
    return [];
  }
  return String($("#trustedAssetUris")?.value || "")
    .split("\n")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function currentVideoPricingHint() {
  const modelVariant = $("#modelVariant")?.value || config.models?.[0]?.value || "";
  return (config.ui?.models || []).find((item) => item.value === modelVariant)?.pricing_hint
    || config.ui?.pricing_hint
    || {};
}

function syncVideoPricingHint() {
  if (kind !== "video") {
    return;
  }
  const host = $("#videoPricingHintSummary");
  if (!host) {
    return;
  }
  const hint = currentVideoPricingHint();
  const resolution = $("#videoResolution")?.value || "720p";
  const duration = $("#videoDuration")?.value || "5";
  const audio = $("#videoGenerateAudio")?.checked;
  const trustedCount = trustedAssetUriLines().length;
  const dimensions = [
    `模型：${$("#modelVariant")?.selectedOptions?.[0]?.textContent || ($("#modelVariant")?.value || "-")}`,
    `分辨率：${resolution}`,
    `时长：${duration} 秒`,
    `音频：${audio ? "开启" : "关闭"}`,
  ];
  if (trustedCount) {
    dimensions.push(`可信素材：${trustedCount} 项`);
  }
  const summary = [];
  if (hint?.summary) {
    summary.push(String(hint.summary));
  }
  if (Array.isArray(hint?.dimensions) && hint.dimensions.length) {
    summary.push(`计费维度：${hint.dimensions.join("、")}`);
  }
  summary.push(dimensions.join(" ｜ "));
  host.textContent = summary.join("。");
}

function syncVideoWebSearch() {
  if (kind !== "video") {
    return;
  }
  const field = $("#videoWebSearchField");
  const input = $("#videoWebSearch");
  if (!field || !input) {
    return;
  }
  const supported = Boolean(currentVideoUiModel()?.supports_web_search) && currentVideoScene() === "text_only";
  field.style.display = supported ? "" : "none";
  if (!supported) {
    input.checked = false;
  }
}

function currentVideoUiModel(modelVariant = $("#modelVariant")?.value || config.models?.[0]?.value || "") {
  return (config.ui?.models || []).find((item) => item.value === modelVariant) || null;
}

function videoSceneOptionsForModel(modelVariant = $("#modelVariant")?.value || config.models?.[0]?.value || "") {
  const model = currentVideoUiModel(modelVariant);
  if (Array.isArray(model?.scenes) && model.scenes.length) {
    return model.scenes;
  }
  const supported = model?.supported_scenes || null;
  return (config.ui?.scenes || []).filter((item) => (
    !Array.isArray(supported) || !supported.length || supported.includes(item.value)
  ));
}

function videoSceneLabelForModel(sceneKey, modelVariant) {
  const normalizedKey = String(sceneKey || "").trim() || "text_only";
  const model = currentVideoUiModel(modelVariant);
  const scene = (model?.scenes || []).find((item) => item.value === normalizedKey);
  return scene?.label
    || model?.scene_labels?.[normalizedKey]
    || videoModeLabels[normalizedKey]
    || normalizedKey;
}

function syncVideoSelectOptions(select, options, preferredValue, fallbackValue, emptyLabel) {
  if (!select) {
    return fallbackValue || "";
  }
  const normalizedOptions = (Array.isArray(options) ? options : [])
    .map((item) => ({
      value: String(item?.value || item || "").trim(),
      label: String(item?.label || item?.value || item || "").trim(),
    }))
    .filter((item) => item.value);
  select.innerHTML = "";
  for (const item of normalizedOptions) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label || item.value;
    select.appendChild(option);
  }
  if (!normalizedOptions.length) {
    const option = document.createElement("option");
    option.value = fallbackValue || "";
    option.textContent = emptyLabel || fallbackValue || "-";
    select.appendChild(option);
    return option.value;
  }
  const requestedValue = String(preferredValue || select.value || fallbackValue || normalizedOptions[0].value).trim();
  const values = normalizedOptions.map((item) => item.value);
  const nextValue = values.includes(requestedValue)
    ? requestedValue
    : (values.includes(fallbackValue) ? fallbackValue : normalizedOptions[0].value);
  select.value = nextValue;
  return nextValue;
}

function supportedVideoScenes(modelVariant = $("#modelVariant")?.value || config.models?.[0]?.value || "") {
  return videoSceneOptionsForModel(modelVariant);
}

function supportedVideoResolutions(scene = currentVideoScene(), modelVariant = $("#modelVariant")?.value || config.models?.[0]?.value || "") {
  const sceneValue = String(scene || "text_only").trim() || "text_only";
  const supportedModelResolutions = currentVideoUiModel(modelVariant)?.supported_resolutions || null;
  return (config.ui.resolutions || []).filter((item) => {
    const supportedScenes = Array.isArray(item.supported_scenes) && item.supported_scenes.length
      ? item.supported_scenes
      : null;
    const supportsScene = !supportedScenes || supportedScenes.includes(sceneValue);
    const supportsModel = !Array.isArray(supportedModelResolutions)
      || !supportedModelResolutions.length
      || supportedModelResolutions.includes(item.value);
    return supportsScene && supportsModel;
  });
}

function supportedVideoRatios(modelVariant = $("#modelVariant")?.value || config.models?.[0]?.value || "") {
  const supported = currentVideoUiModel(modelVariant)?.supported_ratios || null;
  return (config.ui?.ratios || []).filter((item) => (
    !Array.isArray(supported) || !supported.length || supported.includes(item.value)
  ));
}

function supportedVideoDurations(
  modelVariant = $("#modelVariant")?.value || config.models?.[0]?.value || "",
  scene = currentVideoScene(),
  resolution = $("#videoResolution")?.value || "",
) {
  const model = currentVideoUiModel(modelVariant) || {};
  const supported = (model.supported_durations || []).map((item) => String(item));
  let options = (config.ui?.durations || []).filter((item) => (
    !supported.length || supported.includes(String(item.value))
  ));
  if (model.provider === "google" && (["1080p", "4k"].includes(resolution) || ["first_last", "multimodal_reference"].includes(scene))) {
    options = options.filter((item) => String(item.value) === "8");
  }
  return options;
}

function syncVideoSceneOptions(preferredScene = null, { showFallbackToast = false } = {}) {
  if (kind !== "video") {
    return currentVideoScene();
  }
  const select = $("#videoSceneType");
  const requestedValue = preferredScene || select?.value || "text_only";
  const nextValue = syncVideoSelectOptions(select, supportedVideoScenes(), requestedValue, "text_only", "文生视频");
  if (showFallbackToast && requestedValue !== nextValue) {
    showToast("当前模型不支持该生成方式，已自动切换");
  }
  return nextValue;
}

function syncVideoResolutionOptions(scene = currentVideoScene(), preferredResolution = null, { showFallbackToast = false } = {}) {
  if (kind !== "video") {
    return;
  }
  const select = $("#videoResolution");
  if (!select) {
    return;
  }
  const options = supportedVideoResolutions(scene);
  const previousValue = select.value;
  const requestedValue = preferredResolution || previousValue || "720p";
  select.innerHTML = "";
  const availableValues = [];
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label || item.value;
    select.appendChild(option);
    availableValues.push(item.value);
  }
  if (!availableValues.length) {
    const option = document.createElement("option");
    option.value = "720p";
    option.textContent = "720p";
    select.appendChild(option);
    availableValues.push("720p");
  }
  const fallbackValue = availableValues.includes("720p") ? "720p" : availableValues[0];
  const nextValue = availableValues.includes(requestedValue) ? requestedValue : fallbackValue;
  select.value = nextValue;
  if (showFallbackToast && requestedValue !== nextValue) {
    showToast("当前场景不支持所选分辨率，已自动切换");
  }
}

function syncVideoRatioOptions(preferredRatio = null, { showFallbackToast = false } = {}) {
  if (kind !== "video") {
    return;
  }
  const select = $("#videoRatio");
  const requestedValue = preferredRatio || select?.value || "adaptive";
  const options = supportedVideoRatios();
  const fallbackValue = options.some((item) => item.value === "adaptive") ? "adaptive" : (options[0]?.value || "16:9");
  const nextValue = syncVideoSelectOptions(select, options, requestedValue, fallbackValue, "16:9");
  if (showFallbackToast && requestedValue !== nextValue) {
    showToast("当前模型不支持该画幅，已自动切换");
  }
}

function syncVideoDurationOptions(preferredDuration = null, { showFallbackToast = false } = {}) {
  if (kind !== "video") {
    return;
  }
  const select = $("#videoDuration");
  const requestedValue = String(preferredDuration || select?.value || "5");
  const options = supportedVideoDurations(undefined, currentVideoScene(), $("#videoResolution")?.value || "");
  const fallbackValue = options.some((item) => String(item.value) === "5") ? "5" : String(options[0]?.value || "8");
  const nextValue = syncVideoSelectOptions(select, options, requestedValue, fallbackValue, "8 秒");
  if (showFallbackToast && requestedValue !== nextValue) {
    showToast("当前模型不支持该时长，已自动切换");
  }
}

function syncVideoModelOptions({
  preferredScene = null,
  preferredResolution = null,
  preferredRatio = null,
  preferredDuration = null,
  showFallbackToast = false,
} = {}) {
  if (kind !== "video") {
    return;
  }
  const nextScene = syncVideoSceneOptions(preferredScene, { showFallbackToast });
  syncVideoResolutionOptions(nextScene, preferredResolution, { showFallbackToast });
  syncVideoRatioOptions(preferredRatio, { showFallbackToast });
  syncVideoDurationOptions(preferredDuration, { showFallbackToast });
}

function syncImageModelOptions(
  preferredAspectRatio = null,
  preferredSize = null,
  {
    preferredMode = null,
    showModeFallbackToast = false,
    showAspectRatioFallbackToast = false,
    showSizeFallbackToast = false,
    showSequentialFallbackToast = false,
  } = {},
) {
  if (kind !== "image") {
    return;
  }
  const model = $("#modelVariant").value;
  const uiModel = currentImageUiModel(model);
  if (!uiModel) {
    return;
  }
  const requestedMode = preferredMode || $("#imageMode").value || uiModel.default_mode || "text_only";
  const nextMode = ensureImageModeOptions(requestedMode);
  if (showModeFallbackToast && requestedMode && requestedMode !== nextMode) {
    showToast("当前模型不支持该模式，已自动切换");
  }
  const aspectSelect = $("#imageAspectRatio");
  const sizeSelect = $("#imageSize");
  const ratioEntries = Array.isArray(uiModel.aspect_ratios) && uiModel.aspect_ratios.length
    ? uiModel.aspect_ratios.map((item) => (
      typeof item === "string"
        ? { value: item, label: item }
        : { value: item.value, label: item.label || item.value }
    ))
    : Object.keys(uiModel.size_options_by_ratio || {}).map((value) => ({ value, label: value }));
  const ratioLookup = new Map(ratioEntries.map((item) => [item.value, item]));
  const sizeOptionsByRatio = uiModel.size_options_by_ratio || {};
  const fallbackAspectRatio = uiModel.default_aspect_ratio || ratioEntries[0]?.value || "";
  let nextAspectRatio = preferredAspectRatio || aspectSelect.value || fallbackAspectRatio;
  aspectSelect.innerHTML = "";
  for (const item of ratioEntries) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    aspectSelect.appendChild(option);
  }
  if (!ratioLookup.has(nextAspectRatio) && ratioEntries[0]) {
    nextAspectRatio = fallbackAspectRatio || ratioEntries[0].value;
  }
  if (showAspectRatioFallbackToast && preferredAspectRatio && preferredAspectRatio !== nextAspectRatio) {
    showToast("当前模型不支持该比例，已自动切换");
  }
  aspectSelect.value = nextAspectRatio || "";

  const sizeOptions = sizeOptionsByRatio[aspectSelect.value] || uiModel.size_options || [];
  const fallbackSize = uiModel.default_size || sizeOptions[0]?.value || "";
  const requestedSize = preferredSize || sizeSelect.value || fallbackSize;
  sizeSelect.innerHTML = "";
  const values = [];
  for (const item of sizeOptions) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    sizeSelect.appendChild(option);
    values.push(item.value);
  }
  if (!values.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "暂无可用尺寸";
    sizeSelect.appendChild(empty);
  }
  const nextValue = values.includes(requestedSize) ? requestedSize : (values.includes(fallbackSize) ? fallbackSize : (values[0] || ""));
  sizeSelect.value = nextValue;
  if (showSizeFallbackToast && requestedSize && requestedSize !== nextValue) {
    showToast("当前模型不支持该尺寸，已自动切换");
  }

  const syncSelectOptions = (select, options, fallbackValue) => {
    if (!select) {
      return fallbackValue || "";
    }
    const requestedValue = select.value || fallbackValue || "";
    const normalizedOptions = (Array.isArray(options) ? options : [])
      .map((item) => ({
        value: String(item?.value || item || "").trim(),
        label: String(item?.label || item?.value || item || "").trim(),
      }))
      .filter((item) => item.value);
    select.innerHTML = "";
    for (const item of normalizedOptions) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label || item.value;
      select.appendChild(option);
    }
    const values = normalizedOptions.map((item) => item.value);
    const nextSelected = values.includes(requestedValue)
      ? requestedValue
      : (values.includes(fallbackValue) ? fallbackValue : (values[0] || ""));
    if (nextSelected) {
      select.value = nextSelected;
    }
    return nextSelected;
  };
  const outputFormat = syncSelectOptions(
    $("#imageOutputFormat"),
    uiModel.output_formats || config.ui?.output_formats || [],
    uiModel.default_output_format || "jpeg",
  );
  syncSelectOptions($("#imageQuality"), uiModel.quality_options || [], uiModel.default_quality || "auto");
  syncSelectOptions($("#imageBackground"), uiModel.background_options || [], uiModel.default_background || "auto");
  syncSelectOptions($("#imageModeration"), uiModel.moderation_options || [], uiModel.default_moderation || "auto");
  $("#imageOutputField").style.display = uiModel.supports_output_format ? "" : "none";
  $("#imageQualityField").style.display = uiModel.supports_quality ? "" : "none";
  $("#imageBackgroundField").style.display = uiModel.supports_background ? "" : "none";
  $("#imageModerationField").style.display = uiModel.supports_moderation ? "" : "none";
  $("#imageCompressionField").style.display = (
    uiModel.supports_output_compression && ["jpeg", "webp"].includes(outputFormat)
  ) ? "" : "none";
  $("#imageWebSearchField").style.display = uiModel.supports_web_search ? "" : "none";
  $("#imageSequential").closest(".field")?.style.setProperty("display", uiModel.supports_sequential_generation ? "" : "none");
  if (!uiModel.supports_output_format) {
    $("#imageOutputFormat").value = uiModel.default_output_format || "jpeg";
  }
  if (!uiModel.supports_quality && $("#imageQuality")) {
    $("#imageQuality").value = uiModel.default_quality || "auto";
  }
  if (!uiModel.supports_background && $("#imageBackground")) {
    $("#imageBackground").value = uiModel.default_background || "auto";
  }
  if (!uiModel.supports_moderation && $("#imageModeration")) {
    $("#imageModeration").value = uiModel.default_moderation || "auto";
  }
  if (!uiModel.supports_web_search) {
    $("#imageWebSearch").checked = false;
  }
  if (!uiModel.supports_sequential_generation && $("#imageSequential").checked) {
    $("#imageSequential").checked = false;
    if (showSequentialFallbackToast) {
      showToast("当前模型不支持组图，已自动关闭");
    }
  }
}

function syncImageMode({ skipRender = false } = {}) {
  if (kind !== "image") {
    return;
  }
  const mode = currentImageMode();
  normalizeGoogleImageAssets(mode);
  const isUnifiedInputModel = isUnifiedImageInputModel();
  const editorColumn = document.querySelector(".editor-column");
  const referencePane = $("#referencePane");
  const imageReferenceGrid = $("#imageReferenceGrid");
  const primaryGroup = $("#imagePrimaryGroup");
  const referenceGroup = $("#imageReferenceGroup");
  const primaryLabel = primaryGroup?.querySelector(".asset-label");
  const referenceLabel = referenceGroup?.querySelector(".asset-label");
  const primaryDropzone = $("#imagePrimaryDropzone");
  const referenceDropzone = $("#imageReferenceDropzone");
  const showTextOnly = mode === "text_only";
  const showPrimary = isUnifiedInputModel ? mode === "image_edit" : (mode === "base_only" || mode === "multi_image");
  const showReference = isUnifiedInputModel ? mode === "multi_image" : (mode === "reference_only" || mode === "multi_image");
  if (editorColumn) {
    editorColumn.classList.toggle("is-text-only", showTextOnly);
  }
  if (referencePane) {
    referencePane.classList.toggle("is-hidden", showTextOnly);
  }
  if (primaryGroup) {
    primaryGroup.style.display = showPrimary ? "" : "none";
  }
  if (referenceGroup) {
    referenceGroup.style.display = showReference ? "" : "none";
  }
  if (imageReferenceGrid) {
    imageReferenceGrid.classList.toggle("is-single-column", showPrimary !== showReference);
  }
  if (primaryLabel) {
    primaryLabel.textContent = isUnifiedInputModel ? "编辑图" : "基础图";
  }
  if (referenceLabel) {
    referenceLabel.textContent = isUnifiedInputModel ? "合成素材" : "参考图";
  }
  if (primaryDropzone) {
    primaryDropzone.textContent = isUnifiedInputModel
      ? "点击、拖拽或粘贴编辑图"
      : "点击、拖拽或粘贴图片";
  }
  if (referenceDropzone) {
    referenceDropzone.textContent = isUnifiedInputModel
      ? "点击、拖拽或粘贴多张图片"
      : "点击、拖拽或粘贴图片";
  }
  syncPromptPlaceholder(mode);
  if (!isMentionEnabled(mode)) {
    maybeShowMentionIssue(null);
    hideMentionMenu();
  }
  if (!skipRender) {
    renderAllAssetLists();
  }
}

function videoReferenceUrlsHaveValue() {
  if (kind !== "video") {
    return false;
  }
  return Boolean(
    String($("#videoReferenceUrls")?.value || "").trim()
    || String($("#audioReferenceUrls")?.value || "").trim()
    || String($("#trustedAssetUris")?.value || "").trim(),
  );
}

function applyVideoReferenceOptionsState(open) {
  const toggle = $("#videoReferenceOptionsToggle");
  const panel = $("#videoReferenceOptionsPanel");
  if (!toggle || !panel) {
    return;
  }
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  panel.hidden = !open;
}

function setVideoReferenceOptionsOpen(open, { userInitiated = false } = {}) {
  state.videoReferenceOptionsOpen = Boolean(open);
  if (userInitiated) {
    state.videoReferenceOptionsUserToggled = true;
  }
  applyVideoReferenceOptionsState(state.videoReferenceOptionsOpen);
}

function syncVideoReferenceOptions({ autoOpen = false, resetUserChoice = false } = {}) {
  if (kind !== "video") {
    return;
  }
  const wrapper = $("#videoReferenceOptions");
  if (!wrapper) {
    return;
  }
  const showReference = currentVideoScene() === "multimodal_reference";
  wrapper.style.display = showReference ? "" : "none";
  if (!showReference) {
    applyVideoReferenceOptionsState(false);
    return;
  }
  if (resetUserChoice) {
    state.videoReferenceOptionsUserToggled = false;
  }
  let shouldOpen = state.videoReferenceOptionsOpen;
  if (autoOpen && !state.videoReferenceOptionsUserToggled) {
    shouldOpen = true;
  }
  state.videoReferenceOptionsOpen = Boolean(shouldOpen);
  applyVideoReferenceOptionsState(state.videoReferenceOptionsOpen);
}

function syncVideoScene({ skipRender = false, showResolutionFallbackToast = false } = {}) {
  if (kind !== "video") {
    return;
  }
  const scene = syncVideoSceneOptions($("#videoSceneType").value);
  syncVideoResolutionOptions(scene, $("#videoResolution").value, {
    showFallbackToast: showResolutionFallbackToast,
  });
  syncVideoRatioOptions($("#videoRatio")?.value);
  syncVideoDurationOptions($("#videoDuration")?.value);
  const editorColumn = document.querySelector(".editor-column");
  const referencePane = $("#referencePane");
  const emptyState = $("#referenceEmptyState");
  const showTextOnly = scene === "text_only";
  const showFirstFrame = scene === "first_frame" || scene === "first_last";
  const showFirstLast = scene === "first_last";
  const showReference = scene === "multimodal_reference";
  $("#videoFrameGroup").style.display = showFirstFrame ? "" : "none";
  $("#videoLastGroup").style.display = scene === "first_last" ? "" : "none";
  $("#videoReferenceGroup").style.display = showReference ? "" : "none";
  syncVideoReferenceOptions({
    autoOpen: videoReferenceUrlsHaveValue(),
  });
  syncVideoWebSearch();
  syncVideoPricingHint();
  if (editorColumn) {
    editorColumn.classList.toggle("is-text-only", showTextOnly);
  }
  if (referencePane && emptyState) {
    referencePane.classList.toggle("is-hidden", showTextOnly);
    referencePane.classList.toggle("is-first-last", showFirstLast);
    referencePane.classList.remove("is-empty");
    emptyState.classList.add("is-hidden");
  }
  syncPromptPlaceholder(scene);
  if (!isMentionEnabled(scene)) {
    maybeShowMentionIssue(null);
    hideMentionMenu();
  }
  if (!skipRender) {
    renderAllAssetLists();
  }
}

function extractPromptLabels(prompt) {
  return scanPromptMentions(prompt, currentPromptMentionLookup()).mentions;
}

function buildAssetAnnotations() {
  const labelMap = deriveAssetLabels();
  return getActiveImageAssets()
    .map((asset) => labelMap.get(asset.id))
    .filter(Boolean)
    .map((item) => ({
      asset_id: item.asset_id,
      tag_category: item.tag_category,
      tag_sequence: item.tag_sequence,
      mention_name: item.mention_name,
    }));
}

function validateCurrentRequest(params) {
  const mentionLookup = currentPromptMentionLookup();
  const mentionScan = scanPromptMentions(params.prompt || "", mentionLookup);
  const mentions = mentionScan.mentions;
  if (kind === "image") {
    const mode = currentImageMode();
    const isUnifiedInputModel = isUnifiedImageInputModel();
    if (!isMentionEnabled(mode) && (mentions.length || mentionScan.unknown.length)) {
      throw new Error("当前模式不支持 @ 引用素材");
    }
    if (isUnifiedInputModel) {
      const imageCount = (params.input_asset_id ? 1 : 0) + params.reference_asset_ids.length;
      const maxInputImages = currentImageMaxInputImages(params.model_variant);
      if (mode === "image_edit" && imageCount < 1) {
        throw new Error("图像编辑模式需要上传 1 张编辑图");
      }
      if (mode === "multi_image" && params.reference_asset_ids.length < 2) {
        throw new Error("多图合成至少需要 2 张素材图");
      }
      if (mode === "multi_image" && imageCount > maxInputImages) {
        throw new Error(`多图合成最多支持 ${maxInputImages} 张素材图`);
      }
    }
    if (mode === "base_only" && !params.input_asset_id) {
      throw new Error("基础图模式需要上传基础图");
    }
    if (mode === "reference_only" && !params.reference_asset_ids.length) {
      throw new Error("参考图模式至少需要 1 张参考图");
    }
    if (
      mode === "multi_image"
      && !(
        (params.input_asset_id && params.reference_asset_ids.length)
        || params.reference_asset_ids.length > 1
      )
    ) {
      throw new Error("多图融合需要基础图 + 参考图，或至少 2 张参考图");
    }
  }
  if (kind === "video" && params.scene_type !== "multimodal_reference" && (mentions.length || mentionScan.unknown.length)) {
    throw new Error("当前模式不支持 @ 引用素材");
  }
  const labelSet = new Set();
  for (const item of deriveAssetLabels().values()) {
    labelSet.add(item.tag_label);
    if (item.mention_name) {
      labelSet.add(item.mention_name);
    }
  }
  const unknown = mentionScan.unknown.length
    ? mentionScan.unknown
    : mentions.filter((label) => !labelSet.has(label));
  if (unknown.length) {
    throw new Error(`存在无效图片标签引用: ${Array.from(new Set(unknown)).join(", ")}`);
  }
}

function currentParams() {
  normalizeAssetState();
  if (kind === "image") {
    const mode = currentImageMode();
    normalizeGoogleImageAssets(mode);
    normalizeAssetState();
    const inputAssetId = state.assets.imagePrimary?.id || null;
    const referenceAssetIds = dedupeAssetsById(state.assets.imageReferences).map((item) => item.id);
    const isUnifiedInputModel = isUnifiedImageInputModel();
    return {
      model_variant: $("#modelVariant").value,
      prompt: $("#promptInput").value.trim(),
      aspect_ratio: $("#imageAspectRatio").value,
      size: $("#imageSize").value,
      count: Number($("#imageCount").value || 1),
      sequential_mode: $("#imageSequential").checked,
      output_format: $("#imageOutputFormat").value,
      quality: $("#imageQuality")?.value || "auto",
      background: $("#imageBackground")?.value || "auto",
      moderation: $("#imageModeration")?.value || "auto",
      output_compression: Number($("#imageOutputCompression")?.value || 100),
      enable_web_search: $("#imageWebSearch").checked,
      input_asset_id: isUnifiedInputModel
        ? (mode === "image_edit" ? inputAssetId : null)
        : (mode === "base_only" || mode === "multi_image" ? inputAssetId : null),
      reference_asset_ids: isUnifiedInputModel
        ? (mode === "multi_image" ? referenceAssetIds : [])
        : (mode === "reference_only" || mode === "multi_image" ? referenceAssetIds : []),
      asset_annotations: buildAssetAnnotations(),
    };
  }

  const textToLines = (value) => value.split("\n").map((item) => item.trim()).filter(Boolean);
  return {
    model_variant: $("#modelVariant").value,
    prompt: $("#promptInput").value.trim(),
    scene_type: $("#videoSceneType").value,
    resolution_grade: $("#videoResolution").value,
    ratio: $("#videoRatio").value,
    duration: Number($("#videoDuration").value || 5),
    seed: Number($("#videoSeed").value || -1),
    generate_audio: $("#videoGenerateAudio").checked,
    enable_web_search: $("#videoWebSearch")?.checked || false,
    first_frame_asset_id: state.assets.videoFirst?.id || null,
    last_frame_asset_id: state.assets.videoLast?.id || null,
    reference_image_asset_ids: dedupeAssetsById(state.assets.videoReferences).map((item) => item.id),
    reference_video_urls: textToLines($("#videoReferenceUrls").value),
    reference_audio_urls: textToLines($("#audioReferenceUrls").value),
    trusted_asset_uris: trustedAssetUriLines(),
    asset_annotations: buildAssetAnnotations(),
  };
}

function ensurePreviewObserver() {
  if (state.previewObserver || typeof IntersectionObserver === "undefined") {
    return;
  }
  state.previewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target;
        if (!(video instanceof HTMLVideoElement)) {
          continue;
        }
        if (entry.isIntersecting && !document.hidden) {
          if (!video.src && video.dataset.src) {
            video.src = video.dataset.src;
          }
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
          }
        } else {
          video.pause();
        }
      }
    },
    { rootMargin: "160px 0px", threshold: 0.2 },
  );
}

function createQuietVideoPreview(videoUrl, altText) {
  const video = document.createElement("video");
  video.className = "record-card-media";
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.dataset.previewKind = "quiet";
  video.setAttribute("aria-label", altText);
  const settleFrame = () => {
    try {
      if (video.duration && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(0.05, video.duration);
      } else {
        video.currentTime = 0.001;
      }
    } catch (_error) {
      video.pause();
    }
  };
  video.addEventListener("loadedmetadata", settleFrame, { once: true });
  video.addEventListener("seeked", () => video.pause(), { once: true });
  video.addEventListener("loadeddata", () => video.pause(), { once: true });
  return video;
}

function createPreviewImage(src, altText) {
  const image = document.createElement("img");
  image.className = "record-card-media";
  image.alt = altText;
  image.src = src;
  image.loading = "lazy";
  image.decoding = "async";
  return image;
}

function getRecordPrimaryArtifact(record) {
  const artifacts = record.result_payload?.artifacts || [];
  return artifacts[0] || null;
}

function buildPreviewKey(record) {
  const first = getRecordPrimaryArtifact(record);
  if (!first) {
    return "empty";
  }
  if (first.kind === "video") {
    const thumbUrl = String(first.thumbnail_url || "").trim();
    const videoUrl = first.public_url || first.source_url || "";
    const useAnimatedPreview = kind === "video" && state.videoPreviewQuiet && record.status === "succeeded";
    if (useAnimatedPreview && videoUrl) {
      return `video-lazy:${videoUrl}`;
    }
    if (thumbUrl) {
      return `video-thumb:${thumbUrl}`;
    }
    return `video-static:${videoUrl || record.id}`;
  }
  return `image:${first.thumbnail_url || first.public_url || first.source_url || ""}`;
}

function buildRecordCardMeta(record) {
  const mode = record.kind === "video" ? recordVideoMode(record) : recordImageMode(record);
  return {
    recordId: record.id || "",
    previewKey: buildPreviewKey(record),
    status: record.status,
    modeKey: mode?.key || "",
    modeLabel: mode?.label || "",
    elapsedLabel: cardElapsedLabel(record),
    modelVariant: record.model_variant || "",
    message: record.message || "",
    errorMessage: record.error_message || "",
    createdAt: record.created_at || "",
    isLive: Boolean(record.is_live),
    canDelete: canDeleteRecord(record),
  };
}

function recordCardMetaEqual(previous, next) {
  if (!previous || !next) {
    return false;
  }
  const keys = Object.keys(next);
  if (Object.keys(previous).length !== keys.length) {
    return false;
  }
  return keys.every((key) => previous[key] === next[key]);
}

function requestRecordCardPreviewRefresh(recordId) {
  const card = state.recordCardNodes.get(recordId);
  const record = state.historyLookup.get(recordId);
  if (!card || !record) {
    return;
  }
  const refs = card.__recordRefs;
  if (!refs?.previewSlot) {
    return;
  }
  const previousMeta = card.__recordMeta || null;
  syncPreviewSlot(refs.previewSlot, record, previousMeta?.previewKey || "");
  card.__recordMeta = buildRecordCardMeta(record);
}

function captureQuietPoster(recordId, videoUrl) {
  if (!videoUrl || state.quietPosterCache.has(recordId) || state.quietPosterPending.has(recordId)) {
    return;
  }
  const task = new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    let timeoutHandle = null;
    const cleanup = () => {
      if (timeoutHandle) {
        window.clearTimeout(timeoutHandle);
      }
      video.pause();
      video.removeAttribute("src");
      try {
        video.load();
      } catch (_error) {
        // ignore cleanup failures
      }
    };
    const finish = (posterUrl) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      state.quietPosterPending.delete(recordId);
      if (posterUrl) {
        state.quietPosterCache.set(recordId, posterUrl);
        requestRecordCardPreviewRefresh(recordId);
      }
      resolve(posterUrl);
    };
    const captureFrame = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        finish(null);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          finish(null);
          return;
        }
        context.drawImage(video, 0, 0, width, height);
        finish(canvas.toDataURL("image/jpeg", 0.82));
      } catch (_error) {
        finish(null);
      }
    };
    const settleFrame = () => {
      try {
        if (video.duration && Number.isFinite(video.duration)) {
          video.currentTime = Math.min(0.05, Math.max(video.duration - 0.001, 0));
        } else {
          video.currentTime = 0.001;
        }
      } catch (_error) {
        captureFrame();
      }
    };
    timeoutHandle = window.setTimeout(() => finish(null), 5000);
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", settleFrame, { once: true });
    video.addEventListener("seeked", captureFrame, { once: true });
    video.addEventListener("loadeddata", captureFrame, { once: true });
    video.addEventListener("error", () => finish(null), { once: true });
    video.src = videoUrl;
  });
  state.quietPosterPending.set(recordId, task);
}

function mediaPreview(record) {
  const first = getRecordPrimaryArtifact(record);
  if (!first) {
    return null;
  }
  if (first.kind === "video") {
    const thumbUrl = String(first.thumbnail_url || "").trim();
    const videoUrl = first.public_url || first.source_url;
    const altText = record.prompt || record.model_variant || "video";
    const useAnimatedPreview = kind === "video" && state.videoPreviewQuiet && record.status === "succeeded";
    if (useAnimatedPreview && videoUrl) {
      const video = document.createElement("video");
      video.className = "record-card-media";
      video.dataset.src = videoUrl;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "none";
      video.dataset.previewKind = "lazy";
      return video;
    }
    if (thumbUrl) {
      return createPreviewImage(thumbUrl, altText);
    }
    if (videoUrl) {
      return createQuietVideoPreview(videoUrl, altText);
    }
    return createElement("div", "record-card-placeholder", "视频预览");
  }
  return createPreviewImage(
    first.thumbnail_url || first.public_url || first.source_url,
    record.prompt || record.model_variant || "record",
  );
}

function recordStatusText(record) {
  return statusLabels[record.status] || record.status || "未知";
}

function recordVideoMode(record) {
  if (record.kind !== "video") {
    return null;
  }
  const modeKey = String(record.params_requested?.scene_type || "text_only").trim() || "text_only";
  const modelVariant = String(record.model_variant || record.params_requested?.model_variant || "").trim();
  return {
    key: modeKey,
    label: videoSceneLabelForModel(modeKey, modelVariant),
  };
}

function recordImageMode(record) {
  if (record.kind !== "image") {
    return null;
  }
  const modeKey = normalizeModeKey(record) || classifyImageMode({
    inputAssetId: record.params_requested?.input_asset_id,
    referenceAssetIds: record.params_requested?.reference_asset_ids,
    modelVariant: record.model_variant,
  });
  const configuredLabel = (config.ui?.models || [])
    .find((item) => item.value === record.model_variant)
    ?.modes?.find((item) => item.value === modeKey)
    ?.label;
  return {
    key: modeKey,
    label: configuredLabel || imageModeLabels[modeKey] || modeKey,
  };
}

function canDeleteRecord(record) {
  return getRecordCardAction(record?.status)?.action === "delete-record";
}

function canCancelRecord(record) {
  return getRecordCardAction(record?.status)?.action === "cancel-record";
}

function clearPreviewNodes(root) {
  if (!root) {
    return;
  }
  const previousVideos = root.querySelectorAll("video[data-preview-kind]");
  previousVideos.forEach((video) => {
    if (video.dataset.previewKind === "lazy") {
      state.previewObserver?.unobserve(video);
    }
    video.pause();
  });
}

function clearPreviewSlot(slot) {
  if (!slot) {
    return;
  }
  clearPreviewNodes(slot);
  delete slot.dataset.previewKey;
  slot.replaceChildren();
}

function syncPreviewSlot(slot, record, previousPreviewKey = "") {
  const nextPreviewKey = buildPreviewKey(record);
  const currentPreviewKey = previousPreviewKey || slot.dataset.previewKey || "";
  if (currentPreviewKey === nextPreviewKey && slot.childNodes.length) {
    slot.dataset.previewKey = nextPreviewKey;
    return;
  }
  clearPreviewSlot(slot);
  slot.dataset.previewKey = nextPreviewKey;
  const preview = mediaPreview(record);
  if (preview) {
    slot.appendChild(preview);
    if (preview instanceof HTMLVideoElement && preview.dataset.previewKind === "lazy") {
      ensurePreviewObserver();
      state.previewObserver?.observe(preview);
    }
    return;
  }
  slot.appendChild(createElement("div", "record-card-placeholder", recordStatusText(record)));
}

function updateRecordCard(card, record, previousMeta = null) {
  const refs = card.__recordRefs;
  if (!refs) {
    return;
  }
  const nextMeta = buildRecordCardMeta(record);
  if (recordCardMetaEqual(previousMeta, nextMeta)) {
    return;
  }
  card.classList.toggle("is-live", Boolean(record.is_live));
  syncPreviewSlot(refs.previewSlot, record, previousMeta?.previewKey || "");
  refs.statusChip.className = `record-status-chip is-${record.status}`;
  refs.statusChip.textContent = recordStatusText(record);
  refs.modeChip.hidden = !nextMeta.modeKey;
  if (nextMeta.modeKey) {
    refs.modeChip.className = `video-mode-chip is-${record.kind}-${nextMeta.modeKey}`;
    refs.modeChip.textContent = nextMeta.modeLabel;
  }
  const elapsedLabel = cardElapsedLabel(record);
  refs.elapsedPill.textContent = elapsedLabel;
  refs.elapsedPill.hidden = !elapsedLabel;
  const cardAction = getRecordCardAction(record.status);
  refs.actionButton.hidden = !cardAction;
  refs.actionButton.disabled = !cardAction || Boolean(cardAction.disabled);
  refs.actionButton.dataset.action = cardAction?.action || "";
  refs.actionButton.className = `record-action-button${cardAction?.className ? ` ${cardAction.className}` : ""}`;
  refs.actionButton.textContent = cardAction?.label || "";
  refs.modelNode.textContent = record.model_variant || (kind === "image" ? "图片任务" : "视频任务");
  refs.timeNode.textContent = formatDate(record.created_at);
  refs.messageNode.className = "record-card-message";
  refs.messageNode.textContent = "";
  refs.messageNode.hidden = true;
  if (record.error_message) {
    refs.messageNode.classList.add("is-error");
    refs.messageNode.textContent = record.error_message;
    refs.messageNode.hidden = false;
  } else if (record.message) {
    refs.messageNode.textContent = record.message;
    refs.messageNode.hidden = false;
  }
  card.__recordMeta = nextMeta;
}

function createRecordCard(record = null) {
  const card = createElement("article", "record-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");

  const previewWrap = createElement("div", "record-card-preview");
  const previewSlot = createElement("div", "record-card-preview-slot");
  const statusChip = createElement("span", "record-status-chip");
  const modeChip = createElement("span", "video-mode-chip");
  modeChip.hidden = true;
  const elapsedPill = createElement("span", "elapsed-pill");
  const deleteButton = createElement("button", "record-delete-button", "删除");
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-record";
  previewWrap.append(previewSlot);

  const body = createElement("div", "record-card-body");
  const topMetaRow = createElement("div", "record-top-meta-row");
  topMetaRow.append(statusChip, modeChip, deleteButton);
  const modelRow = createElement("div", "record-card-model-row");
  const modelNode = createElement("div", "record-card-model");
  modelRow.append(modelNode, elapsedPill);
  const timeNode = createElement("div", "record-card-time");
  const messageNode = createElement("div", "record-card-message");
  body.append(topMetaRow, modelRow, timeNode, messageNode);

  card.append(previewWrap, body);
  card.__recordRefs = {
    previewSlot,
    statusChip,
    modeChip,
    elapsedPill,
    deleteButton,
    modelNode,
    timeNode,
    messageNode,
    topMetaRow,
    modelRow,
  };
  if (record) {
    card.dataset.historyId = record.id;
    updateRecordCard(card, record, null);
  }
  return card;
}

function removeRecordCardNode(historyId) {
  const card = state.recordCardNodes.get(historyId);
  if (!card) {
    return;
  }
  clearPreviewNodes(card);
  card.remove();
  state.recordCardNodes.delete(historyId);
}

function clearRecordCardNodes() {
  for (const card of state.recordCardPool) {
    clearPreviewNodes(card);
    card.remove();
  }
  state.recordCardPool = [];
  state.recordCardNodes = new Map();
}

function ensureRecordCardPoolSize(count) {
  const grid = $("#recordsGrid");
  if (!grid) {
    return;
  }
  while (state.recordCardPool.length < count) {
    const card = createRecordCard();
    state.recordCardPool.push(card);
    grid.appendChild(card);
  }
  while (state.recordCardPool.length > count) {
    const card = state.recordCardPool.pop();
    if (!card) {
      continue;
    }
    clearPreviewNodes(card);
    card.remove();
  }
}

function computeRecordViewport(records) {
  const stage = $("#recordsStage");
  const metrics = currentRecordCardMetrics();
  const rowHeight = recordRowHeight();
  const stageWidth = Math.max(stage?.clientWidth || 0, metrics.minWidth);
  const stageHeight = Math.max(stage?.clientHeight || rowHeight, rowHeight);
  const cacheKey = historyFilterKey();
  const sizeKey = currentRecordCardSize();
  let { columnCount, totalRows, visibleRows } = state.viewportCache;
  if (
    state.viewportCache.revision !== state.historyRevision
    || state.viewportCache.key !== cacheKey
    || state.viewportCache.size !== sizeKey
    || state.viewportCache.stageWidth !== stageWidth
    || state.viewportCache.stageHeight !== stageHeight
    || state.viewportCache.count !== records.length
    || state.viewportCache.rowHeight !== rowHeight
  ) {
    columnCount = Math.max(1, Math.floor((stageWidth + recordGridGap) / (metrics.minWidth + recordGridGap)));
    totalRows = Math.max(1, Math.ceil(records.length / columnCount));
    visibleRows = Math.max(1, Math.ceil(stageHeight / rowHeight));
    state.viewportCache = {
      revision: state.historyRevision,
      key: cacheKey,
      size: sizeKey,
      stageWidth,
      stageHeight,
      count: records.length,
      columnCount,
      visibleRows,
      totalRows,
      rowHeight,
    };
  }
  const startRow = Math.max(0, Math.floor((stage?.scrollTop || 0) / rowHeight) - recordOverscanRows);
  const endRow = Math.min(totalRows, startRow + visibleRows + recordOverscanRows * 2);
  const startIndex = startRow * columnCount;
  const endIndex = Math.min(records.length, endRow * columnCount);
  return {
    columnCount,
    startIndex,
    endIndex,
    topHeight: startRow * rowHeight,
    bottomHeight: Math.max(0, totalRows - endRow) * rowHeight,
  };
}

function renderRecordViewport() {
  const grid = $("#recordsGrid");
  const topSpacer = $("#recordsTopSpacer");
  const bottomSpacer = $("#recordsBottomSpacer");
  const records = filteredHistory();
  if (!records.length) {
    clearRecordCardNodes();
    if (topSpacer) {
      topSpacer.style.height = "0px";
    }
    if (bottomSpacer) {
      bottomSpacer.style.height = "0px";
    }
    const emptyMessage = hasHistoryFilters() ? "当前筛选条件下暂无任务记录" : "当前目录还没有任务记录。";
    const empty = createElement("div", "records-empty", emptyMessage);
    ensureRecordCardPoolSize(0);
    state.recordCardNodes = new Map();
    grid.replaceChildren(empty);
    return;
  }
  const viewport = computeRecordViewport(records);
  const visibleRecords = records.slice(viewport.startIndex, viewport.endIndex);
  const emptyState = grid.querySelector(".records-empty");
  if (emptyState) {
    emptyState.remove();
  }
  ensureRecordCardPoolSize(visibleRecords.length);
  state.recordCardNodes = new Map();
  for (let index = 0; index < visibleRecords.length; index += 1) {
    const record = visibleRecords[index];
    const card = state.recordCardPool[index];
    const previousMeta = card.__recordMeta || null;
    card.dataset.historyId = record.id;
    updateRecordCard(card, record, previousMeta);
    state.recordCardNodes.set(record.id, card);
  }
  if (topSpacer) {
    topSpacer.style.height = `${viewport.topHeight}px`;
  }
  if (bottomSpacer) {
    bottomSpacer.style.height = `${viewport.bottomHeight}px`;
  }
  grid.style.gridTemplateColumns = `repeat(${viewport.columnCount}, minmax(0, 1fr))`;
}

function scheduleRecordViewportRender() {
  if (state.renderFrame != null) {
    return;
  }
  state.renderFrame = window.requestAnimationFrame(() => {
    state.renderFrame = null;
    renderRecordViewport();
  });
}

function shouldLoadMoreRecords() {
  const stage = $("#recordsStage");
  if (!stage || state.loadingMore || !state.hasMore) {
    return false;
  }
  return stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 360;
}

function scheduleLoadMoreHistory() {
  if (state.loadMoreFrame != null || state.loadingMore || !state.hasMore) {
    return;
  }
  state.loadMoreFrame = window.requestAnimationFrame(() => {
    state.loadMoreFrame = null;
    if (shouldLoadMoreRecords()) {
      loadMoreHistory();
    }
  });
}

function renderRecords() {
  scheduleRecordViewportRender();
  setStatus(filteredStatusText());
  updateLiveRefreshLoop();
  onRecordsStageScroll();
}

function updateLiveRefreshLoop() {
  const hasLive = state.history.some((item) => item.is_live && !terminalStatuses.includes(item.status));
  if (document.hidden) {
    if (state.liveRefreshHandle) {
      window.clearInterval(state.liveRefreshHandle);
      state.liveRefreshHandle = null;
    }
    return;
  }
  if (hasLive && !state.liveRefreshHandle) {
    state.liveRefreshHandle = window.setInterval(() => {
      refreshHistory({ preserveLoaded: true, silent: true });
    }, 2500);
    return;
  }
  if (!hasLive && state.liveRefreshHandle) {
    window.clearInterval(state.liveRefreshHandle);
    state.liveRefreshHandle = null;
  }
}

function scheduleRepairRefresh() {
  if (state.repairRefreshHandle) {
    return;
  }
  state.repairRefreshHandle = window.setTimeout(async () => {
    state.repairRefreshHandle = null;
    await refreshHistory({ preserveLoaded: true, silent: true, forceFull: true });
  }, 1200);
}

async function fetchHistoryPage({ limit, offset, repair = true }) {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    repair: repair ? "1" : "0",
    view: "summary",
  });
  return fetchJson(`/api/history/${kind}?${query.toString()}`);
}

async function refreshHistory({ preserveLoaded = false, silent = false, forceFull = false } = {}) {
  const partialLiveRefresh = !forceFull && preserveLoaded && silent && state.history.length > pageSize;
  const limit = partialLiveRefresh
    ? pageSize
    : (preserveLoaded ? Math.max(state.nextOffset || pageSize, pageSize) : pageSize);
  const payload = await fetchHistoryPage({ limit, offset: 0, repair: !silent });
  let nextHistory = payload.items || [];
  if (partialLiveRefresh) {
    const previousPage = new Map(state.history.slice(0, pageSize).map((item) => [item.id, item]));
    nextHistory = nextHistory.map((item) => {
      const previous = previousPage.get(item.id);
      return historyRecordEquivalent(previous, item) ? previous : item;
    });
    const freshIds = new Set(nextHistory.map((item) => item.id));
    const tail = state.history.filter((item, index) => index >= pageSize && !freshIds.has(item.id));
    nextHistory = [...nextHistory, ...tail];
  }
  const total = payload.total || nextHistory.length;
  const nextOffset = preserveLoaded ? Math.max(state.nextOffset || 0, nextHistory.length) : nextHistory.length;
  const hasMore = nextOffset < total;
  setHistoryState(nextHistory, {
    total,
    nextOffset,
    hasMore,
  });
  if (payload.repair_scheduled) {
    scheduleRepairRefresh();
  }
  renderRecords();
  if (hasHistoryFilters()) {
    await ensureFilteredHistoryLoaded();
  }
  if (!silent && !state.history.length) {
    setStatus("当前资产包暂无记录");
  }
}

async function loadMoreHistory() {
  if (!state.hasMore || state.loadingMore) {
    return;
  }
  state.loadingMore = true;
  try {
    const payload = await fetchHistoryPage({ limit: pageSize, offset: state.nextOffset, repair: false });
    const appended = [...state.history, ...(payload.items || [])];
    const total = payload.total || appended.length;
    const nextOffset = state.nextOffset + (payload.items || []).length;
    setHistoryState(appended, {
      total,
      nextOffset,
      hasMore: nextOffset < total,
    });
    renderRecords();
  } catch (error) {
    showToast(String(error.message || error));
  } finally {
    state.loadingMore = false;
    if (shouldLoadMoreRecords()) {
      scheduleLoadMoreHistory();
    }
  }
}

function onRecordsStageScroll() {
  scheduleRecordViewportRender();
  if (shouldLoadMoreRecords()) {
    scheduleLoadMoreHistory();
  }
}

function onRecordsStageWheel() {
  state.recordsWheelGuardUntil = Date.now() + 180;
}

async function reuseRecord(record) {
  const params = record.params_requested || {};
  const reusedAssets = await fetchJson(`/api/history/${record.id}/reuse-assets`, {
    method: "POST",
  });

  $("#promptInput").value = params.prompt || "";
  if (kind === "image") {
    applyImageDefaults(params);
  } else {
    applyVideoDefaults(params);
    $("#videoReferenceUrls").value = (params.reference_video_urls || []).join("\n");
    $("#audioReferenceUrls").value = (params.reference_audio_urls || []).join("\n");
    if ($("#trustedAssetUris")) {
      $("#trustedAssetUris").value = (params.trusted_asset_uris || []).join("\n");
    }
    syncVideoReferenceOptions({
      autoOpen: videoReferenceUrlsHaveValue(),
      resetUserChoice: true,
    });
    syncVideoPricingHint();
  }
  restoreDraftAssets(reusedAssets.assets || {});
  renderAllAssetLists();
  syncPromptBoundAssetsFromPrompt();
  hideMentionMenu();
  const missingLabels = Array.isArray(reusedAssets.missing_labels) ? reusedAssets.missing_labels : [];
  if (missingLabels.length) {
    showToast(`已复用历史参数，以下素材已不存在：${missingLabels.join("、")}`);
    return;
  }
  showToast("已复用历史参数");
}

function closeDeleteDialog() {
  const dialog = $("#deleteTaskModal");
  if (dialog?.open) {
    dialog.close();
  }
  state.deleteTarget = null;
}

function openDeleteDialog(record) {
  if (!canDeleteRecord(record)) {
    return;
  }
  state.deleteTarget = record;
  $("#deleteTaskSummary").textContent = `${recordStatusText(record)} · ${record.model_variant || "-"} · ${formatDate(record.created_at)}`;
  $("#deleteTaskModal").showModal();
}

async function deleteTaskRecord(deleteOutputs) {
  const record = state.deleteTarget;
  if (!record?.id) {
    return;
  }
  try {
    const result = await fetchJson(`/api/history/${record.id}/delete`, {
      method: "POST",
      body: JSON.stringify({ delete_outputs: Boolean(deleteOutputs) }),
    });
    state.history = state.history.filter((item) => item.id !== record.id);
    state.total = Math.max(0, state.total - 1);
    state.nextOffset = Math.max(0, state.history.length);
    renderRecords();
    closeDeleteDialog();
    showToast(deleteOutputs ? `已删除任务和 ${result.deleted_outputs_count || 0} 个结果文件` : "已删除任务卡片");
    await refreshHistory({ preserveLoaded: true, silent: true, forceFull: true });
  } catch (error) {
    showToast(String(error.message || error));
  }
}

async function startGeneration() {
  const params = currentParams();
  if (!params.prompt && !(kind === "video" && params.scene_type !== "text_only")) {
    showToast("请输入提示词");
    return;
  }
  try {
    validateCurrentRequest(params);
  } catch (error) {
    showToast(String(error.message || error));
    return;
  }

  const endpoint = kind === "image" ? "/api/generate/image" : "/api/generate/video";
  try {
    const result = await fetchJson(endpoint, {
      method: "POST",
      body: JSON.stringify(params),
    });
    setStatus(result.message || "任务已提交");
    await refreshHistory({ preserveLoaded: false, silent: true });
  } catch (error) {
    showToast(String(error.message || error));
    setStatus(String(error.message || error));
  }
}

function clearForm() {
  $("#promptInput").value = "";
  resetPromptBindings();
  state.assets.imagePrimary = null;
  state.assets.imageReferences = [];
  state.assets.videoFirst = null;
  state.assets.videoLast = null;
  state.assets.videoReferences = [];
  clearDerivedCaches();
  renderAllAssetLists();
  hideMentionMenu();
  if (kind === "video") {
    $("#videoReferenceUrls").value = "";
    $("#audioReferenceUrls").value = "";
    if ($("#trustedAssetUris")) {
      $("#trustedAssetUris").value = "";
    }
    state.videoReferenceOptionsOpen = false;
    state.videoReferenceOptionsUserToggled = false;
    syncVideoReferenceOptions();
    syncVideoPricingHint();
  }
  clearWorkspaceDraft();
}

function currentPromptBindingCatalog() {
  const derivedLabels = deriveAssetLabels();
  const byAssetId = new Map();
  const byAlias = new Map();

  const register = (asset, aliases = [], target = null) => {
    if (!asset?.id) {
      return null;
    }
    const normalizedAliases = aliases
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (!normalizedAliases.length) {
      return null;
    }
    let entry = byAssetId.get(asset.id);
    if (!entry) {
      entry = {
        asset,
        assetId: asset.id,
        aliases: new Set(),
        targets: new Set(),
      };
      byAssetId.set(asset.id, entry);
    }
    if (target) {
      entry.targets.add(target);
    }
    for (const alias of normalizedAliases) {
      entry.aliases.add(alias);
      if (!byAlias.has(alias)) {
        byAlias.set(alias, entry);
      }
    }
    return entry;
  };

  for (const target of promptBindingTargets) {
    for (const asset of getTargetItems(target)) {
      const labels = derivedLabels.get(asset.id);
      register(asset, [labels?.tag_label, labels?.mention_name], target);
    }
  }

  for (const asset of state.libraryAssets) {
    if (!asset?.id || byAssetId.has(asset.id)) {
      continue;
    }
    const baseName = asset.display_name || defaultAssetName(asset);
    register(asset, [asset.mention_name || `${baseName}（素材库）`]);
  }

  return { byAssetId, byAlias };
}

function attachPromptBoundAsset(asset) {
  if (!asset?.id) {
    return [];
  }
  const attachedTargets = [];
  let changed = false;

  if (kind === "image") {
    const mode = currentImageMode();
    const isUnifiedInputModel = isUnifiedImageInputModel();
    const hasPrimary = state.assets.imagePrimary?.id === asset.id;
    const hasReference = state.assets.imageReferences.some((entry) => entry.id === asset.id);
    if (isUnifiedInputModel) {
      if (mode === "image_edit") {
        if (!state.assets.imagePrimary) {
          state.assets.imagePrimary = asset;
          attachedTargets.push("imagePrimary");
          changed = true;
        } else if (hasPrimary) {
          attachedTargets.push("imagePrimary");
        } else if (!hasReference) {
          $("#imageMode").value = "multi_image";
          state.assets.imageReferences = [state.assets.imagePrimary, ...state.assets.imageReferences, asset]
            .filter((item, index, array) => item && array.findIndex((entry) => entry.id === item.id) === index);
          state.assets.imagePrimary = null;
          attachedTargets.push("imageReferences");
          changed = true;
          syncImageMode({ skipRender: true });
        } else {
          attachedTargets.push("imageReferences");
        }
      } else if (mode === "multi_image") {
        if (!hasReference) {
          state.assets.imageReferences = [...state.assets.imageReferences, asset];
          changed = true;
        }
        attachedTargets.push("imageReferences");
      }
    } else if (mode === "base_only") {
      if (!state.assets.imagePrimary) {
        state.assets.imagePrimary = asset;
        attachedTargets.push("imagePrimary");
        changed = true;
      } else if (hasPrimary) {
        attachedTargets.push("imagePrimary");
      } else if (hasReference) {
        attachedTargets.push("imageReferences");
      } else {
        $("#imageMode").value = "multi_image";
        state.assets.imageReferences = [...state.assets.imageReferences, asset];
        attachedTargets.push("imageReferences");
        changed = true;
        syncImageMode({ skipRender: true });
      }
    } else if (mode === "reference_only" || mode === "multi_image") {
      if (!hasReference) {
        state.assets.imageReferences = [...state.assets.imageReferences, asset];
        changed = true;
      }
      attachedTargets.push("imageReferences");
    }
  } else {
    if ($("#videoSceneType").value !== "multimodal_reference") {
      $("#videoSceneType").value = "multimodal_reference";
      changed = true;
      syncVideoScene({ skipRender: true });
    }
    const exists = state.assets.videoReferences.some((entry) => entry.id === asset.id);
    if (!exists) {
      state.assets.videoReferences = [...state.assets.videoReferences, asset];
      changed = true;
    }
    attachedTargets.push("videoReferences");
  }

  for (const target of attachedTargets) {
    bindPromptAsset(target, asset.id);
  }
  if (changed) {
    normalizeAssetState();
    clearDerivedCaches();
  }
  return attachedTargets;
}

function ensurePromptMentionAssetBoundByLabel(label) {
  const normalized = String(label || "").trim();
  if (!normalized) {
    return false;
  }
  const catalog = currentPromptBindingCatalog();
  const entry = catalog.byAlias.get(normalized);
  if (!entry) {
    return false;
  }
  let changed = false;
  if (entry.targets.size) {
    for (const target of entry.targets) {
      changed = bindPromptAsset(target, entry.assetId) || changed;
    }
    return changed;
  }
  return attachPromptBoundAsset(entry.asset).length > 0;
}

function removePromptMentionsForAliases(aliases) {
  const textarea = $("#promptInput");
  const aliasSet = new Set(
    (Array.isArray(aliases) ? aliases : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  if (!textarea || !aliasSet.size) {
    return false;
  }
  const mentionLookup = currentPromptMentionLookup();
  const { segments } = scanPromptMentions(textarea.value || "", mentionLookup);
  const nextValue = segments
    .filter((segment) => !(segment.kind === "mention" && aliasSet.has(segment.label)))
    .map((segment) => segment.text)
    .join("");
  if (nextValue === textarea.value) {
    return false;
  }
  textarea.value = nextValue;
  renderPromptMirror();
  return true;
}

function syncPromptBoundAssetsFromPrompt() {
  const textarea = $("#promptInput");
  if (!textarea || state.promptBindingSyncing) {
    return false;
  }
  prunePromptBindings();
  if (!isMentionEnabled()) {
    return false;
  }
  state.promptBindingSyncing = true;
  try {
    const prompt = textarea.value || "";
    const mentionLookup = currentPromptMentionLookup();
    const { mentions } = scanPromptMentions(prompt, mentionLookup);
    const activeMentions = new Set(mentions);
    let changed = false;

    for (const label of mentions) {
      changed = ensurePromptMentionAssetBoundByLabel(label) || changed;
    }

    prunePromptBindings();
    const catalog = currentPromptBindingCatalog();
    for (const target of promptBindingTargets) {
      for (const assetId of Array.from(promptBindingSet(target))) {
        const entry = catalog.byAssetId.get(assetId);
        const isReferenced = entry
          ? Array.from(entry.aliases).some((alias) => activeMentions.has(alias))
          : false;
        if (!isReferenced) {
          changed = detachAssetFromTarget(target, assetId) || changed;
        }
      }
    }

    const normalized = normalizeAssetState();
    if (changed || normalized) {
      clearDerivedCaches();
      renderAllAssetLists();
    }
    return changed || normalized;
  } finally {
    state.promptBindingSyncing = false;
  }
}

function attachLibraryAsset(item) {
  if (!item?.asset_id) {
    return;
  }
  const asset = state.libraryAssets.find((entry) => entry.id === item.asset_id);
  if (!asset) {
    return;
  }
  if (kind === "image") {
    const mode = currentImageMode();
    const isUnifiedInputModel = isUnifiedImageInputModel();
    const hasPrimary = state.assets.imagePrimary?.id === asset.id;
    const hasReference = state.assets.imageReferences.some((entry) => entry.id === asset.id);
    if (isUnifiedInputModel) {
      if (mode === "image_edit") {
        if (!state.assets.imagePrimary) {
          state.assets.imagePrimary = asset;
        } else if (!hasPrimary && !hasReference) {
          $("#imageMode").value = "multi_image";
          state.assets.imageReferences = [state.assets.imagePrimary, ...state.assets.imageReferences, asset]
            .filter((item, index, array) => item && array.findIndex((entry) => entry.id === item.id) === index);
          state.assets.imagePrimary = null;
          clearDerivedCaches();
          syncImageMode();
          return;
        }
      } else if (mode === "multi_image" && !hasReference) {
        state.assets.imageReferences = [...state.assets.imageReferences, asset];
      } else {
        return;
      }
    } else if (mode === "base_only") {
      if (!state.assets.imagePrimary) {
        state.assets.imagePrimary = asset;
      } else if (!hasPrimary && !hasReference) {
        $("#imageMode").value = "multi_image";
        state.assets.imageReferences = [...state.assets.imageReferences, asset];
        clearDerivedCaches();
        syncImageMode();
        return;
      }
    } else if ((mode === "reference_only" || mode === "multi_image") && !hasReference) {
      state.assets.imageReferences = [...state.assets.imageReferences, asset];
    } else {
      return;
    }
    normalizeAssetState();
    clearDerivedCaches();
    renderAllAssetLists();
    return;
  }
  if ($("#videoSceneType").value !== "multimodal_reference") {
    $("#videoSceneType").value = "multimodal_reference";
    syncVideoScene();
  }
  const exists = state.assets.videoReferences.some((entry) => entry.id === asset.id);
  if (!exists) {
    state.assets.videoReferences = [...state.assets.videoReferences, asset];
    normalizeAssetState();
    clearDerivedCaches();
    renderAllAssetLists();
  }
}

function availableMentionCatalog() {
  const cacheKey = `${assetStateSignature()}||${libraryAssetsSignature()}`;
  if (cacheKey === state.mentionCacheKey) {
    return state.mentionCacheValue;
  }
  const order = currentAssetTagCategories();
  const groups = new Map(order.map((category) => [category, []]));
  for (const item of [...activeMentionItems(), ...libraryMentionItems()]) {
    if (!groups.has(item.category)) {
      groups.set(item.category, []);
    }
    groups.get(item.category).push(item);
  }
  const categories = order
    .map((category) => ({
      category,
      items: groups.get(category) || [],
    }))
    .filter((group) => group.items.length);
  const totalItems = categories.reduce((sum, group) => sum + group.items.length, 0);
  if (!totalItems) {
    state.mentionCacheKey = cacheKey;
    state.mentionCacheValue = {
      error: null,
      categories: [],
    };
    return state.mentionCacheValue;
  }
  state.mentionCacheKey = cacheKey;
  state.mentionCacheValue = {
    error: null,
    categories,
  };
  return state.mentionCacheValue;
}

function currentPromptMentionLookup() {
  const cacheKey = `${assetStateSignature()}||${libraryAssetsSignature()}`;
  if (cacheKey === state.promptMentionLookupCache.key) {
    return state.promptMentionLookupCache.map;
  }
  const lookup = new Map();
  for (const item of deriveAssetLabels().values()) {
    if (item.tag_label && !lookup.has(item.tag_label)) {
      lookup.set(item.tag_label, item.tag_category);
    }
    if (item.mention_name && !lookup.has(item.mention_name)) {
      lookup.set(item.mention_name, item.tag_category);
    }
  }
  for (const asset of state.libraryAssets) {
    if (!asset?.tag_category) {
      continue;
    }
    const baseName = asset.display_name || defaultAssetName(asset);
    const mentionName = String(asset.mention_name || `${baseName}（素材库）`).trim();
    if (mentionName && !lookup.has(mentionName)) {
      lookup.set(mentionName, asset.tag_category);
    }
  }
  state.promptMentionLookupCache = {
    key: cacheKey,
    map: lookup,
  };
  return lookup;
}

function isMentionBoundaryChar(char) {
  return !char || mentionBoundaryPattern.test(char);
}

function hasMentionBoundary(text, index) {
  return index >= text.length || isMentionBoundaryChar(text[index]);
}

function sortedMentionLabels(mentionLookup) {
  return Array.from(mentionLookup.keys()).sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }
    return left.localeCompare(right, "zh-Hans-CN");
  });
}

function readUnknownMentionCandidate(text, start, maxLength) {
  let end = start;
  while (end < text.length && !isMentionBoundaryChar(text[end]) && end - start < maxLength) {
    end += 1;
  }
  const label = text.slice(start, end).trim();
  if (!label) {
    return null;
  }
  return { label, end };
}

function scanPromptMentions(text, mentionLookup = new Map()) {
  const value = String(text || "");
  const lookup = mentionLookup instanceof Map ? mentionLookup : new Map();
  const labels = sortedMentionLabels(lookup);
  const maxLabelLength = Math.max((labels[0]?.length || 0) + 4, 6);
  const segments = [];
  const mentions = [];
  const unknown = [];
  let cursor = 0;
  let plainStart = 0;

  while (cursor < value.length) {
    if (value[cursor] !== "@") {
      cursor += 1;
      continue;
    }

    const start = cursor;
    const labelStart = start + 1;
    let matchedLabel = null;
    let matchedCategory = null;

    for (const label of labels) {
      if (value.startsWith(label, labelStart) && hasMentionBoundary(value, labelStart + label.length)) {
        matchedLabel = label;
        matchedCategory = lookup.get(label) || null;
        break;
      }
    }

    if (matchedLabel) {
      if (plainStart < start) {
        segments.push({ kind: "plain", text: value.slice(plainStart, start) });
      }
      segments.push({
        kind: "mention",
        text: `@${matchedLabel}`,
        label: matchedLabel,
        category: matchedCategory,
      });
      mentions.push(matchedLabel);
      cursor = labelStart + matchedLabel.length;
      plainStart = cursor;
      continue;
    }

    const candidate = readUnknownMentionCandidate(value, labelStart, maxLabelLength);
    if (candidate) {
      if (plainStart < start) {
        segments.push({ kind: "plain", text: value.slice(plainStart, start) });
      }
      segments.push({ kind: "plain", text: value.slice(start, candidate.end) });
      unknown.push(candidate.label);
      cursor = candidate.end;
      plainStart = cursor;
      continue;
    }

    cursor += 1;
  }

  if (plainStart < value.length) {
    segments.push({ kind: "plain", text: value.slice(plainStart) });
  }

  return { segments, mentions, unknown };
}

function ensurePromptMeasure() {
  const composer = $("#promptComposer");
  if (!composer) {
    return null;
  }
  let measure = composer.querySelector(".prompt-measure");
  if (!measure) {
    measure = document.createElement("div");
    measure.className = "prompt-measure";
    measure.setAttribute("aria-hidden", "true");
    composer.appendChild(measure);
  }
  return measure;
}

function syncPromptLayerMetrics() {
  const textarea = $("#promptInput");
  const mirror = $("#promptMirror");
  const measure = ensurePromptMeasure();
  if (!textarea || !mirror || !measure) {
    return { textarea, mirror, measure };
  }
  const style = window.getComputedStyle(textarea);
  const layerStyles = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "textTransform",
    "textIndent",
    "boxSizing",
    "whiteSpace",
    "wordSpacing",
    "tabSize",
    "overflowWrap",
    "lineBreak",
  ];
  for (const layer of [mirror, measure]) {
    for (const name of layerStyles) {
      layer.style[name] = style[name];
    }
    layer.style.width = `${textarea.clientWidth}px`;
    layer.style.height = `${textarea.clientHeight}px`;
  }
  return { textarea, mirror, measure };
}

function syncPromptScroll() {
  const textarea = $("#promptInput");
  const mirror = $("#promptMirror");
  if (!textarea || !mirror) {
    return;
  }
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
  const menu = $("#mentionMenu");
  if (menu && !menu.classList.contains("is-hidden")) {
    positionMentionMenu(textarea.selectionStart || 0);
  }
}

function createPromptToken(className, text) {
  return createElement("span", className, text);
}

function renderPromptMirror() {
  const { textarea, mirror } = syncPromptLayerMetrics();
  if (!textarea || !mirror) {
    return;
  }
  const value = textarea.value || "";
  const fragment = document.createDocumentFragment();
  const mentionLookup = isMentionEnabled() ? currentPromptMentionLookup() : new Map();
  const { segments } = scanPromptMentions(value, mentionLookup);
  for (const segment of segments) {
    if (segment.kind === "mention") {
      fragment.appendChild(createPromptToken("prompt-token prompt-token-mention", segment.text));
      continue;
    }
    fragment.appendChild(createPromptToken("prompt-token prompt-token-plain", segment.text));
  }
  if (value.endsWith("\n")) {
    fragment.appendChild(createPromptToken("prompt-token prompt-token-anchor", "\u200b"));
  }
  mirror.replaceChildren(fragment);
  syncPromptScroll();
}

function extractMentionContext() {
  const textarea = $("#promptInput");
  if (!textarea) {
    return null;
  }
  const mentionLookup = isMentionEnabled() ? currentPromptMentionLookup() : new Map();
  const caret = textarea.selectionStart || 0;
  const value = textarea.value || "";
  const labels = sortedMentionLabels(mentionLookup);
  const maxLabelLength = Math.max((labels[0]?.length || 0) + 8, 12);
  const searchStart = Math.max(0, caret - maxLabelLength - 1);

  for (let index = caret - 1; index >= searchStart; index -= 1) {
    if (value[index] !== "@") {
      continue;
    }
    if (index > 0 && !isMentionBoundaryChar(value[index - 1])) {
      continue;
    }
    const query = value.slice(index + 1, caret);
    if (query.includes("@") || query.includes("\n") || query.includes("\r")) {
      continue;
    }
    if (!query) {
      return {
        start: index,
        end: caret,
        query: "",
      };
    }
    const hasKnownPrefix = labels.some((label) => label.startsWith(query));
    if (hasKnownPrefix || query.length <= 2) {
      return {
        start: index,
        end: caret,
        query,
      };
    }
    return null;
  }
  return null;
}

function currentMentionContextFromState() {
  const textarea = $("#promptInput");
  if (state.mention.anchorStart == null) {
    return extractMentionContext();
  }
  return {
    start: state.mention.anchorStart,
    end: state.mention.anchorEnd ?? textarea?.selectionStart ?? state.mention.anchorStart,
    query: "",
  };
}

function setMentionItems(items) {
  const records = Array.isArray(items) ? items : [];
  state.mention.items = records;
  state.mention.itemLookup = new Map();
  records.forEach((item) => {
    if (item?.key) {
      state.mention.itemLookup.set(item.key, item);
    }
  });
}

function maybeShowMentionIssue(message) {
  if (!message) {
    state.mention.noticeKey = null;
    return;
  }
  if (state.mention.noticeKey === message) {
    return;
  }
  state.mention.noticeKey = message;
  showToast(message);
}

function hideMentionMenu() {
  const menu = $("#mentionMenu");
  menu.classList.add("is-hidden");
  menu.innerHTML = "";
  state.mention.itemLookup = new Map();
  state.mention.items = [];
  state.mention.layoutKey = null;
  state.mention.anchorStart = null;
  state.mention.anchorEnd = null;
  state.mention.activeIndex = 0;
  state.mention.level = "categories";
  state.mention.selectedCategory = null;
  state.mention.searchQuery = "";
  state.mention.categorySearchQuery = "";
  state.mention.contextKey = null;
}

function mentionContextKey(context) {
  return context ? `${context.start}:${context.query || ""}` : null;
}

function resetMentionState() {
  state.mention.itemLookup = new Map();
  state.mention.items = [];
  state.mention.activeIndex = 0;
  state.mention.layoutKey = null;
  state.mention.level = "categories";
  state.mention.selectedCategory = null;
  state.mention.searchQuery = "";
  state.mention.categorySearchQuery = "";
}

function ensureMentionMenuLayer() {
  const menu = $("#mentionMenu");
  if (menu && menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }
  return menu;
}

let mentionMeasureContext = null;

function fontShorthand(style) {
  return style.font
    || `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
}

function measureMentionTextWidth(text, font) {
  if (!mentionMeasureContext) {
    mentionMeasureContext = document.createElement("canvas").getContext("2d");
  }
  if (!mentionMeasureContext) {
    return String(text || "").length * 14;
  }
  mentionMeasureContext.font = font;
  return mentionMeasureContext.measureText(String(text || "")).width;
}

function computeMentionMenuWidth(menu) {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportPadding = 8;
  const isCategoryLevel = state.mention.level === "categories";
  const minWidth = Math.min(isCategoryLevel ? 280 : 340, Math.max(240, viewportWidth - viewportPadding * 2));
  const maxWidth = Math.min(isCategoryLevel ? 420 : 560, Math.max(240, viewportWidth - viewportPadding * 2));
  const titleNode = menu.querySelector(".mention-option-title");
  const metaNode = menu.querySelector(".mention-option-meta");
  const titleFont = titleNode ? fontShorthand(window.getComputedStyle(titleNode)) : fontShorthand(window.getComputedStyle(menu));
  const metaFont = metaNode ? fontShorthand(window.getComputedStyle(metaNode)) : titleFont;
  let width = minWidth;

  for (const item of state.mention.items) {
    const titleWidth = measureMentionTextWidth(item?.label || "", titleFont);
    const metaWidth = item?.description ? measureMentionTextWidth(item.description, metaFont) : 0;
    const chromeWidth = item?.kind === "category" ? 86 : 56;
    width = Math.max(width, Math.max(titleWidth, metaWidth) + chromeWidth);
  }

  const menuTitle = menu.querySelector(".mention-menu-title");
  if (menuTitle) {
    width = Math.max(width, measureMentionTextWidth(menuTitle.textContent || "", titleFont) + 136);
  }

  const searchInput = menu.querySelector(".mention-search");
  if (searchInput) {
    width = Math.max(width, measureMentionTextWidth(searchInput.placeholder || "", titleFont) + 72);
  }

  return Math.min(maxWidth, Math.ceil(width));
}

function mentionItemsLayoutKey(items = []) {
  return items
    .map((item) => [item?.kind || "", item?.key || "", item?.label || "", item?.description || ""].join("|"))
    .join("\u0001");
}

function currentMentionLayoutKey() {
  return [
    state.mention.level,
    state.mention.selectedCategory || "",
    state.mention.searchQuery || "",
    state.mention.categorySearchQuery || "",
    mentionItemsLayoutKey(state.mention.items),
  ].join("\u0002");
}

function sizeMentionMenu(menu) {
  if (!menu || menu.classList.contains("is-hidden")) {
    return;
  }
  const viewportPadding = 8;
  const list = menu.querySelector(".mention-option-list");
  const width = computeMentionMenuWidth(menu);
  const maxMenuHeight = Math.max(180, window.innerHeight - viewportPadding * 2);

  menu.style.width = `${width}px`;
  menu.style.maxHeight = "none";
  if (list) {
    list.style.maxHeight = "none";
  }

  const naturalHeight = menu.scrollHeight;
  if (list && naturalHeight > maxMenuHeight) {
    const chromeHeight = naturalHeight - list.scrollHeight;
    const listMaxHeight = Math.max(96, maxMenuHeight - chromeHeight);
    list.style.maxHeight = `${listMaxHeight}px`;
  }

  menu.style.maxHeight = `${maxMenuHeight}px`;
}

function positionMentionMenu(caretPosition) {
  const textarea = $("#promptInput");
  const measure = ensurePromptMeasure();
  const menu = ensureMentionMenuLayer();
  if (!textarea || !measure || !menu) {
    return;
  }
  syncPromptLayerMetrics();
  measure.textContent = textarea.value.slice(0, caretPosition);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(caretPosition, caretPosition + 1) || ".";
  measure.appendChild(marker);

  const markerRect = marker.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const padding = 8;
  const verticalGap = 10;
  const menuWidth = menu.offsetWidth || 280;
  const menuHeight = menu.offsetHeight || 260;
  const left = Math.min(
    Math.max(padding, markerRect.left),
    Math.max(padding, viewportWidth - menuWidth - padding),
  );
  const belowTop = markerRect.bottom + verticalGap;
  const aboveTop = markerRect.top - menuHeight - verticalGap;
  let top = belowTop;
  if (belowTop + menuHeight > viewportHeight - padding && aboveTop >= padding) {
    top = aboveTop;
  } else {
    top = Math.min(Math.max(padding, belowTop), Math.max(padding, viewportHeight - menuHeight - padding));
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function chooseMention(item) {
  const textarea = $("#promptInput");
  const start = state.mention.anchorStart;
  const end = state.mention.anchorEnd ?? textarea.selectionStart ?? 0;
  if (start == null) {
    return;
  }
  const label = item?.insertLabel || item?.label || "";
  const nextValue = `${textarea.value.slice(0, start)}@${label} ${textarea.value.slice(end)}`;
  textarea.value = nextValue;
  const caret = start + label.length + 2;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  const synced = syncPromptBoundAssetsFromPrompt();
  if (!synced) {
    renderPromptMirror();
    persistWorkspaceDraft();
  }
  hideMentionMenu();
}

function filterMentionItems(items, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) {
    return items;
  }
  return items.filter((item) => item.searchText.includes(normalized));
}

function chooseMentionItem(item, context = extractMentionContext()) {
  if (!item) {
    return;
  }
  if (item.kind === "category") {
    state.mention.activeIndex = 0;
    state.mention.searchQuery = "";
    state.mention.categorySearchQuery = "";
    openMentionCategory(item.category, context, true);
    return;
  }
  chooseMention(item);
}

function renderMentionOption(item, index, onChoose) {
  const button = createElement(
    "button",
    `mention-option${index === state.mention.activeIndex ? " is-active" : ""}${item.kind === "category" ? " is-category" : ""}`,
  );
  button.type = "button";
  button.dataset.itemKey = item?.key || "";
  button.dataset.itemKind = item?.kind || "";
  const content = createElement("div", "mention-option-content");
  const title = createElement("div", "mention-option-title", item.label);
  content.appendChild(title);
  if (item.description) {
    content.appendChild(createElement("div", "mention-option-meta", item.description));
  }
  button.appendChild(content);
  if (item.kind === "category") {
    const indicator = createElement("div", "mention-option-indicator", "›");
    indicator.setAttribute("aria-hidden", "true");
    button.appendChild(indicator);
  }
  return button;
}

function renderMentionGroups(items) {
  const container = createElement("div", "mention-option-list");
  if (!items.length) {
    container.appendChild(createElement("div", "mention-empty", "没有匹配的素材"));
    return container;
  }
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.category)) {
      grouped.set(item.category, []);
    }
    grouped.get(item.category).push(item);
  }
  let visualIndex = 0;
  for (const [category, entries] of grouped.entries()) {
    const group = createElement("div", "mention-group");
    group.appendChild(createElement("div", "mention-group-title", category));
    entries.forEach((item) => {
      group.appendChild(renderMentionOption(item, visualIndex));
      visualIndex += 1;
    });
    container.appendChild(group);
  }
  return container;
}

function buildMentionSearchInput({
  placeholder,
  value,
  onInput,
  onArrow,
  onEnter,
  onEscape,
  onLeft = null,
  onRight = null,
  className = "mention-search",
}) {
  const searchInput = document.createElement("input");
  searchInput.className = className;
  searchInput.type = "text";
  searchInput.placeholder = placeholder;
  searchInput.value = value;
  searchInput.addEventListener("input", () => onInput(searchInput.value));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      onArrow(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      onEnter();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key === "ArrowLeft" && typeof onLeft === "function" && !searchInput.value) {
      event.preventDefault();
      onLeft();
      return;
    }
    if (event.key === "ArrowRight" && typeof onRight === "function" && !searchInput.value) {
      event.preventDefault();
      onRight();
    }
  });
  return searchInput;
}

function reflowMentionMenu(menu, context, { focusTarget = null, forceResize = false } = {}) {
  menu.classList.remove("is-hidden");
  const nextLayoutKey = currentMentionLayoutKey();
  if (forceResize || state.mention.layoutKey !== nextLayoutKey) {
    sizeMentionMenu(menu);
    state.mention.layoutKey = nextLayoutKey;
  }
  positionMentionMenu(context.end);
  if (!focusTarget) {
    return;
  }
  requestAnimationFrame(() => {
    focusTarget.focus();
    if (typeof focusTarget.setSelectionRange === "function") {
      const length = focusTarget.value?.length || 0;
      focusTarget.setSelectionRange(length, length);
    }
  });
}

function buildMentionCategoryItems(catalog) {
  return catalog.categories.map((group) => ({
    key: `category:${group.category}`,
    label: group.category,
    description: group.items.length ? `${group.items.length} 项素材` : "当前分类暂无可引用素材",
    category: group.category,
    kind: "category",
  }));
}

function buildMentionGlobalSearchResults(catalog) {
  const query = String(state.mention.categorySearchQuery || "").trim();
  const allItems = catalog.categories.flatMap((group) => group.items);
  return filterMentionItems(allItems, query);
}

function renderMentionCategoryCards(categoryItems, context) {
  const list = createElement("div", "mention-option-list");
  categoryItems.forEach((item, index) => {
    list.appendChild(renderMentionOption(item, index));
  });
  return list;
}

function renderMentionGlobalSearchResults(items, context) {
  return renderMentionGroups(items);
}

function renderMentionPrimaryBody(menu, catalog, context) {
  let body = menu.querySelector(".mention-primary-body");
  if (!body) {
    body = createElement("div", "mention-primary-body");
    menu.prepend(body);
  }
  body.innerHTML = "";
  const query = String(state.mention.categorySearchQuery || "").trim();
  const categoryItems = buildMentionCategoryItems(catalog);
  if (query) {
    state.mention.level = "global_search";
    const results = buildMentionGlobalSearchResults(catalog);
    setMentionItems(results);
    state.mention.activeIndex = results.length
      ? Math.min(state.mention.activeIndex, results.length - 1)
      : 0;
    body.appendChild(renderMentionGlobalSearchResults(results, context));
    return;
  }
  state.mention.level = "categories";
  setMentionItems(categoryItems);
  state.mention.activeIndex = categoryItems.length
    ? Math.min(state.mention.activeIndex, categoryItems.length - 1)
    : 0;
  body.appendChild(renderMentionCategoryCards(categoryItems, context));
}

function renderMentionCategorySearchInput(menu, catalog, context, focusSearch = false) {
  const searchInput = buildMentionSearchInput({
    className: "mention-search mention-search-bottom",
    placeholder: "按素材名称搜索",
    value: state.mention.categorySearchQuery,
    onInput: (value) => {
      state.mention.categorySearchQuery = value;
      state.mention.activeIndex = 0;
      renderMentionPrimaryBody(menu, catalog, context);
      reflowMentionMenu(menu, context, { forceResize: true });
    },
    onArrow: (delta) => {
      stepMentionSelection(delta);
      renderMentionPrimaryBody(menu, catalog, context);
      reflowMentionMenu(menu, context);
    },
    onEnter: () => {
      const item = state.mention.items[state.mention.activeIndex];
      if (item) {
        chooseMentionItem(item, context);
      }
    },
    onEscape: () => {
      if (state.mention.categorySearchQuery) {
        state.mention.categorySearchQuery = "";
        state.mention.activeIndex = 0;
        state.mention.level = "categories";
        renderMentionPrimaryBody(menu, catalog, context);
        reflowMentionMenu(menu, context, { forceResize: true });
        return;
      }
      hideMentionMenu();
      $("#promptInput").focus();
    },
  });
  searchInput.dataset.focusRequested = focusSearch ? "1" : "";
  return searchInput;
}

function showMentionCategoryCards(catalog, context, focusSearch = false) {
  const menu = $("#mentionMenu");
  menu.innerHTML = "";
  state.mention.level = "categories";
  state.mention.selectedCategory = null;
  state.mention.searchQuery = "";
  state.mention.anchorStart = context.start;
  state.mention.anchorEnd = context.end;
  state.mention.contextKey = mentionContextKey(context);
  const searchInput = renderMentionCategorySearchInput(menu, catalog, context, focusSearch);
  renderMentionPrimaryBody(menu, catalog, context);
  menu.appendChild(searchInput);
  reflowMentionMenu(menu, context, {
    focusTarget: focusSearch ? searchInput : null,
  });
}

function showMentionGlobalSearch(catalog, context, focusSearch = false) {
  showMentionCategoryCards(catalog, context, focusSearch);
}

function reopenMentionCategories(context = extractMentionContext()) {
  if (!context) {
    hideMentionMenu();
    return;
  }
  const catalog = availableMentionCatalog();
  if (catalog.error) {
    hideMentionMenu();
    maybeShowMentionIssue(catalog.error);
    return;
  }
  state.mention.activeIndex = 0;
  state.mention.level = "categories";
  state.mention.selectedCategory = null;
  state.mention.searchQuery = "";
  state.mention.categorySearchQuery = "";
  showMentionCategoryCards(catalog, context);
}

function openActiveMentionCategory(context = extractMentionContext()) {
  if (state.mention.level !== "categories") {
    return;
  }
  const item = state.mention.items[state.mention.activeIndex];
  if (item?.kind === "category") {
    chooseMentionItem(item, context);
  }
}

function renderMentionCategoryItemsBody(menu, category, group) {
  let body = menu.querySelector(".mention-category-body");
  if (!body) {
    body = createElement("div", "mention-category-body");
    menu.appendChild(body);
  }
  body.innerHTML = "";
  const filteredItems = filterMentionItems(group.items, state.mention.searchQuery);
  setMentionItems(filteredItems);
  state.mention.activeIndex = Math.min(state.mention.activeIndex, Math.max(filteredItems.length - 1, 0));
  const list = createElement("div", "mention-option-list");
  if (!filteredItems.length) {
    list.appendChild(createElement("div", "mention-empty", `当前没有匹配的${category}素材`));
  } else {
    filteredItems.forEach((item, index) => {
      list.appendChild(renderMentionOption(item, index));
    });
  }
  body.appendChild(list);
}

function openMentionCategory(category, context = extractMentionContext(), focusSearch = false) {
  const menu = $("#mentionMenu");
  if (!menu || !context) {
    hideMentionMenu();
    return;
  }
  const { error, categories } = availableMentionCatalog();
  if (error) {
    hideMentionMenu();
    maybeShowMentionIssue(error);
    return;
  }
  const group = categories.find((entry) => entry.category === category);
  if (!group) {
    showMentionCategoryCards({ categories }, context);
    return;
  }
  menu.innerHTML = "";
  state.mention.level = "category_items";
  state.mention.selectedCategory = category;
  state.mention.anchorStart = context.start;
  state.mention.anchorEnd = context.end;
  state.mention.contextKey = mentionContextKey(context);

  const header = createElement("div", "mention-menu-header");
  const backButton = createElement("button", "mention-back-button", "返回");
  backButton.type = "button";
  backButton.dataset.action = "back";
  header.append(
    backButton,
    createElement("div", "mention-menu-title", category),
  );
  menu.appendChild(header);

  const searchInput = buildMentionSearchInput({
    placeholder: `搜索${category}素材`,
    value: state.mention.searchQuery,
    onInput: (value) => {
      state.mention.searchQuery = value;
      state.mention.activeIndex = 0;
      renderMentionCategoryItemsBody(menu, category, group);
      reflowMentionMenu(menu, context, { forceResize: true });
    },
    onArrow: (delta) => {
      stepMentionSelection(delta);
      renderMentionCategoryItemsBody(menu, category, group);
      reflowMentionMenu(menu, context);
    },
    onEnter: () => {
      const item = state.mention.items[state.mention.activeIndex];
      if (item) {
        chooseMention(item);
      }
    },
    onEscape: () => {
      if (state.mention.searchQuery) {
        state.mention.searchQuery = "";
        state.mention.activeIndex = 0;
        renderMentionCategoryItemsBody(menu, category, group);
        reflowMentionMenu(menu, context, { forceResize: true });
        return;
      }
      reopenMentionCategories(context);
      $("#promptInput").focus();
    },
    onLeft: () => {
      reopenMentionCategories(context);
      $("#promptInput").focus();
    },
  });
  menu.appendChild(searchInput);
  renderMentionCategoryItemsBody(menu, category, group);
  reflowMentionMenu(menu, context, {
    focusTarget: focusSearch ? searchInput : null,
  });
}

function bindMentionMenuInteractions() {
  const menu = ensureMentionMenuLayer();
  if (!menu || menu.dataset.boundInteractions === "1") {
    return;
  }
  menu.dataset.boundInteractions = "1";

  menu.addEventListener("pointerdown", (event) => {
    const interactive = event.target.closest(".mention-option, .mention-back-button");
    if (!interactive) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  menu.addEventListener("click", (event) => {
    const backButton = event.target.closest(".mention-back-button");
    if (backButton) {
      event.preventDefault();
      event.stopPropagation();
      state.mention.activeIndex = 0;
      state.mention.categorySearchQuery = "";
      reopenMentionCategories(currentMentionContextFromState());
      $("#promptInput")?.focus();
      return;
    }

    const option = event.target.closest(".mention-option");
    if (!option) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const itemKey = option.dataset.itemKey || "";
    const item = state.mention.itemLookup.get(itemKey);
    if (!item) {
      return;
    }
    chooseMentionItem(item, currentMentionContextFromState());
  });
}

function updateMentionMenu() {
  if (!isMentionEnabled()) {
    maybeShowMentionIssue(null);
    hideMentionMenu();
    return;
  }
  const context = extractMentionContext();
  if (!context) {
    maybeShowMentionIssue(null);
    hideMentionMenu();
    return;
  }
  const catalog = availableMentionCatalog();
  if (catalog.error) {
    hideMentionMenu();
    maybeShowMentionIssue(catalog.error);
    return;
  }
  maybeShowMentionIssue(null);
  const contextKey = mentionContextKey(context);
  if (state.mention.contextKey && state.mention.contextKey !== contextKey) {
    resetMentionState();
  }
  if (state.mention.level === "category_items" && state.mention.selectedCategory) {
    openMentionCategory(state.mention.selectedCategory, context);
    return;
  }
  if (state.mention.level === "global_search" || state.mention.categorySearchQuery.trim()) {
    showMentionGlobalSearch(catalog, context);
    return;
  }
  showMentionCategoryCards(catalog, context);
}

function stepMentionSelection(delta) {
  if (!state.mention.items.length) {
    return;
  }
  state.mention.activeIndex =
    (state.mention.activeIndex + delta + state.mention.items.length) % state.mention.items.length;
}

function onPromptKeydown(event) {
  if ($("#mentionMenu").classList.contains("is-hidden")) {
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    stepMentionSelection(1);
    updateMentionMenu();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    stepMentionSelection(-1);
    updateMentionMenu();
    return;
  }
  if (event.key === "ArrowRight") {
    if (state.mention.level === "categories") {
      event.preventDefault();
      openActiveMentionCategory();
    }
    return;
  }
  if (event.key === "ArrowLeft") {
    if (state.mention.level === "category_items") {
      event.preventDefault();
      reopenMentionCategories();
    }
    return;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    const item = state.mention.items[state.mention.activeIndex];
    if (!item) {
      return;
    }
    if (state.mention.level === "categories") {
      chooseMentionItem(item);
      return;
    }
    chooseMention(item);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.mention.level === "category_items") {
      if (state.mention.searchQuery) {
        state.mention.searchQuery = "";
        updateMentionMenu();
        return;
      }
      reopenMentionCategories();
      return;
    }
    if (state.mention.level === "global_search") {
      if (state.mention.categorySearchQuery) {
        state.mention.categorySearchQuery = "";
        state.mention.activeIndex = 0;
        state.mention.level = "categories";
        updateMentionMenu();
        return;
      }
      hideMentionMenu();
      return;
    }
    hideMentionMenu();
  }
}

function bindPromptMentions() {
  const textarea = $("#promptInput");
  ensureMentionMenuLayer();
  bindMentionMenuInteractions();
  textarea.addEventListener("input", () => {
    const synced = syncPromptBoundAssetsFromPrompt();
    if (!synced) {
      renderPromptMirror();
      updateMentionMenu();
    }
  });
  textarea.addEventListener("click", updateMentionMenu);
  textarea.addEventListener("keyup", updateMentionMenu);
  textarea.addEventListener("keydown", onPromptKeydown);
  textarea.addEventListener("scroll", syncPromptScroll, { passive: true });
  window.addEventListener("resize", () => {
    state.mention.layoutKey = null;
    renderPromptMirror();
    updateMentionMenu();
  });
  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest("#promptComposer") && !event.target.closest("#mentionMenu")) {
      hideMentionMenu();
    }
  });
  window.addEventListener("godreamai-settings-change", (event) => {
    if (!event.detail?.settings) {
      return;
    }
    config.settings = {
      ...(config.settings || {}),
      ...event.detail.settings,
    };
    applyPromptFontSize();
    renderPromptMirror();
  });
}

function findRecordFromEventTarget(target) {
  const card = target?.closest?.(".record-card");
  if (!card) {
    return null;
  }
  return state.historyLookup.get(card.dataset.historyId) || null;
}

function onRecordGridClick(event) {
  const record = findRecordFromEventTarget(event.target);
  if (!record) {
    return;
  }
  if (event.target.closest(".record-delete-button")) {
    event.preventDefault();
    openDeleteDialog(record);
    return;
  }
  openDetailModal(record, reuseRecord);
}

function onRecordGridKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const record = findRecordFromEventTarget(event.target);
  if (!record || event.target.closest(".record-delete-button")) {
    return;
  }
  event.preventDefault();
  openDetailModal(record, reuseRecord);
}

function bindEvents() {
  $("#refreshHistoryButton").addEventListener("click", () => refreshHistory({ preserveLoaded: false }));
  $("#quietModeButton")?.addEventListener("click", () => {
    state.videoPreviewQuiet = !state.videoPreviewQuiet;
    syncQuietModeButton();
    scheduleRecordViewportRender();
  });
  $("#videoHistoryModelFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modelVariant = event.target.value;
    await applyHistoryFilters();
  });
  $("#videoHistoryModeFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modeKey = event.target.value;
    await applyHistoryFilters();
  });
  $("#imageHistoryModelFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modelVariant = event.target.value;
    await applyHistoryFilters();
  });
  $("#imageHistoryModeFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modeKey = event.target.value;
    await applyHistoryFilters();
  });
  $("#recordsStage").addEventListener("scroll", onRecordsStageScroll, { passive: true });
  $("#recordsGrid").addEventListener("click", onRecordGridClick);
  $("#recordsGrid").addEventListener("keydown", onRecordGridKeydown);
  $("#generateButton").addEventListener("click", startGeneration);
  $("#clearButton").addEventListener("click", clearForm);
  $("#deleteTaskCloseButton").addEventListener("click", closeDeleteDialog);
  $("#deleteTaskOnlyButton").addEventListener("click", () => deleteTaskRecord(false));
  $("#deleteTaskWithOutputsButton").addEventListener("click", () => deleteTaskRecord(true));
  $("#deleteTaskModal").addEventListener("close", () => {
    state.deleteTarget = null;
  });
  document.addEventListener("visibilitychange", updateLiveRefreshLoop);
  window.addEventListener("resize", () => {
    scheduleRecordViewportRender();
    state.mention.layoutKey = null;
    renderPromptMirror();
  }, { passive: true });
  $("#promptInput").addEventListener("input", () => persistWorkspaceDraft());
  $("#modelVariant").addEventListener("change", () => {
    if (kind === "image") {
      syncImageModelOptions();
      syncImageMode();
    } else {
      syncVideoModelOptions({
        preferredScene: currentVideoScene(),
        preferredResolution: $("#videoResolution")?.value,
        preferredRatio: $("#videoRatio")?.value,
        preferredDuration: $("#videoDuration")?.value,
        showFallbackToast: true,
      });
      syncVideoScene();
      syncVideoWebSearch();
      syncVideoPricingHint();
    }
    persistWorkspaceDraft();
  });
  if (kind === "image") {
    $("#imageMode").addEventListener("change", () => {
      syncImageMode();
      persistWorkspaceDraft();
    });
    $("#imageAspectRatio").addEventListener("change", () => {
      syncImageModelOptions($("#imageAspectRatio").value);
      persistWorkspaceDraft();
    });
    $("#imageOutputFormat").addEventListener("change", () => {
      syncImageModelOptions($("#imageAspectRatio").value, $("#imageSize").value);
      persistWorkspaceDraft();
    });
    ["#imageSize", "#imageCount", "#imageSequential", "#imageQuality", "#imageBackground", "#imageModeration", "#imageOutputCompression", "#imageWebSearch"].forEach((selector) => {
      $(selector).addEventListener("change", () => persistWorkspaceDraft());
    });
  }
  if (kind === "video") {
    $("#videoSceneType").addEventListener("change", () => {
      syncVideoScene({ showResolutionFallbackToast: true });
      persistWorkspaceDraft();
    });
    $("#videoResolution").addEventListener("change", () => {
      syncVideoDurationOptions($("#videoDuration")?.value, { showFallbackToast: true });
      persistWorkspaceDraft();
    });
    ["#videoRatio", "#videoDuration", "#videoSeed", "#videoGenerateAudio", "#videoWebSearch"].forEach((selector) => {
      $(selector).addEventListener("change", () => persistWorkspaceDraft());
    });
    $("#videoReferenceOptionsToggle")?.addEventListener("click", () => {
      setVideoReferenceOptionsOpen(!state.videoReferenceOptionsOpen, { userInitiated: true });
    });
    ["#videoReferenceUrls", "#audioReferenceUrls"].forEach((selector) => {
      $(selector).addEventListener("input", () => {
        persistWorkspaceDraft();
      });
    });
  }
}

syncQuietModeButton = function syncQuietModeButton() {
  const button = $("#quietModeButton");
  if (!button) {
    return;
  }
  button.replaceChildren();
  const track = document.createElement("span");
  track.className = "preview-switch-track";
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("span");
  thumb.className = "preview-switch-thumb";
  track.appendChild(thumb);
  const label = document.createElement("span");
  label.className = "preview-switch-label";
  label.textContent = state.videoPreviewQuiet ? "动态预览 开" : "动态预览";
  button.append(track, label);
  button.classList.toggle("is-active", state.videoPreviewQuiet);
  button.setAttribute("aria-pressed", state.videoPreviewQuiet ? "true" : "false");
}

async function cancelRecord(record) {
  if (!record?.job_id || !canCancelRecord(record)) {
    return;
  }
  try {
    const snapshot = await fetchJson(`/api/jobs/${record.job_id}/cancel`, {
      method: "POST",
    });
    setStatus(snapshot?.message || "已请求取消");
    await refreshHistory({ preserveLoaded: true, silent: true });
  } catch (error) {
    showToast(String(error.message || error));
  }
}

async function deleteFailedHistoryRecords() {
  const button = $("#deleteFailedHistoryButton");
  if (button?.disabled) {
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = "删除中";
  }
  try {
    const result = await fetchJson(`/api/history/${kind}/delete-failed`, {
      method: "POST",
      body: JSON.stringify({ delete_outputs: true }),
    });
    const deletedIds = new Set(result.deleted_ids || []);
    if (deletedIds.size) {
      const nextHistory = state.history.filter((item) => !deletedIds.has(item.id));
      setHistoryState(nextHistory, {
        total: Math.max(0, state.total - Number(result.deleted || deletedIds.size)),
        nextOffset: Math.max(0, nextHistory.length),
        hasMore: state.hasMore,
      });
      renderRecords();
    }
    if (result.history_counts) {
      setHistoryCounts(result.history_counts);
    }
    const skipped = Number(result.skipped_active_count || 0);
    const skippedText = skipped ? `，跳过 ${skipped} 个仍在运行的任务` : "";
    showToast(`已删除 ${Number(result.deleted || 0)} 个失败任务${skippedText}`);
    await refreshHistory({ preserveLoaded: false, silent: true, forceFull: true });
  } catch (error) {
    showToast(String(error.message || error));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "删除失败";
    }
  }
}

createRecordCard = function createRecordCard(record = null) {
  const card = createElement("article", "record-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");

  const previewWrap = createElement("div", "record-card-preview");
  const previewSlot = createElement("div", "record-card-preview-slot");
  const statusChip = createElement("span", "record-status-chip");
  const modeChip = createElement("span", "video-mode-chip");
  modeChip.hidden = true;
  const elapsedPill = createElement("span", "elapsed-pill");
  const actionButton = createElement("button", "record-action-button", "删除");
  actionButton.type = "button";
  actionButton.hidden = true;
  previewWrap.append(previewSlot);

  const body = createElement("div", "record-card-body");
  const topMetaRow = createElement("div", "record-top-meta-row");
  topMetaRow.append(statusChip, modeChip, actionButton);
  const modelRow = createElement("div", "record-card-model-row");
  const modelNode = createElement("div", "record-card-model");
  modelRow.append(modelNode, elapsedPill);
  const timeNode = createElement("div", "record-card-time");
  const messageNode = createElement("div", "record-card-message");
  body.append(topMetaRow, modelRow, timeNode, messageNode);

  card.append(previewWrap, body);
  card.__recordRefs = {
    previewSlot,
    statusChip,
    modeChip,
    elapsedPill,
    actionButton,
    modelNode,
    timeNode,
    messageNode,
    topMetaRow,
    modelRow,
  };
  if (record) {
    card.dataset.historyId = record.id;
    updateRecordCard(card, record, null);
  }
  return card;
}

onRecordGridClick = function onRecordGridClick(event) {
  if (Date.now() < state.recordsWheelGuardUntil && !event.target.closest(".record-action-button")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const record = findRecordFromEventTarget(event.target);
  if (!record) {
    return;
  }
  const actionButton = event.target.closest(".record-action-button");
  if (!actionButton) {
    openDetailModal(record, reuseRecord);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const action = actionButton.dataset.action;
  if (action === "delete-record") {
    openDeleteDialog(record);
    return;
  }
  if (action === "cancel-record" && !actionButton.disabled) {
    cancelRecord(record);
  }
}

onRecordGridKeydown = function onRecordGridKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const record = findRecordFromEventTarget(event.target);
  if (!record || event.target.closest(".record-action-button")) {
    return;
  }
  event.preventDefault();
  openDetailModal(record, reuseRecord);
}

bindEvents = function bindEvents() {
  $("#refreshHistoryButton").addEventListener("click", () => refreshHistory({ preserveLoaded: false }));
  $("#deleteFailedHistoryButton")?.addEventListener("click", deleteFailedHistoryRecords);
  $("#quietModeButton")?.addEventListener("click", () => {
    state.videoPreviewQuiet = !state.videoPreviewQuiet;
    syncQuietModeButton();
    scheduleRecordViewportRender();
  });
  $("#videoHistoryModelFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modelVariant = event.target.value;
    await applyHistoryFilters();
  });
  $("#videoHistoryModeFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modeKey = event.target.value;
    await applyHistoryFilters();
  });
  $("#imageHistoryModelFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modelVariant = event.target.value;
    await applyHistoryFilters();
  });
  $("#imageHistoryModeFilter")?.addEventListener("change", async (event) => {
    state.historyFilters.modeKey = event.target.value;
    await applyHistoryFilters();
  });
  $("#recordsStage").addEventListener("scroll", onRecordsStageScroll, { passive: true });
  $("#recordsStage").addEventListener("wheel", onRecordsStageWheel, { passive: true });
  $("#recordsGrid").addEventListener("click", onRecordGridClick);
  $("#recordsGrid").addEventListener("keydown", onRecordGridKeydown);
  $("#generateButton").addEventListener("click", startGeneration);
  $("#clearButton").addEventListener("click", clearForm);
  $("#deleteTaskCloseButton").addEventListener("click", closeDeleteDialog);
  $("#deleteTaskOnlyButton").addEventListener("click", () => deleteTaskRecord(false));
  $("#deleteTaskWithOutputsButton").addEventListener("click", () => deleteTaskRecord(true));
  $("#deleteTaskModal").addEventListener("close", () => {
    state.deleteTarget = null;
  });
  document.addEventListener("visibilitychange", updateLiveRefreshLoop);
  window.addEventListener("resize", () => {
    scheduleRecordViewportRender();
    state.mention.layoutKey = null;
    renderPromptMirror();
  }, { passive: true });
  $("#promptInput").addEventListener("input", () => persistWorkspaceDraft());
  $("#modelVariant").addEventListener("change", () => {
    if (kind === "image") {
      syncImageModelOptions(null, null, {
        showModeFallbackToast: true,
        showAspectRatioFallbackToast: true,
        showSizeFallbackToast: true,
        showSequentialFallbackToast: true,
      });
      syncImageMode();
    } else {
      syncVideoModelOptions({
        preferredScene: currentVideoScene(),
        preferredResolution: $("#videoResolution")?.value,
        preferredRatio: $("#videoRatio")?.value,
        preferredDuration: $("#videoDuration")?.value,
        showFallbackToast: true,
      });
      syncVideoScene();
      syncVideoWebSearch();
      syncVideoPricingHint();
    }
    persistWorkspaceDraft();
  });
  if (kind === "image") {
    $("#imageMode").addEventListener("change", () => {
      syncImageMode();
      persistWorkspaceDraft();
    });
    $("#imageAspectRatio").addEventListener("change", () => {
      syncImageModelOptions($("#imageAspectRatio").value);
      persistWorkspaceDraft();
    });
    $("#imageOutputFormat").addEventListener("change", () => {
      syncImageModelOptions($("#imageAspectRatio").value, $("#imageSize").value);
      persistWorkspaceDraft();
    });
    ["#imageSize", "#imageCount", "#imageSequential", "#imageQuality", "#imageBackground", "#imageModeration", "#imageOutputCompression", "#imageWebSearch"].forEach((selector) => {
      $(selector).addEventListener("change", () => persistWorkspaceDraft());
    });
  }
  if (kind === "video") {
    $("#videoSceneType").addEventListener("change", () => {
      syncVideoScene({ showResolutionFallbackToast: true });
      persistWorkspaceDraft();
    });
    $("#videoResolution").addEventListener("change", () => {
      syncVideoDurationOptions($("#videoDuration")?.value, { showFallbackToast: true });
      syncVideoPricingHint();
      persistWorkspaceDraft();
    });
    ["#videoRatio", "#videoDuration", "#videoSeed", "#videoGenerateAudio", "#videoWebSearch"].forEach((selector) => {
      $(selector).addEventListener("change", () => {
        syncVideoPricingHint();
        persistWorkspaceDraft();
      });
    });
    $("#videoReferenceOptionsToggle")?.addEventListener("click", () => {
      setVideoReferenceOptionsOpen(!state.videoReferenceOptionsOpen, { userInitiated: true });
    });
    ["#videoReferenceUrls", "#audioReferenceUrls", "#trustedAssetUris"].forEach((selector) => {
      $(selector).addEventListener("input", () => {
        syncVideoPricingHint();
        persistWorkspaceDraft();
      });
    });
  }
}

function setHistoryCounts(nextCounts = {}) {
  const normalized = {
    image: Math.max(0, Number(nextCounts?.image || 0)),
    video: Math.max(0, Number(nextCounts?.video || 0)),
  };
  if (
    state.historyCounts.image === normalized.image
    && state.historyCounts.video === normalized.video
  ) {
    return;
  }
  state.historyCounts = normalized;
  state.filteredStatusCache.total = -1;
}

filteredStatusText = function filteredStatusText() {
  const cacheKey = historyFilterKey();
  if (
    state.filteredStatusCache.revision === state.historyRevision
    && state.filteredStatusCache.key === cacheKey
    && state.filteredStatusCache.total === state.total
  ) {
    return state.filteredStatusCache.text;
  }
  const records = filteredHistory();
  const liveRecords = records.filter((item) => item.is_live && !terminalStatuses.includes(item.status));
  let text = "";
  if (liveRecords.length) {
    const firstLive = liveRecords[0];
    if (hasHistoryFilters()) {
      text = firstLive?.message || `当前筛选下有 ${liveRecords.length} 个任务进行中`;
    } else {
      text = firstLive?.message || `当前有 ${liveRecords.length} 个任务进行中`;
    }
  } else if (hasHistoryFilters()) {
    text = `当前筛选命中 ${records.length} / ${state.total} 条记录`;
  } else if (!records.length) {
    text = buildCrossKindEmptyState(kind, state.historyCounts).statusText;
  } else {
    text = `当前资产包共有 ${state.total} 条记录`;
  }
  state.filteredStatusCache = {
    revision: state.historyRevision,
    key: cacheKey,
    total: state.total,
    text,
  };
  return text;
}

renderRecordViewport = function renderRecordViewport() {
  const grid = $("#recordsGrid");
  const topSpacer = $("#recordsTopSpacer");
  const bottomSpacer = $("#recordsBottomSpacer");
  const records = filteredHistory();
  if (!records.length) {
    clearRecordCardNodes();
    if (topSpacer) {
      topSpacer.style.height = "0px";
    }
    if (bottomSpacer) {
      bottomSpacer.style.height = "0px";
    }
    const emptyState = hasHistoryFilters()
      ? {
          message: "当前筛选条件下暂无任务记录",
          actionLabel: "",
          actionHref: "",
        }
      : buildCrossKindEmptyState(kind, state.historyCounts);
    const empty = createElement("div", "records-empty");
    const emptyBody = createElement("div", "records-empty-body");
    const emptyMessage = createElement("div", "records-empty-message", emptyState.message);
    emptyBody.appendChild(emptyMessage);
    if (emptyState.actionLabel && emptyState.actionHref) {
      const emptyAction = createElement("button", "ghost-button records-empty-action", emptyState.actionLabel);
      emptyAction.type = "button";
      emptyAction.addEventListener("click", () => {
        window.location.href = emptyState.actionHref;
      });
      emptyBody.appendChild(emptyAction);
    }
    empty.appendChild(emptyBody);
    ensureRecordCardPoolSize(0);
    state.recordCardNodes = new Map();
    grid.replaceChildren(empty);
    return;
  }
  const viewport = computeRecordViewport(records);
  const visibleRecords = records.slice(viewport.startIndex, viewport.endIndex);
  const emptyState = grid.querySelector(".records-empty");
  if (emptyState) {
    emptyState.remove();
  }
  ensureRecordCardPoolSize(visibleRecords.length);
  state.recordCardNodes = new Map();
  for (let index = 0; index < visibleRecords.length; index += 1) {
    const record = visibleRecords[index];
    const card = state.recordCardPool[index];
    const previousMeta = card.__recordMeta || null;
    card.dataset.historyId = record.id;
    updateRecordCard(card, record, previousMeta);
    state.recordCardNodes.set(record.id, card);
  }
  if (topSpacer) {
    topSpacer.style.height = `${viewport.topHeight}px`;
  }
  if (bottomSpacer) {
    bottomSpacer.style.height = `${viewport.bottomHeight}px`;
  }
  grid.style.gridTemplateColumns = `repeat(${viewport.columnCount}, minmax(0, 1fr))`;
}

refreshHistory = async function refreshHistory({ preserveLoaded = false, silent = false, forceFull = false } = {}) {
  const partialLiveRefresh = !forceFull && preserveLoaded && silent && state.history.length > pageSize;
  const limit = partialLiveRefresh
    ? pageSize
    : (preserveLoaded ? Math.max(state.nextOffset || pageSize, pageSize) : pageSize);
  const payload = await fetchHistoryPage({ limit, offset: 0, repair: !silent });
  let nextHistory = payload.items || [];
  if (partialLiveRefresh) {
    const previousPage = new Map(state.history.slice(0, pageSize).map((item) => [item.id, item]));
    nextHistory = nextHistory.map((item) => {
      const previous = previousPage.get(item.id);
      return historyRecordEquivalent(previous, item) ? previous : item;
    });
    const freshIds = new Set(nextHistory.map((item) => item.id));
    const tail = state.history.filter((item, index) => index >= pageSize && !freshIds.has(item.id));
    nextHistory = [...nextHistory, ...tail];
  }
  const total = payload.total || nextHistory.length;
  const nextOffset = preserveLoaded ? Math.max(state.nextOffset || 0, nextHistory.length) : nextHistory.length;
  const hasMore = nextOffset < total;
  setHistoryCounts(payload.history_counts || {});
  setHistoryState(nextHistory, {
    total,
    nextOffset,
    hasMore,
  });
  if (payload.repair_scheduled) {
    scheduleRepairRefresh();
  }
  renderRecords();
  if (hasHistoryFilters()) {
    await ensureFilteredHistoryLoaded();
  }
  if (!silent && !state.history.length) {
    setStatus(buildCrossKindEmptyState(kind, state.historyCounts).statusText);
  }
}

loadMoreHistory = async function loadMoreHistory() {
  if (!state.hasMore || state.loadingMore) {
    return;
  }
  state.loadingMore = true;
  try {
    const payload = await fetchHistoryPage({ limit: pageSize, offset: state.nextOffset, repair: false });
    const appended = [...state.history, ...(payload.items || [])];
    const total = payload.total || appended.length;
    const nextOffset = state.nextOffset + (payload.items || []).length;
    setHistoryCounts(payload.history_counts || {});
    setHistoryState(appended, {
      total,
      nextOffset,
      hasMore: nextOffset < total,
    });
    renderRecords();
  } catch (error) {
    showToast(String(error.message || error));
  } finally {
    state.loadingMore = false;
    if (shouldLoadMoreRecords()) {
      scheduleLoadMoreHistory();
    }
  }
}

function initialize() {
  applyRecordCardMetrics();
  applyPromptFontSize();
  bindEvents();
  bindPasteUpload();
  bindPromptMentions();
  syncPromptPlaceholder();
  syncQuietModeButton();

  if (kind === "image") {
    bindDropzone("#imagePrimaryDropzone", "#imagePrimaryFile", "imagePrimary", false);
    bindDropzone("#imageReferenceDropzone", "#imageReferenceFiles", "imageReferences", true);
    applyImageDefaults();
  } else {
    bindDropzone("#videoFirstDropzone", "#videoFirstFile", "videoFirst", false);
    bindDropzone("#videoLastDropzone", "#videoLastFile", "videoLast", false);
    bindDropzone("#videoReferenceDropzone", "#videoReferenceFiles", "videoReferences", true);
    applyVideoDefaults();
    syncVideoPricingHint();
  }

  restoreWorkspaceDraft();
  renderAllAssetLists();
  state.canPersistDraft = true;
  persistWorkspaceDraft();
  loadLibraryAssets({ silent: true });
  refreshHistory({ preserveLoaded: false, silent: true });
}

initialize();
