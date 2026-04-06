/**
 * Workflow Hooks Service
 *
 * Lifecycle hooks for workflow execution.
 * Fire-and-forget hook execution with in-memory caching.
 */

import { randomUUID } from 'node:crypto';
import { getEventSystem } from '@ownpilot/core';
import type {
  IWorkflowHooksService,
  WorkflowHookConfig,
  WorkflowHookContext,
  WorkflowHookType,
} from '@ownpilot/core';
import { getAdapterSync } from '../db/adapters/index.js';
import { getLog } from './log.js';

const log = getLog('WorkflowHooksService');
const hookLog = getLog('WorkflowHook');

const TABLE = 'workflow_hook_configs';
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  hooks: WorkflowHookConfig[];
  expiresAt: number;
}

function rowToConfig(row: Record<string, unknown>): WorkflowHookConfig {
  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    hookType: row.hook_type as WorkflowHookType,
    enabled: row.enabled as boolean,
    config: (row.config ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

class WorkflowHooksService implements IWorkflowHooksService {
  private hookCache = new Map<string, CacheEntry>();

  // ── fire ────────────────────────────────────────────────

  async fire(context: WorkflowHookContext): Promise<void> {
    let hooks: WorkflowHookConfig[];
    try {
      hooks = await this.getEnabledHooksCached(context.workflowId);
    } catch (err) {
      log.error(`Failed to load hooks for workflow ${context.workflowId}`, err);
      return;
    }

    for (const hook of hooks) {
      try {
        this.executeHook(hook, context);
      } catch (err) {
        log.error(`Hook ${hook.id} (${hook.hookType}) failed`, err);
      }
    }
  }

  // ── getHooks ────────────────────────────────────────────

  async getHooks(workflowId: string): Promise<WorkflowHookConfig[]> {
    const rows = await getAdapterSync().query(
      `SELECT * FROM ${TABLE} WHERE workflow_id = ? ORDER BY created_at`,
      [workflowId],
    );
    return rows.map(rowToConfig);
  }

  // ── upsertHook ──────────────────────────────────────────

  async upsertHook(
    workflowId: string,
    hookType: WorkflowHookType,
    config: Record<string, unknown>,
    enabled = true,
  ): Promise<WorkflowHookConfig> {
    const now = new Date().toISOString();

    // Check for existing hook of same type for this workflow
    const existing = await getAdapterSync().queryOne<{ id: string }>(
      `SELECT id FROM ${TABLE} WHERE workflow_id = ? AND hook_type = ? LIMIT 1`,
      [workflowId, hookType],
    );

    let id: string;
    if (existing) {
      id = existing.id;
      await getAdapterSync().execute(
        `UPDATE ${TABLE} SET config = ?, enabled = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(config), enabled, now, id],
      );
    } else {
      id = randomUUID();
      await getAdapterSync().execute(
        `INSERT INTO ${TABLE} (id, workflow_id, hook_type, enabled, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, workflowId, hookType, enabled, JSON.stringify(config), now, now],
      );
    }

    this.invalidateCache(workflowId);

    const row = await getAdapterSync().queryOne(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
    return rowToConfig(row!);
  }

  // ── deleteHook ──────────────────────────────────────────

  async deleteHook(hookId: string): Promise<void> {
    const rows = await getAdapterSync().query<{ workflow_id: string }>(
      `DELETE FROM ${TABLE} WHERE id = ? RETURNING workflow_id`,
      [hookId],
    );
    if (rows.length > 0) {
      this.invalidateCache(rows[0]!.workflow_id);
    }
  }

  // ── toggleHook ──────────────────────────────────────────

  async toggleHook(hookId: string, enabled: boolean): Promise<WorkflowHookConfig> {
    const now = new Date().toISOString();
    const row = await getAdapterSync().queryOne(
      `UPDATE ${TABLE} SET enabled = ?, updated_at = ? WHERE id = ? RETURNING *`,
      [enabled, now, hookId],
    );
    if (!row) {
      throw new Error(`Hook ${hookId} not found`);
    }
    this.invalidateCache((row as Record<string, unknown>).workflow_id as string);
    return rowToConfig(row as Record<string, unknown>);
  }

  // ── private helpers ─────────────────────────────────────

  private async getEnabledHooksCached(workflowId: string): Promise<WorkflowHookConfig[]> {
    const cached = this.hookCache.get(workflowId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hooks;
    }

    const rows = await getAdapterSync().query(
      `SELECT * FROM ${TABLE} WHERE workflow_id = ? AND enabled = true`,
      [workflowId],
    );
    const hooks = rows.map(rowToConfig);
    this.hookCache.set(workflowId, { hooks, expiresAt: Date.now() + CACHE_TTL_MS });
    return hooks;
  }

  private invalidateCache(workflowId: string): void {
    this.hookCache.delete(workflowId);
  }

  private executeHook(hook: WorkflowHookConfig, context: WorkflowHookContext): void {
    switch (hook.hookType) {
      case 'logging':
        this.handleLogging(context);
        break;
      case 'metrics':
        this.handleMetrics(context);
        break;
      case 'notification':
        this.handleNotification(hook, context);
        break;
      case 'webhook':
        this.handleWebhook(hook, context);
        break;
      case 'custom':
        this.handleCustom(context);
        break;
    }
  }

  private handleLogging(ctx: WorkflowHookContext): void {
    const parts = [`[${ctx.workflowName}]`, ctx.event];
    if (ctx.nodeLabel) parts.push(ctx.nodeLabel);
    if (ctx.durationMs != null) parts.push(`${ctx.durationMs}ms`);
    hookLog.info(parts.join(' '));
  }

  private handleMetrics(ctx: WorkflowHookContext): void {
    try {
      getEventSystem().emit('workflow.hook' as never, 'workflow-hooks', ctx as never);
    } catch (err) {
      log.error('Metrics emit failed: %s', err);
    }
  }

  private handleNotification(hook: WorkflowHookConfig, ctx: WorkflowHookContext): void {
    import('./notification-router.js')
      .then(({ getNotificationRouter }) => {
        const router = getNotificationRouter();
        return router.notify('system', {
          title: `Workflow: ${ctx.workflowName}`,
          body: `${ctx.event}${ctx.nodeLabel ? ` — ${ctx.nodeLabel}` : ''}`,
          priority: ctx.event === 'node_error' ? 'high' : 'normal',
          ...(hook.config as Record<string, unknown>),
        } as never);
      })
      .catch((err) => {
        log.warn('Notification hook skipped: %s', err);
      });
  }

  private handleWebhook(hook: WorkflowHookConfig, ctx: WorkflowHookContext): void {
    const url = hook.config.url as string | undefined;
    if (!url) {
      log.warn('Webhook hook %s has no url configured', hook.id);
      return;
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
      signal: AbortSignal.timeout(5_000),
    }).catch((err) => {
      log.error(`Webhook POST to ${url} failed`, err);
    });
  }

  private handleCustom(ctx: WorkflowHookContext): void {
    try {
      getEventSystem().emit('workflow.hook.custom' as never, 'workflow-hooks', ctx as never);
    } catch (err) {
      log.error('Custom hook emit failed: %s', err);
    }
  }
}

// ── singleton ───────────────────────────────────────────

let _instance: WorkflowHooksService | null = null;

export function getWorkflowHooksService(): IWorkflowHooksService {
  if (!_instance) {
    _instance = new WorkflowHooksService();
  }
  return _instance;
}
