import { expect, test } from 'bun:test'
import type { AgentStreamEvent, HousePlan } from './house-agent-protocol'
import { agentStep, agentStepStream, splitThinkTags } from './house-agent-server'

test('splitThinkTags separates inline thinking blocks from visible content', () => {
  const result = splitThinkTags('<think>Check wall thickness 0.24 m.</think>\nHere is the plan.')
  expect(result.reasoning).toBe('Check wall thickness 0.24 m.')
  expect(result.content).toBe('Here is the plan.')
})

test('agentStep preserves reasoning_content for multi-turn tool-calling models', async () => {
  let capturedBody: Record<string, unknown> | null = null
  const assistant = await agentStep(
    [
      { role: 'user', content: 'Analyze floorplan' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'First inspect scene levels.',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'list_levels', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"levels":[]}' },
    ],
    'plan',
    new AbortController().signal,
    {
      PASCAL_AGENT_API_KEY: 'test-key',
      PASCAL_AGENT_MODEL: 'deepseek-reasoner',
      PASCAL_AGENT_REASONING_EFFORT: 'high',
    } as unknown as NodeJS.ProcessEnv,
    async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Plan ready.',
                reasoning_content: 'Verified 0 existing levels.',
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    },
  )

  expect(assistant.reasoning_content).toBe('Verified 0 existing levels.')
  expect(assistant.content).toBe('Plan ready.')
  expect(capturedBody?.reasoning_effort).toBe('high')
  const sentMessages = capturedBody?.messages as Array<Record<string, unknown>>
  expect(sentMessages[2]?.reasoning_content).toBe('First inspect scene levels.')
})

test('agentStepStream emits reasoning_delta, content_delta, <think> blocks, and tool calls', async () => {
  const sseChunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"Scale check: "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"<think>3000mm = 3m</think>Room is 3x4m."}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"verify_scene","arguments":"{}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ]
  const events: AgentStreamEvent[] = []
  const assistant = await agentStepStream(
    [{ role: 'user', content: 'Check plan' }],
    'plan',
    new AbortController().signal,
    (event) => events.push(event),
    {
      PASCAL_AGENT_API_KEY: 'test-key',
      PASCAL_AGENT_MODEL: 'reasoner-vl',
    } as unknown as NodeJS.ProcessEnv,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of sseChunks) {
              controller.enqueue(new TextEncoder().encode(chunk))
            }
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  )

  expect(
    events
      .filter((e) => e.type === 'reasoning_delta')
      .map((e) => e.delta)
      .join(''),
  ).toBe('Scale check: 3000mm = 3m')
  expect(
    events
      .filter((e) => e.type === 'content_delta')
      .map((e) => e.delta)
      .join(''),
  ).toBe('Room is 3x4m.')
  expect(assistant.reasoning_content).toBe('Scale check: 3000mm = 3m')
  expect(assistant.content).toBe('Room is 3x4m.')
  expect(assistant.tool_calls?.[0]?.function.name).toBe('verify_scene')
})

export const samplePlanFixture: HousePlan = {
  title: 'Test Plan',
  summary: '1-bedroom layout',
  scaleAndUnits: {
    drawingUnit: 'mm',
    dimensionBasis: 'wall_centerline',
    calibrationBasis: 'Outer width 6000mm',
    storeyHeightMeters: 2.8,
    exteriorWallThicknessMeters: 0.24,
    interiorWallThicknessMeters: 0.12,
  },
  dimensions: [{ label: 'Living room width', valueMeters: 4.2, source: 'measured' }],
  rooms: [
    {
      name: 'Living Room',
      level: 'Level 0',
      polygonMeters: [
        [0, 0],
        [4.2, 0],
        [4.2, 3.6],
        [0, 3.6],
      ],
      areaSqM: 15.12,
    },
  ],
  constructionSteps: ['Create Living Room'],
  openQuestions: [],
}

test('keeps provider reasoning effort independent of plan mode', async () => {
  await agentStep(
    [{ role: 'user', content: 'Plan a two-storey home.' }],
    'plan',
    AbortSignal.timeout(2_000),
    { PASCAL_AGENT_API_KEY: 'test-key', PASCAL_AGENT_MODEL: 'design-model' },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.reasoning_effort).toBe('xhigh')
      expect(body.messages[0].content).toContain('Plan only.')
      expect(body.messages[1].content).toBe('Plan a two-storey home.')
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'Plan ready.' } }],
      })
    },
    { reasoningEffort: 'xhigh' },
  )
})

test('a direct house brief defaults to the complete workflow without requiring plan approval', async () => {
  const brief = '建一栋带两个卧室的小房子。'
  await agentStep(
    [{ role: 'user', content: brief }],
    'build',
    AbortSignal.timeout(2_000),
    { PASCAL_AGENT_API_KEY: 'test-key', PASCAL_AGENT_MODEL: 'design-model' },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.messages[0].content).toContain('call add_level first')
      expect(body.messages[0].content).toContain('Group independent rooms')
      expect(body.messages[0].content).toContain('Verify with verify_scene after the last edit')
      expect(body.messages[0].content).toContain('furnishing, room materials, and finishes')
      expect(body.messages[0].content).toContain('wait for its result')
      expect(body.messages[1].content).toBe(brief)
      expect(
        body.tools.map(({ function: { name } }: { function: { name: string } }) => name),
      ).toContain('create_room')
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'Ready.' } }],
      })
    },
  )
})
