import cors from 'cors'
import express from 'express'
import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'
import multer from 'multer'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { builtInAssets } from '../src/scene/assets'
import {
  getImportedModelFormat,
  isBlendImportFilename,
  isZipImportFilename,
  loadableImportExtensions,
  supportedImportExtensions,
  supportedImportLabel,
} from '../src/scene/importedFormats'
import { normalizeRenderSettings, validateSceneDocument } from '../src/scene/validation'
import type { AssetDefinition, RenderJob, SceneDocument } from '../src/scene/types'

type InternalRenderJob = RenderJob & {
  absoluteOutputPath?: string
  propsPath?: string
}

const workspaceRoot = process.cwd()
const apiPort = Number(process.env.API_PORT ?? 5174)
const importDir = path.join(workspaceRoot, 'assets', 'imports')
const textureDir = path.join(workspaceRoot, 'assets', 'textures')
const exportDir = path.join(workspaceRoot, 'exports')
const jobsDir = path.join(workspaceRoot, 'tmp', 'render-jobs')
const jobs = new Map<string, InternalRenderJob>()
const execFile = promisify(execFileCallback)

let cachedBundleUrl: string | null = null

const ensureDirs = async () => {
  await Promise.all([
    mkdir(importDir, { recursive: true }),
    mkdir(textureDir, { recursive: true }),
    mkdir(exportDir, { recursive: true }),
    mkdir(jobsDir, { recursive: true }),
  ])
}

const safeBaseName = (name: string): string =>
  path
    .basename(name, path.extname(name))
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'asset'

const isSupportedModelFile = (filename: string): boolean =>
  supportedImportExtensions.includes(path.extname(filename).slice(1).toLowerCase())

const isLoadableModelFile = (filename: string): boolean =>
  loadableImportExtensions.includes(path.extname(filename).slice(1).toLowerCase())

const supportedTextureExtensions = ['.png', '.jpg', '.jpeg', '.webp']
const packageModelPriority = [
  '.glb',
  '.gltf',
  '.obj',
  '.fbx',
  '.dae',
  '.stl',
  '.ply',
  '.3mf',
  '.3ds',
  '.blend',
]

const isSupportedTextureFile = (filename: string): boolean =>
  supportedTextureExtensions.includes(path.extname(filename).toLowerCase())

const toUploadUrl = (relativePath: string): string =>
  `/uploads/${relativePath
    .split(path.sep)
    .map((part) => encodeURIComponent(part))
    .join('/')}`

const listFilesRecursive = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return listFilesRecursive(entryPath)
      }
      return [entryPath]
    }),
  )

  return files.flat()
}

const getImportedAssets = async (): Promise<AssetDefinition[]> => {
  await ensureDirs()
  const files = await listFilesRecursive(importDir)

  return files
    .filter(isLoadableModelFile)
    .sort((a, b) => a.localeCompare(b))
    .map((filePath) => {
      const relativePath = path.relative(importDir, filePath)
      const baseName = safeBaseName(path.basename(filePath))
      return {
        id: `import-${baseName}`,
        label: baseName,
        category: 'prop',
        kind: 'imported',
        url: toUploadUrl(relativePath),
        format: getImportedModelFormat(filePath),
        dimensions: [1, 1, 1],
      }
    })
}

const getImportedAssetDeleteTarget = (asset: AssetDefinition): string | null => {
  if (!asset.url?.startsWith('/uploads/')) {
    return null
  }

  const relativePath = decodeURIComponent(asset.url.slice('/uploads/'.length))
  const parts = relativePath.split('/').filter((part) => part && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) {
    return null
  }

  const target = path.resolve(importDir, parts.length > 1 ? parts[0] : parts[0])
  const importRoot = path.resolve(importDir)
  if (target !== importRoot && target.startsWith(`${importRoot}${path.sep}`)) {
    return target
  }

  return null
}

const publicJob = (job: InternalRenderJob): RenderJob => ({
  id: job.id,
  status: job.status,
  progress: job.progress,
  outputPath: job.outputPath,
  downloadUrl: job.downloadUrl,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
})

const findBlenderBinary = async (): Promise<string | null> => {
  const configured = process.env.BLENDER_BIN?.trim()
  if (configured && existsSync(configured)) {
    return configured
  }

  try {
    const { stdout } = await execFile('/usr/bin/which', ['blender'], { timeout: 5000 })
    const resolved = stdout.trim()
    if (resolved) {
      return resolved
    }
  } catch {
  }

  const appBundleBinary = '/Applications/Blender.app/Contents/MacOS/Blender'
  return existsSync(appBundleBinary) ? appBundleBinary : null
}

const convertBlendToGlb = async (sourcePath: string, targetPath: string) => {
  const blenderBinary = await findBlenderBinary()
  if (!blenderBinary) {
    throw new Error(
      '当前系统未检测到 Blender 命令行。.blend 文件需要安装 Blender 后自动转成 GLB，或先在 Blender 中导出 GLB/GLTF 再导入。',
    )
  }

  await mkdir(jobsDir, { recursive: true })
  const scriptPath = path.join(jobsDir, `${safeBaseName(sourcePath)}-convert.py`)
  await writeFile(
    scriptPath,
    [
      'import bpy',
      'import sys',
      'source_path = sys.argv[-2]',
      'target_path = sys.argv[-1]',
      'bpy.ops.wm.open_mainfile(filepath=source_path)',
      "bpy.ops.export_scene.gltf(filepath=target_path, export_format='GLB')",
    ].join('\n'),
    'utf8',
  )

  try {
    await execFile(
      blenderBinary,
      ['--background', '--python', scriptPath, '--', sourcePath, targetPath],
      { timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
    )
    if (!existsSync(targetPath)) {
      throw new Error('Blender 未生成 GLB 文件。')
    }
  } finally {
    await unlink(scriptPath).catch(() => undefined)
  }
}

type ZipEntry = {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const findEndOfCentralDirectory = (buffer: Buffer): number => {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index
    }
  }

  throw new Error('ZIP 资产包无法读取，请确认文件未损坏。')
}

const parseZipEntries = (buffer: Buffer): ZipEntry[] => {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  let offset = buffer.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('ZIP 资产包目录结构异常。')
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const filenameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + filenameLength)

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })
    offset += 46 + filenameLength + extraLength + commentLength
  }

  return entries
}

const zipEntryRelativePath = (name: string): string | null => {
  const normalized = name.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    return null
  }

  const parts = normalized.split('/').filter((part) => part && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) {
    return null
  }

  if (parts[0] === '__MACOSX' || path.posix.basename(parts[parts.length - 1]).startsWith('.')) {
    return null
  }

  return parts.join('/')
}

const unzipEntryData = (buffer: Buffer, entry: ZipEntry): Buffer => {
  const offset = entry.localHeaderOffset
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('ZIP 资产包文件头异常。')
  }

  const filenameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + filenameLength + extraLength
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize)

  if (entry.compressionMethod === 0) {
    return compressed
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed)
  }

  throw new Error('ZIP 资产包包含不支持的压缩方式。请重新压缩为标准 zip。')
}

const findPackageModel = async (packageDir: string): Promise<string | null> => {
  const files = await listFilesRecursive(packageDir)
  const candidates = files.filter((filePath) =>
    [...loadableImportExtensions, 'blend'].includes(
      path.extname(filePath).slice(1).toLowerCase(),
    ),
  )

  if (candidates.length === 0) {
    return null
  }

  return candidates.sort((a, b) => {
    const rankA = packageModelPriority.indexOf(path.extname(a).toLowerCase())
    const rankB = packageModelPriority.indexOf(path.extname(b).toLowerCase())
    const safeRankA = rankA === -1 ? packageModelPriority.length : rankA
    const safeRankB = rankB === -1 ? packageModelPriority.length : rankB

    if (safeRankA !== safeRankB) {
      return safeRankA - safeRankB
    }

    const depthA = path.relative(packageDir, a).split(path.sep).length
    const depthB = path.relative(packageDir, b).split(path.sep).length
    return depthA === depthB ? a.localeCompare(b) : depthA - depthB
  })[0]
}

const extractModelPackage = async (
  zipPath: string,
  packageDir: string,
): Promise<string> => {
  await rm(packageDir, { recursive: true, force: true })
  await mkdir(packageDir, { recursive: true })
  const zipBuffer = await readFile(zipPath)
  const entries = parseZipEntries(zipBuffer)
  let totalUncompressed = 0

  for (const entry of entries) {
    if (entry.name.endsWith('/')) {
      continue
    }

    const relativePath = zipEntryRelativePath(entry.name)
    if (!relativePath) {
      continue
    }

    totalUncompressed += entry.uncompressedSize
    if (totalUncompressed > 300 * 1024 * 1024) {
      throw new Error('ZIP 资产包解压后超过 300MB，请改用低分辨率或单个 GLB/GLTF 文件。')
    }

    const targetPath = path.resolve(packageDir, relativePath)
    const packageRoot = path.resolve(packageDir)
    if (targetPath !== packageRoot && !targetPath.startsWith(`${packageRoot}${path.sep}`)) {
      continue
    }

    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, unzipEntryData(zipBuffer, entry))
  }

  const mainModel = await findPackageModel(packageDir)
  if (!mainModel) {
    throw new Error('ZIP 资产包中未找到可导入模型文件。请包含 GLB/GLTF/OBJ/FBX/DAE/STL/PLY/3MF/3DS 或 BLEND。')
  }

  if (isBlendImportFilename(mainModel)) {
    const glbPath = `${mainModel.slice(0, -path.extname(mainModel).length)}.glb`
    await convertBlendToGlb(mainModel, glbPath)
    await unlink(mainModel).catch(() => undefined)
    return glbPath
  }

  return mainModel
}

const updateJob = (id: string, patch: Partial<InternalRenderJob>) => {
  const current = jobs.get(id)
  if (!current) {
    return
  }

  jobs.set(id, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

const getBundleUrl = async (jobId: string): Promise<string> => {
  if (cachedBundleUrl) {
    return cachedBundleUrl
  }

  const entryPoint = path.join(workspaceRoot, 'src', 'remotion', 'index.ts')
  cachedBundleUrl = await bundle({
    entryPoint,
    onProgress: (progress) =>
      updateJob(jobId, {
        status: 'rendering',
        progress: Math.max(0.02, Math.min(0.12, progress * 0.12)),
      }),
  })

  return cachedBundleUrl
}

const hydrateSceneForRender = (scene: SceneDocument): SceneDocument => {
  const origin = `http://127.0.0.1:${apiPort}`

  return {
    ...scene,
    renderSettings: normalizeRenderSettings(scene.renderSettings),
    objects: scene.objects.map((object) => {
      const url = object.metadata?.url
      const textureUrl = object.metadata?.textureUrl
      if (!url?.startsWith('/uploads/') && !textureUrl?.startsWith('/textures/')) {
        return object
      }

      return {
        ...object,
        metadata: {
          ...object.metadata,
          url: url?.startsWith('/uploads/') ? `${origin}${url}` : url,
          textureUrl: textureUrl?.startsWith('/textures/')
            ? `${origin}${textureUrl}`
            : textureUrl,
        },
      }
    }),
  }
}

const runRenderJob = async (jobId: string, scene: SceneDocument) => {
  const outputPath = path.join(exportDir, `${jobId}.mp4`)
  const propsPath = path.join(jobsDir, `${jobId}.json`)
  const inputProps = hydrateSceneForRender(scene)

  try {
    updateJob(jobId, {
      status: 'rendering',
      progress: 0.01,
      propsPath,
      absoluteOutputPath: outputPath,
      outputPath,
    })

    await writeFile(propsPath, JSON.stringify(inputProps, null, 2), 'utf8')

    const serveUrl = await getBundleUrl(jobId)
    const inputPropsRecord = inputProps as unknown as Record<string, unknown>
    const composition = await selectComposition({
      serveUrl,
      id: 'GoblenderShot',
      inputProps: inputPropsRecord,
    })

    await renderMedia({
      serveUrl,
      composition,
      inputProps: inputPropsRecord,
      codec: 'h264',
      outputLocation: outputPath,
      overwrite: true,
      onProgress: (progress) =>
        updateJob(jobId, {
          status: 'rendering',
          progress: Math.max(0.12, Math.min(0.99, 0.12 + progress.progress * 0.87)),
        }),
    })

    updateJob(jobId, {
      status: 'completed',
      progress: 1,
      outputPath,
      absoluteOutputPath: outputPath,
      downloadUrl: `/api/render-jobs/${jobId}/download`,
    })
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      progress: 1,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    mkdirSync(importDir, { recursive: true })
    callback(null, importDir)
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase()
    const filename = `${safeBaseName(file.originalname)}-${Date.now()}${extension}`
    callback(null, filename)
  },
})

const upload = multer({
  storage,
  fileFilter: (_request, file, callback) => {
    if (!isSupportedModelFile(file.originalname)) {
      callback(new Error(`Only ${supportedImportLabel} files can be imported.`))
      return
    }

    callback(null, true)
  },
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
})

const textureStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    mkdirSync(textureDir, { recursive: true })
    callback(null, textureDir)
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase()
    const filename = `${safeBaseName(file.originalname)}-${Date.now()}${extension}`
    callback(null, filename)
  },
})

const textureUpload = multer({
  storage: textureStorage,
  fileFilter: (_request, file, callback) => {
    if (!isSupportedTextureFile(file.originalname)) {
      callback(new Error('Only PNG, JPG, JPEG and WebP images can be used as textures.'))
      return
    }

    callback(null, true)
  },
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
})

export const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use('/uploads', express.static(importDir))
app.use('/textures', express.static(textureDir))
app.use('/exports', express.static(exportDir))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/assets', async (_request, response, next) => {
  try {
    const importedAssets = await getImportedAssets()
    response.json([...builtInAssets, ...importedAssets])
  } catch (error) {
    next(error)
  }
})

app.post('/api/assets/import', upload.single('asset'), async (request, response) => {
  if (!request.file) {
    response.status(400).send('No asset file uploaded.')
    return
  }

  let filePath = request.file.path
  if (isZipImportFilename(request.file.filename)) {
    const packageDir = path.join(
      importDir,
      path.basename(request.file.filename, path.extname(request.file.filename)),
    )
    try {
      filePath = await extractModelPackage(request.file.path, packageDir)
    } finally {
      await unlink(request.file.path).catch(() => undefined)
    }
  } else if (isBlendImportFilename(request.file.filename)) {
    const glbFilename = `${path.basename(
      request.file.filename,
      path.extname(request.file.filename),
    )}.glb`
    const glbPath = path.join(importDir, glbFilename)
    await convertBlendToGlb(request.file.path, glbPath)
    await unlink(request.file.path).catch(() => undefined)
    filePath = glbPath
  }
  const relativePath = path.relative(importDir, filePath)
  const baseName = safeBaseName(path.basename(filePath))
  const asset: AssetDefinition = {
    id: `import-${baseName}`,
    label: safeBaseName(request.file.originalname),
    category: 'prop',
    kind: 'imported',
    url: toUploadUrl(relativePath),
    format: getImportedModelFormat(filePath),
    dimensions: [1, 1, 1],
  }

  response.status(201).json(asset)
})

app.delete('/api/assets/:assetId', async (request, response, next) => {
  try {
    const importedAssets = await getImportedAssets()
    const asset = importedAssets.find((candidate) => candidate.id === request.params.assetId)

    if (!asset) {
      response.status(404).send('Imported asset not found.')
      return
    }

    const target = getImportedAssetDeleteTarget(asset)
    if (!target) {
      response.status(404).send('Imported asset not found.')
      return
    }

    await rm(target, { recursive: true, force: true })
    response.sendStatus(204)
  } catch (error) {
    next(error)
  }
})

app.post('/api/textures/import', textureUpload.single('texture'), async (request, response) => {
  if (!request.file) {
    response.status(400).send('No texture file uploaded.')
    return
  }

  response.status(201).json({
    name: safeBaseName(request.file.originalname),
    url: `/textures/${request.file.filename}`,
  })
})

app.post('/api/render-jobs', async (request, response) => {
  let scene: SceneDocument

  try {
    scene = validateSceneDocument(request.body)
  } catch (error) {
    response
      .status(400)
      .send(`Invalid scene document. ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const id = `render-${randomUUID()}`
  const now = new Date().toISOString()
  const job: InternalRenderJob = {
    id,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  }

  jobs.set(id, job)
  response.status(202).json(publicJob(job))
  void runRenderJob(id, scene)
})

app.get('/api/render-jobs/:id', (request, response) => {
  const job = jobs.get(request.params.id)

  if (!job) {
    response.status(404).send('Render job not found.')
    return
  }

  response.json(publicJob(job))
})

app.get('/api/render-jobs/:id/download', (request, response) => {
  const job = jobs.get(request.params.id)

  if (!job?.absoluteOutputPath || !existsSync(job.absoluteOutputPath)) {
    response.status(404).send('Rendered file not found.')
    return
  }

  response.download(job.absoluteOutputPath)
})

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = error instanceof Error ? error.message : String(error)
    const status =
      error instanceof multer.MulterError ||
      message.includes('files can be imported') ||
      message.includes('images can be used as textures') ||
      message.includes('.blend') ||
      message.includes('Blender 命令行')
        ? 400
        : 500

    response
      .status(status)
      .send(message)
  },
)

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await ensureDirs()
  const server = createServer(app)
  server.listen(apiPort, '127.0.0.1', () => {
    console.log(`井鸽AI影视套件 API listening on http://127.0.0.1:${apiPort}`)
  })
}
