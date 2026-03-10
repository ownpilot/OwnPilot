/**
 * CLI Workspace Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { ensureWorkspace, createTempWorkspace, getWorkspaceDir } from './workspace.js';

describe('ensureWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue('{}');
  });

  it('should create workspace directory', async () => {
    const result = await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    expect(mkdir).toHaveBeenCalledWith('/tmp/test-ws', { recursive: true });
    expect(result.dir).toBe('/tmp/test-ws');
  });

  it('should write .mcp.json with gateway URL', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws', gatewayUrl: 'http://myhost:9090' });

    const mcpCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.mcp.json'));
    expect(mcpCall).toBeDefined();
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.url).toBe('http://myhost:9090/api/v1/mcp/serve');
    expect(content.mcpServers.ownpilot.type).toBe('http');
  });

  it('should write CLAUDE.md', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const claudeCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('CLAUDE.md'));
    expect(claudeCall).toBeDefined();
    expect(claudeCall![1] as string).toContain('OwnPilot');
    expect(claudeCall![1] as string).toContain('MCP');
  });

  it('should write GEMINI.md', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const geminiCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('GEMINI.md'));
    expect(geminiCall).toBeDefined();
  });

  it('should write CODEX.md', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const codexCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('CODEX.md'));
    expect(codexCall).toBeDefined();
    expect(codexCall![1] as string).toContain('OwnPilot');
    expect(codexCall![1] as string).toContain('shared OwnPilot workspace');
  });

  it('should write AGENTS.md with minimal tool guide', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const agentsCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('AGENTS.md'));
    expect(agentsCall).toBeDefined();
    const content = agentsCall![1] as string;
    expect(content).toContain('OwnPilot');
    expect(content).toContain('MCP');
    expect(content).toContain('add_task');
    expect(content).toContain('list_tasks');
  });

  it('should include correlationId in MCP URL when provided', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws', correlationId: 'test-corr-123' });

    const mcpCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.mcp.json'));
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.url).toContain('correlationId=test-corr-123');
    expect(content.mcpServers.ownpilot.httpUrl).toContain('correlationId=test-corr-123');
  });

  it('should include session token as X-Session-Token header when provided', async () => {
    await ensureWorkspace({
      baseDir: '/tmp/test-ws',
      sessionToken: 'mcp-token-abc',
    });

    const mcpCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.mcp.json'));
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.headers).toEqual({
      'X-Session-Token': 'mcp-token-abc',
    });
  });

  it('should not include headers when no session token', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const mcpCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.mcp.json'));
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.headers).toBeUndefined();
  });

  it('should write 4 files total', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    expect(writeFile).toHaveBeenCalledTimes(5);
  });

  it('should only write workspace config files', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const paths = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]));
    expect(paths.some((p) => p.endsWith('.mcp.json'))).toBe(true);
    expect(paths.some((p) => p.endsWith('AGENTS.md'))).toBe(true);
    expect(paths.some((p) => p.endsWith('CLAUDE.md'))).toBe(true);
    expect(paths.some((p) => p.endsWith('GEMINI.md'))).toBe(true);
    expect(paths.some((p) => p.endsWith('CODEX.md'))).toBe(true);
  });

  it('should remove stale ownpilot entries from global gemini/codex configs', async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return value.includes('.gemini') || value.includes('.codex') ? true : false;
    });
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        mcpServers: { ownpilot: { url: 'http://old' }, other: { url: 'http://keep' } },
      })
    );

    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const writes = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]));
    expect(writes.some((p) => p.includes('.gemini') && p.includes('settings.json'))).toBe(true);
    expect(writes.some((p) => p.includes('.codex') && p.includes('mcp.json'))).toBe(true);
  });

  it('should use default gateway URL', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const mcpCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.mcp.json'));
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.url).toContain('localhost:8080');
  });

  it('should return mcpConfigPath', async () => {
    const result = await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    expect(result.mcpConfigPath).toBe(join('/tmp/test-ws', '.mcp.json'));
  });
});

describe('createTempWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create workspace in temp dir', async () => {
    const result = await createTempWorkspace();

    expect(result.dir).toContain('ownpilot');
    expect(typeof result.cleanup).toBe('function');
  });

  it('cleanup should be a no-op (persistent workspace)', async () => {
    const result = await createTempWorkspace();
    const rmCallsBeforeCleanup = vi.mocked(rm).mock.calls.length;

    await result.cleanup();

    // Persistent workspace is reused — cleanup does not delete it
    expect(vi.mocked(rm).mock.calls.length).toBe(rmCallsBeforeCleanup);
  });
});

describe('getWorkspaceDir', () => {
  it('should return custom dir when provided', () => {
    expect(getWorkspaceDir({ baseDir: '/custom/path' })).toBe('/custom/path');
  });

  it('should return default dir in home', () => {
    const dir = getWorkspaceDir();
    expect(dir).toContain('.ownpilot');
    expect(dir).toContain('workspace');
  });
});
