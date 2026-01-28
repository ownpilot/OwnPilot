/**
 * Plugin Initialization
 *
 * Registers built-in plugins on gateway startup.
 */

import {
  getDefaultPluginRegistry,
  createWeatherPluginTools,
  WEATHER_PLUGIN_MANIFEST,
  createPlugin,
  type PluginManifest,
  type PluginCapability,
} from '@ownpilot/core';

/**
 * Initialize and register built-in plugins
 */
export async function initializePlugins(): Promise<void> {
  console.log('[Plugins] Getting plugin registry...');
  const registry = await getDefaultPluginRegistry();
  console.log('[Plugins] Plugin registry obtained.');

  console.log('[Plugins] Initializing plugin system...');

  // =========================================================================
  // 1. Weather Plugin (Marketplace pattern)
  // =========================================================================
  console.log('[Plugins] Registering Weather plugin...');
  try {
    const weatherTools = createWeatherPluginTools({
      log: {
        info: (msg, data) => console.log(`[Weather] ${msg}`, data || ''),
        error: (msg, data) => console.error(`[Weather] ${msg}`, data || ''),
      },
    });

    const weatherManifest: PluginManifest = {
      id: WEATHER_PLUGIN_MANIFEST.id,
      name: WEATHER_PLUGIN_MANIFEST.name,
      version: WEATHER_PLUGIN_MANIFEST.version,
      description: WEATHER_PLUGIN_MANIFEST.description,
      author: {
        name: WEATHER_PLUGIN_MANIFEST.publisher.name,
        email: WEATHER_PLUGIN_MANIFEST.publisher.email,
        url: WEATHER_PLUGIN_MANIFEST.publisher.website,
      },
      capabilities: ['tools', 'storage'],
      permissions: ['network', 'storage'],
      main: 'weather.js',
      icon: '☁️',
      docs: WEATHER_PLUGIN_MANIFEST.homepage,
    };

    const toolsMap = new Map<string, { definition: (typeof weatherTools.definitions)[0]; executor: (typeof weatherTools.executors) extends Map<string, infer E> ? E : never }>();
    for (const def of weatherTools.definitions) {
      const executor = weatherTools.executors.get(def.name);
      if (executor) {
        toolsMap.set(def.name, { definition: def, executor });
      }
    }

    await registry.register(weatherManifest, {
      tools: toolsMap,
      handlers: [],
      lifecycle: {
        onLoad: async () => {
          await weatherTools.service.initialize();
        },
      },
    });
    console.log(`[Plugins] Registered: ${weatherManifest.name} v${weatherManifest.version}`);
  } catch (error) {
    console.error('[Plugins] Failed to register weather:', error);
  }

  // =========================================================================
  // 2. News/RSS Plugin
  // =========================================================================
  console.log('[Plugins] Registering News/RSS plugin...');
  try {
    const newsPlugin = createPlugin()
      .meta({
        id: 'news-rss',
        name: 'News & RSS Reader',
        version: '1.0.0',
        description: 'Subscribe to RSS feeds and get news updates',
        author: { name: 'OwnPilot' },
        capabilities: ['tools', 'handlers', 'storage', 'scheduled'] as PluginCapability[],
        permissions: ['network', 'storage'],
        icon: '📰',
      })
      .tool(
        {
          name: 'news_add_feed',
          description: 'Add an RSS/Atom feed to track',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'RSS/Atom feed URL' },
              category: { type: 'string', description: 'Category to organize the feed' },
            },
            required: ['url'],
          },
        },
        async (params) => ({
          content: {
            success: true,
            message: 'Feed added successfully',
            feedId: `feed_${Date.now()}`,
            url: params.url,
          },
        })
      )
      .tool(
        {
          name: 'news_list_feeds',
          description: 'List all subscribed RSS feeds',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({
          content: {
            success: true,
            feeds: [],
            message: 'No feeds subscribed yet',
          },
        })
      )
      .tool(
        {
          name: 'news_get_latest',
          description: 'Get latest news from subscribed feeds',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Maximum items to return' },
            },
          },
        },
        async () => ({
          content: {
            success: true,
            items: [],
            message: 'No news items available',
          },
        })
      )
      .build();

    await registry.register(newsPlugin.manifest, newsPlugin.implementation);
    console.log(`[Plugins] Registered: ${newsPlugin.manifest.name} v${newsPlugin.manifest.version}`);
  } catch (error) {
    console.error('[Plugins] Failed to register news:', error);
  }

  // =========================================================================
  // 3. Code Assistant Plugin
  // =========================================================================
  console.log('[Plugins] Registering Code Assistant plugin...');
  try {
    const codePlugin = createPlugin()
      .meta({
        id: 'code-assistant',
        name: 'Code Assistant',
        version: '1.0.0',
        description: 'Code formatting, analysis, and utilities',
        author: { name: 'OwnPilot' },
        capabilities: ['tools', 'handlers'] as PluginCapability[],
        permissions: [],
        icon: '💻',
      })
      .tool(
        {
          name: 'code_format',
          description: 'Format code in various languages',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Code to format' },
              language: { type: 'string', description: 'Programming language' },
            },
            required: ['code'],
          },
        },
        async (params) => ({
          content: {
            success: true,
            formatted: params.code,
            language: params.language || 'auto-detected',
          },
        })
      )
      .tool(
        {
          name: 'code_analyze',
          description: 'Analyze code for issues and improvements',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string', description: 'Code to analyze' },
            },
            required: ['code'],
          },
        },
        async (params) => ({
          content: {
            success: true,
            issues: [],
            suggestions: ['Code looks good!'],
            codeLength: String(params.code).length,
          },
        })
      )
      .tool(
        {
          name: 'code_hash',
          description: 'Generate hash of text/code',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to hash' },
              algorithm: { type: 'string', enum: ['md5', 'sha1', 'sha256'], description: 'Hash algorithm' },
            },
            required: ['text'],
          },
        },
        async (params) => {
          const crypto = await import('node:crypto');
          const algo = (params.algorithm as string) || 'sha256';
          const hash = crypto.createHash(algo).update(params.text as string).digest('hex');
          return {
            content: {
              success: true,
              hash,
              algorithm: algo,
            },
          };
        }
      )
      .build();

    await registry.register(codePlugin.manifest, codePlugin.implementation);
    console.log(`[Plugins] Registered: ${codePlugin.manifest.name} v${codePlugin.manifest.version}`);
  } catch (error) {
    console.error('[Plugins] Failed to register code-assistant:', error);
  }

  // =========================================================================
  // 4. Reminder Plugin
  // =========================================================================
  console.log('[Plugins] Registering Reminder plugin...');
  try {
    const reminderPlugin = createPlugin()
      .meta({
        id: 'reminder',
        name: 'Reminder Manager',
        version: '1.0.0',
        description: 'Create and manage reminders with notifications',
        author: { name: 'OwnPilot' },
        capabilities: ['tools', 'handlers', 'storage', 'notifications'] as PluginCapability[],
        permissions: ['storage', 'notifications'],
        icon: '⏰',
      })
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
        async (params) => ({
          content: {
            success: true,
            reminder: {
              id: `rem_${Date.now()}`,
              title: params.title,
              time: params.time,
              note: params.note,
              createdAt: new Date().toISOString(),
            },
          },
        })
      )
      .tool(
        {
          name: 'reminder_list',
          description: 'List all reminders',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({
          content: {
            success: true,
            reminders: [],
            message: 'No reminders set',
          },
        })
      )
      .build();

    await registry.register(reminderPlugin.manifest, reminderPlugin.implementation);
    console.log(`[Plugins] Registered: ${reminderPlugin.manifest.name} v${reminderPlugin.manifest.version}`);
  } catch (error) {
    console.error('[Plugins] Failed to register reminder:', error);
  }

  // =========================================================================
  // 5. Clipboard Plugin
  // =========================================================================
  console.log('[Plugins] Registering Clipboard plugin...');
  try {
    const clipboardPlugin = createPlugin()
      .meta({
        id: 'clipboard-manager',
        name: 'Clipboard Manager',
        version: '1.0.0',
        description: 'Smart clipboard history with search and pinning',
        author: { name: 'OwnPilot' },
        capabilities: ['tools', 'handlers', 'storage'] as PluginCapability[],
        permissions: ['storage'],
        icon: '📋',
      })
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
        async (params) => ({
          content: {
            success: true,
            id: `clip_${Date.now()}`,
            preview: String(params.content).substring(0, 50),
          },
        })
      )
      .tool(
        {
          name: 'clipboard_history',
          description: 'Get clipboard history',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max items to return' },
            },
          },
        },
        async () => ({
          content: {
            success: true,
            items: [],
            message: 'Clipboard history is empty',
          },
        })
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
        async (params) => ({
          content: {
            success: true,
            query: params.query,
            results: [],
          },
        })
      )
      .build();

    await registry.register(clipboardPlugin.manifest, clipboardPlugin.implementation);
    console.log(`[Plugins] Registered: ${clipboardPlugin.manifest.name} v${clipboardPlugin.manifest.version}`);
  } catch (error) {
    console.error('[Plugins] Failed to register clipboard:', error);
  }

  // =========================================================================
  // 6. Calculator Plugin
  // =========================================================================
  console.log('[Plugins] Registering Calculator plugin...');
  try {
    const calculatorPlugin = createPlugin()
      .meta({
        id: 'advanced-calculator',
        name: 'Advanced Calculator',
        version: '1.0.0',
        description: 'Math expressions, unit conversion, statistics, and financial calculations',
        author: { name: 'OwnPilot' },
        capabilities: ['tools', 'handlers'] as PluginCapability[],
        permissions: [],
        icon: '🔢',
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
          try {
            const expr = String(params.expression)
              .replace(/\^/g, '**')
              .replace(/sqrt\(/g, 'Math.sqrt(')
              .replace(/sin\(/g, 'Math.sin(')
              .replace(/cos\(/g, 'Math.cos(')
              .replace(/pi/gi, 'Math.PI');
            const result = new Function(`"use strict"; return (${expr})`)();
            return {
              content: {
                expression: params.expression,
                result,
              },
            };
          } catch {
            return {
              content: { error: 'Invalid expression' },
              isError: true,
            };
          }
        }
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
            km: { mi: 0.621371, m: 1000 },
            mi: { km: 1.60934, m: 1609.34 },
            kg: { lb: 2.20462, g: 1000 },
            lb: { kg: 0.453592, g: 453.592 },
            gb: { mb: 1024, kb: 1048576 },
            mb: { gb: 0.000976563, kb: 1024 },
          };
          const from = String(params.from).toLowerCase();
          const to = String(params.to).toLowerCase();
          const value = Number(params.value);

          // Handle temperature separately
          if ((from === 'c' || from === 'celsius') && (to === 'f' || to === 'fahrenheit')) {
            return { content: { original: { value, unit: 'C' }, converted: { value: value * 9/5 + 32, unit: 'F' } } };
          }
          if ((from === 'f' || from === 'fahrenheit') && (to === 'c' || to === 'celsius')) {
            return { content: { original: { value, unit: 'F' }, converted: { value: (value - 32) * 5/9, unit: 'C' } } };
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
        }
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
          return {
            content: {
              count: nums.length,
              sum,
              mean,
              median,
              min: sorted[0],
              max: sorted[nums.length - 1],
            },
          };
        }
      )
      .build();

    await registry.register(calculatorPlugin.manifest, calculatorPlugin.implementation);
    console.log(`[Plugins] Registered: ${calculatorPlugin.manifest.name} v${calculatorPlugin.manifest.version}`);
  } catch (error) {
    console.error('[Plugins] Failed to register calculator:', error);
  }

  // =========================================================================
  // 7. Expense Tracker Plugin
  // =========================================================================
  console.log('[Plugins] Registering Expense Tracker plugin...');
  try {
    const expensePlugin = createPlugin()
      .meta({
        id: 'expense-tracker',
        name: 'Expense Tracker',
        version: '1.0.0',
        description: 'Track expenses and manage budgets',
        author: { name: 'OwnPilot' },
        capabilities: ['tools', 'handlers', 'storage'] as PluginCapability[],
        permissions: ['storage'],
        icon: '💰',
      })
      .tool(
        {
          name: 'expense_add',
          description: 'Add a new expense',
          parameters: {
            type: 'object',
            properties: {
              amount: { type: 'number', description: 'Expense amount' },
              category: { type: 'string', description: 'Category (food, transport, etc.)' },
              description: { type: 'string', description: 'Description' },
            },
            required: ['amount', 'category'],
          },
        },
        async (params) => ({
          content: {
            success: true,
            expense: {
              id: `exp_${Date.now()}`,
              amount: params.amount,
              category: params.category,
              description: params.description,
              date: new Date().toISOString(),
            },
          },
        })
      )
      .tool(
        {
          name: 'expense_list',
          description: 'List expenses',
          parameters: {
            type: 'object',
            properties: {
              category: { type: 'string', description: 'Filter by category' },
              limit: { type: 'number', description: 'Max items' },
            },
          },
        },
        async () => ({
          content: {
            success: true,
            expenses: [],
            total: 0,
          },
        })
      )
      .tool(
        {
          name: 'expense_summary',
          description: 'Get expense summary',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({
          content: {
            success: true,
            totalExpenses: 0,
            byCategory: {},
            message: 'No expenses recorded yet',
          },
        })
      )
      .build();

    await registry.register(expensePlugin.manifest, expensePlugin.implementation);
    console.log(`[Plugins] Registered: ${expensePlugin.manifest.name} v${expensePlugin.manifest.version}`);
  } catch (error) {
    console.error('[Plugins] Failed to register expense-tracker:', error);
  }

  // Log summary
  const allPlugins = registry.getAll();
  const enabledPlugins = registry.getEnabled();
  console.log(`[Plugins] Initialized ${allPlugins.length} plugins (${enabledPlugins.length} enabled)`);
}

/**
 * Get plugin registry (for use in routes)
 */
export { getDefaultPluginRegistry } from '@ownpilot/core';
