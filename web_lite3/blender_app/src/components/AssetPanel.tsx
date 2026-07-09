import { Box, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { assetCategoryLabels } from '../scene/assets'
import { supportedImportAccept, supportedImportLabel } from '../scene/importedFormats'
import type { AssetCategory, AssetDefinition } from '../scene/types'

type AssetPanelProps = {
  assets: AssetDefinition[]
  selectedAssetId: string
  importing: boolean
  tools?: ReactNode
  onSelectAsset: (assetId: string) => void
  onAddAsset: (assetId: string) => void
  onDeleteImportedAsset: (assetId: string) => void
  onImportAsset: (file: File) => void
}

const categories: AssetCategory[] = [
  'character',
  'vehicle',
  'aircraft',
  'building',
  'plant',
  'prop',
]

const beginnerCategoryLabels: Record<AssetCategory, string> = {
  character: '人物',
  building: '建筑',
  plant: '植物',
  prop: '道具',
  vehicle: '载具',
  aircraft: '飞行器',
  camera: '镜头',
}

export const AssetPanel = ({
  assets,
  selectedAssetId,
  importing,
  tools,
  onSelectAsset,
  onAddAsset,
  onDeleteImportedAsset,
  onImportAsset,
}: AssetPanelProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return assets
    }

    return assets.filter((asset) =>
      `${asset.label} ${asset.category}`.toLowerCase().includes(normalizedQuery),
    )
  }, [assets, query])

  return (
    <aside className="panel asset-panel" aria-label="白模库">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">资产</span>
          <h2>白模库</h2>
        </div>
        <button
          type="button"
          className="asset-import-button"
          title={`支持：${supportedImportLabel}`}
          onClick={() => inputRef.current?.click()}
          disabled={importing}
        >
          <Upload size={15} />
          {importing ? '导入中' : '导入3D模型'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={supportedImportAccept}
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''

            if (file) {
              onImportAsset(file)
            }
          }}
        />
      </div>

      <div className="asset-scroll">
        {tools}

        <label className="search-field">
          <Search size={14} />
          <input
            value={query}
            placeholder="搜索人物、车、飞机、绿幕"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="place-selected-action"
          onClick={() => onAddAsset(selectedAssetId)}
        >
          <Plus size={15} />
          放入选中的白模
        </button>

        <div className="asset-groups">
          {categories.map((category) => {
            const groupAssets = filteredAssets.filter(
              (asset) => asset.category === category,
            )

            if (groupAssets.length === 0) {
              return null
            }

            return (
              <section key={category} className="asset-group">
                <div className="asset-group-title">
                  <span>{beginnerCategoryLabels[category] ?? assetCategoryLabels[category]}</span>
                  <span>{groupAssets.length}</span>
                </div>
                <div className="asset-list">
                  {groupAssets.map((asset) => (
                    <div
                      key={asset.id}
                      role="button"
                      tabIndex={0}
                      className={`asset-row ${
                        selectedAssetId === asset.id ? 'is-selected' : ''
                      }`}
                      onClick={() => onSelectAsset(asset.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectAsset(asset.id)
                        }
                      }}
                      onDoubleClick={() => onAddAsset(asset.id)}
                    >
                      <span className="asset-thumb">
                        <Box size={16} />
                      </span>
                      <span className="asset-name">{asset.label}</span>
                      <span className="asset-kind">
                        {asset.kind === 'imported' ? '导入' : '内置'}
                      </span>
                      {asset.kind === 'imported' ? (
                        <button
                          type="button"
                          className="asset-delete"
                          title={`删除导入模型 ${asset.label}`}
                          aria-label={`删除导入模型 ${asset.label}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteImportedAsset(asset.id)
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="asset-add"
                        title={`放入 ${asset.label}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onAddAsset(asset.id)
                        }}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
