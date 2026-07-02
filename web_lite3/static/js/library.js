import { $, createElement, fetchJson, getPageConfig, showToast } from "/static/js/common.js";
import { applyLibraryCardMode, getLibraryCardMode, resetLibraryCardMode } from "/static/js/library_card_modes.js";

const config = getPageConfig();

const statusNode = $("#libraryStatusText");
const sourceMetaNode = $("#librarySourceMeta");
const sectionsNode = $("#librarySections");
const pickSourceButton = $("#pickLibrarySourceButton");
const refreshSourceButton = $("#refreshLibrarySourceButton");
const previewDialog = $("#libraryPreviewModal");
const previewTitleNode = $("#libraryPreviewTitle");
const previewMetaNode = $("#libraryPreviewMeta");
const previewImageNode = $("#libraryPreviewImage");
const previewCloseButton = $("#libraryPreviewCloseButton");

const PAGE_SIZE = 120;
const GRID_MIN_WIDTH = 160;
const GRID_GAP = 12;
const CARD_HEIGHT = 312;
const ROW_SPAN = CARD_HEIGHT + GRID_GAP;
const OVERSCAN_ROWS = 2;
const PREFETCH_ROWS = 4;
const SECTION_LOAD_AHEAD_PX = 720;

const state = {
  source: null,
  isBusy: false,
  lastError: "",
  categories: Array.isArray(config.asset_tag_categories) ? config.asset_tag_categories : [],
  categoryCounts: {},
  categoryStates: new Map(),
  totalItems: 0,
  viewportFrame: 0,
  resizeObserver: null,
};

const originLabels = {
  workspace: "\u6765\u6e90\uff1a\u751f\u6210\u9762\u677f",
  library: "\u6765\u6e90\uff1a\u7d20\u6750\u5e93\u4e0a\u4f20",
  library_upload: "\u6765\u6e90\uff1a\u7d20\u6750\u5e93\u4e0a\u4f20",
  library_source: "\u6765\u6e90\uff1a\u672c\u5730\u7d20\u6750\u5e93\u955c\u50cf",
};

const originBadgeClasses = {
  workspace: "is-workspace",
  library: "is-library-upload",
  library_upload: "is-library-upload",
  library_source: "is-library-source",
};

function iconSvg(kind) {
  if (kind === "save") {
    return `
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M4 3.5h9l3.5 3.5v9A1.5 1.5 0 0 1 15 17.5H5A1.5 1.5 0 0 1 3.5 16V5A1.5 1.5 0 0 1 5 3.5z"/>
        <path d="M7 3.5v4h5v-4"/>
        <path d="M7 12.5h6"/>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4.5 6.5h11"/>
      <path d="M7.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 12.5 5v1.5"/>
      <path d="M6.5 6.5l.8 9a1.5 1.5 0 0 0 1.5 1.4h2.4a1.5 1.5 0 0 0 1.5-1.4l.8-9"/>
      <path d="M8.5 9.5v4.5"/>
      <path d="M11.5 9.5v4.5"/>
    </svg>
  `;
}

function createIconButton(kind, label, onClick) {
  const button = document.createElement("button");
  button.className = `library-icon-button is-${kind}`;
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = iconSvg(kind);
  button.onclick = onClick;
  return button;
}

function normalizeCategories(values) {
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

function categorySemanticTerms(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return new Set();
  }
  const terms = new Set([normalized]);
  const chineseIndex = [...normalized].findIndex((char) => /[\u4e00-\u9fff]/.test(char));
  const semantic = (chineseIndex >= 0 ? normalized.slice(chineseIndex) : normalized).replace(/^[_\-\s]+|[_\-\s]+$/g, "");
  if (semantic) {
    terms.add(semantic);
  }
  for (const term of Array.from(terms)) {
    const stripped = term.replace(/\u7d20\u6750$/, "").trim();
    if (stripped) {
      terms.add(stripped);
    }
  }
  const expanded = new Set(terms);
  for (const term of terms) {
    if (term === "\u89d2\u8272" || term === "\u4eba\u7269") {
      expanded.add("\u89d2\u8272");
      expanded.add("\u4eba\u7269");
    } else if (term === "\u73af\u5883" || term === "\u573a\u666f") {
      expanded.add("\u73af\u5883");
      expanded.add("\u573a\u666f");
    } else if (term === "\u9053\u5177" || term === "\u7269\u4ef6") {
      expanded.add("\u9053\u5177");
      expanded.add("\u7269\u4ef6");
    } else if (term === "\u5176\u4ed6" || term === "\u6742\u9879") {
      expanded.add("\u5176\u4ed6");
      expanded.add("\u6742\u9879");
    }
  }
  return expanded;
}

function currentCategories() {
  const categories = normalizeCategories(state.categories);
  state.categories = categories;
  return categories;
}

function resolveRuntimeCategory(value, runtimeCategories = currentCategories()) {
  const normalized = String(value || "").trim();
  if (!normalized || !runtimeCategories.length) {
    return normalized;
  }
  if (runtimeCategories.includes(normalized)) {
    return normalized;
  }
  const valueTerms = categorySemanticTerms(normalized);
  let bestCategory = "";
  let bestScore = 0;
  for (const category of runtimeCategories) {
    const categoryTerms = categorySemanticTerms(category);
    const overlap = Array.from(valueTerms).filter((item) => categoryTerms.has(item));
    let score = overlap.length ? 100 + Math.max(...overlap.map((item) => item.length)) : 0;
    if (!score) {
      for (const left of valueTerms) {
        for (const right of categoryTerms) {
          if (left.length < 2 || right.length < 2) {
            continue;
          }
          if (left.includes(right) || right.includes(left)) {
            score = Math.max(score, 10 + Math.min(left.length, right.length));
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestScore > 0 ? bestCategory : normalized;
}

function normalizeLibraryItem(item) {
  return {
    ...item,
    tag_category: resolveRuntimeCategory(item?.tag_category),
  };
}

function buildSectionState(category, total) {
  return {
    category,
    total,
    items: new Array(total),
    loadedCount: 0,
    pagesLoaded: new Set(),
    inFlightPages: new Map(),
    loadError: "",
    revision: 0,
    lastRenderSignature: "",
    sectionNode: null,
    shellNode: null,
    windowNode: null,
    footerNode: null,
    cardPool: [],
  };
}

function updateTotalItems() {
  const categories = currentCategories();
  state.totalItems = categories.reduce((sum, category) => sum + Number(state.categoryCounts[category] || 0), 0);
}

function describeIdleStatus() {
  if (!currentCategories().length) {
    return "\u8bf7\u5148\u8fde\u63a5\u5e76\u5237\u65b0\u672c\u5730\u7d20\u6750\u5e93\u4ee5\u5efa\u7acb\u5206\u7c7b";
  }
  if (state.totalItems > 0) {
    return `\u5f53\u524d\u8d44\u4ea7\u5305\u5171\u6709 ${state.totalItems} \u9879\u7d20\u6750`;
  }
  if (state.source?.source_dir) {
    return "\u5f53\u524d\u8d44\u4ea7\u5305\u6682\u65e0\u7d20\u6750\uff0c\u5f53\u524d\u7d20\u6750\u5e93\u5df2\u540c\u6b65\uff0c\u53ef\u70b9\u51fb\u201c\u5237\u65b0\u201d\u91cd\u65b0\u5bf9\u8d26\u3002";
  }
  return "\u6309\u5f53\u524d\u8d44\u4ea7\u5305\u9694\u79bb\u7ba1\u7406";
}

function setStatus(message = "") {
  if (!statusNode) {
    return;
  }
  statusNode.textContent = message || describeIdleStatus();
}

function setBusyState(isBusy, message = "") {
  state.isBusy = isBusy;
  if (isBusy) {
    state.lastError = "";
    setStatus(message || "\u6b63\u5728\u52a0\u8f7d\u7d20\u6750\u5e93\u2026");
    return;
  }
  setStatus(state.lastError);
}

function setErrorState(message) {
  state.lastError = String(message || "").trim();
  setStatus(state.lastError || "\u7d20\u6750\u5e93\u52a0\u8f7d\u5931\u8d25");
}

function renderSourceMeta() {
  if (!sourceMetaNode) {
    return;
  }
  const sourceDir = state.source?.source_dir || "";
  if (!sourceDir) {
    sourceMetaNode.textContent = "\u5f53\u524d\u672a\u8fde\u63a5\u672c\u5730\u7d20\u6750\u5e93\u3002\u9009\u62e9\u8def\u5f84\u540e\u4f1a\u7acb\u5373\u540c\u6b65\u5230\u5f53\u524d\u8d44\u4ea7\u5305 source \u76ee\u5f55\u3002";
    return;
  }
  const lastRefreshedAt = state.source?.last_refreshed_at || "";
  const refreshedText = lastRefreshedAt ? ` \u00b7 \u4e0a\u6b21\u5237\u65b0\uff1a${lastRefreshedAt}` : " \u00b7 \u5c1a\u672a\u5237\u65b0";
  sourceMetaNode.textContent = `\u7d20\u6750\u8def\u5f84\uff1a${sourceDir}${refreshedText}`;
}

function closePreview() {
  if (previewDialog?.open) {
    previewDialog.close();
  }
}

function openPreview(item) {
  if (!previewDialog || !previewTitleNode || !previewMetaNode || !previewImageNode) {
    return;
  }
  previewTitleNode.textContent = item.display_name || item.original_name || "\u7d20\u6750\u9884\u89c8";
  previewMetaNode.innerHTML = "";
  const originBadge = createElement(
    "span",
    `library-card-meta ${originBadgeClasses[item.origin] || "is-unknown"}`,
    originLabels[item.origin] || `\u6765\u6e90\uff1a${item.origin || "\u672a\u77e5"}`,
  );
  previewMetaNode.appendChild(originBadge);
  previewImageNode.src = item.public_url;
  previewImageNode.alt = item.display_name || item.original_name || item.id;
  previewDialog.showModal();
}

async function loadSource() {
  const payload = await fetchJson("/api/library/source");
  state.source = payload.source || null;
  renderSourceMeta();
}

function rebuildCategoryStates() {
  const nextStates = new Map();
  for (const category of currentCategories()) {
    nextStates.set(category, buildSectionState(category, Number(state.categoryCounts[category] || 0)));
  }
  state.categoryStates = nextStates;
}

async function loadLibrarySummary() {
  const payload = await fetchJson("/api/library/assets?limit=0&include_category_counts=1");
  state.categories = normalizeCategories(payload.categories);
  const counts = payload.category_counts && typeof payload.category_counts === "object" ? payload.category_counts : {};
  state.categoryCounts = {};
  for (const category of currentCategories()) {
    state.categoryCounts[category] = Number(counts[category] || 0);
  }
  updateTotalItems();
  if (typeof payload.total === "number") {
    state.totalItems = payload.total;
  }
  rebuildCategoryStates();
  state.lastError = "";
  renderSections();
}

async function uploadCategory(category, files) {
  const formData = new FormData();
  formData.append("tag_category", category);
  const names = [];
  files.forEach((file) => {
    formData.append("files", file);
    names.push(file.name.replace(/\.[^/.]+$/, ""));
  });
  formData.append("names", JSON.stringify(names));
  const response = await fetch("/api/library/assets", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

async function saveItem(item, displayName) {
  await fetchJson(`/api/assets/${item.id}/metadata`, {
    method: "PATCH",
    body: JSON.stringify({
      display_name: displayName.trim() || item.display_name,
      tag_category: item.tag_category,
      origin: item.origin,
      library_visible: true,
    }),
  });
  await loadLibrarySummary();
}

async function deleteItem(item) {
  const payload = await fetchJson(`/api/library/assets/${item.id}`, {
    method: "DELETE",
  });
  await loadLibrarySummary();
  return payload;
}

async function pickSourceDirectory() {
  const result = await fetchJson("/api/system/pick-directory", {
    method: "POST",
    body: JSON.stringify({
      initial_dir: state.source?.source_dir || "",
      prompt: "\u9009\u62e9\u672c\u5730\u7d20\u6750\u5e93\u8def\u5f84",
    }),
  });
  return result.selected_dir || result.storage_dir || "";
}

function buildCategoryPageUrl(category, offset) {
  const params = new URLSearchParams({
    tag_category: category,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  return `/api/library/assets?${params.toString()}`;
}

function sectionLoadedLabel(sectionState) {
  if (!sectionState.total) {
    return "";
  }
  if (sectionState.loadedCount >= sectionState.total) {
    return `\u5171 ${sectionState.total} \u9879`;
  }
  return `\u5df2\u52a0\u8f7d ${sectionState.loadedCount}/${sectionState.total} \u9879`;
}

function updateSectionStatus(sectionState) {
  if (!sectionState.footerNode) {
    return;
  }
  if (sectionState.loadError) {
    sectionState.footerNode.textContent = sectionState.loadError;
    return;
  }
  const base = sectionLoadedLabel(sectionState);
  if (sectionState.inFlightPages.size > 0) {
    sectionState.footerNode.textContent = base ? `${base}\uff0c\u7ee7\u7eed\u52a0\u8f7d\u4e2d\u2026` : "\u6b63\u5728\u52a0\u8f7d\u2026";
    return;
  }
  sectionState.footerNode.textContent = base;
}

function computeColumns(width) {
  if (!width || !Number.isFinite(width)) {
    return 1;
  }
  return Math.max(1, Math.floor((width + GRID_GAP) / (GRID_MIN_WIDTH + GRID_GAP)));
}

function computeSectionMetrics(sectionState) {
  const width = sectionState.shellNode?.clientWidth || sectionState.sectionNode?.clientWidth || 0;
  const columns = computeColumns(width);
  const totalRows = Math.max(1, Math.ceil(sectionState.total / columns));
  const totalHeight = (totalRows * CARD_HEIGHT) + (Math.max(0, totalRows - 1) * GRID_GAP);
  if (sectionState.shellNode) {
    sectionState.shellNode.style.height = `${totalHeight}px`;
  }
  return {
    columns,
    totalRows,
    totalHeight,
  };
}

function clearSectionWindow(sectionState) {
  sectionState.lastRenderSignature = "";
}

function computeVisibleRange(sectionState, metrics, containerRect) {
  if (!sectionState.shellNode || !sectionState.total) {
    return null;
  }
  const bodyRect = sectionState.shellNode.getBoundingClientRect();
  if (bodyRect.bottom < containerRect.top - SECTION_LOAD_AHEAD_PX || bodyRect.top > containerRect.bottom + SECTION_LOAD_AHEAD_PX) {
    return null;
  }
  if (bodyRect.top >= containerRect.bottom) {
    const endRow = Math.min(metrics.totalRows, PREFETCH_ROWS);
    return {
      startIndex: 0,
      endIndex: Math.min(sectionState.total, endRow * metrics.columns),
      translateY: 0,
      columns: metrics.columns,
    };
  }
  if (bodyRect.bottom <= containerRect.top) {
    return null;
  }
  const topPx = Math.max(0, Math.min(metrics.totalHeight, containerRect.top - bodyRect.top));
  const bottomPx = Math.max(topPx, Math.min(metrics.totalHeight, containerRect.bottom - bodyRect.top));
  const startRow = Math.max(0, Math.floor(topPx / ROW_SPAN) - OVERSCAN_ROWS);
  const endRow = Math.min(metrics.totalRows, Math.ceil(bottomPx / ROW_SPAN) + OVERSCAN_ROWS);
  return {
    startIndex: startRow * metrics.columns,
    endIndex: Math.min(sectionState.total, endRow * metrics.columns),
    translateY: startRow * ROW_SPAN,
    columns: metrics.columns,
  };
}

function buildLibraryCardShell() {
  const card = createElement("div", "library-card");
  const media = document.createElement("button");
  media.className = "library-card-media";
  media.type = "button";

  const image = document.createElement("img");
  image.className = "library-card-thumb";
  image.loading = "lazy";
  image.decoding = "async";

  const mediaPlaceholder = createElement("div", "library-card-media library-card-media-placeholder");
  mediaPlaceholder.hidden = true;
  media.append(image, mediaPlaceholder);

  const body = createElement("div", "library-card-body");
  const nameInput = document.createElement("input");
  nameInput.className = "library-card-name";
  const nameReadonly = createElement("div", "library-card-name-readonly");
  const meta = createElement("div", "library-card-meta");
  const actions = createElement("div", "library-card-actions");
  const saveButton = createIconButton("save", "\u4fdd\u5b58\u540d\u79f0", async () => {
    const item = card.__item;
    if (!item) {
      return;
    }
    try {
      setBusyState(true, "\u6b63\u5728\u4fdd\u5b58\u7d20\u6750\u540d\u79f0\u2026");
      await saveItem(item, nameInput.value);
      showToast("\u540d\u79f0\u5df2\u66f4\u65b0");
    } catch (error) {
      setErrorState("\u7d20\u6750\u540d\u79f0\u4fdd\u5b58\u5931\u8d25");
      showToast(String(error.message || error));
    } finally {
      setBusyState(false);
    }
  });
  const deleteButton = createIconButton("delete", "\u5220\u9664", async () => {
    const item = card.__item;
    if (!item) {
      return;
    }
    try {
      setBusyState(true, "\u6b63\u5728\u5220\u9664\u7d20\u6750\u2026");
      const result = await deleteItem(item);
      showToast(result.warning || "\u7d20\u6750\u5df2\u5220\u9664");
    } catch (error) {
      setErrorState("\u7d20\u6750\u5220\u9664\u5931\u8d25");
      showToast(String(error.message || error));
    } finally {
      setBusyState(false);
    }
  });
  actions.append(saveButton, deleteButton);

  const placeholderBody = createElement("div", "library-card-body");
  const linePrimary = createElement("div", "library-placeholder-line is-primary");
  const lineSecondary = createElement("div", "library-placeholder-line");
  const lineMeta = createElement("div", "library-placeholder-line is-meta");
  placeholderBody.append(linePrimary, lineSecondary, lineMeta);
  placeholderBody.hidden = true;

  body.append(nameInput, nameReadonly, meta, actions);
  card.append(media, body);
  card.appendChild(placeholderBody);
  card.__refs = {
    media,
    image,
    mediaPlaceholder,
    body,
    nameInput,
    nameReadonly,
    meta,
    actions,
    placeholderBody,
    saveButton,
    deleteButton,
  };
  return card;
}

function updateLibraryCard(card, item) {
  const refs = card.__refs;
  if (!refs) {
    return;
  }
  card.__item = item || null;
  if (!item) {
    card.classList.add("is-placeholder");
    resetLibraryCardMode(card);
    refs.body.hidden = true;
    refs.placeholderBody.hidden = false;
    refs.media.disabled = true;
    refs.media.title = "";
    refs.media.setAttribute("aria-label", "\u6b63\u5728\u52a0\u8f7d\u7d20\u6750");
    refs.mediaPlaceholder.hidden = false;
    refs.image.hidden = true;
    refs.image.removeAttribute("src");
    refs.image.alt = "";
    refs.media.onclick = null;
    return;
  }

  const cardMode = getLibraryCardMode(item);
  const mediaUrl = item.thumbnail_url || item.public_url;
  card.classList.remove("is-placeholder");
  refs.body.hidden = false;
  refs.placeholderBody.hidden = true;
  refs.media.disabled = false;
  refs.media.title = "\u70b9\u51fb\u67e5\u770b\u5927\u56fe";
  refs.media.setAttribute("aria-label", `\u67e5\u770b\u7d20\u6750\u5927\u56fe\uff1a${item.display_name || item.original_name || item.id}`);
  refs.mediaPlaceholder.hidden = true;
  refs.image.hidden = false;
  refs.image.alt = item.display_name || item.original_name || item.id;
  if (refs.image.src !== mediaUrl) {
    refs.image.src = mediaUrl;
  }
  refs.media.onclick = () => openPreview(item);

  applyLibraryCardMode(card, refs, cardMode);
  refs.nameReadonly.textContent = item.display_name || "";
  refs.nameInput.value = item.display_name || "";
  refs.meta.className = `library-card-meta ${originBadgeClasses[item.origin] || "is-unknown"}`;
  refs.meta.textContent = originLabels[item.origin] || `\u6765\u6e90\uff1a${item.origin || "\u672a\u77e5"}`;
}

function ensureSectionPoolSize(sectionState, count) {
  if (!sectionState.windowNode) {
    return;
  }
  while (sectionState.cardPool.length < count) {
    const card = buildLibraryCardShell();
    sectionState.cardPool.push(card);
    sectionState.windowNode.appendChild(card);
  }
  while (sectionState.cardPool.length > count) {
    const card = sectionState.cardPool.pop();
    card?.remove();
  }
}

function renderSectionWindow(sectionState, range) {
  if (!sectionState.windowNode || !sectionState.total) {
    return;
  }
  if (range.endIndex <= range.startIndex) {
    clearSectionWindow(sectionState);
    return;
  }
  const signature = `${range.startIndex}:${range.endIndex}:${range.columns}:${sectionState.revision}`;
  if (signature === sectionState.lastRenderSignature) {
    return;
  }
  const visibleCount = Math.max(0, range.endIndex - range.startIndex);
  ensureSectionPoolSize(sectionState, visibleCount);
  for (let index = 0; index < visibleCount; index += 1) {
    const card = sectionState.cardPool[index];
    const item = sectionState.items[range.startIndex + index];
    updateLibraryCard(card, item || null);
  }
  sectionState.windowNode.style.transform = `translateY(${range.translateY}px)`;
  sectionState.lastRenderSignature = signature;
}

async function ensureCategoryPage(sectionState, pageIndex) {
  if (!sectionState.total) {
    return;
  }
  const maxPage = Math.max(0, Math.ceil(sectionState.total / PAGE_SIZE) - 1);
  if (pageIndex < 0 || pageIndex > maxPage) {
    return;
  }
  if (sectionState.pagesLoaded.has(pageIndex)) {
    return;
  }
  const pending = sectionState.inFlightPages.get(pageIndex);
  if (pending) {
    await pending;
    return;
  }
  const offset = pageIndex * PAGE_SIZE;
  sectionState.loadError = "";
  const request = fetchJson(buildCategoryPageUrl(sectionState.category, offset))
    .then((payload) => {
      const nextTotal = Number(payload.total ?? sectionState.total);
      if (nextTotal !== sectionState.total) {
        sectionState.total = nextTotal;
        sectionState.items.length = nextTotal;
        state.categoryCounts[sectionState.category] = nextTotal;
        updateTotalItems();
      }
      if (!Array.isArray(sectionState.items) || sectionState.items.length !== sectionState.total) {
        sectionState.items = new Array(sectionState.total);
      }
      let addedCount = 0;
      for (const [index, item] of (Array.isArray(payload.items) ? payload.items : []).entries()) {
        const targetIndex = offset + index;
        if (targetIndex >= sectionState.total) {
          break;
        }
        if (!sectionState.items[targetIndex]) {
          addedCount += 1;
        }
        sectionState.items[targetIndex] = normalizeLibraryItem(item);
      }
      sectionState.loadedCount += addedCount;
      sectionState.pagesLoaded.add(pageIndex);
      sectionState.revision += 1;
      state.lastError = "";
    })
    .catch((error) => {
      sectionState.loadError = String(error.message || error);
      setErrorState("\u7d20\u6750\u5e93\u52a0\u8f7d\u5931\u8d25");
      showToast(sectionState.loadError);
    })
    .finally(() => {
      sectionState.inFlightPages.delete(pageIndex);
      updateSectionStatus(sectionState);
      scheduleViewportUpdate();
    });
  sectionState.inFlightPages.set(pageIndex, request);
  updateSectionStatus(sectionState);
  await request;
}

function ensureCategoryRangeLoaded(sectionState, startIndex, endIndex) {
  if (!sectionState.total) {
    return;
  }
  const startPage = Math.max(0, Math.floor(startIndex / PAGE_SIZE));
  const endPage = Math.max(startPage, Math.floor(Math.max(startIndex, endIndex - 1) / PAGE_SIZE));
  const preloadEndPage = Math.min(Math.ceil(sectionState.total / PAGE_SIZE) - 1, endPage + 1);
  for (let page = startPage; page <= preloadEndPage; page += 1) {
    void ensureCategoryPage(sectionState, page);
  }
}

function updateVisibleSections() {
  if (!sectionsNode) {
    return;
  }
  const containerRect = sectionsNode.getBoundingClientRect();
  for (const category of currentCategories()) {
    const sectionState = state.categoryStates.get(category);
    if (!sectionState?.shellNode) {
      continue;
    }
    const metrics = computeSectionMetrics(sectionState);
    const range = computeVisibleRange(sectionState, metrics, containerRect);
    if (!range) {
      clearSectionWindow(sectionState);
      continue;
    }
    renderSectionWindow(sectionState, range);
    ensureCategoryRangeLoaded(sectionState, range.startIndex, Math.min(sectionState.total, range.endIndex + PAGE_SIZE));
    updateSectionStatus(sectionState);
  }
  if (!state.isBusy && !state.lastError) {
    setStatus();
  }
}

function scheduleViewportUpdate() {
  if (state.viewportFrame) {
    return;
  }
  state.viewportFrame = window.requestAnimationFrame(() => {
    state.viewportFrame = 0;
    updateVisibleSections();
  });
}

function createSectionNode(sectionState) {
  const section = createElement("section", "library-section");
  const head = createElement("div", "library-section-head");
  const title = createElement("div", "library-section-title", `${sectionState.category}\u7d20\u6750`);
  const uploadButton = createElement("button", "secondary-button", "\u6279\u91cf\u4e0a\u4f20");
  uploadButton.type = "button";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.hidden = true;

  uploadButton.onclick = () => input.click();
  input.addEventListener("change", async () => {
    if (!input.files?.length) {
      return;
    }
    try {
      setBusyState(true, `\u6b63\u5728\u4e0a\u4f20${sectionState.category}\u7d20\u6750\u2026`);
      await uploadCategory(sectionState.category, Array.from(input.files));
      await loadLibrarySummary();
      setStatus();
      showToast(`${sectionState.category}\u7d20\u6750\u4e0a\u4f20\u6210\u529f`);
    } catch (error) {
      setErrorState(`${sectionState.category}\u7d20\u6750\u4e0a\u4f20\u5931\u8d25`);
      showToast(String(error.message || error));
    } finally {
      setBusyState(false);
      input.value = "";
    }
  });

  head.append(title, uploadButton, input);
  section.appendChild(head);

  sectionState.sectionNode = section;

  if (!sectionState.total) {
    section.appendChild(createElement("div", "library-empty", `\u5f53\u524d\u8fd8\u6ca1\u6709${sectionState.category}\u7d20\u6750\u3002`));
    sectionState.shellNode = null;
    sectionState.windowNode = null;
    sectionState.footerNode = null;
    return section;
  }

  const shell = createElement("div", "library-grid-shell");
  const windowNode = createElement("div", "library-grid library-grid-window");
  shell.appendChild(windowNode);
  const footer = createElement("div", "library-grid-status");

  section.append(shell, footer);

  sectionState.shellNode = shell;
  sectionState.windowNode = windowNode;
  sectionState.footerNode = footer;
  updateSectionStatus(sectionState);
  return section;
}

function renderSections() {
  if (!sectionsNode) {
    return;
  }
  const previousScrollTop = sectionsNode.scrollTop;
  sectionsNode.innerHTML = "";
  const categories = currentCategories();
  if (!categories.length) {
    sectionsNode.appendChild(createElement("div", "library-empty", "\u8bf7\u5148\u8fde\u63a5\u5e76\u5237\u65b0\u672c\u5730\u7d20\u6750\u5e93\u4ee5\u5efa\u7acb\u5206\u7c7b\u3002"));
    return;
  }
  for (const category of categories) {
    const sectionState = state.categoryStates.get(category) || buildSectionState(category, Number(state.categoryCounts[category] || 0));
    state.categoryStates.set(category, sectionState);
    sectionsNode.appendChild(createSectionNode(sectionState));
  }
  sectionsNode.scrollTop = previousScrollTop;
  scheduleViewportUpdate();
  if (!state.isBusy && !state.lastError) {
    setStatus();
  }
}

async function connectSource(sourceDir) {
  const payload = await fetchJson("/api/library/source/connect", {
    method: "POST",
    body: JSON.stringify({
      source_dir: sourceDir,
    }),
  });
  state.source = payload.source || null;
  state.lastError = "";
  renderSourceMeta();
  await loadLibrarySummary();
  const targetDir = state.source?.source_dir || sourceDir;
  showToast(`\u5207\u6362\u5e76\u540c\u6b65\u5b8c\u6210\uff1a${targetDir}\uff0c\u65b0\u589e/\u66f4\u65b0 ${payload.imported_count || 0} \u9879\uff0c\u79fb\u9664 ${payload.removed_count || 0} \u9879`);
}

async function refreshSource() {
  const payload = await fetchJson("/api/library/source/refresh", {
    method: "POST",
  });
  state.source = payload.source || state.source;
  renderSourceMeta();
  await loadLibrarySummary();
  const sourceDir = state.source?.source_dir || "\u5f53\u524d\u7d20\u6750\u5e93";
  showToast(`\u5237\u65b0\u5b8c\u6210\uff1a${sourceDir}\uff0c\u65b0\u589e/\u66f4\u65b0 ${payload.imported_count || 0} \u9879\uff0c\u79fb\u9664 ${payload.removed_count || 0} \u9879`);
}

function setupViewportObservers() {
  if (sectionsNode) {
    sectionsNode.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
  }
  window.addEventListener("resize", scheduleViewportUpdate);
  if (!state.resizeObserver && sectionsNode && typeof ResizeObserver !== "undefined") {
    state.resizeObserver = new ResizeObserver(() => scheduleViewportUpdate());
    state.resizeObserver.observe(sectionsNode);
  }
}

if (pickSourceButton) {
  pickSourceButton.addEventListener("click", async () => {
    pickSourceButton.disabled = true;
    try {
      const selectedDir = await pickSourceDirectory();
      if (!selectedDir) {
        state.lastError = "";
        setStatus();
        return;
      }
      await connectSource(selectedDir);
      showToast("\u672c\u5730\u7d20\u6750\u5e93\u8def\u5f84\u5df2\u4fdd\u5b58\uff0c\u70b9\u51fb\u201c\u5237\u65b0\u201d\u5f00\u59cb\u540c\u6b65");
    } catch (error) {
      setErrorState("\u672c\u5730\u7d20\u6750\u5e93\u8def\u5f84\u4fdd\u5b58\u5931\u8d25");
      showToast(String(error.message || error));
    } finally {
      pickSourceButton.disabled = false;
    }
  });
}

if (refreshSourceButton) {
  refreshSourceButton.addEventListener("click", async () => {
    refreshSourceButton.disabled = true;
    try {
      setBusyState(true, "\u6b63\u5728\u5237\u65b0\u672c\u5730\u7d20\u6750\u5e93\u2026");
      await refreshSource();
      setStatus();
    } catch (error) {
      setErrorState("\u7d20\u6750\u5e93\u5237\u65b0\u5931\u8d25");
      showToast(String(error.message || error));
    } finally {
      setBusyState(false);
      refreshSourceButton.disabled = false;
    }
  });
}

async function initializePage() {
  setupViewportObservers();
  renderSections();
  try {
    setBusyState(true, "\u6b63\u5728\u52a0\u8f7d\u7d20\u6750\u5e93\u2026");
    await loadSource();
    await loadLibrarySummary();
  } catch (error) {
    setErrorState("\u7d20\u6750\u5e93\u52a0\u8f7d\u5931\u8d25");
    showToast(String(error.message || error));
  } finally {
    setBusyState(false);
  }
}

initializePage();

if (previewCloseButton) {
  previewCloseButton.addEventListener("click", closePreview);
}

if (previewDialog) {
  previewDialog.addEventListener("click", (event) => {
    const rect = previewDialog.getBoundingClientRect();
    const insideDialog = (
      event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom
    );
    if (!insideDialog) {
      closePreview();
    }
  });
  previewDialog.addEventListener("close", () => {
    if (previewImageNode) {
      previewImageNode.removeAttribute("src");
      previewImageNode.alt = "";
    }
    if (previewMetaNode) {
      previewMetaNode.innerHTML = "";
    }
  });
}
