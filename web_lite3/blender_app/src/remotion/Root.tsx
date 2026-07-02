import { Composition, type CalculateMetadataFunction } from 'remotion'
import { getFrameCount, getTimelineDuration } from '../scene/camera'
import { createInitialScene } from '../scene/factory'
import { normalizeRenderSettings } from '../scene/validation'
import { ShotComposition, type ShotCompositionProps } from './ShotComposition'

const defaultScene = createInitialScene()

const calculateGoblenderMetadata: CalculateMetadataFunction<
  ShotCompositionProps
> = async ({ props }) => {
  const renderSettings = normalizeRenderSettings(props.renderSettings)
  const durationSec = getTimelineDuration({
    ...props,
    renderSettings,
  })

  return {
    durationInFrames: getFrameCount(
      durationSec,
      renderSettings.fps,
    ),
    fps: renderSettings.fps,
    width: renderSettings.width,
    height: renderSettings.height,
    defaultCodec: 'h264',
    defaultOutName: 'goblender-shot',
    props: {
      ...props,
      renderSettings: {
        ...renderSettings,
        durationSec,
      },
    },
  }
}

export const RemotionRoot = () => (
  <Composition
    id="GoblenderShot"
    component={ShotComposition}
    durationInFrames={getFrameCount(
      defaultScene.renderSettings.durationSec,
      defaultScene.renderSettings.fps,
    )}
    fps={defaultScene.renderSettings.fps}
    width={defaultScene.renderSettings.width}
    height={defaultScene.renderSettings.height}
    defaultProps={defaultScene}
    calculateMetadata={calculateGoblenderMetadata}
  />
)
