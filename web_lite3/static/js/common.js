const pageConfigNode = document.getElementById("page-config");
const videoSceneLabels = {
  text_only: "文生视频",
  first_frame: "首帧",
  first_last: "首尾帧",
  multimodal_reference: "参考素材",
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

export function getPageConfig() {
  if (!pageConfigNode) {
    return {};
  }
  return JSON.parse(pageConfigNode.textContent || "{}");
}

const config = getPageConfig();

function videoModelInfo(modelVariant) {
  const models = config.ui?.models || config.video_ui?.models || [];
  return models.find((item) => item.value === modelVariant) || null;
}

function videoSceneLabel(modeKey, modelVariant) {
  const normalizedKey = String(modeKey || "").trim() || "text_only";
  const model = videoModelInfo(String(modelVariant || "").trim());
  const modelScene = (model?.scenes || []).find((item) => item.value === normalizedKey);
  if (modelScene?.label) {
    return modelScene.label;
  }
  if (model?.scene_labels?.[normalizedKey]) {
    return model.scene_labels[normalizedKey];
  }
  const configuredScene = (config.ui?.scenes || config.video_ui?.scenes || [])
    .find((item) => item.value === normalizedKey);
  return configuredScene?.label || videoSceneLabels[normalizedKey] || normalizedKey;
}

export function $(selector) {
  return document.querySelector(selector);
}

export function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.detail || payload.message || message;
    } catch (error) {
      message = await response.text();
    }
    throw new Error(message);
  }
  return response.json();
}

export function showToast(message) {
  const layer = $("#toastLayer");
  if (!layer) {
    return;
  }
  const toast = createElement("div", "toast", message);
  layer.prepend(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 3000);
}

export function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function formatElapsed(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `t=${seconds.toFixed(1)}s`;
  }
  return `t=${Math.round(seconds)}s`;
}

export function formatRuntimeElapsed(value) {
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

export function applyTheme(theme) {
  const next = theme || "light";
  document.body.dataset.theme = next;
  document.documentElement.dataset.theme = next;
  localStorage.setItem("godreamai-plus-theme", next);
  window.dispatchEvent(new CustomEvent("godreamai-theme-change", { detail: { theme: next } }));
}

let activeCustomSelect = null;
let customSelectLayer = null;
let customSelectScanFrame = 0;

function customSelectLayerHost(select = null) {
  return select?.closest?.("dialog[open]") || document.body;
}

function selectedOptionLabel(select) {
  const option = select.options[select.selectedIndex];
  return String(option?.textContent || option?.label || select.value || "").trim();
}

function syncCustomSelect(select) {
  const wrap = select.closest(".custom-select-wrap");
  const button = wrap?.querySelector(".custom-select-button");
  if (!button) {
    return;
  }
  button.disabled = select.disabled;
  button.textContent = selectedOptionLabel(select) || "请选择";
  button.classList.toggle("is-empty", !select.value);
  button.setAttribute("aria-expanded", activeCustomSelect?.select === select ? "true" : "false");
}

function ensureCustomSelectLayer(select = null) {
  if (customSelectLayer) {
    const host = customSelectLayerHost(select);
    if (customSelectLayer.parentNode !== host) {
      host.append(customSelectLayer);
    }
    return customSelectLayer;
  }
  customSelectLayer = createElement("div", "custom-select-layer");
  customSelectLayer.hidden = true;
  customSelectLayerHost(select).append(customSelectLayer);
  return customSelectLayer;
}

function closeCustomSelect() {
  if (activeCustomSelect?.button) {
    activeCustomSelect.button.setAttribute("aria-expanded", "false");
  }
  activeCustomSelect = null;
  if (customSelectLayer) {
    customSelectLayer.hidden = true;
    customSelectLayer.innerHTML = "";
  }
}

function handleCustomSelectScroll(event) {
  const target = event.target;
  if (customSelectLayer && (target === customSelectLayer || customSelectLayer.contains(target))) {
    return;
  }
  closeCustomSelect();
}

function positionCustomSelectLayer() {
  if (!activeCustomSelect || !customSelectLayer) {
    return;
  }
  const rect = activeCustomSelect.button.getBoundingClientRect();
  const viewportPadding = 8;
  const verticalGap = 6;
  const menuWidth = Math.max(160, rect.width);
  const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding));
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - verticalGap);
  const spaceAbove = Math.max(0, rect.top - viewportPadding - verticalGap);
  const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
  const availableHeight = Math.max(120, openUpward ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(360, availableHeight);
  const rawTop = openUpward ? rect.top - verticalGap - maxHeight : rect.bottom + verticalGap;
  const top = Math.max(
    viewportPadding,
    Math.min(rawTop, window.innerHeight - viewportPadding - maxHeight),
  );
  customSelectLayer.dataset.placement = openUpward ? "top" : "bottom";
  customSelectLayer.style.left = `${Math.round(left)}px`;
  customSelectLayer.style.top = `${Math.round(top)}px`;
  customSelectLayer.style.width = `${Math.round(menuWidth)}px`;
  customSelectLayer.style.maxHeight = `${Math.round(maxHeight)}px`;
}

function chooseCustomSelectOption(select, option) {
  if (option.disabled) {
    return;
  }
  select.value = option.value;
  syncCustomSelect(select);
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  closeCustomSelect();
}

function openCustomSelect(select, button) {
  if (activeCustomSelect?.select === select) {
    closeCustomSelect();
    return;
  }
  closeCustomSelect();
  const layer = ensureCustomSelectLayer(select);
  layer.innerHTML = "";
  activeCustomSelect = { select, button };
  Array.from(select.options).forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-select-option";
    item.textContent = String(option.textContent || option.label || option.value || "").trim();
    item.disabled = option.disabled;
    item.dataset.value = option.value;
    if (option.selected) {
      item.classList.add("is-selected");
      item.setAttribute("aria-current", "true");
    }
    item.addEventListener("click", () => chooseCustomSelectOption(select, option));
    layer.append(item);
  });
  if (!layer.childElementCount) {
    const empty = createElement("div", "custom-select-empty", "暂无选项");
    layer.append(empty);
  }
  layer.hidden = false;
  button.setAttribute("aria-expanded", "true");
  positionCustomSelectLayer();
  const selectedItem = layer.querySelector(".custom-select-option.is-selected:not(:disabled)")
    || layer.querySelector(".custom-select-option:not(:disabled)");
  selectedItem?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  selectedItem?.focus?.({ preventScroll: true });
}

function enhanceCustomSelect(select) {
  if (
    !select
    || select.dataset.customSelectEnhanced === "true"
    || select.multiple
    || Number(select.size || 0) > 1
  ) {
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = "custom-select-wrap";
  select.parentNode.insertBefore(wrap, select);
  wrap.append(select);
  select.dataset.customSelectEnhanced = "true";
  select.classList.add("custom-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "custom-select-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    syncCustomSelect(select);
    openCustomSelect(select, button);
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      return;
    }
    event.preventDefault();
    syncCustomSelect(select);
    openCustomSelect(select, button);
  });
  wrap.append(button);

  const observer = new MutationObserver(() => syncCustomSelect(select));
  observer.observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden", "style", "class"],
  });
  select.addEventListener("change", () => syncCustomSelect(select));
  select.addEventListener("input", () => syncCustomSelect(select));
  syncCustomSelect(select);
}

function scanCustomSelects() {
  customSelectScanFrame = 0;
  document.querySelectorAll("select").forEach(enhanceCustomSelect);
  document.querySelectorAll("select.custom-select-native").forEach(syncCustomSelect);
}

function scheduleCustomSelectScan() {
  if (customSelectScanFrame) {
    return;
  }
  customSelectScanFrame = window.requestAnimationFrame(scanCustomSelects);
}

function initCustomSelects() {
  if (!document.body) {
    return;
  }
  scanCustomSelects();
  scheduleCustomSelectScan();
  const observer = new MutationObserver(scheduleCustomSelectScan);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (customSelectLayer?.contains(target) || target?.closest?.(".custom-select-wrap")) {
      return;
    }
    closeCustomSelect();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeCustomSelect();
    }
  });
  window.addEventListener("resize", () => {
    positionCustomSelectLayer();
    scheduleCustomSelectScan();
  }, { passive: true });
  window.addEventListener("scroll", handleCustomSelectScroll, true);
}

const SIDEBAR_WIDTH_STORAGE_KEY = "godreamai-plus-sidebar-width";
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;

function clampSidebarWidth(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 240;
  }
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(numeric)));
}

function setSidebarWidth(width) {
  const nextWidth = clampSidebarWidth(width);
  document.documentElement.style.setProperty("--sidebar-width", `${nextWidth}px`);
  const resizer = $("#sidebarResizer");
  if (resizer) {
    resizer.setAttribute("aria-valuenow", String(nextWidth));
  }
  return nextWidth;
}

function rememberSidebarWidth(width) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch (_error) {
    // Local storage can be unavailable in private or embedded contexts.
  }
}

function storedSidebarWidth() {
  try {
    return localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  } catch (_error) {
    return "";
  }
}

function initResizableSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const resizer = $("#sidebarResizer");
  if (!sidebar || !resizer) {
    return;
  }
  const stored = storedSidebarWidth();
  if (stored) {
    setSidebarWidth(stored);
  }
  let dragState = null;
  const startDrag = (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    if (window.matchMedia("(max-width: 760px)").matches) {
      return;
    }
    event.preventDefault();
    const rect = sidebar.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: rect.width,
    };
    document.body.classList.add("is-resizing-sidebar");
    resizer.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event) => {
    if (!dragState) {
      return;
    }
    const nextWidth = setSidebarWidth(dragState.startWidth + event.clientX - dragState.startX);
    rememberSidebarWidth(nextWidth);
  };
  const stopDrag = (event) => {
    if (!dragState) {
      return;
    }
    resizer.releasePointerCapture?.(dragState.pointerId || event.pointerId);
    dragState = null;
    document.body.classList.remove("is-resizing-sidebar");
  };
  resizer.addEventListener("pointerdown", startDrag);
  resizer.addEventListener("pointermove", moveDrag);
  resizer.addEventListener("pointerup", stopDrag);
  resizer.addEventListener("pointercancel", stopDrag);
  resizer.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const current = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"), 10) || 240;
    const next = event.key === "Home"
      ? SIDEBAR_MIN_WIDTH
      : event.key === "End"
        ? SIDEBAR_MAX_WIDTH
        : current + (event.key === "ArrowRight" ? 16 : -16);
    rememberSidebarWidth(setSidebarWidth(next));
  });
}

if (!window.__godreamaiSidebarResizeInitialized) {
  window.__godreamaiSidebarResizeInitialized = true;
  initResizableSidebar();
}

if (!window.__godreamaiCustomSelectsInitialized) {
  window.__godreamaiCustomSelectsInitialized = true;
  initCustomSelects();
}

function videoModeInfo(record) {
  const modeKey = String(record?.params_requested?.scene_type || "text_only").trim() || "text_only";
  const modelVariant = String(record?.model_variant || record?.params_requested?.model_variant || "").trim();
  return {
    key: modeKey,
    label: videoSceneLabel(modeKey, modelVariant),
  };
}

const imageModeLabels = {
  text_only: "文生图",
  base_only: "基础图",
  reference_only: "参考图",
  image_edit: "图像编辑",
  multi_image: "多图合成",
};

function imageModelInfo(modelVariant) {
  return (config.ui?.models || []).find((item) => item.value === modelVariant) || null;
}

function imageProvider(record) {
  const modelVariant = String(record?.model_variant || "").trim();
  return imageModelInfo(modelVariant)?.provider || "volcengine";
}

function normalizeAssetNameList(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizedImageModeKey(record) {
  const params = record?.params_requested || {};
  const model = imageModelInfo(String(record?.model_variant || "").trim());
  const supportedModes = Array.isArray(model?.modes) ? model.modes.map((item) => item.value) : [];
  const explicit = String(record?.mode_key || "").trim();
  if (explicit && supportedModes.includes(explicit)) {
    return explicit;
  }
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

function classifyImageMode(record) {
  return normalizedImageModeKey(record);
}

function imageModeInfo(record) {
  const modeKey = classifyImageMode(record);
  const model = imageModelInfo(String(record?.model_variant || "").trim());
  const configuredLabel = (model?.modes || []).find((item) => item.value === modeKey)?.label;
  return {
    key: modeKey,
    label: configuredLabel || imageModeLabels[modeKey] || modeKey,
    provider: imageProvider(record),
  };
}

function imageDetailFields(record) {
  const params = record?.params_requested || {};
  const inputName = String(params.input_asset_name || "").trim();
  const referenceNames = normalizeAssetNameList(params.reference_asset_names);
  return [
    ["基础图名称", inputName || "-"],
    ["参考图名称", referenceNames.length ? referenceNames.join("、") : "-"],
  ];
}

function formatBooleanLabel(value) {
  return value ? "是" : "否";
}

function appendDetailPair(block, key, value, className = "") {
  const label = createElement("strong", "", key);
  const content = createElement("div", className, value || "-");
  block.append(label, content);
  return content;
}

export function openDetailModal(record, onReuse) {
  const dialog = $("#detailModal");
  const title = $("#detailTitle");
  const meta = $("#detailMeta");
  const body = $("#detailBody");
  const closeButton = $("#detailCloseButton");
  const reuseButton = $("#detailReuseButton");
  const fullscreenButton = $("#detailFullscreenButton");
  const providerDeleteButton = $("#detailProviderDeleteButton");

  const statusLabel = statusLabels[record.status] || record.status;
  title.textContent = `${record.model_variant} · ${statusLabel}`;
  meta.textContent = `${formatDate(record.created_at)} · ${record.kind}`;
  body.innerHTML = "";

  const artifacts = record.result_payload?.artifacts || [];
  const stage = createElement("div", "detail-stage");
  const mediaStage = createElement("div", "detail-media-stage");
  const infoStage = createElement("div", "detail-info-stage");

  let primaryMedia = null;
  if (artifacts.length) {
    const artifact = artifacts[0];
    if (artifact.kind === "video") {
      const video = document.createElement("video");
      video.className = "detail-primary-media";
      video.controls = true;
      video.preload = "metadata";
      video.src = artifact.public_url || artifact.source_url;
      mediaStage.appendChild(video);
      primaryMedia = video;
    } else {
      const image = document.createElement("img");
      image.className = "detail-primary-media";
      image.alt = "artifact";
      image.src = artifact.public_url || artifact.source_url;
      mediaStage.appendChild(image);
      primaryMedia = image;
    }
  } else {
    mediaStage.appendChild(createElement("div", "detail-empty-media", "当前任务暂无可展示结果"));
  }

  const block = createElement("div", "detail-kv");
  const params = record.params_requested || {};
  appendDetailPair(block, "提示词", record.prompt);
  appendDetailPair(block, "状态", statusLabel);
  if (record.kind === "video") {
    const mode = videoModeInfo(record);
    const modeBadge = createElement("span", `video-mode-chip is-${mode.key}`, mode.label);
    const modeValue = createElement("div", "detail-inline-chip");
    modeValue.appendChild(modeBadge);
    block.append(createElement("strong", "", "模式"), modeValue);
    appendDetailPair(block, "分辨率", params.resolution_grade || "-");
    appendDetailPair(block, "AR", params.ratio || "-");
    appendDetailPair(block, "时长", params.duration ? `${params.duration} 秒` : "-");
    appendDetailPair(block, "Seed", params.seed ?? "-");
    appendDetailPair(block, "生成音频", formatBooleanLabel(params.generate_audio !== false));
    appendDetailPair(block, "联网搜索", formatBooleanLabel(Boolean(params.enable_web_search)));
    if (mode.key === "first_frame") {
      appendDetailPair(block, "首帧名称", params.first_frame_asset_name || "-");
    }
    if (mode.key === "first_last") {
      appendDetailPair(block, "首帧名称", params.first_frame_asset_name || "-");
      appendDetailPair(block, "尾帧名称", params.last_frame_asset_name || "-");
    }
    if (mode.key === "multimodal_reference") {
      appendDetailPair(
        block,
        "参考图名称",
        Array.isArray(params.reference_image_asset_names) && params.reference_image_asset_names.length
          ? params.reference_image_asset_names.join("、")
          : "-",
      );
      appendDetailPair(
        block,
        "参考视频 URL",
        Array.isArray(params.reference_video_urls) && params.reference_video_urls.length
          ? params.reference_video_urls.join("\n")
          : "-",
      );
      appendDetailPair(
        block,
        "参考音频 URL",
        Array.isArray(params.reference_audio_urls) && params.reference_audio_urls.length
          ? params.reference_audio_urls.join("\n")
          : "-",
      );
      appendDetailPair(
        block,
        "可信素材 URI",
        Array.isArray(params.trusted_asset_uris) && params.trusted_asset_uris.length
          ? params.trusted_asset_uris.join("\n")
          : "-",
      );
    }
  } else if (record.kind === "image") {
    const mode = imageModeInfo(record);
    const modeBadge = createElement("span", `video-mode-chip is-image-${mode.key}`, mode.label);
    const modeValue = createElement("div", "detail-inline-chip");
    modeValue.appendChild(modeBadge);
    block.append(createElement("strong", "", "模式"), modeValue);
    for (const [label, value] of imageDetailFields(record)) {
      appendDetailPair(block, label, value);
    }
  }
  appendDetailPair(block, "模型", record.model_variant);
  appendDetailPair(block, "创建时间", formatDate(record.created_at));
  appendDetailPair(
    block,
    "生成时间",
    record.is_live ? (formatRuntimeElapsed(record.elapsed_ms) || "-") : (formatElapsed(record.elapsed_ms) || "-"),
  );
  appendDetailPair(block, "错误信息", record.error_message || "-");
  infoStage.appendChild(block);

  if (artifacts.length > 1) {
    const rail = createElement("div", "detail-thumb-rail");
    for (const artifact of artifacts) {
      const button = createElement("button", "detail-thumb-button");
      button.type = "button";
      const thumb = artifact.kind === "video" ? document.createElement("video") : document.createElement("img");
      thumb.className = "detail-thumb-media";
      thumb.src = artifact.thumbnail_url || artifact.public_url || artifact.source_url;
      if (artifact.kind === "video") {
        thumb.muted = true;
        thumb.playsInline = true;
        thumb.preload = "metadata";
      } else {
        thumb.alt = "artifact";
      }
      button.appendChild(thumb);
      button.onclick = () => {
        if (!primaryMedia) {
          return;
        }
        primaryMedia.src = artifact.public_url || artifact.source_url;
      };
      rail.appendChild(button);
    }
    infoStage.appendChild(rail);
  }

  stage.append(mediaStage, infoStage);
  body.appendChild(stage);

  closeButton.onclick = () => dialog.close();
  if (providerDeleteButton) {
    const remoteTaskId = String(record?.params_actual?.remote_task_id || "").trim();
    providerDeleteButton.hidden = !(record.kind === "video" && remoteTaskId);
    providerDeleteButton.disabled = false;
    providerDeleteButton.onclick = async () => {
      providerDeleteButton.disabled = true;
      try {
        const payload = await fetchJson(`/api/history/${record.id}/provider-delete`, {
          method: "POST",
        });
        showToast(payload.action === "delete" ? "已删除远端任务" : "已请求取消远端任务");
        dialog.close();
      } catch (error) {
        showToast(String(error?.message || error));
      } finally {
        providerDeleteButton.disabled = false;
      }
    };
  }
  reuseButton.disabled = false;
  reuseButton.onclick = async () => {
    if (typeof onReuse !== "function") {
      dialog.close();
      return;
    }
    reuseButton.disabled = true;
    try {
      await onReuse(record);
      dialog.close();
    } catch (error) {
      showToast(String(error?.message || error));
    } finally {
      reuseButton.disabled = false;
    }
  };
  fullscreenButton.onclick = async () => {
    if (!primaryMedia) {
      return;
    }
    if (typeof primaryMedia.requestFullscreen === "function") {
      await primaryMedia.requestFullscreen();
      return;
    }
    const source = primaryMedia.currentSrc || primaryMedia.src;
    if (source) {
      window.open(source, "_blank", "noopener");
    }
  };
  dialog.showModal();
}

applyTheme(document.body.dataset.theme || getPageConfig().settings?.theme || "light");
