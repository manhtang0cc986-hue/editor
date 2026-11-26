import { describe, expect, test } from 'bun:test'
import { emitter, type ThumbnailGenerateEvent } from '@pascal-app/core'
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

  test('captureEphemeralViewport discards a screenshot cancelled during encoding', async () => {
    const controller = new AbortController()
    const previousWindow = globalThis.window
    globalThis.window = { setTimeout, clearTimeout } as unknown as Window & typeof globalThis
    const onGenerate = ({ requestId }: ThumbnailGenerateEvent) => {
      if (!requestId) return
      const blob = new Blob(['image'], { type: 'image/png' })
      const arrayBuffer = blob.arrayBuffer.bind(blob)
      blob.arrayBuffer = () => {
        controller.abort()
        return arrayBuffer()
      }
      emitter.emit('snapshot:captured', { requestId, blob, width: 1, height: 1 })
    }
    emitter.on('camera-controls:generate-thumbnail', onGenerate)
    try {
      await expect(captureEphemeralViewport({ signal: controller.signal })).rejects.toThrow(/取消/)
    } finally {
      emitter.off('camera-controls:generate-thumbnail', onGenerate)
      globalThis.window = previousWindow
    }
  })
})
