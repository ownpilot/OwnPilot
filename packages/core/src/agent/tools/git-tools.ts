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

// Validate a git ref/branch/commit parameter — rejects values starting with "-"
// which would be interpreted as git flags, causing argument injection.
// Also ensures the ref is safe for use as a positional argument.
function validateGitRef(ref: string, name: string): string {
  if (ref.startsWith('-')) {
    throw new Error(`${name} cannot start with '-' (got: ${ref})`);
  }
  return ref;
}

// Validate a file path argument — rejects paths starting with "-" to prevent
// them from being interpreted as git flags when passed as positional args.
function validateGitFile(file: string, name: string): string {
  if (file.startsWith('-')) {
    throw new Error(
      `${name} cannot start with '-' (got: ${file}). Use './${file}' to refer to files starting with dash.`
    );
  }
  return file;
}

// ============================================================================
// GIT STATUS TOOL
// ============================================================================

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  brief: 'Show staged, modified, and untracked files',
  description:
    'Get the current git repository status including staged, modified, and untracked files',
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

export const gitStatusExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
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
  const lines = output
    .trim()
    .split('\n')
    .filter((l) => l);

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
    clean: Object.values(sections).every((arr) => arr.length === 0),
  };
}

// ============================================================================
// GIT DIFF TOOL
// ============================================================================

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  brief: 'Show changes between commits or working tree',
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

export const gitDiffExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
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
    if (commit) args.push(validateGitRef(commit, 'commit'));
    if (commitRange) args.push(validateGitRef(commitRange, 'commitRange'));
    if (file) {
      args.push('--', validateGitFile(file, 'file'));
    }

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
  brief: 'Show commit history',
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

export const gitLogExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
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
    if (branch) args.push(validateGitRef(branch, 'branch'));
    if (file) {
      args.push('--', validateGitFile(file, 'file'));
    }

    const stdout = await gitExec(args, repoPath);

    // Parse commits
    const commits = oneline
      ? stdout
          .trim()
          .split('\n')
          .map((line) => {
            const [hash, ...messageParts] = line.split(' ');
            return { hash, message: messageParts.join(' ') };
          })
      : stdout
          .trim()
          .split('\n')
          .filter((l) => l)
          .map((line) => {
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
  brief: 'Create a commit with staged changes',
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

export const gitCommitExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
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
    // Only set -m when a message is provided; amend without -m reuses the existing message
    if (message) args.push('-m', message);
    else if (amend) args.push('--no-edit');

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
  brief: 'Stage files for commit',
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

export const gitAddExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const files = params.files as string[] | undefined;
  const all = params.all === true;

  try {
    const args = ['add'];
    if (all) {
      args.push('-A');
    } else {
      // Validate all file paths before adding — reject dash-prefixed paths
      const validFiles = (files || ['.']).map((f) => validateGitFile(f, 'file'));
      args.push(...validFiles);
    }

    await gitExec(args, repoPath);

    // Get status after adding
    const status = await gitExec(['status', '-s'], repoPath);

    return {
      content: {
        success: true,
        staged: files || ['all'],
        currentStatus: status
          .trim()
          .split('\n')
          .filter((l) => l),
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
  brief: 'List, create, or delete branches',
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

export const gitBranchExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
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

        const branches = branchOutput
          .trim()
          .split('\n')
          .map((b) => {
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
        await gitExec(['branch', validateGitRef(name, 'name')], repoPath);
        result = { success: true, created: name };
        break;
      }

      case 'delete': {
        if (!name) {
          return { content: { error: 'Branch name required' }, isError: true };
        }
        await gitExec(['branch', '-d', validateGitRef(name, 'name')], repoPath);
        result = { success: true, deleted: name };
        break;
      }

      case 'rename': {
        if (!name || !newName) {
          return { content: { error: 'Both name and newName required' }, isError: true };
        }
        await gitExec(
          ['branch', '-m', validateGitRef(name, 'name'), validateGitRef(newName, 'newName')],
          repoPath
        );
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
  brief: 'Switch branches or restore files',
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

export const gitCheckoutExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
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
      args.push('-b', validateGitRef(branch, 'branch'));
    } else if (branch) {
      args.push(validateGitRef(branch, 'branch'));
    } else if (file) {
      args.push('--', validateGitFile(file, 'file'));
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
// GIT SHOW TOOL — inspect a specific commit
// ============================================================================

export const gitShowTool: ToolDefinition = {
  name: 'git_show',
  brief: 'Show a commit (message + diff) or a file at a specific revision',
  description:
    'Show the contents of a git object — typically a commit (message + diff) or ' +
    'a file at a given revision. Read-only. Use this to inspect what a specific ' +
    'commit changed, or what a file looked like at a past commit.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the git repository' },
      ref: {
        type: 'string',
        description:
          'The object to show — commit SHA, branch name, tag, or "HEAD" / "HEAD~1". Defaults to HEAD.',
      },
      file: {
        type: 'string',
        description:
          'Optional file path. When supplied, returns the file contents at <ref> instead of the commit diff.',
      },
      statOnly: {
        type: 'boolean',
        description:
          'When true, return only file-change stats (--stat) instead of the full diff. Much cheaper for large commits.',
      },
    },
  },
};

export const gitShowExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const file = params.file as string | undefined;
  const statOnly = params.statOnly === true;
  let ref: string;
  let validatedFile: string | undefined;
  try {
    ref = validateGitRef((params.ref as string) || 'HEAD', 'ref');
    if (file) validatedFile = validateGitFile(file, 'file');
  } catch (err) {
    return { content: { error: (err as Error).message }, isError: true };
  }

  try {
    let args: string[];
    if (validatedFile) {
      // "git show <ref>:<file>" prints the file at that revision.
      args = ['show', `${ref}:${validatedFile}`];
    } else {
      args = ['show'];
      if (statOnly) args.push('--stat');
      args.push(ref);
    }
    const stdout = await gitExec(args, repoPath);
    return {
      content: { ref, file: file ?? null, output: stdout },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return { content: { error: err.message, stderr: err.stderr }, isError: true };
  }
};

// ============================================================================
// GIT BLAME TOOL — line-by-line authorship
// ============================================================================

export const gitBlameTool: ToolDefinition = {
  name: 'git_blame',
  brief: 'Show who last modified each line of a file (and when)',
  description:
    'Run git blame on a file to see, for each line, the commit + author that ' +
    'last touched it. Read-only. Use this when debugging to understand the ' +
    'history of a specific piece of code.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the git repository' },
      file: { type: 'string', description: 'File to blame (relative to repo root)' },
      startLine: {
        type: 'number',
        description: 'Start line of the range to blame (1-indexed; default: 1)',
      },
      endLine: {
        type: 'number',
        description: 'End line of the range to blame (inclusive; default: end of file)',
      },
      ref: {
        type: 'string',
        description: 'Revision to blame at (default: HEAD)',
      },
    },
    required: ['file'],
  },
};

export const gitBlameExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  let file: string;
  let ref: string | undefined;
  try {
    file = validateGitFile(params.file as string, 'file');
    if (params.ref) ref = validateGitRef(params.ref as string, 'ref');
  } catch (err) {
    return { content: { error: (err as Error).message }, isError: true };
  }
  const startLine = params.startLine as number | undefined;
  const endLine = params.endLine as number | undefined;

  try {
    const args: string[] = ['blame'];
    if (startLine !== undefined || endLine !== undefined) {
      const s = startLine ?? 1;
      const e = endLine ?? '';
      args.push('-L', `${s},${e}`);
    }
    // --porcelain gives stable machine-readable output but is verbose; default
    // to the human format which is what agents actually want to read.
    if (ref) args.push(ref);
    args.push('--', file);

    const stdout = await gitExec(args, repoPath);
    return { content: { file, output: stdout }, isError: false };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return { content: { error: err.message, stderr: err.stderr }, isError: true };
  }
};

// ============================================================================
// GIT STASH TOOL — save / restore / list WIP
// ============================================================================

export const gitStashTool: ToolDefinition = {
  name: 'git_stash',
  brief: 'Save, restore, or list stashed working-directory changes',
  description:
    'Manage git stashes — a way to set aside working-directory changes without ' +
    'committing them, then bring them back later. Supports actions: save (default), ' +
    'pop (restore + drop), apply (restore without dropping), list, drop. Use this ' +
    'when you need to switch contexts without losing work in progress.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the git repository' },
      action: {
        type: 'string',
        enum: ['save', 'pop', 'apply', 'list', 'drop'],
        description: 'Stash action (default: save)',
      },
      message: {
        type: 'string',
        description: 'Optional message for save action',
      },
      ref: {
        type: 'string',
        description: 'Stash ref for pop/apply/drop (e.g. "stash@{0}" — the latest by default).',
      },
      includeUntracked: {
        type: 'boolean',
        description: 'Include untracked files in the stash (save action only)',
      },
    },
  },
};

export const gitStashExecutor: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const repoPath = (params.path as string) || process.cwd();
  const action = (params.action as string) || 'save';
  const message = params.message as string | undefined;
  const ref = params.ref as string | undefined;
  const includeUntracked = params.includeUntracked === true;

  if (!['save', 'pop', 'apply', 'list', 'drop'].includes(action)) {
    return {
      content: { error: `Invalid action: ${action}. Use save | pop | apply | list | drop.` },
      isError: true,
    };
  }

  // Validate ref early (only for pop/apply/drop — list/save don't take one)
  if (ref && (action === 'pop' || action === 'apply' || action === 'drop')) {
    try {
      validateGitRef(ref, 'ref');
    } catch (err) {
      return { content: { error: (err as Error).message }, isError: true };
    }
  }

  try {
    let args: string[];
    switch (action) {
      case 'save':
        // `git stash push` is the modern form; `git stash save` is deprecated.
        args = ['stash', 'push'];
        if (includeUntracked) args.push('--include-untracked');
        if (message) args.push('-m', message);
        break;
      case 'pop':
        args = ['stash', 'pop'];
        if (ref) args.push(ref);
        break;
      case 'apply':
        args = ['stash', 'apply'];
        if (ref) args.push(ref);
        break;
      case 'drop':
        args = ['stash', 'drop'];
        if (ref) args.push(ref);
        break;
      case 'list':
        args = ['stash', 'list'];
        break;
      default:
        // Unreachable due to the validation above, but TS doesn't know.
        return { content: { error: 'unreachable' }, isError: true };
    }

    const stdout = await gitExec(args, repoPath);
    return {
      content: { action, output: stdout || `${action} completed` },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string };
    return { content: { error: err.message, stderr: err.stderr }, isError: true };
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
  { definition: gitShowTool, executor: gitShowExecutor },
  { definition: gitBlameTool, executor: gitBlameExecutor },
  { definition: gitStashTool, executor: gitStashExecutor },
];

export const GIT_TOOL_NAMES = GIT_TOOLS.map((t) => t.definition.name);
