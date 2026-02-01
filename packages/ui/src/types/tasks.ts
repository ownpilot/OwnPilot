/**
 * Task Types
 *
 * Shared types for task management (TasksPage, DashboardPage, etc.)
 */

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate?: string;
  dueTime?: string;
  category?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
