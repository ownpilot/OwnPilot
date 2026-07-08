/**
 * Tests for Crew Orchestrator (crew-orchestrator.ts)
 *
 * Covers: buildCrewContextSection for all coordination patterns,
 * member list rendering, unread count notes, edge cases
 * (single member, no members, zero unread, large counts).
 */

import { describe, it, expect } from 'vitest';

const { buildCrewContextSection, COORDINATION_GUIDANCE } = await import('./crew-orchestrator.js');
import type { CrewContextInfo, CrewMemberInfo } from './crew-orchestrator.js';

// ============================================================================
// Helpers
// ============================================================================

function makeCtx(overrides: Partial<CrewContextInfo> = {}): CrewContextInfo {
  return {
    crewId: 'crew-1',
    crewName: 'Alpha Team',
    coordinationPattern: 'peer_to_peer',
    members: [
      { agentId: 'agent-a', name: 'Alice', emoji: '🔍', role: 'Researcher', isCurrentAgent: true },
      { agentId: 'agent-b', name: 'Bob', emoji: '✍️', role: 'Writer' },
    ],
    unreadCount: 0,
    ...overrides,
  };
}

// ============================================================================
// buildCrewContextSection
// ============================================================================

describe('buildCrewContextSection', () => {
  it('includes crew name in header', () => {
    const section = buildCrewContextSection(makeCtx({ crewName: 'Beta Crew' }));
    expect(section).toContain('Crew: Beta Crew');
  });

  it('includes coordination pattern name', () => {
    const section = buildCrewContextSection(makeCtx({ coordinationPattern: 'hub_spoke' }));
    expect(section).toContain('hub-spoke');
  });

  it('includes member count', () => {
    const section = buildCrewContextSection(makeCtx());
    expect(section).toMatch(/2 members/);
  });

  it('shows "1 member" when solo', () => {
    const section = buildCrewContextSection(
      makeCtx({
        members: [
          {
            agentId: 'agent-a',
            name: 'Alice',
            emoji: '🔍',
            role: 'Researcher',
            isCurrentAgent: true,
          },
        ],
      })
    );
    expect(section).toMatch(/1 member/);
  });
});

// ============================================================================
// Member list rendering
// ============================================================================

describe('member list', () => {
  it('lists other crew members (excluding current agent)', () => {
    const ctx = makeCtx({
      members: [
        { agentId: 'a', name: 'Alice', emoji: '🔍', role: 'Researcher', isCurrentAgent: true },
        { agentId: 'b', name: 'Bob', emoji: '✍️', role: 'Writer' },
        { agentId: 'c', name: 'Charlie', emoji: '⚒️', role: 'Developer' },
      ],
    });
    const section = buildCrewContextSection(ctx);
    expect(section).toContain('Bob');
    expect(section).toContain('Charlie');
    // Alice is the current agent, should NOT appear in "Your crew members"
    expect(section).not.toMatch(/Alice.*Researcher.*`a`/);
  });

  it('shows placeholder when no other members exist', () => {
    const ctx = makeCtx({
      members: [{ agentId: 'a', name: 'Solo', emoji: '🕵️', role: 'Loner', isCurrentAgent: true }],
    });
    const section = buildCrewContextSection(ctx);
    expect(section).toContain('(no other members)');
  });

  it('includes emoji, name, role, and agentId for each member', () => {
    const ctx = makeCtx({
      members: [
        { agentId: 'a', name: 'Alice', emoji: '🔍', role: 'Researcher', isCurrentAgent: false },
        { agentId: 'b', name: 'Bob', emoji: '✍️', role: 'Writer', isCurrentAgent: true },
      ],
    });
    const section = buildCrewContextSection(ctx);
    // Alice should be listed with all details
    expect(section).toContain('🔍');
    expect(section).toContain('Alice');
    expect(section).toContain('Researcher');
    expect(section).toContain('`a`');
  });
});

// ============================================================================
// Unread count
// ============================================================================

describe('unread count inbox note', () => {
  it('includes inbox note when unreadCount > 0', () => {
    const section = buildCrewContextSection(makeCtx({ unreadCount: 3 }));
    expect(section).toContain('3 unread messages');
    expect(section).toContain('read_agent_inbox');
  });

  it('uses singular "message" when unreadCount is 1', () => {
    const section = buildCrewContextSection(makeCtx({ unreadCount: 1 }));
    expect(section).toContain('1 unread message');
  });

  it('omits inbox note when unreadCount is 0', () => {
    const section = buildCrewContextSection(makeCtx({ unreadCount: 0 }));
    // When unreadCount is 0, the inboxNote is '' so the section
    // should not contain the inbox prompt text. Note: read_agent_inbox
    // still appears in the "Available crew tools" footer regardless.
    expect(section).not.toContain('unread message');
    expect(section).not.toContain('📬');
  });
});

// ============================================================================
// Coordination pattern guidance
// ============================================================================

describe('coordination guidance', () => {
  it('includes hub_spoke guidance', () => {
    const section = buildCrewContextSection(makeCtx({ coordinationPattern: 'hub_spoke' }));
    expect(section).toContain('Hub-and-spoke crew');
  });

  it('includes peer_to_peer guidance', () => {
    const section = buildCrewContextSection(makeCtx({ coordinationPattern: 'peer_to_peer' }));
    expect(section).toContain('Peer-to-peer crew');
  });

  it('includes pipeline guidance', () => {
    const section = buildCrewContextSection(makeCtx({ coordinationPattern: 'pipeline' }));
    expect(section).toContain('Pipeline crew');
  });

  it('includes hierarchical guidance', () => {
    const section = buildCrewContextSection(makeCtx({ coordinationPattern: 'hierarchical' }));
    expect(section).toContain('Hierarchical crew');
  });
});

// ============================================================================
// Tool reminder
// ============================================================================

describe('crew tool reminder', () => {
  it('lists available crew tools', () => {
    const section = buildCrewContextSection(makeCtx());
    expect(section).toContain('get_crew_members');
    expect(section).toContain('delegate_task');
    expect(section).toContain('broadcast_to_crew');
    expect(section).toContain('claim_task');
    expect(section).toContain('send_agent_message');
    expect(section).toContain('read_agent_inbox');
  });
});

// ============================================================================
// COORDINATION_GUIDANCE export
// ============================================================================

describe('COORDINATION_GUIDANCE', () => {
  it('exports guidance for all 4 patterns', () => {
    expect(Object.keys(COORDINATION_GUIDANCE)).toHaveLength(4);
    expect(COORDINATION_GUIDANCE).toHaveProperty('hub_spoke');
    expect(COORDINATION_GUIDANCE).toHaveProperty('peer_to_peer');
    expect(COORDINATION_GUIDANCE).toHaveProperty('pipeline');
    expect(COORDINATION_GUIDANCE).toHaveProperty('hierarchical');
  });

  it('each guidance is a non-empty string', () => {
    for (const guidance of Object.values(COORDINATION_GUIDANCE)) {
      expect(typeof guidance).toBe('string');
      expect(guidance.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
  it('handles empty members array gracefully', () => {
    const section = buildCrewContextSection(makeCtx({ members: [] }));
    expect(section).toContain('0 members');
    expect(section).toContain('(no other members)');
  });

  it('handles large unread count with correct plural', () => {
    const section = buildCrewContextSection(
      makeCtx({
        members: [{ agentId: 'a', name: 'A', emoji: '🕵️', role: 'R', isCurrentAgent: true }],
        unreadCount: 999,
      })
    );
    expect(section).toContain('999 unread messages');
  });

  it('handles members without isCurrentAgent flag (defaults to not current)', () => {
    const member: CrewMemberInfo = { agentId: 'x', name: 'X', emoji: '📡', role: 'Scanner' };
    const section = buildCrewContextSection(makeCtx({ members: [member] }));
    // Member X is not current agent, should appear in list
    expect(section).toContain('X');
    expect(section).toContain('Scanner');
  });
});
