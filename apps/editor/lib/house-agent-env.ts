import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import { imageConfiguration } from './house-agent-image'
import type { EnvConfigSaveSchema } from './house-agent-protocol'
import { agentConfiguration } from './house-agent-server'

const MANAGED_ENV_KEYS = new Set([
  'PASCAL_AGENT_BASE_URL',
  'PASCAL_AGENT_MODEL',
  'PASCAL_AGENT_API_KEY',
  'PASCAL_AGENT_REASONING_EFFORT',
  'PASCAL_IMAGE_BASE_URL',
  'PASCAL_IMAGE_MODEL',
  'PASCAL_IMAGE_API_KEY',
  'PASCAL_IMAGE_API_MODE',
])

export function maskSecret(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}

export function resolveRepoEnvLocalPath(cwd: string = process.cwd()): string {
  if (existsSync(path.join(cwd, 'apps', 'editor', 'package.json'))) {
    return path.join(cwd, '.env.local')
  }
  const parentTwo = path.resolve(cwd, '..', '..')
  if (existsSync(path.join(parentTwo, 'apps', 'editor', 'package.json'))) {
    return path.join(parentTwo, '.env.local')
  }
  return path.join(cwd, '.env.local')
}

function sanitizeEnvValue(raw: string): string {
  return raw.replace(/[\r\n]/g, '').trim()
}

function formatEnvValue(value: string): string {
  const clean = sanitizeEnvValue(value)
  if (clean === '' || /[\s#"'`$\\]/.test(clean)) {
    return JSON.stringify(clean)
  }
  return clean
}

export function parseEnvEntries(content: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      try {
        val = val.startsWith('"') ? JSON.parse(val) : val.slice(1, -1)
      } catch {
        val = val.slice(1, -1)
      }
    }
    entries[key] = val
  }
  return entries
}

export function serializeEnvUpdates(
  existingContent: string,
  updates: Record<string, string | undefined>,
): string {
  const lines = existingContent ? existingContent.split(/\r?\n/) : []
  const seen = new Set<string>()
  const nextLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      nextLines.push(line)
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      nextLines.push(line)
      continue
    }
    const key = line.slice(0, eq).trim()
    if (key in updates) {
      seen.add(key)
      const val = updates[key]
      if (val !== undefined && val !== '') {
        nextLines.push(`${key}=${formatEnvValue(val)}`)
      }
      continue
    }
    nextLines.push(line)
  }

  for (const [key, val] of Object.entries(updates)) {
    if (seen.has(key) || val === undefined || val === '') continue
    nextLines.push(`${key}=${formatEnvValue(val)}`)
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
    nextLines.pop()
  }
  return `${nextLines.join('\n')}\n`
}

function validateHttpBaseUrl(raw: string, label: string): string {
  const trimmed = raw
    .trim()
    .replace(/\/+(?:chat\/completions|images\/(?:generations|edits)|models)\/?$/i, '')
    .replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(`${trimmed}/models`)
  } catch {
    throw new Error(`${label} 格式无效。`)
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} 配置无效。`)
  }
  return trimmed
}

export function hydrateProcessEnvFromFile(
  env: NodeJS.ProcessEnv = process.env,
  envFilePath: string = resolveRepoEnvLocalPath(),
): void {
  if (!existsSync(envFilePath)) return
  try {
    const parsed = parseEnvEntries(readFileSync(envFilePath, 'utf8'))
    for (const key of MANAGED_ENV_KEYS) {
      if (parsed[key] && !env[key]) {
        env[key] = parsed[key]
      }
    }
  } catch {
    // Ignore unreadable .env.local on hydration.
  }
}

export function persistHouseAgentEnv(
  input: z.infer<typeof EnvConfigSaveSchema>,
  options?: { env?: NodeJS.ProcessEnv; envFilePath?: string },
) {
  const env = options?.env ?? process.env
  const envFilePath = options?.envFilePath ?? resolveRepoEnvLocalPath()
  hydrateProcessEnvFromFile(env, envFilePath)

  const existingContent = existsSync(envFilePath) ? readFileSync(envFilePath, 'utf8') : ''
  const existingDisk = parseEnvEntries(existingContent)
  const updates: Record<string, string | undefined> = {}

  if (input.agent) {
    const prevBase = (
      existingDisk.PASCAL_AGENT_BASE_URL ||
      env.PASCAL_AGENT_BASE_URL ||
      'https://api.openai.com/v1'
    ).replace(/\/+$/, '')
    const rawBase = input.agent.baseUrl?.trim()
    const nextBase = rawBase ? validateHttpBaseUrl(rawBase, '对话模型 Base URL') : prevBase
    const nextKey = input.agent.apiKey?.trim()
    if (nextBase !== prevBase && !nextKey) {
      throw new Error('切换对话模型 Base URL 时，必须同时提供对应的 API Key。')
    }
    if (rawBase !== undefined) {
      updates.PASCAL_AGENT_BASE_URL = rawBase ? nextBase : ''
    }
    if (input.agent.model !== undefined) {
      updates.PASCAL_AGENT_MODEL = input.agent.model.trim()
    }
    if (nextKey) {
      updates.PASCAL_AGENT_API_KEY = nextKey
    }
    if (input.agent.reasoningEffort !== undefined) {
      updates.PASCAL_AGENT_REASONING_EFFORT = input.agent.reasoningEffort
    }
  }

  if (input.image) {
    const prevBase = (
      existingDisk.PASCAL_IMAGE_BASE_URL ||
      env.PASCAL_IMAGE_BASE_URL ||
      existingDisk.PASCAL_AGENT_BASE_URL ||
      env.PASCAL_AGENT_BASE_URL ||
      'https://api.openai.com/v1'
    ).replace(/\/+$/, '')
    const rawBase = input.image.baseUrl?.trim()
    const nextBase = rawBase ? validateHttpBaseUrl(rawBase, '生图模型 Base URL') : prevBase
    const nextKey = input.image.apiKey?.trim()
    if (nextBase !== prevBase && !nextKey) {
      throw new Error('切换生图模型 Base URL 时，必须同时提供对应的生图 API Key。')
    }
    if (rawBase !== undefined) {
      updates.PASCAL_IMAGE_BASE_URL = rawBase ? nextBase : ''
    }
    if (input.image.model !== undefined) {
      updates.PASCAL_IMAGE_MODEL = input.image.model.trim()
    }
    if (nextKey) {
      updates.PASCAL_IMAGE_API_KEY = nextKey
    }
    if (input.image.mode !== undefined) {
      updates.PASCAL_IMAGE_API_MODE = input.image.mode
    }
  }

  const nextContent = serializeEnvUpdates(existingContent, updates)
  if (nextContent !== existingContent) {
    mkdirSync(path.dirname(envFilePath), { recursive: true })
    writeFileSync(envFilePath, nextContent, { encoding: 'utf8', mode: 0o600 })
  }

  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined || val === '') {
      delete env[key]
    } else {
      env[key] = val
    }
  }

  const agentCfg = agentConfiguration(env)
  const imageCfg = imageConfiguration(env)
  return {
    saved: true,
    agent: { ...agentCfg, maskedApiKey: maskSecret(env.PASCAL_AGENT_API_KEY) },
    image: { ...imageCfg, maskedApiKey: maskSecret(env.PASCAL_IMAGE_API_KEY) },
  }
}
