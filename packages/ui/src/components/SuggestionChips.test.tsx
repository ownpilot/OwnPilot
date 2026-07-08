// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SuggestionChips } from './SuggestionChips';

function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('SuggestionChips', () => {
  const suggestions = [
    { title: 'Search', detail: 'Search the web for answers' },
    { title: 'Code', detail: 'Generate code examples' },
  ];

  it('renders null when suggestions is empty', () => {
    const container = render(
      createElement(SuggestionChips, { suggestions: [], onSelect: vi.fn() })
    );
    expect(container.textContent).toBe('');
  });

  it('renders a button for each suggestion', () => {
    const container = render(createElement(SuggestionChips, { suggestions, onSelect: vi.fn() }));
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toBe('Search');
    expect(buttons[1]?.textContent).toBe('Code');
  });

  it('calls onSelect with the suggestion object on click', () => {
    const onSelect = vi.fn();
    const container = render(createElement(SuggestionChips, { suggestions, onSelect }));
    const buttons = container.querySelectorAll('button');
    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(suggestions[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('sets disabled on all buttons when disabled prop is true', () => {
    const container = render(
      createElement(SuggestionChips, {
        suggestions,
        onSelect: vi.fn(),
        disabled: true,
      })
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach((btn) => {
      expect(btn.disabled).toBe(true);
    });
  });

  it('does not disable buttons when disabled is false or omitted', () => {
    const container = render(createElement(SuggestionChips, { suggestions, onSelect: vi.fn() }));
    const buttons = container.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.disabled).toBe(false);
    });
  });

  it('renders title attribute with detail text on each button', () => {
    const container = render(createElement(SuggestionChips, { suggestions, onSelect: vi.fn() }));
    const buttons = container.querySelectorAll('button');
    expect(buttons[0]?.getAttribute('title')).toBe('Search the web for answers');
    expect(buttons[1]?.getAttribute('title')).toBe('Generate code examples');
  });

  it('renders rounded-full class on buttons', () => {
    const container = render(createElement(SuggestionChips, { suggestions, onSelect: vi.fn() }));
    const buttons = container.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.className).toContain('rounded-full');
    });
  });
});
