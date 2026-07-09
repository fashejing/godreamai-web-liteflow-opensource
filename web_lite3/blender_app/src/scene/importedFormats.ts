import type { ImportedModelFormat } from './types'

export const importedModelFormats: Array<{
  format: ImportedModelFormat
  extensions: string[]
  label: string
}> = [
  { format: 'gltf', extensions: ['glb', 'gltf'], label: 'GLB/GLTF' },
  { format: 'obj', extensions: ['obj'], label: 'OBJ' },
  { format: 'stl', extensions: ['stl'], label: 'STL' },
  { format: 'fbx', extensions: ['fbx'], label: 'FBX' },
  { format: 'dae', extensions: ['dae'], label: 'DAE/Collada' },
  { format: 'ply', extensions: ['ply'], label: 'PLY' },
  { format: '3mf', extensions: ['3mf'], label: '3MF' },
  { format: '3ds', extensions: ['3ds'], label: '3DS' },
]

export const loadableImportExtensions = importedModelFormats.flatMap(
  (item) => item.extensions,
)

export const blendImportExtension = 'blend'
export const zipImportExtension = 'zip'

export const supportedImportExtensions = [
  ...loadableImportExtensions,
  blendImportExtension,
  zipImportExtension,
]

export const supportedImportAccept = supportedImportExtensions
  .map((extension) => `.${extension}`)
  .join(',')

export const supportedImportLabel = importedModelFormats
  .map((item) => item.label)
  .concat('BLEND', 'ZIP')
  .join(' / ')

export const isBlendImportFilename = (filename: string): boolean =>
  filename.split('.').pop()?.toLowerCase() === blendImportExtension

export const isZipImportFilename = (filename: string): boolean =>
  filename.split('.').pop()?.toLowerCase() === zipImportExtension

export const getImportedModelFormat = (
  filename: string,
): ImportedModelFormat | undefined => {
  const extension = filename.split('.').pop()?.toLowerCase()
  return importedModelFormats.find((item) =>
    item.extensions.includes(extension ?? ''),
  )?.format
}
