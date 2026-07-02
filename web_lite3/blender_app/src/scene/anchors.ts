import { getActiveCamera, sortKeyframes } from './camera'
import { getAssetById } from './assets'
import type { AssetDefinition, SceneDocument, SceneObject, Vec3 } from './types'

export type AimAnchorSnapPoint = {
  id: string
  label: string
  position: Vec3
  kind: 'object' | 'camera-target'
}

const distance3d = (from: Vec3, to: Vec3): number => {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]

  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

const objectFocusPoint = (
  object: SceneObject,
  assets: AssetDefinition[],
): Vec3 => {
  const asset = getAssetById(assets, object.assetId)
  const height = asset?.dimensions[1] ?? 1

  return [
    object.transform.position[0],
    object.transform.position[1] + (height * object.transform.scale[1]) / 2,
    object.transform.position[2],
  ]
}

export const getAimAnchorSnapPoints = (
  scene: SceneDocument,
  assets: AssetDefinition[],
): AimAnchorSnapPoint[] => {
  const objectPoints = scene.objects
    .filter((object) => object.visible)
    .map((object) => ({
      id: `object-${object.id}`,
      label: object.name,
      position: objectFocusPoint(object, assets),
      kind: 'object' as const,
    }))

  const cameraTargets = sortKeyframes(getActiveCamera(scene)?.keyframes ?? []).map(
    (keyframe, index) => ({
      id: `target-${keyframe.id}`,
      label: `镜头点 ${index + 1} 朝向`,
      position: keyframe.target,
      kind: 'camera-target' as const,
    }),
  )

  return [...objectPoints, ...cameraTargets]
}

export const findNearestAimAnchorSnap = (
  scene: SceneDocument,
  assets: AssetDefinition[],
  position: Vec3,
  radius = 0.85,
): AimAnchorSnapPoint | null => {
  let nearest: AimAnchorSnapPoint | null = null
  let nearestDistance = radius

  for (const point of getAimAnchorSnapPoints(scene, assets)) {
    const distance = distance3d(position, point.position)
    if (distance <= nearestDistance) {
      nearest = point
      nearestDistance = distance
    }
  }

  return nearest
}

export const snapVec3ToGrid = (position: Vec3, gridSize = 0.25): Vec3 => [
  Math.round(position[0] / gridSize) * gridSize,
  Math.round(position[1] / gridSize) * gridSize,
  Math.round(position[2] / gridSize) * gridSize,
]
