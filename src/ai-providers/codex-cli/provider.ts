import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pino } from 'pino'
import type { ContentBlock } from '../../core/session.js'
import { extractMediaFromToolResultContent } from '../../core/media.js'
import { logToolCall } from '../log-tool-call.js'
import type { CodexCliConfig, CodexCliMessage, CodexCliResult, CodexSandboxMode } from './types.js'

const logger = pino({
  transport: { target: 'pino/file', options: { destination: 'logs/codex-cli.log', mkdir: true } },
})

const DEFAULT_SANDBOX: CodexSandboxMode = 'workspace-write'

function buildDeveloperInstructions(systemPrompt?: string, appendSystemPrompt?: string): string | undefined {
  const parts = [systemPrompt, appendSystemPrompt].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  )
  if (parts.length === 0) return undefined
  return parts.join('\n\n')
}

function toTomlString(value: string): string {
  // JSON string literal syntax is valid TOML basic string syntax.
  return JSON.stringify(value)
}

function parseJsonMaybe(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const text = raw.trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return raw
  }
}

function toToolResultContent(output: unknown): string {
  if (typeof output === 'string') return output
  if (output == null) return ''
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

function extractAssistantOutputText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const lines: string[] = []

  for (const part of content as Array<Record<string, unknown>>) {
    if (part.type === 'output_text' && typeof part.text === 'string') {
      lines.push(part.text)
    }
  }

  return lines.join('\n').trim()
}

/**
 * Spawn `codex exec` as a stateless child process and collect result + tool events.
 */
export async function askCodexCli(
  prompt: string,
  config: CodexCliConfig = {},
): Promise<CodexCliResult> {
  const {
    cwd = process.cwd(),
    sandbox = DEFAULT_SANDBOX,
    model,
    profile,
    systemPrompt,
    appendSystemPrompt,
    onToolResult,
  } = config

  const developerInstructions = buildDeveloperInstructions(systemPrompt, appendSystemPrompt)
  const tempDir = await mkdtemp(join(tmpdir(), 'openalice-codex-'))
  const outputFile = join(tempDir, 'last-message.txt')

  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--output-last-message', outputFile,
    '--sandbox', sandbox,
  ]

  if (model) {
    args.push('--model', model)
  }

  if (profile) {
    args.push('--profile', profile)
  }

  if (developerInstructions) {
    args.push('-c', `developer_instructions=${toTomlString(developerInstructions)}`)
  }

  args.push(prompt)

  try {
    return await new Promise<CodexCliResult>((resolve, reject) => {
      const child = spawn('codex', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      let buffer = ''
      let stderr = ''
      let stdoutNoise = ''
      let parsedFinalText = ''
      let turnFailed = false

      const messages: CodexCliMessage[] = []
      const media = [] as CodexCliResult['media']

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()

        let newlineIdx: number
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          if (!line) continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(line) as Record<string, unknown>
          } catch {
            stdoutNoise += line + '\n'
            continue
          }

          if (event.type === 'error' && typeof event.message === 'string') {
            logger.warn({ message: event.message }, 'codex_stream_error')
            continue
          }

          if (event.type === 'turn.failed') {
            turnFailed = true
            const errorObj = event.error as Record<string, unknown> | undefined
            if (errorObj && typeof errorObj.message === 'string') {
              stderr += errorObj.message + '\n'
            }
            continue
          }

          if (event.type !== 'response_item' || typeof event.payload !== 'object' || event.payload == null) {
            continue
          }

          const payload = event.payload as Record<string, unknown>

          if (payload.type === 'function_call') {
            const callId = typeof payload.call_id === 'string' && payload.call_id
              ? payload.call_id
              : `call-${messages.length + 1}`
            const name = typeof payload.name === 'string' && payload.name
              ? payload.name
              : 'unknown'
            const input = parseJsonMaybe(payload.arguments)

            logToolCall(name, input)
            logger.info({ callId, name, input }, 'tool_use')

            const blocks: ContentBlock[] = [{ type: 'tool_use', id: callId, name, input }]
            messages.push({ role: 'assistant', content: blocks })
            continue
          }

          if (payload.type === 'function_call_output') {
            const toolUseId = typeof payload.call_id === 'string' && payload.call_id
              ? payload.call_id
              : 'unknown'
            const content = toToolResultContent(payload.output)

            logger.info({ toolUseId, content: content.slice(0, 500) }, 'tool_result')
            messages.push({
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
            })

            onToolResult?.({ toolUseId, content })
            media.push(...extractMediaFromToolResultContent(content))
            continue
          }

          if (payload.type === 'message' && payload.role === 'assistant') {
            const text = extractAssistantOutputText(payload.content)
            if (text) {
              parsedFinalText = text
              messages.push({ role: 'assistant', content: [{ type: 'text', text }] })
            }
          }
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      child.on('error', (err) => {
        logger.error({ error: err.message }, 'spawn_error')
        reject(new Error(`Failed to spawn codex CLI: ${err.message}`))
      })

      child.on('close', (code) => {
        void (async () => {
          let finalText = ''
          try {
            finalText = (await readFile(outputFile, 'utf-8')).trim()
          } catch {
            // ignore missing output file
          }

          if (!finalText) {
            finalText = parsedFinalText.trim()
          }

          if (!finalText && code !== 0) {
            finalText = (stderr || stdoutNoise).trim()
          }

          if (!finalText) {
            finalText = '(no output)'
          }

          const ok = code === 0 && !turnFailed
          if (!ok) {
            const reason = turnFailed
              ? 'Codex CLI turn failed'
              : `Codex CLI exited with code ${code}`
            finalText = `${reason}:\n${(stderr || stdoutNoise || finalText).trim()}`
            logger.error({ code, turnFailed, stderr: stderr.slice(0, 500) }, 'exit_error')
          }

          resolve({ text: finalText, ok, messages, media })
        })().catch(reject)
      })
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
