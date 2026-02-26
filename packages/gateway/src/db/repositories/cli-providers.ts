/**
 * CLI Providers Repository
 *
 * User-registered CLI tools that can be used as coding agent providers.
 * Enables extensible tool orchestration beyond the built-in providers.
 */

import { BaseRepository, parseJsonField, parseBool } from './base.js';

// =============================================================================
// ROW TYPE
// =============================================================================

interface CliProviderRow {
  id: string;
  user_id: string;
  name: string;
  display_name: string;
  description: string | null;
  binary: string;
  category: string;
  icon: string | null;
  color: string | null;
  auth_method: string;
  config_service_name: string | null;
  api_key_env_var: string | null;
  default_args: string | null; // JSONB
  prompt_template: string | null;
  output_format: string | null;
  default_timeout_ms: number;
  max_timeout_ms: number;
  is_active: number | boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type CliAuthMethod = 'none' | 'config_center' | 'env_var';
export type CliOutputFormat = 'text' | 'json' | 'stream-json';

export interface CliProviderRecord {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  description?: string;
  binary: string;
  category: string;
  icon?: string;
  color?: string;
  authMethod: CliAuthMethod;
  configServiceName?: string;
  apiKeyEnvVar?: string;
  defaultArgs: string[];
  promptTemplate?: string;
  outputFormat: CliOutputFormat;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCliProviderInput {
  name: string;
  displayName: string;
  description?: string;
  binary: string;
  category?: string;
  icon?: string;
  color?: string;
  authMethod?: CliAuthMethod;
  configServiceName?: string;
  apiKeyEnvVar?: string;
  defaultArgs?: string[];
  promptTemplate?: string;
  outputFormat?: CliOutputFormat;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  userId?: string;
}

export interface UpdateCliProviderInput {
  name?: string;
  displayName?: string;
  description?: string;
  binary?: string;
  category?: string;
  icon?: string;
  color?: string;
  authMethod?: CliAuthMethod;
  configServiceName?: string;
  apiKeyEnvVar?: string;
  defaultArgs?: string[];
  promptTemplate?: string;
  outputFormat?: CliOutputFormat;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  isActive?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToRecord(row: CliProviderRow): CliProviderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    displayName: row.display_name,
    description: row.description ?? undefined,
    binary: row.binary,
    category: row.category,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    authMethod: row.auth_method as CliAuthMethod,
    configServiceName: row.config_service_name ?? undefined,
    apiKeyEnvVar: row.api_key_env_var ?? undefined,
    defaultArgs: parseJsonField<string[]>(row.default_args, []),
    promptTemplate: row.prompt_template ?? undefined,
    outputFormat: (row.output_format ?? 'text') as CliOutputFormat,
    defaultTimeoutMs: Number(row.default_timeout_ms),
    maxTimeoutMs: Number(row.max_timeout_ms),
    isActive: parseBool(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class CliProvidersRepository extends BaseRepository {
  async create(input: CreateCliProviderInput): Promise<CliProviderRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const userId = input.userId ?? 'default';

    await this.execute(
      `INSERT INTO cli_providers (
        id, user_id, name, display_name, description, binary, category,
        icon, color, auth_method, config_service_name, api_key_env_var,
        default_args, prompt_template, output_format,
        default_timeout_ms, max_timeout_ms, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        id,
        userId,
        input.name,
        input.displayName,
        input.description ?? null,
        input.binary,
        input.category ?? 'general',
        input.icon ?? null,
        input.color ?? null,
        input.authMethod ?? 'none',
        input.configServiceName ?? null,
        input.apiKeyEnvVar ?? null,
        JSON.stringify(input.defaultArgs ?? []),
        input.promptTemplate ?? null,
        input.outputFormat ?? 'text',
        input.defaultTimeoutMs ?? 300000,
        input.maxTimeoutMs ?? 1800000,
        true,
        now,
        now,
      ]
    );

    const record = await this.getById(id);
    if (!record) throw new Error('Failed to create CLI provider');
    return record;
  }

  async getById(id: string): Promise<CliProviderRecord | null> {
    const row = await this.queryOne<CliProviderRow>(
      'SELECT * FROM cli_providers WHERE id = $1',
      [id]
    );
    return row ? rowToRecord(row) : null;
  }

  async getByName(name: string, userId = 'default'): Promise<CliProviderRecord | null> {
    const row = await this.queryOne<CliProviderRow>(
      'SELECT * FROM cli_providers WHERE name = $1 AND user_id = $2',
      [name, userId]
    );
    return row ? rowToRecord(row) : null;
  }

  async list(userId = 'default'): Promise<CliProviderRecord[]> {
    const rows = await this.query<CliProviderRow>(
      'SELECT * FROM cli_providers WHERE user_id = $1 ORDER BY display_name',
      [userId]
    );
    return rows.map(rowToRecord);
  }

  async listActive(userId = 'default'): Promise<CliProviderRecord[]> {
    const rows = await this.query<CliProviderRow>(
      'SELECT * FROM cli_providers WHERE user_id = $1 AND is_active = TRUE ORDER BY display_name',
      [userId]
    );
    return rows.map(rowToRecord);
  }

  async update(id: string, input: UpdateCliProviderInput): Promise<CliProviderRecord | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const addField = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIdx++}`);
      values.push(value);
    };

    if (input.name !== undefined) addField('name', input.name);
    if (input.displayName !== undefined) addField('display_name', input.displayName);
    if (input.description !== undefined) addField('description', input.description);
    if (input.binary !== undefined) addField('binary', input.binary);
    if (input.category !== undefined) addField('category', input.category);
    if (input.icon !== undefined) addField('icon', input.icon);
    if (input.color !== undefined) addField('color', input.color);
    if (input.authMethod !== undefined) addField('auth_method', input.authMethod);
    if (input.configServiceName !== undefined) addField('config_service_name', input.configServiceName);
    if (input.apiKeyEnvVar !== undefined) addField('api_key_env_var', input.apiKeyEnvVar);
    if (input.defaultArgs !== undefined) addField('default_args', JSON.stringify(input.defaultArgs));
    if (input.promptTemplate !== undefined) addField('prompt_template', input.promptTemplate);
    if (input.outputFormat !== undefined) addField('output_format', input.outputFormat);
    if (input.defaultTimeoutMs !== undefined) addField('default_timeout_ms', input.defaultTimeoutMs);
    if (input.maxTimeoutMs !== undefined) addField('max_timeout_ms', input.maxTimeoutMs);
    if (input.isActive !== undefined) addField('is_active', input.isActive);

    if (setClauses.length === 0) return existing;

    addField('updated_at', new Date().toISOString());
    values.push(id);

    await this.execute(
      `UPDATE cli_providers SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      values
    );

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM cli_providers WHERE id = $1', [id]);
    return (result?.changes ?? 0) > 0;
  }

  async count(userId = 'default'): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM cli_providers WHERE user_id = $1',
      [userId]
    );
    return parseInt(row?.count ?? '0', 10);
  }
}

// =============================================================================
// SINGLETON & FACTORY
// =============================================================================

export const cliProvidersRepo = new CliProvidersRepository();

export function createCliProvidersRepository(): CliProvidersRepository {
  return new CliProvidersRepository();
}
