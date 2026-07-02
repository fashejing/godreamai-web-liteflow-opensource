import { Clock } from 'lucide-react'
import {
  getActiveCamera,
  getFixedShotSegments,
  getTimelineDuration,
  getTimelineMode,
  sortKeyframes,
} from '../scene/camera'
import type { SceneDocument } from '../scene/types'

type TimelineProps = {
  scene: SceneDocument
  playing: boolean
  selectedKeyframeId: string | null
  onTimeChange: (timeSec: number) => void
  onKeyframeSelect: (timeSec: number) => void
  onSelectKeyframe: (keyframeId: string) => void
}

export const Timeline = ({
  scene,
  playing,
  selectedKeyframeId,
  onTimeChange,
  onKeyframeSelect,
  onSelectKeyframe,
}: TimelineProps) => {
  const timelineMode = getTimelineMode(scene)
  const duration = getTimelineDuration(scene)
  const current = scene.timeline.currentTimeSec
  const keyframes = sortKeyframes(getActiveCamera(scene)?.keyframes ?? [])
  const fixedShotSegments = getFixedShotSegments(scene)
  const playheadLeft = `${Math.min(100, (current / duration) * 100)}%`

  return (
    <footer className="timeline-panel" aria-label="镜头时间线">
      <div className="timeline-header">
        <div className="timeline-title">
          <Clock size={15} />
          <span>{timelineMode === 'shots' ? '固定机位' : '运镜轨迹'}</span>
          <strong>{playing ? '播放中' : '暂停'}</strong>
        </div>
        <div className="timeline-meta">
          <span>时长 {duration}s</span>
          <span>{scene.renderSettings.fps} FPS</span>
          <span>{scene.renderSettings.width}x{scene.renderSettings.height}</span>
        </div>
      </div>

      <div className="timeline-track">
        <div className="timeline-ruler">
          {Array.from({ length: 11 }).map((_, index) => (
            <span key={index} style={{ left: `${index * 10}%` }}>
              {Math.round((duration / 10) * index)}s
            </span>
          ))}
        </div>
        <input
          className="timeline-range"
          type="range"
          min={0}
          max={duration}
          step={1 / scene.renderSettings.fps}
          value={current}
          onChange={(event) => onTimeChange(Number(event.target.value))}
        />
        <div className="keyframe-layer">
          {timelineMode === 'shots'
            ? fixedShotSegments.map((segment) => (
                <button
                  key={`block-${segment.keyframe.id}`}
                  type="button"
                  className={`shot-duration-block ${
                    segment.keyframe.id === selectedKeyframeId ? 'is-selected' : ''
                  }`}
                  style={{
                    left: `${(segment.startSec / duration) * 100}%`,
                    width: `${(segment.durationSec / duration) * 100}%`,
                  }}
                  title={`固定镜头 ${segment.index + 1}: ${segment.durationSec.toFixed(1)}s`}
                  onClick={() => {
                    onSelectKeyframe(segment.keyframe.id)
                    onKeyframeSelect(segment.startSec)
                  }}
                >
                  <span>{segment.index + 1}</span>
                </button>
              ))
            : null}
          {timelineMode === 'motion'
            ? keyframes.map((keyframe) => (
                <button
                  key={keyframe.id}
                  type="button"
                  className={`keyframe-dot ${
                    keyframe.id === selectedKeyframeId ? 'is-selected' : ''
                  }`}
                  style={{
                    left: `${Math.min(100, (keyframe.timeSec / duration) * 100)}%`,
                  }}
                  title={`镜头点 ${keyframe.timeSec.toFixed(2)}s`}
                  onClick={() => {
                    onSelectKeyframe(keyframe.id)
                    onKeyframeSelect(keyframe.timeSec)
                  }}
                />
              ))
            : fixedShotSegments.map((segment) => (
                <button
                  key={`dot-${segment.keyframe.id}`}
                  type="button"
                  className={`keyframe-dot ${
                    segment.keyframe.id === selectedKeyframeId ? 'is-selected' : ''
                  }`}
                  style={{
                    left: `${Math.min(100, (segment.startSec / duration) * 100)}%`,
                  }}
                  title={`固定镜头 ${segment.index + 1}`}
                  onClick={() => {
                    onSelectKeyframe(segment.keyframe.id)
                    onKeyframeSelect(segment.startSec)
                  }}
                />
              ))}
          <span className="playhead" style={{ left: playheadLeft }} />
        </div>
      </div>
    </footer>
  )
}
