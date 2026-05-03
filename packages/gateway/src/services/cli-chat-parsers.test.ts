import { describe, it, expect } from 'vitest';
import {
  messagesToPrompt,
  parseClaudeOutput,
  parseCodexOutput,
  parseGeminiOutput,
  extractJsonObjects,
  buildClaudeArgs,
  buildCodexArgs,
  buildGeminiArgs,
  inlineSystemPrompt,
  OUTPUT_PARSERS,
} from './cli-chat-parsers.js';

describe('messagesToPrompt', () => {
  it('extracts system prompt separately', () => {
    const { prompt, systemPrompt } = messagesToPrompt([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(systemPrompt).toBe('You are helpful');
    expect(prompt).toBe('Hello');
  });

  it('returns single user message directly', () => {
    const { prompt } = messagesToPrompt([{ role: 'user', content: 'Hi' }]);
    expect(prompt).toBe('Hi');
  });

  it('wraps multi-turn in conversation history tags', () => {
    const { prompt } = messagesToPrompt([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'How are you?' },
    ]);
    expect(prompt).toContain('<conversation_history>');
    expect(prompt).toContain('User: Hello');
    expect(prompt).toContain('Assistant: Hi there');
    expect(prompt).toContain('How are you?');
  });

  it('handles multi-part content', () => {
    const { prompt } = messagesToPrompt([
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: 'Part 1' },
          { type: 'text' as const, text: 'Part 2' },
        ],
      },
    ]);
    expect(prompt).toContain('Part 1');
    expect(prompt).toContain('Part 2');
  });
});

describe('parseClaudeOutput', () => {
  it('parses JSON result type', () => {
    const output = JSON.stringify({ type: 'result', result: 'Hello world' });
    expect(parseClaudeOutput(output)).toBe('Hello world');
  });

  it('parses assistant message with content array', () => {
    const output = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Response text' }] },
    });
    expect(parseClaudeOutput(output)).toBe('Response text');
  });

  it('parses content field', () => {
    const output = JSON.stringify({ content: 'Direct content' });
    expect(parseClaudeOutput(output)).toBe('Direct content');
  });

  it('falls back to raw stdout for non-JSON', () => {
    expect(parseClaudeOutput('Plain text output')).toBe('Plain text output');
  });
});

describe('parseCodexOutput', () => {
  it('parses message.completed type', () => {
    const obj = {
      type: 'message.completed',
      message: { content: [{ type: 'output_text', text: 'Codex result' }] },
    };
    expect(parseCodexOutput(JSON.stringify(obj))).toBe('Codex result');
  });

  it('parses standard message type', () => {
    const obj = { type: 'message', role: 'assistant', content: 'Simple' };
    expect(parseCodexOutput(JSON.stringify(obj))).toBe('Simple');
  });

  it('falls back to raw stdout', () => {
    expect(parseCodexOutput('no json here')).toBe('no json here');
  });
});

describe('parseGeminiOutput', () => {
  it('parses response field', () => {
    const output = JSON.stringify({ response: 'Gemini says hello' });
    expect(parseGeminiOutput(output)).toBe('Gemini says hello');
  });

  it('parses text field', () => {
    const output = JSON.stringify({ text: 'From text field' });
    expect(parseGeminiOutput(output)).toBe('From text field');
  });

  it('falls back to raw stdout', () => {
    expect(parseGeminiOutput('not json')).toBe('not json');
  });
});

describe('extractJsonObjects', () => {
  it('extracts single JSON object', () => {
    const result = extractJsonObjects('prefix {"key": "value"} suffix');
    expect(result).toEqual(['{"key": "value"}']);
  });

  it('extracts multiple JSON objects', () => {
    const result = extractJsonObjects('{"a":1}text{"b":2}');
    expect(result).toHaveLength(2);
  });

  it('handles nested objects', () => {
    const result = extractJsonObjects('{"outer":{"inner":1}}');
    expect(result).toEqual(['{"outer":{"inner":1}}']);
  });

  it('handles strings with braces', () => {
    const result = extractJsonObjects('{"msg":"hello {world}"}');
    expect(result).toEqual(['{"msg":"hello {world}"}']);
  });

  it('returns empty array for no JSON', () => {
    expect(extractJsonObjects('no json here')).toEqual([]);
  });
});

describe('OUTPUT_PARSERS', () => {
  it('has parsers for all 3 CLIs', () => {
    expect(OUTPUT_PARSERS.claude).toBe(parseClaudeOutput);
    expect(OUTPUT_PARSERS.codex).toBe(parseCodexOutput);
    expect(OUTPUT_PARSERS.gemini).toBe(parseGeminiOutput);
  });
});

describe('buildClaudeArgs', () => {
  it('includes -p flag and output format', () => {
    const args = buildClaudeArgs('test prompt', 'claude-3', false);
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
  });

  it('uses stream-json for streaming', () => {
    const args = buildClaudeArgs('test', '', true);
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
  });

  it('adds model when provided', () => {
    const args = buildClaudeArgs('test', 'claude-3.5', false);
    expect(args).toContain('--model');
    expect(args).toContain('claude-3.5');
  });

  it('skips unsafe model values', () => {
    const args = buildClaudeArgs('test', 'claude"; calc', false);
    expect(args).not.toContain('--model');
    expect(args).not.toContain('claude"; calc');
  });

  it('skips default model', () => {
    const args = buildClaudeArgs('test', 'default', false);
    expect(args).not.toContain('--model');
  });
});

describe('buildCodexArgs', () => {
  it('includes exec and json flags', () => {
    const args = buildCodexArgs('test');
    expect(args).toContain('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--full-auto');
  });

  it('adds model when provided', () => {
    const args = buildCodexArgs('test', 'gpt-4');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-4');
  });

  it('skips unsafe model values', () => {
    const args = buildCodexArgs('test', 'gpt-4 && whoami');
    expect(args).not.toContain('--model');
  });
});

describe('buildGeminiArgs', () => {
  it('includes yolo and output format', () => {
    const args = buildGeminiArgs('test');
    expect(args).toContain('--yolo');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });

  it('skips unsafe model values', () => {
    const args = buildGeminiArgs('test', 'gemini\r\nbad');
    expect(args).not.toContain('--model');
  });
});

describe('inlineSystemPrompt', () => {
  it('wraps system prompt in tags', () => {
    const result = inlineSystemPrompt('user msg', 'system msg');
    expect(result).toContain('<system_prompt>');
    expect(result).toContain('system msg');
    expect(result).toContain('user msg');
  });

  it('returns prompt unchanged when no system prompt', () => {
    expect(inlineSystemPrompt('just prompt')).toBe('just prompt');
  });
});
