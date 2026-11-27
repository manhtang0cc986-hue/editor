'use client'

import { usePascalI18n } from '@pascal-app/core'
import { Bot, Check, DraftingCompass, Layers3, RefreshCw, Settings2, X } from 'lucide-react'
import { houseAgentModelBrand } from '@/lib/house-agent-model-brand'
import type {
  AgentReasoningEffort,
  DetectedModelItem,
  HouseBuildStage,
} from '@/lib/house-agent-protocol'

export type HouseAgentModelTab = 'architect' | 'models'

type HouseAgentArchitectPopoverProps = {
  tab: HouseAgentModelTab
  effort: AgentReasoningEffort
  currentModel: string
  detectedModels: DetectedModelItem[]
  scanned: boolean
  loading: boolean
  scanError: string
  canScan: boolean
  onTabChange: (tab: HouseAgentModelTab) => void
  onSelectEffort: (effort: AgentReasoningEffort) => void
  onSelectModel: (model: DetectedModelItem) => void
  onScan: () => void
  onOpenSettings: () => void
  onClose: () => void
}

const UNKNOWN_MODEL_EFFORTS = ['auto', 'low', 'medium', 'high'] as const

export function HouseAgentModelLogo({
  modelId,
  owner,
  compact = false,
}: {
  modelId: string
  owner?: string
  compact?: boolean
}) {
  const brand = houseAgentModelBrand(modelId, owner)
  return (
    <span
      aria-hidden="true"
      className={
        compact
          ? 'grid size-4 shrink-0 place-items-center'
          : 'grid size-7 shrink-0 place-items-center rounded-md bg-white/5'
      }
    >
      {brand ? (
        <img
          alt=""
          width={compact ? 14 : 16}
          height={compact ? 14 : 16}
          src={`/model-logos/${brand.icon}.svg`}
          className={brand.invert ? 'invert' : undefined}
        />
      ) : (
        <Bot size={compact ? 14 : 16} className="text-zinc-400" />
      )}
    </span>
  )
}

export function modelEfforts(
  model?: DetectedModelItem,
  currentEffort: AgentReasoningEffort = 'auto',
): readonly AgentReasoningEffort[] {
  if (model?.reasoningEfforts) return ['auto', ...model.reasoningEfforts]
  const defaults: readonly AgentReasoningEffort[] = UNKNOWN_MODEL_EFFORTS
  return defaults.includes(currentEffort) ? defaults : [...defaults, currentEffort]
}

export function useHouseAgentModelLabels() {
  const i18n = usePascalI18n()
  return {
    stages: {
      layout: i18n._({ id: 'app.houseAgent.scope.layout', message: 'Layout' }),
      structure: i18n._({ id: 'app.houseAgent.scope.structure', message: 'Structure' }),
      interiors: i18n._({ id: 'app.houseAgent.scope.interiors', message: 'Interiors' }),
      review: i18n._({ id: 'app.houseAgent.scope.review', message: 'Full review' }),
    } satisfies Record<HouseBuildStage, string>,
    effort: {
      auto: i18n._({ id: 'app.houseAgent.effort.auto', message: 'Auto' }),
      none: i18n._({ id: 'app.houseAgent.effort.none', message: 'None' }),
      minimal: i18n._({ id: 'app.houseAgent.effort.minimal', message: 'Minimal' }),
      low: i18n._({ id: 'app.houseAgent.effort.low', message: 'Low' }),
      medium: i18n._({ id: 'app.houseAgent.effort.medium', message: 'Medium' }),
      high: i18n._({ id: 'app.houseAgent.effort.high', message: 'High' }),
      xhigh: i18n._({ id: 'app.houseAgent.effort.xhigh', message: 'Extra high' }),
      max: i18n._({ id: 'app.houseAgent.effort.max', message: 'Max' }),
    } satisfies Record<AgentReasoningEffort, string>,
  }
}

export function HouseAgentArchitectPopover({
  tab,
  effort,
  currentModel,
  detectedModels,
  scanned,
  loading,
  scanError,
  canScan,
  onTabChange,
  onSelectEffort,
  onSelectModel,
  onScan,
  onOpenSettings,
  onClose,
}: HouseAgentArchitectPopoverProps) {
  const i18n = usePascalI18n()
  const labels = useHouseAgentModelLabels()
  const selectedModel = detectedModels.find((model) => model.id === currentModel)
  const efforts = modelEfforts(selectedModel, effort)
  const selectedEffort = efforts.includes(effort) ? effort : 'auto'
  const scopes = [
    {
      id: 'layout',
      description: i18n._({
        id: 'app.houseAgent.scope.layoutDescription',
        message: 'Storeys, room layout, circulation and primary openings.',
      }),
    },
    {
      id: 'structure',
      description: i18n._({
        id: 'app.houseAgent.scope.structureDescription',
        message: 'Develops the layout with floors, stairs and the roof where needed.',
      }),
    },
    {
      id: 'interiors',
      description: i18n._({
        id: 'app.houseAgent.scope.interiorsDescription',
        message: 'Includes furnishing, materials and room finishes.',
      }),
    },
    {
      id: 'review',
      description: i18n._({
        id: 'app.houseAgent.scope.reviewDescription',
        message:
          'Cross-checks dimensions, circulation and clearance, and reports unresolved items.',
      }),
    },
  ] as const

  return (
    <section
      role="dialog"
      aria-label={i18n._({
        id: 'app.houseAgent.modelPicker.title',
        message: 'Agent model and build scope',
      })}
      className="absolute inset-x-0 bottom-full z-40 mb-2 flex max-h-[min(62dvh,34rem)] flex-col overflow-y-auto rounded-2xl border border-sky-200/15 bg-zinc-950 text-xs text-zinc-100 shadow-xl"
    >
      <div className="sticky top-0 z-10 flex gap-1 border-white/10 border-b bg-zinc-950 p-2">
        <button
          type="button"
          aria-pressed={tab === 'architect'}
          onClick={() => onTabChange('architect')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-zinc-400 hover:bg-white/5 aria-pressed:bg-sky-300/15 aria-pressed:text-sky-100"
        >
          <DraftingCompass size={14} />
          {i18n._({ id: 'app.houseAgent.architect.tabArchitect', message: 'Architect' })}
        </button>
        <button
          type="button"
          aria-pressed={tab === 'models'}
          onClick={() => onTabChange('models')}
          className="flex-1 rounded-lg px-2 py-2 text-zinc-400 hover:bg-white/5 aria-pressed:bg-sky-300/15 aria-pressed:text-sky-100"
        >
          {i18n._({ id: 'app.houseAgent.architect.tabOther', message: 'Other models' })}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={i18n._({
            id: 'app.houseAgent.modelPicker.close',
            message: 'Close model picker',
          })}
          className="rounded-lg px-1.5 text-zinc-400 hover:bg-white/10"
        >
          <X size={15} />
        </button>
      </div>
      {tab === 'architect' ? (
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-3 rounded-xl border border-sky-300/20 bg-sky-950/35 p-3">
            <Layers3 size={23} className="shrink-0 text-sky-300" />
            <div className="min-w-0">
              <h4 className="font-semibold">
                {i18n._({ id: 'app.houseAgent.plan.stepsTitle', message: 'Construction sequence' })}
              </h4>
              {currentModel && (
                <p className="mt-1 flex items-center gap-1.5 break-all text-zinc-400">
                  <HouseAgentModelLogo
                    modelId={currentModel}
                    owner={selectedModel?.ownedBy}
                    compact
                  />
                  {currentModel}
                </p>
              )}
            </div>
          </div>
          <ol
            aria-label={i18n._({ id: 'app.houseAgent.scope.title', message: 'Build scope' })}
            className="space-y-1"
          >
            {scopes.map((scope, index) => (
              <li key={scope.id} className="flex items-start gap-3 rounded-lg bg-white/5 p-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sky-300/10 font-mono text-sky-200">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{labels.stages[scope.id]}</p>
                  <p className="mt-0.5 leading-4 text-zinc-400">{scope.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold">
                {i18n._({
                  id: 'app.houseAgent.modelPicker.available',
                  message: 'Detected chat models',
                })}
              </h4>
              <button
                type="button"
                onClick={canScan ? onScan : onOpenSettings}
                disabled={loading}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-2 py-1.5 text-zinc-300 hover:bg-white/10 disabled:opacity-50"
              >
                {canScan ? <RefreshCw size={13} /> : <Settings2 size={13} />}
                {loading
                  ? i18n._({ id: 'app.houseAgent.settings.detecting', message: 'Detecting…' })
                  : canScan
                    ? i18n._({ id: 'app.houseAgent.settings.detect', message: 'Detect' })
                    : i18n._({
                        id: 'app.houseAgent.modelPicker.settings',
                        message: 'API settings',
                      })}
              </button>
            </div>
            {scanError && (
              <p role="alert" className="text-rose-300">
                {scanError}
              </p>
            )}
            {detectedModels.length > 0 ? (
              <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                {detectedModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    aria-pressed={currentModel === model.id}
                    onClick={() => onSelectModel(model)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5 aria-pressed:bg-sky-300/15"
                  >
                    <HouseAgentModelLogo modelId={model.id} owner={model.ownedBy} />
                    <span className="min-w-0 flex-1 break-all">
                      <span className="block">{model.id}</span>
                      {model.ownedBy && (
                        <span className="block text-zinc-400">{model.ownedBy}</span>
                      )}
                    </span>
                    {currentModel === model.id && (
                      <Check size={15} className="shrink-0 text-sky-300" />
                    )}
                  </button>
                ))}
              </div>
            ) : !loading && !scanError ? (
              <p className="leading-5 text-zinc-400">
                {scanned
                  ? i18n._({
                      id: 'app.houseAgent.modelPicker.empty',
                      message: 'The configured API returned no chat models.',
                    })
                  : i18n._({
                      id: 'app.houseAgent.modelPicker.scanFirst',
                      message: 'Scan your configured API to list its chat models.',
                    })}
              </p>
            ) : null}
          </div>
          {currentModel && (
            <div className="space-y-2 border-white/10 border-t bg-white/[0.025] p-3">
              {selectedModel === undefined && (
                <p className="flex items-center gap-2 break-all text-zinc-300">
                  <HouseAgentModelLogo modelId={currentModel} compact />
                  {currentModel}
                </p>
              )}
              <label className="block font-semibold">
                {i18n._({
                  id: 'app.houseAgent.settings.reasoningEffort',
                  message: 'Reasoning effort',
                })}
                {efforts.length > 1 && (
                  <input
                    type="range"
                    min={0}
                    max={efforts.length - 1}
                    step={1}
                    value={efforts.indexOf(selectedEffort)}
                    aria-valuetext={labels.effort[selectedEffort]}
                    onChange={(event) => {
                      const nextEffort = efforts[event.currentTarget.valueAsNumber]
                      if (nextEffort) onSelectEffort(nextEffort)
                    }}
                    className="mt-2 block w-full accent-sky-400"
                  />
                )}
              </label>
              <div className="flex flex-wrap gap-1">
                {efforts.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selectedEffort === option}
                    onClick={() => onSelectEffort(option)}
                    className="rounded-md px-1.5 py-1 text-zinc-400 hover:bg-white/5 aria-pressed:bg-sky-300/15 aria-pressed:text-sky-100"
                  >
                    {labels.effort[option]}
                  </button>
                ))}
              </div>
              {selectedModel?.reasoningEfforts === undefined && (
                <p className="text-zinc-400">
                  {i18n._({
                    id: 'app.houseAgent.modelPicker.noMetadata',
                    message:
                      'The provider does not list supported reasoning levels. Auto uses its default.',
                  })}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
