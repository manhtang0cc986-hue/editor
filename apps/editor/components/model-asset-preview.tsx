'use client'

import { Bounds } from '@react-three/drei/core/Bounds'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { OrbitControls } from '@react-three/drei/core/OrbitControls'
import { Canvas } from '@react-three/fiber'
import { Component, type ReactNode, Suspense, useEffect, useMemo, useState } from 'react'
import { Box3, Vector3 } from 'three'
import { canCreateWebGLPreviewContext } from '@/lib/webgl-preview'

type Vector = [number, number, number]
export type ModelBounds = { dimensions: Vector; offset: Vector }

class PreviewBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function PreviewScene({ url, onBounds }: { url: string; onBounds: (bounds: ModelBounds) => void }) {
  const { scene } = useGLTF(url, false)
  const bounds = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    if (box.isEmpty() || Math.min(size.x, size.y, size.z) <= 0) {
      throw new Error('The mesh has no usable 3D dimensions.')
    }
    return {
      dimensions: size.toArray(),
      offset: [-center.x, -box.min.y, -center.z] as Vector,
    }
  }, [scene])

  useEffect(() => onBounds(bounds), [bounds, onBounds])
  return <primitive object={scene} />
}

export function ModelAssetPreview({
  url,
  onBounds,
  onError,
}: {
  url: string
  onBounds: (bounds: ModelBounds) => void
  onError: () => void
}) {
  const [webglReady, setWebglReady] = useState<boolean | null>(null)

  useEffect(() => () => useGLTF.clear(url), [url])

  useEffect(() => {
    if (!url) return
    const supported = canCreateWebGLPreviewContext()
    setWebglReady(supported)
    if (!supported) {
      onError()
    }
  }, [onError, url])

  if (webglReady === false) return null
  if (webglReady === null) {
    return <div className="h-48 overflow-hidden rounded-lg border border-border bg-background" />
  }

  return (
    <div className="h-48 overflow-hidden rounded-lg border border-border bg-background">
      <PreviewBoundary key={url} onError={onError}>
        <Canvas camera={{ position: [3, 2, 4], fov: 38 }} dpr={[1, 1.5]}>
          <ambientLight intensity={1.2} />
          <directionalLight position={[4, 7, 5]} intensity={2} />
          <OrbitControls makeDefault />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.25}>
              <PreviewScene url={url} onBounds={onBounds} />
            </Bounds>
          </Suspense>
        </Canvas>
      </PreviewBoundary>
    </div>
  )
}
