import { randomUUID } from 'node:crypto'
import type { SessionEntry, SessionStore } from '../../core/session.js'
import { DEFAULT_COMPACTION_CONFIG } from '../../core/compaction.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { askCodexCliWithSession } from './session.js'
import { askCodexCli } from './provider.js'

vi.mock('./provider.js', () => ({
  askCodexCli: vi.fn(),
}))

function makeSessionMock(entries: SessionEntry[] = []): SessionStore {
  const store: SessionEntry[] = [...entries]

  return {
    id: 'test-session',
    appendUser: vi.fn(async (content: string | SessionEntry['message']['content'], provider = 'human') => {
      const e: SessionEntry = {
        type: 'user',
        message: { role: 'user', content },
        uuid: randomUUID(),
        parentUuid: store.length ? store[store.length - 1].uuid : null,
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
        provider,
      }
      store.push(e)
      return e
    }),
    appendAssistant: vi.fn(async (content: string | SessionEntry['message']['content'], provider = 'engine') => {
      const e: SessionEntry = {
        type: 'assistant',
        message: { role: 'assistant', content },
        uuid: randomUUID(),
        parentUuid: store.length ? store[store.length - 1].uuid : null,
        sessionId: 'test-session',
        timestamp: new Date().toISOString(),
        provider,
      }
      store.push(e)
      return e
    }),
    appendRaw: vi.fn(async () => {}),
    readAll: vi.fn(async () => [...store]),
    readActive: vi.fn(async () => [...store]),
    restore: vi.fn(async () => {}),
    exists: vi.fn(async () => store.length > 0),
  } as unknown as SessionStore
}

describe('askCodexCliWithSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends prompt, calls codex, and persists intermediate tool messages', async () => {
    vi.mocked(askCodexCli).mockResolvedValue({
      text: 'final answer',
      ok: true,
      media: [{ type: 'image', path: '/tmp/screenshot.png' }],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { path: 'a.txt' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'ok' }],
        },
      ],
    })

    const session = makeSessionMock()
    const result = await askCodexCliWithSession('hello', session, {
      codexCli: { sandbox: 'read-only' },
      compaction: DEFAULT_COMPACTION_CONFIG,
      systemPrompt: 'You are helpful',
    })

    expect(session.appendUser).toHaveBeenNthCalledWith(1, 'hello', 'human')
    expect(askCodexCli).toHaveBeenCalledWith(expect.stringContaining('hello'), expect.objectContaining({ sandbox: 'read-only' }))
    expect(session.appendAssistant).toHaveBeenCalledWith(
      [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { path: 'a.txt' } }],
      'codex-cli',
    )
    expect(session.appendUser).toHaveBeenNthCalledWith(
      2,
      [{ type: 'tool_result', tool_use_id: 'call-1', content: 'ok' }],
      'codex-cli',
    )
    expect(result).toEqual({
      text: 'final answer',
      media: [{ type: 'image', path: '/tmp/screenshot.png' }],
    })
  })
})
