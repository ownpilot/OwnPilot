import { describe, it, expect } from 'vitest';
import { buildCopilotSystemPrompt } from './workflow-copilot-prompt.js';

describe('buildCopilotSystemPrompt', () => {
  it('returns static prompt when no args', () => {
    const result = buildCopilotSystemPrompt();
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('contains "Workflow Copilot" in base prompt', () => {
    const result = buildCopilotSystemPrompt();
    expect(result).toContain('Workflow Copilot');
  });

  it('contains all 7 node type names', () => {
    const result = buildCopilotSystemPrompt();
    expect(result).toContain('trigger');
    expect(result).toContain('tool');
    expect(result).toContain('llm');
    expect(result).toContain('condition');
    expect(result).toContain('code');
    expect(result).toContain('transformer');
    expect(result).toContain('forEach');
  });

  it('contains template syntax documentation (double braces)', () => {
    const result = buildCopilotSystemPrompt();
    expect(result).toContain('{{');
    expect(result).toContain('}}');
    expect(result).toContain('Template Syntax');
  });

  it('appends Available Tools section when tools provided', () => {
    const result = buildCopilotSystemPrompt(undefined, ['core.get_time', 'core.search']);
    expect(result).toContain('## Available Tools');
  });

  it('Available Tools section contains each tool name', () => {
    const tools = ['core.get_time', 'mcp.github.list_repositories', 'custom.my_tool'];
    const result = buildCopilotSystemPrompt(undefined, tools);
    for (const tool of tools) {
      expect(result).toContain(tool);
    }
  });

  it('does NOT contain Available Tools section when tools array empty', () => {
    const result = buildCopilotSystemPrompt(undefined, []);
    expect(result).not.toContain('## Available Tools');
  });

  it('does NOT contain Available Tools section when tools undefined', () => {
    const result = buildCopilotSystemPrompt(undefined, undefined);
    expect(result).not.toContain('## Available Tools');
  });

  it('appends Current Workflow section with JSON when workflow provided', () => {
    const workflow = {
      name: 'My Workflow',
      nodes: [{ id: 'node_1', type: 'trigger' }],
      edges: [],
    };
    const result = buildCopilotSystemPrompt(workflow);
    expect(result).toContain('## Current Workflow');
    expect(result).toContain('"name": "My Workflow"');
    expect(result).toContain('```json');
  });

  it('does NOT contain Current Workflow when workflow undefined', () => {
    const result = buildCopilotSystemPrompt(undefined);
    expect(result).not.toContain('## Current Workflow');
  });

  it('contains both Available Tools and Current Workflow when both provided', () => {
    const workflow = {
      name: 'Test',
      nodes: [],
      edges: [],
    };
    const tools = ['core.get_time'];
    const result = buildCopilotSystemPrompt(workflow, tools);
    expect(result).toContain('## Available Tools');
    expect(result).toContain('## Current Workflow');
    // Available Tools appears before Current Workflow
    const toolsIndex = result.indexOf('## Available Tools');
    const workflowIndex = result.indexOf('## Current Workflow');
    expect(toolsIndex).toBeLessThan(workflowIndex);
  });
});
