import { builtInAssets } from './assets'
import { defaultSceneLights } from './lights'
import {
  DEFAULT_RENDER_SETTINGS,
  DEFAULT_TRANSFORM,
  type AssetDefinition,
  type CameraKeyframe,
  type SceneDocument,
  type SceneObject,
  type Transform,
  type Vec3,
} from './types'

const cloneVec3 = (value: Vec3): Vec3 => [value[0], value[1], value[2]]

const cloneTransform = (transform: Transform): Transform => ({
  position: cloneVec3(transform.position),
  rotation: cloneVec3(transform.rotation),
  scale: cloneVec3(transform.scale),
})

export const createId = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}`

export const createObjectFromAsset = (
  asset: AssetDefinition,
  overrides: Partial<SceneObject> = {},
): SceneObject => {
  const transform = overrides.transform
    ? cloneTransform(overrides.transform)
    : cloneTransform(DEFAULT_TRANSFORM)

  return {
    id: overrides.id ?? createId('object'),
    assetId: asset.id,
    name: overrides.name ?? asset.label,
    transform,
    visible: overrides.visible ?? true,
    material: overrides.material ?? {
      color: asset.prefab === 'greenscreen' ? '#00b140' : '#f2f4f7',
      roughness: 0.78,
    },
    motion: overrides.motion,
    metadata: overrides.metadata ??
      (asset.url
        ? { url: asset.url, sourceName: asset.label, format: asset.format }
        : undefined),
  }
}

export const createCameraKeyframe = (
  timeSec: number,
  position: Vec3,
  target: Vec3,
  fov = 45,
): CameraKeyframe => ({
  id: createId('kf'),
  timeSec,
  position,
  target,
  fov,
  interpolation: 'linear',
  shotDurationSec: 2,
  speedToNext: 1,
  speedCurveToNext: 'linear',
  curveToNext: 'smooth',
  curveStrengthToNext: 1,
})

export const createInitialScene = (): SceneDocument => {
  const [person, building, tower, tree, crate] = builtInAssets

  return {
    version: 1,
    objects: [
      createObjectFromAsset(building, {
        id: 'building-hero',
        name: 'Main Block',
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.2, 1, 1],
        },
      }),
      createObjectFromAsset(tower, {
        id: 'tower-left',
        name: 'Side Tower',
        transform: {
          position: [-3.2, 0, -1.1],
          rotation: [0, 0.15, 0],
          scale: [1, 1, 1],
        },
      }),
      createObjectFromAsset(person, {
        id: 'person-scale',
        name: 'Scale Person',
        transform: {
          position: [1.8, 0, 1.2],
          rotation: [0, -0.5, 0],
          scale: [1, 1, 1],
        },
      }),
      createObjectFromAsset(tree, {
        id: 'tree-right',
        name: 'Foreground Tree',
        transform: {
          position: [3.6, 0, 1.6],
          rotation: [0, 0, 0],
          scale: [1.1, 1.1, 1.1],
        },
      }),
      createObjectFromAsset(crate, {
        id: 'crate-front',
        name: 'Marker Crate',
        transform: {
          position: [-1.4, 0, 2.4],
          rotation: [0, 0.7, 0],
          scale: [1, 0.8, 1],
        },
      }),
    ],
    cameras: [
      {
        id: 'camera-main',
        name: 'Shot Camera',
        keyframes: [
          {
            id: 'kf-start',
            timeSec: 0,
            position: [-6, 3.2, 6],
            target: [0, 1.3, 0],
            fov: 45,
            interpolation: 'linear',
            shotDurationSec: 3,
            speedToNext: 1,
            curveToNext: 'arc-right',
            curveStrengthToNext: 0.8,
          },
          {
            id: 'kf-mid',
            timeSec: 5,
            position: [-1.8, 2.4, 4.2],
            target: [0.8, 1.5, 0.2],
            fov: 38,
            interpolation: 'linear',
            shotDurationSec: 4,
            speedToNext: 1,
            curveToNext: 'smooth',
            curveStrengthToNext: 0.7,
          },
          {
            id: 'kf-end',
            timeSec: 10,
            position: [4.8, 2.8, 3.5],
            target: [0.2, 1.4, -0.6],
            fov: 42,
            interpolation: 'linear',
            shotDurationSec: 3,
            speedToNext: 1,
            curveToNext: 'linear',
            curveStrengthToNext: 1,
          },
        ],
      },
    ],
    activeCameraId: 'camera-main',
    cameraAimAnchor: {
      enabled: false,
      position: [0, 1.3, 0],
      snapEnabled: true,
    },
    cameraMotion: {
      mode: 'stable',
      shakeStrength: 0,
    },
    lights: defaultSceneLights.map((light) => ({ ...light })),
    timeline: {
      currentTimeSec: 0,
      mode: 'motion',
    },
    renderSettings: {
      ...DEFAULT_RENDER_SETTINGS,
    },
  }
}
