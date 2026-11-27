import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactHash } from '@pascal-app/core'
import { DiskArtifactStore } from '@pascal-app/mcp/storage'
import { runMeshyAction } from './meshy-model-assets'
import { type ModelAssetForm, readModelBytes, validateModelGlb } from './model-assets'
import { listModelAssets, saveModelAsset } from './model-assets-store'

function glb(json: object = { asset: { version: '2.0' }, meshes: [{}] }) {
  const text = JSON.stringify(json)
  const payload = new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 4) * 4, ' '))
  const bytes = new Uint8Array(20 + payload.length)
  const header = new DataView(bytes.buffer)
  header.setUint32(0, 0x46546c67, true)
  header.setUint32(4, 2, true)
  header.setUint32(8, bytes.length, true)
  header.setUint32(12, payload.length, true)
  header.setUint32(16, 0x4e4f534a, true)
  bytes.set(payload, 20)
  return bytes
}

test('GLB import rejects external resources and enforces the limit on streamed bytes', async () => {
  expect(() => validateModelGlb(new Uint8Array(20))).toThrow(/valid GLB/)
  expect(() =>
    validateModelGlb(
      glb({
        asset: { version: '2.0' },
        meshes: [{}],
        images: [{ uri: 'https://example.test/image.png' }],
      }),
    ),
  ).toThrow(/self-contained/)
  await expect(readModelBytes(new Response(new Uint8Array(16)), 8)).rejects.toThrow(/size limit/)
})

test('saved models remain discoverable and reuse the artifact bytes on retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pascal-models-'))
  const database = join(dir, 'editor.db')
  const metadata: ModelAssetForm = {
    name: '原木椅',
    category: 'furniture',
    dimensions: [0.5, 0.8, 0.5],
    offset: [0, 0, 0],
    scale: [1, 1, 1],
  }
  try {
    expect(await listModelAssets(database)).toEqual([])
    const bytes = glb()
    const asset = await saveModelAsset(bytes, metadata, database)
    expect(await saveModelAsset(bytes, metadata, database)).toEqual(asset)
    expect(await listModelAssets(database)).toEqual([asset])
    expect(await new DiskArtifactStore(database).read(artifactHash(asset.src)!)).toEqual(
      Buffer.from(bytes),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Meshy supports text, image and texture refinement without exposing its key', async () => {
  const received: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetchImpl = (async (url, init) => {
    received.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
    return Response.json({ result: 'test-task' })
  }) as typeof fetch
  const signal = AbortSignal.timeout(1000)
  for (const action of [
    { action: 'create-text', prompt: 'Oak chair' },
    { action: 'refine', taskId: 'preview' },
    { action: 'create-image', image: 'data:image/png;base64,YQ==' },
  ] as const) {
    expect(await (await runMeshyAction(action, 'test-key', signal, fetchImpl)).json()).toEqual({
      taskId: 'test-task',
    })
  }
  expect(received).toMatchObject([
    {
      url: 'https://api.meshy.ai/openapi/v2/text-to-3d',
      body: { mode: 'preview', prompt: 'Oak chair' },
    },
    {
      url: 'https://api.meshy.ai/openapi/v2/text-to-3d',
      body: { mode: 'refine', preview_task_id: 'preview' },
    },
    {
      url: 'https://api.meshy.ai/openapi/v1/image-to-3d',
      body: { image_url: 'data:image/png;base64,YQ==' },
    },
  ])
})

test('Meshy model downloads only use the expected asset origin and omit credentials', async () => {
  const signal = AbortSignal.timeout(1000)
  const action = { action: 'download', kind: 'image', taskId: 'test-task' } as const
  const malformed = (async () =>
    Response.json({
      status: 'SUCCEEDED',
      model_urls: { glb: 'https://unknown.test/model.glb' },
    })) as unknown as typeof fetch
  await expect(runMeshyAction(action, 'test-key', signal, malformed)).rejects.toThrow(/asset host/)
  const fetchImpl = (async (url, init) => {
    if (String(url).startsWith('https://api.meshy.ai/')) {
      return Response.json({
        status: 'SUCCEEDED',
        model_urls: { glb: 'https://assets.meshy.ai/model.glb' },
      })
    }
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    return new Response(glb())
  }) as typeof fetch
  const response = await runMeshyAction(action, 'test-key', signal, fetchImpl)
  expect(response.headers.get('content-type')).toBe('model/gltf-binary')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(glb())
})
