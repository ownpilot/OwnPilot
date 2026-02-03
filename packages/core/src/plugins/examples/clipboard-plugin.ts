/**
 * Clipboard Manager Plugin
 *
 * Provides clipboard history management with search and pinning.
 * Demonstrates: storage, handlers
 */

import { createPlugin, type MessageHandler, type HandlerContext, type HandlerResult } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Types
// =============================================================================

interface ClipboardItem {
  id: string;
  content: string;
  type: 'text' | 'code' | 'url' | 'json';
  createdAt: string;
  accessedAt: string;
  accessCount: number;
  pinned: boolean;
  tags?: string[];
  source?: string;
}

// =============================================================================
// In-memory storage
// =============================================================================

const clipboardItems: Map<string, ClipboardItem> = new Map();
const MAX_ITEMS = 100;

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(): string {
  return `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function detectType(content: string): ClipboardItem['type'] {
  if (/^https?:\/\/[^\s]+$/.test(content.trim())) {
    return 'url';
  }
  try {
    JSON.parse(content);
    return 'json';
  } catch {
    // Not JSON
  }
  if (
    content.includes('function ') ||
    content.includes('const ') ||
    content.includes('let ') ||
    content.includes('class ') ||
    content.includes('import ') ||
    content.includes('def ') ||
    /[{};]/.test(content)
  ) {
    return 'code';
  }
  return 'text';
}

function cleanup(): void {
  const unpinned = Array.from(clipboardItems.values()).filter(i => !i.pinned);
  if (unpinned.length > MAX_ITEMS) {
    unpinned.sort((a, b) => new Date(a.accessedAt).getTime() - new Date(b.accessedAt).getTime());
    const toRemove = unpinned.slice(0, unpinned.length - MAX_ITEMS);
    for (const item of toRemove) {
      clipboardItems.delete(item.id);
    }
  }
}

// =============================================================================
// Tool Definitions
// =============================================================================

const saveTool: ToolDefinition = {
  name: 'clipboard_save',
  description: 'Save text to clipboard history with optional tags',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Text content to save',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for organization',
      },
      source: {
        type: 'string',
        description: 'Optional source description',
      },
    },
    required: ['content'],
  },
};

const historyTool: ToolDefinition = {
  name: 'clipboard_history',
  description: 'Get clipboard history with optional filtering',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum items to return (default: 20)',
      },
      type: {
        type: 'string',
        enum: ['text', 'code', 'url', 'json'],
        description: 'Filter by content type',
      },
      pinnedOnly: {
        type: 'boolean',
        description: 'Only return pinned items',
      },
    },
  },
};

const getTool: ToolDefinition = {
  name: 'clipboard_get',
  description: 'Get a specific clipboard item by ID',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Clipboard item ID',
      },
    },
    required: ['id'],
  },
};

const searchTool: ToolDefinition = {
  name: 'clipboard_search',
  description: 'Search clipboard history by content or tags',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      type: {
        type: 'string',
        enum: ['text', 'code', 'url', 'json'],
        description: 'Filter by content type',
      },
    },
    required: ['query'],
  },
};

const pinTool: ToolDefinition = {
  name: 'clipboard_pin',
  description: 'Pin or unpin a clipboard item to prevent auto-deletion',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Clipboard item ID',
      },
      pinned: {
        type: 'boolean',
        description: 'Pin state (default: true)',
      },
    },
    required: ['id'],
  },
};

const clearTool: ToolDefinition = {
  name: 'clipboard_clear',
  description: 'Clear clipboard history',
  parameters: {
    type: 'object',
    properties: {
      keepPinned: {
        type: 'boolean',
        description: 'Keep pinned items (default: true)',
      },
    },
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

const saveExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const content = params.content as string;
  const tags = params.tags as string[] | undefined;
  const source = params.source as string | undefined;
  const now = new Date().toISOString();

  // Check for duplicate
  for (const item of clipboardItems.values()) {
    if (item.content === content) {
      item.accessedAt = now;
      item.accessCount++;
      if (tags) {
        item.tags = [...new Set([...(item.tags || []), ...tags])];
      }
      return {
        content: {
          success: true,
          message: 'Updated existing clipboard item',
          item: {
            id: item.id,
            type: item.type,
            preview: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
          },
        },
      };
    }
  }

  const item: ClipboardItem = {
    id: generateId(),
    content,
    type: detectType(content),
    createdAt: now,
    accessedAt: now,
    accessCount: 1,
    pinned: false,
    tags,
    source,
  };

  clipboardItems.set(item.id, item);
  cleanup();

  return {
    content: {
      success: true,
      message: 'Saved to clipboard history',
      item: {
        id: item.id,
        type: item.type,
        preview: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
      },
    },
  };
};

const historyExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const limit = (params.limit as number) || 20;
  const type = params.type as ClipboardItem['type'] | undefined;
  const pinnedOnly = params.pinnedOnly === true;

  let items = Array.from(clipboardItems.values());

  if (type) {
    items = items.filter(item => item.type === type);
  }
  if (pinnedOnly) {
    items = items.filter(item => item.pinned);
  }

  // Sort: pinned first, then by access time
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime();
  });

  items = items.slice(0, limit);

  const byType: Record<string, number> = {};
  for (const item of clipboardItems.values()) {
    byType[item.type] = (byType[item.type] || 0) + 1;
  }

  return {
    content: {
      success: true,
      items: items.map(item => ({
        id: item.id,
        type: item.type,
        preview: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
        createdAt: item.createdAt,
        accessedAt: item.accessedAt,
        accessCount: item.accessCount,
        pinned: item.pinned,
        tags: item.tags,
      })),
      stats: {
        total: clipboardItems.size,
        pinned: Array.from(clipboardItems.values()).filter(i => i.pinned).length,
        byType,
      },
    },
  };
};

const getExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const id = params.id as string;
  const item = clipboardItems.get(id);

  if (!item) {
    return {
      content: { error: 'Clipboard item not found' },
      isError: true,
    };
  }

  item.accessedAt = new Date().toISOString();
  item.accessCount++;

  return {
    content: {
      id: item.id,
      content: item.content,
      type: item.type,
      createdAt: item.createdAt,
      accessedAt: item.accessedAt,
      accessCount: item.accessCount,
      pinned: item.pinned,
      tags: item.tags,
      source: item.source,
    },
  };
};

const searchExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const query = (params.query as string).toLowerCase();
  const type = params.type as ClipboardItem['type'] | undefined;

  let results = Array.from(clipboardItems.values()).filter(item => {
    const contentMatch = item.content.toLowerCase().includes(query);
    const tagMatch = item.tags?.some(tag => tag.toLowerCase().includes(query));
    return contentMatch || tagMatch;
  });

  if (type) {
    results = results.filter(item => item.type === type);
  }

  return {
    content: {
      success: true,
      query,
      results: results.map(item => ({
        id: item.id,
        type: item.type,
        preview: item.content.substring(0, 100) + (item.content.length > 100 ? '...' : ''),
        pinned: item.pinned,
        tags: item.tags,
      })),
      count: results.length,
    },
  };
};

const pinExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const id = params.id as string;
  const pinned = params.pinned !== false;
  const item = clipboardItems.get(id);

  if (!item) {
    return {
      content: { error: 'Clipboard item not found' },
      isError: true,
    };
  }

  item.pinned = pinned;

  return {
    content: {
      success: true,
      id: item.id,
      pinned: item.pinned,
      message: pinned ? 'Item pinned' : 'Item unpinned',
    },
  };
};

const clearExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const keepPinned = params.keepPinned !== false;
  const before = clipboardItems.size;

  if (keepPinned) {
    for (const [id, item] of clipboardItems) {
      if (!item.pinned) {
        clipboardItems.delete(id);
      }
    }
  } else {
    clipboardItems.clear();
  }

  return {
    content: {
      success: true,
      removed: before - clipboardItems.size,
      remaining: clipboardItems.size,
      message: `Cleared ${before - clipboardItems.size} items`,
    },
  };
};

// =============================================================================
// Message Handler
// =============================================================================

const clipboardHandler: MessageHandler = {
  name: 'clipboard-handler',
  description: 'Handles clipboard-related queries',
  priority: 35,

  canHandle: async (message: string): Promise<boolean> => {
    const lower = message.toLowerCase();
    return /\b(clipboard|copy|paste|copied|pano)\b/i.test(lower);
  },

  handle: async (message: string, _context: HandlerContext): Promise<HandlerResult> => {
    const lower = message.toLowerCase();

    if (/search|find|ara/i.test(lower)) {
      return { handled: false }; // Let AI handle with tool
    }

    // Default: show history
    return {
      handled: true,
      toolCalls: [
        {
          tool: 'clipboard_history',
          args: { limit: 5 },
        },
      ],
    };
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const clipboardPlugin = createPlugin()
  .meta({
    id: 'clipboard-manager',
    name: 'Clipboard Manager',
    version: '1.0.0',
    description: 'Smart clipboard history with search, pinning, and text manipulation',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools', 'handlers', 'storage'],
    permissions: ['storage'],
    icon: '📋',
    pluginConfigSchema: [
      { name: 'maxItems', label: 'Max Items', type: 'number', description: 'Maximum items to keep in history', defaultValue: 100 },
    ],
    defaultConfig: {
      maxItems: 100,
    },
  })
  .tools([
    { definition: saveTool, executor: saveExecutor },
    { definition: historyTool, executor: historyExecutor },
    { definition: getTool, executor: getExecutor },
    { definition: searchTool, executor: searchExecutor },
    { definition: pinTool, executor: pinExecutor },
    { definition: clearTool, executor: clearExecutor },
  ])
  .handler(clipboardHandler)
  .hooks({
    onLoad: async () => {
      console.log('[ClipboardPlugin] Loaded');
    },
  })
  .build();
