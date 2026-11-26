import { expect, test } from 'bun:test'
import { houseAgentModelBrand } from './house-agent-model-brand'

test.each([
  ['gpt-4o-mini', 'openai'],
  ['o3-mini', 'openai'],
  ['openai/claude-sonnet-4', 'claude-color'],
  ['models/gemini-2.5-flash', 'gemini-color'],
  ['deepseek-ai/DeepSeek-V3', 'deepseek-color'],
  ['Qwen3.5-Plus', 'qwen-color'],
  ['x-ai/grok-4', 'grok'],
  ['moonshotai/Kimi-K2', 'kimi-color'],
  ['glm-5', 'zhipu-color'],
  ['mistralai/Mixtral-8x7B', 'mistral-color'],
  ['meta-llama/Llama-3', 'meta-color'],
])('resolves the local brand asset for %s', (id, icon) => {
  expect(houseAgentModelBrand(id)?.icon).toBe(icon)
})

test('falls back to the provider for custom aliases and uses a neutral icon for unknown brands', () => {
  expect(houseAgentModelBrand('my-deployment', 'Anthropic')?.icon).toBe('claude-color')
  expect(houseAgentModelBrand('megpt', 'private-gateway')).toBeUndefined()
})
