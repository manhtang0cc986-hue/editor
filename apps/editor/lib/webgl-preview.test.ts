import { expect, mock, test } from 'bun:test'
import { canCreateWebGLPreviewContext, type WebGLPreviewProbeCanvas } from './webgl-preview'

test('returns false when no canvas is available', () => {
  expect(canCreateWebGLPreviewContext(() => null)).toBe(false)
})

test('returns false when both webgl2 and webgl return null', () => {
  const getContext = mock(() => null)
  const canvas: WebGLPreviewProbeCanvas = { getContext }

  expect(canCreateWebGLPreviewContext(() => canvas)).toBe(false)
  expect(getContext).toHaveBeenCalledTimes(2)
  expect(getContext).toHaveBeenNthCalledWith(1, 'webgl2')
  expect(getContext).toHaveBeenNthCalledWith(2, 'webgl')
})

test('returns false when context probing throws', () => {
  const canvas: WebGLPreviewProbeCanvas = {
    getContext: () => {
      throw new Error('BindToCurrentSequence failed')
    },
  }

  expect(canCreateWebGLPreviewContext(() => canvas)).toBe(false)
})

test('falls back from webgl2 to webgl and releases the temporary probe context', () => {
  const loseContext = mock(() => undefined)
  const getContext = mock((id: 'webgl2' | 'webgl') =>
    id === 'webgl'
      ? {
          getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
        }
      : null,
  )

  expect(canCreateWebGLPreviewContext(() => ({ getContext }))).toBe(true)
  expect(loseContext).toHaveBeenCalledTimes(1)
})
