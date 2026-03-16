/**
 * Workflow Template Ideas — 120 practical workflow examples
 * organized by category.
 *
 * Used by the Workflow Copilot as reference for suggesting real,
 * implementable workflows using OwnPilot's tool ecosystem.
 *
 * Node types: trigger, llm, condition, code, transformer, forEach,
 * httpRequest, delay, switch, notification, parallel, merge,
 * dataStore, filter, map, aggregate, approval, subWorkflow,
 * errorHandler, webhookResponse, stickyNote
 *
 * Tool sources: core.*, mcp.*, custom.*, ext.*, skill.*
 */

export const WORKFLOW_TEMPLATE_IDEAS: Array<{
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: string; // human-readable flow description
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}> = [
  // ============================================================================
  // CONTENT & WRITING (1-15)
  // ============================================================================
  {
    id: 'content-blog-pipeline',
    name: 'Blog Post Pipeline',
    description: 'Generate, review, and publish blog posts with quality gates',
    category: 'Content',
    nodes:
      'Trigger(manual) → LLM(draft article) → LLM(review quality) → Condition(score>7?) → true: LLM(write SEO meta) → Notification(ready) / false: LLM(rewrite) → loop back',
    difficulty: 'intermediate',
  },
  {
    id: 'content-social-media',
    name: 'Social Media Content Generator',
    description: 'Create platform-specific posts from a single topic',
    category: 'Content',
    nodes:
      'Trigger → LLM(generate base content) → Parallel(3) → [LLM(Twitter/X), LLM(LinkedIn), LLM(Instagram)] → Merge → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'content-newsletter',
    name: 'Weekly Newsletter Builder',
    description: 'Curate links, summarize, and format a newsletter',
    category: 'Content',
    nodes:
      'Trigger(schedule weekly) → Tool(list_bookmarks) → Filter(this week) → ForEach(bookmark) → LLM(summarize) → done: LLM(compile newsletter) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'content-translator',
    name: 'Multi-Language Translator',
    description: 'Translate content into multiple languages simultaneously',
    category: 'Content',
    nodes:
      'Trigger → Parallel(4) → [LLM(→TR), LLM(→DE), LLM(→FR), LLM(→ES)] → Merge → Tool(create_note)',
    difficulty: 'beginner',
  },
  {
    id: 'content-email-drafter',
    name: 'Smart Email Drafter',
    description: 'Draft professional emails with tone analysis',
    category: 'Content',
    nodes:
      'Trigger → LLM(draft email, responseFormat:json) → Condition(tone==professional?) → true: Notification(ready) / false: LLM(adjust tone) → Notification',
    difficulty: 'beginner',
  },
  {
    id: 'content-product-description',
    name: 'Product Description Generator',
    description: 'Generate product descriptions from specs',
    category: 'Content',
    nodes:
      'Trigger → LLM(analyze specs) → Parallel(2) → [LLM(short desc), LLM(long desc+SEO)] → Merge → Tool(create_note)',
    difficulty: 'intermediate',
  },
  {
    id: 'content-meeting-notes',
    name: 'Meeting Notes Summarizer',
    description: 'Process raw meeting notes into structured action items',
    category: 'Content',
    nodes:
      'Trigger → LLM(extract action items, responseFormat:json) → ForEach(action) → Tool(create_task) → done: Notification(tasks created)',
    difficulty: 'intermediate',
  },
  {
    id: 'content-changelog',
    name: 'Changelog Generator',
    description: 'Generate changelog from git commits',
    category: 'Content',
    nodes:
      'Trigger → Tool(git_log) → LLM(categorize commits) → LLM(write changelog) → Tool(write_file) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'content-resume-builder',
    name: 'Resume Optimizer',
    description: 'Optimize resume for specific job descriptions',
    category: 'Content',
    nodes:
      'Trigger → LLM(analyze job desc, responseFormat:json) → LLM(optimize resume sections) → LLM(generate cover letter) → Tool(create_note)',
    difficulty: 'intermediate',
  },
  {
    id: 'content-faq-generator',
    name: 'FAQ Generator from Documents',
    description: 'Generate FAQ from documentation or knowledge base',
    category: 'Content',
    nodes:
      'Trigger → Tool(read_file) → LLM(extract Q&A pairs, responseFormat:json) → ForEach(qa) → Tool(create_note) → done: Aggregate(count) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'content-tone-checker',
    name: 'Content Tone Analyzer',
    description: 'Analyze and adjust content tone for target audience',
    category: 'Content',
    nodes:
      'Trigger → LLM(analyze tone, responseFormat:json) → Switch(tone) → [formal: pass, casual: LLM(formalize), aggressive: LLM(soften)] → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'content-press-release',
    name: 'Press Release Writer',
    description: 'Draft press release with fact-checking',
    category: 'Content',
    nodes:
      'Trigger → LLM(draft release) → LLM(fact-check claims, responseFormat:json) → Condition(all_verified?) → true: Approval → Notification / false: LLM(revise)',
    difficulty: 'advanced',
  },
  {
    id: 'content-hashtag-generator',
    name: 'Smart Hashtag Generator',
    description: 'Generate relevant hashtags for social media posts',
    category: 'Content',
    nodes:
      'Trigger → LLM(analyze content, generate hashtags, responseFormat:json) → Filter(relevance>0.7) → Map(format as #tag) → Notification',
    difficulty: 'beginner',
  },
  {
    id: 'content-proofreader',
    name: 'AI Proofreader Pipeline',
    description: 'Multi-pass proofreading: grammar, style, clarity',
    category: 'Content',
    nodes:
      'Trigger → LLM(grammar check) → LLM(style check) → LLM(clarity check) → Aggregate(combine feedback) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'content-podcast-notes',
    name: 'Podcast Show Notes Generator',
    description: 'Generate structured show notes from transcript',
    category: 'Content',
    nodes:
      'Trigger → Tool(read_file transcript) → LLM(extract topics+timestamps, responseFormat:json) → LLM(write show notes) → Tool(create_note)',
    difficulty: 'intermediate',
  },

  // ============================================================================
  // DATA PROCESSING (16-30)
  // ============================================================================
  {
    id: 'data-csv-analyzer',
    name: 'CSV Data Analyzer',
    description: 'Parse CSV, analyze patterns, generate report',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → Tool(csv_to_json) → LLM(analyze patterns) → Tool(create_note report)',
    difficulty: 'beginner',
  },
  {
    id: 'data-json-transformer',
    name: 'JSON Schema Transformer',
    description: 'Transform JSON data between different schemas',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → SchemaValidator(validate input) → Transformer(reshape) → SchemaValidator(validate output) → Tool(write_file)',
    difficulty: 'intermediate',
  },
  {
    id: 'data-dedup-pipeline',
    name: 'Data Deduplication Pipeline',
    description: 'Find and remove duplicates from datasets',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → Tool(csv_to_json) → Aggregate(unique by field) → Tool(json_to_csv) → Tool(write_file) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'data-multi-source-merge',
    name: 'Multi-Source Data Merger',
    description: 'Fetch data from multiple APIs and merge into one dataset',
    category: 'Data',
    nodes:
      'Trigger → Parallel(3) → [HTTP(api1), HTTP(api2), HTTP(api3)] → Merge(waitAll) → Transformer(combine) → Tool(write_file)',
    difficulty: 'advanced',
  },
  {
    id: 'data-email-extractor',
    name: 'Email Address Extractor',
    description: 'Extract and validate email addresses from text',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → Tool(extract_emails) → ForEach(email) → Tool(validate_email) → done: Filter(valid==true) → Notification',
    difficulty: 'beginner',
  },
  {
    id: 'data-url-checker',
    name: 'Broken Link Checker',
    description: 'Extract URLs from document and check if they are alive',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → Tool(extract_urls) → ForEach(url) → HTTP(HEAD request) → done: Filter(status!=200) → Notification(broken links)',
    difficulty: 'intermediate',
  },
  {
    id: 'data-stats-report',
    name: 'Statistical Report Generator',
    description: 'Calculate statistics and generate visual report',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → Tool(csv_to_json) → Parallel(3) → [Aggregate(sum), Aggregate(avg), Aggregate(count)] → Merge → LLM(write report) → Tool(create_note)',
    difficulty: 'intermediate',
  },
  {
    id: 'data-backup-workflow',
    name: 'Automated Data Backup',
    description: 'Backup files to external storage with verification',
    category: 'Data',
    nodes:
      'Trigger(schedule daily) → Tool(list_files) → ForEach(file) → Tool(read_file) → HTTP(POST to backup) → done: Aggregate(count) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'data-cleanup',
    name: 'Data Cleanup Pipeline',
    description: 'Clean, normalize, and validate data',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → Transformer(trim+lowercase) → Filter(non-empty) → Map(normalize format) → SchemaValidator(check) → Tool(write_file)',
    difficulty: 'intermediate',
  },
  {
    id: 'data-compare',
    name: 'Dataset Comparator',
    description: 'Compare two datasets and find differences',
    category: 'Data',
    nodes:
      'Trigger → Parallel(2) → [Tool(read_file A), Tool(read_file B)] → Merge → Code(find differences) → LLM(explain changes) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'data-aggregation-dashboard',
    name: 'KPI Dashboard Data Collector',
    description: 'Collect KPI data from multiple sources',
    category: 'Data',
    nodes:
      'Trigger(schedule hourly) → Parallel(4) → [HTTP(sales API), HTTP(users API), HTTP(revenue API), HTTP(support API)] → Merge → Transformer(format KPIs) → DataStore(set latest-kpis) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'data-log-analyzer',
    name: 'Log File Analyzer',
    description: 'Parse and analyze log files for patterns and errors',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file) → Code(parse log lines) → Filter(level==ERROR) → Aggregate(groupBy errorType) → LLM(root cause analysis) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'data-currency-converter',
    name: 'Bulk Currency Converter',
    description: 'Convert prices across multiple currencies',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file prices.csv) → Tool(csv_to_json) → ForEach(item) → Tool(convert_currency) → done: Tool(json_to_csv) → Tool(write_file)',
    difficulty: 'intermediate',
  },
  {
    id: 'data-contact-enrichment',
    name: 'Contact Data Enrichment',
    description: 'Enrich contact list with additional data from APIs',
    category: 'Data',
    nodes:
      'Trigger → Tool(list_contacts) → ForEach(contact) → HTTP(clearbit/fullcontact API) → done: Map(merge data) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'data-sentiment-batch',
    name: 'Batch Sentiment Analysis',
    description: 'Analyze sentiment of customer feedback in bulk',
    category: 'Data',
    nodes:
      'Trigger → Tool(read_file reviews) → Tool(csv_to_json) → ForEach(review) → LLM(sentiment, responseFormat:json) → done: Aggregate(groupBy sentiment) → Notification',
    difficulty: 'intermediate',
  },

  // ============================================================================
  // MONITORING & ALERTS (31-45)
  // ============================================================================
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

  // ============================================================================
  // DEVOPS & ENGINEERING (46-60)
  // ============================================================================
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

  // ============================================================================
  // BUSINESS & PRODUCTIVITY (61-75)
  // ============================================================================
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

  // ============================================================================
  // API & INTEGRATION (76-90)
  // ============================================================================
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

  // ============================================================================
  // PERSONAL PRODUCTIVITY (91-105)
  // ============================================================================
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

  // ============================================================================
  // SECURITY & COMPLIANCE (106-115)
  // ============================================================================
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

  // ============================================================================
  // RESEARCH & ANALYSIS (116-125)
  // ============================================================================
  {
    id: 'research-competitor',
    name: 'Competitor Analysis Report',
    description: 'Research competitors and generate analysis',
    category: 'Research',
    nodes:
      'Trigger → ForEach(competitor) → HTTP(fetch website) → LLM(analyze offering) → done: LLM(comparative analysis) → Tool(create_note report) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'research-trend-analyzer',
    name: 'Market Trend Analyzer',
    description: 'Analyze market trends from multiple data sources',
    category: 'Research',
    nodes:
      'Trigger(schedule weekly) → Parallel → [HTTP(Google Trends), HTTP(social media trends), HTTP(news API)] → Merge → LLM(identify emerging trends) → Tool(create_note) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'research-paper-summarizer',
    name: 'Research Paper Summarizer',
    description: 'Summarize academic papers with key findings',
    category: 'Research',
    nodes:
      'Trigger → Tool(read_file paper) → LLM(extract key findings, methodology, conclusions, responseFormat:json) → LLM(write executive summary) → Tool(create_note) → Tool(create_bookmark)',
    difficulty: 'intermediate',
  },
  {
    id: 'research-tech-radar',
    name: 'Technology Radar Builder',
    description: 'Build a technology radar from industry signals',
    category: 'Research',
    nodes:
      'Trigger(schedule monthly) → Parallel → [HTTP(HN API), HTTP(Reddit API), HTTP(Dev.to API)] → Merge → LLM(categorize technologies: adopt/trial/assess/hold, responseFormat:json) → Tool(create_note radar)',
    difficulty: 'advanced',
  },
  {
    id: 'research-patent-monitor',
    name: 'Patent Filing Monitor',
    description: 'Monitor patent filings in specific domains',
    category: 'Research',
    nodes:
      'Trigger(schedule weekly) → HTTP(patent API search) → Filter(filed this week) → ForEach(patent) → LLM(summarize in plain language) → done: LLM(compile digest) → Notification',
    difficulty: 'advanced',
  },
  {
    id: 'research-ab-test-analyzer',
    name: 'A/B Test Results Analyzer',
    description: 'Analyze A/B test results and determine winner',
    category: 'Research',
    nodes:
      'Trigger → HTTP(experiment API) → Code(statistical significance test) → Condition(p<0.05?) → true: LLM(explain winner + recommend) → Notification / false: Notification(not significant yet, wait)',
    difficulty: 'advanced',
  },
  {
    id: 'research-market-size',
    name: 'Market Size Estimator',
    description: 'Estimate market size using multiple data points',
    category: 'Research',
    nodes:
      'Trigger → Parallel → [HTTP(industry stats), HTTP(census data), HTTP(trade reports)] → Merge → LLM(estimate TAM/SAM/SOM, responseFormat:json) → Tool(create_note analysis)',
    difficulty: 'advanced',
  },
  {
    id: 'research-arxiv-digest',
    name: 'ArXiv Paper Digest',
    description: 'Daily digest of new papers in your field',
    category: 'Research',
    nodes:
      'Trigger(schedule daily) → HTTP(ArXiv API query) → Filter(category match) → Map(extract title+abstract) → LLM(rank by relevance) → Tool(create_note digest) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'research-keyword-tracker',
    name: 'SEO Keyword Tracker',
    description: 'Track keyword rankings and generate SEO report',
    category: 'Research',
    nodes:
      'Trigger(schedule weekly) → ForEach(keyword) → HTTP(SERP API) → done: Map(extract rank+change) → DataStore(set rankings) → LLM(trend analysis) → Notification',
    difficulty: 'intermediate',
  },
  {
    id: 'research-industry-digest',
    name: 'Industry News Digest with Insights',
    description: 'Collect industry news and generate strategic insights',
    category: 'Research',
    nodes:
      'Trigger(schedule daily) → HTTP(news API industry filter) → Filter(today) → LLM(summarize each, responseFormat:json) → LLM(strategic insights + opportunities) → Tool(create_note) → Notification',
    difficulty: 'intermediate',
  },
];

/** Get templates by category */
export function getTemplatesByCategory(): Record<string, typeof WORKFLOW_TEMPLATE_IDEAS> {
  const result: Record<string, typeof WORKFLOW_TEMPLATE_IDEAS> = {};
  for (const t of WORKFLOW_TEMPLATE_IDEAS) {
    if (!result[t.category]) result[t.category] = [];
    result[t.category]!.push(t);
  }
  return result;
}

/** Get template categories with counts */
export function getTemplateCategoryCounts(): Array<{ category: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const t of WORKFLOW_TEMPLATE_IDEAS) {
    counts[t.category] = (counts[t.category] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
