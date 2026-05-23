/**
 * RuntimeContext tests.
 *
 * The bundle is a thin composition over the individual capability getters,
 * which have their own coverage. These tests pin only the bundle's
 * behavior: once everything is wired, all four capabilities are returned
 * by-reference, and hasRuntimeContext() agrees with the underlying
 * has*() checks.
 *
 * Note: module-level singletons (set by setLLMRouter etc.) persist
 * across tests in the same file, so we set them once in beforeAll
 * rather than trying to reset between tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { setLLMRouter } from './llm-router.js';
import { setChannelService } from '../channels/service.js';
import { setConfigCenter } from './config-center.js';
import { setPermissionGate } from './permission-gate.js';
import { setMemoryService } from './memory-service-interface.js';
import { getRuntimeContext, hasRuntimeContext } from './runtime-context.js';

import type { ILLMRouter } from './llm-router.js';
import type { IChannelService } from '../channels/service.js';
import type { ConfigCenter } from './config-center.js';
import type { IPermissionGate } from './permission-gate.js';
import type { IMemoryService } from './memory-service-interface.js';

const stubLLMRouter: ILLMRouter = {
  pick: async () => ({ provider: 'p', model: 'm' }),
  getContextWindow: () => 128_000,
  getMaxOutput: () => 4096,
  computeMemoryMaxTokens: () => 32_000,
  calculateCost: () => 0,
};

const stubChannelService: Partial<IChannelService> = {
  send: async () => 'msg-id',
  listChannels: () => [],
};

const stubConfigCenter: Partial<ConfigCenter> = {
  getApiKey: () => undefined,
  getFieldValue: () => undefined,
};

const stubPermissionGate: IPermissionGate = {
  check: async () => ({ type: 'allow' }),
};

const stubMemoryService: Partial<IMemoryService> = {
  // Minimal stub — getRuntimeContext() returns the reference, nothing more.
  // Functional tests for memory live in the gateway memory-service suite.
  listMemories: async () => [],
};

describe('RuntimeContext', () => {
  beforeAll(() => {
    setLLMRouter(stubLLMRouter);
    setChannelService(stubChannelService as IChannelService);
    setConfigCenter(stubConfigCenter as ConfigCenter);
    setPermissionGate(stubPermissionGate);
    setMemoryService(stubMemoryService as IMemoryService);
  });

  it('hasRuntimeContext() is true once all five explicit capabilities are set', () => {
    expect(hasRuntimeContext()).toBe(true);
  });

  it('getRuntimeContext() returns the registered LLM router by reference', () => {
    expect(getRuntimeContext().llm).toBe(stubLLMRouter);
  });

  it('getRuntimeContext() returns the registered channel service by reference', () => {
    expect(getRuntimeContext().channels).toBe(stubChannelService);
  });

  it('getRuntimeContext() returns the registered config center by reference', () => {
    expect(getRuntimeContext().config).toBe(stubConfigCenter);
  });

  it('getRuntimeContext() returns the registered permission gate by reference', () => {
    expect(getRuntimeContext().permissions).toBe(stubPermissionGate);
  });

  it('getRuntimeContext() returns the registered memory service by reference', () => {
    expect(getRuntimeContext().memory).toBe(stubMemoryService);
  });

  it('getRuntimeContext() returns a working event system', () => {
    const ctx = getRuntimeContext();
    // EventSystem is lazy-created on first access; just verify it's
    // present and usable.
    expect(ctx.events).toBeDefined();
    expect(typeof ctx.events.emit).toBe('function');
    expect(typeof ctx.events.on).toBe('function');
  });

  it('returns the same capability references on repeated calls', () => {
    const a = getRuntimeContext();
    const b = getRuntimeContext();
    expect(a.llm).toBe(b.llm);
    expect(a.channels).toBe(b.channels);
    expect(a.config).toBe(b.config);
    expect(a.events).toBe(b.events);
    expect(a.permissions).toBe(b.permissions);
    expect(a.memory).toBe(b.memory);
  });
});
