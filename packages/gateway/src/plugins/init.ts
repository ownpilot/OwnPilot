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
  evaluateMathExpression,
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
  function parseRssItems(xml: string): Array<{ title: string; link: string; content: string; published: string }> {
    const items: Array<{ title: string; link: string; content: string; published: string }> = [];

    // RSS 2.0 <item> elements
    const rssItemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
    // Atom <entry> elements
    const atomEntryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;

    const extract = (block: string, tag: string): string => {
      const m = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
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
    .database('plugin_rss_feeds', 'RSS Feeds', [
      { name: 'url', type: 'text', required: true, description: 'Feed URL' },
      { name: 'title', type: 'text', description: 'Feed title' },
      { name: 'category', type: 'text', description: 'Feed category' },
      { name: 'last_fetched', type: 'datetime', description: 'Last fetch timestamp' },
      { name: 'status', type: 'text', defaultValue: 'active', description: 'active | error' },
    ], { description: 'Stores subscribed RSS/Atom feed URLs and metadata' })
    .database('plugin_rss_items', 'RSS Items', [
      { name: 'feed_id', type: 'text', required: true, description: 'Parent feed record ID' },
      { name: 'title', type: 'text', description: 'Item title' },
      { name: 'link', type: 'text', description: 'Item link' },
      { name: 'content', type: 'text', description: 'Item content/summary' },
      { name: 'published_at', type: 'datetime', description: 'Publish date' },
      { name: 'is_read', type: 'boolean', defaultValue: false, description: 'Read status' },
    ], { description: 'Stores individual RSS/Atom feed items' })
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
      },
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
      },
    )
    .tool(
      {
        name: 'news_get_latest',
        description: 'Get latest news items from subscribed feeds',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum items to return (default 20)' },
          },
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const limit = (params.limit as number) || 20;
        const { records } = await repo.listRecords('plugin_rss_items', { limit });
        return {
          content: {
            success: true,
            items: records.map((r) => ({
              id: r.id,
              title: r.data.title,
              link: r.data.link,
              content: String(r.data.content ?? '').substring(0, 300),
              publishedAt: r.data.published_at,
              isRead: r.data.is_read,
            })),
          },
        };
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 2. Reminder Manager
// ---------------------------------------------------------------------------

function buildReminderPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'default_snooze_minutes',
      label: 'Default Snooze (minutes)',
      type: 'number',
      defaultValue: 10,
      order: 0,
    },
    {
      name: 'max_active',
      label: 'Max Active Reminders',
      type: 'number',
      defaultValue: 100,
      order: 1,
    },
    {
      name: 'sound_enabled',
      label: 'Sound Enabled',
      type: 'boolean',
      defaultValue: true,
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'reminder',
      name: 'Reminder Manager',
      version: '1.0.0',
      description: 'Create and manage reminders with notifications',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers', 'storage', 'notifications'] as PluginCapability[],
      permissions: ['storage', 'notifications'] as PluginPermission[],
      icon: '\u23F0',
      category: 'productivity',
      pluginConfigSchema,
      defaultConfig: {
        default_snooze_minutes: 10,
        max_active: 100,
        sound_enabled: true,
      },
    })
    .database('plugin_reminders', 'Reminders', [
      { name: 'title', type: 'text', required: true, description: 'Reminder title' },
      { name: 'time', type: 'text', required: true, description: 'Reminder time' },
      { name: 'note', type: 'text', description: 'Additional notes' },
      { name: 'status', type: 'text', defaultValue: 'active', description: 'active | done | dismissed' },
    ], { description: 'Stores user reminders with title, time and status' })
    .tool(
      {
        name: 'reminder_create',
        description: 'Create a new reminder',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Reminder title' },
            time: { type: 'string', description: 'When to remind (e.g., "in 30 minutes", "tomorrow 9am")' },
            note: { type: 'string', description: 'Additional notes' },
          },
          required: ['title', 'time'],
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const record = await repo.addRecord('plugin_reminders', {
          title: params.title,
          time: params.time,
          note: params.note ?? '',
          status: 'active',
        });
        return {
          content: {
            success: true,
            reminder: { id: record.id, ...record.data, createdAt: record.createdAt },
          },
        };
      },
    )
    .tool(
      {
        name: 'reminder_list',
        description: 'List all reminders',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Filter by status (active, done, dismissed)' },
          },
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const filter = params.status ? { status: params.status } : undefined;
        const { records, total } = await repo.listRecords('plugin_reminders', { limit: 100, filter });
        return {
          content: {
            success: true,
            reminders: records.map((r) => ({ id: r.id, ...r.data, createdAt: r.createdAt })),
            total,
          },
        };
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 3. Clipboard Manager
// ---------------------------------------------------------------------------

function buildClipboardPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'max_history',
      label: 'Max History Items',
      type: 'number',
      defaultValue: 100,
      order: 0,
    },
    {
      name: 'auto_save',
      label: 'Auto Save',
      type: 'boolean',
      defaultValue: true,
      order: 1,
    },
    {
      name: 'retention_days',
      label: 'Retention Days',
      type: 'number',
      defaultValue: 30,
      description: 'Days to keep clipboard items',
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'clipboard-manager',
      name: 'Clipboard Manager',
      version: '1.0.0',
      description: 'Smart clipboard history with search and pinning',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers', 'storage'] as PluginCapability[],
      permissions: ['storage'] as PluginPermission[],
      icon: '\uD83D\uDCCB',
      category: 'utilities',
      pluginConfigSchema,
      defaultConfig: {
        max_history: 100,
        auto_save: true,
        retention_days: 30,
      },
    })
    .database('plugin_clipboard', 'Clipboard History', [
      { name: 'content', type: 'text', required: true, description: 'Clipboard text content' },
      { name: 'preview', type: 'text', description: 'Short preview of content' },
      { name: 'tags', type: 'json', defaultValue: null, description: 'Tags for organization' },
      { name: 'is_pinned', type: 'boolean', defaultValue: false, description: 'Whether item is pinned' },
    ], { description: 'Stores clipboard history entries with search and pinning' })
    .tool(
      {
        name: 'clipboard_save',
        description: 'Save text to clipboard history',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Text to save' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' },
          },
          required: ['content'],
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const content = String(params.content);
        const record = await repo.addRecord('plugin_clipboard', {
          content,
          preview: content.substring(0, 100),
          tags: params.tags ?? [],
          is_pinned: false,
        });
        return {
          content: {
            success: true,
            id: record.id,
            preview: content.substring(0, 50),
          },
        };
      },
    )
    .tool(
      {
        name: 'clipboard_history',
        description: 'Get clipboard history',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max items to return (default 20)' },
          },
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const limit = (params.limit as number) || 20;
        const { records, total } = await repo.listRecords('plugin_clipboard', { limit });
        return {
          content: {
            success: true,
            items: records.map((r) => ({
              id: r.id,
              content: r.data.content,
              preview: r.data.preview,
              tags: r.data.tags,
              isPinned: r.data.is_pinned,
              createdAt: r.createdAt,
            })),
            total,
          },
        };
      },
    )
    .tool(
      {
        name: 'clipboard_search',
        description: 'Search clipboard history',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      async (params) => {
        const repo = getServiceRegistry().get(Services.Database);
        const results = await repo.searchRecords('plugin_clipboard', String(params.query), { limit: 20 });
        return {
          content: {
            success: true,
            query: params.query,
            results: results.map((r) => ({
              id: r.id,
              content: r.data.content,
              preview: r.data.preview,
              tags: r.data.tags,
              createdAt: r.createdAt,
            })),
          },
        };
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 4. Advanced Calculator
// ---------------------------------------------------------------------------

function buildCalculatorPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'precision',
      label: 'Decimal Precision',
      type: 'number',
      defaultValue: 10,
      description: 'Decimal precision for calculations',
      order: 0,
    },
    {
      name: 'angle_unit',
      label: 'Angle Unit',
      type: 'select',
      defaultValue: 'degrees',
      options: [
        { value: 'degrees', label: 'Degrees' },
        { value: 'radians', label: 'Radians' },
      ],
      order: 1,
    },
    {
      name: 'thousands_separator',
      label: 'Thousands Separator',
      type: 'boolean',
      defaultValue: true,
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'advanced-calculator',
      name: 'Advanced Calculator',
      version: '1.0.0',
      description: 'Math expressions, unit conversion, statistics, and financial calculations',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers'] as PluginCapability[],
      permissions: [] as PluginPermission[],
      icon: '\uD83D\uDD22',
      category: 'utilities',
      pluginConfigSchema,
      defaultConfig: {
        precision: 10,
        angle_unit: 'degrees',
        thousands_separator: true,
      },
    })
    .tool(
      {
        name: 'calc_evaluate',
        description: 'Evaluate a mathematical expression',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression (e.g., "2+2", "sqrt(16)")' },
          },
          required: ['expression'],
        },
      },
      async (params) => {
        const input = String(params.expression).trim();
        const result = evaluateMathExpression(input);

        if (result instanceof Error) {
          return {
            content: { error: result.message },
            isError: true,
          };
        }

        return {
          content: {
            expression: params.expression,
            result,
          },
        };
      },
    )
    .tool(
      {
        name: 'calc_convert',
        description: 'Convert between units',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'number', description: 'Value to convert' },
            from: { type: 'string', description: 'Source unit' },
            to: { type: 'string', description: 'Target unit' },
          },
          required: ['value', 'from', 'to'],
        },
      },
      async (params) => {
        const conversions: Record<string, Record<string, number>> = {
          km: { mi: 0.621371, m: 1000, ft: 3280.84 },
          mi: { km: 1.60934, m: 1609.34, ft: 5280 },
          m: { km: 0.001, mi: 0.000621371, ft: 3.28084, cm: 100 },
          ft: { m: 0.3048, km: 0.0003048, mi: 0.000189394, cm: 30.48 },
          cm: { m: 0.01, ft: 0.0328084, in: 0.393701 },
          in: { cm: 2.54, m: 0.0254, ft: 0.0833333 },
          kg: { lb: 2.20462, g: 1000, oz: 35.274 },
          lb: { kg: 0.453592, g: 453.592, oz: 16 },
          g: { kg: 0.001, lb: 0.00220462, oz: 0.035274 },
          oz: { g: 28.3495, kg: 0.0283495, lb: 0.0625 },
          gb: { mb: 1024, kb: 1048576, tb: 0.000976563 },
          mb: { gb: 0.000976563, kb: 1024, tb: 9.5367e-7 },
          kb: { mb: 0.000976563, gb: 9.5367e-7 },
          l: { ml: 1000, gal: 0.264172 },
          ml: { l: 0.001, gal: 0.000264172 },
          gal: { l: 3.78541, ml: 3785.41 },
        };
        const from = String(params.from).toLowerCase();
        const to = String(params.to).toLowerCase();
        const value = Number(params.value);

        // Handle temperature separately
        if ((from === 'c' || from === 'celsius') && (to === 'f' || to === 'fahrenheit')) {
          return { content: { original: { value, unit: 'C' }, converted: { value: value * 9 / 5 + 32, unit: 'F' } } };
        }
        if ((from === 'f' || from === 'fahrenheit') && (to === 'c' || to === 'celsius')) {
          return { content: { original: { value, unit: 'F' }, converted: { value: (value - 32) * 5 / 9, unit: 'C' } } };
        }
        if ((from === 'c' || from === 'celsius') && (to === 'k' || to === 'kelvin')) {
          return { content: { original: { value, unit: 'C' }, converted: { value: value + 273.15, unit: 'K' } } };
        }
        if ((from === 'k' || from === 'kelvin') && (to === 'c' || to === 'celsius')) {
          return { content: { original: { value, unit: 'K' }, converted: { value: value - 273.15, unit: 'C' } } };
        }

        if (conversions[from]?.[to]) {
          const result = value * conversions[from][to]!;
          return {
            content: {
              original: { value, unit: from },
              converted: { value: result, unit: to },
            },
          };
        }
        return {
          content: { error: `Cannot convert from ${from} to ${to}` },
          isError: true,
        };
      },
    )
    .tool(
      {
        name: 'calc_statistics',
        description: 'Calculate statistics for a list of numbers',
        parameters: {
          type: 'object',
          properties: {
            numbers: { type: 'array', items: { type: 'number' }, description: 'Numbers to analyze' },
          },
          required: ['numbers'],
        },
      },
      async (params) => {
        const nums = params.numbers as number[];
        if (!nums || nums.length === 0) {
          return { content: { error: 'No numbers provided' }, isError: true };
        }
        const sum = nums.reduce((a, b) => a + b, 0);
        const mean = sum / nums.length;
        const sorted = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(nums.length / 2);
        const median = nums.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
        const variance = nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length;
        const stddev = Math.sqrt(variance);
        return {
          content: {
            count: nums.length,
            sum,
            mean,
            median,
            min: sorted[0],
            max: sorted[nums.length - 1],
            variance,
            stddev,
          },
        };
      },
    )
    .build();
}


// ---------------------------------------------------------------------------
// 5. Text Utilities
// ---------------------------------------------------------------------------

function buildTextUtilsPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'default_encoding',
      label: 'Default Encoding',
      type: 'select',
      defaultValue: 'utf-8',
      options: [
        { value: 'utf-8', label: 'UTF-8' },
        { value: 'ascii', label: 'ASCII' },
        { value: 'base64', label: 'Base64' },
      ],
      order: 0,
    },
    {
      name: 'hash_algorithm',
      label: 'Hash Algorithm',
      type: 'select',
      defaultValue: 'sha256',
      options: [
        { value: 'sha256', label: 'SHA-256' },
        { value: 'md5', label: 'MD5' },
        { value: 'sha1', label: 'SHA-1' },
      ],
      order: 1,
    },
  ];

  return createPlugin()
    .meta({
      id: 'text-utils',
      name: 'Text Utilities',
      version: '1.0.0',
      description: 'Encode, decode, count, and transform text',
      author: { name: 'OwnPilot' },
      capabilities: ['tools'] as PluginCapability[],
      permissions: [] as PluginPermission[],
      icon: '\uD83D\uDCDD',
      category: 'developer',
      pluginConfigSchema,
      defaultConfig: {
        default_encoding: 'utf-8',
        hash_algorithm: 'sha256',
      },
    })
    .tool(
      {
        name: 'text_encode',
        description: 'Encode text to base64 or hex',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to encode' },
            encoding: { type: 'string', enum: ['base64', 'hex'], description: 'Encoding format' },
          },
          required: ['text', 'encoding'],
        },
      },
      async (params) => {
        const text = String(params.text);
        const encoding = String(params.encoding) as 'base64' | 'hex';
        const buffer = Buffer.from(text, 'utf-8');
        const encoded = buffer.toString(encoding);
        return {
          content: {
            success: true,
            original: text,
            encoded,
            encoding,
          },
        };
      },
    )
    .tool(
      {
        name: 'text_decode',
        description: 'Decode text from base64 or hex',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Encoded text to decode' },
            encoding: { type: 'string', enum: ['base64', 'hex'], description: 'Encoding format of the input' },
          },
          required: ['text', 'encoding'],
        },
      },
      async (params) => {
        try {
          const text = String(params.text);
          const encoding = String(params.encoding) as 'base64' | 'hex';
          const buffer = Buffer.from(text, encoding);
          const decoded = buffer.toString('utf-8');
          return {
            content: {
              success: true,
              original: text,
              decoded,
              encoding,
            },
          };
        } catch {
          return {
            content: { error: 'Failed to decode: invalid input for the specified encoding' },
            isError: true,
          };
        }
      },
    )
    .tool(
      {
        name: 'text_count',
        description: 'Count words, characters, and lines in text',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to analyze' },
          },
          required: ['text'],
        },
      },
      async (params) => {
        const text = String(params.text);
        const characters = text.length;
        const charactersNoSpaces = text.replace(/\s/g, '').length;
        const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
        const lines = text === '' ? 0 : text.split(/\r?\n/).length;
        const sentences = text.trim() === '' ? 0 : text.split(/[.!?]+\s*/g).filter(Boolean).length;
        const paragraphs = text.trim() === '' ? 0 : text.split(/\n\s*\n/).filter(s => s.trim()).length;
        return {
          content: {
            success: true,
            characters,
            charactersNoSpaces,
            words,
            lines,
            sentences,
            paragraphs,
          },
        };
      },
    )
    .tool(
      {
        name: 'text_transform',
        description: 'Transform text (uppercase, lowercase, capitalize, reverse, slugify)',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to transform' },
            operation: {
              type: 'string',
              enum: ['uppercase', 'lowercase', 'capitalize', 'reverse', 'slugify'],
              description: 'Transformation to apply',
            },
          },
          required: ['text', 'operation'],
        },
      },
      async (params) => {
        const text = String(params.text);
        const op = String(params.operation);
        let result: string;

        switch (op) {
          case 'uppercase':
            result = text.toUpperCase();
            break;
          case 'lowercase':
            result = text.toLowerCase();
            break;
          case 'capitalize':
            result = text.replace(/\b\w/g, (c) => c.toUpperCase());
            break;
          case 'reverse':
            result = [...text].reverse().join('');
            break;
          case 'slugify':
            result = text
              .toLowerCase()
              .trim()
              .replace(/[^\w\s-]/g, '')
              .replace(/[\s_]+/g, '-')
              .replace(/^-+|-+$/g, '');
            break;
          default:
            return {
              content: { error: `Unknown operation: ${op}` },
              isError: true,
            };
        }

        return {
          content: {
            success: true,
            original: text,
            result,
            operation: op,
          },
        };
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 6. Pomodoro Timer
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
      },
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
      },
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
      },
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
    // Built-in plugins (1-6)
    buildNewsRssPlugin(),
    buildReminderPlugin(),
    buildClipboardPlugin(),
    buildCalculatorPlugin(),
    buildTextUtilsPlugin(),
    buildPomodoroPlugin(),
    // Integration plugins
    buildComposioPlugin(),
    // Channel plugins
    buildTelegramChannelPlugin(),
  ];
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
          manifest.requiredServices,
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
              table.description,
            );
          } catch (tableErr) {
            log.error(`[Plugins] Failed to create table "${table.name}" for ${manifest.id}:`, tableErr);
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
        plugin.api = (channelFactory as (cfg: Record<string, unknown>) => PluginPublicAPI)(configData);
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
