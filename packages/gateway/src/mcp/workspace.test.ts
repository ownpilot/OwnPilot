/**
 * CLI Workspace Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { ensureWorkspace, createTempWorkspace, getWorkspaceDir } from './workspace.js';

describe('ensureWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create workspace directory', async () => {
    const result = await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    expect(mkdir).toHaveBeenCalledWith('/tmp/test-ws', { recursive: true });
    expect(result.dir).toBe('/tmp/test-ws');
  });

  it('should write .mcp.json with gateway URL', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws', gatewayUrl: 'http://myhost:9090' });

    const mcpCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('.mcp.json')
    );
    expect(mcpCall).toBeDefined();
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.url).toBe('http://myhost:9090/api/v1/mcp/serve');
    expect(content.mcpServers.ownpilot.type).toBe('streamable-http');
  });

  it('should write CLAUDE.md', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const claudeCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('CLAUDE.md')
    );
    expect(claudeCall).toBeDefined();
    expect(claudeCall![1] as string).toContain('OwnPilot');
    expect(claudeCall![1] as string).toContain('MCP');
  });

  it('should write GEMINI.md', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const geminiCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('GEMINI.md')
    );
    expect(geminiCall).toBeDefined();
  });

  it('should write AGENTS.md with minimal tool guide', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const agentsCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('AGENTS.md')
    );
    expect(agentsCall).toBeDefined();
    const content = agentsCall![1] as string;
    expect(content).toContain('OwnPilot');
    expect(content).toContain('MCP');
    expect(content).toContain('add_task');
    expect(content).toContain('search_memories');
  });

  it('should include correlationId in MCP URL when provided', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws', correlationId: 'test-corr-123' });

    const mcpCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('.mcp.json')
    );
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.url).toContain('correlationId=test-corr-123');
    expect(content.mcpServers.ownpilot.httpUrl).toContain('correlationId=test-corr-123');
  });

  it('should include session token as X-Session-Token header when provided', async () => {
    await ensureWorkspace({
      baseDir: '/tmp/test-ws',
      sessionToken: 'mcp-token-abc',
    });

    const mcpCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('.mcp.json')
    );
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.headers).toEqual({
      'X-Session-Token': 'mcp-token-abc',
    });
  });

  it('should not include headers when no session token', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const mcpCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('.mcp.json')
    );
    const content = JSON.parse(mcpCall![1] as string);
    expect(content.mcpServers.ownpilot.headers).toBeUndefined();
  });

  it('should write 4 files total', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    expect(writeFile).toHaveBeenCalledTimes(4);
  });

  it('should use default gateway URL', async () => {
    await ensureWorkspace({ baseDir: '/tmp/test-ws' });

    const mcpCall = vi.mocked(writeFile).mock.calls.find(
      (c) => (c[0] as string).includes('.mcp.json')
    );
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

  it('should cleanup temp workspace', async () => {
    const result = await createTempWorkspace();

    await result.cleanup();

    expect(rm).toHaveBeenCalledWith(result.dir, { recursive: true, force: true });
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
