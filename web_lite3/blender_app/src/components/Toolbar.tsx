import {
  Box,
  Camera,
  Clapperboard,
  Download,
  Expand,
  FileUp,
  Lamp,
  Layers,
  Monitor,
  Moon,
  Palette,
  Pause,
  Play,
  Route,
  RotateCcw,
  Sun,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { TimelineMode } from '../scene/types'

export type UiTheme = 'dark' | 'light'

type ViewportVisibility = {
  lights: boolean
  cameraPath: boolean
  objectPaths: boolean
  floor: boolean
  greenScreen: boolean
}

type ViewportToolbarProps = {
  currentTimeSec: number
  cameraView: boolean
  timelineMode: TimelineMode
  visibility: ViewportVisibility
  cameraSegmentColors: boolean
  monitorEnabled: boolean
  captureBusy: boolean
  playing: boolean
  onToggleVisibility: (key: keyof ViewportVisibility) => void
  onToggleCameraSegmentColors: () => void
  onToggleMonitor: () => void
  onCaptureStill: () => void
  onResetView: () => void
  onToggleFullscreen: () => void
  onTogglePlay: () => void
}

type ToolbarProps = {
  panelTheme: UiTheme
  spaceTheme: UiTheme
  canUndo: boolean
  viewportControls?: ViewportToolbarProps
  onUndo: () => void
  onSaveLocalDocument: () => void
  onRequestLoadLocalDocument: () => void
  onTogglePanelTheme: () => void
  onToggleSpaceTheme: () => void
}

const visibilityControls: Array<{
  key: keyof ViewportVisibility
  label: string
  icon: LucideIcon
}> = [
  { key: 'lights', label: '光源', icon: Lamp },
  { key: 'cameraPath', label: '镜头轨迹', icon: Clapperboard },
  { key: 'objectPaths', label: '白模轨迹', icon: Route },
  { key: 'floor', label: '地板', icon: Layers },
  { key: 'greenScreen', label: '绿幕', icon: Box },
]

const ViewportToolbarControls = ({
  currentTimeSec,
  cameraView,
  timelineMode,
  visibility,
  cameraSegmentColors,
  monitorEnabled,
  captureBusy,
  playing,
  onToggleVisibility,
  onToggleCameraSegmentColors,
  onToggleMonitor,
  onCaptureStill,
  onResetView,
  onToggleFullscreen,
  onTogglePlay,
}: ViewportToolbarProps) => (
  <div className="viewport-toolbar-controls" aria-label="虚拟拍摄快捷工具">
    <button
      type="button"
      className={`tool-button ${monitorEnabled ? 'active' : ''}`}
      title={monitorEnabled ? '隐藏机位监视器' : '显示机位监视器'}
      aria-pressed={monitorEnabled}
      onClick={onToggleMonitor}
    >
      <Monitor size={15} />
      <span>监视器</span>
    </button>
    <button
      type="button"
      className="tool-button"
      title="按当前机位画幅截图并保存到素材库"
      disabled={captureBusy}
      onClick={onCaptureStill}
    >
      <Camera size={15} />
      <span>截图</span>
    </button>
    {visibilityControls.map((control) => {
      const Icon = control.icon
      const active = visibility[control.key]

      return (
        <button
          key={control.key}
          type="button"
          className={`tool-button ${active ? 'active' : ''}`}
          title={`${active ? '隐藏' : '显示'}${control.label}`}
          aria-pressed={active}
          onClick={() => onToggleVisibility(control.key)}
        >
          <Icon size={15} />
          <span>{control.label}</span>
        </button>
      )
    })}
    <button
      type="button"
      className={`tool-button ${cameraSegmentColors ? 'active' : ''}`}
      title={cameraSegmentColors ? '恢复统一绿色轨迹' : '用颜色区分每段轨迹'}
      aria-pressed={cameraSegmentColors}
      disabled={timelineMode !== 'motion' || !visibility.cameraPath}
      onClick={onToggleCameraSegmentColors}
    >
      <Palette size={15} />
      <span>分段颜色</span>
    </button>
    <button
      type="button"
      className="tool-button"
      title={cameraView ? '最终镜头模式下不可重置编辑视角' : '重置到包含全部物件的视图'}
      disabled={cameraView}
      onClick={onResetView}
    >
      <RotateCcw size={15} />
      <span>重置视图</span>
    </button>
    <button type="button" className="tool-button" onClick={onToggleFullscreen}>
      <Expand size={15} />
      <span>全屏播放</span>
    </button>
    <button type="button" className="tool-button" onClick={onTogglePlay}>
      {playing ? <Pause size={15} /> : <Play size={15} />}
      <span>{playing ? '暂停' : '播放'}</span>
    </button>
    <div className="viewport-toolbar-readout">
      {cameraView ? '最终镜头' : '编辑视角'} / {currentTimeSec.toFixed(2)}s
    </div>
  </div>
)

export const Toolbar = ({
  panelTheme,
  spaceTheme,
  canUndo,
  viewportControls,
  onUndo,
  onSaveLocalDocument,
  onRequestLoadLocalDocument,
  onTogglePanelTheme,
  onToggleSpaceTheme,
}: ToolbarProps) => {
  return (
    <header className="top-toolbar">
      <div className="brand-block">
        <div>
          <h1><strong>井鸽</strong>AI视觉专业套件</h1>
          <span>白模虚拟拍摄</span>
        </div>
      </div>
      {viewportControls ? <ViewportToolbarControls {...viewportControls} /> : null}
      <div className="top-toolbar-actions">
        <button
          type="button"
          className="tool-button"
          title="回退上一步工程操作"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <Undo2 size={16} />
          <span>回退</span>
        </button>
        <button
          type="button"
          className="tool-button"
          title="保存当前工程到本地 JSON 文件"
          onClick={onSaveLocalDocument}
        >
          <Download size={16} />
          <span>保存本地</span>
        </button>
        <button
          type="button"
          className="tool-button"
          title="从本地 JSON 文件载入工程"
          onClick={onRequestLoadLocalDocument}
        >
          <FileUp size={16} />
          <span>载入文件</span>
        </button>
        <button
          type="button"
          className="tool-button"
          title={panelTheme === 'dark' ? '切换白色操作面板' : '切换黑色操作面板'}
          onClick={onTogglePanelTheme}
        >
          {panelTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span>{panelTheme === 'dark' ? '面板白' : '面板黑'}</span>
        </button>
        <button
          type="button"
          className="tool-button"
          title={spaceTheme === 'dark' ? '切换白色 3D 空间' : '切换黑色 3D 空间'}
          onClick={onToggleSpaceTheme}
        >
          {spaceTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span>{spaceTheme === 'dark' ? '空间白' : '空间黑'}</span>
        </button>
      </div>
    </header>
  )
}
