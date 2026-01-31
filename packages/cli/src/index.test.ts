import { describe, it, expect } from 'vitest';

describe('CLI', () => {
  it('should export commands', { timeout: 15000 }, async () => {
    const commands = await import('./commands/index.js');

    expect(commands.startServer).toBeDefined();
    expect(commands.startBot).toBeDefined();
    expect(commands.startAll).toBeDefined();
  });

  it('should have valid command functions', async () => {
    const commands = await import('./commands/index.js');

    expect(typeof commands.startServer).toBe('function');
    expect(typeof commands.startBot).toBe('function');
    expect(typeof commands.startAll).toBe('function');
  });

  it('should export config commands', async () => {
    const commands = await import('./commands/index.js');

    expect(commands.setup).toBeDefined();
    expect(commands.configSet).toBeDefined();
    expect(commands.configGet).toBeDefined();
    expect(commands.configDelete).toBeDefined();
    expect(commands.configList).toBeDefined();
    expect(commands.configChangePassword).toBeDefined();
    expect(commands.loadCredentialsToEnv).toBeDefined();
  });

  it('should have valid config functions', async () => {
    const commands = await import('./commands/index.js');

    expect(typeof commands.setup).toBe('function');
    expect(typeof commands.configSet).toBe('function');
    expect(typeof commands.configGet).toBe('function');
    expect(typeof commands.configDelete).toBe('function');
    expect(typeof commands.configList).toBe('function');
    expect(typeof commands.configChangePassword).toBe('function');
    expect(typeof commands.loadCredentialsToEnv).toBe('function');
  });
});
