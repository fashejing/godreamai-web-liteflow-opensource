import { Clock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  constrainCameraKeyframeTime,
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
  onKeyframeTimeChange: (keyframeId: string, timeSec: number) => void
}

type KeyframeDragState = {
  keyframeId: string
  pointerId: number
  timeSec: number
}

export const Timeline = ({
  scene,
  playing,
  selectedKeyframeId,
  onTimeChange,
  onKeyframeSelect,
  onSelectKeyframe,
  onKeyframeTimeChange,
}: TimelineProps) => {
  const timelineMode = getTimelineMode(scene)
  const duration = getTimelineDuration(scene)
  const current = scene.timeline.currentTimeSec
  const activeCameraKeyframes = getActiveCamera(scene)?.keyframes
  const keyframes = useMemo(
    () => sortKeyframes(activeCameraKeyframes ?? []),
    [activeCameraKeyframes],
  )
  const fixedShotSegments = getFixedShotSegments(scene)
  const playheadLeft = `${Math.min(100, (current / duration) * 100)}%`
  const keyframeLayerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<KeyframeDragState | null>(null)
  const dragMovedRef = useRef(false)
  const [dragState, setDragState] = useState<KeyframeDragState | null>(null)

  const setActiveDrag = useCallback((next: KeyframeDragState | null) => {
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const resolveDraggedTime = useCallback((
    clientX: number,
    keyframeId: string,
  ): number | null => {
    const track = keyframeLayerRef.current

    if (!track) {
      return null
    }

    const bounds = track.getBoundingClientRect()
    const progress = (clientX - bounds.left) / Math.max(1, bounds.width)

    return constrainCameraKeyframeTime(
      keyframes,
      keyframeId,
      progress * duration,
      duration,
      scene.renderSettings.fps,
    )
  }, [duration, keyframes, scene.renderSettings.fps])

  useEffect(() => {
    const activeDrag = dragStateRef.current
    if (!activeDrag) {
      return undefined
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentDrag = dragStateRef.current
      if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()
      const nextTime = resolveDraggedTime(event.clientX, currentDrag.keyframeId)
      if (nextTime === null) {
        return
      }

      const sourceKeyframe = keyframes.find(
        (keyframe) => keyframe.id === currentDrag.keyframeId,
      )
      if (
        sourceKeyframe &&
        Math.abs(nextTime - sourceKeyframe.timeSec) >= 1 / scene.renderSettings.fps
      ) {
        dragMovedRef.current = true
      }
      setActiveDrag({ ...currentDrag, timeSec: nextTime })
    }

    const handlePointerUp = (event: PointerEvent) => {
      const currentDrag = dragStateRef.current
      if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
        return
      }

      const nextTime = resolveDraggedTime(
        event.clientX,
        currentDrag.keyframeId,
      ) ?? currentDrag.timeSec
      onKeyframeTimeChange(currentDrag.keyframeId, nextTime)
      setActiveDrag(null)
    }

    const cancelDrag = () => setActiveDrag(null)

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', cancelDrag)
    window.addEventListener('blur', cancelDrag)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', cancelDrag)
      window.removeEventListener('blur', cancelDrag)
    }
  }, [
    dragState?.keyframeId,
    dragState?.pointerId,
    duration,
    keyframes,
    onKeyframeTimeChange,
    resolveDraggedTime,
    scene.renderSettings.fps,
    setActiveDrag,
  ])

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
        <div ref={keyframeLayerRef} className="keyframe-layer">
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
            ? keyframes.map((keyframe, index) => {
                const draggable = index > 0
                const displayedTime = dragState?.keyframeId === keyframe.id
                  ? dragState.timeSec
                  : keyframe.timeSec

                return (
                  <button
                    key={keyframe.id}
                    type="button"
                    className={`keyframe-dot ${
                      keyframe.id === selectedKeyframeId ? 'is-selected' : ''
                    } ${draggable ? 'is-draggable' : 'is-locked'} ${
                      dragState?.keyframeId === keyframe.id ? 'is-dragging' : ''
                    }`}
                    style={{
                      left: `${Math.min(100, (displayedTime / duration) * 100)}%`,
                    }}
                    aria-label={
                      draggable
                        ? `镜头点 ${displayedTime.toFixed(2)} 秒，拖动调整上一段运镜时长`
                        : `镜头起点 ${displayedTime.toFixed(2)} 秒，位置固定`
                    }
                    title={
                      draggable
                        ? `拖动调整镜头时长：${displayedTime.toFixed(2)}s`
                        : `镜头起点 ${displayedTime.toFixed(2)}s（固定）`
                    }
                    onPointerDown={draggable ? (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      dragMovedRef.current = false
                      setActiveDrag({
                        keyframeId: keyframe.id,
                        pointerId: event.pointerId,
                        timeSec: keyframe.timeSec,
                      })
                      onSelectKeyframe(keyframe.id)
                    } : undefined}
                    onClick={() => {
                      if (dragMovedRef.current) {
                        dragMovedRef.current = false
                        return
                      }
                      onSelectKeyframe(keyframe.id)
                      onKeyframeSelect(keyframe.timeSec)
                    }}
                  />
                )
              })
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
          {dragState ? (
            <span
              className="keyframe-drag-time"
              style={{ left: `${Math.min(100, (dragState.timeSec / duration) * 100)}%` }}
              role="status"
            >
              {dragState.timeSec.toFixed(2)}s
            </span>
          ) : null}
          <span className="playhead" style={{ left: playheadLeft }} />
        </div>
      </div>
    </footer>
  )
}
