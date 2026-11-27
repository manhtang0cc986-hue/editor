'use client'

import { usePascalI18n } from '@pascal-app/core'
import { ArrowUpRight, DraftingCompass, FileImage, ImagePlus } from 'lucide-react'
import Image from 'next/image'

type HouseAgentStartersProps = {
  disabled: boolean
  onDraft: (prompt: string) => void
  onOpenStudio: () => void
  onChoosePlan: () => void
  onBuildTemplate: () => void
}

export function HouseAgentStarters({
  disabled,
  onDraft,
  onOpenStudio,
  onChoosePlan,
  onBuildTemplate,
}: HouseAgentStartersProps) {
  const i18n = usePascalI18n()
  const houses = [
    {
      image: '/demos/agent-starters/courtyard.webp',
      title: i18n._({ id: 'app.houseAgent.starters.one', message: 'Single-storey home' }),
      detail: i18n._({
        id: 'app.houseAgent.starters.oneDetail',
        message: 'A courtyard and every room on one level',
      }),
      prompt: i18n._({
        id: 'app.houseAgent.starters.onePrompt',
        message:
          'Plan a single-storey three-bedroom courtyard home with an open living area. Ask about site dimensions and flag any missing measurements before building.',
      }),
    },
    {
      image: '/demos/agent-starters/family.webp',
      title: i18n._({ id: 'app.houseAgent.starters.two', message: 'Two-storey family home' }),
      detail: i18n._({
        id: 'app.houseAgent.starters.twoDetail',
        message: 'Shared rooms below, bedrooms above',
      }),
      prompt: i18n._({
        id: 'app.houseAgent.starters.twoPrompt',
        message:
          'Plan a two-storey family home with living and dining on the ground floor, three bedrooms upstairs, and a central stair. Ask about site dimensions and flag any missing measurements before building.',
      }),
    },
    {
      image: '/demos/agent-starters/townhouse.webp',
      title: i18n._({ id: 'app.houseAgent.starters.three', message: 'Three-storey townhouse' }),
      detail: i18n._({
        id: 'app.houseAgent.starters.threeDetail',
        message: 'A narrow footprint and a compact stair',
      }),
      prompt: i18n._({
        id: 'app.houseAgent.starters.threePrompt',
        message:
          'Plan a compact three-storey townhouse for a narrow lot. Show how the stair connects all levels and how each level gets daylight. Ask about lot dimensions and flag any missing measurements before building.',
      }),
    },
  ]
  const tasks = [
    {
      title: i18n._({
        id: 'app.houseAgent.empty.card.bedroomTitle',
        message: 'Add a master bedroom',
      }),
      prompt: i18n._({
        id: 'app.houseAgent.empty.card.bedroomPrompt',
        message:
          'Add a 4.5m x 4m master bedroom with en-suite bathroom, double bed, wardrobe, and south-facing window.',
      }),
    },
    {
      title: i18n._({ id: 'app.houseAgent.empty.card.kitchenTitle', message: 'Design a kitchen' }),
      prompt: i18n._({
        id: 'app.houseAgent.empty.card.kitchenPrompt',
        message:
          'Design an L-shaped modern kitchen with island counter, sink, refrigerator, and dining nook.',
      }),
    },
    {
      title: i18n._({
        id: 'app.houseAgent.empty.card.livingTitle',
        message: 'Create a living room',
      }),
      prompt: i18n._({
        id: 'app.houseAgent.empty.card.livingPrompt',
        message:
          'Create a bright 6m x 5m living room with L-sofa, coffee table, TV wall, and floor-to-ceiling windows.',
      }),
    },
  ]
  return (
    <div className="space-y-4 text-xs text-zinc-300">
      <div className="relative isolate overflow-hidden rounded-2xl border border-sky-300/15 bg-linear-to-br from-sky-500/15 via-sky-950/30 to-zinc-950 p-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-3 right-5 -z-10 grid size-20 rotate-12 place-items-center rounded-3xl border border-white/10 text-sky-200/15"
        >
          <DraftingCompass size={36} strokeWidth={1} />
        </div>
        <span className="grid size-8 place-items-center rounded-lg bg-sky-400/15 text-sky-200">
          <DraftingCompass size={17} />
        </span>
        <h3 className="mt-2 font-semibold text-xl tracking-tight text-white">
          {i18n._({ id: 'app.houseAgent.starters.heading', message: 'Start a building plan' })}
        </h3>
        <p className="mt-1 max-w-[85%] leading-5 text-zinc-400">
          {i18n._({
            id: 'app.houseAgent.starters.description',
            message: 'Use a reference, attach a floor plan, or describe what you want to build.',
          })}
        </p>
      </div>
      <div className="space-y-2">
        {houses.map((house) => (
          <button
            key={house.image}
            type="button"
            disabled={disabled}
            onClick={() => onDraft(house.prompt)}
            className="group flex min-h-[4.75rem] w-full items-stretch overflow-hidden rounded-xl border border-white/10 bg-white/[0.035] text-left hover:border-sky-300/35 hover:bg-sky-400/[0.06] disabled:opacity-50"
          >
            <span className="relative w-[38%] max-w-36 shrink-0 overflow-hidden bg-sky-950">
              <Image
                src={house.image}
                alt=""
                fill
                sizes="144px"
                unoptimized
                className="object-cover transition-transform motion-safe:group-hover:scale-105"
              />
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2">
              <span className="flex-1">
                <span className="block font-semibold text-zinc-100">{house.title}</span>
                <span className="mt-1 block text-[11px] leading-4 text-zinc-400">
                  {house.detail}
                </span>
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-sky-300" />
            </span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onChoosePlan}
          className="flex flex-col items-start gap-1.5 rounded-xl border border-white/10 p-2.5 text-left hover:bg-white/5 disabled:opacity-50"
        >
          <FileImage className="size-4 text-sky-300" />
          <span className="font-semibold text-zinc-100">
            {i18n._({ id: 'app.houseAgent.starters.attachPlan', message: 'Attach a floor plan' })}
          </span>
          <span className="text-[11px] text-zinc-400">
            {i18n._({ id: 'app.houseAgent.starters.formats', message: 'PNG, JPEG or WebP' })}
          </span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenStudio}
          className="flex flex-col items-start gap-1.5 rounded-xl border border-white/10 p-2.5 text-left hover:bg-white/5 disabled:opacity-50"
        >
          <ImagePlus className="size-4 text-sky-300" />
          <span className="font-semibold text-zinc-100">
            {i18n._({
              id: 'app.houseAgent.starters.exploreImage',
              message: 'Explore a design image',
            })}
          </span>
          <span className="text-[11px] text-zinc-400">
            {i18n._({ id: 'app.houseAgent.starters.studio', message: 'Open Image Studio' })}
          </span>
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tasks.map((task) => (
          <button
            key={task.title}
            type="button"
            disabled={disabled}
            onClick={() => onDraft(task.prompt)}
            className="rounded-lg bg-white/5 px-2 py-1.5 text-[11px] hover:bg-white/10 disabled:opacity-50"
          >
            {task.title}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onBuildTemplate}
        className="text-left text-[11px] text-zinc-400 underline-offset-4 hover:text-white hover:underline disabled:opacity-50"
      >
        {i18n._({
          id: 'app.houseAgent.starters.loadTemplate',
          message: 'Load the sample villa into this scene',
        })}
      </button>
    </div>
  )
}
