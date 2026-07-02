import type {
  ObjectMotion,
  ObjectMotionMode,
  SceneObject,
  Transform,
  Vec3,
} from './types'
import { applySpeedCurve, normalizeSpeedCurve } from './speedCurves'

export type SceneMotionPreset = {
  id: string
  label: string
  description: string
  durationSec: number
  objects: Array<{
    assetId: string
    name: string
    transform: Transform
    material?: {
      color: string
      roughness: number
    }
    motion: ObjectMotion
  }>
}

export const DEFAULT_OBJECT_MOTION: ObjectMotion = {
  enabled: false,
  mode: 'none',
  speedCurve: 'linear',
  startSec: 0,
  durationSec: 4,
  directionDeg: 0,
  distance: 4,
  heightDelta: 1.5,
  radius: 2,
  loops: 1,
  autoFace: true,
  faceOffsetDeg: 0,
}

export const objectMotionModeLabels: Record<ObjectMotionMode, string> = {
  none: '静止',
  linear: '直线推进',
  pingpong: '往返巡逻',
  orbit: '环绕运动',
  takeoff: '起飞爬升',
  hover: '悬停漂移',
  lane_change: '变道超车',
  weave: '蛇形闪避',
  pursuit: '追逐贴近',
  bank_turn: '压坡转弯',
  jump: '跃起落地',
}

export const objectMotionPresets: Array<{
  id: string
  label: string
  motion: ObjectMotion
}> = [
  {
    id: 'walk-forward',
    label: '人物走位',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'linear',
      durationSec: 5,
      distance: 3,
      autoFace: true,
    },
  },
  {
    id: 'vehicle-drive',
    label: '车辆驶过',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'linear',
      durationSec: 4,
      distance: 8,
      autoFace: true,
    },
  },
  {
    id: 'patrol-loop',
    label: '往返巡逻',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'pingpong',
      durationSec: 6,
      distance: 5,
      loops: 2,
      autoFace: true,
    },
  },
  {
    id: 'vehicle-lane-change',
    label: '车辆变道超车',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'lane_change',
      durationSec: 4.5,
      distance: 9,
      radius: 1.35,
      autoFace: true,
    },
  },
  {
    id: 'vehicle-weave',
    label: '车辆蛇形闪避',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'weave',
      durationSec: 5.5,
      distance: 9,
      radius: 1.15,
      loops: 2.5,
      autoFace: true,
    },
  },
  {
    id: 'vehicle-pursuit',
    label: '车辆追逐贴近',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'pursuit',
      durationSec: 6,
      distance: 11,
      radius: 0.9,
      autoFace: true,
    },
  },
  {
    id: 'motorcycle-jump',
    label: '摩托跃起落地',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'jump',
      durationSec: 2.8,
      distance: 5,
      heightDelta: 1.4,
      autoFace: true,
    },
  },
  {
    id: 'airplane-takeoff',
    label: '飞机起飞',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'takeoff',
      durationSec: 5,
      distance: 7,
      heightDelta: 4,
      autoFace: true,
    },
  },
  {
    id: 'aircraft-bank-turn',
    label: '飞行器压坡转弯',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'bank_turn',
      durationSec: 6,
      distance: 8,
      radius: 3,
      heightDelta: 1.8,
      loops: 1,
      autoFace: true,
    },
  },
  {
    id: 'drone-orbit',
    label: '无人机环绕',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'orbit',
      durationSec: 8,
      radius: 2.5,
      heightDelta: 0.6,
      loops: 1,
      autoFace: true,
    },
  },
  {
    id: 'hover-drift',
    label: '悬停漂移',
    motion: {
      ...DEFAULT_OBJECT_MOTION,
      enabled: true,
      mode: 'hover',
      durationSec: 6,
      distance: 2,
      heightDelta: 0.7,
      loops: 2,
      autoFace: true,
    },
  },
]

export const sceneMotionPresets: SceneMotionPreset[] = [
  {
    id: 'two-car-chase',
    label: '两车追逐',
    description: '自动放入前车和追车，生成错位、贴近、变道的追逐运动。',
    durationSec: 7,
    objects: [
      {
        assetId: 'vehicle-car',
        name: 'Lead Car',
        transform: {
          position: [-0.9, 0, -3.2],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        material: {
          color: '#f2f4f7',
          roughness: 0.72,
        },
        motion: {
          ...DEFAULT_OBJECT_MOTION,
          enabled: true,
          mode: 'lane_change',
          durationSec: 7,
          directionDeg: 0,
          distance: 13,
          radius: 1.2,
          autoFace: true,
        },
      },
      {
        assetId: 'vehicle-car',
        name: 'Chase Car',
        transform: {
          position: [0.9, 0, -5.1],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        material: {
          color: '#ff5c35',
          roughness: 0.68,
        },
        motion: {
          ...DEFAULT_OBJECT_MOTION,
          enabled: true,
          mode: 'pursuit',
          durationSec: 7,
          directionDeg: 0,
          distance: 14.5,
          radius: 0.85,
          autoFace: true,
        },
      },
    ],
  },
]

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const cloneVec3 = (value: Vec3): Vec3 => [value[0], value[1], value[2]]

const cloneTransform = (transform: Transform): Transform => ({
  position: cloneVec3(transform.position),
  rotation: cloneVec3(transform.rotation),
  scale: cloneVec3(transform.scale),
})

const degToRad = (value: number): number => (value * Math.PI) / 180

const smooth = (value: number): number => value * value * (3 - 2 * value)

const normalizeDegrees = (value: number): number => {
  let next = ((value + 180) % 360 + 360) % 360 - 180
  if (next === -180) {
    next = 180
  }
  return next
}

const progressForMotion = (motion: ObjectMotion, timeSec: number): number =>
  applySpeedCurve(
    clamp((timeSec - motion.startSec) / Math.max(0.1, motion.durationSec), 0, 1),
    motion.speedCurve,
  )

const directionVector = (directionDeg: number): Vec3 => {
  const radians = degToRad(directionDeg)

  return [Math.sin(radians), 0, Math.cos(radians)]
}

const sideVector = (directionDeg: number): Vec3 => {
  const radians = degToRad(directionDeg)

  return [Math.cos(radians), 0, -Math.sin(radians)]
}

export const normalizeObjectMotion = (
  motion?: Partial<ObjectMotion>,
): ObjectMotion => {
  const next = {
    ...DEFAULT_OBJECT_MOTION,
    ...motion,
  }

  return {
    enabled: Boolean(next.enabled) && next.mode !== 'none',
    mode: next.enabled ? next.mode : 'none',
    speedCurve: normalizeSpeedCurve(next.speedCurve),
    startSec: clamp(Number(next.startSec) || 0, 0, 300),
    durationSec: clamp(Number(next.durationSec) || 4, 0.25, 300),
    directionDeg: clamp(Number(next.directionDeg) || 0, -180, 180),
    distance: clamp(Number(next.distance) || 0, 0, 60),
    heightDelta: clamp(Number(next.heightDelta) || 0, -20, 20),
    radius: clamp(Number(next.radius) || 0, 0, 30),
    loops: clamp(Number(next.loops) || 1, 0.25, 12),
    autoFace: Boolean(next.autoFace),
    faceOffsetDeg: normalizeDegrees(Number(next.faceOffsetDeg) || 0),
  }
}

export const reverseObjectMotion = (motion?: Partial<ObjectMotion>): ObjectMotion => {
  const normalized = normalizeObjectMotion(motion)

  return normalizeObjectMotion({
    ...normalized,
    directionDeg: normalizeDegrees(normalized.directionDeg + 180),
  })
}

export const reverseObjectMotionFacing = (
  motion?: Partial<ObjectMotion>,
): ObjectMotion => {
  const normalized = normalizeObjectMotion(motion)

  return normalizeObjectMotion({
    ...normalized,
    faceOffsetDeg: normalizeDegrees(normalized.faceOffsetDeg + 180),
  })
}

const sampleObjectMotionTransformBase = (
  object: SceneObject,
  timeSec: number,
  applyFacing: boolean,
): Transform => {
  const transform = cloneTransform(object.transform)
  const motion = normalizeObjectMotion(object.motion)

  if (!motion.enabled || motion.mode === 'none') {
    return transform
  }

  const progress = progressForMotion(motion, timeSec)
  const direction = directionVector(motion.directionDeg)
  const side = sideVector(motion.directionDeg)
  const applyFacingYaw = (yaw: number) => {
    transform.rotation[1] =
      object.transform.rotation[1] + yaw + degToRad(motion.faceOffsetDeg)
  }
  const applyForward = (amount: number) => {
    transform.position[0] += direction[0] * amount
    transform.position[2] += direction[2] * amount
  }
  const applySide = (amount: number) => {
    transform.position[0] += side[0] * amount
    transform.position[2] += side[2] * amount
  }

  if (motion.mode === 'linear') {
    applyForward(motion.distance * progress)
  }

  if (motion.mode === 'pingpong') {
    const phase = (progress * motion.loops * 2) % 2
    const wave = phase <= 1 ? phase : 2 - phase
    applyForward(motion.distance * wave)
  }

  if (motion.mode === 'orbit') {
    const angle = degToRad(motion.directionDeg) + progress * motion.loops * Math.PI * 2
    transform.position[0] += Math.cos(angle) * motion.radius
    transform.position[2] += Math.sin(angle) * motion.radius
    transform.position[1] += Math.sin(progress * motion.loops * Math.PI * 2) * motion.heightDelta
    if (motion.autoFace && applyFacing) {
      applyFacingYaw(-angle + Math.PI / 2)
    }
  }

  if (motion.mode === 'takeoff') {
    applyForward(motion.distance * progress)
    transform.position[1] += motion.heightDelta * smooth(progress)
  }

  if (motion.mode === 'hover') {
    applyForward(motion.distance * progress)
    transform.position[1] +=
      Math.sin(progress * motion.loops * Math.PI * 2) * motion.heightDelta
  }

  if (motion.mode === 'lane_change') {
    applyForward(motion.distance * progress)
    applySide(motion.radius * smooth(progress))
  }

  if (motion.mode === 'weave') {
    applyForward(motion.distance * progress)
    applySide(Math.sin(progress * motion.loops * Math.PI * 2) * motion.radius)
  }

  if (motion.mode === 'pursuit') {
    applyForward(motion.distance * (0.9 * progress + 0.1 * smooth(progress)))
    applySide(Math.sin(progress * Math.PI) * motion.radius)
  }

  if (motion.mode === 'bank_turn') {
    applyForward(motion.distance * progress)
    applySide(Math.sin(progress * motion.loops * Math.PI) * motion.radius)
    transform.position[1] += smooth(progress) * motion.heightDelta
    transform.rotation[2] += -Math.sin(progress * motion.loops * Math.PI) * 0.35
  }

  if (motion.mode === 'jump') {
    applyForward(motion.distance * progress)
    transform.position[1] += Math.sin(progress * Math.PI) * motion.heightDelta
  }

  if (motion.autoFace && applyFacing) {
    const epsilon = Math.max(0.02, motion.durationSec / 240)
    const startSec = motion.startSec
    const endSec = motion.startSec + motion.durationSec
    let beforeTime = clamp(timeSec - epsilon, startSec, endSec)
    let afterTime = clamp(timeSec + epsilon, startSec, endSec)

    if (Math.abs(afterTime - beforeTime) < 0.0001) {
      beforeTime = clamp(timeSec, startSec, endSec)
      afterTime = clamp(timeSec + epsilon, startSec, endSec)
    }

    if (Math.abs(afterTime - beforeTime) < 0.0001) {
      beforeTime = clamp(timeSec - epsilon, startSec, endSec)
      afterTime = clamp(timeSec, startSec, endSec)
    }

    const before = sampleObjectMotionTransformBase(object, beforeTime, false).position
    const after = sampleObjectMotionTransformBase(object, afterTime, false).position
    const deltaX = after[0] - before[0]
    const deltaZ = after[2] - before[2]

    if (Math.sqrt(deltaX * deltaX + deltaZ * deltaZ) > 0.0001) {
      applyFacingYaw(Math.atan2(deltaX, deltaZ))
    } else {
      applyFacingYaw(degToRad(motion.directionDeg))
    }
  }

  return transform
}

export const sampleObjectMotionTransform = (
  object: SceneObject,
  timeSec: number,
): Transform => sampleObjectMotionTransformBase(object, timeSec, true)

export const getObjectMotionPathPoints = (
  object: SceneObject,
  steps = 32,
): Vec3[] => {
  const motion = normalizeObjectMotion(object.motion)

  if (!motion.enabled || motion.mode === 'none') {
    return []
  }

  return Array.from({ length: steps + 1 }, (_, index) =>
    sampleObjectMotionTransform(
      object,
      motion.startSec + (motion.durationSec * index) / steps,
    ).position,
  )
}
