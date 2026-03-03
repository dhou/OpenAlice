import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfigRoutes } from './config.js'
import { writeAIConfig } from '../../../core/ai-config.js'

vi.mock('../../../core/config.js', () => ({
  loadConfig: vi.fn(),
  writeConfigSection: vi.fn(),
  readAIProviderConfig: vi.fn(),
  readOpenbbConfig: vi.fn(),
  validSections: ['aiProvider'],
}))

vi.mock('../../../core/ai-config.js', () => ({
  readAIConfig: vi.fn(),
  writeAIConfig: vi.fn(),
}))

describe('createConfigRoutes /ai-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts codex-cli backend', async () => {
    const app = createConfigRoutes()

    const res = await app.request('/ai-provider', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'codex-cli' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ backend: 'codex-cli' })
    expect(writeAIConfig).toHaveBeenCalledWith('codex-cli')
  })

  it('rejects unsupported backend values', async () => {
    const app = createConfigRoutes()

    const res = await app.request('/ai-provider', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'not-real' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid backend')
  })
})
