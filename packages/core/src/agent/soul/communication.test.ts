/**
 * Tests for Agent Communication Type Definitions (communication.ts)
 *
 * Covers: type exports, interface shapes, and structural contracts.
 * Since communication.ts is a pure types/interfaces file, we validate
 * the types are exported correctly, interfaces have all expected properties,
 * and the IAgentCommunicationBus contract is well-formed.
 */

import { describe, it, expect } from 'vitest';

// Import types at runtime — they're erased but imports validate the exports exist
import type {
  AgentMessageType,
  MessagePriority,
  MessageStatus,
  AgentMessage,
  AgentAttachment,
  MessageQueryOptions,
  IAgentCommunicationBus,
} from './communication.js';

// Because interfaces don't exist at runtime, we test the exported module
// by verifying the module object has the expected shape.
const commModule = await import('./communication.js');

// ============================================================================
// Module exports
// ============================================================================

describe('communication.ts exports', () => {
  it('exports type AgentMessageType', () => {
    // Runtime check: types are erased, but we assert the const values exist
    // We can't check the type directly, but we verify the module loads
    expect(commModule).toBeDefined();
  });

  it('AgentMessageType has expected literal values', () => {
    // Validate string literal via a compile-time-checked assignment
    const types: AgentMessageType[] = [
      'task_delegation',
      'task_result',
      'status_update',
      'question',
      'feedback',
      'alert',
      'coordination',
      'knowledge_share',
    ];
    expect(types).toHaveLength(8);
    expect(types).toContain('task_delegation');
    expect(types).toContain('task_result');
    expect(types).toContain('status_update');
    expect(types).toContain('question');
    expect(types).toContain('feedback');
    expect(types).toContain('alert');
    expect(types).toContain('coordination');
    expect(types).toContain('knowledge_share');
  });

  it('MessagePriority has expected literal values', () => {
    const priorities: MessagePriority[] = ['low', 'normal', 'high', 'urgent'];
    expect(priorities).toHaveLength(4);
    expect(priorities).toContain('low');
    expect(priorities).toContain('normal');
    expect(priorities).toContain('high');
    expect(priorities).toContain('urgent');
  });

  it('MessageStatus has expected literal values', () => {
    const statuses: MessageStatus[] = ['sent', 'delivered', 'read', 'replied'];
    expect(statuses).toHaveLength(4);
    expect(statuses).toContain('sent');
    expect(statuses).toContain('delivered');
    expect(statuses).toContain('read');
    expect(statuses).toContain('replied');
  });
});

// ============================================================================
// AgentMessage interface contract
// ============================================================================

describe('AgentMessage interface', () => {
  it('can construct a valid AgentMessage object', () => {
    const msg: AgentMessage = {
      id: 'msg-1',
      from: 'agent-a',
      to: 'agent-b',
      type: 'task_delegation',
      subject: 'Process data',
      content: 'Please process the incoming data file',
      priority: 'normal',
      requiresResponse: true,
      status: 'sent',
      createdAt: new Date('2025-01-01'),
    };
    expect(msg.id).toBe('msg-1');
    expect(msg.from).toBe('agent-a');
    expect(msg.to).toBe('agent-b');
    expect(msg.type).toBe('task_delegation');
    expect(msg.subject).toBe('Process data');
    expect(msg.requiresResponse).toBe(true);
    expect(msg.status).toBe('sent');
  });

  it('supports optional fields', () => {
    const msg: AgentMessage = {
      id: 'msg-2',
      from: 'agent-c',
      to: 'broadcast',
      type: 'alert',
      subject: 'System alert',
      content: 'CPU usage critical',
      attachments: [{ type: 'data', id: 'd-1', title: 'Metrics' }],
      priority: 'urgent',
      threadId: 'thread-1',
      requiresResponse: false,
      deadline: new Date('2025-02-01'),
      status: 'delivered',
      crewId: 'crew-1',
      workspaceId: 'ws-1',
      createdAt: new Date(),
      readAt: new Date(),
    };
    expect(msg.attachments).toHaveLength(1);
    expect(msg.threadId).toBe('thread-1');
    expect(msg.deadline).toBeInstanceOf(Date);
    expect(msg.crewId).toBe('crew-1');
    expect(msg.workspaceId).toBe('ws-1');
    expect(msg.readAt).toBeInstanceOf(Date);
  });

  it('allows broadcast by using "broadcast" as recipient', () => {
    const msg: AgentMessage = {
      id: 'msg-3',
      from: 'agent-a',
      to: 'broadcast',
      type: 'coordination',
      subject: 'All hands',
      content: 'Status update',
      priority: 'high',
      requiresResponse: false,
      status: 'sent',
      createdAt: new Date(),
    };
    expect(msg.to).toBe('broadcast');
  });
});

// ============================================================================
// AgentAttachment interface
// ============================================================================

describe('AgentAttachment interface', () => {
  it('supports all attachment types', () => {
    const types: AgentAttachment['type'][] = ['note', 'task', 'memory', 'data', 'artifact'];
    expect(types).toHaveLength(5);
  });

  it('can construct an attachment with title', () => {
    const att: AgentAttachment = { type: 'note', id: 'n-1', title: 'Meeting notes' };
    expect(att.type).toBe('note');
    expect(att.id).toBe('n-1');
    expect(att.title).toBe('Meeting notes');
  });

  it('can construct an attachment without title', () => {
    const att: AgentAttachment = { type: 'task', id: 't-1' };
    expect(att.title).toBeUndefined();
  });
});

// ============================================================================
// MessageQueryOptions
// ============================================================================

describe('MessageQueryOptions interface', () => {
  it('allows partial options', () => {
    const opts: MessageQueryOptions = { unreadOnly: true };
    expect(opts.unreadOnly).toBe(true);
    expect(opts.limit).toBeUndefined();
    expect(opts.types).toBeUndefined();
  });

  it('can specify all query options', () => {
    const opts: MessageQueryOptions = {
      unreadOnly: true,
      limit: 50,
      types: ['task_delegation', 'status_update'],
      fromAgent: 'agent-a',
    };
    expect(opts.limit).toBe(50);
    expect(opts.types).toHaveLength(2);
    expect(opts.fromAgent).toBe('agent-a');
  });
});

// ============================================================================
// IAgentCommunicationBus interface
// ============================================================================

describe('IAgentCommunicationBus interface', () => {
  it('defines the expected 6 methods', () => {
    // We check that an implementation can be created with all methods
    const bus: IAgentCommunicationBus = {
      send: async () => 'msg-id',
      readInbox: async () => [],
      broadcast: async () => ({ delivered: [], failed: [] }),
      getConversation: async () => [],
      getThread: async () => [],
      getUnreadCount: async () => 0,
    };
    expect(typeof bus.send).toBe('function');
    expect(typeof bus.readInbox).toBe('function');
    expect(typeof bus.broadcast).toBe('function');
    expect(typeof bus.getConversation).toBe('function');
    expect(typeof bus.getThread).toBe('function');
    expect(typeof bus.getUnreadCount).toBe('function');
  });

  it('send returns a Promise<string>', async () => {
    const bus: IAgentCommunicationBus = {
      send: async () => 'generated-id-42',
      readInbox: async () => [],
      broadcast: async () => ({ delivered: [], failed: [] }),
      getConversation: async () => [],
      getThread: async () => [],
      getUnreadCount: async () => 0,
    };
    const id = await bus.send({
      from: 'test',
      to: 'test2',
      type: 'feedback',
      subject: 'Hi',
      content: 'Hello',
      priority: 'normal',
      requiresResponse: false,
    });
    expect(typeof id).toBe('string');
    expect(id).toBe('generated-id-42');
  });

  it('broadcast returns delivery results', async () => {
    const bus: IAgentCommunicationBus = {
      send: async () => '',
      readInbox: async () => [],
      broadcast: async () => ({ delivered: ['agent-b'], failed: [] }),
      getConversation: async () => [],
      getThread: async () => [],
      getUnreadCount: async () => 0,
    };
    const result = await bus.broadcast('crew-1', {
      from: 'agent-a',
      type: 'coordination',
      subject: 'Sync',
      content: 'Meeting now',
      priority: 'normal',
      requiresResponse: false,
    });
    expect(result.delivered).toContain('agent-b');
    expect(result.failed).toHaveLength(0);
  });

  it('getUnreadCount returns a number', async () => {
    const bus: IAgentCommunicationBus = {
      send: async () => '',
      readInbox: async () => [],
      broadcast: async () => ({ delivered: [], failed: [] }),
      getConversation: async () => [],
      getThread: async () => [],
      getUnreadCount: async () => 5,
    };
    const count = await bus.getUnreadCount('agent-a');
    expect(count).toBe(5);
  });
});
