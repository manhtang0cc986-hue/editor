import type { AnyNode } from '@pascal-app/core'
import type { HouseAgentToolEvent } from './house-agent-runner'

export type BuildPhase = 'inspect' | 'structure' | 'furnish' | 'finish' | 'check'
export function toolPhase(name: string): BuildPhase {
  if (name === 'verify_scene' || name === 'view_scene') return 'check'
  if (/^(place_items|furnish_room|place_in_room)$/.test(name)) return 'furnish'
  if (name === 'paint' || name === 'generate_design_image') return 'finish'
  if (/^(get_|list_|find_|search_|view_|inspect_|submit_)/.test(name)) return 'inspect'
  return 'structure'
}

export function activityGroups(events: HouseAgentToolEvent[]) {
  const groups: {
    phase: BuildPhase
    events: HouseAgentToolEvent[]
    created: Record<string, number>
  }[] = []
  for (const event of events) {
    const phase = toolPhase(event.name)
    let group = groups.at(-1)
    if (!group || group.phase !== phase) {
      group = { phase, events: [], created: {} }
      groups.push(group)
    }
    group.events.push(event)
    if (event.status !== 'completed') continue
    const achieved = event.result?.achieved as { created?: Record<string, unknown> } | undefined
    for (const [kind, count] of Object.entries(achieved?.created ?? {})) {
      if (typeof count === 'number' && Number.isSafeInteger(count) && count > 0)
        group.created[kind] = (group.created[kind] ?? 0) + count
    }
  }
  return groups
}

export function selectionContext(
  nodes: Readonly<Record<string, { type: string; name?: string }>>,
  selection: { levelId: string | null; zoneId: string | null; selectedIds: readonly string[] },
) {
  return {
    activeLevelId: selection.levelId,
    selected: [
      ...new Set([...selection.selectedIds, ...(selection.zoneId ? [selection.zoneId] : [])]),
    ]
      .slice(0, 20)
      .flatMap((id) =>
        nodes[id] ? [{ id, type: nodes[id].type, name: nodes[id].name?.slice(0, 100) }] : [],
      ),
  }
}

export function houseAgentSceneContext(
  nodes: Readonly<Record<string, AnyNode>>,
  selection: Parameters<typeof selectionContext>[1],
) {
  const levels = []
  let buildingCount = 0
  let wallCount = 0
  let roomCount = 0
  let guideCount = 0
  for (const node of Object.values(nodes)) {
    switch (node.type) {
      case 'level':
        levels.push({
          id: node.id,
          buildingId: node.parentId,
          name: node.name?.slice(0, 100),
          index: node.level,
          height: node.height,
        })
        break
      case 'building':
        buildingCount += 1
        break
      case 'wall':
        wallCount += 1
        break
      case 'zone':
        roomCount += 1
        break
      case 'guide':
        guideCount += 1
        break
    }
  }
  return {
    ...selectionContext(nodes, selection),
    buildingCount,
    levelCount: levels.length,
    levels: levels.slice(0, 20),
    wallCount,
    roomCount,
    guideCount,
  }
}
