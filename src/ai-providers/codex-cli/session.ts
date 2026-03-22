import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { MediaAttachment } from '../../core/types.js'
import type { CodexCliConfig } from './types.js'
import { toTextHistory } from '../../core/session.js'
import { compactIfNeeded } from '../../core/compaction.js'
import { askCodexCli } from './provider.js'

export interface CodexCliSessionConfig {
  /** Config passed through to askCodexCli. */
  codexCli: CodexCliConfig
  /** Compaction config for auto-summarization. */
  compaction: CompactionConfig
  /** Optional instructions forwarded to Codex CLI via `developer_instructions`. */
  systemPrompt?: string
  /** Max text history entries to include in <chat_history>. Default: 50. */
  maxHistoryEntries?: number
  /** Preamble text inside <chat_history> block. */
  historyPreamble?: string
}

export interface CodexCliSessionResult {
  text: string
  media: MediaAttachment[]
}

const DEFAULT_MAX_HISTORY = 50
const DEFAULT_PREAMBLE =
  'The following is the recent conversation history. Use it as context if it references earlier events or decisions.'

export async function askCodexCliWithSession(
  prompt: string,
  session: SessionStore,
  config: CodexCliSessionConfig,
): Promise<CodexCliSessionResult> {
  const maxHistory = config.maxHistoryEntries ?? DEFAULT_MAX_HISTORY
  const preamble = config.historyPreamble ?? DEFAULT_PREAMBLE

  // 1. Append user message to session
  await session.appendUser(prompt, 'human')

  // 2. Compact if needed
  const compactionResult = await compactIfNeeded(
    session,
    config.compaction,
    async (summarizePrompt) => {
      const r = await askCodexCli(summarizePrompt, {
        ...config.codexCli,
        sandbox: 'read-only',
      })
      return r.text
    },
  )

  // 3. Build text history
  const entries = compactionResult.activeEntries ?? await session.readActive()
  const textHistory = toTextHistory(entries).slice(-maxHistory)

  // 4. Construct full prompt
  const promptParts: string[] = []

  if (textHistory.length > 0) {
    const lines = textHistory.map((entry) => {
      const tag = entry.role === 'user' ? 'User' : 'Bot'
      return `[${tag}] ${entry.text}`
    })
    promptParts.push('<chat_history>')
    promptParts.push(preamble)
    promptParts.push('')
    promptParts.push(...lines)
    promptParts.push('</chat_history>')
    promptParts.push('')
  }

  promptParts.push(prompt)
  const fullPrompt = promptParts.join('\n')

  // 5. Run Codex CLI
  const result = await askCodexCli(fullPrompt, {
    ...config.codexCli,
    systemPrompt: config.systemPrompt,
  })

  // 6. Persist intermediate messages (tool calls + results)
  for (const msg of result.messages) {
    if (msg.role === 'assistant') {
      await session.appendAssistant(msg.content, 'codex-cli')
    } else {
      await session.appendUser(msg.content, 'codex-cli')
    }
  }

  // 7. Return unified result
  const prefix = result.ok ? '' : '[error] '
  return { text: prefix + result.text, media: result.media }
}
