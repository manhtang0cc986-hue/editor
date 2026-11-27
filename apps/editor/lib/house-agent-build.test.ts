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
  const plan = {
    title: 'Single-storey home',
    summary: 'An 8 by 4 metre home with a living room and bedroom.',
    scaleAndUnits: {
      drawingUnit: 'm',
      dimensionBasis: 'external_overall',
      calibrationBasis: 'Proposed dimensions',
      storeyHeightMeters: 3,
      exteriorWallThicknessMeters: 0.24,
      interiorWallThicknessMeters: 0.12,
    },
    dimensions: [],
    rooms: [
      {
        name: 'Living room',
        level: 'Ground floor',
        polygonMeters: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        areaSqM: 16,
      },
    ],
    constructionSteps: ['Build the ground floor', 'Add a roof'],
    openQuestions: [],
    automation: {
      intent: 'build',
      buildingType: 'Ordinary house',
      widthMeters: 8,
      depthMeters: 4,
      heightMeters: 4.5,
      levels: [{ name: 'Ground floor', heightMeters: 3, furniture: ['Living room: sofa'] }],
      phases: [
        { title: 'Structure', level: 'Ground floor', tasks: ['Create the rooms'] },
        { title: 'Roof', level: 'Ground floor', tasks: ['Add the roof'] },
      ],
    },
  }
  const batches: { name: string; input: Record<string, unknown> }[][] = [
    [{ name: 'add_level', input: {} }],
    [{ name: 'submit_house_plan', input: plan }],
    [
      { name: 'add_level', input: {} },
      { name: 'read_house_plan', input: {} },
    ],
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
    [
      { name: 'complete_house_phase', input: { phaseNumber: 1, result: 'Rooms created' } },
      { name: 'get_level_summary', input: {} },
      {
        name: 'complete_house_phase',
        input: { phaseNumber: 1, result: 'Both room zones present' },
      },
    ],
    [
      { name: 'read_house_plan', input: {} },
      { name: 'create_roof', input: {} },
    ],
    [
      { name: 'verify_scene', input: {} },
      { name: 'complete_house_phase', input: { phaseNumber: 2, result: 'Roof verified' } },
    ],
  ]

  try {
    const result = await runHouseAgent({
      messages: [{ role: 'user', content: '建一栋带客厅、卧室和屋顶的单层小房子。' }],
      mode: 'build',
      managedBuild: true,
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
    expect(result.planSubmitted).toBe(true)
    expect(
      result.messages
        .flatMap((message) => (message.role === 'tool' ? [JSON.parse(message.content).code] : []))
        .filter(Boolean),
    ).toEqual(['plan_phase_required', 'plan_phase_required', 'phase_not_checked'])
    expect(operations).toEqual([
      'add_level',
      'create_room',
      'create_room',
      'get_level_summary',
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

    const before = useScene.getState().nodes
    const window = Object.values(before).find((node) => node.type === 'window')
    const ground = Object.values(before).find((node) => node.id === levelId)
    if (!window || !ground) throw new Error('Expected a window and the ground floor')
    const sill = window.position[1] - window.height / 2
    const repair = {
      ...plan,
      title: 'Window sill repair',
      summary: 'Move one window sill upward by 0.1 m.',
      automation: {
        ...plan.automation,
        intent: 'repair',
        repairBefore: `The selected window sill is at ${sill} m.`,
        phases: [
          { title: 'Adjust sill', level: 'Ground floor', tasks: ['Raise the selected window'] },
        ],
      },
    }
    const repairBatches = [
      [{ name: 'submit_house_plan', input: repair }],
      [
        { name: 'get_node', input: { id: window.id } },
        { name: 'submit_house_plan', input: repair },
      ],
      [
        { name: 'read_house_plan', input: {} },
        { name: 'place_building', input: {} },
        { name: 'delete_node', input: { id: ground.id } },
        {
          name: 'run_batch',
          input: { calls: [{ tool: 'delete_node', input: { id: ground.id } }] },
        },
        { name: 'move_node', input: { id: window.id, by: [0, 0], y: sill + 0.1 } },
      ],
      [
        { name: 'verify_scene', input: {} },
        { name: 'complete_house_phase', input: { phaseNumber: 1, result: 'Checked the new sill' } },
      ],
    ]
    let repairRound = 0
    const repaired = await runHouseAgent({
      messages: [...result.messages, { role: 'user', content: '把这扇窗的窗台抬高 10 厘米。' }],
      mode: 'build',
      managedBuild: true,
      nodeType: (id) =>
        Object.values(useScene.getState().nodes).find((node) => node.id === id)?.type,
      signal: new AbortController().signal,
      request: async () => {
        const batch = repairBatches[repairRound++]
        return batch
          ? {
              role: 'assistant',
              content: null,
              tool_calls: batch.map(({ name, input }, index) => ({
                id: `repair_${repairRound}_${index}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(input) },
              })),
            }
          : { role: 'assistant', content: '已抬高窗台。' }
      },
      execute: executeHouseAgentTool,
    })
    expect(repaired.status).toBe('completed')
    expect(
      repaired.messages
        .slice(result.messages.length)
        .flatMap((message) => (message.role === 'tool' ? [JSON.parse(message.content).code] : []))
        .filter(Boolean),
    ).toEqual(['incomplete_build_plan', 'repair_scope', 'repair_scope', 'repair_scope'])
    const after = useScene.getState().nodes
    const repairedWindow = after[window.id]
    expect(repairedWindow?.type === 'window' && repairedWindow.position[1]).toBeCloseTo(
      window.position[1] + 0.1,
    )
    expect(Object.keys(after)).toEqual(Object.keys(before))
    for (const node of Object.values(before)) {
      if (node.id !== window.id) expect(after[node.id]).toEqual(node)
    }
  } finally {
    useScene.setState(previousScene)
    useScene.temporal.setState(previousHistory)
    globalThis.fetch = previousFetch
  }
})
