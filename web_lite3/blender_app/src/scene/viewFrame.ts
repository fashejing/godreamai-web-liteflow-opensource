import { Box3, Vector3 } from 'three'
import { getAssetById } from './assets'
import type { AssetDefinition, SceneDocument, Vec3 } from './types'

export const DEFAULT_VIEW_CENTER: Vec3 = [0, 1.2, 0]
export const DEFAULT_VIEW_SIZE: Vec3 = [6, 3, 6]
export const VIEW_RESET_DIRECTION: Vec3 = [1, 0.72, 1]

const minObjectSize = 0.05
const viewFramePadding = 1.35
const markerScalePerMeter = 0.18
const minMarkerScale = 0.22
const maxMarkerScale = 1

export type ContainedAspectSize = {
  width: number
  height: number
}

export const getContainedAspectSize = (
  containerWidth: number,
  containerHeight: number,
  aspect: number,
  inset = 0,
): ContainedAspectSize => {
  const availableWidth = Math.max(0, containerWidth - inset * 2)
  const availableHeight = Math.max(0, containerHeight - inset * 2)
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9

  if (availableWidth === 0 || availableHeight === 0) {
    return { width: 0, height: 0 }
  }

  const widthFromHeight = availableHeight * safeAspect

  if (widthFromHeight <= availableWidth) {
    return {
      width: widthFromHeight,
      height: availableHeight,
    }
  }

  return {
    width: availableWidth,
    height: availableWidth / safeAspect,
  }
}

export const getAdaptiveMarkerScale = (distance: number): number =>
  Math.min(maxMarkerScale, Math.max(minMarkerScale, distance * markerScalePerMeter))

export const getSceneObjectBounds = (
  objects: SceneDocument['objects'],
  assets: AssetDefinition[],
): Box3 | null => {
  const bounds = new Box3()
  const objectBounds = new Box3()
  let hasBounds = false

  objects.forEach((object) => {
    if (!object.visible) {
      return
    }

    const asset = getAssetById(assets, object.assetId)
    const dimensions = asset?.dimensions ?? ([1, 1, 1] as Vec3)
    const scale = object.transform.scale
    const size = new Vector3(
      Math.max(minObjectSize, Math.abs(dimensions[0] * scale[0])),
      Math.max(minObjectSize, Math.abs(dimensions[1] * scale[1])),
      Math.max(minObjectSize, Math.abs(dimensions[2] * scale[2])),
    )
    const center = new Vector3(
      object.transform.position[0],
      object.transform.position[1] + size.y / 2,
      object.transform.position[2],
    )

    objectBounds.setFromCenterAndSize(center, size)
    bounds.union(objectBounds)
    hasBounds = true
  })

  return hasBounds ? bounds : null
}

export const getFrameDistanceForBounds = (
  bounds: Box3,
  fovDeg: number,
  aspect: number,
): number => {
  const size = bounds.getSize(new Vector3())
  const radiusDistance = Math.max(size.length() * 0.5, 1)
  const fovRad = (fovDeg * Math.PI) / 180
  const safeAspect = Math.max(aspect, 0.1)
  const verticalDistance = size.y / 2 / Math.tan(fovRad / 2)
  const horizontalDistance = size.x / 2 / Math.tan(fovRad / 2) / safeAspect
  const depthDistance = size.z * 0.65

  return Math.max(
    verticalDistance,
    horizontalDistance,
    depthDistance,
    radiusDistance,
    2,
  ) * viewFramePadding
}
