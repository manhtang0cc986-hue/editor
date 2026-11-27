import { readLimitedJson } from '@/lib/house-agent-server'
import { MeshyAction, meshyApiKey, runMeshyAction } from '@/lib/meshy-model-assets'
import { MAX_REFERENCE_BYTES } from '@/lib/model-assets'
import { guardSceneApiRequest } from '@/lib/scene-api-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  const blocked = guardSceneApiRequest(request)
  if (blocked) return blocked
  return Response.json(
    { configured: Boolean(meshyApiKey()) },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

export async function POST(request: Request) {
  const blocked = guardSceneApiRequest(request)
  if (blocked) return blocked
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json({ error: 'Origin not allowed.' }, { status: 403 })
  const key = meshyApiKey()
  if (!key) return Response.json({ error: 'Set MESHY_API_KEY in .env.local.' }, { status: 503 })

  let action: MeshyAction
  try {
    action = MeshyAction.parse(
      await readLimitedJson(request, Math.ceil(MAX_REFERENCE_BYTES / 3) * 4 + 512),
    )
    if (
      action.action === 'create-image' &&
      Buffer.from(action.image.split(',')[1]!, 'base64').length > MAX_REFERENCE_BYTES
    )
      throw new Error('Reference image too large')
  } catch {
    return Response.json({ error: 'Invalid model generation request.' }, { status: 400 })
  }
  try {
    return await runMeshyAction(action, key, request.signal)
  } catch (error) {
    const message =
      error instanceof Error &&
      /^Meshy |^The file |^Upload a valid |^Export a self-contained /.test(error.message)
        ? error.message
        : 'Meshy returned an invalid response or timed out.'
    return Response.json({ error: message }, { status: 502 })
  }
}
