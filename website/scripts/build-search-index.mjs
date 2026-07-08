/**
 * Build-time search index generator.
 *
 * Reads each doc page JSX, extracts headings, paragraphs, and callout
 * text using regex, then writes a rich search-index.json consumed by
 * the DocSearch component. Run before `vite build`.
 *
 * Usage:  node scripts/build-search-index.mjs
 *         node scripts/build-search-index.mjs --watch   (re-run on file change)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '../src/pages/docs');
const OUT_FILE = path.resolve(__dirname, '../src/lib/search-index.ts');

// Regex helpers for JSX text extraction
function extractTextBetweenTags(text, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'gi');
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push(match[1].replace(/\s+/g, ' ').trim());
  }
  return results;
}

// Extract text from <Callout type="..." title="..."> blocks
function extractCalloutText(text) {
  const regex = /<Callout[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/Callout>/gi;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const title = match[1];
    const body = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (title) results.push(title);
    if (body && body.length > 10) results.push(body);
  }
  return results;
}

// Extract table content
function extractTableText(text) {
  const regex = /<td[^>]*>([^<]+)<\/td>/gi;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push(match[1].replace(/\s+/g, ' ').trim());
  }
  return results;
}

// Page metadata mapping (path, section, keywords)
const PAGE_META = {
  AgentsPage: { path: '/docs/agents', section: 'Core Concepts', keywords: ['agent', 'soul', 'personality', 'crew', 'identity', 'autonomous'] },
  ApiReferencePage: { path: '/docs/api-reference', section: 'Operations', keywords: ['api', 'rest', 'endpoint', 'reference', 'gateway'] },
  ArchitecturePage: { path: '/docs/architecture', section: 'Getting Started', keywords: ['architecture', 'packages', 'monorepo', 'core', 'gateway', 'system design'] },
  ChannelsPage: { path: '/docs/channels', section: 'Core Concepts', keywords: ['telegram', 'whatsapp', 'messaging', 'channel', 'bot'] },
  CodingAgentsPage: { path: '/docs/coding-agents', section: 'Core Concepts', keywords: ['coding', 'claude code', 'codex', 'gemini', 'cli', 'terminal'] },
  ConfigurationPage: { path: '/docs/configuration', section: 'Getting Started', keywords: ['config', 'settings', 'providers', 'auth', 'logging'] },
  DeploymentPage: { path: '/docs/deployment', section: 'Operations', keywords: ['deploy', 'production', 'docker', 'proxy', 'nginx', 'postgres'] },
  EdgeDevicesPage: { path: '/docs/edge-devices', section: 'Core Concepts', keywords: ['iot', 'edge', 'device', 'mqtt', 'raspberry pi', 'esp32', 'telemetry'] },
  InstallationPage: { path: '/docs/installation', section: 'Getting Started', keywords: ['docker', 'manual', 'install', 'configure', 'environment', '.env'] },
  IntroductionPage: { path: '/docs/introduction', section: 'Getting Started', keywords: ['overview', 'about', 'privacy', 'self-hosted', 'ai assistant'] },
  McpPage: { path: '/docs/mcp', section: 'Core Concepts', keywords: ['mcp', 'model context protocol', 'claude', 'external', 'integration'] },
  PersonalDataPage: { path: '/docs/personal-data', section: 'Core Concepts', keywords: ['tasks', 'notes', 'bookmarks', 'contacts', 'calendar', 'expenses', 'habits', 'data'] },
  ProvidersPage: { path: '/docs/providers', section: 'Core Concepts', keywords: ['provider', 'model', 'api', 'openai', 'anthropic', 'ollama', 'lm studio', 'local'] },
  QuickStartPage: { path: '/docs/quick-start', section: 'Getting Started', keywords: ['docker', 'compose', 'setup', 'installation', 'start'] },
  SecurityPage: { path: '/docs/security', section: 'Operations', keywords: ['security', 'sandbox', 'pii', 'encryption', 'audit', 'permissions'] },
  ToolsPage: { path: '/docs/tools', section: 'Core Concepts', keywords: ['tool', 'code', 'search', 'browser', 'iot', 'automation', 'execution'] },
  WorkflowsPage: { path: '/docs/automation/workflows', section: 'Automation', keywords: ['workflow', 'automation', 'drag-drop', 'pipeline', 'llm', 'node'] },
};

function extractTitle(text) {
  const h1Match = text.match(/<h1>([^<]+)<\/h1>/);
  return h1Match ? h1Match[1].trim() : 'Untitled';
}

function extractDescription(text) {
  // First meaningful paragraph after h1 that's not in a Callout
  const lines = text.split('\n');
  let afterH1 = false;
  let firstP = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('<h1>')) { afterH1 = true; continue; }
    if (afterH1 && trimmed.startsWith('<p>') && !trimmed.startsWith('<p class=')) {
      firstP = trimmed.replace(/<\/?[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (firstP.length > 20) break;
    }
  }
  return firstP || '';
}

function build() {
  const entries = [];
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
    const pageName = file.replace('.tsx', '');
    const meta = PAGE_META[pageName];
    if (!meta) {
      console.warn(`  ⚠  No metadata for ${file}, skipping`);
      continue;
    }

    const title = extractTitle(content);
    const description = extractDescription(content);

    // Extract all text content for full-text search
    const headings = [
      ...extractTextBetweenTags(content, 'h1'),
      ...extractTextBetweenTags(content, 'h2'),
      ...extractTextBetweenTags(content, 'h3'),
    ];
    const paragraphs = extractTextBetweenTags(content, 'p')
      .filter(p => p.length > 15 && !p.startsWith('{'));
    const calloutText = extractCalloutText(content);
    const tableText = extractTableText(content);

    // Build rich text content
    const bodyText = [
      ...headings,
      ...paragraphs,
      ...calloutText,
      ...tableText,
    ].join(' ');

    entries.push({
      path: meta.path,
      title,
      description: description || headings[0] || title,
      section: meta.section,
      keywords: meta.keywords,
      content: bodyText.substring(0, 3000), // limit size
    });
  }

  // Sort: Getting Started first, then Core Concepts, then others
  const sortOrder = { 'Getting Started': 0, 'Core Concepts': 1, Automation: 2, Operations: 3 };
  entries.sort((a, b) => (sortOrder[a.section] ?? 99) - (sortOrder[b.section] ?? 99));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const tsContent = `// Auto-generated by scripts/build-search-index.mjs — DO NOT EDIT
// Run \`node scripts/build-search-index.mjs\` after adding/editing doc pages.

export interface SearchEntry {
  path: string;
  title: string;
  description: string;
  section: string;
  keywords: string[];
  content: string;
}

export const SEARCH_INDEX: SearchEntry[] = ${JSON.stringify(entries, null, 2)};
`;
  fs.writeFileSync(OUT_FILE, tsContent, 'utf8');
  console.log(`✅ Search index generated: ${entries.length} pages → ${OUT_FILE}`);
}

build();

// Watch mode
if (process.argv.includes('--watch')) {
  console.log('👀 Watching for changes...');
  fs.watch(DOCS_DIR, (event, filename) => {
    if (filename?.endsWith('.tsx')) {
      console.log(`\n📝 ${filename} changed, rebuilding...`);
      build();
    }
  });
}
