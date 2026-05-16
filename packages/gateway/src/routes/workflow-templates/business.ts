/**
 * Business & productivity workflow templates (15 entries).
 *
 * Lead scoring, invoices, standups, expense reports, contract review —
 * workflows aimed at the back-office and ops side of a small team.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const BUSINESS_TEMPLATES: WorkflowTemplateIdea[] = [
  {
    id: 'biz-lead-scoring',
    name: 'Lead Scoring Pipeline',
    description: 'Score and qualify sales leads automatically',
    category: 'Business',
    nodes:
      'Trigger(webhook new lead) → HTTP(enrich data) → LLM(score lead 1-100, responseFormat:json) → Switch(score band) → [hot: Notification(sales team), warm: Tool(create_task follow up), cold: Tool(add to nurture list)]',
    difficulty: 'advanced',
  },
  {
    id: 'biz-invoice-processor',
    name: 'Invoice Processor',
    description: 'Extract data from invoices and create records',
    category: 'Business',
    nodes:
      'Trigger → Tool(read_file invoice) → LLM(extract fields, responseFormat:json) → SchemaValidator(check required) → Condition(valid?) → true: HTTP(accounting API) → Notification / false: Notification(invalid invoice)',
    difficulty: 'intermediate',
  },
  {
    id: 'biz-daily-standup',
    name: 'Daily Standup Compiler',
    description: 'Collect and compile daily standup updates',
    category: 'Business',
    nodes:
      'Trigger(schedule 9AM) → Tool(list_tasks status:in-progress) → Tool(search_notes tag:standup) → LLM(compile standup report) → Notification',
    difficulty: 'beginner',
  },
  {
    id: 'biz-expense-report',
    name: 'Expense Report Automator',
    description: 'Categorize expenses and generate report',
    category: 'Business',
    nodes:
      'Trigger → Tool(query_expenses this month) → LLM(categorize, responseFormat:json) → Aggregate(sum by category) → LLM(write expense report) → Approval(manager review) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'biz-customer-feedback',
    name: 'Customer Feedback Analyzer',
    description: 'Analyze feedback, categorize issues, assign actions',
    category: 'Business',
    nodes:
      'Trigger(webhook feedback) → LLM(sentiment+category, responseFormat:json) → Switch(category) → [bug: Tool(create_task), feature: Tool(create_note), praise: Notification(share team)] → ErrorHandler',
    difficulty: 'advanced',
  },
  {
    id: 'biz-meeting-scheduler',
    name: 'Smart Meeting Scheduler',
    description: 'Find optimal meeting times from calendars',
    category: 'Business',
    nodes:
      'Trigger → Tool(list_events this week) → LLM(find free slots, responseFormat:json) → Filter(duration>=30min) → Notification(available slots)',
    difficulty: 'beginner',
  },
  {
    id: 'biz-contract-review',
    name: 'Contract Review Assistant',
    description: 'AI review of contracts with risk flagging',
    category: 'Business',
    nodes:
      'Trigger → Tool(read_file contract) → LLM(identify risks, responseFormat:json) → Filter(severity>=medium) → Condition(high risks?) → true: Approval(legal review) / false: Notification(contract OK)',
    difficulty: 'advanced',
  },
  {
    id: 'biz-weekly-report',
    name: 'Automated Weekly Report',
    description: 'Compile weekly progress report from tasks and notes',
    category: 'Business',
    nodes:
      'Trigger(schedule Friday 5PM) → Parallel → [Tool(list_tasks completed), Tool(search_notes this week), Tool(query_expenses)] → Merge → LLM(write weekly report) → Tool(create_note) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'biz-onboarding-checklist',
    name: 'Employee Onboarding Checklist',
    description: 'Create and track onboarding tasks for new hires',
    category: 'Business',
    nodes:
      'Trigger → LLM(generate onboarding tasks for role, responseFormat:json) → ForEach(task) → Tool(create_task) → done: Notification(onboarding tasks created)',
    difficulty: 'beginner',
  },
  {
    id: 'biz-rfp-responder',
    name: 'RFP Auto-Responder',
    description: 'Draft RFP responses using company knowledge base',
    category: 'Business',
    nodes:
      'Trigger → Tool(read_file rfp) → LLM(extract requirements, responseFormat:json) → ForEach(req) → Tool(search_memories relevant info) → done: LLM(draft response) → Approval → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'biz-time-tracker',
    name: 'Automated Time Tracking Report',
    description: 'Analyze time entries and generate billing report',
    category: 'Business',
    nodes:
      'Trigger(schedule monthly) → HTTP(time tracking API) → Aggregate(sum by project) → Map(add hourly rate) → Aggregate(sum total) → LLM(format invoice) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'biz-goal-tracker',
    name: 'OKR Progress Tracker',
    description: 'Track OKR progress and send weekly updates',
    category: 'Business',
    nodes:
      'Trigger(schedule weekly) → Tool(list_goals) → ForEach(goal) → Transformer(calc progress%) → done: Aggregate(avg completion) → LLM(write progress update) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'biz-client-birthday',
    name: 'Client Birthday Reminder',
    description: 'Send personalized birthday messages to clients',
    category: 'Business',
    nodes:
      'Trigger(schedule daily) → Tool(list_contacts) → Filter(birthday==today) → ForEach(contact) → LLM(write personal message) → Notification(send wishes)',
    difficulty: 'beginner',
  },
  {
    id: 'biz-knowledge-base',
    name: 'Knowledge Base Builder',
    description: 'Organize and tag knowledge base articles from raw notes',
    category: 'Business',
    nodes:
      'Trigger → Tool(search_notes untagged) → ForEach(note) → LLM(categorize+suggest tags, responseFormat:json) → done: Map(apply tags) → Notification(organized)',
    difficulty: 'intermediate',
  },
  {
    id: 'biz-survey-analyzer',
    name: 'Survey Response Analyzer',
    description: 'Analyze survey responses and generate insights',
    category: 'Business',
    nodes:
      'Trigger → Tool(read_file survey.csv) → Tool(csv_to_json) → Aggregate(groupBy question) → LLM(analyze trends) → LLM(actionable recommendations) → Tool(create_note)',
    difficulty: 'intermediate',
  },
];
