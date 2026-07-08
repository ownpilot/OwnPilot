// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextDetailModal } from './ContextDetailModal';

// Mock icons
vi.mock('./icons', () => ({
  X: ({ className }: { className?: string }) => (
    <span data-testid="icon-x" className={className}>
      X
    </span>
  ),
  Trash2: ({ className }: { className?: string }) => (
    <span data-testid="icon-trash" className={className}>
      Trash
    </span>
  ),
  RefreshCw: ({ className }: { className?: string }) => (
    <span data-testid="icon-refresh" className={className}>
      Refresh
    </span>
  ),
}));

vi.mock('../api', () => ({
  chatApi: {
    getContextDetail: vi.fn(),
  },
}));

vi.mock('../constants/storage-keys', () => ({
  STORAGE_KEYS: { AUTO_COMPACT_DISABLED: 'ownpilot_auto_compact_disabled' },
}));

import { chatApi } from '../api';

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
  vi.restoreAllMocks();
});

const defaultSessionInfo = {
  sessionId: 'session-1',
  messageCount: 42,
  estimatedTokens: 92_000,
  maxContextTokens: 100_000,
  contextFillPercent: 92,
  cachedTokens: 12_000,
};

describe('ContextDetailModal', () => {
  it('summarizes remaining context and recommends compacting near the limit', () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 15_000,
        messageHistoryTokens: 77_000,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    expect(container.textContent).toContain('92% used');
    expect(container.textContent).toContain('8.0K left');
    expect(container.textContent).toContain('Near limit');
    expect(container.textContent).toContain('Compact this session');
    expect(container.textContent).toContain('12.0K tokens served from prompt cache');
  });

  it('shows loading state initially', () => {
    // Never resolve the promise
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    expect(container.textContent).toContain('Loading breakdown');
  });

  it('shows section breakdown when breakdown has sections', async () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 20_000,
        messageHistoryTokens: 72_000,
        sections: [
          { name: 'System Instructions', tokens: 12_000 },
          { name: 'Tool Definitions', tokens: 8_000 },
        ],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('System Instructions');
    expect(container.textContent).toContain('Tool Definitions');
    expect(container.textContent).toContain('12.0K');
    expect(container.textContent).toContain('8.0K');
  });

  it('handles API failure gracefully', async () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API error')
    );

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Should still render with sessionInfo-derived values
    expect(container.textContent).toContain('92% used');
  });

  it('shows "Getting full" status at 75-89% fill', () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 10_000,
        messageHistoryTokens: 70_000,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={{
          sessionId: 's1',
          messageCount: 20,
          estimatedTokens: 80_000,
          maxContextTokens: 100_000,
          contextFillPercent: 80,
        }}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    expect(container.textContent).toContain('Getting full');
  });

  it('shows "Healthy" status at <75% fill', () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 128_000,
        systemPromptTokens: 5_000,
        messageHistoryTokens: 25_000,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={{
          sessionId: 's1',
          messageCount: 5,
          estimatedTokens: 30_000,
          maxContextTokens: 128_000,
          contextFillPercent: 23,
        }}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    expect(container.textContent).toContain('Healthy');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={onClose}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLElement;
    act(() => {
      closeBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={onClose}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    // Click the backdrop (the outer overlay)
    const backdrop = container.firstElementChild as HTMLElement;
    act(() => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking modal content', () => {
    const onClose = vi.fn();
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={onClose}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    // The inner modal div has onClick={e => e.stopPropagation()}
    const innerModal = container.querySelector('.w-full') as HTMLElement;
    act(() => {
      innerModal.click();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onCompact when Compact button is clicked', async () => {
    const onCompact = vi.fn().mockResolvedValue(undefined);
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 15_000,
        messageHistoryTokens: 77_000,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={onCompact}
        onClear={() => undefined}
      />
    );

    const compactBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Compact')
    );
    expect(compactBtn).not.toBeNull();

    act(() => {
      compactBtn?.click();
    });
    expect(onCompact).toHaveBeenCalledTimes(1);
  });

  it('shows compact error when onCompact fails', async () => {
    const onCompact = vi.fn().mockRejectedValue(new Error('Too few messages'));
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 15_000,
        messageHistoryTokens: 77_000,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={onCompact}
        onClear={() => undefined}
      />
    );

    const compactBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Compact')
    );
    act(() => {
      compactBtn?.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Too few messages');
  });

  it('shows generic error message when compact fails with non-Error', async () => {
    const onCompact = vi.fn().mockRejectedValue('string error');
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 15_000,
        messageHistoryTokens: 77_000,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={onCompact}
        onClear={() => undefined}
      />
    );

    const compactBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Compact')
    );
    act(() => {
      compactBtn?.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Could not compact this conversation');
  });

  it('disables compact button when canCompact is false', () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 2_000,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={{
          sessionId: 's1',
          messageCount: 3,
          estimatedTokens: 2_000,
          maxContextTokens: 100_000,
          contextFillPercent: 2,
        }}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    const compactBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Compact')
    );
    expect(compactBtn).not.toBeNull();
    expect((compactBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onClear when Clear Session button is clicked', () => {
    const onClear = vi.fn();
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={onClear}
      />
    );

    const clearBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Clear Session')
    );
    act(() => {
      clearBtn?.click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('shows auto-compact banner disabled notice when banner is off', () => {
    // Set auto-compact disabled in localStorage
    localStorage.setItem('ownpilot_auto_compact_disabled', '1');
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    expect(container.textContent).toContain('Auto-compact banner is off');
    expect(container.textContent).toContain('Re-enable');
  });

  it('re-enables auto-compact banner and hides notice', () => {
    localStorage.setItem('ownpilot_auto_compact_disabled', '1');
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    const reEnableBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Re-enable')
    );
    act(() => {
      reEnableBtn?.click();
    });

    expect(localStorage.getItem('ownpilot_auto_compact_disabled')).toBeNull();
  });

  it('shows last compaction summary when provided', () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const onDismissSummary = vi.fn();
    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
        lastCompactionSummary="Preserved: recent messages, removed: old context"
        onDismissSummary={onDismissSummary}
      />
    );

    expect(container.textContent).toContain('Last compaction summary');
    expect(container.textContent).toContain('Preserved: recent messages');
  });

  it('calls onDismissSummary when dismiss button clicked on summary', () => {
    const onDismissSummary = vi.fn();
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
        lastCompactionSummary="Preserved content"
        onDismissSummary={onDismissSummary}
      />
    );

    const dismissBtn = container.querySelector(
      'button[aria-label="Dismiss compaction summary"]'
    ) as HTMLElement;
    act(() => {
      dismissBtn?.click();
    });
    expect(onDismissSummary).toHaveBeenCalledTimes(1);
  });

  it('does not show dismiss button when onDismissSummary is not provided', () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        sections: [],
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
        lastCompactionSummary="Preserved content"
      />
    );

    expect(container.querySelector('button[aria-label="Dismiss compaction summary"]')).toBeNull();
  });

  it('uses breakdown provider/model name when available', async () => {
    (chatApi.getContextDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      breakdown: {
        maxContextTokens: 100_000,
        systemPromptTokens: 10_000,
        messageHistoryTokens: 82_000,
        sections: [],
        providerName: 'Anthropic',
        modelName: 'claude-3',
      },
    });

    const container = render(
      <ContextDetailModal
        sessionInfo={defaultSessionInfo}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Anthropic');
    expect(container.textContent).toContain('claude-3');
  });
});
