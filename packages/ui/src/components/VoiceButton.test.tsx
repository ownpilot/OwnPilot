// @vitest-environment happy-dom

/**
 * VoiceButton tests.
 *
 * Covers: isSupported gate, idle/recording/transcribing states,
 * click to start/stop recording, right-click to cancel,
 * error tooltip, disabled state.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceButton } from './VoiceButton';

// Mock dependencies
vi.mock('./icons', () => ({
  Mic: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'icon-mic', className }),
}));

vi.mock('../hooks/useVoice', () => ({
  useVoice: vi.fn(),
}));

import { useVoice } from '../hooks/useVoice';

function makeUseVoiceReturn(overrides: Record<string, unknown> = {}) {
  return {
    isRecording: false,
    isTranscribing: false,
    isSupported: true,
    isBrowserSupported: true,
    isServiceAvailable: true,
    error: null,
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(null),
    cancelRecording: vi.fn(),
    ...overrides,
  };
}

function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return { container };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('VoiceButton', () => {
  it('renders null when voice is not supported', () => {
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({ isSupported: false }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    expect(container.textContent).toBe('');
  });

  it('renders button with Mic icon when supported and idle', () => {
    vi.mocked(useVoice).mockReturnValue(makeUseVoiceReturn() as ReturnType<typeof useVoice>);
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    expect(container.querySelector('button')).not.toBeNull();
    expect(container.querySelector('[data-testid="icon-mic"]')).not.toBeNull();
  });

  it('has aria-label "Voice input" in idle state', () => {
    vi.mocked(useVoice).mockReturnValue(makeUseVoiceReturn() as ReturnType<typeof useVoice>);
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Voice input');
  });

  it('calls startRecording on click when idle', async () => {
    const startRecording = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({ startRecording }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it('calls stopRecording on click when recording and invokes onTranscription', async () => {
    const stopRecording = vi.fn().mockResolvedValue('Hello transcribed');
    const onTranscription = vi.fn();
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({
        isRecording: true,
        stopRecording,
      }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription }));
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(onTranscription).toHaveBeenCalledWith('Hello transcribed');
  });

  it('does not call onTranscription when stopRecording returns null', async () => {
    const stopRecording = vi.fn().mockResolvedValue(null);
    const onTranscription = vi.fn();
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({
        isRecording: true,
        stopRecording,
      }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription }));
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(onTranscription).not.toHaveBeenCalled();
  });

  it('does nothing on click when isTranscribing', async () => {
    const startRecording = vi.fn();
    const stopRecording = vi.fn();
    const onTranscription = vi.fn();
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({
        isTranscribing: true,
        startRecording,
        stopRecording,
      }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription }));
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(startRecording).not.toHaveBeenCalled();
    expect(stopRecording).not.toHaveBeenCalled();
    expect(onTranscription).not.toHaveBeenCalled();
  });

  it('calls cancelRecording on right-click when recording', () => {
    const cancelRecording = vi.fn();
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({
        isRecording: true,
        cancelRecording,
      }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    const button = container.querySelector('button')!;

    act(() => {
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    expect(cancelRecording).toHaveBeenCalledTimes(1);
  });

  it('does not call cancelRecording on right-click when not recording', () => {
    const cancelRecording = vi.fn();
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({ cancelRecording }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    const button = container.querySelector('button')!;

    act(() => {
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    expect(cancelRecording).not.toHaveBeenCalled();
  });

  it('renders button disabled when disabled prop is true', () => {
    vi.mocked(useVoice).mockReturnValue(makeUseVoiceReturn() as ReturnType<typeof useVoice>);
    const { container } = render(
      createElement(VoiceButton, {
        onTranscription: vi.fn(),
        disabled: true,
      })
    );
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
  });

  it('renders button disabled when isTranscribing is true', () => {
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({
        isTranscribing: true,
        isRecording: false,
      }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
  });

  it('shows error tooltip when error is present', () => {
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({
        error: 'Microphone access denied',
      }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    expect(container.textContent).toContain('Microphone access denied');
  });

  it('shows spinner and "Transcribing..." aria-label when transcribing', () => {
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({
        isTranscribing: true,
      }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Transcribing...');
    // Should have a spinner div (not Mic icon)
    expect(button?.querySelector('.animate-spin')).not.toBeNull();
    expect(container.querySelector('[data-testid="icon-mic"]')).toBeNull();
  });

  it('shows "Stop recording" aria-label when recording', () => {
    vi.mocked(useVoice).mockReturnValue(
      makeUseVoiceReturn({ isRecording: true }) as ReturnType<typeof useVoice>
    );
    const { container } = render(createElement(VoiceButton, { onTranscription: vi.fn() }));
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Stop recording');
  });
});
