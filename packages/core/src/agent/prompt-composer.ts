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
  /** Language for prompts */
  language?: 'en' | 'tr' | 'auto';
}

// =============================================================================
// Prompt Templates
// =============================================================================

const PROMPT_SECTIONS = {
  userProfile: {
    en: `## About the User
{{userInfo}}`,
    tr: `## Kullanıcı Hakkında
{{userInfo}}`,
  },

  workspace: {
    en: `## File System Access
You have access to file system tools (read_file, write_file, list_directory, etc.).

**Allowed directories for file operations:**
{{allowedDirs}}

**Important**: When saving files, always use the workspace directory. Example paths:
- Save to workspace: \`{{workspaceDir}}/my-file.txt\`
- Temporary files: \`{{tempDir}}/temp-file.txt\`

Do NOT attempt to write files outside these directories - access will be denied.`,
    tr: `## Dosya Sistemi Erişimi
Dosya sistemi araçlarına erişiminiz var (read_file, write_file, list_directory, vb.).

**Dosya işlemleri için izin verilen dizinler:**
{{allowedDirs}}

**Önemli**: Dosya kaydederken her zaman workspace dizinini kullanın. Örnek yollar:
- Workspace'e kaydet: \`{{workspaceDir}}/dosya.txt\`
- Geçici dosyalar: \`{{tempDir}}/gecici-dosya.txt\`

Bu dizinlerin dışına dosya yazmaya çalışmayın - erişim reddedilecektir.`,
  },

  tools: {
    en: `## Available Tools
You have access to the following tools. Use them proactively to help the user:

{{toolList}}

**Important**: When a task can be accomplished using a tool, use it immediately. Don't ask for permission unless the action is destructive or irreversible.`,
    tr: `## Mevcut Araçlar
Aşağıdaki araçlara erişiminiz var. Kullanıcıya yardımcı olmak için bunları proaktif olarak kullanın:

{{toolList}}

**Önemli**: Bir görev araç kullanılarak yapılabiliyorsa, hemen kullanın. Eylem yıkıcı veya geri alınamaz olmadıkça izin istemeyin.`,
  },

  capabilities: {
    en: `## Your Capabilities
{{capabilitiesList}}`,
    tr: `## Yetenekleriniz
{{capabilitiesList}}`,
  },

  timeContext: {
    en: `## Current Context
- Current time: {{time}}
- Day: {{dayOfWeek}}
- User's timezone: {{timezone}}`,
    tr: `## Mevcut Bağlam
- Şu anki zaman: {{time}}
- Gün: {{dayOfWeek}}
- Kullanıcının saat dilimi: {{timezone}}`,
  },

  customInstructions: {
    en: `## Custom Instructions
The user has provided the following instructions. Always follow them:

{{instructions}}`,
    tr: `## Özel Talimatlar
Kullanıcı aşağıdaki talimatları verdi. Her zaman bunlara uyun:

{{instructions}}`,
  },

  conversationContext: {
    en: `## Conversation Context
{{contextInfo}}`,
    tr: `## Konuşma Bağlamı
{{contextInfo}}`,
  },

  autonomyGuidelines: {
    en: `## Autonomy Guidelines
Your autonomy level is set to: {{level}}

{{guidelines}}`,
    tr: `## Otonomi Yönergeleri
Otonomi seviyeniz: {{level}}

{{guidelines}}`,
  },
};

const AUTONOMY_GUIDELINES: Record<string, { en: string; tr: string }> = {
  none: {
    en: 'Ask for explicit permission before taking any action.',
    tr: 'Herhangi bir işlem yapmadan önce açık izin isteyin.',
  },
  low: {
    en: 'You can perform read-only operations freely. Ask permission for any modifications.',
    tr: 'Salt okunur işlemleri serbestçe yapabilirsiniz. Herhangi bir değişiklik için izin isteyin.',
  },
  medium: {
    en: 'You can perform most operations freely. Ask permission for destructive or irreversible actions.',
    tr: 'Çoğu işlemi serbestçe yapabilirsiniz. Yıkıcı veya geri alınamaz eylemler için izin isteyin.',
  },
  high: {
    en: 'You can perform almost all operations autonomously. Only ask for truly destructive actions.',
    tr: 'Neredeyse tüm işlemleri otonom olarak yapabilirsiniz. Sadece gerçekten yıkıcı eylemler için sorun.',
  },
  full: {
    en: 'You have full autonomy. Take action immediately to accomplish tasks. The user trusts your judgment.',
    tr: 'Tam otonomiye sahipsiniz. Görevleri yerine getirmek için hemen harekete geçin. Kullanıcı kararlarınıza güveniyor.',
  },
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
function formatUserProfile(profile: UserProfile, lang: 'en' | 'tr'): string {
  const lines: string[] = [];

  if (profile.name) {
    lines.push(lang === 'en' ? `- Name: ${profile.name}` : `- İsim: ${profile.name}`);
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
      lines.push(lang === 'en'
        ? `- Prefers ${style.formality} communication`
        : `- ${style.formality === 'formal' ? 'Resmi' : 'Samimi'} iletişimi tercih eder`
      );
    }
    if (style.verbosity !== 'mixed') {
      lines.push(lang === 'en'
        ? `- Prefers ${style.verbosity} responses`
        : `- ${style.verbosity === 'concise' ? 'Kısa' : 'Detaylı'} yanıtları tercih eder`
      );
    }
    if (style.language) {
      lines.push(lang === 'en'
        ? `- Primary language: ${style.language}`
        : `- Ana dil: ${style.language}`
      );
    }
    if (style.timezone) {
      lines.push(lang === 'en'
        ? `- Timezone: ${style.timezone}`
        : `- Saat dilimi: ${style.timezone}`
      );
    }
  }

  // Add interests
  if (profile.interests.length > 0) {
    const topInterests = profile.interests.slice(0, 5).join(', ');
    lines.push(lang === 'en'
      ? `- Interests: ${topInterests}`
      : `- İlgi alanları: ${topInterests}`
    );
  }

  // Add goals
  if (profile.goals.length > 0) {
    const topGoals = profile.goals.slice(0, 3).join('; ');
    lines.push(lang === 'en'
      ? `- Current goals: ${topGoals}`
      : `- Mevcut hedefler: ${topGoals}`
    );
  }

  return lines.join('\n');
}

/**
 * Format tools for prompt
 */
function formatTools(tools: readonly ToolDefinition[], lang: 'en' | 'tr'): string {
  if (tools.length === 0) {
    return lang === 'en' ? 'No tools available.' : 'Mevcut araç yok.';
  }

  // Count tools per category (don't list individual names — too verbose for system prompt)
  const categoryCounts = new Map<string, number>();
  for (const tool of tools) {
    const category = tool.category ?? 'General';
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const categories = Array.from(categoryCounts.entries())
    .map(([cat, count]) => `${cat} (${count})`)
    .join(', ');

  if (lang === 'tr') {
    return [
      `${tools.length} araç kullanılabilir: ${categories}`,
      '',
      'Araç kullanımı:',
      '1. search_tools(query) — İhtiyacın olan aracı bul',
      '2. get_tool_help(tool_name) — Parametreleri öğren',
      '3. use_tool(tool_name, arguments) — Aracı çalıştır',
    ].join('\n');
  }

  return [
    `${tools.length} tools available across: ${categories}`,
    '',
    'Tool workflow:',
    '1. search_tools(query) — Find tools for your task',
    '2. get_tool_help(tool_name) — Learn parameters',
    '3. use_tool(tool_name, arguments) — Execute the tool',
  ].join('\n');
}

/**
 * Format capabilities for prompt
 */
function formatCapabilities(caps: AgentCapabilities, lang: 'en' | 'tr'): string {
  const lines: string[] = [];

  const capLabels = {
    codeExecution: { en: 'Execute code and scripts', tr: 'Kod ve script çalıştırma' },
    fileAccess: { en: 'Read and write files', tr: 'Dosya okuma ve yazma' },
    webBrowsing: { en: 'Browse the web and fetch content', tr: 'Web tarama ve içerik çekme' },
    memory: { en: 'Remember information across conversations', tr: 'Konuşmalar arasında bilgi hatırlama' },
    scheduling: { en: 'Schedule tasks and reminders', tr: 'Görev ve hatırlatıcı zamanlama' },
  };

  for (const [key, enabled] of Object.entries(caps)) {
    if (key === 'externalServices' || key === 'autonomyLevel') continue;
    if (enabled && capLabels[key as keyof typeof capLabels]) {
      const label = capLabels[key as keyof typeof capLabels][lang];
      lines.push(`- ✓ ${label}`);
    }
  }

  if (caps.externalServices && caps.externalServices.length > 0) {
    const services = caps.externalServices.join(', ');
    lines.push(lang === 'en'
      ? `- ✓ Access to external services: ${services}`
      : `- ✓ Harici servislere erişim: ${services}`
    );
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
      maxPromptLength: options.maxPromptLength ?? 16000,
      language: options.language ?? 'auto',
    };
  }

  /**
   * Compose a complete system prompt
   */
  compose(context: PromptContext): string {
    const lang = this.detectLanguage(context);
    const sections: string[] = [];

    // 1. Base prompt
    sections.push(context.basePrompt);

    // 2. User profile
    if (this.options.includeUserProfile && context.userProfile) {
      const userInfo = formatUserProfile(context.userProfile, lang);
      if (userInfo) {
        const template = PROMPT_SECTIONS.userProfile[lang];
        sections.push(template.replace('{{userInfo}}', userInfo));
      }
    }

    // 3. Custom instructions
    if (context.customInstructions && context.customInstructions.length > 0) {
      const instructions = context.customInstructions.map(i => `- ${i}`).join('\n');
      const template = PROMPT_SECTIONS.customInstructions[lang];
      sections.push(template.replace('{{instructions}}', instructions));
    }

    // 4. Available tools
    if (this.options.includeToolDescriptions && context.tools && context.tools.length > 0) {
      const toolList = formatTools(context.tools, lang);
      const template = PROMPT_SECTIONS.tools[lang];
      sections.push(template.replace('{{toolList}}', toolList));
    }

    // 4b. Workspace context (for file operations)
    if (context.workspaceContext) {
      const ws = context.workspaceContext;
      const allowedDirs: string[] = [];
      allowedDirs.push(`- Workspace: \`${ws.workspaceDir}\``);
      if (ws.homeDir) allowedDirs.push(`- Home: \`${ws.homeDir}\``);
      if (ws.tempDir) allowedDirs.push(`- Temp: \`${ws.tempDir}\``);

      const template = PROMPT_SECTIONS.workspace[lang];
      sections.push(
        template
          .replace('{{allowedDirs}}', allowedDirs.join('\n'))
          .replace(/\{\{workspaceDir\}\}/g, ws.workspaceDir)
          .replace(/\{\{tempDir\}\}/g, ws.tempDir ?? '/tmp')
      );
    }

    // 5. Capabilities
    if (this.options.includeCapabilities && context.capabilities) {
      const capsList = formatCapabilities(context.capabilities, lang);
      if (capsList) {
        const template = PROMPT_SECTIONS.capabilities[lang];
        sections.push(template.replace('{{capabilitiesList}}', capsList));
      }

      // 5b. Autonomy guidelines
      if (context.capabilities.autonomyLevel) {
        const level = context.capabilities.autonomyLevel;
        const guidelineEntry = AUTONOMY_GUIDELINES[level];
        if (guidelineEntry) {
          const guidelines = guidelineEntry[lang];
          const template = PROMPT_SECTIONS.autonomyGuidelines[lang];
          sections.push(
            template
              .replace('{{level}}', level.toUpperCase())
              .replace('{{guidelines}}', guidelines)
          );
        }
      }
    }

    // 6. Time context
    if (this.options.includeTimeContext && context.timeContext) {
      const tc = context.timeContext;
      const template = PROMPT_SECTIONS.timeContext[lang];
      sections.push(
        template
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
        contextLines.push(lang === 'en'
          ? `- Messages in this conversation: ${cc.messageCount}`
          : `- Bu konuşmadaki mesaj sayısı: ${cc.messageCount}`
        );
      }
      if (cc.topics && cc.topics.length > 0) {
        contextLines.push(lang === 'en'
          ? `- Topics discussed: ${cc.topics.join(', ')}`
          : `- Tartışılan konular: ${cc.topics.join(', ')}`
        );
      }
      if (cc.currentTask) {
        contextLines.push(lang === 'en'
          ? `- Current task: ${cc.currentTask}`
          : `- Mevcut görev: ${cc.currentTask}`
        );
      }
      if (cc.previousSummary) {
        contextLines.push(lang === 'en'
          ? `- Previous conversation summary: ${cc.previousSummary}`
          : `- Önceki konuşma özeti: ${cc.previousSummary}`
        );
      }

      if (contextLines.length > 0) {
        const template = PROMPT_SECTIONS.conversationContext[lang];
        sections.push(template.replace('{{contextInfo}}', contextLines.join('\n')));
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
   * Detect language from context
   */
  private detectLanguage(context: PromptContext): 'en' | 'tr' {
    if (this.options.language !== 'auto') {
      return this.options.language;
    }

    // Check user profile language
    if (context.userProfile?.communicationStyle?.language) {
      const lang = context.userProfile.communicationStyle.language.toLowerCase();
      if (lang.includes('tr') || lang.includes('turkish') || lang.includes('türkçe')) {
        return 'tr';
      }
    }

    // Check base prompt language (simple heuristic)
    const turkishWords = ['merhaba', 'lütfen', 'teşekkür', 'yardım', 'yapabilir'];
    const basePromptLower = context.basePrompt.toLowerCase();
    if (turkishWords.some(word => basePromptLower.includes(word))) {
      return 'tr';
    }

    return 'en';
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
