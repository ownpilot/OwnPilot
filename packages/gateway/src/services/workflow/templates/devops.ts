/**
 * DevOps & engineering workflow templates (15 entries).
 *
 * CI/CD, deployments, infrastructure ops, security scans — workflows the
 * platform team would wire up.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const DEVOPS_TEMPLATES: WorkflowTemplateIdea[] = [
  {
    id: 'devops-deploy-pipeline',
    name: 'Deployment Pipeline with Approval',
    description: 'Build, test, approve, deploy workflow',
    category: 'DevOps',
    nodes:
      'Trigger(webhook) → Code(run tests) → Condition(tests pass?) → true: Approval(deploy to prod?) → HTTP(trigger deploy) → Notification / false: Notification(tests failed)',
    difficulty: 'advanced',
  },
  {
    id: 'devops-pr-review',
    name: 'PR Auto-Reviewer',
    description: 'Automatically review pull requests with AI',
    category: 'DevOps',
    nodes:
      'Trigger(webhook PR opened) → HTTP(GitHub get PR diff) → LLM(review code) → LLM(security scan) → HTTP(post review comment) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'devops-incident-response',
    name: 'Incident Response Runbook',
    description: 'Automated incident response with escalation',
    category: 'DevOps',
    nodes:
      'Trigger(webhook alert) → Switch(severity) → [P0: Notification(page oncall) → Delay(5m) → Condition(acked?) / P1: Notification(slack) / P2: Tool(create_task)]',
    difficulty: 'advanced',
  },
  {
    id: 'devops-changelog-gen',
    name: 'Release Changelog Generator',
    description: 'Generate changelog from commits between tags',
    category: 'DevOps',
    nodes:
      'Trigger → Tool(git_log) → LLM(categorize: feat/fix/refactor, responseFormat:json) → LLM(write readable changelog) → Tool(write_file CHANGELOG.md) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'devops-docker-cleanup',
    name: 'Docker Image Cleanup',
    description: 'Remove old/unused Docker images',
    category: 'DevOps',
    nodes:
      'Trigger(schedule weekly) → Code(docker images list) → Filter(older than 30 days) → ForEach(image) → Code(docker rmi) → done: Aggregate(count) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'devops-db-backup',
    name: 'Database Backup + Verify',
    description: 'Automated DB backup with integrity check',
    category: 'DevOps',
    nodes:
      'Trigger(schedule daily 2AM) → Code(pg_dump) → Code(verify checksum) → Condition(valid?) → true: HTTP(upload S3) → Notification(backup OK) / false: Notification(BACKUP CORRUPT)',
    difficulty: 'advanced',
  },
  {
    id: 'devops-code-quality',
    name: 'Code Quality Gate',
    description: 'Run linting, testing, and coverage checks',
    category: 'DevOps',
    nodes:
      'Trigger(webhook) → Parallel(3) → [Code(lint), Code(test), Code(coverage)] → Merge → Transformer(pass/fail each) → Condition(all pass?) → true: Notification(✅) / false: Notification(❌)',
    difficulty: 'advanced',
  },
  {
    id: 'devops-secret-rotation',
    name: 'Secret Rotation Reminder',
    description: 'Track and remind about API key expiry',
    category: 'DevOps',
    nodes:
      'Trigger(schedule monthly) → DataStore(get secret-registry) → ForEach(secret) → Condition(age>90 days?) → true: Notification(rotate!) → done: Aggregate(count expired)',
    difficulty: 'intermediate',
  },
  {
    id: 'devops-log-alert',
    name: 'Error Log Alerter',
    description: 'Watch logs for critical errors and alert',
    category: 'DevOps',
    nodes:
      'Trigger(schedule */5) → HTTP(log aggregator API) → Filter(level==CRITICAL) → Condition(count>0?) → true: LLM(summarize errors) → Notification(CRITICAL ERRORS)',
    difficulty: 'intermediate',
  },
  {
    id: 'devops-migration-checker',
    name: 'Database Migration Validator',
    description: 'Validate DB migrations before applying',
    category: 'DevOps',
    nodes:
      'Trigger → Tool(read_file migration.sql) → LLM(analyze for risks) → Condition(safe?) → true: Approval(apply migration?) → Code(run migration) → Notification / false: Notification(risky)',
    difficulty: 'advanced',
  },
  {
    id: 'devops-status-page',
    name: 'Status Page Updater',
    description: 'Automatically update status page based on health checks',
    category: 'DevOps',
    nodes:
      'Trigger(schedule */5) → Parallel → [HTTP(api check), HTTP(web check), HTTP(db check)] → Merge → Transformer(compute status) → HTTP(update status page API)',
    difficulty: 'intermediate',
  },
  {
    id: 'devops-dependency-update',
    name: 'Dependency Update Reporter',
    description: 'Check for outdated dependencies and create report',
    category: 'DevOps',
    nodes:
      'Trigger(schedule weekly) → Code(npm outdated --json) → Filter(major updates) → LLM(assess breaking change risk) → Tool(create_note) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'devops-env-validator',
    name: 'Environment Config Validator',
    description: 'Validate environment variables match schema',
    category: 'DevOps',
    nodes:
      'Trigger → Tool(read_file .env) → SchemaValidator(check required vars) → Condition(valid?) → false: Notification(missing env vars!) / true: Notification(env OK)',
    difficulty: 'beginner',
  },
  {
    id: 'devops-container-scan',
    name: 'Container Security Scanner',
    description: 'Scan Docker images for vulnerabilities',
    category: 'DevOps',
    nodes:
      'Trigger(webhook new image pushed) → Code(trivy scan) → Filter(severity>=HIGH) → Condition(critical found?) → true: Notification(block deploy!) → Approval / false: Notification(clean)',
    difficulty: 'advanced',
  },
  {
    id: 'devops-performance-test',
    name: 'Automated Performance Test',
    description: 'Run load tests and compare with baseline',
    category: 'DevOps',
    nodes:
      'Trigger → Code(run load test) → DataStore(get baseline) → Transformer(compare metrics) → Condition(regression?) → true: Notification(perf regression!) / false: DataStore(update baseline)',
    difficulty: 'advanced',
  },
];
