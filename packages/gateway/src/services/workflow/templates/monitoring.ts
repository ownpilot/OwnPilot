/**
 * Monitoring & alerts workflow templates (15 entries).
 *
 * Periodic checks, threshold-based alerts, drift detection — workflows
 * that poll an external system and notify when something diverges.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const MONITORING_TEMPLATES: WorkflowTemplateIdea[] = [
  {
    id: 'monitor-uptime',
    name: 'Website Uptime Monitor',
    description: 'Check website availability every 5 minutes',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule */5 * * * *) → HTTP(GET website) → Condition(status==200?) → false: Notification(SITE DOWN!) / true: DataStore(set last-check OK)',
    difficulty: 'beginner',
  },
  {
    id: 'monitor-api-health',
    name: 'API Health Dashboard',
    description: 'Monitor multiple API endpoints and alert on failures',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule) → Parallel(5) → [HTTP(api1), HTTP(api2), HTTP(api3), HTTP(api4), HTTP(api5)] → Merge → Filter(status!=200) → Condition(any failed?) → true: Notification(alert)',
    difficulty: 'intermediate',
  },
  {
    id: 'monitor-ssl-expiry',
    name: 'SSL Certificate Expiry Checker',
    description: 'Check SSL certificates and alert before expiry',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule daily) → ForEach(domain list) → HTTP(check SSL) → done: Filter(expiresIn<30 days) → Condition(any expiring?) → true: Notification(renew!)',
    difficulty: 'intermediate',
  },
  {
    id: 'monitor-price-tracker',
    name: 'Product Price Tracker',
    description: 'Track product prices and alert on drops',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule hourly) → HTTP(scrape price) → DataStore(get last-price) → Condition(price<last?) → true: Notification(price dropped!) → DataStore(set last-price)',
    difficulty: 'intermediate',
  },
  {
    id: 'monitor-github-releases',
    name: 'GitHub Release Monitor',
    description: 'Watch for new releases of favorite repos',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule daily) → ForEach(repo list) → HTTP(GitHub API releases) → done: Filter(released today) → Condition(any new?) → true: LLM(summarize changes) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'monitor-competitor',
    name: 'Competitor Website Monitor',
    description: 'Detect changes on competitor websites',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule daily) → HTTP(fetch page) → Tool(hash_text) → DataStore(get prev-hash) → Condition(changed?) → true: LLM(summarize changes) → Notification → DataStore(set prev-hash)',
    difficulty: 'advanced',
  },
  {
    id: 'monitor-error-rate',
    name: 'Error Rate Monitor',
    description: 'Track error rates and alert when threshold exceeded',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule) → HTTP(metrics API) → Transformer(calc error rate) → Condition(rate>5%?) → true: Notification(high error rate!) → LLM(suggest fixes)',
    difficulty: 'intermediate',
  },
  {
    id: 'monitor-disk-space',
    name: 'Disk Space Monitor',
    description: 'Monitor disk usage and alert when low',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule hourly) → Code(check disk usage) → Condition(usage>80%?) → true: Notification(disk space low!) → LLM(suggest cleanup)',
    difficulty: 'beginner',
  },
  {
    id: 'monitor-dns-check',
    name: 'DNS Propagation Checker',
    description: 'Check DNS records across multiple nameservers',
    category: 'Monitoring',
    nodes:
      'Trigger → ForEach(nameserver) → HTTP(DNS query) → done: Transformer(compare results) → Condition(all match?) → false: Notification(inconsistent DNS)',
    difficulty: 'intermediate',
  },
  {
    id: 'monitor-dependency-vuln',
    name: 'Dependency Vulnerability Scanner',
    description: 'Check for known vulnerabilities in project dependencies',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule weekly) → Tool(read_file package.json) → HTTP(npm audit API) → Filter(severity>=high) → Condition(any found?) → true: LLM(summarize risks) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'monitor-weather-alert',
    name: 'Severe Weather Alerter',
    description: 'Monitor weather and alert on severe conditions',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule */30) → HTTP(weather API) → Condition(severe alert?) → true: Notification(weather warning!) / false: DataStore(set current-weather)',
    difficulty: 'beginner',
  },
  {
    id: 'monitor-stock-price',
    name: 'Stock Price Alert',
    description: 'Monitor stock price and alert on significant moves',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule */15) → HTTP(stock API) → DataStore(get prev-price) → Transformer(calc change%) → Condition(change>3%?) → true: Notification(price move!) → DataStore(set prev-price)',
    difficulty: 'intermediate',
  },
  {
    id: 'monitor-social-mentions',
    name: 'Brand Mention Monitor',
    description: 'Track brand mentions on social media',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule hourly) → HTTP(social API search) → Filter(new since last check) → ForEach(mention) → LLM(sentiment analysis) → done: Aggregate(groupBy sentiment) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'monitor-backup-verify',
    name: 'Backup Verification Monitor',
    description: 'Verify backups are running and recent',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule daily) → HTTP(backup status API) → Condition(last backup < 24h?) → false: Notification(BACKUP OVERDUE!) → true: DataStore(set backup-verified)',
    difficulty: 'beginner',
  },
  {
    id: 'monitor-cron-health',
    name: 'Cron Job Health Monitor',
    description: 'Ensure scheduled jobs are running successfully',
    category: 'Monitoring',
    nodes:
      'Trigger(schedule) → HTTP(healthcheck API) → Filter(failed jobs) → Condition(any?) → true: ForEach(failed) → Notification(job failed) → done: LLM(suggest fixes)',
    difficulty: 'intermediate',
  },
];
