// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Skeleton, SkeletonCard, SkeletonStats } from './Skeleton';

function render(element: ReactElement) {
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

describe('Skeleton', () => {
  it('renders the requested number of pulse placeholders with custom classes', () => {
    const container = render(createElement(Skeleton, { count: 3, className: 'h-4 w-full' }));

    const items = container.querySelectorAll('.animate-pulse');
    expect(items).toHaveLength(3);
    expect(items[0]?.className).toContain('h-4 w-full');
  });
});

describe('SkeletonCard', () => {
  it('renders card-shaped skeleton rows', () => {
    const container = render(createElement(SkeletonCard, { count: 2 }));

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
    expect(container.querySelector('.space-y-3')).not.toBeNull();
  });
});

describe('SkeletonStats', () => {
  it('renders stat-card skeletons in a responsive grid', () => {
    const container = render(createElement(SkeletonStats, { count: 5 }));

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
    expect(container.querySelector('.grid')).not.toBeNull();
  });
});
