// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextBar } from './ContextBar';

function render(element: React.ReactElement) {
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

describe('ContextBar', () => {
  it('shows context health, remaining tokens, and accessible progress', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 18,
          estimatedTokens: 90_000,
          maxContextTokens: 100_000,
          contextFillPercent: 90,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.textContent).toContain('18');
    expect(container.textContent).toContain('Near limit');
    expect(container.textContent).toContain('10.0K left');
    expect(container.textContent).toContain('90%');
  });

  it('uses derived fill percent when reported fill is 0 and estimatedTokens > 0', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 4,
          estimatedTokens: 32_000,
          maxContextTokens: 128_000,
          contextFillPercent: 0,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.textContent).toContain('25%');
    expect(container.textContent).toContain('96.0K left');
  });

  it('shows cached tokens indicator when present', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 12,
          estimatedTokens: 40_000,
          maxContextTokens: 100_000,
          contextFillPercent: 40,
          cachedTokens: 8_000,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.textContent).toContain('8.0K cached');
  });

  it('shows cached token percentage when estimatedTokens > 0', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 12,
          estimatedTokens: 50_000,
          maxContextTokens: 100_000,
          contextFillPercent: 50,
          cachedTokens: 5_000,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.textContent).toContain('(10%)');
  });

  it('shows "Getting full" status at 65-84%', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 's1',
          messageCount: 10,
          estimatedTokens: 70_000,
          maxContextTokens: 100_000,
          contextFillPercent: 70,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.textContent).toContain('Getting full');
  });

  it('shows "Healthy" status at <65%', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 's1',
          messageCount: 3,
          estimatedTokens: 20_000,
          maxContextTokens: 100_000,
          contextFillPercent: 20,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.textContent).toContain('Healthy');
  });

  it('shows red fill bar at >=80%', () => {
    const sessionInfo = {
      sessionId: 's1',
      messageCount: 20,
      estimatedTokens: 85_000,
      maxContextTokens: 100_000,
      contextFillPercent: 85,
    };

    const container = render(
      <ContextBar
        sessionInfo={sessionInfo}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    // Red fill bar class
    const fillDiv = container.querySelector('.bg-red-500');
    expect(fillDiv).not.toBeNull();
  });

  it('shows yellow fill bar at 50-79%', () => {
    const sessionInfo = {
      sessionId: 's1',
      messageCount: 10,
      estimatedTokens: 60_000,
      maxContextTokens: 100_000,
      contextFillPercent: 60,
    };

    const container = render(
      <ContextBar
        sessionInfo={sessionInfo}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.querySelector('.bg-yellow-500')).not.toBeNull();
  });

  it('shows green fill bar at <50%', () => {
    const sessionInfo = {
      sessionId: 's1',
      messageCount: 3,
      estimatedTokens: 20_000,
      maxContextTokens: 100_000,
      contextFillPercent: 20,
    };

    const container = render(
      <ContextBar
        sessionInfo={sessionInfo}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.querySelector('.bg-emerald-500')).not.toBeNull();
  });

  it('shows compacting spinner when isCompacting is true', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 's1',
          messageCount: 5,
          estimatedTokens: 10_000,
          maxContextTokens: 100_000,
          contextFillPercent: 10,
        }}
        isCompacting={true}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(container.textContent).toContain('Compacting');
  });

  it('renders with null sessionInfo gracefully', () => {
    const container = render(
      <ContextBar
        sessionInfo={null}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    // 0 msgs, 0%, no errors
    expect(container.textContent).toContain('0');
  });

  it('shows title with breakdown on hover', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 's1',
          messageCount: 5,
          estimatedTokens: 25_000,
          maxContextTokens: 100_000,
          contextFillPercent: 25,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    const progressBtn = container.querySelector('button');
    expect(progressBtn?.getAttribute('title')).toContain('25.0K used');
  });

  it('uses defaultMaxTokens when maxContextTokens is not available', () => {
    const container = render(
      <ContextBar
        sessionInfo={{
          sessionId: 's1',
          messageCount: 2,
          estimatedTokens: 10_000,
          maxContextTokens: undefined as unknown as number,
          contextFillPercent: 0,
        }}
        defaultMaxTokens={64_000}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    // maxContextTokens not provided → should fall back to defaultMaxTokens
    expect(container.textContent).toContain('64.0K');
  });
});
