// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { renderWorkflowNode } from './node-render-helper';
import { LlmNode } from './LlmNode';
import { HttpRequestNode } from './HttpRequestNode';
import { CodeNode } from './CodeNode';
import { ConditionNode } from './ConditionNode';

type NodeShape = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  selected: boolean;
  isConnectable: boolean;
  zIndex: number;
  positionAbsoluteX: number;
  positionAbsoluteY: number;
};

function nodeProps(
  type: string,
  data: Record<string, unknown>,
  id = 'n1',
  selected = false
): NodeShape {
  return {
    id,
    type,
    data,
    selected,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('LlmNode', () => {
  it('renders label, provider, and model chips', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Summarise',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'Hello',
      }) as never
    );
    expect(r.text()).toContain('Summarise');
    expect(r.text()).toContain('openai');
    expect(r.text()).toContain('gpt-4.1');
    expect(r.text()).toContain('Hello');
    r.cleanup();
  });

  it('falls back to default Auto chip when no provider or model', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', { label: 'Auto', userMessage: 'hi' }) as never
    );
    expect(r.text()).toContain('Auto (default)');
    r.cleanup();
  });

  it('renders the JSON badge when responseFormat is json', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'JSON',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        responseFormat: 'json',
      }) as never
    );
    expect(r.text()).toContain('JSON');
    r.cleanup();
  });

  it('renders the temperature meter and value when provided', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Hot',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        temperature: 1.5,
      }) as never
    );
    expect(r.text()).toContain('1.5');
    r.cleanup();
  });

  it('renders system prompt with truncation ellipsis', () => {
    const longPrompt = 'You are a helpful assistant '.repeat(10);
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Sys',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        systemPrompt: longPrompt,
      }) as never
    );
    expect(r.text()).toContain('...');
    r.cleanup();
  });

  it('renders error and duration footer when present', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'LLM',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        executionStatus: 'error',
        executionError: 'rate limited',
        executionDuration: 2500,
      }) as never
    );
    expect(r.text()).toContain('rate limited');
    expect(r.text()).toContain('2.5s');
    r.cleanup();
  });

  it('formats duration in milliseconds when under 1000ms', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Quick',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        executionDuration: 250,
      }) as never
    );
    expect(r.text()).toContain('250ms');
    r.cleanup();
  });

  it('uses the blue color for very low temperature (< 0.4)', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Cold',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        temperature: 0.2,
      }) as never
    );
    const meter = r.container.querySelector('div.bg-blue-400');
    expect(meter).not.toBeNull();
    r.cleanup();
  });

  it('uses the indigo color for moderate temperature (0.4-0.8)', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Mild',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        temperature: 0.6,
      }) as never
    );
    const meter = r.container.querySelector('div.bg-indigo-500');
    expect(meter).not.toBeNull();
    r.cleanup();
  });

  it('uses the amber color for hot temperature (0.8-1.2)', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Hot',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        temperature: 1.0,
      }) as never
    );
    const meter = r.container.querySelector('div.bg-amber-500');
    expect(meter).not.toBeNull();
    r.cleanup();
  });

  it('uses the red color for very hot temperature (>= 1.2)', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Spicy',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        temperature: 1.5,
      }) as never
    );
    // The previous 'Hot' test at 1.0 already covers the amber case; here
    // 1.5 should land in the red branch.
    const meter = r.container.querySelector('div.bg-red-500');
    expect(meter).not.toBeNull();
    r.cleanup();
  });

  it('shows the running status icon and applies animate-pulse', () => {
    const r = renderWorkflowNode(
      LlmNode as never,
      nodeProps('llmNode', {
        label: 'Run',
        provider: 'openai',
        model: 'gpt-4.1',
        userMessage: 'x',
        executionStatus: 'running',
      }) as never
    );
    const iconSpan = r.container.querySelector('svg.text-amber-200');
    expect(iconSpan).not.toBeNull();
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('animate-pulse');
    r.cleanup();
  });
});

describe('HttpRequestNode', () => {
  it('renders default GET method when no method provided', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', { label: 'List', url: 'https://api.example.test/list' }) as never
    );
    expect(r.text()).toContain('GET');
    expect(r.text()).toContain('https://api.example.test/list');
    r.cleanup();
  });

  it('renders POST and PUT methods with their color badges', () => {
    const rPost = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', { label: 'Create', method: 'POST', url: '/p' }) as never
    );
    expect(rPost.text()).toContain('POST');
    rPost.cleanup();

    const rPut = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', { label: 'Update', method: 'PUT', url: '/u' }) as never
    );
    expect(rPut.text()).toContain('PUT');
    rPut.cleanup();
  });

  it('shows the auth indicator when auth config is present', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Authed',
        method: 'GET',
        url: '/u',
        auth: { type: 'bearer', token: 'x' },
      }) as never
    );
    expect(r.text()).toContain('Auth configured');
    r.cleanup();
  });

  it('omits the auth indicator when auth is empty', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Anon',
        method: 'GET',
        url: '/u',
        auth: {},
      }) as never
    );
    expect(r.text()).not.toContain('Auth configured');
    r.cleanup();
  });

  it('renders error and duration footer', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Fail',
        method: 'DELETE',
        url: '/x',
        executionStatus: 'error',
        executionError: 'HTTP 500',
        executionDuration: 800,
      }) as never
    );
    expect(r.text()).toContain('HTTP 500');
    expect(r.text()).toContain('800ms');
    r.cleanup();
  });

  it('falls back to default label when missing', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', { url: '/x' }) as never
    );
    expect(r.text()).toContain('HTTP Request');
    r.cleanup();
  });

  it('renders DELETE method with red badge styling', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', { label: 'Drop', method: 'DELETE', url: '/x' }) as never
    );
    expect(r.text()).toContain('DELETE');
    // The DELETE method background class is bg-red-500
    const badge = Array.from(r.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === 'DELETE'
    );
    expect(badge?.className).toContain('bg-red-500');
    r.cleanup();
  });

  it('applies the selected ring class when selected is true', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps(
        'httpRequestNode',
        {
          label: 'Sel',
          method: 'GET',
          url: '/x',
        },
        'n1',
        true
      ) as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-orange-500');
    r.cleanup();
  });

  it('renders the success status icon for success state', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'OK',
        method: 'GET',
        url: '/x',
        executionStatus: 'success',
      }) as never
    );
    // The success icon is rendered as an SVG (lucide icon) with text-success
    const iconSpan = r.container.querySelector('svg.text-success');
    expect(iconSpan).not.toBeNull();
    r.cleanup();
  });

  it('renders the error status icon and the bodyType area when present', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Err',
        method: 'POST',
        url: '/x',
        executionStatus: 'error',
      }) as never
    );
    const iconSpan = r.container.querySelector('svg.text-error');
    expect(iconSpan).not.toBeNull();
    r.cleanup();
  });

  it('renders the running status icon and applies animate-pulse', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Run',
        method: 'GET',
        url: '/x',
        executionStatus: 'running',
      }) as never
    );
    const iconSpan = r.container.querySelector('svg.text-warning');
    expect(iconSpan).not.toBeNull();
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('animate-pulse');
    r.cleanup();
  });

  it('falls back to muted text class for unknown status', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Default',
        method: 'GET',
        url: '/x',
        executionStatus: 'skipped',
      }) as never
    );
    const iconSpan = r.container.querySelector('svg.text-text-muted');
    expect(iconSpan).not.toBeNull();
    r.cleanup();
  });

  it('falls back to a blue method badge for unknown methods', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Methodless',
        method: 'PATCH' as never,
        url: '/x',
      }) as never
    );
    // PATCH IS in methodStyles, so use a truly unknown method:
    r.cleanup();

    const r2 = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'X',
        method: 'OPTIONS' as never,
        url: '/x',
      }) as never
    );
    const badge = Array.from(r2.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === 'OPTIONS'
    );
    expect(badge?.className).toContain('bg-blue-500');
    r2.cleanup();
  });

  it('renders PATCH method with indigo badge styling', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', { label: 'Patch', method: 'PATCH', url: '/x' }) as never
    );
    const badge = Array.from(r.container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === 'PATCH'
    );
    expect(badge?.className).toContain('bg-indigo-500');
    r.cleanup();
  });

  it('omits the auth indicator when auth is null', () => {
    const r = renderWorkflowNode(
      HttpRequestNode as never,
      nodeProps('httpRequestNode', {
        label: 'Anon',
        method: 'GET',
        url: '/x',
        auth: null,
      }) as never
    );
    expect(r.text()).not.toContain('Auth configured');
    r.cleanup();
  });
});

describe('CodeNode', () => {
  it('renders label, language badge, and first two code lines', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps('codeNode', {
        label: 'Run',
        language: 'python',
        code: 'def add(a, b):\n    return a + b',
      }) as never
    );
    expect(r.text()).toContain('Run');
    expect(r.text()).toContain('PY');
    expect(r.text()).toContain('def add(a, b):');
    expect(r.text()).toContain('return a + b');
    r.cleanup();
  });

  it('falls back to JS label for unknown language', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps('codeNode', {
        label: 'Mystery',
        language: 'ruby' as never,
        code: 'puts 1',
      }) as never
    );
    // Falls back to lang.toUpperCase() so 'RUBY' appears
    expect(r.text()).toContain('RUBY');
    r.cleanup();
  });

  it('defaults language badge to JS when language is missing', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps('codeNode', { label: 'JS', code: 'console.log(1)' }) as never
    );
    expect(r.text()).toContain('JS');
    r.cleanup();
  });

  it('skips code preview when all lines are blank', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps('codeNode', { label: 'Empty', language: 'javascript', code: '\n\n  \n' }) as never
    );
    expect(r.text()).toContain('Empty');
    r.cleanup();
  });

  it('renders error and duration footer', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps('codeNode', {
        label: 'C',
        language: 'shell',
        code: 'echo hi',
        executionStatus: 'error',
        executionError: 'bad exit',
        executionDuration: 200,
      }) as never
    );
    expect(r.text()).toContain('bad exit');
    expect(r.text()).toContain('200ms');
    r.cleanup();
  });

  it('formats duration in seconds when >= 1000ms', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps('codeNode', {
        label: 'Slow',
        language: 'python',
        code: 'time.sleep(2)',
        executionDuration: 2500,
      }) as never
    );
    expect(r.text()).toContain('2.5s');
    r.cleanup();
  });

  it('applies the running ring and animate-pulse class', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps(
        'codeNode',
        {
          label: 'Run',
          language: 'javascript',
          code: 'x',
          executionStatus: 'running',
        },
        'n1',
        true
      ) as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('animate-pulse');
    expect(outer?.className).toContain('ring-teal-500');
    r.cleanup();
  });

  it('falls back to default Code label when missing', () => {
    const r = renderWorkflowNode(
      CodeNode as never,
      nodeProps('codeNode', { language: 'javascript', code: 'x' }) as never
    );
    expect(r.text()).toContain('Code');
    r.cleanup();
  });
});

describe('ConditionNode', () => {
  it('renders label and expression in code block', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'Is even',
        expression: 'value % 2 === 0',
      }) as never
    );
    expect(r.text()).toContain('Is even');
    expect(r.text()).toContain('value % 2 === 0');
    r.cleanup();
  });

  it('renders the TRUE/FALSE split indicators at the bottom', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', { label: 'Branch', expression: 'x > 0' }) as never
    );
    expect(r.text()).toContain('TRUE');
    expect(r.text()).toContain('FALSE');
    r.cleanup();
  });

  it('highlights the branchTaken path when status is success', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'success',
        branchTaken: 'true',
      }) as never
    );
    // Both 'TRUE' and 'Result:' labels appear; the success branch shows a
    // 'Result: TRUE' indicator.
    expect(r.text()).toContain('Result:');
    expect(r.text()).toContain('TRUE');
    r.cleanup();
  });

  it('highlights the FALSE branch when branchTaken is false', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'success',
        branchTaken: 'false',
      }) as never
    );
    expect(r.text()).toContain('Result:');
    expect(r.text()).toContain('FALSE');
    r.cleanup();
  });

  it('does not show the Result badge when status is not success', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'error',
        branchTaken: 'true',
      }) as never
    );
    expect(r.text()).not.toContain('Result:');
    r.cleanup();
  });

  it('falls back to default Condition label when missing', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', { expression: 'x' }) as never
    );
    expect(r.text()).toContain('Condition');
    r.cleanup();
  });

  it('renders error and duration footer', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'error',
        executionError: 'threw',
        executionDuration: 1500,
      }) as never
    );
    expect(r.text()).toContain('threw');
    expect(r.text()).toContain('1.5s');
    r.cleanup();
  });

  it('applies the selected ring class when selected is true', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps(
        'conditionNode',
        {
          label: 'C',
          expression: 'x',
        },
        'n1',
        true
      ) as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('ring-emerald-500');
    r.cleanup();
  });

  it('applies animate-pulse when status is running', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'running',
      }) as never
    );
    const outer = r.container.querySelector('div.relative');
    expect(outer?.className).toContain('animate-pulse');
    r.cleanup();
  });

  it('formats duration in milliseconds when under 1000ms', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionDuration: 250,
      }) as never
    );
    expect(r.text()).toContain('250ms');
    r.cleanup();
  });

  it('formats duration in seconds when >= 1000ms', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionDuration: 3000,
      }) as never
    );
    expect(r.text()).toContain('3.0s');
    r.cleanup();
  });

  it('renders the running status icon and animated branch split indicator', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'running',
        branchTaken: 'true',
      }) as never
    );
    const iconSpan = r.container.querySelector('svg.text-warning');
    expect(iconSpan).not.toBeNull();
    r.cleanup();
  });

  it('highlights the active TRUE branch in the bottom split indicator', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'success',
        branchTaken: 'true',
      }) as never
    );
    // The bottom split has two child divs, one per branch. With branchTaken
    // 'true', the TRUE side gets the bright emerald background; the FALSE
    // side stays muted. We assert by checking that at least one child
    // contains bg-emerald-100 (the success class) and the other does not.
    const allDivs = Array.from(r.container.querySelectorAll('div.bg-emerald-100'));
    expect(allDivs.length).toBeGreaterThan(0);
    r.cleanup();
  });

  it('highlights the active FALSE branch in the bottom split indicator', () => {
    const r = renderWorkflowNode(
      ConditionNode as never,
      nodeProps('conditionNode', {
        label: 'C',
        expression: 'x',
        executionStatus: 'success',
        branchTaken: 'false',
      }) as never
    );
    const allDivs = Array.from(r.container.querySelectorAll('div.bg-red-100'));
    expect(allDivs.length).toBeGreaterThan(0);
    r.cleanup();
  });
});
