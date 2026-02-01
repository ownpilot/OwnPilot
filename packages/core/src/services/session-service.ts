/**
 * ISessionService - Unified Session Management
 *
 * A "session" represents any interaction context — whether from
 * web UI, API call, Telegram conversation, scheduled task, or system process.
 *
 * This replaces the separate WebSocket SessionManager and ChannelSessionsRepository
 * with a unified concept where session source is just metadata.
 *
 * Usage:
 *   const sessions = registry.get(Services.Session);
 *   const session = sessions.getOrCreate({
 *     userId: 'default',
 *     source: 'channel',
 *     channelPluginId: 'channel.telegram',
 *     platformChatId: '12345',
 *   });
 *   sessions.linkConversation(session.id, conversationId);
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Where the session originated from.
 */
export type SessionSource = 'web' | 'api' | 'channel' | 'scheduler' | 'system';

/**
 * Unified session representing any interaction context.
 */
export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly source: SessionSource;

  /** Linked OwnPilot conversation (set after first message) */
  conversationId: string | null;

  /** Channel plugin ID (only for channel sessions) */
  readonly channelPluginId?: string;

  /** Platform-specific chat ID (only for channel sessions) */
  readonly platformChatId?: string;

  /** Whether the session is currently active */
  readonly isActive: boolean;

  /** Arbitrary session metadata */
  readonly metadata: Record<string, unknown>;

  readonly createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Input for creating a new session.
 */
export interface CreateSessionInput {
  userId: string;
  source: SessionSource;
  channelPluginId?: string;
  platformChatId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface ISessionService {
  /**
   * Create a new session.
   */
  create(input: CreateSessionInput): Session;

  /**
   * Get a session by ID. Returns null if not found or inactive.
   */
  get(sessionId: string): Session | null;

  /**
   * Get or create a session. For channel sessions, matches by
   * (userId, channelPluginId, platformChatId). For others, always creates new.
   */
  getOrCreate(input: CreateSessionInput): Session;

  /**
   * Update session's lastActivityAt timestamp.
   */
  touch(sessionId: string): void;

  /**
   * Link a session to an OwnPilot conversation.
   */
  linkConversation(sessionId: string, conversationId: string): void;

  /**
   * Set a metadata value on a session.
   */
  setMetadata(sessionId: string, key: string, value: unknown): void;

  /**
   * Close/deactivate a session.
   */
  close(sessionId: string): void;

  /**
   * Get all active sessions for a user.
   */
  getByUser(userId: string): Session[];

  /**
   * Find an active channel session by plugin + chat ID.
   * Returns null if no active session exists.
   */
  getByChannel(channelPluginId: string, platformChatId: string): Session | null;

  /**
   * Get all active sessions.
   */
  getActiveSessions(): Session[];

  /**
   * Get session count by source type.
   */
  getStats(): Record<SessionSource, number>;
}
