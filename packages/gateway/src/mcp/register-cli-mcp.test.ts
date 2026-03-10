/**
 * CLI MCP Registration Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../services/binary-utils.js', () => ({
  isBinaryInstalled: vi.fn().mockReturnValue(true),
}));

import {
  registerMcpForCli,
  registerMcpForAllClis,
  unregisterMcpForCli,
  getMcpConfigSnippet,
} from './register-cli-mcp.js';
import { isBinaryInstalled } from '../services/binary-utils.js';

describe('registerMcpForCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBinaryInstalled).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue('{}');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
  });

  it('should register with Claude Code', async () => {
    const result = await registerMcpForCli('claude', { gatewayUrl: 'http://localhost:9090' });

    expect(result.success).toBe(true);
    expect(result.cli).toBe('claude');
    expect(result.configPath).toContain('.claude');

    // Verify written config
    const writeCall = vi.mocked(writeFile).mock.calls[0]!;
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.ownpilot).toEqual({
      type: 'http',
      url: 'http://localhost:9090/api/v1/mcp/serve',
    });
  });

  it('should register with Gemini CLI', async () => {
    const result = await registerMcpForCli('gemini');

    expect(result.success).toBe(true);
    expect(result.configPath).toContain('.gemini');

    const writeCall = vi.mocked(writeFile).mock.calls[0]!;
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.ownpilot).toEqual({
      httpUrl: 'http://localhost:8080/api/v1/mcp/serve',
      trust: true,
    });
  });

  it('should register with Codex CLI using stdio transport', async () => {
    const result = await registerMcpForCli('codex');

    expect(result.success).toBe(true);
    expect(result.configPath).toContain('.codex');

    const writeCall = vi.mocked(writeFile).mock.calls[0]!;
    const written = JSON.parse(writeCall[1] as string);
    // Codex uses stdio transport (not streamable-http)
    expect(written.mcpServers.ownpilot).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['./cli-mcp-server.js'],
      env: { OWNPILOT_URL: 'http://localhost:8080' },
    });
  });

  it('should fail if CLI is not installed', async () => {
    vi.mocked(isBinaryInstalled).mockReturnValue(false);

    const result = await registerMcpForCli('claude');

    expect(result.success).toBe(false);
    expect(result.message).toContain('not installed');
  });

  it('should preserve existing config', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        mcpServers: { other: { type: 'stdio', command: 'other-server' } },
        otherSetting: true,
      })
    );

    await registerMcpForCli('claude');

    const writeCall = vi.mocked(writeFile).mock.calls[0]!;
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.other).toBeDefined();
    expect(written.mcpServers.ownpilot).toBeDefined();
    expect(written.otherSetting).toBe(true);
  });

  it('should use stdio transport when serverScript is provided', async () => {
    await registerMcpForCli('claude', {
      gatewayUrl: 'http://localhost:8080',
      serverScript: '/path/to/mcp-server.js',
    });

    const writeCall = vi.mocked(writeFile).mock.calls[0]!;
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.ownpilot).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['/path/to/mcp-server.js'],
      env: { OWNPILOT_URL: 'http://localhost:8080' },
    });
  });
});

describe('registerMcpForAllClis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBinaryInstalled).mockReturnValue(true);
    vi.mocked(readFile).mockResolvedValue('{}');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
  });

  it('should register with all 3 CLIs', async () => {
    const results = await registerMcpForAllClis();

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.map((r) => r.cli)).toEqual(['claude', 'gemini', 'codex']);
  });
});

describe('unregisterMcpForCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          ownpilot: { type: 'http', url: 'http://localhost:8080/api/v1/mcp/serve' },
          other: { type: 'stdio', command: 'other' },
        },
      })
    );
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
  });

  it('should remove ownpilot from config', async () => {
    const result = await unregisterMcpForCli('claude');

    expect(result.success).toBe(true);

    const writeCall = vi.mocked(writeFile).mock.calls[0]!;
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.ownpilot).toBeUndefined();
    expect(written.mcpServers.other).toBeDefined();
  });

  it('should succeed even if not registered', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

    const result = await unregisterMcpForCli('gemini');

    expect(result.success).toBe(true);
    expect(result.message).toContain('not registered');
  });
});

describe('getMcpConfigSnippet', () => {
  it('should return config snippet for Claude', () => {
    const { snippet, configPath } = getMcpConfigSnippet('claude', {
      gatewayUrl: 'http://myserver:8080',
    });

    expect(configPath).toContain('.claude');
    expect(snippet).toEqual({
      mcpServers: {
        ownpilot: {
          type: 'http',
          url: 'http://myserver:8080/api/v1/mcp/serve',
        },
      },
    });
  });

  it('should use default URL', () => {
    const { snippet } = getMcpConfigSnippet('gemini');

    const entry = (snippet.mcpServers as Record<string, Record<string, string>>).ownpilot;
    expect(entry.httpUrl).toContain('localhost:8080');
    expect(entry.trust).toBe(true);
  });
});
