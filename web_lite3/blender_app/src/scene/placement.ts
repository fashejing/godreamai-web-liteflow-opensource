import { getAssetById } from './assets'
import type { AssetDefinition, SceneDocument, SceneObject, Vec3 } from './types'

export type PlacementGuide = {
  objectId: string
  label: string
  baseY: number
  topY: number
  center: Vec3
}

const objectHeight = (
  object: SceneObject,
  assets: AssetDefinition[],
): number => {
  const asset = getAssetById(assets, object.assetId)
  return (asset?.dimensions[1] ?? 1) * object.transform.scale[1]
}

export const getObjectBaseY = (
  object: SceneObject,
  _assets: AssetDefinition[],
): number => object.transform.position[1]

export const getObjectTopY = (
  object: SceneObject,
  assets: AssetDefinition[],
): number => object.transform.position[1] + objectHeight(object, assets)

export const centerYForBase = (
  _object: SceneObject,
  _assets: AssetDefinition[],
  baseY: number,
): number => baseY

export const getPlacementGuides = (
  scene: SceneDocument,
  assets: AssetDefinition[],
): PlacementGuide[] => [
  {
    objectId: 'ground',
    label: '地面',
    baseY: 0,
    topY: 0,
    center: [0, 0, 0],
  },
  ...scene.objects.map((object) => ({
    objectId: object.id,
    label: object.name,
    baseY: getObjectBaseY(object, assets),
    topY: getObjectTopY(object, assets),
    center: object.transform.position,
  })),
]

export const snapObjectPositionToPlacementGuide = (
  scene: SceneDocument,
  assets: AssetDefinition[],
  object: SceneObject,
  position: Vec3,
  radius = 0.18,
): { position: Vec3; label?: string } => {
  const movingObject = {
    ...object,
    transform: {
      ...object.transform,
      position,
    },
  }
  const movingBaseY = getObjectBaseY(movingObject, assets)
  let best: PlacementGuide | null = null
  let bestDistance = radius

  for (const guide of getPlacementGuides(scene, assets)) {
    if (guide.objectId === object.id) {
      continue
    }

    const baseDistance = Math.abs(movingBaseY - guide.baseY)
    if (baseDistance < bestDistance) {
      best = guide
      bestDistance = baseDistance
    }
  }

  if (!best) {
    return { position }
  }

  return {
    position: [position[0], centerYForBase(object, assets, best.baseY), position[2]],
    label: best.label,
  }
}
