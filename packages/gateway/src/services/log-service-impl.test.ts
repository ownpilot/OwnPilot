/**
 * LogService Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogService, createLogService } from './log-service-impl.js';

describe('LogService', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    debug: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('level filtering', () => {
    it('filters debug messages when level is info', () => {
      const log = new LogService({ level: 'info' });
      log.debug('hidden');
      log.info('visible');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledOnce();
    });

    it('shows all messages when level is debug', () => {
      const log = new LogService({ level: 'debug' });
      log.debug('debug msg');
      log.info('info msg');
      log.warn('warn msg');
      log.error('error msg');

      expect(consoleSpy.debug).toHaveBeenCalledOnce();
      expect(consoleSpy.log).toHaveBeenCalledOnce();
      expect(consoleSpy.warn).toHaveBeenCalledOnce();
      expect(consoleSpy.error).toHaveBeenCalledOnce();
    });

    it('only shows warn and error when level is warn', () => {
      const log = new LogService({ level: 'warn' });
      log.debug('hidden');
      log.info('hidden');
      log.warn('visible');
      log.error('visible');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledOnce();
      expect(consoleSpy.error).toHaveBeenCalledOnce();
    });

    it('always shows error messages regardless of level', () => {
      const log = new LogService({ level: 'error' });
      log.debug('hidden');
      log.info('hidden');
      log.warn('hidden');
      log.error('visible');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledOnce();
    });
  });

  describe('dev output (non-JSON)', () => {
    it('prefixes with module name', () => {
      const log = new LogService({ level: 'info', json: false, module: 'TestModule' });
      log.info('hello');

      expect(consoleSpy.log).toHaveBeenCalledWith('[TestModule] hello');
    });

    it('passes data as second argument', () => {
      const log = new LogService({ level: 'info', json: false, module: 'Test' });
      log.info('msg', { key: 'val' });

      expect(consoleSpy.log).toHaveBeenCalledWith('[Test] msg', { key: 'val' });
    });

    it('omits prefix when no module set', () => {
      const log = new LogService({ level: 'info', json: false });
      log.info('bare message');

      expect(consoleSpy.log).toHaveBeenCalledWith(' bare message');
    });
  });

  describe('JSON output', () => {
    it('outputs valid JSON with all fields', () => {
      const log = new LogService({ level: 'info', json: true, module: 'API' });
      log.info('request processed', { status: 200 });

      expect(consoleSpy.log).toHaveBeenCalledOnce();
      const output = JSON.parse(consoleSpy.log.mock.calls[0][0] as string);
      expect(output.level).toBe('info');
      expect(output.module).toBe('API');
      expect(output.msg).toBe('request processed');
      expect(output.status).toBe(200);
      expect(output.ts).toBeTruthy();
    });

    it('wraps non-object data in { data }', () => {
      const log = new LogService({ level: 'info', json: true });
      log.info('count', 42);

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0] as string);
      expect(output.data).toBe(42);
    });

    it('omits module when not set', () => {
      const log = new LogService({ level: 'info', json: true });
      log.info('test');

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0] as string);
      expect(output.module).toBeUndefined();
    });
  });

  describe('child logger', () => {
    it('creates child with combined module name', () => {
      const parent = new LogService({ level: 'info', json: false, module: 'Parent' });
      const child = parent.child('Child');
      child.info('hello');

      expect(consoleSpy.log).toHaveBeenCalledWith('[Parent:Child] hello');
    });

    it('inherits log level from parent', () => {
      const parent = new LogService({ level: 'warn', json: false });
      const child = parent.child('Child');
      child.info('hidden');
      child.warn('visible');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledOnce();
    });

    it('sets module directly when parent has no module', () => {
      const parent = new LogService({ level: 'info', json: false });
      const child = parent.child('Module');
      child.info('test');

      expect(consoleSpy.log).toHaveBeenCalledWith('[Module] test');
    });
  });

  describe('createLogService factory', () => {
    it('returns a LogService instance', () => {
      const log = createLogService({ level: 'info' });
      expect(log).toBeInstanceOf(LogService);
    });

    it('defaults to info level', () => {
      const log = createLogService();
      log.debug('hidden');
      log.info('visible');

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledOnce();
    });
  });
});
