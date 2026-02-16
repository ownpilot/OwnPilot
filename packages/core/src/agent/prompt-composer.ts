/**
 * Dynamic System Prompt Composer
 *
 * Generates context-aware system prompts that include:
 * - User profile information (name, preferences, communication style)
 * - Available tools with descriptions
 * - Custom instructions from memory
 * - Contextual information (time, location, etc.)
 *
 * This enables the LLM to have full awareness of its capabilities
 * and the user it's interacting with.
 */

import type { ToolDefinition } from './types.js';
import type { UserProfile } from '../memory/conversation.js';
import { TOOL_GROUPS, FAMILIAR_TOOLS, TOOL_CATEGORY_CAPABILITIES } from './tool-config.js';
import { getBaseName } from './tool-namespace.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Workspace context for file operations
 */
export interface WorkspaceContext {
  /** The workspace directory path where files can be saved */
  workspaceDir: string;
  /** Home directory */
  homeDir?: string;
  /** Temp directory */
  tempDir?: string;
}

/**
 * Prompt composition context
 */
export interface PromptContext {
  /** Base system prompt for the agent */
  basePrompt: string;
  /** User profile (if available) */
  userProfile?: UserProfile;
  /** Available tools */
  tools?: readonly ToolDefinition[];
  /** Custom instructions from user */
  customInstructions?: string[];
  /** Current time context */
  timeContext?: TimeContext;
  /** Agent capabilities */
  capabilities?: AgentCapabilities;
  /** Conversation context */
  conversationContext?: PromptConversationContext;
  /** Workspace context for file operations */
  workspaceContext?: WorkspaceContext;
}

/**
 * Time context for the prompt
 */
export interface TimeContext {
  /** Current date/time */
  currentTime: Date;
  /** User's timezone (if known) */
  timezone?: string;
  /** Day of week */
  dayOfWeek: string;
  /** Time of day (morning, afternoon, evening, night) */
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
}

/**
 * Agent capabilities
 */
export interface AgentCapabilities {
  /** Can execute code */
  codeExecution?: boolean;
  /** Can access files */
  fileAccess?: boolean;
  /** Can browse web */
  webBrowsing?: boolean;
  /** Can remember conversations */
  memory?: boolean;
  /** Can schedule tasks */
  scheduling?: boolean;
  /** Can access external services */
  externalServices?: string[];
  /** Autonomous operation level */
  autonomyLevel?: 'none' | 'low' | 'medium' | 'high' | 'full';
}

/**
 * Conversation context
 */
export interface PromptConversationContext {
  /** Number of messages in conversation */
  messageCount: number;
  /** Main topics discussed */
  topics?: string[];
  /** Current task (if any) */
  currentTask?: string;
  /** Previous conversation summary (if resuming) */
  previousSummary?: string;
}

/**
 * Prompt composition options
 */
export interface PromptComposerOptions {
  /** Include tool descriptions in prompt */
  includeToolDescriptions?: boolean;
  /** Include user profile in prompt */
  includeUserProfile?: boolean;
  /** Include time context */
  includeTimeContext?: boolean;
  /** Include capabilities section */
  includeCapabilities?: boolean;
  /** Maximum prompt length (characters) */
  maxPromptLength?: number;
}

// =============================================================================
// Prompt Templates
// =============================================================================

const PROMPT_SECTIONS = {
  userProfile: `## About the User
{{userInfo}}`,

  workspace: `## File System Access
You have file system tools for reading, writing, listing, searching, and downloading files.

**Allowed directories for file operations:**
{{allowedDirs}}

**Important**: When saving files, always use the workspace directory. Example paths:
- Save to workspace: \`{{workspaceDir}}/my-file.txt\`
- Temporary files: \`{{tempDir}}/temp-file.txt\`

Do NOT attempt to write files outside these directories - access will be denied.`,

  tools: `## Available Tools
You have access to the following tools. Use them proactively to help the user:

{{toolList}}

**Important**: When a task can be accomplished using a tool, use it immediately. Don't ask for permission unless the action is destructive or irreversible.`,

  capabilities: `## Your Capabilities
{{capabilitiesList}}`,

  timeContext: `## Current Context
- Current time: {{time}}
- Day: {{dayOfWeek}}
- User's timezone: {{timezone}}`,

  customInstructions: `## Custom Instructions
The user has provided the following instructions. Always follow them:

{{instructions}}`,

  conversationContext: `## Conversation Context
{{contextInfo}}`,

  automation: `## Automation
You can create **triggers** (recurring automated actions) and **plans** (multi-step workflows).
Use search_tools("trigger") or search_tools("plan") to discover automation tools.
Use get_tool_help with tool_names array to get parameter docs for multiple tools at once.`,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get current time context
 */
export function getTimeContext(timezone?: string): TimeContext {
  const now = new Date();
  const hour = now.getHours();

  let timeOfDay: TimeContext['timeOfDay'];
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

  return {
    currentTime: now,
    timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayOfWeek: days[now.getDay()] ?? 'Unknown',
    timeOfDay,
  };
}

/**
 * Format user profile for prompt
 */
function formatUserProfile(profile: UserProfile): string {
  const lines: string[] = [];

  if (profile.name) {
    lines.push(`- Name: ${profile.name}`);
  }

  // Add facts
  if (profile.facts.length > 0) {
    const highConfidenceFacts = profile.facts
      .filter(f => f.confidence >= 0.7)
      .slice(0, 10);

    for (const fact of highConfidenceFacts) {
      lines.push(`- ${fact.key}: ${fact.value}`);
    }
  }

  // Add communication style
  if (profile.communicationStyle) {
    const style = profile.communicationStyle;
    if (style.formality !== 'mixed') {
      lines.push(`- Prefers ${style.formality} communication`);
    }
    if (style.verbosity !== 'mixed') {
      lines.push(`- Prefers ${style.verbosity} responses`);
    }
    if (style.language) {
      lines.push(`- Primary language: ${style.language}`);
    }
    if (style.timezone) {
      lines.push(`- Timezone: ${style.timezone}`);
    }
  }

  // Add interests
  if (profile.interests.length > 0) {
    const topInterests = profile.interests.slice(0, 5).join(', ');
    lines.push(`- Interests: ${topInterests}`);
  }

  // Add goals
  if (profile.goals.length > 0) {
    const topGoals = profile.goals.slice(0, 3).join('; ');
    lines.push(`- Current goals: ${topGoals}`);
  }

  return lines.join('\n');
}

/**
 * Map a display category name to its TOOL_GROUPS key.
 * Falls back to lowercase concatenation.
 */
function categoryToGroupId(category: string): string {
  for (const [id, group] of Object.entries(TOOL_GROUPS)) {
    if (group.name === category) return id;
  }
  return category.toLowerCase().replace(/[\s&]+/g, '');
}

/**
 * Format tools for prompt — categorical capabilities + usage strategy + familiar tools
 */
function formatTools(tools: readonly ToolDefinition[]): string {
  if (tools.length === 0) {
    return 'No tools available.';
  }

  // Group tools by category and count
  const categoryCounts = new Map<string, number>();
  for (const tool of tools) {
    const category = tool.category ?? 'General';
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  // Build categorical capabilities
  const capabilityLines: string[] = [];
  for (const [category, count] of categoryCounts.entries()) {
    const groupId = categoryToGroupId(category);
    const capability = TOOL_CATEGORY_CAPABILITIES[groupId] ?? `${category} operations`;
    capabilityLines.push(`- **${category}** (${count}): ${capability}`);
  }

  // Build familiar tools quick-reference
  const familiarToolLines: string[] = [];
  for (const tool of tools) {
    if (FAMILIAR_TOOLS.has(getBaseName(tool.name))) {
      const brief = tool.brief ?? tool.description.slice(0, 60);
      familiarToolLines.push(`  ${tool.name} — ${brief}`);
    }
  }

  const sections: string[] = [];

  // 1. Overview
  sections.push(`${tools.length} tools available across ${categoryCounts.size} categories:`);
  sections.push('');
  sections.push(capabilityLines.join('\n'));

  // 2. Strategy section
  sections.push('');
  sections.push('### How to Use Tools');
  sections.push('');
  sections.push('**Discovery flow:**');
  sections.push('1. For common tasks (see Familiar Tools below), call `use_tool` directly.');
  sections.push('2. For unfamiliar tasks, call `search_tools("keyword")` — results include parameter docs.');
  sections.push('3. For detailed parameter info, call `get_tool_help("tool_name")` or pass `tool_names` array for batch lookup.');
  sections.push('');
  sections.push('**Parallel execution:**');
  sections.push('- Use `batch_use_tool` with an array of `{ tool_name, arguments }` for independent operations. Faster than sequential calls.');
  sections.push('');
  sections.push('**Error handling:**');
  sections.push('- On error, read the error message — it shows the correct parameter schema. Fix and retry.');
  sections.push('- Tool not found → use `search_tools` to discover the correct name.');
  sections.push('');
  sections.push('**Custom tools:**');
  sections.push('- Users may have custom tools. Use `search_tools` to discover them.');
  sections.push('- Use `create_tool` to build new reusable tools when needed.');

  // 3. Familiar tools quick-reference
  if (familiarToolLines.length > 0) {
    sections.push('');
    sections.push('### Familiar Tools (call directly via use_tool)');
    sections.push(familiarToolLines.join('\n'));
  }

  return sections.join('\n');
}

/**
 * Format capabilities for prompt
 */
function formatCapabilities(caps: AgentCapabilities): string {
  const lines: string[] = [];

  const capLabels: Record<string, string> = {
    codeExecution: 'Execute code and scripts',
    fileAccess: 'Read and write files',
    webBrowsing: 'Browse the web and fetch content',
    memory: 'Remember information across conversations',
    scheduling: 'Schedule tasks and reminders',
  };

  for (const [key, enabled] of Object.entries(caps)) {
    if (key === 'externalServices' || key === 'autonomyLevel') continue;
    if (enabled && capLabels[key]) {
      lines.push(`- ✓ ${capLabels[key]}`);
    }
  }

  if (caps.externalServices && caps.externalServices.length > 0) {
    const services = caps.externalServices.join(', ');
    lines.push(`- ✓ Access to external services: ${services}`);
  }

  return lines.join('\n');
}

// =============================================================================
// Main Composer Class
// =============================================================================

/**
 * System Prompt Composer
 *
 * Composes dynamic system prompts based on context.
 */
export class PromptComposer {
  private readonly options: Required<PromptComposerOptions>;

  constructor(options: PromptComposerOptions = {}) {
    this.options = {
      includeToolDescriptions: options.includeToolDescriptions ?? true,
      includeUserProfile: options.includeUserProfile ?? true,
      includeTimeContext: options.includeTimeContext ?? true,
      includeCapabilities: options.includeCapabilities ?? true,
      maxPromptLength: options.maxPromptLength ?? 6000,
    };
  }

  /**
   * Compose a complete system prompt
   */
  compose(context: PromptContext): string {
    const sections: string[] = [];

    // 1. Base prompt
    sections.push(context.basePrompt);

    // 2. User profile
    if (this.options.includeUserProfile && context.userProfile) {
      const userInfo = formatUserProfile(context.userProfile);
      if (userInfo) {
        sections.push(PROMPT_SECTIONS.userProfile.replace('{{userInfo}}', userInfo));
      }
    }

    // 3. Custom instructions
    if (context.customInstructions && context.customInstructions.length > 0) {
      const instructions = context.customInstructions.map(i => `- ${i}`).join('\n');
      sections.push(PROMPT_SECTIONS.customInstructions.replace('{{instructions}}', instructions));
    }

    // 4. Available tools
    if (this.options.includeToolDescriptions && context.tools && context.tools.length > 0) {
      const toolList = formatTools(context.tools);
      sections.push(PROMPT_SECTIONS.tools.replace('{{toolList}}', toolList));

      // 4a. Automation context (only if automation tools are registered)
      const hasAutomationTools = context.tools.some(
        (t) => {
          const baseName = getBaseName(t.name);
          return t.category === 'Automation' || baseName.startsWith('create_trigger') || baseName.startsWith('create_plan');
        }
      );
      if (hasAutomationTools) {
        sections.push(PROMPT_SECTIONS.automation);
      }
    }

    // 4b. Workspace context (for file operations)
    if (context.workspaceContext) {
      const ws = context.workspaceContext;
      const allowedDirs: string[] = [];
      allowedDirs.push(`- Workspace: \`${ws.workspaceDir}\``);
      if (ws.homeDir) allowedDirs.push(`- Home: \`${ws.homeDir}\``);
      if (ws.tempDir) allowedDirs.push(`- Temp: \`${ws.tempDir}\``);

      sections.push(
        PROMPT_SECTIONS.workspace
          .replace('{{allowedDirs}}', allowedDirs.join('\n'))
          .replace(/\{\{workspaceDir\}\}/g, ws.workspaceDir)
          .replace(/\{\{tempDir\}\}/g, ws.tempDir ?? '/tmp')
      );
    }

    // 5. Capabilities
    if (this.options.includeCapabilities && context.capabilities) {
      const capsList = formatCapabilities(context.capabilities);
      if (capsList) {
        sections.push(PROMPT_SECTIONS.capabilities.replace('{{capabilitiesList}}', capsList));
      }

    }

    // 6. Time context
    if (this.options.includeTimeContext && context.timeContext) {
      const tc = context.timeContext;
      sections.push(
        PROMPT_SECTIONS.timeContext
          .replace('{{time}}', tc.currentTime.toLocaleString())
          .replace('{{dayOfWeek}}', tc.dayOfWeek)
          .replace('{{timezone}}', tc.timezone ?? 'Unknown')
      );
    }

    // 7. Conversation context
    if (context.conversationContext) {
      const cc = context.conversationContext;
      const contextLines: string[] = [];

      if (cc.messageCount > 0) {
        contextLines.push(`- Messages in this conversation: ${cc.messageCount}`);
      }
      if (cc.topics && cc.topics.length > 0) {
        contextLines.push(`- Topics discussed: ${cc.topics.join(', ')}`);
      }
      if (cc.currentTask) {
        contextLines.push(`- Current task: ${cc.currentTask}`);
      }
      if (cc.previousSummary) {
        contextLines.push(`- Previous conversation summary: ${cc.previousSummary}`);
      }

      if (contextLines.length > 0) {
        sections.push(PROMPT_SECTIONS.conversationContext.replace('{{contextInfo}}', contextLines.join('\n')));
      }
    }

    // Combine all sections
    let prompt = sections.join('\n\n---\n\n');

    // Truncate if too long
    if (prompt.length > this.options.maxPromptLength) {
      prompt = this.truncatePrompt(prompt, this.options.maxPromptLength);
    }

    return prompt;
  }

  /**
   * Truncate prompt while preserving structure
   */
  private truncatePrompt(prompt: string, maxLength: number): string {
    if (prompt.length <= maxLength) return prompt;

    // Split by section dividers
    const sections = prompt.split('\n\n---\n\n');

    // Always keep first section (base prompt)
    const firstSection = sections[0] ?? '';
    const result = [firstSection];
    let currentLength = firstSection.length;

    // Add sections until we exceed limit
    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      if (!section) continue;
      const sectionLength = section.length + 7; // +7 for divider
      if (currentLength + sectionLength <= maxLength) {
        result.push(section);
        currentLength += sectionLength;
      }
    }

    return result.join('\n\n---\n\n');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a prompt composer with default options
 */
export function createPromptComposer(
  options?: PromptComposerOptions
): PromptComposer {
  return new PromptComposer(options);
}

/**
 * Compose a system prompt with default settings
 */
export function composeSystemPrompt(context: PromptContext): string {
  const composer = createPromptComposer();
  return composer.compose(context);
}
