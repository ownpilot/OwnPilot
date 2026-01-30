/**
 * Memory Injector Service
 *
 * Integrates personal memory and conversation context into agent prompts.
 * This service ensures that agents have full awareness of:
 * - Who the user is (personal profile)
 * - What tools are available
 * - User's preferences and custom instructions
 * - Current context (time, location, conversation history)
 *
 * This enables truly personalized and context-aware AI interactions.
 */

import type { ToolDefinition } from './types.js';
import type { UserProfile } from '../memory/conversation.js';
import { getPersonalMemoryStore, type ComprehensiveProfile } from '../memory/personal.js';
import {
  PromptComposer,
  type PromptContext,
  type AgentCapabilities,
  type PromptConversationContext,
  type WorkspaceContext,
  getTimeContext,
} from './prompt-composer.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Memory injection options
 */
export interface MemoryInjectionOptions {
  /** User ID for memory retrieval */
  userId?: string;
  /** Available tools to include in prompt */
  tools?: readonly ToolDefinition[];
  /** Agent capabilities */
  capabilities?: AgentCapabilities;
  /** Conversation context */
  conversationContext?: PromptConversationContext;
  /** Workspace context for file operations */
  workspaceContext?: WorkspaceContext;
  /** Include user profile */
  includeProfile?: boolean;
  /** Include custom instructions */
  includeInstructions?: boolean;
  /** Include time context */
  includeTimeContext?: boolean;
  /** Include tool descriptions */
  includeToolDescriptions?: boolean;
  /** Maximum prompt length */
  maxPromptLength?: number;
}

/**
 * Injected prompt result
 */
export interface InjectedPromptResult {
  /** The composed system prompt */
  systemPrompt: string;
  /** User profile used (if any) */
  userProfile?: UserProfile;
  /** Tools included */
  toolCount: number;
  /** Custom instructions included */
  instructionCount: number;
  /** Whether time context was included */
  hasTimeContext: boolean;
  /** Prompt length */
  promptLength: number;
}

// =============================================================================
// Memory Injector Class
// =============================================================================

/**
 * Memory Injector
 *
 * Service that injects memory and context into agent system prompts.
 */
export class MemoryInjector {
  private readonly composer: PromptComposer;

  constructor() {
    this.composer = new PromptComposer();
  }

  /**
   * Inject memory and context into a base system prompt
   */
  async injectMemory(
    basePrompt: string,
    options: MemoryInjectionOptions = {}
  ): Promise<InjectedPromptResult> {
    // Build the prompt context
    const context: PromptContext = {
      basePrompt,
      tools: options.tools,
      capabilities: options.capabilities,
      conversationContext: options.conversationContext,
      workspaceContext: options.workspaceContext,
    };

    // Add time context
    if (options.includeTimeContext !== false) {
      context.timeContext = getTimeContext();
    }

    // Load user memory if available
    let userProfile: UserProfile | undefined;
    let customInstructions: string[] = [];

    if (options.userId && options.includeProfile !== false) {
      try {
        const memoryStore = await getPersonalMemoryStore(options.userId);
        const profile = await memoryStore.getProfile();

        // Convert comprehensive profile to UserProfile format
        userProfile = this.comprehensiveToUserProfile(profile);
        context.userProfile = userProfile;

        // Get custom instructions
        if (options.includeInstructions !== false) {
          customInstructions = profile.aiPreferences.customInstructions ?? [];
          context.customInstructions = customInstructions;
        }

        // Update capabilities with user preferences
        if (profile.aiPreferences.autonomyLevel && context.capabilities) {
          context.capabilities = {
            ...context.capabilities,
            autonomyLevel: profile.aiPreferences.autonomyLevel,
          };
        }
      } catch (error) {
        // Memory not available, continue without it
        console.warn('Failed to load user memory:', error);
      }
    }

    // Compose the prompt
    const systemPrompt = this.composer.compose(context);

    return {
      systemPrompt,
      userProfile,
      toolCount: options.tools?.length ?? 0,
      instructionCount: customInstructions.length,
      hasTimeContext: options.includeTimeContext !== false,
      promptLength: systemPrompt.length,
    };
  }

  /**
   * Create an enhanced system prompt for an agent
   */
  async createAgentPrompt(
    agentName: string,
    agentDescription: string,
    options: MemoryInjectionOptions & {
      personality?: string;
      specialInstructions?: string[];
    } = {}
  ): Promise<string> {
    // Build the base prompt
    const basePrompt = this.buildBasePrompt(agentName, agentDescription, options);

    // Inject memory and context
    const result = await this.injectMemory(basePrompt, options);

    return result.systemPrompt;
  }

  /**
   * Get relevant memories for a query
   */
  async getRelevantContext(
    userId: string,
    query: string
  ): Promise<string | null> {
    try {
      const memoryStore = await getPersonalMemoryStore(userId);
      const results = await memoryStore.search(query);

      if (results.length === 0) return null;

      const relevantInfo = results
        .slice(0, 5)
        .map(r => `- ${r.key}: ${r.value}`)
        .join('\n');

      return `Relevant information from memory:\n${relevantInfo}`;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Build the base prompt for an agent
   */
  private buildBasePrompt(
    agentName: string,
    agentDescription: string,
    options: {
      personality?: string;
      specialInstructions?: string[];
    }
  ): string {
    const sections: string[] = [];

    // Agent identity
    sections.push(`# ${agentName}\n\n${agentDescription}`);

    // Personality
    if (options.personality) {
      sections.push(`## Personality\n\n${options.personality}`);
    }

    // Special instructions
    if (options.specialInstructions?.length) {
      sections.push(
        `## Special Instructions\n\n${options.specialInstructions.map(i => `- ${i}`).join('\n')}`
      );
    }

    // Core behavior guidelines
    sections.push(`## Core Behavior

1. **Be Proactive**: When you have the tools and information to help, take action immediately.
2. **Be Context-Aware**: Use the user's profile and preferences to personalize your responses.
3. **Be Helpful**: Your goal is to assist the user in the best way possible.
4. **Be Transparent**: If you're unsure or need more information, ask.
5. **Remember**: Use the memory system to track important information about the user.`);

    return sections.join('\n\n');
  }

  /**
   * Convert ComprehensiveProfile to UserProfile format
   */
  private comprehensiveToUserProfile(profile: ComprehensiveProfile): UserProfile {
    const facts: Array<{ key: string; value: string; confidence: number }> = [];

    // Add identity facts
    if (profile.identity.name) {
      facts.push({ key: 'name', value: profile.identity.name, confidence: 1.0 });
    }
    if (profile.identity.nickname) {
      facts.push({ key: 'nickname', value: profile.identity.nickname, confidence: 1.0 });
    }
    if (profile.identity.age) {
      facts.push({ key: 'age', value: profile.identity.age.toString(), confidence: 0.9 });
    }
    if (profile.identity.nationality) {
      facts.push({ key: 'nationality', value: profile.identity.nationality, confidence: 0.9 });
    }

    // Add location facts
    if (profile.location.home?.city) {
      facts.push({ key: 'city', value: profile.location.home.city, confidence: 0.9 });
    }
    if (profile.location.home?.country) {
      facts.push({ key: 'country', value: profile.location.home.country, confidence: 0.9 });
    }

    // Add work facts
    if (profile.work.occupation) {
      facts.push({ key: 'occupation', value: profile.work.occupation, confidence: 0.9 });
    }
    if (profile.work.company) {
      facts.push({ key: 'company', value: profile.work.company, confidence: 0.9 });
    }

    // Build interests from hobbies and skills
    const interests: string[] = [
      ...(profile.lifestyle.hobbies ?? []),
      ...(profile.work.skills ?? []),
    ];

    return {
      userId: profile.userId,
      name: profile.identity.name,
      facts,
      preferences: profile.aiPreferences.customInstructions ?? [],
      preferencesDetailed: [],
      communicationStyle: {
        formality: profile.communication.preferredStyle ?? 'mixed',
        verbosity: profile.communication.verbosity ?? 'mixed',
        language: profile.communication.primaryLanguage,
        timezone: profile.location.home?.timezone,
      },
      interests,
      topicsOfInterest: interests,
      goals: [
        ...(profile.goals.shortTerm ?? []),
        ...(profile.goals.mediumTerm ?? []),
      ],
      relationships: profile.social.family?.map(f => `${f.name} (${f.relation})`) ?? [],
      customInstructions: profile.aiPreferences.customInstructions ?? [],
      lastInteraction: profile.meta.lastUpdated,
      totalConversations: 0,
      completeness: profile.meta.completeness,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Global memory injector instance
 */
let globalInjector: MemoryInjector | null = null;

/**
 * Get the global memory injector instance
 */
export function getMemoryInjector(): MemoryInjector {
  if (!globalInjector) {
    globalInjector = new MemoryInjector();
  }
  return globalInjector;
}

/**
 * Inject memory into a system prompt
 */
export async function injectMemoryIntoPrompt(
  basePrompt: string,
  options: MemoryInjectionOptions = {}
): Promise<InjectedPromptResult> {
  const injector = getMemoryInjector();
  return injector.injectMemory(basePrompt, options);
}

/**
 * Create an enhanced agent prompt with memory
 */
export async function createEnhancedAgentPrompt(
  agentName: string,
  agentDescription: string,
  options: MemoryInjectionOptions & {
    personality?: string;
    specialInstructions?: string[];
  } = {}
): Promise<string> {
  const injector = getMemoryInjector();
  return injector.createAgentPrompt(agentName, agentDescription, options);
}
