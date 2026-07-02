import type { SpeedCurveType } from './types'

export const speedCurveOptions: Array<{ value: SpeedCurveType; label: string }> = [
  { value: 'linear', label: '线性' },
  { value: 'ease-in', label: '缓入' },
  { value: 'ease-out', label: '缓出' },
  { value: 'ease-in-out', label: 'S曲线' },
  { value: 'strong-ease-in', label: '强缓入' },
  { value: 'strong-ease-out', label: '强缓出' },
]

const speedCurveValues = new Set(speedCurveOptions.map((option) => option.value))

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1)

export const normalizeSpeedCurve = (value?: string): SpeedCurveType =>
  value && speedCurveValues.has(value as SpeedCurveType)
    ? (value as SpeedCurveType)
    : 'linear'

export const applySpeedCurve = (
  progress: number,
  curve: SpeedCurveType = 'linear',
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
    case 'linear':
    default:
      return t
  }
}
