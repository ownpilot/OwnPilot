/**
 * Security & compliance workflow templates (10 entries).
 *
 * PII scans, access reviews, compliance frameworks, vulnerability
 * reports — workflows for the security team.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const SECURITY_TEMPLATES: WorkflowTemplateIdea[] = [
  {
    id: 'sec-password-audit',
    name: 'Password Strength Auditor',
    description: 'Audit password policies and generate recommendations',
    category: 'Security',
    nodes:
      'Trigger → LLM(generate security audit checklist) → ForEach(check) → Tool(create_task) → done: Notification(audit tasks created)',
    difficulty: 'beginner',
  },
  {
    id: 'sec-pii-scanner',
    name: 'PII Data Scanner',
    description: 'Scan files for personally identifiable information',
    category: 'Security',
    nodes:
      'Trigger → Tool(list_files) → ForEach(file) → Tool(read_file) → Code(PII regex scan) → done: Filter(found PII) → Condition(any?) → true: Notification(PII found!)',
    difficulty: 'intermediate',
  },
  {
    id: 'sec-access-review',
    name: 'Access Review Workflow',
    description: 'Periodic access rights review with approval',
    category: 'Security',
    nodes:
      'Trigger(schedule quarterly) → HTTP(get user permissions) → ForEach(user) → LLM(assess permission appropriateness) → done: Filter(excessive) → Approval(revoke excess?) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'sec-compliance-check',
    name: 'Compliance Checklist Runner',
    description: 'Run compliance checks against a framework',
    category: 'Security',
    nodes:
      'Trigger → DataStore(get compliance-checklist) → ForEach(item) → Condition(automated check?) → true: Code(run check) / false: Approval(manual check) → done: Aggregate(pass rate) → LLM(compliance report)',
    difficulty: 'advanced',
  },
  {
    id: 'sec-vulnerability-report',
    name: 'Vulnerability Report Generator',
    description: 'Compile vulnerability scan results into executive report',
    category: 'Security',
    nodes:
      'Trigger → HTTP(vulnerability scanner API) → Filter(severity>=medium) → Aggregate(groupBy severity) → LLM(write executive summary) → Tool(create_note) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'sec-gdpr-data-request',
    name: 'GDPR Data Request Handler',
    description: 'Process GDPR data access/deletion requests',
    category: 'Security',
    nodes:
      'Trigger(webhook) → Switch(request type) → [access: SubWorkflow(export-data) → Notification / deletion: Approval(confirm delete) → SubWorkflow(delete-data) → Notification]',
    difficulty: 'advanced',
  },
  {
    id: 'sec-ip-blocklist',
    name: 'IP Blocklist Updater',
    description: 'Update IP blocklists from threat intelligence feeds',
    category: 'Security',
    nodes:
      'Trigger(schedule daily) → Parallel → [HTTP(feed1), HTTP(feed2), HTTP(feed3)] → Merge → Transformer(flatten+dedup IPs) → Tool(write_file blocklist) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'sec-cert-monitor',
    name: 'TLS Certificate Monitor',
    description: 'Monitor TLS certificates across domains',
    category: 'Security',
    nodes:
      'Trigger(schedule weekly) → ForEach(domain) → Code(check TLS cert) → done: Filter(expiry<30d) → Condition(any?) → true: Notification(certs expiring!) → ForEach → Tool(create_task renew)',
    difficulty: 'intermediate',
  },
  {
    id: 'sec-audit-trail',
    name: 'Audit Trail Reporter',
    description: 'Generate audit trail report for compliance',
    category: 'Security',
    nodes:
      'Trigger(schedule monthly) → HTTP(audit log API) → Aggregate(groupBy action type) → LLM(write audit report) → Approval(review) → Tool(create_artifact report) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'sec-phishing-detector',
    name: 'Phishing Email Detector',
    description: 'Analyze emails for phishing indicators',
    category: 'Security',
    nodes:
      'Trigger(event email_received) → LLM(analyze for phishing indicators, responseFormat:json) → Condition(phishing score>70?) → true: Notification(PHISHING DETECTED!) → Tool(create_task investigate)',
    difficulty: 'intermediate',
  },
];
