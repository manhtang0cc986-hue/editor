import { z } from 'zod'
import {
  type ImageClientConfig,
  type ImageConfiguration,
  type ImageGenMode,
  ImageGenModeSchema,
  type ImageGenPreset,
  type ImageGenRequest,
  ImageGenRequestSchema,
  type ImageGenSize,
  MAX_AGENT_IMAGE_BYTES,
} from './house-agent-protocol'
import { readLimitedJson } from './house-agent-server'

function normalizeImageMode(value: string | undefined): ImageGenMode {
  const parsed = ImageGenModeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'auto'
}

export function imageConfiguration(env: NodeJS.ProcessEnv = process.env): ImageConfiguration {
  const apiKey = env.PASCAL_IMAGE_API_KEY || ''
  const model = env.PASCAL_IMAGE_MODEL || null
  const baseUrl =
    env.PASCAL_IMAGE_BASE_URL || env.PASCAL_AGENT_BASE_URL || 'https://api.openai.com/v1'
  return {
    configured: Boolean(apiKey && model),
    model,
    baseUrl,
    mode: normalizeImageMode(env.PASCAL_IMAGE_API_MODE),
    source: apiKey && model ? 'env' : 'none',
  }
}

const PRESET_PROMPT_PREFIX: Record<ImageGenPreset, string> = {
  exterior:
    'Architectural exterior visualization, realistic daylight, clean modern proportions, natural surroundings, sharp architectural details:',
  floorplan:
    'Clean top-down 2D architectural floor plan blueprint drawing on white background, crisp black walls, clear room labels, door swings, window openings, readable metric dimensions:',
  interior:
    'Photorealistic architectural interior design rendering, natural window lighting, balanced furniture layout, refined material textures:',
  courtyard:
    'Architectural villa courtyard and landscape design rendering, outdoor terrace, greenery, natural light, coherent elevation:',
}

function resolveImageRuntime(override: ImageClientConfig | undefined, env: NodeJS.ProcessEnv) {
  const base = imageConfiguration(env)
  const serverBaseUrl = base.baseUrl.replace(/\/$/, '')
  const customBaseUrl = override?.baseUrl?.trim().replace(/\/$/, '')
  const isCustomHost = Boolean(customBaseUrl && customBaseUrl !== serverBaseUrl)
  const baseUrl = customBaseUrl || serverBaseUrl
  const model = override?.model?.trim() || base.model || ''
  const customApiKey = override?.apiKey?.trim() || ''

  if (isCustomHost && !customApiKey) {
    throw new Error('切换自定义生图服务地址时，必须同时提供该服务对应的 API Key。')
  }

  const apiKey = customApiKey || env.PASCAL_IMAGE_API_KEY || ''
  const mode = override?.mode ?? base.mode

  if (!apiKey || !model) {
    throw new Error(
      '请在生图设置中填写独立的模型名称与 API Key，或在 .env.local 配置 PASCAL_IMAGE_API_KEY 和 PASCAL_IMAGE_MODEL。',
    )
  }

  let parsedBase: URL
  try {
    parsedBase = new URL(`${baseUrl}/images/generations`)
  } catch {
    throw new Error('生图服务 Base URL 格式无效。')
  }
  if (
    !['http:', 'https:'].includes(parsedBase.protocol) ||
    parsedBase.username ||
    parsedBase.password ||
    parsedBase.search ||
    parsedBase.hash
  ) {
    throw new Error('生图服务 Base URL 配置无效。')
  }

  return { baseUrl, model, apiKey, mode }
}

function shouldUseChatEndpoint(model: string, mode: ImageGenMode): boolean {
  if (mode === 'chat') return true
  if (mode === 'images') return false
  // Auto-detect chat-based multimodal image generation models (Gemini image / nano-banana / gpt-4o-image).
  return /gemini|nano-banana|image-preview|flash-image|pro-image|4o-image/i.test(model)
}

async function fetchRemoteImageAsDataUrl(
  imageUrl: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(imageUrl)) {
    return imageUrl
  }
  let parsed: URL
  try {
    parsed = new URL(imageUrl)
  } catch {
    throw new Error('生图返回的图片地址无效。')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('生图返回了不支持的图片协议。')
  }
  const response = await fetchImpl(parsed, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`下载生成图片失败（HTTP ${response.status}）。`)
  }
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const allowedMime =
    contentType === 'image/png' || contentType === 'image/jpeg' || contentType === 'image/webp'
      ? contentType
      : 'image/png'
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AGENT_IMAGE_BYTES) {
    throw new Error('生成图片大小超出限制。')
  }
  return `data:${allowedMime};base64,${Buffer.from(bytes).toString('base64')}`
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new Error('参考图片格式无效。')
  const mime = match[1]!
  const bytes = Buffer.from(match[2]!, 'base64')
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  return { blob: new Blob([bytes], { type: mime }), ext }
}

function extractImageFromChatResponse(body: unknown): {
  imageRef: string
  text: string | null
} | null {
  if (!body || typeof body !== 'object') return null
  const choices = (body as { choices?: unknown[] }).choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  if (!first || typeof first !== 'object') return null
  const message = (first as { message?: Record<string, unknown> }).message
  if (!message) return null

  const collectText =
    typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter((p): p is { type: string; text?: string } =>
              Boolean(p && typeof p === 'object' && (p as { type?: string }).type === 'text'),
            )
            .map((p) => p.text ?? '')
            .join('\n')
        : ''

  // OpenRouter / Gemini OpenAI-compat `message.images`
  if (Array.isArray(message.images)) {
    for (const img of message.images) {
      if (typeof img === 'string') return { imageRef: img, text: collectText || null }
      if (img && typeof img === 'object') {
        const url =
          (img as { image_url?: { url?: string }; url?: string }).image_url?.url ??
          (img as { url?: string }).url
        if (typeof url === 'string' && url) return { imageRef: url, text: collectText || null }
      }
    }
  }

  // Content array with `image_url`
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part && typeof part === 'object') {
        const url = (part as { image_url?: { url?: string } }).image_url?.url
        if (typeof url === 'string' && url) return { imageRef: url, text: collectText || null }
      }
    }
  }

  // Inline data URL or markdown image inside text content
  if (collectText) {
    const dataMatch = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/.exec(collectText)
    if (dataMatch) return { imageRef: dataMatch[0], text: collectText }
    const mdMatch = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(collectText)
    if (mdMatch?.[1]) return { imageRef: mdMatch[1], text: collectText }
  }
  return null
}

export async function generateDesignImage(
  input: ImageGenRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  imageDataUrl: string
  revisedPrompt: string | null
  model: string
  endpoint: 'images' | 'edits' | 'chat'
}> {
  const resolved = resolveImageRuntime(input.config, env)
  const prefix = input.preset ? `${PRESET_PROMPT_PREFIX[input.preset]} ` : ''
  const fullPrompt = `${prefix}${input.prompt.trim()}`
  const size: ImageGenSize = input.size ?? '1536x1024'

  if (shouldUseChatEndpoint(resolved.model, resolved.mode)) {
    const url = new URL(`${resolved.baseUrl}/chat/completions`)
    const userContent = input.referenceImage
      ? [
          {
            type: 'text',
            text: `${fullPrompt}\n(Aspect / size target: ${size}. Generate the architectural design image directly.)`,
          },
          { type: 'image_url', image_url: { url: input.referenceImage, detail: 'high' } },
        ]
      : `${fullPrompt}\n(Aspect / size target: ${size}. Generate the architectural design image directly.)`

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify({
          model: resolved.model,
          modalities: ['image', 'text'],
          messages: [{ role: 'user', content: userContent }],
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
        redirect: 'error',
      })
    } catch {
      throw new Error(signal.aborted ? '已取消生图。' : '生图模型服务连接失败或超时。')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`生图模型返回 HTTP ${response.status}，请检查生图模型名称、密钥与接口模式。`)
    }
    const body = await readLimitedJson(response, 24 * 1024 * 1024)
    const extracted = extractImageFromChatResponse(body)
    if (!extracted) {
      throw new Error(
        '模型未返回图片数据，请确认模型支持图像生成或切换接口模式为 /images/generations。',
      )
    }
    const imageDataUrl = await fetchRemoteImageAsDataUrl(extracted.imageRef, signal, fetchImpl)
    return {
      imageDataUrl,
      revisedPrompt: extracted.text,
      model: resolved.model,
      endpoint: 'chat',
    }
  }

  // Standard OpenAI /images/edits (when referenceImage supplied) or /images/generations
  if (input.referenceImage) {
    const editUrl = new URL(`${resolved.baseUrl}/images/edits`)
    const { blob, ext } = dataUrlToBlob(input.referenceImage)
    const form = new FormData()
    form.set('model', resolved.model)
    form.set('prompt', fullPrompt)
    form.set('size', size)
    form.set('image', blob, `reference.${ext}`)

    let editResponse: Response
    try {
      editResponse = await fetchImpl(editUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${resolved.apiKey}` },
        body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
        redirect: 'error',
      })
    } catch {
      throw new Error(signal.aborted ? '已取消生图。' : '参考图生图请求失败或超时。')
    }
    if (editResponse.ok) {
      const body = await readLimitedJson(editResponse, 24 * 1024 * 1024)
      const parsed = z
        .object({
          data: z
            .array(
              z.object({
                b64_json: z.string().optional(),
                url: z.string().optional(),
                revised_prompt: z.string().optional(),
              }),
            )
            .min(1),
        })
        .safeParse(body)
      if (parsed.success) {
        const item = parsed.data.data[0]!
        const imageDataUrl = item.b64_json
          ? `data:image/png;base64,${item.b64_json}`
          : item.url
            ? await fetchRemoteImageAsDataUrl(item.url, signal, fetchImpl)
            : null
        if (imageDataUrl) {
          return {
            imageDataUrl,
            revisedPrompt: item.revised_prompt ?? null,
            model: resolved.model,
            endpoint: 'edits',
          }
        }
      }
    } else {
      await editResponse.body?.cancel()
      // Some providers don't support /images/edits; fall through to /images/generations only if user didn't force strict edits?
      // Report clearly when /images/edits rejects so the user knows why reference wasn't used, unless 404.
      if (editResponse.status !== 404) {
        throw new Error(
          `参考图生图 (/images/edits) 返回 HTTP ${editResponse.status}，请检查模型是否支持图生图，或取消勾选参考图后重试。`,
        )
      }
    }
  }

  const genUrl = new URL(`${resolved.baseUrl}/images/generations`)
  let response: Response
  try {
    response = await fetchImpl(genUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        prompt: fullPrompt,
        n: 1,
        size,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
      redirect: 'error',
    })
  } catch {
    throw new Error(signal.aborted ? '已取消生图。' : '生图模型服务连接失败或超时。')
  }

  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`生图模型返回 HTTP ${response.status}，请检查生图模型名称、密钥与接口地址。`)
  }
  const body = await readLimitedJson(response, 24 * 1024 * 1024)
  const parsed = z
    .object({
      data: z
        .array(
          z.object({
            b64_json: z.string().optional(),
            url: z.string().optional(),
            revised_prompt: z.string().optional(),
          }),
        )
        .min(1),
    })
    .safeParse(body)
  if (!parsed.success) {
    throw new Error('生图服务返回格式无效。')
  }
  const first = parsed.data.data[0]!
  const imageDataUrl = first.b64_json
    ? `data:image/png;base64,${first.b64_json}`
    : first.url
      ? await fetchRemoteImageAsDataUrl(first.url, signal, fetchImpl)
      : null
  if (!imageDataUrl) {
    throw new Error('生图响应中未包含图片数据。')
  }
  return {
    imageDataUrl,
    revisedPrompt: first.revised_prompt ?? null,
    model: resolved.model,
    endpoint: 'images',
  }
}

export async function handleImageGenPost(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  let parsed: ImageGenRequest
  try {
    parsed = ImageGenRequestSchema.parse(await readLimitedJson(request))
  } catch {
    return Response.json({ error: '生图请求参数无效，请检查提示词与参考图格式。' }, { status: 400 })
  }
  try {
    return Response.json(await generateDesignImage(parsed, request.signal))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '图片生成失败。' },
      { status: 502 },
    )
  }
}
