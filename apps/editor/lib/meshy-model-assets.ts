import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { parseEnvEntries, resolveRepoEnvLocalPath } from './house-agent-env'
import { readLimitedJson } from './house-agent-server'
import { MAX_MODEL_BYTES, readModelBytes, validateModelGlb } from './model-assets'

const API = 'https://api.meshy.ai'
const paths = { text: '/openapi/v2/text-to-3d', image: '/openapi/v1/image-to-3d' }
const kind = z.enum(['text', 'image'])
const taskId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
const stage = z.object({ kind, taskId })
export const MeshyAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create-text'), prompt: z.string().trim().min(1).max(500) }),
  z.object({
    action: z.literal('create-image'),
    image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[a-z\d+/]+={0,2}$/i),
  }),
  z.object({ action: z.literal('refine'), taskId }),
  stage.extend({ action: z.literal('status') }),
  stage.extend({ action: z.literal('download') }),
])
export type MeshyAction = z.infer<typeof MeshyAction>

export function meshyApiKey(): string {
  if (process.env.MESHY_API_KEY?.trim()) return process.env.MESHY_API_KEY.trim()
  try {
    return (
      parseEnvEntries(readFileSync(resolveRepoEnvLocalPath(), 'utf8')).MESHY_API_KEY?.trim() ?? ''
    )
  } catch {
    return ''
  }
}

const taskStatus = z.object({
  status: z.enum([
    'PENDING',
    'IN_PROGRESS',
    'SUCCEEDED',
    'FAILED',
    'CANCELED',
    'CANCELLED',
    'EXPIRED',
  ]),
  progress: z.number().optional(),
  model_urls: z.object({ glb: z.string().optional() }).optional(),
})

export async function runMeshyAction(
  action: MeshyAction,
  key: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const apiRequest = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetchImpl(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      ...(body && { method: 'POST', body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Meshy API returned HTTP ${response.status}.`)
    }
    return readLimitedJson(response, 1024 * 1024)
  }

  switch (action.action) {
    case 'create-text':
    case 'create-image':
    case 'refine': {
      const isImage = action.action === 'create-image'
      const { result } = z.object({ result: taskId }).parse(
        await apiRequest(isImage ? paths.image : paths.text, {
          target_formats: ['glb'],
          ...(action.action === 'create-text'
            ? { mode: 'preview', prompt: action.prompt, moderation: true }
            : action.action === 'refine'
              ? { mode: 'refine', preview_task_id: action.taskId }
              : { image_url: action.image, should_texture: true, moderation: true }),
        }),
      )
      return Response.json({ taskId: result })
    }
    case 'status':
    case 'download': {
      const task = taskStatus.parse(await apiRequest(`${paths[action.kind]}/${action.taskId}`))
      if (action.action === 'status') {
        return Response.json({ status: task.status, progress: task.progress ?? 0 })
      }
      const glb = task.model_urls?.glb
      if (task.status !== 'SUCCEEDED' || !glb) throw new Error('Meshy has not finished this GLB.')
      const url = new URL(glb)
      if (url.origin !== 'https://assets.meshy.ai' || url.username || url.password)
        throw new Error('Meshy returned an unsupported asset host.')
      const response = await fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Meshy GLB download returned HTTP ${response.status}.`)
      }
      const bytes = await readModelBytes(response, MAX_MODEL_BYTES)
      validateModelGlb(bytes)
      return new Response(bytes as BodyInit, {
        headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store' },
      })
    }
  }
}
