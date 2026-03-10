import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mapSessionNotification, mapSessionUpdate, type MappedAcpEvent } from './acp-event-mapper.js';

// Freeze time for deterministic timestamps
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-09T12:00:00.000Z'));
});

const SESSION_ID = 'ses-owner-1';
const ACP_SESSION_ID = 'acp-session-1';
const TIMESTAMP = '2026-03-09T12:00:00.000Z';

describe('acp-event-mapper', () => {
  // ===========================================================================
  // mapSessionNotification
  // ===========================================================================
  describe('mapSessionNotification', () => {
    it('returns empty array when update is undefined', () => {
      const result = mapSessionNotification({ sessionId: ACP_SESSION_ID } as any, SESSION_ID);
      expect(result).toEqual([]);
    });

    it('delegates to mapSessionUpdate when update is present', () => {
      const notification = {
        sessionId: ACP_SESSION_ID,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'thinking...' },
        },
      };
      const result = mapSessionNotification(notification as any, SESSION_ID);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('coding-agent:acp:thought');
    });
  });

  // ===========================================================================
  // mapSessionUpdate — tool_call
  // ===========================================================================
  describe('mapSessionUpdate — tool_call', () => {
    it('maps a tool_call update', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'Read file',
        kind: 'read',
        status: 'running',
        rawInput: { path: '/src/index.ts' },
        content: null,
        locations: [{ path: '/src/index.ts', line: 10 }],
      };

      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:tool-call');
      const payload = event.payload as any;
      expect(payload.sessionId).toBe(SESSION_ID);
      expect(payload.timestamp).toBe(TIMESTAMP);
      expect(payload.toolCall.toolCallId).toBe('tc-1');
      expect(payload.toolCall.title).toBe('Read file');
      expect(payload.toolCall.kind).toBe('read');
      expect(payload.toolCall.status).toBe('running');
      expect(payload.toolCall.locations).toEqual([{ path: '/src/index.ts', startLine: 10 }]);
    });

    it('defaults kind to other and status to pending', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-2',
        title: 'Custom',
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const tc = (event.payload as any).toolCall;
      expect(tc.kind).toBe('other');
      expect(tc.status).toBe('pending');
    });
  });

  // ===========================================================================
  // mapSessionUpdate — tool_call_update
  // ===========================================================================
  describe('mapSessionUpdate — tool_call_update', () => {
    it('maps a tool_call_update', () => {
      const update = {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-1',
        status: 'completed',
        title: 'Read file (done)',
        content: [
          {
            type: 'diff',
            path: '/src/index.ts',
            oldText: 'old',
            newText: 'new',
          },
        ],
        locations: null,
      };

      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:tool-update');
      const payload = event.payload as any;
      expect(payload.toolCallId).toBe('tc-1');
      expect(payload.status).toBe('completed');
      expect(payload.title).toBe('Read file (done)');
      expect(payload.content).toEqual([
        { type: 'diff', path: '/src/index.ts', oldText: 'old', newText: 'new' },
      ]);
    });

    it('converts null status/title to undefined', () => {
      const update = {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-3',
        status: null,
        title: null,
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const payload = event.payload as any;
      expect(payload.status).toBeUndefined();
      expect(payload.title).toBeUndefined();
    });
  });

  // ===========================================================================
  // mapSessionUpdate — plan
  // ===========================================================================
  describe('mapSessionUpdate — plan', () => {
    it('maps a plan update with entries', () => {
      const update = {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Step 1', status: 'completed', priority: 'high' },
          { content: 'Step 2', status: 'pending', priority: 'medium' },
        ],
      };

      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:plan');
      const plan = (event.payload as any).plan;
      expect(plan.entries).toHaveLength(2);
      expect(plan.entries[0]).toEqual({ content: 'Step 1', status: 'completed', priority: 'high' });
      expect(plan.entries[1]).toEqual({ content: 'Step 2', status: 'pending', priority: 'medium' });
      expect(plan.updatedAt).toBe(TIMESTAMP);
    });

    it('defaults entry status to pending and priority to medium', () => {
      const update = {
        sessionUpdate: 'plan',
        entries: [{ content: 'Task' }],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const entry = (event.payload as any).plan.entries[0];
      expect(entry.status).toBe('pending');
      expect(entry.priority).toBe('medium');
    });

    it('handles empty/missing entries', () => {
      const update = { sessionUpdate: 'plan' };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect((event.payload as any).plan.entries).toEqual([]);
    });
  });

  // ===========================================================================
  // mapSessionUpdate — messages
  // ===========================================================================
  describe('mapSessionUpdate — messages', () => {
    it('maps agent_message_chunk as assistant role', () => {
      const update = {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello!' },
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:message');
      const payload = event.payload as any;
      expect(payload.role).toBe('assistant');
      expect(payload.content).toEqual({ type: 'text', text: 'Hello!' });
    });

    it('maps user_message_chunk as user role', () => {
      const update = {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Fix the bug' },
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:message');
      expect((event.payload as any).role).toBe('user');
    });
  });

  // ===========================================================================
  // mapSessionUpdate — thought
  // ===========================================================================
  describe('mapSessionUpdate — thought', () => {
    it('maps agent_thought_chunk', () => {
      const update = {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Let me think...' },
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:thought');
      expect((event.payload as any).content).toEqual({ type: 'text', text: 'Let me think...' });
    });
  });

  // ===========================================================================
  // mapSessionUpdate — mode change
  // ===========================================================================
  describe('mapSessionUpdate — current_mode_update', () => {
    it('maps mode change', () => {
      const update = {
        sessionUpdate: 'current_mode_update',
        currentMode: 'code',
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:mode-change');
      expect((event.payload as any).mode).toBe('code');
    });
  });

  // ===========================================================================
  // mapSessionUpdate — config update
  // ===========================================================================
  describe('mapSessionUpdate — config_option_update', () => {
    it('maps config update', () => {
      const update = {
        sessionUpdate: 'config_option_update',
        configOptions: [{ id: 'opt-1', name: 'Safety', value: 'on' }],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:config-update');
      expect((event.payload as any).configOptions).toEqual([{ id: 'opt-1', name: 'Safety', value: 'on' }]);
    });
  });

  // ===========================================================================
  // mapSessionUpdate — session info
  // ===========================================================================
  describe('mapSessionUpdate — session_info_update', () => {
    it('maps session info update', () => {
      const update = {
        sessionUpdate: 'session_info_update',
        someInfo: 'value',
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(event.type).toBe('coding-agent:acp:session-info');
      expect((event.payload as any).someInfo).toBe('value');
    });
  });

  // ===========================================================================
  // mapSessionUpdate — edge cases
  // ===========================================================================
  describe('mapSessionUpdate — edge cases', () => {
    it('returns empty for unknown sessionUpdate kind', () => {
      const update = { sessionUpdate: 'unknown_future_type', data: {} };
      const result = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(result).toEqual([]);
    });

    it('returns empty when sessionUpdate field is missing', () => {
      const update = { type: 'something_else' };
      const result = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // Content mapping helpers (tested via tool_call)
  // ===========================================================================
  describe('content mapping', () => {
    it('maps diff content', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-diff',
        title: 'Edit file',
        content: [
          { type: 'diff', path: '/file.ts', oldText: null, newText: 'new content' },
        ],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const content = (event.payload as any).toolCall.content;
      expect(content).toEqual([
        { type: 'diff', path: '/file.ts', oldText: undefined, newText: 'new content' },
      ]);
    });

    it('maps terminal content', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-term',
        title: 'Run cmd',
        content: [{ type: 'terminal', terminalId: 'term-1' }],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const content = (event.payload as any).toolCall.content;
      expect(content).toEqual([{ type: 'terminal', terminalId: 'term-1' }]);
    });

    it('maps content type (ContentBlock wrapper)', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-content',
        title: 'Content',
        content: [
          { type: 'content', content: { type: 'text', text: 'hello' } },
        ],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const content = (event.payload as any).toolCall.content;
      expect(content).toEqual([{ type: 'content', content: { type: 'text', text: 'hello' } }]);
    });

    it('maps unknown content type to text JSON', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-unknown',
        title: 'Unknown',
        content: [{ type: 'future_type', data: 'xyz' }],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const content = (event.payload as any).toolCall.content;
      expect(content[0].type).toBe('text');
      expect(content[0].text).toContain('future_type');
    });

    it('returns undefined for empty content array', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-empty',
        title: 'Empty',
        content: [],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      expect((event.payload as any).toolCall.content).toBeUndefined();
    });

    it('maps locations with line → startLine', () => {
      const update = {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-loc',
        title: 'Loc',
        locations: [
          { path: '/a.ts', line: 42 },
          { path: '/b.ts' },
        ],
      };
      const [event] = mapSessionUpdate(update as any, SESSION_ID, ACP_SESSION_ID);
      const locations = (event.payload as any).toolCall.locations;
      expect(locations).toEqual([
        { path: '/a.ts', startLine: 42 },
        { path: '/b.ts', startLine: undefined },
      ]);
    });
  });
});
