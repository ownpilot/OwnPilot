/**
 * CLI Wrapper Tools
 *
 * Named, structured wrappers around the catalog CLIs (gh, git, docker, npm).
 * Each wrapper delegates to `cliToolService.executeTool(...)` so the binary
 * allowlist, per-tool policy, env sanitization, and spawn-without-shell
 * guarantees from `run_cli_tool` still apply — wrappers only fix the binary
 * and translate typed parameters into the arg array.
 *
 * Why these exist when run_cli_tool already does the same job:
 *  - Discoverability: agents searching tool-tags find `gh_pr_create` directly,
 *    no need to know GitHub CLI subcommand syntax.
 *  - Typed parameters: tool schemas pin down what each wrapper accepts so the
 *    LLM doesn't construct malformed arg arrays.
 *
 * Wrappers are deliberately minimal — common operations only. Anything more
 * exotic falls back to run_cli_tool with hand-rolled args.
 */

import type { ToolDefinition } from '@ownpilot/core/agent';
import { getErrorMessage } from '@ownpilot/core/services';
import { getCliToolService } from '../services/cli/tool-service.js';

// =============================================================================
// Wrapper specification
// =============================================================================

interface WrapperSpec {
  name: string;
  binary: string;
  description: string;
  category: string;
  tags: string[];
  parameters: ToolDefinition['parameters'];
  workflowUsable?: boolean;
  /** Translate validated params into the arg array passed to spawn. */
  buildArgs: (params: Record<string, unknown>) => string[];
}

// Common cwd field reused by every wrapper.
const cwdField = {
  cwd: {
    type: 'string',
    description: 'Working directory (absolute path)',
  },
} as const;

function appendIf<T>(arr: T[], cond: unknown, ...items: T[]): void {
  if (cond) arr.push(...items);
}

function strArr(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

// =============================================================================
// gh — GitHub CLI
// =============================================================================

const GH_WRAPPERS: WrapperSpec[] = [
  {
    name: 'gh_pr_list',
    binary: 'gh',
    description: 'List GitHub pull requests for the current repository.',
    category: 'GitHub',
    tags: ['github', 'gh', 'pr', 'pull request', 'list'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        state: {
          type: 'string',
          enum: ['open', 'closed', 'merged', 'all'],
          description: 'Filter by PR state (default: open)',
        },
        limit: { type: 'number', description: 'Max results (default 30)' },
        author: { type: 'string', description: 'Filter by author handle' },
        label: { type: 'string', description: 'Filter by label' },
      },
      required: ['cwd'],
    },
    buildArgs: (p) => {
      const args = ['pr', 'list', '--json', 'number,title,state,author,headRefName,url,createdAt'];
      if (typeof p.state === 'string') args.push('--state', p.state);
      if (typeof p.limit === 'number') args.push('--limit', String(p.limit));
      if (typeof p.author === 'string') args.push('--author', p.author);
      if (typeof p.label === 'string') args.push('--label', p.label);
      return args;
    },
  },
  {
    name: 'gh_pr_view',
    binary: 'gh',
    description: 'View a GitHub pull request by number, optionally with comments.',
    category: 'GitHub',
    tags: ['github', 'gh', 'pr', 'pull request', 'view'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        number: { type: 'number', description: 'PR number' },
        comments: { type: 'boolean', description: 'Include PR comments' },
      },
      required: ['cwd', 'number'],
    },
    buildArgs: (p) => {
      const args = [
        'pr',
        'view',
        String(p.number),
        '--json',
        'number,title,state,body,author,headRefName,baseRefName,url',
      ];
      appendIf(args, p.comments, '--comments');
      return args;
    },
  },
  {
    name: 'gh_pr_create',
    binary: 'gh',
    description: 'Create a GitHub pull request. The current branch must already be pushed.',
    category: 'GitHub',
    tags: ['github', 'gh', 'pr', 'pull request', 'create', 'open'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR body (markdown)' },
        base: { type: 'string', description: 'Base branch (default repo default)' },
        draft: { type: 'boolean', description: 'Open as draft PR' },
      },
      required: ['cwd', 'title', 'body'],
    },
    buildArgs: (p) => {
      const args = ['pr', 'create', '--title', String(p.title), '--body', String(p.body)];
      if (typeof p.base === 'string') args.push('--base', p.base);
      appendIf(args, p.draft, '--draft');
      return args;
    },
  },
  {
    name: 'gh_issue_list',
    binary: 'gh',
    description: 'List GitHub issues for the current repository.',
    category: 'GitHub',
    tags: ['github', 'gh', 'issue', 'list'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by issue state (default open)',
        },
        limit: { type: 'number', description: 'Max results (default 30)' },
        label: { type: 'string', description: 'Filter by label' },
        author: { type: 'string', description: 'Filter by author handle' },
      },
      required: ['cwd'],
    },
    buildArgs: (p) => {
      const args = ['issue', 'list', '--json', 'number,title,state,author,labels,url,createdAt'];
      if (typeof p.state === 'string') args.push('--state', p.state);
      if (typeof p.limit === 'number') args.push('--limit', String(p.limit));
      if (typeof p.label === 'string') args.push('--label', p.label);
      if (typeof p.author === 'string') args.push('--author', p.author);
      return args;
    },
  },
  {
    name: 'gh_issue_view',
    binary: 'gh',
    description: 'View a GitHub issue by number, optionally with comments.',
    category: 'GitHub',
    tags: ['github', 'gh', 'issue', 'view'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        number: { type: 'number', description: 'Issue number' },
        comments: { type: 'boolean', description: 'Include issue comments' },
      },
      required: ['cwd', 'number'],
    },
    buildArgs: (p) => {
      const args = [
        'issue',
        'view',
        String(p.number),
        '--json',
        'number,title,state,body,author,labels,url',
      ];
      appendIf(args, p.comments, '--comments');
      return args;
    },
  },
  {
    name: 'gh_issue_create',
    binary: 'gh',
    description: 'Create a GitHub issue.',
    category: 'GitHub',
    tags: ['github', 'gh', 'issue', 'create', 'open'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (markdown)' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional labels to attach',
        },
      },
      required: ['cwd', 'title', 'body'],
    },
    buildArgs: (p) => {
      const args = ['issue', 'create', '--title', String(p.title), '--body', String(p.body)];
      const labels = strArr(p.labels);
      if (labels?.length) args.push('--label', labels.join(','));
      return args;
    },
  },
  {
    name: 'gh_run_list',
    binary: 'gh',
    description: 'List recent GitHub Actions workflow runs.',
    category: 'GitHub',
    tags: ['github', 'gh', 'actions', 'run', 'workflow', 'ci', 'list'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        workflow: { type: 'string', description: 'Filter by workflow name or filename' },
        branch: { type: 'string', description: 'Filter by branch' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        status: {
          type: 'string',
          enum: ['queued', 'in_progress', 'completed'],
          description: 'Filter by run status',
        },
      },
      required: ['cwd'],
    },
    buildArgs: (p) => {
      const args = [
        'run',
        'list',
        '--json',
        'databaseId,name,status,conclusion,headBranch,event,createdAt,url',
      ];
      if (typeof p.workflow === 'string') args.push('--workflow', p.workflow);
      if (typeof p.branch === 'string') args.push('--branch', p.branch);
      if (typeof p.limit === 'number') args.push('--limit', String(p.limit));
      if (typeof p.status === 'string') args.push('--status', p.status);
      return args;
    },
  },
  {
    name: 'gh_run_view',
    binary: 'gh',
    description: 'View a GitHub Actions run, optionally showing failed-step logs.',
    category: 'GitHub',
    tags: ['github', 'gh', 'actions', 'run', 'view', 'log', 'ci'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        run_id: { type: 'string', description: 'Run database ID' },
        log_failed: { type: 'boolean', description: 'Print logs of failed steps only' },
      },
      required: ['cwd', 'run_id'],
    },
    buildArgs: (p) => {
      const args = ['run', 'view', String(p.run_id)];
      appendIf(args, p.log_failed, '--log-failed');
      return args;
    },
  },
];

// Git wrappers intentionally omitted — core/git-tools.ts already exposes
// git_status / git_diff / git_log / git_commit / git_add / git_branch /
// git_checkout as first-class tools with execFile (no shell) and ref/path
// validation. Duplicating them here would collide with the core registrations.

// =============================================================================
// docker (read-only)
// =============================================================================
// Docker is `defaultPolicy: 'blocked'` in the catalog; users must promote to
// 'allowed' or 'prompt' before these wrappers will execute. Limited to inspect
// operations — no run/stop/rm.

const DOCKER_WRAPPERS: WrapperSpec[] = [
  {
    name: 'docker_ps',
    binary: 'docker',
    description: 'List Docker containers.',
    category: 'Docker',
    tags: ['docker', 'container', 'list', 'ps'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        all: { type: 'boolean', description: 'Include stopped containers' },
      },
      required: ['cwd'],
    },
    buildArgs: (p) => {
      const args = ['ps', '--format', 'json'];
      appendIf(args, p.all, '--all');
      return args;
    },
  },
  {
    name: 'docker_images',
    binary: 'docker',
    description: 'List local Docker images.',
    category: 'Docker',
    tags: ['docker', 'image', 'list'],
    parameters: {
      type: 'object',
      properties: { ...cwdField },
      required: ['cwd'],
    },
    buildArgs: () => ['images', '--format', 'json'],
  },
  {
    name: 'docker_logs',
    binary: 'docker',
    description: 'Fetch logs from a container.',
    category: 'Docker',
    tags: ['docker', 'container', 'log', 'logs'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        container: { type: 'string', description: 'Container ID or name' },
        tail: { type: 'number', description: 'Number of trailing lines (default 200)' },
        timestamps: { type: 'boolean', description: 'Include timestamps' },
      },
      required: ['cwd', 'container'],
    },
    buildArgs: (p) => {
      const args = ['logs', '--tail', String(typeof p.tail === 'number' ? p.tail : 200)];
      appendIf(args, p.timestamps, '--timestamps');
      args.push(String(p.container));
      return args;
    },
  },
  {
    name: 'docker_inspect',
    binary: 'docker',
    description: 'Inspect a Docker object (container, image, network, volume).',
    category: 'Docker',
    tags: ['docker', 'inspect', 'detail', 'metadata'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        target: { type: 'string', description: 'Object name or ID' },
      },
      required: ['cwd', 'target'],
    },
    buildArgs: (p) => ['inspect', String(p.target)],
  },
];

// =============================================================================
// npm
// =============================================================================

const NPM_WRAPPERS: WrapperSpec[] = [
  {
    name: 'npm_install',
    binary: 'npm',
    description: 'Install npm dependencies. With `packages` set, runs `npm install <packages>`.',
    category: 'npm',
    tags: ['npm', 'install', 'dependency', 'package', 'add'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of packages to install',
        },
        dev: { type: 'boolean', description: 'Install as devDependency' },
        global: { type: 'boolean', description: 'Install globally' },
      },
      required: ['cwd'],
    },
    buildArgs: (p) => {
      const args = ['install'];
      appendIf(args, p.dev, '--save-dev');
      appendIf(args, p.global, '--global');
      const pkgs = strArr(p.packages);
      if (pkgs?.length) args.push(...pkgs);
      return args;
    },
  },
  {
    name: 'npm_run',
    binary: 'npm',
    description: 'Run an npm script defined in package.json.',
    category: 'npm',
    tags: ['npm', 'run', 'script', 'task'],
    parameters: {
      type: 'object',
      properties: {
        ...cwdField,
        script: { type: 'string', description: 'Script name' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Extra args passed through to the script (after --)',
        },
      },
      required: ['cwd', 'script'],
    },
    buildArgs: (p) => {
      const args = ['run', String(p.script)];
      const extra = strArr(p.args);
      if (extra?.length) args.push('--', ...extra);
      return args;
    },
  },
  {
    name: 'npm_outdated',
    binary: 'npm',
    description: 'List outdated npm packages in machine-readable JSON.',
    category: 'npm',
    tags: ['npm', 'outdated', 'dependency', 'update'],
    parameters: {
      type: 'object',
      properties: { ...cwdField },
      required: ['cwd'],
    },
    buildArgs: () => ['outdated', '--json'],
  },
];

// =============================================================================
// Aggregate
// =============================================================================

const ALL_WRAPPERS: WrapperSpec[] = [...GH_WRAPPERS, ...DOCKER_WRAPPERS, ...NPM_WRAPPERS];

const WRAPPERS_BY_NAME = new Map<string, WrapperSpec>(ALL_WRAPPERS.map((w) => [w.name, w]));

export const CLI_WRAPPER_TOOLS: ToolDefinition[] = ALL_WRAPPERS.map((w) => ({
  name: w.name,
  description: w.description,
  parameters: w.parameters,
  category: w.category,
  tags: w.tags,
  workflowUsable: w.workflowUsable ?? true,
}));

export async function executeCliWrapperTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const spec = WRAPPERS_BY_NAME.get(toolName);
  if (!spec) return { success: false, error: `Unknown CLI wrapper tool: ${toolName}` };

  const cwd = typeof args.cwd === 'string' ? args.cwd : '';
  if (!cwd) return { success: false, error: 'cwd is required' };

  try {
    const cliArgs = spec.buildArgs(args);
    const service = getCliToolService();
    const result = await service.executeTool(spec.binary, cliArgs, cwd, userId);
    return {
      success: result.success,
      result: {
        toolName: result.toolName,
        binary: spec.binary,
        exitCode: result.exitCode,
        stdout: truncate(result.stdout, 8000),
        stderr: truncate(result.stderr, 2000),
        durationMs: result.durationMs,
        truncated: result.truncated,
      },
      error: result.error,
    };
  } catch (e) {
    return { success: false, error: getErrorMessage(e) };
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const half = Math.floor(max / 2) - 20;
  return s.slice(0, half) + '\n\n... [output truncated] ...\n\n' + s.slice(-half);
}
