/**
 * Pomodoro Repository
 *
 * CRUD operations for pomodoro timer sessions, settings, and stats
 */

import { getDatabase } from '../connection.js';

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
  auto_start_breaks: number;
  auto_start_work: number;
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
    autoStartBreaks: row.auto_start_breaks === 1,
    autoStartWork: row.auto_start_work === 1,
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

export class PomodoroRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  startSession(input: CreateSessionInput): PomodoroSession {
    const id = `pom_${Date.now()}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO pomodoro_sessions (id, user_id, type, status, task_description, duration_minutes, started_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?)
    `);

    stmt.run(id, this.userId, input.type, input.taskDescription ?? null, input.durationMinutes, now);

    return this.getSession(id)!;
  }

  getSession(id: string): PomodoroSession | null {
    const stmt = this.db.prepare<[string, string], SessionRow>(`
      SELECT * FROM pomodoro_sessions WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToSession(row) : null;
  }

  getActiveSession(): PomodoroSession | null {
    const stmt = this.db.prepare<[string], SessionRow>(`
      SELECT * FROM pomodoro_sessions WHERE user_id = ? AND status = 'running'
      ORDER BY started_at DESC LIMIT 1
    `);

    const row = stmt.get(this.userId);
    return row ? rowToSession(row) : null;
  }

  completeSession(id: string): PomodoroSession | null {
    const session = this.getSession(id);
    if (!session || session.status !== 'running') return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE pomodoro_sessions SET status = 'completed', completed_at = ? WHERE id = ? AND user_id = ?
    `);

    stmt.run(now, id, this.userId);

    // Update daily stats
    this.updateDailyStats(session.type, session.durationMinutes, false);

    return this.getSession(id);
  }

  interruptSession(id: string, reason?: string): PomodoroSession | null {
    const session = this.getSession(id);
    if (!session || session.status !== 'running') return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE pomodoro_sessions SET status = 'interrupted', interrupted_at = ?, interruption_reason = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(now, reason ?? null, id, this.userId);

    // Update daily stats for interruption
    this.updateDailyStats(session.type, 0, true);

    return this.getSession(id);
  }

  listSessions(options: { limit?: number; type?: SessionType; status?: SessionStatus } = {}): PomodoroSession[] {
    let sql = `SELECT * FROM pomodoro_sessions WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (options.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }

    if (options.status) {
      sql += ` AND status = ?`;
      params.push(options.status);
    }

    sql += ` ORDER BY started_at DESC`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const stmt = this.db.prepare<unknown[], SessionRow>(sql);
    return stmt.all(...params).map(rowToSession);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  getSettings(): PomodoroSettings {
    const stmt = this.db.prepare<[string], SettingsRow>(`
      SELECT * FROM pomodoro_settings WHERE user_id = ?
    `);

    const row = stmt.get(this.userId);

    if (!row) {
      // Create default settings
      return this.createDefaultSettings();
    }

    return rowToSettings(row);
  }

  private createDefaultSettings(): PomodoroSettings {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO pomodoro_settings (user_id, updated_at)
      VALUES (?, ?)
    `);

    stmt.run(this.userId, now);
    return this.getSettings();
  }

  updateSettings(input: UpdateSettingsInput): PomodoroSettings {
    // Ensure settings exist
    this.getSettings();

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE pomodoro_settings SET
        work_duration = COALESCE(?, work_duration),
        short_break_duration = COALESCE(?, short_break_duration),
        long_break_duration = COALESCE(?, long_break_duration),
        sessions_before_long_break = COALESCE(?, sessions_before_long_break),
        auto_start_breaks = COALESCE(?, auto_start_breaks),
        auto_start_work = COALESCE(?, auto_start_work),
        updated_at = ?
      WHERE user_id = ?
    `);

    stmt.run(
      input.workDuration ?? null,
      input.shortBreakDuration ?? null,
      input.longBreakDuration ?? null,
      input.sessionsBeforeLongBreak ?? null,
      input.autoStartBreaks !== undefined ? (input.autoStartBreaks ? 1 : 0) : null,
      input.autoStartWork !== undefined ? (input.autoStartWork ? 1 : 0) : null,
      now,
      this.userId
    );

    return this.getSettings();
  }

  // ---------------------------------------------------------------------------
  // Daily Stats
  // ---------------------------------------------------------------------------

  private updateDailyStats(sessionType: SessionType, minutes: number, isInterruption: boolean): void {
    const today: string = new Date().toISOString().split('T')[0]!;
    const id = `pds_${this.userId}_${today}`;

    // Try to get existing stats
    const existingStmt = this.db.prepare<[string, string], DailyStatsRow>(`
      SELECT * FROM pomodoro_daily_stats WHERE user_id = ? AND date = ?
    `);

    const existing = existingStmt.get(this.userId, today);

    if (existing) {
      // Update existing
      let updateSql = `UPDATE pomodoro_daily_stats SET `;
      const params: unknown[] = [];

      if (isInterruption) {
        updateSql += `interruptions = interruptions + 1`;
      } else if (sessionType === 'work') {
        updateSql += `completed_sessions = completed_sessions + 1, total_work_minutes = total_work_minutes + ?`;
        params.push(minutes);
      } else {
        updateSql += `total_break_minutes = total_break_minutes + ?`;
        params.push(minutes);
      }

      updateSql += ` WHERE user_id = ? AND date = ?`;
      params.push(this.userId, today);

      this.db.prepare(updateSql).run(...params);
    } else {
      // Insert new
      const stmt = this.db.prepare(`
        INSERT INTO pomodoro_daily_stats (id, user_id, date, completed_sessions, total_work_minutes, total_break_minutes, interruptions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        this.userId,
        today,
        !isInterruption && sessionType === 'work' ? 1 : 0,
        sessionType === 'work' ? minutes : 0,
        sessionType !== 'work' ? minutes : 0,
        isInterruption ? 1 : 0
      );
    }
  }

  getDailyStats(date?: string): PomodoroDailyStats | null {
    const targetDate: string = date ?? new Date().toISOString().split('T')[0]!;

    const stmt = this.db.prepare<[string, string], DailyStatsRow>(`
      SELECT * FROM pomodoro_daily_stats WHERE user_id = ? AND date = ?
    `);

    const row = stmt.get(this.userId, targetDate);
    return row ? rowToDailyStats(row) : null;
  }

  getStatsRange(startDate: string, endDate: string): PomodoroDailyStats[] {
    const stmt = this.db.prepare<[string, string, string], DailyStatsRow>(`
      SELECT * FROM pomodoro_daily_stats
      WHERE user_id = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `);

    return stmt.all(this.userId, startDate, endDate).map(rowToDailyStats);
  }

  getStreak(): number {
    // Get consecutive days with at least one completed work session
    const stmt = this.db.prepare<[string], DailyStatsRow>(`
      SELECT * FROM pomodoro_daily_stats
      WHERE user_id = ? AND completed_sessions > 0
      ORDER BY date DESC
    `);

    const stats = stmt.all(this.userId).map(rowToDailyStats);

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
        const diffDays = Math.floor((today.getTime() - statDate.getTime()) / (1000 * 60 * 60 * 24));
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

  getTotalStats(): {
    totalSessions: number;
    totalWorkMinutes: number;
    totalBreakMinutes: number;
    totalInterruptions: number;
    currentStreak: number;
    bestStreak: number;
  } {
    const stmt = this.db.prepare<[string], {
      total_sessions: number;
      total_work: number;
      total_break: number;
      total_interruptions: number;
    }>(`
      SELECT
        COALESCE(SUM(completed_sessions), 0) as total_sessions,
        COALESCE(SUM(total_work_minutes), 0) as total_work,
        COALESCE(SUM(total_break_minutes), 0) as total_break,
        COALESCE(SUM(interruptions), 0) as total_interruptions
      FROM pomodoro_daily_stats
      WHERE user_id = ?
    `);

    const row = stmt.get(this.userId)!;
    const currentStreak = this.getStreak();

    // Calculate best streak
    const allStats = this.db.prepare<[string], DailyStatsRow>(`
      SELECT * FROM pomodoro_daily_stats
      WHERE user_id = ? AND completed_sessions > 0
      ORDER BY date ASC
    `).all(this.userId).map(rowToDailyStats);

    let bestStreak = 0;
    let currentRun = 0;
    let lastDate: Date | null = null;

    for (const stat of allStats) {
      const statDate = new Date(stat.date);

      if (lastDate === null) {
        currentRun = 1;
      } else {
        const diffDays = Math.floor((statDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
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
      totalSessions: row.total_sessions,
      totalWorkMinutes: row.total_work,
      totalBreakMinutes: row.total_break,
      totalInterruptions: row.total_interruptions,
      currentStreak,
      bestStreak,
    };
  }
}

export const pomodoroRepo = new PomodoroRepository();
