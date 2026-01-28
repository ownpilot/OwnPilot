/**
 * Quick Capture Plugin
 *
 * Quickly capture ideas, thoughts, and snippets for later processing.
 * Like a digital inbox for your brain.
 * - Quick capture with minimal friction
 * - Auto-categorization
 * - Processing workflow
 * - Integration with notes/tasks
 */

import { createPlugin } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Types
// =============================================================================

type CaptureType = 'idea' | 'thought' | 'todo' | 'link' | 'quote' | 'snippet' | 'question' | 'other';

interface Capture {
  id: string;
  content: string;
  type: CaptureType;
  tags: string[];
  source?: string;
  url?: string;
  processed: boolean;
  processedAs?: {
    type: 'note' | 'task' | 'bookmark' | 'discarded';
    id?: string;
  };
  createdAt: string;
  processedAt?: string;
}

// In-memory storage
const captures: Map<string, Capture> = new Map();

// =============================================================================
// Helper Functions
// =============================================================================

function detectType(content: string): CaptureType {
  const lower = content.toLowerCase();

  // URL detection
  if (/https?:\/\/[^\s]+/.test(content)) return 'link';

  // Quote detection
  if (/^["'].*["']$/.test(content.trim()) || /^>/.test(content)) return 'quote';

  // Question detection
  if (/\?$/.test(content.trim()) || /^(what|why|how|when|where|who|can|should|would)/i.test(content)) return 'question';

  // Todo detection
  if (/^(todo|task|remember to|don't forget|need to|must|should)/i.test(lower)) return 'todo';

  // Code snippet detection
  if (/```|function\s|const\s|let\s|var\s|import\s|class\s|def\s|public\s/.test(content)) return 'snippet';

  // Idea indicators
  if (/^(idea|what if|maybe|could|might be|consider)/i.test(lower)) return 'idea';

  return 'thought';
}

function extractTags(content: string): string[] {
  const tags: string[] = [];

  // Extract hashtags
  const hashtagMatches = content.match(/#(\w+)/g);
  if (hashtagMatches) {
    tags.push(...hashtagMatches.map(t => t.slice(1).toLowerCase()));
  }

  // Extract @mentions as context tags
  const mentionMatches = content.match(/@(\w+)/g);
  if (mentionMatches) {
    tags.push(...mentionMatches.map(t => `person:${t.slice(1).toLowerCase()}`));
  }

  return [...new Set(tags)];
}

function extractUrl(content: string): string | undefined {
  const urlMatch = content.match(/https?:\/\/[^\s]+/);
  return urlMatch?.[0];
}

// =============================================================================
// Tool Definitions
// =============================================================================

const quickCaptureTool: ToolDefinition = {
  name: 'capture',
  description: 'Quickly capture an idea, thought, link, or anything for later processing',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to capture',
      },
      type: {
        type: 'string',
        enum: ['idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other'],
        description: 'Type of capture (auto-detected if not specified)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for organization (also auto-extracted from #hashtags)',
      },
      source: {
        type: 'string',
        description: 'Where this came from (book, conversation, article, etc.)',
      },
    },
    required: ['content'],
  },
};

const listCapturesTool: ToolDefinition = {
  name: 'capture_list',
  description: 'List captured items, optionally filtered',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other'],
        description: 'Filter by type',
      },
      tag: {
        type: 'string',
        description: 'Filter by tag',
      },
      processed: {
        type: 'boolean',
        description: 'Filter by processed status',
      },
      limit: {
        type: 'number',
        description: 'Maximum items to return (default: 20)',
      },
    },
    required: [],
  },
};

const processCaptureTool: ToolDefinition = {
  name: 'capture_process',
  description: 'Process a captured item (convert to note, task, or discard)',
  parameters: {
    type: 'object',
    properties: {
      captureId: {
        type: 'string',
        description: 'ID of the capture to process',
      },
      action: {
        type: 'string',
        enum: ['note', 'task', 'bookmark', 'discard', 'keep'],
        description: 'How to process this capture',
      },
      additionalInfo: {
        type: 'string',
        description: 'Additional context for processing (e.g., note title, task due date)',
      },
    },
    required: ['captureId', 'action'],
  },
};

const captureInboxTool: ToolDefinition = {
  name: 'capture_inbox',
  description: 'Get unprocessed captures (your inbox)',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum items (default: 10)',
      },
    },
    required: [],
  },
};

const captureStatsTool: ToolDefinition = {
  name: 'capture_stats',
  description: 'Get capture statistics',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

const deleteCaptureTool: ToolDefinition = {
  name: 'capture_delete',
  description: 'Delete a capture',
  parameters: {
    type: 'object',
    properties: {
      captureId: {
        type: 'string',
        description: 'ID of the capture to delete',
      },
    },
    required: ['captureId'],
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

const quickCaptureExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const content = params.content as string;
  const autoTags = extractTags(content);
  const manualTags = (params.tags as string[]) || [];

  const capture: Capture = {
    id: `cap_${Date.now()}`,
    content,
    type: (params.type as CaptureType) || detectType(content),
    tags: [...new Set([...autoTags, ...manualTags])],
    source: params.source as string | undefined,
    url: extractUrl(content),
    processed: false,
    createdAt: new Date().toISOString(),
  };

  captures.set(capture.id, capture);

  return {
    content: {
      message: 'Captured!',
      capture: {
        id: capture.id,
        type: capture.type,
        tags: capture.tags,
        preview: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
      },
      inboxCount: Array.from(captures.values()).filter(c => !c.processed).length,
    },
    isError: false,
  };
};

const listCapturesExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  let filtered = Array.from(captures.values());

  if (params.type) {
    filtered = filtered.filter(c => c.type === params.type);
  }

  if (params.tag) {
    const tag = (params.tag as string).toLowerCase();
    filtered = filtered.filter(c => c.tags.some(t => t.toLowerCase().includes(tag)));
  }

  if (params.processed !== undefined) {
    filtered = filtered.filter(c => c.processed === params.processed);
  }

  // Sort by newest first
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const limit = (params.limit as number) || 20;
  filtered = filtered.slice(0, limit);

  return {
    content: {
      captures: filtered.map(c => ({
        id: c.id,
        type: c.type,
        content: c.content.slice(0, 200) + (c.content.length > 200 ? '...' : ''),
        tags: c.tags,
        processed: c.processed,
        createdAt: c.createdAt,
      })),
      total: filtered.length,
    },
    isError: false,
  };
};

const processCaptureExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const capture = captures.get(params.captureId as string);

  if (!capture) {
    return {
      content: { error: 'Capture not found' },
      isError: true,
    };
  }

  const action = params.action as string;

  if (action === 'keep') {
    return {
      content: {
        message: 'Capture kept in inbox',
        capture: { id: capture.id, content: capture.content.slice(0, 100) },
      },
      isError: false,
    };
  }

  capture.processed = true;
  capture.processedAt = new Date().toISOString();

  if (action === 'discard') {
    capture.processedAs = { type: 'discarded' };
    return {
      content: {
        message: 'Capture discarded',
        captureId: capture.id,
      },
      isError: false,
    };
  }

  // For note/task/bookmark, we'd integrate with those systems
  // For now, just mark as processed
  capture.processedAs = {
    type: action as 'note' | 'task' | 'bookmark',
  };

  return {
    content: {
      message: `Capture marked for ${action}`,
      capture: {
        id: capture.id,
        content: capture.content,
        processedAs: capture.processedAs,
      },
      hint: `To complete, use the ${action}s system to create the actual item.`,
    },
    isError: false,
  };
};

const captureInboxExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const limit = (params.limit as number) || 10;

  const inbox = Array.from(captures.values())
    .filter(c => !c.processed)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const byType: Record<string, number> = {};
  inbox.forEach(c => {
    byType[c.type] = (byType[c.type] || 0) + 1;
  });

  return {
    content: {
      inbox: inbox.map(c => ({
        id: c.id,
        type: c.type,
        content: c.content.slice(0, 150) + (c.content.length > 150 ? '...' : ''),
        tags: c.tags,
        age: Math.round((Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60)) + ' hours ago',
      })),
      count: inbox.length,
      totalUnprocessed: Array.from(captures.values()).filter(c => !c.processed).length,
      byType,
      message: inbox.length === 0
        ? 'Inbox is empty! Great job processing your captures.'
        : `${inbox.length} items need processing`,
    },
    isError: false,
  };
};

const captureStatsExecutor: ToolExecutor = async (): Promise<ToolExecutionResult> => {
  const all = Array.from(captures.values());
  const processed = all.filter(c => c.processed);
  const unprocessed = all.filter(c => !c.processed);

  const byType: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  const processedAs: Record<string, number> = {};

  all.forEach(c => {
    byType[c.type] = (byType[c.type] || 0) + 1;
    c.tags.forEach(t => {
      byTag[t] = (byTag[t] || 0) + 1;
    });
    if (c.processedAs) {
      processedAs[c.processedAs.type] = (processedAs[c.processedAs.type] || 0) + 1;
    }
  });

  // Sort tags by count
  const topTags = Object.entries(byTag)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    content: {
      total: all.length,
      processed: processed.length,
      unprocessed: unprocessed.length,
      processingRate: all.length > 0 ? Math.round((processed.length / all.length) * 100) : 0,
      byType,
      topTags,
      processedAs,
    },
    isError: false,
  };
};

const deleteCaptureExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const captureId = params.captureId as string;

  if (!captures.has(captureId)) {
    return {
      content: { error: 'Capture not found' },
      isError: true,
    };
  }

  captures.delete(captureId);

  return {
    content: {
      message: 'Capture deleted',
      captureId,
    },
    isError: false,
  };
};

// =============================================================================
// Plugin Export
// =============================================================================

export const quickCapturePlugin = createPlugin()
  .meta({
    id: 'dev.ownpilot.quick-capture',
    name: 'Quick Capture',
    version: '1.0.0',
    description: 'Quickly capture ideas, thoughts, and snippets for later processing',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools', 'storage'],
    permissions: ['storage'],
    icon: '📥',
  })
  .tool(quickCaptureTool, quickCaptureExecutor)
  .tool(listCapturesTool, listCapturesExecutor)
  .tool(processCaptureTool, processCaptureExecutor)
  .tool(captureInboxTool, captureInboxExecutor)
  .tool(captureStatsTool, captureStatsExecutor)
  .tool(deleteCaptureTool, deleteCaptureExecutor)
  .build();
