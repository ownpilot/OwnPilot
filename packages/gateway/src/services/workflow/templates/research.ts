/**
 * Research & analysis workflow templates (10 entries).
 *
 * Competitor sweeps, trend analysis, paper summaries, market sizing —
 * workflows that gather and synthesise external signal.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const RESEARCH_TEMPLATES: WorkflowTemplateIdea[] = [
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
