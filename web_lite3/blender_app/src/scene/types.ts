export type Vec3 = [number, number, number]

export type AssetCategory =
  | 'character'
  | 'building'
  | 'plant'
  | 'prop'
  | 'vehicle'
  | 'aircraft'
  | 'camera'

export type PrimitivePrefab =
  | 'person'
  | 'block-building'
  | 'tower'
  | 'tree'
  | 'crate'
  | 'wall'
  | 'greenscreen'
  | 'car'
  | 'truck'
  | 'motorcycle'
  | 'airplane'
  | 'drone'
  | 'helicopter'
  | 'boat'

export type ObjectMotionMode =
  | 'none'
  | 'linear'
  | 'pingpong'
  | 'orbit'
  | 'takeoff'
  | 'hover'
  | 'lane_change'
  | 'weave'
  | 'pursuit'
  | 'bank_turn'
  | 'jump'

export type ObjectMotion = {
  enabled: boolean
  mode: ObjectMotionMode
  speedCurve: SpeedCurveType
  startSec: number
  durationSec: number
  directionDeg: number
  distance: number
  heightDelta: number
  radius: number
  loops: number
  autoFace: boolean
  faceOffsetDeg: number
}

export type ImportedModelFormat =
  | 'gltf'
  | 'obj'
  | 'stl'
  | 'fbx'
  | 'dae'
  | 'ply'
  | '3mf'
  | '3ds'

export type AssetDefinition = {
  id: string
  label: string
  category: AssetCategory
  kind: 'primitive' | 'imported'
  prefab?: PrimitivePrefab
  url?: string
  format?: ImportedModelFormat
  dimensions: Vec3
}

export type Transform = {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export type SceneObject = {
  id: string
  assetId: string
  name: string
  transform: Transform
  visible: boolean
  material: {
    color: string
    roughness: number
  }
  motion?: ObjectMotion
  metadata?: {
    url?: string
    sourceName?: string
    format?: ImportedModelFormat
    textureUrl?: string
    textureName?: string
  }
}

export type CameraKeyframe = {
  id: string
  timeSec: number
  position: Vec3
  target: Vec3
  fov: number
  interpolation: 'linear'
  shotDurationSec?: number
  speedToNext?: number
  speedCurveToNext?: SpeedCurveType
  curveToNext?: CameraCurveType
  curveStrengthToNext?: number
  curveControlToNext?: Vec3
  curveControlInToNext?: Vec3
}

export type SpeedCurveType =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'strong-ease-in'
  | 'strong-ease-out'

export type CameraCurveType =
  | 'linear'
  | 'smooth'
  | 'arc-left'
  | 'arc-right'
  | 'crane-up'
  | 'crane-down'
  | 'custom'

export type VirtualCamera = {
  id: string
  name: string
  keyframes: CameraKeyframe[]
}

export type CameraAimAnchor = {
  enabled: boolean
  position: Vec3
  snapEnabled: boolean
  targetObjectId?: string
  targetOffset?: Vec3
}

export type CameraMotionMode = 'stable' | 'handheld' | 'drone'

export type CameraMotionSettings = {
  mode: CameraMotionMode
  shakeStrength: number
}

export type SceneLightKind = 'ambient' | 'directional' | 'point' | 'spot'

export type SceneLight = {
  id: string
  name: string
  kind: SceneLightKind
  enabled: boolean
  intensity: number
  colorTemperature: number
  azimuthDeg: number
  elevationDeg: number
  distance: number
  position?: Vec3
  target?: Vec3
}

export type TimelineMode = 'motion' | 'shots'

export type TimelineState = {
  currentTimeSec: number
  mode?: TimelineMode
}

export type RenderSettings = {
  durationSec: number
  fps: 24 | 30 | 60
  width: number
  height: number
  format: 'mp4'
  fillWhiteGround: boolean
  hideGrid: boolean
}

export type SceneDocument = {
  version: 1
  objects: SceneObject[]
  cameras: VirtualCamera[]
  activeCameraId: string
  cameraAimAnchor?: CameraAimAnchor
  cameraMotion?: CameraMotionSettings
  lights?: SceneLight[]
  timeline: TimelineState
  renderSettings: RenderSettings
}

export type RenderJobStatus = 'queued' | 'rendering' | 'completed' | 'failed'

export type RenderJob = {
  id: string
  status: RenderJobStatus
  progress: number
  kind?: 'video'
  outputPath?: string
  downloadUrl?: string
  frameCount?: number
  error?: string
  createdAt: string
  updatedAt: string
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  durationSec: 10,
  fps: 30,
  width: 1920,
  height: 1080,
  format: 'mp4',
  fillWhiteGround: false,
  hideGrid: false,
}

export const DEFAULT_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
}
