import { z } from 'zod'
import {
  DEFAULT_RENDER_SETTINGS,
  type RenderSettings,
  type SceneDocument,
} from './types'
import {
  LIGHT_MAX_DISTANCE,
  LIGHT_MIN_DISTANCE,
  normalizeSceneLights,
} from './lights'

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const transformSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
})

const speedCurveValueSchema = z.union([
  z.literal('linear'),
  z.literal('ease-in'),
  z.literal('ease-out'),
  z.literal('ease-in-out'),
  z.literal('strong-ease-in'),
  z.literal('strong-ease-out'),
])

const speedCurveSchema = speedCurveValueSchema.default('linear')

const objectMotionSchema = z.object({
  enabled: z.boolean(),
  mode: z.union([
    z.literal('none'),
    z.literal('linear'),
    z.literal('pingpong'),
    z.literal('orbit'),
    z.literal('takeoff'),
    z.literal('hover'),
    z.literal('lane_change'),
    z.literal('weave'),
    z.literal('pursuit'),
    z.literal('bank_turn'),
    z.literal('jump'),
  ]),
  speedCurve: speedCurveSchema,
  startSec: z.number().min(0).max(300),
  durationSec: z.number().min(0.25).max(300),
  directionDeg: z.number().min(-180).max(180),
  distance: z.number().min(0).max(60),
  heightDelta: z.number().min(-20).max(20),
  radius: z.number().min(0).max(30),
  loops: z.number().min(0.25).max(12),
  autoFace: z.boolean(),
  faceOffsetDeg: z.number().min(-180).max(180).default(0),
})

const sceneObjectSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  transform: transformSchema,
  visible: z.boolean(),
  material: z.object({
    color: z.string().min(1),
    roughness: z.number().min(0).max(1),
  }),
  motion: objectMotionSchema.optional(),
  metadata: z
    .object({
      url: z.string().optional(),
      sourceName: z.string().optional(),
      format: z
        .union([
          z.literal('gltf'),
          z.literal('obj'),
          z.literal('stl'),
          z.literal('fbx'),
          z.literal('dae'),
          z.literal('ply'),
          z.literal('3mf'),
          z.literal('3ds'),
        ])
        .optional(),
      textureUrl: z.string().optional(),
      textureName: z.string().optional(),
    })
    .optional(),
})

const cameraKeyframeSchema = z.object({
  id: z.string().min(1),
  timeSec: z.number().min(0),
  position: vec3Schema,
  target: vec3Schema,
  fov: z.number().min(10).max(120),
  interpolation: z.literal('linear'),
  shotDurationSec: z.number().min(0.5).max(30).optional(),
  speedToNext: z.number().min(0.25).max(3).optional(),
  speedCurveToNext: speedCurveValueSchema.optional(),
  curveToNext: z
    .union([
      z.literal('linear'),
      z.literal('smooth'),
      z.literal('arc-left'),
      z.literal('arc-right'),
      z.literal('crane-up'),
      z.literal('crane-down'),
      z.literal('custom'),
    ])
    .optional(),
  curveStrengthToNext: z.number().min(0).max(3).optional(),
  curveControlToNext: vec3Schema.optional(),
  curveControlInToNext: vec3Schema.optional(),
})

const virtualCameraSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  keyframes: z.array(cameraKeyframeSchema).min(1),
})

const cameraAimAnchorSchema = z.object({
  enabled: z.boolean(),
  position: vec3Schema,
  snapEnabled: z.boolean(),
  targetObjectId: z.string().optional(),
  targetOffset: vec3Schema.optional(),
})

const cameraMotionSchema = z.object({
  mode: z
    .union([z.literal('stable'), z.literal('handheld'), z.literal('drone')])
    .default('stable'),
  shakeStrength: z.number().min(0).max(2).default(0),
})

const sceneLightSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.union([
    z.literal('ambient'),
    z.literal('directional'),
    z.literal('point'),
    z.literal('spot'),
  ]),
  enabled: z.boolean(),
  intensity: z.number().min(0).max(10),
  colorTemperature: z.number().min(2000).max(10000),
  azimuthDeg: z.number().min(-180).max(180),
  elevationDeg: z.number().min(-90).max(90),
  distance: z.number().transform((value) =>
    clamp(value, LIGHT_MIN_DISTANCE, LIGHT_MAX_DISTANCE),
  ),
  position: vec3Schema.optional(),
  target: vec3Schema.optional(),
})

export const renderSettingsSchema = z.object({
  durationSec: z.number().min(1).max(300),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  width: z.number().int().min(320).max(3840),
  height: z.number().int().min(240).max(2160),
  format: z.literal('mp4'),
  fillWhiteGround: z.boolean().default(false),
  hideGrid: z.boolean().default(false),
})

export const sceneDocumentSchema = z.object({
  version: z.literal(1),
  objects: z.array(sceneObjectSchema),
  cameras: z.array(virtualCameraSchema).min(1),
  activeCameraId: z.string().min(1),
  cameraAimAnchor: cameraAimAnchorSchema.optional(),
  cameraMotion: cameraMotionSchema.optional(),
  lights: z.array(sceneLightSchema).optional(),
  timeline: z.object({
    currentTimeSec: z.number().min(0),
    mode: z.union([z.literal('motion'), z.literal('shots')]).optional(),
  }),
  renderSettings: renderSettingsSchema,
})

export const normalizeRenderSettings = (
  value: Partial<RenderSettings>,
): RenderSettings => renderSettingsSchema.parse({
  ...DEFAULT_RENDER_SETTINGS,
  ...value,
})

export const validateSceneDocument = (value: unknown): SceneDocument => {
  const scene = sceneDocumentSchema.parse(value)

  return {
    ...scene,
    lights: scene.lights ? normalizeSceneLights(scene.lights) : scene.lights,
  }
}
