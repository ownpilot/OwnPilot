/**
 * Tool Context Injection Tests
 */

import { describe, it, expect } from 'vitest';
import { buildToolContextBlock, injectToolContext } from './tool-context.js';

describe('buildToolContextBlock', () => {
  it('should include ownpilot tags', () => {
    const block = buildToolContextBlock();
    expect(block).toContain('<ownpilot>');
    expect(block).toContain('</ownpilot>');
  });

  it('should mention MCP meta-tools', () => {
    const block = buildToolContextBlock();
    expect(block).toContain('use_tool');
    expect(block).toContain('search_tools');
    expect(block).toContain('core.list_tasks');
  });

  it('should be concise (under 500 chars)', () => {
    const block = buildToolContextBlock();
    expect(block.length).toBeLessThan(500);
  });

  it('should mention MCP', () => {
    const block = buildToolContextBlock();
    expect(block).toContain('MCP');
  });
});

describe('injectToolContext', () => {
  it('should prepend context to first user message', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ];

    const result = injectToolContext(messages);

    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe('system');
    expect(result[0]!.content).toBe('You are helpful.'); // unchanged
    expect(result[1]!.role).toBe('user');
    expect(result[1]!.content as string).toContain('<ownpilot>');
    expect(result[1]!.content as string).toContain('Hello');
  });

  it('should only inject into the first user message', () => {
    const messages = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Second' },
    ];

    const result = injectToolContext(messages);

    expect(result[0]!.content as string).toContain('<ownpilot>');
    expect(result[2]!.content).toBe('Second'); // unchanged
  });

  it('should not modify messages without user role', () => {
    const messages = [{ role: 'system', content: 'System prompt' }];

    const result = injectToolContext(messages);

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('System prompt');
  });

  it('should not mutate the original array', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const result = injectToolContext(messages);

    expect(result).not.toBe(messages);
    expect(messages[0]!.content).toBe('Hello'); // original unchanged
  });
});
