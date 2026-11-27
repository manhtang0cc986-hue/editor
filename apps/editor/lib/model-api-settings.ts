import { z } from 'zod'

export const MODEL_API_URL = '/api/model-api'
export const MODEL_API_CHANGED = 'pascal:model-api-changed'
export const ModelApiTarget = z.enum(['agent', 'image', 'video', 'mesh'])
export type ModelApiTarget = z.infer<typeof ModelApiTarget>
export type ModelApiSettings = {
  baseUrl: string
  model: string
  hasKey: boolean
  imageMode?: 'auto' | 'images' | 'chat'
}
export type ModelApiSnapshot = Record<ModelApiTarget, ModelApiSettings>
export type ModelApiCandidate = { id: string; owner?: string }
export type ModelApiProbe = {
  status: number
  durationMs: number
  models: ModelApiCandidate[]
  selectedModelListed?: boolean
  credits?: number
}

export const ModelApiInput = z
  .object({
    target: ModelApiTarget,
    action: z.enum(['save', 'discover', 'test']),
    baseUrl: z.string().trim().max(500).optional(),
    model: z.string().trim().max(200).optional(),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[^\r\n]+$/)
      .optional(),
    imageMode: z.enum(['auto', 'images', 'chat']).optional(),
  })
  .strict()
export type ModelApiInput = z.infer<typeof ModelApiInput>
