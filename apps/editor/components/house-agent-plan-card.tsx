'use client'

import { usePascalI18n } from '@pascal-app/core'
import { AlertTriangle, CheckCircle2, Compass, Layers, Ruler } from 'lucide-react'
import type { HousePlan, HousePlanProgress } from '@/lib/house-agent-protocol'

const SOURCE_STYLE: Record<HousePlan['dimensions'][number]['source'], string> = {
  measured: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  inferred: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  assumed: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  proposed: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
}

export function HouseAgentPlanCard({
  plan,
  progress,
}: {
  plan: HousePlan
  progress?: HousePlanProgress | null
}) {
  const i18n = usePascalI18n()
  const automation = plan.automation

  const sourceLabel = (source: HousePlan['dimensions'][number]['source']) => {
    switch (source) {
      case 'measured':
        return i18n._({ id: 'app.houseAgent.plan.source.measured', message: 'Measured' })
      case 'inferred':
        return i18n._({ id: 'app.houseAgent.plan.source.inferred', message: 'Inferred' })
      case 'assumed':
        return i18n._({ id: 'app.houseAgent.plan.source.assumed', message: 'Assumed' })
      case 'proposed':
        return i18n._({ id: 'app.houseAgent.plan.source.proposed', message: 'Proposed' })
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-sky-500/30 bg-sky-950/20 p-3 text-xs">
      {automation?.repairBefore && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
          <p className="font-medium text-zinc-200">
            {i18n._({ id: 'app.houseAgent.plan.repairBefore', message: 'Before repair' })}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-zinc-300">
            {automation.repairBefore}
          </p>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div>
          {automation?.intent === 'repair' && (
            <p className="mb-1 font-medium text-zinc-300">
              {i18n._({ id: 'app.houseAgent.plan.repairAfter', message: 'Repair plan' })}
            </p>
          )}
          <p className="font-semibold text-sky-200">{plan.title}</p>
          <p className="mt-1 leading-5 text-zinc-300">{plan.summary}</p>
        </div>
        <span className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-200">
          {plan.rooms.length}{' '}
          {i18n._({ id: 'app.houseAgent.plan.roomsCountLabel', message: 'rooms' })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/30 p-2.5 text-[11px]">
        <div className="flex items-center gap-1.5 text-zinc-300">
          <Ruler size={13} className="shrink-0 text-sky-400" />
          <span>
            {i18n._({ id: 'app.houseAgent.plan.unit', message: 'Unit' })}:{' '}
            <strong className="text-white">{plan.scaleAndUnits.drawingUnit}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-300">
          <Layers size={13} className="shrink-0 text-sky-400" />
          <span>
            {i18n._({ id: 'app.houseAgent.plan.storeyHeight', message: 'Height' })}:{' '}
            <strong className="text-white">{plan.scaleAndUnits.storeyHeightMeters} m</strong>
          </span>
        </div>
        <div className="col-span-2 flex items-start gap-1.5 text-zinc-400">
          <Compass size={13} className="mt-0.5 shrink-0 text-sky-400" />
          <span>
            {plan.scaleAndUnits.calibrationBasis}
            {plan.scaleAndUnits.orientationNote ? ` · ${plan.scaleAndUnits.orientationNote}` : ''}
          </span>
        </div>
      </div>

      {automation && (
        <>
          <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
            <p className="font-medium text-white">{automation.buildingType}</p>
            <p className="mt-1 break-words font-mono text-sky-200">
              {automation.widthMeters} × {automation.depthMeters} × {automation.heightMeters} m
            </p>
          </div>
          <details open className="rounded-lg border border-white/10 bg-black/20 p-2">
            <summary className="cursor-pointer font-medium text-zinc-200">
              {i18n._({
                id: 'app.houseAgent.plan.furnitureByLevel',
                message: 'Floors and furniture',
              })}{' '}
              ({automation.levels.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {automation.levels.map((level, index) => (
                <li key={`${level.name}-${index}`} className="rounded bg-white/5 p-2">
                  <p className="font-medium text-white">
                    {level.name} · {level.heightMeters} m
                  </p>
                  {level.furniture.length > 0 && (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-zinc-300">
                      {level.furniture.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
          <details open className="rounded-lg border border-white/10 bg-black/20 p-2">
            <summary className="cursor-pointer font-medium text-zinc-200">
              {i18n._({ id: 'app.houseAgent.plan.stepsTitle', message: 'Construction sequence' })} (
              {progress ? `${progress.completed}/${progress.total}` : automation.phases.length})
            </summary>
            {progress && (
              <progress
                aria-label={i18n._({
                  id: 'app.houseAgent.plan.stepsTitle',
                  message: 'Construction sequence',
                })}
                className="mt-2 h-1 w-full accent-sky-400"
                value={progress.completed}
                max={progress.total}
              />
            )}
            <ol className="mt-2 space-y-2">
              {automation.phases.map((phase, index) => (
                <li key={`${phase.title}-${index}`} className="flex gap-2 rounded bg-white/5 p-2">
                  <span className="shrink-0 pt-0.5 font-mono text-sky-300">
                    {progress && index < progress.completed ? (
                      <CheckCircle2 size={13} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div className="min-w-0 break-words">
                    <p className="font-medium text-white">
                      {phase.level} · {phase.title}
                    </p>
                    <ul className="mt-1 space-y-1 text-zinc-300">
                      {phase.tasks.map((task, index) => (
                        <li key={`${task}-${index}`}>{task}</li>
                      ))}
                    </ul>
                    {progress?.checks[index] && (
                      <p className="mt-2 border-t border-white/10 pt-1.5 text-emerald-200">
                        {progress.checks[index]}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      {plan.dimensions.length > 0 && (
        <details open className="rounded-lg border border-white/10 bg-black/20 p-2">
          <summary className="cursor-pointer font-medium text-zinc-200">
            {i18n._({ id: 'app.houseAgent.plan.dimensionsTitle', message: 'Dimension evidence' })} (
            {plan.dimensions.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {plan.dimensions.map((dim, idx) => (
              <div
                key={`${dim.label}-${idx}`}
                className="flex items-center justify-between gap-2 rounded bg-white/5 px-2 py-1"
              >
                <div className="min-w-0">
                  <p className="truncate text-zinc-200">{dim.label}</p>
                  {(dim.originalText || dim.note) && (
                    <p className="truncate text-[10px] text-zinc-400">
                      {[dim.originalText, dim.note].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="font-mono text-white">{dim.valueMeters} m</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${SOURCE_STYLE[dim.source]}`}
                  >
                    {sourceLabel(dim.source)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <details open className="rounded-lg border border-white/10 bg-black/20 p-2">
        <summary className="cursor-pointer font-medium text-zinc-200">
          {i18n._({ id: 'app.houseAgent.plan.roomsTitle', message: 'Room & opening schedule' })}
        </summary>
        <div className="mt-2 space-y-2">
          {plan.rooms.map((room, idx) => (
            <div
              key={`${room.name}-${idx}`}
              className="rounded-lg border border-white/10 bg-white/5 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-white">
                  {room.name} <span className="text-zinc-400">({room.level})</span>
                </span>
                <span className="font-mono text-sky-300">{room.areaSqM} m²</span>
              </div>
              <p className="mt-1 text-[10px] text-zinc-400">
                {room.floorMaterial ? `${room.floorMaterial}` : ''}
                {room.floorMaterial && room.wallMaterial ? ' · ' : ''}
                {room.wallMaterial ? `${room.wallMaterial}` : ''}
                {room.openings?.length
                  ? ` · ${room.openings.length} ${i18n._({ id: 'app.houseAgent.plan.openingsLabel', message: 'openings' })}`
                  : ''}
              </p>
              {room.assetIds && room.assetIds.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {room.assetIds.map((assetId) => (
                    <span
                      key={assetId}
                      className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                    >
                      {assetId}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </details>

      {!automation && (
        <details className="rounded-lg border border-white/10 bg-black/20 p-2">
          <summary className="cursor-pointer font-medium text-zinc-200">
            {i18n._({ id: 'app.houseAgent.plan.stepsTitle', message: 'Construction sequence' })} (
            {plan.constructionSteps.length})
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-zinc-300">
            {plan.constructionSteps.map((step, idx) => (
              <li key={`step-${idx}`}>{step}</li>
            ))}
          </ol>
        </details>
      )}

      {plan.openQuestions.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-2">
          <p className="flex items-center gap-1.5 font-medium text-amber-200">
            <AlertTriangle size={13} />
            {i18n._({
              id: 'app.houseAgent.plan.questionsTitle',
              message: 'Questions to confirm',
            })}
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] text-amber-100/90">
            {plan.openQuestions.map((question, idx) => (
              <li key={`q-${idx}`}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      {!automation && plan.openQuestions.length === 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
          <CheckCircle2 size={13} />
          {i18n._({
            id: 'app.houseAgent.plan.readyHint',
            message: 'All required dimensions are accounted for and ready to build.',
          })}
        </p>
      )}
    </div>
  )
}
