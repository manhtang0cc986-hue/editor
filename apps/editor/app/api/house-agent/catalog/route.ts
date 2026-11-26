import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type LocalCatalogManifest = {
  items: Record<string, { thumbnail?: string; src?: string }>
  materials: Record<string, string>
}

let cachedManifest: LocalCatalogManifest | null = null

function resolvePublicDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'apps', 'editor', 'public'),
  ]
  return candidates.find((dir) => existsSync(path.join(dir, 'items'))) ?? null
}

function scanLocalAssets(): LocalCatalogManifest {
  if (cachedManifest) return cachedManifest
  const publicDir = resolvePublicDir()
  if (!publicDir) {
    cachedManifest = { items: {}, materials: {} }
    return cachedManifest
  }

  const items: LocalCatalogManifest['items'] = {}
  const itemsDir = path.join(publicDir, 'items')
  if (existsSync(itemsDir)) {
    for (const entry of readdirSync(itemsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const itemDir = path.join(itemsDir, entry.name)
      const files = readdirSync(itemDir)
      const thumb =
        files.find((file) => file === 'thumbnail.webp') ??
        files.find((file) => file === 'thumbnail.png') ??
        files.find((file) => file.startsWith('thumbnail.'))
      const glb =
        files.find((file) => file === 'model.glb') ?? files.find((file) => file.endsWith('.glb'))
      if (thumb || glb) {
        items[entry.name] = {
          ...(thumb ? { thumbnail: `/items/${entry.name}/${thumb}` } : {}),
          ...(glb ? { src: `/items/${entry.name}/${glb}` } : {}),
        }
      }
    }
  }

  const materials: LocalCatalogManifest['materials'] = {}
  const materialDir = path.join(publicDir, 'material')
  if (existsSync(materialDir)) {
    for (const category of readdirSync(materialDir, { withFileTypes: true })) {
      if (!category.isDirectory()) continue
      const catDir = path.join(materialDir, category.name)
      for (const mat of readdirSync(catDir, { withFileTypes: true })) {
        if (!mat.isDirectory()) continue
        const matPath = path.join(catDir, mat.name)
        const files = readdirSync(matPath)
        const preview =
          files.find((file) => file.endsWith('_thumb.webp')) ??
          files.find((file) => file.endsWith('_basecolor.webp')) ??
          files.find((file) => file.endsWith('_albedo.webp')) ??
          files.find((file) => /\.(webp|png|jpe?g)$/i.test(file))
        if (preview) {
          materials[`/material/${category.name}/${mat.name}`] =
            `/material/${category.name}/${mat.name}/${preview}`
        }
      }
    }
  }

  cachedManifest = { items, materials }
  return cachedManifest
}

export function GET() {
  return Response.json(scanLocalAssets(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
