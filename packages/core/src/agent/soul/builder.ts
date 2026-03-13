/**
 * Soul Prompt Builder
 *
 * Converts an AgentSoul into a system prompt string.
 * Called from AgentEngine.buildSystemPrompt() — if no soul exists,
 * returns empty string for backward compatibility.
 */

import type { AgentSoul, HeartbeatTask } from './types.js';

/**
 * Minimal memory shape used by the builder.
 * Avoids importing the full MemoryEntry type to keep the module lightweight.
 */
export interface SoulMemoryRef {
  content: unknown;
  importance?: number;
}

/**
 * Build the soul prompt section injected into the agent's system prompt.
 * Returns an empty string when no soul is provided.
 */
export function buildSoulPrompt(
  soul: AgentSoul,
  recentMemories: SoulMemoryRef[],
  pendingInbox: number,
  currentHeartbeatTask?: HeartbeatTask
): string {
  const sections: string[] = [];

  // ── Identity
  const quirks = soul.identity.voice.quirks?.map((q) => `- Quirk: ${q}`).join('\n') || '';
  const backstory = soul.identity.backstory ? `**Backstory:** ${soul.identity.backstory}` : '';

  sections.push(
    `## Who You Are
You are **${soul.identity.name}** ${soul.identity.emoji}
**Role:** ${soul.identity.role}
**Personality:** ${soul.identity.personality}
**Tone:** ${soul.identity.voice.tone} | **Language:** ${soul.identity.voice.language}
${quirks}
${backstory}`.trim()
  );

  // ── Mission & Goals
  sections.push(
    `## Your Mission
${soul.purpose.mission}

### Active Goals
${soul.purpose.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}

### Your Expertise
${soul.purpose.expertise.join(', ')}`
  );

  // ── Boundaries (CRITICAL — always prominent)
  sections.push(
    `## Boundaries — ALWAYS RESPECT
${soul.identity.boundaries.map((b) => `- ${b}`).join('\n')}`
  );

  // ── Autonomy
  sections.push(
    `## Autonomy Level: ${soul.autonomy.level}
- **Allowed:** ${soul.autonomy.allowedActions.join(', ') || 'none'}
- **Requires Approval:** ${soul.autonomy.requiresApproval.join(', ') || 'none'}
- **Blocked:** ${soul.autonomy.blockedActions.join(', ') || 'none'}
- **Budget:** $${soul.autonomy.maxCostPerDay}/day`
  );

  // ── Claw Mode (autonomy level 5)
  if (soul.autonomy.level === 5 && soul.autonomy.clawMode?.enabled) {
    const caps: string[] = ['All tools available (unrestricted access)'];
    if (soul.autonomy.clawMode.canManageAgents) {
      caps.push('Can spawn subagents and manage fleets');
    }
    if (soul.autonomy.clawMode.canCreateTools) {
      caps.push('Can create tools at runtime');
    }
    if (soul.autonomy.clawMode.selfImprovement !== 'disabled') {
      caps.push(`Self-improvement: ${soul.autonomy.clawMode.selfImprovement}`);
    }

    sections.push(
      `## Claw Mode — ACTIVE
You are operating with elevated autonomy. Capabilities:
${caps.map((c) => `- ${c}`).join('\n')}

Budget limits still apply. Use capabilities responsibly and efficiently.`
    );
  }

  // ── Relationships
  if (
    soul.relationships.reportsTo ||
    soul.relationships.peers.length > 0 ||
    soul.relationships.delegates.length > 0
  ) {
    const lines: string[] = [];
    if (soul.relationships.reportsTo) {
      lines.push(`- **Reports to:** ${soul.relationships.reportsTo}`);
    }
    if (soul.relationships.peers.length > 0) {
      lines.push(`- **Peers:** ${soul.relationships.peers.join(', ')}`);
    }
    if (soul.relationships.delegates.length > 0) {
      lines.push(`- **Can delegate to:** ${soul.relationships.delegates.join(', ')}`);
    }
    sections.push(`## Your Team\n${lines.join('\n')}`);
  }

  // ── Inbox
  if (pendingInbox > 0) {
    sections.push(
      `## Inbox
You have **${pendingInbox}** unread messages from other agents. Check your inbox.`
    );
  }

  // ── Current heartbeat task
  if (currentHeartbeatTask) {
    sections.push(
      `## Current Heartbeat Task
**${currentHeartbeatTask.name}:** ${currentHeartbeatTask.description}
Tools available: ${currentHeartbeatTask.tools.join(', ') || 'any'}
Output to: ${JSON.stringify(currentHeartbeatTask.outputTo || 'memory')}
Priority: ${currentHeartbeatTask.priority}`
    );
  }

  // ── Learnings (last 10)
  if (soul.evolution.learnings.length > 0) {
    sections.push(
      `## Learnings from Experience
${soul.evolution.learnings
  .slice(-10)
  .map((l) => `- ${l}`)
  .join('\n')}`
    );
  }

  // ── Recent memories (last 5)
  if (recentMemories.length > 0) {
    sections.push(
      `## Recent Memories
${recentMemories
  .slice(0, 5)
  .map((m) => `- [${m.importance ?? 0}] ${String(m.content)}`)
  .join('\n')}`
    );
  }

  return sections.join('\n\n');
}

/**
 * Estimate token count for a soul prompt (rough: 1 token ~ 4 chars).
 */
export function estimateSoulTokens(soul: AgentSoul): number {
  const prompt = buildSoulPrompt(soul, [], 0);
  return Math.ceil(prompt.length / 4);
}
