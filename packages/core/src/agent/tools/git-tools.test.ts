/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:child_process so that every `execFile` call is intercepted.
// We use vi.hoisted so the mock factory runs before ESM imports are resolved.
// ---------------------------------------------------------------------------
const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

// promisify(execFile) should return a function that wraps mockExecFile in a
// promise.  We mock `node:util` so that `promisify` returns a wrapper around
// our mock.
vi.mock('node:util', () => ({
  promisify: () =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        mockExecFile(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      }),
}));

import {
  gitStatusTool,
  gitStatusExecutor,
  gitDiffTool,
  gitDiffExecutor,
  gitLogTool,
  gitLogExecutor,
  gitCommitTool,
  gitCommitExecutor,
  gitAddTool,
  gitAddExecutor,
  gitBranchTool,
  gitBranchExecutor,
  gitCheckoutTool,
  gitCheckoutExecutor,
  GIT_TOOLS,
  GIT_TOOL_NAMES,
} from './git-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make `mockExecFile` succeed with the given stdout for the next call.
 */
function succeedWith(stdout: string): void {
  mockExecFile.mockImplementationOnce(
    (...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
      cb(null, stdout, '');
    },
  );
}

/**
 * Make `mockExecFile` fail with the given error message.
 */
function failWith(message: string, stderr = ''): void {
  mockExecFile.mockImplementationOnce(
    (...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error(message), { stderr });
      cb(err, '', stderr);
    },
  );
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockExecFile.mockReset();
});

// ===========================================================================
// GIT_TOOLS / GIT_TOOL_NAMES exports
// ===========================================================================

describe('GIT_TOOLS and GIT_TOOL_NAMES', () => {
  it('exports exactly 7 tools', () => {
    expect(GIT_TOOLS).toHaveLength(7);
  });

  it('exports matching tool names array', () => {
    expect(GIT_TOOL_NAMES).toHaveLength(7);
    expect(GIT_TOOL_NAMES).toEqual([
      'git_status',
      'git_diff',
      'git_log',
      'git_commit',
      'git_add',
      'git_branch',
      'git_checkout',
    ]);
  });

  it('each entry has a definition and executor', () => {
    for (const tool of GIT_TOOLS) {
      expect(tool.definition).toBeDefined();
      expect(tool.definition.name).toBeTypeOf('string');
      expect(tool.definition.description).toBeTypeOf('string');
      expect(tool.definition.parameters).toBeDefined();
      expect(tool.executor).toBeTypeOf('function');
    }
  });

  it('all tool definitions have object-type parameters', () => {
    for (const tool of GIT_TOOLS) {
      expect(tool.definition.parameters.type).toBe('object');
      expect(tool.definition.parameters.properties).toBeDefined();
    }
  });
});

// ===========================================================================
// TOOL DEFINITIONS
// ===========================================================================

describe('Tool definitions', () => {
  it('gitStatusTool has correct schema', () => {
    expect(gitStatusTool.name).toBe('git_status');
    expect(gitStatusTool.parameters.properties).toHaveProperty('path');
    expect(gitStatusTool.parameters.properties).toHaveProperty('short');
    expect(gitStatusTool.parameters.properties.short.type).toBe('boolean');
  });

  it('gitDiffTool has correct schema', () => {
    expect(gitDiffTool.name).toBe('git_diff');
    const props = gitDiffTool.parameters.properties;
    expect(props).toHaveProperty('path');
    expect(props).toHaveProperty('file');
    expect(props).toHaveProperty('staged');
    expect(props).toHaveProperty('commit');
    expect(props).toHaveProperty('commitRange');
    expect(props).toHaveProperty('stat');
  });

  it('gitLogTool has correct schema', () => {
    expect(gitLogTool.name).toBe('git_log');
    const props = gitLogTool.parameters.properties;
    expect(props).toHaveProperty('path');
    expect(props).toHaveProperty('limit');
    expect(props).toHaveProperty('oneline');
    expect(props).toHaveProperty('author');
    expect(props).toHaveProperty('since');
    expect(props).toHaveProperty('until');
    expect(props).toHaveProperty('file');
    expect(props).toHaveProperty('branch');
  });

  it('gitCommitTool has required "message" field', () => {
    expect(gitCommitTool.name).toBe('git_commit');
    expect(gitCommitTool.parameters.required).toContain('message');
    const props = gitCommitTool.parameters.properties;
    expect(props).toHaveProperty('message');
    expect(props).toHaveProperty('all');
    expect(props).toHaveProperty('amend');
  });

  it('gitAddTool has correct schema', () => {
    expect(gitAddTool.name).toBe('git_add');
    const props = gitAddTool.parameters.properties;
    expect(props).toHaveProperty('files');
    expect(props).toHaveProperty('all');
    expect(props.files.type).toBe('array');
  });

  it('gitBranchTool has correct schema', () => {
    expect(gitBranchTool.name).toBe('git_branch');
    const props = gitBranchTool.parameters.properties;
    expect(props).toHaveProperty('action');
    expect(props).toHaveProperty('name');
    expect(props).toHaveProperty('newName');
    expect(props).toHaveProperty('remote');
    expect(props.action.enum).toEqual(['list', 'create', 'delete', 'rename']);
  });

  it('gitCheckoutTool has correct schema', () => {
    expect(gitCheckoutTool.name).toBe('git_checkout');
    const props = gitCheckoutTool.parameters.properties;
    expect(props).toHaveProperty('branch');
    expect(props).toHaveProperty('file');
    expect(props).toHaveProperty('createBranch');
  });
});

// ===========================================================================
// GIT STATUS EXECUTOR
// ===========================================================================

describe('gitStatusExecutor', () => {
  it('returns parsed long-format status', async () => {
    const output = [
      'On branch main',
      'Changes to be committed:',
      '\tnew file:   foo.ts',
      'Changes not staged for commit:',
      '\tmodified:   bar.ts',
      'Untracked files:',
      '\tbaz.txt',
    ].join('\n');
    succeedWith(output);

    const result = await gitStatusExecutor({});
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.raw).toBe(output);
    expect(content.parsed.staged).toEqual(['new file:   foo.ts']);
    expect(content.parsed.notStaged).toEqual(['modified:   bar.ts']);
    expect(content.parsed.untracked).toEqual(['baz.txt']);
    expect(content.parsed.clean).toBe(false);
  });

  it('reports clean when long-format has no changes', async () => {
    const output = 'On branch main\nnothing to commit, working tree clean\n';
    succeedWith(output);

    const result = await gitStatusExecutor({});
    const content = result.content as any;
    expect(content.parsed.clean).toBe(true);
  });

  it('returns short-format parsed status', async () => {
    const output = 'M  staged.ts\n M modified.ts\n?? untracked.txt\nA  added.ts\nD  deleted.ts\n';
    succeedWith(output);

    const result = await gitStatusExecutor({ short: true });
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.parsed.staged).toContain('staged.ts');
    expect(content.parsed.staged).toContain('added.ts');
    expect(content.parsed.staged).toContain('deleted.ts');
    expect(content.parsed.modified).toContain('modified.ts');
    expect(content.parsed.untracked).toContain('untracked.txt');
    expect(content.parsed.clean).toBe(false);
  });

  it('passes -s flag when short is true', async () => {
    succeedWith('');
    await gitStatusExecutor({ short: true });

    // First arg is 'git', second is the args array
    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('-s');
  });

  it('uses the provided path as cwd', async () => {
    succeedWith('');
    await gitStatusExecutor({ path: '/my/repo' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const opts = callArgs[2] as { cwd: string };
    expect(opts.cwd).toBe('/my/repo');
  });

  it('uses process.cwd() when no path given', async () => {
    succeedWith('');
    await gitStatusExecutor({});

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const opts = callArgs[2] as { cwd: string };
    expect(opts.cwd).toBe(process.cwd());
  });

  it('reports clean=true for empty short output', async () => {
    succeedWith('');
    const result = await gitStatusExecutor({ short: true });
    const content = result.content as any;
    expect(content.parsed.clean).toBe(true);
    expect(content.parsed.staged).toEqual([]);
    expect(content.parsed.modified).toEqual([]);
    expect(content.parsed.untracked).toEqual([]);
  });

  it('returns error when git command fails', async () => {
    failWith('fatal: not a git repository', 'some stderr');
    const result = await gitStatusExecutor({});
    expect(result.isError).toBe(true);

    const content = result.content as any;
    expect(content.error).toContain('not a git repository');
    expect(content.stderr).toBe('some stderr');
    expect(content.note).toBe('Make sure you are in a git repository');
  });

  it('handles short status with both staged and modified flags on same file', async () => {
    // MM means file is both staged and has unstaged modifications
    const output = 'MM both.ts\n';
    succeedWith(output);

    const result = await gitStatusExecutor({ short: true });
    const content = result.content as any;
    expect(content.parsed.staged).toContain('both.ts');
    expect(content.parsed.modified).toContain('both.ts');
  });
});

// ===========================================================================
// GIT DIFF EXECUTOR
// ===========================================================================

describe('gitDiffExecutor', () => {
  it('returns diff output and parsed stats', async () => {
    const diff = [
      'diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      '+added line',
      ' unchanged',
      '-removed line',
    ].join('\n');
    succeedWith(diff);

    const result = await gitDiffExecutor({});
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.diff).toBe(diff);
    expect(content.stats.files).toBe(1);
    expect(content.stats.additions).toBe(1);
    expect(content.stats.deletions).toBe(1);
  });

  it('returns "No changes" when diff is empty', async () => {
    succeedWith('');
    const result = await gitDiffExecutor({});
    const content = result.content as any;
    expect(content.diff).toBe('No changes');
  });

  it('passes --cached when staged is true', async () => {
    succeedWith('');
    await gitDiffExecutor({ staged: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--cached');
  });

  it('passes --stat when stat is true', async () => {
    succeedWith('');
    await gitDiffExecutor({ stat: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--stat');
  });

  it('passes commit hash when commit provided', async () => {
    succeedWith('');
    await gitDiffExecutor({ commit: 'abc123' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('abc123');
  });

  it('passes commit range when commitRange provided', async () => {
    succeedWith('');
    await gitDiffExecutor({ commitRange: 'main..feature' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('main..feature');
  });

  it('passes -- file when file is specified', async () => {
    succeedWith('');
    await gitDiffExecutor({ file: 'src/app.ts' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--');
    expect(gitArgs).toContain('src/app.ts');
  });

  it('includes options in result', async () => {
    succeedWith('');
    const result = await gitDiffExecutor({
      staged: true,
      commit: 'abc',
      commitRange: 'a..b',
      file: 'x.ts',
      stat: true,
    });
    const content = result.content as any;
    expect(content.options).toEqual({
      staged: true,
      commit: 'abc',
      commitRange: 'a..b',
      file: 'x.ts',
      stat: true,
    });
  });

  it('counts multiple files in diff stats', async () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '+line1',
      'diff --git a/b.ts b/b.ts',
      '+line2',
      '+line3',
      '-removed',
    ].join('\n');
    succeedWith(diff);

    const result = await gitDiffExecutor({});
    const content = result.content as any;
    expect(content.stats.files).toBe(2);
    expect(content.stats.additions).toBe(3);
    expect(content.stats.deletions).toBe(1);
  });

  it('returns error when diff command fails', async () => {
    failWith('bad revision', 'stderr output');
    const result = await gitDiffExecutor({ commit: 'invalid' });
    expect(result.isError).toBe(true);
    const content = result.content as any;
    expect(content.error).toContain('bad revision');
    expect(content.stderr).toBe('stderr output');
  });

  it('combines multiple flags correctly', async () => {
    succeedWith('');
    await gitDiffExecutor({ staged: true, stat: true, file: 'f.ts' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toEqual(['diff', '--cached', '--stat', '--', 'f.ts']);
  });
});

// ===========================================================================
// GIT LOG EXECUTOR
// ===========================================================================

describe('gitLogExecutor', () => {
  it('parses structured log format (non-oneline)', async () => {
    const ts = Math.floor(new Date('2025-01-15T10:00:00Z').getTime() / 1000);
    const output = `abc123|John|john@test.com|${ts}|Initial commit\ndef456|Jane|jane@test.com|${ts}|Second commit\n`;
    succeedWith(output);

    const result = await gitLogExecutor({});
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.count).toBe(2);
    expect(content.commits[0].hash).toBe('abc123');
    expect(content.commits[0].author).toBe('John');
    expect(content.commits[0].email).toBe('john@test.com');
    expect(content.commits[0].message).toBe('Initial commit');
    expect(content.commits[1].hash).toBe('def456');
  });

  it('parses oneline format', async () => {
    const output = 'abc123 Initial commit\ndef456 Second commit\n';
    succeedWith(output);

    const result = await gitLogExecutor({ oneline: true });
    const content = result.content as any;
    expect(content.count).toBe(2);
    expect(content.commits[0].hash).toBe('abc123');
    expect(content.commits[0].message).toBe('Initial commit');
    expect(content.commits[1].hash).toBe('def456');
    expect(content.commits[1].message).toBe('Second commit');
  });

  it('defaults limit to 10', async () => {
    succeedWith('');
    await gitLogExecutor({});

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('-n');
    expect(gitArgs).toContain('10');
  });

  it('uses custom limit', async () => {
    succeedWith('');
    await gitLogExecutor({ limit: 5 });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('5');
  });

  it('passes --oneline flag', async () => {
    succeedWith('');
    await gitLogExecutor({ oneline: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--oneline');
  });

  it('passes author filter', async () => {
    succeedWith('');
    await gitLogExecutor({ author: 'John' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--author=John');
  });

  it('passes since filter', async () => {
    succeedWith('');
    await gitLogExecutor({ since: '2025-01-01' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--since=2025-01-01');
  });

  it('passes until filter', async () => {
    succeedWith('');
    await gitLogExecutor({ until: '2025-12-31' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--until=2025-12-31');
  });

  it('passes branch argument', async () => {
    succeedWith('');
    await gitLogExecutor({ branch: 'feature-x' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('feature-x');
  });

  it('passes -- file argument', async () => {
    succeedWith('');
    await gitLogExecutor({ file: 'README.md' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--');
    expect(gitArgs).toContain('README.md');
  });

  it('includes format flag when not oneline', async () => {
    succeedWith('');
    await gitLogExecutor({});

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--format=%H|%an|%ae|%at|%s');
  });

  it('does not include format flag when oneline', async () => {
    succeedWith('');
    await gitLogExecutor({ oneline: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).not.toContain('--format=%H|%an|%ae|%at|%s');
  });

  it('includes filters in result', async () => {
    succeedWith('');
    const result = await gitLogExecutor({
      author: 'A',
      since: 'S',
      until: 'U',
      file: 'F',
      branch: 'B',
    });
    const content = result.content as any;
    expect(content.filters).toEqual({
      author: 'A',
      since: 'S',
      until: 'U',
      file: 'F',
      branch: 'B',
    });
  });

  it('handles commit messages with pipe characters', async () => {
    const ts = '1700000000';
    const output = `abc123|John|j@t.com|${ts}|fix: handle A|B edge case\n`;
    succeedWith(output);

    const result = await gitLogExecutor({});
    const content = result.content as any;
    expect(content.commits[0].message).toBe('fix: handle A|B edge case');
  });

  it('returns error on failure', async () => {
    failWith('does not have any commits yet', 'stderr');
    const result = await gitLogExecutor({});
    expect(result.isError).toBe(true);
    const content = result.content as any;
    expect(content.error).toContain('does not have any commits yet');
  });

  it('converts unix timestamp to ISO date', async () => {
    const ts = '1705312800'; // 2024-01-15T10:00:00Z
    const output = `abc|Author|a@t.com|${ts}|msg\n`;
    succeedWith(output);

    const result = await gitLogExecutor({});
    const content = result.content as any;
    const expectedDate = new Date(parseInt(ts) * 1000).toISOString();
    expect(content.commits[0].date).toBe(expectedDate);
  });
});

// ===========================================================================
// GIT COMMIT EXECUTOR
// ===========================================================================

describe('gitCommitExecutor', () => {
  it('creates a commit and returns hash', async () => {
    succeedWith('[main abc1234] test commit\n 1 file changed');
    succeedWith('abc1234abcdef\n');

    const result = await gitCommitExecutor({ message: 'test commit' });
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.success).toBe(true);
    expect(content.commitHash).toBe('abc1234abcdef');
    expect(content.message).toBe('test commit');
    expect(content.amend).toBe(false);
  });

  it('passes -a flag when all is true', async () => {
    succeedWith('commit output');
    succeedWith('hash\n');

    await gitCommitExecutor({ message: 'msg', all: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('-a');
  });

  it('passes --amend flag when amend is true', async () => {
    succeedWith('commit output');
    succeedWith('hash\n');

    await gitCommitExecutor({ message: 'amended', amend: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('--amend');
  });

  it('returns error when message is empty and not amending', async () => {
    const result = await gitCommitExecutor({ message: '' });
    expect(result.isError).toBe(true);
    const content = result.content as any;
    expect(content.error).toBe('Commit message is required');
  });

  it('passes -m flag with the message', async () => {
    succeedWith('ok');
    succeedWith('hash\n');

    await gitCommitExecutor({ message: 'my message' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('-m');
    expect(gitArgs).toContain('my message');
  });

  it('returns error when git commit fails', async () => {
    failWith('nothing to commit', 'stderr');
    const result = await gitCommitExecutor({ message: 'msg' });
    expect(result.isError).toBe(true);
    const content = result.content as any;
    expect(content.error).toContain('nothing to commit');
  });

  it('sets amend to true in content when amend flag is set', async () => {
    succeedWith('ok');
    succeedWith('hash\n');

    const result = await gitCommitExecutor({ message: 'fix', amend: true });
    const content = result.content as any;
    expect(content.amend).toBe(true);
  });

  it('uses provided path as cwd', async () => {
    succeedWith('ok');
    succeedWith('hash\n');

    await gitCommitExecutor({ message: 'msg', path: '/custom/path' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const opts = callArgs[2] as { cwd: string };
    expect(opts.cwd).toBe('/custom/path');
  });

  it('fetches HEAD hash after successful commit', async () => {
    succeedWith('commit ok');
    succeedWith('deadbeef\n');

    await gitCommitExecutor({ message: 'msg' });

    // The second call should be rev-parse HEAD
    const secondCall = mockExecFile.mock.calls[1] as unknown[];
    const gitArgs = secondCall[1] as string[];
    expect(gitArgs).toEqual(['rev-parse', 'HEAD']);
  });
});

// ===========================================================================
// GIT ADD EXECUTOR
// ===========================================================================

describe('gitAddExecutor', () => {
  it('stages specified files and returns status', async () => {
    succeedWith(''); // git add
    succeedWith('M  foo.ts\nA  bar.ts\n'); // git status -s

    const result = await gitAddExecutor({ files: ['foo.ts', 'bar.ts'] });
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.success).toBe(true);
    expect(content.staged).toEqual(['foo.ts', 'bar.ts']);
    expect(content.currentStatus).toHaveLength(2);
  });

  it('stages all with -A flag when all is true', async () => {
    succeedWith('');
    succeedWith('');

    await gitAddExecutor({ all: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toContain('-A');
  });

  it('defaults to "." when no files provided and all is false', async () => {
    succeedWith('');
    succeedWith('');

    await gitAddExecutor({});

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toEqual(['add', '.']);
  });

  it('reports staged as "all" when no files specified', async () => {
    succeedWith('');
    succeedWith('');

    const result = await gitAddExecutor({});
    const content = result.content as any;
    expect(content.staged).toEqual(['all']);
  });

  it('runs git status -s after adding', async () => {
    succeedWith('');
    succeedWith('M  file.ts\n');

    await gitAddExecutor({ files: ['file.ts'] });

    const secondCall = mockExecFile.mock.calls[1] as unknown[];
    const gitArgs = secondCall[1] as string[];
    expect(gitArgs).toEqual(['status', '-s']);
  });

  it('returns error when add command fails', async () => {
    failWith('pathspec did not match', 'stderr');

    const result = await gitAddExecutor({ files: ['nonexistent.ts'] });
    expect(result.isError).toBe(true);
    const content = result.content as any;
    expect(content.error).toContain('pathspec did not match');
  });

  it('handles empty status output after add', async () => {
    succeedWith('');
    succeedWith('');

    const result = await gitAddExecutor({ files: ['clean.ts'] });
    const content = result.content as any;
    // filter(l => l) removes empty strings
    expect(content.currentStatus).toEqual([]);
  });

  it('passes multiple files as separate arguments', async () => {
    succeedWith('');
    succeedWith('');

    await gitAddExecutor({ files: ['a.ts', 'b.ts', 'c.ts'] });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toEqual(['add', 'a.ts', 'b.ts', 'c.ts']);
  });
});

// ===========================================================================
// GIT BRANCH EXECUTOR
// ===========================================================================

describe('gitBranchExecutor', () => {
  describe('list action', () => {
    it('lists branches and marks current', async () => {
      const output = '  develop\n* main\n  feature-x\n';
      succeedWith(output);

      const result = await gitBranchExecutor({ action: 'list' });
      expect(result.isError).toBe(false);

      const content = result.content as any;
      expect(content.count).toBe(3);
      expect(content.branches[0]).toEqual({ name: 'develop', current: false });
      expect(content.branches[1]).toEqual({ name: 'main', current: true });
      expect(content.branches[2]).toEqual({ name: 'feature-x', current: false });
    });

    it('passes -a flag when remote is true', async () => {
      succeedWith('* main\n');
      await gitBranchExecutor({ action: 'list', remote: true });

      const callArgs = mockExecFile.mock.calls[0] as unknown[];
      const gitArgs = callArgs[1] as string[];
      expect(gitArgs).toContain('-a');
    });

    it('defaults to list when no action specified', async () => {
      succeedWith('* main\n');
      const result = await gitBranchExecutor({});
      expect(result.isError).toBe(false);

      const content = result.content as any;
      expect(content.branches).toBeDefined();
    });
  });

  describe('create action', () => {
    it('creates a branch successfully', async () => {
      succeedWith('');
      const result = await gitBranchExecutor({ action: 'create', name: 'new-branch' });
      expect(result.isError).toBe(false);

      const content = result.content as any;
      expect(content.success).toBe(true);
      expect(content.created).toBe('new-branch');
    });

    it('passes correct args to git branch', async () => {
      succeedWith('');
      await gitBranchExecutor({ action: 'create', name: 'feature' });

      const callArgs = mockExecFile.mock.calls[0] as unknown[];
      const gitArgs = callArgs[1] as string[];
      expect(gitArgs).toEqual(['branch', 'feature']);
    });

    it('returns error when name is missing', async () => {
      const result = await gitBranchExecutor({ action: 'create' });
      expect(result.isError).toBe(true);
      const content = result.content as any;
      expect(content.error).toBe('Branch name required');
    });
  });

  describe('delete action', () => {
    it('deletes a branch successfully', async () => {
      succeedWith('Deleted branch old-branch');
      const result = await gitBranchExecutor({ action: 'delete', name: 'old-branch' });
      expect(result.isError).toBe(false);

      const content = result.content as any;
      expect(content.success).toBe(true);
      expect(content.deleted).toBe('old-branch');
    });

    it('passes -d flag', async () => {
      succeedWith('');
      await gitBranchExecutor({ action: 'delete', name: 'x' });

      const callArgs = mockExecFile.mock.calls[0] as unknown[];
      const gitArgs = callArgs[1] as string[];
      expect(gitArgs).toEqual(['branch', '-d', 'x']);
    });

    it('returns error when name is missing', async () => {
      const result = await gitBranchExecutor({ action: 'delete' });
      expect(result.isError).toBe(true);
      const content = result.content as any;
      expect(content.error).toBe('Branch name required');
    });
  });

  describe('rename action', () => {
    it('renames a branch successfully', async () => {
      succeedWith('');
      const result = await gitBranchExecutor({ action: 'rename', name: 'old', newName: 'new' });
      expect(result.isError).toBe(false);

      const content = result.content as any;
      expect(content.success).toBe(true);
      expect(content.renamed).toEqual({ from: 'old', to: 'new' });
    });

    it('passes -m flag with both names', async () => {
      succeedWith('');
      await gitBranchExecutor({ action: 'rename', name: 'a', newName: 'b' });

      const callArgs = mockExecFile.mock.calls[0] as unknown[];
      const gitArgs = callArgs[1] as string[];
      expect(gitArgs).toEqual(['branch', '-m', 'a', 'b']);
    });

    it('returns error when name is missing', async () => {
      const result = await gitBranchExecutor({ action: 'rename', newName: 'b' });
      expect(result.isError).toBe(true);
      const content = result.content as any;
      expect(content.error).toBe('Both name and newName required');
    });

    it('returns error when newName is missing', async () => {
      const result = await gitBranchExecutor({ action: 'rename', name: 'a' });
      expect(result.isError).toBe(true);
      const content = result.content as any;
      expect(content.error).toBe('Both name and newName required');
    });
  });

  describe('unknown action', () => {
    it('returns error for unknown action', async () => {
      const result = await gitBranchExecutor({ action: 'merge' });
      expect(result.isError).toBe(true);
      const content = result.content as any;
      expect(content.error).toBe('Unknown action: merge');
    });
  });

  describe('error handling', () => {
    it('returns error when git branch command fails', async () => {
      failWith('branch already exists', 'stderr');
      const result = await gitBranchExecutor({ action: 'create', name: 'existing' });
      expect(result.isError).toBe(true);
      const content = result.content as any;
      expect(content.error).toContain('branch already exists');
    });
  });
});

// ===========================================================================
// GIT CHECKOUT EXECUTOR
// ===========================================================================

describe('gitCheckoutExecutor', () => {
  it('checks out an existing branch', async () => {
    succeedWith("Switched to branch 'main'\n");
    const result = await gitCheckoutExecutor({ branch: 'main' });
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.success).toBe(true);
    expect(content.target).toBe('main');
    expect(content.newBranch).toBe(false);
  });

  it('creates and checks out a new branch with -b', async () => {
    succeedWith("Switched to a new branch 'feature'\n");
    const result = await gitCheckoutExecutor({ branch: 'feature', createBranch: true });
    expect(result.isError).toBe(false);

    const content = result.content as any;
    expect(content.success).toBe(true);
    expect(content.target).toBe('feature');
    expect(content.newBranch).toBe(true);
  });

  it('passes -b flag when createBranch is true', async () => {
    succeedWith('');
    await gitCheckoutExecutor({ branch: 'new-feat', createBranch: true });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toEqual(['checkout', '-b', 'new-feat']);
  });

  it('restores a file with -- separator', async () => {
    succeedWith('');
    const result = await gitCheckoutExecutor({ file: 'src/app.ts' });
    expect(result.isError).toBe(false);

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    expect(gitArgs).toEqual(['checkout', '--', 'src/app.ts']);

    const content = result.content as any;
    expect(content.target).toBe('src/app.ts');
  });

  it('returns error when neither branch nor file is specified', async () => {
    const result = await gitCheckoutExecutor({});
    expect(result.isError).toBe(true);
    const content = result.content as any;
    expect(content.error).toBe('Either branch or file must be specified');
  });

  it('returns "Checkout successful" when stdout is empty', async () => {
    succeedWith('');
    const result = await gitCheckoutExecutor({ branch: 'main' });
    const content = result.content as any;
    expect(content.output).toBe('Checkout successful');
  });

  it('prefers branch over file when both are provided', async () => {
    succeedWith('');
    await gitCheckoutExecutor({ branch: 'develop', file: 'f.ts' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    // Branch takes priority in the if-else chain
    expect(gitArgs).toEqual(['checkout', 'develop']);
  });

  it('returns error when checkout fails', async () => {
    failWith("pathspec 'missing' did not match", 'stderr');
    const result = await gitCheckoutExecutor({ branch: 'missing' });
    expect(result.isError).toBe(true);
    const content = result.content as any;
    expect(content.error).toContain('pathspec');
  });

  it('uses provided path as cwd', async () => {
    succeedWith('');
    await gitCheckoutExecutor({ branch: 'main', path: '/repos/myproject' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const opts = callArgs[2] as { cwd: string };
    expect(opts.cwd).toBe('/repos/myproject');
  });

  it('createBranch without branch name just runs checkout', async () => {
    // createBranch is true but branch is undefined, file is set
    succeedWith('');
    await gitCheckoutExecutor({ createBranch: true, file: 'foo.ts' });

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const gitArgs = callArgs[1] as string[];
    // Since !branch, it falls to file case
    expect(gitArgs).toEqual(['checkout', '--', 'foo.ts']);
  });
});

// ===========================================================================
// COMMON BEHAVIOR: maxBuffer / cwd defaults
// ===========================================================================

describe('common gitExec behavior', () => {
  it('sets maxBuffer to 100000', async () => {
    succeedWith('');
    await gitStatusExecutor({});

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    const opts = callArgs[2] as { maxBuffer: number };
    expect(opts.maxBuffer).toBe(100000);
  });

  it('always calls git as the command', async () => {
    succeedWith('');
    await gitStatusExecutor({});

    const callArgs = mockExecFile.mock.calls[0] as unknown[];
    expect(callArgs[0]).toBe('git');
  });
});
