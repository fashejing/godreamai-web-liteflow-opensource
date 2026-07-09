import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { app } from '../server/index'
import {
  connectCameraKeyframes,
  getCameraSegments,
  getFixedShotSegments,
  getFrameCount,
  getNextCameraKeyframeTime,
  getTimelineDuration,
  sampleCameraAtTime,
  sampleSegmentPoints,
  smoothCameraKeyframes,
  smoothCameraRateKeyframes,
} from '../src/scene/camera'
import { builtInAssets } from '../src/scene/assets'
import { cinematicMovePresets } from '../src/scene/cameraPresets'
import { createInitialScene, createObjectFromAsset } from '../src/scene/factory'
import {
  objectMotionPresets,
  reverseObjectMotion,
  reverseObjectMotionFacing,
  sceneMotionPresets,
  sampleObjectMotionTransform,
} from '../src/scene/objectMotion'
import { popSceneHistory, pushSceneHistory } from '../src/scene/history'
import {
  getObjectTopY,
  snapObjectPositionToPlacementGuide,
} from '../src/scene/placement'
import { normalizeRenderSettings, validateSceneDocument } from '../src/scene/validation'
import {
  getAdaptiveMarkerScale,
  getFrameDistanceForBounds,
  getSceneObjectBounds,
} from '../src/scene/viewFrame'
import type { AssetDefinition, ObjectMotion, Vec3 } from '../src/scene/types'

const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]

const length = (value: Vec3): number =>
  Math.sqrt(
    value[0] * value[0] + value[1] * value[1] + value[2] * value[2],
  )

const normalize = (value: Vec3): Vec3 => {
  const length = Math.sqrt(
    value[0] * value[0] + value[1] * value[1] + value[2] * value[2],
  )

  return [value[0] / length, value[1] / length, value[2] / length]
}

const angleDeg = (a: Vec3, b: Vec3): number => {
  const na = normalize(a)
  const nb = normalize(b)
  const cosine = Math.min(
    1,
    Math.max(-1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]),
  )

  return (Math.acos(cosine) * 180) / Math.PI
}

const makeStoredZip = (entries: Array<{ name: string; content: string | Uint8Array }>): Uint8Array => {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt32LE(0, 14)
    localHeader.writeUInt32LE(content.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localParts.push(localHeader, name, content)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt32LE(0, 16)
    centralHeader.writeUInt32LE(content.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + content.length
  })

  const centralDirectoryOffset = offset
  const centralDirectory = Buffer.concat(centralParts)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(entries.length, 8)
  endOfCentralDirectory.writeUInt16LE(entries.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16)

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory])
}

let baseUrl = ''
let server: ReturnType<typeof createServer>

beforeAll(async () => {
  server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()

  if (address && typeof address === 'object') {
    baseUrl = `http://127.0.0.1:${address.port}`
  }
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

describe('scene document schema', () => {
  it('accepts the initial scene document', () => {
    const scene = createInitialScene()

    expect(validateSceneDocument(scene)).toEqual(scene)
  })

  it('clamps render settings to the public v1 limits', () => {
    const settings = normalizeRenderSettings({
      durationSec: 12,
      fps: 30,
      width: 1280,
      height: 720,
      format: 'mp4',
      fillWhiteGround: true,
      hideGrid: true,
      floorMaterial: 'checker',
    })

    expect(settings).toEqual({
      durationSec: 12,
      fps: 30,
      width: 1280,
      height: 720,
      format: 'mp4',
      fillWhiteGround: true,
      hideGrid: true,
      floorMaterial: 'checker',
    })
  })

  it('keeps render background options optional for old scenes', () => {
    const scene = createInitialScene()
    const legacyRenderSettings = { ...scene.renderSettings }
    delete (legacyRenderSettings as Partial<typeof scene.renderSettings>).fillWhiteGround
    delete (legacyRenderSettings as Partial<typeof scene.renderSettings>).hideGrid
    delete (legacyRenderSettings as Partial<typeof scene.renderSettings>).floorMaterial

    const parsed = validateSceneDocument({
      ...scene,
      renderSettings: legacyRenderSettings,
    })

    expect(parsed.renderSettings.fillWhiteGround).toBe(false)
    expect(parsed.renderSettings.hideGrid).toBe(false)
    expect(parsed.renderSettings.floorMaterial).toBe('studio')
  })

  it('normalizes oversized light distances instead of rejecting render payloads', () => {
    const scene = createInitialScene()
    scene.lights![1].distance = 120
    scene.lights![1].position = [120, 1.2, 0]

    const parsed = validateSceneDocument(scene)
    const light = parsed.lights![1]
    const target = light.target ?? ([0, 1.2, 0] as Vec3)
    const position = light.position ?? ([0, 0, 0] as Vec3)
    const distance = Math.sqrt(
      (position[0] - target[0]) ** 2 +
        (position[1] - target[1]) ** 2 +
        (position[2] - target[2]) ** 2,
    )

    expect(light.distance).toBe(50)
    expect(distance).toBeLessThanOrEqual(50)
  })
})

describe('scene undo history', () => {
  it('keeps the newest scene snapshots within the history limit', () => {
    const first = createInitialScene()
    const second = {
      ...createInitialScene(),
      renderSettings: {
        ...createInitialScene().renderSettings,
        width: 1280,
      },
    }
    const third = {
      ...createInitialScene(),
      renderSettings: {
        ...createInitialScene().renderSettings,
        width: 1920,
      },
    }

    let history = pushSceneHistory([], first, 2)
    history = pushSceneHistory(history, second, 2)
    history = pushSceneHistory(history, third, 2)

    expect(history.map((scene) => scene.renderSettings.width)).toEqual([1280, 1920])
  })

  it('pops the most recent scene snapshot for undo', () => {
    const first = {
      ...createInitialScene(),
      renderSettings: {
        ...createInitialScene().renderSettings,
        width: 1280,
      },
    }
    const second = {
      ...createInitialScene(),
      renderSettings: {
        ...createInitialScene().renderSettings,
        width: 1920,
      },
    }

    const popped = popSceneHistory([first, second])

    expect(popped.previousScene?.renderSettings.width).toBe(1920)
    expect(popped.history.map((scene) => scene.renderSettings.width)).toEqual([1280])
  })
})

describe('viewport framing', () => {
  it('keeps viewport helper markers compact near the camera', () => {
    expect(getAdaptiveMarkerScale(0.4)).toBe(0.22)
    expect(getAdaptiveMarkerScale(3)).toBeCloseTo(0.54)
    expect(getAdaptiveMarkerScale(12)).toBe(1)
  })

  it('frames scaled imported models from asset dimensions', () => {
    const importedAsset: AssetDefinition = {
      id: 'asset-plastic-crate',
      label: 'Plastic crate',
      category: 'prop',
      kind: 'imported',
      url: '/assets/plastic_crate_03_1k.gltf',
      format: 'gltf',
      dimensions: [2, 1, 3],
    }
    const scene = createInitialScene()
    scene.objects = [
      createObjectFromAsset(importedAsset, {
        id: 'object-plastic-crate',
        transform: {
          position: [3, 0, -2],
          rotation: [0, 0, 0],
          scale: [2, 1.5, 0.5],
        },
      }),
    ]

    const bounds = getSceneObjectBounds(scene.objects, [...builtInAssets, importedAsset])

    expect(bounds).not.toBeNull()
    expect(bounds!.getCenter(new Vector3()).toArray()).toEqual([3, 0.75, -2])
    expect(bounds!.getSize(new Vector3()).toArray()).toEqual([4, 1.5, 1.5])
    expect(getFrameDistanceForBounds(bounds!, 48, 16 / 9)).toBeGreaterThan(2)
  })
})

describe('camera timeline sampling', () => {
  it('places repeated camera keyframe additions into the next open time slot', () => {
    const scene = createInitialScene()
    scene.cameras[0].keyframes = [
      {
        ...scene.cameras[0].keyframes[0],
        timeSec: 0,
      },
    ]

    const firstAddedTime = getNextCameraKeyframeTime(
      scene.cameras[0].keyframes,
      0,
      scene.renderSettings.durationSec,
    )
    scene.cameras[0].keyframes.push({
      ...scene.cameras[0].keyframes[0],
      id: 'kf-added-1',
      timeSec: firstAddedTime,
    })
    const secondAddedTime = getNextCameraKeyframeTime(
      scene.cameras[0].keyframes,
      0,
      scene.renderSettings.durationSec,
    )

    expect(firstAddedTime).toBe(2)
    expect(secondAddedTime).toBe(4)
  })

  it('connects camera keyframes into one continuous trajectory', () => {
    const scene = createInitialScene()
    scene.renderSettings.durationSec = 12
    const [first, second, third] = scene.cameras[0].keyframes
    const connected = connectCameraKeyframes(
      [
        {
          ...first,
          timeSec: 0,
          curveToNext: 'custom',
          curveControlToNext: [1, 2, 3],
          curveControlInToNext: [3, 2, 1],
        },
        {
          ...second,
          timeSec: 0,
        },
        {
          ...third,
          timeSec: 0,
        },
      ],
      scene.renderSettings.durationSec,
    )

    expect(connected.durationSec).toBe(12)
    expect(connected.keyframes.map((keyframe) => keyframe.timeSec)).toEqual([
      0, 6, 12,
    ])
    expect(connected.keyframes.every((keyframe) => keyframe.curveToNext === 'linear')).toBe(
      true,
    )
    expect(connected.keyframes.every((keyframe) => keyframe.connectToNext)).toBe(
      true,
    )
    expect(connected.keyframes[0].curveControlToNext).toBeUndefined()
    expect(connected.keyframes[0].curveControlInToNext).toBeUndefined()
  })

  it('lets camera trajectory segments be disconnected independently', () => {
    const scene = createInitialScene()
    scene.cameras[0].keyframes[0] = {
      ...scene.cameras[0].keyframes[0],
      curveToNext: 'linear',
      connectToNext: false,
    }

    const segments = getCameraSegments(scene)
    const sample = sampleCameraAtTime(scene, 2.5)

    expect(segments.map((segment) => segment.index)).toEqual([1])
    expect(sample.position).toEqual(scene.cameras[0].keyframes[0].position)
    expect(sample.fov).toBe(scene.cameras[0].keyframes[0].fov)
  })

  it('samples midway between two keyframes', () => {
    const scene = createInitialScene()
    scene.cameras[0].keyframes[0].curveToNext = 'linear'
    const sample = sampleCameraAtTime(scene, 2.5)

    expect(sample.position[0]).toBeCloseTo(-3.9)
    expect(sample.position[1]).toBeCloseTo(2.8)
    expect(sample.position[2]).toBeCloseTo(5.1)
    expect(sample.fov).toBeCloseTo(41.5)
  })

  it('uses duration and fps to calculate deterministic frame counts', () => {
    expect(getFrameCount(5, 30)).toBe(150)
    expect(getFrameCount(12, 24)).toBe(288)
  })

  it('uses segment speed to change travel progress along a trajectory', () => {
    const scene = createInitialScene()
    scene.cameras[0].keyframes[0].curveToNext = 'linear'
    scene.cameras[0].keyframes[0].speedToNext = 2
    const sample = sampleCameraAtTime(scene, 2.5)

    expect(sample.position[0]).toBeGreaterThan(-3.9)
    expect(sample.position[2]).toBeLessThan(5.1)
  })

  it('samples curved camera paths using segment curve controls', () => {
    const scene = createInitialScene()
    const [from, to] = scene.cameras[0].keyframes
    from.curveToNext = 'arc-left'
    from.curveStrengthToNext = 1
    const points = sampleSegmentPoints(from, to, 8)
    const midpoint = points[4]
    const linearMidpointX = (from.position[0] + to.position[0]) / 2

    expect(Math.abs(midpoint[0] - linearMidpointX)).toBeGreaterThan(0.1)
  })

  it('uses an enabled aim anchor as the camera target', () => {
    const scene = createInitialScene()
    scene.cameraAimAnchor = {
      enabled: true,
      position: [2, 1.5, -1],
      snapEnabled: true,
    }
    const sample = sampleCameraAtTime(scene, 2.5)

    expect(sample.target).toEqual([2, 1.5, -1])
  })

  it('tracks a moving object when the aim anchor targets a whitebox', () => {
    const scene = createInitialScene()
    scene.objects[0] = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: {
        ...objectMotionPresets.find((preset) => preset.id === 'vehicle-drive')!.motion,
        startSec: 0,
        durationSec: 4,
        directionDeg: 90,
        distance: 8,
      },
    }
    scene.cameraAimAnchor = {
      enabled: true,
      position: [0, 0.5, 0],
      snapEnabled: true,
      targetObjectId: scene.objects[0].id,
      targetOffset: [0, 0.5, 0],
    }

    const first = sampleCameraAtTime(scene, 0)
    const midpoint = sampleCameraAtTime(scene, 2)

    expect(first.target).toEqual([0, 0.5, 0])
    expect(midpoint.target[0]).toBeCloseTo(4)
    expect(midpoint.target[1]).toBeCloseTo(0.5)
  })

  it('auto-faces objects along curved motion tangents', () => {
    const scene = createInitialScene()
    const object = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: {
        ...objectMotionPresets.find((preset) => preset.id === 'vehicle-weave')!.motion,
        startSec: 0,
        durationSec: 6,
        directionDeg: 0,
        distance: 8,
        radius: 2,
        loops: 1,
        autoFace: true,
      },
    }

    const early = sampleObjectMotionTransform(object, 1)
    const late = sampleObjectMotionTransform(object, 3)

    expect(early.rotation[1]).not.toBeCloseTo(late.rotation[1], 2)
  })

  it('reverses object motion direction with one operation', () => {
    const scene = createInitialScene()
    const forward = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: objectMotionPresets.find((preset) => preset.id === 'vehicle-drive')!.motion,
    }
    const reversed = {
      ...forward,
      motion: reverseObjectMotion(forward.motion),
    }

    expect(sampleObjectMotionTransform(forward, 4).position[2]).toBeGreaterThan(7.9)
    expect(sampleObjectMotionTransform(reversed, 4).position[2]).toBeLessThan(-7.9)
  })

  it('keeps object rotation independent from motion path direction', () => {
    const scene = createInitialScene()
    const object = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, Math.PI / 2, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: {
        ...objectMotionPresets.find((preset) => preset.id === 'vehicle-drive')!.motion,
        startSec: 0,
        durationSec: 4,
        directionDeg: 0,
        distance: 8,
        autoFace: true,
      },
    }

    const sampled = sampleObjectMotionTransform(object, 2)

    expect(sampled.position[2]).toBeCloseTo(4)
    expect(sampled.rotation[1]).toBeCloseTo(Math.PI / 2)
  })

  it('reverses object facing alignment without changing the path', () => {
    const scene = createInitialScene()
    const forward = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: {
        ...objectMotionPresets.find((preset) => preset.id === 'vehicle-drive')!.motion,
        startSec: 0,
        durationSec: 4,
        directionDeg: 0,
        distance: 8,
        autoFace: true,
      },
    }
    const flipped = {
      ...forward,
      motion: reverseObjectMotionFacing(forward.motion),
    }
    const forwardSample = sampleObjectMotionTransform(forward, 2)
    const flippedSample = sampleObjectMotionTransform(flipped, 2)
    const yawDelta = Math.abs(flippedSample.rotation[1] - forwardSample.rotation[1])

    expect(flippedSample.position).toEqual(forwardSample.position)
    expect(Math.abs(yawDelta - Math.PI)).toBeLessThan(0.001)
  })

  it('samples object motion with custom speed curves', () => {
    const scene = createInitialScene()
    const object = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: {
        ...objectMotionPresets.find((preset) => preset.id === 'vehicle-drive')!.motion,
        startSec: 0,
        durationSec: 4,
        directionDeg: 0,
        distance: 8,
        speedCurve: 'ease-in' as const,
      },
    }

    const easedIn = sampleObjectMotionTransform(object, 2)
    const easedOut = sampleObjectMotionTransform(
      {
        ...object,
        motion: {
          ...object.motion,
          speedCurve: 'ease-out',
        },
      },
      2,
    )

    expect(easedIn.position[2]).toBeCloseTo(2)
    expect(easedOut.position[2]).toBeCloseTo(6)
  })

  it('samples camera motion with custom segment speed curves', () => {
    const scene = createInitialScene()
    const [first, second] = scene.cameras[0].keyframes
    scene.cameras[0].keyframes = [
      {
        ...first,
        timeSec: 0,
        position: [0, 1, 0] as Vec3,
        target: [0, 1, 0] as Vec3,
        speedToNext: 1,
        speedCurveToNext: 'ease-in',
        curveToNext: 'linear',
      },
      {
        ...second,
        timeSec: 4,
        position: [0, 1, 8] as Vec3,
        target: [0, 1, 0] as Vec3,
      },
    ]

    const easedIn = sampleCameraAtTime(scene, 2)
    scene.cameras[0].keyframes[0].speedCurveToNext = 'ease-out'
    const easedOut = sampleCameraAtTime(scene, 2)

    expect(easedIn.position[2]).toBeCloseTo(2)
    expect(easedOut.position[2]).toBeCloseTo(6)
  })

  it('adds deterministic camera shake for handheld and drone modes', () => {
    const scene = createInitialScene()
    scene.cameraMotion = { mode: 'stable', shakeStrength: 1 }
    const stable = sampleCameraAtTime(scene, 1.23)

    scene.cameraMotion = { mode: 'handheld', shakeStrength: 1 }
    const handheld = sampleCameraAtTime(scene, 1.23)
    const repeatedHandheld = sampleCameraAtTime(scene, 1.23)

    scene.cameraMotion = { mode: 'drone', shakeStrength: 1 }
    const drone = sampleCameraAtTime(scene, 1.23)

    expect(handheld).toEqual(repeatedHandheld)
    expect(handheld.position).not.toEqual(stable.position)
    expect(length(subtract(handheld.position, stable.position))).toBeGreaterThan(
      length(subtract(drone.position, stable.position)),
    )
  })

  it('cuts between fixed camera shots using per-shot durations', () => {
    const scene = createInitialScene()
    scene.timeline.mode = 'shots'
    scene.cameras[0].keyframes[0].shotDurationSec = 2
    scene.cameras[0].keyframes[1].shotDurationSec = 3
    scene.cameras[0].keyframes[2].shotDurationSec = 4

    const segments = getFixedShotSegments(scene)

    expect(getTimelineDuration(scene)).toBe(9)
    expect(segments.map((segment) => segment.startSec)).toEqual([0, 2, 5])
    expect(sampleCameraAtTime(scene, 1.9).position).toEqual(
      scene.cameras[0].keyframes[0].position,
    )
    expect(sampleCameraAtTime(scene, 2.1).position).toEqual(
      scene.cameras[0].keyframes[1].position,
    )
    expect(sampleCameraAtTime(scene, 5.1).position).toEqual(
      scene.cameras[0].keyframes[2].position,
    )
  })

  it('auto-smooths paths by reducing the control tangent angle at turns', () => {
    const scene = createInitialScene()
    const keyframes = scene.cameras[0].keyframes.map((keyframe, index) => ({
      ...keyframe,
      timeSec: index * 5,
      speedToNext: index === 0 ? 0.5 : 2,
      position: [
        index === 0 ? 0 : 2,
        1.5,
        index === 2 ? 2 : 0,
      ] as Vec3,
      target: [0, 1.3, 0] as Vec3,
    }))

    const smoothed = smoothCameraKeyframes(keyframes, 10)
    const incomingTangent = subtract(
      smoothed[1].position,
      smoothed[0].curveControlInToNext!,
    )
    const outgoingTangent = subtract(
      smoothed[1].curveControlToNext!,
      smoothed[1].position,
    )

    expect(smoothed[0].curveToNext).toBe('custom')
    expect(smoothed[0].speedToNext).toBe(0.5)
    expect(smoothed[0].curveControlInToNext).toBeDefined()
    expect(smoothed[1].timeSec).toBeGreaterThan(0)
    expect(smoothed[1].timeSec).toBeLessThan(10)
    expect(angleDeg(incomingTangent, outgoingTangent)).toBeLessThan(2)
  })

  it('smooths camera rates while preserving the existing path curve', () => {
    const scene = createInitialScene()
    const [first, second, third] = scene.cameras[0].keyframes
    const keyframes = [
      {
        ...first,
        timeSec: 0,
        position: [0, 1.5, 0] as Vec3,
        speedToNext: 0.25,
        curveToNext: 'arc-left' as const,
        curveStrengthToNext: 1.6,
      },
      {
        ...second,
        timeSec: 3,
        position: [2, 1.5, 0] as Vec3,
        speedToNext: 3,
      },
      {
        ...third,
        timeSec: 6,
        position: [4, 1.5, 0] as Vec3,
        speedToNext: 0.25,
      },
      {
        ...third,
        id: 'kf-rate-end',
        timeSec: 9,
        position: [6, 1.5, 0] as Vec3,
      },
    ]

    const smoothed = smoothCameraRateKeyframes(keyframes, 9)
    const speeds = smoothed.slice(0, -1).map((keyframe) => keyframe.speedToNext ?? 1)

    expect(smoothed[0].curveToNext).toBe('arc-left')
    expect(smoothed[0].curveStrengthToNext).toBe(1.6)
    expect(speeds[0]).toBeGreaterThan(0.25)
    expect(speeds[1]).toBeLessThan(3)
    expect(speeds[2]).toBeGreaterThan(0.25)
    expect(smoothed[0].timeSec).toBe(0)
    expect(smoothed[1].timeSec).toBeGreaterThan(0)
    expect(smoothed[2].timeSec).toBeGreaterThan(smoothed[1].timeSec)
    expect(smoothed[3].timeSec).toBe(9)
  })

  it('auto-smoothing preserves existing curve bend instead of flattening it', () => {
    const scene = createInitialScene()
    const [from, to] = scene.cameras[0].keyframes
    const keyframes = [
      {
        ...from,
        timeSec: 0,
        position: [0, 1.5, 0] as Vec3,
        target: [0, 1.3, 0] as Vec3,
        curveToNext: 'arc-left' as const,
        curveStrengthToNext: 1,
      },
      {
        ...to,
        timeSec: 10,
        position: [4, 1.5, 0] as Vec3,
        target: [0, 1.3, 0] as Vec3,
      },
    ]

    const smoothed = smoothCameraKeyframes(keyframes, 10)
    const midpoint = sampleSegmentPoints(smoothed[0], smoothed[1], 10)[5]

    expect(smoothed[0].curveControlToNext).toBeDefined()
    expect(smoothed[0].curveControlInToNext).toBeDefined()
    expect(Math.abs(midpoint[2])).toBeGreaterThan(0.35)
  })

  it('ships cinematic multi-point camera movement presets', () => {
    expect(cinematicMovePresets.length).toBeGreaterThanOrEqual(30)
    expect(cinematicMovePresets.every((preset) => preset.keyframes.length >= 3)).toBe(true)
  })
})

describe('beginner placement helpers', () => {
  it('snaps nearby objects to the same base plane', () => {
    const scene = createInitialScene()
    const object = scene.objects[1]
    const snapped = snapObjectPositionToPlacementGuide(
      scene,
      builtInAssets,
      object,
      [object.transform.position[0], 0.08, object.transform.position[2]],
    )

    expect(snapped.position[1]).toBe(0)
    expect(snapped.label).toBe('地面')
  })

  it('reports top height from base plus full object height', () => {
    const scene = createInitialScene()
    const tower = scene.objects.find((object) => object.assetId === 'tower-building')

    expect(tower).toBeDefined()
    expect(getObjectTopY(tower!, builtInAssets)).toBeCloseTo(5)
  })
})

describe('object motion presets', () => {
  it('ships common moving whitebox assets', () => {
    const assetIds = new Set(builtInAssets.map((asset) => asset.id))

    expect(assetIds.has('vehicle-car')).toBe(true)
    expect(assetIds.has('vehicle-truck')).toBe(true)
    expect(assetIds.has('vehicle-motorcycle')).toBe(true)
    expect(assetIds.has('vehicle-boat')).toBe(true)
    expect(assetIds.has('aircraft-airplane')).toBe(true)
    expect(assetIds.has('aircraft-drone')).toBe(true)
    expect(assetIds.has('aircraft-helicopter')).toBe(true)
  })

  it('samples linear object motion over scene time', () => {
    const scene = createInitialScene()
    const object = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: {
        ...objectMotionPresets.find((preset) => preset.id === 'vehicle-drive')!.motion,
        startSec: 0,
        durationSec: 4,
        directionDeg: 90,
        distance: 8,
      },
    }

    const sampled = sampleObjectMotionTransform(object, 2)

    expect(sampled.position[0]).toBeCloseTo(4)
    expect(sampled.position[2]).toBeCloseTo(0)
  })

  it('ships cinematic object motion presets including chase and vehicle stunts', () => {
    const presetIds = new Set(objectMotionPresets.map((preset) => preset.id))

    expect(presetIds.has('vehicle-lane-change')).toBe(true)
    expect(presetIds.has('vehicle-weave')).toBe(true)
    expect(presetIds.has('vehicle-pursuit')).toBe(true)
    expect(presetIds.has('motorcycle-jump')).toBe(true)
    expect(presetIds.has('aircraft-bank-turn')).toBe(true)
  })

  it('samples complex object motion with lateral or vertical movement', () => {
    const scene = createInitialScene()
    const object = {
      ...scene.objects[0],
      transform: {
        position: [0, 0, 0] as Vec3,
        rotation: [0, 0, 0] as Vec3,
        scale: [1, 1, 1] as Vec3,
      },
      motion: {
        ...objectMotionPresets.find((preset) => preset.id === 'vehicle-weave')!.motion,
        startSec: 0,
        durationSec: 4,
        directionDeg: 0,
        distance: 8,
        radius: 2,
        loops: 1,
      },
    }

    const sampled = sampleObjectMotionTransform(object, 1)

    expect(sampled.position[0]).toBeGreaterThan(1.9)
    expect(sampled.position[2]).toBeCloseTo(2)
  })

  it('ships a two-car chase director motion preset', () => {
    const preset = sceneMotionPresets.find(
      (candidate) => candidate.id === 'two-car-chase',
    )

    expect(preset).toBeDefined()
    expect(preset!.objects).toHaveLength(2)
    expect(preset!.objects.every((object) => object.assetId === 'vehicle-car')).toBe(true)
    expect(new Set(preset!.objects.map((object) => object.motion.mode))).toEqual(
      new Set(['lane_change', 'pursuit']),
    )
  })

  it('accepts object motion in persisted scene documents', () => {
    const scene = createInitialScene()
    scene.objects[0].motion = objectMotionPresets.find(
      (preset) => preset.id === 'aircraft-bank-turn',
    )!.motion

    const parsed = validateSceneDocument(scene)

    expect(parsed.objects[0].motion?.mode).toBe('bank_turn')
  })

  it('loads legacy object motion without a facing offset', () => {
    const scene = createInitialScene()
    const legacyMotion = {
      ...objectMotionPresets.find((preset) => preset.id === 'vehicle-drive')!.motion,
    } as Partial<ObjectMotion>

    delete legacyMotion.faceOffsetDeg
    delete legacyMotion.speedCurve
    scene.objects[0].motion = legacyMotion as ObjectMotion

    const parsed = validateSceneDocument(scene)

    expect(parsed.objects[0].motion?.faceOffsetDeg).toBe(0)
    expect(parsed.objects[0].motion?.speedCurve).toBe('linear')
  })
})

describe('asset import API', () => {
  it('ships a built-in green screen panel asset', () => {
    expect(
      builtInAssets.some(
        (asset) => asset.id === 'greenscreen-panel' && asset.prefab === 'greenscreen',
      ),
    ).toBe(true)
  })

  it('rejects unsupported model uploads with a 400', async () => {
    const body = new FormData()
    body.append('asset', new Blob(['not a model']), 'notes.txt')

    const response = await fetch(`${baseUrl}/api/assets/import`, {
      method: 'POST',
      body,
    })
    const text = await response.text()

    expect(response.status).toBe(400)
    expect(text).toContain('Only GLB/GLTF')
  })

  it('accepts OBJ uploads and returns the detected model format', async () => {
    const body = new FormData()
    body.append('asset', new Blob(['o cube\nv 0 0 0\n']), 'cube.obj')

    const response = await fetch(`${baseUrl}/api/assets/import`, {
      method: 'POST',
      body,
    })
    const payload = await response.json() as {
      id: string
      kind: string
      format: string
      url: string
    }

    expect(response.status).toBe(201)
    expect(payload.kind).toBe('imported')
    expect(payload.format).toBe('obj')
    expect(payload.url).toMatch(/\.obj$/)
  })

  it('accepts ZIP model packages and serves nested glTF dependencies', async () => {
    const packageName = `delete-package-${Date.now()}`
    const packageBytes = makeStoredZip([
      {
        name: `${packageName}/${packageName}.gltf`,
        content: JSON.stringify({
          asset: { version: '2.0' },
          buffers: [{ uri: `${packageName}.bin`, byteLength: 4 }],
          images: [{ uri: `textures/${packageName}.jpg` }],
        }),
      },
      {
        name: `${packageName}/${packageName}.bin`,
        content: new Uint8Array([0, 1, 2, 3]),
      },
      {
        name: `${packageName}/textures/${packageName}.jpg`,
        content: new Uint8Array([255, 216, 255, 217]),
      },
    ])
    const body = new FormData()
    body.append('asset', new Blob([packageBytes]), `${packageName}.zip`)

    const response = await fetch(`${baseUrl}/api/assets/import`, {
      method: 'POST',
      body,
    })
    const payload = await response.json() as {
      id: string
      kind: string
      format: string
      url: string
    }

    expect(response.status).toBe(201)
    expect(payload.kind).toBe('imported')
    expect(payload.format).toBe('gltf')
    expect(payload.url).toContain(`${packageName}.gltf`)

    const packageBaseUrl = payload.url.split('/').slice(0, -1).join('/')
    const binResponse = await fetch(`${baseUrl}${packageBaseUrl}/${packageName}.bin`)
    const textureResponse = await fetch(
      `${baseUrl}${packageBaseUrl}/textures/${packageName}.jpg`,
    )

    expect(binResponse.status).toBe(200)
    expect(textureResponse.status).toBe(200)

    const assetsBeforeDelete = await fetch(`${baseUrl}/api/assets`)
    const assetListBeforeDelete = await assetsBeforeDelete.json() as Array<{ id: string }>
    expect(assetListBeforeDelete.some((asset) => asset.id === payload.id)).toBe(true)

    const deleteResponse = await fetch(
      `${baseUrl}/api/assets/${encodeURIComponent(payload.id)}`,
      { method: 'DELETE' },
    )
    const assetListAfterDelete = await (await fetch(`${baseUrl}/api/assets`)).json() as Array<{ id: string }>
    const deletedTextureResponse = await fetch(
      `${baseUrl}${packageBaseUrl}/textures/${packageName}.jpg`,
    )

    expect(deleteResponse.status).toBe(204)
    expect(assetListAfterDelete.some((asset) => asset.id === payload.id)).toBe(false)
    expect(deletedTextureResponse.status).toBe(404)
  })

  it('imports green screen texture images', async () => {
    const badBody = new FormData()
    badBody.append('texture', new Blob(['not an image']), 'notes.txt')
    const rejected = await fetch(`${baseUrl}/api/textures/import`, {
      method: 'POST',
      body: badBody,
    })
    const rejectedText = await rejected.text()

    expect(rejected.status).toBe(400)
    expect(rejectedText).toContain('textures')

    const body = new FormData()
    body.append('texture', new Blob(['fake png']), 'plate.png')
    const response = await fetch(`${baseUrl}/api/textures/import`, {
      method: 'POST',
      body,
    })
    const payload = await response.json() as {
      name: string
      url: string
    }

    expect(response.status).toBe(201)
    expect(payload.name).toBe('plate')
    expect(payload.url).toMatch(/^\/textures\/.*\.png$/)
  })
})
