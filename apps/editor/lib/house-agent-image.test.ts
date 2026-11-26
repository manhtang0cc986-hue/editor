import { describe, expect, test } from 'bun:test'
import { generateDesignImage, handleImageGenPost, imageConfiguration } from './house-agent-image'

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('imageConfiguration', () => {
  test('reports unconfigured defaults and inherits agent baseUrl if image baseUrl omitted', () => {
    const config = imageConfiguration({
      PASCAL_AGENT_BASE_URL: 'https://agent.example.com/v1',
    } as unknown as NodeJS.ProcessEnv)
    expect(config).toEqual({
      configured: false,
      model: null,
      baseUrl: 'https://agent.example.com/v1',
      mode: 'auto',
      source: 'none',
    })
  })

  test('reports independent image env configuration when key and model are provided', () => {
    const config = imageConfiguration({
      PASCAL_IMAGE_BASE_URL: 'https://img.example.com/v1',
      PASCAL_IMAGE_MODEL: 'gpt-image-1',
      PASCAL_IMAGE_API_KEY: 'img-secret-key',
      PASCAL_IMAGE_API_MODE: 'chat',
    } as unknown as NodeJS.ProcessEnv)
    expect(config).toEqual({
      configured: true,
      model: 'gpt-image-1',
      baseUrl: 'https://img.example.com/v1',
      mode: 'chat',
      source: 'env',
    })
  })
})

describe('generateDesignImage', () => {
  test('calls /images/generations using override model, baseUrl, and separate key', async () => {
    const calls: Array<{ url: string; auth: string | null; body: string }> = []
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push({
        url: String(input),
        auth: headers.get('authorization'),
        body: String(init?.body ?? ''),
      })
      return new Response(
        JSON.stringify({
          data: [{ b64_json: PNG_1X1_BASE64, revised_prompt: 'Modern white villa daylight' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await generateDesignImage(
      {
        prompt: 'Modern white two-storey villa with courtyard',
        preset: 'exterior',
        size: '1536x1024',
        config: {
          baseUrl: 'https://custom-image.example/v1',
          model: 'gpt-image-1',
          apiKey: 'separate-img-key',
          mode: 'images',
        },
      },
      new AbortController().signal,
      {
        PASCAL_AGENT_API_KEY: 'agent-only-key',
        PASCAL_AGENT_MODEL: 'gpt-4o',
      } as unknown as NodeJS.ProcessEnv,
      fakeFetch,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://custom-image.example/v1/images/generations')
    expect(calls[0]?.auth).toBe('Bearer separate-img-key')
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      model: 'gpt-image-1',
      size: '1536x1024',
    })
    expect(result.endpoint).toBe('images')
    expect(result.model).toBe('gpt-image-1')
    expect(result.revisedPrompt).toBe('Modern white villa daylight')
    expect(result.imageDataUrl).toBe(`data:image/png;base64,${PNG_1X1_BASE64}`)
  })

  test('calls /images/edits multipart endpoint when referenceImage is provided', async () => {
    const urls: string[] = []
    let receivedForm = false
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      if (String(input).endsWith('/images/edits')) {
        receivedForm = init?.body instanceof FormData
        return new Response(
          JSON.stringify({ data: [{ url: 'https://cdn.example.com/render.png' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      const bytes = Buffer.from(PNG_1X1_BASE64, 'base64')
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
    }) as typeof fetch

    const result = await generateDesignImage(
      {
        prompt: 'Warm Mediterranean courtyard restyle',
        preset: 'courtyard',
        size: '1024x1024',
        referenceImage: `data:image/png;base64,${PNG_1X1_BASE64}`,
        config: {
          baseUrl: 'https://img.example.com/v1',
          model: 'gpt-image-1',
          apiKey: 'img-key',
          mode: 'images',
        },
      },
      new AbortController().signal,
      {} as NodeJS.ProcessEnv,
      fakeFetch,
    )

    expect(receivedForm).toBe(true)
    expect(urls).toEqual([
      'https://img.example.com/v1/images/edits',
      'https://cdn.example.com/render.png',
    ])
    expect(result.endpoint).toBe('edits')
    expect(result.imageDataUrl).toStartWith('data:image/png;base64,')
  })

  test('auto-selects /chat/completions for gemini image models and extracts returned image', async () => {
    let hitUrl = ''
    const fakeFetch = (async (input: RequestInfo | URL) => {
      hitUrl = String(input)
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Generated floor plan layout.',
                images: [{ image_url: { url: `data:image/png;base64,${PNG_1X1_BASE64}` } }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const result = await generateDesignImage(
      {
        prompt: 'Minimalist two-storey house floor plan',
        preset: 'floorplan',
        config: {
          baseUrl: 'https://relay.example.com/v1',
          model: 'gemini-2.5-flash-image',
          apiKey: 'relay-key',
          mode: 'auto',
        },
      },
      new AbortController().signal,
      {} as NodeJS.ProcessEnv,
      fakeFetch,
    )

    expect(hitUrl).toBe('https://relay.example.com/v1/chat/completions')
    expect(result.endpoint).toBe('chat')
    expect(result.revisedPrompt).toBe('Generated floor plan layout.')
    expect(result.imageDataUrl).toBe(`data:image/png;base64,${PNG_1X1_BASE64}`)
  })

  test('throws a clear error when neither env nor client image credentials are configured', async () => {
    await expect(
      generateDesignImage(
        { prompt: 'Villa render' },
        new AbortController().signal,
        {} as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow(/API Key/)
  })

  test('blocks custom baseUrl without matching client apiKey before any upstream fetch', async () => {
    let fetchCalls = 0
    const fakeFetch = (async () => {
      fetchCalls += 1
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    await expect(
      generateDesignImage(
        {
          prompt: 'Villa render',
          config: {
            baseUrl: 'https://custom-provider.example/v1',
            model: 'gpt-image-1',
          },
        },
        new AbortController().signal,
        {
          PASCAL_IMAGE_API_KEY: 'server-secret-key',
          PASCAL_IMAGE_MODEL: 'gpt-image-1',
        } as unknown as NodeJS.ProcessEnv,
        fakeFetch,
      ),
    ).rejects.toThrow(/API Key/)

    expect(fetchCalls).toBe(0)
  })
})

describe('handleImageGenPost', () => {
  test('rejects missing or mismatched origin with 403', async () => {
    const req = new Request('http://localhost/api/house-agent/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ prompt: 'Modern villa' }),
    })
    const res = await handleImageGenPost(req)
    expect(res.status).toBe(403)
  })

  test('returns 400 on invalid request payload from same origin', async () => {
    const req = new Request('http://localhost/api/house-agent/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ prompt: '' }),
    })
    const res = await handleImageGenPost(req)
    expect(res.status).toBe(400)
  })
})
