import { hydrateProcessEnvFromFile, maskSecret } from '@/lib/house-agent-env'
import { handleImageGenPost, imageConfiguration } from '@/lib/house-agent-image'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  hydrateProcessEnvFromFile()
  return Response.json(
    {
      ...imageConfiguration(),
      maskedApiKey: maskSecret(process.env.PASCAL_IMAGE_API_KEY),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export function POST(request: Request) {
  hydrateProcessEnvFromFile()
  return handleImageGenPost(request)
}
