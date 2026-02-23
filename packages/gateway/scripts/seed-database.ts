/**
 * Database Seed Script
 *
 * Seeds the database with default data for a fresh installation.
 * Run with: npx tsx scripts/seed-database.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = process.env.API_URL || 'http://localhost:8080/api/v1';

// ============================================================================
// Load Default Agents from JSON
// ============================================================================

interface AgentJsonData {
  id: string;
  name: string;
  emoji?: string;
  category: string;
  systemPrompt: string;
  tools?: string[];
  toolGroups?: string[];
  dataAccess?: string[];
  triggers?: {
    keywords: string[];
    description: string;
  };
  config: {
    maxTokens: number;
    temperature: number;
    maxTurns: number;
    maxToolCalls: number;
  };
}

interface AgentsJson {
  version: string;
  agents: AgentJsonData[];
}

function loadDefaultAgents(): Array<{
  name: string;
  systemPrompt: string;
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
  maxTurns: number;
  maxToolCalls: number;
  tools?: string[];
}> {
  const dataFile = path.join(__dirname, '..', 'data', 'seeds', 'default-agents.json');

  try {
    if (!fs.existsSync(dataFile)) {
      console.warn(`Default agents file not found: ${dataFile}`);
      return [];
    }

    const content = fs.readFileSync(dataFile, 'utf-8');
    const data: AgentsJson = JSON.parse(content);

    return data.agents.map((agent) => ({
      name: agent.emoji ? `${agent.emoji} ${agent.name}` : agent.name,
      systemPrompt: agent.systemPrompt,
      provider: 'default', // Use dynamic default - resolved at runtime
      model: 'default', // Use dynamic default - resolved at runtime
      maxTokens: agent.config.maxTokens,
      temperature: agent.config.temperature,
      maxTurns: agent.config.maxTurns,
      maxToolCalls: agent.config.maxToolCalls,
      tools: [...(agent.tools ?? []), ...(agent.toolGroups ?? [])],
    }));
  } catch (error) {
    console.error('Failed to load default agents:', error);
    return [];
  }
}

const defaultAgents = loadDefaultAgents();

// ============================================================================
// Sample Data
// ============================================================================

const sampleTasks = [
  {
    title: 'Review project documentation',
    description: 'Go through the README and docs to understand the project structure',
    status: 'pending',
    priority: 'normal',
    category: 'work',
  },
  {
    title: 'Set up development environment',
    description: 'Install dependencies and configure local environment',
    status: 'completed',
    priority: 'high',
    category: 'work',
  },
  {
    title: 'Test API endpoints',
    description: 'Verify all REST endpoints are working correctly',
    status: 'pending',
    priority: 'high',
    category: 'work',
  },
];

const sampleNotes = [
  {
    title: 'Getting Started',
    content: `# Welcome to OwnPilot

This is your personal AI assistant platform. Here are some things you can do:

- Chat with AI using different providers (OpenAI, Anthropic, Google, etc.)
- Create and manage tasks, notes, and bookmarks
- Set up automated triggers and workflows
- Track your expenses and activities

## Quick Tips

1. Use the sidebar to navigate between features
2. Configure your API keys in Settings
3. Customize agents for different use cases`,
    category: 'guide',
    tags: ['welcome', 'guide'],
    isPinned: true,
  },
];

const sampleMemories = [
  {
    type: 'preference',
    content:
      'User prefers concise responses with code examples when discussing programming topics.',
    importance: 0.8,
    tags: ['preference', 'communication'],
  },
  {
    type: 'fact',
    content:
      'This AI assistant system supports multiple providers including OpenAI, Anthropic, Google, and local models via Ollama.',
    importance: 0.7,
    tags: ['system', 'capabilities'],
  },
];

const sampleGoals = [
  {
    title: 'Learn the OwnPilot system',
    description: 'Understand all features and capabilities of the platform',
    status: 'active',
    priority: 5,
    progress: 20,
  },
  {
    title: 'Set up automation workflows',
    description: 'Configure triggers and plans for automated tasks',
    status: 'active',
    priority: 4,
    progress: 0,
  },
];

// ============================================================================
// Seed Functions
// ============================================================================

async function seedAgents() {
  console.log('Seeding agents...');
  console.log(`  Found ${defaultAgents.length} agents in default-agents.json`);

  if (defaultAgents.length === 0) {
    console.warn('  No agents found! Check that data/seeds/default-agents.json exists.');
    return;
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const agent of defaultAgents) {
    try {
      const response = await fetch(`${API_BASE}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent),
      });

      const result = await response.json();
      if (result.success) {
        console.log(`  ✓ Created: ${agent.name}`);
        created++;
      } else {
        // Agent might already exist
        if (
          result.error?.message?.includes('already exists') ||
          result.error?.message?.includes('UNIQUE')
        ) {
          console.log(`  → Exists: ${agent.name}`);
          skipped++;
        } else {
          console.error(`  ✗ Failed: ${agent.name} - ${result.error?.message}`);
          failed++;
        }
      }
    } catch (error) {
      console.error(`  ✗ Error: ${agent.name} -`, error);
      failed++;
    }
  }

  console.log(`  Summary: ${created} created, ${skipped} existing, ${failed} failed`);
}

async function seedTasks() {
  console.log('Seeding tasks...');

  for (const task of sampleTasks) {
    try {
      const response = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });

      const result = await response.json();
      if (result.success) {
        console.log(`  Created task: ${task.title}`);
      } else {
        console.error(`  Failed to create task ${task.title}:`, result.error);
      }
    } catch (error) {
      console.error(`  Error creating task ${task.title}:`, error);
    }
  }
}

async function seedNotes() {
  console.log('Seeding notes...');

  for (const note of sampleNotes) {
    try {
      const response = await fetch(`${API_BASE}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });

      const result = await response.json();
      if (result.success) {
        console.log(`  Created note: ${note.title}`);
      } else {
        console.error(`  Failed to create note ${note.title}:`, result.error);
      }
    } catch (error) {
      console.error(`  Error creating note ${note.title}:`, error);
    }
  }
}

async function seedMemories() {
  console.log('Seeding memories...');

  for (const memory of sampleMemories) {
    try {
      const response = await fetch(`${API_BASE}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memory),
      });

      const result = await response.json();
      if (result.success) {
        console.log(`  Created memory: ${memory.content.slice(0, 50)}...`);
      } else {
        console.error(`  Failed to create memory:`, result.error);
      }
    } catch (error) {
      console.error(`  Error creating memory:`, error);
    }
  }
}

async function seedGoals() {
  console.log('Seeding goals...');

  for (const goal of sampleGoals) {
    try {
      const response = await fetch(`${API_BASE}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(goal),
      });

      const result = await response.json();
      if (result.success) {
        console.log(`  Created goal: ${goal.title}`);
      } else {
        console.error(`  Failed to create goal ${goal.title}:`, result.error);
      }
    } catch (error) {
      console.error(`  Error creating goal ${goal.title}:`, error);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('OwnPilot Database Seed Script');
  console.log('='.repeat(60));
  console.log(`API Base: ${API_BASE}\n`);

  // Check if API is reachable
  try {
    const health = await fetch(`${API_BASE.replace('/api/v1', '')}/health`);
    if (!health.ok) {
      throw new Error('API not responding');
    }
    console.log('API is reachable\n');
  } catch {
    console.error('ERROR: Cannot reach API at', API_BASE);
    console.error('Make sure the server is running: pnpm dev\n');
    process.exit(1);
  }

  await seedAgents();
  console.log('');
  await seedTasks();
  console.log('');
  await seedNotes();
  console.log('');
  await seedMemories();
  console.log('');
  await seedGoals();

  console.log('\n' + '='.repeat(60));
  console.log('Seed process completed!');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
