'use client'

import { MATERIAL_CATALOG, type MaterialCatalogItem } from '@pascal-app/core'
import { CATALOG_ITEMS } from '@pascal-app/editor'
import type { LocalCatalogManifest } from '@/app/api/house-agent/catalog/route'

export type CatalogItem = (typeof CATALOG_ITEMS)[number]

let manifestPromise: Promise<LocalCatalogManifest> | null = null
let cachedManifest: LocalCatalogManifest | null = null

export async function loadLocalCatalogManifest(): Promise<LocalCatalogManifest> {
  if (cachedManifest) return cachedManifest
  if (!manifestPromise) {
    manifestPromise = fetch('/api/house-agent/catalog', { signal: AbortSignal.timeout(8000) })
      .then(async (response) => {
        if (!response.ok) return { items: {}, materials: {} }
        const data = (await response.json()) as LocalCatalogManifest
        cachedManifest = data
        return data
      })
      .catch(() => ({ items: {}, materials: {} }))
  }
  return manifestPromise
}

export function applyLocalCatalogManifest(
  items: readonly CatalogItem[],
  manifest: LocalCatalogManifest,
): CatalogItem[] {
  return items.map((item) => {
    const local = manifest.items[item.id]
    if (!local) return item
    return {
      ...item,
      ...(local.thumbnail ? { thumbnail: local.thumbnail } : {}),
      ...(local.src ? { src: local.src } : {}),
    }
  })
}

export async function getLocalAwareCatalog(): Promise<CatalogItem[]> {
  const manifest = await loadLocalCatalogManifest()
  return applyLocalCatalogManifest(CATALOG_ITEMS, manifest)
}

export function resolveMaterialPreviewPath(
  material: MaterialCatalogItem,
  manifest: LocalCatalogManifest,
): string | null {
  const thumb = material.previewThumbnailUrl
  if (!thumb) return null
  const parts = thumb.split('/')
  if (parts.length >= 4 && parts[1] === 'material') {
    const dirKey = `/material/${parts[2]}/${parts[3]}`
    if (manifest.materials[dirKey]) return manifest.materials[dirKey]
  }
  return thumb
}

export async function getLocalAwareMaterials(): Promise<
  Array<MaterialCatalogItem & { resolvedPreviewUrl: string | null }>
> {
  const manifest = await loadLocalCatalogManifest()
  return MATERIAL_CATALOG.map((material) => ({
    ...material,
    resolvedPreviewUrl: resolveMaterialPreviewPath(material, manifest),
  }))
}
