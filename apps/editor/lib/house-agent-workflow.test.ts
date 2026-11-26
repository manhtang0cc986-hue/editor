import { expect, test } from 'bun:test'
import { activityGroups, selectionContext } from './house-agent-workflow'

test('selection attaches live ids and active level while excluding stale selection', () => {
  const nodes = {
    wall_a: { type: 'wall', name: 'Kitchen wall' },
    zone_a: { type: 'zone', name: 'Kitchen' },
  }
  const first = selectionContext(nodes, {
    levelId: 'level_ground',
    zoneId: 'zone_a',
    selectedIds: ['wall_a', 'missing', 'zone_a'],
  })
  expect(first.selected.map((node) => node.id)).toEqual(['wall_a', 'zone_a'])
  expect(first.activeLevelId).toBe('level_ground')
  const next = selectionContext(nodes, { levelId: 'level_upper', zoneId: null, selectedIds: [] })
  expect(next).toEqual({ activeLevelId: 'level_upper', selected: [] })
})

test('activity preserves phase order including a return to construction after inspection', () => {
  const groups = activityGroups([
    {
      id: '1',
      name: 'create_room',
      status: 'completed',
      result: { achieved: { created: { wall: 4, zone: 1 } } },
    },
    {
      id: '2',
      name: 'create_room',
      status: 'error',
      result: { achieved: { created: { wall: 99 } } },
    },
    { id: '3', name: 'verify_scene', status: 'completed' },
    { id: '4', name: 'create_roof', status: 'running' },
    {
      id: '5',
      name: 'place_items',
      status: 'completed',
      result: { achieved: { created: { item: 2 } } },
    },
  ])
  expect(groups.map((group) => group.phase)).toEqual(['structure', 'check', 'structure', 'furnish'])
  expect(groups[0]?.created).toEqual({ wall: 4, zone: 1 })
  expect(groups[2]?.created).toEqual({})
})
