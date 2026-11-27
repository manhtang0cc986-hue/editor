import { z } from 'zod'

export const MAX_MODEL_BYTES = 32 * 1024 * 1024
export const MAX_REFERENCE_BYTES = 5 * 1024 * 1024
export const MODEL_ASSETS_URL = '/api/model-assets'
export const MODEL_GENERATION_URL = '/api/model-assets/generate'

export const ModelAssetForm = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(['furniture', 'kitchen', 'bathroom', 'appliance', 'outdoor']),
  dimensions: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  scale: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  offset: z.tuple([z.number(), z.number(), z.number()]),
})
export type ModelAssetForm = z.infer<typeof ModelAssetForm>

export function validateModelGlb(bytes: Uint8Array): void {
  if (bytes.length > MAX_MODEL_BYTES) throw new Error('GLB exceeds the 32 MB size limit.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes.length < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a
  ) {
    throw new Error('Upload a valid GLB 2.0 model.')
  }
  const jsonEnd = 20 + view.getUint32(12, true)
  if (jsonEnd > bytes.length || jsonEnd % 4 !== 0) throw new Error('Invalid GLB metadata.')
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, jsonEnd)))
  } catch {
    throw new Error('Invalid GLB metadata.')
  }
  const gltf = z
    .object({
      asset: z.object({ version: z.literal('2.0') }),
      meshes: z.array(z.unknown()).min(1),
      buffers: z.array(z.object({ uri: z.string().optional() })).optional(),
      images: z.array(z.object({ uri: z.string().optional() })).optional(),
    })
    .safeParse(json)
  if (!gltf.success) throw new Error('The GLB must contain a 3D mesh.')
  for (const resource of [...(gltf.data.buffers ?? []), ...(gltf.data.images ?? [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) {
      throw new Error('Export a self-contained GLB with embedded textures and buffers.')
    }
  }
}

export async function readModelBytes(
  source: Request | Response,
  limit: number,
): Promise<Uint8Array> {
  if (Number(source.headers.get('content-length')) > limit)
    throw new Error('The file exceeds the size limit.')
  const reader = source.body?.getReader()
  if (!reader) throw new Error('The file is empty.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('The file exceeds the size limit.')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
