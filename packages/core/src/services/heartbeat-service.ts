/**
 * IHeartbeatService - Heartbeat Management Interface
 *
 * Provides CRUD for heartbeat entries (NL-to-cron periodic tasks).
 * Each heartbeat owns one backing trigger and keeps it in sync.
 *
 * Usage:
 *   const heartbeats = registry.get(Services.Heartbeat);
 *   const list = await heartbeats.listHeartbeats(userId);
 */

// ============================================================================
// Types
// ============================================================================

export interface HeartbeatInfo {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly scheduleText: string;
  readonly cron: string;
  readonly taskDescription: string;
  readonly triggerId: string | null;
  readonly enabled: boolean;
  readonly tags: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateHeartbeatInput {
  scheduleText: string;
  taskDescription: string;
  name?: string;
  enabled?: boolean;
  tags?: string[];
}

export interface UpdateHeartbeatInput {
  scheduleText?: string;
  taskDescription?: string;
  name?: string;
  enabled?: boolean;
  tags?: string[];
}

// ============================================================================
// IHeartbeatService
// ============================================================================

export interface IHeartbeatService {
  createHeartbeat(userId: string, input: CreateHeartbeatInput): Promise<HeartbeatInfo>;
  getHeartbeat(userId: string, id: string): Promise<HeartbeatInfo | null>;
  listHeartbeats(
    userId: string,
    query?: { enabled?: boolean; limit?: number }
  ): Promise<HeartbeatInfo[]>;
  updateHeartbeat(
    userId: string,
    id: string,
    input: UpdateHeartbeatInput
  ): Promise<HeartbeatInfo | null>;
  deleteHeartbeat(userId: string, id: string): Promise<boolean>;
  enableHeartbeat(userId: string, id: string): Promise<HeartbeatInfo | null>;
  disableHeartbeat(userId: string, id: string): Promise<HeartbeatInfo | null>;
  importMarkdown(
    userId: string,
    markdown: string
  ): Promise<{
    created: number;
    errors: Array<{ scheduleText: string; error: string }>;
    heartbeats: HeartbeatInfo[];
  }>;
  exportMarkdown(userId: string): Promise<string>;
  countHeartbeats(userId: string, enabled?: boolean): Promise<number>;
}
