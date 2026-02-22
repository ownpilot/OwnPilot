/**
 * Agent Router
 *
 * LLM-based intelligent routing that selects the best agent for each request.
 * Analyzes user messages and routes them to specialized agents.
 */

import type { Message } from '../agent/types.js';
import { getLog } from '../services/get-log.js';

const log = getLog('AgentRouter');

// =============================================================================
// Types
// =============================================================================

/**
 * Agent info for routing decisions
 */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  triggers?: {
    keywords?: string[];
    description?: string;
  };
}

/**
 * Routing result
 */
export interface AgentRoutingResult {
  /** Selected agent ID */
  agentId: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Reasoning for the selection */
  reasoning: string;
  /** Alternative agents that could handle the request */
  alternatives?: Array<{ agentId: string; confidence: number }>;
}

/**
 * Routing context
 */
export interface RoutingContext {
  /** User ID */
  userId?: string;
  /** Channel (chat, telegram, etc.) */
  channel?: string;
  /** Conversation history */
  conversationHistory?: Message[];
  /** Previous agent used */
  previousAgentId?: string;
  /** User preferences */
  preferences?: Record<string, unknown>;
}

/**
 * LLM Provider for routing
 */
export interface RouterLLMProvider {
  complete(messages: Message[]): Promise<string>;
}

// =============================================================================
// Agent Router
// =============================================================================

/**
 * Router configuration
 */
export interface AgentRouterConfig {
  /** Default agent to use when no good match */
  defaultAgentId?: string;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Enable detailed reasoning */
  enableReasoning?: boolean;
}

const DEFAULT_CONFIG: Required<AgentRouterConfig> = {
  defaultAgentId: 'general-assistant',
  minConfidence: 0.4,
  enableReasoning: true,
};

/**
 * Agent Router - LLM-based intelligent agent selection
 */
export class AgentRouter {
  private readonly config: Required<AgentRouterConfig>;
  private readonly agents: Map<string, AgentInfo> = new Map();
  private llmProvider?: RouterLLMProvider;

  constructor(config: AgentRouterConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the LLM provider for routing
   */
  setLLMProvider(provider: RouterLLMProvider): void {
    this.llmProvider = provider;
  }

  /**
   * Register an agent for routing
   */
  registerAgent(agent: AgentInfo): void {
    this.agents.set(agent.id, agent);
  }

  /**
   * Register multiple agents
   */
  registerAgents(agents: AgentInfo[]): void {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  /**
   * Get all registered agents
   */
  getAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  /**
   * Route a message to the best agent
   */
  async route(message: string, context: RoutingContext = {}): Promise<AgentRoutingResult> {
    // If no LLM provider, use rule-based fallback
    if (!this.llmProvider) {
      return this.routeWithRules(message, context);
    }

    return this.routeWithLLM(message, context);
  }

  /**
   * LLM-based routing
   */
  private async routeWithLLM(
    message: string,
    context: RoutingContext
  ): Promise<AgentRoutingResult> {
    const agentList = this.buildAgentListPrompt();
    const contextInfo = this.buildContextPrompt(context);

    const systemPrompt = `You are an intelligent router that selects the best agent to handle user requests.

## Available Agents
${agentList}

## Instructions
1. Analyze the user's message carefully
2. Consider the context and conversation history
3. Select the agent best suited to handle this request
4. If no agent is a good match, use "${this.config.defaultAgentId}"

## Response Format
Respond with JSON only:
{
  "agentId": "selected-agent-id",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this agent was selected"
}`;

    const userPrompt = `${contextInfo}

User message: "${message}"

Select the best agent to handle this request.`;

    try {
      const response = await this.llmProvider!.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          agentId: string;
          confidence: number;
          reasoning: string;
        };

        // Validate agent exists
        if (!this.agents.has(parsed.agentId)) {
          return this.fallbackResult(message, 'Agent not found in response');
        }

        // Check confidence threshold
        if (parsed.confidence < this.config.minConfidence) {
          return {
            ...parsed,
            agentId: this.config.defaultAgentId,
            reasoning: `Low confidence (${parsed.confidence}). Falling back to default. Original reasoning: ${parsed.reasoning}`,
          };
        }

        return parsed;
      }

      return this.fallbackResult(message, 'Could not parse LLM response');
    } catch (error) {
      log.error('LLM routing failed:', error);
      return this.routeWithRules(message, context);
    }
  }

  /**
   * Rule-based routing fallback (when LLM not available)
   */
  private routeWithRules(message: string, context: RoutingContext): AgentRoutingResult {
    const lower = message.toLowerCase();
    const scores: Array<{ agentId: string; score: number }> = [];

    for (const agent of this.agents.values()) {
      let score = 0;

      // Check keyword triggers
      if (agent.triggers?.keywords) {
        for (const keyword of agent.triggers.keywords) {
          if (lower.includes(keyword.toLowerCase())) {
            score += 0.3;
          }
        }
      }

      // Check capabilities
      for (const capability of agent.capabilities) {
        if (lower.includes(capability.toLowerCase())) {
          score += 0.2;
        }
      }

      // Check name
      if (lower.includes(agent.name.toLowerCase())) {
        score += 0.4;
      }

      // Boost if same as previous agent (continuation)
      if (context.previousAgentId === agent.id) {
        score += 0.1;
      }

      if (score > 0) {
        scores.push({ agentId: agent.id, score: Math.min(score, 1) });
      }
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    if (scores.length > 0 && scores[0]!.score >= this.config.minConfidence) {
      return {
        agentId: scores[0]!.agentId,
        confidence: scores[0]!.score,
        reasoning: 'Rule-based matching (LLM not available)',
        alternatives: scores.slice(1, 4).map((s) => ({
          agentId: s.agentId,
          confidence: s.score,
        })),
      };
    }

    return this.fallbackResult(message, 'No matching agent found');
  }

  /**
   * Build agent list for LLM prompt
   */
  private buildAgentListPrompt(): string {
    const lines: string[] = [];

    for (const agent of this.agents.values()) {
      const keywords = agent.triggers?.keywords?.join(', ') || '';
      const triggerDesc = agent.triggers?.description || '';

      lines.push(`### ${agent.id}: ${agent.name}`);
      lines.push(`Description: ${agent.description}`);
      lines.push(`Capabilities: ${agent.capabilities.join(', ')}`);
      if (keywords) {
        lines.push(`Keywords: ${keywords}`);
      }
      if (triggerDesc) {
        lines.push(`When to use: ${triggerDesc}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Build context prompt
   */
  private buildContextPrompt(context: RoutingContext): string {
    const parts: string[] = [];

    if (context.channel) {
      parts.push(`Channel: ${context.channel}`);
    }
    if (context.previousAgentId) {
      parts.push(`Previous agent: ${context.previousAgentId}`);
    }
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      const recent = context.conversationHistory.slice(-3);
      parts.push(
        'Recent conversation:\n' +
          recent.map((m) => `${m.role}: ${m.content?.slice(0, 100)}...`).join('\n')
      );
    }

    return parts.length > 0 ? `Context:\n${parts.join('\n')}\n` : '';
  }

  /**
   * Create fallback result
   */
  private fallbackResult(message: string, reason: string): AgentRoutingResult {
    return {
      agentId: this.config.defaultAgentId,
      confidence: 0.5,
      reasoning: `Using default agent. ${reason}`,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

let _router: AgentRouter | null = null;

export function getAgentRouter(): AgentRouter {
  if (!_router) {
    _router = new AgentRouter();
  }
  return _router;
}

export function createAgentRouter(config?: AgentRouterConfig): AgentRouter {
  return new AgentRouter(config);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create agent info from agent config
 */
export function agentConfigToInfo(config: {
  id: string;
  name: string;
  systemPrompt?: string;
  triggers?: {
    keywords?: string[];
    description?: string;
  };
}): AgentInfo {
  // Extract capabilities from system prompt
  const capabilities: string[] = [];
  if (config.systemPrompt) {
    // Simple extraction - look for capability mentions
    const capabilityPatterns = [
      /can help with (.+)/gi,
      /capabilities?:?\s*(.+)/gi,
      /expertise in (.+)/gi,
    ];

    for (const pattern of capabilityPatterns) {
      const matches = config.systemPrompt.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cap = match.replace(pattern, '$1').trim();
          if (cap.length < 100) {
            capabilities.push(cap);
          }
        }
      }
    }
  }

  return {
    id: config.id,
    name: config.name,
    description: config.systemPrompt?.slice(0, 200) || config.name,
    capabilities: capabilities.length > 0 ? capabilities : [config.name.toLowerCase()],
    triggers: config.triggers,
  };
}
