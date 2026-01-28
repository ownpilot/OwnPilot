/**
 * Habits Repository
 *
 * CRUD operations for habit tracking with streaks and statistics
 */

import { getDatabase } from '../connection.js';

// =============================================================================
// Types
// =============================================================================

export type HabitFrequency = 'daily' | 'weekly' | 'weekdays' | 'custom';

export interface Habit {
  id: string;
  userId: string;
  name: string;
  description?: string;
  frequency: HabitFrequency;
  targetDays: number[]; // 0-6 for Sunday-Saturday
  targetCount: number;
  unit?: string;
  category?: string;
  color?: string;
  icon?: string;
  reminderTime?: string;
  isArchived: boolean;
  streakCurrent: number;
  streakLongest: number;
  totalCompletions: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HabitLog {
  id: string;
  habitId: string;
  userId: string;
  date: string;
  count: number;
  notes?: string;
  loggedAt: Date;
}

export interface CreateHabitInput {
  name: string;
  description?: string;
  frequency?: HabitFrequency;
  targetDays?: number[];
  targetCount?: number;
  unit?: string;
  category?: string;
  color?: string;
  icon?: string;
  reminderTime?: string;
}

export interface UpdateHabitInput {
  name?: string;
  description?: string;
  frequency?: HabitFrequency;
  targetDays?: number[];
  targetCount?: number;
  unit?: string;
  category?: string;
  color?: string;
  icon?: string;
  reminderTime?: string;
  isArchived?: boolean;
}

export interface HabitQuery {
  category?: string;
  isArchived?: boolean;
  limit?: number;
}

export interface HabitWithTodayStatus extends Habit {
  completedToday: boolean;
  todayCount: number;
}

// =============================================================================
// Row Interfaces
// =============================================================================

interface HabitRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  frequency: string;
  target_days: string;
  target_count: number;
  unit: string | null;
  category: string | null;
  color: string | null;
  icon: string | null;
  reminder_time: string | null;
  is_archived: number;
  streak_current: number;
  streak_longest: number;
  total_completions: number;
  created_at: string;
  updated_at: string;
}

interface HabitLogRow {
  id: string;
  habit_id: string;
  user_id: string;
  date: string;
  count: number;
  notes: string | null;
  logged_at: string;
}

// =============================================================================
// Row Converters
// =============================================================================

function rowToHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    frequency: row.frequency as HabitFrequency,
    targetDays: JSON.parse(row.target_days || '[]'),
    targetCount: row.target_count,
    unit: row.unit ?? undefined,
    category: row.category ?? undefined,
    color: row.color ?? undefined,
    icon: row.icon ?? undefined,
    reminderTime: row.reminder_time ?? undefined,
    isArchived: row.is_archived === 1,
    streakCurrent: row.streak_current,
    streakLongest: row.streak_longest,
    totalCompletions: row.total_completions,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToHabitLog(row: HabitLogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    userId: row.user_id,
    date: row.date,
    count: row.count,
    notes: row.notes ?? undefined,
    loggedAt: new Date(row.logged_at),
  };
}

// =============================================================================
// Repository
// =============================================================================

export class HabitsRepository {
  private db = getDatabase();
  private userId: string;

  constructor(userId = 'default') {
    this.userId = userId;
  }

  // ---------------------------------------------------------------------------
  // Habits CRUD
  // ---------------------------------------------------------------------------

  create(input: CreateHabitInput): Habit {
    const id = `hab_${Date.now()}`;
    const now = new Date().toISOString();

    // Default target days based on frequency
    let targetDays = input.targetDays ?? [];
    if (!input.targetDays) {
      switch (input.frequency ?? 'daily') {
        case 'daily':
          targetDays = [0, 1, 2, 3, 4, 5, 6];
          break;
        case 'weekdays':
          targetDays = [1, 2, 3, 4, 5];
          break;
        case 'weekly':
          targetDays = [1]; // Monday by default
          break;
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO habits (id, user_id, name, description, frequency, target_days, target_count,
        unit, category, color, icon, reminder_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      this.userId,
      input.name,
      input.description ?? null,
      input.frequency ?? 'daily',
      JSON.stringify(targetDays),
      input.targetCount ?? 1,
      input.unit ?? null,
      input.category ?? null,
      input.color ?? null,
      input.icon ?? null,
      input.reminderTime ?? null,
      now,
      now
    );

    return this.get(id)!;
  }

  get(id: string): Habit | null {
    const stmt = this.db.prepare<[string, string], HabitRow>(`
      SELECT * FROM habits WHERE id = ? AND user_id = ?
    `);

    const row = stmt.get(id, this.userId);
    return row ? rowToHabit(row) : null;
  }

  update(id: string, input: UpdateHabitInput): Habit | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE habits SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        frequency = COALESCE(?, frequency),
        target_days = COALESCE(?, target_days),
        target_count = COALESCE(?, target_count),
        unit = COALESCE(?, unit),
        category = COALESCE(?, category),
        color = COALESCE(?, color),
        icon = COALESCE(?, icon),
        reminder_time = COALESCE(?, reminder_time),
        is_archived = COALESCE(?, is_archived),
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    stmt.run(
      input.name ?? null,
      input.description ?? null,
      input.frequency ?? null,
      input.targetDays ? JSON.stringify(input.targetDays) : null,
      input.targetCount ?? null,
      input.unit ?? null,
      input.category ?? null,
      input.color ?? null,
      input.icon ?? null,
      input.reminderTime ?? null,
      input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : null,
      now,
      id,
      this.userId
    );

    return this.get(id);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM habits WHERE id = ? AND user_id = ?`);
    const result = stmt.run(id, this.userId);
    return result.changes > 0;
  }

  archive(id: string): Habit | null {
    return this.update(id, { isArchived: true });
  }

  unarchive(id: string): Habit | null {
    return this.update(id, { isArchived: false });
  }

  list(query: HabitQuery = {}): Habit[] {
    let sql = `SELECT * FROM habits WHERE user_id = ?`;
    const params: unknown[] = [this.userId];

    if (query.category) {
      sql += ` AND category = ?`;
      params.push(query.category);
    }

    if (query.isArchived !== undefined) {
      sql += ` AND is_archived = ?`;
      params.push(query.isArchived ? 1 : 0);
    }

    sql += ` ORDER BY created_at DESC`;

    if (query.limit) {
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }

    const stmt = this.db.prepare<unknown[], HabitRow>(sql);
    return stmt.all(...params).map(rowToHabit);
  }

  // ---------------------------------------------------------------------------
  // Habit Logs
  // ---------------------------------------------------------------------------

  logHabit(habitId: string, options: { date?: string; count?: number; notes?: string } = {}): HabitLog | null {
    const habit = this.get(habitId);
    if (!habit) return null;

    const date: string = options.date ?? new Date().toISOString().split('T')[0]!;
    const count = options.count ?? 1;

    // Check if log exists for this date
    const existing = this.getLog(habitId, date);

    if (existing) {
      // Update existing log
      const newCount = existing.count + count;
      const stmt = this.db.prepare(`
        UPDATE habit_logs SET count = ?, notes = COALESCE(?, notes), logged_at = ?
        WHERE habit_id = ? AND date = ?
      `);

      stmt.run(newCount, options.notes ?? null, new Date().toISOString(), habitId, date);
    } else {
      // Insert new log
      const id = `hlog_${Date.now()}`;
      const stmt = this.db.prepare(`
        INSERT INTO habit_logs (id, habit_id, user_id, date, count, notes, logged_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(id, habitId, this.userId, date, count, options.notes ?? null, new Date().toISOString());
    }

    // Update habit stats
    this.updateHabitStats(habitId);

    return this.getLog(habitId, date);
  }

  getLog(habitId: string, date: string): HabitLog | null {
    const stmt = this.db.prepare<[string, string], HabitLogRow>(`
      SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?
    `);

    const row = stmt.get(habitId, date);
    return row ? rowToHabitLog(row) : null;
  }

  getLogs(habitId: string, options: { startDate?: string; endDate?: string; limit?: number } = {}): HabitLog[] {
    let sql = `SELECT * FROM habit_logs WHERE habit_id = ?`;
    const params: unknown[] = [habitId];

    if (options.startDate) {
      sql += ` AND date >= ?`;
      params.push(options.startDate);
    }

    if (options.endDate) {
      sql += ` AND date <= ?`;
      params.push(options.endDate);
    }

    sql += ` ORDER BY date DESC`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const stmt = this.db.prepare<unknown[], HabitLogRow>(sql);
    return stmt.all(...params).map(rowToHabitLog);
  }

  deleteLog(habitId: string, date: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM habit_logs WHERE habit_id = ? AND date = ?`);
    const result = stmt.run(habitId, date);

    if (result.changes > 0) {
      this.updateHabitStats(habitId);
    }

    return result.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Stats & Streaks
  // ---------------------------------------------------------------------------

  private updateHabitStats(habitId: string): void {
    const habit = this.get(habitId);
    if (!habit) return;

    // Calculate total completions
    const totalStmt = this.db.prepare<[string], { total: number }>(`
      SELECT COALESCE(SUM(count), 0) as total FROM habit_logs WHERE habit_id = ?
    `);
    const totalCompletions = totalStmt.get(habitId)?.total ?? 0;

    // Calculate streak
    const { currentStreak, longestStreak } = this.calculateStreak(habit);

    // Update habit
    const stmt = this.db.prepare(`
      UPDATE habits SET
        total_completions = ?,
        streak_current = ?,
        streak_longest = ?
      WHERE id = ?
    `);

    stmt.run(totalCompletions, currentStreak, Math.max(longestStreak, habit.streakLongest), habitId);
  }

  private calculateStreak(habit: Habit): { currentStreak: number; longestStreak: number } {
    const logs = this.getLogs(habit.id, { limit: 365 }); // Last year

    if (logs.length === 0) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    // Sort by date ascending
    logs.sort((a, b) => a.date.localeCompare(b.date));

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let lastDate: Date | null = null;

    // Helper to check if a date is a target day
    const isTargetDay = (date: Date): boolean => {
      if (habit.frequency === 'daily') return true;
      if (habit.frequency === 'weekdays') return date.getDay() >= 1 && date.getDay() <= 5;
      return habit.targetDays.includes(date.getDay());
    };

    // Process logs
    for (const log of logs) {
      const logDate = new Date(log.date);

      if (log.count >= habit.targetCount) {
        if (lastDate === null) {
          tempStreak = 1;
        } else {
          // Check if consecutive (accounting for non-target days)
          const daysDiff = Math.floor((logDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

          let missedTargetDays = 0;
          for (let i = 1; i < daysDiff; i++) {
            const checkDate = new Date(lastDate);
            checkDate.setDate(lastDate.getDate() + i);
            if (isTargetDay(checkDate)) {
              missedTargetDays++;
            }
          }

          if (missedTargetDays === 0) {
            tempStreak++;
          } else {
            tempStreak = 1;
          }
        }

        lastDate = logDate;

        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }
      }
    }

    // Check if streak is still active (today or yesterday completed, or today is not a target day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (lastDate) {
      const lastLogDate = new Date(lastDate);
      lastLogDate.setHours(0, 0, 0, 0);

      const daysSince = Math.floor((today.getTime() - lastLogDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince <= 1 || (daysSince > 1 && !isTargetDay(yesterday))) {
        currentStreak = tempStreak;
      }
    }

    return { currentStreak, longestStreak };
  }

  getHabitStats(habitId: string): {
    habit: Habit;
    weeklyCompletions: number;
    monthlyCompletions: number;
    completionRate: number;
    recentLogs: HabitLog[];
  } | null {
    const habit = this.get(habitId);
    if (!habit) return null;

    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30);

    const weeklyLogs = this.getLogs(habitId, { startDate: weekAgo.toISOString().split('T')[0] });
    const monthlyLogs = this.getLogs(habitId, { startDate: monthAgo.toISOString().split('T')[0] });

    const weeklyCompletions = weeklyLogs.reduce((sum, log) => sum + log.count, 0);
    const monthlyCompletions = monthlyLogs.reduce((sum, log) => sum + log.count, 0);

    // Calculate expected completions based on frequency
    let expectedWeekly = 7;
    let expectedMonthly = 30;
    if (habit.frequency === 'weekdays') {
      expectedWeekly = 5;
      expectedMonthly = 22;
    } else if (habit.frequency === 'weekly') {
      expectedWeekly = 1;
      expectedMonthly = 4;
    } else if (habit.frequency === 'custom') {
      expectedWeekly = habit.targetDays.length;
      expectedMonthly = habit.targetDays.length * 4;
    }

    const completionRate = monthlyCompletions / (expectedMonthly * habit.targetCount) * 100;

    return {
      habit,
      weeklyCompletions,
      monthlyCompletions,
      completionRate: Math.min(100, Math.round(completionRate)),
      recentLogs: weeklyLogs,
    };
  }

  // ---------------------------------------------------------------------------
  // Today's Habits
  // ---------------------------------------------------------------------------

  getTodayHabits(): HabitWithTodayStatus[] {
    const today = new Date();
    const todayStr: string = today.toISOString().split('T')[0]!;
    const dayOfWeek = today.getDay();

    const habits = this.list({ isArchived: false });

    return habits
      .filter(habit => {
        if (habit.frequency === 'daily') return true;
        if (habit.frequency === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
        return habit.targetDays.includes(dayOfWeek);
      })
      .map(habit => {
        const todayLog = this.getLog(habit.id, todayStr);
        return {
          ...habit,
          completedToday: todayLog ? todayLog.count >= habit.targetCount : false,
          todayCount: todayLog?.count ?? 0,
        };
      });
  }

  getTodayProgress(): {
    total: number;
    completed: number;
    percentage: number;
    habits: HabitWithTodayStatus[];
  } {
    const habits = this.getTodayHabits();
    const completed = habits.filter(h => h.completedToday).length;

    return {
      total: habits.length,
      completed,
      percentage: habits.length > 0 ? Math.round((completed / habits.length) * 100) : 0,
      habits,
    };
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  getCategories(): string[] {
    const stmt = this.db.prepare<string, { category: string }>(`
      SELECT DISTINCT category FROM habits
      WHERE user_id = ? AND category IS NOT NULL
      ORDER BY category
    `);

    return stmt.all(this.userId).map(r => r.category);
  }
}

export const habitsRepo = new HabitsRepository();
