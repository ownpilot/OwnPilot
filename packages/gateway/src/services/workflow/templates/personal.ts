/**
 * Personal productivity workflow templates (15 entries).
 *
 * Morning briefs, journals, habit tracking, reading lists — workflows
 * meant for the individual user's day-to-day routines.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const PERSONAL_TEMPLATES: WorkflowTemplateIdea[] = [
  {
    id: 'personal-morning-brief',
    name: 'Morning Briefing',
    description: 'Daily summary of tasks, calendar, and weather',
    category: 'Personal',
    nodes:
      'Trigger(schedule 7AM) → Parallel → [Tool(list_tasks due:today), Tool(list_events today), HTTP(weather API)] → Merge → LLM(write morning brief) → Notification',
    difficulty: 'beginner',
  },
  {
    id: 'personal-journal',
    name: 'AI Daily Journal Prompt',
    description: 'Generate personalized journal prompts based on the day',
    category: 'Personal',
    nodes:
      'Trigger(schedule 9PM) → Tool(list_tasks completed today) → Tool(list_events today) → LLM(generate reflection questions) → Tool(create_note journal) → Notification',
    difficulty: 'beginner',
  },
  {
    id: 'personal-habit-tracker',
    name: 'Habit Tracker Report',
    description: 'Weekly habit tracking with streak analysis',
    category: 'Personal',
    nodes:
      'Trigger(schedule Sunday) → Tool(list_tasks tag:habit) → Aggregate(groupBy habit) → Map(calc streak days) → LLM(motivational summary) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-bookmark-organizer',
    name: 'Bookmark Auto-Organizer',
    description: 'Categorize and tag bookmarks automatically',
    category: 'Personal',
    nodes:
      'Trigger → Tool(list_bookmarks untagged) → ForEach(bookmark) → LLM(categorize, responseFormat:json) → done: ForEach(add tags) → Notification(organized)',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-reading-list',
    name: 'Reading List Curator',
    description: 'Curate daily reading recommendations',
    category: 'Personal',
    nodes:
      "Trigger(schedule daily) → Tool(list_bookmarks tag:to-read) → LLM(pick top 3 based on interests) → Notification(today's reads)",
    difficulty: 'beginner',
  },
  {
    id: 'personal-weekly-review',
    name: 'Weekly Review Generator',
    description: 'Comprehensive weekly review of all activities',
    category: 'Personal',
    nodes:
      'Trigger(schedule Friday) → Parallel → [Tool(list_tasks), Tool(search_notes), Tool(list_goals), Tool(query_expenses)] → Merge → LLM(comprehensive review) → Tool(create_note) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-learning-tracker',
    name: 'Learning Progress Tracker',
    description: 'Track learning goals and suggest next steps',
    category: 'Personal',
    nodes:
      'Trigger(schedule) → Tool(list_goals tag:learning) → ForEach(goal) → LLM(assess progress, suggest next) → done: Notification(learning update)',
    difficulty: 'beginner',
  },
  {
    id: 'personal-recipe-planner',
    name: 'Weekly Meal Planner',
    description: 'Generate meal plan based on preferences and budget',
    category: 'Personal',
    nodes:
      'Trigger → LLM(generate meal plan, responseFormat:json) → ForEach(day) → LLM(recipe details) → done: Tool(create_note meal plan) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-fitness-tracker',
    name: 'Fitness Progress Report',
    description: 'Compile fitness data into progress report',
    category: 'Personal',
    nodes:
      'Trigger(schedule weekly) → Tool(search_notes tag:workout) → Aggregate(sum by exercise) → LLM(analyze progress, recommendations) → Tool(create_note report) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-gratitude-journal',
    name: 'AI Gratitude Journal',
    description: 'Daily gratitude prompts with AI reflection',
    category: 'Personal',
    nodes:
      'Trigger(schedule 8PM) → LLM(generate 3 gratitude prompts) → Tool(create_note) → Notification(time to reflect)',
    difficulty: 'beginner',
  },
  {
    id: 'personal-birthday-reminder',
    name: 'Birthday Reminder with Gift Ideas',
    description: 'Remind about upcoming birthdays with gift suggestions',
    category: 'Personal',
    nodes:
      'Trigger(schedule daily) → Tool(list_contacts) → Filter(birthday in 7 days) → ForEach(contact) → LLM(suggest gifts based on interests) → done: Notification(upcoming birthdays)',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-news-digest',
    name: 'Personalized News Digest',
    description: 'Curated news based on your interests',
    category: 'Personal',
    nodes:
      'Trigger(schedule morning) → Parallel → [HTTP(tech news), HTTP(business news), HTTP(local news)] → Merge → LLM(filter by interests, summarize top 10) → Tool(create_note) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-task-prioritizer',
    name: 'AI Task Prioritizer',
    description: 'Use AI to prioritize your task list',
    category: 'Personal',
    nodes:
      'Trigger → Tool(list_tasks status:pending) → LLM(prioritize by urgency+importance, responseFormat:json) → ForEach(task) → Tool(update_task priority) → done: Notification(tasks prioritized)',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-event-prep',
    name: 'Meeting Prep Assistant',
    description: 'Prepare for upcoming meetings with context',
    category: 'Personal',
    nodes:
      'Trigger(schedule 30min before) → Tool(list_events next) → Tool(search_notes about attendees) → Tool(search_memories context) → LLM(prepare talking points) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'personal-budget-tracker',
    name: 'Monthly Budget Tracker',
    description: 'Track spending against budget categories',
    category: 'Personal',
    nodes:
      'Trigger(schedule monthly) → Tool(query_expenses this month) → Aggregate(sum by category) → Tool(expense_summary) → Condition(over budget?) → true: Notification(overspent!) / false: Notification(on track)',
    difficulty: 'beginner',
  },
];
