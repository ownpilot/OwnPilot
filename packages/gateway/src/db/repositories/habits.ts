/**
 * Habits Repository
 *
 * CRUD operations for habit tracking with streaks and statistics
 */

import { BaseRepository } from './base.js';
import { MS_PER_DAY, MAX_DAYS_LOOKBACK } from '../../config/defaults.js';

function safeParseArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

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
  is_archived: boolean;
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
    targetDays: safeParseArray(row.target_days),
    targetCount: row.target_count,
    unit: row.unit ?? undefined,
    category: row.category ?? undefined,
    color: row.color ?? undefined,
    icon: row.icon ?? undefined,
    reminderTime: row.reminder_time ?? undefined,
    isArchived: row.is_archived === true,
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

// ==============================================================================
// Repository
// ==============================================================================

export class HabitsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  // ---------------------------------------------------------------------------
  // Habits CRUD
  // ---------------------------------------------------------------------------

  async create(input: CreateHabitInput): Promise<Habit> {
    const id = `hab_${Date.now()}`;

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

    await this.execute(
      `INSERT INTO habits (id, user_id, name, description, frequency, target_days, target_count,
        unit, category, color, icon, reminder_time, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [
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
      ]
    );

    const habit = await this.get(id);
    if (!habit) throw new Error('Failed to create habit');
    return habit;
  }

  async get(id: string): Promise<Habit | null> {
    const row = await this.queryOne<HabitRow>(
      `SELECT * FROM habits WHERE id = $1 AND user_id = $2`,
      [id, this.userId]
    );

    return row ? rowToHabit(row) : null;
  }

  async update(id: string, input: UpdateHabitInput): Promise<Habit | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    await this.execute(
      `UPDATE habits SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        frequency = COALESCE($3, frequency),
        target_days = COALESCE($4, target_days),
        target_count = COALESCE($5, target_count),
        unit = COALESCE($6, unit),
        category = COALESCE($7, category),
        color = COALESCE($8, color),
        icon = COALESCE($9, icon),
        reminder_time = COALESCE($10, reminder_time),
        is_archived = COALESCE($11, is_archived),
        updated_at = NOW()
      WHERE id = $12 AND user_id = $13`,
      [
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
        input.isArchived !== undefined ? input.isArchived : null,
        id,
        this.userId,
      ]
    );

    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM habits WHERE id = $1 AND user_id = $2`, [
      id,
      this.userId,
    ]);
    return result.changes > 0;
  }

  async archive(id: string): Promise<Habit | null> {
    return this.update(id, { isArchived: true });
  }

  async unarchive(id: string): Promise<Habit | null> {
    return this.update(id, { isArchived: false });
  }

  async list(query: HabitQuery = {}): Promise<Habit[]> {
    let sql = `SELECT * FROM habits WHERE user_id = $1`;
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(query.category);
    }

    if (query.isArchived !== undefined) {
      sql += ` AND is_archived = $${paramIndex++}`;
      params.push(query.isArchived);
    }

    sql += ` ORDER BY created_at DESC`;

    if (query.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(query.limit);
    }

    const rows = await this.query<HabitRow>(sql, params);
    return rows.map(rowToHabit);
  }

  // ---------------------------------------------------------------------------
  // Habit Logs
  // ---------------------------------------------------------------------------

  async logHabit(
    habitId: string,
    options: { date?: string; count?: number; notes?: string } = {}
  ): Promise<HabitLog | null> {
    const habit = await this.get(habitId);
    if (!habit) return null;

    const date: string = options.date ?? new Date().toISOString().split('T')[0]!;
    const count = options.count ?? 1;

    // Check if log exists for this date
    const existing = await this.getLog(habitId, date);

    if (existing) {
      // Update existing log
      const newCount = existing.count + count;
      await this.execute(
        `UPDATE habit_logs SET count = $1, notes = COALESCE($2, notes), logged_at = NOW()
        WHERE habit_id = $3 AND date = $4`,
        [newCount, options.notes ?? null, habitId, date]
      );
    } else {
      // Insert new log
      const id = `hlog_${Date.now()}`;
      await this.execute(
        `INSERT INTO habit_logs (id, habit_id, user_id, date, count, notes, logged_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [id, habitId, this.userId, date, count, options.notes ?? null]
      );
    }

    // Update habit stats
    await this.updateHabitStats(habitId);

    return this.getLog(habitId, date);
  }

  async getLog(habitId: string, date: string): Promise<HabitLog | null> {
    const row = await this.queryOne<HabitLogRow>(
      `SELECT * FROM habit_logs WHERE habit_id = $1 AND date = $2`,
      [habitId, date]
    );

    return row ? rowToHabitLog(row) : null;
  }

  async getLogs(
    habitId: string,
    options: { startDate?: string; endDate?: string; limit?: number } = {}
  ): Promise<HabitLog[]> {
    let sql = `SELECT * FROM habit_logs WHERE habit_id = $1`;
    const params: unknown[] = [habitId];
    let paramIndex = 2;

    if (options.startDate) {
      sql += ` AND date >= $${paramIndex++}`;
      params.push(options.startDate);
    }

    if (options.endDate) {
      sql += ` AND date <= $${paramIndex++}`;
      params.push(options.endDate);
    }

    sql += ` ORDER BY date DESC`;

    if (options.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      params.push(options.limit);
    }

    const rows = await this.query<HabitLogRow>(sql, params);
    return rows.map(rowToHabitLog);
  }

  async deleteLog(habitId: string, date: string): Promise<boolean> {
    const result = await this.execute(`DELETE FROM habit_logs WHERE habit_id = $1 AND date = $2`, [
      habitId,
      date,
    ]);

    if (result.changes > 0) {
      await this.updateHabitStats(habitId);
    }

    return result.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Stats & Streaks
  // ---------------------------------------------------------------------------

  private async updateHabitStats(habitId: string): Promise<void> {
    const habit = await this.get(habitId);
    if (!habit) return;

    // Calculate total completions
    const totalResult = await this.queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(count), 0) as total FROM habit_logs WHERE habit_id = $1`,
      [habitId]
    );
    const totalCompletions = totalResult?.total ?? 0;

    // Calculate streak
    const { currentStreak, longestStreak } = await this.calculateStreak(habit);

    // Update habit
    await this.execute(
      `UPDATE habits SET
        total_completions = $1,
        streak_current = $2,
        streak_longest = $3
      WHERE id = $4`,
      [totalCompletions, currentStreak, Math.max(longestStreak, habit.streakLongest), habitId]
    );
  }

  private async calculateStreak(
    habit: Habit
  ): Promise<{ currentStreak: number; longestStreak: number }> {
    const logs = await this.getLogs(habit.id, { limit: MAX_DAYS_LOOKBACK }); // Last year

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
          const daysDiff = Math.floor((logDate.getTime() - lastDate.getTime()) / MS_PER_DAY);

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

      const daysSince = Math.floor((today.getTime() - lastLogDate.getTime()) / MS_PER_DAY);

      if (daysSince <= 1 || (daysSince > 1 && !isTargetDay(yesterday))) {
        currentStreak = tempStreak;
      }
    }

    return { currentStreak, longestStreak };
  }

  async getHabitStats(habitId: string): Promise<{
    habit: Habit;
    weeklyCompletions: number;
    monthlyCompletions: number;
    completionRate: number;
    recentLogs: HabitLog[];
  } | null> {
    const habit = await this.get(habitId);
    if (!habit) return null;

    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30);

    const weeklyLogs = await this.getLogs(habitId, {
      startDate: weekAgo.toISOString().split('T')[0],
    });
    const monthlyLogs = await this.getLogs(habitId, {
      startDate: monthAgo.toISOString().split('T')[0],
    });

    const weeklyCompletions = weeklyLogs.reduce((sum, log) => sum + log.count, 0);
    const monthlyCompletions = monthlyLogs.reduce((sum, log) => sum + log.count, 0);

    // Calculate expected completions based on frequency
    let expectedMonthly = 30;
    if (habit.frequency === 'weekdays') {
      expectedMonthly = 22;
    } else if (habit.frequency === 'weekly') {
      expectedMonthly = 4;
    } else if (habit.frequency === 'custom') {
      expectedMonthly = habit.targetDays.length * 4;
    }

    const completionRate = (monthlyCompletions / (expectedMonthly * habit.targetCount)) * 100;

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

  async getTodayHabits(): Promise<HabitWithTodayStatus[]> {
    const today = new Date();
    const todayStr: string = today.toISOString().split('T')[0]!;
    const dayOfWeek = today.getDay();

    const habits = await this.list({ isArchived: false });

    // Batch-fetch all today's logs in one query instead of N+1
    const todayLogs = await this.query<HabitLogRow>(`SELECT * FROM habit_logs WHERE date = $1`, [
      todayStr,
    ]);
    const logsByHabitId = new Map(todayLogs.map((row) => [row.habit_id, rowToHabitLog(row)]));

    const results: HabitWithTodayStatus[] = [];

    for (const habit of habits) {
      let isTargetDay = false;
      if (habit.frequency === 'daily') {
        isTargetDay = true;
      } else if (habit.frequency === 'weekdays') {
        isTargetDay = dayOfWeek >= 1 && dayOfWeek <= 5;
      } else {
        isTargetDay = habit.targetDays.includes(dayOfWeek);
      }

      if (isTargetDay) {
        const todayLog = logsByHabitId.get(habit.id);
        results.push({
          ...habit,
          completedToday: todayLog ? todayLog.count >= habit.targetCount : false,
          todayCount: todayLog?.count ?? 0,
        });
      }
    }

    return results;
  }

  async getTodayProgress(): Promise<{
    total: number;
    completed: number;
    percentage: number;
    habits: HabitWithTodayStatus[];
  }> {
    const habits = await this.getTodayHabits();
    const completed = habits.filter((h) => h.completedToday).length;

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

  async getCategories(): Promise<string[]> {
    const rows = await this.query<{ category: string }>(
      `SELECT DISTINCT category FROM habits
      WHERE user_id = $1 AND category IS NOT NULL
      ORDER BY category`,
      [this.userId]
    );

    return rows.map((r) => r.category);
  }
}

export const habitsRepo = new HabitsRepository();

// Factory function
export function createHabitsRepository(userId = 'default'): HabitsRepository {
  return new HabitsRepository(userId);
}
