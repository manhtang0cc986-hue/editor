import { AGENT_TOOL_CONTRACTS, type AgentToolContract } from '@pascal-app/core/agent-tools'
import { z } from 'zod'
import { HousePlanSchema, ImageGenPresetSchema, ImageGenSizeSchema } from './house-agent-protocol'

const READ_TOOLS = new Set([
  'list_levels',
  'get_site',
  'get_node',
  'get_level_summary',
  'get_walls',
  'get_zones',
  'find_by_type',
  'list_units',
  'search_assets',
  'view_assets',
  'search_materials',
  'measure_stair',
  'verify_scene',
  'view_scene',
])

const WRITE_TOOLS = new Set([
  'place_building',
  'add_level',
  'duplicate_level',
  'set_ground_level',
  'create_room',
  'add_wall',
  'set_wall_type',
  'add_door',
  'add_window',
  'add_corner_window',
  'merge_windows',
  'create_roof',
  'create_stair',
  'fit_stair',
  'add_column',
  'add_fence',
  'place_items',
  'furnish_room',
  'place_in_room',
  'paint',
  'move_node',
  'duplicate_node',
  'delete_node',
  'create_unit',
  'set_unit_members',
  'run_batch',
])

export const HOST_AGENT_CONTRACTS: readonly AgentToolContract[] = [
  {
    name: 'inspect_scene_guides',
    title: 'Inspect scene blueprint guides',
    description:
      'Read all floor-plan guide images imported onto levels in the current scene, including their calibrated scaleReference (realLengthMeters, metersPerUnit, displayUnit), position, rotation, and scale, and attach the guide images for visual blueprint reading.',
    input: {
      levelId: z
        .string()
        .min(1)
        .optional()
        .describe('Optional level ID to filter guides. Omit to inspect all levels.'),
    },
  },
  {
    name: 'view_materials',
    title: 'View material swatches',
    description:
      'Inspect material library entries by ID or library:<id> ref to view their texture swatch thumbnails, colours, roughness/metalness, and supported surfaces before painting.',
    input: {
      ids: z
        .array(z.string().min(1))
        .min(1)
        .max(8)
        .describe('One to eight material IDs or library:<id> refs returned by search_materials.'),
    },
  },
  {
    name: 'submit_house_plan',
    title: 'Submit structured house plan',
    description:
      'Record a structured architectural reading and construction plan for the user to review before building: scale/units, coordinate origin, measured vs inferred/assumed dimensions, room polygons, doors/windows, selected materials/assets, build steps, and open questions. Does not modify the 3D scene.',
    input: HousePlanSchema.shape,
  },
  {
    name: 'read_house_plan',
    title: 'Read current house plan and next phase',
    description:
      'Read the accepted plan, the previous check, and the next pending phase. Wait for this result before carrying out the phase.',
    input: {},
  },
  {
    name: 'complete_house_phase',
    title: 'Record completed house construction phase',
    description:
      'After reading the live scene inspection result for this phase, record the evidence. Use the one-based phaseNumber from read_house_plan.',
    input: {
      phaseNumber: z.number().int().min(1),
      result: z.string().min(1).max(600),
    },
  },
  {
    name: 'generate_design_image',
    title: 'Generate architectural design image',
    description:
      'Generate an architectural visualization image (exterior villa render, 2D floor plan sketch, interior render, or courtyard concept) using the user-configured image generation model. Optionally captures the current 3D viewport as a visual reference.',
    input: {
      prompt: z
        .string()
        .min(1)
        .max(4000)
        .describe(
          'Detailed architectural visual prompt describing style, layout, massing, materials, lighting, and perspective.',
        ),
      preset: ImageGenPresetSchema.optional().describe(
        'Visual preset: exterior, floorplan, interior, or courtyard.',
      ),
      size: ImageGenSizeSchema.optional().describe(
        'Output aspect/resolution: 1024x1024, 1536x1024, or 1024x1536.',
      ),
      useCurrentViewAsReference: z
        .boolean()
        .optional()
        .describe(
          'If true, captures the current 3D scene viewport as a reference image for image-to-image styling or rendering.',
        ),
    },
  },
]

export type HouseAgentToolEntry = {
  contract: AgentToolContract
  write: boolean
  hostOnly?: boolean
}

// A host policy, independent of plugin-supplied annotation hints.
export const HOUSE_AGENT_TOOLS: HouseAgentToolEntry[] = [
  ...AGENT_TOOL_CONTRACTS.filter(
    (contract) => READ_TOOLS.has(contract.name) || WRITE_TOOLS.has(contract.name),
  ).map((contract) => ({ contract, write: WRITE_TOOLS.has(contract.name) })),
  ...HOST_AGENT_CONTRACTS.map((contract) => ({ contract, write: false, hostOnly: true })),
]
