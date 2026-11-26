'use client'

import {
  type GuideNode,
  loadAssetUrl,
  type MaterialCatalogItem,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { Layers, Package, Palette, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  type CatalogItem,
  getLocalAwareCatalog,
  getLocalAwareMaterials,
} from '@/lib/house-agent-catalog'

export type PickedAssetAttachment = {
  name: string
  imageUrl?: string
  snippet: string
}

type MaterialWithPreview = MaterialCatalogItem & { resolvedPreviewUrl: string | null }

async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const resolved = await loadAssetUrl(url)
    if (!resolved) return null
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(resolved)) return resolved
    const response = await fetch(resolved, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, 768 / Math.max(1, longest))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/webp', 0.88)
  } catch {
    return null
  }
}

function colorSwatchDataUrl(hex: string): string | undefined {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = hex
    ctx.fillRect(0, 0, 128, 128)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

export function HouseAgentAssetPicker({
  onPick,
  onClose,
}: {
  onPick: (attachment: PickedAssetAttachment) => void
  onClose: () => void
}) {
  const i18n = usePascalI18n()
  const nodes = useScene((s) => s.nodes)
  const [tab, setTab] = useState<'guides' | 'items' | 'materials'>('items')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [materials, setMaterials] = useState<MaterialWithPreview[]>([])
  const [guidePreviews, setGuidePreviews] = useState<Record<string, string>>({})
  const [pickingId, setPickingId] = useState<string | null>(null)

  const guides = useMemo(
    () => Object.values(nodes).filter((node): node is GuideNode => node.type === 'guide'),
    [nodes],
  )

  useEffect(() => {
    let active = true
    void getLocalAwareCatalog().then((loaded) => {
      if (active) setItems(loaded)
    })
    void getLocalAwareMaterials().then((loaded) => {
      if (active) setMaterials(loaded)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (tab !== 'guides') return
    let active = true
    for (const guide of guides.slice(0, 8)) {
      if (guidePreviews[guide.id]) continue
      void imageUrlToDataUrl(guide.url).then((dataUrl) => {
        if (active && dataUrl) {
          setGuidePreviews((prev) => ({ ...prev, [guide.id]: dataUrl }))
        }
      })
    }
    return () => {
      active = false
    }
  }, [tab, guides, guidePreviews])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? items.filter((item) =>
          `${item.id} ${item.name} ${item.category} ${(item.tags ?? []).join(' ')}`
            .toLowerCase()
            .includes(q),
        )
      : items
    return list.slice(0, 36)
  }, [items, query])

  const filteredMaterials = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? materials.filter((mat) =>
          `${mat.id} ${mat.label} ${mat.category} ${(mat.surfaces ?? []).join(' ')}`
            .toLowerCase()
            .includes(q),
        )
      : materials
    return list.slice(0, 36)
  }, [materials, query])

  return (
    <div className="space-y-2 rounded-xl border border-white/15 bg-zinc-900/95 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab('guides')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 ${
              tab === 'guides' ? 'bg-sky-600 text-white' : 'text-zinc-300 hover:bg-white/10'
            }`}
          >
            <Layers size={12} />
            {i18n._({ id: 'app.houseAgent.picker.guides', message: 'Scene Guides' })} (
            {guides.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('items')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 ${
              tab === 'items' ? 'bg-sky-600 text-white' : 'text-zinc-300 hover:bg-white/10'
            }`}
          >
            <Package size={12} />
            {i18n._({ id: 'app.houseAgent.picker.items', message: '3D Assets' })}
          </button>
          <button
            type="button"
            onClick={() => setTab('materials')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 ${
              tab === 'materials' ? 'bg-sky-600 text-white' : 'text-zinc-300 hover:bg-white/10'
            }`}
          >
            <Palette size={12} />
            {i18n._({ id: 'app.houseAgent.picker.materials', message: 'Materials' })}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={i18n._({ id: 'app.houseAgent.picker.close', message: 'Close asset picker' })}
          className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {tab !== 'guides' && (
        <div className="relative">
          <Search size={13} className="absolute top-2 left-2.5 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={i18n._({
              id: 'app.houseAgent.picker.search',
              message: 'Search assets or materials (e.g. bed, sofa, wood)…',
            })}
            className="w-full rounded-lg border border-white/10 bg-black/40 py-1.5 pr-2 pl-7 text-xs outline-none focus:border-sky-500"
          />
        </div>
      )}

      <div className="max-h-48 overflow-y-auto pr-1">
        {tab === 'guides' && (
          <div className="space-y-1.5">
            {guides.length === 0 ? (
              <p className="py-4 text-center text-zinc-400">
                {i18n._({
                  id: 'app.houseAgent.picker.noGuides',
                  message: 'No floor-plan guides in the scene yet.',
                })}
              </p>
            ) : (
              guides.map((guide) => (
                <button
                  key={guide.id}
                  type="button"
                  disabled={pickingId === guide.id}
                  onClick={async () => {
                    setPickingId(guide.id)
                    const guideName = guide.name ?? guide.id
                    const imageUrl = guidePreviews[guide.id] ?? (await imageUrlToDataUrl(guide.url))
                    const scaleInfo = guide.scaleReference
                      ? `, scale ${guide.scaleReference.realLengthMeters}m (${guide.scaleReference.displayUnit ?? 'meters'})`
                      : ''
                    onPick({
                      name: guideName,
                      ...(imageUrl ? { imageUrl } : {}),
                      snippet: `[scene guide: ${guideName} (${guide.id})${scaleInfo}]`,
                    })
                    setPickingId(null)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-1.5 text-left hover:bg-white/10"
                >
                  {guidePreviews[guide.id] ? (
                    <img
                      src={guidePreviews[guide.id]}
                      alt={guide.name}
                      className="h-10 w-12 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded bg-black/40 text-zinc-500">
                      <Layers size={14} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-100">{guide.name}</p>
                    <p className="truncate text-[10px] text-zinc-400">
                      {guide.scaleReference
                        ? `${guide.scaleReference.realLengthMeters} m · ${guide.scaleReference.label}`
                        : i18n._({
                            id: 'app.houseAgent.picker.uncalibrated',
                            message: 'Uncalibrated guide image',
                          })}
                    </p>
                  </div>
                  <Plus size={14} className="shrink-0 text-sky-400" />
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'items' && (
          <div className="grid grid-cols-2 gap-1.5">
            {filteredItems.map((item) => {
              const dims = (item.dimensions ?? [1, 1, 1]).map(
                (n: number) => Math.round(n * 100) / 100,
              )
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={pickingId === item.id}
                  onClick={async () => {
                    setPickingId(item.id)
                    const imageUrl = item.thumbnail
                      ? await imageUrlToDataUrl(item.thumbnail)
                      : undefined
                    onPick({
                      name: item.name,
                      ...(imageUrl ? { imageUrl } : {}),
                      snippet: `[asset: ${item.id} (${item.name}, ${dims.join('×')}m)]`,
                    })
                    setPickingId(null)
                  }}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-1.5 text-left hover:bg-white/10"
                >
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.name}
                      className="h-9 w-9 shrink-0 rounded bg-black/40 object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-black/40 text-zinc-500">
                      <Package size={13} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[11px] text-zinc-100">{item.name}</p>
                    <p className="truncate font-mono text-[10px] text-zinc-400">
                      {dims.join('×')}m
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {tab === 'materials' && (
          <div className="grid grid-cols-2 gap-1.5">
            {filteredMaterials.map((mat) => (
              <button
                key={mat.id}
                type="button"
                disabled={pickingId === mat.id}
                onClick={async () => {
                  setPickingId(mat.id)
                  const imageUrl = mat.resolvedPreviewUrl
                    ? await imageUrlToDataUrl(mat.resolvedPreviewUrl)
                    : mat.previewColor
                      ? colorSwatchDataUrl(mat.previewColor)
                      : undefined
                  onPick({
                    name: mat.label,
                    ...(imageUrl ? { imageUrl } : {}),
                    snippet: `[material: library:${mat.id} (${mat.label})]`,
                  })
                  setPickingId(null)
                }}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-1.5 text-left hover:bg-white/10"
              >
                {mat.resolvedPreviewUrl ? (
                  <img
                    src={mat.resolvedPreviewUrl}
                    alt={mat.label}
                    className="h-8 w-8 shrink-0 rounded border border-white/15 object-cover"
                  />
                ) : (
                  <span
                    className="h-8 w-8 shrink-0 rounded border border-white/15"
                    style={{ backgroundColor: mat.previewColor ?? '#888888' }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[11px] text-zinc-100">{mat.label}</p>
                  <p className="truncate font-mono text-[10px] text-zinc-400">{mat.category}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
