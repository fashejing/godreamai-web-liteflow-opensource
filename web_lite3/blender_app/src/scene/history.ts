import type { SceneDocument } from './types'

export const SCENE_HISTORY_LIMIT = 80

export const pushSceneHistory = (
  history: SceneDocument[],
  scene: SceneDocument,
  limit = SCENE_HISTORY_LIMIT,
): SceneDocument[] => [...history.slice(Math.max(0, history.length - limit + 1)), scene]

export const popSceneHistory = (
  history: SceneDocument[],
): { previousScene: SceneDocument | null; history: SceneDocument[] } => {
  const previousScene = history[history.length - 1] ?? null

  if (!previousScene) {
    return { previousScene: null, history }
  }

  return {
    previousScene,
    history: history.slice(0, -1),
  }
}
