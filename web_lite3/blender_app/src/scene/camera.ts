import type {
  CameraCurveType,
  CameraKeyframe,
  CameraMotionSettings,
  SceneDocument,
  SpeedCurveInterpolation,
  SpeedCurvePoint,
  SpeedCurveType,
  TimelineMode,
  Vec3,
} from './types'
import { sampleObjectMotionTransform } from './objectMotion'
import {
  applySpeedCurve,
  normalizeCustomSpeedCurvePoints,
  normalizeSpeedCurveInterpolation,
  normalizeSpeedCurve,
} from './speedCurves'

export type CameraSample = {
  position: Vec3
  target: Vec3
  fov: number
}

export const DEFAULT_CAMERA_MOTION: CameraMotionSettings = {
  mode: 'stable',
  shakeStrength: 0,
}

export const DEFAULT_SHOT_DURATION_SEC = 2
export const MIN_SHOT_DURATION_SEC = 0.5
export const MAX_SHOT_DURATION_SEC = 30
const CAMERA_KEYFRAME_TIME_EPSILON = 0.05
const AUTO_CAMERA_KEYFRAME_STEP_SEC = 2

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const lerp = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress

export const normalizeCameraMotionSettings = (
  settings?: Partial<CameraMotionSettings>,
): CameraMotionSettings => {
  const mode = settings?.mode === 'handheld' || settings?.mode === 'drone'
    ? settings.mode
    : 'stable'

  return {
    mode,
    shakeStrength: mode === 'stable'
      ? 0
      : clamp(Number(settings?.shakeStrength) || 0, 0, 2),
  }
}

export const lerpVec3 = (from: Vec3, to: Vec3, progress: number): Vec3 => [
  lerp(from[0], to[0], progress),
  lerp(from[1], to[1], progress),
  lerp(from[2], to[2], progress),
]

const addVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
]

const subtractVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]

const scaleVec3 = (value: Vec3, amount: number): Vec3 => [
  value[0] * amount,
  value[1] * amount,
  value[2] * amount,
]

const divideVec3 = (value: Vec3, amount: number): Vec3 => [
  value[0] / amount,
  value[1] / amount,
  value[2] / amount,
]

const dotVec3 = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const distanceXZ = (from: Vec3, to: Vec3): number => {
  const x = to[0] - from[0]
  const z = to[2] - from[2]
  return Math.max(0.001, Math.sqrt(x * x + z * z))
}

const distance3d = (from: Vec3, to: Vec3): number => {
  const x = to[0] - from[0]
  const y = to[1] - from[1]
  const z = to[2] - from[2]

  return Math.sqrt(x * x + y * y + z * z)
}

const normalizeVec3 = (value: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 => {
  const length = Math.sqrt(dotVec3(value, value))

  if (length < 0.0001) {
    return fallback
  }

  return divideVec3(value, length)
}

const angleBetweenVec3 = (a: Vec3, b: Vec3): number => {
  const normalizedA = normalizeVec3(a)
  const normalizedB = normalizeVec3(b)
  const cosine = clamp(dotVec3(normalizedA, normalizedB), -1, 1)

  return Math.acos(cosine)
}

const horizontalPerpendicular = (from: Vec3, to: Vec3): Vec3 => {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const length = Math.max(0.001, Math.sqrt(dx * dx + dz * dz))

  return [-dz / length, 0, dx / length]
}

const quadraticBezier = (
  from: Vec3,
  control: Vec3,
  to: Vec3,
  progress: number,
): Vec3 => {
  const inverse = 1 - progress

  return [
    inverse * inverse * from[0] + 2 * inverse * progress * control[0] + progress * progress * to[0],
    inverse * inverse * from[1] + 2 * inverse * progress * control[1] + progress * progress * to[1],
    inverse * inverse * from[2] + 2 * inverse * progress * control[2] + progress * progress * to[2],
  ]
}

const cubicBezier = (
  from: Vec3,
  controlOut: Vec3,
  controlIn: Vec3,
  to: Vec3,
  progress: number,
): Vec3 => {
  const inverse = 1 - progress
  const inverse2 = inverse * inverse
  const progress2 = progress * progress

  return [
    inverse2 * inverse * from[0] +
      3 * inverse2 * progress * controlOut[0] +
      3 * inverse * progress2 * controlIn[0] +
      progress2 * progress * to[0],
    inverse2 * inverse * from[1] +
      3 * inverse2 * progress * controlOut[1] +
      3 * inverse * progress2 * controlIn[1] +
      progress2 * progress * to[1],
    inverse2 * inverse * from[2] +
      3 * inverse2 * progress * controlOut[2] +
      3 * inverse * progress2 * controlIn[2] +
      progress2 * progress * to[2],
  ]
}

const pointLineDistance = (point: Vec3, from: Vec3, to: Vec3): number => {
  const line = subtractVec3(to, from)
  const length = distance3d(from, to)

  if (length < 0.001) {
    return distance3d(point, from)
  }

  const unit = divideVec3(line, length)
  const fromToPoint = subtractVec3(point, from)
  const projection = scaleVec3(unit, dotVec3(fromToPoint, unit))
  const perpendicular = subtractVec3(fromToPoint, projection)

  return Math.sqrt(dotVec3(perpendicular, perpendicular))
}

const getSegmentDirection = (
  from: CameraKeyframe,
  to: CameraKeyframe,
): Vec3 => normalizeVec3(subtractVec3(to.position, from.position))

const getSegmentBendFactor = (
  from: CameraKeyframe,
  to: CameraKeyframe,
): number => {
  const control = getCurveControlPoint(from, to)
  const length = Math.max(0.001, distance3d(from.position, to.position))

  return clamp(pointLineDistance(control, from.position, to.position) / length, 0, 1)
}

const getSegmentStartTangent = (
  from: CameraKeyframe,
  to: CameraKeyframe,
): Vec3 => {
  const control = from.curveControlToNext ?? getCurveControlPoint(from, to)

  return normalizeVec3(
    subtractVec3(control, from.position),
    getSegmentDirection(from, to),
  )
}

const getSegmentEndTangent = (
  from: CameraKeyframe,
  to: CameraKeyframe,
): Vec3 => {
  const control = from.curveControlInToNext ?? getCurveControlPoint(from, to)

  return normalizeVec3(
    subtractVec3(to.position, control),
    getSegmentDirection(from, to),
  )
}

const getTurnCurvatureFactor = (
  keyframes: CameraKeyframe[],
  index: number,
): number => {
  if (index <= 0 || index >= keyframes.length - 1) {
    return 0
  }

  const incoming = getSegmentDirection(keyframes[index - 1], keyframes[index])
  const outgoing = getSegmentDirection(keyframes[index], keyframes[index + 1])
  const angle = angleBetweenVec3(incoming, outgoing)

  return Math.sin(angle / 2)
}

const getTangentAtKeyframe = (
  keyframes: CameraKeyframe[],
  index: number,
): Vec3 => {
  if (keyframes.length < 2) {
    return [0, 0, 1]
  }

  if (index <= 0) {
    return getSegmentStartTangent(keyframes[0], keyframes[1])
  }

  if (index >= keyframes.length - 1) {
    return getSegmentEndTangent(
      keyframes[keyframes.length - 2],
      keyframes[keyframes.length - 1],
    )
  }

  const previousLength = Math.max(
    0.001,
    distance3d(keyframes[index - 1].position, keyframes[index].position),
  )
  const nextLength = Math.max(
    0.001,
    distance3d(keyframes[index].position, keyframes[index + 1].position),
  )
  const incoming = getSegmentEndTangent(keyframes[index - 1], keyframes[index])
  const outgoing = getSegmentStartTangent(keyframes[index], keyframes[index + 1])
  const averaged = normalizeVec3(
    addVec3(
      scaleVec3(incoming, nextLength),
      scaleVec3(outgoing, previousLength),
    ),
    outgoing,
  )

  return averaged
}

export const getCurvatureSmoothedSegmentControls = (
  keyframes: CameraKeyframe[],
  segmentIndex: number,
): { controlOut: Vec3; controlIn: Vec3 } => {
  const sorted = sortKeyframes(keyframes)
  const from = sorted[segmentIndex]
  const to = sorted[segmentIndex + 1]
  const segmentLength = Math.max(0.001, distance3d(from.position, to.position))
  const startCurvature = getTurnCurvatureFactor(sorted, segmentIndex)
  const endCurvature = getTurnCurvatureFactor(sorted, segmentIndex + 1)
  const curvature = Math.max(startCurvature, endCurvature)
  const bendFactor = getSegmentBendFactor(from, to)
  const previousLength =
    segmentIndex > 0
      ? distance3d(sorted[segmentIndex - 1].position, from.position)
      : segmentLength
  const nextLength =
    segmentIndex + 2 < sorted.length
      ? distance3d(to.position, sorted[segmentIndex + 2].position)
      : segmentLength
  const neighborLimit = Math.max(
    0.001,
    Math.min(previousLength, segmentLength, nextLength),
  )
  const handleScale = 0.34 + bendFactor * 0.48 + curvature * 0.12
  const handleOutLength = Math.min(
    segmentLength * 0.62,
    neighborLimit * handleScale,
  )
  const handleInLength = handleOutLength
  const startTangent = getTangentAtKeyframe(sorted, segmentIndex)
  const endTangent = getTangentAtKeyframe(sorted, segmentIndex + 1)

  return {
    controlOut: addVec3(
      from.position,
      scaleVec3(startTangent, handleOutLength),
    ),
    controlIn: addVec3(
      to.position,
      scaleVec3(endTangent, -handleInLength),
    ),
  }
}

export const getCurvatureSmoothedControlPoint = (
  keyframes: CameraKeyframe[],
  segmentIndex: number,
): Vec3 => {
  const { controlOut, controlIn } = getCurvatureSmoothedSegmentControls(
    keyframes,
    segmentIndex,
  )

  return lerpVec3(controlOut, controlIn, 0.5)
}

export const sortKeyframes = (
  keyframes: CameraKeyframe[],
): CameraKeyframe[] => [...keyframes].sort((a, b) => a.timeSec - b.timeSec)

export type CameraKeyframeTimeBounds = {
  minSec: number
  maxSec: number
}

export const getCameraKeyframeTimeBounds = (
  keyframes: CameraKeyframe[],
  keyframeId: string,
  durationSec: number,
  fps: number,
): CameraKeyframeTimeBounds | null => {
  const sorted = sortKeyframes(keyframes)
  const index = sorted.findIndex((keyframe) => keyframe.id === keyframeId)

  if (index <= 0) {
    return null
  }

  const frameStep = 1 / Math.max(1, fps)
  const minSec = sorted[index - 1].timeSec + frameStep
  const maxSec = sorted[index + 1]
    ? sorted[index + 1].timeSec - frameStep
    : durationSec

  return maxSec >= minSec ? { minSec, maxSec } : null
}

export const constrainCameraKeyframeTime = (
  keyframes: CameraKeyframe[],
  keyframeId: string,
  requestedTimeSec: number,
  durationSec: number,
  fps: number,
): number | null => {
  const bounds = getCameraKeyframeTimeBounds(
    keyframes,
    keyframeId,
    durationSec,
    fps,
  )

  if (!bounds || !Number.isFinite(requestedTimeSec)) {
    return null
  }

  const frameStep = 1 / Math.max(1, fps)
  const snapped = Math.round(requestedTimeSec / frameStep) * frameStep

  return Number(clamp(snapped, bounds.minSec, bounds.maxSec).toFixed(6))
}

export const isCameraSegmentConnected = (keyframe: CameraKeyframe): boolean =>
  keyframe.connectToNext !== false

export const retimeCameraKeyframes = (
  keyframes: CameraKeyframe[],
  durationSec: number,
): { keyframes: CameraKeyframe[]; durationSec: number } => {
  if (keyframes.length < 2) {
    return {
      keyframes,
      durationSec,
    }
  }

  const connectedDurationSec = Math.max(
    durationSec,
    (keyframes.length - 1) * AUTO_CAMERA_KEYFRAME_STEP_SEC,
  )
  const lastIndex = keyframes.length - 1

  return {
    durationSec: connectedDurationSec,
    keyframes: keyframes.map((keyframe, index) => ({
      ...keyframe,
      timeSec: Number(((connectedDurationSec * index) / lastIndex).toFixed(2)),
    })),
  }
}

export const getNextCameraKeyframeTime = (
  keyframes: CameraKeyframe[],
  desiredTimeSec: number,
  durationSec: number,
): number => {
  const latestTimeSec = keyframes.reduce(
    (latest, keyframe) => Math.max(latest, keyframe.timeSec),
    0,
  )
  const maxSearchTimeSec = Math.max(durationSec, latestTimeSec, desiredTimeSec, 0)
  const timeIsAvailable = (timeSec: number) =>
    keyframes.every(
      (keyframe) =>
        Math.abs(keyframe.timeSec - timeSec) > CAMERA_KEYFRAME_TIME_EPSILON,
    )
  const roundTime = (timeSec: number) => Number(timeSec.toFixed(2))
  let candidateTimeSec = clamp(desiredTimeSec, 0, maxSearchTimeSec)

  if (timeIsAvailable(candidateTimeSec)) {
    return roundTime(candidateTimeSec)
  }

  while (candidateTimeSec + AUTO_CAMERA_KEYFRAME_STEP_SEC <= maxSearchTimeSec) {
    candidateTimeSec += AUTO_CAMERA_KEYFRAME_STEP_SEC

    if (timeIsAvailable(candidateTimeSec)) {
      return roundTime(candidateTimeSec)
    }
  }

  return roundTime(latestTimeSec + AUTO_CAMERA_KEYFRAME_STEP_SEC)
}

export const connectCameraKeyframes = (
  keyframes: CameraKeyframe[],
  durationSec: number,
): { keyframes: CameraKeyframe[]; durationSec: number } => {
  const retimed = retimeCameraKeyframes(keyframes, durationSec)

  return {
    durationSec: retimed.durationSec,
    keyframes: retimed.keyframes.map((keyframe) => {
      const connectedKeyframe = {
        ...keyframe,
        connectToNext: true,
        curveToNext: 'linear' as const,
        curveStrengthToNext: 1,
      }
      delete connectedKeyframe.curveControlToNext
      delete connectedKeyframe.curveControlInToNext
      return connectedKeyframe
    }),
  }
}

export const getSegmentSpeed = (keyframe: CameraKeyframe): number =>
  clamp(keyframe.speedToNext ?? 1, 0.25, 3)

export const getSegmentSpeedCurve = (keyframe: CameraKeyframe): SpeedCurveType =>
  normalizeSpeedCurve(keyframe.speedCurveToNext)

export const getSegmentSpeedCurvePoints = (
  keyframe: CameraKeyframe,
): SpeedCurvePoint[] =>
  normalizeCustomSpeedCurvePoints(keyframe.speedCurvePointsToNext)

export const getSegmentSpeedCurveInterpolation = (
  keyframe: CameraKeyframe,
): SpeedCurveInterpolation =>
  normalizeSpeedCurveInterpolation(keyframe.speedCurveInterpolationToNext)

export const getTimelineMode = (scene: SceneDocument): TimelineMode =>
  scene.timeline.mode ?? 'motion'

export const getShotDuration = (keyframe: CameraKeyframe): number =>
  clamp(
    keyframe.shotDurationSec ?? DEFAULT_SHOT_DURATION_SEC,
    MIN_SHOT_DURATION_SEC,
    MAX_SHOT_DURATION_SEC,
  )

export const getSegmentCurve = (keyframe: CameraKeyframe): CameraCurveType =>
  keyframe.curveToNext ?? 'smooth'

export const getSegmentCurveStrength = (keyframe: CameraKeyframe): number =>
  clamp(keyframe.curveStrengthToNext ?? 1, 0, 3)

export const getCurveControlPoint = (
  from: CameraKeyframe,
  to: CameraKeyframe,
): Vec3 => {
  if (from.curveToNext === 'custom' && from.curveControlToNext) {
    return from.curveControlInToNext
      ? lerpVec3(from.curveControlToNext, from.curveControlInToNext, 0.5)
      : from.curveControlToNext
  }

  const midpoint = lerpVec3(from.position, to.position, 0.5)
  const distance = distanceXZ(from.position, to.position)
  const strength = getSegmentCurveStrength(from)
  const curve = getSegmentCurve(from)

  switch (curve) {
    case 'arc-left':
      return addVec3(
        midpoint,
        scaleVec3(horizontalPerpendicular(from.position, to.position), distance * 0.42 * strength),
      )
    case 'arc-right':
      return addVec3(
        midpoint,
        scaleVec3(horizontalPerpendicular(from.position, to.position), -distance * 0.42 * strength),
      )
    case 'crane-up':
      return addVec3(midpoint, [0, distance * 0.35 * strength, 0])
    case 'crane-down':
      return addVec3(midpoint, [0, -distance * 0.28 * strength, 0])
    case 'smooth':
      return addVec3(midpoint, [0, distance * 0.16 * strength, 0])
    case 'custom':
    case 'linear':
    default:
      return midpoint
  }
}

export const sampleSegmentPosition = (
  from: CameraKeyframe,
  to: CameraKeyframe,
  progress: number,
): Vec3 => {
  const adjustedProgress = clamp(progress, 0, 1)

  if (getSegmentCurve(from) === 'linear') {
    return lerpVec3(from.position, to.position, adjustedProgress)
  }

  if (
    getSegmentCurve(from) === 'custom' &&
    from.curveControlToNext &&
    from.curveControlInToNext
  ) {
    return cubicBezier(
      from.position,
      from.curveControlToNext,
      from.curveControlInToNext,
      to.position,
      adjustedProgress,
    )
  }

  return quadraticBezier(
    from.position,
    getCurveControlPoint(from, to),
    to.position,
    adjustedProgress,
  )
}

export const sampleSegmentPoints = (
  from: CameraKeyframe,
  to: CameraKeyframe,
  steps = 24,
): Vec3[] =>
  Array.from({ length: steps + 1 }, (_, index) =>
    sampleSegmentPosition(from, to, index / steps),
  )

export const adjustProgressBySpeed = (
  progress: number,
  speed: number,
  speedCurve: SpeedCurveType = 'linear',
  speedCurvePoints?: SpeedCurvePoint[],
  speedCurveInterpolation: SpeedCurveInterpolation = 'linear',
): number => {
  const clampedProgress = clamp(progress, 0, 1)
  const clampedSpeed = getSegmentSpeed({
    id: 'speed',
    timeSec: 0,
    position: [0, 0, 0],
    target: [0, 0, 0],
    fov: 45,
    interpolation: 'linear',
    speedToNext: speed,
  })

  if (Math.abs(clampedSpeed - 1) < 0.001) {
    return applySpeedCurve(
      clampedProgress,
      speedCurve,
      speedCurvePoints,
      speedCurveInterpolation,
    )
  }

  if (speedCurve === 'custom') {
    const customProgress = applySpeedCurve(
      clampedProgress,
      speedCurve,
      speedCurvePoints,
      speedCurveInterpolation,
    )
    return 1 - Math.pow(1 - customProgress, clampedSpeed)
  }

  return applySpeedCurve(
    1 - Math.pow(1 - clampedProgress, clampedSpeed),
    speedCurve,
    speedCurvePoints,
    speedCurveInterpolation,
  )
}

export const getCameraSegments = (
  scene: SceneDocument,
): Array<{
  from: CameraKeyframe
  to: CameraKeyframe
  index: number
  speed: number
  speedCurve: SpeedCurveType
  speedCurvePoints: SpeedCurvePoint[]
  speedCurveInterpolation: SpeedCurveInterpolation
  curve: CameraCurveType
  curveStrength: number
  controlPoint: Vec3
}> => {
  const camera = getActiveCamera(scene)
  const sorted = sortKeyframes(camera?.keyframes ?? [])

  return sorted.slice(0, -1).flatMap((from, index) => {
    if (!isCameraSegmentConnected(from)) {
      return []
    }

    const to = sorted[index + 1]

    return [
      {
        from,
        to,
        index,
        speed: getSegmentSpeed(from),
        speedCurve: getSegmentSpeedCurve(from),
        speedCurvePoints: getSegmentSpeedCurvePoints(from),
        speedCurveInterpolation: getSegmentSpeedCurveInterpolation(from),
        curve: getSegmentCurve(from),
        curveStrength: getSegmentCurveStrength(from),
        controlPoint: getCurveControlPoint(from, to),
      },
    ]
  })
}

export const getActiveCamera = (scene: SceneDocument) =>
  scene.cameras.find((camera) => camera.id === scene.activeCameraId) ??
  scene.cameras[0]

export const getFixedShotSegments = (
  scene: SceneDocument,
): Array<{
  keyframe: CameraKeyframe
  index: number
  startSec: number
  endSec: number
  durationSec: number
}> => {
  const sorted = sortKeyframes(getActiveCamera(scene)?.keyframes ?? [])
  let startSec = 0

  return sorted.map((keyframe, index) => {
    const durationSec = getShotDuration(keyframe)
    const segment = {
      keyframe,
      index,
      startSec,
      endSec: startSec + durationSec,
      durationSec,
    }
    startSec += durationSec
    return segment
  })
}

export const getFixedShotsDuration = (scene: SceneDocument): number =>
  getFixedShotSegments(scene).reduce(
    (duration, segment) => duration + segment.durationSec,
    0,
  )

export const getTimelineDuration = (scene: SceneDocument): number =>
  getTimelineMode(scene) === 'shots'
    ? Math.max(MIN_SHOT_DURATION_SEC, getFixedShotsDuration(scene))
    : scene.renderSettings.durationSec

const getSegmentMotionWeight = (
  keyframes: CameraKeyframe[],
  index: number,
): number => {
  const from = keyframes[index]
  const to = keyframes[index + 1]
  const positionDistance = distance3d(from.position, to.position)
  const targetDistance = distance3d(from.target, to.target) * 0.35
  const fovDistance = Math.abs(from.fov - to.fov) * 0.04
  const curvature = Math.max(
    getTurnCurvatureFactor(keyframes, index),
    getTurnCurvatureFactor(keyframes, index + 1),
  )

  return Math.max(
    0.001,
    (positionDistance + targetDistance + fovDistance) * (1 + curvature * 0.35),
  )
}

const distributeKeyframeTimes = (
  weights: number[],
  durationSec: number,
): number[] => {
  const usableDuration = Math.max(0.001, durationSec)
  const totalWeight = Math.max(
    0.001,
    weights.reduce((sum, weight) => sum + weight, 0),
  )

  return Array.from({ length: weights.length + 1 }, (_, index) => {
    if (index === 0) {
      return 0
    }

    if (index === weights.length) {
      return usableDuration
    }

    return weights
      .slice(0, index)
      .reduce(
        (timeSec, weight) => timeSec + (weight / totalWeight) * usableDuration,
        0,
      )
  })
}

const shakeWave = (timeSec: number, frequency: number, phase: number): number =>
  Math.sin(timeSec * frequency * Math.PI * 2 + phase)

const addCameraMotionShake = (
  sample: CameraSample,
  settings: CameraMotionSettings,
  timeSec: number,
): CameraSample => {
  const normalized = normalizeCameraMotionSettings(settings)

  if (normalized.mode === 'stable' || normalized.shakeStrength <= 0) {
    return sample
  }

  const strength = normalized.shakeStrength
  const handheld = normalized.mode === 'handheld'
  const positionAmplitude = (handheld ? 0.035 : 0.012) * strength
  const targetAmplitude = (handheld ? 0.018 : 0.006) * strength
  const fovAmplitude = (handheld ? 0.12 : 0.035) * strength
  const baseFrequency = handheld ? 5.8 : 0.85

  const positionOffset: Vec3 = [
    shakeWave(timeSec, baseFrequency, 0.2) * positionAmplitude,
    shakeWave(timeSec, baseFrequency * 1.7, 1.4) * positionAmplitude * 0.65,
    shakeWave(timeSec, baseFrequency * 1.27, 2.1) * positionAmplitude,
  ]
  const targetOffset: Vec3 = [
    shakeWave(timeSec, baseFrequency * 1.35, 2.7) * targetAmplitude,
    shakeWave(timeSec, baseFrequency * 1.95, 0.8) * targetAmplitude,
    shakeWave(timeSec, baseFrequency * 1.1, 1.9) * targetAmplitude,
  ]

  return {
    position: addVec3(sample.position, positionOffset),
    target: addVec3(sample.target, targetOffset),
    fov: clamp(
      sample.fov + shakeWave(timeSec, baseFrequency * 0.7, 0.5) * fovAmplitude,
      10,
      120,
    ),
  }
}

const withCameraMotion = (
  scene: SceneDocument,
  timeSec: number,
  sample: CameraSample,
): CameraSample =>
  addCameraMotionShake(
    sample,
    normalizeCameraMotionSettings(scene.cameraMotion),
    timeSec,
  )

const smoothSegmentSpeeds = (speeds: number[]): number[] => {
  if (speeds.length < 2) {
    return speeds
  }

  return speeds.map((speed, index) => {
    const previous = speeds[index - 1]
    const next = speeds[index + 1]

    if (previous === undefined) {
      return clamp((speed * 2 + next) / 3, 0.25, 3)
    }

    if (next === undefined) {
      return clamp((previous + speed * 2) / 3, 0.25, 3)
    }

    return clamp((previous + speed * 2 + next) / 4, 0.25, 3)
  })
}

export const smoothCameraKeyframes = (
  keyframes: CameraKeyframe[],
  _durationSec: number,
): CameraKeyframe[] => {
  const sorted = sortKeyframes(keyframes)

  if (sorted.length < 2) {
    return sorted
  }

  const controlPairs = sorted.slice(0, -1).map((_, index) =>
    getCurvatureSmoothedSegmentControls(sorted, index),
  )

  return sorted.map((keyframe, index) => {
    const smoothedKeyframe: CameraKeyframe = {
      ...keyframe,
      curveToNext: index === sorted.length - 1 ? 'linear' : 'custom',
      curveStrengthToNext: index === sorted.length - 1 ? 1 : 0.9,
      curveControlToNext: controlPairs[index]?.controlOut,
      curveControlInToNext: controlPairs[index]?.controlIn,
    }

    if (index === sorted.length - 1) {
      delete smoothedKeyframe.curveControlToNext
      delete smoothedKeyframe.curveControlInToNext
    }

    return smoothedKeyframe
  })
}

export const smoothCameraRateKeyframes = (
  keyframes: CameraKeyframe[],
  durationSec: number,
): CameraKeyframe[] => {
  const sorted = sortKeyframes(keyframes)

  if (sorted.length < 2) {
    return sorted
  }

  const smoothedSpeeds = smoothSegmentSpeeds(
    sorted.slice(0, -1).map((keyframe) => getSegmentSpeed(keyframe)),
  )
  const weights = sorted
    .slice(0, -1)
    .map((_, index) => getSegmentMotionWeight(sorted, index) / smoothedSpeeds[index])
  const keyframeTimes = distributeKeyframeTimes(weights, durationSec)

  return sorted.map((keyframe, index) => ({
    ...keyframe,
    timeSec: keyframeTimes[index],
    speedToNext:
      index < smoothedSpeeds.length ? smoothedSpeeds[index] : keyframe.speedToNext,
  }))
}

export const resolveCameraTarget = (
  scene: SceneDocument,
  fallbackTarget: Vec3,
  timeSec: number,
): Vec3 => {
  const anchor = scene.cameraAimAnchor

  if (!anchor?.enabled) {
    return fallbackTarget
  }

  if (anchor.targetObjectId) {
    const targetObject = scene.objects.find(
      (object) => object.id === anchor.targetObjectId && object.visible,
    )

    if (targetObject) {
      const sampled = sampleObjectMotionTransform(targetObject, timeSec)
      const offset = anchor.targetOffset ?? ([0, 0, 0] as Vec3)

      return [
        sampled.position[0] + offset[0],
        sampled.position[1] + offset[1],
        sampled.position[2] + offset[2],
      ]
    }
  }

  return anchor.position
}

export const sampleCameraAtTime = (
  scene: SceneDocument,
  timeSec: number,
): CameraSample => {
  const camera = getActiveCamera(scene)
  const sorted = sortKeyframes(camera?.keyframes ?? [])

  if (getTimelineMode(scene) === 'shots') {
    const shotSegments = getFixedShotSegments(scene)
    const activeShot =
      shotSegments.find(
        (segment) => timeSec >= segment.startSec && timeSec < segment.endSec,
      ) ??
      shotSegments[shotSegments.length - 1]

    if (activeShot) {
      return withCameraMotion(scene, timeSec, {
        position: activeShot.keyframe.position,
        target: resolveCameraTarget(scene, activeShot.keyframe.target, timeSec),
        fov: activeShot.keyframe.fov,
      })
    }
  }

  if (sorted.length === 0) {
    return withCameraMotion(scene, timeSec, {
      position: [6, 4, 6],
      target: resolveCameraTarget(scene, [0, 1, 0], timeSec),
      fov: 45,
    })
  }

  if (sorted.length === 1 || timeSec <= sorted[0].timeSec) {
    const keyframe = sorted[0]
    return withCameraMotion(scene, timeSec, {
      position: keyframe.position,
      target: resolveCameraTarget(scene, keyframe.target, timeSec),
      fov: keyframe.fov,
    })
  }

  const last = sorted[sorted.length - 1]
  if (timeSec >= last.timeSec) {
    return withCameraMotion(scene, timeSec, {
      position: last.position,
      target: resolveCameraTarget(scene, last.target, timeSec),
      fov: last.fov,
    })
  }

  const nextIndex = sorted.findIndex((keyframe) => keyframe.timeSec >= timeSec)
  const from = sorted[nextIndex - 1]
  const to = sorted[nextIndex]
  const span = Math.max(0.001, to.timeSec - from.timeSec)
  const progress = clamp((timeSec - from.timeSec) / span, 0, 1)

  if (!isCameraSegmentConnected(from) && progress < 0.999) {
    return withCameraMotion(scene, timeSec, {
      position: from.position,
      target: resolveCameraTarget(scene, from.target, timeSec),
      fov: from.fov,
    })
  }

  const adjustedProgress = adjustProgressBySpeed(
    progress,
    getSegmentSpeed(from),
    getSegmentSpeedCurve(from),
    getSegmentSpeedCurvePoints(from),
    getSegmentSpeedCurveInterpolation(from),
  )

  return withCameraMotion(scene, timeSec, {
    position: sampleSegmentPosition(from, to, adjustedProgress),
    target: resolveCameraTarget(
      scene,
      lerpVec3(from.target, to.target, adjustedProgress),
      timeSec,
    ),
    fov: lerp(from.fov, to.fov, adjustedProgress),
  })
}

export const getFrameCount = (durationSec: number, fps: number): number =>
  Math.max(1, Math.ceil(durationSec * fps))

export const clampTimeToDuration = (
  timeSec: number,
  durationSec: number,
): number => clamp(timeSec, 0, Math.max(0, durationSec))
