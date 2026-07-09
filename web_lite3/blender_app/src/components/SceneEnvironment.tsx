import { Grid } from '@react-three/drei'
import { useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BackSide, CanvasTexture, RepeatWrapping, TextureLoader } from 'three'
import {
  INFINITE_GRID_CELL_SIZE,
  INFINITE_GRID_CELL_THICKNESS,
  INFINITE_GRID_FADE_DISTANCE,
  INFINITE_GRID_FADE_STRENGTH,
  INFINITE_GRID_SECTION_SIZE,
  INFINITE_GRID_SECTION_THICKNESS,
  VISUAL_GROUND_SIZE,
} from '../scene/environment'
import type { FloorMaterial, RenderSettings } from '../scene/types'
import type { UiTheme } from './Toolbar'

type SceneEnvironmentColors = {
  gridCell: string
  gridSection: string
  shadow: string
}

type SceneEnvironmentProps = {
  renderSettings: RenderSettings
  colors: SceneEnvironmentColors
  uiTheme: UiTheme
  showFloor: boolean
  showPanorama?: boolean
  panoramaUrl?: string
}

type FloorStyle = {
  color: string
  roughness: number
}

const textureRepeatByMaterial: Partial<Record<FloorMaterial, number>> = {
  checker: VISUAL_GROUND_SIZE / 16,
  concrete: VISUAL_GROUND_SIZE / 24,
  sand: VISUAL_GROUND_SIZE / 18,
  grass: VISUAL_GROUND_SIZE / 20,
  asphalt: VISUAL_GROUND_SIZE / 24,
}

const panoramaDomeRadius = 1500

const pseudoRandom = (seed: number): number => {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

const speckle = (
  context: CanvasRenderingContext2D,
  colors: string[],
  count: number,
  seedOffset: number,
  minSize = 1,
  maxSize = 3,
) => {
  for (let index = 0; index < count; index += 1) {
    const x = pseudoRandom(index + seedOffset) * 256
    const y = pseudoRandom(index + seedOffset + 93) * 256
    const size = minSize + pseudoRandom(index + seedOffset + 211) * (maxSize - minSize)
    context.globalAlpha = 0.18 + pseudoRandom(index + seedOffset + 37) * 0.35
    context.fillStyle = colors[index % colors.length]
    context.fillRect(x, y, size, size)
  }
  context.globalAlpha = 1
}

const createFloorTexture = (material: FloorMaterial): CanvasTexture | null => {
  if (!textureRepeatByMaterial[material]) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  if (material === 'checker') {
    const tileSize = 32
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        context.fillStyle = (x + y) % 2 === 0 ? '#f1f3f5' : '#aab0b7'
        context.fillRect(x * tileSize, y * tileSize, tileSize, tileSize)
      }
    }
    context.strokeStyle = 'rgba(80, 88, 96, 0.22)'
    context.lineWidth = 1
    for (let index = 0; index <= 8; index += 1) {
      const position = index * tileSize
      context.beginPath()
      context.moveTo(position, 0)
      context.lineTo(position, 256)
      context.moveTo(0, position)
      context.lineTo(256, position)
      context.stroke()
    }
  }

  if (material === 'concrete') {
    context.fillStyle = '#c6c9cc'
    context.fillRect(0, 0, 256, 256)
    speckle(context, ['#e0e2e4', '#9fa4a8', '#b7babd'], 700, 19, 1, 4)
    context.strokeStyle = 'rgba(92, 98, 102, 0.24)'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(18, 172)
    context.bezierCurveTo(64, 154, 96, 196, 142, 166)
    context.bezierCurveTo(174, 146, 196, 155, 236, 126)
    context.stroke()
  }

  if (material === 'sand') {
    context.fillStyle = '#d8bb70'
    context.fillRect(0, 0, 256, 256)
    speckle(context, ['#f0d990', '#b99352', '#e2c77b'], 950, 41, 1, 3)
  }

  if (material === 'grass') {
    context.fillStyle = '#527a40'
    context.fillRect(0, 0, 256, 256)
    speckle(context, ['#6a954f', '#3f6834', '#83a760'], 520, 73, 1, 4)
    context.strokeStyle = 'rgba(130, 176, 88, 0.42)'
    context.lineWidth = 1
    for (let index = 0; index < 150; index += 1) {
      const x = pseudoRandom(index + 151) * 256
      const y = pseudoRandom(index + 293) * 256
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(x + 2 + pseudoRandom(index + 419) * 5, y - 4 - pseudoRandom(index + 521) * 8)
      context.stroke()
    }
  }

  if (material === 'asphalt') {
    context.fillStyle = '#25282a'
    context.fillRect(0, 0, 256, 256)
    speckle(context, ['#4b4f52', '#181a1c', '#6f7477'], 850, 109, 1, 3)
  }

  const texture = new CanvasTexture(canvas)
  const repeat = textureRepeatByMaterial[material] ?? 1
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.needsUpdate = true
  return texture
}

const getFloorStyle = (
  material: FloorMaterial,
  uiTheme: UiTheme,
): FloorStyle => {
  if (material === 'white') {
    return { color: '#ffffff', roughness: 0.82 }
  }

  if (material === 'checker') {
    return { color: '#ffffff', roughness: 0.86 }
  }

  if (material === 'concrete') {
    return { color: '#d0d2d4', roughness: 0.94 }
  }

  if (material === 'sand') {
    return { color: '#d9bb70', roughness: 0.96 }
  }

  if (material === 'grass') {
    return { color: '#527a40', roughness: 0.9 }
  }

  if (material === 'asphalt') {
    return { color: '#25282a', roughness: 0.92 }
  }

  return {
    color: uiTheme === 'dark' ? '#27323a' : '#e2e8ee',
    roughness: 0.9,
  }
}

const PanoramaDome = ({ url }: { url: string }) => {
  const texture = useLoader(TextureLoader, url)

  return (
    <mesh rotation={[0, Math.PI, 0]} raycast={() => null}>
      <sphereGeometry args={[panoramaDomeRadius, 96, 48]} />
      <meshBasicMaterial
        map={texture}
        side={BackSide}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  )
}

export const SceneEnvironment = ({
  renderSettings,
  colors,
  uiTheme,
  showFloor,
  showPanorama = false,
  panoramaUrl,
}: SceneEnvironmentProps) => {
  const floorMaterial = renderSettings.fillWhiteGround
    ? 'white'
    : renderSettings.floorMaterial
  const floorTexture = useMemo(
    () => createFloorTexture(floorMaterial),
    [floorMaterial],
  )
  const floorStyle = getFloorStyle(floorMaterial, uiTheme)

  useEffect(() => () => floorTexture?.dispose(), [floorTexture])

  return (
    <>
      {showPanorama && panoramaUrl ? <PanoramaDome url={panoramaUrl} /> : null}
      {!renderSettings.hideGrid ? (
        <Grid
          args={[1, 1]}
          infiniteGrid
          followCamera
          cellSize={INFINITE_GRID_CELL_SIZE}
          cellThickness={INFINITE_GRID_CELL_THICKNESS}
          cellColor={colors.gridCell}
          sectionSize={INFINITE_GRID_SECTION_SIZE}
          sectionThickness={INFINITE_GRID_SECTION_THICKNESS}
          sectionColor={colors.gridSection}
          fadeDistance={INFINITE_GRID_FADE_DISTANCE}
          fadeStrength={INFINITE_GRID_FADE_STRENGTH}
          position={[0, showFloor ? 0.018 : 0.006, 0]}
        />
      ) : null}
      {showFloor ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]} receiveShadow>
          <planeGeometry args={[VISUAL_GROUND_SIZE, VISUAL_GROUND_SIZE]} />
          <meshStandardMaterial
            color={floorStyle.color}
            roughness={floorStyle.roughness}
            metalness={0}
            map={floorTexture ?? undefined}
          />
        </mesh>
      ) : null}
    </>
  )
}
