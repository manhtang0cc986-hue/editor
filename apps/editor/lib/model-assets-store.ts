import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type AssetInput, artifactUrl } from '@pascal-app/core'
import { DiskArtifactStore, resolveDefaultDatabasePath } from '@pascal-app/mcp/storage'
import { type ModelAssetForm, validateModelGlb } from './model-assets'

export async function listModelAssets(
  databasePath = resolveDefaultDatabasePath(),
): Promise<AssetInput[]> {
  const directory = `${databasePath}.models`
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return []
  })
  const assets = await Promise.all(
    names
      .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
      .map(async (name) => {
        const json = await readFile(join(directory, name), 'utf8')
        return JSON.parse(json) as AssetInput
      }),
  )
  return assets.sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveModelAsset(
  bytes: Uint8Array,
  metadata: ModelAssetForm,
  databasePath = resolveDefaultDatabasePath(),
): Promise<AssetInput> {
  validateModelGlb(bytes)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const id = createHash('sha256').update(hash).update(JSON.stringify(metadata)).digest('hex')
  const asset: AssetInput = {
    ...metadata,
    id: `custom-${id}`,
    src: artifactUrl(hash),
    source: 'mine',
    thumbnail: '',
    tags: ['floor'],
  }

  await new DiskArtifactStore(databasePath).put(hash, bytes)
  const directory = `${databasePath}.models`
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${randomUUID()}`)
  try {
    await writeFile(temporary, JSON.stringify(asset), { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(directory, `${id}.json`))
  } finally {
    await rm(temporary, { force: true })
  }
  return asset
}
