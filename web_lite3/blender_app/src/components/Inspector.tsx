import {
  Camera,
  ChevronDown,
  Crosshair,
  Download,
  Gauge,
  GripVertical,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  Magnet,
  Monitor,
  Palette,
  Plus,
  Route,
  Trash2,
  Unlink,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import {
  getActiveCamera,
  getCameraSegments,
  getFixedShotSegments,
  getShotDuration,
  getTimelineDuration,
  getTimelineMode,
  sortKeyframes,
} from '../scene/camera'
import {
  normalizeObjectMotion,
  objectMotionModeLabels,
  objectMotionPresets,
  reverseObjectMotion,
  reverseObjectMotionFacing,
} from '../scene/objectMotion'
import { speedCurveOptions } from '../scene/speedCurves'
import type {
  CameraMotionMode,
  CameraMotionSettings,
  CameraCurveType,
  FloorMaterial,
  ObjectMotion,
  ObjectMotionMode,
  RenderJob,
  RenderSettings,
  SceneDocument,
  SceneLight,
  SceneObject,
  ShotCapture,
  SpeedCurveType,
  Transform,
  Vec3,
  VirtualProductionSettings,
} from '../scene/types'

type InspectorProps = {
  scene: SceneDocument
  selectedObject: SceneObject | null
  selectedKeyframeId: string | null
  renderJob: RenderJob | null
  virtualProduction: VirtualProductionSettings
  shotCaptures: ShotCapture[]
  captureBusy: boolean
  onUpdateObjectTransform: (objectId: string, transform: Transform) => void
  onUpdateObjectColor: (objectId: string, color: string) => void
  onUpdateObjectMotion: (objectId: string, motion: ObjectMotion) => void
  onImportGreenScreenTexture: (objectId: string, file: File) => void
  onClearGreenScreenTexture: (objectId: string) => void
  onToggleVirtualMonitor: () => void
  onTogglePanoramaBackground: () => void
  onImportPanoramaBackground: (file: File) => void
  onClearPanoramaBackground: () => void
  onCaptureStill: () => void
  onDeleteShotCapture: (shotId: string) => void
  onDownloadShotCapture: (shotId: string) => void
  selectedObjectBaseY: number | null
  selectedObjectTopY: number | null
  placementSnap: boolean
  onTogglePlacementSnap: () => void
  onGroundSelectedObject: () => void
  onAddLight: () => void
  onUpdateLight: (lightId: string, patch: Partial<SceneLight>) => void
  onDeleteLight: (lightId: string) => void
  onSelectKeyframe: (keyframeId: string) => void
  onDeleteKeyframe: (keyframeId: string) => void
  onReorderKeyframe: (draggedKeyframeId: string, targetKeyframeId: string) => void
  onToggleSegmentConnection: (fromKeyframeId: string) => void
  onMoveKeyframePosition: (keyframeId: string, position: Vec3) => void
  onMoveKeyframeTarget: (keyframeId: string, target: Vec3) => void
  onToggleAimAnchor: () => void
  onToggleAimAnchorSnap: () => void
  onSetAimAnchorToSelectedObject: () => void
  onSetAimAnchorToCurrentTarget: () => void
  onMoveCurveControl: (fromKeyframeId: string, controlPoint: Vec3) => void
  onUpdateSegmentSpeed: (fromKeyframeId: string, speedToNext: number) => void
  onUpdateSegmentSpeedCurve: (
    fromKeyframeId: string,
    speedCurveToNext: SpeedCurveType,
  ) => void
  onUpdateSegmentCurve: (fromKeyframeId: string, curveToNext: CameraCurveType) => void
  onUpdateSegmentCurveStrength: (
    fromKeyframeId: string,
    curveStrengthToNext: number,
  ) => void
  onUpdateKeyframeShotDuration: (keyframeId: string, durationSec: number) => void
  onUpdateCameraMotion: (settings: CameraMotionSettings) => void
  onUpdateRenderSettings: (settings: RenderSettings) => void
  onExportVideo: () => void
}

const axisLabels = ['X', 'Y', 'Z'] as const

type AxisRange = {
  label: string
  min: number
  max: number
  step: number
}

const curveOptions: Array<{ value: CameraCurveType; label: string }> = [
  { value: 'linear', label: '直线' },
  { value: 'smooth', label: '平滑弧线' },
  { value: 'arc-left', label: '向左绕' },
  { value: 'arc-right', label: '向右绕' },
  { value: 'crane-up', label: '摇臂上升' },
  { value: 'crane-down', label: '摇臂下降' },
  { value: 'custom', label: '自定义' },
]

const cameraMotionModeOptions: Array<{ value: CameraMotionMode; label: string }> = [
  { value: 'stable', label: '稳定拍摄' },
  { value: 'handheld', label: '手持模式' },
  { value: 'drone', label: '无人机模式' },
]

const floorMaterialOptions: Array<{ value: FloorMaterial; label: string }> = [
  { value: 'studio', label: '影棚灰' },
  { value: 'white', label: '纯白' },
  { value: 'checker', label: '棋盘格' },
  { value: 'concrete', label: '混凝土' },
  { value: 'sand', label: '沙地' },
  { value: 'grass', label: '草地' },
  { value: 'asphalt', label: '沥青' },
]

const positionRanges: [AxisRange, AxisRange, AxisRange] = [
  { label: '左右', min: -10, max: 10, step: 0.05 },
  { label: '高度', min: -1, max: 8, step: 0.05 },
  { label: '前后', min: -10, max: 10, step: 0.05 },
]

const scaleRanges: [AxisRange, AxisRange, AxisRange] = [
  { label: '宽', min: 0.1, max: 3, step: 0.02 },
  { label: '高', min: 0.1, max: 3, step: 0.02 },
  { label: '深', min: 0.1, max: 3, step: 0.02 },
]

const rotationRanges: [AxisRange, AxisRange, AxisRange] = [
  { label: '俯仰', min: -180, max: 180, step: 1 },
  { label: '朝向', min: -180, max: 180, step: 1 },
  { label: '滚转', min: -180, max: 180, step: 1 },
]

const lightKindLabels: Record<SceneLight['kind'], string> = {
  ambient: '环境光',
  directional: '方向光',
  point: '点光',
  spot: '聚光',
}

const whiteboxSwatches = [
  '#ffffff',
  '#1e9bff',
  '#00d26a',
  '#ffe500',
  '#ff5c35',
  '#c026ff',
  '#8b98a8',
  '#050505',
]

const formatValue = (value: number): string => Number(value.toFixed(2)).toString()

const radiansToDegrees = (radians: number): number => {
  const degrees = (radians * 180) / Math.PI
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180

  return Number(normalized.toFixed(1))
}

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180

const axisBounds = (value: number, range: AxisRange): { min: number; max: number } => ({
  min: Math.min(range.min, Math.floor(value) - 1),
  max: Math.max(range.max, Math.ceil(value) + 1),
})

const updateTransformAxis = (
  transform: Transform,
  key: keyof Transform,
  axisIndex: number,
  value: number,
): Transform => {
  const next = {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  } as Transform

  next[key][axisIndex] = value
  return next
}

const VectorSliderGroup = ({
  label,
  values,
  ranges,
  onChange,
}: {
  label: string
  values: [number, number, number]
  ranges: [AxisRange, AxisRange, AxisRange]
  onChange: (axisIndex: number, value: number) => void
}) => (
  <div className="vector-slider-group">
    <div className="vector-title">{label}</div>
    <div className="vector-slider-list">
      {values.map((value, axisIndex) => {
        const range = ranges[axisIndex]
        const bounds = axisBounds(value, range)

        return (
          <label key={axisLabels[axisIndex]} className="vector-axis-slider">
            <span>
              {axisLabels[axisIndex]} · {range.label}
            </span>
            <input
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={range.step}
              value={value}
              onChange={(event) => onChange(axisIndex, Number(event.target.value))}
            />
            <strong>{formatValue(value)}</strong>
          </label>
        )
      })}
    </div>
  </div>
)

const ColorControl = ({
  color,
  onChange,
}: {
  color: string
  onChange: (color: string) => void
}) => (
  <div className="color-control">
    <div className="vector-title">
      <Palette size={13} />
      白模颜色
    </div>
    <div className="swatch-row">
      {whiteboxSwatches.map((swatch) => (
        <button
          key={swatch}
          type="button"
          className={`color-swatch ${color.toLowerCase() === swatch ? 'is-selected' : ''}`}
          style={{ backgroundColor: swatch }}
          aria-label={`选择颜色 ${swatch}`}
          onClick={() => onChange(swatch)}
        />
      ))}
      <label className="color-picker">
        <input
          type="color"
          value={color}
          onChange={(event) => onChange(event.target.value)}
        />
        自定义
      </label>
    </div>
  </div>
)

const GreenScreenTextureControl = ({
  textureName,
  onImportTexture,
  onClearTexture,
}: {
  textureName?: string
  onImportTexture: (file: File) => void
  onClearTexture: () => void
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="texture-control">
      <div className="vector-title">
        <ImageIcon size={13} />
        绿幕贴图
      </div>
      <div className="texture-actions">
        <button
          type="button"
          className="texture-button"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={13} />
          上传贴图
        </button>
        <button
          type="button"
          className="texture-button"
          disabled={!textureName}
          onClick={onClearTexture}
        >
          <X size={13} />
          清除
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''

            if (file) {
              onImportTexture(file)
            }
          }}
        />
      </div>
      <div className="texture-readout">
        {textureName ? textureName : '默认绿幕'}
      </div>
    </div>
  )
}

const CompactRange = ({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) => (
  <label className="range-field">
    <span>{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
    <strong>
      {formatValue(value)}
      {suffix}
    </strong>
  </label>
)

const CollapsibleSection = ({
  title,
  children,
  action,
  defaultOpen = true,
  className = '',
}: {
  title: string
  children: ReactNode
  action?: ReactNode
  defaultOpen?: boolean
  className?: string
}) => {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={`inspector-section collapsible-section ${className}`}>
      <div className="section-title section-title-row collapsible-title">
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={14} />
          <span>{title}</span>
        </button>
        {action}
      </div>
      {open ? children : null}
    </section>
  )
}

const ObjectMotionControl = ({
  motion,
  onChange,
}: {
  motion?: ObjectMotion
  onChange: (motion: ObjectMotion) => void
}) => {
  const normalized = normalizeObjectMotion(motion)
  const updateMotion = (patch: Partial<ObjectMotion>) =>
    onChange(normalizeObjectMotion({ ...normalized, ...patch }))
  const motionEnabled = normalized.enabled && normalized.mode !== 'none'
  const usesSideAmplitude = ['lane_change', 'weave', 'pursuit', 'bank_turn'].includes(
    normalized.mode,
  )
  const usesHeight = ['orbit', 'takeoff', 'hover', 'bank_turn', 'jump'].includes(
    normalized.mode,
  )
  const usesLoops = ['pingpong', 'orbit', 'hover', 'weave', 'bank_turn'].includes(
    normalized.mode,
  )

  return (
    <div className="motion-control">
      <div className="vector-title">
        <Route size={13} />
        物体运动
      </div>
      <label className="motion-select-field">
        <span>常用轨迹</span>
        <select
          className="motion-preset-select"
          defaultValue=""
          onChange={(event) => {
            const preset = objectMotionPresets.find(
              (candidate) => candidate.id === event.target.value,
            )
            event.currentTarget.value = ''
            if (preset) {
              onChange(normalizeObjectMotion({ ...preset.motion }))
            }
          }}
        >
          <option value="">套用预设</option>
          {objectMotionPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label className="motion-select-field">
        <span>运动类型</span>
        <select
          className="motion-mode-select"
          value={normalized.mode}
          onChange={(event) => {
            const mode = event.target.value as ObjectMotionMode
            updateMotion({
              enabled: mode !== 'none',
              mode,
            })
          }}
        >
          {Object.entries(objectMotionModeLabels).map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {motionEnabled ? (
        <>
          <div className="motion-actions">
            <button type="button" onClick={() => onChange(reverseObjectMotion(normalized))}>
              一键反向运动
            </button>
            <button
              type="button"
              onClick={() => onChange(reverseObjectMotionFacing(normalized))}
            >
              对准反向
            </button>
          </div>
          <CompactRange
            label="开始"
            value={normalized.startSec}
            min={0}
            max={30}
            step={0.1}
            suffix="s"
            onChange={(startSec) => updateMotion({ startSec })}
          />
          <CompactRange
            label="时长"
            value={normalized.durationSec}
            min={0.5}
            max={30}
            step={0.1}
            suffix="s"
            onChange={(durationSec) => updateMotion({ durationSec })}
          />
          <label className="motion-select-field">
            <span>速率曲线</span>
            <select
              value={normalized.speedCurve}
              onChange={(event) =>
                updateMotion({ speedCurve: event.target.value as SpeedCurveType })
              }
            >
              {speedCurveOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {normalized.mode !== 'orbit' ? (
            <>
              <CompactRange
                label="轨迹方向"
                value={normalized.directionDeg}
                min={-180}
                max={180}
                step={1}
                suffix="°"
                onChange={(directionDeg) => updateMotion({ directionDeg })}
              />
              <CompactRange
                label="距离"
                value={normalized.distance}
                min={0}
                max={20}
                step={0.1}
                onChange={(distance) => updateMotion({ distance })}
              />
            </>
          ) : (
            <CompactRange
              label="半径"
              value={normalized.radius}
              min={0.2}
              max={10}
              step={0.1}
              onChange={(radius) => updateMotion({ radius })}
            />
          )}
          {usesSideAmplitude ? (
            <CompactRange
              label="横移"
              value={normalized.radius}
              min={0}
              max={10}
              step={0.1}
              onChange={(radius) => updateMotion({ radius })}
            />
          ) : null}
          {usesHeight ? (
            <CompactRange
              label="高度"
              value={normalized.heightDelta}
              min={-5}
              max={8}
              step={0.1}
              onChange={(heightDelta) => updateMotion({ heightDelta })}
            />
          ) : null}
          {usesLoops ? (
            <CompactRange
              label="循环"
              value={normalized.loops}
              min={0.25}
              max={8}
              step={0.25}
              onChange={(loops) => updateMotion({ loops })}
            />
          ) : null}
          <CompactRange
            label="朝向偏移"
            value={normalized.faceOffsetDeg}
            min={-180}
            max={180}
            step={1}
            suffix="°"
            onChange={(faceOffsetDeg) => updateMotion({ faceOffsetDeg })}
          />
          <label className="motion-checkbox">
            <input
              type="checkbox"
              checked={normalized.autoFace}
              onChange={(event) =>
                updateMotion({ autoFace: event.target.checked })
              }
            />
            自动朝向运动方向
          </label>
        </>
      ) : null}
    </div>
  )
}

export const Inspector = ({
  scene,
  selectedObject,
  selectedKeyframeId,
  renderJob,
  virtualProduction,
  shotCaptures,
  captureBusy,
  onUpdateObjectTransform,
  onUpdateObjectColor,
  onUpdateObjectMotion,
  onImportGreenScreenTexture,
  onClearGreenScreenTexture,
  onToggleVirtualMonitor,
  onTogglePanoramaBackground,
  onImportPanoramaBackground,
  onClearPanoramaBackground,
  onCaptureStill,
  onDeleteShotCapture,
  onDownloadShotCapture,
  selectedObjectBaseY,
  selectedObjectTopY,
  placementSnap,
  onTogglePlacementSnap,
  onGroundSelectedObject,
  onAddLight,
  onUpdateLight,
  onDeleteLight,
  onSelectKeyframe,
  onDeleteKeyframe,
  onReorderKeyframe,
  onToggleSegmentConnection,
  onMoveKeyframePosition,
  onMoveKeyframeTarget,
  onToggleAimAnchor,
  onToggleAimAnchorSnap,
  onSetAimAnchorToSelectedObject,
  onSetAimAnchorToCurrentTarget,
  onMoveCurveControl,
  onUpdateSegmentSpeed,
  onUpdateSegmentSpeedCurve,
  onUpdateSegmentCurve,
  onUpdateSegmentCurveStrength,
  onUpdateKeyframeShotDuration,
  onUpdateCameraMotion,
  onUpdateRenderSettings,
  onExportVideo,
}: InspectorProps) => {
  const activeCamera = getActiveCamera(scene)
  const keyframes = sortKeyframes(activeCamera?.keyframes ?? [])
  const selectedKeyframe =
    keyframes.find((keyframe) => keyframe.id === selectedKeyframeId) ?? null
  const segments = getCameraSegments(scene)
  const selectedSegment =
    segments.find((segment) => segment.from.id === selectedKeyframeId) ?? null
  const fixedShotSegments = getFixedShotSegments(scene)
  const timelineMode = getTimelineMode(scene)
  const timelineDuration = getTimelineDuration(scene)
  const cameraMotion = scene.cameraMotion ?? {
    mode: 'stable' as CameraMotionMode,
    shakeStrength: 0,
  }
  const renderSettings = scene.renderSettings
  const renderBusy = renderJob?.status === 'queued' || renderJob?.status === 'rendering'
  const selectedTransform = selectedObject?.transform
  const selectedRotationDegrees = selectedTransform
    ? (selectedTransform.rotation.map(radiansToDegrees) as Vec3)
    : null
  const selectedIsGreenScreen = selectedObject?.assetId === 'greenscreen-panel'
  const lights = scene.lights ?? []
  const aimAnchor = scene.cameraAimAnchor ?? {
    enabled: false,
    position: [0, 1.3, 0] as Vec3,
    snapEnabled: true,
  }
  const trackedAnchorObject = aimAnchor.targetObjectId
    ? scene.objects.find((object) => object.id === aimAnchor.targetObjectId) ?? null
    : null
  const [draggedKeyframeId, setDraggedKeyframeId] = useState<string | null>(null)
  const [dragOverKeyframeId, setDragOverKeyframeId] = useState<string | null>(null)
  const panoramaInputRef = useRef<HTMLInputElement | null>(null)

  const updateKeyframePositionAxis = (axisIndex: number, value: number) => {
    if (!selectedKeyframe) {
      return
    }

    const position = [...selectedKeyframe.position] as Vec3
    position[axisIndex] = value
    onMoveKeyframePosition(selectedKeyframe.id, position)
  }

  const updateKeyframeTargetAxis = (axisIndex: number, value: number) => {
    if (!selectedKeyframe) {
      return
    }

    const target = [...selectedKeyframe.target] as Vec3
    target[axisIndex] = value
    onMoveKeyframeTarget(selectedKeyframe.id, target)
  }

  const updateCurveControlAxis = (axisIndex: number, value: number) => {
    if (!selectedSegment) {
      return
    }

    const controlPoint = [...selectedSegment.controlPoint] as Vec3
    controlPoint[axisIndex] = value
    onMoveCurveControl(selectedSegment.from.id, controlPoint)
  }

  return (
    <aside className="panel inspector-panel" aria-label="右侧设置面板">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">设置</span>
          <h2>{selectedObject?.name ?? (selectedKeyframe ? '镜头点' : '当前工程')}</h2>
        </div>
      </div>

      <CollapsibleSection title="虚拟拍摄台" className="inspector-section-virtual">
        <div className="virtual-production-actions">
          <button
            type="button"
            className={virtualProduction.monitorEnabled ? 'active' : ''}
            onClick={onToggleVirtualMonitor}
          >
            <Monitor size={13} />
            监视器
          </button>
          <button
            type="button"
            className={virtualProduction.panoramaEnabled ? 'active' : ''}
            disabled={!virtualProduction.panoramaUrl}
            onClick={onTogglePanoramaBackground}
          >
            <ImageIcon size={13} />
            720 背景
          </button>
        </div>
        <input
          ref={panoramaInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) {
              void onImportPanoramaBackground(file)
            }
            event.currentTarget.value = ''
          }}
        />
        <div className="panorama-upload-row">
          <button type="button" className="mini-action" onClick={() => panoramaInputRef.current?.click()}>
            <Upload size={13} />
            上传 720 图
          </button>
          {virtualProduction.panoramaUrl ? (
            <button type="button" className="icon-mini danger" onClick={onClearPanoramaBackground}>
              <X size={13} />
            </button>
          ) : null}
          <span>{virtualProduction.panoramaName ?? '未设置背景'}</span>
        </div>
        <div className="shot-action-row">
          <button
            type="button"
            className="mini-action"
            disabled={captureBusy}
            onClick={onCaptureStill}
          >
            <Camera size={13} />
            截图
          </button>
        </div>
        <div className="shot-library">
          {shotCaptures.length === 0 ? (
            <div className="empty-inspector">当前还没有截图。</div>
          ) : (
            shotCaptures.map((capture) => (
              <article key={capture.id} className="shot-card">
                <img src={capture.url} alt={capture.name} />
                <div className="shot-card-body">
                  <div className="shot-card-title">
                    <strong>{capture.name}</strong>
                    <span>
                      {capture.width}x{capture.height} / {capture.timeSec.toFixed(2)}s
                    </span>
                  </div>
                  <div className="shot-card-actions">
                    <button
                      type="button"
                      className="icon-mini"
                      title="下载截图"
                      onClick={() => onDownloadShotCapture(capture.id)}
                    >
                      <Download size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-mini danger"
                      title="删除截图"
                      onClick={() => onDeleteShotCapture(capture.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {capture.analysis ? (
                    <pre className="shot-analysis">{capture.analysis}</pre>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="选中的白模" className="inspector-section-object">
        {selectedObject && selectedTransform ? (
          <>
          {selectedIsGreenScreen ? (
            <GreenScreenTextureControl
              textureName={selectedObject.metadata?.textureName}
              onImportTexture={(file) =>
                onImportGreenScreenTexture(selectedObject.id, file)
              }
              onClearTexture={() => onClearGreenScreenTexture(selectedObject.id)}
            />
          ) : (
            <ColorControl
              color={selectedObject.material.color}
              onChange={(color) => onUpdateObjectColor(selectedObject.id, color)}
            />
          )}
          <ObjectMotionControl
            motion={selectedObject.motion}
            onChange={(motion) => onUpdateObjectMotion(selectedObject.id, motion)}
          />
          <div className="placement-control">
            <div className="placement-readout">
              <span>底面高度 {selectedObjectBaseY?.toFixed(2) ?? '--'}</span>
              <span>顶面高度 {selectedObjectTopY?.toFixed(2) ?? '--'}</span>
            </div>
            <div className="anchor-actions">
              <button
                type="button"
                className={placementSnap ? 'active' : ''}
                onClick={onTogglePlacementSnap}
              >
                <Magnet size={13} />
                同高磁吸
              </button>
              <button type="button" onClick={onGroundSelectedObject}>
                贴到地面
              </button>
            </div>
          </div>
          {selectedRotationDegrees ? (
            <VectorSliderGroup
              label="朝向（度）"
              values={selectedRotationDegrees}
              ranges={rotationRanges}
              onChange={(axisIndex, value) =>
                onUpdateObjectTransform(
                  selectedObject.id,
                  updateTransformAxis(
                    selectedTransform,
                    'rotation',
                    axisIndex,
                    degreesToRadians(value),
                  ),
                )
              }
            />
          ) : null}
          <VectorSliderGroup
            label="大小微调"
            values={selectedTransform.scale}
            ranges={scaleRanges}
            onChange={(axisIndex, value) =>
              onUpdateObjectTransform(
                selectedObject.id,
                updateTransformAxis(selectedTransform, 'scale', axisIndex, value),
              )
            }
          />
          </>
        ) : (
          <div className="empty-inspector">
            选择一个白模可调整位置；选择蓝色镜头点可编辑位置和朝向。
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={timelineMode === 'shots' ? '固定机位剪辑' : '运镜轨迹'}
        className="inspector-section-camera"
      >
        <div className={`anchor-control ${aimAnchor.enabled ? 'is-enabled' : ''}`}>
          <div className="anchor-header">
            <div>
              <strong>镜头锚点</strong>
              <span>
                {aimAnchor.enabled && trackedAnchorObject
                  ? `正在跟踪：${trackedAnchorObject.name}`
                  : aimAnchor.enabled
                    ? '所有镜头自动看向红色锚点'
                    : '关闭时使用每个镜头点自己的紫色朝向'}
              </span>
            </div>
            <button type="button" onClick={onToggleAimAnchor}>
              <Crosshair size={14} />
              {aimAnchor.enabled ? '关闭' : '开启'}
            </button>
          </div>
          <div className="anchor-actions">
            <button
              type="button"
              className={aimAnchor.snapEnabled ? 'active' : ''}
              onClick={onToggleAimAnchorSnap}
            >
              <Magnet size={13} />
              磁吸
            </button>
            <button
              type="button"
              disabled={!selectedObject}
              onClick={onSetAimAnchorToSelectedObject}
            >
              跟踪选中白模
            </button>
            <button type="button" onClick={onSetAimAnchorToCurrentTarget}>
              用当前朝向
            </button>
          </div>
          <div className="anchor-position-readout">
            拖动画面里的红点指定固定锚点；跟踪白模时会按当前时间自动看向运动物体。
          </div>
        </div>
        <div className="camera-summary">
          <span>{activeCamera?.name ?? '镜头'}</span>
          <strong>{keyframes.length} 个镜头 / {timelineDuration.toFixed(1)}s</strong>
        </div>
        <div className="camera-summary muted">
          <span>当前时间</span>
          <strong>{scene.timeline.currentTimeSec.toFixed(2)}s</strong>
        </div>
        <div className="keyframe-edit-card">
          <label className="compact-field">
            <span>镜头模式</span>
            <select
              value={cameraMotion.mode}
              onChange={(event) => {
                const mode = event.target.value as CameraMotionMode
                const shakeStrength =
                  mode === 'stable'
                    ? 0
                    : cameraMotion.shakeStrength > 0
                      ? cameraMotion.shakeStrength
                      : mode === 'handheld'
                        ? 1
                        : 0.45
                onUpdateCameraMotion({ mode, shakeStrength })
              }}
            >
              {cameraMotionModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {cameraMotion.mode !== 'stable' ? (
            <CompactRange
              label="抖动强度"
              value={cameraMotion.shakeStrength}
              min={0}
              max={2}
              step={0.05}
              suffix="x"
              onChange={(shakeStrength) =>
                onUpdateCameraMotion({ ...cameraMotion, shakeStrength })
              }
            />
          ) : null}
        </div>
        <div className="keyframe-list">
          {keyframes.map((keyframe, index) => {
            const hasNextKeyframe = index < keyframes.length - 1
            const segmentConnected = keyframe.connectToNext !== false

            return (
              <div key={keyframe.id} className="keyframe-stack">
                <div
                  className={`keyframe-row ${
                    keyframe.id === selectedKeyframeId ? 'is-selected' : ''
                  } ${
                    keyframe.id === dragOverKeyframeId &&
                    draggedKeyframeId !== keyframe.id
                      ? 'is-drop-target'
                      : ''
                  }`}
                  draggable
                  onDragStart={(event) => {
                    setDraggedKeyframeId(keyframe.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', keyframe.id)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDragOverKeyframeId(keyframe.id)
                  }}
                  onDragLeave={() => {
                    setDragOverKeyframeId((currentId) =>
                      currentId === keyframe.id ? null : currentId,
                    )
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const sourceKeyframeId =
                      draggedKeyframeId ||
                      event.dataTransfer.getData('text/plain')
                    setDraggedKeyframeId(null)
                    setDragOverKeyframeId(null)

                    if (sourceKeyframeId && sourceKeyframeId !== keyframe.id) {
                      onReorderKeyframe(sourceKeyframeId, keyframe.id)
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedKeyframeId(null)
                    setDragOverKeyframeId(null)
                  }}
                >
                  <span className="keyframe-drag-handle" title="拖动排序">
                    <GripVertical size={14} />
                  </span>
                  <button
                    type="button"
                    className="keyframe-row-main"
                    onClick={() => onSelectKeyframe(keyframe.id)}
                  >
                    <span>镜头点 {index + 1}</span>
                    <strong>
                      {timelineMode === 'shots'
                        ? `${getShotDuration(keyframe).toFixed(1)}s`
                        : `${keyframe.timeSec.toFixed(2)}s`}
                    </strong>
                  </button>
                  <button
                    type="button"
                    className="keyframe-delete-button"
                    disabled={keyframes.length <= 1}
                    title="删除镜头点"
                    aria-label={`删除镜头点 ${index + 1}`}
                    onClick={() => onDeleteKeyframe(keyframe.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {timelineMode === 'motion' && hasNextKeyframe ? (
                  <button
                    type="button"
                    className={`keyframe-link-toggle ${
                      segmentConnected ? 'is-connected' : 'is-disconnected'
                    }`}
                    aria-pressed={segmentConnected}
                    onClick={() => onToggleSegmentConnection(keyframe.id)}
                  >
                    {segmentConnected ? <Link2 size={13} /> : <Unlink size={13} />}
                    <span>
                      点 {index + 1} 到点 {index + 2}
                    </span>
                    <strong>{segmentConnected ? '已连线' : '断开'}</strong>
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
        {selectedKeyframe ? (
          <div className="keyframe-edit-card">
            {timelineMode === 'shots' ? (
              <CompactRange
                label="时长"
                value={getShotDuration(selectedKeyframe)}
                min={0.5}
                max={30}
                step={0.1}
                suffix="s"
                onChange={(durationSec) =>
                  onUpdateKeyframeShotDuration(selectedKeyframe.id, durationSec)
                }
              />
            ) : null}
            <VectorSliderGroup
              label="蓝色镜头位置"
              values={selectedKeyframe.position}
              ranges={positionRanges}
              onChange={updateKeyframePositionAxis}
            />
            {aimAnchor.enabled ? (
              <div className="anchor-lock-note">
                已开启锚点锁定，此镜头点会自动看向红点。
              </div>
            ) : (
              <VectorSliderGroup
                label="紫色朝向目标"
                values={selectedKeyframe.target}
                ranges={positionRanges}
                onChange={updateKeyframeTargetAxis}
              />
            )}
          </div>
        ) : null}
        <div className="segment-speed-list">
          {timelineMode === 'motion'
            ? segments.map((segment) => (
                <div key={segment.from.id} className="segment-speed">
                  <div className="segment-title">
                    <span>
                      <Gauge size={13} />
                      轨迹 {segment.index + 1}: 点 {segment.index + 1} 到点{' '}
                      {segment.index + 2}
                    </span>
                    <strong>{segment.speed.toFixed(2)}x</strong>
                  </div>
                  <label className="compact-field">
                    <span>曲线</span>
                    <select
                      value={segment.curve}
                      onChange={(event) =>
                        onUpdateSegmentCurve(
                          segment.from.id,
                          event.target.value as CameraCurveType,
                        )
                      }
                    >
                      {curveOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="range-field">
                    <span>弯曲</span>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={0.05}
                      value={segment.curveStrength}
                      onChange={(event) =>
                        onUpdateSegmentCurveStrength(
                          segment.from.id,
                          Number(event.target.value),
                        )
                      }
                    />
                    <strong>{segment.curveStrength.toFixed(2)}</strong>
                  </label>
                  <label className="range-field">
                    <span>速度</span>
                    <input
                      type="range"
                      min={0.25}
                      max={3}
                      step={0.05}
                      value={segment.speed}
                      onChange={(event) =>
                        onUpdateSegmentSpeed(segment.from.id, Number(event.target.value))
                      }
                    />
                    <strong>{segment.speed.toFixed(2)}x</strong>
                  </label>
                  <label className="compact-field">
                    <span>速率曲线</span>
                    <select
                      value={segment.speedCurve}
                      onChange={(event) =>
                        onUpdateSegmentSpeedCurve(
                          segment.from.id,
                          event.target.value as SpeedCurveType,
                        )
                      }
                    >
                      {speedCurveOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))
            : fixedShotSegments.map((segment) => (
                <div key={segment.keyframe.id} className="segment-speed">
                  <div className="segment-title">
                    <span>
                      <Camera size={13} />
                      固定镜头 {segment.index + 1}
                    </span>
                    <strong>
                      {segment.startSec.toFixed(1)}s - {segment.endSec.toFixed(1)}s
                    </strong>
                  </div>
                  <label className="range-field">
                    <span>时长</span>
                    <input
                      type="range"
                      min={0.5}
                      max={30}
                      step={0.1}
                      value={segment.durationSec}
                      onChange={(event) =>
                        onUpdateKeyframeShotDuration(
                          segment.keyframe.id,
                          Number(event.target.value),
                        )
                      }
                    />
                    <strong>{segment.durationSec.toFixed(1)}s</strong>
                  </label>
                </div>
              ))}
        </div>
        {timelineMode === 'motion' && selectedSegment ? (
          <VectorSliderGroup
            label="橙色曲线控制点"
            values={selectedSegment.controlPoint}
            ranges={positionRanges}
            onChange={updateCurveControlAxis}
          />
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection
        title="光照系统"
        className="inspector-section-light"
        action={
          <button type="button" className="mini-action" onClick={onAddLight}>
            <Plus size={13} />
            加光
          </button>
        }
      >
        <div className="light-list">
          {lights.map((light) => (
            <div key={light.id} className="light-card">
              <div className="light-card-header">
                <label>
                  <input
                    type="checkbox"
                    checked={light.enabled}
                    onChange={(event) =>
                      onUpdateLight(light.id, { enabled: event.target.checked })
                    }
                  />
                  <Lightbulb size={13} />
                  <strong>{light.name}</strong>
                </label>
                <button
                  type="button"
                  className="icon-mini danger"
                  onClick={() => onDeleteLight(light.id)}
                  disabled={lights.length <= 1}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <label className="compact-field">
                <span>类型</span>
                <select
                  value={light.kind}
                  onChange={(event) =>
                    onUpdateLight(light.id, {
                      kind: event.target.value as SceneLight['kind'],
                    })
                  }
                >
                  {Object.entries(lightKindLabels).map(([kind, label]) => (
                    <option key={kind} value={kind}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <CompactRange
                label="强度"
                value={light.intensity}
                min={0}
                max={3}
                step={0.05}
                onChange={(intensity) => onUpdateLight(light.id, { intensity })}
              />
              <CompactRange
                label="色温"
                value={light.colorTemperature}
                min={2000}
                max={10000}
                step={100}
                suffix="K"
                onChange={(colorTemperature) =>
                  onUpdateLight(light.id, { colorTemperature })
                }
              />
              {light.kind !== 'ambient' ? (
                <>
                  <CompactRange
                    label="水平角"
                    value={light.azimuthDeg}
                    min={-180}
                    max={180}
                    step={1}
                    suffix="°"
                    onChange={(azimuthDeg) => onUpdateLight(light.id, { azimuthDeg })}
                  />
                  <CompactRange
                    label="高度角"
                    value={light.elevationDeg}
                    min={-10}
                    max={85}
                    step={1}
                    suffix="°"
                    onChange={(elevationDeg) =>
                      onUpdateLight(light.id, { elevationDeg })
                    }
                  />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="导出视频"
        className="inspector-section-export export-section"
      >
        <label className="wide-field">
          <span>{timelineMode === 'shots' ? '总时长' : '时长'}</span>
          <input
            type="number"
            min={1}
            max={300}
            step={timelineMode === 'shots' ? 0.1 : 1}
            value={
              timelineMode === 'shots'
                ? Number(timelineDuration.toFixed(1))
                : renderSettings.durationSec
            }
            disabled={timelineMode === 'shots'}
            onChange={(event) =>
              onUpdateRenderSettings({
                ...renderSettings,
                durationSec: Number(event.target.value),
              })
            }
          />
        </label>
        <label className="wide-field">
          <span>FPS</span>
          <select
            value={renderSettings.fps}
            onChange={(event) =>
              onUpdateRenderSettings({
                ...renderSettings,
                fps: Number(event.target.value) as RenderSettings['fps'],
              })
            }
          >
            <option value={24}>24</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <div className="resolution-row">
          <label className="wide-field">
            <span>宽</span>
            <input
              type="number"
              min={320}
              max={3840}
              value={renderSettings.width}
              onChange={(event) =>
                onUpdateRenderSettings({
                  ...renderSettings,
                  width: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="wide-field">
            <span>高</span>
            <input
              type="number"
              min={240}
              max={2160}
              value={renderSettings.height}
              onChange={(event) =>
                onUpdateRenderSettings({
                  ...renderSettings,
                  height: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <label className="wide-field">
          <span>地面材质</span>
          <select
            value={renderSettings.fillWhiteGround ? 'white' : renderSettings.floorMaterial}
            onChange={(event) => {
              const floorMaterial = event.target.value as FloorMaterial
              onUpdateRenderSettings({
                ...renderSettings,
                floorMaterial,
                fillWhiteGround: floorMaterial === 'white',
              })
            }}
          >
            {floorMaterialOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="export-toggle">
          <input
            type="checkbox"
            checked={renderSettings.hideGrid}
            onChange={(event) =>
              onUpdateRenderSettings({
                ...renderSettings,
                hideGrid: event.target.checked,
              })
            }
          />
          导出时去掉网格
        </label>
        <button
          type="button"
          className="primary-action"
          onClick={onExportVideo}
          disabled={renderBusy}
        >
          <Video size={16} />
          导出 MP4
        </button>
        {renderJob ? (
          <div className={`render-status ${renderJob.status}`}>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.round(renderJob.progress * 100)}%` }}
              />
            </div>
            <span>
              {renderJob.status} / {Math.round(renderJob.progress * 100)}%
            </span>
            {renderJob.status === 'completed' && renderJob.downloadUrl ? (
              <a href={renderJob.downloadUrl} className="download-link">
                <Download size={14} />
                下载视频
              </a>
            ) : null}
            {renderJob.status === 'failed' && renderJob.error ? (
              <p>{renderJob.error}</p>
            ) : null}
          </div>
        ) : null}
      </CollapsibleSection>
    </aside>
  )
}
