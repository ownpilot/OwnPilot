/**
 * Chat prompt helpers — system prompt init, execution context, demo mode.
 *
 * Extracted from chat.ts — contains buildExecutionSystemPrompt,
 * buildToolCatalog, generateDemoResponse, tryGetMessageBus.
 */

import {
  Services,
  getBaseName,
  type ToolDefinition,
  type ExecutionPermissions,
  type IMessageBus,
} from '@ownpilot/core';
import { tryGetService } from '../services/service-helpers.js';
import { AI_META_TOOL_NAMES } from '../config/defaults.js';

export const PERM_LABELS: Record<string, string> = {
  blocked: 'Blocked',
  prompt: 'Ask',
  allowed: 'Allow',
};
export const MODE_LABELS: Record<string, string> = {
  local: 'Local (host machine)',
  docker: 'Docker sandbox',
  auto: 'Auto (Docker if available, else local)',
};

export const EXEC_CATEGORIES = [
  'execute_javascript',
  'execute_python',
  'execute_shell',
  'compile_code',
  'package_manager',
] as const;

/**
 * Build execution context for the system prompt.
 * Moved from user message to system prompt so AI models treat it as core instructions.
 */
export function buildExecutionSystemPrompt(perms: ExecutionPermissions): string {
  if (!perms.enabled) {
    return '\n\n## Code Execution\nCode execution is DISABLED. Do not attempt to call execution tools.';
  }

  const modeDesc = MODE_LABELS[perms.mode] ?? perms.mode;

  // Build compact permission table: tool → Allow/Ask/Blocked
  const catLines = EXEC_CATEGORIES.map(
    (k) => `\`${k}\`: ${PERM_LABELS[perms[k]] ?? perms[k]}`
  ).join(' | ');

  let section = `\n\n## Code Execution`;
  section += `\nENABLED (${modeDesc}). When asked to run code, use the execution tool via \`use_tool\` — don't just explain.`;
  section += `\nPermissions: ${catLines}`;
  section += `\nAllow = run immediately, Ask = needs user approval, Blocked = don't attempt.`;

  if (perms.mode === 'docker') {
    section += '\ncompile_code and package_manager unavailable in Docker mode.';
  }

  return section;
}

/**
 * Build a minimal first-message context addendum.
 *
 * The system prompt already contains categorical capabilities and familiar
 * tool quick-references. This function only appends dynamic context that
 * cannot be known at system-prompt composition time:
 * - Custom data tables (user-created dynamic tables)
 * - Active custom/user-created tools
 */
export async function buildToolCatalog(allTools: readonly ToolDefinition[]): Promise<string> {
  const lines: string[] = [];

  // 1. List active custom/user-created tools (if any)
  const skipTools = new Set<string>(AI_META_TOOL_NAMES);
  const customTools = allTools.filter(
    (t) =>
      !skipTools.has(t.name) &&
      (t.category === 'Custom' || t.category === 'User' || t.category === 'Dynamic Tools')
  );
  if (customTools.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('## Active Custom & Extension Tools');
    lines.push('Call these with their qualified name shown below via use_tool.');
    for (const t of customTools) {
      const brief = t.brief ?? t.description.slice(0, 80);
      const displayName = getBaseName(t.name);
      lines.push(`  ${displayName} — ${brief}`);
    }
  }

  // 2. Fetch custom data tables
  try {
    const service = tryGetService(Services.Database);
    if (!service) throw new Error('no registry');
    const tables = await service.listTables();
    if (tables.length > 0) {
      if (lines.length === 0) {
        lines.push('');
        lines.push('---');
      }
      lines.push('');
      lines.push('## Custom Data Tables');
      for (const t of tables) {
        const display =
          t.displayName && t.displayName !== t.name ? `${t.displayName} (${t.name})` : t.name;
        lines.push(`  ${display}`);
      }
    }
  } catch {
    // Custom data not available — skip
  }

  return lines.join('\n');
}

/**
 * Generate demo response based on user message
 */
export function generateDemoResponse(message: string, provider: string, model: string): string {
  const providerName: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    zhipu: 'Zhipu AI (GLM)',
    deepseek: 'DeepSeek',
    groq: 'Groq',
    google: 'Google AI',
    xai: 'xAI',
    mistral: 'Mistral AI',
    together: 'Together AI',
    perplexity: 'Perplexity',
  };

  const name = providerName[provider] ?? provider;

  // Simple demo responses
  const lower = message.toLowerCase();

  if (lower.includes('help') || lower.includes('what can you')) {
    return `Hello! I'm running in **demo mode** using ${name} (${model}).\n\nTo enable full functionality, please configure your API key in Settings.\n\nIn demo mode, I can:\n- Show you the UI capabilities\n- Demonstrate the chat interface\n- Help you configure your API keys\n\nOnce configured, I'll be able to:\n- Answer questions with AI\n- Execute tools\n- Remember conversation context`;
  }

  if (lower.includes('capabilities')) {
    return `**OwnPilot Capabilities**\n\nThis is a privacy-first AI assistant platform. Currently in demo mode with ${name}.\n\n**Supported Providers:**\n- OpenAI (GPT-4o, o1, o1-mini)\n- Anthropic (Claude Sonnet 4, Opus 4)\n- Zhipu AI (GLM-4)\n- DeepSeek (DeepSeek-V3)\n- Groq (Llama 3.3)\n- Google AI (Gemini 1.5)\n- xAI (Grok 2)\n- And more!\n\n**Features:**\n- Multi-provider support\n- Tool/function calling\n- Conversation memory\n- Encrypted credential storage\n- Privacy-first design`;
  }

  if (lower.includes('tool')) {
    return `**Tools in OwnPilot**\n\nTools allow the AI to perform actions:\n\n- **get_current_time**: Get current date/time\n- **calculate**: Perform calculations\n- **search_web**: Search the internet\n- **read_file**: Read local files\n\nTo use tools, configure your API key and the AI will automatically use them when needed.`;
  }

  return `*Demo Mode Response*\n\nI received your message: "${message}"\n\nI'm currently running in demo mode with **${name}** (${model}). To get real AI responses, please configure your API key in the Settings page.\n\n---\n_This is a simulated response. Configure your API key for actual AI capabilities._`;
}

/**
 * Try to get the MessageBus from the ServiceRegistry.
 * Returns null if not available (graceful fallback to direct path).
 */
export function tryGetMessageBus(): IMessageBus | null {
  return tryGetService(Services.Message);
}
