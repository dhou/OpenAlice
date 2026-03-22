import { resolve } from 'node:path'
import type { CompactionConfig } from '../../core/compaction.js'
import type { SessionEntry } from '../../core/session.js'
import type { AIProvider, GenerateOpts, ProviderEvent, ProviderResult } from '../types.js'
import type { CodexCliConfig } from './types.js'
import { toTextHistory } from '../../core/session.js'
import { readAgentConfig } from '../../core/config.js'
import { buildChatHistoryPrompt, DEFAULT_MAX_HISTORY } from '../utils.js'
import { askCodexCli } from './provider.js'

export class CodexCliProvider implements AIProvider {
  readonly providerTag = 'codex-cli' as const

  constructor(
    private _compaction: CompactionConfig,
    private systemPrompt?: string,
  ) {}

  private async resolveConfig(): Promise<CodexCliConfig> {
    const agent = await readAgentConfig()
    const evolutionMode = agent.evolutionMode
    return {
      ...agent.codexCli,
      evolutionMode,
      cwd: evolutionMode ? process.cwd() : resolve('data/brain'),
      sandbox: agent.codexCli.sandbox ?? 'workspace-write',
    }
  }

  async ask(prompt: string): Promise<ProviderResult> {
    const config = await this.resolveConfig()
    const result = await askCodexCli(prompt, {
      ...config,
      systemPrompt: this.systemPrompt,
    })
    return { text: result.text, media: result.media }
  }

  async *generate(entries: SessionEntry[], prompt: string, opts?: GenerateOpts): AsyncGenerator<ProviderEvent> {
    const maxHistory = opts?.maxHistoryEntries ?? DEFAULT_MAX_HISTORY
    const textHistory = toTextHistory(entries).slice(-maxHistory)
    const fullPrompt = buildChatHistoryPrompt(prompt, textHistory, opts?.historyPreamble)

    const config = await this.resolveConfig()
    const result = await askCodexCli(fullPrompt, {
      ...config,
      systemPrompt: opts?.systemPrompt ?? this.systemPrompt,
    })

    for (const msg of result.messages) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          yield { type: 'tool_use', id: block.id, name: block.name, input: block.input }
        } else if (block.type === 'tool_result') {
          yield { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content }
        } else if (block.type === 'text') {
          yield { type: 'text', text: block.text }
        }
      }
    }

    const prefix = result.ok ? '' : '[error] '
    yield { type: 'done', result: { text: prefix + result.text, media: result.media } }
  }
}
