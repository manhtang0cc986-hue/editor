import { hydrateProcessEnvFromFile, maskSecret } from '@/lib/house-agent-env'
import { agentConfiguration, handleAgentPost } from '@/lib/house-agent-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  hydrateProcessEnvFromFile()
  return Response.json(
    {
      ...agentConfiguration(),
      maskedApiKey: maskSecret(process.env.PASCAL_AGENT_API_KEY),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export function POST(request: Request) {
  hydrateProcessEnvFromFile()
  return handleAgentPost(request)
}
