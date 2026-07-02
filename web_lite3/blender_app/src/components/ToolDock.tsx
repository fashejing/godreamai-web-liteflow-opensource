import {
  Camera,
  Copy,
  Eye,
  Gauge,
  Maximize2,
  MousePointer2,
  Move,
  Pause,
  Play,
  Route,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { cinematicMovePresets } from '../scene/cameraPresets'
import type { TimelineMode } from '../scene/types'
import type { TransformMode } from './SceneViewport'

type ToolDockProps = {
  transformMode: TransformMode
  timelineMode: TimelineMode
  cameraView: boolean
  snapToGrid: boolean
  playing: boolean
  hasSelection: boolean
  hasObjects: boolean
  canSmoothCamera: boolean
  onTransformModeChange: (mode: TransformMode) => void
  onSetTimelineMode: (mode: TimelineMode) => void
  onToggleCameraView: () => void
  onToggleSnap: () => void
  onTogglePlay: () => void
  onAddKeyframe: () => void
  onSmoothCameraRate: () => void
  onSmoothCameraPath: () => void
  onApplyCinematicPreset: (presetId: string) => void
  onClearCameraPath: () => void
  onDuplicateSelected: () => void
  onDeleteSelected: () => void
  onClearSceneObjects: () => void
  onAlignAllObjectsToGround: () => void
}

export const ToolDock = ({
  transformMode,
  timelineMode,
  cameraView,
  snapToGrid,
  playing,
  hasSelection,
  hasObjects,
  canSmoothCamera,
  onTransformModeChange,
  onSetTimelineMode,
  onToggleCameraView,
  onToggleSnap,
  onTogglePlay,
  onAddKeyframe,
  onSmoothCameraRate,
  onSmoothCameraPath,
  onApplyCinematicPreset,
  onClearCameraPath,
  onDuplicateSelected,
  onDeleteSelected,
  onClearSceneObjects,
  onAlignAllObjectsToGround,
}: ToolDockProps) => (
  <section className="tool-dock" aria-label="常用工具">
    <div className="tool-dock-section tool-dock-section-layout">
      <div className="tool-dock-section-title">变换</div>
      <div className="tool-dock-group">
        <button
          type="button"
          className={`dock-button ${transformMode === 'translate' ? 'active' : ''}`}
          onClick={() => onTransformModeChange('translate')}
        >
          <Move size={15} />
          移动
        </button>
        <button
          type="button"
          className={`dock-button ${transformMode === 'rotate' ? 'active' : ''}`}
          onClick={() => onTransformModeChange('rotate')}
        >
          <RotateCcw size={15} />
          旋转
        </button>
        <button
          type="button"
          className={`dock-button ${transformMode === 'scale' ? 'active' : ''}`}
          onClick={() => onTransformModeChange('scale')}
        >
          <Maximize2 size={15} />
          缩放
        </button>
        <button
          type="button"
          className={`dock-button ${snapToGrid ? 'active' : ''}`}
          onClick={onToggleSnap}
        >
          <MousePointer2 size={15} />
          网格吸附
        </button>
      </div>
    </div>

    <div className="tool-dock-section tool-dock-section-camera">
      <div className="tool-dock-section-title">运镜</div>
      <div className="dock-segmented" aria-label="镜头模式">
        <button
          type="button"
          className={timelineMode === 'motion' ? 'active' : ''}
          onClick={() => onSetTimelineMode('motion')}
        >
          轨迹
        </button>
        <button
          type="button"
          className={timelineMode === 'shots' ? 'active' : ''}
          onClick={() => onSetTimelineMode('shots')}
        >
          固定
        </button>
      </div>
      <div className="tool-dock-group">
        <button
          type="button"
          className={`dock-button ${playing ? 'active' : ''}`}
          onClick={onTogglePlay}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          className={`dock-button ${cameraView ? 'active' : ''}`}
          onClick={onToggleCameraView}
        >
          <Eye size={15} />
          镜头预览
        </button>
        <button type="button" className="dock-button accent-camera" onClick={onAddKeyframe}>
          <Camera size={15} />
          添加镜头点
        </button>
        <button
          type="button"
          className="dock-button accent-rate"
          onClick={onSmoothCameraRate}
          disabled={timelineMode === 'shots' || !canSmoothCamera}
        >
          <Gauge size={15} />
          速率平滑
        </button>
        <button
          type="button"
          className="dock-button accent-path"
          onClick={onSmoothCameraPath}
          disabled={timelineMode === 'shots' || !canSmoothCamera}
        >
          <Route size={15} />
          轨道平滑
        </button>
        <button type="button" className="dock-button danger" onClick={onClearCameraPath}>
          <Trash2 size={15} />
          清空轨迹
        </button>
      </div>
      <label className="dock-select-field">
        <span>电影方案</span>
        <select
          value=""
          onChange={(event) => {
            if (event.target.value) {
              onApplyCinematicPreset(event.target.value)
            }
          }}
        >
          <option value="">选择连续运镜</option>
          {cinematicMovePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
    </div>

    <div className="tool-dock-section tool-dock-section-objects">
      <div className="tool-dock-section-title">对象</div>
      <div className="tool-dock-group">
        <button
          type="button"
          className="dock-button"
          onClick={onDuplicateSelected}
          disabled={!hasSelection}
        >
          <Copy size={15} />
          复制
        </button>
        <button
          type="button"
          className="dock-button danger"
          onClick={onDeleteSelected}
          disabled={!hasSelection}
        >
          <Trash2 size={15} />
          删除
        </button>
        <button
          type="button"
          className="dock-button danger"
          onClick={onClearSceneObjects}
          disabled={!hasObjects}
        >
          <Trash2 size={15} />
          清空白模
        </button>
        <button
          type="button"
          className="dock-button"
          onClick={onAlignAllObjectsToGround}
          disabled={!hasObjects}
        >
          <Move size={15} />
          全体同高
        </button>
      </div>
    </div>
  </section>
)
