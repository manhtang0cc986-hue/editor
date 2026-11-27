'use client'

import { usePascalI18n } from '@pascal-app/core'
import {
  Activity,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Film,
  Image,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  ScanSearch,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  MODEL_API_CHANGED,
  MODEL_API_URL,
  type ModelApiInput,
  type ModelApiProbe,
  type ModelApiSettings,
  type ModelApiSnapshot,
  type ModelApiTarget,
} from '@/lib/model-api-settings'
import { HouseAgentModelLogo } from './house-agent-architect-popover'

const blank: ModelApiSettings = { baseUrl: '', model: '', hasKey: false }
const field =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/20'
const secondary =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50'
const primary =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50'
const targets = [
  {
    id: 'agent',
    icon: MessageSquare,
    label: { id: 'app.modelApi.agent', message: 'Chat models' },
    usage: { id: 'app.modelApi.agentUsage', message: 'Chat and editable 3D house modeling.' },
  },
  {
    id: 'image',
    icon: Image,
    label: { id: 'app.modelApi.image', message: 'Image models' },
    usage: { id: 'app.modelApi.imageUsage', message: 'Design renders and reference images.' },
  },
  {
    id: 'video',
    icon: Film,
    label: { id: 'app.modelApi.video', message: 'Video models' },
    usage: {
      id: 'app.modelApi.videoUsage',
      message:
        'Configure and test a video provider. Cloud video generation is not connected to Image Studio yet.',
    },
  },
  {
    id: 'mesh',
    icon: Box,
    label: { id: 'app.modelApi.mesh', message: '3D models' },
    usage: { id: 'app.modelApi.meshUsage', message: 'Meshy text and image to 3D in My models.' },
  },
] as const

async function responseData(response: Response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`)
  return data
}

export function ModelApiSettingsDialog() {
  const i18n = usePascalI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<ModelApiTarget>('agent')
  const [snapshot, setSnapshot] = useState<ModelApiSnapshot | null>(null)
  const [drafts, setDrafts] = useState<
    Partial<Record<ModelApiTarget, Partial<ModelApiSettings> & { apiKey?: string }>>
  >({})
  const [pending, setPending] = useState<ModelApiInput['action'] | 'load' | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<ModelApiProbe | null>(null)
  const [showModels, setShowModels] = useState(false)
  const settings = { ...(snapshot?.[target] ?? blank), ...drafts[target] }
  const selection = targets.find((item) => item.id === target)!
  const TargetIcon = selection.icon
  const canRequest = Boolean(
    (target === 'mesh' || settings.baseUrl?.trim()) && (settings.apiKey?.trim() || settings.hasKey),
  )
  const status = settings.hasKey
    ? i18n._({ id: 'app.modelApi.keySaved', message: 'Key saved' })
    : i18n._({ id: 'app.modelApi.keyMissing', message: 'Key required' })

  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    setPending('load')
    setError('')
    void fetch(MODEL_API_URL, { signal: abort.signal })
      .then(responseData)
      .then((data) => {
        if (!abort.signal.aborted) setSnapshot(data)
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(String(error))
      })
      .finally(() => {
        if (!abort.signal.aborted) setPending(null)
      })
    return () => {
      abort.abort()
      activeRequest.current?.abort()
    }
  }, [open])

  function edit(field: Partial<ModelApiSettings> & { apiKey?: string }) {
    setDrafts((previous) => ({ ...previous, [target]: { ...previous[target], ...field } }))
    setSaved(false)
    setError('')
    if ('baseUrl' in field || 'apiKey' in field) setProbe(null)
  }

  async function submit(action: ModelApiInput['action']) {
    if (activeRequest.current || pending) return
    const abort = new AbortController()
    activeRequest.current = abort
    setPending(action)
    setSaved(false)
    setError('')
    setProbe(null)
    try {
      const response = await fetch(MODEL_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          action,
          ...(target !== 'mesh' && { baseUrl: settings.baseUrl, model: settings.model }),
          ...(settings.apiKey?.trim() && { apiKey: settings.apiKey.trim() }),
          ...(target === 'image' && { imageMode: settings.imageMode ?? 'auto' }),
        } satisfies ModelApiInput),
        signal: abort.signal,
      })
      const result = await responseData(response)
      if (abort.signal.aborted) return
      if (action === 'save') {
        setSnapshot(result)
        setDrafts((previous) => ({ ...previous, [target]: undefined }))
        setSaved(true)
        window.dispatchEvent(new Event(MODEL_API_CHANGED))
      } else {
        setProbe(result)
        setShowModels(action === 'discover')
      }
    } catch (error) {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (activeRequest.current === abort) activeRequest.current = null
      if (!abort.signal.aborted) setPending(null)
    }
  }

  return (
    <>
      <button
        type="button"
        className="group flex w-full items-center gap-3 rounded-2xl border border-indigo-500/25 bg-linear-to-br from-indigo-500/15 to-card p-3 text-left transition-colors hover:border-indigo-500/50"
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
        }}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-500 dark:text-indigo-300">
          <KeyRound size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-sm">
            {i18n._({ id: 'app.houseAgent.modelPicker.settings', message: 'API settings' })}
          </span>
          <span className="block text-xs text-muted-foreground">
            {i18n._({ id: 'app.modelApi.entry', message: 'Chat, image, video and 3D models' })}
          </span>
        </span>
        <ArrowUpRight size={16} className="text-muted-foreground group-hover:text-indigo-400" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="model-api-title"
        className="m-auto max-h-[92dvh] w-[min(55rem,calc(100%-1.5rem))] max-w-none overflow-auto rounded-[1.5rem] border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm"
        onClose={() => {
          setOpen(false)
          activeRequest.current?.abort()
          activeRequest.current = null
          setPending(null)
          setDrafts({})
          setProbe(null)
          setSaved(false)
          setError('')
        }}
      >
        <header className="flex items-center gap-3 border-border border-b bg-linear-to-br from-indigo-500/15 via-indigo-500/5 to-card px-5 py-5 sm:px-7">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-500 dark:text-indigo-300">
            <KeyRound size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="model-api-title" className="font-semibold text-xl tracking-tight">
              {i18n._({ id: 'app.houseAgent.modelPicker.settings', message: 'API settings' })}
            </h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              {i18n._({ id: 'app.modelApi.entry', message: 'Chat, image, video and 3D models' })}
            </p>
          </div>
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={i18n._({ id: 'app.modelApi.close', message: 'Close API configuration' })}
            onClick={() => dialog.current?.close()}
          >
            <X size={19} />
          </button>
        </header>
        <div className="grid gap-0 sm:grid-cols-[13rem_minmax(0,1fr)]">
          <nav
            aria-label={i18n._({ id: 'app.modelApi.categories', message: 'Model categories' })}
            className="grid grid-cols-2 content-start gap-1.5 border-border border-b bg-muted/25 p-3 sm:grid-cols-1 sm:border-r sm:border-b-0"
          >
            {targets.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={target === id}
                disabled={pending !== null}
                onClick={() => {
                  setTarget(id)
                  setProbe(null)
                  setSaved(false)
                  setError('')
                }}
                className="group flex min-w-0 items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-background aria-pressed:border-indigo-500/25 aria-pressed:bg-indigo-500/10 aria-pressed:text-foreground"
              >
                <Icon size={16} className="shrink-0 group-aria-pressed:text-indigo-500" />
                <span className="min-w-0 flex-1">{i18n._(label)}</span>
                {snapshot?.[id].hasKey && (
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                )}
                <ChevronRight size={13} className="hidden shrink-0 sm:block" />
              </button>
            ))}
          </nav>
          <form
            className="min-w-0 space-y-4 p-4 sm:p-6"
            onSubmit={(event) => {
              event.preventDefault()
              void submit('save')
            }}
          >
            <div className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500">
                <TargetIcon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-base">{i18n._(selection.label)}</h3>
                <p className="mt-0.5 text-muted-foreground text-xs">{i18n._(selection.usage)}</p>
              </div>
              <span className="h-fit shrink-0 rounded-full border border-border px-2 py-1 text-muted-foreground text-[11px]">
                {status}
              </span>
            </div>
            <fieldset disabled={pending !== null} className="min-w-0 space-y-3 disabled:opacity-70">
              <label className="block space-y-1.5 text-xs font-medium">
                <span>
                  {i18n._({ id: 'app.houseAgent.settings.baseUrl', message: 'API Base URL' })}
                </span>
                <input
                  className={field}
                  placeholder="https://api.example.com/v1"
                  readOnly={target === 'mesh'}
                  value={settings.baseUrl}
                  onChange={(event) => edit({ baseUrl: event.target.value })}
                />
              </label>
              <label className="block space-y-1.5 text-xs font-medium">
                <span>{i18n._({ id: 'app.modelApi.key', message: 'API Key' })}</span>
                <input
                  className={field}
                  type="password"
                  autoComplete="off"
                  placeholder={settings.hasKey ? '••••••••••••' : undefined}
                  value={settings.apiKey ?? ''}
                  onChange={(event) => edit({ apiKey: event.target.value })}
                />
              </label>
              {target !== 'mesh' && (
                <label className="block space-y-1.5 text-xs font-medium">
                  <span>{i18n._({ id: 'app.houseAgent.settings.model', message: 'Model' })}</span>
                  <span className="relative block">
                    <input
                      className={`${field} pr-10`}
                      value={settings.model}
                      onChange={(event) => edit({ model: event.target.value })}
                    />
                    {settings.model && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <HouseAgentModelLogo modelId={settings.model} compact />
                      </span>
                    )}
                  </span>
                </label>
              )}
              {target === 'image' && (
                <label className="block space-y-1.5 text-xs font-medium">
                  <span>
                    {i18n._({ id: 'app.houseAgent.imageSettings.mode', message: 'API Mode' })}
                  </span>
                  <select
                    className={field}
                    value={settings.imageMode ?? 'auto'}
                    onChange={(event) =>
                      edit({ imageMode: event.target.value as ModelApiSettings['imageMode'] })
                    }
                  >
                    <option value="auto">
                      {i18n._({ id: 'app.houseAgent.imageSettings.mode.auto', message: 'Auto' })}
                    </option>
                    <option value="images">Images API</option>
                    <option value="chat">Chat Completions</option>
                  </select>
                </label>
              )}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={secondary}
                disabled={pending !== null || !canRequest}
                onClick={() => void submit('discover')}
              >
                <ScanSearch size={15} />
                {target === 'mesh'
                  ? i18n._({ id: 'app.modelApi.workflow', message: 'Check capabilities' })
                  : i18n._({ id: 'app.houseAgent.settings.detect', message: 'Detect' })}
              </button>
              <button
                type="button"
                className={secondary}
                disabled={pending !== null || !canRequest}
                onClick={() => void submit('test')}
              >
                <Activity size={15} />
                {i18n._({ id: 'app.modelApi.test', message: 'Test request' })}
              </button>
              <button
                type="submit"
                className={`${primary} sm:ml-auto`}
                disabled={pending !== null || !canRequest}
              >
                <Check size={15} />
                {i18n._({ id: 'app.modelApi.save', message: 'Save configuration' })}
              </button>
            </div>
            {pending && (
              <p role="status" className="flex items-center gap-2 text-muted-foreground text-xs">
                <LoaderCircle size={14} className="animate-spin" />
                {i18n._({ id: 'app.modelApi.loading', message: 'Waiting for response…' })}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm"
              >
                {error}
              </p>
            )}
            {saved && (
              <p
                role="status"
                className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm"
              >
                {i18n._({ id: 'app.modelApi.saved', message: 'Saved to server environment.' })}
              </p>
            )}
            {probe && (
              <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                <p role="status" className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Check size={15} className="text-emerald-500" /> HTTP {probe.status}
                  <span className="text-xs text-muted-foreground">{probe.durationMs} ms</span>
                  {probe.credits !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {i18n._({
                        id: 'app.modelApi.credits',
                        message: '{credits} Meshy credits',
                        values: { credits: probe.credits },
                      })}
                    </span>
                  )}
                </p>
                {target === 'mesh' && showModels && (
                  <p className="text-xs text-muted-foreground">{i18n._(selection.usage)}</p>
                )}
                {target !== 'mesh' && !showModels && probe.selectedModelListed === false && (
                  <p className="text-xs text-muted-foreground">
                    {i18n._({
                      id: 'app.modelApi.modelNotListed',
                      message:
                        'The request succeeded. The selected model is not in the returned catalog.',
                    })}
                  </p>
                )}
                {showModels && target !== 'mesh' && (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {probe.models.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {i18n._({
                          id: 'app.modelApi.noModels',
                          message: 'No models were returned for this category.',
                        })}
                      </p>
                    )}
                    {probe.models.map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        aria-pressed={settings.model === model.id}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent aria-pressed:bg-indigo-500/10"
                        onClick={() => edit({ model: model.id })}
                      >
                        <HouseAgentModelLogo modelId={model.id} owner={model.owner} compact />
                        <span className="min-w-0 flex-1 break-all">{model.id}</span>
                        {settings.model === model.id && (
                          <Check size={13} className="shrink-0 text-indigo-500" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      </dialog>
    </>
  )
}
