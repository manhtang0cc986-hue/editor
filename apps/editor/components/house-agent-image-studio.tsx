'use client'

import { type AnyNodeId, GuideNode, saveAsset, usePascalI18n, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  Download,
  Film,
  Home,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Square,
  Video,
  Wand2,
  X,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { captureEphemeralViewport } from '@/lib/house-agent-executor'
import type { ImageClientConfig, ImageGenPreset, ImageGenSize } from '@/lib/house-agent-protocol'
import {
  captureCurrent3DPhoto,
  captureRoomShowcasePhotos,
  type Recorded3DVideo,
  record3DWalkthroughVideo,
} from '@/lib/scene-media-capture'

type GeneratedDesignItem = {
  id: string
  imageDataUrl: string
  prompt: string
  preset: ImageGenPreset
  size: ImageGenSize
  revisedPrompt: string | null
  model: string
  endpoint: string
  importedAsGuide?: boolean
}

type StudioReference = {
  id: string
  label: string
  kind: 'snapshot' | 'style'
  dataUrl: string
}

type AspectRatioOption = {
  id: '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
  size: ImageGenSize
  boxClass: string
}

const ASPECT_RATIOS: AspectRatioOption[] = [
  { id: '16:9', size: '1536x1024', boxClass: 'h-2.5 w-4' },
  { id: '9:16', size: '1024x1536', boxClass: 'h-4 w-2.5' },
  { id: '4:3', size: '1536x1024', boxClass: 'h-2.5 w-3.5' },
  { id: '3:4', size: '1024x1536', boxClass: 'h-3.5 w-2.5' },
  { id: '1:1', size: '1024x1024', boxClass: 'h-3 w-3' },
]

// i18n-ignore: short technical status badge
const BADGE_READY = 'READY'
// i18n-ignore: short technical status badge
const BADGE_FAST = 'FAST'

type HouseAgentImageStudioProps = {
  configured: boolean
  modelLabel: string
  imageConfig?: ImageClientConfig
  onOpenSettings: () => void
  onAttachToChat: (item: { imageDataUrl: string; prompt: string; preset: ImageGenPreset }) => void
  onClose: () => void
}

function getDefaultLevelId(): string | null {
  const active = useViewer.getState().selection.levelId
  const nodes = useScene.getState().nodes
  if (active && nodes[active as AnyNodeId]?.type === 'level') {
    return active
  }
  const firstLevel = Object.values(nodes).find((node) => node.type === 'level')
  return firstLevel?.id ?? null
}

async function dataUrlToImageFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const mime = blob.type || 'image/png'
  const ext = mime.includes('webp') ? 'webp' : mime.includes('jpeg') ? 'jpg' : 'png'
  return new File([blob], `${filename}.${ext}`, { type: mime })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

export function HouseAgentImageStudio({
  configured,
  modelLabel,
  imageConfig,
  onOpenSettings,
  onAttachToChat,
  onClose,
}: HouseAgentImageStudioProps) {
  const i18n = usePascalI18n()
  const [studioTab, setStudioTab] = useState<'image' | 'video'>('image')
  const [preset, setPreset] = useState<ImageGenPreset>('exterior')
  const [aspectId, setAspectId] = useState<AspectRatioOption['id']>('16:9')
  const [variations, setVariations] = useState<1 | 2 | 3 | 4>(2)
  const [resolutionTier, setResolutionTier] = useState<'1K' | '2K' | '4K'>('2K')

  // Smart prompt pill states (Image)
  const [renderStyle, setRenderStyle] = useState<
    'photorealistic' | 'architectural' | 'floorplan' | 'interior'
  >('photorealistic')
  const [lightingMood, setLightingMood] = useState<'golden' | 'daylight' | 'overcast' | 'twilight'>(
    'golden',
  )
  const [atmosphere, setAtmosphere] = useState<'diffused' | 'crisp' | 'warm'>('diffused')
  const [paletteTone, setPaletteTone] = useState<'neutrals' | 'timber' | 'monochrome'>('neutrals')

  // Smart prompt pill states (Video)
  const [cameraMotion, setCameraMotion] = useState<'orbit' | 'push' | 'sweep' | 'rise'>('orbit')
  const [videoPacing, setVideoPacing] = useState<'cinematic' | 'steady' | 'glide'>('cinematic')

  const [customDetails, setCustomDetails] = useState('')
  const [showLibrary, setShowLibrary] = useState(false)
  const [showAddRefMenu, setShowAddRefMenu] = useState(false)
  const [references, setReferences] = useState<StudioReference[]>([])

  // Video specific state
  const [videoDuration, setVideoDuration] = useState(5)
  const [videoRes, setVideoRes] = useState<'480P' | '768P' | '1080P'>('768P')
  const [startFrame, setStartFrame] = useState<string | null>(null)
  const [endFrame, setEndFrame] = useState<string | null>(null)

  const [capturingRef, setCapturingRef] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [roomShooting, setRoomShooting] = useState(false)
  const [roomProgress, setRoomProgress] = useState<{
    current: number
    total: number
    label: string
  } | null>(null)
  const [recordingVideo, setRecordingVideo] = useState(false)
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [videoOrbitMode, setVideoOrbitMode] = useState<'auto-orbit' | 'free'>('auto-orbit')
  const [recordedVideos, setRecordedVideos] = useState<Recorded3DVideo[]>([])
  const [error, setError] = useState('')
  const [results, setResults] = useState<GeneratedDesignItem[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const videoAbortRef = useRef<AbortController | null>(null)

  async function handleCaptureCurrentPhoto() {
    if (roomShooting || capturingRef || generating) return
    setRoomShooting(true)
    setError('')
    try {
      const photo = await captureCurrent3DPhoto()
      setResults((prev) =>
        [
          {
            id: photo.id,
            imageDataUrl: photo.imageDataUrl,
            prompt: photo.label,
            preset: 'exterior',
            size: '1536x1024',
            revisedPrompt: photo.label,
            model: '3D Viewport',
            endpoint: '3d-capture',
          } satisfies GeneratedDesignItem,
          ...prev,
        ].slice(0, 20),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : i18n._({
              id: 'app.houseAgent.imageStudio.captureFailed',
              message: 'Could not capture 3D viewport reference.',
            }),
      )
    } finally {
      setRoomShooting(false)
    }
  }

  async function handleCaptureAllRooms() {
    if (roomShooting || capturingRef || generating) return
    const controller = new AbortController()
    abortRef.current = controller
    setRoomShooting(true)
    setRoomProgress(null)
    setError('')
    try {
      const captured = await captureRoomShowcasePhotos({
        signal: controller.signal,
        onProgress: (current, total, label) => setRoomProgress({ current, total, label }),
        onPhoto: (photo) => {
          setResults((prev) =>
            [
              {
                id: photo.id,
                imageDataUrl: photo.imageDataUrl,
                prompt: photo.label,
                preset: photo.category === 'plan' ? 'floorplan' : 'interior',
                size: '1536x1024',
                revisedPrompt: photo.label,
                model: '3D Room Tour',
                endpoint: '3d-room-capture',
              } satisfies GeneratedDesignItem,
              ...prev,
            ].slice(0, 20),
          )
        },
      })
      if (captured.length === 0 && !controller.signal.aborted) {
        setError(
          i18n._({
            id: 'app.houseAgent.imageStudio.captureFailed',
            message: 'Could not capture 3D viewport reference.',
          }),
        )
      }
    } finally {
      abortRef.current = null
      setRoomShooting(false)
      setRoomProgress(null)
    }
  }

  async function handleRecord3DVideo() {
    if (recordingVideo) return
    const controller = new AbortController()
    videoAbortRef.current = controller
    setRecordingVideo(true)
    setRecordingElapsed(0)
    setError('')
    try {
      const video = await record3DWalkthroughVideo({
        durationSeconds: videoDuration,
        orbitMode: videoOrbitMode,
        signal: controller.signal,
        onElapsed: setRecordingElapsed,
      })
      setRecordedVideos((prev) => [video, ...prev].slice(0, 6))
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error
            ? err.message
            : i18n._({
                id: 'app.houseAgent.imageStudio.captureFailed',
                message: 'Could not capture 3D viewport reference.',
              }),
        )
      }
    } finally {
      videoAbortRef.current = null
      setRecordingVideo(false)
    }
  }

  const selectedAspect = useMemo(
    () => ASPECT_RATIOS.find((a) => a.id === aspectId) ?? ASPECT_RATIOS[0]!,
    [aspectId],
  )

  const composedImagePrompt = useMemo(() => {
    const styleMap = {
      photorealistic: 'photorealistic architectural render of this view',
      architectural: 'clean architectural concept illustration of this view',
      floorplan: 'accurate top-down 2D architectural floor plan blueprint',
      interior: 'photorealistic interior design render of this room',
    }
    const lightMap = {
      golden: 'golden hour light',
      daylight: 'bright natural daylight',
      overcast: 'soft overcast architectural light',
      twilight: 'blue-hour twilight with warm interior glow',
    }
    const atmoMap = {
      diffused: 'soft diffused ambient shadows',
      crisp: 'crisp directional sunlight',
      warm: 'warm inviting atmosphere',
    }
    const palMap = {
      neutrals: 'warm neutrals material palette',
      timber: 'natural oak timber and stone palette',
      monochrome: 'minimalist concrete and glass palette',
    }
    const base = `${styleMap[renderStyle]} — ${lightMap[lightingMood]}, ${atmoMap[atmosphere]}, ${palMap[paletteTone]}, ${resolutionTier} architectural detail`
    return customDetails.trim() ? `${base}. ${customDetails.trim()}` : base
  }, [renderStyle, lightingMood, atmosphere, paletteTone, resolutionTier, customDetails])

  const composedVideoPrompt = useMemo(() => {
    const motionMap = {
      orbit: 'slow orbit',
      push: 'gentle push-in',
      sweep: 'panoramic sweep',
      rise: 'aerial drone rise',
    }
    const paceMap = {
      cinematic: 'slow cinematic',
      steady: 'steady architectural walkthrough',
      glide: 'smooth stabilized glide',
    }
    const lightMap = {
      golden: 'golden hour light',
      daylight: 'natural daylight',
      overcast: 'soft diffused light',
      twilight: 'twilight architectural lighting',
    }
    const base = `${motionMap[cameraMotion]} of this view — ${paceMap[videoPacing]}, ${lightMap[lightingMood]}`
    return customDetails.trim() ? `${base}. ${customDetails.trim()}` : base
  }, [cameraMotion, videoPacing, lightingMood, customDetails])

  function cycleStyle(val: typeof renderStyle) {
    setRenderStyle(val)
    if (val === 'floorplan') setPreset('floorplan')
    else if (val === 'interior') setPreset('interior')
    else setPreset('exterior')
  }

  function handleEnhancePrompt() {
    const addition =
      studioTab === 'image'
        ? i18n._({
            id: 'app.houseAgent.imageStudio.enhanceImageSnippet',
            message:
              'sharp architectural mullions, realistic global illumination, physical material reflections, human-scale landscaping',
          })
        : i18n._({
            id: 'app.houseAgent.imageStudio.enhanceVideoSnippet',
            message:
              'smooth parallax depth, consistent structural geometry, subtle tree breeze and sun shimmer',
          })
    setCustomDetails((prev) => (prev.trim() ? `${prev.trim()}, ${addition}` : addition))
  }

  async function addSnapshotReference(kind: 'ref' | 'start' | 'end') {
    if (capturingRef || generating) return
    setCapturingRef(true)
    setError('')
    setShowAddRefMenu(false)
    try {
      const captured = await captureEphemeralViewport({
        captureMode: 'standard',
        standardSize: { w: 1280, h: 800 },
      })
      if (kind === 'start') {
        setStartFrame(captured.dataUrl)
      } else if (kind === 'end') {
        setEndFrame(captured.dataUrl)
      } else {
        setReferences((prev) => [
          ...prev.slice(0, 5),
          {
            id: crypto.randomUUID(),
            label: i18n._({
              id: 'app.houseAgent.imageStudio.snapshotTag',
              message: '3D Snapshot',
            }),
            kind: 'snapshot',
            dataUrl: captured.dataUrl,
          },
        ])
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : i18n._({
              id: 'app.houseAgent.imageStudio.captureFailed',
              message: 'Could not capture 3D viewport reference.',
            }),
      )
    } finally {
      setCapturingRef(false)
    }
  }

  async function addUploadedReferences(files: File[]) {
    setShowAddRefMenu(false)
    setError('')
    try {
      const urls = await Promise.all(files.map((f) => readFileAsDataUrl(f)))
      setReferences((prev) => {
        const appended: StudioReference[] = urls.map((url, idx) => ({
          id: crypto.randomUUID(),
          label:
            files[idx]?.name ||
            i18n._({ id: 'app.houseAgent.imageStudio.useAsRef', message: 'Ref' }),
          kind: 'style',
          dataUrl: url,
        }))
        return [...prev, ...appended].slice(0, 6)
      })
    } catch {
      setError(
        i18n._({
          id: 'app.houseAgent.imageStudio.failed',
          message: 'Image generation failed.',
        }),
      )
    }
  }

  async function handleGenerateImages() {
    if (generating) return
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    setError('')

    const primaryRef = references[0]?.dataUrl
    const count = variations

    try {
      const requests = Array.from({ length: count }, (_, idx) =>
        fetch('/api/house-agent/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt:
              count > 1 ? `${composedImagePrompt} (variation ${idx + 1})` : composedImagePrompt,
            preset,
            size: selectedAspect.size,
            ...(primaryRef ? { referenceImage: primaryRef } : {}),
            ...(imageConfig ? { config: imageConfig } : {}),
          }),
          signal: controller.signal,
        }).then(async (response) => {
          const body = (await response.json().catch(() => null)) as {
            imageDataUrl?: string
            revisedPrompt?: string | null
            model?: string
            endpoint?: string
            error?: string
          } | null
          if (!response.ok || !body?.imageDataUrl) {
            throw new Error(
              body?.error ||
                i18n._({
                  id: 'app.houseAgent.imageStudio.failed',
                  message: 'Image generation failed.',
                }),
            )
          }
          return {
            id: crypto.randomUUID(),
            imageDataUrl: body.imageDataUrl,
            prompt: composedImagePrompt,
            preset,
            size: selectedAspect.size,
            revisedPrompt: body.revisedPrompt ?? null,
            model: body.model || modelLabel,
            endpoint: body.endpoint || 'images',
          } satisfies GeneratedDesignItem
        }),
      )

      const generatedItems = await Promise.all(requests)
      setResults((prev) => [...generatedItems, ...prev].slice(0, 12))
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error
            ? err.message
            : i18n._({
                id: 'app.houseAgent.imageStudio.failed',
                message: 'Image generation failed.',
              }),
        )
      }
    } finally {
      abortRef.current = null
      setGenerating(false)
    }
  }

  async function handleImportGuide(item: GeneratedDesignItem) {
    setError('')
    try {
      const levelId = getDefaultLevelId()
      if (!levelId) {
        throw new Error(
          i18n._({
            id: 'app.houseAgent.imageStudio.noLevel',
            message: 'Create or select a building level first before importing a guide.',
          }),
        )
      }
      const file = await dataUrlToImageFile(item.imageDataUrl, `design-${item.preset}`)
      const assetUrl = await saveAsset(file)
      const guide = GuideNode.parse({
        name: `Design ${item.preset}`,
        url: assetUrl,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: 1,
        opacity: 50,
        scaleReference: null,
      })
      useScene.getState().createNode(guide, levelId as AnyNodeId)
      setResults((prev) =>
        prev.map((entry) => (entry.id === item.id ? { ...entry, importedAsGuide: true } : entry)),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : i18n._({
              id: 'app.houseAgent.imageStudio.importFailed',
              message: 'Unable to import guide.',
            }),
      )
    }
  }

  const promptTemplates = [
    {
      id: 'villa',
      label: i18n._({
        id: 'app.houseAgent.imageStudio.lib.villa',
        message: 'Two-storey modern white villa with courtyard pool',
      }),
      text: 'Two-storey modern white stucco villa with timber soffits, floor-to-ceiling glass, courtyard pool and olive trees',
    },
    {
      id: 'floorplan',
      label: i18n._({
        id: 'app.houseAgent.imageStudio.lib.floorplan',
        message: '2D dimensioned floor plan (living, kitchen, 3 bedrooms)',
      }),
      text: '12m x 10m ground floor layout showing living/dining, L-shaped kitchen, hallway, master suite with labels and metric dimensions',
    },
    {
      id: 'interior',
      label: i18n._({
        id: 'app.houseAgent.imageStudio.lib.interior',
        message: 'Warm sunlit minimalist living room',
      }),
      text: 'Double-height minimalist living room with oak herringbone parquet, linen sectional sofa, warm cove lighting and courtyard view',
    },
  ]

  return (
    <div className="flex h-full flex-col gap-3 text-xs">
      {/* Header matching official Renders drawer */}
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm text-zinc-100">
          {i18n._({ id: 'app.houseAgent.imageStudio.rendersTitle', message: 'Renders' })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={i18n._({
            id: 'app.houseAgent.imageStudio.close',
            message: 'Close image studio',
          })}
          className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {/* Image | Video Segmented Tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/50 p-1">
        <button
          type="button"
          onClick={() => setStudioTab('image')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            studioTab === 'image'
              ? 'border border-violet-400/35 bg-violet-600/25 text-violet-100'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <ImageIcon size={13} />
          {i18n._({ id: 'app.houseAgent.imageStudio.tabImage', message: 'Image' })}
        </button>
        <button
          type="button"
          onClick={() => setStudioTab('video')}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
            studioTab === 'video'
              ? 'border border-amber-400/35 bg-amber-600/20 text-amber-100'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Film size={13} />
          {i18n._({ id: 'app.houseAgent.imageStudio.tabVideo', message: 'Video' })}
        </button>
      </div>

      {/* Scrollable Studio Body */}
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto pr-0.5">
        {/* PROMPT Section */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              {i18n._({ id: 'app.houseAgent.imageStudio.promptHeader', message: 'PROMPT' })}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
              {i18n._({ id: 'app.houseAgent.imageStudio.smartLabel', message: 'Smart' })}
              <Info size={10} />
            </span>
          </div>

          <div className="space-y-2.5 rounded-2xl border border-white/10 bg-zinc-900/90 p-3">
            {studioTab === 'image' ? (
              <div className="flex flex-wrap items-center gap-1.5 leading-6 text-zinc-200">
                <select
                  value={renderStyle}
                  onChange={(e) => cycleStyle(e.target.value as typeof renderStyle)}
                  className="rounded-md border border-rose-400/35 bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-medium text-rose-200 outline-none"
                >
                  <option value="photorealistic">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.style.photorealistic',
                      message: 'photorealistic',
                    })}
                  </option>
                  <option value="architectural">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.style.architectural',
                      message: 'architectural sketch',
                    })}
                  </option>
                  <option value="floorplan">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.style.floorplan',
                      message: '2D floor plan',
                    })}
                  </option>
                  <option value="interior">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.style.interior',
                      message: 'interior photo',
                    })}
                  </option>
                </select>
                <span className="text-[11px] text-zinc-300">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.phrase.renderOfView',
                    message: 'render of this view —',
                  })}
                </span>
                <select
                  value={lightingMood}
                  onChange={(e) => setLightingMood(e.target.value as typeof lightingMood)}
                  className="rounded-md border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-200 outline-none"
                >
                  <option value="golden">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.light.golden',
                      message: 'golden hour',
                    })}
                  </option>
                  <option value="daylight">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.light.daylight',
                      message: 'bright daylight',
                    })}
                  </option>
                  <option value="overcast">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.light.overcast',
                      message: 'soft overcast',
                    })}
                  </option>
                  <option value="twilight">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.light.twilight',
                      message: 'blue-hour twilight',
                    })}
                  </option>
                </select>
                <span className="text-[11px] text-zinc-300">
                  {i18n._({ id: 'app.houseAgent.imageStudio.phrase.lightWord', message: 'light,' })}
                </span>
                <select
                  value={atmosphere}
                  onChange={(e) => setAtmosphere(e.target.value as typeof atmosphere)}
                  className="rounded-md border border-orange-400/35 bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-medium text-orange-200 outline-none"
                >
                  <option value="diffused">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.atmo.diffused',
                      message: 'soft diffused',
                    })}
                  </option>
                  <option value="crisp">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.atmo.crisp',
                      message: 'crisp sunlight',
                    })}
                  </option>
                  <option value="warm">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.atmo.warm',
                      message: 'warm ambient',
                    })}
                  </option>
                </select>
                <select
                  value={paletteTone}
                  onChange={(e) => setPaletteTone(e.target.value as typeof paletteTone)}
                  className="rounded-md border border-fuchsia-400/35 bg-fuchsia-500/15 px-1.5 py-0.5 text-[11px] font-medium text-fuchsia-200 outline-none"
                >
                  <option value="neutrals">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.palette.neutrals',
                      message: 'warm neutrals',
                    })}
                  </option>
                  <option value="timber">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.palette.timber',
                      message: 'oak & stone',
                    })}
                  </option>
                  <option value="monochrome">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.palette.monochrome',
                      message: 'modern concrete',
                    })}
                  </option>
                </select>
                <span className="text-[11px] text-zinc-300">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.phrase.paletteWord',
                    message: 'palette',
                  })}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 leading-6 text-zinc-200">
                <select
                  value={cameraMotion}
                  onChange={(e) => setCameraMotion(e.target.value as typeof cameraMotion)}
                  className="rounded-md border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-200 outline-none"
                >
                  <option value="orbit">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.video.chipOrbit',
                      message: 'slow orbit',
                    })}
                  </option>
                  <option value="push">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.video.motionPush',
                      message: 'gentle push-in',
                    })}
                  </option>
                  <option value="sweep">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.video.motionSweep',
                      message: 'panoramic sweep',
                    })}
                  </option>
                  <option value="rise">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.video.motionRise',
                      message: 'aerial rise',
                    })}
                  </option>
                </select>
                <span className="text-[11px] text-zinc-300">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.video.phraseOfView',
                    message: 'of this view —',
                  })}
                </span>
                <select
                  value={videoPacing}
                  onChange={(e) => setVideoPacing(e.target.value as typeof videoPacing)}
                  className="rounded-md border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-200 outline-none"
                >
                  <option value="cinematic">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.video.chipCinematic',
                      message: 'slow cinematic',
                    })}
                  </option>
                  <option value="steady">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.video.paceSteady',
                      message: 'steady architectural',
                    })}
                  </option>
                  <option value="glide">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.video.paceGlide',
                      message: 'smooth glide',
                    })}
                  </option>
                </select>
                <select
                  value={lightingMood}
                  onChange={(e) => setLightingMood(e.target.value as typeof lightingMood)}
                  className="rounded-md border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-200 outline-none"
                >
                  <option value="golden">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.light.golden',
                      message: 'golden hour',
                    })}
                  </option>
                  <option value="daylight">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.light.daylight',
                      message: 'bright daylight',
                    })}
                  </option>
                  <option value="twilight">
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.light.twilight',
                      message: 'blue-hour twilight',
                    })}
                  </option>
                </select>
                <span className="text-[11px] text-zinc-300">
                  {i18n._({ id: 'app.houseAgent.imageStudio.phrase.lightWord', message: 'light,' })}
                </span>
              </div>
            )}

            <textarea
              value={customDetails}
              disabled={generating}
              maxLength={3500}
              onChange={(e) => setCustomDetails(e.target.value)}
              rows={2}
              placeholder={i18n._({
                id: 'app.houseAgent.imageStudio.promptPlaceholder',
                message:
                  'Describe style, materials, roof form, courtyard, lighting, or layout dimensions…',
              })}
              className="w-full resize-none rounded-lg border border-white/10 bg-black/40 p-2 text-[11px] text-zinc-100 outline-none focus:border-violet-400"
            />

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setShowLibrary((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
              >
                <Plus size={12} />
                {i18n._({
                  id: 'app.houseAgent.imageStudio.addModifier',
                  message: 'Add modifier',
                })}
              </button>
              <button
                type="button"
                disabled={generating}
                onClick={handleEnhancePrompt}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/20 px-2.5 py-1 text-[11px] font-medium text-violet-100 hover:bg-violet-500/30"
              >
                <Wand2 size={12} />
                {i18n._({ id: 'app.houseAgent.imageStudio.enhance', message: 'Enhance' })}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowLibrary((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/70 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
          >
            <BookOpen size={12} />
            {i18n._({
              id: 'app.houseAgent.imageStudio.promptLibrary',
              message: 'Prompt library',
            })}
          </button>

          {showLibrary && (
            <div className="space-y-1 rounded-xl border border-white/10 bg-black/40 p-2">
              {promptTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    setCustomDetails(tpl.text)
                    setShowLibrary(false)
                  }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/10"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* MODEL Card */}
        <section className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            {i18n._({ id: 'app.houseAgent.imageStudio.modelLabel', message: 'MODEL' })}
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-white/10 bg-zinc-900/90 p-2.5 text-left hover:border-white/25"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/50 text-violet-300">
              {studioTab === 'image' ? <Sparkles size={15} /> : <Film size={15} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-xs text-zinc-100">
                  {configured && modelLabel
                    ? modelLabel
                    : i18n._({
                        id: 'app.houseAgent.imageStudio.configureBtn',
                        message: 'Configure',
                      })}
                </span>
                {configured ? (
                  <span className="rounded bg-amber-500/20 px-1 py-0.2 font-mono text-[9px] text-amber-200">
                    {studioTab === 'image' ? BADGE_READY : BADGE_FAST}
                  </span>
                ) : (
                  <span className="rounded bg-red-500/20 px-1 py-0.2 text-[9px] text-red-200">
                    {i18n._({ id: 'app.houseAgent.imageStudio.needKeyTag', message: 'No key' })}
                  </span>
                )}
              </div>
              <p className="truncate text-[10px] text-zinc-400">
                {studioTab === 'image'
                  ? i18n._({
                      id: 'app.houseAgent.imageStudio.modelSubtitleImage',
                      message: 'Layout-faithful architectural image generation',
                    })
                  : i18n._({
                      id: 'app.houseAgent.imageStudio.modelSubtitleVideo',
                      message: 'Start + end frame motion interpolation',
                    })}
              </p>
            </div>
            <ChevronDown size={14} className="shrink-0 text-zinc-400" />
          </button>
        </section>

        {studioTab === 'image' ? (
          <>
            {/* 3D Built-Room Photography (No API key needed) */}
            <section className="space-y-1.5 rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.roomPhotoTitle',
                    message: '3D SCENE & ROOM PHOTOS (LOCAL)',
                  })}
                </span>
                {roomProgress && (
                  <span className="font-mono text-[10px] text-emerald-200">
                    {roomProgress.current}/{roomProgress.total} · {roomProgress.label}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={roomShooting || generating}
                  onClick={() => void handleCaptureCurrentPhoto()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-black/40 py-2 text-[11px] font-medium text-zinc-100 hover:bg-white/10 disabled:opacity-40"
                >
                  <Camera size={13} className="text-emerald-300" />
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.snapCurrentView',
                    message: 'Snap 3D view',
                  })}
                </button>
                <button
                  type="button"
                  disabled={roomShooting || generating}
                  onClick={() => void handleCaptureAllRooms()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/20 py-2 text-[11px] font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  <Home size={13} />
                  {roomShooting
                    ? i18n._({
                        id: 'app.houseAgent.imageStudio.snappingRooms',
                        message: 'Capturing…',
                      })
                    : i18n._({
                        id: 'app.houseAgent.imageStudio.snapAllRooms',
                        message: 'Photo all rooms',
                      })}
                </button>
              </div>
            </section>

            {/* REFERENCES 0/6 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.referencesTitle',
                    message: 'REFERENCES',
                  })}
                </span>
                {/* i18n-ignore: numeric ratio counter */}
                <span className="rounded-full border border-violet-400/35 bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-200">
                  {references.length}/6
                </span>
              </div>

              <div className="flex gap-2 rounded-xl border border-violet-400/35 bg-violet-950/25 p-2.5 text-[11px] leading-4 text-zinc-300">
                <Info size={14} className="mt-0.5 shrink-0 text-violet-300" />
                <p>
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.referencesHint',
                    message:
                      'References steer the render. A 3D snapshot locks your real layout; a past render carries its style.',
                  })}
                </p>
              </div>

              {references.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5">
                  {references.map((ref) => (
                    <div
                      key={ref.id}
                      className="group relative overflow-hidden rounded-lg border border-white/15 bg-black/50"
                    >
                      <img src={ref.dataUrl} alt={ref.label} className="h-14 w-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          setReferences((prev) => prev.filter((item) => item.id !== ref.id))
                        }
                        aria-label={i18n._({
                          id: 'app.houseAgent.imageStudio.removeRef',
                          message: 'Remove reference image',
                        })}
                        className="absolute top-1 right-1 rounded-full bg-black/80 p-0.5 text-zinc-200 hover:bg-black"
                      >
                        <X size={10} />
                      </button>
                      <span className="block truncate px-1.5 py-0.5 text-[9px] text-zinc-300">
                        {ref.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative">
                <button
                  type="button"
                  disabled={references.length >= 6 || generating}
                  onClick={() => setShowAddRefMenu((v) => !v)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-zinc-900/70 py-2 text-[11px] font-medium text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                >
                  <Plus size={13} />
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.addReference',
                    message: 'Add reference',
                  })}
                </button>
                {showAddRefMenu && (
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-zinc-900 p-1.5">
                    <button
                      type="button"
                      disabled={capturingRef}
                      onClick={() => void addSnapshotReference('ref')}
                      className="flex items-center justify-center gap-1 rounded-lg bg-white/5 py-1.5 text-[11px] text-zinc-200 hover:bg-white/10"
                    >
                      <Camera size={12} />
                      {i18n._({
                        id: 'app.houseAgent.imageStudio.use3DRef',
                        message: 'Use 3D view',
                      })}
                    </button>
                    <label className="flex cursor-pointer items-center justify-center gap-1 rounded-lg bg-white/5 py-1.5 text-[11px] text-zinc-200 hover:bg-white/10">
                      <ImagePlus size={12} />
                      {i18n._({
                        id: 'app.houseAgent.imageStudio.uploadRef',
                        message: 'Upload image',
                      })}
                      <input
                        type="file"
                        className="sr-only"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? [])
                          e.target.value = ''
                          if (files.length) void addUploadedReferences(files)
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            </section>

            {/* VARIATIONS */}
            <section className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {i18n._({ id: 'app.houseAgent.imageStudio.variations', message: 'VARIATIONS' })}
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {([1, 2, 3, 4] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={generating}
                    onClick={() => setVariations(count)}
                    className={`rounded-xl border py-1.5 font-mono text-xs transition-colors ${
                      variations === count
                        ? 'border-violet-400/70 bg-violet-500/20 text-white'
                        : 'border-white/10 bg-zinc-900/70 text-zinc-400 hover:bg-white/5'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </section>

            {/* RESOLUTION */}
            <section className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {i18n._({
                  id: 'app.houseAgent.imageStudio.resolutionLabel',
                  message: 'RESOLUTION',
                })}
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['1K', '2K', '4K'] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    disabled={generating}
                    onClick={() => setResolutionTier(tier)}
                    className={`rounded-xl border py-1.5 font-mono text-xs transition-colors ${
                      resolutionTier === tier
                        ? 'border-violet-400/70 bg-violet-500/20 text-white'
                        : 'border-white/10 bg-zinc-900/70 text-zinc-400 hover:bg-white/5'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </section>

            {/* ASPECT RATIO (5 cards with wireframe preview) */}
            <section className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {i18n._({
                  id: 'app.houseAgent.imageStudio.aspectRatio',
                  message: 'ASPECT RATIO',
                })}
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio.id}
                    type="button"
                    disabled={generating}
                    onClick={() => setAspectId(ratio.id)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border py-2 font-mono text-[10px] transition-colors ${
                      aspectId === ratio.id
                        ? 'border-violet-400/70 bg-violet-500/20 text-white'
                        : 'border-white/10 bg-zinc-900/70 text-zinc-400 hover:bg-white/5'
                    }`}
                  >
                    <span
                      className={`rounded-[2px] border ${
                        aspectId === ratio.id ? 'border-violet-300' : 'border-zinc-500'
                      } ${ratio.boxClass}`}
                    />
                    <span>{ratio.id}</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            {/* INPUT FRAMES */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.video.inputFrames',
                    message: 'INPUT FRAMES',
                  })}
                </span>
                <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-300">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.video.startEndTag',
                    message: 'start + end frame',
                  })}
                </span>
              </div>

              <div className="flex gap-2 rounded-xl border border-amber-500/35 bg-amber-950/20 p-2.5 text-[11px] leading-4 text-zinc-300">
                <Info size={14} className="mt-0.5 shrink-0 text-amber-300" />
                <p>
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.video.framesHint',
                    message:
                      'Video interpolates from the start frame — a 3D snapshot or past render — and, optionally, an end frame to drive motion.',
                  })}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => void addSnapshotReference('start')}
                    className="flex h-24 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-white/15 bg-zinc-900/70 p-2 text-center hover:border-amber-400/50"
                  >
                    {startFrame ? (
                      <img src={startFrame} alt="" className="h-full w-full rounded object-cover" />
                    ) : (
                      <>
                        <Plus size={14} className="text-zinc-300" />
                        <span className="text-[11px] font-medium text-zinc-100">
                          {i18n._({
                            id: 'app.houseAgent.imageStudio.video.startFrame',
                            message: 'Start frame',
                          })}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {i18n._({
                            id: 'app.houseAgent.imageStudio.video.required',
                            message: 'required (3D view)',
                          })}
                        </span>
                      </>
                    )}
                  </button>
                  {startFrame && (
                    <button
                      type="button"
                      onClick={() => setStartFrame(null)}
                      aria-label={i18n._({
                        id: 'app.houseAgent.imageStudio.removeRef',
                        message: 'Remove reference image',
                      })}
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/80 p-0.5 text-white"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                <div className="relative">
                  <label className="flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-white/15 bg-zinc-900/70 p-2 text-center hover:border-amber-400/50">
                    {endFrame ? (
                      <img src={endFrame} alt="" className="h-full w-full rounded object-cover" />
                    ) : (
                      <>
                        <Plus size={14} className="text-zinc-300" />
                        <span className="text-[11px] font-medium text-zinc-100">
                          {i18n._({
                            id: 'app.houseAgent.imageStudio.video.endFrame',
                            message: 'End frame',
                          })}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {i18n._({
                            id: 'app.houseAgent.imageStudio.video.optional',
                            message: 'optional',
                          })}
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) setEndFrame(await readFileAsDataUrl(file))
                      }}
                    />
                  </label>
                  {endFrame && (
                    <button
                      type="button"
                      onClick={() => setEndFrame(null)}
                      aria-label={i18n._({
                        id: 'app.houseAgent.imageStudio.removeRef',
                        message: 'Remove reference image',
                      })}
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/80 p-0.5 text-white"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* MOTION LENGTH */}
            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.video.motionLength',
                    message: 'MOTION LENGTH',
                  })}
                </span>
                <span className="font-mono text-xs text-amber-300">{videoDuration}s</span>
              </div>
              <input
                type="range"
                min={3}
                max={10}
                value={videoDuration}
                onChange={(e) => setVideoDuration(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </section>

            {/* VIDEO RESOLUTION */}
            <section className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {i18n._({
                  id: 'app.houseAgent.imageStudio.resolutionLabel',
                  message: 'RESOLUTION',
                })}
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(['480P', '768P', '1080P'] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setVideoRes(tier)}
                    className={`rounded-xl border py-1.5 font-mono text-xs transition-colors ${
                      videoRes === tier
                        ? 'border-amber-400/70 bg-amber-500/20 text-white'
                        : 'border-white/10 bg-zinc-900/70 text-zinc-400 hover:bg-white/5'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </section>

            {/* 3D RECORDING MODE */}
            <section className="space-y-1.5 rounded-2xl border border-emerald-500/25 bg-emerald-950/20 p-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                {i18n._({
                  id: 'app.houseAgent.imageStudio.video.recordModeLabel',
                  message: '3D VIEWPORT RECORDING (NO KEY NEEDED)',
                })}
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={recordingVideo}
                  onClick={() => setVideoOrbitMode('auto-orbit')}
                  className={`rounded-xl border py-1.5 text-[11px] transition-colors ${
                    videoOrbitMode === 'auto-orbit'
                      ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                      : 'border-white/10 bg-black/30 text-zinc-400 hover:bg-white/5'
                  }`}
                >
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.video.modeAutoOrbit',
                    message: 'Auto 360° orbit',
                  })}
                </button>
                <button
                  type="button"
                  disabled={recordingVideo}
                  onClick={() => setVideoOrbitMode('free')}
                  className={`rounded-xl border py-1.5 text-[11px] transition-colors ${
                    videoOrbitMode === 'free'
                      ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                      : 'border-white/10 bg-black/30 text-zinc-400 hover:bg-white/5'
                  }`}
                >
                  {i18n._({
                    id: 'app.houseAgent.imageStudio.video.modeFreeWalk',
                    message: 'Free camera walk',
                  })}
                </button>
              </div>
            </section>
          </>
        )}

        {error && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
            {error}
          </p>
        )}

        {/* Generated Renders History */}
        {results.length > 0 && studioTab === 'image' && (
          <div className="space-y-2 border-white/10 border-t pt-2.5">
            {results.map((item) => (
              <div
                key={item.id}
                className="space-y-1.5 rounded-xl border border-white/10 bg-black/50 p-2"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                  <span className="truncate font-medium text-zinc-200">{item.prompt}</span>
                  <span className="shrink-0 font-mono">{item.model}</span>
                </div>
                <img
                  src={item.imageDataUrl}
                  alt={item.prompt}
                  className="max-h-48 w-full rounded-lg bg-black object-contain"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <a
                    href={item.imageDataUrl}
                    download={`pascal-${item.preset}.png`}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[10px] text-zinc-200 hover:bg-white/10"
                  >
                    <Download size={11} />
                    {i18n._({ id: 'app.houseAgent.imageStudio.download', message: 'Download' })}
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      onAttachToChat({
                        imageDataUrl: item.imageDataUrl,
                        prompt: item.prompt,
                        preset: item.preset,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[10px] text-sky-200 hover:bg-sky-500/25"
                  >
                    <ImagePlus size={11} />
                    {i18n._({
                      id: 'app.houseAgent.imageStudio.sendToAgent',
                      message: 'Send to Agent',
                    })}
                  </button>
                  <button
                    type="button"
                    disabled={item.importedAsGuide}
                    onClick={() => void handleImportGuide(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
                  >
                    {item.importedAsGuide ? <Check size={11} /> : <Layers size={11} />}
                    {item.importedAsGuide
                      ? i18n._({
                          id: 'app.houseAgent.imageStudio.importedGuide',
                          message: 'Imported as Guide',
                        })
                      : i18n._({
                          id: 'app.houseAgent.imageStudio.importGuide',
                          message: 'Import as Guide',
                        })}
                  </button>
                  {references.length < 6 && (
                    <button
                      type="button"
                      onClick={() =>
                        setReferences((prev) => [
                          ...prev.slice(0, 5),
                          {
                            id: crypto.randomUUID(),
                            label: i18n._({
                              id: 'app.houseAgent.imageStudio.pastRenderTag',
                              message: 'Past Render',
                            }),
                            kind: 'style',
                            dataUrl: item.imageDataUrl,
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/15 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-500/25"
                    >
                      <Plus size={11} />
                      {i18n._({
                        id: 'app.houseAgent.imageStudio.useAsRef',
                        message: 'Ref',
                      })}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Recorded 3D Videos History */}
        {recordedVideos.length > 0 && studioTab === 'video' && (
          <div className="space-y-2 border-white/10 border-t pt-2.5">
            {recordedVideos.map((vid) => (
              <div
                key={vid.id}
                className="space-y-1.5 rounded-xl border border-white/10 bg-black/50 p-2"
              >
                <video
                  src={vid.videoUrl}
                  controls
                  muted
                  playsInline
                  loop
                  className="max-h-48 w-full rounded-lg bg-black"
                >
                  <track kind="captions" />
                </video>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-zinc-400">
                    {vid.filename} ({Math.round(vid.durationMs / 1000)}s)
                  </span>
                  <a
                    href={vid.videoUrl}
                    download={vid.filename}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[10px] text-zinc-100 hover:bg-white/10"
                  >
                    <Download size={11} />
                    {i18n._({ id: 'app.houseAgent.imageStudio.download', message: 'Download' })}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Sticky CTA Footer */}
      <div className="space-y-1.5 border-white/10 border-t pt-2.5">
        {studioTab === 'image' ? (
          generating ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-900 py-2.5 text-xs font-semibold text-white hover:bg-red-800"
            >
              <Square size={13} />
              {i18n._({ id: 'app.houseAgent.imageStudio.stop', message: 'Stop generation' })}
            </button>
          ) : (
            <button
              type="button"
              disabled={!configured}
              onClick={() => void handleGenerateImages()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-xs font-semibold text-white shadow-lg hover:bg-violet-500 disabled:opacity-40"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {i18n._({
                id: 'app.houseAgent.imageStudio.generateN',
                message: 'Generate {count} renders',
                values: { count: variations },
              })}
            </button>
          )
        ) : recordingVideo ? (
          <button
            type="button"
            onClick={() => videoAbortRef.current?.abort()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-900 py-2.5 text-xs font-semibold text-white hover:bg-red-800"
          >
            <Square size={13} />
            {i18n._({
              id: 'app.houseAgent.imageStudio.video.stopRecording',
              message: 'Stop recording ({elapsed}s / {total}s)',
              values: { elapsed: recordingElapsed, total: videoDuration },
            })}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleRecord3DVideo()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 py-2.5 text-xs font-semibold text-white shadow-lg hover:bg-amber-500"
          >
            <Video size={14} />
            {i18n._({
              id: 'app.houseAgent.imageStudio.video.record3D',
              message: 'Record {seconds}s 3D video',
              values: { seconds: videoDuration },
            })}
          </button>
        )}

        <p className="flex items-center justify-between text-[10px] text-zinc-500">
          <span className="truncate font-mono">{modelLabel || '—'}</span>
          <span className="shrink-0 font-mono">
            {studioTab === 'image'
              ? `${variations} × ${resolutionTier} · ${aspectId}`
              : `${videoDuration}s · ${videoRes}`}
          </span>
        </p>
      </div>
    </div>
  )
}
