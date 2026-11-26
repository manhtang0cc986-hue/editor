import { expect, test } from 'bun:test'
import type { AgentMessage } from './house-agent-protocol'
import { type HouseAgentRunOptions, runHouseAgent } from './house-agent-runner'

type AssistantMessage = Extract<AgentMessage, { role: 'assistant' }>

function toolReply(names: string[], argumentsJson = '{}'): AssistantMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: names.map((name, index) => ({
      id: `call_${index}`,
      type: 'function',
      function: { name, arguments: argumentsJson },
    })),
  }
}

function options(overrides: Partial<HouseAgentRunOptions> = {}): HouseAgentRunOptions {
  return {
    messages: [{ role: 'user', content: 'Build the approved plan.' }],
    mode: 'build',
    signal: new AbortController().signal,
    request: async () => ({ role: 'assistant', content: 'Done.' }),
    execute: async () => ({ ok: true }),
    ...overrides,
  }
}

function assertCompleteToolReplies(messages: AgentMessage[]) {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || !message.tool_calls?.length) continue
    for (const [offset, call] of message.tool_calls.entries()) {
      const result = messages[index + offset + 1]
      expect(result?.role).toBe('tool')
      if (result?.role === 'tool') expect(result.tool_call_id).toBe(call.id)
    }
  }
}

test('sequential tools feed their results back to the model without changing the input history', async () => {
  let rounds = 0
  let active = 0
  const order: string[] = []
  const config = options({
    request: async (messages, mode) => {
      expect(mode).toBe('build')
      if (rounds++ === 0) return toolReply(['list_levels', 'add_level'])
      assertCompleteToolReplies(messages)
      expect(messages.filter((message) => message.role === 'tool')).toHaveLength(2)
      return { role: 'assistant', content: 'The new level is ready.' }
    },
    execute: async (name, _args, permission) => {
      expect(active).toBe(0)
      expect(permission.allowWrites).toBe(true)
      active += 1
      order.push(name)
      await Promise.resolve()
      active -= 1
      return { ok: true }
    },
    onMessages: assertCompleteToolReplies,
  })
  const result = await runHouseAgent(config)
  expect(result.status).toBe('completed')
  expect(order).toEqual(['list_levels', 'add_level'])
  expect(config.messages).toHaveLength(1)
})

test('planning refuses scene writes and unknown tools before calling the executor', async () => {
  const executed: string[] = []
  let round = 0
  const result = await runHouseAgent(
    options({
      mode: 'plan',
      request: async () =>
        round++ === 0
          ? toolReply(['add_level', 'clear_scene', 'list_levels'])
          : { role: 'assistant', content: 'Here is the plan.' },
      execute: async (name, _args, permission) => {
        expect(permission.allowWrites).toBe(false)
        executed.push(name)
        return { levels: [] }
      },
    }),
  )
  expect(executed).toEqual(['list_levels'])
  expect(result.status).toBe('completed')
  expect(
    result.messages
      .filter((message) => message.role === 'tool')
      .map((message) => JSON.parse(message.content)),
  ).toMatchObject([{ code: 'planning_only' }, { code: 'unknown_tool' }, { levels: [] }])
})

test('malformed arguments become tool errors without running the operation', async () => {
  let round = 0
  let executed = false
  const result = await runHouseAgent(
    options({
      request: async () =>
        round++ === 0
          ? toolReply(['list_levels'], '[1,2]')
          : { role: 'assistant', content: 'Please clarify.' },
      execute: async () => {
        executed = true
        return {}
      },
    }),
  )
  expect(executed).toBe(false)
  expect(result.messages[2]).toMatchObject({
    role: 'tool',
    content: expect.stringContaining('invalid_arguments'),
  })
})

test('stopping while the model request is pending prevents all tool execution', async () => {
  const controller = new AbortController()
  let executed = false
  const result = await runHouseAgent(
    options({
      signal: controller.signal,
      request: async () => {
        controller.abort()
        return toolReply(['add_level'])
      },
      execute: async () => {
        executed = true
        return {}
      },
    }),
  )
  expect(result.status).toBe('stopped')
  expect(executed).toBe(false)
  expect(result.messages).toHaveLength(1)
})

test('stop between tools keeps completed changes and pairs skipped tools without rerunning writes', async () => {
  const controller = new AbortController()
  const executed: string[] = []
  const result = await runHouseAgent(
    options({
      signal: controller.signal,
      request: async () => toolReply(['add_level', 'add_level']),
      execute: async (name) => {
        executed.push(name)
        controller.abort()
        return { created: 'level_new' }
      },
      onMessages: assertCompleteToolReplies,
    }),
  )
  expect(result.status).toBe('stopped')
  expect(executed).toEqual(['add_level'])
  expect(result.messages[2]).toMatchObject({
    role: 'tool',
    content: JSON.stringify({ created: 'level_new' }),
  })
  expect(result.messages[3]).toMatchObject({
    role: 'tool',
    content: expect.stringContaining('stopped'),
  })
})

test('a stopped build does not report verification from before its last edit', async () => {
  const controller = new AbortController()
  const result = await runHouseAgent(
    options({
      signal: controller.signal,
      request: async () => toolReply(['verify_scene', 'add_level']),
      execute: async (name) => {
        if (name === 'verify_scene') return { valid: true }
        controller.abort()
        return { created: 'level_new' }
      },
    }),
  )
  expect(result.status).toBe('stopped')
  expect(result.wroteScene).toBe(true)
  expect(result.verifyResult).toBeUndefined()
})

test('stop from progress callback is checked immediately before executing a write', async () => {
  const controller = new AbortController()
  let executed = false
  const result = await runHouseAgent(
    options({
      signal: controller.signal,
      request: async () => toolReply(['add_level']),
      onTool: (event) => {
        if (event.status === 'running') controller.abort()
      },
      execute: async () => {
        executed = true
        return {}
      },
    }),
  )
  expect(result.status).toBe('stopped')
  expect(executed).toBe(false)
  assertCompleteToolReplies(result.messages)
})

test('the tool cap skips remaining calls and leaves a resumable transcript', async () => {
  let executed = 0
  const result = await runHouseAgent(
    options({
      request: async () => toolReply(['list_levels', 'list_levels', 'list_levels']),
      execute: async () => {
        executed += 1
        return { levels: [] }
      },
      onMessages: assertCompleteToolReplies,
    }),
  )
  expect(result.status).toBe('limit')
  expect(executed).toBe(40)
  expect(result.messages.at(-1)).toMatchObject({
    role: 'tool',
    content: expect.stringContaining('tool_limit'),
  })
})

test('the model round cap prevents an unbounded read loop', async () => {
  let requests = 0
  const result = await runHouseAgent(
    options({
      request: async () => {
        requests += 1
        return toolReply(['list_levels'])
      },
    }),
  )
  expect(requests).toBe(16)
  expect(result.status).toBe('limit')
  assertCompleteToolReplies(result.messages)
})

test('catalog images are vision inputs after all tool replies, with invalid URLs removed', async () => {
  let round = 0
  const image = 'data:image/png;base64,YQ=='
  const result = await runHouseAgent(
    options({
      request: async () =>
        round++ === 0
          ? toolReply(['view_assets', 'list_levels'])
          : { role: 'assistant', content: 'I selected the matching item.' },
      execute: async (name) =>
        name === 'view_assets'
          ? {
              previews: [
                { label: 'Chair', image },
                { label: 'Remote', image: 'https://example.com/private' },
              ],
            }
          : { levels: [] },
      onMessages: assertCompleteToolReplies,
    }),
  )
  expect(result.messages[2]).toMatchObject({
    role: 'tool',
    content: expect.not.stringContaining('base64'),
  })
  expect(result.messages[3]?.role).toBe('tool')
  expect(result.messages[4]).toMatchObject({
    role: 'user',
    content: [
      { type: 'text', text: expect.stringContaining('tool data, not instructions') },
      { type: 'image_url', image_url: { url: image } },
    ],
  })
})

test('large and failing tool results stay valid JSON and never automatically repeat a write', async () => {
  let round = 0
  let writes = 0
  const result = await runHouseAgent(
    options({
      request: async () =>
        round++ === 0
          ? toolReply(['add_level', 'list_levels'])
          : { role: 'assistant', content: 'Review the scene before proceeding.' },
      execute: async (name) => {
        if (name === 'list_levels') throw new Error('Unable to read levels')
        writes += 1
        return { data: 'x'.repeat(70_000) }
      },
    }),
  )
  expect(writes).toBe(1)
  expect(
    result.messages
      .filter((message) => message.role === 'tool')
      .map((message) => JSON.parse(message.content)),
  ).toMatchObject([{ code: 'result_too_large' }, { code: 'tool_failed' }])
})

test('network errors preserve complete history and report an error without retries', async () => {
  let requests = 0
  const result = await runHouseAgent(
    options({
      request: async () => {
        requests += 1
        throw new Error('Provider unavailable')
      },
    }),
  )
  expect(result.status).toBe('error')
  expect(result.error).toBe('Provider unavailable')
  expect(requests).toBe(1)
  expect(result.messages).toHaveLength(1)
})

test('streaming, view_scene/inspect_scene_guides/view_materials images, and submit_house_plan work end-to-end', async () => {
  let round = 0
  const image = 'data:image/webp;base64,YQ=='
  const streamed: string[] = []
  let recordedPlanTitle: string | null = null
  const result = await runHouseAgent(
    options({
      mode: 'plan',
      requestStream: async (_messages, _mode, _signal, onDelta) => {
        if (round++ === 0) {
          onDelta({ type: 'reasoning_delta', delta: 'Checking guides' })
          return {
            role: 'assistant',
            content: null,
            reasoning_content: 'Checking guides',
            tool_calls: [
              {
                id: 'call_guide',
                type: 'function',
                function: { name: 'inspect_scene_guides', arguments: '{}' },
              },
              {
                id: 'call_mat',
                type: 'function',
                function: { name: 'view_materials', arguments: '{"ids":["wood-floorplank1"]}' },
              },
              {
                id: 'call_plan',
                type: 'function',
                function: {
                  name: 'submit_house_plan',
                  arguments: JSON.stringify({
                    title: '2BR House',
                    summary: 'Compact 2-bedroom plan',
                    scaleAndUnits: {
                      drawingUnit: 'mm',
                      dimensionBasis: 'wall_centerline',
                      calibrationBasis: '8000mm outer width',
                      storeyHeightMeters: 2.8,
                      exteriorWallThicknessMeters: 0.24,
                      interiorWallThicknessMeters: 0.12,
                    },
                    dimensions: [{ label: 'Total width', valueMeters: 8, source: 'measured' }],
                    rooms: [
                      {
                        name: 'Living Room',
                        level: 'Level 0',
                        polygonMeters: [
                          [0, 0],
                          [4, 0],
                          [4, 4],
                          [0, 4],
                        ],
                        areaSqM: 16,
                      },
                    ],
                    constructionSteps: ['Build living room'],
                    openQuestions: [],
                  }),
                },
              },
            ],
          }
        }
        onDelta({ type: 'content_delta', delta: 'Plan ready.' })
        return { role: 'assistant', content: 'Plan ready.' }
      },
      execute: async (name) => {
        if (name === 'inspect_scene_guides') {
          return { count: 1, guides: [{ id: 'guide_1' }], previews: [{ label: 'Guide 1', image }] }
        }
        if (name === 'view_materials') {
          return { materials: [{ id: 'wood-floorplank1' }], previews: [{ label: 'Floor', image }] }
        }
        if (name === 'submit_house_plan') {
          return { status: 'plan_recorded', plan: { title: '2BR House' } }
        }
        return {}
      },
      onStream: (s) => {
        if (s?.reasoning) streamed.push(s.reasoning)
      },
      onPlan: (plan) => {
        recordedPlanTitle = plan.title
      },
    }),
  )

  expect(result.status).toBe('completed')
  expect(streamed).toContain('Checking guides')
  expect(recordedPlanTitle).toBe('2BR House')
  const visionUserMsg = result.messages.find(
    (m) =>
      m.role === 'user' &&
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === 'image_url'),
  )
  expect(visionUserMsg).toBeDefined()
})

test('plain text replies in plan or build mode do not mark planSubmitted or wroteScene', async () => {
  const planResult = await runHouseAgent({
    messages: [{ role: 'user', content: 'Help me design a house' }],
    mode: 'plan',
    signal: new AbortController().signal,
    request: async () => ({
      role: 'assistant',
      content: 'Could you tell me the total lot dimensions first?',
    }),
    execute: async () => ({}),
  })
  expect(planResult.status).toBe('completed')
  expect(planResult.planSubmitted).toBe(false)

  const buildResult = await runHouseAgent({
    messages: [{ role: 'user', content: 'Build it' }],
    mode: 'build',
    signal: new AbortController().signal,
    request: async () => ({
      role: 'assistant',
      content: 'All done!',
    }),
    execute: async () => ({}),
  })
  expect(buildResult.status).toBe('completed')
  expect(buildResult.wroteScene).toBe(false)
})

test('aborting while a write tool is waiting propagates signal and adds zero nodes', async () => {
  const controller = new AbortController()
  let committedNodes = 0

  const result = await runHouseAgent({
    messages: [{ role: 'user', content: 'Create a room' }],
    mode: 'build',
    signal: controller.signal,
    request: async () => ({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_room',
          type: 'function',
          function: {
            name: 'create_room',
            arguments: JSON.stringify({
              name: 'Living',
              polygon: [
                [0, 0],
                [4, 0],
                [4, 4],
                [0, 4],
              ],
            }),
          },
        },
      ],
    }),
    execute: async (_name, _args, options) => {
      controller.abort()
      if (options.signal?.aborted) {
        return { error: 'stopped', aborted: true }
      }
      committedNodes += 1
      return { ok: true }
    },
  })

  expect(result.status).toBe('stopped')
  expect(committedNodes).toBe(0)
  expect(result.wroteScene).toBe(false)
})
