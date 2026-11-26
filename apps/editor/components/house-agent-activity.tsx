'use client'
import { usePascalI18n } from '@pascal-app/core'
import { CheckCircle2, Circle, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { HouseAgentToolEvent } from '@/lib/house-agent-runner'
import { HOUSE_AGENT_TOOLS } from '@/lib/house-agent-tools'
import { activityGroups } from '@/lib/house-agent-workflow'

export function HouseAgentActivity({ events }: { events: HouseAgentToolEvent[] }) {
  const i18n = usePascalI18n()
  const labels = {
    inspect: i18n._({ id: 'app.houseAgent.phase.inspect', message: 'Read & plan' }),
    structure: i18n._({ id: 'app.houseAgent.phase.structure', message: 'Build structure' }),
    furnish: i18n._({ id: 'app.houseAgent.phase.furnish', message: 'Furnish rooms' }),
    finish: i18n._({ id: 'app.houseAgent.phase.finish', message: 'Apply finishes' }),
    check: i18n._({ id: 'app.houseAgent.phase.check', message: 'Check result' }),
  }
  return (
    <div className="space-y-1 rounded-xl border border-white/10 bg-white/[0.025] p-2">
      {activityGroups(events).map((group) => {
        const running = group.events.some((event) => event.status === 'running')
        const failed = group.events.some((event) => event.status === 'error')
        const complete = group.events.every((event) => event.status === 'completed')
        const Icon = running
          ? LoaderCircle
          : failed
            ? TriangleAlert
            : complete
              ? CheckCircle2
              : Circle
        return (
          <details key={group.events[0]?.id} className="group rounded-lg p-2 open:bg-white/5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
              <Icon
                size={14}
                className={
                  running
                    ? 'animate-spin text-sky-300'
                    : failed
                      ? 'text-amber-300'
                      : 'text-zinc-400'
                }
              />
              <span className="flex-1">{labels[group.phase]}</span>
              <span className="text-zinc-500">
                {group.events.filter((e) => e.status === 'completed').length}/{group.events.length}
              </span>
            </summary>
            {Object.keys(group.created).length > 0 && (
              <p className="mt-1 pl-6 text-[11px] text-zinc-400">
                {Object.entries(group.created)
                  .map(([kind, count]) => `${count} ${kind}`)
                  .join(' · ')}
              </p>
            )}
            {group.events.map((event) => (
              <div key={event.id} className="mt-2 border-white/5 border-t pt-2 text-xs">
                <p>
                  {HOUSE_AGENT_TOOLS.find((entry) => entry.contract.name === event.name)?.contract
                    .title ?? event.name}{' '}
                  · {event.status}
                </p>
                {event.previews?.map((preview) => (
                  <img
                    key={preview.image.slice(-80)}
                    src={preview.image}
                    alt={preview.label}
                    className="mt-2 max-h-40 rounded-lg object-contain"
                  />
                ))}
                {event.result && (
                  <details className="mt-1 text-zinc-500">
                    <summary className="cursor-pointer">
                      {i18n._({ id: 'app.houseAgent.activity.details', message: 'Tool details' })}
                    </summary>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                      {JSON.stringify(
                        event.result,
                        (key, value) => (key === 'previews' ? undefined : value),
                        2,
                      )}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </details>
        )
      })}
    </div>
  )
}
