import { PerspectiveCamera, Grid } from '@react-three/drei'
import { ThreeCanvas } from '@remotion/three'
import { Suspense } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { SceneLights, SceneObjects } from '../scene/SceneGeometry'
import { builtInAssets } from '../scene/assets'
import { sampleCameraAtTime } from '../scene/camera'
import {
  INFINITE_GRID_CELL_SIZE,
  INFINITE_GRID_CELL_THICKNESS,
  INFINITE_GRID_FADE_DISTANCE,
  INFINITE_GRID_FADE_STRENGTH,
  INFINITE_GRID_SECTION_SIZE,
  INFINITE_GRID_SECTION_THICKNESS,
  SCENE_CAMERA_FAR,
  SCENE_FOG_FAR,
  SCENE_FOG_NEAR,
} from '../scene/environment'
import type { AssetDefinition, SceneDocument } from '../scene/types'

export type ShotCompositionProps = SceneDocument

const getAssetsForScene = (scene: SceneDocument): AssetDefinition[] => {
  const importedAssets = scene.objects
    .filter((object) => object.metadata?.url)
    .map<AssetDefinition>((object) => ({
      id: object.assetId,
      label: object.name,
      category: 'prop',
      kind: 'imported',
      url: object.metadata?.url,
      format: object.metadata?.format,
      dimensions: [1, 1, 1],
    }))

  return [...builtInAssets, ...importedAssets]
}

export const ShotComposition = (props: ShotCompositionProps) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeSec = frame / fps
  const cameraSample = sampleCameraAtTime(props, timeSec)
  const assets = getAssetsForScene(props)

  return (
    <AbsoluteFill style={{ backgroundColor: '#edf1f5' }}>
      <ThreeCanvas
        width={width}
        height={height}
        camera={{
          position: cameraSample.position,
          fov: cameraSample.fov,
          near: 0.1,
          far: SCENE_CAMERA_FAR,
        }}
      >
        <color attach="background" args={['#edf1f5']} />
        <fog attach="fog" args={['#edf1f5', SCENE_FOG_NEAR, SCENE_FOG_FAR]} />
        <PerspectiveCamera
          makeDefault
          position={cameraSample.position}
          fov={cameraSample.fov}
          near={0.1}
          far={SCENE_CAMERA_FAR}
          onUpdate={(camera) => camera.lookAt(...cameraSample.target)}
        />
        <SceneLights scene={props} />
        <Grid
          args={[1, 1]}
          infiniteGrid
          followCamera
          cellSize={INFINITE_GRID_CELL_SIZE}
          cellThickness={INFINITE_GRID_CELL_THICKNESS}
          cellColor="#cbd1da"
          sectionSize={INFINITE_GRID_SECTION_SIZE}
          sectionThickness={INFINITE_GRID_SECTION_THICKNESS}
          sectionColor="#aeb7c3"
          fadeDistance={INFINITE_GRID_FADE_DISTANCE}
          fadeStrength={INFINITE_GRID_FADE_STRENGTH}
          position={[0, -0.02, 0]}
        />
        <Suspense fallback={null}>
          <SceneObjects
            scene={props}
            assets={assets}
            currentTimeSec={timeSec}
            interactive={false}
          />
        </Suspense>
      </ThreeCanvas>
    </AbsoluteFill>
  )
}
