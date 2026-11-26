import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  listCapturableRooms,
  pickSupportedVideoMimeType,
  planRoomCaptureShots,
} from './scene-media-capture'

const SAMPLE_NODES: Record<string, AnyNode> = {
  level_0: {
    id: 'level_0',
    type: 'level',
    name: '一楼',
    level: 0,
    children: [],
  } as unknown as AnyNode,
  zone_living: {
    id: 'zone_living',
    type: 'zone',
    name: '客厅',
    parentId: 'level_0',
    polygon: [
      [0, 0],
      [6, 0],
      [6, 5],
      [0, 5],
    ],
  } as unknown as AnyNode,
  zone_bed: {
    id: 'zone_bed',
    type: 'zone',
    name: '主卧',
    parentId: 'level_0',
    polygon: [
      [6, 0],
      [10, 0],
      [10, 4],
      [6, 4],
    ],
  } as unknown as AnyNode,
}

describe('scene-media-capture', () => {
  test('listCapturableRooms resolves room names and parent level names', () => {
    const rooms = listCapturableRooms(SAMPLE_NODES)
    expect(rooms).toHaveLength(2)
    expect(rooms.map((r) => ({ name: r.name, levelName: r.levelName }))).toEqual([
      { name: '客厅', levelName: '一楼' },
      { name: '主卧', levelName: '一楼' },
    ])
  })

  test('planRoomCaptureShots creates exterior, top plan, and room interior camera plans', () => {
    const shots = planRoomCaptureShots(SAMPLE_NODES)
    expect(shots.map((s) => ({ category: s.category, label: s.label }))).toEqual([
      { category: 'exterior', label: 'Exterior 3D' },
      { category: 'plan', label: 'Top Plan 3D' },
      { category: 'room', label: '一楼 · 客厅' },
      { category: 'room', label: '一楼 · 主卧' },
    ])
    expect(shots[2]?.args).toEqual({
      projection: 'perspective',
      interior: { zoneId: 'zone_living', levelId: 'level_0' },
    })
  })

  test('pickSupportedVideoMimeType prefers mp4/vp9 when supported and falls back cleanly', () => {
    expect(pickSupportedVideoMimeType((m) => m.includes('vp9'))).toEqual({
      mimeType: 'video/webm;codecs=vp9',
      ext: 'webm',
    })
    expect(pickSupportedVideoMimeType(() => false)).toEqual({
      mimeType: 'video/webm',
      ext: 'webm',
    })
  })
})
