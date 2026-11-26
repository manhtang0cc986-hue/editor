import {
  AGENT_OPERATIONS,
  type AgentOperation,
  type AssetCatalog,
  readCatalog,
  setWallSkirting,
} from '@pascal-app/core/agent-operations'
import {
  applyPatchWithDependencies,
  captureRegistryVersions,
  effectIds,
  isEmptyScenePatch,
  openDetachedScene,
  type SceneSnapshot,
} from '@pascal-app/core/runtime'
import type { AnyNode, AnyNodeId, SceneMaterial, SceneMaterialId } from '@pascal-app/core/schema'

export type VillaStyle = 'modern' | 'warm' | 'nordic'

export type VillaCommandLog = {
  step: number
  tool: string
  label: string
  ok: boolean
  summary: string
}

export type VillaBuildOptions = {
  name?: string
  style?: VillaStyle
  floors?: 1 | 2
  includeFurniture?: boolean
  includeCourtyard?: boolean
  catalog: AssetCatalog
  onLog?: (entry: VillaCommandLog) => void
}

export type VillaBuildResult = {
  document: SceneSnapshot
  logs: VillaCommandLog[]
  verifyReport: Record<string, unknown>
  summary: {
    levels: number
    rooms: number
    walls: number
    doors: number
    windows: number
    items: number
    issues: number
  }
}

const STYLE_PALETTES: Record<
  VillaStyle,
  {
    label: string
    exteriorWall: string
    interiorWall: string
    wetWall: string
    livingFloor: string
    bedroomFloor: string
    wetFloor: string
    terraceFloor: string
    roofTop: string
    roofFascia: string
    fence: string
  }
> = {
  modern: {
    label: '现代极简白墅',
    exteriorWall: 'library:concrete-stucco',
    interiorWall: 'library:preset-softwhite',
    wetWall: 'library:flooring-statuarettowhite',
    livingFloor: 'library:wood-hungarianparquet10',
    bedroomFloor: 'library:wood-floorplank1',
    wetFloor: 'library:flooring-statuarettowhite',
    terraceFloor: 'library:flooring-tile79',
    roofTop: 'library:roof-greyshingles',
    roofFascia: 'library:preset-nearblack',
    fence: 'library:preset-charcoal',
  },
  warm: {
    label: '暖调新古典别墅',
    exteriorWall: 'library:siding-batten-cream',
    interiorWall: 'library:preset-cream',
    wetWall: 'library:flooring-terrazzo19',
    livingFloor: 'library:wood-woodfine2',
    bedroomFloor: 'library:wood-finewood27',
    wetFloor: 'library:flooring-terrazzo19',
    terraceFloor: 'library:flooring-tile86',
    roofTop: 'library:roof-terracottatiles',
    roofFascia: 'library:preset-beige',
    fence: 'library:wood-woodplank19',
  },
  nordic: {
    label: '北欧原木庭院墅',
    exteriorWall: 'library:siding-lap-white',
    interiorWall: 'library:preset-white',
    wetWall: 'library:flooring-lightceramic24',
    livingFloor: 'library:wood-woodplank48',
    bedroomFloor: 'library:wood-woodfine13',
    wetFloor: 'library:flooring-lightceramic24',
    terraceFloor: 'library:concrete-plate',
    roofTop: 'library:roof-weatheredshingles',
    roofFascia: 'library:preset-seattlegrey',
    fence: 'library:siding-lap-cedar',
  },
}

function emptyDocument(): SceneSnapshot {
  return {
    nodes: {} as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [],
    collections: {},
    materials: {} as Record<SceneMaterialId, SceneMaterial>,
    installedPlugins: [],
  }
}

/**
 * Automatically executes Pascal's architectural commands to design & construct
 * a complete 1- or 2-storey courtyard villa with calibrated rooms, openings,
 * U-staircase, hip roof, porch framing, courtyard fence, PBR materials, and
 * collision-free local 3D furniture.
 */
export async function buildVillaWithCommands(
  options: VillaBuildOptions,
): Promise<VillaBuildResult> {
  const style = options.style ?? 'modern'
  const palette = STYLE_PALETTES[style]
  const floors = options.floors ?? 2
  const includeFurniture = options.includeFurniture ?? true
  const includeCourtyard = options.includeCourtyard ?? true
  const logs: VillaCommandLog[] = []
  let doc = emptyDocument()
  let activeLevelId: string | null = null
  let stepCounter = 0

  const runCommand = async (
    tool: string,
    label: string,
    input: Record<string, unknown>,
    optionsRun?: { optional?: boolean },
  ): Promise<Record<string, unknown>> => {
    stepCounter += 1
    const operation =
      tool === 'set_wall_skirting'
        ? (setWallSkirting as AgentOperation)
        : (AGENT_OPERATIONS as Record<string, AgentOperation>)[tool]
    if (!operation) {
      throw new Error(`Unknown operation: ${tool}`)
    }
    const catalogContext = await readCatalog(doc.nodes, tool, input, options.catalog)
    const scene = openDetachedScene(doc, {
      base: { kind: 'authority', seq: stepCounter },
      ids: effectIds(`villa-${stepCounter}`),
      context: {
        activeLevelId,
        selection: [],
        units: 'metric',
        catalogVersion: 'builtin',
        registryVersions: captureRegistryVersions(),
      },
    })

    try {
      const result = scene.execute(operation, input as never, {
        activeLevelId,
        ...catalogContext,
        materials: doc.materials,
      })
      const patch = scene.patch()
      if (!isEmptyScenePatch(patch)) {
        const application = applyPatchWithDependencies(doc, patch, scene.dependencies(), doc)
        if (!application.ok) {
          throw new Error(
            `Dependency conflict on ${tool}: ${application.changed.map((c) => c.id ?? c.kind).join(', ')}`,
          )
        }
        doc = application.next as SceneSnapshot
      }
      const entry: VillaCommandLog = {
        step: stepCounter,
        tool,
        label,
        ok: true,
        summary:
          typeof result.zoneId === 'string'
            ? `zone=${result.zoneId}`
            : typeof result.levelId === 'string'
              ? `level=${result.levelId}`
              : typeof result.stairId === 'string'
                ? `stair=${result.stairId}`
                : typeof result.roofId === 'string'
                  ? `roof=${result.roofId}`
                  : 'ok',
      }
      logs.push(entry)
      options.onLog?.(entry)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const entry: VillaCommandLog = {
        step: stepCounter,
        tool,
        label,
        ok: false,
        summary: message,
      }
      logs.push(entry)
      options.onLog?.(entry)
      if (!optionsRun?.optional) throw error
      return { error: message }
    } finally {
      scene.dispose()
    }
  }

  // 1. Initialize Ground Level (Site -> Building -> Level 0, height 3.0 m)
  const level0Res = await runCommand('add_level', '创建场地、别墅建筑与一层（层高 3.0 m）', {
    name: '一层 Ground Floor',
    height: 3.0,
  })
  const level0Id = String(level0Res.levelId)
  activeLevelId = level0Id

  // Main footprint: x in [-6, 6] (12m), z in [-4.5, 4.5] (9m)
  // Grid lines: x = -0.5, x = 2.5; z = -1.0 (south depth 5.5m, north depth 3.5m)

  // 2. Ground Floor Rooms
  const livingZone = await runCommand('create_room', '建造一层客厅 (5.5m × 5.5m)', {
    levelId: level0Id,
    name: '客厅 Living Room',
    polygon: [
      [-6, -1.0],
      [-0.5, -1.0],
      [-0.5, 4.5],
      [-6, 4.5],
    ],
    wallThickness: 0.2,
    doors: [
      {
        wallIndex: 1,
        t: 0.55,
        openingKind: 'opening',
        width: 1.8,
        height: 2.4,
      },
    ],
    windows: [
      {
        wallIndex: 2,
        t: 0.5,
        windowType: 'fixed',
        style: 'tall-grid',
        width: 2.6,
        height: 1.8,
        sillHeight: 0.5,
      },
      { wallIndex: 3, t: 0.5, windowType: 'casement', width: 2.0, height: 1.6, sillHeight: 0.7 },
    ],
  })

  const guestZone = await runCommand('create_room', '建造一层老人房/客房 (5.5m × 3.5m)', {
    levelId: level0Id,
    name: '一层客房 Guest Suite',
    polygon: [
      [-6, -4.5],
      [-0.5, -4.5],
      [-0.5, -1.0],
      [-6, -1.0],
    ],
    wallThickness: 0.2,
    doors: [{ wallIndex: 1, t: 0.5, style: 'modern', width: 0.9, height: 2.1 }],
    windows: [
      { wallIndex: 0, t: 0.5, windowType: 'casement', width: 1.8, height: 1.5, sillHeight: 0.8 },
      { wallIndex: 3, t: 0.5, windowType: 'casement', width: 1.6, height: 1.5, sillHeight: 0.8 },
    ],
  })

  const hallZone = await runCommand('create_room', '建造入户玄关与楼梯厅 (3.0m × 5.5m)', {
    levelId: level0Id,
    name: '玄关楼梯厅 Entry Hall',
    polygon: [
      [-0.5, -1.0],
      [2.5, -1.0],
      [2.5, 4.5],
      [-0.5, 4.5],
    ],
    wallThickness: 0.2,
    doors: [
      {
        wallIndex: 2,
        t: 0.35,
        style: 'paneled-glass',
        width: 1.0,
        height: 2.3,
        sidelightLeft: 0.3,
        sidelightRight: 0.3,
      },
      {
        wallIndex: 0,
        t: 0.5,
        style: 'modern',
        width: 0.85,
        height: 2.1,
      },
      {
        wallIndex: 1,
        t: 0.55,
        openingKind: 'opening',
        width: 1.6,
        height: 2.4,
      },
    ],
  })

  const bath0Zone = await runCommand('create_room', '建造一层公卫与家政区 (3.0m × 3.5m)', {
    levelId: level0Id,
    name: '一层客卫 Bathroom',
    polygon: [
      [-0.5, -4.5],
      [2.5, -4.5],
      [2.5, -1.0],
      [-0.5, -1.0],
    ],
    wallThickness: 0.2,
    windows: [
      { wallIndex: 0, t: 0.5, windowType: 'awning', width: 1.0, height: 0.9, sillHeight: 1.3 },
    ],
  })

  const diningZone = await runCommand('create_room', '建造一层餐厅 (3.5m × 5.5m)', {
    levelId: level0Id,
    name: '餐厅 Dining Room',
    polygon: [
      [2.5, -1.0],
      [6, -1.0],
      [6, 4.5],
      [2.5, 4.5],
    ],
    wallThickness: 0.2,
    doors: [{ wallIndex: 0, t: 0.5, openingKind: 'opening', width: 1.8, height: 2.4 }],
    windows: [
      { wallIndex: 1, t: 0.5, windowType: 'casement', width: 1.8, height: 1.6, sillHeight: 0.7 },
      {
        wallIndex: 2,
        t: 0.5,
        windowType: 'fixed',
        style: 'grid',
        width: 1.8,
        height: 1.6,
        sillHeight: 0.7,
      },
    ],
  })

  const kitchenZone = await runCommand('create_room', '建造一层厨房 (3.5m × 3.5m)', {
    levelId: level0Id,
    name: '厨房 Kitchen',
    polygon: [
      [2.5, -4.5],
      [6, -4.5],
      [6, -1.0],
      [2.5, -1.0],
    ],
    wallThickness: 0.2,
    windows: [
      { wallIndex: 0, t: 0.5, windowType: 'sliding', width: 1.6, height: 1.1, sillHeight: 1.1 },
      { wallIndex: 1, t: 0.5, windowType: 'casement', width: 1.2, height: 1.1, sillHeight: 1.1 },
    ],
  })

  const terraceZone = await runCommand('create_room', '建造南向入户休闲门廊 (12.0m × 2.5m)', {
    levelId: level0Id,
    name: '南向庭院门廊 Front Porch',
    outdoor: true,
    polygon: [
      [-6, 4.5],
      [6, 4.5],
      [6, 7.0],
      [-6, 7.0],
    ],
  })

  await runCommand(
    'set_zone_intent',
    '配置门廊自动立柱、梁架与地面',
    {
      zoneId: terraceZone.zoneId,
      patch: {
        roomType: 'porch',
        porchFraming: { auto: true, postSize: '6x6', postSpacing: 3.6 },
        floor: { finish: palette.terraceFloor },
      },
    },
    { optional: true },
  )

  // 3. Second Floor + Staircase
  let level1Id: string | null = null
  let masterZoneId: string | null = null
  let masterBathZoneId: string | null = null
  let upperHallZoneId: string | null = null
  let bed2ZoneId: string | null = null
  let studyZoneId: string | null = null
  let bath1ZoneId: string | null = null

  if (floors === 2) {
    const level1Res = await runCommand('add_level', '创建别墅二层（层高 2.8 m）', {
      name: '二层 Second Floor',
      position: 'above',
      height: 2.8,
    })
    level1Id = String(level1Res.levelId)

    const masterRes = await runCommand('create_room', '建造二层主卧套房 (5.5m × 5.5m)', {
      levelId: level1Id,
      name: '主卧 Master Bedroom',
      polygon: [
        [-6, -1.0],
        [-0.5, -1.0],
        [-0.5, 4.5],
        [-6, 4.5],
      ],
      wallThickness: 0.2,
      doors: [
        { wallIndex: 0, t: 0.72, style: 'modern', width: 0.9, height: 2.1 },
        { wallIndex: 1, t: 0.45, style: 'modern', width: 0.9, height: 2.1 },
      ],
      windows: [
        {
          wallIndex: 2,
          t: 0.5,
          windowType: 'fixed',
          style: 'wide-grid',
          width: 2.6,
          height: 1.6,
          sillHeight: 0.6,
        },
        { wallIndex: 3, t: 0.5, windowType: 'casement', width: 1.8, height: 1.5, sillHeight: 0.7 },
      ],
    })
    masterZoneId = String(masterRes.zoneId)

    const masterBathRes = await runCommand('create_room', '建造二层主卫与浴缸区 (5.5m × 3.5m)', {
      levelId: level1Id,
      name: '主卫 Master Bathroom',
      polygon: [
        [-6, -4.5],
        [-0.5, -4.5],
        [-0.5, -1.0],
        [-6, -1.0],
      ],
      wallThickness: 0.2,
      windows: [
        { wallIndex: 0, t: 0.5, windowType: 'awning', width: 1.5, height: 1.0, sillHeight: 1.2 },
      ],
    })
    masterBathZoneId = String(masterBathRes.zoneId)

    const upperHallRes = await runCommand('create_room', '建造二层楼梯起居厅 (3.0m × 5.5m)', {
      levelId: level1Id,
      name: '二层走廊起居厅 Upper Hall',
      polygon: [
        [-0.5, -1.0],
        [2.5, -1.0],
        [2.5, 4.5],
        [-0.5, 4.5],
      ],
      wallThickness: 0.2,
      doors: [
        { wallIndex: 0, t: 0.5, style: 'modern', width: 0.85, height: 2.1 },
        { wallIndex: 1, t: 0.45, style: 'modern', width: 0.9, height: 2.1 },
      ],
      windows: [
        {
          wallIndex: 2,
          t: 0.5,
          windowType: 'fixed',
          style: 'double-hung',
          width: 1.6,
          height: 1.6,
          sillHeight: 0.6,
        },
      ],
    })
    upperHallZoneId = String(upperHallRes.zoneId)

    const bath1Res = await runCommand('create_room', '建造二层公卫 (3.0m × 3.5m)', {
      levelId: level1Id,
      name: '二层公卫 Shared Bath',
      polygon: [
        [-0.5, -4.5],
        [2.5, -4.5],
        [2.5, -1.0],
        [-0.5, -1.0],
      ],
      wallThickness: 0.2,
      windows: [
        { wallIndex: 0, t: 0.5, windowType: 'awning', width: 1.0, height: 0.9, sillHeight: 1.3 },
      ],
    })
    bath1ZoneId = String(bath1Res.zoneId)

    const bed2Res = await runCommand('create_room', '建造二层南向次卧 (3.5m × 5.5m)', {
      levelId: level1Id,
      name: '次卧 Bedroom 2',
      polygon: [
        [2.5, -1.0],
        [6, -1.0],
        [6, 4.5],
        [2.5, 4.5],
      ],
      wallThickness: 0.2,
      doors: [{ wallIndex: 0, t: 0.35, style: 'modern', width: 0.9, height: 2.1 }],
      windows: [
        { wallIndex: 1, t: 0.5, windowType: 'casement', width: 1.6, height: 1.5, sillHeight: 0.7 },
        { wallIndex: 2, t: 0.5, windowType: 'casement', width: 1.6, height: 1.5, sillHeight: 0.7 },
      ],
    })
    bed2ZoneId = String(bed2Res.zoneId)

    const studyRes = await runCommand('create_room', '建造二层书房 (3.5m × 3.5m)', {
      levelId: level1Id,
      name: '书房 Study',
      polygon: [
        [2.5, -4.5],
        [6, -4.5],
        [6, -1.0],
        [2.5, -1.0],
      ],
      wallThickness: 0.2,
      windows: [
        { wallIndex: 0, t: 0.5, windowType: 'casement', width: 1.5, height: 1.4, sillHeight: 0.8 },
        { wallIndex: 1, t: 0.5, windowType: 'casement', width: 1.5, height: 1.4, sillHeight: 0.8 },
      ],
    })
    studyZoneId = String(studyRes.zoneId)

    // U-shaped staircase inside Entry Hall / Upper Hall (z in [-1.0, 4.5], x in [-0.5, 2.5])
    await runCommand(
      'create_stair',
      '建造贯通一二层的双跑 U 型楼梯（自动裁切楼板洞口）',
      {
        levelId: level0Id,
        toLevelId: level1Id,
        x: 0.4,
        z: 3.1,
        rotation: 180,
        layout: 'u',
        turn: 'right',
        width: 0.85,
        railingMode: 'both',
      },
      { optional: true },
    )
  }

  // 4. Roof over top storey
  await runCommand('create_roof', '自动生成四坡别墅屋顶与檐口挑檐', {
    levelId: level1Id ?? level0Id,
    roofType: 'hip',
    pitch: 28,
    overhang: 0.65,
    materialPreset: palette.roofTop,
    fasciaHeight: 0.26,
    fasciaMaterialPreset: palette.roofFascia,
  })

  // 5. Courtyard perimeter fence
  if (includeCourtyard) {
    await runCommand(
      'add_fence',
      '围合别墅庭院边界栅栏（留出南向入户门洞）',
      {
        levelId: level0Id,
        points: [
          [2.0, 9.5],
          [9.0, 9.5],
          [9.0, -7.2],
          [-9.0, -7.2],
          [-9.0, 9.5],
          [-1.5, 9.5],
        ],
        height: 1.45,
        style: 'slat',
        materialPreset: palette.fence,
      },
      { optional: true },
    )
  }

  // 6. Set room floor & wall finishes via set_zone_intent + paint exterior walls
  const roomFinishes: Array<{ id: string | null; floor: string; wall: string; label: string }> = [
    {
      id: String(livingZone.zoneId),
      floor: palette.livingFloor,
      wall: palette.interiorWall,
      label: '配置客厅地板与墙面',
    },
    {
      id: String(diningZone.zoneId),
      floor: palette.livingFloor,
      wall: palette.interiorWall,
      label: '配置餐厅地板与墙面',
    },
    {
      id: String(hallZone.zoneId),
      floor: palette.wetFloor,
      wall: palette.interiorWall,
      label: '配置玄关石材地面与墙面',
    },
    {
      id: String(guestZone.zoneId),
      floor: palette.bedroomFloor,
      wall: palette.interiorWall,
      label: '配置一层客房木地板与墙面',
    },
    {
      id: String(kitchenZone.zoneId),
      floor: palette.wetFloor,
      wall: palette.wetWall,
      label: '配置厨房防滑地砖与墙砖',
    },
    {
      id: String(bath0Zone.zoneId),
      floor: palette.wetFloor,
      wall: palette.wetWall,
      label: '配置一层客卫地面与瓷砖墙面',
    },
    ...(floors === 2
      ? [
          {
            id: masterZoneId,
            floor: palette.bedroomFloor,
            wall: palette.interiorWall,
            label: '配置主卧木地板与墙面',
          },
          {
            id: upperHallZoneId,
            floor: palette.livingFloor,
            wall: palette.interiorWall,
            label: '配置二层起居厅地板与墙面',
          },
          {
            id: bed2ZoneId,
            floor: palette.bedroomFloor,
            wall: palette.interiorWall,
            label: '配置次卧木地板与墙面',
          },
          {
            id: studyZoneId,
            floor: palette.bedroomFloor,
            wall: palette.interiorWall,
            label: '配置书房木地板与墙面',
          },
          {
            id: masterBathZoneId,
            floor: palette.wetFloor,
            wall: palette.wetWall,
            label: '配置主卫石材地面与墙砖',
          },
          {
            id: bath1ZoneId,
            floor: palette.wetFloor,
            wall: palette.wetWall,
            label: '配置二层公卫地面与墙砖',
          },
        ]
      : []),
  ]

  for (const spec of roomFinishes) {
    if (!spec.id) continue
    await runCommand(
      'set_zone_intent',
      spec.label,
      {
        zoneId: spec.id,
        patch: {
          floor: { finish: spec.floor },
          wallMaterial: spec.wall,
        },
      },
      { optional: true },
    )
  }

  // Paint exterior faces explicitly by outer face (frontSide/backSide)
  const wallNodes = Object.values(doc.nodes).filter(
    (node): node is Extract<AnyNode, { type: 'wall' }> => node.type === 'wall',
  )
  const faceAWalls = wallNodes.filter((w) => w.frontSide === 'exterior').map((w) => w.id)
  const faceBWalls = wallNodes.filter((w) => w.backSide === 'exterior').map((w) => w.id)
  if (faceAWalls.length) {
    await runCommand(
      'paint',
      '粉刷别墅外立面（正面朝外墙体）',
      { targets: faceAWalls, role: 'a', material: palette.exteriorWall },
      { optional: true },
    )
  }
  if (faceBWalls.length) {
    await runCommand(
      'paint',
      '粉刷别墅外立面（背面朝外墙体）',
      { targets: faceBWalls, role: 'b', material: palette.exteriorWall },
      { optional: true },
    )
  }

  // Add interior baseboards/skirting along indoor wall faces
  if (wallNodes.length) {
    await runCommand(
      'set_wall_skirting',
      '为室内墙体安装踢脚线',
      {
        wallIds: wallNodes.map((w) => w.id),
        enabled: true,
        height: 0.1,
        depth: 0.015,
        finish: palette.interiorWall,
      },
      { optional: true },
    )
  }

  // 7. Place collision-free local 3D furniture & outdoor assets
  if (includeFurniture) {
    await runCommand(
      'place_items',
      '布置一层客厅、餐厅、厨房、客房与庭院 3D 家具素材',
      {
        levelId: level0Id,
        items: [
          // Living Room (x in [-6, -0.5], z in [-1.0, 4.5])
          { assetId: 'sofa', x: -3.0, z: 0.0, rotation: 0 },
          { assetId: 'coffee-table', x: -3.0, z: 2.0, rotation: 0 },
          { assetId: 'tv-stand', x: -3.0, z: 4.05, rotation: 180 },
          { assetId: 'livingroom-chair', x: -5.1, z: 2.0, rotation: 90 },
          { assetId: 'indoor-plant', x: -5.4, z: 3.9, rotation: 0 },
          // Guest Suite (x in [-6, -0.5], z in [-4.5, -1.0])
          { assetId: 'double-bed', x: -4.65, z: -2.75, rotation: 90 },
          { assetId: 'bedside-table', x: -5.55, z: -1.35, rotation: 90 },
          { assetId: 'closet', x: -2.0, z: -3.9, rotation: 0 },
          // Ground Bath (x in [-0.5, 2.5], z in [-4.5, -1.0])
          { assetId: 'bathroom-sink', x: 1.4, z: -3.65, rotation: 0 },
          { assetId: 'toilet', x: 0.1, z: -2.1, rotation: 90 },
          { assetId: 'washing-machine', x: 1.9, z: -1.7, rotation: -90 },
          // Dining Room (x in [2.5, 6.0], z in [-1.0, 4.5])
          { assetId: 'dining-table', x: 4.25, z: 2.0, rotation: 90 },
          { assetId: 'dining-chair', x: 3.3, z: 1.5, rotation: 90 },
          { assetId: 'dining-chair', x: 3.3, z: 2.5, rotation: 90 },
          { assetId: 'dining-chair', x: 5.2, z: 1.5, rotation: -90 },
          { assetId: 'dining-chair', x: 5.2, z: 2.5, rotation: -90 },
          // Kitchen (x in [2.5, 6.0], z in [-4.5, -1.0])
          { assetId: 'kitchen', x: 4.6, z: -3.9, rotation: 0 },
          { assetId: 'fridge', x: 3.1, z: -2.1, rotation: 90 },
          { assetId: 'stove', x: 5.35, z: -2.1, rotation: -90 },
          // Courtyard plants
          { assetId: 'indoor-plant', x: -7.5, z: 6.5, rotation: 0 },
          { assetId: 'indoor-plant', x: 7.5, z: 6.5, rotation: 0 },
        ],
      },
      { optional: true },
    )

    if (level1Id) {
      await runCommand(
        'place_items',
        '布置二层主卧、主卫、次卧与书房 3D 家具素材',
        {
          levelId: level1Id,
          items: [
            // Master Bedroom (x in [-6, -0.5], z in [-1.0, 4.5])
            { assetId: 'double-bed', x: -4.65, z: 1.8, rotation: 90 },
            { assetId: 'bedside-table', x: -5.6, z: 0.3, rotation: 90 },
            { assetId: 'bedside-table', x: -5.6, z: 3.3, rotation: 90 },
            { assetId: 'dresser', x: -2.6, z: 3.9, rotation: 180 },
            // Master Bath (x in [-6, -0.5], z in [-4.5, -1.0])
            { assetId: 'bathtub', x: -4.6, z: -3.65, rotation: 0 },
            { assetId: 'bathroom-sink', x: -1.7, z: -3.65, rotation: 0 },
            { assetId: 'toilet', x: -5.3, z: -1.7, rotation: 90 },
            // Shared Upper Bath (x in [-0.5, 2.5], z in [-4.5, -1.0])
            { assetId: 'shower-square', x: 0.15, z: -3.85, rotation: 0 },
            { assetId: 'toilet', x: 0.15, z: -2.1, rotation: 90 },
            { assetId: 'bathroom-sink', x: 1.65, z: -2.6, rotation: -90 },
            // Bedroom 2 (x in [2.5, 6.0], z in [-1.0, 4.5])
            { assetId: 'single-bed', x: 4.65, z: 1.8, rotation: -90 },
            { assetId: 'closet', x: 4.2, z: 3.9, rotation: 180 },
            // Study (x in [2.5, 6.0], z in [-4.5, -1.0])
            { assetId: 'office-table', x: 4.4, z: -3.4, rotation: 0 },
            { assetId: 'bookshelf', x: 5.4, z: -1.7, rotation: -90 },
            { assetId: 'floor-lamp', x: 3.1, z: -3.8, rotation: 0 },
          ],
        },
        { optional: true },
      )
    }
  }

  // 8. Final Scene Verification
  const verifyReport = await runCommand('verify_scene', '执行全场景空间与规范校验', {})

  const allNodes = Object.values(doc.nodes)
  const issues = Array.isArray(verifyReport.issues) ? verifyReport.issues.length : 0

  return {
    document: doc,
    logs,
    verifyReport,
    summary: {
      levels: allNodes.filter((n) => n.type === 'level').length,
      rooms: allNodes.filter((n) => n.type === 'zone').length,
      walls: allNodes.filter((n) => n.type === 'wall').length,
      doors: allNodes.filter((n) => n.type === 'door').length,
      windows: allNodes.filter((n) => n.type === 'window').length,
      items: allNodes.filter((n) => n.type === 'item').length,
      issues,
    },
  }
}
