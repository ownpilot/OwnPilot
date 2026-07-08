// @vitest-environment happy-dom

/**
 * VoicePlayButton tests.
 *
 * Covers: availability gate, idle/loading/playing states,
 * click to start playback, click to stop, API error handling.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { VoicePlayButton } from './VoicePlayButton';

// Mock dependencies
vi.mock('../hooks/useVoiceAvailability', () => ({
  useVoiceAvailability: vi.fn(),
}));

vi.mock('../api/endpoints/voice', () => ({
  voiceApi: { synthesize: vi.fn() },
}));

vi.mock('./icons', () => ({
  Volume2: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'icon-volume2', className }),
  StopCircle: ({ className }: { className?: string }) =>
    createElement('svg', { 'data-testid': 'icon-stop-circle', className }),
}));

import { useVoiceAvailability } from '../hooks/useVoiceAvailability';
import { voiceApi } from '../api/endpoints/voice';

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

describe('VoicePlayButton', () => {
  it('renders null when voice is not available', () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(false);
    const { container } = render(createElement(VoicePlayButton, { text: 'Hello world' }));
    expect(container.textContent).toBe('');
  });

  it('renders null when useVoiceAvailability returns null (loading)', () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(null as unknown as boolean);
    const { container } = render(createElement(VoicePlayButton, { text: 'Hello' }));
    expect(container.textContent).toBe('');
  });

  it('renders button with Listen text in idle state when available', () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(true);
    const { container } = render(createElement(VoicePlayButton, { text: 'Hello world' }));
    expect(container.textContent).toContain('Listen');
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('renders Volume2 icon in idle state', () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(true);
    const { container } = render(createElement(VoicePlayButton, { text: 'Hello' }));
    expect(container.querySelector('[data-testid="icon-volume2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="icon-stop-circle"]')).toBeNull();
  });

  it('shows loading state after click while voiceApi.synthesize is pending', async () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(true);
    // Keep the promise pending so we can observe the loading state
    vi.mocked(voiceApi.synthesize).mockReturnValue(
      new Promise<Blob>(() => {}) // never resolves
    );

    const { container } = render(createElement(VoicePlayButton, { text: 'Hello' }));
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // Yield to let React process the state update
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain('Loading...');
    // Spinner via CSS class, not an icon
    expect(container.querySelector('[data-testid="icon-volume2"]')).toBeNull();
    expect(container.querySelector('[data-testid="icon-stop-circle"]')).toBeNull();
  });

  it('transitions to playing state after successful synthesis', async () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(true);

    // Stub Audio with a proper constructor function (vi.fn doesn't work with `new`)
    const audioPlay = vi.fn().mockResolvedValue(undefined);
    const audioPause = vi.fn();
    function MockAudio() {
      return { play: audioPlay, pause: audioPause };
    }
    vi.stubGlobal('Audio', MockAudio);
    vi.stubGlobal(
      'URL',
      Object.assign(Object.create(null), {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      })
    );

    const blob = new Blob(['audio data'], { type: 'audio/wav' });
    vi.mocked(voiceApi.synthesize).mockResolvedValue(blob);

    const { container } = render(createElement(VoicePlayButton, { text: 'Hello' }));
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Flush React updates after async handler completes
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(voiceApi.synthesize).toHaveBeenCalledWith('Hello');
    expect(container.textContent).toContain('Stop');
    expect(container.querySelector('[data-testid="icon-stop-circle"]')).not.toBeNull();
    expect(audioPlay).toHaveBeenCalled();
  });

  it('returns to idle state when clicking while playing', async () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(true);

    const audioPlay = vi.fn().mockResolvedValue(undefined);
    const audioPause = vi.fn();
    function MockAudio() {
      return { play: audioPlay, pause: audioPause };
    }
    vi.stubGlobal('Audio', MockAudio);
    vi.stubGlobal(
      'URL',
      Object.assign(Object.create(null), {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      })
    );

    const blob = new Blob(['data'], { type: 'audio/wav' });
    vi.mocked(voiceApi.synthesize).mockResolvedValue(blob);

    const { container } = render(createElement(VoicePlayButton, { text: 'Hello' }));
    const button = container.querySelector('button')!;

    // First click: start playback
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(container.textContent).toContain('Stop');

    // Second click: stop playback
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain('Listen');
    expect(audioPause).toHaveBeenCalled();
  });

  it('handles API error gracefully and returns to idle', async () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(true);
    vi.mocked(voiceApi.synthesize).mockRejectedValue(new Error('API unavailable'));

    const { container } = render(createElement(VoicePlayButton, { text: 'Hello' }));
    const button = container.querySelector('button')!;

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should return to idle state after error
    expect(container.textContent).toContain('Listen');
  });

  it('sets title attribute correctly based on state', () => {
    vi.mocked(useVoiceAvailability).mockReturnValue(true);

    const { container } = render(createElement(VoicePlayButton, { text: 'Hello' }));
    const button = container.querySelector('button');
    expect(button?.getAttribute('title')).toBe('Read aloud');
  });
});
