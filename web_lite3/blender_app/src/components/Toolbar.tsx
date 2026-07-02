import { useRef } from 'react'
import { Download, FileUp, Moon, Sun, Undo2 } from 'lucide-react'

export type UiTheme = 'dark' | 'light'

type ToolbarProps = {
  panelTheme: UiTheme
  spaceTheme: UiTheme
  canUndo: boolean
  onUndo: () => void
  onSaveLocalDocument: () => void
  onLoadLocalDocument: (file: File) => void | Promise<void>
  onTogglePanelTheme: () => void
  onToggleSpaceTheme: () => void
}

export const Toolbar = ({
  panelTheme,
  spaceTheme,
  canUndo,
  onUndo,
  onSaveLocalDocument,
  onLoadLocalDocument,
  onTogglePanelTheme,
  onToggleSpaceTheme,
}: ToolbarProps) => {
  const localSceneInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <header className="top-toolbar">
      <div className="brand-block">
        <div>
          <h1><strong>井鸽</strong>AI视觉专业套件</h1>
          <span>白模虚拟拍摄</span>
        </div>
      </div>
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
          onClick={() => localSceneInputRef.current?.click()}
        >
          <FileUp size={16} />
          <span>载入文件</span>
        </button>
        <input
          ref={localSceneInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) {
              void onLoadLocalDocument(file)
            }
            event.currentTarget.value = ''
          }}
        />
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
