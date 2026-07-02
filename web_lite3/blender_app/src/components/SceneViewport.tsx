import { Line, OrbitControls, TransformControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import {
  Box,
  Clapperboard,
  Expand,
  Lamp,
  Layers,
  Pause,
  Play,
  Route,
  type LucideIcon,
} from 'lucide-react'
import type { Group, PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { SceneEnvironment } from './SceneEnvironment'
import {
  ObjectMotionPaths,
  SceneLights,
  WhiteboxObjectMesh,
} from '../scene/SceneGeometry'
import { getAimAnchorSnapPoints } from '../scene/anchors'
import { getAssetById } from '../scene/assets'
import { lightDirectionToPosition, positionToLightAngles } from '../scene/lights'
import {
  getActiveCamera,
  getCameraSegments,
  getTimelineMode,
  resolveCameraTarget,
  sampleSegmentPoints,
  sampleCameraAtTime,
  sortKeyframes,
  type CameraSample,
} from '../scene/camera'
import {
  SCENE_CAMERA_FAR,
  SCENE_FOG_FAR,
  SCENE_FOG_NEAR,
} from '../scene/environment'
import type { UiTheme } from './Toolbar'
import type {
  AssetDefinition,
  CameraKeyframe,
  SceneDocument,
  SceneLight,
  Transform,
  Vec3,
} from '../scene/types'
import { sampleObjectMotionTransform } from '../scene/objectMotion'

export type TransformMode = 'translate' | 'rotate' | 'scale'

export type ViewportVisibility = {
  lights: boolean
  cameraPath: boolean
  objectPaths: boolean
  floor: boolean
  greenScreen: boolean
}

type SceneViewportProps = {
  scene: SceneDocument
  assets: AssetDefinition[]
  selectedObjectId: string | null
  transformMode: TransformMode
  currentTimeSec: number
  cameraView: boolean
  uiTheme: UiTheme
  snapToGrid: boolean
  placementSnap: boolean
  visibility: ViewportVisibility
  fullscreenActive?: boolean
  playing: boolean
  onToggleVisibility: (key: keyof ViewportVisibility) => void
  onToggleFullscreen: () => void
  onTogglePlay: () => void
  onSelectObject: (objectId: string | null) => void
  onTransformObject: (objectId: string, transform: Transform) => void
  onViewportCameraChange: (sample: CameraSample) => void
  selectedKeyframeId: string | null
  onSelectKeyframe: (keyframeId: string) => void
  onMoveKeyframePosition: (keyframeId: string, position: Vec3) => void
  onMoveKeyframeTarget: (keyframeId: string, target: Vec3) => void
  onMoveAimAnchor: (position: Vec3) => void
  onMoveCurveControl: (fromKeyframeId: string, controlPoint: Vec3) => void
  onUpdateLight: (lightId: string, patch: Partial<SceneLight>) => void
}

const visibilityControls: Array<{
  key: keyof ViewportVisibility
  label: string
  icon: LucideIcon
}> = [
  { key: 'lights', label: '光源', icon: Lamp },
  { key: 'cameraPath', label: '镜头轨迹', icon: Clapperboard },
  { key: 'objectPaths', label: '白模轨迹', icon: Route },
  { key: 'floor', label: '地板', icon: Layers },
  { key: 'greenScreen', label: '绿幕', icon: Box },
]

const viewportTheme = {
  dark: {
    background: '#15171b',
    fog: '#15171b',
    gridCell: '#5b6775',
    gridSection: '#9aabbf',
    shadow: '#b7c0cc',
  },
  light: {
    background: '#f7f7f4',
    fog: '#f7f7f4',
    gridCell: '#aeb8c4',
    gridSection: '#7f8d9d',
    shadow: '#8b96a5',
  },
} satisfies Record<UiTheme, {
  background: string
  fog: string
  gridCell: string
  gridSection: string
  shadow: string
}>

type TransformableObjectProps = {
  sceneObject: SceneDocument['objects'][number]
  asset: AssetDefinition | undefined
  selected: boolean
  currentTimeSec: number
  transformMode: TransformMode
  snapToGrid: boolean
  onSelectObject: (objectId: string | null) => void
  onTransformObject: (objectId: string, transform: Transform) => void
}

const groupToTransform = (group: Group): Transform => ({
  position: [group.position.x, group.position.y, group.position.z],
  rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
  scale: [group.scale.x, group.scale.y, group.scale.z],
})

const groupToBaseTransform = (
  group: Group,
  baseTransform: Transform,
  sampledTransform: Transform,
  transformMode: TransformMode,
): Transform => {
  if (transformMode === 'translate') {
    return {
      ...baseTransform,
      position: [
        baseTransform.position[0] + group.position.x - sampledTransform.position[0],
        baseTransform.position[1] + group.position.y - sampledTransform.position[1],
        baseTransform.position[2] + group.position.z - sampledTransform.position[2],
      ],
    }
  }

  if (transformMode === 'rotate') {
    return {
      ...baseTransform,
      rotation: [
        baseTransform.rotation[0] + group.rotation.x - sampledTransform.rotation[0],
        baseTransform.rotation[1] + group.rotation.y - sampledTransform.rotation[1],
        baseTransform.rotation[2] + group.rotation.z - sampledTransform.rotation[2],
      ],
    }
  }

  if (transformMode === 'scale') {
    return {
      ...baseTransform,
      scale: [group.scale.x, group.scale.y, group.scale.z],
    }
  }

  return groupToTransform(group)
}

const TransformableObject = ({
  sceneObject,
  asset,
  selected,
  currentTimeSec,
  transformMode,
  snapToGrid,
  onSelectObject,
  onTransformObject,
}: TransformableObjectProps) => {
  const groupRef = useRef<Group>(null)
  const [ready, setReady] = useState(false)
  const sampledTransform = useMemo(
    () => sampleObjectMotionTransform(sceneObject, currentTimeSec),
    [sceneObject, currentTimeSec],
  )
  useEffect(() => {
    setReady(true)
  }, [])

  const pushTransform = () => {
    if (!groupRef.current) {
      return
    }

    onTransformObject(
      sceneObject.id,
      groupToBaseTransform(
        groupRef.current,
        sceneObject.transform,
        sampledTransform,
        transformMode,
      ),
    )
  }

  return (
    <>
      <group
        ref={groupRef}
        name={sceneObject.name}
        position={sampledTransform.position}
        rotation={sampledTransform.rotation}
        scale={sampledTransform.scale}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelectObject(sceneObject.id)
        }}
      >
        <WhiteboxObjectMesh object={sceneObject} asset={asset} selected={selected} />
      </group>
      {selected && ready && groupRef.current ? (
        <TransformControls
          object={groupRef.current}
          mode={transformMode}
          translationSnap={snapToGrid ? 0.25 : null}
          rotationSnap={snapToGrid ? Math.PI / 12 : null}
          scaleSnap={snapToGrid ? 0.1 : null}
          onObjectChange={pushTransform}
          onMouseUp={pushTransform}
        />
      ) : null}
    </>
  )
}

const EditableKeyframeMarker = ({
  keyframe,
  selected,
  onSelectKeyframe,
  onMoveKeyframePosition,
}: {
  keyframe: CameraKeyframe
  selected: boolean
  onSelectKeyframe: (keyframeId: string) => void
  onMoveKeyframePosition: (keyframeId: string, position: Vec3) => void
}) => {
  const markerRef = useRef<Group>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  const pushPosition = () => {
    if (!markerRef.current) {
      return
    }

    onMoveKeyframePosition(keyframe.id, [
      markerRef.current.position.x,
      markerRef.current.position.y,
      markerRef.current.position.z,
    ])
  }

  return (
    <>
      <group
        ref={markerRef}
        position={keyframe.position}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelectKeyframe(keyframe.id)
        }}
      >
        <mesh>
          <sphereGeometry args={[selected ? 0.14 : 0.1, 20, 14]} />
          <meshStandardMaterial
            color={selected ? '#ffb84d' : '#006edc'}
            roughness={0.35}
          />
        </mesh>
      </group>
      {selected && ready && markerRef.current ? (
        <TransformControls
          object={markerRef.current}
          mode="translate"
          translationSnap={0.1}
          onObjectChange={pushPosition}
          onMouseUp={pushPosition}
        />
      ) : null}
    </>
  )
}

const EditableTargetMarker = ({
  keyframe,
  selected,
  onSelectKeyframe,
  onMoveKeyframeTarget,
}: {
  keyframe: CameraKeyframe
  selected: boolean
  onSelectKeyframe: (keyframeId: string) => void
  onMoveKeyframeTarget: (keyframeId: string, target: Vec3) => void
}) => {
  const markerRef = useRef<Group>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  const pushTarget = () => {
    if (!markerRef.current) {
      return
    }

    onMoveKeyframeTarget(keyframe.id, [
      markerRef.current.position.x,
      markerRef.current.position.y,
      markerRef.current.position.z,
    ])
  }

  return (
    <>
      <group
        ref={markerRef}
        position={keyframe.target}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelectKeyframe(keyframe.id)
        }}
      >
        <mesh>
          <sphereGeometry args={[selected ? 0.13 : 0.095, 20, 14]} />
          <meshStandardMaterial
            color={selected ? '#d457ff' : '#8d4fd8'}
            roughness={0.36}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[selected ? 0.24 : 0.18, 0.012, 8, 28]} />
          <meshStandardMaterial color="#8d4fd8" roughness={0.42} />
        </mesh>
      </group>
      {selected && ready && markerRef.current ? (
        <TransformControls
          object={markerRef.current}
          mode="translate"
          translationSnap={0.1}
          onObjectChange={pushTarget}
          onMouseUp={pushTarget}
        />
      ) : null}
    </>
  )
}

const DirectionCone = ({
  position,
  target,
  color,
}: {
  position: Vec3
  target: Vec3
  color: string
}) => {
  const coneRef = useRef<Group>(null)

  useEffect(() => {
    coneRef.current?.lookAt(...target)
  }, [position, target])

  return (
    <group ref={coneRef} position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.2]}>
        <coneGeometry args={[0.13, 0.34, 4]} />
        <meshStandardMaterial color={color} roughness={0.62} />
      </mesh>
    </group>
  )
}

const EditableCameraPath = ({
  scene,
  assets,
  currentTimeSec,
  selectedKeyframeId,
  onSelectKeyframe,
  onMoveKeyframePosition,
  onMoveKeyframeTarget,
  onMoveAimAnchor,
  onMoveCurveControl,
}: {
  scene: SceneDocument
  assets: AssetDefinition[]
  currentTimeSec: number
  selectedKeyframeId: string | null
  onSelectKeyframe: (keyframeId: string) => void
  onMoveKeyframePosition: (keyframeId: string, position: Vec3) => void
  onMoveKeyframeTarget: (keyframeId: string, target: Vec3) => void
  onMoveAimAnchor: (position: Vec3) => void
  onMoveCurveControl: (fromKeyframeId: string, controlPoint: Vec3) => void
}) => {
  const keyframes = sortKeyframes(getActiveCamera(scene)?.keyframes ?? [])
  const segments = getCameraSegments(scene)
  const timelineMode = getTimelineMode(scene)
  const aimAnchor = scene.cameraAimAnchor
  const aimAnchorEnabled = Boolean(aimAnchor?.enabled)
  const aimAnchorPosition = resolveCameraTarget(
    scene,
    aimAnchor?.position ?? ([0, 1.3, 0] as Vec3),
    currentTimeSec,
  )
  const snapPoints = aimAnchor?.snapEnabled
    ? getAimAnchorSnapPoints(scene, assets)
    : []
  const sampledCamera = useMemo(
    () => sampleCameraAtTime(scene, currentTimeSec),
    [scene, currentTimeSec],
  )
  const [selectedCurveFromId, setSelectedCurveFromId] = useState<string | null>(null)

  return (
    <>
      {timelineMode === 'motion'
        ? segments.map((segment) => (
            <Line
              key={`line-${segment.from.id}`}
              points={sampleSegmentPoints(segment.from, segment.to, 32)}
              color="#24b47e"
              lineWidth={2.6}
            />
          ))
        : keyframes.slice(0, -1).map((keyframe, index) => (
            <Line
              key={`shot-order-${keyframe.id}`}
              points={[keyframe.position, keyframes[index + 1].position]}
              color="#00f5ff"
              lineWidth={1.4}
              dashed
              dashSize={0.18}
              gapSize={0.12}
            />
          ))}
      {aimAnchorEnabled
        ? keyframes.map((keyframe) => (
            <Line
              key={`anchor-aim-${keyframe.id}`}
              points={[keyframe.position, aimAnchorPosition]}
              color="#ff5c7a"
              lineWidth={keyframe.id === selectedKeyframeId ? 2.3 : 1.25}
              dashed={keyframe.id !== selectedKeyframeId}
              dashSize={0.14}
              gapSize={0.12}
            />
          ))
        : keyframes.map((keyframe) => (
            <Line
              key={`aim-${keyframe.id}`}
              points={[keyframe.position, keyframe.target]}
              color={keyframe.id === selectedKeyframeId ? '#d457ff' : '#8d4fd8'}
              lineWidth={keyframe.id === selectedKeyframeId ? 2.4 : 1.4}
              dashed={keyframe.id !== selectedKeyframeId}
              dashSize={0.16}
              gapSize={0.11}
            />
          ))}
      <Line
        points={[sampledCamera.position, sampledCamera.target]}
        color="#ff5c7a"
        lineWidth={2.6}
      />
      <DirectionCone
        position={sampledCamera.position}
        target={sampledCamera.target}
        color="#172433"
      />
      {timelineMode === 'motion'
        ? segments.map((segment) => (
            <CurveControlMarker
              key={`curve-${segment.from.id}`}
              fromKeyframeId={segment.from.id}
              controlPoint={segment.controlPoint}
              selected={selectedCurveFromId === segment.from.id}
              onSelect={() => setSelectedCurveFromId(segment.from.id)}
              onMoveCurveControl={onMoveCurveControl}
            />
          ))
        : null}
      {!aimAnchorEnabled
        ? keyframes.map((keyframe) => (
            <EditableTargetMarker
              key={`target-${keyframe.id}`}
              keyframe={keyframe}
              selected={selectedKeyframeId === keyframe.id}
              onSelectKeyframe={onSelectKeyframe}
              onMoveKeyframeTarget={onMoveKeyframeTarget}
            />
          ))
        : null}
      {snapPoints.map((point) => (
        <mesh key={point.id} position={point.position}>
          <sphereGeometry args={[0.045, 12, 8]} />
          <meshStandardMaterial
            color={point.kind === 'object' ? '#ffc857' : '#8d4fd8'}
            roughness={0.45}
          />
        </mesh>
      ))}
      <AimAnchorMarker
        enabled={aimAnchorEnabled}
        position={aimAnchorPosition}
        onMoveAimAnchor={onMoveAimAnchor}
      />
      {keyframes.map((keyframe) => (
        <EditableKeyframeMarker
          key={keyframe.id}
          keyframe={keyframe}
          selected={selectedKeyframeId === keyframe.id}
          onSelectKeyframe={onSelectKeyframe}
          onMoveKeyframePosition={onMoveKeyframePosition}
        />
      ))}
    </>
  )
}

const AimAnchorMarker = ({
  enabled,
  position,
  onMoveAimAnchor,
}: {
  enabled: boolean
  position: Vec3
  onMoveAimAnchor: (position: Vec3) => void
}) => {
  const markerRef = useRef<Group>(null)
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  const pushAnchor = () => {
    if (!markerRef.current) {
      return
    }

    onMoveAimAnchor([
      markerRef.current.position.x,
      markerRef.current.position.y,
      markerRef.current.position.z,
    ])
  }

  return (
    <>
      <group
        ref={markerRef}
        position={position}
        onPointerDown={(event) => {
          event.stopPropagation()
          setSelected(true)
        }}
      >
        <mesh rotation={[Math.PI / 4, 0, Math.PI / 4]}>
          <boxGeometry args={[selected ? 0.24 : 0.18, selected ? 0.24 : 0.18, selected ? 0.24 : 0.18]} />
          <meshStandardMaterial
            color={enabled ? '#ff5c7a' : '#ffc857'}
            roughness={0.34}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[selected ? 0.38 : 0.3, 0.012, 8, 32]} />
          <meshStandardMaterial
            color={enabled ? '#ff5c7a' : '#ffc857'}
            roughness={0.42}
          />
        </mesh>
      </group>
      {selected && ready && markerRef.current ? (
        <TransformControls
          object={markerRef.current}
          mode="translate"
          translationSnap={0.05}
          onObjectChange={pushAnchor}
          onMouseUp={pushAnchor}
        />
      ) : null}
    </>
  )
}

const CurveControlMarker = ({
  fromKeyframeId,
  controlPoint,
  selected,
  onSelect,
  onMoveCurveControl,
}: {
  fromKeyframeId: string
  controlPoint: Vec3
  selected: boolean
  onSelect: () => void
  onMoveCurveControl: (fromKeyframeId: string, controlPoint: Vec3) => void
}) => {
  const markerRef = useRef<Group>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  const pushControl = () => {
    if (!markerRef.current) {
      return
    }

    onMoveCurveControl(fromKeyframeId, [
      markerRef.current.position.x,
      markerRef.current.position.y,
      markerRef.current.position.z,
    ])
  }

  return (
    <>
      <group
        ref={markerRef}
        position={controlPoint}
        onPointerDown={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      >
        <mesh>
          <sphereGeometry args={[selected ? 0.13 : 0.09, 18, 12]} />
          <meshStandardMaterial color="#ffb84d" roughness={0.4} />
        </mesh>
      </group>
      {selected && ready && markerRef.current ? (
        <TransformControls
          object={markerRef.current}
          mode="translate"
          translationSnap={0.1}
          onObjectChange={pushControl}
          onMouseUp={pushControl}
        />
      ) : null}
    </>
  )
}

const LightPositionMarker = ({
  light,
  onUpdateLight,
}: {
  light: SceneLight
  onUpdateLight: (lightId: string, patch: Partial<SceneLight>) => void
}) => {
  const markerRef = useRef<Group>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  const position = lightDirectionToPosition(light)
  const target = light.target ?? ([0, 1.2, 0] as Vec3)

  const pushPosition = () => {
    if (!markerRef.current) {
      return
    }

    const nextPosition: Vec3 = [
      markerRef.current.position.x,
      markerRef.current.position.y,
      markerRef.current.position.z,
    ]
    onUpdateLight(light.id, {
      position: nextPosition,
      ...positionToLightAngles(nextPosition, target),
    })
  }

  return (
    <>
      <group ref={markerRef} position={position}>
        <mesh>
          <sphereGeometry args={[0.12, 18, 12]} />
          <meshStandardMaterial color="#ccff00" emissive="#ccff00" emissiveIntensity={0.25} />
        </mesh>
      </group>
      {ready && markerRef.current ? (
        <TransformControls
          object={markerRef.current}
          mode="translate"
          translationSnap={0.1}
          onObjectChange={pushPosition}
          onMouseUp={pushPosition}
        />
      ) : null}
    </>
  )
}

const LightTargetMarker = ({
  light,
  onUpdateLight,
}: {
  light: SceneLight
  onUpdateLight: (lightId: string, patch: Partial<SceneLight>) => void
}) => {
  const markerRef = useRef<Group>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  const target = light.target ?? ([0, 1.2, 0] as Vec3)

  const pushTarget = () => {
    if (!markerRef.current) {
      return
    }

    const nextTarget: Vec3 = [
      markerRef.current.position.x,
      markerRef.current.position.y,
      markerRef.current.position.z,
    ]
    onUpdateLight(light.id, {
      target: nextTarget,
      ...positionToLightAngles(lightDirectionToPosition(light), nextTarget),
    })
  }

  return (
    <>
      <group ref={markerRef} position={target}>
        <mesh>
          <sphereGeometry args={[0.095, 18, 12]} />
          <meshStandardMaterial color="#00f5ff" emissive="#00f5ff" emissiveIntensity={0.2} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.22, 0.01, 8, 28]} />
          <meshStandardMaterial color="#00f5ff" />
        </mesh>
      </group>
      {ready && markerRef.current ? (
        <TransformControls
          object={markerRef.current}
          mode="translate"
          translationSnap={0.1}
          onObjectChange={pushTarget}
          onMouseUp={pushTarget}
        />
      ) : null}
    </>
  )
}

const EditableLightGizmos = ({
  scene,
  onUpdateLight,
}: {
  scene: SceneDocument
  onUpdateLight: (lightId: string, patch: Partial<SceneLight>) => void
}) => {
  const lights = (scene.lights ?? []).filter(
    (light) => light.enabled && light.kind !== 'ambient',
  )

  return (
    <>
      {lights.map((light) => {
        const position = lightDirectionToPosition(light)
        const target = light.target ?? ([0, 1.2, 0] as Vec3)

        return (
          <group key={light.id}>
            <Line points={[position, target]} color="#ccff00" lineWidth={1.6} dashed dashSize={0.18} gapSize={0.1} />
            <LightPositionMarker light={light} onUpdateLight={onUpdateLight} />
            <LightTargetMarker light={light} onUpdateLight={onUpdateLight} />
          </group>
        )
      })}
    </>
  )
}

const CameraFollower = ({
  scene,
  currentTimeSec,
  cameraView,
}: {
  scene: SceneDocument
  currentTimeSec: number
  cameraView: boolean
}) => {
  const camera = useThree((state) => state.camera)
  const sample = useMemo(
    () => sampleCameraAtTime(scene, currentTimeSec),
    [scene, currentTimeSec],
  )

  useEffect(() => {
    if (!cameraView) {
      return
    }

    const perspectiveCamera = camera as PerspectiveCamera
    perspectiveCamera.position.set(...sample.position)
    perspectiveCamera.lookAt(...sample.target)
    perspectiveCamera.fov = sample.fov
    perspectiveCamera.updateProjectionMatrix()
  }, [camera, cameraView, sample])

  return null
}

const ViewReporter = ({
  cameraView,
  onViewportCameraChange,
  controlsRef,
  viewChangeTick,
}: {
  cameraView: boolean
  onViewportCameraChange: (sample: CameraSample) => void
  controlsRef: RefObject<OrbitControlsImpl | null>
  viewChangeTick: number
}) => {
  const camera = useThree((state) => state.camera)

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera
    const target = controlsRef.current?.target

    onViewportCameraChange({
      position: [
        perspectiveCamera.position.x,
        perspectiveCamera.position.y,
        perspectiveCamera.position.z,
      ],
      target: target ? [target.x, target.y, target.z] : [0, 1.2, 0],
      fov: perspectiveCamera.fov,
    })
  }, [camera, cameraView, controlsRef, onViewportCameraChange, viewChangeTick])

  return null
}

export const SceneViewport = ({
  scene,
  assets,
  selectedObjectId,
  transformMode,
  currentTimeSec,
  cameraView,
  uiTheme,
  snapToGrid,
  placementSnap,
  visibility,
  fullscreenActive = false,
  playing,
  onToggleVisibility,
  onToggleFullscreen,
  onTogglePlay,
  onSelectObject,
  onTransformObject,
  onViewportCameraChange,
  selectedKeyframeId,
  onSelectKeyframe,
  onMoveKeyframePosition,
  onMoveKeyframeTarget,
  onMoveAimAnchor,
  onMoveCurveControl,
  onUpdateLight,
}: SceneViewportProps) => {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const [viewChangeTick, setViewChangeTick] = useState(0)
  const timelineMode = getTimelineMode(scene)
  const colors = viewportTheme[uiTheme]
  const renderAspect = scene.renderSettings.width / scene.renderSettings.height
  const visibleObjects = visibility.greenScreen
    ? scene.objects
    : scene.objects.filter((object) => getAssetById(assets, object.assetId)?.prefab !== 'greenscreen')

  return (
    <section
      className={`viewport-shell ${cameraView ? 'is-camera-view' : ''}`}
      aria-label="3D viewport"
    >
      <div className="viewport-topbar">
        <div className="viewport-chip">画面窗口</div>
        <div className="viewport-topbar-actions">
          <div className="viewport-visibility-controls" aria-label="显示内容">
            {visibilityControls.map((control) => {
              const Icon = control.icon
              const active = visibility[control.key]

              return (
                <button
                  key={control.key}
                  type="button"
                  className={active ? 'active' : ''}
                  title={`${active ? '隐藏' : '显示'}${control.label}`}
                  aria-pressed={active}
                  onClick={() => onToggleVisibility(control.key)}
                >
                  <Icon size={13} />
                  <span>{control.label}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="viewport-fullscreen-button"
            onClick={onToggleFullscreen}
          >
            <Expand size={14} />
            {fullscreenActive ? '退出全屏' : '全屏播放'}
          </button>
          {fullscreenActive ? (
            <button
              type="button"
              className="viewport-fullscreen-button viewport-play-button"
              onClick={onTogglePlay}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
              {playing ? '暂停' : '播放'}
            </button>
          ) : null}
          <div className="viewport-readout">
            {cameraView ? '最终镜头' : '编辑视角'} / {currentTimeSec.toFixed(2)}s
          </div>
        </div>
      </div>
      <div className="camera-guide-card">
        <strong>{timelineMode === 'shots' ? '固定机位' : '运镜轨迹'}</strong>
        <span>
          {timelineMode === 'shots'
            ? '蓝点=固定机位，青色虚线=切换顺序，播放时按镜头硬切。'
            : '绿线=路线，蓝点=镜头位置，红点=锁定锚点。'}
          {placementSnap ? ' 同高磁吸开启。' : ' 自由摆放。'}
        </span>
      </div>
      <div
        className="viewport-canvas-frame"
        style={{
          aspectRatio: cameraView
            ? `${scene.renderSettings.width} / ${scene.renderSettings.height}`
            : undefined,
          '--render-aspect': String(renderAspect),
        } as CSSProperties}
      >
        <Canvas
          className="viewport-canvas"
          shadows
          dpr={cameraView ? 1 : [1, 1.6]}
          camera={{ position: [-7, 5, 7], fov: 48, near: 0.1, far: SCENE_CAMERA_FAR }}
          onPointerMissed={() => onSelectObject(null)}
        >
          <color attach="background" args={[colors.background]} />
          <fog attach="fog" args={[colors.fog, SCENE_FOG_NEAR, SCENE_FOG_FAR]} />
          <SceneLights scene={scene} />
          {visibility.lights ? (
            <EditableLightGizmos scene={scene} onUpdateLight={onUpdateLight} />
          ) : null}
          <Suspense fallback={null}>
            <SceneEnvironment
              renderSettings={scene.renderSettings}
              colors={colors}
              uiTheme={uiTheme}
              showFloor={visibility.floor}
            />
            {visibleObjects
              .filter((object) => object.visible)
              .map((object) => (
                <TransformableObject
                  key={object.id}
                  sceneObject={object}
                  asset={getAssetById(assets, object.assetId)}
                  selected={selectedObjectId === object.id}
                  currentTimeSec={currentTimeSec}
                  transformMode={transformMode}
                  snapToGrid={snapToGrid}
                  onSelectObject={onSelectObject}
                  onTransformObject={onTransformObject}
                />
              ))}
            {visibility.objectPaths ? <ObjectMotionPaths scene={scene} /> : null}
            {visibility.cameraPath ? (
              <EditableCameraPath
                scene={scene}
                assets={assets}
                currentTimeSec={currentTimeSec}
                selectedKeyframeId={selectedKeyframeId}
                onSelectKeyframe={onSelectKeyframe}
                onMoveKeyframePosition={onMoveKeyframePosition}
                onMoveKeyframeTarget={onMoveKeyframeTarget}
                onMoveAimAnchor={onMoveAimAnchor}
                onMoveCurveControl={onMoveCurveControl}
              />
            ) : null}
            <CameraFollower
              scene={scene}
              currentTimeSec={currentTimeSec}
              cameraView={cameraView}
            />
            <ViewReporter
              cameraView={cameraView}
              controlsRef={controlsRef}
              viewChangeTick={viewChangeTick}
              onViewportCameraChange={onViewportCameraChange}
            />
          </Suspense>
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!cameraView}
            target={[0, 1.2, 0]}
            minDistance={0.08}
            zoomSpeed={0.7}
            maxPolarAngle={Math.PI * 0.48}
            onChange={() => setViewChangeTick((tick) => tick + 1)}
          />
        </Canvas>
      </div>
    </section>
  )
}
