// Plugins, User Extensions, and Config Services types

export interface ConfigFieldDefinition {
  name: string;
  label: string;
  type: 'string' | 'secret' | 'url' | 'number' | 'boolean' | 'select' | 'json';
  required?: boolean;
  defaultValue?: unknown;
  envVar?: string;
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  order?: number;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  status: 'installed' | 'enabled' | 'disabled' | 'error' | 'updating';
  category?: string;
  capabilities: string[];
  permissions: string[];
  grantedPermissions?: string[];
  tools: string[];
  toolCount?: number;
  handlers: string[];
  error?: string;
  installedAt: string;
  updatedAt?: string;
  docs?: string;
  hasSettings?: boolean;
  hasUnconfiguredServices?: boolean;
  settings?: Record<string, unknown>;
  configSchema?: ConfigFieldDefinition[];
  pluginConfigSchema?: ConfigFieldDefinition[];
  configValues?: Record<string, unknown>;
  services?: Array<{
    serviceName: string;
    displayName: string;
    isConfigured: boolean;
  }>;
  requiredServices?: Array<{
    name: string;
    displayName: string;
    isConfigured: boolean;
  }>;
}

export interface PluginStats {
  total: number;
  enabled: number;
  disabled: number;
  error: number;
  totalTools: number;
  totalHandlers: number;
  byCapability: Record<string, number>;
  byPermission: Record<string, number>;
}

// ---- User Extensions ----

export interface ExtensionToolInfo {
  name: string;
  description: string;
  permissions?: string[];
  requires_approval?: boolean;
}

export interface ExtensionTriggerInfo {
  name: string;
  description?: string;
  type: 'schedule' | 'event';
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface ExtensionRequiredService {
  name: string;
  display_name: string;
  description?: string;
  category?: string;
  docs_url?: string;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  category: string;
  icon?: string;
  authorName?: string;
  status: 'enabled' | 'disabled' | 'error';
  sourcePath?: string;
  errorMessage?: string;
  toolCount: number;
  triggerCount: number;
  installedAt: string;
  updatedAt: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    format?: 'ownpilot' | 'agentskills';
    tools: ExtensionToolInfo[];
    triggers?: ExtensionTriggerInfo[];
    required_services?: ExtensionRequiredService[];
    system_prompt?: string;
    instructions?: string;
    tags?: string[];
    keywords?: string[];
    docs?: string;
    author?: { name: string; email?: string; url?: string };
    license?: string;
    compatibility?: string;
    allowed_tools?: string[];
    script_paths?: string[];
    reference_paths?: string[];
    _security?: {
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
      blocked: boolean;
      warnings: string[];
      undeclaredTools: string[];
      auditedAt: number;
    };
  };
}

// ---- Config Services ----

export interface RequiredByEntry {
  type: 'tool' | 'plugin';
  name: string;
  id: string;
}

export interface ConfigEntryView {
  id: string;
  serviceName: string;
  label: string;
  data: Record<string, unknown>;
  isDefault: boolean;
  isActive: boolean;
  hasSecrets: boolean;
  secretFields: string[];
}

export interface ConfigServiceView {
  id: string;
  name: string;
  displayName: string;
  category: string;
  description: string | null;
  docsUrl: string | null;
  configSchema: ConfigFieldDefinition[];
  multiEntry: boolean;
  requiredBy: RequiredByEntry[];
  isActive: boolean;
  isConfigured: boolean;
  entryCount: number;
  entries: ConfigEntryView[];
}

export interface ConfigServiceStats {
  total: number;
  configured: number;
  active: number;
  categories: string[];
  neededByTools: number;
  neededButUnconfigured: number;
}
