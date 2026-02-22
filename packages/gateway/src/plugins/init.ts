/**
 * Plugin Initialization
 *
 * Registers all built-in plugins on gateway startup.
 * Each plugin's state (enabled/disabled, settings, permissions) is persisted
 * in the `plugins` DB table via pluginsRepo. Plugins with external service
 * dependencies register them through the Config Center registrar.
 */

import {
  getDefaultPluginRegistry,
  createPlugin,
  buildCorePlugin,
  getServiceRegistry,
  Services,
  type PluginManifest,
  type PluginCapability,
  type PluginPermission,
  type PluginStatus,
  type ConfigFieldDefinition,
} from '@ownpilot/core';
import type { Plugin, PluginPublicAPI } from '@ownpilot/core';
import { pluginsRepo } from '../db/repositories/plugins.js';
import { pomodoroRepo } from '../db/repositories/pomodoro.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { registerToolConfigRequirements } from '../services/api-service-registrar.js';
import { buildTelegramChannelPlugin } from '../channels/plugins/telegram/index.js';
import { buildGatewayPlugin } from './gateway-plugin.js';
import { buildComposioPlugin } from './composio.js';
import { getLog } from '../services/log.js';

const log = getLog('Plugins');

// =============================================================================
// Types
// =============================================================================

interface BuiltinPluginEntry {
  manifest: PluginManifest;
  implementation: Partial<Plugin>;
}

// =============================================================================
// Plugin Definitions
// =============================================================================

// ---------------------------------------------------------------------------
// 1. News & RSS Reader
// ---------------------------------------------------------------------------

function buildNewsRssPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'max_feeds',
      label: 'Maximum Feeds',
      type: 'number',
      defaultValue: 50,
      order: 0,
    },
    {
      name: 'refresh_interval',
      label: 'Refresh Interval',
      type: 'number',
      defaultValue: 60,
      description: 'Feed refresh interval in minutes',
      order: 1,
    },
    {
      name: 'default_category',
      label: 'Default Category',
      type: 'string',
      placeholder: 'e.g. Technology',
      order: 2,
    },
  ];

  /** Minimal RSS/Atom parser - extracts items from XML text */
  function parseRssItems(
    xml: string
  ): Array<{ title: string; link: string; content: string; published: string }> {
    const items: Array<{ title: string; link: string; content: string; published: string }> = [];

    // RSS 2.0 <item> elements
    const rssItemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
    // Atom <entry> elements
    const atomEntryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;

    const extract = (block: string, tag: string): string => {
      const m = new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
        'i'
      ).exec(block);
      return (m?.[1] ?? m?.[2] ?? '').trim();
    };
    const extractLink = (block: string): string => {
      // Atom uses <link href="..."/>
      const atomLink = /<link[^>]+href=["']([^"']+)["']/i.exec(block);
      if (atomLink?.[1]) return atomLink[1];
      return extract(block, 'link');
    };

    let match: RegExpExecArray | null;

    // Try RSS first
    while ((match = rssItemRegex.exec(xml)) !== null) {
      const block = match[1] ?? '';
      items.push({
        title: extract(block, 'title'),
        link: extractLink(block),
        content: extract(block, 'description') || extract(block, 'content:encoded'),
        published: extract(block, 'pubDate') || extract(block, 'dc:date'),
      });
    }

    // Try Atom if no RSS items found
    if (items.length === 0) {
      while ((match = atomEntryRegex.exec(xml)) !== null) {
        const block = match[1] ?? '';
        items.push({
          title: extract(block, 'title'),
          link: extractLink(block),
          content: extract(block, 'summary') || extract(block, 'content'),
          published: extract(block, 'published') || extract(block, 'updated'),
        });
      }
    }

    return items;
  }

  return createPlugin()
    .meta({
      id: 'news-rss',
      name: 'News & RSS Reader',
      version: '1.0.0',
      description: 'Subscribe to RSS feeds and get news updates',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers', 'storage', 'scheduled'] as PluginCapability[],
      permissions: ['network', 'storage'] as PluginPermission[],
      icon: '\uD83D\uDCF0',
      category: 'data',
      pluginConfigSchema,
      defaultConfig: {
        max_feeds: 50,
        refresh_interval: 60,
        default_category: '',
      },
    })
    .database(
      'plugin_rss_feeds',
      'RSS Feeds',
      [
        { name: 'url', type: 'text', required: true, description: 'Feed URL' },
        { name: 'title', type: 'text', description: 'Feed title' },
        { name: 'category', type: 'text', description: 'Feed category' },
        { name: 'last_fetched', type: 'datetime', description: 'Last fetch timestamp' },
        { name: 'status', type: 'text', defaultValue: 'active', description: 'active | error' },
      ],
      { description: 'Stores subscribed RSS/Atom feed URLs and metadata' }
    )
    .database(
      'plugin_rss_items',
      'RSS Items',
      [
        { name: 'feed_id', type: 'text', required: true, description: 'Parent feed record ID' },
        { name: 'title', type: 'text', description: 'Item title' },
        { name: 'link', type: 'text', description: 'Item link' },
        { name: 'content', type: 'text', description: 'Item content/summary' },
        { name: 'published_at', type: 'datetime', description: 'Publish date' },
        { name: 'is_read', type: 'boolean', defaultValue: false, description: 'Read status' },
      ],
      { description: 'Stores individual RSS/Atom feed items' }
    )
    .tool(
      {
        name: 'news_add_feed',
        description: 'Add an RSS/Atom feed and fetch its latest items',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'RSS/Atom feed URL' },
            category: { type: 'string', description: 'Category to organize the feed' },
          },
          required: ['url'],
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const feedUrl = String(params.url);

        // Create feed record
        const feedRecord = await repo.addRecord('plugin_rss_feeds', {
          url: feedUrl,
          title: feedUrl,
          category: params.category ?? '',
          last_fetched: null,
          status: 'active',
        });

        // Try to fetch and parse the feed
        let itemCount = 0;
        let feedTitle = feedUrl;
        try {
          const response = await fetch(feedUrl, {
            headers: { 'User-Agent': 'OwnPilot RSS Reader/1.0' },
            signal: AbortSignal.timeout(10000),
          });
          const xml = await response.text();

          // Extract feed title
          const titleMatch = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(xml);
          if (titleMatch?.[1]) feedTitle = titleMatch[1].trim();

          const items = parseRssItems(xml);
          for (const item of items.slice(0, 20)) {
            await repo.addRecord('plugin_rss_items', {
              feed_id: feedRecord.id,
              title: item.title,
              link: item.link,
              content: item.content.substring(0, 2000),
              published_at: item.published || new Date().toISOString(),
              is_read: false,
            });
            itemCount++;
          }

          // Update feed with title and last_fetched
          await repo.updateRecord(feedRecord.id, {
            title: feedTitle,
            last_fetched: new Date().toISOString(),
            status: 'active',
          });
        } catch {
          await repo.updateRecord(feedRecord.id, { status: 'error' });
        }

        return {
          content: {
            success: true,
            message: `Feed "${feedTitle}" added with ${itemCount} item(s).`,
            feedId: feedRecord.id,
            title: feedTitle,
            itemsFetched: itemCount,
          },
        };
      }
    )
    .tool(
      {
        name: 'news_list_feeds',
        description: 'List all subscribed RSS feeds',
        parameters: { type: 'object', properties: {} },
      },
      async () => {
        const repo = getServiceRegistry().get(Services.Database);
        const { records } = await repo.listRecords('plugin_rss_feeds', { limit: 100 });
        return {
          content: {
            success: true,
            feeds: records.map((r) => ({
              id: r.id,
              url: r.data.url,
              title: r.data.title,
              category: r.data.category,
              status: r.data.status,
              lastFetched: r.data.last_fetched,
            })),
          },
        };
      }
    )
    .tool(
      {
        name: 'news_get_latest',
        description: 'Get latest news items from subscribed feeds. Optionally filter by feed.',
        parameters: {
          type: 'object',
          properties: {
            feed_id: { type: 'string', description: 'Filter by specific feed ID (optional)' },
            limit: { type: 'number', description: 'Maximum items to return (default 20)' },
            unread_only: {
              type: 'boolean',
              description: 'Only return unread items (default false)',
            },
          },
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const limit = (params.limit as number) || 20;
        const filter: Record<string, unknown> = {};
        if (params.feed_id) filter.feed_id = params.feed_id;
        if (params.unread_only) filter.is_read = false;
        const { records } = await repo.listRecords('plugin_rss_items', {
          limit,
          filter: Object.keys(filter).length ? filter : undefined,
        });
        return {
          content: {
            success: true,
            items: records.map((r) => ({
              id: r.id,
              feedId: r.data.feed_id,
              title: r.data.title,
              link: r.data.link,
              content: String(r.data.content ?? '').substring(0, 300),
              publishedAt: r.data.published_at,
              isRead: r.data.is_read,
            })),
          },
        };
      }
    )
    .tool(
      {
        name: 'news_remove_feed',
        description: 'Remove an RSS feed subscription and its items',
        parameters: {
          type: 'object',
          properties: {
            feed_id: { type: 'string', description: 'Feed ID to remove' },
          },
          required: ['feed_id'],
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const feedId = String(params.feed_id);
        // Delete items for this feed
        const { records: items } = await repo.listRecords('plugin_rss_items', {
          limit: 1000,
          filter: { feed_id: feedId },
        });
        for (const item of items) {
          await repo.deleteRecord(item.id);
        }
        // Delete the feed itself
        await repo.deleteRecord(feedId);
        return {
          content: {
            success: true,
            message: `Feed removed along with ${items.length} item(s).`,
          },
        };
      }
    )
    .tool(
      {
        name: 'news_refresh_feed',
        description: 'Re-fetch a specific RSS feed to get new items',
        parameters: {
          type: 'object',
          properties: {
            feed_id: { type: 'string', description: 'Feed ID to refresh' },
          },
          required: ['feed_id'],
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const feedId = String(params.feed_id);
        const feed = await repo.getRecord(feedId);
        if (!feed || !feed.data.url) {
          return { content: { error: 'Feed not found' }, isError: true };
        }

        let itemCount = 0;
        try {
          const response = await fetch(String(feed.data.url), {
            headers: { 'User-Agent': 'OwnPilot RSS Reader/1.0' },
            signal: AbortSignal.timeout(10000),
          });
          const xml = await response.text();
          const items = parseRssItems(xml);

          // Get existing links to avoid duplicates
          const { records: existing } = await repo.listRecords('plugin_rss_items', {
            limit: 1000,
            filter: { feed_id: feedId },
          });
          const existingLinks = new Set(existing.map((r) => r.data.link));

          for (const item of items.slice(0, 20)) {
            if (existingLinks.has(item.link)) continue;
            await repo.addRecord('plugin_rss_items', {
              feed_id: feedId,
              title: item.title,
              link: item.link,
              content: item.content.substring(0, 2000),
              published_at: item.published || new Date().toISOString(),
              is_read: false,
            });
            itemCount++;
          }

          await repo.updateRecord(feedId, {
            last_fetched: new Date().toISOString(),
            status: 'active',
          });
        } catch {
          await repo.updateRecord(feedId, { status: 'error' });
          return { content: { error: 'Failed to fetch feed' }, isError: true };
        }

        return {
          content: {
            success: true,
            message: `Feed refreshed: ${itemCount} new item(s) added.`,
            newItems: itemCount,
          },
        };
      }
    )
    .build();
}

// ---------------------------------------------------------------------------
// 2. Pomodoro Timer
// ---------------------------------------------------------------------------

function buildPomodoroPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'work_minutes',
      label: 'Work Duration (minutes)',
      type: 'number',
      defaultValue: 25,
      order: 0,
    },
    {
      name: 'short_break',
      label: 'Short Break (minutes)',
      type: 'number',
      defaultValue: 5,
      order: 1,
    },
    {
      name: 'long_break',
      label: 'Long Break (minutes)',
      type: 'number',
      defaultValue: 15,
      order: 2,
    },
    {
      name: 'sessions_before_long',
      label: 'Sessions Before Long Break',
      type: 'number',
      defaultValue: 4,
      description: 'Work sessions before a long break',
      order: 3,
    },
  ];

  return createPlugin()
    .meta({
      id: 'pomodoro',
      name: 'Pomodoro Timer',
      version: '1.0.0',
      description: 'Focus timer with work/break intervals',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'storage', 'notifications'] as PluginCapability[],
      permissions: ['storage', 'notifications'] as PluginPermission[],
      icon: '\uD83C\uDF45',
      category: 'productivity',
      pluginConfigSchema,
      defaultConfig: {
        work_minutes: 25,
        short_break: 5,
        long_break: 15,
        sessions_before_long: 4,
      },
    })
    .tool(
      {
        name: 'pomodoro_start',
        description: 'Start a new Pomodoro work session',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description for this session' },
            duration: { type: 'number', description: 'Duration in minutes (default 25)' },
          },
        },
      },
      async (params) => {
        // Check for existing active session
        const active = await pomodoroRepo.getActiveSession();
        if (active) {
          return {
            content: {
              success: false,
              message: `A session is already running: "${active.taskDescription}" (started at ${active.startedAt})`,
              session: active,
            },
          };
        }

        const session = await pomodoroRepo.startSession({
          type: 'work',
          taskDescription: String(params.task || 'Untitled session'),
          durationMinutes: (params.duration as number) || 25,
        });

        return {
          content: {
            success: true,
            message: `Pomodoro session started: "${session.taskDescription}" for ${session.durationMinutes} minutes`,
            session,
          },
        };
      }
    )
    .tool(
      {
        name: 'pomodoro_status',
        description: 'Get current Pomodoro session status and daily stats',
        parameters: { type: 'object', properties: {} },
      },
      async () => {
        const active = await pomodoroRepo.getActiveSession();
        const todayStats = await pomodoroRepo.getDailyStats(new Date().toISOString().split('T')[0]);
        const totalStats = await pomodoroRepo.getTotalStats();

        if (active) {
          const elapsed = Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60000);
          const remaining = Math.max(0, active.durationMinutes - elapsed);
          return {
            content: {
              success: true,
              active: true,
              session: {
                ...active,
                elapsedMinutes: elapsed,
                remainingMinutes: remaining,
              },
              today: todayStats,
              total: totalStats,
            },
          };
        }

        return {
          content: {
            success: true,
            active: false,
            message: 'No active Pomodoro session',
            today: todayStats,
            total: totalStats,
          },
        };
      }
    )
    .tool(
      {
        name: 'pomodoro_stop',
        description: 'Stop/complete the current Pomodoro session',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Reason for stopping early (if interrupted)' },
          },
        },
      },
      async (params) => {
        const active = await pomodoroRepo.getActiveSession();
        if (!active) {
          return {
            content: {
              success: false,
              message: 'No active session to stop',
            },
          };
        }

        const elapsed = Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60000);
        const isComplete = elapsed >= active.durationMinutes;

        let session;
        if (isComplete || !params.reason) {
          session = await pomodoroRepo.completeSession(active.id);
        } else {
          session = await pomodoroRepo.interruptSession(active.id, String(params.reason));
        }

        return {
          content: {
            success: true,
            message: isComplete
              ? `Session completed! Worked for ${elapsed} minutes on "${active.taskDescription}"`
              : `Session interrupted after ${elapsed} minutes. Reason: ${params.reason || 'none'}`,
            session,
          },
        };
      }
    )
    .build();
}

// =============================================================================
// Plugin Collection
// =============================================================================

/**
 * Returns all built-in plugin definitions.
 */
function getAllBuiltinPlugins(): BuiltinPluginEntry[] {
  return [
    // Core plugin — built-in tools (file system, code exec, web fetch, utilities, etc.)
    buildCorePlugin(),
    // Gateway plugin — service tools (memory, goals, custom data, personal data, triggers, plans)
    buildGatewayPlugin(),
    // Built-in plugins
    buildNewsRssPlugin(),
    buildPomodoroPlugin(),
    // Integrations
    buildComposioPlugin(),
    // Channel plugins
    buildTelegramChannelPlugin(),
  ];
}

// =============================================================================
// Channel API Factory Cache
// =============================================================================

/**
 * Stores channel API factory functions by plugin ID so they can be re-invoked
 * after config changes (e.g. via the quick setup endpoint).
 */
const channelApiFactories = new Map<string, (cfg: Record<string, unknown>) => PluginPublicAPI>();

/**
 * Re-create a channel plugin's API instance with fresh config from Config Center.
 * Called after updating config entries so the channel reconnects with new credentials.
 */
export async function refreshChannelApi(pluginId: string): Promise<void> {
  const factory = channelApiFactories.get(pluginId);
  if (!factory) return;

  const registry = await getDefaultPluginRegistry();
  const plugin = registry.get(pluginId);
  if (!plugin) return;

  const configData: Record<string, unknown> = {};
  const requiredServices = plugin.manifest.requiredServices as Array<{ name: string }> | undefined;
  if (requiredServices?.length) {
    const serviceName = requiredServices[0]!.name;
    const entry = configServicesRepo.getDefaultEntry(serviceName);
    if (entry?.data) {
      Object.assign(configData, entry.data);
    }
  }

  plugin.api = factory(configData);
}

// =============================================================================
// Boot Flow
// =============================================================================

/**
 * Initialize and register all built-in plugins.
 *
 * For each plugin:
 *  1. Load or create its DB state (settings, permissions, status).
 *  2. Register external service dependencies in Config Center.
 *  3. Register in the in-memory PluginRegistry.
 *  4. Apply persisted DB state onto the live plugin instance.
 */
export async function initializePlugins(): Promise<void> {
  const registry = await getDefaultPluginRegistry();
  const builtinPlugins = getAllBuiltinPlugins();

  for (const { manifest, implementation } of builtinPlugins) {
    try {
      // 1. Load or create DB state
      let dbRecord = pluginsRepo.getById(manifest.id);
      if (!dbRecord) {
        dbRecord = await pluginsRepo.upsert({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          settings: manifest.defaultConfig ?? {},
        });
      }

      // 2. Register required services in Config Center
      if (manifest.requiredServices?.length) {
        await registerToolConfigRequirements(
          manifest.name,
          manifest.id,
          'plugin',
          manifest.requiredServices
        );
      }

      // 3. Auto-create declared database tables (protected, owned by plugin)
      if (manifest.databaseTables?.length) {
        const customDataRepo = getServiceRegistry().get(Services.Database);
        for (const table of manifest.databaseTables) {
          try {
            await customDataRepo.ensurePluginTable(
              manifest.id,
              table.name,
              table.displayName,
              table.columns,
              table.description
            );
          } catch (tableErr) {
            log.error(
              `[Plugins] Failed to create table "${table.name}" for ${manifest.id}:`,
              tableErr
            );
          }
        }
      }

      // 4. Register in PluginRegistry
      const plugin = await registry.register(manifest, implementation);

      // 4b. If this is a channel plugin with a factory, create the ChannelPluginAPI
      const channelFactory = (implementation as Record<string, unknown>).channelApiFactory;
      if (typeof channelFactory === 'function') {
        const configData: Record<string, unknown> = {};
        if (manifest.requiredServices?.length) {
          const serviceName = (manifest.requiredServices[0] as { name: string }).name;
          const entry = configServicesRepo.getDefaultEntry(serviceName);
          if (entry?.data) {
            Object.assign(configData, entry.data);
          }
        }
        const typedFactory = channelFactory as (cfg: Record<string, unknown>) => PluginPublicAPI;
        plugin.api = typedFactory(configData);
        channelApiFactories.set(manifest.id, typedFactory);
      }

      // 5. Apply DB state
      plugin.config.settings = dbRecord.settings;
      plugin.config.grantedPermissions = dbRecord.grantedPermissions as PluginPermission[];
      plugin.config.enabled = dbRecord.status === 'enabled';
      plugin.status = dbRecord.status as PluginStatus;

      log.info(`[Plugins] Registered: ${manifest.name} v${manifest.version} (${dbRecord.status})`);
    } catch (error) {
      log.error(`[Plugins] Failed to register ${manifest.id}:`, error);
    }
  }

  const allPlugins = registry.getAll();
  const enabledPlugins = registry.getEnabled();
  log.info(`[Plugins] Initialized ${allPlugins.length} plugins (${enabledPlugins.length} enabled)`);
}

/**
 * Re-export for route-layer access to the plugin registry.
 */
export { getDefaultPluginRegistry } from '@ownpilot/core';
