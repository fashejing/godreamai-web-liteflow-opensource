import type { SceneLight, Vec3 } from './types'

export const LIGHT_MIN_DISTANCE = 0.1
export const LIGHT_MAX_DISTANCE = 50

export const defaultSceneLights: SceneLight[] = [
  {
    id: 'light-ambient',
    name: '环境柔光',
    kind: 'ambient',
    enabled: true,
    intensity: 0.42,
    colorTemperature: 6200,
    azimuthDeg: 0,
    elevationDeg: 90,
    distance: 1,
  },
  {
    id: 'light-key',
    name: '主光',
    kind: 'directional',
    enabled: true,
    intensity: 1.15,
    colorTemperature: 5600,
    azimuthDeg: 42,
    elevationDeg: 46,
    distance: 9,
    target: [0, 1.2, 0],
  },
  {
    id: 'light-rim',
    name: '轮廓光',
    kind: 'directional',
    enabled: true,
    intensity: 0.45,
    colorTemperature: 7200,
    azimuthDeg: -135,
    elevationDeg: 24,
    distance: 7,
    target: [0, 1.4, 0],
  },
]

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export const clampLightDistance = (distance: number): number =>
  clamp(Number.isFinite(distance) ? distance : 1, LIGHT_MIN_DISTANCE, LIGHT_MAX_DISTANCE)

export const clampLightPosition = (
  position: Vec3,
  target: Vec3 = [0, 0, 0],
): Vec3 => {
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  const dz = position[2] - target[2]
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

  if (distance <= LIGHT_MAX_DISTANCE || distance < LIGHT_MIN_DISTANCE) {
    return position
  }

  const ratio = LIGHT_MAX_DISTANCE / distance

  return [
    target[0] + dx * ratio,
    target[1] + dy * ratio,
    target[2] + dz * ratio,
  ]
}

export const kelvinToHex = (kelvin: number): string => {
  const temperature = clamp(kelvin, 2000, 10000) / 100
  let red = 255
  let green = 255
  let blue = 255

  if (temperature <= 66) {
    red = 255
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661
    blue =
      temperature <= 19
        ? 0
        : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307
  } else {
    red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592)
    green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492)
    blue = 255
  }

  const toHex = (value: number) =>
    Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

export const lightDirectionToPosition = (light: SceneLight): Vec3 => {
  const target = light.target ?? ([0, 1.2, 0] as Vec3)

  if (light.position) {
    return clampLightPosition(light.position, target)
  }

  const azimuth = (light.azimuthDeg * Math.PI) / 180
  const elevation = (light.elevationDeg * Math.PI) / 180
  const radius = clampLightDistance(light.distance)
  const horizontal = Math.cos(elevation) * radius

  return [
    target[0] + Math.sin(azimuth) * horizontal,
    target[1] + Math.sin(elevation) * radius,
    target[2] + Math.cos(azimuth) * horizontal,
  ]
}

export const positionToLightAngles = (
  position: Vec3,
  target: Vec3 = [0, 0, 0],
): Pick<SceneLight, 'azimuthDeg' | 'elevationDeg' | 'distance'> => {
  const clampedPosition = clampLightPosition(position, target)
  const dx = clampedPosition[0] - target[0]
  const dy = clampedPosition[1] - target[1]
  const dz = clampedPosition[2] - target[2]
  const distance = clampLightDistance(Math.sqrt(dx * dx + dy * dy + dz * dz))
  const horizontal = Math.max(0.001, Math.sqrt(dx * dx + dz * dz))

  return {
    azimuthDeg: (Math.atan2(dx, dz) * 180) / Math.PI,
    elevationDeg: (Math.atan2(dy, horizontal) * 180) / Math.PI,
    distance,
  }
}

export const normalizeSceneLight = (light: SceneLight): SceneLight => {
  const target = light.target ?? ([0, 1.2, 0] as Vec3)
  const position = light.position
    ? clampLightPosition(light.position, target)
    : undefined

  return {
    ...light,
    distance: clampLightDistance(light.distance),
    position,
  }
}

export const normalizeSceneLights = (lights: SceneLight[] = []): SceneLight[] =>
  lights.map(normalizeSceneLight)

export const createLight = (index: number): SceneLight => ({
  id: `light-${Date.now()}-${index}`,
  name: `补光 ${index}`,
  kind: 'directional',
  enabled: true,
  intensity: 0.75,
  colorTemperature: 5600,
  azimuthDeg: 30,
  elevationDeg: 35,
  distance: 8,
  target: [0, 1.2, 0],
})
