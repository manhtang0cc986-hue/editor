'use client'

import { type AnyNode, emitter, getSceneDocument } from '@pascal-app/core'
import { sceneViewPlan } from '@pascal-app/core/agent-operations'
import { captureEphemeralViewport, executeViewScene } from './house-agent-executor'

export type CapturableRoom = {
  id: string
  name: string
  levelId: string | null
  levelName: string | null
}

export type PlannedRoomShot = {
  id: string
  label: string
  category: 'exterior' | 'plan' | 'room'
  zoneId?: string
  args: Record<string, unknown>
}

export type CapturedRoomPhoto = {
  id: string
  label: string
  category: 'exterior' | 'plan' | 'room'
  zoneId?: string
  imageDataUrl: string
  width?: number
  height?: number
}

export type Recorded3DVideo = {
  id: string
  videoUrl: string
  mimeType: string
  filename: string
  durationMs: number
  mode: 'auto-orbit' | 'free'
}

export function listCapturableRooms(nodes: Readonly<Record<string, AnyNode>>): CapturableRoom[] {
  const rooms: CapturableRoom[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone') continue
    const level = node.parentId ? nodes[node.parentId] : undefined
    rooms.push({
      id: node.id,
      name: node.name || 'Room',
      levelId: node.parentId ?? null,
      levelName: level && level.type === 'level' ? (level.name ?? null) : null,
    })
  }
  return rooms
}

export function planRoomCaptureShots(
  nodes: Readonly<Record<string, AnyNode>>,
  maxRooms = 12,
): PlannedRoomShot[] {
  const shots: PlannedRoomShot[] = [
    {
      id: 'shot-exterior',
      label: 'Exterior 3D',
      category: 'exterior',
      args: { projection: 'perspective', lighting: 'day' },
    },
    {
      id: 'shot-top-plan',
      label: 'Top Plan 3D',
      category: 'plan',
      args: { projection: 'orthographic', from: 'top' },
    },
  ]

  const rooms = listCapturableRooms(nodes).slice(0, maxRooms)
  for (const room of rooms) {
    const label = room.levelName ? `${room.levelName} · ${room.name}` : room.name
    shots.push({
      id: `shot-room-${room.id}`,
      label,
      category: 'room',
      zoneId: room.id,
      args: {
        projection: 'perspective',
        interior: {
          zoneId: room.id,
          ...(room.levelId ? { levelId: room.levelId } : {}),
        },
      },
    })
  }
  return shots
}

export async function captureCurrent3DPhoto(): Promise<CapturedRoomPhoto> {
  const captured = await captureEphemeralViewport({
    captureMode: 'viewport',
    standardSize: { w: 1280, h: 800 },
  })
  return {
    id: crypto.randomUUID(),
    label: '3D Viewport',
    category: 'exterior',
    imageDataUrl: captured.dataUrl,
    width: captured.width,
    height: captured.height,
  }
}

export async function captureRoomShowcasePhotos(options?: {
  maxRooms?: number
  signal?: AbortSignal
  onProgress?: (current: number, total: number, label: string) => void
  onPhoto?: (photo: CapturedRoomPhoto) => void
}): Promise<CapturedRoomPhoto[]> {
  const doc = getSceneDocument()
  const shots = planRoomCaptureShots(doc.nodes, options?.maxRooms ?? 12)
  const collected: CapturedRoomPhoto[] = []

  for (let i = 0; i < shots.length; i += 1) {
    if (options?.signal?.aborted) break
    const shot = shots[i]!
    options?.onProgress?.(i + 1, shots.length, shot.label)
    try {
      const result = await executeViewScene(shot.args, options?.signal)
      const previews = Array.isArray(result.previews)
        ? (result.previews as Array<{ image?: string }>)
        : []
      const firstImage = previews[0]?.image
      if (typeof firstImage === 'string' && firstImage.startsWith('data:image/')) {
        const size = result.size as { w?: number; h?: number } | undefined
        const photo: CapturedRoomPhoto = {
          id: crypto.randomUUID(),
          label: shot.label,
          category: shot.category,
          ...(shot.zoneId ? { zoneId: shot.zoneId } : {}),
          imageDataUrl: firstImage,
          ...(size?.w ? { width: size.w } : {}),
          ...(size?.h ? { height: size.h } : {}),
        }
        collected.push(photo)
        options?.onPhoto?.(photo)
      }
    } catch {
      // Skip any unreachable angle and keep capturing remaining rooms.
    }
  }

  return collected
}

export function pickSupportedVideoMimeType(
  isSupported: (mime: string) => boolean = (mime) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime),
): { mimeType: string; ext: 'mp4' | 'webm' } {
  const candidates: Array<{ mimeType: string; ext: 'mp4' | 'webm' }> = [
    { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ]
  for (const candidate of candidates) {
    try {
      if (isSupported(candidate.mimeType)) return candidate
    } catch {
      // Ignore probe error and test next candidate.
    }
  }
  return { mimeType: 'video/webm', ext: 'webm' }
}

export async function record3DWalkthroughVideo(options: {
  durationSeconds: number
  orbitMode: 'auto-orbit' | 'free'
  fps?: number
  signal?: AbortSignal
  onElapsed?: (seconds: number) => void
}): Promise<Recorded3DVideo> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('当前环境不支持浏览器 3D 视频录制。')
  }
  const canvas = document.querySelector<HTMLCanvasElement>('[data-pascal-viewer-3d] canvas')
  if (!canvas || typeof canvas.captureStream !== 'function') {
    throw new Error(
      '未检测到可用的 3D WebGL/WebGPU 画布，无法录制 3D 视频（请开启浏览器硬件加速）。',
    )
  }

  const fps = options.fps ?? 30
  const stream = canvas.captureStream(fps)
  const { mimeType, ext } = pickSupportedVideoMimeType()
  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

  const durationMs = Math.max(2, Math.min(30, options.durationSeconds)) * 1000
  const startedAt = performance.now()

  let basePos: [number, number, number] = [14, 10, 14]
  let targetPos: [number, number, number] = [0, 1.5, 0]
  let fov = 45
  if (options.orbitMode === 'auto-orbit') {
    try {
      const plan = sceneViewPlan(getSceneDocument().nodes, { projection: 'perspective' })
      if (plan.pose.projection === 'perspective') {
        basePos = plan.pose.position
        targetPos = plan.pose.target
        fov = plan.pose.fov
      }
    } catch {
      // Fallback to default orbit pose.
    }
  }

  const dx = basePos[0] - targetPos[0]
  const dz = basePos[2] - targetPos[2]
  const radius = Math.hypot(dx, dz) || 16
  const startAngle = Math.atan2(dz, dx)

  emitter.emit('camera-controls:capture-session', { owner: 'studio-video', active: true })

  return new Promise<Recorded3DVideo>((resolve, reject) => {
    let rafId = 0
    let timerId = 0
    let finished = false

    const cleanup = () => {
      cancelAnimationFrame(rafId)
      clearTimeout(timerId)
      for (const track of stream.getTracks()) track.stop()
      emitter.emit('camera-controls:capture-session', { owner: 'studio-video', active: false })
    }

    const finishRecording = () => {
      if (finished) return
      finished = true
      if (recorder.state !== 'inactive') {
        recorder.stop()
      }
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data)
    }

    recorder.onerror = () => {
      cleanup()
      reject(new Error('3D 画布视频录制失败。'))
    }

    recorder.onstop = () => {
      const elapsed = Math.round(performance.now() - startedAt)
      cleanup()
      const blob = new Blob(chunks, { type: mimeType })
      const videoUrl = URL.createObjectURL(blob)
      resolve({
        id: crypto.randomUUID(),
        videoUrl,
        mimeType,
        filename: `pascal-3d-tour-${Math.round(elapsed / 1000)}s.${ext}`,
        durationMs: elapsed,
        mode: options.orbitMode,
      })
    }

    if (options.signal) {
      if (options.signal.aborted) {
        cleanup()
        reject(new Error('已取消录制。'))
        return
      }
      options.signal.addEventListener('abort', finishRecording, { once: true })
    }

    recorder.start(250)
    timerId = window.setTimeout(finishRecording, durationMs)

    const tick = () => {
      if (finished) return
      const elapsedMs = performance.now() - startedAt
      options.onElapsed?.(Math.min(options.durationSeconds, Math.floor(elapsedMs / 1000)))
      if (options.orbitMode === 'auto-orbit') {
        const progress = Math.min(1, elapsedMs / durationMs)
        const angle = startAngle + progress * Math.PI * 2
        const pos: [number, number, number] = [
          targetPos[0] + Math.cos(angle) * radius,
          basePos[1],
          targetPos[2] + Math.sin(angle) * radius,
        ]
        emitter.emit('camera-controls:apply-pose', {
          position: pos,
          target: targetPos,
          projection: 'perspective',
          fov,
        })
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  })
}
