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
