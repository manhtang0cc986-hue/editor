import { expect, test } from 'bun:test'
import { houseAgentModelBrand } from './house-agent-model-brand'

test.each([
  ['gpt-4o-mini', 'openai'],
  ['o3-mini', 'openai'],
  ['openai/claude-sonnet-4', 'claude-color'],
  ['models/gemini-2.5-flash', 'gemini-color'],
  ['nano-banana-pro', 'gemini-color'],
  ['DALL-E 3', 'openai'],
  ['x-ai/grok-4', 'grok'],
])('resolves the local brand asset for %s', (id, icon) => {
  expect(houseAgentModelBrand(id)?.icon).toBe(icon)
})

test('falls back to the provider for custom aliases and uses a neutral icon for unknown brands', () => {
  expect(houseAgentModelBrand('my-deployment', 'Anthropic')?.icon).toBe('claude-color')
  expect(houseAgentModelBrand('megpt', 'private-gateway')).toBeUndefined()
})
