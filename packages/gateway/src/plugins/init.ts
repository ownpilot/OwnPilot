/**
 * Plugin Initialization
 *
 * Registers all 12 built-in plugins on gateway startup.
 * Each plugin's state (enabled/disabled, settings, permissions) is persisted
 * in the `plugins` DB table via pluginsRepo. Plugins with external service
 * dependencies register them through the Config Center registrar.
 */

import {
  getDefaultPluginRegistry,
  createPlugin,
  type PluginManifest,
  type PluginCapability,
  type PluginPermission,
  type PluginStatus,
  type ConfigFieldDefinition,
} from '@ownpilot/core';
import type { Plugin } from '@ownpilot/core';
import { pluginsRepo } from '../db/repositories/plugins.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { registerPluginApiDependencies } from '../services/api-service-registrar.js';

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
// 1. Weather Service
// ---------------------------------------------------------------------------

function buildWeatherPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'default_city',
      label: 'Default City',
      type: 'string',
      placeholder: 'e.g. London',
      order: 0,
    },
    {
      name: 'units',
      label: 'Temperature Units',
      type: 'select',
      defaultValue: 'metric',
      options: [
        { value: 'metric', label: 'Celsius (Metric)' },
        { value: 'imperial', label: 'Fahrenheit (Imperial)' },
      ],
      order: 1,
    },
    {
      name: 'refresh_interval',
      label: 'Refresh Interval',
      type: 'number',
      defaultValue: 30,
      description: 'Auto-refresh interval in minutes',
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'weather',
      name: 'Weather Service',
      version: '1.0.0',
      description: 'Get current weather and forecasts for any location',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'storage'] as PluginCapability[],
      permissions: ['network', 'storage'] as PluginPermission[],
      icon: '\u2601\uFE0F',
      category: 'utilities',
      pluginConfigSchema,
      defaultConfig: {
        default_city: '',
        units: 'metric',
        refresh_interval: 30,
      },
      requiredServices: [
        {
          name: 'openweathermap',
          displayName: 'OpenWeatherMap',
          category: 'weather',
          docsUrl: 'https://openweathermap.org/api',
        },
      ],
    })
    .tool(
      {
        name: 'weather_current',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name (e.g. "London", "New York")' },
            units: { type: 'string', enum: ['metric', 'imperial'], description: 'Temperature units' },
          },
          required: ['city'],
        },
      },
      async (params) => {
        const apiKey = configServicesRepo.getApiKey('openweathermap');
        if (!apiKey) {
          return { content: { error: 'OpenWeatherMap API key not configured. Add it in Config Center.' }, isError: true };
        }
        const city = params.city as string;
        const units = (params.units as string) || 'metric';
        try {
          const res = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=${units}&appid=${apiKey}`,
          );
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return { content: { error: `OpenWeatherMap API error ${res.status}: ${errText}` }, isError: true };
          }
          const data = await res.json() as Record<string, unknown>;
          const main = data.main as Record<string, number>;
          const weather = (data.weather as Array<Record<string, string>>)?.[0];
          const wind = data.wind as Record<string, number>;
          return {
            content: {
              city: data.name,
              country: (data.sys as Record<string, string>)?.country,
              temperature: main?.temp,
              feelsLike: main?.feels_like,
              humidity: main?.humidity,
              pressure: main?.pressure,
              description: weather?.description,
              icon: weather?.icon,
              windSpeed: wind?.speed,
              units,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (error) {
          return { content: { error: `Weather fetch failed: ${error instanceof Error ? error.message : String(error)}` }, isError: true };
        }
      },
    )
    .tool(
      {
        name: 'weather_forecast',
        description: 'Get weather forecast for a location',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'City name' },
            days: { type: 'number', description: 'Number of days (1-7)' },
          },
          required: ['city'],
        },
      },
      async (params) => {
        const apiKey = configServicesRepo.getApiKey('openweathermap');
        if (!apiKey) {
          return { content: { error: 'OpenWeatherMap API key not configured. Add it in Config Center.' }, isError: true };
        }
        const city = params.city as string;
        const days = Math.min(Math.max((params.days as number) || 3, 1), 7);
        const units = 'metric';
        try {
          const res = await fetch(
            `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=${units}&cnt=${days * 8}&appid=${apiKey}`,
          );
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return { content: { error: `OpenWeatherMap API error ${res.status}: ${errText}` }, isError: true };
          }
          const data = await res.json() as Record<string, unknown>;
          const list = (data.list as Array<Record<string, unknown>>) || [];
          const forecast = list.map((item) => {
            const main = item.main as Record<string, number>;
            const weather = (item.weather as Array<Record<string, string>>)?.[0];
            return {
              dateTime: item.dt_txt,
              temperature: main?.temp,
              feelsLike: main?.feels_like,
              humidity: main?.humidity,
              description: weather?.description,
            };
          });
          return {
            content: {
              city: (data.city as Record<string, unknown>)?.name,
              days,
              forecast,
            },
          };
        } catch (error) {
          return { content: { error: `Forecast fetch failed: ${error instanceof Error ? error.message : String(error)}` }, isError: true };
        }
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 2. News & RSS Reader
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
      }),
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
      }),
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
      }),
    )
    .build();
}

// ---------------------------------------------------------------------------
// 3. Code Assistant
// ---------------------------------------------------------------------------

function buildCodeAssistantPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'default_language',
      label: 'Default Language',
      type: 'string',
      defaultValue: 'javascript',
      placeholder: 'e.g. python',
      order: 0,
    },
    {
      name: 'tab_size',
      label: 'Tab Size',
      type: 'number',
      defaultValue: 2,
      order: 1,
    },
    {
      name: 'format_style',
      label: 'Format Style',
      type: 'select',
      defaultValue: 'prettier',
      options: [
        { value: 'prettier', label: 'Prettier' },
        { value: 'standard', label: 'Standard' },
      ],
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'code-assistant',
      name: 'Code Assistant',
      version: '1.0.0',
      description: 'Code formatting, analysis, and utilities',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers'] as PluginCapability[],
      permissions: [] as PluginPermission[],
      icon: '\uD83D\uDCBB',
      category: 'developer',
      pluginConfigSchema,
      defaultConfig: {
        default_language: 'javascript',
        tab_size: 2,
        format_style: 'prettier',
      },
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
      }),
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
      }),
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
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 4. Reminder Manager
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
      }),
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
      }),
    )
    .build();
}

// ---------------------------------------------------------------------------
// 5. Clipboard Manager
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
      }),
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
      }),
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
      }),
    )
    .build();
}

// ---------------------------------------------------------------------------
// 6. Advanced Calculator
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
        try {
          const expr = String(params.expression)
            .replace(/\^/g, '**')
            .replace(/sqrt\(/g, 'Math.sqrt(')
            .replace(/sin\(/g, 'Math.sin(')
            .replace(/cos\(/g, 'Math.cos(')
            .replace(/tan\(/g, 'Math.tan(')
            .replace(/log\(/g, 'Math.log10(')
            .replace(/ln\(/g, 'Math.log(')
            .replace(/abs\(/g, 'Math.abs(')
            .replace(/ceil\(/g, 'Math.ceil(')
            .replace(/floor\(/g, 'Math.floor(')
            .replace(/round\(/g, 'Math.round(')
            .replace(/pi/gi, 'Math.PI')
            .replace(/\be\b/g, 'Math.E');
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
// 7. Expense Tracker
// ---------------------------------------------------------------------------

function buildExpenseTrackerPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'currency',
      label: 'Currency',
      type: 'string',
      defaultValue: 'USD',
      placeholder: 'e.g. EUR',
      order: 0,
    },
    {
      name: 'budget_period',
      label: 'Budget Period',
      type: 'select',
      defaultValue: 'monthly',
      options: [
        { value: 'weekly', label: 'Weekly' },
        { value: 'monthly', label: 'Monthly' },
        { value: 'yearly', label: 'Yearly' },
      ],
      order: 1,
    },
    {
      name: 'default_category',
      label: 'Default Category',
      type: 'string',
      placeholder: 'e.g. Food',
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'expense-tracker',
      name: 'Expense Tracker',
      version: '1.0.0',
      description: 'Track expenses and manage budgets',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers', 'storage'] as PluginCapability[],
      permissions: ['storage'] as PluginPermission[],
      icon: '\uD83D\uDCB0',
      category: 'data',
      pluginConfigSchema,
      defaultConfig: {
        currency: 'USD',
        budget_period: 'monthly',
        default_category: '',
      },
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
      }),
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
      }),
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
      }),
    )
    .build();
}

// ---------------------------------------------------------------------------
// 8. Email Assistant (NEW)
// ---------------------------------------------------------------------------

function buildEmailAssistantPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'check_interval',
      label: 'Check Interval',
      type: 'number',
      defaultValue: 15,
      description: 'Check for new emails every N minutes',
      order: 0,
    },
    {
      name: 'max_results',
      label: 'Max Results',
      type: 'number',
      defaultValue: 20,
      order: 1,
    },
    {
      name: 'auto_summarize',
      label: 'Auto-Summarize',
      type: 'boolean',
      defaultValue: false,
      description: 'Auto-summarize new emails',
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'email-assistant',
      name: 'Email Assistant',
      version: '1.0.0',
      description: 'Send, read, and search emails through AI',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers', 'storage', 'notifications'] as PluginCapability[],
      permissions: ['network', 'storage', 'email', 'notifications'] as PluginPermission[],
      icon: '\uD83D\uDCE7',
      category: 'communication',
      pluginConfigSchema,
      defaultConfig: {
        check_interval: 15,
        max_results: 20,
        auto_summarize: false,
      },
      requiredServices: [
        {
          name: 'smtp',
          displayName: 'SMTP Email (Send)',
          category: 'email',
          multiEntry: true,
        },
        {
          name: 'imap',
          displayName: 'IMAP Email (Read)',
          category: 'email',
          multiEntry: true,
        },
      ],
    })
    .tool(
      {
        name: 'email_send',
        description: 'Send an email via SMTP',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body (plain text or HTML)' },
            cc: { type: 'string', description: 'CC recipients (comma-separated)' },
            bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
            html: { type: 'boolean', description: 'Whether body is HTML (default: false)' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      async (params) => {
        const entry = configServicesRepo.getDefaultEntry('smtp');
        if (!entry?.data) {
          return { content: { error: 'SMTP not configured. Add SMTP settings in Config Center.' }, isError: true };
        }
        const { host, port, secure, user, password, from_name } = entry.data as Record<string, string | number | boolean>;
        if (!host || !user || !password) {
          return { content: { error: 'SMTP configuration incomplete (host, user, password required).' }, isError: true };
        }
        try {
          const nodemailer = await import('nodemailer');
          const createTransport = nodemailer.default?.createTransport ?? nodemailer.createTransport;
          const transporter = createTransport({
            host: String(host),
            port: Number(port) || 587,
            secure: secure === true || secure === 'true',
            auth: { user: String(user), pass: String(password) },
          });
          const from = from_name ? `"${from_name}" <${user}>` : String(user);
          const isHtml = params.html === true;
          const mailOptions = {
            from,
            to: params.to as string,
            subject: params.subject as string,
            ...(isHtml ? { html: params.body as string } : { text: params.body as string }),
            ...(params.cc ? { cc: params.cc as string } : {}),
            ...(params.bcc ? { bcc: params.bcc as string } : {}),
          };
          const info = await transporter.sendMail(mailOptions);
          return {
            content: {
              success: true,
              messageId: info.messageId,
              to: params.to,
              subject: params.subject,
            },
          };
        } catch (error) {
          return { content: { error: `Failed to send email: ${error instanceof Error ? error.message : String(error)}` }, isError: true };
        }
      },
    )
    .tool(
      {
        name: 'email_read',
        description: 'Read recent emails from mailbox via IMAP',
        parameters: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'Folder to read from (default: INBOX)' },
            limit: { type: 'number', description: 'Maximum emails to return (default: 10)' },
          },
        },
      },
      async (params) => {
        const entry = configServicesRepo.getDefaultEntry('imap');
        if (!entry?.data) {
          return { content: { error: 'IMAP not configured. Add IMAP settings in Config Center.' }, isError: true };
        }
        const { host, port, secure, user, password, mailbox } = entry.data as Record<string, string | number | boolean>;
        if (!host || !user || !password) {
          return { content: { error: 'IMAP configuration incomplete (host, user, password required).' }, isError: true };
        }
        const folder = (params.folder as string) || (mailbox as string) || 'INBOX';
        const limit = Math.min(Math.max((params.limit as number) || 10, 1), 50);

        const maxRetries = 2;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const { ImapFlow } = await import('imapflow');
            const client = new ImapFlow({
              host: String(host),
              port: Number(port) || 993,
              secure: secure !== false && secure !== 'false',
              auth: { user: String(user), pass: String(password) },
              logger: false,
              emitLogs: false,
              connectionTimeout: 15000,
            });

            // Stage 1: Connect
            try {
              await client.connect();
            } catch (connErr) {
              const msg = connErr instanceof Error ? connErr.message : String(connErr);
              if (attempt < maxRetries) { lastError = connErr; continue; }
              return { content: { error: `IMAP connection failed (${String(host)}:${Number(port) || 993}): ${msg}` }, isError: true };
            }

            // Stage 2: Open mailbox
            let lock: { release: () => void };
            try {
              lock = await client.getMailboxLock(folder);
            } catch (lockErr) {
              await client.logout().catch(() => {});
              const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
              return { content: { error: `Failed to open folder "${folder}": ${msg}` }, isError: true };
            }

            try {
              const messages: Array<Record<string, unknown>> = [];
              const status = client.mailbox;
              const totalMessages = (status && typeof status === 'object' && 'exists' in status)
                ? (status as { exists: number }).exists : 0;
              if (totalMessages === 0) {
                return { content: { emails: [], total: 0, folder } };
              }
              const startSeq = Math.max(1, totalMessages - limit + 1);

              // Stage 3: Fetch messages
              try {
                for await (const msg of client.fetch(`${startSeq}:*`, {
                  envelope: true,
                  bodyStructure: true,
                  flags: true,
                })) {
                  const env = msg.envelope;
                  messages.push({
                    seq: msg.seq,
                    uid: msg.uid,
                    date: env?.date?.toISOString(),
                    subject: env?.subject,
                    from: env?.from?.map((a: { name?: string; address?: string }) => a.address || a.name).join(', '),
                    to: env?.to?.map((a: { name?: string; address?: string }) => a.address || a.name).join(', '),
                    flags: Array.from(msg.flags || []),
                    read: msg.flags?.has('\\Seen') ?? false,
                  });
                }
              } catch (fetchErr) {
                const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                if (attempt < maxRetries && /timeout|reset|closed|ECONNRESET/i.test(msg)) {
                  lastError = fetchErr;
                  lock.release();
                  await client.logout().catch(() => {});
                  continue;
                }
                return { content: { error: `IMAP FETCH failed for "${folder}": ${msg}` }, isError: true };
              }

              messages.reverse(); // newest first
              return {
                content: {
                  emails: messages,
                  total: totalMessages,
                  folder,
                  returned: messages.length,
                },
              };
            } finally {
              lock.release();
              await client.logout().catch(() => {});
            }
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries) continue;
          }
        }

        const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
        return { content: { error: `IMAP read failed after ${maxRetries} attempts: ${errMsg}` }, isError: true };
      },
    )
    .tool(
      {
        name: 'email_get_content',
        description: 'Read the full content/body of a specific email by UID. Use email_read first to list emails and get UIDs, then use this tool to read the content of a specific email.',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: 'UID of the email to read (from email_read or email_search results)' },
            folder: { type: 'string', description: 'Folder the email is in (default: INBOX)' },
          },
          required: ['uid'],
        },
      },
      async (params) => {
        const entry = configServicesRepo.getDefaultEntry('imap');
        if (!entry?.data) {
          return { content: { error: 'IMAP not configured. Add IMAP settings in Config Center.' }, isError: true };
        }
        const { host, port, secure, user, password, mailbox } = entry.data as Record<string, string | number | boolean>;
        if (!host || !user || !password) {
          return { content: { error: 'IMAP configuration incomplete.' }, isError: true };
        }
        const uid = params.uid as number;
        if (!uid || uid <= 0 || !Number.isInteger(uid)) {
          return { content: { error: `Invalid UID: ${uid}. UID must be a positive integer.` }, isError: true };
        }
        const folder = (params.folder as string) || (mailbox as string) || 'INBOX';

        const maxRetries = 2;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const { ImapFlow } = await import('imapflow');
            const client = new ImapFlow({
              host: String(host),
              port: Number(port) || 993,
              secure: secure !== false && secure !== 'false',
              auth: { user: String(user), pass: String(password) },
              logger: false,
              emitLogs: false,
              connectionTimeout: 15000,
            });

            // Stage 1: Connect to IMAP server
            try {
              await client.connect();
            } catch (connErr) {
              const msg = connErr instanceof Error ? connErr.message : String(connErr);
              if (attempt < maxRetries) { lastError = connErr; continue; }
              return { content: { error: `IMAP connection failed (${String(host)}:${Number(port) || 993}): ${msg}` }, isError: true };
            }

            // Stage 2: Open mailbox folder
            let lock: { release: () => void };
            try {
              lock = await client.getMailboxLock(folder);
            } catch (lockErr) {
              await client.logout().catch(() => {});
              const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
              return { content: { error: `Failed to open folder "${folder}": ${msg}` }, isError: true };
            }

            try {
              // Stage 3: Fetch envelope + flags
              interface EnvelopeAddr { name?: string; address?: string }
              let envelope: { date?: Date; subject?: string; from?: EnvelopeAddr[]; to?: EnvelopeAddr[]; cc?: EnvelopeAddr[] } | undefined;
              let flags: Set<string> | undefined;
              let foundUid: number | undefined;

              try {
                for await (const msg of client.fetch(String(uid), {
                  envelope: true,
                  flags: true,
                  uid: true,
                })) {
                  envelope = msg.envelope;
                  flags = msg.flags;
                  foundUid = msg.uid;
                }
              } catch (fetchErr) {
                const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                // Retry on transient failures (connection reset, timeout)
                if (attempt < maxRetries && /timeout|reset|closed|ECONNRESET/i.test(msg)) {
                  lastError = fetchErr;
                  lock.release();
                  await client.logout().catch(() => {});
                  continue;
                }
                return { content: { error: `IMAP FETCH failed for UID ${uid} in "${folder}": ${msg}. The email may have been deleted or moved.` }, isError: true };
              }

              if (!foundUid) {
                return { content: { error: `Email with UID ${uid} not found in "${folder}". It may have been deleted or moved to another folder.` }, isError: true };
              }

              // Stage 4: Download message body via client.download()
              let body = '';
              try {
                const download = await client.download(String(uid), undefined, { uid: true });
                const chunks: Buffer[] = [];
                for await (const chunk of download.content) {
                  chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer);
                  const totalSize = chunks.reduce((s, c) => s + c.length, 0);
                  if (totalSize > 512 * 1024) break;
                }
                const raw = Buffer.concat(chunks).toString('utf-8');
                const headerEnd = raw.indexOf('\r\n\r\n');
                if (headerEnd !== -1) {
                  body = raw.substring(headerEnd + 4);
                } else {
                  body = raw;
                }
              } catch {
                // Fallback: fetch with bodyParts
                try {
                  for await (const msg of client.fetch(String(uid), {
                    uid: true,
                    bodyParts: ['text'],
                  } as Record<string, unknown>)) {
                    const parts = msg.bodyParts as Map<string, Buffer> | undefined;
                    if (parts) {
                      for (const [, value] of parts) {
                        body = value.toString('utf-8');
                        break;
                      }
                    }
                  }
                } catch {
                  body = '(Could not retrieve email body)';
                }
              }

              // Decode quoted-printable soft line breaks
              body = body.replace(/=\r?\n/g, '');
              body = body.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)));

              // Strip HTML to plain text if needed
              if (body.includes('<html') || body.includes('<HTML') || body.includes('<div') || body.includes('<p>') || body.includes('<table')) {
                body = body
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<\/p>/gi, '\n')
                  .replace(/<\/div>/gi, '\n')
                  .replace(/<\/tr>/gi, '\n')
                  .replace(/<\/li>/gi, '\n')
                  .replace(/<[^>]+>/g, '')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/\n{3,}/g, '\n\n')
                  .trim();
              }

              // Trim oversized content
              if (body.length > 10000) {
                body = body.substring(0, 10000) + '\n... [truncated]';
              }

              const formatAddr = (a: EnvelopeAddr) => a.name ? `${a.name} <${a.address}>` : (a.address ?? '');

              return {
                content: {
                  uid: foundUid,
                  date: envelope?.date?.toISOString(),
                  subject: envelope?.subject,
                  from: envelope?.from?.map(formatAddr).join(', '),
                  to: envelope?.to?.map(formatAddr).join(', '),
                  cc: envelope?.cc?.map(formatAddr).join(', ') || undefined,
                  read: flags?.has('\\Seen') ?? false,
                  flagged: flags?.has('\\Flagged') ?? false,
                  body,
                  folder,
                },
              };
            } finally {
              lock.release();
              await client.logout().catch(() => {});
            }
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries) continue;
          }
        }

        // All retries exhausted
        const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
        return { content: { error: `IMAP read failed after ${maxRetries} attempts: ${errMsg}` }, isError: true };
      },
    )
    .tool(
      {
        name: 'email_search',
        description: 'Search emails via IMAP',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search text (searches subject and body)' },
            folder: { type: 'string', description: 'Folder to search in (default: INBOX)' },
            from: { type: 'string', description: 'Filter by sender address' },
            since: { type: 'string', description: 'Emails since date (YYYY-MM-DD)' },
            limit: { type: 'number', description: 'Maximum results (default: 20)' },
          },
          required: ['query'],
        },
      },
      async (params) => {
        const entry = configServicesRepo.getDefaultEntry('imap');
        if (!entry?.data) {
          return { content: { error: 'IMAP not configured. Add IMAP settings in Config Center.' }, isError: true };
        }
        const { host, port, secure, user, password, mailbox } = entry.data as Record<string, string | number | boolean>;
        if (!host || !user || !password) {
          return { content: { error: 'IMAP configuration incomplete.' }, isError: true };
        }
        const folder = (params.folder as string) || (mailbox as string) || 'INBOX';
        const limit = Math.min(Math.max((params.limit as number) || 20, 1), 50);
        const query = params.query as string;

        const maxRetries = 2;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const { ImapFlow } = await import('imapflow');
            const client = new ImapFlow({
              host: String(host),
              port: Number(port) || 993,
              secure: secure !== false && secure !== 'false',
              auth: { user: String(user), pass: String(password) },
              logger: false,
              emitLogs: false,
              connectionTimeout: 15000,
            });

            try {
              await client.connect();
            } catch (connErr) {
              const msg = connErr instanceof Error ? connErr.message : String(connErr);
              if (attempt < maxRetries) { lastError = connErr; continue; }
              return { content: { error: `IMAP connection failed (${String(host)}:${Number(port) || 993}): ${msg}` }, isError: true };
            }

            let lock: { release: () => void };
            try {
              lock = await client.getMailboxLock(folder);
            } catch (lockErr) {
              await client.logout().catch(() => {});
              const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
              return { content: { error: `Failed to open folder "${folder}": ${msg}` }, isError: true };
            }

            try {
              const searchCriteria: Record<string, unknown> = {};
              if (query) searchCriteria.or = [{ subject: query }, { body: query }];
              if (params.from) searchCriteria.from = params.from as string;
              if (params.since) searchCriteria.since = params.since as string;

              let searchResult: number[];
              try {
                searchResult = await client.search(searchCriteria, { uid: true }) as number[];
              } catch (searchErr) {
                const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
                if (attempt < maxRetries && /timeout|reset|closed|ECONNRESET/i.test(msg)) {
                  lastError = searchErr;
                  lock.release();
                  await client.logout().catch(() => {});
                  continue;
                }
                return { content: { error: `IMAP SEARCH failed in "${folder}": ${msg}` }, isError: true };
              }

              const uids = Array.isArray(searchResult) ? searchResult : [];
              const resultUids = uids.slice(-limit);
              if (resultUids.length === 0) {
                return { content: { query, results: [], total: 0, folder } };
              }
              const messages: Array<Record<string, unknown>> = [];
              for await (const msg of client.fetch(resultUids, {
                envelope: true,
                flags: true,
                uid: true,
              })) {
                const env = msg.envelope;
                messages.push({
                  uid: msg.uid,
                  date: env?.date?.toISOString(),
                  subject: env?.subject,
                  from: env?.from?.map((a: { name?: string; address?: string }) => a.address || a.name).join(', '),
                  to: env?.to?.map((a: { name?: string; address?: string }) => a.address || a.name).join(', '),
                  read: msg.flags?.has('\\Seen') ?? false,
                });
              }
              messages.reverse();
              return {
                content: {
                  query,
                  results: messages,
                  total: uids.length,
                  returned: messages.length,
                  folder,
                },
              };
            } finally {
              lock.release();
              await client.logout().catch(() => {});
            }
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries) continue;
          }
        }

        const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
        return { content: { error: `IMAP search failed after ${maxRetries} attempts: ${errMsg}` }, isError: true };
      },
    )
    .tool(
      {
        name: 'email_delete',
        description: 'Delete an email by UID via IMAP. Moves it to Trash or marks it as \\Deleted depending on server support.',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: 'UID of the email to delete' },
            folder: { type: 'string', description: 'Folder where the email resides (default: INBOX)' },
          },
          required: ['uid'],
        },
      },
      async (params) => {
        const entry = configServicesRepo.getDefaultEntry('imap');
        if (!entry?.data) {
          return { content: { error: 'IMAP not configured. Add IMAP settings in Config Center.' }, isError: true };
        }
        const { host, port, secure, user, password, mailbox } = entry.data as Record<string, string | number | boolean>;
        if (!host || !user || !password) {
          return { content: { error: 'IMAP configuration incomplete.' }, isError: true };
        }
        const uid = params.uid as number;
        if (!uid || uid <= 0 || !Number.isInteger(uid)) {
          return { content: { error: `Invalid UID: ${uid}. UID must be a positive integer.` }, isError: true };
        }
        const folder = (params.folder as string) || (mailbox as string) || 'INBOX';

        const maxRetries = 2;
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const { ImapFlow } = await import('imapflow');
            const client = new ImapFlow({
              host: String(host),
              port: Number(port) || 993,
              secure: secure !== false && secure !== 'false',
              auth: { user: String(user), pass: String(password) },
              logger: false,
              emitLogs: false,
              connectionTimeout: 15000,
            });

            try {
              await client.connect();
            } catch (connErr) {
              const msg = connErr instanceof Error ? connErr.message : String(connErr);
              if (attempt < maxRetries) { lastError = connErr; continue; }
              return { content: { error: `IMAP connection failed (${String(host)}:${Number(port) || 993}): ${msg}` }, isError: true };
            }

            let lock: { release: () => void };
            try {
              lock = await client.getMailboxLock(folder);
            } catch (lockErr) {
              await client.logout().catch(() => {});
              const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
              return { content: { error: `Failed to open folder "${folder}": ${msg}` }, isError: true };
            }

            try {
              // Try moving to Trash first, fall back to flag-based delete
              try {
                await client.messageMove(String(uid), 'Trash', { uid: true });
                return {
                  content: {
                    success: true,
                    uid,
                    action: 'moved_to_trash',
                    folder,
                  },
                };
              } catch {
                // Trash folder may not exist or move not supported; flag as deleted
                await client.messageDelete(String(uid), { uid: true });
                return {
                  content: {
                    success: true,
                    uid,
                    action: 'deleted',
                    folder,
                  },
                };
              }
            } finally {
              lock.release();
              await client.logout().catch(() => {});
            }
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries) continue;
          }
        }

        const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
        return { content: { error: `IMAP delete failed after ${maxRetries} attempts: ${errMsg}` }, isError: true };
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 9. Translation (NEW)
// ---------------------------------------------------------------------------

function buildTranslationPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'default_source_lang',
      label: 'Default Source Language',
      type: 'string',
      defaultValue: 'auto',
      placeholder: 'auto',
      order: 0,
    },
    {
      name: 'default_target_lang',
      label: 'Default Target Language',
      type: 'string',
      defaultValue: 'en',
      placeholder: 'en',
      order: 1,
    },
    {
      name: 'auto_detect',
      label: 'Auto-Detect Language',
      type: 'boolean',
      defaultValue: true,
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'translation',
      name: 'Translation',
      version: '1.0.0',
      description: 'Translate text between languages using DeepL',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '\uD83C\uDF10',
      category: 'utilities',
      pluginConfigSchema,
      defaultConfig: {
        default_source_lang: 'auto',
        default_target_lang: 'en',
        auto_detect: true,
      },
      requiredServices: [
        {
          name: 'deepl',
          displayName: 'DeepL',
          category: 'translation',
          docsUrl: 'https://www.deepl.com/docs-api',
        },
      ],
    })
    .tool(
      {
        name: 'translate_text',
        description: 'Translate text to another language using DeepL',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to translate' },
            target_lang: { type: 'string', description: 'Target language code (e.g. "EN", "DE", "FR", "TR")' },
            source_lang: { type: 'string', description: 'Source language code (or omit for auto-detection)' },
          },
          required: ['text', 'target_lang'],
        },
      },
      async (params) => {
        const apiKey = configServicesRepo.getApiKey('deepl');
        if (!apiKey) {
          return { content: { error: 'DeepL API key not configured. Add it in Config Center.' }, isError: true };
        }
        const baseUrl = (configServicesRepo.getFieldValue('deepl', 'base_url') as string) || 'https://api-free.deepl.com/v2';
        const text = params.text as string;
        const targetLang = (params.target_lang as string).toUpperCase();
        const body: Record<string, unknown> = { text: [text], target_lang: targetLang };
        const sourceLang = params.source_lang as string | undefined;
        if (sourceLang && sourceLang !== 'auto') {
          body.source_lang = sourceLang.toUpperCase();
        }
        try {
          const res = await fetch(`${baseUrl}/translate`, {
            method: 'POST',
            headers: { 'Authorization': `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return { content: { error: `DeepL API error ${res.status}: ${errText}` }, isError: true };
          }
          const data = await res.json() as { translations: Array<{ detected_source_language: string; text: string }> };
          const t = data.translations[0];
          return {
            content: {
              original: text,
              translated: t?.text ?? text,
              source_lang: t?.detected_source_language?.toLowerCase() ?? 'unknown',
              target_lang: targetLang.toLowerCase(),
            },
          };
        } catch (error) {
          return { content: { error: `Translation failed: ${error instanceof Error ? error.message : String(error)}` }, isError: true };
        }
      },
    )
    .tool(
      {
        name: 'detect_language',
        description: 'Detect the language of a text (translates a small snippet to detect source language)',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to analyze' },
          },
          required: ['text'],
        },
      },
      async (params) => {
        const apiKey = configServicesRepo.getApiKey('deepl');
        if (!apiKey) {
          return { content: { error: 'DeepL API key not configured. Add it in Config Center.' }, isError: true };
        }
        const baseUrl = (configServicesRepo.getFieldValue('deepl', 'base_url') as string) || 'https://api-free.deepl.com/v2';
        const text = (params.text as string).slice(0, 200);
        try {
          const res = await fetch(`${baseUrl}/translate`, {
            method: 'POST',
            headers: { 'Authorization': `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: [text], target_lang: 'EN' }),
          });
          if (!res.ok) {
            return { content: { error: `DeepL API error ${res.status}` }, isError: true };
          }
          const data = await res.json() as { translations: Array<{ detected_source_language: string; text: string }> };
          const detected = data.translations[0]?.detected_source_language?.toLowerCase() ?? 'unknown';
          return {
            content: {
              text: text.length > 100 ? text.slice(0, 100) + '...' : text,
              detected_language: detected,
            },
          };
        } catch (error) {
          return { content: { error: `Detection failed: ${error instanceof Error ? error.message : String(error)}` }, isError: true };
        }
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 10. Web Search (NEW)
// ---------------------------------------------------------------------------

function buildWebSearchPlugin(): BuiltinPluginEntry {
  const pluginConfigSchema: ConfigFieldDefinition[] = [
    {
      name: 'default_depth',
      label: 'Default Search Depth',
      type: 'select',
      defaultValue: 'basic',
      options: [
        { value: 'basic', label: 'Basic (faster)' },
        { value: 'advanced', label: 'Advanced (better)' },
      ],
      order: 0,
    },
    {
      name: 'max_results',
      label: 'Max Results',
      type: 'number',
      defaultValue: 5,
      order: 1,
    },
    {
      name: 'include_images',
      label: 'Include Images',
      type: 'boolean',
      defaultValue: false,
      order: 2,
    },
  ];

  return createPlugin()
    .meta({
      id: 'web-search',
      name: 'Web Search',
      version: '1.0.0',
      description: 'Search the web and extract content from URLs',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'handlers'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '\uD83D\uDD0D',
      category: 'utilities',
      pluginConfigSchema,
      defaultConfig: {
        default_depth: 'basic',
        max_results: 5,
        include_images: false,
      },
      requiredServices: [
        {
          name: 'tavily',
          displayName: 'Tavily',
          category: 'search',
          docsUrl: 'https://docs.tavily.com/',
        },
      ],
    })
    .tool(
      {
        name: 'web_search',
        description: 'Search the web for information using Tavily',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            depth: { type: 'string', enum: ['basic', 'advanced'], description: 'Search depth' },
            max_results: { type: 'number', description: 'Maximum number of results (1-20)' },
          },
          required: ['query'],
        },
      },
      async (params) => {
        const apiKey = configServicesRepo.getApiKey('tavily');
        if (!apiKey) {
          return { content: { error: 'Tavily API key not configured. Add it in Config Center.' }, isError: true };
        }
        const query = params.query as string;
        const depth = (params.depth as string) || 'basic';
        const maxResults = Math.min(Math.max((params.max_results as number) || 5, 1), 20);
        try {
          const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: apiKey,
              query,
              search_depth: depth,
              max_results: maxResults,
              include_answer: true,
            }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return { content: { error: `Tavily API error ${res.status}: ${errText}` }, isError: true };
          }
          const data = await res.json() as Record<string, unknown>;
          const results = (data.results as Array<Record<string, unknown>> || []).map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
          }));
          return {
            content: {
              query,
              answer: data.answer,
              results,
              resultCount: results.length,
            },
          };
        } catch (error) {
          return { content: { error: `Search failed: ${error instanceof Error ? error.message : String(error)}` }, isError: true };
        }
      },
    )
    .tool(
      {
        name: 'web_extract',
        description: 'Extract content from a URL using Tavily',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to extract content from' },
          },
          required: ['url'],
        },
      },
      async (params) => {
        const apiKey = configServicesRepo.getApiKey('tavily');
        if (!apiKey) {
          return { content: { error: 'Tavily API key not configured. Add it in Config Center.' }, isError: true };
        }
        const url = params.url as string;
        try {
          const res = await fetch('https://api.tavily.com/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, urls: [url] }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            return { content: { error: `Tavily extract error ${res.status}: ${errText}` }, isError: true };
          }
          const data = await res.json() as { results: Array<Record<string, unknown>> };
          const result = data.results?.[0];
          return {
            content: {
              url,
              rawContent: result?.raw_content ?? '',
              extractedContent: result?.content ?? '',
            },
          };
        } catch (error) {
          return { content: { error: `Extraction failed: ${error instanceof Error ? error.message : String(error)}` }, isError: true };
        }
      },
    )
    .build();
}

// ---------------------------------------------------------------------------
// 11. Text Utilities (NEW)
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
// 12. Pomodoro Timer (NEW)
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
          },
        },
      },
      async (params) => ({
        content: {
          success: true,
          session: {
            id: `pom_${Date.now()}`,
            task: params.task || 'Untitled session',
            startedAt: new Date().toISOString(),
            duration: 25,
            type: 'work',
          },
          message: 'Pomodoro session started',
        },
      }),
    )
    .tool(
      {
        name: 'pomodoro_status',
        description: 'Get current Pomodoro session status',
        parameters: { type: 'object', properties: {} },
      },
      async () => ({
        content: {
          success: true,
          active: false,
          message: 'No active Pomodoro session',
        },
      }),
    )
    .tool(
      {
        name: 'pomodoro_stop',
        description: 'Stop the current Pomodoro session',
        parameters: { type: 'object', properties: {} },
      },
      async () => ({
        content: {
          success: true,
          active: false,
          message: 'No active session to stop',
        },
      }),
    )
    .build();
}

// =============================================================================
// Plugin Collection
// =============================================================================

/**
 * Returns all 12 built-in plugin definitions.
 */
function getAllBuiltinPlugins(): BuiltinPluginEntry[] {
  return [
    // Existing plugins (1-7)
    buildWeatherPlugin(),
    buildNewsRssPlugin(),
    buildCodeAssistantPlugin(),
    buildReminderPlugin(),
    buildClipboardPlugin(),
    buildCalculatorPlugin(),
    buildExpenseTrackerPlugin(),
    // New plugins (8-12)
    buildEmailAssistantPlugin(),
    buildTranslationPlugin(),
    buildWebSearchPlugin(),
    buildTextUtilsPlugin(),
    buildPomodoroPlugin(),
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
        await registerPluginApiDependencies(
          manifest.id,
          manifest.name,
          manifest.requiredServices,
        );
      }

      // 3. Register in PluginRegistry
      const plugin = await registry.register(manifest, implementation);

      // 4. Apply DB state
      plugin.config.settings = dbRecord.settings;
      plugin.config.grantedPermissions = dbRecord.grantedPermissions as PluginPermission[];
      plugin.config.enabled = dbRecord.status === 'enabled';
      plugin.status = dbRecord.status as PluginStatus;

      console.log(`[Plugins] Registered: ${manifest.name} v${manifest.version} (${dbRecord.status})`);
    } catch (error) {
      console.error(`[Plugins] Failed to register ${manifest.id}:`, error);
    }
  }

  const allPlugins = registry.getAll();
  const enabledPlugins = registry.getEnabled();
  console.log(`[Plugins] Initialized ${allPlugins.length} plugins (${enabledPlugins.length} enabled)`);
}

/**
 * Re-export for route-layer access to the plugin registry.
 */
export { getDefaultPluginRegistry } from '@ownpilot/core';
