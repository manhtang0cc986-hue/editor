type ProbeContext = {
  getExtension?: (name: string) => { loseContext?: () => void } | null
}

export type WebGLPreviewProbeCanvas = {
  getContext: (contextId: 'webgl2' | 'webgl') => ProbeContext | null
}

function defaultProbeCanvas(): WebGLPreviewProbeCanvas | null {
  if (typeof document === 'undefined') return null
  return document.createElement('canvas') as unknown as WebGLPreviewProbeCanvas
}

/**
 * Probes whether a WebGL context can be created before mounting R3F's default
 * THREE.WebGLRenderer, which attaches a `webglcontextcreationerror` listener that
 * logs `console.error` even when caught by an error boundary.
 */
export function canCreateWebGLPreviewContext(
  createCanvas: () => WebGLPreviewProbeCanvas | null = defaultProbeCanvas,
): boolean {
  try {
    const canvas = createCanvas()
    if (!canvas) return false
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!context) return false
    try {
      context.getExtension?.('WEBGL_lose_context')?.loseContext?.()
    } catch {
      // Best-effort release of the probe context slot.
    }
    return true
  } catch {
    return false
  }
}
