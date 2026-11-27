import { MAX_MODEL_BYTES, ModelAssetForm, readModelBytes } from '@/lib/model-assets'
import { listModelAssets, saveModelAsset } from '@/lib/model-assets-store'
import { guardSceneApiRequest } from '@/lib/scene-api-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const blocked = guardSceneApiRequest(request)
  if (blocked) return blocked
  return Response.json(await listModelAssets(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const blocked = guardSceneApiRequest(request)
  if (blocked) return blocked
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json({ error: 'Origin not allowed.' }, { status: 403 })

  try {
    const metadata = ModelAssetForm.parse(
      JSON.parse(decodeURIComponent(request.headers.get('x-model-metadata') ?? '')),
    )
    return Response.json(
      await saveModelAsset(await readModelBytes(request, MAX_MODEL_BYTES), metadata),
    )
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not save the model.' },
      { status: 400 },
    )
  }
}
