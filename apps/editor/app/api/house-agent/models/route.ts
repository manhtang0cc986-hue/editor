import { z } from 'zod'
import { hydrateProcessEnvFromFile } from '@/lib/house-agent-env'
import { imageConfiguration } from '@/lib/house-agent-image'
import { AgentReasoningEffortSchema, type DetectedModelItem } from '@/lib/house-agent-protocol'
import { agentConfiguration, readLimitedJson } from '@/lib/house-agent-server'

export const runtime = 'nodejs'

const ModelsRequestSchema = z.union([
  z
    .object({
      useServerConfig: z.literal(true),
      target: z.enum(['agent', 'image']).optional(),
    })
    .strict(),
  z
    .object({
      baseUrl: z.string().trim().min(1).max(500).optional(),
      apiKey: z.string().trim().min(1).max(500),
    })
    .strict(),
])

const ModelSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(207).optional(),
  owned_by: z.string().trim().min(1).max(100).optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
  reasoning_efforts: z.array(z.string()).optional(),
  supported_reasoning_efforts: z.array(z.string()).optional(),
  supported_parameters: z.array(z.string()).optional(),
  capabilities: z
    .object({
      chat: z.boolean().optional(),
      tool_calling: z.boolean().optional(),
      reasoning_efforts: z.array(z.string()).optional(),
    })
    .optional(),
})

function modelKind(id: string, model: z.infer<typeof ModelSchema>): DetectedModelItem['kind'] {
  const supportsTools =
    model.capabilities?.tool_calling ??
    model.supported_parameters?.some(
      (parameter) => parameter === 'tools' || parameter === 'tool_choice',
    )
  if (model.capabilities?.chat === true && supportsTools !== false) return 'chat'
  if (
    /(?:^|[\s/:_.-])(?:gpt-image|dall-e|imagen|nano-banana|flux|midjourney|stable-diffusion|gemini-[\w.-]+-image)(?:$|[\s/:_.-])/i.test(
      id,
    )
  )
    return 'image'
  if (
    model.capabilities?.chat === false ||
    supportsTools === false ||
    /(?:^|[\s/:_.-])(?:embeddings?|embed|rerank|whisper|tts|transcribe|audio|moderation|sora|veo|video|realtime|codex-search)(?:$|[\s/:_.-])/i.test(
      id,
    ) ||
    (model.supportedGenerationMethods &&
      !model.supportedGenerationMethods.includes('generateContent'))
  )
    return 'other'
  // OpenAI-compatible gateways can expose custom deployment aliases without capability metadata.
  return 'chat'
}

export async function POST(request: Request) {
  hydrateProcessEnvFromFile()
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let parsed: z.infer<typeof ModelsRequestSchema>
  try {
    parsed = ModelsRequestSchema.parse(await readLimitedJson(request, 4096))
  } catch {
    return Response.json({ error: '请填写有效的 API Key 和 Base URL。' }, { status: 400 })
  }

  const useImageServer = 'useServerConfig' in parsed && parsed.target === 'image'
  const server = useImageServer ? imageConfiguration() : agentConfiguration()
  const baseUrl = ('useServerConfig' in parsed ? server.baseUrl : parsed.baseUrl || server.baseUrl)
    .trim()
    .replace(/\/+$/, '')
  const apiKey =
    'useServerConfig' in parsed
      ? useImageServer
        ? process.env.PASCAL_IMAGE_API_KEY
        : process.env.PASCAL_AGENT_API_KEY
      : parsed.apiKey
  if (!apiKey) return Response.json({ error: '请先配置模型服务的 API Key。' }, { status: 400 })

  let modelsUrl: URL
  try {
    modelsUrl = new URL(`${baseUrl}/models`)
  } catch {
    return Response.json({ error: 'Base URL 格式无效。' }, { status: 400 })
  }
  if (
    !['http:', 'https:'].includes(modelsUrl.protocol) ||
    modelsUrl.username ||
    modelsUrl.password ||
    modelsUrl.search ||
    modelsUrl.hash
  ) {
    return Response.json({ error: 'Base URL 格式无效。' }, { status: 400 })
  }

  let response: Response
  try {
    response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    })
  } catch {
    return Response.json({ error: '连接模型服务失败或超时，请检查 Base URL。' }, { status: 502 })
  }

  if (!response.ok) {
    await response.body?.cancel()
    return Response.json(
      { error: `密钥验证或获取模型列表失败（HTTP ${response.status}）。` },
      { status: 502 },
    )
  }

  const body = (await readLimitedJson(response, 4 * 1024 * 1024).catch(() => null)) as {
    data?: unknown[]
    models?: unknown[]
  } | null
  const entries = Array.isArray(body?.data) ? body.data : body?.models
  if (!Array.isArray(entries)) {
    return Response.json({ error: '模型服务未返回有效的模型列表。' }, { status: 502 })
  }

  const models = new Map<string, DetectedModelItem>()
  for (const entry of entries) {
    const result = ModelSchema.safeParse(entry)
    if (!result.success) continue
    const model = result.data
    const id = model.id ?? model.name?.replace(/^models\//, '')
    if (!id || id.length > 200 || models.has(id)) continue
    const advertised =
      model.supported_reasoning_efforts ??
      model.reasoning_efforts ??
      model.capabilities?.reasoning_efforts
    const reasoningEfforts = advertised
      ? AgentReasoningEffortSchema.options.filter(
          (effort) => effort !== 'auto' && advertised.includes(effort),
        )
      : model.supported_parameters &&
          !model.supported_parameters.includes('reasoning_effort') &&
          !model.supported_parameters.includes('reasoning')
        ? []
        : undefined
    models.set(id, {
      id,
      ...(model.owned_by ? { ownedBy: model.owned_by } : {}),
      kind: modelKind(id, model),
      ...(reasoningEfforts ? { reasoningEfforts } : {}),
    })
  }
  const ordered = [...models.values()].sort(
    (a, b) => (a.ownedBy ?? '').localeCompare(b.ownedBy ?? '') || a.id.localeCompare(b.id),
  )
  return Response.json({ count: ordered.length, models: ordered })
}
