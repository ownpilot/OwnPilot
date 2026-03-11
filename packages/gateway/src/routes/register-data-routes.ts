/**
 * Data Domain Route Registration
 *
 * Mounts all data-related routes: personal data, custom data,
 * memories, goals, expenses, costs, artifacts, and productivity.
 */

import type { Hono } from 'hono';
import {
  personalDataRoutes,
  customDataRoutes,
  memoriesRoutes,
  goalsRoutes,
  expensesRoutes,
  costRoutes,
  artifactsRoutes,
  productivityRoutes,
} from './index.js';

export function registerDataRoutes(app: Hono): void {
  // Personal data routes (tasks, bookmarks, notes, calendar, contacts, summary)
  app.route('/api/v1', personalDataRoutes);

  // Custom data routes (dynamic tables with AI-decided schemas)
  app.route('/api/v1/custom-data', customDataRoutes);

  // Memory routes (persistent AI memory)
  app.route('/api/v1/memories', memoriesRoutes);

  // Goals routes (long-term objectives tracking)
  app.route('/api/v1/goals', goalsRoutes);

  // Expenses
  app.route('/api/v1/expenses', expensesRoutes);

  // Costs
  app.route('/api/v1/costs', costRoutes);

  // Artifacts (AI-generated interactive content)
  app.route('/api/v1/artifacts', artifactsRoutes);

  // Productivity (Pomodoro, Habits, Captures)
  app.route('/api/v1', productivityRoutes);
}
