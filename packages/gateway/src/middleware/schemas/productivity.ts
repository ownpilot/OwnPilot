/**
 * Productivity-domain schemas: things the user tracks about their own life.
 *
 *  - plans          (createPlan, updatePlan, createPlanStep, updatePlanStep)
 *  - goals          (createGoal, updateGoal, createGoalSteps, updateGoalStep,
 *                    completeGoalStep)
 *  - memories       (create/update/boost/decay/cleanup)
 *  - expenses       (create/update)
 *  - productivity   (startPomodoro, createHabit, createCapture,
 *                    processCapture)
 *  - personal data  (create/update task|bookmark|note|contact|event)
 */

import { z } from 'zod';

// ─── Plans ───────────────────────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  goal: z.string().min(1).max(5000),
  deadline: z.string().max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

export const updatePlanSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  goal: z.string().max(5000).optional(),
  deadline: z.string().max(100).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']).optional(),
});

export const createPlanStepSchema = z.object({
  name: z.string().min(1).max(500),
  type: z.enum([
    'tool_call',
    'llm_decision',
    'user_input',
    'condition',
    'parallel',
    'loop',
    'sub_plan',
  ]),
  orderNum: z.number().int().min(0).max(1000),
  description: z.string().max(5000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
});

export const updatePlanStepSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  type: z
    .enum(['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan'])
    .optional(),
  status: z
    .enum(['pending', 'running', 'completed', 'failed', 'skipped', 'blocked', 'waiting'])
    .optional(),
  orderNum: z.number().int().min(0).max(1000).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  action: z.record(z.string(), z.unknown()).optional(),
});

// ─── Goals ───────────────────────────────────────────────────────

export const createGoalSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  status: z.enum(['active', 'paused', 'completed', 'abandoned']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  parentId: z.string().max(200).optional(),
  dueDate: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateGoalSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['active', 'paused', 'completed', 'abandoned']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  dueDate: z.string().max(100).optional(),
  progress: z.number().min(0).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createGoalStepsSchema = z.union([
  z.object({
    steps: z
      .array(
        z.object({
          title: z.string().min(1).max(500),
          description: z.string().max(5000).optional(),
          orderNum: z.number().int().min(0).max(10000).optional(),
          dependencies: z.array(z.string().max(200)).max(50).optional(),
        })
      )
      .min(1)
      .max(100),
  }),
  z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    orderNum: z.number().int().min(0).max(10000).optional(),
    dependencies: z.array(z.string().max(200)).max(50).optional(),
  }),
]);

export const updateGoalStepSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'skipped']).optional(),
  result: z.string().max(10000).optional(),
});

export const completeGoalStepSchema = z.object({
  result: z.string().max(10000).optional(),
});

// ─── Memories ────────────────────────────────────────────────────

export const createMemorySchema = z.object({
  type: z.enum(['fact', 'preference', 'conversation', 'event', 'skill']),
  content: z.string().min(1).max(50000),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  source: z.string().max(200).optional(),
  sourceId: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateMemorySchema = z.object({
  content: z.string().min(1).max(50000).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

export const boostMemorySchema = z.object({
  amount: z.number().min(0).max(1).optional(),
});

export const decayMemoriesSchema = z.object({
  daysThreshold: z.number().int().min(1).max(3650).optional(),
  decayFactor: z.number().min(0).max(1).optional(),
});

export const cleanupMemoriesSchema = z.object({
  maxAge: z.number().int().min(1).max(3650).optional(),
  minImportance: z.number().min(0).max(1).optional(),
});

// ─── Expenses ────────────────────────────────────────────────────

const expenseCategoryEnum = z.enum([
  'food',
  'transport',
  'utilities',
  'entertainment',
  'shopping',
  'health',
  'education',
  'travel',
  'subscription',
  'housing',
  'other',
]);

export const createExpenseSchema = z.object({
  date: z.string().max(100).optional(),
  amount: z.number().positive(),
  currency: z.string().max(10).optional(),
  category: expenseCategoryEnum,
  description: z.string().min(1).max(1000),
  paymentMethod: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateExpenseSchema = z.object({
  date: z.string().max(100).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().max(10).optional(),
  category: expenseCategoryEnum.optional(),
  description: z.string().min(1).max(1000).optional(),
  paymentMethod: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  notes: z.string().max(5000).optional(),
});

// ─── Productivity (pomodoro, habit, capture) ─────────────────────

export const startPomodoroSchema = z.object({
  type: z.enum(['work', 'short_break', 'long_break']),
  durationMinutes: z.number().int().min(1).max(120),
  taskDescription: z.string().max(500).optional(),
});

export const createHabitSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  frequency: z.enum(['daily', 'weekly', 'weekdays', 'custom']).optional(),
  targetDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  targetCount: z.number().int().min(1).max(100).optional(),
  unit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  color: z.string().max(50).optional(),
  icon: z.string().max(50).optional(),
  reminderTime: z.string().max(10).optional(),
});

export const createCaptureSchema = z.object({
  content: z.string().min(1).max(50000),
  type: z
    .enum(['idea', 'thought', 'todo', 'link', 'quote', 'snippet', 'question', 'other'])
    .optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
  source: z.string().max(200).optional(),
});

export const processCaptureSchema = z.object({
  processedAsType: z.enum(['note', 'task', 'bookmark', 'discarded']),
  processedAsId: z.string().max(200).optional(),
});

// ─── Personal data: tasks ────────────────────────────────────────

const taskStatusEnum = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
const taskPriorityEnum = z.enum(['low', 'normal', 'high', 'urgent']);

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  priority: taskPriorityEnum.optional(),
  dueDate: z.string().max(50).optional(),
  dueTime: z.string().max(20).optional(),
  reminderAt: z.string().max(50).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  parentId: z.string().max(200).optional(),
  projectId: z.string().max(200).optional(),
  recurrence: z.string().max(200).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).optional(),
  status: taskStatusEnum.optional(),
  priority: taskPriorityEnum.optional(),
  dueDate: z.string().max(50).optional(),
  dueTime: z.string().max(20).optional(),
  reminderAt: z.string().max(50).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  parentId: z.string().max(200).optional(),
  projectId: z.string().max(200).optional(),
  recurrence: z.string().max(200).optional(),
});

// ─── Personal data: bookmarks ────────────────────────────────────

export const createBookmarkSchema = z.object({
  url: z.string().min(1).max(2048),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  favicon: z.string().max(2048).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  isFavorite: z.boolean().optional(),
});

export const updateBookmarkSchema = z.object({
  url: z.string().max(2048).optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  favicon: z.string().max(2048).optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  isFavorite: z.boolean().optional(),
});

// ─── Personal data: notes ────────────────────────────────────────

const noteContentTypeEnum = z.enum(['markdown', 'text', 'html']);

export const createNoteSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().max(100_000),
  contentType: noteContentTypeEnum.optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  isPinned: z.boolean().optional(),
  color: z.string().max(50).optional(),
});

export const updateNoteSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().max(100_000).optional(),
  contentType: noteContentTypeEnum.optional(),
  category: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  color: z.string().max(50).optional(),
});

// ─── Personal data: contacts ─────────────────────────────────────

const stringRecord = z.record(z.string(), z.string().max(2048));

export const createContactSchema = z.object({
  name: z.string().min(1).max(300),
  nickname: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
  company: z.string().max(300).optional(),
  jobTitle: z.string().max(200).optional(),
  avatar: z.string().max(2048).optional(),
  birthday: z.string().max(50).optional(),
  address: z.string().max(1000).optional(),
  notes: z.string().max(10_000).optional(),
  relationship: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  isFavorite: z.boolean().optional(),
  externalId: z.string().max(200).optional(),
  externalSource: z.string().max(100).optional(),
  socialLinks: stringRecord.optional(),
  customFields: stringRecord.optional(),
});

export const updateContactSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  nickname: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
  company: z.string().max(300).optional(),
  jobTitle: z.string().max(200).optional(),
  avatar: z.string().max(2048).optional(),
  birthday: z.string().max(50).optional(),
  address: z.string().max(1000).optional(),
  notes: z.string().max(10_000).optional(),
  relationship: z.string().max(100).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  isFavorite: z.boolean().optional(),
  socialLinks: stringRecord.optional(),
  customFields: stringRecord.optional(),
});

// ─── Personal data: calendar events ──────────────────────────────
//
// The route normalises (startDate/startTime/endDate/endTime/isAllDay)
// into ISO strings before persisting, so the schema validates the raw
// shape that arrives over the wire rather than the repo's
// `CreateEventInput`/`UpdateEventInput` shapes.

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createCalendarEventSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(10_000).optional(),
    location: z.string().max(500).optional(),
    category: z.string().max(200).optional(),
    color: z.string().max(50).optional(),
    startDate: z.string().regex(DATE_REGEX, 'expected YYYY-MM-DD'),
    endDate: z.string().regex(DATE_REGEX, 'expected YYYY-MM-DD').optional(),
    startTime: z.string().regex(HHMM_REGEX, 'expected HH:MM').optional(),
    endTime: z.string().regex(HHMM_REGEX, 'expected HH:MM').optional(),
    isAllDay: z.boolean().optional(),
    reminders: z.array(z.number().int().min(0).max(43_200)).max(10).optional(),
    recurrence: z.string().max(200).optional(),
    attendees: z.array(z.string().max(320)).max(100).optional(),
  })
  .passthrough();

export const updateCalendarEventSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(10_000).optional(),
    location: z.string().max(500).optional(),
    category: z.string().max(200).optional(),
    color: z.string().max(50).optional(),
    startDate: z.string().regex(DATE_REGEX, 'expected YYYY-MM-DD').optional(),
    endDate: z.string().regex(DATE_REGEX, 'expected YYYY-MM-DD').optional(),
    startTime: z.string().regex(HHMM_REGEX, 'expected HH:MM').optional(),
    endTime: z.string().regex(HHMM_REGEX, 'expected HH:MM').optional(),
    isAllDay: z.boolean().optional(),
    reminders: z.array(z.number().int().min(0).max(43_200)).max(10).optional(),
    recurrence: z.string().max(200).optional(),
    attendees: z.array(z.string().max(320)).max(100).optional(),
  })
  .passthrough();
