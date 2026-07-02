function assetIdentityKey(item) {
  const contentHash = String(item?.content_hash || "").trim();
  if (contentHash) {
    return `hash:${contentHash}`;
  }
  const publicUrl = String(item?.public_url || "").trim();
  if (publicUrl) {
    return `url:${publicUrl}`;
  }
  const assetId = String(item?.id || "").trim();
  return assetId ? `id:${assetId}` : "";
}

export function dedupeAssetsById(items = []) {
  const seen = new Set();
  const deduped = [];
  for (const item of Array.isArray(items) ? items : []) {
    const assetKey = assetIdentityKey(item);
    if (!assetKey || seen.has(assetKey)) {
      continue;
    }
    seen.add(assetKey);
    deduped.push(item);
  }
  return deduped;
}

export function normalizeWorkspaceAssets(assets = {}) {
  const imagePrimary = assets.imagePrimary?.id ? assets.imagePrimary : null;
  const videoFirst = assets.videoFirst?.id ? assets.videoFirst : null;
  const videoLast = assets.videoLast?.id ? assets.videoLast : null;
  const primaryAssetId = String(imagePrimary?.id || "").trim();
  const primaryAssetKey = assetIdentityKey(imagePrimary);
  const imageReferences = dedupeAssetsById(assets.imageReferences || []).filter(
    (item) => String(item?.id || "").trim() !== primaryAssetId && assetIdentityKey(item) !== primaryAssetKey,
  );
  const videoReferences = dedupeAssetsById(assets.videoReferences || []);
  return {
    imagePrimary,
    imageReferences,
    videoFirst,
    videoLast,
    videoReferences,
  };
}

export function getRecordCardAction(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (["pending", "queued", "running"].includes(normalized)) {
    return {
      action: "cancel-record",
      label: "取消任务",
      disabled: false,
      className: "is-cancel",
    };
  }
  if (normalized === "cancel_requested") {
    return {
      action: "cancel-record",
      label: "取消中",
      disabled: true,
      className: "is-cancel-pending",
    };
  }
  if (["succeeded", "failed", "cancelled", "expired"].includes(normalized)) {
    return {
      action: "delete-record",
      label: "删除",
      disabled: false,
      className: "is-delete",
    };
  }
  return null;
}

export function buildCrossKindEmptyState(kind, historyCounts = {}) {
  const imageCount = Math.max(0, Number(historyCounts?.image || 0));
  const videoCount = Math.max(0, Number(historyCounts?.video || 0));
  if (kind === "video" && imageCount > 0) {
    return {
      message: `当前资产包没有生视频记录，但有 ${imageCount} 条生图记录。`,
      actionLabel: "查看生图记录",
      actionHref: "/image",
      statusText: `当前资产包有 ${imageCount} 条生图记录，当前页没有生视频记录`,
    };
  }
  if (kind === "image" && videoCount > 0) {
    return {
      message: `当前资产包没有生图记录，但有 ${videoCount} 条生视频记录。`,
      actionLabel: "查看生视频记录",
      actionHref: "/video",
      statusText: `当前资产包有 ${videoCount} 条生视频记录，当前页没有生图记录`,
    };
  }
  return {
    message: "当前资产包暂无任务记录。",
    actionLabel: "",
    actionHref: "",
    statusText: "当前资产包暂无任务记录",
  };
}
