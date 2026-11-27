import { z } from 'zod'

export const MAX_AGENT_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_AGENT_IMAGES = 8
export const MAX_AGENT_REQUEST_BYTES = 48 * 1024 * 1024

export const AgentImage = z
  .string()
  .max(Math.ceil((MAX_AGENT_IMAGE_BYTES * 4) / 3) + 64)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)

export const AgentReasoningEffortSchema = z.enum([
  'auto',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
export type AgentReasoningEffort = z.infer<typeof AgentReasoningEffortSchema>

export const HouseBuildStageSchema = z.enum(['layout', 'structure', 'interiors', 'review'])
export type HouseBuildStage = z.infer<typeof HouseBuildStageSchema>

export type DetectedModelItem = {
  id: string
  ownedBy?: string
  kind: 'chat' | 'image' | 'other'
  reasoningEfforts?: AgentReasoningEffort[]
}

export const AgentToolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(100_000) }),
})

const part = z.union([
  z.object({ type: z.literal('text'), text: z.string().max(40_000) }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({ url: AgentImage, detail: z.enum(['auto', 'high', 'low']).optional() }),
  }),
])

export const AgentAssistantSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().max(150_000).nullable(),
  /** Reasoning / thinking trace captured from reasoning_content, reasoning, or <think> tags. */
  reasoning_content: z.string().max(200_000).nullable().optional(),
  tool_calls: z.array(AgentToolCallSchema).max(16).optional(),
})

export const AgentMessageSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('user'),
    content: z.union([
      z.string().min(1).max(40_000),
      z
        .array(part)
        .min(1)
        .max(16)
        .refine((parts) => parts.filter((p) => p.type === 'image_url').length <= MAX_AGENT_IMAGES),
    ]),
  }),
  AgentAssistantSchema,
  z.object({
    role: z.literal('tool'),
    content: z.string().max(150_000),
    tool_call_id: z.string().max(200),
  }),
])

export const AgentClientConfigSchema = z
  .object({
    baseUrl: z.string().min(1).max(500).optional(),
    model: z.string().min(1).max(200).optional(),
    apiKey: z.string().min(1).max(500).optional(),
    reasoningEffort: AgentReasoningEffortSchema.optional(),
  })
  .optional()

export const ImageGenModeSchema = z.enum(['auto', 'images', 'chat'])
export type ImageGenMode = z.infer<typeof ImageGenModeSchema>

export const ImageGenSizeSchema = z.enum(['1024x1024', '1536x1024', '1024x1536'])
export type ImageGenSize = z.infer<typeof ImageGenSizeSchema>

export const ImageGenPresetSchema = z.enum(['exterior', 'floorplan', 'interior', 'courtyard'])
export type ImageGenPreset = z.infer<typeof ImageGenPresetSchema>

export const ImageClientConfigSchema = z
  .object({
    baseUrl: z.string().min(1).max(500).optional(),
    model: z.string().min(1).max(200).optional(),
    apiKey: z.string().min(1).max(500).optional(),
    mode: ImageGenModeSchema.optional(),
  })
  .optional()

export const ImageGenRequestSchema = z.object({
  prompt: z.string().min(1).max(12_000),
  preset: ImageGenPresetSchema.optional(),
  size: ImageGenSizeSchema.optional(),
  referenceImage: AgentImage.optional(),
  config: ImageClientConfigSchema,
})

export type ImageClientConfig = z.infer<typeof ImageClientConfigSchema>
export type ImageGenRequest = z.infer<typeof ImageGenRequestSchema>
export type ImageConfiguration = {
  configured: boolean
  model: string | null
  baseUrl: string
  mode: ImageGenMode
  source: 'env' | 'none'
  maskedApiKey?: string | null
}

export const AgentRequestSchema = z.object({
  messages: z.array(AgentMessageSchema).min(1).max(240),
  mode: z.enum(['plan', 'build']),
  stream: z.boolean().optional(),
  config: AgentClientConfigSchema,
})

export const DimensionSourceSchema = z.enum(['measured', 'inferred', 'assumed', 'proposed'])

export const HousePlanDimensionSchema = z.object({
  label: z.string().min(1).max(120),
  valueMeters: z.number().finite(),
  originalText: z.string().max(80).optional(),
  source: DimensionSourceSchema,
  note: z.string().max(240).optional(),
})

export const HousePlanOpeningSchema = z.object({
  kind: z.enum(['door', 'window']),
  wallIndex: z.number().int().min(0),
  t: z.number().min(0).max(1),
  widthMeters: z.number().positive(),
  heightMeters: z.number().positive(),
  sillHeightMeters: z.number().min(0).optional(),
  style: z.string().max(60).optional(),
  note: z.string().max(200).optional(),
})

export const HousePlanRoomSchema = z.object({
  name: z.string().min(1).max(80),
  level: z.string().min(1).max(60),
  polygonMeters: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3),
  areaSqM: z.number().nonnegative(),
  wallThicknessMeters: z.number().positive().optional(),
  floorMaterial: z.string().max(120).optional(),
  wallMaterial: z.string().max(120).optional(),
  openings: z.array(HousePlanOpeningSchema).max(24).optional(),
  assetIds: z.array(z.string().max(80)).max(32).optional(),
})

export const HouseAutomationSchema = z.object({
  intent: z.enum(['build', 'repair']),
  buildingType: z.string().trim().min(1).max(100),
  widthMeters: z.number().positive(),
  depthMeters: z.number().positive(),
  heightMeters: z.number().positive(),
  levels: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        heightMeters: z.number().positive(),
        furniture: z.array(z.string().min(1).max(160)).max(40),
      }),
    )
    .min(1)
    .max(80),
  phases: z
    .array(
      z.object({
        stage: HouseBuildStageSchema.optional(),
        title: z.string().min(1).max(120),
        level: z.string().min(1).max(80),
        tasks: z.array(z.string().min(1).max(240)).min(1).max(12),
      }),
    )
    .min(1)
    .max(20),
  repairBefore: z.string().trim().min(1).max(4000).optional(),
})

export const HousePlanProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  checks: z.array(z.string().max(600)).max(20),
})

export type HousePlanProgress = z.infer<typeof HousePlanProgressSchema>

export const HousePlanSchema = z.object({
  automation: HouseAutomationSchema.optional(),
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(1000),
  scaleAndUnits: z.object({
    drawingUnit: z.string().min(1).max(40),
    dimensionBasis: z.enum(['internal_clear', 'wall_centerline', 'external_overall', 'mixed']),
    calibrationBasis: z.string().min(1).max(300),
    orientationNote: z.string().max(240).optional(),
    storeyHeightMeters: z.number().positive(),
    exteriorWallThicknessMeters: z.number().positive(),
    interiorWallThicknessMeters: z.number().positive(),
  }),
  dimensions: z.array(HousePlanDimensionSchema).max(80),
  rooms: z.array(HousePlanRoomSchema).min(1).max(40),
  constructionSteps: z.array(z.string().min(1).max(240)).min(1).max(30),
  openQuestions: z.array(z.string().min(1).max(300)).max(20),
})

export type AgentMessage = z.infer<typeof AgentMessageSchema>
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>
export type AgentClientConfig = z.infer<typeof AgentClientConfigSchema>
export type AgentMode = 'plan' | 'build'
export type HousePlan = z.infer<typeof HousePlanSchema>

export type AgentConfiguration = {
  configured: boolean
  modelDiscoveryConfigured: boolean
  model: string | null
  baseUrl: string
  reasoningEffort: AgentReasoningEffort
  source: 'env' | 'none'
  maskedApiKey?: string | null
}

export const EnvConfigSaveSchema = z.object({
  agent: z
    .object({
      baseUrl: z.string().trim().max(500).optional(),
      model: z.string().trim().max(200).optional(),
      apiKey: z.string().trim().max(500).optional(),
      reasoningEffort: AgentReasoningEffortSchema.optional(),
    })
    .optional(),
  image: z
    .object({
      baseUrl: z.string().trim().max(500).optional(),
      model: z.string().trim().max(200).optional(),
      apiKey: z.string().trim().max(500).optional(),
      mode: ImageGenModeSchema.optional(),
    })
    .optional(),
})

export type AgentStreamEvent =
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'content_delta'; delta: string }
  | { type: 'assistant'; message: Extract<AgentMessage, { role: 'assistant' }> }
  | { type: 'error'; error: string }
