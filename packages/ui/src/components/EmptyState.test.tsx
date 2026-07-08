// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { EmptyState } from './EmptyState';

function TestIcon({ className = '' }: { className?: string }) {
  return createElement('svg', { className, 'data-testid': 'test-icon' });
}

function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('EmptyState', () => {
  it('renders the default variant with title, description, and default action buttons', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const container = render(
      createElement(EmptyState, {
        icon: TestIcon,
        title: 'No agents yet',
        description: 'Create one to get started.',
        action: { label: 'Create', onClick: onPrimary },
        secondaryAction: { label: 'Learn more', onClick: onSecondary },
      })
    );

    expect(container.textContent).toContain('No agents yet');
    expect(container.textContent).toContain('Create one to get started.');

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(buttons[1]?.className).toContain('text-text-secondary');
  });

  it('renders the minimal variant without action buttons or icon background wrapper', () => {
    const container = render(
      createElement(EmptyState, {
        icon: TestIcon,
        title: 'Nothing here',
        variant: 'minimal',
        size: 'sm',
      })
    );

    expect(container.textContent).toContain('Nothing here');
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[data-testid="test-icon"]')?.getAttribute('class')).toContain(
      'w-10 h-10'
    );
  });

  it('renders the card variant with explicit secondary button styling and action icons', () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const container = render(
      createElement(EmptyState, {
        icon: TestIcon,
        title: 'No runs',
        description: 'Run history will appear here.',
        variant: 'card',
        size: 'lg',
        action: {
          label: 'Run now',
          onClick: onPrimary,
          icon: TestIcon,
          variant: 'ghost',
        },
        secondaryAction: {
          label: 'Import',
          onClick: onSecondary,
          icon: TestIcon,
        },
      })
    );

    expect(container.textContent).toContain('No runs');
    expect(container.querySelector('[data-testid="test-icon"]')?.getAttribute('class')).toContain(
      'w-20 h-20'
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons[0]?.className).toContain('text-text-secondary');
    expect(buttons[1]?.className).toContain('border-border');
    expect(container.querySelectorAll('button [data-testid="test-icon"]')).toHaveLength(2);
  });

  it('falls back to base button classes for unexpected runtime variants', () => {
    const container = render(
      createElement(EmptyState, {
        icon: TestIcon,
        title: 'Runtime variant',
        action: {
          label: 'Mystery',
          onClick: vi.fn(),
          variant: 'mystery' as never,
        },
      })
    );

    const button = container.querySelector('button');
    expect(button?.className).toBe(
      'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium'
    );
  });
});
