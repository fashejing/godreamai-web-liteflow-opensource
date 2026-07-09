import { PerspectiveCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import { SceneLights, SceneObjects } from '../scene/SceneGeometry'
import { sampleCameraAtTime, type CameraSample } from '../scene/camera'
import {
  SCENE_CAMERA_FAR,
  SCENE_FOG_FAR,
  SCENE_FOG_NEAR,
} from '../scene/environment'
import type { AssetDefinition, SceneDocument } from '../scene/types'
import { SceneEnvironment } from './SceneEnvironment'
import type { UiTheme } from './Toolbar'

type CameraMonitorViewportProps = {
  scene: SceneDocument
  assets: AssetDefinition[]
  currentTimeSec: number
  uiTheme: UiTheme
  showFloor: boolean
}

const monitorTheme = {
  dark: {
    background: '#15171b',
    gridCell: '#5b6775',
    gridSection: '#9aabbf',
    shadow: '#b7c0cc',
  },
  light: {
    background: '#f7f7f4',
    gridCell: '#aeb8c4',
    gridSection: '#7f8d9d',
    shadow: '#8b96a5',
  },
} satisfies Record<UiTheme, {
  background: string
  gridCell: string
  gridSection: string
  shadow: string
}>

const MonitorCamera = ({ sample }: { sample: CameraSample }) => {
  const cameraRef = useRef<ThreePerspectiveCamera | null>(null)

  useLayoutEffect(() => {
    const camera = cameraRef.current

    if (!camera) {
      return
    }

    camera.position.set(...sample.position)
    camera.lookAt(...sample.target)
    camera.fov = sample.fov
    camera.near = 0.1
    camera.far = SCENE_CAMERA_FAR
    camera.updateProjectionMatrix()
  }, [sample])

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      near={0.1}
      far={SCENE_CAMERA_FAR}
    />
  )
}

export const CameraMonitorViewport = ({
  scene,
  assets,
  currentTimeSec,
  uiTheme,
  showFloor,
}: CameraMonitorViewportProps) => {
  const cameraSample = useMemo(
    () => sampleCameraAtTime(scene, currentTimeSec),
    [scene, currentTimeSec],
  )
  const colors = monitorTheme[uiTheme]

  return (
    <Canvas
      className="shot-monitor-canvas"
      shadows
      dpr={1}
      camera={{
        position: cameraSample.position,
        fov: cameraSample.fov,
        near: 0.1,
        far: SCENE_CAMERA_FAR,
      }}
    >
      <color attach="background" args={[colors.background]} />
      <fog attach="fog" args={[colors.background, SCENE_FOG_NEAR, SCENE_FOG_FAR]} />
      <MonitorCamera sample={cameraSample} />
      <SceneLights scene={scene} />
      <Suspense fallback={null}>
        <SceneEnvironment
          renderSettings={scene.renderSettings}
          colors={colors}
          uiTheme={uiTheme}
          showFloor={showFloor}
          showPanorama={Boolean(
            scene.virtualProduction?.panoramaEnabled &&
              scene.virtualProduction.panoramaUrl,
          )}
          panoramaUrl={scene.virtualProduction?.panoramaUrl}
        />
        <SceneObjects
          scene={scene}
          assets={assets}
          currentTimeSec={currentTimeSec}
          interactive={false}
        />
      </Suspense>
    </Canvas>
  )
}
