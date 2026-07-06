/**
 * Tunnel Service Tests
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { getTunnelService } from './tunnel-service.js';

type MockChildProcess = ChildProcess & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeMockChild(): MockChildProcess {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  }) as MockChildProcess;
}

async function waitForSpawnListeners(): Promise<void> {
  await Promise.resolve();
}

describe('TunnelService', () => {
  let service: ReturnType<typeof getTunnelService>;

  beforeEach(async () => {
    service = getTunnelService();
    await service.stop();
    spawnMock.mockReset();
  });

  afterEach(async () => {
    await service.stop();
  });

  describe('getStatus()', () => {
    it('should return stopped status initially', () => {
      const status = service.getStatus();
      expect(status.status).toBe('stopped');
      expect(status.url).toBeNull();
    });
  });

  describe('getUrl()', () => {
    it('should return null when tunnel is not running', () => {
      expect(service.getUrl()).toBeNull();
    });
  });

  describe('configure()', () => {
    it('should accept port configuration', () => {
      service.configure({ port: 3000 });
      const status = service.getStatus();
      expect(status.status).toBe('stopped');
    });

    it('should accept password configuration', () => {
      service.configure({ password: 'secret123' });
      // No status change expected for config-only
      expect(service.getStatus().status).toBe('stopped');
    });

    it('should accept hostname configuration', () => {
      service.configure({ hostname: 'my-tunnel.example.com' });
      expect(service.getStatus().status).toBe('stopped');
    });
  });

  describe('start()', () => {
    it('keeps the cloudflared process owned after the startup URL is detected', async () => {
      const child = makeMockChild();
      spawnMock.mockReturnValue(child);

      const startPromise = service.start('secret123');
      await waitForSpawnListeners();
      child.stderr.emit('data', Buffer.from('https://abc-123.trycloudflare.com'));
      const status = await startPromise;

      expect(status).toMatchObject({
        status: 'running',
        url: 'https://abc-123.trycloudflare.com',
      });

      await service.stop();

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(service.getStatus().status).toBe('stopped');
    });

    it('marks the tunnel errored when cloudflared exits after startup', async () => {
      const child = makeMockChild();
      spawnMock.mockReturnValue(child);

      const startPromise = service.start();
      await waitForSpawnListeners();
      child.stderr.emit('data', Buffer.from('https://runtime-exit.trycloudflare.com'));
      await startPromise;

      child.emit('exit', 42);

      expect(service.getStatus()).toMatchObject({
        status: 'error',
        url: null,
        error: 'cloudflared exited unexpectedly (code 42)',
      });
    });
  });
});
