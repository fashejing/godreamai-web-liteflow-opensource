import { $, showToast } from "/static/js/common.js";

const uploadInput = $("#blenderAssetUpload");
const uploadButton = $("#blenderAssetUploadButton");
const importStatus = $("#blenderImportStatus");
const blenderFrame = $("#blenderLauncherFrame");

function setImportStatus(message) {
  if (importStatus) {
    importStatus.textContent = message;
  }
}

function refreshBlenderFrame() {
  if (!blenderFrame) return;
  const nextUrl = new URL(blenderFrame.getAttribute("src") || "/blender/app", window.location.origin);
  nextUrl.searchParams.set("asset_refresh", String(Date.now()));
  blenderFrame.setAttribute("src", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

async function uploadBlenderAsset(file) {
  const form = new FormData();
  form.append("asset", file);
  const response = await fetch("/api/assets/import", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    let message = `导入失败：${response.status}`;
    try {
      const payload = await response.json();
      message = payload.detail || payload.message || message;
    } catch (_error) {
      message = await response.text();
    }
    throw new Error(message);
  }
  return response.json();
}

uploadButton?.addEventListener("click", () => {
  uploadInput?.click();
});

uploadInput?.addEventListener("change", async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;
  uploadButton.disabled = true;
  setImportStatus(`正在导入：${file.name}`);
  try {
    const asset = await uploadBlenderAsset(file);
    setImportStatus(`已导入：${asset.label || file.name}，已刷新内嵌 Blender 资产库`);
    showToast(`已导入3D模型：${asset.label || file.name}`);
    refreshBlenderFrame();
  } catch (error) {
    const message = String(error?.message || error);
    setImportStatus(message);
    showToast(message);
  } finally {
    uploadButton.disabled = false;
    uploadInput.value = "";
  }
});
