/**
 * Environment configuration loader for OpenClaw Bridge Daemon
 * Validates required env vars at startup.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env file manually before anything else
// We avoid dotenv/config auto-import to be explicit
function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env file not found — rely on environment variables
  }
}

loadDotEnv();

function requireEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined || val === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`${key} must be an integer, got: ${raw}`);
  return parsed;
}

function optionalEnvFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) throw new Error(`${key} must be a number, got: ${raw}`);
  return parsed;
}

export const config = {
  port: optionalEnvInt('PORT', 9090),
  bridgeApiKey: requireEnv('BRIDGE_API_KEY'),
  // Optional: Claude Code uses OAuth auth by default (keyring).
  // Set this only if you want to use API key auth instead of OAuth.
  anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),

  // Minimax API for LLM intent routing (Faz 3).
  // Compatible with @anthropic-ai/sdk via baseURL override.
  minimaxApiKey: optionalEnv('MINIMAX_API_KEY', ''),
  minimaxBaseUrl: optionalEnv('MINIMAX_BASE_URL', 'https://api.minimax.io/anthropic'),
  minimaxModel: optionalEnv('MINIMAX_MODEL', 'MiniMax-M2.5'),
  claudeModel: optionalEnv('CLAUDE_MODEL', 'claude-sonnet-4-6'),
  // Spawn timeout: how long to wait for CC --print to produce a result before SIGTERM.
  // GSD plan-phase (research+plan+verify) can take 20-30 min. Default: 30 min.
  ccSpawnTimeoutMs: optionalEnvInt('CC_SPAWN_TIMEOUT_MS', 30 * 60 * 1000),
  claudeMaxBudgetUsd: optionalEnvFloat('CLAUDE_MAX_BUDGET_USD', 5),
  defaultProjectDir: optionalEnv('DEFAULT_PROJECT_DIR', '/home/ayaz/'),
  idleTimeoutMs: optionalEnvInt('IDLE_TIMEOUT_MS', 1_800_000),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  // Per-project resource limits for multi-project fairness
  maxConcurrentPerProject: optionalEnvInt('MAX_CONCURRENT_PER_PROJECT', 5),
  maxSessionsPerProject: optionalEnvInt('MAX_SESSIONS_PER_PROJECT', 100),

  // Allowed tools for Claude Code
  // Skill + Agent required for GSD slash commands and subagent spawning
  allowedTools: [
    'Bash',
    'Edit',
    'Read',
    'Write',
    'Glob',
    'Grep',
    'Task',
    'WebFetch',
    'Skill',
    'Agent',
    'EnterPlanMode',
    'ExitPlanMode',
    'AskUserQuestion',
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
  ],

  // Full path to claude binary (needed when running under systemd which has minimal PATH)
  claudePath: optionalEnv('CLAUDE_PATH', '/home/ayaz/.local/bin/claude'),

  // Full path to opencode binary
  opencodePath: optionalEnv('OPENCODE_PATH', '/home/ayaz/.opencode/bin/opencode'),
  // Default model for OpenCode spawns (provider/model format)
  opencodeModel: optionalEnv('OPENCODE_MODEL', 'minimax/MiniMax-M2.5'),

  // MCP servers for bridge-spawned CC instances (empty = no MCP, fastest startup).
  // Add specific servers here if bridge CC needs them (e.g., SupabaseSelfHosted).
  // User's main CC MCP servers are NOT affected — this only controls bridge spawns.
  mcpServers: {} as Record<string, unknown>,
} as const;

export type Config = typeof config;
