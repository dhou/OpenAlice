import type { ContentBlock } from '../../core/session.js'
import type { MediaAttachment } from '../../core/types.js'

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export interface CodexCliConfig {
  /** When true, run from project root; otherwise restrict to data/brain by default. */
  evolutionMode?: boolean
  /** Working directory for the Codex CLI process. */
  cwd?: string
  /** Codex CLI sandbox mode. Default: workspace-write */
  sandbox?: CodexSandboxMode
  /** Optional Codex model override. */
  model?: string
  /** Optional Codex profile name from ~/.codex/config.toml. */
  profile?: string
  /** Optional instructions forwarded to Codex CLI via `developer_instructions`. */
  systemPrompt?: string
  /** Extra instructions appended to `systemPrompt` in `developer_instructions`. */
  appendSystemPrompt?: string
  /** Called for each parsed function call payload. */
  onToolUse?: (toolUse: { id: string; name: string; input: unknown }) => void
  /** Called for each parsed function call output payload. */
  onToolResult?: (toolResult: { toolUseId: string; content: string }) => void
  /** Called for each assistant text chunk parsed from the stream. */
  onText?: (text: string) => void
}

export interface CodexCliMessage {
  role: 'assistant' | 'user'
  content: ContentBlock[]
}

export interface CodexCliResult {
  /** Final text response from Codex. */
  text: string
  /** Whether the run completed successfully. */
  ok: boolean
  /** Intermediate tool messages reconstructed from Codex JSON events. */
  messages: CodexCliMessage[]
  /** Media attachments extracted from tool outputs. */
  media: MediaAttachment[]
}
