import { expect, spyOn, test } from 'bun:test'
import { POST } from '../app/api/house-agent/models/route'

test('model detection preserves custom chat aliases, distinguishes non-chat models, and reports advertised reasoning levels', async () => {
  const upstream = spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      data: [
        {
          id: 'private-design-model',
          owned_by: 'Internal',
          reasoning_efforts: ['high', 'xhigh', 'medium', 'unknown'],
        },
        { id: 'private-design-model' },
        { id: 'another-chat', capabilities: { chat: true }, supported_parameters: ['tools'] },
        { id: 'text-only', capabilities: { chat: true, tool_calling: false } },
        { id: 'text-embedding-3-small' },
        { id: 'gemini-2.5-flash-image' },
        { id: 'sora-video' },
      ],
    }),
  )
  try {
    const response = await POST(
      new Request('http://localhost/api/house-agent/models', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'https://models.example/v1', apiKey: 'synthetic-key' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(new URL(String(upstream.mock.calls[0]?.[0])).pathname).toBe('/v1/models')
    expect(await response.json()).toEqual({
      count: 6,
      models: [
        { id: 'another-chat', kind: 'chat', reasoningEfforts: [] },
        { id: 'gemini-2.5-flash-image', kind: 'image' },
        { id: 'sora-video', kind: 'other' },
        { id: 'text-embedding-3-small', kind: 'other' },
        { id: 'text-only', kind: 'other' },
        {
          id: 'private-design-model',
          kind: 'chat',
          ownedBy: 'Internal',
          reasoningEfforts: ['medium', 'high', 'xhigh'],
        },
      ],
    })
  } finally {
    upstream.mockRestore()
  }
})

test('useServerConfig supports target image with PASCAL_IMAGE_API_KEY and PASCAL_IMAGE_BASE_URL', async () => {
  const prevUrl = process.env.PASCAL_IMAGE_BASE_URL
  const prevKey = process.env.PASCAL_IMAGE_API_KEY
  process.env.PASCAL_IMAGE_BASE_URL = 'https://img-server.example/v1'
  process.env.PASCAL_IMAGE_API_KEY = 'img-server-key'

  const upstream = spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({ data: [{ id: 'gpt-image-1' }] }),
  )
  try {
    const response = await POST(
      new Request('http://localhost/api/house-agent/models', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ useServerConfig: true, target: 'image' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(String(upstream.mock.calls[0]?.[0])).toBe('https://img-server.example/v1/models')
    const headers = new Headers(upstream.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer img-server-key')
    const json = (await response.json()) as { count: number; models: Array<{ id: string }> }
    expect(json.count).toBe(1)
    expect(json.models[0]?.id).toBe('gpt-image-1')
  } finally {
    upstream.mockRestore()
    if (prevUrl === undefined) delete process.env.PASCAL_IMAGE_BASE_URL
    else process.env.PASCAL_IMAGE_BASE_URL = prevUrl
    if (prevKey === undefined) delete process.env.PASCAL_IMAGE_API_KEY
    else process.env.PASCAL_IMAGE_API_KEY = prevKey
  }
})
