import { $, applyTheme, fetchJson, getPageConfig, showToast } from "/static/js/common.js";

const config = getPageConfig();
const settings = config.settings || {};
const automaticNetworkModes = {
  volcengine: "direct",
  kling: "direct",
};
const networkProviders = ["volcengine", "kling"];
const promptFontSizeDefaults = {
  min: 14,
  max: 28,
  value: 16,
};

function colorForIndex(index) {
  const hue = (index * 57) % 360;
  return `hsl(${hue} 68% 48%)`;
}

function populateApiKeyHistory(selectId, items = []) {
  const select = $(selectId);
  if (!select) {
    return;
  }
  select.innerHTML = "<option value=\"\">选择已保存的 Key</option>";
  for (const item of Array.isArray(items) ? items : []) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  }
}

function normalizePromptFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return promptFontSizeDefaults.value;
  }
  return Math.max(promptFontSizeDefaults.min, Math.min(promptFontSizeDefaults.max, Math.round(numeric)));
}

function syncPromptFontSizeDisplay() {
  const range = $("#promptFontSizeRange");
  const value = normalizePromptFontSize(range?.value);
  if (range) {
    range.value = String(value);
  }
  if ($("#promptFontSizeValue")) {
    $("#promptFontSizeValue").textContent = `${value}px`;
  }
}

function fillForm() {
  $("#volcengineApiKey").value = settings.volcengine_api_key || "";
  $("#klingApiKey").value = settings.kling_api_key || "";
  $("#storageDir").value = settings.storage_dir || "";
  $("#apiNetworkAutoSwitch").value = settings.api_network_auto_switch === false ? "false" : "true";
  $("#apiProxyUrl").value = settings.api_proxy_url || "";
  syncAutomaticNetworkPolicy();
  $("#promptFontSizeRange").value = String(normalizePromptFontSize(settings.prompt_font_size));
  $("#recordCardSizeSelect").value = settings.record_card_size || "medium";
  $("#themeSelect").value = settings.theme || "light";
  $("#autoOpenBrowser").checked = Boolean(settings.auto_open_browser);
  populateApiKeyHistory("#volcengineApiKeyHistorySelect", config.masked_api_key_history?.volcengine || []);
  populateApiKeyHistory("#klingApiKeyHistorySelect", config.masked_api_key_history?.kling || []);
  syncPromptFontSizeDisplay();
}

function syncAutomaticNetworkPolicy() {
  $("#volcengineNetworkMode").value = automaticNetworkModes.volcengine;
  $("#klingNetworkMode").value = automaticNetworkModes.kling;
  settings.volcengine_network_mode = automaticNetworkModes.volcengine;
  settings.kling_network_mode = automaticNetworkModes.kling;
}

function collectForm() {
  syncAutomaticNetworkPolicy();
  return {
    auto_open_browser: $("#autoOpenBrowser").checked,
    prompt_font_size: normalizePromptFontSize($("#promptFontSizeRange").value),
    record_card_size: $("#recordCardSizeSelect").value,
    theme: $("#themeSelect").value,
    api_network_auto_switch: $("#apiNetworkAutoSwitch").value !== "false",
    api_proxy_url: $("#apiProxyUrl").value.trim(),
    openai_network_mode: "proxy",
    google_network_mode: "proxy",
    volcengine_network_mode: automaticNetworkModes.volcengine,
    kling_network_mode: automaticNetworkModes.kling,
    storage_dir: $("#storageDir").value.trim(),
    volcengine_api_key: $("#volcengineApiKey").value.trim(),
    kling_api_key: $("#klingApiKey").value.trim(),
    google_api_key: "",
    openai_api_key: "",
  };
}

function networkProviderLabel(provider) {
  return {
    volcengine: "火山引擎",
    kling: "Kling",
  }[provider] || provider;
}

function apiKeyInputForProvider(provider) {
  return {
    volcengine: "#volcengineApiKey",
    kling: "#klingApiKey",
  }[provider] || "";
}

function defaultNetworkHint(provider) {
  if (provider === "volcengine") {
    return {
      status: "等待检测",
      hint: "火山引擎通常需要关闭 VPN。",
    };
  }
  if (provider === "kling") {
    return {
      status: "等待检测",
      hint: "可灵中国大陆接口通常直连。",
    };
  }
  return {
    status: "等待检测",
    hint: "点击检测连通性查看结果。",
  };
}

function isKeyNetworkProblem(item) {
  return item?.code === "missing_api_key" || item?.code === "api_key_error" || item?.api_key_configured === false;
}

function fallbackNetworkGuidance(provider, item = {}) {
  if (item.ok === true) {
    return {
      status: "已连通",
      hint: "连通正常。",
      action: "",
      label: "",
    };
  }
  if (isKeyNetworkProblem(item)) {
    return {
      status: "检查 API Key",
      hint: "请检查 API Key。",
      action: "check_api_key",
      label: "检查 API Key",
    };
  }
  if (item.ok === false) {
    return {
      status: "需要关闭 VPN",
      hint: "请关闭 VPN 后重试。",
      action: "recheck_after_vpn",
      label: "我已切换 VPN，重新检测",
    };
  }
  const initial = defaultNetworkHint(provider);
  return {
    status: initial.status,
    hint: initial.hint,
    action: "",
    label: "",
  };
}

function renderNetworkStatus(payload, { checking = false } = {}) {
  const container = $("#apiNetworkStatus");
  if (!container) return;
  const providers = payload?.providers || payload?.results || config.network_status?.providers || {};
  container.innerHTML = "";
  container.setAttribute("aria-busy", checking ? "true" : "false");
  for (const provider of networkProviders) {
    const item = providers[provider] || {};
    const row = document.createElement("div");
    const status = item.ok === true ? "ok" : item.ok === false ? "warn" : item.status || "idle";
    row.className = `network-status-item is-${status}`;
    const title = document.createElement("div");
    title.className = "network-status-title";
    title.textContent = networkProviderLabel(provider);
    const meta = document.createElement("div");
    meta.className = "network-status-meta";
    const guidance = fallbackNetworkGuidance(provider, item);
    meta.textContent = checking ? "检测中" : (item.user_status || guidance.status);
    const message = document.createElement("div");
    message.className = "network-status-message";
    message.textContent = checking ? "正在检测..." : (item.user_hint || guidance.hint || "等待检测");
    row.append(title, meta, message);
    const action = item.user_action || guidance.action;
    const label = item.user_action_label || guidance.label;
    if (!checking && action && label) {
      const actions = document.createElement("div");
      actions.className = "network-status-actions";
      const button = document.createElement("button");
      button.className = "secondary-button network-status-action";
      button.type = "button";
      button.dataset.networkAction = action;
      button.dataset.provider = provider;
      button.textContent = label;
      actions.appendChild(button);
      row.appendChild(actions);
    }
    container.appendChild(row);
  }
}

function networkErrorPayload(message) {
  const text = message || "网络检测请求失败，请稍后重试。";
  return {
    results: Object.fromEntries(networkProviders.map((provider) => ([
      provider,
      {
        ok: false,
        configured_mode: automaticNetworkModes[provider],
        active_mode: automaticNetworkModes[provider],
        code: "network_error",
        reachable: false,
        message: text,
      },
    ]))),
  };
}

function focusApiKeyInput(provider) {
  const selector = apiKeyInputForProvider(provider);
  const input = selector ? $(selector) : null;
  if (!input) {
    return;
  }
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  input.focus();
  input.select();
}

function shortTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSeconds(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    return "-";
  }
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

function ensureTooltip(container) {
  let tooltip = container.querySelector(".chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip is-hidden";
    container.appendChild(tooltip);
  }
  return tooltip;
}

function showTooltip(host, tooltip, event, point, label) {
  tooltip.classList.remove("is-hidden");
  tooltip.textContent = `${label} · ${shortTime(point.created_at)} · #${point.sequence} · ${formatSeconds(point.elapsed_ms)}`;
  const rect = host.getBoundingClientRect();
  const left = event.clientX - rect.left + 8;
  const top = event.clientY - rect.top - 36;
  tooltip.style.left = `${Math.max(12, Math.min(left, rect.width - 220))}px`;
  tooltip.style.top = `${Math.max(12, top)}px`;
}

function hideTooltip(tooltip) {
  tooltip.classList.add("is-hidden");
}

function ensureChartCanvas(container) {
  let canvas = container.querySelector(".duration-chart-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "duration-chart-canvas";
    container.appendChild(canvas);
  }
  return canvas;
}

function syncCanvasSize(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  const nextWidth = Math.max(320, Math.round(width));
  const nextHeight = Math.max(220, Math.round(height));
  canvas.width = Math.round(nextWidth * ratio);
  canvas.height = Math.round(nextHeight * ratio);
  canvas.style.width = `${nextWidth}px`;
  canvas.style.height = `${nextHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: nextWidth, height: nextHeight };
}

function downsamplePoints(points, maxPoints = 180) {
  if (points.length <= maxPoints) {
    return points.slice();
  }
  const result = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let index = 0; index < maxPoints; index += 1) {
    result.push(points[Math.round(index * step)]);
  }
  return result;
}

function axisLabelIndexes(length) {
  if (length <= 1) {
    return [0];
  }
  if (length <= 3) {
    return Array.from({ length }, (_, index) => index);
  }
  return [0, Math.floor(length / 2), length - 1];
}

function renderBreakdown(container, title, items, keyName = "label") {
  container.innerHTML = "";
  if (!items.length) {
    return;
  }
  const titleNode = document.createElement("div");
  titleNode.className = "chart-breakdown-item";
  titleNode.innerHTML = `<span class="chart-breakdown-label">${title}</span>`;
  container.appendChild(titleNode);
  items.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "chart-breakdown-item";
    const label = document.createElement("span");
    label.className = "chart-breakdown-label";
    label.textContent = `${item[keyName]} · ${item.success_count} 条`;
    const value = document.createElement("span");
    value.className = "chart-breakdown-value";
    value.textContent = formatSeconds(item.average_elapsed_ms);
    chip.append(label, value);
    container.appendChild(chip);
  });
}

function renderLegend(container, series) {
  container.innerHTML = "";
  for (const [index, item] of series.entries()) {
    const legendItem = document.createElement("div");
    legendItem.className = "chart-legend-item";
    const swatch = document.createElement("span");
    swatch.className = "chart-legend-swatch";
    swatch.style.background = colorForIndex(index);
    const text = document.createElement("span");
    text.textContent = `${item.label} · ${item.success_count} 条 · 平均 ${formatSeconds(item.average_elapsed_ms)}`;
    legendItem.append(swatch, text);
    container.appendChild(legendItem);
  }
}

function renderDurationChart(container, payload, emptyText) {
  container.innerHTML = "";
  const rawSeries = payload.series || [];
  const series = rawSeries
    .map((item) => ({
      ...item,
      points: downsamplePoints(
        (item.points || []).slice().sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")),
      ),
    }))
    .filter((item) => item.points.length);
  const allPoints = series.flatMap((item) => item.points || []);
  if (!allPoints.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  const tooltip = ensureTooltip(container);
  const canvas = ensureChartCanvas(container);
  const { ctx, width, height } = syncCanvasSize(canvas, container.clientWidth || 760, 260);
  const themeStyles = getComputedStyle(document.body);
  const borderColor = themeStyles.getPropertyValue("--border").trim();
  const textMuted = themeStyles.getPropertyValue("--text-muted").trim();
  const panelColor = themeStyles.getPropertyValue("--bg-panel").trim();
  const padLeft = 46;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 36;
  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;
  const orderedPoints = allPoints.slice().sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const maxMs = Math.max(...orderedPoints.map((point) => Number(point.elapsed_ms) || 0), 1000);
  const maxSeconds = Math.ceil(maxMs / 1000);
  const positions = new Map();
  const hitTargets = [];
  orderedPoints.forEach((point, index) => {
    const x = padLeft + (orderedPoints.length === 1 ? chartWidth / 2 : (chartWidth * index) / (orderedPoints.length - 1));
    const y = padTop + chartHeight - chartHeight * ((Number(point.elapsed_ms) || 0) / (maxSeconds * 1000 || 1000));
    positions.set(point.history_id, { x, y });
  });
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = borderColor;
  ctx.fillStyle = textMuted;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  [0, maxSeconds / 2, maxSeconds].forEach((value) => {
    const ratio = maxSeconds === 0 ? 0 : value / maxSeconds;
    const y = padTop + chartHeight - chartHeight * ratio;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(value)}s`, 10, y + 4);
  });

  series.forEach((item, index) => {
    const color = colorForIndex(index);
    const points = item.points || [];
    if (!points.length) {
      return;
    }
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    points.forEach((point, pointIndex) => {
      const position = positions.get(point.history_id);
      if (!position) {
        return;
      }
      if (pointIndex === 0) {
        ctx.moveTo(position.x, position.y);
      } else {
        ctx.lineTo(position.x, position.y);
      }
    });
    ctx.stroke();

    points.forEach((point) => {
      const position = positions.get(point.history_id);
      if (!position) {
        return;
      }
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.strokeStyle = panelColor;
      ctx.lineWidth = 2;
      ctx.arc(position.x, position.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      hitTargets.push({ ...position, point, label: item.label });
    });
  });

  axisLabelIndexes(orderedPoints.length).forEach((index) => {
    const point = orderedPoints[index];
    const position = positions.get(point.history_id);
    if (!position) {
      return;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = textMuted;
    ctx.fillText(shortTime(point.created_at), position.x, height - 10);
  });
  ctx.textAlign = "start";
  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let target = null;
    let bestDistance = 12;
    for (const item of hitTargets) {
      const distance = Math.hypot(item.x - x, item.y - y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        target = item;
      }
    }
    if (!target) {
      hideTooltip(tooltip);
      return;
    }
    showTooltip(container, tooltip, event, target.point, target.label);
  };
  canvas.onmouseleave = () => hideTooltip(tooltip);
}

async function loadStats() {
  try {
    const payload = await fetchJson("/api/stats/durations");
    $("#imageAverageElapsed").textContent = formatSeconds(payload.image?.average_elapsed_ms);
    $("#videoAverageElapsed").textContent = formatSeconds(payload.video?.average_elapsed_ms);
    renderBreakdown($("#imageModelAverages"), "按模型平均耗时", payload.image?.model_averages || []);
    renderBreakdown($("#imageModeAverages"), "按模式平均耗时", payload.image?.mode_averages || [], "mode_label");
    renderBreakdown($("#videoModelAverages"), "按模型平均耗时", payload.video?.model_averages || []);
    renderBreakdown($("#videoModeAverages"), "按模式平均耗时", payload.video?.mode_averages || [], "mode_label");
    renderLegend($("#imageDurationLegend"), payload.image?.series || []);
    renderLegend($("#videoDurationLegend"), payload.video?.series || []);
    renderDurationChart($("#imageDurationChart"), payload.image || { series: [] }, "当前资产包暂无成功生图任务。");
    renderDurationChart($("#videoDurationChart"), payload.video || { series: [] }, "当前资产包暂无成功生视频任务。");
  } catch (error) {
    showToast(String(error.message || error));
  }
}

async function pickDirectory(initialDir, prompt) {
  const result = await fetchJson("/api/system/pick-directory", {
    method: "POST",
    body: JSON.stringify({ initial_dir: initialDir, prompt }),
  });
  return result.selected_dir || result.storage_dir || "";
}

async function loadNetworkStatus() {
  try {
    const payload = await fetchJson("/api/network/status");
    config.network_status = payload;
    renderNetworkStatus(payload);
  } catch (error) {
    renderNetworkStatus(config.network_status || {});
  }
}

async function checkApiNetwork() {
  const button = $("#apiNetworkCheckButton");
  const originalLabel = button?.textContent || "检测连通性";
  if (button) {
    button.disabled = true;
    button.textContent = "正在检测...";
  }
  renderNetworkStatus(config.network_status || {}, { checking: true });
  try {
    const payload = await fetchJson("/api/network/check", {
      method: "POST",
      body: JSON.stringify(collectForm()),
    });
    config.network_status = payload;
    renderNetworkStatus(payload);
    showToast("API 网络检测完成");
  } catch (error) {
    showToast(String(error.message || error));
    renderNetworkStatus(networkErrorPayload(String(error.message || error)));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = collectForm();
    const result = await fetchJson("/api/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    Object.assign(settings, result.settings || {});
    config.settings = settings;
    config.masked_api_key_history = {
      volcengine: (settings.volcengine_api_key_history || []).map((value) => ({
        value,
        label: value.length > 8 ? `${value.slice(0, 3)}****${value.slice(-4)}` : value,
      })),
    };
    applyTheme(result.settings.theme);
    await loadNetworkStatus();
    window.dispatchEvent(new CustomEvent("godreamai-settings-change", {
      detail: { settings: { ...settings } },
    }));
    fillForm();
    await loadStats();
    showToast("设置已保存");
  } catch (error) {
    showToast(String(error.message || error));
  }
});

$("#apiNetworkCheckButton").addEventListener("click", checkApiNetwork);

$("#apiNetworkStatus")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-network-action]");
  if (!button) {
    return;
  }
  const action = button.dataset.networkAction;
  const provider = button.dataset.provider;
  if (action === "check_api_key") {
    focusApiKeyInput(provider);
    return;
  }
  if (action === "recheck_after_vpn" || action === "recheck") {
    checkApiNetwork();
  }
});

$("#pickStorageDirButton").addEventListener("click", async () => {
  const button = $("#pickStorageDirButton");
  button.disabled = true;
  try {
    const selectedDir = await pickDirectory($("#storageDir").value.trim(), "选择资产存储目录");
    if (selectedDir) {
      $("#storageDir").value = selectedDir;
      showToast("已选择资产存储目录");
    }
  } catch (error) {
    showToast(String(error.message || error));
  } finally {
    button.disabled = false;
  }
});

$("#volcengineApiKeyHistorySelect").addEventListener("change", () => {
  const value = $("#volcengineApiKeyHistorySelect").value;
  if (value) {
    $("#volcengineApiKey").value = value;
  }
});

$("#klingApiKeyHistorySelect").addEventListener("change", () => {
  const value = $("#klingApiKeyHistorySelect").value;
  if (value) {
    $("#klingApiKey").value = value;
  }
});

$("#themeSelect").addEventListener("change", () => {
  applyTheme($("#themeSelect").value || "light");
});

$("#promptFontSizeRange").addEventListener("input", syncPromptFontSizeDisplay);
$("#promptFontSizeRange").addEventListener("change", syncPromptFontSizeDisplay);

window.addEventListener("godreamai-theme-change", (event) => {
  const theme = event.detail?.theme;
  if (theme && $("#themeSelect")) {
    $("#themeSelect").value = theme;
  }
});

fillForm();
renderNetworkStatus(config.network_status || {});
loadStats();
loadNetworkStatus();
