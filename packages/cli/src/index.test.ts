import { describe, it, expect } from 'vitest';
import { startServer } from './commands/server.js';
import { startBot } from './commands/bot.js';
import { startAll } from './commands/start.js';
import {
  setup,
  configSet,
  configGet,
  configDelete,
  configList,
  configChangePassword,
  loadCredentialsToEnv,
} from './commands/config.js';

describe('CLI', { timeout: 30_000 }, () => {
  it('should export commands', () => {
    expect(startServer).toBeDefined();
    expect(startBot).toBeDefined();
    expect(startAll).toBeDefined();
  });

  it('should have valid command functions', () => {
    expect(typeof startServer).toBe('function');
    expect(typeof startBot).toBe('function');
    expect(typeof startAll).toBe('function');
  });

  it('should export config commands', () => {
    expect(setup).toBeDefined();
    expect(configSet).toBeDefined();
    expect(configGet).toBeDefined();
    expect(configDelete).toBeDefined();
    expect(configList).toBeDefined();
    expect(configChangePassword).toBeDefined();
    expect(loadCredentialsToEnv).toBeDefined();
  });

  it('should have valid config functions', () => {
    expect(typeof setup).toBe('function');
    expect(typeof configSet).toBe('function');
    expect(typeof configGet).toBe('function');
    expect(typeof configDelete).toBe('function');
    expect(typeof configList).toBe('function');
    expect(typeof configChangePassword).toBe('function');
    expect(typeof loadCredentialsToEnv).toBe('function');
  });
});
