/**
 * Git Tools
 * Version control operations
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Safely run a git command using execFile (no shell interpolation).
 * All arguments are passed as an array to avoid command injection.
 */
async function gitExec(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: MAX_OUTPUT_SIZE,
  });
  return stdout;
}

// Maximum output size
const MAX_OUTPUT_SIZE = 100000;

// ============================================================================
// GIT STATUS TOOL
// ============================================================================

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: 'Get the current git repository status including staged, modified, and untracked files',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the git repository (default: current directory)',
      },
      short: {
        type: 'boolean',
        description: 'Use short format output',
      },
    },
  },
};

export const gitStatusExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const short = params.short === true;

  try {
    const args = ['status'];
    if (short) args.push('-s');
    const stdout = await gitExec(args, repoPath);

    // Parse status for structured output
    const status = parseGitStatus(stdout, short);

    return {
      content: {
        raw: stdout,
        parsed: status,
        repository: repoPath,
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return {
      content: {
        error: err.message,
        stderr: err.stderr,
        note: 'Make sure you are in a git repository',
      },
      isError: true,
    };
  }
};

/**
 * Parse git status output
 */
function parseGitStatus(output: string, short: boolean): Record<string, unknown> {
  const lines = output.trim().split('\n').filter(l => l);

  if (short) {
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status[0] === 'M' || status[0] === 'A' || status[0] === 'D') {
        staged.push(file);
      }
      if (status[1] === 'M') {
        modified.push(file);
      }
      if (status === '??') {
        untracked.push(file);
      }
    }

    return { staged, modified, untracked, clean: lines.length === 0 };
  }

  // Long format parsing
  const sections: Record<string, string[]> = {
    staged: [],
    notStaged: [],
    untracked: [],
  };

  let currentSection = '';

  for (const line of lines) {
    if (line.includes('Changes to be committed')) {
      currentSection = 'staged';
    } else if (line.includes('Changes not staged')) {
      currentSection = 'notStaged';
    } else if (line.includes('Untracked files')) {
      currentSection = 'untracked';
    } else if (line.startsWith('\t') && currentSection) {
      sections[currentSection]?.push(line.trim());
    }
  }

  return {
    ...sections,
    clean: Object.values(sections).every(arr => arr.length === 0),
  };
}

// ============================================================================
// GIT DIFF TOOL
// ============================================================================

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: 'Show changes between commits, working tree, and staging area',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the git repository',
      },
      file: {
        type: 'string',
        description: 'Specific file to diff',
      },
      staged: {
        type: 'boolean',
        description: 'Show staged changes (--cached)',
      },
      commit: {
        type: 'string',
        description: 'Compare with specific commit',
      },
      commitRange: {
        type: 'string',
        description: 'Compare commit range (e.g., "main..feature")',
      },
      stat: {
        type: 'boolean',
        description: 'Show diffstat only',
      },
    },
  },
};

export const gitDiffExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const file = params.file as string | undefined;
  const staged = params.staged === true;
  const commit = params.commit as string | undefined;
  const commitRange = params.commitRange as string | undefined;
  const stat = params.stat === true;

  try {
    const args = ['diff'];

    if (staged) args.push('--cached');
    if (stat) args.push('--stat');
    if (commit) args.push(commit);
    if (commitRange) args.push(commitRange);
    if (file) { args.push('--'); args.push(file); }

    const stdout = await gitExec(args, repoPath);

    // Parse diff stats
    const stats = parseDiffStats(stdout);

    return {
      content: {
        diff: stdout || 'No changes',
        stats,
        options: { staged, commit, commitRange, file, stat },
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return {
      content: { error: err.message, stderr: err.stderr },
      isError: true,
    };
  }
};

/**
 * Parse diff statistics
 */
function parseDiffStats(diff: string): Record<string, number> {
  const additions = (diff.match(/^\+[^+]/gm) || []).length;
  const deletions = (diff.match(/^-[^-]/gm) || []).length;
  const files = new Set(diff.match(/^diff --git a\/(.+) b\//gm) || []).size;

  return { files, additions, deletions };
}

// ============================================================================
// GIT LOG TOOL
// ============================================================================

export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description: 'Show commit history',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the git repository',
      },
      limit: {
        type: 'number',
        description: 'Number of commits to show (default: 10)',
      },
      oneline: {
        type: 'boolean',
        description: 'One line per commit',
      },
      author: {
        type: 'string',
        description: 'Filter by author',
      },
      since: {
        type: 'string',
        description: 'Show commits since date',
      },
      until: {
        type: 'string',
        description: 'Show commits until date',
      },
      file: {
        type: 'string',
        description: 'Show commits for specific file',
      },
      branch: {
        type: 'string',
        description: 'Show commits for specific branch',
      },
    },
  },
};

export const gitLogExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const limit = (params.limit as number) || 10;
  const oneline = params.oneline === true;
  const author = params.author as string | undefined;
  const since = params.since as string | undefined;
  const until = params.until as string | undefined;
  const file = params.file as string | undefined;
  const branch = params.branch as string | undefined;

  try {
    const args = ['log', '-n', String(limit)];

    if (oneline) args.push('--oneline');
    if (author) args.push(`--author=${author}`);
    if (since) args.push(`--since=${since}`);
    if (until) args.push(`--until=${until}`);
    if (!oneline) args.push('--format=%H|%an|%ae|%at|%s');
    if (branch) args.push(branch);
    if (file) { args.push('--'); args.push(file); }

    const stdout = await gitExec(args, repoPath);

    // Parse commits
    const commits = oneline
      ? stdout.trim().split('\n').map(line => {
          const [hash, ...messageParts] = line.split(' ');
          return { hash, message: messageParts.join(' ') };
        })
      : stdout.trim().split('\n').filter(l => l).map(line => {
          const [hash, author, email, timestamp, ...messageParts] = line.split('|');
          return {
            hash,
            author,
            email,
            date: new Date(parseInt(timestamp || '0') * 1000).toISOString(),
            message: messageParts.join('|'),
          };
        });

    return {
      content: {
        commits,
        count: commits.length,
        filters: { author, since, until, file, branch },
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return {
      content: { error: err.message, stderr: err.stderr },
      isError: true,
    };
  }
};

// ============================================================================
// GIT COMMIT TOOL
// ============================================================================

export const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  description: 'Create a new commit with staged changes',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the git repository',
      },
      message: {
        type: 'string',
        description: 'Commit message',
      },
      all: {
        type: 'boolean',
        description: 'Stage all modified files before committing (-a)',
      },
      amend: {
        type: 'boolean',
        description: 'Amend the previous commit',
      },
    },
    required: ['message'],
  },
};

export const gitCommitExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const message = params.message as string;
  const all = params.all === true;
  const amend = params.amend === true;

  if (!message && !amend) {
    return {
      content: { error: 'Commit message is required' },
      isError: true,
    };
  }

  try {
    const args = ['commit'];
    if (all) args.push('-a');
    if (amend) args.push('--amend');
    args.push('-m', message);

    const stdout = await gitExec(args, repoPath);

    // Get commit hash
    const hash = await gitExec(['rev-parse', 'HEAD'], repoPath);

    return {
      content: {
        success: true,
        output: stdout,
        commitHash: hash.trim(),
        message,
        amend,
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return {
      content: { error: err.message, stderr: err.stderr },
      isError: true,
    };
  }
};

// ============================================================================
// GIT ADD TOOL
// ============================================================================

export const gitAddTool: ToolDefinition = {
  name: 'git_add',
  description: 'Stage files for commit',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the git repository',
      },
      files: {
        type: 'array',
        description: 'Files to stage (use "." for all)',
        items: { type: 'string' },
      },
      all: {
        type: 'boolean',
        description: 'Stage all changes including deletions (-A)',
      },
    },
  },
};

export const gitAddExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const files = params.files as string[] | undefined;
  const all = params.all === true;

  try {
    const args = ['add'];
    if (all) {
      args.push('-A');
    } else {
      args.push(...(files || ['.']));
    }

    await gitExec(args, repoPath);

    // Get status after adding
    const status = await gitExec(['status', '-s'], repoPath);

    return {
      content: {
        success: true,
        staged: files || ['all'],
        currentStatus: status.trim().split('\n').filter(l => l),
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return {
      content: { error: err.message, stderr: err.stderr },
      isError: true,
    };
  }
};

// ============================================================================
// GIT BRANCH TOOL
// ============================================================================

export const gitBranchTool: ToolDefinition = {
  name: 'git_branch',
  description: 'List, create, or delete branches',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the git repository',
      },
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['list', 'create', 'delete', 'rename'],
      },
      name: {
        type: 'string',
        description: 'Branch name (for create/delete/rename)',
      },
      newName: {
        type: 'string',
        description: 'New branch name (for rename)',
      },
      remote: {
        type: 'boolean',
        description: 'Include remote branches in list',
      },
    },
  },
};

export const gitBranchExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const action = (params.action as string) || 'list';
  const name = params.name as string | undefined;
  const newName = params.newName as string | undefined;
  const remote = params.remote === true;

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'list': {
        const branchArgs = ['branch'];
        if (remote) branchArgs.push('-a');
        const branchOutput = await gitExec(branchArgs, repoPath);

        const branches = branchOutput.trim().split('\n').map(b => {
          const isCurrent = b.startsWith('*');
          return {
            name: b.replace(/^\*?\s+/, ''),
            current: isCurrent,
          };
        });

        result = { branches, count: branches.length };
        break;
      }

      case 'create': {
        if (!name) {
          return { content: { error: 'Branch name required' }, isError: true };
        }
        await gitExec(['branch', name], repoPath);
        result = { success: true, created: name };
        break;
      }

      case 'delete': {
        if (!name) {
          return { content: { error: 'Branch name required' }, isError: true };
        }
        await gitExec(['branch', '-d', name], repoPath);
        result = { success: true, deleted: name };
        break;
      }

      case 'rename': {
        if (!name || !newName) {
          return { content: { error: 'Both name and newName required' }, isError: true };
        }
        await gitExec(['branch', '-m', name, newName], repoPath);
        result = { success: true, renamed: { from: name, to: newName } };
        break;
      }

      default:
        return { content: { error: `Unknown action: ${action}` }, isError: true };
    }

    return { content: result, isError: false };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return {
      content: { error: err.message, stderr: err.stderr },
      isError: true,
    };
  }
};

// ============================================================================
// GIT CHECKOUT TOOL
// ============================================================================

export const gitCheckoutTool: ToolDefinition = {
  name: 'git_checkout',
  description: 'Switch branches or restore files',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the git repository',
      },
      branch: {
        type: 'string',
        description: 'Branch name to checkout',
      },
      file: {
        type: 'string',
        description: 'File to restore',
      },
      createBranch: {
        type: 'boolean',
        description: 'Create new branch (-b)',
      },
    },
  },
};

export const gitCheckoutExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const branch = params.branch as string | undefined;
  const file = params.file as string | undefined;
  const createBranch = params.createBranch === true;

  if (!branch && !file) {
    return {
      content: { error: 'Either branch or file must be specified' },
      isError: true,
    };
  }

  try {
    const args = ['checkout'];
    if (createBranch && branch) {
      args.push('-b', branch);
    } else if (branch) {
      args.push(branch);
    } else if (file) {
      args.push('--', file);
    }

    const stdout = await gitExec(args, repoPath);

    return {
      content: {
        success: true,
        output: stdout || 'Checkout successful',
        target: branch || file,
        newBranch: createBranch,
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return {
      content: { error: err.message, stderr: err.stderr },
      isError: true,
    };
  }
};

// ============================================================================
// EXPORT ALL GIT TOOLS
// ============================================================================

export const GIT_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: gitStatusTool, executor: gitStatusExecutor },
  { definition: gitDiffTool, executor: gitDiffExecutor },
  { definition: gitLogTool, executor: gitLogExecutor },
  { definition: gitCommitTool, executor: gitCommitExecutor },
  { definition: gitAddTool, executor: gitAddExecutor },
  { definition: gitBranchTool, executor: gitBranchExecutor },
  { definition: gitCheckoutTool, executor: gitCheckoutExecutor },
];

export const GIT_TOOL_NAMES = GIT_TOOLS.map((t) => t.definition.name);
