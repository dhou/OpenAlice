import { resolve } from 'node:path'
import type { AIProvider, AskOptions, ProviderResult } from '../../core/ai-provider.js'
import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { CodexCliConfig } from './types.js'
import { readAgentConfig } from '../../core/config.js'
import { askCodexCli } from './provider.js'
import { askCodexCliWithSession } from './session.js'

export class CodexCliProvider implements AIProvider {
  constructor(
    private compaction: CompactionConfig,
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
    const result = await askCodexCli(prompt, config)
    return { text: result.text, media: result.media }
  }

  async askWithSession(prompt: string, session: SessionStore, opts?: AskOptions): Promise<ProviderResult> {
    const config = await this.resolveConfig()
    return askCodexCliWithSession(prompt, session, {
      codexCli: config,
      compaction: this.compaction,
      ...opts,
      systemPrompt: opts?.systemPrompt ?? this.systemPrompt,
    })
  }
}
