/**
 * Memory Tools
 *
 * Persistent memory operations for the autonomous AI assistant.
 * Allows the AI to store and retrieve facts, preferences, and events.
 * Definitions only - executors are in gateway package.
 */

import type { ToolDefinition } from '../types.js';

// ============================================================================
// MEMORY STORAGE TOOLS
// ============================================================================

/**
 * Remember a fact, preference, or event
 */
export const rememberTool: ToolDefinition = {
  name: 'remember',
  description: `Store important information in persistent memory for future reference.
Use this to save:
- Facts about the user (name, job, preferences)
- Important events (meetings, deadlines, birthdays)
- Learned preferences (communication style, interests)
- Skills and knowledge the user has shared

Memory persists across conversations. Be selective - only remember truly important information.`,
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember (be concise but complete)',
      },
      type: {
        type: 'string',
        enum: ['fact', 'preference', 'event', 'skill'],
        description: 'Type of memory: fact (user info), preference (likes/dislikes), event (important dates), skill (learned capabilities)',
      },
      importance: {
        type: 'number',
        description: 'Importance score from 0 to 1. Higher = more important, less likely to be forgotten. Default: 0.5',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorization (e.g., ["work", "project-x"])',
      },
    },
    required: ['content', 'type'],
  },
};

/**
 * Batch remember multiple facts, preferences, or events
 */
export const batchRememberTool: ToolDefinition = {
  name: 'batch_remember',
  description: `Store multiple pieces of information in persistent memory at once.
Use this for bulk memory creation - more efficient than calling remember multiple times.
Useful for onboarding, importing user data, or storing multiple related facts.`,
  parameters: {
    type: 'object',
    properties: {
      memories: {
        type: 'array',
        description: 'Array of memories to store',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The information to remember',
            },
            type: {
              type: 'string',
              enum: ['fact', 'preference', 'event', 'skill'],
              description: 'Type of memory',
            },
            importance: {
              type: 'number',
              description: 'Importance score from 0 to 1. Default: 0.5',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization',
            },
          },
          required: ['content', 'type'],
        },
      },
    },
    required: ['memories'],
  },
};

/**
 * Recall information from memory
 */
export const recallTool: ToolDefinition = {
  name: 'recall',
  description: `Search persistent memory for relevant information.
Use this to:
- Answer questions about the user
- Find previously mentioned preferences
- Look up past events or deadlines
- Retrieve learned skills or knowledge

Returns matching memories sorted by relevance and importance.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for in memory (natural language)',
      },
      type: {
        type: 'string',
        enum: ['fact', 'preference', 'event', 'skill'],
        description: 'Optional: filter by memory type',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: filter by tags',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 10)',
      },
    },
    required: ['query'],
  },
};

/**
 * Forget a specific memory
 */
export const forgetTool: ToolDefinition = {
  name: 'forget',
  description: `Remove a specific memory. Use with caution.
Only use when:
- User explicitly asks to forget something
- Information is outdated or incorrect
- Memory was stored in error`,
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the memory to forget',
      },
    },
    required: ['memoryId'],
  },
};

/**
 * List recent memories
 */
export const listMemoriesTool: ToolDefinition = {
  name: 'list_memories',
  description: `List recent memories, optionally filtered by type.
Use this to review what has been remembered about the user.`,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['fact', 'preference', 'event', 'skill'],
        description: 'Filter by memory type',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to list (default: 20)',
      },
      minImportance: {
        type: 'number',
        description: 'Only show memories above this importance threshold (0-1)',
      },
    },
    required: [],
  },
};

/**
 * Update a memory's importance
 */
export const boostMemoryTool: ToolDefinition = {
  name: 'boost_memory',
  description: `Increase a memory's importance when it becomes more relevant.
Use this when:
- User mentions the topic again
- The memory becomes more important
- You want to prevent the memory from decaying`,
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the memory to boost',
      },
      amount: {
        type: 'number',
        description: 'Amount to increase importance by (default: 0.1, max 0.5)',
      },
    },
    required: ['memoryId'],
  },
};

/**
 * Get memory statistics
 */
export const memoryStatsTool: ToolDefinition = {
  name: 'memory_stats',
  description: `Get statistics about stored memories.
Shows total count, breakdown by type, and average importance.
Useful for understanding the memory system state.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ============================================================================
// EXPORT ALL MEMORY TOOLS
// ============================================================================

export const MEMORY_TOOLS: ToolDefinition[] = [
  rememberTool,
  batchRememberTool,
  recallTool,
  forgetTool,
  listMemoriesTool,
  boostMemoryTool,
  memoryStatsTool,
];

/**
 * Get tool names for memory operations
 */
export const MEMORY_TOOL_NAMES = MEMORY_TOOLS.map((t) => t.name);
