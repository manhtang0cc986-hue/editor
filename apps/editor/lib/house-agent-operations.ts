import {
  AGENT_OPERATIONS,
  type AgentOperation,
  addWallOpening,
} from '@pascal-app/core/agent-operations'
import { HOUSE_AGENT_TOOLS } from './house-agent-tools'

type OpeningInput = Parameters<typeof addWallOpening>[1] & { code?: string; nodeId?: string }

function openingOperation(kind: 'door' | 'window'): AgentOperation {
  return (nodes, input) => {
    const opening = input as OpeningInput
    if (opening.code || opening.nodeId) {
      return {
        result: {
          error:
            'Scripted opening creation and rebuilding are not supported here. Use standard door/window parameters.',
        },
      }
    }
    return addWallOpening(nodes, { ...opening, kind })
  }
}

export const HOUSE_AGENT_OPERATIONS: Readonly<Record<string, AgentOperation>> = {
  ...AGENT_OPERATIONS,
  add_door: openingOperation('door'),
  add_window: openingOperation('window'),
  run_batch: (nodes, input, context) => {
    const batch = input as { calls: { tool: string }[] }
    const unsupported = batch.calls.find(
      (call) =>
        call.tool === 'run_batch' ||
        !HOUSE_AGENT_TOOLS.some((entry) => entry.contract.name === call.tool && !entry.hostOnly),
    )
    if (unsupported)
      return { result: { error: `Tool not available in this host: ${unsupported.tool}` } }
    return AGENT_OPERATIONS.run_batch(nodes, input, context)
  },
}
