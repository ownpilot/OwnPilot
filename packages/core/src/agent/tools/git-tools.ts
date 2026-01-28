/**
 * Git Tools
 * Version control operations
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';
import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

export const gitStatusExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const short = params.short === true;

  try {
    const args = short ? '-s' : '';
    const { stdout } = await execAsync(`git status ${args}`, {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_SIZE,
    });

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

export const gitDiffExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const file = params.file as string | undefined;
  const staged = params.staged === true;
  const commit = params.commit as string | undefined;
  const commitRange = params.commitRange as string | undefined;
  const stat = params.stat === true;

  try {
    let args = '';

    if (staged) args += '--cached ';
    if (stat) args += '--stat ';
    if (commit) args += `${commit} `;
    if (commitRange) args += `${commitRange} `;
    if (file) args += `-- ${file}`;

    const { stdout } = await execAsync(`git diff ${args}`.trim(), {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_SIZE,
    });

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

export const gitLogExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const limit = (params.limit as number) || 10;
  const oneline = params.oneline === true;
  const author = params.author as string | undefined;
  const since = params.since as string | undefined;
  const until = params.until as string | undefined;
  const file = params.file as string | undefined;
  const branch = params.branch as string | undefined;

  try {
    let args = `-n ${limit}`;

    if (oneline) args += ' --oneline';
    if (author) args += ` --author="${author}"`;
    if (since) args += ` --since="${since}"`;
    if (until) args += ` --until="${until}"`;
    if (branch) args += ` ${branch}`;
    if (file) args += ` -- ${file}`;

    // Use structured format for parsing
    const format = oneline ? '' : ' --format="%H|%an|%ae|%at|%s"';
    const { stdout } = await execAsync(`git log ${args}${format}`, {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_SIZE,
    });

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

export const gitCommitExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
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
    let args = '';
    if (all) args += '-a ';
    if (amend) args += '--amend ';
    args += `-m "${message.replace(/"/g, '\\"')}"`;

    const { stdout } = await execAsync(`git commit ${args}`, {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_SIZE,
    });

    // Get commit hash
    const { stdout: hash } = await execAsync('git rev-parse HEAD', {
      cwd: repoPath,
    });

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

export const gitAddExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const files = params.files as string[] | undefined;
  const all = params.all === true;

  try {
    let args = all ? '-A' : (files?.join(' ') || '.');

    await execAsync(`git add ${args}`, {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_SIZE,
    });

    // Get status after adding
    const { stdout: status } = await execAsync('git status -s', {
      cwd: repoPath,
    });

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

export const gitBranchExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const action = (params.action as string) || 'list';
  const name = params.name as string | undefined;
  const newName = params.newName as string | undefined;
  const remote = params.remote === true;

  try {
    let result: Record<string, unknown>;

    switch (action) {
      case 'list': {
        const args = remote ? '-a' : '';
        const { stdout } = await execAsync(`git branch ${args}`, {
          cwd: repoPath,
        });

        const branches = stdout.trim().split('\n').map(b => {
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
        await execAsync(`git branch ${name}`, { cwd: repoPath });
        result = { success: true, created: name };
        break;
      }

      case 'delete': {
        if (!name) {
          return { content: { error: 'Branch name required' }, isError: true };
        }
        await execAsync(`git branch -d ${name}`, { cwd: repoPath });
        result = { success: true, deleted: name };
        break;
      }

      case 'rename': {
        if (!name || !newName) {
          return { content: { error: 'Both name and newName required' }, isError: true };
        }
        await execAsync(`git branch -m ${name} ${newName}`, { cwd: repoPath });
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

export const gitCheckoutExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
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
    let args = '';
    if (createBranch && branch) {
      args = `-b ${branch}`;
    } else if (branch) {
      args = branch;
    } else if (file) {
      args = `-- ${file}`;
    }

    const { stdout } = await execAsync(`git checkout ${args}`, {
      cwd: repoPath,
      maxBuffer: MAX_OUTPUT_SIZE,
    });

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
