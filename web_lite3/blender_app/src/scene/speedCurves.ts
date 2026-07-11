import type {
  SpeedCurveInterpolation,
  SpeedCurvePoint,
  SpeedCurveType,
} from './types'

export const speedCurveOptions: Array<{ value: SpeedCurveType; label: string }> = [
  { value: 'linear', label: '线性' },
  { value: 'ease-in', label: '缓入' },
  { value: 'ease-out', label: '缓出' },
  { value: 'ease-in-out', label: 'S曲线' },
  { value: 'strong-ease-in', label: '强缓入' },
  { value: 'strong-ease-out', label: '强缓出' },
]

export const cameraSpeedCurveOptions: Array<{
  value: SpeedCurveType
  label: string
}> = [...speedCurveOptions, { value: 'custom', label: '自定义曲线' }]

const speedCurveValues = new Set(
  cameraSpeedCurveOptions.map((option) => option.value),
)

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1)
const clampRate = (value: number): number => Math.min(Math.max(value, 0), 3)

export const DEFAULT_CUSTOM_SPEED_CURVE: SpeedCurvePoint[] = [
  { time: 0, rate: 1 },
  { time: 1, rate: 1 },
]

export const normalizeCustomSpeedCurvePoints = (
  points?: SpeedCurvePoint[],
): SpeedCurvePoint[] => {
  const sorted = (points ?? [])
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.rate))
    .map((point) => ({
      time: clamp01(point.time),
      rate: clampRate(point.rate),
    }))
    .sort((left, right) => left.time - right.time)
  const normalized = sorted.reduce<SpeedCurvePoint[]>((result, point) => {
    const previous = result[result.length - 1]
    if (previous && Math.abs(previous.time - point.time) < 0.0001) {
      previous.rate = point.rate
    } else {
      result.push(point)
    }
    return result
  }, [])

  if (normalized.length < 2) {
    return DEFAULT_CUSTOM_SPEED_CURVE.map((point) => ({ ...point }))
  }

  normalized[0].time = 0
  normalized[normalized.length - 1].time = 1
  return normalized
}

export const normalizeSpeedCurveInterpolation = (
  value?: string,
): SpeedCurveInterpolation => (value === 'smooth' ? 'smooth' : 'linear')

const getMonotoneTangents = (curve: SpeedCurvePoint[]): number[] => {
  const durations = curve.slice(0, -1).map((point, index) =>
    Math.max(0.0001, curve[index + 1].time - point.time),
  )
  const slopes = durations.map(
    (duration, index) =>
      (curve[index + 1].rate - curve[index].rate) / duration,
  )

  if (curve.length === 2) {
    return [slopes[0], slopes[0]]
  }

  const tangents = new Array<number>(curve.length).fill(0)
  const endpointTangent = (
    firstDuration: number,
    secondDuration: number,
    firstSlope: number,
    secondSlope: number,
  ) => {
    let tangent =
      ((2 * firstDuration + secondDuration) * firstSlope -
        firstDuration * secondSlope) /
      (firstDuration + secondDuration)
    if (tangent * firstSlope <= 0) {
      return 0
    }
    if (
      firstSlope * secondSlope < 0 &&
      Math.abs(tangent) > Math.abs(3 * firstSlope)
    ) {
      tangent = 3 * firstSlope
    }
    return tangent
  }

  tangents[0] = endpointTangent(
    durations[0],
    durations[1],
    slopes[0],
    slopes[1],
  )
  tangents[curve.length - 1] = endpointTangent(
    durations[durations.length - 1],
    durations[durations.length - 2],
    slopes[slopes.length - 1],
    slopes[slopes.length - 2],
  )

  for (let index = 1; index < curve.length - 1; index += 1) {
    const previousSlope = slopes[index - 1]
    const nextSlope = slopes[index]
    if (previousSlope * nextSlope <= 0) {
      tangents[index] = 0
      continue
    }

    const previousDuration = durations[index - 1]
    const nextDuration = durations[index]
    const firstWeight = 2 * nextDuration + previousDuration
    const secondWeight = nextDuration + 2 * previousDuration
    tangents[index] =
      (firstWeight + secondWeight) /
      (firstWeight / previousSlope + secondWeight / nextSlope)
  }

  return tangents
}

const sampleSmoothSegment = (
  from: SpeedCurvePoint,
  to: SpeedCurvePoint,
  fromTangent: number,
  toTangent: number,
  progress: number,
): number => {
  const u = clamp01(progress)
  const duration = Math.max(0.0001, to.time - from.time)
  const u2 = u * u
  const u3 = u2 * u
  return clampRate(
    (2 * u3 - 3 * u2 + 1) * from.rate +
      (u3 - 2 * u2 + u) * duration * fromTangent +
      (-2 * u3 + 3 * u2) * to.rate +
      (u3 - u2) * duration * toTangent,
  )
}

export const sampleCustomSpeedCurveRate = (
  time: number,
  points?: SpeedCurvePoint[],
  interpolation: SpeedCurveInterpolation = 'linear',
): number => {
  const curve = normalizeCustomSpeedCurvePoints(points)
  const targetTime = clamp01(time)
  const segmentIndex = Math.min(
    curve.length - 2,
    Math.max(
      0,
      curve.findIndex((_, index) =>
        index < curve.length - 1 && targetTime <= curve[index + 1].time,
      ),
    ),
  )
  const from = curve[segmentIndex]
  const to = curve[segmentIndex + 1]
  const duration = Math.max(0.0001, to.time - from.time)
  const progress = clamp01((targetTime - from.time) / duration)

  if (normalizeSpeedCurveInterpolation(interpolation) === 'linear') {
    return from.rate + (to.rate - from.rate) * progress
  }

  const tangents = getMonotoneTangents(curve)
  return sampleSmoothSegment(
    from,
    to,
    tangents[segmentIndex],
    tangents[segmentIndex + 1],
    progress,
  )
}

const integrateSmoothSegment = (
  from: SpeedCurvePoint,
  to: SpeedCurvePoint,
  fromTangent: number,
  toTangent: number,
  progress: number,
): number => {
  const u = clamp01(progress)
  const duration = Math.max(0, to.time - from.time)
  const u2 = u * u
  const u3 = u2 * u
  const u4 = u3 * u
  return duration * (
    (0.5 * u4 - u3 + u) * from.rate +
    (0.25 * u4 - (2 / 3) * u3 + 0.5 * u2) * duration * fromTangent +
    (-0.5 * u4 + u3) * to.rate +
    (0.25 * u4 - (1 / 3) * u3) * duration * toTangent
  )
}

const integrateCustomSpeedCurve = (
  progress: number,
  points?: SpeedCurvePoint[],
  interpolation: SpeedCurveInterpolation = 'linear',
): number => {
  const curve = normalizeCustomSpeedCurvePoints(points)
  const targetTime = clamp01(progress)
  const normalizedInterpolation = normalizeSpeedCurveInterpolation(interpolation)
  const tangents =
    normalizedInterpolation === 'smooth' ? getMonotoneTangents(curve) : []
  let elapsedArea = 0
  let totalArea = 0

  for (let index = 0; index < curve.length - 1; index += 1) {
    const from = curve[index]
    const to = curve[index + 1]
    const duration = Math.max(0, to.time - from.time)
    const segmentArea =
      normalizedInterpolation === 'smooth'
        ? integrateSmoothSegment(
            from,
            to,
            tangents[index],
            tangents[index + 1],
            1,
          )
        : duration * (from.rate + to.rate) * 0.5
    totalArea += segmentArea

    if (targetTime <= from.time || duration === 0) {
      continue
    }

    const localDuration = Math.min(targetTime, to.time) - from.time
    const localProgress = localDuration / duration
    if (normalizedInterpolation === 'smooth') {
      elapsedArea += integrateSmoothSegment(
        from,
        to,
        tangents[index],
        tangents[index + 1],
        localProgress,
      )
    } else {
      const localRate = from.rate + (to.rate - from.rate) * localProgress
      elapsedArea += localDuration * (from.rate + localRate) * 0.5
    }
  }

  return totalArea > 0.0001 ? clamp01(elapsedArea / totalArea) : targetTime
}

export const normalizeSpeedCurve = (value?: string): SpeedCurveType =>
  value && speedCurveValues.has(value as SpeedCurveType)
    ? (value as SpeedCurveType)
    : 'linear'

export const applySpeedCurve = (
  progress: number,
  curve: SpeedCurveType = 'linear',
  customPoints?: SpeedCurvePoint[],
  customInterpolation: SpeedCurveInterpolation = 'linear',
): number => {
  const t = clamp01(progress)

  switch (normalizeSpeedCurve(curve)) {
    case 'ease-in':
      return t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t)
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'strong-ease-in':
      return t * t * t
    case 'strong-ease-out':
      return 1 - Math.pow(1 - t, 3)
    case 'custom':
      return integrateCustomSpeedCurve(t, customPoints, customInterpolation)
    case 'linear':
    default:
      return t
  }
}
