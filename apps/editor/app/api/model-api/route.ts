import { readLimitedJson } from '@/lib/house-agent-server'
import { ModelApiInput } from '@/lib/model-api-settings'
import {
  modelApiSnapshot,
  probeModelApi,
  saveModelApiSettings,
} from '@/lib/model-api-settings-server'
import { guardSceneApiRequest } from '@/lib/scene-api-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  const blocked = guardSceneApiRequest(request)
  if (blocked) return blocked
  return Response.json(modelApiSnapshot(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const blocked = guardSceneApiRequest(request)
  if (blocked) return blocked
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json({ error: 'Origin not allowed.' }, { status: 403 })

  let input: ModelApiInput
  try {
    input = ModelApiInput.parse(await readLimitedJson(request, 4096))
  } catch {
    return Response.json({ error: 'Invalid model API settings.' }, { status: 400 })
  }
  try {
    const result =
      input.action === 'save'
        ? saveModelApiSettings(input)
        : await probeModelApi(input, request.signal)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message =
      error instanceof Error && !(error instanceof SyntaxError) && !('code' in error)
        ? error.message
        : 'Could not read or save the model API settings.'
    return Response.json({ error: message }, { status: 400 })
  }
}
