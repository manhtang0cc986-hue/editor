import { describe, expect, test } from 'bun:test'
import { captureEphemeralViewport } from './house-agent-executor'

describe('house-agent-executor', () => {
  test('captureEphemeralViewport aborts immediately when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(captureEphemeralViewport({ signal: controller.signal })).rejects.toThrow(/取消/)
  })

  test('captureEphemeralViewport fails fast when no 3D WebGL canvas exists in DOM', async () => {
    const prevDocument = globalThis.document
    globalThis.document = {
      visibilityState: 'visible',
      querySelector: () => null,
    } as unknown as Document

    const started = performance.now()
    try {
      await expect(captureEphemeralViewport()).rejects.toThrow(/WebGL/)
      expect(performance.now() - started).toBeLessThan(1000)
    } finally {
      globalThis.document = prevDocument
    }
  })
})
