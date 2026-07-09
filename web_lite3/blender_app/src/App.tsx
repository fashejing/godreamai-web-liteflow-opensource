import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AssetPanel } from './components/AssetPanel'
import { Inspector } from './components/Inspector'
import {
  RenderCaptureViewport,
  type RenderCaptureHandle,
} from './components/RenderCaptureViewport'
import {
  SceneViewport,
  type TransformMode,
  type ViewportVisibility,
} from './components/SceneViewport'
import { Timeline } from './components/Timeline'
import { Toolbar, type UiTheme } from './components/Toolbar'
import { ToolDock } from './components/ToolDock'
import {
  findNearestAimAnchorSnap,
  snapVec3ToGrid,
} from './scene/anchors'
import { builtInAssets } from './scene/assets'
import {
  cinematicMovePresets,
  renderSettingsForPreset,
} from './scene/cameraPresets'
import {
  clampTimeToDuration,
  connectCameraKeyframes,
  getFrameCount,
  getNextCameraKeyframeTime,
  getTimelineDuration,
  getTimelineMode,
  normalizeCameraMotionSettings,
  retimeCameraKeyframes,
  sampleCameraAtTime,
  smoothCameraKeyframes,
  smoothCameraRateKeyframes,
  sortKeyframes,
  type CameraSample,
} from './scene/camera'
import {
  createCameraKeyframe,
  createInitialScene,
  createObjectFromAsset,
} from './scene/factory'
import {
  createLight,
  defaultSceneLights,
  normalizeSceneLight,
  normalizeSceneLights,
} from './scene/lights'
import { popSceneHistory, pushSceneHistory } from './scene/history'
import { validateSceneDocument } from './scene/validation'
import {
  normalizeObjectMotion,
  sampleObjectMotionTransform,
  sceneMotionPresets,
} from './scene/objectMotion'
import {
  getObjectBaseY,
  getObjectTopY,
  snapObjectPositionToPlacementGuide,
} from './scene/placement'
import type {
  AssetDefinition,
  CameraAimAnchor,
  CameraMotionSettings,
  CameraCurveType,
  CameraKeyframe,
  FloorMaterial,
  ObjectMotion,
  RenderJob,
  RenderSettings,
  SceneDocument,
  SceneLight,
  SceneObject,
  SpeedCurveType,
  TimelineMode,
  Transform,
  Vec3,
} from './scene/types'
import './App.css'

const apiJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

type BlenderDocumentFile = {
  version?: number
  document?: SceneDocument
  scene?: SceneDocument
  assets?: AssetDefinition[]
  createdAt?: string
  updatedAt?: string
}

type TextureUploadResponse = {
  name: string
  url: string
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const evenInteger = (value: number): number => Math.max(2, Math.round(value) - (Math.round(value) % 2))

const floorMaterialValues: FloorMaterial[] = [
  'studio',
  'white',
  'checker',
  'concrete',
  'sand',
  'grass',
  'asphalt',
]

const normalizeFloorMaterial = (
  value: RenderSettings['floorMaterial'] | undefined,
): FloorMaterial => floorMaterialValues.includes(value as FloorMaterial)
  ? value as FloorMaterial
  : 'studio'

const normalizeRenderSettingsForUi = (
  settings: RenderSettings,
): RenderSettings => ({
  durationSec: clamp(Number(settings.durationSec) || 1, 1, 300),
  fps: ([24, 30, 60].includes(settings.fps) ? settings.fps : 30) as RenderSettings['fps'],
  width: evenInteger(clamp(Number(settings.width) || 1920, 320, 3840)),
  height: evenInteger(clamp(Number(settings.height) || 1080, 240, 2160)),
  format: 'mp4',
  fillWhiteGround: Boolean(settings.fillWhiteGround),
  hideGrid: Boolean(settings.hideGrid),
  floorMaterial: normalizeFloorMaterial(settings.floorMaterial),
})

const nextPlacementOffset = (objectCount: number): number =>
  ((objectCount % 5) - 2) * 0.55

const localDocumentFilename = (): string => {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  return `jingge-animation-workspace-${date}.json`
}

const importedAssetsFromScene = (scene: SceneDocument): AssetDefinition[] => {
  const byId = new Map<string, AssetDefinition>()

  scene.objects.forEach((object) => {
    if (!object.metadata?.url) {
      return
    }

    byId.set(object.assetId, {
      id: object.assetId,
      label: object.metadata.sourceName ?? object.name,
      category: 'prop',
      kind: 'imported',
      url: object.metadata.url,
      format: object.metadata.format,
      dimensions: [1, 1, 1],
    })
  })

  return [...byId.values()]
}

const cloneKeyframes = (keyframes: CameraKeyframe[]): CameraKeyframe[] =>
  keyframes.map((keyframe) => ({
    ...keyframe,
    position: [...keyframe.position],
    target: [...keyframe.target],
    curveControlToNext: keyframe.curveControlToNext
      ? [...keyframe.curveControlToNext]
      : undefined,
    curveControlInToNext: keyframe.curveControlInToNext
      ? [...keyframe.curveControlInToNext]
      : undefined,
  }))

const defaultAimAnchor: CameraAimAnchor = {
  enabled: false,
  position: [0, 1.3, 0],
  snapEnabled: true,
}

const defaultViewportVisibility: ViewportVisibility = {
  lights: true,
  cameraPath: true,
  objectPaths: true,
  floor: true,
  greenScreen: true,
}

const getObjectAimOffset = (
  object: SceneObject,
  assets: AssetDefinition[],
): Vec3 => {
  const asset = assets.find((candidate) => candidate.id === object.assetId)
  const height = asset?.dimensions[1] ?? 1

  return [0, (height * object.transform.scale[1]) / 2, 0]
}

const getAimAnchor = (scene: SceneDocument): CameraAimAnchor =>
  scene.cameraAimAnchor ?? defaultAimAnchor

type SceneUpdate = SceneDocument | ((current: SceneDocument) => SceneDocument)

const resolveSceneUpdate = (
  current: SceneDocument,
  update: SceneUpdate,
): SceneDocument => (typeof update === 'function' ? update(current) : update)

function App() {
  const [assets, setAssets] = useState<AssetDefinition[]>(builtInAssets)
  const [scene, setScene] = useState<SceneDocument>(() => createInitialScene())
  const sceneRef = useRef(scene)
  const sceneHistoryRef = useRef<SceneDocument[]>([])
  const [undoDepth, setUndoDepth] = useState(0)
  const [selectedAssetId, setSelectedAssetId] = useState(builtInAssets[0].id)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>('person-scale')
  const [transformMode, setTransformMode] = useState<TransformMode>('translate')
  const [panelTheme, setPanelTheme] = useState<UiTheme>('dark')
  const [spaceTheme, setSpaceTheme] = useState<UiTheme>('dark')
  const [cameraView, setCameraView] = useState(false)
  const [fullscreenPreview, setFullscreenPreview] = useState(false)
  const [viewportVisibility, setViewportVisibility] = useState<ViewportVisibility>(
    defaultViewportVisibility,
  )
  const [cameraSegmentColors, setCameraSegmentColors] = useState(false)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [placementSnap, setPlacementSnap] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null)
  const [systemMessage, setSystemMessage] = useState('Ready')
  const [importing, setImporting] = useState(false)
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>('kf-start')
  const playStartRef = useRef<{ timestamp: number; timeSec: number } | null>(null)
  const viewportCameraRef = useRef<CameraSample | null>(null)
  const renderCaptureRef = useRef<RenderCaptureHandle | null>(null)
  const [captureScene, setCaptureScene] = useState<SceneDocument | null>(null)
  const [captureTimeSec, setCaptureTimeSec] = useState(0)

  const setSceneSilently = (update: SceneUpdate): SceneDocument => {
    const nextScene = resolveSceneUpdate(sceneRef.current, update)
    sceneRef.current = nextScene
    setScene(nextScene)
    return nextScene
  }

  const resetSceneHistory = () => {
    sceneHistoryRef.current = []
    setUndoDepth(0)
  }

  const commitScene = (update: SceneUpdate): SceneDocument => {
    const currentScene = sceneRef.current
    const nextScene = resolveSceneUpdate(currentScene, update)

    if (nextScene === currentScene) {
      return currentScene
    }

    sceneHistoryRef.current = pushSceneHistory(sceneHistoryRef.current, currentScene)
    setUndoDepth(sceneHistoryRef.current.length)
    sceneRef.current = nextScene
    setScene(nextScene)
    return nextScene
  }

  const undoSceneChange = () => {
    const popped = popSceneHistory(sceneHistoryRef.current)

    if (!popped.previousScene) {
      setSystemMessage('暂无可回退的操作')
      return
    }

    const previousScene = popped.previousScene
    sceneHistoryRef.current = popped.history
    setUndoDepth(popped.history.length)
    setSceneSilently(previousScene)
    setPlaying(false)
    setRenderJob(null)
    setSelectedObjectId((currentId) =>
      currentId && previousScene.objects.some((object) => object.id === currentId)
        ? currentId
        : previousScene.objects[0]?.id ?? null,
    )
    setSelectedKeyframeId((currentId) =>
      currentId &&
      previousScene.cameras.some((camera) =>
        camera.keyframes.some((keyframe) => keyframe.id === currentId),
      )
        ? currentId
        : previousScene.cameras[0]?.keyframes[0]?.id ?? null,
    )
    setSystemMessage('已回退上一步操作')
  }

  const selectedObject = useMemo(
    () => scene.objects.find((object) => object.id === selectedObjectId) ?? null,
    [scene.objects, selectedObjectId],
  )
  const timelineDuration = useMemo(() => getTimelineDuration(scene), [scene])
  const timelineMode = useMemo(() => getTimelineMode(scene), [scene])
  const canSmoothCamera = useMemo(() => {
    const activeCamera = scene.cameras.find(
      (camera) => camera.id === scene.activeCameraId,
    )

    return (activeCamera?.keyframes.length ?? 0) >= 2
  }, [scene])

  const toggleViewportVisibility = (key: keyof ViewportVisibility) => {
    setViewportVisibility((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  useEffect(() => {
    let cancelled = false

    apiJson<AssetDefinition[]>('/api/assets')
      .then((nextAssets) => {
        if (!cancelled && nextAssets.length > 0) {
          setAssets(nextAssets)
        }
      })
      .catch((error: unknown) => {
        setSystemMessage(
          `Asset API unavailable, using built-in presets. ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!playing) {
      playStartRef.current = null
      return undefined
    }

    let frameId = 0
    const tick = (timestamp: number) => {
      if (!playStartRef.current) {
        playStartRef.current = {
          timestamp,
          timeSec: scene.timeline.currentTimeSec,
        }
      }

      const start = playStartRef.current
      const elapsed = (timestamp - start.timestamp) / 1000
      const duration = timelineDuration
      const nextTime = (start.timeSec + elapsed) % duration

      setSceneSilently((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          currentTimeSec: nextTime,
        },
      }))

      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [playing, timelineDuration, scene.timeline.currentTimeSec])

  useEffect(() => {
    if (
      !renderJob ||
      renderJob.id.startsWith('capture-') ||
      !['queued', 'rendering'].includes(renderJob.status)
    ) {
      return undefined
    }

    const interval = window.setInterval(() => {
      apiJson<RenderJob>(`/api/render-jobs/${renderJob.id}`)
        .then(setRenderJob)
        .catch((error: unknown) =>
          setSystemMessage(
            error instanceof Error ? error.message : String(error),
          ),
        )
    }, 1000)

    return () => window.clearInterval(interval)
  }, [renderJob])

  const sceneForPersistence = (): SceneDocument => ({
    ...scene,
    lights: normalizeSceneLights(scene.lights ?? defaultSceneLights),
  })

  const mergeImportedAssets = (nextAssets: AssetDefinition[]) => {
    if (nextAssets.length === 0) {
      return
    }

    setAssets((current) => [
      ...current.filter(
        (asset) => asset.kind !== 'imported' || !nextAssets.some((next) => next.id === asset.id),
      ),
      ...nextAssets,
    ])
  }

  const applyLoadedDocument = (
    nextDocument: SceneDocument,
    importedAssets: AssetDefinition[] | undefined,
    statusMessage: string,
  ) => {
    const nextScene = validateSceneDocument(nextDocument)
    const documentAssets = new Map<string, AssetDefinition>()
    const candidateAssets = [
      ...(importedAssets ?? []),
      ...importedAssetsFromScene(nextScene),
    ]

    candidateAssets.forEach((asset) => {
      if (asset.kind === 'imported') {
        documentAssets.set(asset.id, asset)
      }
    })

    mergeImportedAssets([...documentAssets.values()])
    resetSceneHistory()
    setSceneSilently(nextScene)
    setSelectedObjectId(nextScene.objects[0]?.id ?? null)
    setSelectedKeyframeId(nextScene.cameras[0]?.keyframes[0]?.id ?? null)
    setCameraView(false)
    setPlaying(false)
    setRenderJob(null)
    setSystemMessage(statusMessage)
  }

  const addAssetToScene = (assetId: string) => {
    const asset = assets.find((candidate) => candidate.id === assetId)
    if (!asset) {
      return
    }

    const offset = nextPlacementOffset(scene.objects.length)
    const object = createObjectFromAsset(asset, {
      transform: {
        position: [offset, 0, 2 + offset],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })

    commitScene((current) => ({
      ...current,
      objects: [...current.objects, object],
    }))
    setSelectedObjectId(object.id)
    setSelectedAssetId(asset.id)
    setSystemMessage(`${asset.label} placed`)
  }

  const deleteImportedAsset = async (assetId: string) => {
    const asset = assets.find(
      (candidate) => candidate.id === assetId && candidate.kind === 'imported',
    )

    if (!asset) {
      return
    }

    const removedObjectCount = scene.objects.filter(
      (object) => object.assetId === assetId,
    ).length
    const removesSelectedObject = scene.objects.some(
      (object) => object.id === selectedObjectId && object.assetId === assetId,
    )

    setSystemMessage(`正在删除导入模型：${asset.label}`)

    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
        method: 'DELETE',
      })
      if (!response.ok && response.status !== 404) {
        const text = await response.text()
        throw new Error(text || `${response.status} ${response.statusText}`)
      }

      setAssets((current) => current.filter((candidate) => candidate.id !== assetId))
      commitScene((current) => ({
        ...current,
        objects: current.objects.filter((object) => object.assetId !== assetId),
      }))

      if (removesSelectedObject) {
        setSelectedObjectId(null)
      }

      setSelectedAssetId((current) =>
        current === assetId ? builtInAssets[0].id : current,
      )
      setSystemMessage(
        removedObjectCount > 0
          ? `已删除导入模型：${asset.label}，并移除 ${removedObjectCount} 个场景实例`
          : `已删除导入模型：${asset.label}`,
      )
    } catch (error) {
      setSystemMessage(
        `删除导入模型失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const updateObjectTransform = (objectId: string, transform: Transform) => {
    let snapLabel: string | undefined

    commitScene((current) => {
      const selected = current.objects.find((object) => object.id === objectId)
      const nextTransform = { ...transform, position: [...transform.position] as Vec3 }

      if (selected && placementSnap) {
        const snapped = snapObjectPositionToPlacementGuide(
          current,
          assets,
          selected,
          nextTransform.position,
        )
        nextTransform.position = snapped.position
        snapLabel = snapped.label
      }

      return {
        ...current,
        objects: current.objects.map((object) =>
          object.id === objectId ? { ...object, transform: nextTransform } : object,
        ),
      }
    })

    if (snapLabel) {
      setSystemMessage(`已同高磁吸到：${snapLabel}`)
    }
  }

  const updateObjectColor = (objectId: string, color: string) => {
    commitScene((current) => ({
      ...current,
      objects: current.objects.map((object) =>
        object.id === objectId
          ? {
              ...object,
              material: {
                ...object.material,
                color,
              },
            }
          : object,
      ),
    }))
    setSystemMessage('已更新白模颜色')
  }

  const updateObjectMotion = (objectId: string, motion: ObjectMotion) => {
    const normalizedMotion = normalizeObjectMotion(motion)

    commitScene((current) => ({
      ...current,
      objects: current.objects.map((object) =>
        object.id === objectId
          ? {
              ...object,
              motion: normalizedMotion.enabled ? normalizedMotion : undefined,
            }
          : object,
      ),
    }))
    setSystemMessage(
      normalizedMotion.enabled ? '已更新物体运动轨迹' : '已关闭物体运动',
    )
  }

  const updateCameraMotion = (settings: CameraMotionSettings) => {
    const cameraMotion = normalizeCameraMotionSettings(settings)

    commitScene((current) => ({
      ...current,
      cameraMotion,
    }))
    setSystemMessage(
      cameraMotion.mode === 'stable'
        ? '已切换到稳定拍摄'
        : `已切换镜头模式，抖动强度 ${cameraMotion.shakeStrength.toFixed(2)}x`,
    )
  }

  const importGreenScreenTexture = async (objectId: string, file: File) => {
    setSystemMessage(`正在上传贴图：${file.name}`)

    try {
      const body = new FormData()
      body.append('texture', file)
      const texture = await apiJson<TextureUploadResponse>('/api/textures/import', {
        method: 'POST',
        body,
      })

      commitScene((current) => ({
        ...current,
        objects: current.objects.map((object) =>
          object.id === objectId
            ? {
                ...object,
                metadata: {
                  ...object.metadata,
                  textureUrl: texture.url,
                  textureName: texture.name,
                },
              }
            : object,
        ),
      }))
      setSystemMessage(`贴图已应用：${texture.name}`)
    } catch (error) {
      setSystemMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const clearGreenScreenTexture = (objectId: string) => {
    commitScene((current) => ({
      ...current,
      objects: current.objects.map((object) => {
        if (object.id !== objectId) {
          return object
        }

        const metadata = { ...(object.metadata ?? {}) }
        delete metadata.textureName
        delete metadata.textureUrl

        return {
          ...object,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        }
      }),
    }))
    setSystemMessage('已清除绿幕贴图')
  }

  const groundSelectedObject = () => {
    if (!selectedObject) {
      return
    }

    updateObjectTransform(selectedObject.id, {
      ...selectedObject.transform,
      position: [
        selectedObject.transform.position[0],
        0,
        selectedObject.transform.position[2],
      ],
    })
    setSystemMessage('已将白模贴到地面')
  }

  const addLight = () => {
    commitScene((current) => {
      const currentLights = current.lights?.length ? current.lights : defaultSceneLights
      const nextLight = createLight(currentLights.length + 1)

      return {
        ...current,
        lights: [...currentLights, nextLight],
      }
    })
    setSystemMessage('已添加新光源')
  }

  const updateLight = (lightId: string, patch: Partial<SceneLight>) => {
    commitScene((current) => {
      const currentLights = current.lights?.length ? current.lights : defaultSceneLights

      return {
        ...current,
        lights: currentLights.map((light) =>
          light.id === lightId ? normalizeSceneLight({ ...light, ...patch }) : light,
        ),
      }
    })
  }

  const deleteLight = (lightId: string) => {
    commitScene((current) => {
      const currentLights = current.lights?.length ? current.lights : defaultSceneLights

      return {
        ...current,
        lights: currentLights.length <= 1
          ? currentLights
          : currentLights.filter((light) => light.id !== lightId),
      }
    })
    setSystemMessage('已删除光源')
  }

  const resolveAimAnchorPosition = (
    current: SceneDocument,
    position: Vec3,
  ): { position: Vec3; snapLabel?: string } => {
    const anchor = getAimAnchor(current)

    if (!anchor.snapEnabled) {
      return { position }
    }

    const nearest = findNearestAimAnchorSnap(current, assets, position)
    if (nearest) {
      return {
        position: nearest.position,
        snapLabel: nearest.label,
      }
    }

    return { position: snapVec3ToGrid(position) }
  }

  const moveAimAnchor = (position: Vec3) => {
    let snapLabel: string | undefined

    commitScene((current) => {
      const anchor = getAimAnchor(current)
      const resolved = resolveAimAnchorPosition(current, position)
      snapLabel = resolved.snapLabel

      return {
        ...current,
        cameraAimAnchor: {
          ...anchor,
          enabled: true,
          position: resolved.position,
          targetObjectId: undefined,
          targetOffset: undefined,
        },
      }
    })
    setSystemMessage(
      snapLabel ? `锚点已磁吸到：${snapLabel}` : '已移动镜头锚点',
    )
  }

  const toggleAimAnchor = () => {
    commitScene((current) => {
      const anchor = getAimAnchor(current)

      return {
        ...current,
        cameraAimAnchor: {
          ...anchor,
          enabled: !anchor.enabled,
        },
      }
    })
    setSystemMessage('已切换镜头锚点锁定')
  }

  const toggleAimAnchorSnap = () => {
    commitScene((current) => {
      const anchor = getAimAnchor(current)

      return {
        ...current,
        cameraAimAnchor: {
          ...anchor,
          snapEnabled: !anchor.snapEnabled,
        },
      }
    })
    setSystemMessage('已切换锚点磁吸')
  }

  const setAimAnchorToSelectedObject = () => {
    if (!selectedObject) {
      return
    }

    commitScene((current) => {
      const targetObject = current.objects.find(
        (object) => object.id === selectedObject.id,
      )

      if (!targetObject) {
        return current
      }

      const sampled = sampleObjectMotionTransform(
        targetObject,
        current.timeline.currentTimeSec,
      )
      const targetOffset = getObjectAimOffset(targetObject, assets)

      return {
        ...current,
        cameraAimAnchor: {
          ...getAimAnchor(current),
          enabled: true,
          position: [
            sampled.position[0] + targetOffset[0],
            sampled.position[1] + targetOffset[1],
            sampled.position[2] + targetOffset[2],
          ],
          targetObjectId: targetObject.id,
          targetOffset,
        },
      }
    })
    setSystemMessage(`镜头锚点已跟踪：${selectedObject.name}`)
  }

  const setAimAnchorToCurrentTarget = () => {
    const anchor = getAimAnchor(scene)
    const unlockedScene: SceneDocument = {
      ...scene,
      cameraAimAnchor: {
        ...anchor,
        enabled: false,
      },
    }
    const sample = sampleCameraAtTime(unlockedScene, scene.timeline.currentTimeSec)

    commitScene((current) => ({
      ...current,
      cameraAimAnchor: {
        ...getAimAnchor(current),
        enabled: true,
        position: sample.target,
        targetObjectId: undefined,
        targetOffset: undefined,
      },
    }))
    setSystemMessage('锚点已设为当前镜头朝向')
  }

  const updateCurrentTime = (timeSec: number) => {
    setPlaying(false)
    setSceneSilently((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        currentTimeSec: clampTimeToDuration(timeSec, getTimelineDuration(current)),
      },
    }))
  }

  const setTimelineMode = (mode: TimelineMode) => {
    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) => ({
                ...keyframe,
                shotDurationSec: keyframe.shotDurationSec ?? 2,
              })),
            }
          : camera,
      ),
      timeline: {
        ...current.timeline,
        mode,
        currentTimeSec: 0,
      },
    }))
    setPlaying(false)
    setCameraView(mode === 'shots' ? true : cameraView)
    setSystemMessage(
      mode === 'shots'
        ? '已切换到固定机位剪辑：按镜头顺序硬切，可单独设置每个镜头时长'
        : '已切换到连续运镜轨迹',
    )
  }

  const updateKeyframeShotDuration = (
    keyframeId: string,
    shotDurationSec: number,
  ) => {
    const duration = clamp(shotDurationSec, 0.5, 30)

    commitScene((current) => {
      const cameras = current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === keyframeId
                  ? { ...keyframe, shotDurationSec: duration }
                  : keyframe,
              ),
            }
          : camera,
      )
      const nextScene = {
        ...current,
        cameras,
      }

      return {
        ...nextScene,
        timeline: {
          ...current.timeline,
          currentTimeSec: clampTimeToDuration(
            current.timeline.currentTimeSec,
            getTimelineDuration(nextScene),
          ),
        },
      }
    })
    setSystemMessage(`已设置固定镜头时长：${duration.toFixed(1)}s`)
  }

  const smoothCameraPath = () => {
    commitScene((current) => {
      const activeCamera = current.cameras.find(
        (camera) => camera.id === current.activeCameraId,
      )

      if (!activeCamera || activeCamera.keyframes.length < 2) {
        return current
      }

      return {
        ...current,
        cameras: current.cameras.map((camera) =>
          camera.id === current.activeCameraId
            ? {
                ...camera,
                keyframes: smoothCameraKeyframes(
                  camera.keyframes,
                  current.renderSettings.durationSec,
                ),
              }
            : camera,
        ),
        timeline: {
          ...current.timeline,
          mode: 'motion',
          currentTimeSec: clampTimeToDuration(
            current.timeline.currentTimeSec,
            current.renderSettings.durationSec,
          ),
        },
      }
    })
    setPlaying(false)
    setSystemMessage('已完成轨道平滑：转角处生成自定义控制点，镜头速率保持不变')
  }

  const smoothCameraRate = () => {
    commitScene((current) => {
      const activeCamera = current.cameras.find(
        (camera) => camera.id === current.activeCameraId,
      )

      if (!activeCamera || activeCamera.keyframes.length < 2) {
        return current
      }

      return {
        ...current,
        cameras: current.cameras.map((camera) =>
          camera.id === current.activeCameraId
            ? {
                ...camera,
                keyframes: smoothCameraRateKeyframes(
                  camera.keyframes,
                  current.renderSettings.durationSec,
                ),
              }
            : camera,
        ),
        timeline: {
          ...current.timeline,
          mode: 'motion',
          currentTimeSec: clampTimeToDuration(
            current.timeline.currentTimeSec,
            current.renderSettings.durationSec,
          ),
        },
      }
    })
    setPlaying(false)
    setSystemMessage('已完成速率平滑：相邻轨迹速度过渡更顺，节点时间已重新分配')
  }

  const addCameraKeyframe = () => {
    const sample =
      viewportCameraRef.current ??
      sampleCameraAtTime(scene, scene.timeline.currentTimeSec)
    let addedKeyframeId: string | null = null
    let addedTimeSec = 0

    commitScene((current) => {
      const activeCamera = current.cameras.find(
        (camera) => camera.id === current.activeCameraId,
      )
      const timeSec = getNextCameraKeyframeTime(
        activeCamera?.keyframes ?? [],
        current.timeline.currentTimeSec,
        current.renderSettings.durationSec,
      )
      const nextKeyframe = createCameraKeyframe(
        timeSec,
        sample.position,
        sample.target,
        sample.fov,
      )
      addedKeyframeId = nextKeyframe.id
      addedTimeSec = nextKeyframe.timeSec

      return {
        ...current,
        cameras: current.cameras.map((camera) =>
          camera.id === current.activeCameraId
            ? {
                ...camera,
                keyframes: [...camera.keyframes, nextKeyframe],
              }
            : camera,
        ),
        renderSettings: {
          ...current.renderSettings,
          durationSec: Math.max(current.renderSettings.durationSec, timeSec),
        },
      }
    })
    setSelectedKeyframeId(addedKeyframeId)
    setSelectedObjectId(null)
    setSystemMessage(
      `已添加 ${addedTimeSec.toFixed(2)}s 的镜头点，可继续换角度添加`,
    )
  }

  const connectCameraPath = () => {
    let connectedCount = 0
    let connectedDurationSec = scene.renderSettings.durationSec

    commitScene((current) => {
      const activeCamera = current.cameras.find(
        (camera) => camera.id === current.activeCameraId,
      )

      if (!activeCamera || activeCamera.keyframes.length < 2) {
        return current
      }

      const connected = connectCameraKeyframes(
        activeCamera.keyframes,
        current.renderSettings.durationSec,
      )
      connectedCount = connected.keyframes.length
      connectedDurationSec = connected.durationSec

      return {
        ...current,
        cameras: current.cameras.map((camera) =>
          camera.id === current.activeCameraId
            ? {
                ...camera,
                keyframes: connected.keyframes,
              }
            : camera,
        ),
        renderSettings: {
          ...current.renderSettings,
          durationSec: connected.durationSec,
        },
        timeline: {
          ...current.timeline,
          mode: 'motion',
          currentTimeSec: 0,
        },
      }
    })
    setPlaying(false)
    setSystemMessage(
      connectedCount >= 2
        ? `已一键连线 ${connectedCount} 个镜头点，形成 ${connectedDurationSec.toFixed(1)}s 轨迹`
        : '至少需要 2 个镜头点才能一键连线',
    )
  }

  const deleteCameraKeyframe = (keyframeId: string) => {
    let deleted = false
    let nextSelectedKeyframeId = selectedKeyframeId

    commitScene((current) => {
      const activeCamera = current.cameras.find(
        (camera) => camera.id === current.activeCameraId,
      )

      if (!activeCamera || activeCamera.keyframes.length <= 1) {
        return current
      }

      const sorted = sortKeyframes(activeCamera.keyframes)
      const deleteIndex = sorted.findIndex((keyframe) => keyframe.id === keyframeId)

      if (deleteIndex === -1) {
        return current
      }

      const remaining = sorted.filter((keyframe) => keyframe.id !== keyframeId)
      deleted = true

      if (
        selectedKeyframeId === keyframeId ||
        !remaining.some((keyframe) => keyframe.id === selectedKeyframeId)
      ) {
        nextSelectedKeyframeId =
          remaining[Math.min(deleteIndex, remaining.length - 1)]?.id ?? null
      }

      return {
        ...current,
        cameras: current.cameras.map((camera) =>
          camera.id === current.activeCameraId
            ? {
                ...camera,
                keyframes: remaining,
              }
            : camera,
        ),
      }
    })

    if (deleted) {
      setSelectedKeyframeId(nextSelectedKeyframeId)
      setSelectedObjectId(null)
      setSystemMessage('已删除镜头点')
    } else {
      setSystemMessage('至少保留 1 个镜头点')
    }
  }

  const reorderCameraKeyframe = (
    draggedKeyframeId: string,
    targetKeyframeId: string,
  ) => {
    if (draggedKeyframeId === targetKeyframeId) {
      return
    }

    let reordered = false

    commitScene((current) => {
      const activeCamera = current.cameras.find(
        (camera) => camera.id === current.activeCameraId,
      )

      if (!activeCamera) {
        return current
      }

      const sorted = sortKeyframes(activeCamera.keyframes)
      const fromIndex = sorted.findIndex(
        (keyframe) => keyframe.id === draggedKeyframeId,
      )
      const targetIndex = sorted.findIndex(
        (keyframe) => keyframe.id === targetKeyframeId,
      )

      if (fromIndex === -1 || targetIndex === -1) {
        return current
      }

      const nextOrder = [...sorted]
      const [movedKeyframe] = nextOrder.splice(fromIndex, 1)
      nextOrder.splice(targetIndex, 0, movedKeyframe)
      const retimed = retimeCameraKeyframes(
        nextOrder,
        current.renderSettings.durationSec,
      )
      reordered = true

      return {
        ...current,
        cameras: current.cameras.map((camera) =>
          camera.id === current.activeCameraId
            ? {
                ...camera,
                keyframes: retimed.keyframes,
              }
            : camera,
        ),
        renderSettings: {
          ...current.renderSettings,
          durationSec: retimed.durationSec,
        },
        timeline: {
          ...current.timeline,
          mode: 'motion',
          currentTimeSec: clampTimeToDuration(
            current.timeline.currentTimeSec,
            retimed.durationSec,
          ),
        },
      }
    })

    if (reordered) {
      setSelectedKeyframeId(draggedKeyframeId)
      setSelectedObjectId(null)
      setSystemMessage('已调整镜头点顺序，并重新分配运镜时间')
    }
  }

  const toggleCameraSegmentConnection = (fromKeyframeId: string) => {
    let updated = false
    let segmentConnected = true
    let segmentLabel = '该段'

    commitScene((current) => {
      const activeCamera = current.cameras.find(
        (camera) => camera.id === current.activeCameraId,
      )

      if (!activeCamera) {
        return current
      }

      const sorted = sortKeyframes(activeCamera.keyframes)
      const segmentIndex = sorted.findIndex(
        (keyframe) => keyframe.id === fromKeyframeId,
      )

      if (segmentIndex === -1 || segmentIndex >= sorted.length - 1) {
        return current
      }

      const fromKeyframe = sorted[segmentIndex]
      segmentConnected = fromKeyframe.connectToNext === false
      segmentLabel = `点 ${segmentIndex + 1} 到点 ${segmentIndex + 2}`
      updated = true

      return {
        ...current,
        cameras: current.cameras.map((camera) =>
          camera.id === current.activeCameraId
            ? {
                ...camera,
                keyframes: camera.keyframes.map((keyframe) =>
                  keyframe.id === fromKeyframeId
                    ? {
                        ...keyframe,
                        connectToNext: segmentConnected,
                      }
                    : keyframe,
                ),
              }
            : camera,
        ),
        timeline: {
          ...current.timeline,
          mode: 'motion',
        },
      }
    })

    if (!updated) {
      return
    }

    setSystemMessage(
      segmentConnected
        ? `已连线${segmentLabel}`
        : `已断开${segmentLabel}的运镜轨迹`,
    )
  }

  const clearCameraPath = () => {
    const sample = sampleCameraAtTime(scene, scene.timeline.currentTimeSec)
    const keyframe = {
      ...createCameraKeyframe(0, sample.position, sample.target, sample.fov),
      id: 'kf-reset',
      curveToNext: 'linear' as const,
    }

    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              name: 'Shot Camera',
              keyframes: [keyframe],
            }
          : camera,
      ),
      timeline: {
        ...current.timeline,
        currentTimeSec: 0,
      },
    }))
    setSelectedKeyframeId(keyframe.id)
    setSelectedObjectId(null)
    setPlaying(false)
    setSystemMessage('已清空全部轨迹，并保留当前画面为起始镜头点')
  }

  const moveKeyframePosition = (keyframeId: string, position: Vec3) => {
    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === keyframeId ? { ...keyframe, position } : keyframe,
              ),
            }
          : camera,
      ),
    }))
    setSelectedKeyframeId(keyframeId)
  }

  const moveKeyframeTarget = (keyframeId: string, target: Vec3) => {
    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === keyframeId ? { ...keyframe, target } : keyframe,
              ),
            }
          : camera,
      ),
    }))
    setSelectedKeyframeId(keyframeId)
    setSystemMessage('已调整镜头朝向目标')
  }

  const moveCurveControl = (fromKeyframeId: string, controlPoint: Vec3) => {
    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === fromKeyframeId
                  ? {
                      ...keyframe,
                      curveToNext: 'custom',
                      curveControlToNext: controlPoint,
                      curveControlInToNext: undefined,
                    }
                  : keyframe,
              ),
            }
          : camera,
      ),
    }))
    setSystemMessage('已拖拽橙色控制点，自定义该段曲线')
  }

  const updateSegmentSpeed = (fromKeyframeId: string, speedToNext: number) => {
    const speed = clamp(speedToNext, 0.25, 3)

    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === fromKeyframeId
                  ? { ...keyframe, speedToNext: speed }
                  : keyframe,
              ),
            }
          : camera,
      ),
    }))
    setSystemMessage(`已调整该段运镜速度：${speed.toFixed(2)}x`)
  }

  const updateSegmentSpeedCurve = (
    fromKeyframeId: string,
    speedCurveToNext: SpeedCurveType,
  ) => {
    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === fromKeyframeId
                  ? { ...keyframe, speedCurveToNext }
                  : keyframe,
              ),
            }
          : camera,
      ),
    }))
    setSystemMessage('已调整该段运镜速率曲线')
  }

  const updateSegmentCurve = (
    fromKeyframeId: string,
    curveToNext: CameraCurveType,
  ) => {
    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === fromKeyframeId
                  ? {
                      ...keyframe,
                      curveToNext,
                      curveControlToNext:
                        curveToNext === 'custom'
                          ? keyframe.curveControlToNext
                          : undefined,
                      curveControlInToNext: undefined,
                    }
                  : keyframe,
              ),
            }
          : camera,
      ),
    }))
    setSystemMessage(`已切换该段曲线：${curveToNext}`)
  }

  const updateSegmentCurveStrength = (
    fromKeyframeId: string,
    curveStrengthToNext: number,
  ) => {
    const strength = clamp(curveStrengthToNext, 0, 3)

    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              keyframes: camera.keyframes.map((keyframe) =>
                keyframe.id === fromKeyframeId
                  ? { ...keyframe, curveStrengthToNext: strength }
                  : keyframe,
              ),
            }
          : camera,
      ),
    }))
    setSystemMessage(`已调整该段弯曲强度：${strength.toFixed(2)}`)
  }

  const applyCinematicPreset = (presetId: string) => {
    const preset = cinematicMovePresets.find((candidate) => candidate.id === presetId)
    if (!preset) {
      return
    }

    const nextKeyframes = cloneKeyframes(preset.keyframes)
    commitScene((current) => ({
      ...current,
      cameras: current.cameras.map((camera) =>
        camera.id === current.activeCameraId
          ? {
              ...camera,
              name: preset.name,
              keyframes: nextKeyframes,
            }
          : camera,
      ),
      timeline: {
        ...current.timeline,
        currentTimeSec: 0,
        mode: 'motion',
      },
      renderSettings: renderSettingsForPreset(
        current.renderSettings,
        preset,
      ),
    }))
    setSelectedKeyframeId(nextKeyframes[0]?.id ?? null)
    setSelectedObjectId(null)
    setCameraView(true)
    setPlaying(false)
    setSystemMessage(`已套用电影运镜方案：${preset.name}`)
  }

  const togglePlaybackPreview = () => {
    setPlaying((current) => !current)
  }

  const addSceneMotionPreset = (presetId: string) => {
    const preset = sceneMotionPresets.find((candidate) => candidate.id === presetId)

    if (!preset) {
      return
    }

    const nextObjects = preset.objects
      .map((presetObject) => {
        const asset = assets.find((candidate) => candidate.id === presetObject.assetId)

        if (!asset) {
          return null
        }

        return createObjectFromAsset(asset, {
          name: presetObject.name,
          transform: presetObject.transform,
          material: presetObject.material,
          motion: presetObject.motion,
        })
      })
      .filter((object): object is SceneDocument['objects'][number] => Boolean(object))

    if (nextObjects.length === 0) {
      setSystemMessage('当前资产库缺少该导演运动所需白模')
      return
    }

    commitScene((current) => ({
      ...current,
      objects: [...current.objects, ...nextObjects],
      timeline: {
        ...current.timeline,
        mode: 'motion',
        currentTimeSec: 0,
      },
      renderSettings: {
        ...current.renderSettings,
        durationSec: Math.max(current.renderSettings.durationSec, preset.durationSec),
      },
    }))
    setSelectedObjectId(nextObjects[nextObjects.length - 1]?.id ?? null)
    setSelectedKeyframeId(null)
    setPlaying(false)
    setSystemMessage(`已放入导演运动：${preset.label}`)
  }

  const duplicateSelected = () => {
    const selected = selectedObject
    const asset = selected
      ? assets.find((candidate) => candidate.id === selected.assetId)
      : undefined

    if (!selected || !asset) {
      return
    }

    const duplicate = createObjectFromAsset(asset, {
      name: `${selected.name} Copy`,
      transform: {
        ...selected.transform,
        position: [
          selected.transform.position[0] + 0.5,
          selected.transform.position[1],
          selected.transform.position[2] + 0.5,
        ],
      },
      metadata: selected.metadata,
      motion: selected.motion,
    })

    commitScene((current) => ({
      ...current,
      objects: [...current.objects, duplicate],
    }))
    setSelectedObjectId(duplicate.id)
    setSystemMessage(`${selected.name} duplicated`)
  }

  const deleteSelected = () => {
    const selected = selectedObject
    if (!selected) {
      return
    }

    commitScene((current) => ({
      ...current,
      objects: current.objects.filter((object) => object.id !== selected.id),
    }))
    setSelectedObjectId(null)
    setSystemMessage(`${selected.name} deleted`)
  }

  const clearSceneObjects = () => {
    commitScene((current) => ({
      ...current,
      objects: [],
    }))
    setSelectedObjectId(null)
    setSystemMessage('已清空所有白模，镜头和运镜已保留')
  }

  const alignAllObjectsToGround = () => {
    commitScene((current) => ({
      ...current,
      objects: current.objects.map((object) => ({
        ...object,
        transform: {
          ...object.transform,
          position: [
            object.transform.position[0],
            0,
            object.transform.position[2],
          ],
        },
      })),
    }))
    setSystemMessage('已将所有白模对齐到同一水平面')
  }

  const saveSceneToLocalFile = () => {
    const now = new Date().toISOString()
    const importedAssets = assets.filter((asset) => asset.kind === 'imported')
    const payload: BlenderDocumentFile = {
      version: 1,
      document: sceneForPersistence(),
      assets: importedAssets,
      createdAt: now,
      updatedAt: now,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = localDocumentFilename()
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setSystemMessage(`已保存到本地文件：${link.download}`)
  }

  const loadSceneFromLocalFile = async (file: File) => {
    setSystemMessage(`正在载入本地文件：${file.name}`)

    try {
      const raw = JSON.parse(await file.text()) as unknown
      const payload = raw && typeof raw === 'object'
        ? raw as BlenderDocumentFile
        : {}
      const nextScene = validateSceneDocument(payload.document ?? payload.scene ?? raw)
      applyLoadedDocument(
        nextScene,
        payload.assets,
        `已载入本地文件：${file.name}`,
      )
    } catch (error) {
      setSystemMessage(
        `本地文件载入失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const importAsset = async (file: File) => {
    setImporting(true)
    setSystemMessage(`正在导入：${file.name}`)

    try {
      const body = new FormData()
      body.append('asset', file)
      const asset = await apiJson<AssetDefinition>('/api/assets/import', {
        method: 'POST',
        body,
      })

      setAssets((current) => [
        ...current.filter((candidate) => candidate.id !== asset.id),
        asset,
      ])
      setSelectedAssetId(asset.id)
      setSystemMessage(`已导入：${asset.label}`)
    } catch (error) {
      setSystemMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  const waitForRenderCapture = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

  const captureStablePngFrame = async (
    expectedWidth: number,
    expectedHeight: number,
  ): Promise<Blob> => {
    let lastFrame: Blob | null = null
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await waitForRenderCapture()
      const frame = await renderCaptureRef.current?.capturePng(
        expectedWidth,
        expectedHeight,
      )
      if (!frame) {
        continue
      }
      lastFrame = frame
      if (frame.size > 1024) {
        return frame
      }
    }

    if (!lastFrame) {
      throw new Error('镜头预览画布没有返回 PNG 帧，请稍后再试。')
    }
    return lastFrame
  }

  const setLocalRenderProgress = (
    kind: 'video',
    progress: number,
  ) => {
    const now = new Date().toISOString()
    setRenderJob({
      id: `capture-${kind}`,
      kind,
      status: 'rendering',
      progress,
      createdAt: now,
      updatedAt: now,
    })
  }

  const captureRenderedFrames = async (
    exportScene: SceneDocument,
    fps: number,
    kind: 'video',
  ): Promise<FormData> => {
    const duration = getTimelineDuration(exportScene)
    const frameCount = getFrameCount(duration, fps)
    const body = new FormData()
    body.append('fps', String(fps))
    body.append('width', String(exportScene.renderSettings.width))
    body.append('height', String(exportScene.renderSettings.height))

    flushSync(() => {
      setCaptureScene(exportScene)
      setCaptureTimeSec(0)
    })
    await waitForRenderCapture()

    try {
      for (let index = 0; index < frameCount; index += 1) {
        const timeSec = Math.min(duration, index / fps)
        flushSync(() => {
          setCaptureTimeSec(timeSec)
        })
        const frame = await captureStablePngFrame(
          exportScene.renderSettings.width,
          exportScene.renderSettings.height,
        )

        body.append(
          'frames',
          frame,
          `frame_${String(index + 1).padStart(6, '0')}.png`,
        )

        if (index % Math.max(1, Math.floor(frameCount / 20)) === 0) {
          setLocalRenderProgress(kind, 0.02 + (index / frameCount) * 0.82)
        }
      }
    } finally {
      setCaptureScene(null)
    }

    return body
  }

  const exportVideo = async () => {
    const exportScene = sceneForPersistence()
    const fps = exportScene.renderSettings.fps
    setSystemMessage('正在按镜头预览渲染 MP4 帧')
    setLocalRenderProgress('video', 0.01)

    try {
      const body = await captureRenderedFrames(exportScene, fps, 'video')
      setSystemMessage('正在编码 MP4')
      setLocalRenderProgress('video', 0.9)
      const job = await apiJson<RenderJob>('/api/render-jobs/captured-video', {
        method: 'POST',
        body,
      })
      setRenderJob(job)
    } catch (error) {
      setSystemMessage(error instanceof Error ? error.message : String(error))
      setRenderJob(null)
    }
  }

  const renderViewport = (isFullscreen = false) => (
    <SceneViewport
      scene={scene}
      assets={assets}
      selectedObjectId={selectedObjectId}
      transformMode={transformMode}
      currentTimeSec={scene.timeline.currentTimeSec}
      cameraView={cameraView}
      uiTheme={spaceTheme}
      snapToGrid={snapToGrid}
      placementSnap={placementSnap}
      visibility={viewportVisibility}
      cameraSegmentColors={cameraSegmentColors}
      fullscreenActive={isFullscreen}
      playing={playing}
      onToggleVisibility={toggleViewportVisibility}
      onToggleCameraSegmentColors={() => setCameraSegmentColors((value) => !value)}
      onToggleFullscreen={() => setFullscreenPreview((value) => !value)}
      onTogglePlay={togglePlaybackPreview}
      onSelectObject={(objectId) => {
        setSelectedObjectId(objectId)
        if (objectId) {
          setSelectedKeyframeId(null)
        }
      }}
      onTransformObject={updateObjectTransform}
      onViewportCameraChange={(sample) => {
        viewportCameraRef.current = sample
      }}
      selectedKeyframeId={selectedKeyframeId}
      onSelectKeyframe={(keyframeId) => {
        setSelectedKeyframeId(keyframeId)
        setSelectedObjectId(null)
        setSystemMessage('已选中镜头点，可拖动蓝点改位置，点击方向按钮改朝向')
      }}
      onMoveKeyframePosition={moveKeyframePosition}
      onMoveKeyframeTarget={moveKeyframeTarget}
      onMoveAimAnchor={moveAimAnchor}
      onMoveCurveControl={moveCurveControl}
      onUpdateLight={updateLight}
    />
  )

  return (
    <main className={`app-shell theme-${panelTheme}`}>
      {captureScene ? (
        <RenderCaptureViewport
          ref={renderCaptureRef}
          scene={captureScene}
          assets={assets}
          currentTimeSec={captureTimeSec}
          uiTheme={spaceTheme}
        />
      ) : null}
      <Toolbar
        panelTheme={panelTheme}
        spaceTheme={spaceTheme}
        canUndo={undoDepth > 0}
        onUndo={undoSceneChange}
        onSaveLocalDocument={saveSceneToLocalFile}
        onLoadLocalDocument={loadSceneFromLocalFile}
        onTogglePanelTheme={() =>
          setPanelTheme((current) => (current === 'dark' ? 'light' : 'dark'))
        }
        onToggleSpaceTheme={() =>
          setSpaceTheme((current) => (current === 'dark' ? 'light' : 'dark'))
        }
      />

      <section className="workspace-grid">
        <AssetPanel
          assets={assets}
          selectedAssetId={selectedAssetId}
          importing={importing}
          tools={
            <ToolDock
              transformMode={transformMode}
              timelineMode={timelineMode}
              cameraView={cameraView}
              snapToGrid={snapToGrid}
              playing={playing}
              hasSelection={Boolean(selectedObject)}
              hasObjects={scene.objects.length > 0}
              canSmoothCamera={canSmoothCamera}
              onTransformModeChange={setTransformMode}
              onSetTimelineMode={setTimelineMode}
              onToggleCameraView={() => setCameraView((value) => !value)}
              onToggleSnap={() => setSnapToGrid((value) => !value)}
              onTogglePlay={togglePlaybackPreview}
              onAddKeyframe={addCameraKeyframe}
              onConnectCameraPath={connectCameraPath}
              onSmoothCameraRate={smoothCameraRate}
              onSmoothCameraPath={smoothCameraPath}
              onApplyCinematicPreset={applyCinematicPreset}
              onClearCameraPath={clearCameraPath}
              onDuplicateSelected={duplicateSelected}
              onDeleteSelected={deleteSelected}
              onClearSceneObjects={clearSceneObjects}
              onAlignAllObjectsToGround={alignAllObjectsToGround}
            />
          }
          onSelectAsset={setSelectedAssetId}
          onAddAsset={addAssetToScene}
          onDeleteImportedAsset={deleteImportedAsset}
          onAddSceneMotionPreset={addSceneMotionPreset}
          onImportAsset={importAsset}
        />
        {renderViewport(false)}
        <Inspector
          scene={scene}
          selectedObject={selectedObject}
          selectedKeyframeId={selectedKeyframeId}
          renderJob={renderJob}
          onUpdateObjectTransform={updateObjectTransform}
          onUpdateObjectColor={updateObjectColor}
          onUpdateObjectMotion={updateObjectMotion}
          onImportGreenScreenTexture={importGreenScreenTexture}
          onClearGreenScreenTexture={clearGreenScreenTexture}
          selectedObjectBaseY={
            selectedObject ? getObjectBaseY(selectedObject, assets) : null
          }
          selectedObjectTopY={
            selectedObject ? getObjectTopY(selectedObject, assets) : null
          }
          placementSnap={placementSnap}
          onTogglePlacementSnap={() => setPlacementSnap((value) => !value)}
          onGroundSelectedObject={groundSelectedObject}
          onAddLight={addLight}
          onUpdateLight={updateLight}
          onDeleteLight={deleteLight}
          onSelectKeyframe={(keyframeId) => {
            setSelectedKeyframeId(keyframeId)
            setSelectedObjectId(null)
          }}
          onDeleteKeyframe={deleteCameraKeyframe}
          onReorderKeyframe={reorderCameraKeyframe}
          onToggleSegmentConnection={toggleCameraSegmentConnection}
          onMoveKeyframePosition={moveKeyframePosition}
          onMoveKeyframeTarget={moveKeyframeTarget}
          onToggleAimAnchor={toggleAimAnchor}
          onToggleAimAnchorSnap={toggleAimAnchorSnap}
          onSetAimAnchorToSelectedObject={setAimAnchorToSelectedObject}
          onSetAimAnchorToCurrentTarget={setAimAnchorToCurrentTarget}
          onMoveCurveControl={moveCurveControl}
          onUpdateSegmentSpeed={updateSegmentSpeed}
          onUpdateSegmentSpeedCurve={updateSegmentSpeedCurve}
          onUpdateSegmentCurve={updateSegmentCurve}
          onUpdateSegmentCurveStrength={updateSegmentCurveStrength}
          onUpdateKeyframeShotDuration={updateKeyframeShotDuration}
          onUpdateCameraMotion={updateCameraMotion}
          onUpdateRenderSettings={(settings) =>
            commitScene((current) => ({
              ...current,
              renderSettings: normalizeRenderSettingsForUi(settings),
              timeline: {
                ...current.timeline,
                currentTimeSec: clampTimeToDuration(
                  current.timeline.currentTimeSec,
                  settings.durationSec,
                ),
              },
            }))
          }
          onExportVideo={exportVideo}
        />
      </section>

      <Timeline
        scene={scene}
        playing={playing}
        onTimeChange={updateCurrentTime}
        onKeyframeSelect={updateCurrentTime}
        selectedKeyframeId={selectedKeyframeId}
        onSelectKeyframe={(keyframeId) => {
          setSelectedKeyframeId(keyframeId)
          setSelectedObjectId(null)
        }}
      />

      <div className="status-bar">
        <span>{systemMessage}</span>
        <span>
          {scene.objects.length} objects / {timelineDuration.toFixed(1)}s /{' '}
          {scene.renderSettings.fps} FPS
        </span>
      </div>
      {fullscreenPreview ? (
        <div className="fullscreen-preview-layer" role="dialog" aria-label="全屏播放窗口">
          {renderViewport(true)}
        </div>
      ) : null}
    </main>
  )
}

export default App
