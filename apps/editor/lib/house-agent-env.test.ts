import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  hydrateProcessEnvFromFile,
  maskSecret,
  persistHouseAgentEnv,
  serializeEnvUpdates,
} from './house-agent-env'

describe('house-agent-env persistence', () => {
  test('maskSecret masks keys cleanly without exposing secrets', () => {
    expect(maskSecret(undefined)).toBeNull()
    expect(maskSecret('short')).toBe('••••••••')
    expect(maskSecret('sk-proj-1234567890abcd')).toBe('sk-p••••abcd')
  })

  test('serializeEnvUpdates preserves unrelated env vars and strips newlines', () => {
    const existing = '# comment\nOTHER_VAR=keep\nPASCAL_AGENT_MODEL=old-model\n'
    const next = serializeEnvUpdates(existing, {
      PASCAL_AGENT_MODEL: 'o3\nINJECTED=bad',
      PASCAL_AGENT_API_KEY: 'sk-test-123456',
    })
    expect(next).toContain('# comment')
    expect(next).toContain('OTHER_VAR=keep')
    expect(next).toContain('PASCAL_AGENT_MODEL=o3INJECTED=bad')
    expect(next).toContain('PASCAL_AGENT_API_KEY=sk-test-123456')
    expect(next).not.toContain('\nINJECTED=bad')
  })

  test('persistHouseAgentEnv writes .env.local, updates env, and hydrates back on startup', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pascal-env-test-'))
    const envFile = path.join(dir, '.env.local')
    try {
      const runtimeEnv = {} as NodeJS.ProcessEnv
      const saved = persistHouseAgentEnv(
        {
          agent: {
            baseUrl: 'https://api.openai.com/v1',
            model: 'o3',
            apiKey: 'sk-agent-secret-9999',
            reasoningEffort: 'high',
          },
          image: {
            baseUrl: 'https://img.example.com/v1',
            model: 'gpt-image-1',
            apiKey: 'sk-image-secret-8888',
            mode: 'images',
          },
        },
        { env: runtimeEnv, envFilePath: envFile },
      )

      expect(saved.saved).toBe(true)
      expect(saved.agent.configured).toBe(true)
      expect(saved.agent.maskedApiKey).toBe('sk-a••••9999')
      expect(saved.image.configured).toBe(true)
      expect(saved.image.maskedApiKey).toBe('sk-i••••8888')
      expect(existsSync(envFile)).toBe(true)
      expect(readFileSync(envFile, 'utf8')).toContain('PASCAL_AGENT_API_KEY=sk-agent-secret-9999')

      // Simulate fresh process hydrating from disk .env.local
      const freshEnv = {} as NodeJS.ProcessEnv
      hydrateProcessEnvFromFile(freshEnv, envFile)
      expect(freshEnv.PASCAL_AGENT_MODEL).toBe('o3')
      expect(freshEnv.PASCAL_AGENT_API_KEY).toBe('sk-agent-secret-9999')
      expect(freshEnv.PASCAL_IMAGE_MODEL).toBe('gpt-image-1')
      expect(freshEnv.PASCAL_IMAGE_API_KEY).toBe('sk-image-secret-8888')

      persistHouseAgentEnv(
        { image: { model: 'new-image-model', mode: 'chat' } },
        { env: freshEnv, envFilePath: envFile },
      )
      const restored: NodeJS.ProcessEnv = {}
      hydrateProcessEnvFromFile(restored, envFile)
      expect(restored.PASCAL_IMAGE_MODEL).toBe('new-image-model')
      expect(restored.PASCAL_IMAGE_API_MODE).toBe('chat')
      expect(restored.PASCAL_IMAGE_API_KEY).toBe('sk-image-secret-8888')
      expect(restored.PASCAL_AGENT_MODEL).toBe('o3')
      expect(restored.PASCAL_AGENT_REASONING_EFFORT).toBe('high')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a failed disk write does not change active model settings', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pascal-env-write-'))
    const blocked = path.join(dir, 'file')
    writeFileSync(blocked, '')
    const env = { PASCAL_AGENT_MODEL: 'original' }
    try {
      expect(() =>
        persistHouseAgentEnv(
          { agent: { model: 'replacement' } },
          { env, envFilePath: path.join(blocked, '.env.local') },
        ),
      ).toThrow()
      expect(env.PASCAL_AGENT_MODEL).toBe('original')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects changing baseUrl without supplying a matching apiKey', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pascal-env-pair-'))
    const envFile = path.join(dir, '.env.local')
    writeFileSync(
      envFile,
      'PASCAL_AGENT_BASE_URL=https://api.openai.com/v1\nPASCAL_AGENT_API_KEY=sk-old-1111\n',
    )
    try {
      expect(() =>
        persistHouseAgentEnv(
          { agent: { baseUrl: 'https://other.example.com/v1', model: 'o3' } },
          { env: {} as NodeJS.ProcessEnv, envFilePath: envFile },
        ),
      ).toThrow(/API Key/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
