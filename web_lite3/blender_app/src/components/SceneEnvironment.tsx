import { Grid } from '@react-three/drei'
import {
  INFINITE_GRID_CELL_SIZE,
  INFINITE_GRID_CELL_THICKNESS,
  INFINITE_GRID_FADE_DISTANCE,
  INFINITE_GRID_FADE_STRENGTH,
  INFINITE_GRID_SECTION_SIZE,
  INFINITE_GRID_SECTION_THICKNESS,
  VISUAL_GROUND_SIZE,
} from '../scene/environment'
import type { RenderSettings } from '../scene/types'
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
}

export const SceneEnvironment = ({
  renderSettings,
  colors,
  uiTheme,
  showFloor,
}: SceneEnvironmentProps) => (
  <>
    {showFloor && !renderSettings.hideGrid ? (
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
        position={[0, 0.006, 0]}
      />
    ) : null}
    {showFloor ? (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]} receiveShadow>
        <planeGeometry args={[VISUAL_GROUND_SIZE, VISUAL_GROUND_SIZE]} />
        {renderSettings.fillWhiteGround ? (
          <meshStandardMaterial color="#ffffff" roughness={0.82} metalness={0} />
        ) : (
          <meshStandardMaterial
            color={uiTheme === 'dark' ? '#1d2229' : '#edf0f4'}
            roughness={0.9}
            metalness={0}
          />
        )}
      </mesh>
    ) : null}
  </>
)
