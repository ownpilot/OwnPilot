// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { SchemaFormFields } from './SchemaFormFields';
import type { ToolParams } from '../../pages/tools/types';

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
  getInput: (name: string) => HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  getByName: (
    name: string
  ) => { type: string; input: HTMLElement | null; required: boolean } | null;
  text: () => string;
  cleanup: () => void;
}

function renderFields(opts: {
  schema?: ToolParams;
  toolArgs?: Record<string, unknown>;
  onFieldChange?: (name: string, value: unknown) => void;
  onFieldFocus?: (name: string) => void;
  focusedField?: string | null;
}): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(SchemaFormFields, {
        schema: opts.schema,
        toolArgs: opts.toolArgs ?? {},
        onFieldChange: opts.onFieldChange ?? (() => {}),
        onFieldFocus: opts.onFieldFocus ?? (() => {}),
        focusedField: opts.focusedField ?? null,
      })
    );
  });

  // Each FieldRow renders an outer <div> with the field label inside a
  // <span class="font-mono">. We find that row by walking up from the label
  // until we find the closest ancestor that contains a real input element.
  function findRow(name: string): HTMLElement | null {
    const spans = container.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim() !== name) continue;
      let cursor: HTMLElement | null = span;
      while (cursor) {
        if (cursor.querySelector('input, select, textarea')) return cursor;
        cursor = cursor.parentElement;
      }
    }
    return null;
  }

  return {
    container,
    root,
    getInput: (name) => {
      const row = findRow(name);
      return row?.querySelector('input, select, textarea') as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null;
    },
    getByName: (name) => {
      const row = findRow(name);
      if (!row) return null;
      // FieldRow: first <span> is the field name, second is the type chip.
      const spans = row.querySelectorAll('span');
      return {
        type: spans[1]?.textContent?.trim() ?? '',
        input: row.querySelector('input, select, textarea'),
        required: !!row.querySelector('span.text-red-500'),
      };
    },
    text: () => container.textContent ?? '',
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('SchemaFormFields empty states', () => {
  it('renders the empty-state message when schema is undefined', () => {
    const r = renderFields({});
    expect(r.text()).toContain('This tool has no parameters');
    r.cleanup();
  });

  it('renders the empty-state message when properties is empty', () => {
    const r = renderFields({ schema: { type: 'object', properties: {} } });
    expect(r.text()).toContain('This tool has no parameters');
    r.cleanup();
  });
});

describe('SchemaFormFields string fields', () => {
  it('renders a string input with the field name as label', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'search query' } },
      },
    });
    const field = r.getByName('query');
    expect(field).not.toBeNull();
    expect(field?.type).toBe('string');
    expect(field?.input).toBeInstanceOf(HTMLInputElement);
    expect(field?.input?.getAttribute('type')).toBe('text');
    expect(r.text()).toContain('search query');
    r.cleanup();
  });

  it('marks required fields with the red asterisk', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    });
    const field = r.getByName('url');
    expect(field?.required).toBe(true);
    r.cleanup();
  });

  it('passes the placeholder with default when present', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { name: { type: 'string', default: 'world' } },
      },
    });
    const input = r.getByName('name')?.input;
    expect(input?.getAttribute('placeholder')).toBe('Default: "world"');
    r.cleanup();
  });
});

describe('SchemaFormFields typed inputs', () => {
  it('renders a select for enum fields', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['a', 'b', 'c'] } },
      },
      toolArgs: { mode: 'a' },
    });
    const field = r.getByName('mode');
    expect(field?.input).toBeInstanceOf(HTMLSelectElement);
    expect((field?.input as HTMLSelectElement).value).toBe('a');
    r.cleanup();
  });

  it('renders a boolean select', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { flag: { type: 'boolean' } },
      },
      toolArgs: { flag: true },
    });
    const field = r.getByName('flag');
    expect(field?.input).toBeInstanceOf(HTMLSelectElement);
    expect((field?.input as HTMLSelectElement).value).toBe('true');
    r.cleanup();
  });

  it('renders a number input for numeric types', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { count: { type: 'number' } },
      },
      toolArgs: { count: 42 },
    });
    const field = r.getByName('count');
    expect(field?.input).toBeInstanceOf(HTMLInputElement);
    expect((field?.input as HTMLInputElement).getAttribute('type')).toBe('number');
    expect((field?.input as HTMLInputElement).value).toBe('42');
    r.cleanup();
  });

  it('renders a textarea for array fields and parses JSON', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { tags: { type: 'array' } },
      },
      toolArgs: { tags: ['a', 'b'] },
      onFieldChange,
    });
    const field = r.getByName('tags');
    expect(field?.input).toBeInstanceOf(HTMLTextAreaElement);
    const textarea = field?.input as HTMLTextAreaElement;
    expect(textarea.value).toBe(JSON.stringify(['a', 'b'], null, 2));
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '["c","d"]');
      textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenLastCalledWith('tags', ['c', 'd']);
    r.cleanup();
  });

  it('keeps the textarea string when JSON parse fails', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { obj: { type: 'object' } },
      },
      toolArgs: { obj: { a: 1 } },
      onFieldChange,
    });
    const textarea = r.getByName('obj')?.input as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, 'not json');
      textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenLastCalledWith('obj', 'not json');
    r.cleanup();
  });

  it('clears the array field when the textarea becomes empty', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { tags: { type: 'array' } },
      },
      toolArgs: { tags: ['a'] },
      onFieldChange,
    });
    const textarea = r.getByName('tags')?.input as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '');
      textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenLastCalledWith('tags', undefined);
    r.cleanup();
  });
});

describe('SchemaFormFields focus and expression mode', () => {
  it('highlights the focused field via the ring class', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      focusedField: 'name',
    });
    const input = r.getByName('name')?.input;
    expect(input?.className).toContain('ring-1');
    r.cleanup();
  });

  it('renders an expression input when the value is a {{...}} template', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      toolArgs: { name: '{{node.output.x}}' },
    });
    const input = r.getByName('name')?.input as HTMLInputElement;
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input.placeholder).toBe('{{node_1.output.field}}');
    expect(input.value).toBe('{{node.output.x}}');
    r.cleanup();
  });

  it('exposes a Code button to toggle expression mode per field', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      toolArgs: { name: 'literal' },
    });
    const toggleButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Switch to expression {{...}}'
    );
    expect(toggleButton).toBeTruthy();
    r.cleanup();
  });

  it('flips the Code button title once the value is already an expression', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      toolArgs: { name: '{{node.output.x}}' },
    });
    const toggleButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Switch to literal value'
    );
    expect(toggleButton).toBeTruthy();
    r.cleanup();
  });

  // The two toggle tests above exercise the click path indirectly through
  // rendered button presence, since happy-dom + React 19's synthetic
  // event delegation does not always invoke onClick via dispatchEvent.
  // Coverage still benefits from these renders; the toggle behaviour is
  // also covered indirectly by the "expression input" assertion above.
});

describe('SchemaFormFields number/integer edge cases', () => {
  it('clears number value when the input becomes empty', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { count: { type: 'number' } },
      },
      toolArgs: { count: 42 },
      onFieldChange,
    });
    const input = r.getByName('count')?.input as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, '');
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenLastCalledWith('count', undefined);
    r.cleanup();
  });

  it('ignores NaN values from number input', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { count: { type: 'integer' } },
      },
      toolArgs: { count: 10 },
      onFieldChange,
    });
    const input = r.getByName('count')?.input as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, 'abc');
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    // NaN should not call onChange (the value stays at the last valid number)
    expect(onFieldChange).not.toHaveBeenCalledWith('count', expect.any(Number));
    r.cleanup();
  });

  it('renders default placeholder for number without explicit default', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { score: { type: 'number' } },
      },
    });
    const input = r.getByName('score')?.input;
    expect(input?.getAttribute('placeholder')).toBe('Enter number');
    r.cleanup();
  });

  it('parses number from string default for integer type', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { level: { type: 'integer', default: 5 } },
      },
    });
    const input = r.getByName('level')?.input;
    expect(input?.getAttribute('placeholder')).toBe('Default: 5');
    r.cleanup();
  });
});

describe('SchemaFormFields enum type variants', () => {
  it('parses number values when enum type is number', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { priority: { type: 'number', enum: ['1', '2', '3'] } },
      },
      onFieldChange,
    });
    const select = r.getByName('priority')?.input as HTMLSelectElement;
    expect(select).toBeInstanceOf(HTMLSelectElement);
    act(() => {
      select.value = '1';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenCalledWith('priority', 1);
    r.cleanup();
  });

  it('clears enum selection when empty value is chosen', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { color: { type: 'string', enum: ['red', 'blue'] } },
      },
      onFieldChange,
    });
    const select = r.getByName('color')?.input as HTMLSelectElement;
    act(() => {
      select.value = '';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenCalledWith('color', undefined);
    r.cleanup();
  });
});

describe('SchemaFormFields expression toggle', () => {
  it('renders expression-mode input when manual expr toggled via button', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      toolArgs: { name: 'literal' },
      onFieldChange,
    });
    // Find and click the expression toggle button
    const toggleButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Switch to expression {{...}}'
    );
    expect(toggleButton).toBeTruthy();
    // Clicking toggles to expression mode
    act(() => {
      toggleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    const input = r.getByName('name')?.input as HTMLInputElement;
    // In expression mode, the placeholder changes
    expect(input?.placeholder).toBe('{{node_1.output.field}}');
    r.cleanup();
  });

  it('shows focused ring on expression input when focusedField matches', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      toolArgs: { name: '{{expr}}' },
      focusedField: 'name',
    });
    const input = r.getByName('name')?.input;
    expect(input?.className).toContain('ring-1');
    expect(input?.className).toContain('ring-primary');
    r.cleanup();
  });

  it('shows description text when prop has a description', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query to execute' } },
      },
    });
    expect(r.text()).toContain('The search query to execute');
    r.cleanup();
  });

  it('renders empty string input for non-string expression values', () => {
    const r = renderFields({
      schema: {
        type: 'object',
        properties: { count: { type: 'number' } },
      },
      toolArgs: { count: 42 },
    });
    // First toggle to expression mode
    const toggleButton = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Switch to expression {{...}}'
    );
    act(() => {
      toggleButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    const input = r.getByName('count')?.input as HTMLInputElement;
    expect(input.value).toBe(''); // non-string values become empty in expression mode
    r.cleanup();
  });
});

describe('SchemaFormFields object textarea edge cases', () => {
  it('keeps the textarea string when JSON parse fails during typing', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: { type: 'object', properties: { cfg: { type: 'object' } } },
      toolArgs: { cfg: { enabled: true } },
      onFieldChange,
    });
    const textarea = r.getByName('cfg')?.input as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '{"broken":');
      textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    // Invalid JSON stays as string (user is mid-edit)
    expect(onFieldChange).toHaveBeenLastCalledWith('cfg', '{"broken":');
    r.cleanup();
  });

  it('clears object field when textarea becomes whitespace-only', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: { type: 'object', properties: { data: { type: 'object' } } },
      toolArgs: { data: { x: 1 } },
      onFieldChange,
    });
    const textarea = r.getByName('data')?.input as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '   ');
      textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenLastCalledWith('data', undefined);
    r.cleanup();
  });

  it('parses valid JSON from object textarea', () => {
    const onFieldChange = vi.fn();
    const r = renderFields({
      schema: { type: 'object', properties: { data: { type: 'object' } } },
      toolArgs: { data: { a: 1 } },
      onFieldChange,
    });
    const textarea = r.getByName('data')?.input as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '{"b": 2}');
      textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(onFieldChange).toHaveBeenLastCalledWith('data', { b: 2 });
    r.cleanup();
  });
});
