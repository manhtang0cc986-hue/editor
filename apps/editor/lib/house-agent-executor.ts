'use client'

import {
  applySceneOperationPatch,
  emitter,
  type GuideNode,
  getSceneDocument,
  loadAssetUrl,
  type SnapshotCapturedEvent,
  type SnapshotCaptureFailedEvent,
  useScene,
} from '@pascal-app/core'
import {
  assetViewNeeds,
  catalogReads,
  createAssetViewLoader,
  createFetchAssetViewIO,
  readCatalog,
  sceneViewPlan,
} from '@pascal-app/core/agent-operations'
import {
  applyPatchWithDependencies,
  captureRegistryVersions,
  effectIds,
  isEmptyScenePatch,
  openDetachedScene,
} from '@pascal-app/core/runtime'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import { getLocalAwareCatalog, getLocalAwareMaterials } from './house-agent-catalog'
import { HOUSE_AGENT_OPERATIONS } from './house-agent-operations'
import {
  HousePlanSchema,
  type ImageClientConfig,
  type ImageGenPreset,
  type ImageGenSize,
  MAX_AGENT_IMAGE_BYTES,
} from './house-agent-protocol'
import { HOUSE_AGENT_TOOLS } from './house-agent-tools'

const MAX_PICTURE_EDGE = 1280

async function resizeImageBytes(
  bytes: Uint8Array,
  mediaType: string,
  maxEdge = MAX_PICTURE_EDGE,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return { bytes, mediaType }
  }
  try {
    const blob = new Blob([bytes as BlobPart], { type: mediaType })
    const bitmap = await createImageBitmap(blob)
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= maxEdge && bytes.byteLength <= 1024 * 1024) {
      bitmap.close()
      return { bytes, mediaType }
    }
    const scale = Math.min(1, maxEdge / Math.max(1, longest))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return { bytes, mediaType }
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const targetMime = mediaType === 'image/png' ? 'image/png' : 'image/webp'
    const encoded = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, targetMime, 0.88),
    )
    if (!encoded) return { bytes, mediaType }
    return { bytes: new Uint8Array(await encoded.arrayBuffer()), mediaType: targetMime }
  } catch {
    return { bytes, mediaType }
  }
}

const assetLoader = createAssetViewLoader(
  createFetchAssetViewIO({
    fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
    resizePicture: (bytes, mediaType) => resizeImageBytes(bytes, mediaType, 512),
  }),
)

async function blobToResizedDataUrl(blob: Blob, maxEdge = MAX_PICTURE_EDGE): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mediaType = blob.type || 'image/webp'
  const resized = await resizeImageBytes(bytes, mediaType, maxEdge)
  if (resized.bytes.byteLength > MAX_AGENT_IMAGE_BYTES) {
    throw new Error('Captured image exceeds size limit.')
  }
  let binary = ''
  for (let i = 0; i < resized.bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...resized.bytes.subarray(i, i + 0x8000))
  }
  return `data:${resized.mediaType};base64,${btoa(binary)}`
}

async function fetchUrlAsDataUrl(url: string, maxEdge = 512): Promise<string | null> {
  try {
    const resolved = await loadAssetUrl(url)
    if (!resolved) return null
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(resolved)) return resolved
    const response = await fetch(resolved, { signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    return await blobToResizedDataUrl(blob, maxEdge)
  } catch {
    return null
  }
}

function makeColorSwatchDataUrl(hex: string): string | null {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = hex
    ctx.fillRect(0, 0, 128, 128)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

export async function captureEphemeralViewport(
  options: {
    perspective?: {
      position: [number, number, number]
      target: [number, number, number]
      fov?: number
    }
    ortho?: {
      position: [number, number, number]
      target: [number, number, number]
      viewWidth: number
    }
    standardSize?: { w: number; h: number }
    interior?: { levelId: string; roomId?: string }
    presentation?: { mode: 'stacked' | 'exploded' } | { mode: 'solo'; levelId: string }
    captureMode?: 'standard' | 'viewport'
    signal?: AbortSignal
  } = {},
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (options.signal?.aborted) {
    throw new Error('已取消 3D 视图截取。')
  }
  if (typeof document !== 'undefined') {
    if (document.visibilityState !== 'visible') {
      throw new Error('编辑器标签页当前在后台，请将其切换至前台后再截图。')
    }
    if (!document.querySelector('[data-pascal-viewer-3d] canvas')) {
      throw new Error(
        '当前浏览器未检测到可用的 3D WebGL 画布（可能未启用硬件加速），已跳过截图，请直接根据场景数据与 verify_scene 继续。',
      )
    }
  }
  const requestId = `house-agent-${crypto.randomUUID()}`
  const projectId = useViewer.getState().projectId ?? 'default'

  const captured = await new Promise<SnapshotCapturedEvent>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('3D 视图渲染超时，已自动跳过，请直接根据 verify_scene 结果继续。'))
    }, 10_000)

    const onAbort = () => {
      cleanup()
      reject(new Error('已取消 3D 视图截取。'))
    }
    const onCaptured = (event: SnapshotCapturedEvent) => {
      if (event.requestId !== requestId) return
      cleanup()
      resolve(event)
    }
    const onFailed = (event: SnapshotCaptureFailedEvent) => {
      if (event.requestId !== requestId) return
      cleanup()
      reject(new Error(event.error || '3D 视图渲染失败。'))
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      emitter.off('snapshot:captured', onCaptured)
      emitter.off('snapshot:capture-failed', onFailed)
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    emitter.on('snapshot:captured', onCaptured)
    emitter.on('snapshot:capture-failed', onFailed)
    emitter.emit('camera-controls:generate-thumbnail', {
      projectId,
      requestId,
      ephemeral: true,
      captureMode: options.captureMode ?? 'standard',
      ...(options.standardSize ? { standardSize: options.standardSize } : {}),
      ...(options.perspective ? { perspective: options.perspective } : {}),
      ...(options.ortho ? { ortho: options.ortho } : {}),
      ...(options.interior ? { interior: options.interior } : {}),
      ...(options.presentation ? { presentation: options.presentation } : {}),
    })
  })

  const dataUrl = await blobToResizedDataUrl(captured.blob, MAX_PICTURE_EDGE)
  if (options.signal?.aborted) {
    throw new Error('已取消 3D 视图截取。')
  }
  return { dataUrl, width: captured.width, height: captured.height }
}

export async function executeViewScene(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (args.camera === 'current') {
    const conflicting = (
      ['from', 'position', 'elevation', 'eyeHeight', 'fov', 'projection'] as const
    ).filter((key) => args[key] !== undefined)
    if (conflicting.length > 0) {
      return {
        code: 'camera_and_viewpoint',
        error: `Give a camera or a viewpoint of your own, not both (${conflicting.join(', ')}).`,
      }
    }
    const maxPx = typeof args.maxPx === 'number' ? Math.min(1920, Math.max(64, args.maxPx)) : 1280
    const capture = await captureEphemeralViewport({
      captureMode: 'viewport',
      standardSize: { w: maxPx, h: Math.round(maxPx * 0.625) },
      ...(signal ? { signal } : {}),
    })
    return {
      status: 'captured',
      camera: 'current',
      size: { w: capture.width, h: capture.height },
      previews: [
        {
          label: `Current 3D viewport (${capture.width}x${capture.height})`,
          image: capture.dataUrl,
        },
      ],
    }
  }

  const before = getSceneDocument()
  const plan = sceneViewPlan(before.nodes, args as never)
  const isOrtho = plan.pose.projection === 'orthographic'
  const capture = await captureEphemeralViewport({
    captureMode: 'standard',
    standardSize: plan.size,
    ...(signal ? { signal } : {}),
    ...(plan.interior ? { interior: plan.interior } : {}),
    ...(plan.presentation ? { presentation: plan.presentation } : {}),
    ...(isOrtho && plan.pose.projection === 'orthographic'
      ? {
          ortho: {
            position: plan.pose.position,
            target: plan.pose.target,
            viewWidth: plan.pose.viewWidth,
          },
        }
      : plan.pose.projection === 'perspective'
        ? {
            perspective: {
              position: plan.pose.position,
              target: plan.pose.target,
              fov: plan.pose.fov,
            },
          }
        : {}),
  })

  const label = `3D scene view (${plan.pose.projection}, ${capture.width}x${capture.height})`
  return {
    status: 'captured',
    pose: plan.pose,
    size: { w: capture.width, h: capture.height },
    ...(plan.interior ? { interior: plan.interior } : {}),
    ...(plan.presentation ? { presentation: plan.presentation } : {}),
    previews: [{ label, image: capture.dataUrl }],
  }
}

async function executeInspectSceneGuides(args: {
  levelId?: string
}): Promise<Record<string, unknown>> {
  const { nodes } = getSceneDocument()
  const guides = Object.values(nodes).filter(
    (node): node is GuideNode =>
      node.type === 'guide' && (!args.levelId || node.parentId === args.levelId),
  )

  if (guides.length === 0) {
    return {
      count: 0,
      guides: [],
      note: '当前场景中没有导入任何底图参考 (guide) 节点；请读取用户上传的图纸图片或提示用户提供尺寸图纸。',
    }
  }

  const limited = guides.slice(0, 4)
  const previews: Array<{ label: string; image: string }> = []
  const guideSummaries = await Promise.all(
    limited.map(async (guide) => {
      const image = await fetchUrlAsDataUrl(guide.url, MAX_PICTURE_EDGE)
      const label = `Guide "${guide.name}" (${guide.id}) on level ${guide.parentId ?? 'unknown'}`
      if (image) previews.push({ label, image })
      return {
        id: guide.id,
        name: guide.name,
        levelId: guide.parentId ?? null,
        position: guide.position,
        rotation: guide.rotation,
        scale: guide.scale,
        opacity: guide.opacity,
        scaleReference: guide.scaleReference,
        imageAttached: Boolean(image),
      }
    }),
  )

  return {
    count: guides.length,
    guides: guideSummaries,
    previews,
  }
}

async function executeViewMaterials(args: { ids: string[] }): Promise<Record<string, unknown>> {
  const catalog = await getLocalAwareMaterials()
  const wanted = [...new Set(args.ids.map((id) => id.replace(/^library:/, '')))]
  const materials: Array<Record<string, unknown>> = []
  const previews: Array<{ label: string; image: string }> = []

  for (const id of wanted) {
    const entry = catalog.find((item) => item.id === id)
    if (!entry) {
      materials.push({ id, ref: `library:${id}`, found: false })
      continue
    }
    let image: string | null = null
    if (entry.resolvedPreviewUrl) {
      image = await fetchUrlAsDataUrl(entry.resolvedPreviewUrl, 512)
    }
    if (!image && entry.previewColor) {
      image = makeColorSwatchDataUrl(entry.previewColor)
    }
    const label = `${entry.label} (library:${entry.id}): ${entry.category}, surfaces [${(entry.surfaces ?? []).join(', ')}]${entry.previewColor ? `, color ${entry.previewColor}` : ''}`
    if (image) previews.push({ label, image })
    materials.push({
      id: entry.id,
      ref: `library:${entry.id}`,
      label: entry.label,
      category: entry.category,
      surfaces: entry.surfaces ?? [],
      previewColor: entry.previewColor ?? null,
      description: entry.description ?? null,
      imageAttached: Boolean(image),
    })
  }

  return { materials, previews }
}

async function executeGenerateDesignImage(
  args: {
    prompt: string
    preset?: ImageGenPreset
    size?: ImageGenSize
    useCurrentViewAsReference?: boolean
  },
  imageConfig?: ImageClientConfig,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (signal?.aborted) {
    return { error: 'The user stopped this run. Image generation skipped.', aborted: true }
  }
  let referenceImage: string | undefined
  if (args.useCurrentViewAsReference) {
    try {
      const captured = await captureEphemeralViewport({
        captureMode: 'standard',
        standardSize: { w: 1280, h: 800 },
        ...(signal ? { signal } : {}),
      })
      referenceImage = captured.dataUrl
    } catch {
      if (signal?.aborted) {
        return { error: 'The user stopped this run. Image generation skipped.', aborted: true }
      }
      // Fallback cleanly to text-to-image if no 3D canvas is mounted yet.
      referenceImage = undefined
    }
  }

  const response = await fetch('/api/house-agent/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: args.prompt,
      preset: args.preset ?? 'exterior',
      size: args.size ?? '1536x1024',
      ...(referenceImage ? { referenceImage } : {}),
      ...(imageConfig ? { config: imageConfig } : {}),
    }),
    ...(signal ? { signal } : {}),
  })
  const body = (await response.json().catch(() => null)) as {
    imageDataUrl?: string
    revisedPrompt?: string | null
    model?: string
    endpoint?: string
    error?: string
  } | null
  if (!response.ok || !body?.imageDataUrl) {
    return {
      error: body?.error || `Image generation failed (HTTP ${response.status}).`,
    }
  }

  const presetLabel = args.preset ?? 'exterior'
  return {
    status: 'generated',
    model: body.model ?? null,
    endpoint: body.endpoint ?? null,
    revisedPrompt: body.revisedPrompt ?? null,
    usedViewportReference: Boolean(referenceImage),
    previews: [
      {
        label: `Generated architectural ${presetLabel} design`,
        image: body.imageDataUrl,
      },
    ],
  }
}

export async function executeHouseAgentTool(
  name: string,
  args: unknown,
  {
    allowWrites,
    imageConfig,
    signal,
  }: { allowWrites: boolean; imageConfig?: ImageClientConfig; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const entry = HOUSE_AGENT_TOOLS.find(({ contract }) => contract.name === name)
  if (!entry || (entry.write && !allowWrites)) {
    return { error: 'This tool is not permitted in the current mode.' }
  }
  if (useScene.getState().readOnly && entry.write) {
    return { error: 'The scene is read-only.' }
  }
  const parsed = z.object(entry.contract.input).safeParse(args)
  if (!parsed.success) {
    return { error: 'Invalid tool arguments', details: parsed.error.issues }
  }

  if (name === 'inspect_scene_guides') {
    return executeInspectSceneGuides(parsed.data as { levelId?: string })
  }
  if (name === 'view_materials') {
    return executeViewMaterials(parsed.data as { ids: string[] })
  }
  if (name === 'submit_house_plan') {
    const plan = HousePlanSchema.parse(parsed.data)
    return { status: 'plan_recorded', plan }
  }
  if (name === 'generate_design_image') {
    return executeGenerateDesignImage(
      parsed.data as {
        prompt: string
        preset?: ImageGenPreset
        size?: ImageGenSize
        useCurrentViewAsReference?: boolean
      },
      imageConfig,
      signal,
    )
  }
  if (name === 'view_scene') {
    try {
      return await executeViewScene(parsed.data as Record<string, unknown>, signal)
    } catch (error) {
      return {
        code: 'view_unavailable',
        note: '3D viewport capture is unavailable right now; do not retry view_scene repeatedly—rely on verify_scene and scene structure instead.',
        error: error instanceof Error ? error.message : 'Unable to capture 3D view.',
      }
    }
  }

  const operation = HOUSE_AGENT_OPERATIONS[name]
  if (!operation) return { error: 'This operation is unavailable.' }

  const before = getSceneDocument()
  const activeLevelId = useViewer.getState().selection.levelId
  const catalogNeeds = catalogReads(before.nodes, name, parsed.data)
  const catalog =
    catalogNeeds.ids.length || catalogNeeds.searches.length ? await getLocalAwareCatalog() : []
  const catalogContext = await readCatalog(before.nodes, name, parsed.data, catalog)
  const needs = assetViewNeeds(before.nodes, name, parsed.data, { catalog })
  const assetViews =
    name === 'view_assets' && needs.subjects.length
      ? await assetLoader(needs.subjects.slice(0, 6), { pictures: needs.pictures })
      : undefined

  if (signal?.aborted) {
    return { error: 'The user stopped this run. Scene write skipped.', aborted: true }
  }

  const scene = openDetachedScene(before, {
    base: { kind: 'authority', seq: 0 },
    ids: effectIds(crypto.randomUUID()),
    context: {
      activeLevelId,
      selection: [],
      units: 'metric',
      catalogVersion: 'builtin',
      registryVersions: captureRegistryVersions(),
    },
  })

  try {
    const result = scene.execute(operation, parsed.data as never, {
      activeLevelId,
      ...catalogContext,
      materials: before.materials,
      assetViews,
    })
    const patch = scene.patch()
    if (!isEmptyScenePatch(patch)) {
      if (signal?.aborted) {
        return { error: 'The user stopped this run. Scene write skipped.', aborted: true }
      }
      if (!allowWrites || !entry.write) {
        return { error: 'A read-only tool attempted to change the scene.' }
      }
      const application = applyPatchWithDependencies(
        getSceneDocument(),
        patch,
        scene.dependencies(),
        before,
      )
      if (!application.ok) {
        return {
          error: 'The scene changed. Read it again before retrying.',
          changed: application.changed,
        }
      }
      if (!applySceneOperationPatch(application.patch, { undoable: true })) {
        return { error: 'The editor is busy. Finish the current interaction before trying again.' }
      }
    }
    return result
  } finally {
    scene.dispose()
  }
}
