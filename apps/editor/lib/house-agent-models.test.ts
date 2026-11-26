import { expect, spyOn, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { POST } from '../app/api/house-agent/models/route'
import { HouseAgentArchitectPopover } from '../components/house-agent-architect-popover'
import type { DetectedModelItem } from './house-agent-protocol'

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

test('saved chat credentials discover models that render with their brand logos', async () => {
  const previousUrl = process.env.PASCAL_AGENT_BASE_URL
  const previousKey = process.env.PASCAL_AGENT_API_KEY
  process.env.PASCAL_AGENT_BASE_URL = 'https://models.example/v1'
  process.env.PASCAL_AGENT_API_KEY = 'synthetic-chat-key'
  const upstream = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      data: [
        { id: 'gpt-4o-mini', owned_by: 'openai' },
        { id: 'private-alias', owned_by: 'private-gateway' },
        { id: 'gpt-image-1' },
      ],
    }),
  )
  try {
    const response = await POST(
      new Request('http://localhost/api/house-agent/models', {
        method: 'POST',
        headers: { origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ useServerConfig: true, target: 'agent' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(String(upstream.mock.calls[0]?.[0])).toBe('https://models.example/v1/models')
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer synthetic-chat-key',
    )
    const { models } = (await response.json()) as { models: DetectedModelItem[] }
    const noop = () => undefined
    const html = renderToStaticMarkup(
      createElement(HouseAgentArchitectPopover, {
        tab: 'models',
        profile: 'structure',
        effort: 'auto',
        currentModel: 'gpt-4o-mini',
        detectedModels: models.filter(({ kind }) => kind === 'chat'),
        scanned: true,
        loading: false,
        scanError: '',
        canScan: true,
        onTabChange: noop,
        onSelectProfile: noop,
        onSelectEffort: noop,
        onSelectModel: noop,
        onScan: noop,
        onOpenSettings: noop,
        onClose: noop,
      }),
    )
    expect(html).toContain('/model-logos/openai.svg')
    expect(html).toContain('gpt-4o-mini')
    expect(html).toContain('private-alias')
    expect(html).not.toContain('gpt-image-1')
    expect(html).not.toContain('synthetic-chat-key')
  } finally {
    upstream.mockRestore()
    if (previousUrl === undefined) delete process.env.PASCAL_AGENT_BASE_URL
    else process.env.PASCAL_AGENT_BASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.PASCAL_AGENT_API_KEY
    else process.env.PASCAL_AGENT_API_KEY = previousKey
  }
})
