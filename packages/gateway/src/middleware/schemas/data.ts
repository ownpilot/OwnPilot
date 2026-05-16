/**
 * User-data and workspace schemas — anything that holds the user's content.
 *
 *  - custom data tables  (createCustomTable, updateCustomTable,
 *                         createCustomRecord, updateCustomRecord)
 *  - workspaces          (createWorkspace, updateWorkspace, toggleEnabled)
 *  - workspace files     (workspaceWriteFile, workspaceExecuteCode)
 *  - profile             (set/delete/import/quickSetup)
 */

import { z } from 'zod';

// ─── Custom data tables ──────────────────────────────────────────

const columnDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['text', 'number', 'boolean', 'date', 'datetime', 'json']),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  description: z.string().max(500).optional(),
});

export const createCustomTableSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  columns: z.array(columnDefinitionSchema).min(1).max(100),
});

export const updateCustomTableSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  columns: z.array(columnDefinitionSchema).min(1).max(100).optional(),
});

export const createCustomRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export const updateCustomRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

// ─── Workspaces ──────────────────────────────────────────────────

const containerConfigSchema = z.object({
  memoryMB: z.number().min(64).max(2048).optional(),
  cpuCores: z.number().min(0.25).max(4).optional(),
  storageGB: z.number().min(1).max(10).optional(),
  timeoutMs: z.number().min(5000).max(120000).optional(),
  networkPolicy: z.enum(['none', 'restricted', 'full']).optional(),
  allowedHosts: z.array(z.string().max(500)).max(50).optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  containerConfig: containerConfigSchema.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  containerConfig: containerConfigSchema.optional(),
});

export const toggleEnabledSchema = z.object({
  enabled: z.boolean(),
});

// ─── Workspace files & code execution ────────────────────────────

export const workspaceWriteFileSchema = z.object({
  content: z.string().max(10_000_000),
});

export const workspaceExecuteCodeSchema = z.object({
  code: z.string().min(1).max(100000),
  language: z.enum(['python', 'javascript', 'shell']),
  timeout: z.number().int().min(1000).max(120000).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        content: z.string().max(1000000),
      })
    )
    .max(50)
    .optional(),
});

// ─── Profile ─────────────────────────────────────────────────────

export const profileSetDataSchema = z.object({
  category: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  value: z.unknown(),
  data: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(['user_stated', 'user_confirmed', 'ai_inferred', 'imported']).optional(),
  sensitive: z.boolean().optional(),
});

export const profileDeleteDataSchema = z.object({
  category: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
});

export const profileImportSchema = z.object({
  entries: z.array(z.record(z.string(), z.unknown())).min(1).max(10000),
});

export const profileQuickSetupSchema = z.object({
  name: z.string().max(200).optional(),
  nickname: z.string().max(200).optional(),
  location: z.string().max(500).optional(),
  timezone: z.string().max(100).optional(),
  occupation: z.string().max(500).optional(),
  language: z.string().max(100).optional(),
  communicationStyle: z.string().max(200).optional(),
  autonomyLevel: z.string().max(100).optional(),
});
