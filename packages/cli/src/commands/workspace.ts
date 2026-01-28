/**
 * Workspace management commands
 */

import { input, select, confirm, checkbox } from '@inquirer/prompts';

interface WorkspaceConfig {
  id: string;
  name: string;
  description?: string;
  channels: string[];
  agent: {
    provider: string;
    model: string;
    systemPrompt: string;
  };
}

// In-memory workspace storage (would be persisted in real implementation)
const workspaces = new Map<string, WorkspaceConfig>();

// Simulated channels (would come from channel store)
const availableChannels = [
  { id: 'tg-1', name: 'Personal Bot', type: 'telegram' },
  { id: 'dc-1', name: 'Dev Server', type: 'discord' },
  { id: 'sl-1', name: 'Work Team', type: 'slack' },
];

// Available providers and models
const providers = [
  { name: 'OpenAI', value: 'openai', models: ['gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'] },
  { name: 'Anthropic', value: 'anthropic', models: ['claude-opus-4.5', 'claude-sonnet-4.5'] },
  { name: 'Zhipu AI', value: 'zhipu', models: ['glm-4.7', 'glm-4.7-plus'] },
  { name: 'DeepSeek', value: 'deepseek', models: ['deepseek-v3.2', 'deepseek-r2'] },
  { name: 'Groq', value: 'groq', models: ['llama-4-70b', 'mixtral-8x22b'] },
];

/**
 * List all workspaces
 */
export async function workspaceList(): Promise<void> {
  console.log('\nWorkspaces:');
  console.log('─'.repeat(70));

  if (workspaces.size === 0) {
    console.log('  No workspaces configured yet.');
    console.log('  Use "ownpilot workspace create" to create one.\n');
    return;
  }

  for (const ws of workspaces.values()) {
    console.log(`\n  📁 ${ws.name}`);
    if (ws.description) {
      console.log(`     ${ws.description}`);
    }
    console.log(`     Provider: ${ws.agent.provider} / ${ws.agent.model}`);
    console.log(`     Channels: ${ws.channels.length > 0 ? ws.channels.join(', ') : 'None'}`);
  }
  console.log();
}

/**
 * Create a new workspace
 */
export async function workspaceCreate(): Promise<void> {
  console.log('\n🏗️  Create a new workspace\n');

  const name = await input({
    message: 'Workspace name:',
    validate: (value: string) => (value.length > 0 ? true : 'Name is required'),
  });

  const description = await input({
    message: 'Description (optional):',
  });

  // Select provider
  const provider = await select({
    message: 'Select AI provider:',
    choices: providers.map((p) => ({
      name: p.name,
      value: p.value,
    })),
  });

  // Select model
  const selectedProvider = providers.find((p) => p.value === provider)!;
  const model = await select({
    message: 'Select model:',
    choices: selectedProvider.models.map((m) => ({
      name: m,
      value: m,
    })),
  });

  // Set system prompt
  const systemPrompt = await input({
    message: 'System prompt:',
    default: 'You are a helpful AI assistant.',
  });

  // Select channels
  let channels: string[] = [];
  if (availableChannels.length > 0) {
    const selectChannels = await confirm({
      message: 'Associate channels with this workspace?',
      default: true,
    });

    if (selectChannels) {
      channels = await checkbox({
        message: 'Select channels:',
        choices: availableChannels.map((ch) => ({
          name: `${ch.name} (${ch.type})`,
          value: ch.id,
        })),
      });
    }
  }

  // Generate ID
  const id = `ws-${Date.now().toString(36)}`;

  // Store workspace
  const workspace: WorkspaceConfig = {
    id,
    name,
    description: description || undefined,
    channels,
    agent: {
      provider,
      model,
      systemPrompt,
    },
  };

  workspaces.set(id, workspace);

  console.log(`\n✅ Workspace "${name}" created!`);
  console.log(`   ID: ${id}`);
  console.log(`   Provider: ${provider} / ${model}`);
  console.log(`   Channels: ${channels.length > 0 ? channels.join(', ') : 'None'}`);
  console.log('\nRun "ownpilot start" to activate the workspace.\n');
}

/**
 * Delete a workspace
 */
export async function workspaceDelete(options: { id?: string }): Promise<void> {
  if (workspaces.size === 0) {
    console.log('\nNo workspaces configured.\n');
    return;
  }

  let workspaceId = options.id;

  if (!workspaceId) {
    const choices = Array.from(workspaces.values()).map((ws) => ({
      name: ws.name,
      value: ws.id,
    }));

    workspaceId = await select({
      message: 'Select workspace to delete:',
      choices,
    });
  }

  if (!workspaceId) {
    console.log('\n❌ No workspace selected.\n');
    return;
  }

  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    console.log(`\n❌ Workspace not found: ${workspaceId}\n`);
    return;
  }

  const confirmed = await confirm({
    message: `Delete workspace "${workspace.name}"?`,
    default: false,
  });

  if (confirmed) {
    workspaces.delete(workspaceId);
    console.log(`\n✅ Workspace "${workspace.name}" deleted.\n`);
  } else {
    console.log('\nCancelled.\n');
  }
}

/**
 * Switch active workspace
 */
export async function workspaceSwitch(options: { id?: string }): Promise<void> {
  if (workspaces.size === 0) {
    console.log('\nNo workspaces configured.\n');
    return;
  }

  let workspaceId = options.id;

  if (!workspaceId) {
    const choices = Array.from(workspaces.values()).map((ws) => ({
      name: ws.name,
      value: ws.id,
      description: `${ws.agent.provider} / ${ws.agent.model}`,
    }));

    workspaceId = await select({
      message: 'Select workspace to activate:',
      choices,
    });
  }

  if (!workspaceId) {
    console.log('\n❌ No workspace selected.\n');
    return;
  }

  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    console.log(`\n❌ Workspace not found: ${workspaceId}\n`);
    return;
  }

  // In real implementation, this would send message to gateway
  console.log(`\n✅ Switched to workspace "${workspace.name}"\n`);
}

/**
 * Show workspace details
 */
export async function workspaceInfo(options: { id?: string }): Promise<void> {
  if (workspaces.size === 0) {
    console.log('\nNo workspaces configured.\n');
    return;
  }

  let workspaceId = options.id;

  if (!workspaceId) {
    const choices = Array.from(workspaces.values()).map((ws) => ({
      name: ws.name,
      value: ws.id,
    }));

    workspaceId = await select({
      message: 'Select workspace:',
      choices,
    });
  }

  if (!workspaceId) {
    console.log('\n❌ No workspace selected.\n');
    return;
  }

  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    console.log(`\n❌ Workspace not found: ${workspaceId}\n`);
    return;
  }

  console.log(`\n📁 Workspace: ${workspace.name}`);
  console.log('─'.repeat(50));
  console.log(`ID:          ${workspace.id}`);
  if (workspace.description) {
    console.log(`Description: ${workspace.description}`);
  }
  console.log(`\nAI Configuration:`);
  console.log(`  Provider:  ${workspace.agent.provider}`);
  console.log(`  Model:     ${workspace.agent.model}`);
  console.log(`  Prompt:    ${workspace.agent.systemPrompt.slice(0, 50)}...`);
  console.log(`\nChannels (${workspace.channels.length}):`);
  if (workspace.channels.length > 0) {
    for (const chId of workspace.channels) {
      const ch = availableChannels.find((c) => c.id === chId);
      if (ch) {
        console.log(`  - ${ch.name} (${ch.type})`);
      } else {
        console.log(`  - ${chId} (unknown)`);
      }
    }
  } else {
    console.log('  No channels associated');
  }
  console.log();
}
