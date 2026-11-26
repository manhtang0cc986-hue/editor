import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { CATALOG_ITEMS } from '@pascal-app/editor'
import { getSceneOperations } from '../lib/scene-store-server'
import { buildVillaWithCommands, type VillaStyle } from '../lib/villa-auto-builder'

function loadLocalCatalogForCli() {
  const publicItemsDir = [
    path.join(process.cwd(), 'apps/editor/public/items'),
    path.join(process.cwd(), 'public/items'),
  ].find((dir) => existsSync(dir))

  const available = new Set(publicItemsDir ? readdirSync(publicItemsDir) : [])
  return CATALOG_ITEMS.map((item) => {
    if (!available.has(item.id) || !publicItemsDir) return item
    const files = readdirSync(path.join(publicItemsDir, item.id))
    const thumb =
      files.find((f) => f === 'thumbnail.webp') ?? files.find((f) => f.startsWith('thumbnail.'))
    const glb = files.find((f) => f === 'model.glb') ?? files.find((f) => f.endsWith('.glb'))
    return {
      ...item,
      ...(thumb ? { thumbnail: `/items/${item.id}/${thumb}` } : {}),
      ...(glb ? { src: `/items/${item.id}/${glb}` } : {}),
    }
  })
}

function parseArgs(argv: string[]) {
  const getFlag = (name: string) => {
    const idx = argv.indexOf(`--${name}`)
    return idx >= 0 ? argv[idx + 1] : undefined
  }
  const styleArg = getFlag('style')
  const style: VillaStyle = styleArg === 'warm' || styleArg === 'nordic' ? styleArg : 'modern'
  const floorsArg = getFlag('floors')
  const floors: 1 | 2 = floorsArg === '1' ? 1 : 2
  const name = getFlag('name') || `自动生成双层现代别墅 (${style})`
  const noSave = argv.includes('--dry-run')
  return { style, floors, name, noSave }
}

async function main() {
  const { style, floors, name, noSave } = parseArgs(process.argv.slice(2))
  console.log(
    `\n🏗️  开始自动跑命令设计并建造别墅: "${name}" (style=${style}, floors=${floors})...\n`,
  )

  const catalog = loadLocalCatalogForCli()
  const built = await buildVillaWithCommands({
    name,
    style,
    floors,
    catalog,
    onLog: (entry) => {
      const icon = entry.ok ? '✅' : '⚠️'
      console.log(
        `  [${String(entry.step).padStart(2, '0')}] ${icon} ${entry.tool} — ${entry.label} (${entry.summary})`,
      )
    },
  })

  console.log('\n📊 建模统计:', JSON.stringify(built.summary))

  if (!noSave) {
    const operations = await getSceneOperations()
    const saved = await operations.saveScene({
      name,
      graph: {
        nodes: built.document.nodes,
        rootNodeIds: built.document.rootNodeIds,
        materials: built.document.materials,
        collections: built.document.collections,
      } as never,
    })
    const port = process.env.PORT || '3002'
    console.log(`\n🎉 已保存到本地项目库！`)
    console.log(`   项目 ID: ${saved.id}`)
    console.log(`   打开编辑器查看 3D 别墅: http://localhost:${port}/project/${saved.id}\n`)
  }
}

await main()
