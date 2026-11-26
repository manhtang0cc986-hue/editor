import { expect, test } from 'bun:test'
import { LevelNode, WallNode } from '@pascal-app/core/schema'
import { HOUSE_AGENT_OPERATIONS } from './house-agent-operations'

for (const kind of ['door', 'window'] as const) {
  test(`agent creates a standard ${kind} on a known wall`, () => {
    const level = LevelNode.parse({ id: 'level_test', height: 3, children: ['wall_test'] })
    const wall = WallNode.parse({
      id: 'wall_test',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
      height: 3,
    })
    const outcome = HOUSE_AGENT_OPERATIONS[`add_${kind}`]!(
      { [level.id]: level, [wall.id]: wall },
      { wallId: wall.id, t: 0.5, width: 1, height: kind === 'door' ? 2.1 : 1.2 } as never,
      { activeLevelId: level.id },
    )
    expect(outcome.result.ok).toBe(true)
    expect(outcome.changes?.create?.[0]?.node.type).toBe(kind)
    expect(outcome.changes?.create?.[0]?.parentId).toBe(wall.id)
    expect(wall.children).toEqual([])
  })
}

test('a batch cannot run tools the house agent does not offer', () => {
  const outcome = HOUSE_AGENT_OPERATIONS.run_batch!(
    {},
    { calls: [{ tool: 'add_object', input: { code: 'unavailable' } }] } as never,
    { activeLevelId: null },
  )
  expect(outcome.result.error).toContain('not available')
  expect(outcome.changes).toBeUndefined()
})

test('scripted openings refuse explicitly instead of silently creating a standard door', () => {
  const outcome = HOUSE_AGENT_OPERATIONS.add_door!({}, { code: 'unsupported' } as never, {
    activeLevelId: null,
  })
  expect(outcome.result.error).toContain('not supported')
  expect(outcome.changes).toBeUndefined()
})
