import { EventEmitter } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

import { askCodexCli } from './provider.js'

type MockChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
}

function makeChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('askCodexCli', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('parses function_call/function_call_output and extracts media', async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild()
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'call-1',
            name: 'Read',
            arguments: '{"path":"data/brain/persona.md"}',
          },
        }) + '\n'))

        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-1',
            output: '{"content":[{"type":"text","text":"MEDIA:/tmp/test.png"}]}',
          },
        }) + '\n'))

        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'done' }],
          },
        }) + '\n'))

        child.emit('close', 0)
      }, 0)
      return child
    })

    const result = await askCodexCli('hello', { sandbox: 'read-only' })

    expect(result.ok).toBe(true)
    expect(result.text).toBe('done')
    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { path: 'data/brain/persona.md' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"content":[{"type":"text","text":"MEDIA:/tmp/test.png"}]}' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
      },
    ])
    expect(result.media).toEqual([{ type: 'image', path: '/tmp/test.png' }])
  })

  it('prefers output-last-message file when available', async () => {
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const child = makeChild()
      const idx = args.indexOf('--output-last-message')
      const outputFile = args[idx + 1]

      setTimeout(async () => {
        await writeFile(outputFile, 'from-file\n')
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'stream-text' }],
          },
        }) + '\n'))
        child.emit('close', 0)
      }, 0)

      return child
    })

    const result = await askCodexCli('hello')
    expect(result.ok).toBe(true)
    expect(result.text).toBe('from-file')
  })

  it('returns failure text when turn fails', async () => {
    spawnMock.mockImplementation(() => {
      const child = makeChild()
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'turn.failed',
          error: { message: 'boom' },
        }) + '\n'))
        child.emit('close', 1)
      }, 0)
      return child
    })

    const result = await askCodexCli('hello')
    expect(result.ok).toBe(false)
    expect(result.text).toContain('turn failed')
    expect(result.text).toContain('boom')
  })
})
