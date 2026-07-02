import { Line } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { useLoader } from '@react-three/fiber'
import {
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Object3D as ThreeObject3D,
  TextureLoader,
} from 'three'
import type { DirectionalLight, Object3D, SpotLight } from 'three'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js'
import { getImportedModelFormat } from './importedFormats'
import type { AssetDefinition, SceneDocument, SceneObject, Vec3 } from './types'
import { getActiveCamera, sampleCameraAtTime, sortKeyframes } from './camera'
import { getAssetById } from './assets'
import { defaultSceneLights, kelvinToHex, lightDirectionToPosition } from './lights'
import {
  getObjectMotionPathPoints,
  sampleObjectMotionTransform,
} from './objectMotion'

type SceneGeometryProps = {
  scene: SceneDocument
  assets: AssetDefinition[]
  selectedObjectId?: string | null
  interactive?: boolean
  showCameraPath?: boolean
  currentTimeSec?: number
  onSelectObject?: (objectId: string) => void
}

type ObjectMeshProps = {
  object: SceneObject
  asset: AssetDefinition | undefined
  selected: boolean
}

const whiteboxColor = '#f1f3f6'
const secondaryColor = '#d8dde6'
const darkLineColor = '#9aa4b2'

const stopAndSelect = (
  event: ThreeEvent<PointerEvent>,
  objectId: string,
  onSelectObject?: (objectId: string) => void,
) => {
  event.stopPropagation()
  onSelectObject?.(objectId)
}

const MatteMaterial = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <meshStandardMaterial
    color={color}
    emissive={selected ? '#86d8ff' : '#000000'}
    emissiveIntensity={selected ? 0.12 : 0}
    metalness={0}
    roughness={0.82}
  />
)

const EdgeMaterial = () => (
  <meshStandardMaterial color={secondaryColor} metalness={0} roughness={0.86} />
)

const PersonPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 1.05, 0]} castShadow>
      <boxGeometry args={[0.55, 0.85, 0.32]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 1.66, 0]} castShadow>
      <sphereGeometry args={[0.22, 24, 16]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[-0.18, 0.42, 0]} castShadow>
      <boxGeometry args={[0.16, 0.75, 0.18]} />
      <EdgeMaterial />
    </mesh>
    <mesh position={[0.18, 0.42, 0]} castShadow>
      <boxGeometry args={[0.16, 0.75, 0.18]} />
      <EdgeMaterial />
    </mesh>
    <mesh position={[-0.45, 1.05, 0]} rotation={[0, 0, -0.25]} castShadow>
      <boxGeometry args={[0.14, 0.72, 0.14]} />
      <EdgeMaterial />
    </mesh>
    <mesh position={[0.45, 1.05, 0]} rotation={[0, 0, 0.25]} castShadow>
      <boxGeometry args={[0.14, 0.72, 0.14]} />
      <EdgeMaterial />
    </mesh>
  </group>
)

const BlockBuildingPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 1.55, 0]} castShadow receiveShadow>
      <boxGeometry args={[3, 3.1, 2.2]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0.8, 3.25, -0.2]} castShadow>
      <boxGeometry args={[1.1, 0.35, 1]} />
      <EdgeMaterial />
    </mesh>
    {[-0.8, 0, 0.8].map((x) =>
      [1.2, 2.0].map((y) => (
        <mesh key={`${x}-${y}`} position={[x, y, 1.12]}>
          <boxGeometry args={[0.34, 0.38, 0.04]} />
          <meshStandardMaterial color={darkLineColor} roughness={0.9} />
        </mesh>
      )),
    )}
  </group>
)

const TowerPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 2.5, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.5, 5, 1.5]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 5.18, 0]} castShadow>
      <boxGeometry args={[1.95, 0.32, 1.95]} />
      <EdgeMaterial />
    </mesh>
    <mesh position={[0, 0.18, 0]} receiveShadow>
      <boxGeometry args={[2.1, 0.36, 2.1]} />
      <EdgeMaterial />
    </mesh>
  </group>
)

const TreePrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 0.72, 0]} castShadow>
      <cylinderGeometry args={[0.16, 0.2, 1.45, 10]} />
      <meshStandardMaterial color={secondaryColor} roughness={0.9} />
    </mesh>
    <mesh position={[0, 1.78, 0]} castShadow>
      <coneGeometry args={[0.86, 1.55, 8]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 2.36, 0]} castShadow>
      <coneGeometry args={[0.62, 1.18, 8]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
  </group>
)

const CratePrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 1.04, 0]} castShadow>
      <boxGeometry args={[1.08, 0.08, 1.08]} />
      <EdgeMaterial />
    </mesh>
  </group>
)

const WallPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <mesh position={[0, 0.8, 0]} castShadow receiveShadow>
    <boxGeometry args={[3, 1.6, 0.2]} />
    <MatteMaterial color={color} selected={selected} />
  </mesh>
)

const Wheel = ({ position }: { position: Vec3 }) => (
  <mesh position={position} rotation={[Math.PI / 2, 0, 0]} castShadow>
    <cylinderGeometry args={[0.18, 0.18, 0.12, 16]} />
    <meshStandardMaterial color="#1d232b" roughness={0.7} />
  </mesh>
)

const CarPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.65, 0.5, 2.6]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 0.86, -0.2]} castShadow>
      <boxGeometry args={[1.2, 0.42, 1.1]} />
      <EdgeMaterial />
    </mesh>
    {[-0.72, 0.72].map((x) =>
      [-0.95, 0.95].map((z) => <Wheel key={`${x}-${z}`} position={[x, 0.2, z]} />),
    )}
  </group>
)

const TruckPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 0.65, 0.45]} castShadow receiveShadow>
      <boxGeometry args={[1.95, 0.95, 2.7]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 0.78, -1.45]} castShadow>
      <boxGeometry args={[1.75, 1.15, 1.25]} />
      <EdgeMaterial />
    </mesh>
    {[-0.86, 0.86].map((x) =>
      [-1.5, -0.2, 1.45].map((z) => <Wheel key={`${x}-${z}`} position={[x, 0.22, z]} />),
    )}
  </group>
)

const MotorcyclePrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 0.58, 0]} castShadow>
      <boxGeometry args={[0.34, 0.28, 1.1]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <Wheel position={[0, 0.22, -0.78]} />
    <Wheel position={[0, 0.22, 0.78]} />
    <mesh position={[0, 0.88, -0.12]} castShadow>
      <boxGeometry args={[0.24, 0.34, 0.32]} />
      <EdgeMaterial />
    </mesh>
  </group>
)

const AirplanePrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[0.24, 0.36, 2.8, 16]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 0, 0.05]} castShadow>
      <boxGeometry args={[3.3, 0.08, 0.72]} />
      <EdgeMaterial />
    </mesh>
    <mesh position={[0, 0.18, 1.22]} castShadow>
      <boxGeometry args={[1.2, 0.08, 0.46]} />
      <EdgeMaterial />
    </mesh>
  </group>
)

const DronePrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh castShadow>
      <boxGeometry args={[0.5, 0.18, 0.5]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    {[
      [-0.75, 0, -0.75],
      [0.75, 0, -0.75],
      [-0.75, 0, 0.75],
      [0.75, 0, 0.75],
    ].map((position) => (
      <mesh key={position.join('-')} position={position as Vec3} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.5, 0.03, 0.5]} />
        <EdgeMaterial />
      </mesh>
    ))}
  </group>
)

const HelicopterPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 0.52, -0.1]} castShadow>
      <boxGeometry args={[0.85, 0.55, 1.7]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 0.62, 1.25]} castShadow>
      <boxGeometry args={[0.18, 0.16, 1.2]} />
      <EdgeMaterial />
    </mesh>
    <mesh position={[0, 0.92, -0.15]} castShadow>
      <boxGeometry args={[2.4, 0.04, 0.18]} />
      <meshStandardMaterial color="#1d232b" roughness={0.75} />
    </mesh>
  </group>
)

const BoatPrefab = ({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) => (
  <group>
    <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.3, 0.46, 2.8]} />
      <MatteMaterial color={color} selected={selected} />
    </mesh>
    <mesh position={[0, 0.74, -0.25]} castShadow>
      <boxGeometry args={[0.75, 0.45, 0.9]} />
      <EdgeMaterial />
    </mesh>
  </group>
)

const TexturedGreenScreen = ({ textureUrl }: { textureUrl: string }) => {
  const texture = useLoader(TextureLoader, textureUrl)

  return (
    <mesh position={[0, 1.125, 0]} castShadow receiveShadow>
      <boxGeometry args={[4, 2.25, 0.08]} />
      <meshStandardMaterial
        map={texture}
        color="#ffffff"
        roughness={0.62}
        metalness={0}
        side={DoubleSide}
      />
    </mesh>
  )
}

const GreenScreenPrefab = ({
  selected,
  textureUrl,
}: {
  selected: boolean
  textureUrl?: string
}) => (
  <group>
    {textureUrl ? (
      <TexturedGreenScreen textureUrl={textureUrl} />
    ) : (
      <mesh position={[0, 1.125, 0]} castShadow receiveShadow>
        <boxGeometry args={[4, 2.25, 0.08]} />
        <meshStandardMaterial
          color="#00b140"
          emissive={selected ? '#45ff7a' : '#003f20'}
          emissiveIntensity={selected ? 0.2 : 0.08}
          roughness={0.58}
          metalness={0}
          side={DoubleSide}
        />
      </mesh>
    )}
    <mesh position={[0, 2.33, 0]}>
      <boxGeometry args={[4.18, 0.08, 0.12]} />
      <meshStandardMaterial color="#202626" roughness={0.78} />
    </mesh>
    <mesh position={[-2.12, 1.12, 0]}>
      <boxGeometry args={[0.08, 2.5, 0.12]} />
      <meshStandardMaterial color="#202626" roughness={0.78} />
    </mesh>
    <mesh position={[2.12, 1.12, 0]}>
      <boxGeometry args={[0.08, 2.5, 0.12]} />
      <meshStandardMaterial color="#202626" roughness={0.78} />
    </mesh>
  </group>
)

const importedLoaderByFormat = {
  gltf: GLTFLoader,
  obj: OBJLoader,
  stl: STLLoader,
  fbx: FBXLoader,
  dae: ColladaLoader,
  ply: PLYLoader,
  '3mf': ThreeMFLoader,
  '3ds': TDSLoader,
}

const normalizeImportedObject = (object: Object3D): Object3D => {
  object.traverse((child) => {
    const maybeMesh = child as Mesh
    if (!maybeMesh.isMesh) {
      return
    }
    maybeMesh.castShadow = true
    maybeMesh.receiveShadow = true
    if (!maybeMesh.material) {
      maybeMesh.material = new MeshStandardMaterial({
        color: whiteboxColor,
        roughness: 0.82,
      })
    }
  })
  return object
}

const ImportedModel = ({
  url,
  format,
}: {
  url: string
  format: AssetDefinition['format']
}) => {
  const resolvedFormat = format ?? getImportedModelFormat(url) ?? 'gltf'
  const Loader = importedLoaderByFormat[resolvedFormat]
  const loaded = useLoader(Loader, url)
  const clonedScene = useMemo(() => {
    const loadedModel = loaded as unknown

    if (
      loadedModel &&
      typeof loadedModel === 'object' &&
      'scene' in loadedModel &&
      loadedModel.scene instanceof ThreeObject3D
    ) {
      return normalizeImportedObject(loadedModel.scene.clone(true))
    }

    if (loadedModel instanceof BufferGeometry) {
      return normalizeImportedObject(
        new Mesh(
          loadedModel,
          new MeshStandardMaterial({ color: whiteboxColor, roughness: 0.82 }),
        ),
      )
    }

    if (loadedModel instanceof ThreeObject3D) {
      return normalizeImportedObject(loadedModel.clone(true))
    }

    return new ThreeObject3D()
  }, [loaded])

  return <primitive object={clonedScene} />
}

export const WhiteboxObjectMesh = ({
  object,
  asset,
  selected,
}: ObjectMeshProps) => {
  const objectColor = object.material.color || whiteboxColor

  if (asset?.kind === 'imported' && (object.metadata?.url ?? asset.url)) {
    return (
      <ImportedModel
        url={object.metadata?.url ?? asset.url ?? ''}
        format={object.metadata?.format ?? asset.format}
      />
    )
  }

  switch (asset?.prefab) {
    case 'person':
      return <PersonPrefab color={objectColor} selected={selected} />
    case 'block-building':
      return <BlockBuildingPrefab color={objectColor} selected={selected} />
    case 'tower':
      return <TowerPrefab color={objectColor} selected={selected} />
    case 'tree':
      return <TreePrefab color={objectColor} selected={selected} />
    case 'wall':
      return <WallPrefab color={objectColor} selected={selected} />
    case 'greenscreen':
      return (
        <GreenScreenPrefab
          selected={selected}
          textureUrl={object.metadata?.textureUrl}
        />
      )
    case 'car':
      return <CarPrefab color={objectColor} selected={selected} />
    case 'truck':
      return <TruckPrefab color={objectColor} selected={selected} />
    case 'motorcycle':
      return <MotorcyclePrefab color={objectColor} selected={selected} />
    case 'airplane':
      return <AirplanePrefab color={objectColor} selected={selected} />
    case 'drone':
      return <DronePrefab color={objectColor} selected={selected} />
    case 'helicopter':
      return <HelicopterPrefab color={objectColor} selected={selected} />
    case 'boat':
      return <BoatPrefab color={objectColor} selected={selected} />
    case 'crate':
    default:
      return <CratePrefab color={objectColor} selected={selected} />
  }
}

export const SceneObjects = ({
  scene,
  assets,
  selectedObjectId,
  interactive = false,
  currentTimeSec = 0,
  onSelectObject,
}: SceneGeometryProps) => (
  <>
    {scene.objects
      .filter((object) => object.visible)
      .map((object) => {
        const asset = getAssetById(assets, object.assetId)
        const selected = object.id === selectedObjectId
        const transform = sampleObjectMotionTransform(object, currentTimeSec)

        return (
          <group
            key={object.id}
            name={object.name}
            position={transform.position}
            rotation={transform.rotation}
            scale={transform.scale}
            onPointerDown={
              interactive
                ? (event) => stopAndSelect(event, object.id, onSelectObject)
                : undefined
            }
          >
            <WhiteboxObjectMesh object={object} asset={asset} selected={selected} />
          </group>
        )
      })}
  </>
)

export const ObjectMotionPaths = ({
  scene,
}: {
  scene: SceneDocument
}) => (
  <>
    {scene.objects.map((object) => {
      const points = getObjectMotionPathPoints(object)

      return points.length > 1 ? (
        <Line key={`object-motion-${object.id}`} points={points} color="#ffb84d" lineWidth={2.2} />
      ) : null
    })}
  </>
)

const DirectionalSceneLight = ({
  color,
  intensity,
  position,
  target,
}: {
  color: string
  intensity: number
  position: Vec3
  target: Vec3
}) => {
  const lightRef = useRef<DirectionalLight>(null)
  const targetRef = useRef<Object3D>(null)

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [target])

  return (
    <>
      <object3D ref={targetRef} position={target} />
      <directionalLight
        ref={lightRef}
        color={color}
        intensity={intensity}
        position={position}
        castShadow
      />
    </>
  )
}

const SpotSceneLight = ({
  color,
  intensity,
  position,
  target,
}: {
  color: string
  intensity: number
  position: Vec3
  target: Vec3
}) => {
  const lightRef = useRef<SpotLight>(null)
  const targetRef = useRef<Object3D>(null)

  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  }, [target])

  return (
    <>
      <object3D ref={targetRef} position={target} />
      <spotLight
        ref={lightRef}
        color={color}
        intensity={intensity}
        position={position}
        angle={Math.PI / 5}
        penumbra={0.55}
        castShadow
      />
    </>
  )
}

export const SceneLights = ({ scene }: { scene: SceneDocument }) => {
  const lights = scene.lights?.length ? scene.lights : defaultSceneLights

  return (
    <>
      {lights
        .filter((light) => light.enabled)
        .map((light) => {
          const color = kelvinToHex(light.colorTemperature)
          const position = lightDirectionToPosition(light)
          const target = light.target ?? ([0, 1.2, 0] as Vec3)

          switch (light.kind) {
            case 'ambient':
              return (
                <ambientLight
                  key={light.id}
                  color={color}
                  intensity={light.intensity}
                />
              )
            case 'point':
              return (
                <pointLight
                  key={light.id}
                  color={color}
                  intensity={light.intensity}
                  position={position}
                  distance={light.distance * 3}
                  castShadow
                />
              )
            case 'spot':
              return (
                <SpotSceneLight
                  key={light.id}
                  color={color}
                  intensity={light.intensity}
                  position={position}
                  target={target}
                />
              )
            case 'directional':
            default:
              return (
                <DirectionalSceneLight
                  key={light.id}
                  color={color}
                  intensity={light.intensity}
                  position={position}
                  target={target}
                />
              )
          }
        })}
    </>
  )
}

export const CameraPath = ({
  scene,
  currentTimeSec = 0,
  showCameraPath = true,
}: SceneGeometryProps) => {
  const activeCamera = getActiveCamera(scene)
  const keyframes = sortKeyframes(activeCamera?.keyframes ?? [])
  const sampled = sampleCameraAtTime(scene, currentTimeSec)
  const points = keyframes.map((keyframe) => keyframe.position)
  const aimVector: Vec3 = [
    sampled.target[0] - sampled.position[0],
    sampled.target[1] - sampled.position[1],
    sampled.target[2] - sampled.position[2],
  ]

  return (
    <>
      {showCameraPath && points.length > 1 ? (
        <Line points={points} color="#24b47e" lineWidth={2.4} />
      ) : null}
      {showCameraPath
        ? keyframes.map((keyframe) => (
            <mesh key={keyframe.id} position={keyframe.position}>
              <sphereGeometry args={[0.09, 16, 12]} />
              <meshStandardMaterial color="#1f8cff" roughness={0.35} />
            </mesh>
          ))
        : null}
      <group position={sampled.position}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.18, 0.38, 4]} />
          <meshStandardMaterial color="#222a35" roughness={0.7} />
        </mesh>
        <Line points={[[0, 0, 0] as Vec3, aimVector]} color="#24b47e" lineWidth={1.6} />
      </group>
    </>
  )
}
