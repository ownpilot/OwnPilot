/**
 * Pipeline Middleware Ordering Test
 *
 * Ensures the middleware pipeline is registered in the correct order.
 * A reorder would silently break the request lifecycle.
 *
 * Expected order (first registered = outermost wrapper):
 *   1. audit
 *   2. persistence
 *   3. post-processing
 *   4. request-preprocessor
 *   5. context-injection
 *   6. agent-execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track registration order
const registrationOrder: string[] = [];

const mockBus = {
  useNamed: vi.fn((name: string, _middleware: unknown) => {
    registrationOrder.push(name);
  }),
};

// Mock all middleware factories to return identifiable stubs
vi.mock('./audit.js', () => ({
  createAuditMiddleware: vi.fn(() => 'audit-middleware'),
}));
vi.mock('./persistence.js', () => ({
  createPersistenceMiddleware: vi.fn(() => 'persistence-middleware'),
}));
vi.mock('./post-processing.js', () => ({
  createPostProcessingMiddleware: vi.fn(() => 'post-processing-middleware'),
}));
vi.mock('./request-preprocessor.js', () => ({
  createRequestPreprocessorMiddleware: vi.fn(() => 'request-preprocessor-middleware'),
}));
vi.mock('./context-injection.js', () => ({
  createContextInjectionMiddleware: vi.fn(() => 'context-injection-middleware'),
}));
vi.mock('./agent-execution.js', () => ({
  createAgentExecutionMiddleware: vi.fn(() => 'agent-execution-middleware'),
}));

const { registerPipelineMiddleware } = await import('./index.js');

describe('Pipeline Middleware Ordering', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
    mockBus.useNamed.mockClear();
  });

  it('registers exactly 6 middleware stages', () => {
    registerPipelineMiddleware(mockBus as never);
    expect(mockBus.useNamed).toHaveBeenCalledTimes(6);
  });

  it('registers middleware in the correct order', () => {
    registerPipelineMiddleware(mockBus as never);

    const expectedOrder = [
      'audit',
      'persistence',
      'post-processing',
      'request-preprocessor',
      'context-injection',
      'agent-execution',
    ];

    expect(registrationOrder).toEqual(expectedOrder);
  });

  it('audit is the first (outermost) middleware', () => {
    registerPipelineMiddleware(mockBus as never);
    expect(registrationOrder[0]).toBe('audit');
  });

  it('agent-execution is the last (innermost) middleware', () => {
    registerPipelineMiddleware(mockBus as never);
    expect(registrationOrder[registrationOrder.length - 1]).toBe('agent-execution');
  });

  it('context-injection runs immediately before agent-execution', () => {
    registerPipelineMiddleware(mockBus as never);
    const ciIndex = registrationOrder.indexOf('context-injection');
    const aeIndex = registrationOrder.indexOf('agent-execution');
    expect(aeIndex - ciIndex).toBe(1);
  });

  it('persistence runs before post-processing (so DB save happens after extraction)', () => {
    registerPipelineMiddleware(mockBus as never);
    const persIndex = registrationOrder.indexOf('persistence');
    const ppIndex = registrationOrder.indexOf('post-processing');
    expect(persIndex).toBeLessThan(ppIndex);
  });

  it('passes each factory result to bus.useNamed', () => {
    registerPipelineMiddleware(mockBus as never);

    expect(mockBus.useNamed).toHaveBeenCalledWith('audit', 'audit-middleware');
    expect(mockBus.useNamed).toHaveBeenCalledWith('persistence', 'persistence-middleware');
    expect(mockBus.useNamed).toHaveBeenCalledWith('post-processing', 'post-processing-middleware');
    expect(mockBus.useNamed).toHaveBeenCalledWith(
      'request-preprocessor',
      'request-preprocessor-middleware'
    );
    expect(mockBus.useNamed).toHaveBeenCalledWith(
      'context-injection',
      'context-injection-middleware'
    );
    expect(mockBus.useNamed).toHaveBeenCalledWith(
      'agent-execution',
      'agent-execution-middleware'
    );
  });
});
