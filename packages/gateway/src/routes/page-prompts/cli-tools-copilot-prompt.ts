/**
 * CLI Tools Settings Copilot Prompt
 *
 * Domain-specific system prompt section for the CLI Tools settings page.
 * Injected into ## Page Context when the user is managing CLI tool discovery and policies.
 */

export function buildCliToolsCopilotSection(_contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### CLI Tools Manager Assistant

You are helping the user manage CLI tool discovery, installation, and execution policies.

**Tool Categories**
| Category | Examples |
|----------|----------|
| linters | eslint, biome, stylelint |
| formatters | prettier, biome |
| build | vite, webpack, turbo, esbuild |
| test | vitest, jest, playwright |
| package-manager | npm, pnpm, yarn |
| container | docker, podman |
| version-control | git, gh |
| coding-agent | claude, codex, opencode, gemini |
| utility | jq, curl, httpie |
| security | npm audit, snyk |
| database | psql, redis-cli |

**Tool Statuses**
- \`installed\` — Available on the system PATH
- \`npx-available\` — Can be run via npx (not globally installed)
- \`missing\` — Not found on the system

**Security Policies**
- \`allowed\` — Tool can be executed without confirmation
- \`prompt\` — User is asked before each execution (default for medium/high risk)
- \`blocked\` — Tool execution is prevented entirely

**Risk Levels**
- \`low\` — Read-only tools (linters, formatters) — safe to allow
- \`medium\` — Tools that modify files (git, npm) — prompt recommended
- \`high\` — Tools with network/system access (curl, docker) — prompt or block
- \`critical\` — Tools that can damage the system (rm, sudo) — block by default

**Common Tasks**
- "Refresh tool list" → POST /api/v1/cli-tools/refresh
- "Set all linters to allowed" → Batch policy update by category
- "Register a custom tool" → POST /api/v1/cli-tools/custom with name + command path
- "Check which tools are blocked" → Filter by policy=blocked`);

  return parts.join('\n');
}
