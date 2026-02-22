/**
 * Pomodoro Repository
 *
 * CRUD operations for pomodoro timer sessions, settings, and stats
 */

import { BaseRepository } from './base.js';
import { MS_PER_DAY } from '../../config/defaults.js';

// =============================================================================
// Types
// =============================================================================

export type SessionType = 'work' | 'short_break' | 'long_break';
export type SessionStatus = 'running' | 'completed' | 'interrupted';

export interface PomodoroSession {
  id: string;
  userId: string;
  type: SessionType;
  status: SessionStatus;
  taskDescription?: string;
  durationMinutes: number;
  startedAt: Date;
  completedAt?: Date;
  interruptedAt?: Date;
  interruptionReason?: string;
}

export interface PomodoroSettings {
  userId: string;
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
  updatedAt: Date;
}

export interface PomodoroDailyStats {
  id: string;
  userId: string;
  date: string;
  completedSessions: number;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  interruptions: number;
}

export interface CreateSessionInput {
  type: SessionType;
  taskDescription?: string;
  durationMinutes: number;
}

export interface UpdateSettingsInput {
  workDuration?: number;
  shortBreakDuration?: number;
  longBreakDuration?: number;
  sessionsBeforeLongBreak?: number;
  autoStartBreaks?: boolean;
  autoStartWork?: boolean;
}

// =============================================================================
// Row Interfaces
// =============================================================================

interface SessionRow {
  id: string;
  user_id: string;
  type: string;
  status: string;
  task_description: string | null;
  duration_minutes: number;
  started_at: string;
  completed_at: string | null;
  interrupted_at: string | null;
  interruption_reason: string | null;
}

interface SettingsRow {
  user_id: string;
  work_duration: number;
  short_break_duration: number;
  long_break_duration: number;
  sessions_before_long_break: number;
  auto_start_breaks: boolean;
  auto_start_work: boolean;
  updated_at: string;
}

interface DailyStatsRow {
  id: string;
  user_id: string;
  date: string;
  completed_sessions: number;
  total_work_minutes: number;
  total_break_minutes: number;
  interruptions: number;
}

// =============================================================================
// Row Converters
// =============================================================================

function rowToSession(row: SessionRow): PomodoroSession {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as SessionType,
    status: row.status as SessionStatus,
    taskDescription: row.task_description ?? undefined,
    durationMinutes: row.duration_minutes,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    interruptedAt: row.interrupted_at ? new Date(row.interrupted_at) : undefined,
    interruptionReason: row.interruption_reason ?? undefined,
  };
}

function rowToSettings(row: SettingsRow): PomodoroSettings {
  return {
    userId: row.user_id,
    workDuration: row.work_duration,
    shortBreakDuration: row.short_break_duration,
    longBreakDuration: row.long_break_duration,
    sessionsBeforeLongBreak: row.sessions_before_long_break,
    autoStartBreaks: row.auto_start_breaks,
    autoStartWork: row.auto_start_work,
    updatedAt: new Date(row.updated_at),
  };
}

function rowToDailyStats(row: DailyStatsRow): PomodoroDailyStats {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    completedSessions: row.completed_sessions,
    totalWorkMinutes: row.total_work_minutes,
    totalBreakMinutes: row.total_break_minutes,
    interruptions: row.interruptions,
  };
}

// =============================================================================
// Repository
// =============================================================================

export class PomodoroRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async startSession(input: CreateSessionInput): Promise<PomodoroSession> {
    const id = `pom_${Date.now()}`;
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO pomodoro_sessions (id, user_id, type, status, task_description, duration_minutes, started_at)
       VALUES ($1, $2, $3, 'running', $4, $5, $6)`,
      [id, this.userId, input.type, input.taskDescription ?? null, input.durationMinutes, now]
    );

    const session = await this.getSession(id);
    if (!session) throw new Error('Failed to create pomodoro session');
    return session;
  }

  async getSession(id: string): Promise<PomodoroSession | null> {
    const row = await this.queryOne<SessionRow>(
      `SELECT * FROM pomodoro_sessions WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );

    return row ? rowToSession(row) : null;
  }

  async getActiveSession(): Promise<PomodoroSession | null> {
    const row = await this.queryOne<SessionRow>(
      `SELECT * FROM pomodoro_sessions WHERE user_id = $1 AND status = 'running'
       ORDER BY started_at DESC LIMIT 1`,
      [this.userId]
    );

    return row ? rowToSession(row) : null;
  }

  async completeSession(id: string): Promise<PomodoroSession | null> {
    const session = await this.getSession(id);
    if (!session || session.status !== 'running') return null;

    const now = new Date().toISOString();

    await this.execute(
      `UPDATE pomodoro_sessions SET status = 'completed', completed_at = $1 WHERE id = $2 AND user_id = $3`,
      [now, id, this.userId]
    );

    // Update daily stats
    await this.updateDailyStats(session.type, session.durationMinutes, false);

    return this.getSession(id);
  }

  async interruptSession(id: string, reason?: string): Promise<PomodoroSession | null> {
    const session = await this.getSession(id);
    if (!session || session.status !== 'running') return null;

    const now = new Date().toISOString();

    await this.execute(
      `UPDATE pomodoro_sessions SET status = 'interrupted', interrupted_at = $1, interruption_reason = $2
       WHERE id = $3 AND user_id = $4`,
      [now, reason ?? null, id, this.userId]
    );

    // Update daily stats for interruption
    await this.updateDailyStats(session.type, 0, true);

    return this.getSession(id);
  }

  async listSessions(
    options: { limit?: number; type?: SessionType; status?: SessionStatus } = {}
  ): Promise<PomodoroSession[]> {
    let sql = `SELECT * FROM pomodoro_sessions WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (options.type) {
      sql += ` AND type = $${paramIndex++}`;
      params.push(options.type);
    }

    if (options.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(options.status);
    }

    sql += ` ORDER BY started_at DESC`;

    if (options.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }

    const rows = await this.query<SessionRow>(sql, params);
    return rows.map(rowToSession);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async getSettings(): Promise<PomodoroSettings> {
    const row = await this.queryOne<SettingsRow>(
      `SELECT * FROM pomodoro_settings WHERE user_id = $1`,
      [this.userId]
    );

    if (!row) {
      // Create default settings
      return this.createDefaultSettings();
    }

    return rowToSettings(row);
  }

  private async createDefaultSettings(): Promise<PomodoroSettings> {
    await this.execute(
      `INSERT INTO pomodoro_settings (user_id, updated_at)
       VALUES ($1, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [this.userId]
    );

    return this.getSettings();
  }

  async updateSettings(input: UpdateSettingsInput): Promise<PomodoroSettings> {
    // Ensure settings exist
    await this.getSettings();

    await this.execute(
      `UPDATE pomodoro_settings SET
        work_duration = COALESCE($1, work_duration),
        short_break_duration = COALESCE($2, short_break_duration),
        long_break_duration = COALESCE($3, long_break_duration),
        sessions_before_long_break = COALESCE($4, sessions_before_long_break),
        auto_start_breaks = COALESCE($5, auto_start_breaks),
        auto_start_work = COALESCE($6, auto_start_work),
        updated_at = NOW()
       WHERE user_id = $7`,
      [
        input.workDuration ?? null,
        input.shortBreakDuration ?? null,
        input.longBreakDuration ?? null,
        input.sessionsBeforeLongBreak ?? null,
        input.autoStartBreaks ?? null,
        input.autoStartWork ?? null,
        this.userId,
      ]
    );

    return this.getSettings();
  }

  // ---------------------------------------------------------------------------
  // Daily Stats
  // ---------------------------------------------------------------------------

  private async updateDailyStats(
    sessionType: SessionType,
    minutes: number,
    isInterruption: boolean
  ): Promise<void> {
    const today: string = new Date().toISOString().split('T')[0]!;
    const id = `pds_${this.userId}_${today}`;

    // Try to get existing stats
    const existing = await this.queryOne<DailyStatsRow>(
      `SELECT * FROM pomodoro_daily_stats WHERE user_id = $1 AND date = $2`,
      [this.userId, today]
    );

    if (existing) {
      // Update existing
      if (isInterruption) {
        await this.execute(
          `UPDATE pomodoro_daily_stats SET interruptions = interruptions + 1
           WHERE user_id = $1 AND date = $2`,
          [this.userId, today]
        );
      } else if (sessionType === 'work') {
        await this.execute(
          `UPDATE pomodoro_daily_stats SET completed_sessions = completed_sessions + 1, total_work_minutes = total_work_minutes + $1
           WHERE user_id = $2 AND date = $3`,
          [minutes, this.userId, today]
        );
      } else {
        await this.execute(
          `UPDATE pomodoro_daily_stats SET total_break_minutes = total_break_minutes + $1
           WHERE user_id = $2 AND date = $3`,
          [minutes, this.userId, today]
        );
      }
    } else {
      // Insert new
      await this.execute(
        `INSERT INTO pomodoro_daily_stats (id, user_id, date, completed_sessions, total_work_minutes, total_break_minutes, interruptions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          this.userId,
          today,
          !isInterruption && sessionType === 'work' ? 1 : 0,
          sessionType === 'work' ? minutes : 0,
          sessionType !== 'work' ? minutes : 0,
          isInterruption ? 1 : 0,
        ]
      );
    }
  }

  async getDailyStats(date?: string): Promise<PomodoroDailyStats | null> {
    const targetDate: string = date ?? new Date().toISOString().split('T')[0]!;

    const row = await this.queryOne<DailyStatsRow>(
      `SELECT * FROM pomodoro_daily_stats WHERE user_id = $1 AND date = $2`,
      [this.userId, targetDate]
    );

    return row ? rowToDailyStats(row) : null;
  }

  async getStatsRange(startDate: string, endDate: string): Promise<PomodoroDailyStats[]> {
    const rows = await this.query<DailyStatsRow>(
      `SELECT * FROM pomodoro_daily_stats
       WHERE user_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date ASC`,
      [this.userId, startDate, endDate]
    );

    return rows.map(rowToDailyStats);
  }

  async getStreak(): Promise<number> {
    // Get consecutive days with at least one completed work session
    const rows = await this.query<DailyStatsRow>(
      `SELECT * FROM pomodoro_daily_stats
       WHERE user_id = $1 AND completed_sessions > 0
       ORDER BY date DESC`,
      [this.userId]
    );

    const stats = rows.map(rowToDailyStats);

    if (stats.length === 0) return 0;

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i]!;
      const statDate = new Date(stat.date);
      statDate.setHours(0, 0, 0, 0);

      const expectedDate = new Date(today);
      expectedDate.setDate(today.getDate() - streak);

      // Allow for today or yesterday to count as start
      if (i === 0) {
        const diffDays = Math.floor((today.getTime() - statDate.getTime()) / MS_PER_DAY);
        if (diffDays > 1) return 0; // Streak is broken
      }

      if (statDate.getTime() === expectedDate.getTime()) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  async getTotalStats(): Promise<{
    totalSessions: number;
    totalWorkMinutes: number;
    totalBreakMinutes: number;
    totalInterruptions: number;
    currentStreak: number;
    bestStreak: number;
  }> {
    const row = await this.queryOne<{
      total_sessions: number;
      total_work: number;
      total_break: number;
      total_interruptions: number;
    }>(
      `SELECT
        COALESCE(SUM(completed_sessions), 0) as total_sessions,
        COALESCE(SUM(total_work_minutes), 0) as total_work,
        COALESCE(SUM(total_break_minutes), 0) as total_break,
        COALESCE(SUM(interruptions), 0) as total_interruptions
       FROM pomodoro_daily_stats
       WHERE user_id = $1`,
      [this.userId]
    );

    const currentStreak = await this.getStreak();

    // Calculate best streak
    const allStatsRows = await this.query<DailyStatsRow>(
      `SELECT * FROM pomodoro_daily_stats
       WHERE user_id = $1 AND completed_sessions > 0
       ORDER BY date ASC`,
      [this.userId]
    );

    const allStats = allStatsRows.map(rowToDailyStats);

    let bestStreak = 0;
    let currentRun = 0;
    let lastDate: Date | null = null;

    for (const stat of allStats) {
      const statDate = new Date(stat.date);

      if (lastDate === null) {
        currentRun = 1;
      } else {
        const diffDays = Math.floor((statDate.getTime() - lastDate.getTime()) / MS_PER_DAY);
        if (diffDays === 1) {
          currentRun++;
        } else {
          currentRun = 1;
        }
      }

      if (currentRun > bestStreak) {
        bestStreak = currentRun;
      }

      lastDate = statDate;
    }

    return {
      totalSessions: row?.total_sessions ?? 0,
      totalWorkMinutes: row?.total_work ?? 0,
      totalBreakMinutes: row?.total_break ?? 0,
      totalInterruptions: row?.total_interruptions ?? 0,
      currentStreak,
      bestStreak,
    };
  }
}

export const pomodoroRepo = new PomodoroRepository();

// Factory function
export function createPomodoroRepository(userId = 'default'): PomodoroRepository {
  return new PomodoroRepository(userId);
}
