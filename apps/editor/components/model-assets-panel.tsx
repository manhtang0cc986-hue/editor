'use client'

import { type AssetInput, artifactHash, usePascalI18n } from '@pascal-app/core'
import { activateCatalogItem, ItemsPanel } from '@pascal-app/editor'
import { ArrowUpRight, Box, ImagePlus, Sparkles, Type, Upload } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MODEL_API_CHANGED } from '@/lib/model-api-settings'
import {
  MAX_MODEL_BYTES,
  MAX_REFERENCE_BYTES,
  MODEL_ASSETS_URL,
  MODEL_GENERATION_URL,
  ModelAssetForm,
  validateModelGlb,
} from '@/lib/model-assets'
import { ModelApiSetupHint } from './model-api-setup-hint'
import type { ModelBounds } from './model-asset-preview'

const ModelAssetPreview = dynamic(
  () => import('./model-asset-preview').then((module) => module.ModelAssetPreview),
  { ssr: false },
)

type Job = { taskId: string; stage: 'preview' | 'refine' | 'image' }
const JOB_KEY = 'pascal.meshy.job'
const input = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm'
const button =
  'inline-flex min-h-8 items-center justify-center gap-2 rounded-lg border border-border px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent disabled:opacity-45'
const primaryButton =
  'flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 font-semibold text-sm text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none'
const sourceButton =
  'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 font-medium text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm'

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
      <div className="flex gap-1 border-b border-border px-3 py-2">
        <button
          type="button"
          aria-pressed={tab === 'library'}
          className={`${sourceButton} aria-pressed:bg-accent aria-pressed:shadow-none`}
          onClick={() => setTab('library')}
        >
          {i18n._({ id: 'app.modelAssets.catalog', message: 'Catalog' })}
        </button>
        <button
          type="button"
          aria-pressed={tab === 'mine'}
          className={`${sourceButton} aria-pressed:bg-accent aria-pressed:shadow-none`}
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
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [prompt, setPrompt] = useState('')
  const [source, setSource] = useState<'image' | 'text'>('image')
  const [reference, setReference] = useState<File | null>(null)
  const [referenceUrl, setReferenceUrl] = useState('')
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

  const checkConfiguration = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await assertOk(await fetch(MODEL_GENERATION_URL, { signal }))
      const result = await response.json()
      if (!signal?.aborted) setConfigured(result.configured === true)
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : String(error))
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
    const refreshConfig = () => void checkConfiguration(controller.signal)
    refreshConfig()
    window.addEventListener(MODEL_API_CHANGED, refreshConfig)
    return () => {
      window.removeEventListener(MODEL_API_CHANGED, refreshConfig)
      controller.abort()
      startRequest.current?.abort()
    }
  }, [checkConfiguration])

  useEffect(() => {
    if (!reference) {
      setReferenceUrl('')
      return
    }
    const url = URL.createObjectURL(reference)
    setReferenceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [reference])

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
    if (!configured || job || startRequest.current) return
    const image = source === 'image' ? reference : null
    if (source === 'image' ? !image : !prompt.trim()) return
    const controller = new AbortController()
    startRequest.current = controller
    setBusy(true)
    setError('')
    setPaused(false)
    setProgress(0)
    try {
      const action = image
        ? { action: 'create-image', image: await readReference(image) }
        : { action: 'create-text', prompt: prompt.trim() }
      const response = await generate(action, controller.signal)
      const { taskId } = await response.json()
      rememberJob({ taskId, stage: image ? 'image' : 'preview' })
      setName((image ? image.name.replace(/\.[^.]+$/, '') : prompt.trim()).slice(0, 100))
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
    setError(
      i18n._({ id: 'app.modelAssets.previewFailed', message: 'Could not preview this GLB.' }),
    )
  }, [i18n])

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
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 text-sm">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="flex items-center gap-3 border-border border-b bg-linear-to-br from-indigo-500/15 via-indigo-500/5 to-transparent p-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500 dark:text-indigo-300">
            <Box size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold leading-tight text-foreground">
              {i18n._({ id: 'app.modelAssets.studio', message: '3D Model Studio' })}
            </h3>
            {/* i18n-ignore: provider brand name */}
            <span className="text-muted-foreground text-xs">Meshy</span>
          </div>
          {configured !== null && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background/70 px-2 py-1 font-medium text-[10px] text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${configured ? 'bg-emerald-500' : 'bg-amber-400'}`}
              />
              {configured
                ? i18n._({ id: 'app.modelAssets.connected', message: 'Configured' })
                : i18n._({ id: 'app.modelAssets.notConnected', message: 'Setup needed' })}
            </span>
          )}
        </header>
        <div className="space-y-3 p-3.5">
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            <button
              type="button"
              aria-pressed={source === 'image'}
              className={sourceButton}
              disabled={generating || busy}
              onClick={() => setSource('image')}
            >
              <ImagePlus size={14} />
              {i18n._({ id: 'app.modelAssets.imageMode', message: 'Image to 3D' })}
            </button>
            <button
              type="button"
              aria-pressed={source === 'text'}
              className={sourceButton}
              disabled={generating || busy}
              onClick={() => setSource('text')}
            >
              <Type size={14} />
              {i18n._({ id: 'app.modelAssets.textMode', message: 'Text to 3D' })}
            </button>
          </div>
          {source === 'image' ? (
            <div className="relative">
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-indigo-500/35 border-dashed bg-indigo-500/5 px-3 py-4 text-center transition-colors hover:bg-indigo-500/10 focus-within:ring-2 focus-within:ring-indigo-500/50">
                {reference && referenceUrl ? (
                  <>
                    <img
                      src={referenceUrl}
                      alt=""
                      className="h-16 w-full rounded-md object-contain"
                    />
                    <span className="max-w-full truncate px-5 font-medium text-xs">
                      {reference.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="grid size-8 place-items-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                      <ImagePlus size={16} />
                    </span>
                    <span className="font-medium text-xs">
                      {i18n._({
                        id: 'app.modelAssets.reference',
                        message: 'Or choose a reference image',
                      })}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {i18n._({
                        id: 'app.modelAssets.imageFormats',
                        message: 'PNG, JPG or WebP · up to 5 MB',
                      })}
                    </span>
                  </>
                )}
                <input
                  type="file"
                  className="sr-only"
                  aria-label={i18n._({
                    id: 'app.modelAssets.reference',
                    message: 'Or choose a reference image',
                  })}
                  accept="image/png,image/jpeg,image/webp"
                  disabled={generating || busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (!file) return
                    setError('')
                    if (
                      file.size > MAX_REFERENCE_BYTES ||
                      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                    ) {
                      setError(
                        i18n._({
                          id: 'app.modelAssets.referenceLimit',
                          message: 'Choose a PNG, JPEG or WebP image smaller than 5 MB.',
                        }),
                      )
                      return
                    }
                    setReference(file)
                  }}
                />
              </label>
              {reference && (
                <button
                  type="button"
                  className={`${button} absolute top-2 right-2 bg-background`}
                  disabled={generating || busy}
                  onClick={() => setReference(null)}
                >
                  {i18n._({ id: 'app.houseAgent.removeImage', message: 'Remove image' })}
                </button>
              )}
            </div>
          ) : (
            <label className="block space-y-1.5 text-xs">
              <span className="font-medium">
                {i18n._({ id: 'app.modelAssets.prompt', message: 'Describe a 3D model' })}
              </span>
              <textarea
                className={`${input} min-h-28 resize-y rounded-xl focus-visible:border-indigo-500 focus-visible:outline-none`}
                rows={3}
                maxLength={500}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={generating || busy}
              />
            </label>
          )}
          <button
            type="button"
            className={primaryButton}
            disabled={
              !configured ||
              busy ||
              generating ||
              Boolean(upload) ||
              (source === 'image' ? !reference : !prompt.trim())
            }
            onClick={() => void startGeneration()}
          >
            <Sparkles size={15} />
            {i18n._({ id: 'app.modelAssets.generate', message: 'Generate 3D model' })}
          </button>
          {configured === false && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/7 p-2.5">
              <ModelApiSetupHint />
            </div>
          )}
          {job && (
            <div
              className="space-y-1.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-2.5 text-xs"
              aria-live="polite"
            >
              <p>
                {job.stage === 'refine'
                  ? i18n._({ id: 'app.modelAssets.texturing', message: 'Adding textures' })
                  : i18n._({ id: 'app.modelAssets.generating', message: 'Generating model' })}
              </p>
              <progress className="h-1.5 w-full accent-indigo-500" max={100} value={progress} />
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
      </section>
      <label className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2 font-medium text-xs transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-indigo-500/50">
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
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {activePreview && (
        <ModelAssetPreview url={activePreview} onBounds={receiveBounds} onError={onPreviewError} />
      )}
      {upload && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-3">
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
      {!upload && savedPreview && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-2.5">
          <span className="truncate text-xs font-medium">{savedPreview.name}</span>
          <button
            type="button"
            className={button}
            onClick={() => activateCatalogItem(savedPreview)}
          >
            {i18n._({ id: 'app.modelAssets.place', message: 'Place' })}
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className="flex items-center gap-2 rounded-xl border border-border bg-card p-1.5"
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
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-500">
                <Box size={14} />
              </span>
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
