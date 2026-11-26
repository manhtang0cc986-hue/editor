import { expect, mock, test } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { executeHouseAgentTool } from './house-agent-executor'
import { runHouseAgent } from './house-agent-runner'

test('a single brief can build and check an editable house without loading the asset catalog', async () => {
  const previousScene = useScene.getState()
  const previousHistory = useScene.temporal.getState()
  const previousFetch = globalThis.fetch
  const fetchCatalog = mock(async () => Response.json({ items: {}, materials: {} }))
  globalThis.fetch = Object.assign(fetchCatalog, { preconnect: previousFetch.preconnect })
  useScene.getState().unloadScene()
  let round = 0
  const operations: string[] = []
  let levelId: string | undefined
  const batches = [
    [{ name: 'add_level', input: { name: 'Ground floor', height: 3 } }],
    [
      {
        name: 'create_room',
        input: {
          name: 'Living room',
          polygon: [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
          doors: [{ wallIndex: 0 }, { wallIndex: 1 }],
          windows: [{ wallIndex: 3 }],
        },
      },
      {
        name: 'create_room',
        input: {
          name: 'Bedroom',
          polygon: [
            [4, 0],
            [8, 0],
            [8, 4],
            [4, 4],
          ],
          windows: [{ wallIndex: 1 }],
        },
      },
    ],
    [{ name: 'create_roof', input: {} }],
  ]

  try {
    const result = await runHouseAgent({
      messages: [{ role: 'user', content: '建一栋带客厅、卧室和屋顶的单层小房子。' }],
      mode: 'build',
      signal: new AbortController().signal,
      request: async () => {
        const batch = batches[round++]
        return batch
          ? {
              role: 'assistant',
              content: null,
              tool_calls: batch.map(({ name, input }, index) => ({
                id: `call_${round}_${index}`,
                type: 'function',
                function: {
                  name,
                  arguments: JSON.stringify({ ...input, ...(levelId ? { levelId } : {}) }),
                },
              })),
            }
          : { role: 'assistant', content: '已完成单层房屋。' }
      },
      execute: async (name, args, options) => {
        operations.push(name)
        const output = await executeHouseAgentTool(name, args, options)
        if (name === 'add_level' && typeof output.levelId === 'string') levelId = output.levelId
        return output
      },
    })
    expect(result.status).toBe('completed')
    expect(result.wroteScene).toBe(true)
    expect(operations).toEqual([
      'add_level',
      'create_room',
      'create_room',
      'create_roof',
      'verify_scene',
    ])
    expect(fetchCatalog).not.toHaveBeenCalled()
    const kinds = Object.values(useScene.getState().nodes).map(({ type }) => type)
    expect(kinds.filter((type) => type === 'zone')).toHaveLength(2)
    expect(kinds.filter((type) => type === 'wall')).toHaveLength(7)
    expect(kinds.filter((type) => type === 'door')).toHaveLength(2)
    expect(kinds.filter((type) => type === 'window')).toHaveLength(2)
    expect(kinds).toContain('roof')
    expect(result.verifyResult).toBeDefined()
  } finally {
    useScene.setState(previousScene)
    useScene.temporal.setState(previousHistory)
    globalThis.fetch = previousFetch
  }
})
