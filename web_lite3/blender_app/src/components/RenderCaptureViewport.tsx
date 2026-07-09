import { PerspectiveCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { forwardRef, Suspense, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
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

export type RenderCaptureHandle = {
  capturePng: (expectedWidth: number, expectedHeight: number) => Promise<Blob>
  isReady: () => boolean
}

type RenderCaptureViewportProps = {
  scene: SceneDocument
  assets: AssetDefinition[]
  currentTimeSec: number
  uiTheme: UiTheme
}

const captureTheme = {
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

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })

const canvasHasPixels = (canvas: HTMLCanvasElement): boolean =>
  canvas.width > 0 &&
  canvas.height > 0 &&
  canvas.clientWidth > 0 &&
  canvas.clientHeight > 0

const canvasMatchesSize = (
  canvas: HTMLCanvasElement,
  expectedWidth: number,
  expectedHeight: number,
): boolean =>
  canvasHasPixels(canvas) &&
  canvas.width === expectedWidth &&
  canvas.height === expectedHeight

const canvasHasRenderedScenePixels = (canvas: HTMLCanvasElement): boolean => {
  try {
    const sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = 32
    sampleCanvas.height = 32
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return true
    }

    context.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height)
    const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data
    let minBrightness = 255
    let maxBrightness = 0

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3]

      if (alpha === 0) {
        continue
      }

      const brightness = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3
      minBrightness = Math.min(minBrightness, brightness)
      maxBrightness = Math.max(maxBrightness, brightness)
    }

    return maxBrightness > 34 || maxBrightness - minBrightness > 10
  } catch (_error) {
    return true
  }
}

const CaptureCamera = ({ sample }: { sample: CameraSample }) => {
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

export const RenderCaptureViewport = forwardRef<
  RenderCaptureHandle,
  RenderCaptureViewportProps
>(({ scene, assets, currentTimeSec, uiTheme }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cameraSample = useMemo(
    () => sampleCameraAtTime(scene, currentTimeSec),
    [scene, currentTimeSec],
  )
  const colors = captureTheme[uiTheme]

  useImperativeHandle(ref, () => ({
    isReady: () => {
      const canvas = containerRef.current?.querySelector('canvas')
      return Boolean(canvas && canvasHasPixels(canvas))
    },
    capturePng: async (expectedWidth: number, expectedHeight: number) => {
      let canvas: HTMLCanvasElement | null | undefined

      for (let attempt = 0; attempt < 90; attempt += 1) {
        canvas = containerRef.current?.querySelector('canvas')
        if (
          canvas &&
          canvasMatchesSize(canvas, expectedWidth, expectedHeight) &&
          canvasHasRenderedScenePixels(canvas)
        ) {
          break
        }
        await waitForNextFrame()
      }

      if (!canvas || !canvasMatchesSize(canvas, expectedWidth, expectedHeight)) {
        const actualSize = canvas ? `${canvas.width}x${canvas.height}` : '0x0'
        throw new Error(
          `导出画布尺寸未匹配：${actualSize}，期望 ${expectedWidth}x${expectedHeight}。`,
        )
      }

      return new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Render canvas did not return a PNG frame.'))
              return
            }
            resolve(blob)
          }, 'image/png')
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
  }))

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="render-capture-viewport"
      style={{
        width: `${scene.renderSettings.width}px`,
        height: `${scene.renderSettings.height}px`,
      }}
    >
      <Canvas
        shadows
        dpr={1}
        gl={{ preserveDrawingBuffer: true }}
        style={{
          width: `${scene.renderSettings.width}px`,
          height: `${scene.renderSettings.height}px`,
        }}
        camera={{
          position: cameraSample.position,
          fov: cameraSample.fov,
          near: 0.1,
          far: SCENE_CAMERA_FAR,
        }}
      >
        <color attach="background" args={[colors.background]} />
        <fog attach="fog" args={[colors.background, SCENE_FOG_NEAR, SCENE_FOG_FAR]} />
        <CaptureCamera sample={cameraSample} />
        <SceneLights scene={scene} />
        <Suspense fallback={null}>
          <SceneEnvironment
            renderSettings={scene.renderSettings}
            colors={colors}
            uiTheme={uiTheme}
            showFloor
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
    </div>
  )
})

RenderCaptureViewport.displayName = 'RenderCaptureViewport'
