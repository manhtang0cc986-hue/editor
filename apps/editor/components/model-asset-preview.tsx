'use client'

import { usePascalI18n } from '@pascal-app/core'
import { Bounds } from '@react-three/drei/core/Bounds'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { OrbitControls } from '@react-three/drei/core/OrbitControls'
import { Canvas } from '@react-three/fiber'
import { Component, type ReactNode, Suspense, useEffect, useMemo } from 'react'
import { Box3, Vector3 } from 'three'

type Vector = [number, number, number]
export type ModelBounds = { dimensions: Vector; offset: Vector }

class PreviewBoundary extends Component<
  { children: ReactNode; onError?: () => void; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError?.()
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function PreviewScene({ url, onBounds }: { url: string; onBounds: (bounds: ModelBounds) => void }) {
  const i18n = usePascalI18n()
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
  const fallback = (
    <p className="p-3 text-muted-foreground">
      {i18n._({ id: 'app.modelAssets.previewUnavailable', message: '3D preview unavailable.' })}
    </p>
  )
  return (
    <PreviewBoundary fallback={fallback}>
      <Canvas camera={{ position: [3, 2, 4], fov: 38 }} dpr={[1, 1.5]} fallback={fallback}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[4, 7, 5]} intensity={2} />
        <OrbitControls makeDefault />
        <Bounds fit clip observe margin={1.25}>
          <primitive object={scene} />
        </Bounds>
      </Canvas>
    </PreviewBoundary>
  )
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
  useEffect(() => () => useGLTF.clear(url), [url])

  return (
    <div className="h-48 overflow-hidden rounded-lg border border-border bg-background">
      <PreviewBoundary key={url} onError={onError}>
        <Suspense fallback={null}>
          <PreviewScene url={url} onBounds={onBounds} />
        </Suspense>
      </PreviewBoundary>
    </div>
  )
}
