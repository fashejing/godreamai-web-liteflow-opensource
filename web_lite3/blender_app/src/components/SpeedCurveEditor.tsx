import { Minus, Plus, Spline, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  normalizeCustomSpeedCurvePoints,
  sampleCustomSpeedCurveRate,
} from '../scene/speedCurves'
import type {
  SpeedCurveInterpolation,
  SpeedCurvePoint,
} from '../scene/types'

type SpeedCurveEditorProps = {
  interpolation: SpeedCurveInterpolation
  segmentLabel: string
  points: SpeedCurvePoint[]
  onChange: (points: SpeedCurvePoint[]) => void
  onInterpolationChange: (interpolation: SpeedCurveInterpolation) => void
  onClose: () => void
}

const VIEW_WIDTH = 560
const VIEW_HEIGHT = 310
const PLOT_LEFT = 54
const PLOT_TOP = 18
const PLOT_RIGHT = 18
const PLOT_BOTTOM = 46
const PLOT_WIDTH = VIEW_WIDTH - PLOT_LEFT - PLOT_RIGHT
const PLOT_HEIGHT = VIEW_HEIGHT - PLOT_TOP - PLOT_BOTTOM
const MAX_RATE = 3
const MAX_POINTS = 16
const MIN_POINT_GAP = 0.01

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const toSvgPoint = (point: SpeedCurvePoint) => ({
  x: PLOT_LEFT + point.time * PLOT_WIDTH,
  y: PLOT_TOP + (1 - point.rate / MAX_RATE) * PLOT_HEIGHT,
})

export const SpeedCurveEditor = ({
  interpolation,
  segmentLabel,
  points,
  onChange,
  onInterpolationChange,
  onClose,
}: SpeedCurveEditorProps) => {
  const normalizedPoints = useMemo(
    () => normalizeCustomSpeedCurvePoints(points),
    [points],
  )
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (draggedIndex === null) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const svg = svgRef.current
      if (!svg) {
        return
      }

      const rect = svg.getBoundingClientRect()
      const svgX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH
      const svgY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT
      const nextPoints = normalizedPoints.map((point) => ({ ...point }))
      const isEndpoint = draggedIndex === 0 || draggedIndex === nextPoints.length - 1
      const previousTime = nextPoints[draggedIndex - 1]?.time ?? 0
      const nextTime = nextPoints[draggedIndex + 1]?.time ?? 1

      nextPoints[draggedIndex] = {
        time: isEndpoint
          ? nextPoints[draggedIndex].time
          : clamp(
              (svgX - PLOT_LEFT) / PLOT_WIDTH,
              previousTime + MIN_POINT_GAP,
              nextTime - MIN_POINT_GAP,
            ),
        rate: clamp(
          ((PLOT_TOP + PLOT_HEIGHT - svgY) / PLOT_HEIGHT) * MAX_RATE,
          0,
          MAX_RATE,
        ),
      }
      onChange(nextPoints)
    }

    const handlePointerUp = () => setDraggedIndex(null)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [draggedIndex, normalizedPoints, onChange])

  const addPoint = () => {
    if (normalizedPoints.length >= MAX_POINTS) {
      return
    }

    let gapIndex = 0
    for (let index = 1; index < normalizedPoints.length - 1; index += 1) {
      const currentGap = normalizedPoints[index + 1].time - normalizedPoints[index].time
      const largestGap =
        normalizedPoints[gapIndex + 1].time - normalizedPoints[gapIndex].time
      if (currentGap > largestGap) {
        gapIndex = index
      }
    }

    const from = normalizedPoints[gapIndex]
    const to = normalizedPoints[gapIndex + 1]
    const nextPoint = {
      time: (from.time + to.time) / 2,
      rate: (from.rate + to.rate) / 2,
    }
    const nextPoints = [
      ...normalizedPoints.slice(0, gapIndex + 1),
      nextPoint,
      ...normalizedPoints.slice(gapIndex + 1),
    ]
    setSelectedIndex(gapIndex + 1)
    onChange(nextPoints)
  }

  const removePoint = () => {
    if (selectedIndex <= 0 || selectedIndex >= normalizedPoints.length - 1) {
      return
    }

    onChange(normalizedPoints.filter((_, index) => index !== selectedIndex))
    setSelectedIndex(Math.max(0, selectedIndex - 1))
  }

  const selectedPoint = normalizedPoints[selectedIndex] ?? normalizedPoints[0]
  const portalTarget =
    document.querySelector<HTMLElement>('.app-shell') ?? document.body
  const curvePath = useMemo(() => {
    const displayPoints =
      interpolation === 'smooth'
        ? Array.from({ length: 81 }, (_, index) => {
            const time = index / 80
            return {
              time,
              rate: sampleCustomSpeedCurveRate(
                time,
                normalizedPoints,
                interpolation,
              ),
            }
          })
        : normalizedPoints

    return displayPoints
    .map((point) => {
      const svgPoint = toSvgPoint(point)
      return `${svgPoint.x},${svgPoint.y}`
    })
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point}`)
      .join(' ')
  }, [interpolation, normalizedPoints])

  return createPortal(
    <div
      className="speed-curve-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        aria-label="自定义速率曲线设置"
        aria-modal="true"
        className="speed-curve-dialog"
        role="dialog"
      >
        <header className="speed-curve-dialog-header">
          <div>
            <strong>自定义速率曲线</strong>
            <span>{segmentLabel}</span>
          </div>
          <div className="speed-curve-dialog-actions">
            <button
              aria-label="增加曲线节点"
              disabled={normalizedPoints.length >= MAX_POINTS}
              onClick={addPoint}
              title="增加节点"
              type="button"
            >
              <Plus size={17} />
            </button>
            <button
              aria-label="删除选中的曲线节点"
              disabled={
                selectedIndex <= 0 || selectedIndex >= normalizedPoints.length - 1
              }
              onClick={removePoint}
              title="删除选中的中间节点"
              type="button"
            >
              <Minus size={17} />
            </button>
            <button
              aria-label="关闭曲线设置"
              onClick={onClose}
              title="关闭"
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="speed-curve-modebar">
          <span>节点连线</span>
          <div aria-label="曲线平滑方式" role="group">
            <button
              aria-pressed={interpolation === 'linear'}
              className={interpolation === 'linear' ? 'is-active' : ''}
              onClick={() => onInterpolationChange('linear')}
              type="button"
            >
              <Minus size={15} />
              保持直线
            </button>
            <button
              aria-pressed={interpolation === 'smooth'}
              className={interpolation === 'smooth' ? 'is-active' : ''}
              onClick={() => onInterpolationChange('smooth')}
              type="button"
            >
              <Spline size={15} />
              平滑成曲线
            </button>
          </div>
        </div>

        <div className="speed-curve-chart">
          <svg
            aria-label="横轴为时间，纵轴为速率的可编辑曲线"
            ref={svgRef}
            role="img"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const x = PLOT_LEFT + tick * PLOT_WIDTH
              return (
                <g key={`time-${tick}`}>
                  <line
                    className="speed-curve-grid-line"
                    x1={x}
                    x2={x}
                    y1={PLOT_TOP}
                    y2={PLOT_TOP + PLOT_HEIGHT}
                  />
                  <text
                    className="speed-curve-axis-label"
                    textAnchor="middle"
                    x={x}
                    y={VIEW_HEIGHT - 18}
                  >
                    {Math.round(tick * 100)}%
                  </text>
                </g>
              )
            })}
            {[0, 1, 2, 3].map((tick) => {
              const y = PLOT_TOP + (1 - tick / MAX_RATE) * PLOT_HEIGHT
              return (
                <g key={`rate-${tick}`}>
                  <line
                    className="speed-curve-grid-line"
                    x1={PLOT_LEFT}
                    x2={PLOT_LEFT + PLOT_WIDTH}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="speed-curve-axis-label"
                    textAnchor="end"
                    x={PLOT_LEFT - 10}
                    y={y + 4}
                  >
                    {tick}x
                  </text>
                </g>
              )
            })}
            <g className="speed-curve-axis">
              <line
                x1={PLOT_LEFT}
                x2={PLOT_LEFT + PLOT_WIDTH}
                y1={PLOT_TOP + PLOT_HEIGHT}
                y2={PLOT_TOP + PLOT_HEIGHT}
              />
              <path
                d={`M ${PLOT_LEFT + PLOT_WIDTH} ${PLOT_TOP + PLOT_HEIGHT} l -9 -5 l 0 10 z`}
              />
              <line
                x1={PLOT_LEFT}
                x2={PLOT_LEFT}
                y1={PLOT_TOP + PLOT_HEIGHT}
                y2={PLOT_TOP}
              />
              <path d={`M ${PLOT_LEFT} ${PLOT_TOP} l -5 9 l 10 0 z`} />
            </g>
            <text
              className="speed-curve-axis-title"
              textAnchor="middle"
              x={PLOT_LEFT + PLOT_WIDTH / 2}
              y={VIEW_HEIGHT - 2}
            >
              X · 时间
            </text>
            <text
              className="speed-curve-axis-title"
              textAnchor="middle"
              transform={`rotate(-90 14 ${PLOT_TOP + PLOT_HEIGHT / 2})`}
              x={14}
              y={PLOT_TOP + PLOT_HEIGHT / 2}
            >
              Y · 速率
            </text>
            <path className="speed-curve-line" d={curvePath} />
            {normalizedPoints.map((point, index) => {
              const svgPoint = toSvgPoint(point)
              return (
                <circle
                  aria-label={`节点 ${index + 1}`}
                  className={`speed-curve-node${
                    selectedIndex === index ? ' is-selected' : ''
                  }`}
                  cx={svgPoint.x}
                  cy={svgPoint.y}
                  key={`${index}-${point.time}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    setSelectedIndex(index)
                    setDraggedIndex(index)
                  }}
                  r={selectedIndex === index ? 7 : 6}
                  role="button"
                />
              )
            })}
          </svg>
        </div>

        <footer className="speed-curve-readout">
          <span>节点 {selectedIndex + 1} / {normalizedPoints.length}</span>
          <strong>时间 {(selectedPoint.time * 100).toFixed(1)}%</strong>
          <strong>速率 {selectedPoint.rate.toFixed(2)}x</strong>
          <span>拖动节点调整；首尾节点固定在起止时间</span>
        </footer>
      </section>
    </div>,
    portalTarget,
  )
}
