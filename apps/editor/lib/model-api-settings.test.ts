import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelApiSnapshot, probeModelApi, saveModelApiSettings } from './model-api-settings-server'

test('each category persists independently and only reports whether a key exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pascal-model-api-'))
  const envFile = join(dir, '.env.local')
  const options = { env: {}, envFile }
  try {
    writeFileSync(envFile, 'UNRELATED=keep\n')
    saveModelApiSettings(
      {
        target: 'agent',
        action: 'save',
        baseUrl: 'https://chat.example/v1/chat/completions',
        apiKey: 'test-chat-key',
        model: 'gpt-4o',
      },
      options,
    )
    saveModelApiSettings(
      {
        target: 'image',
        action: 'save',
        baseUrl: 'https://image.example/v1',
        apiKey: 'test-image-key',
        model: 'image-a',
        imageMode: 'images',
      },
      options,
    )
    saveModelApiSettings(
      {
        target: 'video',
        action: 'save',
        baseUrl: 'https://video.example/v1',
        apiKey: 'test-video-key',
        model: 'video-a',
      },
      options,
    )
    saveModelApiSettings({ target: 'mesh', action: 'save', apiKey: 'test-mesh-key' }, options)
    const fresh = modelApiSnapshot({ env: {}, envFile })
    expect(fresh.agent).toEqual({
      baseUrl: 'https://chat.example/v1',
      model: 'gpt-4o',
      hasKey: true,
    })
    expect(fresh.image).toMatchObject({ imageMode: 'images', hasKey: true })
    expect(fresh.video).toMatchObject({ model: 'video-a', hasKey: true })
    expect(fresh.mesh.hasKey).toBe(true)
    expect(JSON.stringify(fresh)).not.toContain('test-')
    expect(readFileSync(envFile, 'utf8')).toContain('UNRELATED=keep')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saved credentials cannot be sent to a changed Base URL without a new key', async () => {
  await expect(
    probeModelApi(
      { target: 'agent', action: 'test', baseUrl: 'https://other.example/v1' },
      new AbortController().signal,
      {
        env: {
          PASCAL_AGENT_BASE_URL: 'https://chat.example/v1',
          PASCAL_AGENT_API_KEY: 'saved-key',
        },
        envFile: '/dev/null',
      },
    ),
  ).rejects.toThrow(/key for the changed address/)
})

test('model discovery and request tests use authenticated read requests for each provider', async () => {
  const seen: string[] = []
  const fetchImpl = (async (url, init) => {
    seen.push(String(url))
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer draft-key')
    return String(url).endsWith('/balance')
      ? Response.json({ balance: 42 })
      : Response.json({
          data: [{ id: 'gpt-4o', owned_by: 'openai' }, { id: 'text-embedding-3-small' }],
        })
  }) as typeof fetch
  const options = { env: {}, envFile: '/dev/null', fetchImpl }
  const signal = AbortSignal.timeout(1000)
  const chat = await probeModelApi(
    {
      target: 'agent',
      action: 'discover',
      baseUrl: 'https://chat.example/v1',
      apiKey: 'draft-key',
    },
    signal,
    options,
  )
  expect(chat.models).toEqual([{ id: 'gpt-4o', owner: 'openai' }])
  const video = await probeModelApi(
    {
      target: 'video',
      action: 'test',
      baseUrl: 'https://video.example/v1',
      apiKey: 'draft-key',
      model: 'not-advertised',
    },
    signal,
    options,
  )
  expect(video.selectedModelListed).toBe(false)
  const mesh = await probeModelApi(
    { target: 'mesh', action: 'test', apiKey: 'draft-key' },
    signal,
    options,
  )
  expect(mesh.credits).toBe(42)
  expect(seen).toEqual([
    'https://chat.example/v1/models',
    'https://video.example/v1/models',
    'https://api.meshy.ai/openapi/v1/balance',
  ])
})
