import { expect, test } from 'bun:test'
import { CATALOG_ITEMS } from '@pascal-app/editor'
import { buildVillaWithCommands } from './villa-auto-builder'

test('buildVillaWithCommands executes full 2-storey villa command sequence cleanly', async () => {
  const result = await buildVillaWithCommands({
    style: 'modern',
    floors: 2,
    catalog: CATALOG_ITEMS,
  })
  expect(result.logs.every((entry) => entry.ok)).toBe(true)
  expect(result.summary.levels).toBe(3)
  expect(result.summary.rooms).toBe(13)
  expect(result.summary.doors).toBe(11)
  expect(result.summary.windows).toBe(18)
  expect(result.summary.items).toBe(35)
  expect(result.verifyReport.valid).toBe(true)
}, 20_000)
