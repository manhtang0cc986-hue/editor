'use client'

import { type AssetInput, artifactHash, usePascalI18n } from '@pascal-app/core'
import { activateCatalogItem, ItemsPanel } from '@pascal-app/editor'
import { Box, Sparkles, Upload } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_MODEL_BYTES,
  MAX_REFERENCE_BYTES,
  MODEL_ASSETS_URL,
  MODEL_GENERATION_URL,
  ModelAssetForm,
  validateModelGlb,
} from '@/lib/model-assets'
import type { ModelBounds } from './model-asset-preview'

const ModelAssetPreview = dynamic(
  () => import('./model-asset-preview').then((module) => module.ModelAssetPreview),
  { ssr: false },
)

type Job = { taskId: string; stage: 'preview' | 'refine' | 'image' }
const JOB_KEY = 'pascal.meshy.job'
const input = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm'
const button =
  'rounded-md border border-border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-45'

function pendingJob(): Job | null {
  try {
    const job = JSON.parse(sessionStorage.getItem(JOB_KEY) ?? 'null') as Job | null
    return job &&
      /^[A-Za-z0-9_-]{1,100}$/.test(job.taskId) &&
      ['preview', 'refine', 'image'].includes(job.stage)
      ? job
      : null
  } catch {
    return null
  }
}

async function assertOk(response: Response) {
  if (response.ok) return response
  const error = await response.json().catch(() => null)
  throw new Error(error?.error || `Request failed (HTTP ${response.status}).`)
}

async function generate(action: object, signal: AbortSignal) {
  return assertOk(
    await fetch(MODEL_GENERATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
      signal,
    }),
  )
}

function readReference(file: File): Promise<string> {
  if (
    file.size > MAX_REFERENCE_BYTES ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
  ) {
    throw new Error('Choose a PNG, JPEG or WebP image smaller than 5 MB.')
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the reference image.'))
    reader.readAsDataURL(file)
  })
}

export function ModelAssetsPanel() {
  const i18n = usePascalI18n()
  const [tab, setTab] = useState<'library' | 'mine'>('library')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-2 border-b border-border p-2">
        <button
          type="button"
          aria-pressed={tab === 'library'}
          className={`${button} aria-pressed:bg-accent`}
          onClick={() => setTab('library')}
        >
          {i18n._({ id: 'app.modelAssets.catalog', message: 'Catalog' })}
        </button>
        <button
          type="button"
          aria-pressed={tab === 'mine'}
          className={`${button} aria-pressed:bg-accent`}
          onClick={() => setTab('mine')}
        >
          {i18n._({ id: 'app.modelAssets.mine', message: 'My models' })}
        </button>
      </div>
      <div className="min-h-0 flex-1" hidden={tab !== 'library'}>
        <ItemsPanel showSourceFilter={false} showTagFilters={false} />
      </div>
      {tab === 'mine' && <PersonalModels />}
    </div>
  )
}

function PersonalModels() {
  const i18n = usePascalI18n()
  const [assets, setAssets] = useState<AssetInput[]>([])
  const [configured, setConfigured] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [reference, setReference] = useState<File | null>(null)
  const [upload, setUpload] = useState<Blob | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<ModelAssetForm['category']>('furniture')
  const [width, setWidth] = useState('')
  const [bounds, setBounds] = useState<ModelBounds | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [savedPreview, setSavedPreview] = useState<AssetInput | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState(pendingJob)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const startRequest = useRef<AbortController | null>(null)

  const rememberJob = useCallback((next: Job | null) => {
    setJob(next)
    try {
      if (next) sessionStorage.setItem(JOB_KEY, JSON.stringify(next))
      else sessionStorage.removeItem(JOB_KEY)
    } catch {
      // Generation can continue while this panel is open.
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(MODEL_ASSETS_URL, { signal: controller.signal })
      .then(assertOk)
      .then((response) => response.json())
      .then(setAssets)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error))
      })
    void fetch(MODEL_GENERATION_URL, { signal: controller.signal })
      .then(assertOk)
      .then((response) => response.json())
      .then((result) => setConfigured(result.configured === true))
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error))
      })
    return () => {
      controller.abort()
      startRequest.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!upload) return
    const url = URL.createObjectURL(upload)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [upload])

  useEffect(() => {
    if (!job || paused) return
    const controller = new AbortController()
    const { signal } = controller
    const kind = job.stage === 'image' ? 'image' : 'text'
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await generate({ action: 'status', kind, taskId: job.taskId }, signal)
        const status = await response.json()
        if (signal.aborted) return
        setProgress(status.progress)
        if (status.status === 'PENDING' || status.status === 'IN_PROGRESS') {
          timer = setTimeout(() => void poll(), 4000)
          return
        }
        if (status.status !== 'SUCCEEDED') {
          rememberJob(null)
          throw new Error(`Meshy generation ended with status ${status.status}.`)
        }
        if (job.stage === 'preview') {
          const next = await generate({ action: 'refine', taskId: job.taskId }, signal)
          const { taskId } = await next.json()
          if (!signal.aborted) {
            setProgress(0)
            rememberJob({ taskId, stage: 'refine' })
          }
          return
        }
        const result = await generate({ action: 'download', kind, taskId: job.taskId }, signal)
        const blob = await result.blob()
        if (signal.aborted) return
        setBounds(null)
        setSavedPreview(null)
        setUpload(blob)
        setName((previous) => previous || 'Meshy model')
        setWidth('')
        rememberJob(null)
      } catch (error) {
        if (!signal.aborted) {
          setPaused(true)
          setError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [job, paused, rememberJob])

  async function startGeneration() {
    if (job || startRequest.current) return
    const controller = new AbortController()
    startRequest.current = controller
    setBusy(true)
    setError('')
    setPaused(false)
    setProgress(0)
    try {
      const action = reference
        ? { action: 'create-image', image: await readReference(reference) }
        : { action: 'create-text', prompt: prompt.trim() }
      const response = await generate(action, controller.signal)
      const { taskId } = await response.json()
      rememberJob({ taskId, stage: reference ? 'image' : 'preview' })
      setName(prompt.trim().slice(0, 100))
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error))
    } finally {
      startRequest.current = null
      setBusy(false)
    }
  }

  async function selectUpload(file: File) {
    setError('')
    setBusy(true)
    try {
      if (file.size > MAX_MODEL_BYTES) throw new Error('GLB exceeds the 32 MB size limit.')
      validateModelGlb(new Uint8Array(await file.arrayBuffer()))
      setBounds(null)
      setSavedPreview(null)
      setUpload(file)
      setName(file.name.replace(/\.glb$/i, '').slice(0, 100))
      setWidth('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const receiveBounds = useCallback((next: ModelBounds) => {
    setBounds(next)
    setWidth((previous) => previous || String(Number(next.dimensions[0].toPrecision(4))))
  }, [])
  const onPreviewError = useCallback(() => {
    setBounds(null)
    setError('Could not preview this GLB.')
  }, [])

  async function save() {
    if (!upload || !bounds || busy) return
    setError('')
    setBusy(true)
    try {
      const factor = Number(width) / bounds.dimensions[0]
      const metadata = ModelAssetForm.parse({
        name,
        category,
        dimensions: bounds.dimensions.map((size) => size * factor),
        offset: bounds.offset.map((value) => value * factor),
        scale: [factor, factor, factor],
      })
      const response = await assertOk(
        await fetch(MODEL_ASSETS_URL, {
          method: 'POST',
          headers: {
            'x-model-metadata': encodeURIComponent(JSON.stringify(metadata)),
            'Content-Type': 'model/gltf-binary',
          },
          body: upload,
        }),
      )
      const asset: AssetInput = await response.json()
      setAssets((previous) =>
        [...previous.filter(({ id }) => id !== asset.id), asset].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setUpload(null)
      setPreviewUrl('')
      setSavedPreview(asset)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const sha = savedPreview ? artifactHash(savedPreview.src) : null
  const activePreview = upload ? previewUrl : sha ? `/api/artifacts/${sha}` : ''
  const generating = job !== null

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 hover:bg-accent">
        <Upload size={15} />
        {i18n._({ id: 'app.modelAssets.upload', message: 'Upload GLB' })}
        <input
          type="file"
          className="sr-only"
          accept=".glb,model/gltf-binary"
          disabled={busy || generating || Boolean(upload)}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void selectUpload(file)
          }}
        />
      </label>
      <div className="space-y-2 rounded-lg border border-border p-2.5">
        <h3 className="flex items-center gap-2 font-medium">
          <Sparkles size={15} /> Meshy
        </h3>
        {configured ? (
          <>
            <label className="block">
              {i18n._({ id: 'app.modelAssets.prompt', message: 'Describe a 3D model' })}
              <textarea
                className={input}
                rows={2}
                maxLength={500}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={generating || busy || Boolean(reference)}
              />
            </label>
            <label className="block">
              {i18n._({ id: 'app.modelAssets.reference', message: 'Or choose a reference image' })}
              <input
                type="file"
                className="block w-full text-xs"
                accept="image/png,image/jpeg,image/webp"
                disabled={generating || busy}
                onChange={(event) => setReference(event.currentTarget.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              className={button}
              disabled={busy || generating || Boolean(upload) || (!prompt.trim() && !reference)}
              onClick={() => void startGeneration()}
            >
              {i18n._({ id: 'app.modelAssets.generate', message: 'Generate 3D model' })}
            </button>
          </>
        ) : (
          <p className="text-muted-foreground">
            {i18n._({
              id: 'app.modelAssets.configure',
              message: 'Set MESHY_API_KEY in .env.local to enable generation.',
            })}
          </p>
        )}
        {job && (
          <div className="space-y-1" aria-live="polite">
            <p>
              {job.stage === 'refine'
                ? i18n._({ id: 'app.modelAssets.texturing', message: 'Adding textures' })
                : i18n._({ id: 'app.modelAssets.generating', message: 'Generating model' })}
            </p>
            <progress className="w-full" max={100} value={progress} />
            {paused && (
              <button
                type="button"
                className={button}
                onClick={() => {
                  setError('')
                  setPaused(false)
                }}
              >
                {i18n._({ id: 'app.modelAssets.retry', message: 'Check again' })}
              </button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {activePreview && (
        <ModelAssetPreview url={activePreview} onBounds={receiveBounds} onError={onPreviewError} />
      )}
      {upload && (
        <div className="space-y-2">
          <label className="block">
            {i18n._({ id: 'app.modelAssets.name', message: 'Name' })}
            <input
              className={input}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block">
            {i18n._({ id: 'app.modelAssets.category', message: 'Category' })}
            <select
              className={input}
              value={category}
              onChange={(event) => setCategory(event.target.value as ModelAssetForm['category'])}
            >
              {ModelAssetForm.shape.category.options.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {i18n._({ id: 'app.modelAssets.width', message: 'Model width (m)' })}
            <input
              type="number"
              min="0.001"
              step="any"
              className={input}
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={button}
            disabled={!bounds || !name.trim() || Number(width) <= 0 || busy}
            onClick={() => void save()}
          >
            {i18n._({ id: 'app.modelAssets.save', message: 'Save to my models' })}
          </button>
          <button
            type="button"
            className={`${button} ml-2`}
            disabled={busy}
            onClick={() => {
              setUpload(null)
              setPreviewUrl('')
              setBounds(null)
              setError('')
            }}
          >
            {i18n._({ id: 'app.modelAssets.discard', message: 'Discard preview' })}
          </button>
        </div>
      )}
      <ul className="space-y-1">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className="flex items-center gap-1 rounded-md border border-border p-1"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent"
              disabled={busy || generating || Boolean(upload)}
              onClick={() => {
                setError('')
                setSavedPreview(asset)
              }}
            >
              <Box size={14} className="shrink-0" />
              <span className="truncate">{asset.name}</span>
            </button>
            <button type="button" className={button} onClick={() => activateCatalogItem(asset)}>
              {i18n._({ id: 'app.modelAssets.place', message: 'Place' })}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
