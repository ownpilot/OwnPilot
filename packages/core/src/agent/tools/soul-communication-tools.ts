/**
 * Soul Communication Tools
 *
 * Agent-to-agent messaging tools exposed via the meta-tool proxy.
 * These let agents send messages, read their inbox, and reply in threads.
 */

import type { ToolDefinition } from '../types.js';

export const SOUL_COMMUNICATION_TOOLS: ToolDefinition[] = [
  {
    name: 'send_agent_message',
    description:
      'Send a message to another agent in your crew. Use for task delegation, status updates, questions, and knowledge sharing.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        to_agent: {
          type: 'string',
          description: 'Name or ID of the target agent',
        },
        type: {
          type: 'string',
          enum: [
            'task_delegation',
            'task_result',
            'question',
            'feedback',
            'alert',
            'coordination',
            'knowledge_share',
          ],
          description: 'Message type',
        },
        subject: {
          type: 'string',
          description: 'Message subject line',
        },
        content: {
          type: 'string',
          description: 'Message body',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Message priority (default: normal)',
        },
        requires_response: {
          type: 'boolean',
          description: 'Whether the recipient should respond (default: false)',
        },
      },
      required: ['to_agent', 'type', 'subject', 'content'],
    },
  },
  {
    name: 'read_agent_inbox',
    description:
      'Check your inbox for messages from other agents. Returns unread messages by default.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        unread_only: {
          type: 'boolean',
          description: 'Only return unread messages (default: true)',
        },
        from_agent: {
          type: 'string',
          description: 'Filter by sender agent name or ID (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'reply_to_agent',
    description: 'Reply to a message in an existing conversation thread.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        thread_id: {
          type: 'string',
          description: 'Thread ID to reply in',
        },
        content: {
          type: 'string',
          description: 'Reply message content',
        },
      },
      required: ['thread_id', 'content'],
    },
  },
];

export const SOUL_COMMUNICATION_TOOL_NAMES = SOUL_COMMUNICATION_TOOLS.map((t) => t.name);
