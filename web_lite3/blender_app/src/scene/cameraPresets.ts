import type { CameraKeyframe, RenderSettings } from './types'

export type CinematicMovePreset = {
  id: string
  name: string
  description: string
  durationSec: number
  keyframes: CameraKeyframe[]
}

const keyframe = (
  presetId: string,
  index: number,
  timeSec: number,
  position: [number, number, number],
  target: [number, number, number],
  options: Partial<CameraKeyframe> = {},
): CameraKeyframe => ({
  id: `${presetId}-kf-${index + 1}`,
  timeSec,
  position,
  target,
  fov: options.fov ?? 42,
  interpolation: 'linear',
  speedToNext: options.speedToNext ?? 1,
  speedCurveToNext: options.speedCurveToNext ?? 'linear',
  curveToNext: options.curveToNext ?? 'smooth',
  curveStrengthToNext: options.curveStrengthToNext ?? 1,
  curveControlToNext: options.curveControlToNext,
})

type CompactPresetKeyframe = {
  timeSec: number
  position: [number, number, number]
  target: [number, number, number]
  options?: Partial<CameraKeyframe>
}

const cinematicPreset = (
  id: string,
  name: string,
  description: string,
  durationSec: number,
  frames: CompactPresetKeyframe[],
): CinematicMovePreset => ({
  id,
  name,
  description,
  durationSec,
  keyframes: frames.map((frame, index) =>
    keyframe(id, index, frame.timeSec, frame.position, frame.target, frame.options),
  ),
})

export const cinematicMovePresets: CinematicMovePreset[] = [
  {
    id: 'slow-push-in',
    name: '奥斯卡式缓推',
    description: '从远景慢慢推到主体，适合建立情绪和人物重量。',
    durationSec: 10,
    keyframes: [
      keyframe('slow-push-in', 0, 0, [0, 2.6, 8.2], [0, 1.4, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.45,
        speedToNext: 0.8,
        fov: 46,
      }),
      keyframe('slow-push-in', 1, 5, [0.2, 2.3, 5.4], [0.1, 1.35, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.35,
        speedToNext: 1,
        fov: 42,
      }),
      keyframe('slow-push-in', 2, 10, [0.35, 2.0, 3.3], [0.15, 1.35, 0], {
        curveToNext: 'linear',
        fov: 38,
      }),
    ],
  },
  {
    id: 'orbit-reveal',
    name: '半环绕揭示',
    description: '围绕主体绕半圈，适合展示建筑或人物关系。',
    durationSec: 12,
    keyframes: [
      keyframe('orbit-reveal', 0, 0, [-6, 2.8, 5.4], [0, 1.4, 0], {
        curveToNext: 'arc-left',
        curveStrengthToNext: 1,
        speedToNext: 0.9,
      }),
      keyframe('orbit-reveal', 1, 4, [-2.6, 2.5, 6.7], [0, 1.4, 0], {
        curveToNext: 'arc-left',
        curveStrengthToNext: 1.15,
        speedToNext: 1.05,
      }),
      keyframe('orbit-reveal', 2, 8, [3.8, 2.6, 5.7], [0, 1.35, 0], {
        curveToNext: 'arc-left',
        curveStrengthToNext: 0.8,
        speedToNext: 0.95,
      }),
      keyframe('orbit-reveal', 3, 12, [6.2, 2.4, 2.4], [0, 1.25, 0], {
        curveToNext: 'linear',
      }),
    ],
  },
  {
    id: 'crane-down',
    name: '摇臂下降',
    description: '从高处下降到主体高度，适合开场和空间交代。',
    durationSec: 10,
    keyframes: [
      keyframe('crane-down', 0, 0, [-4, 6.8, 6], [0, 1.5, 0], {
        curveToNext: 'crane-down',
        curveStrengthToNext: 1.4,
        speedToNext: 0.8,
        fov: 48,
      }),
      keyframe('crane-down', 1, 5, [-3, 4.0, 4.8], [0, 1.35, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.55,
        speedToNext: 1,
        fov: 44,
      }),
      keyframe('crane-down', 2, 10, [-1.6, 2.3, 3.8], [0.2, 1.25, 0], {
        curveToNext: 'linear',
        fov: 40,
      }),
    ],
  },
  {
    id: 'side-dolly',
    name: '横移跟拍',
    description: '横向平移穿过空间，适合展示空间层次。',
    durationSec: 10,
    keyframes: [
      keyframe('side-dolly', 0, 0, [-6.5, 2.0, 3.6], [0, 1.25, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.25,
        speedToNext: 1,
      }),
      keyframe('side-dolly', 1, 5, [0, 2.0, 3.8], [0.3, 1.3, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.35,
        speedToNext: 1,
      }),
      keyframe('side-dolly', 2, 10, [6.5, 2.0, 3.6], [0.5, 1.25, 0], {
        curveToNext: 'linear',
      }),
    ],
  },
  {
    id: 's-curve-tour',
    name: 'S 形游走',
    description: '用多段曲线穿过空间，适合预演复杂动线。',
    durationSec: 14,
    keyframes: [
      keyframe('s-curve-tour', 0, 0, [-6.2, 2.4, 5.2], [0, 1.4, 0], {
        curveToNext: 'arc-right',
        curveStrengthToNext: 0.9,
        speedToNext: 0.9,
      }),
      keyframe('s-curve-tour', 1, 3.5, [-2.8, 2.1, 4.5], [0.3, 1.35, 0.2], {
        curveToNext: 'arc-left',
        curveStrengthToNext: 1.2,
        speedToNext: 1.15,
      }),
      keyframe('s-curve-tour', 2, 7, [1.2, 2.2, 4.9], [0.2, 1.35, -0.3], {
        curveToNext: 'arc-right',
        curveStrengthToNext: 1.1,
        speedToNext: 1.05,
      }),
      keyframe('s-curve-tour', 3, 10.5, [4.2, 2.4, 3.5], [0.1, 1.3, -0.4], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.45,
        speedToNext: 0.85,
      }),
      keyframe('s-curve-tour', 4, 14, [5.8, 2.2, 1.8], [0, 1.25, 0], {
        curveToNext: 'linear',
      }),
    ],
  },
  {
    id: 'hero-low-angle',
    name: '低角英雄推进',
    description: '低机位向主体推进，制造压迫感和主角感。',
    durationSec: 9,
    keyframes: [
      keyframe('hero-low-angle', 0, 0, [-4.8, 1.0, 5.4], [0, 1.5, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.55,
        speedToNext: 0.75,
        fov: 48,
      }),
      keyframe('hero-low-angle', 1, 4.5, [-2.0, 0.9, 4.0], [0, 1.55, 0], {
        curveToNext: 'arc-right',
        curveStrengthToNext: 0.65,
        speedToNext: 1,
        fov: 42,
      }),
      keyframe('hero-low-angle', 2, 9, [0.7, 0.85, 3.0], [0, 1.58, 0], {
        curveToNext: 'linear',
        fov: 36,
      }),
    ],
  },
  {
    id: 'overhead-dive',
    name: '高位俯冲揭示',
    description: '从俯视下降并转入平视，适合展示空间后落到主体。',
    durationSec: 11,
    keyframes: [
      keyframe('overhead-dive', 0, 0, [0, 8.0, 5.0], [0, 1.2, 0], {
        curveToNext: 'crane-down',
        curveStrengthToNext: 1.6,
        speedToNext: 0.7,
        fov: 52,
      }),
      keyframe('overhead-dive', 1, 4, [-1.5, 5.2, 5.4], [0, 1.35, 0], {
        curveToNext: 'arc-left',
        curveStrengthToNext: 0.9,
        speedToNext: 1.1,
        fov: 46,
      }),
      keyframe('overhead-dive', 2, 7.5, [-3.2, 3.2, 4.2], [0, 1.45, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.45,
        speedToNext: 0.9,
        fov: 42,
      }),
      keyframe('overhead-dive', 3, 11, [-4.2, 2.2, 3.0], [0.2, 1.35, 0], {
        curveToNext: 'linear',
        fov: 39,
      }),
    ],
  },
  {
    id: 'long-take-thread',
    name: '长镜头穿梭',
    description: '连续穿过前景与主体，适合模拟调度感强的长镜头。',
    durationSec: 15,
    keyframes: [
      keyframe('long-take-thread', 0, 0, [-6.8, 1.8, 4.2], [-0.8, 1.3, 0.2], {
        curveToNext: 'arc-right',
        curveStrengthToNext: 0.8,
        speedToNext: 0.8,
        fov: 44,
      }),
      keyframe('long-take-thread', 1, 4, [-3.4, 1.7, 3.5], [-0.1, 1.25, 0.1], {
        curveToNext: 'arc-left',
        curveStrengthToNext: 1.1,
        speedToNext: 1.15,
        fov: 40,
      }),
      keyframe('long-take-thread', 2, 8, [0.2, 1.8, 4.0], [0.5, 1.25, -0.2], {
        curveToNext: 'arc-right',
        curveStrengthToNext: 0.95,
        speedToNext: 1.05,
        fov: 38,
      }),
      keyframe('long-take-thread', 3, 12, [3.2, 1.9, 3.0], [0.8, 1.2, -0.5], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.5,
        speedToNext: 0.85,
        fov: 42,
      }),
      keyframe('long-take-thread', 4, 15, [5.8, 2.0, 2.0], [0.3, 1.3, -0.2], {
        curveToNext: 'linear',
        fov: 45,
      }),
    ],
  },
  {
    id: 'over-shoulder-slide',
    name: '过肩转场',
    description: '从一侧过肩滑到主体正面，适合人物关系和揭示。',
    durationSec: 10,
    keyframes: [
      keyframe('over-shoulder-slide', 0, 0, [-4.8, 1.8, 3.2], [0.8, 1.45, 0.4], {
        curveToNext: 'arc-left',
        curveStrengthToNext: 0.9,
        speedToNext: 0.85,
        fov: 50,
      }),
      keyframe('over-shoulder-slide', 1, 4, [-2.2, 1.9, 3.8], [0.5, 1.42, 0.2], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.35,
        speedToNext: 1,
        fov: 44,
      }),
      keyframe('over-shoulder-slide', 2, 7, [0.8, 1.9, 4.0], [0.2, 1.38, 0], {
        curveToNext: 'arc-right',
        curveStrengthToNext: 0.65,
        speedToNext: 0.9,
        fov: 40,
      }),
      keyframe('over-shoulder-slide', 3, 10, [2.6, 1.85, 3.2], [0, 1.35, 0], {
        curveToNext: 'linear',
        fov: 38,
      }),
    ],
  },
  {
    id: 'dolly-zoom-pressure',
    name: '压缩变焦',
    description: '位置后撤同时收窄视角，制造空间压缩和心理压力。',
    durationSec: 8,
    keyframes: [
      keyframe('dolly-zoom-pressure', 0, 0, [0, 1.8, 3.0], [0, 1.35, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.25,
        speedToNext: 0.8,
        fov: 32,
      }),
      keyframe('dolly-zoom-pressure', 1, 4, [0, 1.9, 4.8], [0, 1.35, 0], {
        curveToNext: 'smooth',
        curveStrengthToNext: 0.15,
        speedToNext: 1,
        fov: 42,
      }),
      keyframe('dolly-zoom-pressure', 2, 8, [0, 2.0, 7.0], [0, 1.35, 0], {
        curveToNext: 'linear',
        fov: 56,
      }),
    ],
  },
  cinematicPreset('establishing-wide-glide', '远景建立滑入', '从大远景缓慢滑入，让观众先读懂空间再进入主体关系。', 12, [
    { timeSec: 0, position: [-7.5, 3.4, 8.0], target: [0, 1.2, 0], options: { fov: 54, speedToNext: 0.75, curveStrengthToNext: 0.35 } },
    { timeSec: 6, position: [-4.2, 2.8, 6.0], target: [0, 1.25, 0], options: { fov: 48, curveToNext: 'smooth', speedToNext: 0.95 } },
    { timeSec: 12, position: [-1.4, 2.3, 4.2], target: [0.1, 1.35, 0], options: { fov: 42, curveToNext: 'linear' } },
  ]),
  cinematicPreset('locked-off-creep', '定机轻推', '近似固定机位的细微推进，适合压低存在感的剧情对白。', 9, [
    { timeSec: 0, position: [0, 2.0, 5.4], target: [0, 1.35, 0], options: { fov: 44, speedToNext: 0.65, curveStrengthToNext: 0.15 } },
    { timeSec: 4.5, position: [0.08, 1.95, 4.7], target: [0.04, 1.36, 0], options: { fov: 42, speedToNext: 0.8, curveStrengthToNext: 0.12 } },
    { timeSec: 9, position: [0.16, 1.9, 4.1], target: [0.08, 1.36, 0], options: { fov: 40, curveToNext: 'linear' } },
  ]),
  cinematicPreset('handheld-follow', '手持贴身跟随', '模拟肩扛跟随的贴近感，适合人物移动或紧张追随。', 10, [
    { timeSec: 0, position: [-2.4, 1.55, 4.2], target: [0, 1.4, 0], options: { fov: 50, curveToNext: 'arc-right', curveStrengthToNext: 0.45, speedToNext: 1.1 } },
    { timeSec: 3.5, position: [-1.4, 1.48, 3.6], target: [0.2, 1.38, -0.2], options: { fov: 48, curveToNext: 'arc-left', curveStrengthToNext: 0.65, speedToNext: 1.2 } },
    { timeSec: 7, position: [0.2, 1.58, 3.4], target: [0.4, 1.35, -0.3], options: { fov: 46, curveToNext: 'smooth', curveStrengthToNext: 0.35, speedToNext: 0.9 } },
    { timeSec: 10, position: [1.2, 1.5, 3.0], target: [0.5, 1.35, -0.1], options: { fov: 45, curveToNext: 'linear' } },
  ]),
  cinematicPreset('ground-rush-pass', '贴地掠过', '低位快速掠过前景，适合车辆、战场或巨大物体的速度感。', 8, [
    { timeSec: 0, position: [-5.8, 0.55, 2.8], target: [0, 1.0, 0], options: { fov: 58, curveToNext: 'smooth', curveStrengthToNext: 0.35, speedToNext: 1.4 } },
    { timeSec: 3, position: [-1.6, 0.5, 2.4], target: [0.3, 1.1, -0.2], options: { fov: 52, curveToNext: 'arc-right', curveStrengthToNext: 0.5, speedToNext: 1.25 } },
    { timeSec: 8, position: [4.8, 0.65, 2.1], target: [0.8, 1.15, -0.4], options: { fov: 46, curveToNext: 'linear' } },
  ]),
  cinematicPreset('top-down-map-drop', '顶视地图下降', '从俯视地图式视角下降到立体空间，适合行动部署或地形说明。', 11, [
    { timeSec: 0, position: [0, 10.0, 0.4], target: [0, 0.4, 0], options: { fov: 56, curveToNext: 'crane-down', curveStrengthToNext: 1.6, speedToNext: 0.8 } },
    { timeSec: 5, position: [-1.2, 6.5, 3.2], target: [0, 1.1, 0], options: { fov: 50, curveToNext: 'arc-left', curveStrengthToNext: 1.0, speedToNext: 1 } },
    { timeSec: 11, position: [-3.0, 3.2, 4.8], target: [0, 1.35, 0], options: { fov: 42, curveToNext: 'linear' } },
  ]),
  cinematicPreset('back-orbit-reveal', '绕背揭示', '从主体背后绕到侧前方，适合神秘人物或反派登场。', 11, [
    { timeSec: 0, position: [0.8, 1.8, -5.2], target: [0, 1.35, 0], options: { fov: 44, curveToNext: 'arc-left', curveStrengthToNext: 1.2, speedToNext: 0.85 } },
    { timeSec: 5.5, position: [-4.0, 2.0, -1.2], target: [0, 1.4, 0], options: { fov: 42, curveToNext: 'arc-left', curveStrengthToNext: 1.1, speedToNext: 1 } },
    { timeSec: 11, position: [-4.8, 2.0, 3.0], target: [0.2, 1.35, 0], options: { fov: 39, curveToNext: 'linear' } },
  ]),
  cinematicPreset('standoff-push', '对峙切入', '从中立视角推入两侧对峙中心，适合冲突建立。', 10, [
    { timeSec: 0, position: [0, 2.2, 7.0], target: [0, 1.3, 0], options: { fov: 48, curveToNext: 'smooth', curveStrengthToNext: 0.3, speedToNext: 0.8 } },
    { timeSec: 5, position: [-0.8, 2.0, 5.0], target: [0.2, 1.35, 0], options: { fov: 42, curveToNext: 'arc-right', curveStrengthToNext: 0.45, speedToNext: 1 } },
    { timeSec: 10, position: [-1.6, 1.85, 3.2], target: [0.25, 1.35, 0], options: { fov: 36, curveToNext: 'linear' } },
  ]),
  cinematicPreset('rear-vehicle-chase', '车尾追拍', '从后侧低位追随载具，适合道路、车队和逃亡段落。', 12, [
    { timeSec: 0, position: [-3.8, 1.15, 5.8], target: [0, 1.0, 0], options: { fov: 52, curveToNext: 'smooth', curveStrengthToNext: 0.35, speedToNext: 1.1 } },
    { timeSec: 4, position: [-2.0, 1.05, 4.9], target: [0.4, 1.0, -0.4], options: { fov: 48, curveToNext: 'arc-right', curveStrengthToNext: 0.55, speedToNext: 1.2 } },
    { timeSec: 8, position: [0.3, 1.1, 4.5], target: [0.8, 1.05, -0.7], options: { fov: 45, curveToNext: 'smooth', curveStrengthToNext: 0.4, speedToNext: 1 } },
    { timeSec: 12, position: [1.8, 1.18, 3.9], target: [0.9, 1.05, -0.4], options: { fov: 42, curveToNext: 'linear' } },
  ]),
  cinematicPreset('traffic-weave', '车阵穿插', '镜头在多辆车之间穿行，适合混乱、堵截和追逐调度。', 13, [
    { timeSec: 0, position: [-6.0, 1.2, 3.8], target: [-0.8, 1.0, 0], options: { fov: 54, curveToNext: 'arc-right', curveStrengthToNext: 0.9, speedToNext: 1.15 } },
    { timeSec: 4, position: [-2.4, 1.1, 3.2], target: [0.1, 1.0, -0.2], options: { fov: 48, curveToNext: 'arc-left', curveStrengthToNext: 1.1, speedToNext: 1.25 } },
    { timeSec: 8, position: [1.8, 1.15, 3.5], target: [0.8, 1.0, -0.3], options: { fov: 46, curveToNext: 'arc-right', curveStrengthToNext: 0.85, speedToNext: 1.05 } },
    { timeSec: 13, position: [5.4, 1.2, 2.7], target: [0.6, 1.05, 0], options: { fov: 44, curveToNext: 'linear' } },
  ]),
  cinematicPreset('high-speed-chase', '高速追车贴地', '贴近地面高速前冲，适合车轮、速度线和近距离追逐。', 9, [
    { timeSec: 0, position: [-5.4, 0.45, 4.4], target: [0, 0.8, 0], options: { fov: 62, curveToNext: 'smooth', curveStrengthToNext: 0.2, speedToNext: 1.45 } },
    { timeSec: 3, position: [-1.4, 0.42, 3.8], target: [0.5, 0.85, -0.3], options: { fov: 56, curveToNext: 'smooth', curveStrengthToNext: 0.2, speedToNext: 1.25 } },
    { timeSec: 9, position: [5.2, 0.55, 3.0], target: [0.8, 0.9, -0.4], options: { fov: 48, curveToNext: 'linear' } },
  ]),
  cinematicPreset('aircraft-flyby', '飞机掠场', '镜头从低位抬头追随飞行器掠过，适合飞行器登场。', 10, [
    { timeSec: 0, position: [-6.5, 1.2, 4.6], target: [-0.6, 2.4, 0], options: { fov: 54, curveToNext: 'crane-up', curveStrengthToNext: 1.0, speedToNext: 1.1 } },
    { timeSec: 5, position: [-2.2, 2.8, 5.2], target: [0.4, 3.2, -0.2], options: { fov: 48, curveToNext: 'arc-right', curveStrengthToNext: 0.75, speedToNext: 1.05 } },
    { timeSec: 10, position: [3.8, 4.0, 4.0], target: [1.2, 3.5, -0.6], options: { fov: 42, curveToNext: 'linear' } },
  ]),
  cinematicPreset('drone-rise-orbit', '无人机升空环绕', '从地面附近升起并环绕主体，适合产品、建筑或角色展示。', 12, [
    { timeSec: 0, position: [-3.2, 1.0, 4.0], target: [0, 1.2, 0], options: { fov: 48, curveToNext: 'crane-up', curveStrengthToNext: 1.0, speedToNext: 0.85 } },
    { timeSec: 4, position: [-4.6, 2.8, 4.6], target: [0, 1.35, 0], options: { fov: 44, curveToNext: 'arc-left', curveStrengthToNext: 1.1, speedToNext: 1 } },
    { timeSec: 8, position: [0.2, 4.2, 5.4], target: [0, 1.4, 0], options: { fov: 42, curveToNext: 'arc-left', curveStrengthToNext: 1.0, speedToNext: 1 } },
    { timeSec: 12, position: [4.8, 3.6, 3.0], target: [0, 1.3, 0], options: { fov: 40, curveToNext: 'linear' } },
  ]),
  cinematicPreset('helicopter-track', '直升机追踪', '高位斜向跟踪目标，适合大场面追捕和灾难片视角。', 13, [
    { timeSec: 0, position: [-7.0, 5.5, 7.0], target: [-0.6, 1.2, 0], options: { fov: 58, curveToNext: 'smooth', curveStrengthToNext: 0.45, speedToNext: 1 } },
    { timeSec: 6, position: [-2.0, 5.2, 6.2], target: [0.2, 1.25, -0.3], options: { fov: 52, curveToNext: 'arc-right', curveStrengthToNext: 0.7, speedToNext: 1.05 } },
    { timeSec: 13, position: [4.8, 4.6, 5.0], target: [0.8, 1.2, -0.4], options: { fov: 48, curveToNext: 'linear' } },
  ]),
  cinematicPreset('corridor-run', '走廊穿越', '沿中轴穿越空间，适合建筑走廊、车库或通道调度。', 10, [
    { timeSec: 0, position: [0, 1.7, 7.0], target: [0, 1.4, 0], options: { fov: 46, curveToNext: 'smooth', curveStrengthToNext: 0.12, speedToNext: 1.1 } },
    { timeSec: 5, position: [0.15, 1.7, 3.5], target: [0.1, 1.4, -0.6], options: { fov: 42, curveToNext: 'smooth', curveStrengthToNext: 0.1, speedToNext: 1 } },
    { timeSec: 10, position: [0.25, 1.7, 0.4], target: [0.1, 1.35, -1.5], options: { fov: 40, curveToNext: 'linear' } },
  ]),
  cinematicPreset('doorway-reveal', '门框揭示', '从侧边滑入中心，制造门框或遮挡后的主体揭示。', 9, [
    { timeSec: 0, position: [-5.0, 1.8, 3.2], target: [-0.6, 1.35, 0], options: { fov: 48, curveToNext: 'smooth', curveStrengthToNext: 0.35, speedToNext: 0.8 } },
    { timeSec: 4, position: [-2.4, 1.85, 3.4], target: [0, 1.35, 0], options: { fov: 44, curveToNext: 'arc-left', curveStrengthToNext: 0.45, speedToNext: 1 } },
    { timeSec: 9, position: [0.4, 1.9, 3.2], target: [0.2, 1.36, 0], options: { fov: 40, curveToNext: 'linear' } },
  ]),
  cinematicPreset('foreground-wipe', '前景遮挡滑入', '从前景遮挡物后滑出，适合转场、窥视和悬念感。', 8, [
    { timeSec: 0, position: [-4.8, 1.6, 2.2], target: [0, 1.25, 0], options: { fov: 52, curveToNext: 'arc-left', curveStrengthToNext: 0.75, speedToNext: 1 } },
    { timeSec: 3.5, position: [-2.0, 1.65, 3.0], target: [0.2, 1.3, 0], options: { fov: 46, curveToNext: 'smooth', curveStrengthToNext: 0.35, speedToNext: 0.9 } },
    { timeSec: 8, position: [0.5, 1.72, 3.8], target: [0.1, 1.35, 0], options: { fov: 42, curveToNext: 'linear' } },
  ]),
  cinematicPreset('reverse-reveal', '反打揭示', '从主体背面或侧后方转到反打视角，适合对白和身份揭露。', 10, [
    { timeSec: 0, position: [3.2, 1.8, -3.4], target: [0, 1.35, 0], options: { fov: 46, curveToNext: 'arc-right', curveStrengthToNext: 1.0, speedToNext: 0.85 } },
    { timeSec: 5, position: [4.6, 1.9, 0.6], target: [0.1, 1.35, 0], options: { fov: 42, curveToNext: 'arc-right', curveStrengthToNext: 0.9, speedToNext: 1 } },
    { timeSec: 10, position: [3.2, 1.85, 4.0], target: [0.2, 1.35, 0], options: { fov: 38, curveToNext: 'linear' } },
  ]),
  cinematicPreset('pull-back-lonely', '孤独拉远', '从近景慢慢拉开，制造人物被空间吞没的孤独感。', 12, [
    { timeSec: 0, position: [0, 1.75, 2.7], target: [0, 1.35, 0], options: { fov: 36, curveToNext: 'smooth', curveStrengthToNext: 0.2, speedToNext: 0.75 } },
    { timeSec: 6, position: [0.2, 2.0, 5.3], target: [0.05, 1.35, 0], options: { fov: 44, curveToNext: 'smooth', curveStrengthToNext: 0.3, speedToNext: 0.9 } },
    { timeSec: 12, position: [0.4, 2.8, 8.4], target: [0, 1.3, 0], options: { fov: 52, curveToNext: 'linear' } },
  ]),
  cinematicPreset('spiral-rise', '螺旋升起', '围绕主体边升边转，适合仪式感、胜利感和魔法感。', 13, [
    { timeSec: 0, position: [-3.2, 1.2, 4.2], target: [0, 1.25, 0], options: { fov: 46, curveToNext: 'arc-left', curveStrengthToNext: 1.1, speedToNext: 0.9 } },
    { timeSec: 4.5, position: [-4.8, 2.7, 0.6], target: [0, 1.35, 0], options: { fov: 44, curveToNext: 'arc-left', curveStrengthToNext: 1.3, speedToNext: 1.05 } },
    { timeSec: 9, position: [-0.8, 4.4, -4.8], target: [0, 1.45, 0], options: { fov: 42, curveToNext: 'arc-left', curveStrengthToNext: 1.1, speedToNext: 0.95 } },
    { timeSec: 13, position: [4.2, 5.2, -1.0], target: [0, 1.4, 0], options: { fov: 40, curveToNext: 'linear' } },
  ]),
  cinematicPreset('battlefield-pan', '战场横扫', '横向扫过多层主体，适合群像、战场或大场面展示。', 11, [
    { timeSec: 0, position: [-7.0, 2.1, 4.8], target: [-1.2, 1.25, 0], options: { fov: 52, curveToNext: 'smooth', curveStrengthToNext: 0.25, speedToNext: 1.1 } },
    { timeSec: 5.5, position: [0, 2.2, 5.0], target: [0, 1.3, 0], options: { fov: 48, curveToNext: 'smooth', curveStrengthToNext: 0.28, speedToNext: 1 } },
    { timeSec: 11, position: [7.0, 2.2, 4.4], target: [1.2, 1.25, 0], options: { fov: 48, curveToNext: 'linear' } },
  ]),
  cinematicPreset('macro-detail-push', '细节特写推进', '从中景推进到局部细节，适合道具、线索和关键动作。', 8, [
    { timeSec: 0, position: [-1.6, 1.4, 3.4], target: [0, 1.15, 0], options: { fov: 38, curveToNext: 'smooth', curveStrengthToNext: 0.25, speedToNext: 0.7 } },
    { timeSec: 4, position: [-0.8, 1.25, 2.2], target: [0.05, 1.05, 0], options: { fov: 32, curveToNext: 'smooth', curveStrengthToNext: 0.18, speedToNext: 0.9 } },
    { timeSec: 8, position: [-0.35, 1.15, 1.35], target: [0.05, 1.0, 0], options: { fov: 26, curveToNext: 'linear' } },
  ]),
  cinematicPreset('profile-cross', '侧脸穿越', '沿角色侧面交叉移动，适合情绪变化和沉默反应。', 9, [
    { timeSec: 0, position: [-4.0, 1.75, 2.4], target: [0, 1.38, 0], options: { fov: 42, curveToNext: 'smooth', curveStrengthToNext: 0.2, speedToNext: 0.9 } },
    { timeSec: 4.5, position: [-0.4, 1.75, 2.6], target: [0.1, 1.38, 0], options: { fov: 40, curveToNext: 'smooth', curveStrengthToNext: 0.2, speedToNext: 1 } },
    { timeSec: 9, position: [3.4, 1.75, 2.2], target: [0.2, 1.36, 0], options: { fov: 38, curveToNext: 'linear' } },
  ]),
  cinematicPreset('hero-crane-up', '英雄摇臂升起', '从低位仰拍升到高位，适合角色完成动作后的胜利感。', 10, [
    { timeSec: 0, position: [-2.2, 0.8, 3.4], target: [0, 1.55, 0], options: { fov: 44, curveToNext: 'crane-up', curveStrengthToNext: 1.2, speedToNext: 0.85 } },
    { timeSec: 5, position: [-3.2, 2.4, 4.4], target: [0, 1.45, 0], options: { fov: 42, curveToNext: 'arc-right', curveStrengthToNext: 0.65, speedToNext: 1 } },
    { timeSec: 10, position: [-4.4, 4.6, 5.2], target: [0, 1.35, 0], options: { fov: 40, curveToNext: 'linear' } },
  ]),
  cinematicPreset('surveillance-wide', '监控广角俯看', '冷静的高位广角观察，适合动作前部署、空间关系和客观视角。', 10, [
    { timeSec: 0, position: [5.2, 5.8, 6.6], target: [0, 1.0, 0], options: { fov: 60, curveToNext: 'smooth', curveStrengthToNext: 0.18, speedToNext: 0.7 } },
    { timeSec: 5, position: [4.8, 5.6, 5.8], target: [0.2, 1.0, -0.1], options: { fov: 58, curveToNext: 'smooth', curveStrengthToNext: 0.12, speedToNext: 0.8 } },
    { timeSec: 10, position: [4.2, 5.4, 5.0], target: [0.3, 1.0, -0.2], options: { fov: 56, curveToNext: 'linear' } },
  ]),
]

export const getCinematicMovePreset = (
  presetId: string,
): CinematicMovePreset | undefined =>
  cinematicMovePresets.find((preset) => preset.id === presetId)

export const renderSettingsForPreset = (
  renderSettings: RenderSettings,
  preset: CinematicMovePreset,
): RenderSettings => ({
  ...renderSettings,
  durationSec: preset.durationSec,
})
