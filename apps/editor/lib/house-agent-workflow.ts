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
