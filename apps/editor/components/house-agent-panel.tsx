'use client'

import { type AnyNodeId, usePascalI18n, useScene } from '@pascal-app/core'
import { applySceneGraphToEditor, type SceneGraph } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import {
  ArrowUp,
  Bot,
  Brain,
  Camera,
  ChevronDown,
  DraftingCompass,
  Film,
  History,
  ImagePlus,
  Layers,
  Plus,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { type ClipboardEvent, useEffect, useRef, useState } from 'react'
import { getLocalAwareCatalog } from '@/lib/house-agent-catalog'
import { captureEphemeralViewport, executeHouseAgentTool } from '@/lib/house-agent-executor'
import {
  type ChatRecord,
  listAgentChats,
  recentAgentMessages,
  saveAgentChat,
} from '@/lib/house-agent-history'
import {
  type AgentClientConfig,
  type AgentConfiguration,
  type AgentMessage,
  type AgentMode,
  type AgentReasoningEffort,
  type AgentStreamEvent,
  type DetectedModelItem,
  type HousePlan,
  type HousePlanProgress,
  type ImageConfiguration,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGES,
} from '@/lib/house-agent-protocol'
import {
  type HouseAgentStreamState,
  type HouseAgentToolEvent,
  runHouseAgent,
} from '@/lib/house-agent-runner'
import { houseAgentSceneContext } from '@/lib/house-agent-workflow'
import { MODEL_API_CHANGED } from '@/lib/model-api-settings'
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
import { ModelApiSetupHint } from './model-api-setup-hint'

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

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Image could not be read.'))
    reader.readAsDataURL(file)
  })
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
      messages: recentAgentMessages(history),
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
  const [showPicker, setShowPicker] = useState(false)
  const [workspaceTab, setWorkspaceTab] = useState<'build' | 'image' | 'video'>('build')
  const [showArchitectPopover, setShowArchitectPopover] = useState(false)
  const [pickerTab, setPickerTab] = useState<HouseAgentModelTab>('architect')
  const [config, setConfig] = useState<AgentConfiguration | null>(null)
  const [imageConfigStatus, setImageConfigStatus] = useState<ImageConfiguration | null>(null)
  const [modelOverride, setModelOverride] = useState('')
  const [effortOverride, setEffortOverride] = useState<AgentReasoningEffort>()
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [streamState, setStreamState] = useState<HouseAgentStreamState | null>(null)
  const [events, setEvents] = useState<HouseAgentToolEvent[]>([])
  const [currentPlan, setCurrentPlan] = useState<HousePlan | null>(null)
  const [planProgress, setPlanProgress] = useState<HousePlanProgress | null>(null)
  const [resumeWroteScene, setResumeWroteScene] = useState<boolean>()
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
  const [agentModels, setAgentModels] = useState(EMPTY_MODEL_SCAN)
  const modelTab = modelOverride ? 'models' : 'architect'
  const chatModels = agentModels.models.filter((model) => model.kind === 'chat')
  const effectiveModelLabel = modelOverride || config?.model || ''
  const effectiveConfigured = Boolean(config?.modelDiscoveryConfigured && effectiveModelLabel)
  const chosenModel = chatModels.find((model) => model.id === effectiveModelLabel)
  const requestedEffort = effortOverride ?? config?.reasoningEffort ?? 'auto'
  const reasoningEffort =
    chosenModel?.reasoningEfforts && !modelEfforts(chosenModel).includes(requestedEffort)
      ? 'auto'
      : requestedEffort
  const effectiveImageConfigured = imageConfigStatus?.configured === true
  const effectiveImageModelLabel = imageConfigStatus?.model || ''
  const unfinishedPlan =
    resumeWroteScene !== undefined &&
    currentPlan?.automation &&
    planProgress &&
    planProgress.completed < planProgress.total
      ? { plan: currentPlan, progress: planProgress, wroteScene: resumeWroteScene }
      : undefined
  const resumeLabel = i18n._({ id: 'app.houseAgent.resumeBuild', message: 'Resume build' })

  const runtimeOverride: AgentClientConfig = {
    ...(modelOverride ? { model: modelOverride } : {}),
    ...(effortOverride !== undefined || modelOverride ? { reasoningEffort } : {}),
  }

  useEffect(() => () => controller.current?.abort(), [])

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
    let request: AbortController | undefined
    const loadConfiguration = () => {
      request?.abort()
      setModelOverride('')
      setEffortOverride(undefined)
      setAgentModels(EMPTY_MODEL_SCAN)
      const abort = new AbortController()
      request = abort
      fetch('/api/house-agent', { signal: abort.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Configuration could not be loaded.')
          const body = await response.json()
          if (!abort.signal.aborted) setConfig(body)
        })
        .catch((error) => {
          if (!abort.signal.aborted) setNotice(String(error))
        })
      fetch('/api/house-agent/image', { signal: abort.signal })
        .then(async (response) => {
          if (!response.ok) return
          const body = await response.json()
          if (!abort.signal.aborted) setImageConfigStatus(body)
        })
        .catch(() => undefined)
    }
    loadConfiguration()
    window.addEventListener(MODEL_API_CHANGED, loadConfiguration)
    return () => {
      request?.abort()
      window.removeEventListener(MODEL_API_CHANGED, loadConfiguration)
    }
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

  useEffect(() => {
    if (!showArchitectPopover || pickerTab !== 'models' || !config?.modelDiscoveryConfigured) return
    const request = new AbortController()
    setAgentModels({ ...EMPTY_MODEL_SCAN, loading: true })
    void fetch('/api/house-agent/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useServerConfig: true, target: 'agent' }),
      signal: request.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          count?: number
          models?: DetectedModelItem[]
          error?: string
        } | null
        if (!response.ok || !Array.isArray(body?.models))
          throw new Error(body?.error || `HTTP ${response.status}`)
        if (!request.signal.aborted)
          setAgentModels({
            loading: false,
            models: body.models,
            count: body.count ?? body.models.length,
            error: '',
          })
      })
      .catch((error) => {
        if (!request.signal.aborted)
          setAgentModels({
            ...EMPTY_MODEL_SCAN,
            error: error instanceof Error ? error.message : 'Model detection failed.',
          })
      })
    return () => request.abort()
  }, [showArchitectPopover, pickerTab, config])

  function selectChatModel(model: DetectedModelItem) {
    setModelOverride(model.id)
    setEffortOverride(
      model.id === effectiveModelLabel &&
        modelEfforts(model, reasoningEffort).includes(reasoningEffort)
        ? reasoningEffort
        : 'auto',
    )
  }

  async function addFiles(files: File[]) {
    if (controller.current || busy || reading || capturing) return
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
    if (busy || reading || capturing || images.length >= MAX_AGENT_IMAGES) return
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
    if (busy || reading || capturing) return
    historyRequest.current += 1
    followConversation.current = true
    setChatId(crypto.randomUUID())
    setMessages([])
    setEvents([])
    setCurrentPlan(null)
    setPlanProgress(null)
    setResumeWroteScene(undefined)
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

  async function send(mode: AgentMode, resume = false) {
    if (controller.current || busy || reading || capturing || !effectiveConfigured) return
    const checkpoint = resume ? unfinishedPlan : undefined
    if (resume && (!checkpoint || draft.trim() || images.length)) return
    const rawText =
      (checkpoint ? resumeLabel : draft.trim()) ||
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
      setPlanProgress(null)
    }
    setMessages(next)
    setDraft('')
    setImages([])
    try {
      let latestPlan = mode === 'plan' ? null : currentPlan
      let latestProgress = mode === 'plan' ? null : planProgress
      let workingPlan = checkpoint?.plan
      const result = await runHouseAgent({
        messages: next,
        mode,
        signal: abort.signal,
        maxRounds: mode === 'build' ? 110 : 64,
        managedBuild: mode === 'build',
        ...(checkpoint ? { resume: checkpoint } : {}),
        nodeType: (id) => useScene.getState().nodes[id as AnyNodeId]?.type,
        onPhase: (progress) => {
          latestProgress = progress
          setPlanProgress(progress)
        },
        maxToolCalls: mode === 'build' ? 125 : 100,
        execute: executeHouseAgentTool,
        requestStream: (history, runMode, signal, onDelta) =>
          streamAgentTurn(history, runMode, signal, runtimeOverride, onDelta),
        onMessages: setMessages,
        onStream: setStreamState,
        onPlan: (plan) => {
          latestPlan = plan
          workingPlan = plan
          setCurrentPlan(plan)
        },
        onTool: (event) =>
          setEvents((previous) => [...previous.filter((item) => item.id !== event.id), event]),
      })
      if (result.status === 'error' && result.messages.length === next.length && !checkpoint) {
        setMessages(messages)
        setDraft(draft)
        setImages(images)
        setCurrentPlan(currentPlan)
        setPlanProgress(planProgress)
        setHasPlan(hasPlan)
        setNotice(result.error ?? '')
        return
      }
      const resumable =
        result.status !== 'completed' &&
        mode === 'build' &&
        workingPlan?.automation &&
        latestProgress &&
        latestProgress.completed < latestProgress.total
          ? Boolean(result.wroteScene)
          : undefined
      setResumeWroteScene(resumable)
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
          messages: recentAgentMessages(result.messages),
          plan: latestPlan,
          ...(latestProgress ? { planProgress: latestProgress } : {}),
          planPending,
          ...(resumable !== undefined ? { resumeWroteScene: resumable } : {}),
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
        <header className="flex flex-wrap items-center justify-between gap-2 border-white/10 border-b bg-zinc-950/40 px-3 py-2.5">
          <nav className="flex min-w-0 items-center gap-0.5 rounded-xl border border-white/8 bg-black/30 p-0.5">
            {(
              [
                {
                  id: 'build',
                  icon: DraftingCompass,
                  label: i18n._({ id: 'app.houseAgent.tab.build', message: 'Design & Build' }),
                  active: 'bg-sky-400/15 text-sky-100',
                },
                {
                  id: 'image',
                  icon: ImagePlus,
                  label: i18n._({ id: 'app.houseAgent.imageStudio.tabImage', message: 'Image' }),
                  active: 'bg-violet-400/15 text-violet-100',
                },
                {
                  id: 'video',
                  icon: Film,
                  label: i18n._({ id: 'app.houseAgent.imageStudio.tabVideo', message: 'Video' }),
                  active: 'bg-amber-400/15 text-amber-100',
                },
              ] as const
            ).map(({ id, icon: Icon, label, active }) => (
              <button
                key={id}
                type="button"
                aria-pressed={workspaceTab === id}
                onClick={() => setWorkspaceTab(id)}
                className={`flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5 font-medium text-[11px] whitespace-nowrap transition-colors ${workspaceTab === id ? active : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
              >
                <Icon size={12} className="shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>
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
                  if (controller.current || busy || reading || capturing) return
                  historyRequest.current += 1
                  followConversation.current = true
                  setWorkspaceTab('build')
                  setChatId(record.id)
                  setMessages(record.messages)
                  setCurrentPlan(record.plan)
                  setPlanProgress(record.planProgress ?? null)
                  setResumeWroteScene(record.resumeWroteScene)
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
        {workspaceTab !== 'build' ? (
          <div className="min-h-0 flex-1 p-3.5">
            <HouseAgentImageStudio
              studioTab={workspaceTab}
              configured={effectiveImageConfigured}
              modelLabel={effectiveImageModelLabel}
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
                  onOpenStudio={() => setWorkspaceTab('image')}
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

              {currentPlan && <HouseAgentPlanCard plan={currentPlan} progress={planProgress} />}

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

            <div className="shrink-0 space-y-2 border-white/10 border-t bg-zinc-950/55 px-3 py-3">
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

              {config && !effectiveConfigured && <ModelApiSetupHint />}
              <div
                ref={modelPicker}
                className="relative rounded-2xl border border-white/12 bg-linear-to-br from-sky-400/[0.07] to-zinc-900 px-2.5 py-2.5 shadow-lg shadow-black/20 transition-colors focus-within:border-sky-400/55"
              >
                {showArchitectPopover && (
                  <HouseAgentArchitectPopover
                    tab={pickerTab}
                    effort={reasoningEffort}
                    currentModel={effectiveModelLabel}
                    detectedModels={chatModels}
                    scanned={agentModels.count !== null}
                    loading={agentModels.loading}
                    scanError={agentModels.error}
                    onTabChange={setPickerTab}
                    onSelectEffort={setEffortOverride}
                    onSelectModel={selectChatModel}
                    onClose={() => {
                      setShowArchitectPopover(false)
                      modelTrigger.current?.focus()
                    }}
                  />
                )}
                <div className="mb-2 flex min-w-0 items-center gap-1.5">
                  <div
                    role="group"
                    aria-label={i18n._({
                      id: 'app.houseAgent.mode.toggleHint',
                      message: 'Switch between Plan only and Direct 3D Build',
                    })}
                    className="flex shrink-0 rounded-lg border border-white/10 bg-black/25 p-0.5"
                  >
                    {(['plan', 'build'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={preferredMode === mode}
                        disabled={busy}
                        onClick={() => setPreferredMode(mode)}
                        className="rounded-md px-2 py-1 font-medium text-[11px] text-zinc-400 hover:text-white aria-pressed:bg-sky-300/15 aria-pressed:text-sky-100 disabled:opacity-50"
                      >
                        {mode === 'build'
                          ? i18n._({ id: 'app.houseAgent.mode.buildLabel', message: 'Build' })
                          : i18n._({ id: 'app.houseAgent.mode.planLabel', message: 'Plan' })}
                      </button>
                    ))}
                  </div>
                  <button
                    ref={modelTrigger}
                    type="button"
                    aria-expanded={showArchitectPopover}
                    disabled={busy}
                    onClick={() => {
                      if (!showArchitectPopover) setPickerTab(modelTab)
                      setShowArchitectPopover(!showArchitectPopover)
                    }}
                    className="ml-auto inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    {modelTab === 'models' && effectiveModelLabel && (
                      <HouseAgentModelLogo
                        modelId={effectiveModelLabel}
                        owner={chosenModel?.ownedBy}
                        compact
                      />
                    )}
                    <span className="min-w-0 truncate font-medium">
                      {modelTab === 'models' && effectiveModelLabel
                        ? effectiveModelLabel
                        : i18n._({
                            id: 'app.houseAgent.architect.pillLabel',
                            message: 'Architect',
                          })}
                    </span>
                    <span className="min-w-0 truncate whitespace-nowrap text-zinc-400">
                      {modelTab === 'architect'
                        ? i18n._({
                            id: 'app.houseAgent.plan.stepsTitle',
                            message: 'Construction sequence',
                          })
                        : modelLabels.effort[reasoningEffort]}
                    </span>
                    <ChevronDown
                      size={11}
                      className="min-w-0 truncate whitespace-nowrap text-zinc-400"
                    />
                  </button>
                </div>
                {images.length > 0 && (
                  <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                    {images.map((image, index) => (
                      <div
                        className="flex max-w-36 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 p-1 text-xs text-zinc-300"
                        key={`${image.name}-${index}`}
                      >
                        <img
                          src={image.url}
                          alt=""
                          className="size-7 shrink-0 rounded object-cover"
                        />
                        <span className="truncate" title={image.name}>
                          {image.name}
                        </span>
                        <button
                          type="button"
                          aria-label={i18n._({
                            id: 'app.houseAgent.removeImage',
                            message: 'Remove image',
                          })}
                          disabled={busy}
                          onClick={() =>
                            setImages((items) =>
                              items.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={composer}
                  value={draft}
                  maxLength={30_000}
                  disabled={busy}
                  onPaste={(event) => void handlePaste(event)}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
                  }}
                  onDrop={(event) => {
                    const files = Array.from(event.dataTransfer.files)
                    if (!files.length) return
                    event.preventDefault()
                    void addFiles(files)
                  }}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing)
                      return
                    event.preventDefault()
                    if (draft.trim() || images.length) void send(preferredMode)
                  }}
                  className="field-sizing-content min-h-16 max-h-36 w-full resize-none overflow-y-auto bg-transparent px-1 text-[13px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-500"
                  placeholder={i18n._({
                    id: 'app.houseAgent.placeholder',
                    message:
                      'Describe dimensions, rooms, doors/windows, or paste (Ctrl+V) a floor plan…',
                  })}
                />

                <div className="mt-1 flex items-center gap-1 border-white/8 border-t pt-2">
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
                    disabled={busy || reading || capturing || images.length >= MAX_AGENT_IMAGES}
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
                    disabled={busy || reading || capturing}
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
                    onClick={() => setWorkspaceTab('image')}
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
                          !effectiveConfigured ||
                          reading ||
                          capturing ||
                          (!draft.trim() && !images.length)
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
                        className="grid size-8 place-items-center rounded-xl bg-sky-300 text-sky-950 shadow-md shadow-sky-900/30 transition-colors hover:bg-sky-200 disabled:bg-white/8 disabled:text-zinc-500 disabled:shadow-none"
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {unfinishedPlan && !busy && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-300/20 bg-sky-300/[0.06] p-2">
                  <span className="min-w-0 truncate text-xs text-zinc-300">
                    {unfinishedPlan.progress.completed}/{unfinishedPlan.progress.total}
                    {' · '}
                    {
                      unfinishedPlan.plan.automation?.phases[unfinishedPlan.progress.completed]
                        ?.title
                    }
                  </span>
                  <button
                    type="button"
                    onClick={() => void send('build', true)}
                    disabled={
                      !effectiveConfigured ||
                      reading ||
                      capturing ||
                      Boolean(draft.trim()) ||
                      images.length > 0
                    }
                    className="shrink-0 rounded-lg bg-sky-300 px-2.5 py-1.5 font-semibold text-xs text-sky-950 hover:bg-sky-200 disabled:opacity-40"
                  >
                    {resumeLabel}
                  </button>
                </div>
              )}

              {hasPlan && !unfinishedPlan && !busy && (
                <button
                  type="button"
                  onClick={() => void send('build')}
                  disabled={images.length > 0 || Boolean(draft.trim())}
                  className="w-full rounded-lg border border-emerald-600 bg-emerald-950 p-2 text-xs font-medium text-emerald-100 hover:bg-emerald-900 disabled:opacity-40"
                >
                  {i18n._({ id: 'app.houseAgent.build', message: 'Confirm plan & build' })}
                </button>
              )}

              {effectiveConfigured && (
                <p className="text-[10px] leading-4 text-zinc-500">
                  {i18n._({
                    id: 'app.houseAgent.privacy',
                    message:
                      'Messages and images are sent to your configured model when you send. Completed conversations are saved in this browser for this project.',
                  })}
                </p>
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
