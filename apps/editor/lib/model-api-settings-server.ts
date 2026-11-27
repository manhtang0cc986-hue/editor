import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  hydrateProcessEnvFromFile,
  parseEnvEntries,
  persistHouseAgentEnv,
  resolveRepoEnvLocalPath,
  serializeEnvUpdates,
} from './house-agent-env'
import { imageConfiguration } from './house-agent-image'
import { agentConfiguration, readLimitedJson } from './house-agent-server'
import type {
  ModelApiCandidate,
  ModelApiInput,
  ModelApiProbe,
  ModelApiSnapshot,
} from './model-api-settings'

const MESHY_BASE_URL = 'https://api.meshy.ai/openapi/v1'
const keyNames = {
  agent: 'PASCAL_AGENT_API_KEY',
  image: 'PASCAL_IMAGE_API_KEY',
  video: 'PASCAL_VIDEO_API_KEY',
  mesh: 'MESHY_API_KEY',
} as const
const otherKeys = [
  'PASCAL_VIDEO_BASE_URL',
  'PASCAL_VIDEO_MODEL',
  'PASCAL_VIDEO_API_KEY',
  'MESHY_API_KEY',
] as const
type Options = { env?: NodeJS.ProcessEnv; envFile?: string }

function getEnvironment(options?: Options) {
  const env = options?.env ?? process.env
  const envFile = options?.envFile ?? resolveRepoEnvLocalPath()
  hydrateProcessEnvFromFile(env, envFile)
  if (existsSync(envFile)) {
    const disk = parseEnvEntries(readFileSync(envFile, 'utf8'))
    for (const key of otherKeys) if (!env[key] && disk[key]) env[key] = disk[key]
  }
  return { env, envFile }
}

export function modelApiSnapshot(options?: Options): ModelApiSnapshot {
  const { env } = getEnvironment(options)
  const agent = agentConfiguration(env)
  const image = imageConfiguration(env)
  return {
    agent: {
      baseUrl: agent.baseUrl,
      model: agent.model ?? '',
      hasKey: Boolean(env.PASCAL_AGENT_API_KEY?.trim()),
    },
    image: {
      baseUrl: image.baseUrl,
      model: image.model ?? '',
      imageMode: image.mode,
      hasKey: Boolean(env.PASCAL_IMAGE_API_KEY?.trim()),
    },
    video: {
      baseUrl: env.PASCAL_VIDEO_BASE_URL ?? '',
      model: env.PASCAL_VIDEO_MODEL ?? '',
      hasKey: Boolean(env.PASCAL_VIDEO_API_KEY?.trim()),
    },
    mesh: { baseUrl: MESHY_BASE_URL, model: 'Meshy', hasKey: Boolean(env.MESHY_API_KEY?.trim()) },
  }
}

function modelApiBase(raw: string): string {
  const base = raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|images\/(?:generations|edits)|videos|models)$/i, '')
  const url = z.url().safeParse(base)
  if (!url.success) throw new Error('Enter a valid API Base URL.')
  const parsed = new URL(url.data)
  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('Enter an HTTP or HTTPS Base URL without credentials, query or fragment.')
  return parsed.href.replace(/\/+$/, '')
}

function persistAdditionalEnv(
  env: NodeJS.ProcessEnv,
  envFile: string,
  updates: Record<string, string>,
) {
  const previous = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  const contents = serializeEnvUpdates(previous, updates)
  if (contents !== previous) {
    mkdirSync(dirname(envFile), { recursive: true })
    const temporary = `${envFile}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, envFile)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value) env[key] = value
    else delete env[key]
  }
}

function resolveConnection(input: ModelApiInput, options?: Options) {
  const { env, envFile } = getEnvironment(options)
  const saved = modelApiSnapshot({ env, envFile })[input.target]
  const baseUrl =
    input.target === 'mesh' ? MESHY_BASE_URL : modelApiBase(input.baseUrl || saved.baseUrl)
  const oldBase = saved.baseUrl ? modelApiBase(saved.baseUrl) : ''
  if (baseUrl !== oldBase && !input.apiKey)
    throw new Error('Enter the API key for the changed address.')
  const apiKey = input.apiKey || env[keyNames[input.target]]?.trim()
  if (!apiKey) throw new Error('Enter an API key for this service.')
  return { env, envFile, baseUrl, apiKey, saved }
}

export function saveModelApiSettings(input: ModelApiInput, options?: Options): ModelApiSnapshot {
  const { env, envFile, baseUrl } = resolveConnection(input, options)
  if (input.target === 'agent' || input.target === 'image') {
    persistHouseAgentEnv(
      {
        [input.target]: {
          baseUrl,
          model: input.model,
          apiKey: input.apiKey,
          ...(input.target === 'image' && input.imageMode && { mode: input.imageMode }),
        },
      },
      { env, envFilePath: envFile },
    )
  } else if (input.target === 'mesh') {
    if (input.apiKey) persistAdditionalEnv(env, envFile, { MESHY_API_KEY: input.apiKey })
  } else {
    persistAdditionalEnv(env, envFile, {
      PASCAL_VIDEO_BASE_URL: baseUrl,
      ...(input.model !== undefined && { PASCAL_VIDEO_MODEL: input.model }),
      ...(input.apiKey && { PASCAL_VIDEO_API_KEY: input.apiKey }),
    })
  }
  return modelApiSnapshot({ env, envFile })
}

const modelEntry = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(207).optional(),
  owned_by: z.string().max(100).optional(),
  capabilities: z
    .object({ chat: z.boolean().optional(), tool_calling: z.boolean().optional() })
    .optional(),
})

function getModelCandidates(body: unknown, target: ModelApiInput['target']): ModelApiCandidate[] {
  const parsed = z
    .object({ data: z.array(z.unknown()).optional(), models: z.array(z.unknown()).optional() })
    .parse(body)
  const entries = parsed.data ?? parsed.models
  if (!entries) throw new Error('The service did not return a model list.')
  const models = new Map<string, ModelApiCandidate>()
  for (const item of entries) {
    const entry = modelEntry.safeParse(item)
    if (!entry.success) continue
    const model = entry.data
    const id = model.id ?? model.name?.replace(/^models\//, '')
    if (!id) continue
    if (
      target === 'agent' &&
      (model.capabilities?.chat === false ||
        model.capabilities?.tool_calling === false ||
        /(?:^|[-_/])(?:embed|embedding|rerank|whisper|tts|video|imagen|gpt-image|dall-e|sora|veo|moderation)(?:$|[-_/])/i.test(
          id,
        ) ||
        /gemini-[\w.-]+-image/i.test(id))
    )
      continue
    models.set(id, { id, ...(model.owned_by && { owner: model.owned_by }) })
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id))
}

export async function probeModelApi(
  input: ModelApiInput,
  signal: AbortSignal,
  options?: Options & { fetchImpl?: typeof fetch },
): Promise<ModelApiProbe> {
  const { baseUrl, apiKey, saved } = resolveConnection(input, options)
  const mesh = input.target === 'mesh'
  const started = performance.now()
  let response: Response
  try {
    response = await (options?.fetchImpl ?? fetch)(`${baseUrl}/${mesh ? 'balance' : 'models'}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    })
  } catch {
    throw new Error('Could not reach the model API. Check the address and network.')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Provider returned HTTP ${response.status}.`)
  }
  const body = await readLimitedJson(response, 4 * 1024 * 1024)
  const result = { status: response.status, durationMs: Math.round(performance.now() - started) }
  if (mesh) {
    const { balance } = z.object({ balance: z.number() }).parse(body)
    return { ...result, credits: balance, models: [] }
  }
  const models = getModelCandidates(body, input.target)
  const model = input.model ?? saved.model
  return {
    ...result,
    models,
    ...(model && { selectedModelListed: models.some(({ id }) => id === model) }),
  }
}
