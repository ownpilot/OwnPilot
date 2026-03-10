#!/usr/bin/env node
/**
 * MCP + CLI Workspace E2E Test
 *
 * Tests the full flow:
 * 1. Create workspace with .mcp.json + context files
 * 2. Spawn CLI in that workspace
 * 3. Verify CLI picks up context and responds
 *
 * Usage:
 *   npx tsx packages/gateway/src/mcp/e2e-test.ts [gemini|codex|claude]
 */

import { ensureWorkspace } from './workspace.js';
import { CliChatProvider } from '../services/cli-chat-provider.js';
import type { CliChatBinary } from '../services/cli-chat-provider.js';
import { isBinaryInstalled } from '../services/binary-utils.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function log(msg: string) {
  console.log(`${C.dim}[${new Date().toISOString().slice(11, 19)}]${C.reset} ${msg}`);
}

// =============================================================================
// Step 1: Test workspace creation
// =============================================================================

async function testWorkspace(): Promise<string> {
  log(`${C.bold}Step 1: Creating workspace${C.reset}`);

  const { dir, mcpConfigPath } = await ensureWorkspace({
    gatewayUrl: 'http://localhost:8080',
  });

  log(`  Workspace dir: ${dir}`);

  // Verify files exist
  const files = ['.mcp.json', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];
  for (const file of files) {
    const path = join(dir, file);
    if (existsSync(path)) {
      const size = readFileSync(path, 'utf-8').length;
      log(`  ${C.green}✓${C.reset} ${file} (${size} bytes)`);
    } else {
      log(`  ${C.red}✗${C.reset} ${file} — MISSING`);
      throw new Error(`File missing: ${path}`);
    }
  }

  // Verify .mcp.json is valid JSON with correct structure
  const mcpContent = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
  if (mcpContent.mcpServers?.ownpilot?.url) {
    log(`  ${C.green}✓${C.reset} .mcp.json → ${mcpContent.mcpServers.ownpilot.url}`);
  } else {
    throw new Error('.mcp.json missing mcpServers.ownpilot.url');
  }

  log(`  ${C.green}Workspace ready${C.reset}\n`);
  return dir;
}

// =============================================================================
// Step 2: Test CLI in workspace
// =============================================================================

async function testCliInWorkspace(binary: CliChatBinary, workspaceDir: string): Promise<boolean> {
  log(`${C.bold}Step 2: Testing ${binary} CLI in workspace${C.reset}`);

  if (!isBinaryInstalled(binary)) {
    log(`  ${C.yellow}⚠ ${binary} not installed, skipping${C.reset}\n`);
    return false;
  }

  const provider = new CliChatProvider({
    binary,
    cwd: workspaceDir,
    timeout: 90_000,
    // No model specified — use CLI default
  });

  if (!provider.isReady()) {
    log(`  ${C.red}✗ ${binary} not ready${C.reset}\n`);
    return false;
  }

  // Test 1: Basic response
  log(`  ${C.cyan}Test A: Basic response...${C.reset}`);
  const start = Date.now();
  const result = await provider.complete({
    messages: [{ role: 'user', content: 'Reply with exactly one word: WORKSPACE_OK' }],
    model: { model: '' }, // use CLI default
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.ok) {
    const content = result.value.content.trim();
    log(`  ${C.green}✓${C.reset} Response (${elapsed}s): ${content.slice(0, 100)}`);
  } else {
    log(`  ${C.red}✗${C.reset} Failed (${elapsed}s): ${result.error.message}`);
    return false;
  }

  // Test 2: Check if CLI sees the context file
  log(`  ${C.cyan}Test B: Context file awareness...${C.reset}`);
  const start2 = Date.now();
  const result2 = await provider.complete({
    messages: [
      {
        role: 'user',
        content: 'Is there an AGENTS.md file in your current workspace? Reply YES or NO only.',
      },
    ],
    model: { model: '' },
  });
  const elapsed2 = ((Date.now() - start2) / 1000).toFixed(1);

  if (result2.ok) {
    const content = result2.value.content.trim();
    const seesFile = content.toUpperCase().includes('YES');
    log(
      `  ${seesFile ? C.green + '✓' : C.yellow + '~'} ${C.reset} Context awareness (${elapsed2}s): ${content.slice(0, 100)}`
    );
  } else {
    log(`  ${C.red}✗${C.reset} Failed (${elapsed2}s): ${result2.error.message}`);
  }

  // Test 3: Check if MCP tools are available (this needs gateway running)
  log(`  ${C.cyan}Test C: MCP tool discovery...${C.reset}`);
  const start3 = Date.now();
  const result3 = await provider.complete({
    messages: [
      {
        role: 'user',
        content:
          'Do you have access to an MCP server called "ownpilot"? Check your available MCP tools. Reply YES or NO, then list any ownpilot tools you see.',
      },
    ],
    model: { model: '' },
  });
  const elapsed3 = ((Date.now() - start3) / 1000).toFixed(1);

  if (result3.ok) {
    const content = result3.value.content.trim();
    const hasMcp =
      content.toLowerCase().includes('search_tools') ||
      content.toLowerCase().includes('use_tool') ||
      content.toUpperCase().includes('YES');
    log(
      `  ${hasMcp ? C.green + '✓' : C.yellow + '~'} ${C.reset} MCP discovery (${elapsed3}s): ${content.slice(0, 200)}`
    );
    if (!hasMcp) {
      log(
        `  ${C.dim}  (MCP tools not found — is OwnPilot gateway running on localhost:8080?)${C.reset}`
      );
    }
  } else {
    log(`  ${C.red}✗${C.reset} Failed (${elapsed3}s): ${result3.error.message}`);
  }

  // Test 4: Actual tool execution via MCP — call add_task directly
  log(`  ${C.cyan}Test D: Tool execution via MCP...${C.reset}`);
  const start4 = Date.now();
  const result4 = await provider.complete({
    messages: [
      {
        role: 'user',
        content:
          'Use the add_task MCP tool to create a task with title "E2E test from Gemini CLI" and priority "high". Then confirm it was created.',
      },
    ],
    model: { model: '' },
  });
  const elapsed4 = ((Date.now() - start4) / 1000).toFixed(1);

  if (result4.ok) {
    const content = result4.value.content.trim();
    const usedTool =
      content.toLowerCase().includes('created') ||
      content.toLowerCase().includes('success') ||
      content.toLowerCase().includes('e2e test');
    log(
      `  ${usedTool ? C.green + '✓' : C.yellow + '~'} ${C.reset} Tool execution (${elapsed4}s): ${content.slice(0, 300)}`
    );
  } else {
    log(`  ${C.red}✗${C.reset} Failed (${elapsed4}s): ${result4.error.message}`);
  }

  log('');
  return true;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const cli = (process.argv[2] || 'gemini') as CliChatBinary;

  log(`${C.bold}OwnPilot MCP + CLI E2E Test${C.reset}`);
  log(`CLI: ${cli}\n`);

  try {
    const workspaceDir = await testWorkspace();
    const success = await testCliInWorkspace(cli, workspaceDir);

    log(`${C.bold}Summary${C.reset}`);
    if (success) {
      log(`  ${C.green}✓ ${cli} works with OwnPilot workspace${C.reset}`);
    } else {
      log(`  ${C.yellow}⚠ ${cli} could not be tested${C.reset}`);
    }
  } catch (error) {
    log(`${C.red}FATAL: ${error instanceof Error ? error.message : String(error)}${C.reset}`);
    process.exit(1);
  }
}

main();
