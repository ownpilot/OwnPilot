/**
 * Tests for the ToolPicker instruction builders.
 *
 * This text is not cosmetic: it is injected verbatim into the prompt when a
 * user attaches a resource, and it is the only thing telling the agent which
 * tool to call and how. It was previously buried in a 1247-line component and
 * reachable only by rendering the picker, so none of it was pinned. The
 * assertions below cover the parts an agent actually acts on — the tool name,
 * the required-parameter markers, the generated example call, and the
 * "call directly, do NOT use search_tools" instruction whose absence sends the
 * agent on a tool-search detour.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_DATA_TOOL_INSTRUCTIONS,
  buildCustomDataInstructions,
  buildToolInstructions,
  buildSkillInstructions,
  buildFileInstructions,
  buildUrlInstructions,
  buildComposioInstructions,
  buildMcpToolInstructions,
  buildArtifactInstructions,
} from './instructions';
import { BUILTIN_DATA_ITEMS } from './builtin-data';

describe('BUILTIN_DATA_TOOL_INSTRUCTIONS', () => {
  it('covers every built-in data item the picker offers', () => {
    // A picker row with no instructions attaches an empty context block.
    for (const item of BUILTIN_DATA_ITEMS) {
      expect(BUILTIN_DATA_TOOL_INSTRUCTIONS[item.name], item.name).toBeTruthy();
    }
  });

  it('namespaces every tool call and steers away from search_tools', () => {
    for (const [key, text] of Object.entries(BUILTIN_DATA_TOOL_INSTRUCTIONS)) {
      expect(text, key).toContain('DO NOT use search_tools');
      for (const call of text.matchAll(/use_tool\("([^"]+)"/g)) {
        expect(call[1], `${key}: ${call[1]}`).toMatch(/^core\./);
      }
    }
  });
});

describe('buildCustomDataInstructions', () => {
  it('uses the internal table name in calls and the display name for the human', () => {
    const out = buildCustomDataInstructions('My Recipes', 'recipes_x1');
    expect(out).toContain('"My Recipes"');
    expect(out).toContain('{"table_name":"recipes_x1"}');
    // The agent cannot guess columns; the schema hint is what prevents a blind insert.
    expect(out).toContain('core.describe_custom_table');
  });
});

describe('buildToolInstructions', () => {
  it('marks required parameters and leaves optional ones unmarked', () => {
    const out = buildToolInstructions('core.send', 'Send a thing', {
      properties: { to: { type: 'string', description: 'Recipient' }, cc: { type: 'string' } },
      required: ['to'],
    });
    expect(out).toContain('• to: string (REQUIRED) — Recipient');
    expect(out).toContain('• cc: string');
    expect(out).not.toContain('cc: string (REQUIRED)');
  });

  it('renders an enum as its alternatives rather than as "any"', () => {
    const out = buildToolInstructions('core.set', 'Set mode', {
      properties: { mode: { enum: ['fast', 'slow'] } },
      required: ['mode'],
    });
    expect(out).toContain('• mode: "fast" | "slow" (REQUIRED)');
  });

  it('builds an example containing only required params, typed per schema', () => {
    const out = buildToolInstructions('core.mk', 'Make', {
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' },
        flag: { type: 'boolean' },
        list: { type: 'array' },
        obj: { type: 'object' },
        mode: { enum: ['a', 'b'] },
        skipped: { type: 'string' },
      },
      required: ['name', 'count', 'flag', 'list', 'obj', 'mode'],
    });
    const example = out.slice(out.indexOf('Example: '));
    expect(example).toBe(
      'Example: core.mk({"name":"...","count":0,"flag":true,"list":[],"obj":{},"mode":"a"})'
    );
    expect(example).not.toContain('skipped');
  });

  it('emits an empty-object example for a parameterless tool', () => {
    const out = buildToolInstructions('core.ping', 'Ping');
    expect(out).toContain('Example: core.ping({})');
    expect(out).not.toContain('Parameters:');
  });

  it('tells the agent to call the tool by name, not through use_tool', () => {
    // Attached tools are bound directly; routing through use_tool would double-hop.
    expect(buildToolInstructions('core.ping', 'Ping')).toContain('do NOT use use_tool');
  });
});

describe('content-embedding builders', () => {
  it('fences file content with matching begin/end markers', () => {
    const out = buildFileInstructions('notes.txt', 'hello');
    expect(out).toContain('--- BEGIN FILE CONTENT ---');
    expect(out).toContain('--- END FILE CONTENT ---');
    expect(out).toContain('hello');
  });

  it('reports the file size in characters', () => {
    // Group separator is locale-dependent (toLocaleString), so derive the expectation.
    expect(buildFileInstructions('big.txt', 'x'.repeat(1234))).toContain(
      `(${(1234).toLocaleString()} chars)`
    );
  });

  it('fences page content and keeps the source URL', () => {
    const out = buildUrlInstructions('https://example.com', 'Example', 'body');
    expect(out).toContain('https://example.com');
    expect(out).toContain('--- BEGIN PAGE CONTENT ---');
    expect(out).toContain('--- END PAGE CONTENT ---');
  });

  it('passes short artifacts through untouched', () => {
    const out = buildArtifactInstructions('Draft', 'markdown', 'short');
    expect(out).toContain('short');
    expect(out).not.toContain('[truncated]');
  });

  it('truncates artifacts over 8000 chars so one attachment cannot eat the context', () => {
    const out = buildArtifactInstructions('Big', 'code', 'x'.repeat(9000));
    expect(out).toContain('...[truncated]');
    expect(out.match(/x+/)![0]).toHaveLength(8000);
  });

  it('quotes the skill instructions verbatim', () => {
    const out = buildSkillInstructions('pdf', 'Step one.\nStep two.');
    expect(out).toContain('Skill: pdf');
    expect(out).toContain('Step one.\nStep two.');
  });
});

describe('buildComposioInstructions', () => {
  it('routes through composio_execute with the action pre-filled', () => {
    const out = buildComposioInstructions('GITHUB_STAR', 'github', 'Star a repo');
    expect(out).toContain('use_tool("composio_execute", {"action": "GITHUB_STAR"');
    expect(out).toContain('NOT search_tools');
  });
});

describe('buildMcpToolInstructions', () => {
  it('names the originating server so identically-named tools stay distinguishable', () => {
    const out = buildMcpToolInstructions('read_file', 'filesystem', 'Read a file');
    expect(out).toContain('MCP Tool: read_file (from MCP server: filesystem)');
  });

  it('marks required parameters from the input schema', () => {
    const out = buildMcpToolInstructions('read_file', 'fs', 'Read', {
      properties: { path: { type: 'string', description: 'Path' }, encoding: { type: 'string' } },
      required: ['path'],
    });
    expect(out).toContain('• path: string (REQUIRED) — Path');
    expect(out).toContain('• encoding: string');
  });

  it('omits the parameters section when the schema is empty', () => {
    expect(buildMcpToolInstructions('ping', 'fs', 'Ping', {})).not.toContain('Parameters:');
  });

  it('substitutes a placeholder for a missing description', () => {
    expect(buildMcpToolInstructions('ping', 'fs', '')).toContain('Description: No description');
  });
});
