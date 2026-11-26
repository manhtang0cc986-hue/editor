import { hydrateProcessEnvFromFile, maskSecret, persistHouseAgentEnv } from '@/lib/house-agent-env'
import { imageConfiguration } from '@/lib/house-agent-image'
import { EnvConfigSaveSchema } from '@/lib/house-agent-protocol'
import { agentConfiguration, readLimitedJson } from '@/lib/house-agent-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  hydrateProcessEnvFromFile()
  return Response.json(
    {
      agent: {
        ...agentConfiguration(),
        maskedApiKey: maskSecret(process.env.PASCAL_AGENT_API_KEY),
      },
      image: {
        ...imageConfiguration(),
        maskedApiKey: maskSecret(process.env.PASCAL_IMAGE_API_KEY),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let parsed: ReturnType<typeof EnvConfigSaveSchema.parse>
  try {
    parsed = EnvConfigSaveSchema.parse(await readLimitedJson(request, 16 * 1024))
  } catch {
    return Response.json({ error: '配置参数格式无效。' }, { status: 400 })
  }

  try {
    return Response.json(persistHouseAgentEnv(parsed), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '保存配置失败。' },
      { status: 400 },
    )
  }
}
