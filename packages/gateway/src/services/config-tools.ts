/**
 * Config Center Management Tools
 *
 * Provides AI tools to list, inspect, and update Config Center services and entries.
 * These tools let the AI configure external services (API keys, SMTP, etc.)
 * on behalf of the user through conversation.
 */

import type { ToolDefinition, ToolExecutionResult } from '@ownpilot/core';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { maskSecret, getErrorMessage } from '../routes/helpers.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const listConfigServicesTool: ToolDefinition = {
  name: 'config_list_services',
  description:
    'List all available Config Center services (API integrations, email providers, etc.). ' +
    'Shows which services are configured and which still need setup.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (e.g. "ai", "email", "translation", "search", "weather")',
      },
    },
  },
};

const getConfigServiceTool: ToolDefinition = {
  name: 'config_get_service',
  description:
    'Get full details for a Config Center service: its schema (required fields), ' +
    'current entries/accounts, and status. Use this before setting values to see what fields are needed.',
  parameters: {
    type: 'object',
    properties: {
      service: {
        type: 'string',
        description: 'Service name (e.g. "deepl", "smtp", "imap", "openweathermap", "tavily")',
      },
    },
    required: ['service'],
  },
};

const setConfigEntryTool: ToolDefinition = {
  name: 'config_set_entry',
  description:
    'Create or update a Config Center entry for a service. ' +
    'Pass the service name and a data object with field values matching the service schema. ' +
    'If the service already has a default entry, it will be updated; otherwise a new entry is created.',
  parameters: {
    type: 'object',
    properties: {
      service: {
        type: 'string',
        description: 'Service name (e.g. "deepl", "smtp", "openweathermap")',
      },
      data: {
        type: 'object',
        description: 'Field values keyed by field name from the service schema (e.g. { "api_key": "abc123", "base_url": "https://..." })',
      },
      label: {
        type: 'string',
        description: 'Optional label for multi-entry services (e.g. "Work Gmail", "Personal SMTP")',
      },
    },
    required: ['service', 'data'],
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

async function executeListConfigServices(
  params: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const category = params.category as string | undefined;
  const services = configServicesRepo.list(category);

  const result = services.map((svc) => {
    const entries = configServicesRepo.getEntries(svc.name);
    const configured = entries.length > 0 && entries.some((e) => {
      const vals = Object.values(e.data);
      return vals.some((v) => v !== null && v !== undefined && v !== '');
    });

    return {
      name: svc.name,
      displayName: svc.displayName,
      category: svc.category,
      configured,
      entryCount: entries.length,
      multiEntry: svc.multiEntry,
      requiredBy: svc.requiredBy?.map((r) => `${r.type}:${r.name}`) ?? [],
    };
  });

  return {
    content: {
      services: result,
      total: result.length,
      configured: result.filter((s) => s.configured).length,
      unconfigured: result.filter((s) => !s.configured).length,
    },
  };
}

async function executeGetConfigService(
  params: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const serviceName = params.service as string;
  const svc = configServicesRepo.getByName(serviceName);
  if (!svc) {
    return {
      content: { error: `Service not found: "${serviceName}". Use config_list_services to see available services.` },
      isError: true,
    };
  }

  const entries = configServicesRepo.getEntries(serviceName);

  // Build schema summary — mask secret fields in existing entries
  const schema = svc.configSchema.map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    required: f.required ?? false,
    defaultValue: f.defaultValue,
    description: f.description,
    placeholder: f.placeholder,
    options: f.options,
  }));

  const maskedEntries = entries.map((entry) => {
    const maskedData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry.data)) {
      const fieldDef = svc.configSchema.find((f) => f.name === key);
      if (fieldDef?.type === 'secret' && typeof value === 'string' && value.length > 0) {
        maskedData[key] = maskSecret(value);
      } else {
        maskedData[key] = value;
      }
    }
    return {
      id: entry.id,
      label: entry.label,
      isDefault: entry.isDefault,
      isActive: entry.isActive,
      data: maskedData,
    };
  });

  return {
    content: {
      service: {
        name: svc.name,
        displayName: svc.displayName,
        category: svc.category,
        description: svc.description,
        docsUrl: svc.docsUrl,
        multiEntry: svc.multiEntry,
      },
      schema,
      entries: maskedEntries,
      configured: maskedEntries.length > 0,
    },
  };
}

async function executeSetConfigEntry(
  params: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const serviceName = params.service as string;
  const data = params.data as Record<string, unknown> | undefined;
  const label = params.label as string | undefined;

  if (!data || typeof data !== 'object') {
    return { content: { error: '"data" must be an object with field values.' }, isError: true };
  }

  // Strip prototype pollution keys
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    delete data[key];
  }

  const svc = configServicesRepo.getByName(serviceName);
  if (!svc) {
    return {
      content: { error: `Service not found: "${serviceName}". Use config_list_services to see available services.` },
      isError: true,
    };
  }

  // Validate required fields
  const schema = svc.configSchema ?? [];
  const missing: string[] = [];
  for (const field of schema) {
    if (field.required && (data[field.name] === undefined || data[field.name] === '')) {
      missing.push(`${field.name} (${field.label})`);
    }
  }

  // Check if there's already a default entry to update
  const existingEntry = label
    ? configServicesRepo.getEntryByLabel(serviceName, label)
    : configServicesRepo.getDefaultEntry(serviceName);

  try {
    if (existingEntry) {
      // Merge new data with existing data (don't wipe fields not provided)
      // Protect against masked secret values being merged in
      const secretFieldNames = schema
        .filter(f => f.type === 'secret')
        .map(f => f.name);
      const cleanData = { ...data };
      for (const field of secretFieldNames) {
        const val = cleanData[field];
        if (typeof val === 'string' && (val === '****' || /^.{4}\.\.\..{4}$/.test(val))) {
          // This looks like a masked value — drop it so the original is preserved
          delete cleanData[field];
        }
      }
      const mergedData = { ...existingEntry.data, ...cleanData };
      await configServicesRepo.updateEntry(existingEntry.id, {
        data: mergedData,
        ...(label ? { label } : {}),
      });

      return {
        content: {
          success: true,
          action: 'updated',
          service: serviceName,
          entryId: existingEntry.id,
          label: label ?? existingEntry.label,
          updatedFields: Object.keys(data),
          ...(missing.length > 0 ? { missingOptionalFields: missing } : {}),
        },
      };
    } else {
      // Create new entry
      const entry = await configServicesRepo.createEntry(serviceName, {
        data,
        label: label ?? 'Default',
        isDefault: true,
      });

      return {
        content: {
          success: true,
          action: 'created',
          service: serviceName,
          entryId: entry.id,
          label: entry.label,
          setFields: Object.keys(data),
          ...(missing.length > 0 ? { missingRequiredFields: missing } : {}),
        },
      };
    }
  } catch (error) {
    return {
      content: { error: `Failed to save config: ${getErrorMessage(error)}` },
      isError: true,
    };
  }
}

// =============================================================================
// Executor Dispatch
// =============================================================================

export async function executeConfigTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    let result: ToolExecutionResult;
    switch (toolName) {
      case 'config_list_services':
        result = await executeListConfigServices(params);
        break;
      case 'config_get_service':
        result = await executeGetConfigService(params);
        break;
      case 'config_set_entry':
        result = await executeSetConfigEntry(params);
        break;
      default:
        return { success: false, error: `Unknown config tool: ${toolName}` };
    }
    if (result.isError) {
      return { success: false, error: JSON.stringify(result.content) };
    }
    return { success: true, result: result.content };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

// =============================================================================
// Export
// =============================================================================

export const CONFIG_TOOLS: ToolDefinition[] = [
  listConfigServicesTool,
  getConfigServiceTool,
  setConfigEntryTool,
];
