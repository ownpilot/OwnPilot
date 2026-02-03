/**
 * News & RSS Plugin
 *
 * Provides news aggregation and RSS feed management.
 * Demonstrates: network access, storage, scheduled tasks
 */

import { createPlugin, type MessageHandler, type HandlerContext, type HandlerResult } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Types
// =============================================================================

interface RSSFeed {
  id: string;
  url: string;
  title: string;
  description?: string;
  category?: string;
  lastFetched?: string;
  itemCount?: number;
}

interface NewsItem {
  id: string;
  feedId: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  categories?: string[];
  read?: boolean;
  saved?: boolean;
}

// =============================================================================
// Tool Definitions
// =============================================================================

const addFeedTool: ToolDefinition = {
  name: 'news_add_feed',
  description: 'Add an RSS/Atom feed to track',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'RSS/Atom feed URL',
      },
      category: {
        type: 'string',
        description: 'Category to organize the feed (e.g., "tech", "news")',
      },
    },
    required: ['url'],
  },
};

const listFeedsTool: ToolDefinition = {
  name: 'news_list_feeds',
  description: 'List all subscribed RSS feeds',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category',
      },
    },
  },
};

const removeFeedTool: ToolDefinition = {
  name: 'news_remove_feed',
  description: 'Remove an RSS feed subscription',
  parameters: {
    type: 'object',
    properties: {
      feedId: {
        type: 'string',
        description: 'Feed ID to remove',
      },
    },
    required: ['feedId'],
  },
};

const getNewsTool: ToolDefinition = {
  name: 'news_get_latest',
  description: 'Get latest news from subscribed feeds',
  parameters: {
    type: 'object',
    properties: {
      feedId: {
        type: 'string',
        description: 'Specific feed ID (optional, all feeds if not specified)',
      },
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of items (default: 10)',
      },
      unreadOnly: {
        type: 'boolean',
        description: 'Only show unread items',
      },
    },
  },
};

const markReadTool: ToolDefinition = {
  name: 'news_mark_read',
  description: 'Mark news items as read',
  parameters: {
    type: 'object',
    properties: {
      itemIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Item IDs to mark as read',
      },
      all: {
        type: 'boolean',
        description: 'Mark all items as read',
      },
    },
  },
};

const searchNewsTool: ToolDefinition = {
  name: 'news_search',
  description: 'Search news items by keyword',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      feedId: {
        type: 'string',
        description: 'Limit search to specific feed',
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 20)',
      },
    },
    required: ['query'],
  },
};

// =============================================================================
// In-memory storage (replace with actual storage in production)
// =============================================================================

const feeds: Map<string, RSSFeed> = new Map();
const newsItems: Map<string, NewsItem> = new Map();

// =============================================================================
// Tool Executors
// =============================================================================

const addFeedExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const url = params.url as string;
  const category = params.category as string | undefined;

  // Generate feed ID
  const id = `feed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // In production, fetch and parse the RSS feed to get title/description
  const feed: RSSFeed = {
    id,
    url,
    title: `Feed from ${new URL(url).hostname}`,
    category,
    lastFetched: new Date().toISOString(),
    itemCount: 0,
  };

  feeds.set(id, feed);

  return {
    content: {
      success: true,
      message: 'Feed added successfully',
      feed,
      note: 'In production, the feed would be fetched and parsed to get actual title and items',
    },
  };
};

const listFeedsExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const category = params.category as string | undefined;

  let feedList = Array.from(feeds.values());

  if (category) {
    feedList = feedList.filter(f => f.category === category);
  }

  return {
    content: {
      success: true,
      feeds: feedList,
      totalCount: feedList.length,
      categories: [...new Set(Array.from(feeds.values()).map(f => f.category).filter(Boolean))],
    },
  };
};

const removeFeedExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const feedId = params.feedId as string;

  if (!feeds.has(feedId)) {
    return {
      content: { error: `Feed not found: ${feedId}` },
      isError: true,
    };
  }

  const feed = feeds.get(feedId)!;
  feeds.delete(feedId);

  // Remove associated news items
  for (const [itemId, item] of newsItems) {
    if (item.feedId === feedId) {
      newsItems.delete(itemId);
    }
  }

  return {
    content: {
      success: true,
      message: `Feed "${feed.title}" removed`,
      removedFeedId: feedId,
    },
  };
};

const getNewsExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const feedId = params.feedId as string | undefined;
  const category = params.category as string | undefined;
  const limit = (params.limit as number) || 10;
  const unreadOnly = params.unreadOnly === true;

  let items = Array.from(newsItems.values());

  // Filter by feed
  if (feedId) {
    items = items.filter(item => item.feedId === feedId);
  }

  // Filter by category
  if (category) {
    const feedsInCategory = Array.from(feeds.values())
      .filter(f => f.category === category)
      .map(f => f.id);
    items = items.filter(item => feedsInCategory.includes(item.feedId));
  }

  // Filter unread
  if (unreadOnly) {
    items = items.filter(item => !item.read);
  }

  // Sort by date (newest first)
  items.sort((a, b) => {
    const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return dateB - dateA;
  });

  // Limit results
  items = items.slice(0, limit);

  return {
    content: {
      success: true,
      items,
      count: items.length,
      unreadCount: Array.from(newsItems.values()).filter(i => !i.read).length,
    },
  };
};

const markReadExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const itemIds = params.itemIds as string[] | undefined;
  const all = params.all === true;

  let markedCount = 0;

  if (all) {
    for (const item of newsItems.values()) {
      if (!item.read) {
        item.read = true;
        markedCount++;
      }
    }
  } else if (itemIds) {
    for (const id of itemIds) {
      const item = newsItems.get(id);
      if (item && !item.read) {
        item.read = true;
        markedCount++;
      }
    }
  }

  return {
    content: {
      success: true,
      markedCount,
      message: `Marked ${markedCount} items as read`,
    },
  };
};

const searchNewsExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const query = (params.query as string).toLowerCase();
  const feedId = params.feedId as string | undefined;
  const limit = (params.limit as number) || 20;

  let items = Array.from(newsItems.values());

  // Filter by feed
  if (feedId) {
    items = items.filter(item => item.feedId === feedId);
  }

  // Search in title and description
  items = items.filter(item => {
    const titleMatch = item.title.toLowerCase().includes(query);
    const descMatch = item.description?.toLowerCase().includes(query);
    return titleMatch || descMatch;
  });

  // Limit results
  items = items.slice(0, limit);

  return {
    content: {
      success: true,
      query,
      items,
      count: items.length,
    },
  };
};

// =============================================================================
// Message Handler
// =============================================================================

const newsHandler: MessageHandler = {
  name: 'news-handler',
  description: 'Handles news-related queries like "show me the news" or "any updates?"',
  priority: 40,

  canHandle: async (message: string): Promise<boolean> => {
    const lower = message.toLowerCase();
    return /\b(news|rss|feed|headlines?|updates?|articles?)\b/i.test(lower);
  },

  handle: async (message: string, _context: HandlerContext): Promise<HandlerResult> => {
    const lower = message.toLowerCase();

    // Check for specific actions
    if (/add.*(feed|rss|subscribe)/i.test(lower)) {
      return { handled: false }; // Let AI handle with tool
    }

    // Default: show latest news
    return {
      handled: true,
      toolCalls: [
        {
          tool: 'news_get_latest',
          args: { limit: 5, unreadOnly: true },
        },
      ],
    };
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const newsPlugin = createPlugin()
  .meta({
    id: 'news-rss',
    name: 'News & RSS Reader',
    version: '1.0.0',
    description: 'Subscribe to RSS feeds and get news updates',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools', 'handlers', 'storage', 'scheduled'],
    permissions: ['network', 'storage'],
    icon: '📰',
    configSchema: {
      type: 'object',
      properties: {
        refreshInterval: {
          type: 'number',
          description: 'Feed refresh interval in minutes',
          default: 30,
        },
        maxItemsPerFeed: {
          type: 'number',
          description: 'Maximum items to store per feed',
          default: 100,
        },
      },
    },
    defaultConfig: {
      refreshInterval: 30,
      maxItemsPerFeed: 100,
    },
  })
  .tools([
    { definition: addFeedTool, executor: addFeedExecutor },
    { definition: listFeedsTool, executor: listFeedsExecutor },
    { definition: removeFeedTool, executor: removeFeedExecutor },
    { definition: getNewsTool, executor: getNewsExecutor },
    { definition: markReadTool, executor: markReadExecutor },
    { definition: searchNewsTool, executor: searchNewsExecutor },
  ])
  .handler(newsHandler)
  .hooks({
    onLoad: async () => {
      console.log('[NewsPlugin] Loaded');
    },
    onEnable: async () => {
      console.log('[NewsPlugin] Enabled - would start feed refresh scheduler');
    },
    onDisable: async () => {
      console.log('[NewsPlugin] Disabled - would stop feed refresh scheduler');
    },
  })
  .build();
