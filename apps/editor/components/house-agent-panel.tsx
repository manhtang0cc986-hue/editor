'use client'

import { usePascalI18n, useScene } from '@pascal-app/core'
import { applySceneGraphToEditor, type SceneGraph } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  ArrowUp,
  Bot,
  Brain,
  Camera,
  ChevronDown,
  History,
  ImagePlus,
  Layers,
  Plus,
  Settings2,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { type ClipboardEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { getLocalAwareCatalog } from '@/lib/house-agent-catalog'
import { captureEphemeralViewport, executeHouseAgentTool } from '@/lib/house-agent-executor'
import { type ChatRecord, listAgentChats, saveAgentChat } from '@/lib/house-agent-history'
import {
  type AgentBuildProfile,
  AgentBuildProfileSchema,
  type AgentClientConfig,
  type AgentConfiguration,
  type AgentMessage,
  type AgentMode,
  type AgentReasoningEffort,
  AgentReasoningEffortSchema,
  type AgentStreamEvent,
  type DetectedModelItem,
  type HousePlan,
  type ImageClientConfig,
  type ImageConfiguration,
  type ImageGenMode,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGES,
} from '@/lib/house-agent-protocol'
import {
  type HouseAgentStreamState,
  type HouseAgentToolEvent,
  runHouseAgent,
} from '@/lib/house-agent-runner'
import { houseAgentSceneContext } from '@/lib/house-agent-workflow'
import { buildVillaWithCommands, type VillaStyle } from '@/lib/villa-auto-builder'
import { HouseAgentActivity } from './house-agent-activity'
import {
  HouseAgentArchitectPopover,
  HouseAgentModelLogo,
  type HouseAgentModelTab,
  modelEfforts,
  useHouseAgentModelLabels,
} from './house-agent-architect-popover'
import { HouseAgentAssetPicker } from './house-agent-asset-picker'
import { HouseAgentImageStudio } from './house-agent-image-studio'
import { HouseAgentMarkdown } from './house-agent-markdown'
import { HouseAgentPlanCard } from './house-agent-plan-card'
import { HouseAgentStarters } from './house-agent-starters'

type ModelScanTarget = 'agent' | 'image'
type DetectedModelsState = {
  loading: boolean
  models: DetectedModelItem[]
  count: number | null
  error: string
}

const EMPTY_MODEL_SCAN: DetectedModelsState = {
  loading: false,
  models: [],
  count: null,
  error: '',
}

const SETTINGS_STORAGE_KEY = 'pascal.houseAgent.settings.v1'
const IMAGE_SETTINGS_STORAGE_KEY = 'pascal.houseAgent.imageSettings.v1'

function maskedKeyPlaceholder(maskedApiKey: string | null | undefined, configured?: boolean) {
  // i18n-ignore: masked API key placeholder
  if (maskedApiKey) return `${maskedApiKey} (.env.local)`
  // i18n-ignore: masked API key placeholder
  if (configured) return '•••••••• (env)'
  // i18n-ignore: API key prefix placeholder
  return 'sk-...'
}

// i18n-ignore: technical env var names
const ENV_TEMPLATE =
  'PASCAL_AGENT_BASE_URL=https://…/v1\nPASCAL_AGENT_MODEL=…\nPASCAL_AGENT_API_KEY=…'
// i18n-ignore: technical env var names
const IMAGE_ENV_TEMPLATE =
  'PASCAL_IMAGE_BASE_URL=https://…/v1\nPASCAL_IMAGE_MODEL=…\nPASCAL_IMAGE_API_KEY=…\nPASCAL_IMAGE_API_MODE=auto'

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Image could not be read.'))
    reader.readAsDataURL(file)
  })
}

type StoredSettings = {
  baseUrl: string
  model: string
  apiKey: string
  reasoningEffort?: AgentReasoningEffort
  buildProfile?: AgentBuildProfile
  modelTab?: HouseAgentModelTab
}

function loadStoredSettings(): StoredSettings {
  if (typeof window === 'undefined') {
    return { baseUrl: '', model: '', apiKey: '' }
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { baseUrl: '', model: '', apiKey: '' }
    const parsed = JSON.parse(raw) as Partial<StoredSettings>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      reasoningEffort: AgentReasoningEffortSchema.safeParse(parsed.reasoningEffort).data,
      buildProfile: AgentBuildProfileSchema.safeParse(parsed.buildProfile).data,
      modelTab: parsed.modelTab === 'models' ? 'models' : 'architect',
    }
  } catch {
    return { baseUrl: '', model: '', apiKey: '' }
  }
}

type StoredImageSettings = {
  baseUrl: string
  model: string
  apiKey: string
  mode?: ImageGenMode
}

function loadStoredImageSettings(): StoredImageSettings {
  if (typeof window === 'undefined') {
    return { baseUrl: '', model: '', apiKey: '' }
  }
  try {
    const raw = window.localStorage.getItem(IMAGE_SETTINGS_STORAGE_KEY)
    if (!raw) return { baseUrl: '', model: '', apiKey: '' }
    const parsed = JSON.parse(raw) as Partial<StoredImageSettings>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      mode: parsed.mode === 'images' || parsed.mode === 'chat' ? parsed.mode : undefined,
    }
  } catch {
    return { baseUrl: '', model: '', apiKey: '' }
  }
}

async function streamAgentTurn(
  history: AgentMessage[],
  runMode: AgentMode,
  signal: AbortSignal,
  configOverride: AgentClientConfig | undefined,
  onDelta: (event: AgentStreamEvent) => void,
): Promise<Extract<AgentMessage, { role: 'assistant' }>> {
  const response = await fetch('/api/house-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: history,
      mode: runMode,
      stream: true,
      ...(configOverride ? { config: configOverride } : {}),
    }),
    signal,
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `HTTP ${response.status}`)
  }
  if (!contentType.includes('text/event-stream')) {
    const body = (await response.json()) as {
      message: Extract<AgentMessage, { role: 'assistant' }>
    }
    return body.message
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty stream response.')
  const decoder = new TextDecoder()
  let buffer = ''
  let finalMessage: Extract<AgentMessage, { role: 'assistant' }> | null = null

  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.split(/\r?\n/).find((entry) => entry.trim().startsWith('data:'))
        if (!line) continue
        const payload = line.trim().slice(5).trim()
        if (!payload) continue
        const event = JSON.parse(payload) as AgentStreamEvent
        if (event.type === 'error') throw new Error(event.error)
        if (event.type === 'assistant') {
          finalMessage = event.message
        } else {
          onDelta(event)
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (!finalMessage) throw new Error('The model stream ended without a response.')
  return finalMessage
}

export function HouseAgentPanel({
  embedded = false,
  sceneId,
}: {
  embedded?: boolean
  sceneId: string
}) {
  const i18n = usePascalI18n()
  const modelLabels = useHouseAgentModelLabels()
  const selection = useViewer((state) => state.selection)
  const [chatId, setChatId] = useState(() => crypto.randomUUID())
  const [history, setHistory] = useState<ChatRecord[] | null>(null)
  const [openItems, setOpenItems] = useState<string[]>([])
  const [open, setOpen] = useState(embedded)
  const [showSettings, setShowSettings] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [workspaceTab, setWorkspaceTab] = useState<'build' | 'studio'>('build')
  const [showArchitectPopover, setShowArchitectPopover] = useState(false)
  const [pickerTab, setPickerTab] = useState<HouseAgentModelTab>('architect')
  const [config, setConfig] = useState<AgentConfiguration | null>(null)
  const [imageConfigStatus, setImageConfigStatus] = useState<ImageConfiguration | null>(null)
  const [customSettings, setCustomSettings] = useState<StoredSettings>(() => loadStoredSettings())
  const [customImageSettings, setCustomImageSettings] = useState<StoredImageSettings>(() =>
    loadStoredImageSettings(),
  )
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [streamState, setStreamState] = useState<HouseAgentStreamState | null>(null)
  const [events, setEvents] = useState<HouseAgentToolEvent[]>([])
  const [currentPlan, setCurrentPlan] = useState<HousePlan | null>(null)
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<{ name: string; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [hasPlan, setHasPlan] = useState(false)
  const [hasBuilt, setHasBuilt] = useState(false)
  const [needsReverify, setNeedsReverify] = useState(false)
  const [preferredMode, setPreferredMode] = useState<AgentMode>('build')
  const [villaStyle, setVillaStyle] = useState<VillaStyle>('modern')
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const followConversation = useRef(true)
  const historyRequest = useRef(0)
  const composer = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const modelPicker = useRef<HTMLDivElement>(null)
  const modelTrigger = useRef<HTMLButtonElement>(null)
  const scanRequests = useRef<Partial<Record<ModelScanTarget, AbortController>>>({})
  const [agentModels, setAgentModels] = useState(EMPTY_MODEL_SCAN)
  const [imageModels, setImageModels] = useState(EMPTY_MODEL_SCAN)
  const [savingEnv, setSavingEnv] = useState(false)
  const envSaveInFlight = useRef(false)
  const [envRevision, setEnvRevision] = useState({ agent: 0, image: 0 })
  const attemptedEnvRevision = useRef({ agent: 0, image: 0 })
  const [envSaveState, setEnvSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [envSaveError, setEnvSaveError] = useState('')
  const modelTab = customSettings.modelTab ?? 'architect'
  const buildProfile = customSettings.buildProfile ?? 'structure'
  const chatModels = agentModels.models.filter((model) => model.kind === 'chat')
  const agentBaseUrl =
    customSettings.baseUrl.trim() || config?.baseUrl || 'https://api.openai.com/v1'
  const canScanAgentModels = Boolean(
    customSettings.apiKey.trim() ||
      (config?.modelDiscoveryConfigured &&
        agentBaseUrl.replace(/\/+$/, '') === config.baseUrl.replace(/\/+$/, '')),
  )

  const effectiveConfigured = Boolean(
    canScanAgentModels && (customSettings.model.trim() || config?.model),
  )
  const effectiveModelLabel = customSettings.model.trim() || config?.model || ''
  const chosenModel = chatModels.find((model) => model.id === effectiveModelLabel)
  const requestedEffort = customSettings.reasoningEffort ?? config?.reasoningEffort ?? 'auto'
  const reasoningEffort =
    chosenModel?.reasoningEfforts && !modelEfforts(chosenModel).includes(requestedEffort)
      ? 'auto'
      : requestedEffort

  const imageBaseUrl =
    customImageSettings.baseUrl.trim() || imageConfigStatus?.baseUrl || 'https://api.openai.com/v1'
  const canUseImageServerKey = Boolean(
    (imageConfigStatus?.maskedApiKey || imageConfigStatus?.configured) &&
      imageBaseUrl.replace(/\/+$/, '') === (imageConfigStatus?.baseUrl ?? '').replace(/\/+$/, ''),
  )
  const canScanImageModels = Boolean(customImageSettings.apiKey.trim() || canUseImageServerKey)

  const effectiveImageConfigured = Boolean(
    (customImageSettings.apiKey.trim() || canUseImageServerKey) &&
      (customImageSettings.model.trim() || imageConfigStatus?.model),
  )
  const effectiveImageModelLabel =
    customImageSettings.model.trim() || imageConfigStatus?.model || ''

  const runtimeOverride: AgentClientConfig = {
    ...(customSettings.baseUrl.trim() ? { baseUrl: customSettings.baseUrl.trim() } : {}),
    ...(customSettings.model.trim() ? { model: customSettings.model.trim() } : {}),
    ...(customSettings.apiKey.trim() ? { apiKey: customSettings.apiKey.trim() } : {}),
    ...(reasoningEffort !== 'auto' || modelTab === 'models' ? { reasoningEffort } : {}),
    ...(modelTab === 'architect' ? { buildProfile } : {}),
  }

  const imageRuntimeOverride: ImageClientConfig | undefined =
    customImageSettings.baseUrl.trim() ||
    customImageSettings.model.trim() ||
    customImageSettings.apiKey.trim() ||
    customImageSettings.mode !== undefined
      ? {
          ...(customImageSettings.baseUrl.trim()
            ? { baseUrl: customImageSettings.baseUrl.trim() }
            : {}),
          ...(customImageSettings.model.trim() ? { model: customImageSettings.model.trim() } : {}),
          ...(customImageSettings.apiKey.trim()
            ? { apiKey: customImageSettings.apiKey.trim() }
            : {}),
          ...(customImageSettings.mode !== undefined ? { mode: customImageSettings.mode } : {}),
        }
      : undefined

  useEffect(
    () => () => {
      controller.current?.abort()
      scanRequests.current.agent?.abort()
      scanRequests.current.image?.abort()
    },
    [],
  )

  useEffect(() => {
    if (!showArchitectPopover) return
    modelPicker.current
      ?.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-pressed="true"]')
      ?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!modelPicker.current?.contains(event.target as Node)) setShowArchitectPopover(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setShowArchitectPopover(false)
      modelTrigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [showArchitectPopover])
  useEffect(() => {
    if (!open && !embedded) return
    const abort = new AbortController()
    fetch('/api/house-agent', { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuration could not be loaded.')
        setConfig(await response.json())
      })
      .catch((error) => {
        if (!abort.signal.aborted) setNotice(String(error))
      })
    fetch('/api/house-agent/image', { signal: abort.signal })
      .then(async (response) => {
        if (response.ok) setImageConfigStatus(await response.json())
      })
      .catch(() => undefined)
    return () => abort.abort()
  }, [open, embedded])
  useEffect(() => {
    if (
      (embedded || open) &&
      workspaceTab === 'build' &&
      followConversation.current &&
      (messages.length || events.length || busy || streamState?.reasoning || streamState?.content)
    ) {
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight })
    }
  }, [messages, events, busy, streamState, workspaceTab, open, embedded])

  function markEnvChanged(target: ModelScanTarget) {
    setEnvRevision((previous) => ({ ...previous, [target]: previous[target] + 1 }))
    setEnvSaveState('idle')
    setEnvSaveError('')
  }

  function updateCustomSettings(patch: Partial<StoredSettings>) {
    if (patch.apiKey !== undefined || patch.baseUrl !== undefined) {
      scanRequests.current.agent?.abort()
      setAgentModels(EMPTY_MODEL_SCAN)
    }
    if (
      patch.baseUrl !== undefined ||
      patch.model !== undefined ||
      patch.apiKey !== undefined ||
      patch.reasoningEffort !== undefined
    ) {
      markEnvChanged('agent')
    }
    setCustomSettings((previous) => ({ ...previous, ...patch }))
    if (patch.modelTab !== undefined || patch.buildProfile !== undefined) {
      try {
        const { buildProfile, modelTab } = { ...customSettings, ...patch }
        window.localStorage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify({ buildProfile, modelTab }),
        )
      } catch {
        // Browser preferences are optional.
      }
    }
  }

  function updateCustomImageSettings(patch: Partial<StoredImageSettings>) {
    if (patch.apiKey !== undefined || patch.baseUrl !== undefined) {
      scanRequests.current.image?.abort()
      setImageModels(EMPTY_MODEL_SCAN)
    }
    setCustomImageSettings((previous) => ({ ...previous, ...patch }))
    markEnvChanged('image')
  }

  async function detectModels(target: ModelScanTarget, baseUrl: string, apiKey: string) {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey && (target === 'agent' ? !canScanAgentModels : !canScanImageModels)) return
    scanRequests.current[target]?.abort()
    const request = new AbortController()
    scanRequests.current[target] = request
    const setState = target === 'agent' ? setAgentModels : setImageModels
    setState({ ...EMPTY_MODEL_SCAN, loading: true })
    try {
      const response = await fetch('/api/house-agent/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          trimmedKey ? { baseUrl, apiKey: trimmedKey } : { useServerConfig: true, target },
        ),
        signal: request.signal,
      })
      const body = (await response.json().catch(() => null)) as {
        count?: number
        models?: DetectedModelItem[]
        error?: string
      } | null
      if (!response.ok || !Array.isArray(body?.models)) {
        throw new Error(body?.error || `HTTP ${response.status}`)
      }
      if (request.signal.aborted) return
      const list = body.models
      setState({ loading: false, models: list, count: body.count ?? list.length, error: '' })
      if (target === 'image' && !effectiveImageModelLabel) {
        const preferred = list.find((model) => model.kind === 'image')
        if (preferred) updateCustomImageSettings({ model: preferred.id })
      }
    } catch (error) {
      if (request.signal.aborted) return
      setState({
        ...EMPTY_MODEL_SCAN,
        error: error instanceof Error ? error.message : 'Model detection failed.',
      })
    } finally {
      if (scanRequests.current[target] === request) delete scanRequests.current[target]
    }
  }

  const autoDetectImageModels = useEffectEvent((baseUrl: string, key: string) =>
    detectModels('image', baseUrl, key),
  )
  useEffect(() => {
    const key = customImageSettings.apiKey.trim()
    if (key.length < 10) return
    const baseUrl =
      customImageSettings.baseUrl.trim() ||
      imageConfigStatus?.baseUrl ||
      'https://api.openai.com/v1'
    const timer = setTimeout(() => void autoDetectImageModels(baseUrl, key), 600)
    return () => clearTimeout(timer)
  }, [customImageSettings.apiKey, customImageSettings.baseUrl, imageConfigStatus?.baseUrl])

  function scanAgentModels() {
    void detectModels('agent', agentBaseUrl, customSettings.apiKey)
  }

  const autoDetectAgentModels = useEffectEvent((baseUrl: string) => {
    if (!scanRequests.current.agent && agentModels.count === null)
      void detectModels('agent', baseUrl, '')
  })
  useEffect(() => {
    if ((!open && !embedded) || !canScanAgentModels || customSettings.apiKey.trim()) return
    autoDetectAgentModels(agentBaseUrl)
  }, [open, embedded, canScanAgentModels, agentBaseUrl, customSettings.apiKey])

  async function saveSettingsToEnv(manual = false) {
    if (envSaveInFlight.current) return

    const targets = (['agent', 'image'] as const).filter((target) =>
      manual
        ? envRevision[target] > 0 ||
          (target === 'agent' ? customSettings.apiKey.trim() : customImageSettings.apiKey.trim())
        : envRevision[target] !== attemptedEnvRevision.current[target],
    )
    if (!targets.length) return

    envSaveInFlight.current = true
    setSavingEnv(true)
    setEnvSaveError('')
    const errors: string[] = []
    let saved = false
    try {
      for (const target of targets) {
        attemptedEnvRevision.current[target] = envRevision[target]
        const settings = target === 'agent' ? customSettings : customImageSettings
        const baseUrl = settings.baseUrl.trim()
        const model = settings.model.trim()
        const apiKey = settings.apiKey.trim()
        const fields = {
          ...(baseUrl ? { baseUrl } : {}),
          ...(model ? { model } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(target === 'agent' && customSettings.reasoningEffort !== undefined
            ? { reasoningEffort: customSettings.reasoningEffort }
            : {}),
          ...(target === 'image' && customImageSettings.mode !== undefined
            ? { mode: customImageSettings.mode }
            : {}),
        }
        if (Object.keys(fields).length === 0) continue

        try {
          const response = await fetch('/api/house-agent/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [target]: fields }),
          })
          const body = (await response.json().catch(() => null)) as {
            saved?: boolean
            agent?: AgentConfiguration
            image?: ImageConfiguration
            error?: string
          } | null
          if (!response.ok || !body?.saved) {
            throw new Error(body?.error || `HTTP ${response.status}`)
          }
          if (body.agent) setConfig(body.agent)
          if (body.image) setImageConfigStatus(body.image)
          if (target === 'agent') {
            setCustomSettings((current) => ({
              ...current,
              baseUrl: current.baseUrl.trim() === baseUrl ? '' : current.baseUrl,
              model: current.model.trim() === model ? '' : current.model,
              apiKey: current.apiKey.trim() === apiKey ? '' : current.apiKey,
              reasoningEffort:
                current.reasoningEffort === customSettings.reasoningEffort
                  ? undefined
                  : current.reasoningEffort,
            }))
          } else {
            setCustomImageSettings((current) => ({
              ...current,
              baseUrl: current.baseUrl.trim() === baseUrl ? '' : current.baseUrl,
              model: current.model.trim() === model ? '' : current.model,
              apiKey: current.apiKey.trim() === apiKey ? '' : current.apiKey,
              mode: current.mode === customImageSettings.mode ? undefined : current.mode,
            }))
          }
          try {
            if (target === 'agent') {
              const { buildProfile, modelTab } = loadStoredSettings()
              window.localStorage.setItem(
                SETTINGS_STORAGE_KEY,
                JSON.stringify({ buildProfile, modelTab }),
              )
            } else {
              window.localStorage.removeItem(IMAGE_SETTINGS_STORAGE_KEY)
            }
          } catch {
            // The environment save does not depend on browser storage.
          }
          saved = true
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      setEnvSaveError(errors.join(' · '))
      setEnvSaveState(errors.length ? 'error' : saved ? 'saved' : 'idle')
    } finally {
      envSaveInFlight.current = false
      setSavingEnv(false)
    }
  }

  const autoSaveEnv = useEffectEvent(() => saveSettingsToEnv())
  useEffect(() => {
    if (
      savingEnv ||
      (envRevision.agent === attemptedEnvRevision.current.agent &&
        envRevision.image === attemptedEnvRevision.current.image)
    ) {
      return
    }
    const timer = setTimeout(() => void autoSaveEnv(), 900)
    return () => clearTimeout(timer)
  }, [envRevision, savingEnv])

  function selectChatModel(model: DetectedModelItem) {
    updateCustomSettings({
      model: model.id,
      modelTab: 'models',
      reasoningEffort:
        model.id === effectiveModelLabel &&
        modelEfforts(model, reasoningEffort).includes(reasoningEffort)
          ? reasoningEffort
          : 'auto',
    })
  }

  async function addFiles(files: File[]) {
    if (
      files.length + images.length > MAX_AGENT_IMAGES ||
      files.some(
        (file) =>
          file.size > MAX_AGENT_IMAGE_BYTES ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type),
      )
    ) {
      setNotice(
        i18n._({
          id: 'app.houseAgent.imageLimit',
          message: 'Choose up to 8 PNG, JPEG or WebP images, each smaller than 5 MB.',
        }),
      )
      return
    }
    setReading(true)
    try {
      const added = await Promise.all(
        files.map(async (file) => ({ name: file.name, url: await readImage(file) })),
      )
      setImages((previous) => [...previous, ...added])
      setNotice('')
    } catch (error) {
      setNotice(String(error))
    } finally {
      setReading(false)
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      ['image/png', 'image/jpeg', 'image/webp'].includes(file.type),
    )
    if (pastedFiles.length === 0) return
    event.preventDefault()
    await addFiles(pastedFiles)
  }

  async function handleCaptureViewport() {
    if (busy || capturing || images.length >= MAX_AGENT_IMAGES) return
    setCapturing(true)
    setNotice('')
    try {
      const capture = await captureEphemeralViewport({ captureMode: 'viewport' })
      setImages((prev) => [
        ...prev,
        {
          name: `viewport-${capture.width}x${capture.height}.webp`,
          url: capture.dataUrl,
        },
      ])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setCapturing(false)
    }
  }

  async function runAutoVilla() {
    if (busy || reading) return
    const existingNodes = Object.values(useScene.getState().nodes)
    const hasExistingContent = existingNodes.some(
      (n) => n.type !== 'site' && n.type !== 'building' && n.type !== 'level',
    )
    if (
      hasExistingContent &&
      !window.confirm(
        i18n._({
          id: 'app.houseAgent.villa.confirmOverwrite',
          message:
            'The current project already contains building elements. Generating a template villa will replace the current scene and clear undo history. Continue?',
        }),
      )
    ) {
      return
    }
    setBusy(true)
    setNotice('')
    setOpenItems([])
    setShowPicker(false)
    setEvents([])
    try {
      const catalog = await getLocalAwareCatalog()
      const built = await buildVillaWithCommands({
        style: villaStyle,
        floors: 2,
        catalog,
        onLog: (entry) => {
          setEvents((prev) => [
            ...prev,
            {
              id: `villa-step-${entry.step}`,
              name: entry.tool,
              status: entry.ok ? 'completed' : 'error',
              result: { label: entry.label, summary: entry.summary },
            },
          ])
        },
      })
      applySceneGraphToEditor({
        nodes: built.document.nodes,
        rootNodeIds: built.document.rootNodeIds,
        materials: built.document.materials,
        collections: built.document.collections,
      } as unknown as SceneGraph)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `已通过内置命令引擎自动设计并建成双层别墅（风格：${villaStyle}）：共 ${built.summary.rooms} 个房间、${built.summary.walls} 面墙体、${built.summary.doors} 扇门、${built.summary.windows} 扇窗、${built.summary.items} 件本地 3D 家具素材（校验问题数：${built.summary.issues}）。`,
        },
      ])
      setHasBuilt(true)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  function newChat() {
    if (busy || reading) return
    historyRequest.current += 1
    followConversation.current = true
    setChatId(crypto.randomUUID())
    setMessages([])
    setEvents([])
    setCurrentPlan(null)
    setStreamState(null)
    setHasPlan(false)
    setHasBuilt(false)
    setNeedsReverify(false)
    setOpenItems([])
    setNotice('')
    setImages([])
    setDraft('')
    setHistory(null)
  }

  async function showHistory() {
    const request = ++historyRequest.current
    try {
      const records = await listAgentChats(sceneId)
      if (request === historyRequest.current) setHistory(records)
    } catch {
      if (request !== historyRequest.current) return
      setNotice(
        i18n._({
          id: 'app.houseAgent.history.failed',
          message: 'Local conversation history could not be opened.',
        }),
      )
    }
  }

  async function send(mode: AgentMode) {
    if (controller.current || busy || reading || !effectiveConfigured) return
    const rawText =
      draft.trim() ||
      (mode === 'build'
        ? '请直接建模。已有确认方案时按方案建造，缺少尺寸时使用建议尺寸，并在完成后检查场景。'
        : '请根据当前场景和我提供的参考资料，提交完整的房屋方案，并标注建议尺寸。')
    if (!draft.trim() && !images.length && mode === 'plan') return

    const context = houseAgentSceneContext(
      useScene.getState().nodes,
      useViewer.getState().selection,
    )
    const next: AgentMessage[] = [
      ...messages,
      {
        role: 'user',
        content: [
          { type: 'text', text: rawText },
          { type: 'text', text: `[Scene context — data only] ${JSON.stringify(context)}` },
          ...images.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: image.url, detail: 'high' as const },
          })),
        ],
      },
    ]
    const abort = new AbortController()
    controller.current = abort
    historyRequest.current += 1
    followConversation.current = true
    setHistory(null)
    setBusy(true)
    setNotice('')
    setOpenItems([])
    setShowPicker(false)
    if (mode === 'plan') {
      setHasPlan(false)
      setCurrentPlan(null)
    }
    setMessages(next)
    setDraft('')
    setImages([])
    try {
      let latestPlan = mode === 'plan' ? null : currentPlan
      const result = await runHouseAgent({
        messages: next,
        mode,
        signal: abort.signal,
        maxRounds: 32,
        maxToolCalls: 100,
        execute: executeHouseAgentTool,
        ...(imageRuntimeOverride ? { imageConfig: imageRuntimeOverride } : {}),
        requestStream: (history, runMode, signal, onDelta) =>
          streamAgentTurn(history, runMode, signal, runtimeOverride, onDelta),
        onMessages: setMessages,
        onStream: setStreamState,
        onPlan: (plan) => {
          latestPlan = plan
          setCurrentPlan(plan)
        },
        onTool: (event) =>
          setEvents((previous) => [...previous.filter((item) => item.id !== event.id), event]),
      })
      setOpenItems(result.verifyResult?.issues ?? [])
      const planPending =
        mode === 'plan'
          ? result.status === 'completed' && Boolean(result.planSubmitted)
          : hasPlan && !result.wroteScene
      setHasPlan(planPending)
      try {
        const first = result.messages.find((message) => message.role === 'user')
        const title =
          typeof first?.content === 'string'
            ? first.content
            : (first?.content?.find((part) => part.type === 'text')?.text ?? 'Chat')
        await saveAgentChat({
          id: chatId,
          sceneId,
          title: title.slice(0, 100),
          updatedAt: Date.now(),
          messages: result.messages,
          plan: latestPlan,
          planPending,
        })
      } catch {
        setNotice(
          i18n._({
            id: 'app.houseAgent.history.saveFailed',
            message: 'The response is ready, but local history could not be saved.',
          }),
        )
      }
      if (result.status === 'completed') {
        if (mode === 'build' && result.wroteScene) {
          if (result.verifyResult?.ok) {
            setHasBuilt(true)
            setNeedsReverify(false)
          } else {
            setHasBuilt(false)
            setNeedsReverify(true)
            const issueText = result.verifyResult?.issues?.length
              ? result.verifyResult.issues.join('；')
              : i18n._({
                  id: 'app.houseAgent.verify.pending',
                  message: 'Modified, pending verification.',
                })
            setNotice(
              `${i18n._({
                id: 'app.houseAgent.verify.pendingPrefix',
                message: 'Modified, pending check: ',
              })}${issueText}`,
            )
          }
        }
      } else {
        setNotice(
          result.error ||
            i18n._({
              id: 'app.houseAgent.stopped',
              message:
                'Stopped or step limit reached. Completed edits remain; use editor Undo to revert them.',
            }),
        )
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      controller.current = null
      setStreamState(null)
      setBusy(false)
    }
  }

  return (
    <>
      {!embedded && !open && (
        <button
          type="button"
          className="absolute right-4 bottom-20 z-40 flex items-center gap-2 rounded-full border border-white/15 bg-zinc-900 px-4 py-3 text-white shadow-xl hover:bg-zinc-800"
          onClick={() => setOpen(true)}
        >
          <Bot size={20} />
          {i18n._({ id: 'app.houseAgent.title', message: 'House Agent' })}
        </button>
      )}
      <section
        hidden={!embedded && !open}
        className={
          embedded
            ? 'flex h-full w-full flex-col overflow-hidden bg-transparent text-zinc-100'
            : 'absolute top-16 right-3 bottom-4 z-50 flex w-[440px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 text-zinc-100 shadow-2xl'
        }
      >
        <header className="flex items-center justify-between gap-2 border-white/10 border-b px-3 py-2.5">
          <div className="grid grid-cols-2 gap-0.5 rounded-xl bg-black/50 p-0.5">
            <button
              type="button"
              onClick={() => setWorkspaceTab('build')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                workspaceTab === 'build'
                  ? 'bg-white/15 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {i18n._({ id: 'app.houseAgent.tab.build', message: 'Design & Build' })}
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceTab('studio')}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                workspaceTab === 'studio'
                  ? 'bg-white/15 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {i18n._({ id: 'app.houseAgent.tab.studio', message: 'Image Studio' })}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy || reading}
              onClick={newChat}
              aria-label={i18n._({ id: 'app.houseAgent.reset', message: 'New chat' })}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 disabled:opacity-40"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              disabled={busy || reading}
              onClick={() => void showHistory()}
              aria-label={i18n._({ id: 'app.houseAgent.history.title', message: 'Chat history' })}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 disabled:opacity-40"
            >
              <History size={16} />
            </button>
            {effectiveConfigured && effectiveModelLabel && (
              <span className="max-w-28 truncate rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                {effectiveModelLabel}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              title={i18n._({
                id: 'app.houseAgent.settings.toggle',
                message: 'Model & reasoning settings',
              })}
              aria-label={i18n._({
                id: 'app.houseAgent.settings.toggle',
                message: 'Model & reasoning settings',
              })}
              className={`rounded-lg p-1.5 ${
                showSettings ? 'bg-white/15 text-white' : 'text-zinc-400 hover:bg-white/10'
              }`}
            >
              <Settings2 size={16} />
            </button>
            {!embedded && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={i18n._({ id: 'app.houseAgent.close', message: 'Close agent panel' })}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </header>

        {history !== null && (
          <div className="max-h-64 space-y-2 overflow-y-auto border-white/10 border-b bg-zinc-900 p-3">
            <div className="flex justify-between text-xs">
              <span>{i18n._({ id: 'app.houseAgent.history.title', message: 'Chat history' })}</span>
              <button
                type="button"
                onClick={() => setHistory(null)}
                aria-label={i18n._({ id: 'app.houseAgent.close', message: 'Close agent panel' })}
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">
              {i18n._({
                id: 'app.houseAgent.history.local',
                message:
                  'Saved on this browser for this project. Opening a chat does not restore scene geometry.',
              })}
            </p>
            {history.length === 0 && (
              <p className="text-xs text-zinc-400">
                {i18n._({
                  id: 'app.houseAgent.history.empty',
                  message: 'No saved conversations yet.',
                })}
              </p>
            )}
            {history.map((record) => (
              <button
                key={record.id}
                type="button"
                disabled={busy || reading}
                className="block w-full truncate rounded-lg bg-white/5 p-2 text-left text-xs hover:bg-white/10 disabled:opacity-40"
                onClick={() => {
                  if (controller.current || busy || reading) return
                  historyRequest.current += 1
                  followConversation.current = true
                  setWorkspaceTab('build')
                  setChatId(record.id)
                  setMessages(record.messages)
                  setCurrentPlan(record.plan)
                  setHasPlan(record.plan !== null && record.planPending === true)
                  setHasBuilt(false)
                  setNeedsReverify(false)
                  setEvents([])
                  setImages([])
                  setDraft('')
                  setOpenItems([])
                  setNotice('')
                  setHistory(null)
                }}
              >
                {record.title}
                <span className="mt-1 block text-[10px] text-zinc-500">
                  {new Date(record.updatedAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        )}
        {showSettings && (
          <div className="max-h-88 space-y-2.5 overflow-y-auto border-white/10 border-b bg-zinc-900/70 px-4 py-3 text-xs">
            {!effectiveConfigured && (
              <div className="space-y-1.5 text-amber-200">
                <p>
                  {i18n._({
                    id: 'app.houseAgent.configure',
                    message: 'Configure a vision model with tool calling below or in .env.local.',
                  })}
                </p>
                <code className="block whitespace-pre-wrap text-[11px] text-zinc-400">
                  {/* i18n-ignore: technical env var names */}
                  {ENV_TEMPLATE}
                </code>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">
                  {i18n._({ id: 'app.houseAgent.settings.baseUrl', message: 'API Base URL' })}
                </span>
                <input
                  type="url"
                  value={customSettings.baseUrl}
                  onChange={(e) => updateCustomSettings({ baseUrl: e.target.value })}
                  placeholder={config?.baseUrl || 'https://api.openai.com/v1'}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-sky-500"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">
                    {i18n._({ id: 'app.houseAgent.settings.model', message: 'Model' })}
                  </span>
                  <input
                    type="text"
                    value={customSettings.model}
                    onChange={(e) =>
                      updateCustomSettings({ model: e.target.value, reasoningEffort: 'auto' })
                    }
                    // i18n-ignore: technical model ID examples
                    placeholder={config?.model || 'gpt-4o / qwen-vl / deepseek'}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-sky-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">
                    {i18n._({
                      id: 'app.houseAgent.settings.reasoningEffort',
                      message: 'Reasoning effort',
                    })}
                  </span>
                  <select
                    value={reasoningEffort}
                    onChange={(e) =>
                      updateCustomSettings({
                        reasoningEffort: e.target.value as AgentReasoningEffort,
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] outline-none focus:border-sky-500"
                  >
                    {modelEfforts(chosenModel).map((effort) => (
                      <option key={effort} value={effort}>
                        {modelLabels.effort[effort]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">
                  {i18n._({
                    id: 'app.houseAgent.settings.apiKey',
                    message: 'API Key (optional if set in .env.local)',
                  })}
                </span>
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    value={customSettings.apiKey}
                    onChange={(e) => updateCustomSettings({ apiKey: e.target.value })}
                    placeholder={maskedKeyPlaceholder(config?.maskedApiKey, config?.configured)}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    disabled={!canScanAgentModels || agentModels.loading}
                    onClick={scanAgentModels}
                    className="shrink-0 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-medium text-sky-200 hover:bg-sky-500/25 disabled:opacity-40"
                  >
                    {agentModels.loading
                      ? i18n._({ id: 'app.houseAgent.settings.detecting', message: 'Detecting…' })
                      : i18n._({ id: 'app.houseAgent.settings.detect', message: 'Detect' })}
                  </button>
                </div>
              </label>
              {agentModels.count !== null && (
                <div className="space-y-1">
                  <p className="text-[11px] text-emerald-300">
                    {i18n._({
                      id: 'app.houseAgent.settings.detectedCount',
                      message: 'Detected {count} available models',
                      values: { count: chatModels.length },
                    })}
                  </p>
                  {chatModels.length > 0 && (
                    <select
                      value={
                        chatModels.some(({ id }) => id === effectiveModelLabel)
                          ? effectiveModelLabel
                          : ''
                      }
                      onChange={(event) => {
                        const model = chatModels.find(({ id }) => id === event.target.value)
                        if (model) selectChatModel(model)
                      }}
                      className="w-full rounded-lg border border-emerald-500/30 bg-black/50 px-2 py-1.5 font-mono text-[11px] text-emerald-100 outline-none focus:border-emerald-400"
                    >
                      <option value="">
                        {i18n._({
                          id: 'app.houseAgent.settings.pickModel',
                          message: 'Select a detected model…',
                        })}
                      </option>
                      {chatModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {agentModels.error && (
                <p className="text-[11px] text-amber-300">{agentModels.error}</p>
              )}
            </div>

            <div className="space-y-2 border-white/10 border-t pt-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[11px] text-violet-300">
                  {i18n._({
                    id: 'app.houseAgent.imageSettings.title',
                    message: 'Design Image Generation Model & Key (Independent)',
                  })}
                </span>
                {effectiveImageConfigured && effectiveImageModelLabel && (
                  <span className="truncate rounded-full bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
                    {effectiveImageModelLabel}
                  </span>
                )}
              </div>
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">
                  {i18n._({
                    id: 'app.houseAgent.imageSettings.baseUrl',
                    message: 'Image API Base URL',
                  })}
                </span>
                <input
                  type="url"
                  value={customImageSettings.baseUrl}
                  onChange={(e) => updateCustomImageSettings({ baseUrl: e.target.value })}
                  placeholder={imageConfigStatus?.baseUrl || 'https://api.openai.com/v1'}
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-violet-400"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">
                    {i18n._({
                      id: 'app.houseAgent.imageSettings.model',
                      message: 'Image Model',
                    })}
                  </span>
                  <input
                    type="text"
                    value={customImageSettings.model}
                    onChange={(e) => updateCustomImageSettings({ model: e.target.value })}
                    // i18n-ignore: technical image model ID examples
                    placeholder={imageConfigStatus?.model || 'gpt-image-1 / gemini-2.5-flash-image'}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-violet-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-zinc-400">
                    {i18n._({
                      id: 'app.houseAgent.imageSettings.mode',
                      message: 'API Mode',
                    })}
                  </span>
                  <select
                    value={customImageSettings.mode ?? imageConfigStatus?.mode ?? 'auto'}
                    onChange={(e) =>
                      updateCustomImageSettings({ mode: e.target.value as ImageGenMode })
                    }
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] outline-none focus:border-violet-400"
                  >
                    <option value="auto">
                      {i18n._({ id: 'app.houseAgent.imageSettings.mode.auto', message: 'Auto' })}
                    </option>
                    <option value="images">
                      {i18n._({
                        id: 'app.houseAgent.imageSettings.mode.images',
                        message: 'Images API (/images/generations)',
                      })}
                    </option>
                    <option value="chat">
                      {i18n._({
                        id: 'app.houseAgent.imageSettings.mode.chat',
                        message: 'Chat Image API (/chat/completions)',
                      })}
                    </option>
                  </select>
                </label>
              </div>
              <label className="space-y-1">
                <span className="text-[11px] text-zinc-400">
                  {i18n._({
                    id: 'app.houseAgent.imageSettings.apiKey',
                    message: 'Image API Key (separate from chat agent)',
                  })}
                </span>
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    value={customImageSettings.apiKey}
                    onChange={(e) => updateCustomImageSettings({ apiKey: e.target.value })}
                    placeholder={maskedKeyPlaceholder(
                      imageConfigStatus?.maskedApiKey,
                      imageConfigStatus?.configured,
                    )}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-violet-400"
                  />
                  <button
                    type="button"
                    disabled={!canScanImageModels || imageModels.loading}
                    onClick={() =>
                      void detectModels('image', imageBaseUrl, customImageSettings.apiKey)
                    }
                    className="shrink-0 rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1.5 text-[11px] font-medium text-violet-200 hover:bg-violet-500/25 disabled:opacity-40"
                  >
                    {imageModels.loading
                      ? i18n._({ id: 'app.houseAgent.settings.detecting', message: 'Detecting…' })
                      : i18n._({ id: 'app.houseAgent.settings.detect', message: 'Detect' })}
                  </button>
                </div>
              </label>
              {imageModels.count !== null && (
                <div className="space-y-1">
                  <p className="text-[11px] text-emerald-300">
                    {i18n._({
                      id: 'app.houseAgent.settings.detectedCount',
                      message: 'Detected {count} available models',
                      values: { count: imageModels.count },
                    })}
                  </p>
                  {imageModels.models.length > 0 && (
                    <select
                      value={
                        imageModels.models.some(({ id }) => id === effectiveImageModelLabel)
                          ? effectiveImageModelLabel
                          : ''
                      }
                      onChange={(e) => updateCustomImageSettings({ model: e.target.value })}
                      className="w-full rounded-lg border border-violet-500/30 bg-black/50 px-2 py-1.5 font-mono text-[11px] text-violet-100 outline-none focus:border-violet-400"
                    >
                      <option value="">
                        {i18n._({
                          id: 'app.houseAgent.settings.pickModel',
                          message: 'Select a detected model…',
                        })}
                      </option>
                      {imageModels.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {imageModels.error && (
                <p className="text-[11px] text-amber-300">{imageModels.error}</p>
              )}
              <code className="block whitespace-pre-wrap text-[10px] text-zinc-500">
                {/* i18n-ignore: technical env var names */}
                {IMAGE_ENV_TEMPLATE}
              </code>
            </div>

            <div className="space-y-2 border-white/10 border-t pt-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={savingEnv}
                  onClick={() => void saveSettingsToEnv(true)}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  {savingEnv
                    ? i18n._({ id: 'app.houseAgent.settings.savingEnv', message: 'Saving…' })
                    : i18n._({
                        id: 'app.houseAgent.settings.saveEnv',
                        message: 'Save keys & models to .env.local',
                      })}
                </button>
                {envSaveState === 'saved' && !savingEnv && (
                  <span className="text-[10px] text-emerald-300">
                    {i18n._({
                      id: 'app.houseAgent.settings.savedEnvHint',
                      message: 'Persisted in project .env.local',
                    })}
                  </span>
                )}
              </div>
              {envSaveError && <p className="text-[11px] text-amber-300">{envSaveError}</p>}
            </div>

            <p className="text-[11px] text-zinc-500">
              {i18n._({
                id: 'app.houseAgent.privacy',
                message:
                  'Messages and images are sent to your configured model when you send. Completed conversations are saved in this browser for this project.',
              })}
            </p>
          </div>
        )}

        {workspaceTab === 'studio' ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
            <HouseAgentImageStudio
              configured={effectiveImageConfigured}
              modelLabel={effectiveImageModelLabel}
              imageConfig={imageRuntimeOverride}
              onOpenSettings={() => setShowSettings(true)}
              onAttachToChat={({ imageDataUrl, prompt: imgPrompt, preset }) => {
                if (images.length < MAX_AGENT_IMAGES) {
                  setImages((prev) => [
                    ...prev,
                    { name: `design-${preset}.png`, url: imageDataUrl },
                  ])
                }
                const hint = i18n._({
                  id: 'app.houseAgent.imageStudio.chatAttachPrefix',
                  message:
                    'Please study this generated architectural design image, analyze its layout, massing, materials, and proportions, and plan/build the 3D house:',
                })
                setDraft((prev) =>
                  prev.trim() ? `${prev}\n${hint} ${imgPrompt}` : `${hint} ${imgPrompt}`,
                )
                setWorkspaceTab('build')
              }}
              onClose={() => setWorkspaceTab('build')}
            />
          </div>
        ) : (
          <>
            <div
              ref={scroll}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
              onScroll={({ currentTarget }) => {
                const { scrollHeight, clientHeight, scrollTop } = currentTarget
                followConversation.current = scrollHeight - clientHeight - scrollTop <= 48
              }}
            >
              {messages.length === 0 && (
                <HouseAgentStarters
                  disabled={busy || reading}
                  onDraft={(prompt) => {
                    setDraft((previous) => (previous.trim() ? `${previous}\n\n${prompt}` : prompt))
                    composer.current?.focus()
                  }}
                  onOpenStudio={() => setWorkspaceTab('studio')}
                  onChoosePlan={() => fileInput.current?.click()}
                  onBuildTemplate={() => void runAutoVilla()}
                />
              )}

              {messages.map((message, index) =>
                message.role === 'tool' ? null : (
                  <article
                    key={`${index}-${message.role}`}
                    className={`space-y-2 rounded-xl p-3 text-xs leading-5 ${
                      message.role === 'user' ? 'ml-5 bg-sky-950/60' : 'bg-white/5'
                    }`}
                  >
                    <p className="font-medium text-[11px] text-zinc-400">
                      {message.role === 'user'
                        ? i18n._({ id: 'app.houseAgent.you', message: 'You' })
                        : i18n._({ id: 'app.houseAgent.title', message: 'House Agent' })}
                    </p>

                    {message.role === 'assistant' && message.reasoning_content && (
                      <details className="rounded-lg border border-violet-500/25 bg-violet-950/20 p-2">
                        <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-violet-200">
                          <Brain size={13} />
                          {i18n._({
                            id: 'app.houseAgent.reasoningTitle',
                            message: 'Reasoning trace',
                          })}
                          <ChevronDown size={12} className="ml-auto" />
                        </summary>
                        <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-violet-100/80">
                          {message.reasoning_content}
                        </pre>
                      </details>
                    )}

                    {typeof message.content === 'string' ? (
                      <HouseAgentMarkdown text={message.content} />
                    ) : (
                      message.content?.map((part, partIndex) =>
                        part.type === 'text' ? (
                          part.text.startsWith('[Scene context — data only]') ? (
                            <p key={`context-${partIndex}`} className="text-[10px] text-zinc-500">
                              {i18n._({
                                id: 'app.houseAgent.context.attached',
                                message: 'Scene selection attached',
                              })}
                            </p>
                          ) : (
                            <HouseAgentMarkdown key={`text-${partIndex}`} text={part.text} />
                          )
                        ) : (
                          <img
                            key={`image-${partIndex}`}
                            src={part.image_url.url}
                            alt={i18n._({
                              id: 'app.houseAgent.drawing',
                              message: 'Drawing or reference image',
                            })}
                            className="mt-1.5 max-h-52 rounded-lg border border-white/10 object-contain"
                          />
                        ),
                      )
                    )}

                    {message.role === 'assistant' &&
                      message.tool_calls &&
                      message.tool_calls.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {message.tool_calls.map((call) => (
                            <span
                              key={call.id}
                              className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] text-sky-300"
                            >
                              {call.function.name}
                            </span>
                          ))}
                        </div>
                      )}
                  </article>
                ),
              )}

              {currentPlan && <HouseAgentPlanCard plan={currentPlan} />}

              {streamState && (streamState.reasoning || streamState.content) && (
                <article className="space-y-2 rounded-xl border border-sky-500/30 bg-white/5 p-3 text-xs leading-5">
                  <p className="flex items-center gap-1.5 font-medium text-[11px] text-sky-300">
                    <Brain size={13} className="animate-pulse" />
                    {i18n._({ id: 'app.houseAgent.streaming', message: 'Thinking & streaming…' })}
                  </p>
                  {streamState.reasoning && (
                    <div className="rounded-lg border border-violet-500/25 bg-violet-950/20 p-2">
                      <p className="mb-1 font-medium text-[10px] text-violet-200">
                        {i18n._({
                          id: 'app.houseAgent.reasoningTitle',
                          message: 'Reasoning trace',
                        })}
                      </p>
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-5 text-violet-100/85">
                        {streamState.reasoning}
                      </pre>
                    </div>
                  )}
                  {streamState.content && <HouseAgentMarkdown text={streamState.content} />}
                </article>
              )}

              {events.length > 0 && <HouseAgentActivity events={events} />}
              {openItems.length > 0 && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-3 text-xs">
                  <h3 className="mb-2 font-medium text-amber-200">
                    {i18n._({ id: 'app.houseAgent.openItems', message: 'Open items' })}
                  </h3>
                  <ul className="list-disc space-y-1 pl-4 text-amber-100/80">
                    {openItems.map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {busy && !streamState && (
                <p role="status" className="animate-pulse text-xs text-sky-300">
                  {i18n._({
                    id: 'app.houseAgent.working',
                    message: 'Reading, planning, or running tools…',
                  })}
                </p>
              )}

              {notice && (
                <p role="alert" className="rounded-lg bg-amber-950/40 p-3 text-xs text-amber-200">
                  {notice}
                </p>
              )}
            </div>

            <div className="space-y-2.5 border-white/10 border-t p-3.5">
              {(selection.selectedIds.length > 0 || selection.zoneId) && (
                <div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2 py-1.5 text-[11px] text-sky-200">
                  <Layers size={13} />
                  {i18n._({
                    id: 'app.houseAgent.context.selected',
                    message: 'Current selection will accompany your message',
                  })}
                </div>
              )}
              {messages.length === 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPreferredMode('plan')
                      setDraft(
                        selection.selectedIds.length || selection.zoneId
                          ? '请检查当前选中对象，说明它的尺寸、材质和可改进之处。'
                          : '请检查当前楼层，说明房间面积、门窗和通行问题。',
                      )
                      composer.current?.focus()
                    }}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-white/5"
                  >
                    {i18n._({
                      id: 'app.houseAgent.context.inspect',
                      message: 'Inspect selection / floor',
                    })}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPreferredMode('plan')
                      setDraft('根据当前选中房间及楼层，规划家具和材质，先检查尺寸及门口通道。')
                      composer.current?.focus()
                    }}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-white/5"
                  >
                    {i18n._({ id: 'app.houseAgent.context.furnish', message: 'Plan furnishings' })}
                  </button>
                </div>
              )}

              {showPicker && (
                <HouseAgentAssetPicker
                  onClose={() => setShowPicker(false)}
                  onPick={(picked) => {
                    setDraft((prev) => (prev ? `${prev}\n${picked.snippet}` : picked.snippet))
                    if (picked.imageUrl && images.length < MAX_AGENT_IMAGES) {
                      setImages((prev) => [...prev, { name: picked.name, url: picked.imageUrl! }])
                    }
                  }}
                />
              )}

              {images.length > 0 && (
                <div className="flex gap-2 overflow-auto">
                  {images.map((image, idx) => (
                    <button
                      key={`${image.name}-${idx}`}
                      type="button"
                      disabled={busy}
                      onClick={() => setImages((items) => items.filter((_, i) => i !== idx))}
                      title={i18n._({ id: 'app.houseAgent.removeImage', message: 'Remove image' })}
                      className="relative shrink-0"
                    >
                      <img
                        src={image.url}
                        alt={image.name}
                        className="h-14 w-18 rounded border border-white/20 object-cover"
                      />
                      <X size={12} className="absolute top-0 right-0 bg-black" />
                    </button>
                  ))}
                </div>
              )}

              <div
                ref={modelPicker}
                className="relative rounded-2xl border border-white/15 bg-zinc-900/90 p-2.5 focus-within:border-sky-500/70"
              >
                {showArchitectPopover && (
                  <HouseAgentArchitectPopover
                    tab={pickerTab}
                    profile={buildProfile}
                    effort={reasoningEffort}
                    currentModel={effectiveModelLabel}
                    detectedModels={chatModels}
                    scanned={agentModels.count !== null}
                    loading={agentModels.loading}
                    scanError={agentModels.error}
                    canScan={canScanAgentModels}
                    onTabChange={setPickerTab}
                    onSelectProfile={(profile) => {
                      updateCustomSettings({ buildProfile: profile, modelTab: 'architect' })
                    }}
                    onSelectEffort={(effort) => updateCustomSettings({ reasoningEffort: effort })}
                    onSelectModel={selectChatModel}
                    onScan={scanAgentModels}
                    onOpenSettings={() => {
                      setShowArchitectPopover(false)
                      setShowSettings(true)
                    }}
                    onClose={() => {
                      setShowArchitectPopover(false)
                      modelTrigger.current?.focus()
                    }}
                  />
                )}
                <textarea
                  ref={composer}
                  value={draft}
                  maxLength={30_000}
                  disabled={busy}
                  onPaste={(event) => void handlePaste(event)}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
                      return
                    event.preventDefault()
                    if (draft.trim() || images.length) void send(preferredMode)
                  }}
                  className="min-h-14 w-full resize-none bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
                  placeholder={i18n._({
                    id: 'app.houseAgent.placeholder',
                    message:
                      'Describe dimensions, rooms, doors/windows, or paste (Ctrl+V) a floor plan…',
                  })}
                />

                <div className="mt-1.5 flex items-center gap-1">
                  <label
                    className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                    title={i18n._({
                      id: 'app.houseAgent.attach',
                      message: 'Attach PNG, JPEG or WebP (up to 8 images, 5 MB each)',
                    })}
                  >
                    <ImagePlus size={15} />
                    <input
                      ref={fileInput}
                      type="file"
                      className="sr-only"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      disabled={busy || reading}
                      aria-label={i18n._({
                        id: 'app.houseAgent.attach',
                        message: 'Attach PNG, JPEG or WebP (up to 8 images, 5 MB each)',
                      })}
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? [])
                        event.target.value = ''
                        if (files.length) void addFiles(files)
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={busy || capturing || images.length >= MAX_AGENT_IMAGES}
                    onClick={() => void handleCaptureViewport()}
                    title={i18n._({
                      id: 'app.houseAgent.captureView',
                      message: 'Capture current 3D viewport',
                    })}
                    aria-label={i18n._({
                      id: 'app.houseAgent.captureView',
                      message: 'Capture current 3D viewport',
                    })}
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 disabled:opacity-40"
                  >
                    <Camera size={15} />
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowPicker((v) => !v)}
                    title={i18n._({
                      id: 'app.houseAgent.openPicker',
                      message: 'Pick scene guides, 3D assets & materials',
                    })}
                    aria-label={i18n._({
                      id: 'app.houseAgent.openPicker',
                      message: 'Pick scene guides, 3D assets & materials',
                    })}
                    className={`rounded-lg p-1.5 ${
                      showPicker
                        ? 'bg-sky-600/30 text-sky-200'
                        : 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                    }`}
                  >
                    <Layers size={15} />
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setWorkspaceTab('studio')}
                    title={i18n._({
                      id: 'app.houseAgent.openImageStudio',
                      message: 'Design Image Studio (generate renderings & blueprints)',
                    })}
                    aria-label={i18n._({
                      id: 'app.houseAgent.openImageStudio',
                      message: 'Design Image Studio (generate renderings & blueprints)',
                    })}
                    className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                  >
                    <Sparkles size={15} />
                  </button>

                  <div className="relative ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setPreferredMode((prev) => (prev === 'build' ? 'plan' : 'build'))
                      }
                      title={i18n._({
                        id: 'app.houseAgent.mode.toggleHint',
                        message: 'Switch between Plan only and Direct 3D Build',
                      })}
                      className={`rounded-full border px-2 py-1 text-[10px] font-medium transition-colors ${
                        preferredMode === 'build'
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                          : 'border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
                      }`}
                    >
                      {preferredMode === 'build'
                        ? i18n._({ id: 'app.houseAgent.mode.buildLabel', message: 'Build' })
                        : i18n._({ id: 'app.houseAgent.mode.planLabel', message: 'Plan' })}
                    </button>

                    <button
                      ref={modelTrigger}
                      type="button"
                      aria-expanded={showArchitectPopover}
                      disabled={busy}
                      onClick={() => {
                        if (!showArchitectPopover) setPickerTab(modelTab)
                        setShowArchitectPopover(!showArchitectPopover)
                      }}
                      className="inline-flex min-w-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                    >
                      {modelTab === 'models' && effectiveModelLabel && (
                        <HouseAgentModelLogo
                          modelId={effectiveModelLabel}
                          owner={chosenModel?.ownedBy}
                          compact
                        />
                      )}
                      <span className="max-w-24 truncate font-medium">
                        {modelTab === 'models' && effectiveModelLabel
                          ? effectiveModelLabel
                          : i18n._({
                              id: 'app.houseAgent.architect.pillLabel',
                              message: 'Architect',
                            })}
                      </span>
                      <span className="shrink-0 text-zinc-400">
                        {modelTab === 'architect'
                          ? modelLabels.profile[buildProfile]
                          : modelLabels.effort[reasoningEffort]}
                      </span>
                      <ChevronDown size={11} className="shrink-0 text-zinc-400" />
                    </button>

                    {busy ? (
                      <button
                        type="button"
                        onClick={() => controller.current?.abort()}
                        title={i18n._({ id: 'app.houseAgent.stop', message: 'Stop' })}
                        aria-label={i18n._({ id: 'app.houseAgent.stop', message: 'Stop' })}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
                      >
                        <Square size={11} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          !effectiveConfigured || reading || (!draft.trim() && !images.length)
                        }
                        onClick={() => void send(preferredMode)}
                        title={
                          preferredMode === 'build'
                            ? i18n._({
                                id: 'app.houseAgent.refineBuild',
                                message: 'Send & update build',
                              })
                            : i18n._({ id: 'app.houseAgent.plan', message: 'Analyze & plan' })
                        }
                        aria-label={
                          preferredMode === 'build'
                            ? i18n._({
                                id: 'app.houseAgent.refineBuild',
                                message: 'Send & update build',
                              })
                            : i18n._({ id: 'app.houseAgent.plan', message: 'Analyze & plan' })
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black transition-opacity hover:bg-zinc-200 disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {hasPlan && !busy && (
                <button
                  type="button"
                  onClick={() => void send('build')}
                  disabled={images.length > 0 || Boolean(draft.trim())}
                  className="w-full rounded-lg border border-emerald-600 bg-emerald-950 p-2 text-xs font-medium text-emerald-100 hover:bg-emerald-900 disabled:opacity-40"
                >
                  {i18n._({ id: 'app.houseAgent.build', message: 'Confirm plan & build' })}
                </button>
              )}

              <p className="text-[10px] leading-4 text-zinc-500">
                {i18n._({
                  id: 'app.houseAgent.undo',
                  message:
                    'Build edits the current project and autosaves. Each tool edit supports editor Undo. New images or changes should be analyzed first.',
                })}
              </p>
            </div>
          </>
        )}
      </section>
    </>
  )
}
