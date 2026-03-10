/**
 * CLI Chat Provider — E2E Smoke Test
 *
 * Actually spawns CLIs to verify they work. Run with:
 *   npx tsx packages/gateway/src/services/cli-chat-provider.e2e.ts
 *
 * Pass CLI name(s) as args: claude, codex, gemini, or "all"
 *   npx tsx packages/gateway/src/services/cli-chat-provider.e2e.ts claude
 *   npx tsx packages/gateway/src/services/cli-chat-provider.e2e.ts all
 */

import {
  CliChatProvider,
  type CliChatBinary,
  detectCliChatProviders,
} from './cli-chat-provider.js';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function log(msg: string) {
  console.log(`${COLORS.dim}[${new Date().toISOString().slice(11, 19)}]${COLORS.reset} ${msg}`);
}

async function testProvider(binary: CliChatBinary): Promise<boolean> {
  const label = `${COLORS.bold}${binary}${COLORS.reset}`;
  log(`${COLORS.cyan}Testing ${label}...${COLORS.reset}`);

  const provider = new CliChatProvider({ binary, timeout: 60_000 });

  if (!provider.isReady()) {
    log(`${COLORS.yellow}⚠ ${label} — binary not installed, skipping${COLORS.reset}`);
    return false;
  }

  const start = Date.now();
  const result = await provider.complete({
    messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_TEST_OK' }],
    model: { model: '' }, // use default
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.ok) {
    const content = result.value.content.trim();
    const passed = content.includes('SMOKE_TEST_OK');
    if (passed) {
      log(
        `${COLORS.green}✓ ${label} — OK (${elapsed}s) model=${result.value.model}${COLORS.reset}`
      );
      log(`  ${COLORS.dim}Response: ${content.slice(0, 120)}${COLORS.reset}`);
    } else {
      log(
        `${COLORS.yellow}~ ${label} — responded but didn't follow instruction (${elapsed}s)${COLORS.reset}`
      );
      log(`  ${COLORS.dim}Response: ${content.slice(0, 200)}${COLORS.reset}`);
    }
    return true;
  } else {
    log(`${COLORS.red}✗ ${label} — FAILED (${elapsed}s): ${result.error.message}${COLORS.reset}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Show detection first
  log(`${COLORS.bold}CLI Chat Provider Detection${COLORS.reset}`);
  const providers = detectCliChatProviders();
  for (const p of providers) {
    const status = p.installed
      ? `${COLORS.green}installed${COLORS.reset}`
      : `${COLORS.red}not found${COLORS.reset}`;
    log(`  ${p.id}: ${status} (${p.binary})`);
  }
  console.log();

  // Determine which to test
  let binaries: CliChatBinary[];
  if (args.length === 0 || args[0] === 'all') {
    binaries = providers.filter((p) => p.installed).map((p) => p.binary) as CliChatBinary[];
  } else {
    binaries = args as CliChatBinary[];
  }

  if (binaries.length === 0) {
    log(`${COLORS.yellow}No CLIs to test. Install claude, codex, or gemini first.${COLORS.reset}`);
    process.exit(1);
  }

  log(`${COLORS.bold}Running smoke tests: ${binaries.join(', ')}${COLORS.reset}\n`);

  const results: Record<string, boolean> = {};
  for (const binary of binaries) {
    try {
      results[binary] = await testProvider(binary);
    } catch (e) {
      log(
        `${COLORS.red}✗ ${binary} — EXCEPTION: ${e instanceof Error ? e.message : String(e)}${COLORS.reset}`
      );
      results[binary] = false;
    }
    console.log();
  }

  // Summary
  log(`${COLORS.bold}Summary${COLORS.reset}`);
  for (const [name, passed] of Object.entries(results)) {
    const icon = passed ? `${COLORS.green}✓` : `${COLORS.red}✗`;
    log(`  ${icon} ${name}${COLORS.reset}`);
  }

  const allPassed = Object.values(results).every(Boolean);
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
