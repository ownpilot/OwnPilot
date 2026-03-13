/**
 * Crew Orchestrator
 *
 * Provides crew context injection and coordination pattern guidance
 * for the heartbeat runner. Pure helper functions — no DB access.
 * All data is passed in; this module has no side effects.
 */

import type { CrewCoordinationPattern } from './types.js';

// ============================================================
// Types
// ============================================================

export interface CrewMemberInfo {
  agentId: string;
  name: string;
  emoji: string;
  role: string;
  /** True for the agent currently executing the heartbeat */
  isCurrentAgent?: boolean;
}

export interface CrewContextInfo {
  crewId: string;
  crewName: string;
  coordinationPattern: CrewCoordinationPattern;
  members: CrewMemberInfo[];
  unreadCount: number;
}

// ============================================================
// Coordination pattern guidance
// ============================================================

const COORDINATION_GUIDANCE: Record<CrewCoordinationPattern, string> = {
  hub_spoke:
    'Hub-and-spoke crew: the hub agent coordinates work and aggregates results from spoke agents. Spoke agents report findings to the hub.',
  peer_to_peer:
    'Peer-to-peer crew: all agents collaborate as equals. Share findings proactively with peers using `send_agent_message` or `broadcast_to_crew`.',
  pipeline:
    'Pipeline crew: agents work in sequence. Complete your stage, then pass results to the next agent using `delegate_task`.',
  hierarchical:
    'Hierarchical crew: leaders delegate tasks downstream; team members execute and report results back using `send_agent_message`.',
};

// ============================================================
// Context section builder
// ============================================================

/**
 * Build the crew context markdown block to prepend to heartbeat task prompts.
 * Informs the agent about their crew, member list, coordination pattern,
 * and whether they have unread messages.
 */
export function buildCrewContextSection(ctx: CrewContextInfo): string {
  const otherMembers = ctx.members.filter((m) => !m.isCurrentAgent);

  const memberList =
    otherMembers.length > 0
      ? otherMembers
          .map((m) => `  - **${m.emoji} ${m.name}** — ${m.role} (\`${m.agentId}\`)`)
          .join('\n')
      : '  (no other members)';

  const inboxNote =
    ctx.unreadCount > 0
      ? `\n> 📬 **${ctx.unreadCount} unread message${ctx.unreadCount !== 1 ? 's' : ''}** in your inbox — use \`read_agent_inbox\` to check them.`
      : '';

  const guidance = COORDINATION_GUIDANCE[ctx.coordinationPattern];

  return [
    `## Crew: ${ctx.crewName}`,
    `Pattern: **${ctx.coordinationPattern.replace(/_/g, '-')}** | ${ctx.members.length} member${ctx.members.length !== 1 ? 's' : ''}`,
    '',
    '**Your crew members:**',
    memberList,
    inboxNote,
    '',
    `**Coordination:** ${guidance}`,
    '',
    '> Available crew tools: `get_crew_members`, `delegate_task`, `broadcast_to_crew`, `claim_task`, `submit_result`, `request_review`, `share_knowledge`, `get_crew_memory`, `coordinate`, `send_agent_message`, `read_agent_inbox`',
    '',
    '---',
    '',
  ].join('\n');
}

// ============================================================
// Exports
// ============================================================

export { COORDINATION_GUIDANCE };
