/**
 * Content & writing workflow templates (15 entries).
 *
 * Drafting, summarising, translating, formatting — workflows centred on
 * generating or transforming text artifacts.
 */

import type { WorkflowTemplateIdea } from './types.js';

export const CONTENT_TEMPLATES: WorkflowTemplateIdea[] = [
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
];
