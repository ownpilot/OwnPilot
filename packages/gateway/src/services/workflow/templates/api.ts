/**
 * API & integration workflow templates (15 entries).
 *
 * Webhooks, syncs, gateways, OAuth — workflows that bridge OwnPilot to
 * other systems over HTTP.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const API_TEMPLATES: WorkflowTemplateIdea[] = [
  {
    id: 'api-webhook-relay',
    name: 'Webhook Event Relay',
    description: 'Receive webhook, transform, and forward to another service',
    category: 'Integration',
    nodes:
      'Trigger(webhook) → Transformer(extract fields) → HTTP(POST to destination) → Condition(success?) → false: Delay(30s) → HTTP(retry) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'api-sync-two-systems',
    name: 'Two-Way System Sync',
    description: 'Sync data between two external systems',
    category: 'Integration',
    nodes:
      'Trigger(schedule) → Parallel → [HTTP(get from system A), HTTP(get from system B)] → Merge → Code(diff records) → ForEach(change) → Switch(direction) → [A→B: HTTP(update B), B→A: HTTP(update A)]',
    difficulty: 'advanced',
  },
  {
    id: 'api-slack-bot',
    name: 'Slack Command Handler',
    description: 'Process Slack slash commands via webhook',
    category: 'Integration',
    nodes:
      'Trigger(webhook) → Switch(command) → [/help: WebhookResponse(help text), /status: HTTP(get status) → WebhookResponse, /report: SubWorkflow(generate report) → WebhookResponse]',
    difficulty: 'advanced',
  },
  {
    id: 'api-github-issue-triage',
    name: 'GitHub Issue Auto-Triager',
    description: 'Automatically label and assign GitHub issues',
    category: 'Integration',
    nodes:
      'Trigger(webhook issue opened) → LLM(classify issue, responseFormat:json) → HTTP(add labels) → Switch(priority) → [P0: HTTP(assign oncall), P1: HTTP(assign team lead), P2: pass] → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'api-form-processor',
    name: 'Form Submission Processor',
    description: 'Process form submissions, validate, and store',
    category: 'Integration',
    nodes:
      'Trigger(webhook form submit) → SchemaValidator(check fields) → Condition(valid?) → true: HTTP(store in CRM) → LLM(draft thank you email) → Notification / false: WebhookResponse(validation errors)',
    difficulty: 'intermediate',
  },
  {
    id: 'api-rss-digest',
    name: 'RSS Feed Digest',
    description: 'Collect RSS feeds and create daily digest',
    category: 'Integration',
    nodes:
      'Trigger(schedule daily) → ForEach(feed URL) → HTTP(fetch RSS) → done: Transformer(flatten all items) → Filter(last 24h) → Map(extract title+link) → LLM(summarize top stories) → Tool(create_note)',
    difficulty: 'intermediate',
  },
  {
    id: 'api-calendar-sync',
    name: 'Calendar Event Syncer',
    description: 'Sync calendar events with task management',
    category: 'Integration',
    nodes:
      'Trigger(schedule) → Tool(list_events today) → Filter(has action items) → ForEach(event) → Tool(create_task from event) → done: Notification(tasks synced)',
    difficulty: 'beginner',
  },
  {
    id: 'api-email-to-task',
    name: 'Email to Task Converter',
    description: 'Convert emails to actionable tasks automatically',
    category: 'Integration',
    nodes:
      'Trigger(event email_received) → LLM(extract action items, responseFormat:json) → ForEach(action) → Tool(create_task) → done: Notification(tasks created from email)',
    difficulty: 'intermediate',
  },
  {
    id: 'api-payment-webhook',
    name: 'Payment Webhook Handler',
    description: 'Process payment notifications and update records',
    category: 'Integration',
    nodes:
      'Trigger(webhook stripe payment) → Switch(event type) → [payment_succeeded: HTTP(update order) → Notification(payment received), payment_failed: Notification(payment failed!) → Tool(create_task follow up)]',
    difficulty: 'intermediate',
  },
  {
    id: 'api-multi-notifier',
    name: 'Multi-Channel Notifier',
    description: 'Send notifications to multiple channels simultaneously',
    category: 'Integration',
    nodes:
      'Trigger → Parallel(4) → [Notification(web), HTTP(Slack webhook), HTTP(Discord webhook), HTTP(email API)] → Merge → DataStore(set notification-log)',
    difficulty: 'beginner',
  },
  {
    id: 'api-data-gateway',
    name: 'API Data Gateway',
    description: 'Create a simple API gateway with caching',
    category: 'Integration',
    nodes:
      'Trigger(webhook) → DataStore(get cached-response) → Condition(cache hit?) → true: WebhookResponse(cached) / false: HTTP(upstream API) → DataStore(set cache) → WebhookResponse(fresh data)',
    difficulty: 'advanced',
  },
  {
    id: 'api-oauth-token-refresh',
    name: 'OAuth Token Refresher',
    description: 'Automatically refresh OAuth tokens before expiry',
    category: 'Integration',
    nodes:
      'Trigger(schedule hourly) → DataStore(get token-expiry) → Condition(expires in 1h?) → true: HTTP(token refresh endpoint) → DataStore(set new-token) → Notification(refreshed)',
    difficulty: 'intermediate',
  },
  {
    id: 'api-graphql-collector',
    name: 'GraphQL Data Collector',
    description: 'Query multiple GraphQL endpoints and merge results',
    category: 'Integration',
    nodes:
      'Trigger → Parallel → [HTTP(GraphQL query 1), HTTP(GraphQL query 2)] → Merge → Transformer(combine data) → Tool(write_file report)',
    difficulty: 'intermediate',
  },
  {
    id: 'api-webhook-validator',
    name: 'Webhook Payload Validator',
    description: 'Validate incoming webhook payloads and route accordingly',
    category: 'Integration',
    nodes:
      'Trigger(webhook) → SchemaValidator(check payload) → Condition(valid?) → true: SubWorkflow(process-payload) → WebhookResponse(200 OK) / false: WebhookResponse(400 bad request)',
    difficulty: 'intermediate',
  },
  {
    id: 'api-rate-limited-batch',
    name: 'Rate-Limited API Batch Processor',
    description: 'Process items through a rate-limited API with delays',
    category: 'Integration',
    nodes:
      'Trigger → Tool(read_file items) → ForEach(item) → HTTP(API call) → Delay(1s rate limit) → done: Aggregate(count successes) → Notification',
    difficulty: 'intermediate',
  },
];
