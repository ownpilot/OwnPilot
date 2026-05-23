/**
 * Data processing workflow templates (15 entries).
 *
 * Parsing, transforming, enriching, aggregating, comparing — workflows
 * that operate on structured data (CSV/JSON/log files) rather than text.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const DATA_TEMPLATES: WorkflowTemplateIdea[] = [
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
];
