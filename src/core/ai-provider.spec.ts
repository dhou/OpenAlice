import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIProvider } from './ai-provider.js'
import type { SessionStore } from './session.js'
import { ProviderRouter } from './ai-provider.js'
import { readAIProviderConfig } from './config.js'

vi.mock('./config.js', () => ({
  readAIProviderConfig: vi.fn(),
}))

function makeProvider(text: string): AIProvider {
  return {
    ask: vi.fn(async () => ({ text, media: [] })),
    askWithSession: vi.fn(async () => ({ text: `${text}-session`, media: [] })),
  }
}

describe('ProviderRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches to codex-cli backend when selected', async () => {
    vi.mocked(readAIProviderConfig).mockResolvedValue({ backend: 'codex-cli' } as Awaited<ReturnType<typeof readAIProviderConfig>>)

    const vercel = makeProvider('vercel')
    const claude = makeProvider('claude')
    const codex = makeProvider('codex')
    const router = new ProviderRouter(vercel, claude, codex)

    const result = await router.ask('hello')

    expect(codex.ask).toHaveBeenCalledWith('hello')
    expect(result.text).toBe('codex')
  })

  it('falls back to vercel when codex backend is selected but provider is unavailable', async () => {
    vi.mocked(readAIProviderConfig).mockResolvedValue({ backend: 'codex-cli' } as Awaited<ReturnType<typeof readAIProviderConfig>>)

    const vercel = makeProvider('vercel')
    const claude = makeProvider('claude')
    const router = new ProviderRouter(vercel, claude, null)

    const result = await router.ask('hello')

    expect(vercel.ask).toHaveBeenCalledWith('hello')
    expect(result.text).toBe('vercel')
  })

  it('dispatches askWithSession to codex provider', async () => {
    vi.mocked(readAIProviderConfig).mockResolvedValue({ backend: 'codex-cli' } as Awaited<ReturnType<typeof readAIProviderConfig>>)

    const vercel = makeProvider('vercel')
    const claude = makeProvider('claude')
    const codex = makeProvider('codex')
    const router = new ProviderRouter(vercel, claude, codex)

    const session = { id: 's' } as SessionStore
    const result = await router.askWithSession('hello', session)

    expect(codex.askWithSession).toHaveBeenCalledWith('hello', session, undefined)
    expect(result.text).toBe('codex-session')
  })
})
