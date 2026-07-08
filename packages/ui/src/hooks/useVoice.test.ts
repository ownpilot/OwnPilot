// @vitest-environment happy-dom
/**
 * useVoice tests — browser audio recording hook.
 *
 * Mocks useVoiceAvailability to control the service-available gate,
 * provides a fake MediaRecorder, and fakes navigator.mediaDevices.getUserMedia.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useVoice } from './useVoice';

// ---- Mocks ----

// Mock useVoiceAvailability so we control isServiceAvailable without
// depending on voiceApi.getStatus or its module-level cache.
const mockUseVoiceAvailability = vi.hoisted(() => vi.fn());
vi.mock('./useVoiceAvailability', () => ({
  useVoiceAvailability: mockUseVoiceAvailability,
}));

// Mock voiceApi transcribe
const mockTranscribe = vi.hoisted(() => vi.fn());
vi.mock('../api/endpoints/voice', () => ({
  voiceApi: {
    transcribe: mockTranscribe,
  },
}));

// ---- Fake MediaRecorder ----
// Must be a real constructor function so `new FakeMediaRecorder(...)` works.

const recorderInstances: Array<Record<string, unknown>> = [];

function FakeMediaRecorder(
  this: Record<string, unknown>,
  _stream: MediaStream,
  _options?: MediaRecorderOptions
) {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const self = this;
  self.state = 'inactive';
  self.ondataavailable = null;
  self.onstop = null;
  self.onerror = null;
  self.start = function () {
    self.state = 'recording';
  };
  self.stop = function () {
    self.state = 'inactive';
    if (typeof self.ondataavailable === 'function') {
      (self.ondataavailable as (e: { data: Blob }) => void)({
        data: new Blob(['audio data'], { type: 'audio/webm' }),
      });
    }
    if (typeof self.onstop === 'function') {
      (self.onstop as () => void)();
    }
  };
  self.mimeType = 'audio/webm;codecs=opus';
  recorderInstances.push(self);
}
(FakeMediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported = vi
  .fn()
  .mockReturnValue(true);

// ---- Minimal renderHook ----

function renderHook<T>(useHook: () => T) {
  const result = { current: null as unknown as T };
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  function TestComponent() {
    result.current = useHook();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(TestComponent));
  });

  return {
    result,
    unmount: () =>
      act(() => {
        root.unmount();
        if (container.parentNode) container.parentNode.removeChild(container);
      }),
  };
}

// ---- Setup / teardown ----

beforeEach(() => {
  recorderInstances.length = 0;
  vi.clearAllMocks();

  // Default: service is available (STT supported)
  mockUseVoiceAvailability.mockReturnValue(true);

  // Provide MediaRecorder if happy-dom lacks it
  if (typeof globalThis.MediaRecorder === 'undefined') {
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
  }

  // Fake navigator.mediaDevices.getUserMedia returning a stream that has getTracks
  const fakeStream = {
    getTracks: vi.fn(() => [{ stop: vi.fn() }]),
  };
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn() },
      configurable: true,
      writable: true,
    });
  }
  (navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    fakeStream
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ---- Tests ----

describe('useVoice', () => {
  it('returns initial state (not recording, no error, browser supported)', () => {
    const { result, unmount } = renderHook(() => useVoice());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.isBrowserSupported).toBe(true);
    expect(result.current.error).toBeNull();

    unmount();
  });

  it('detects browser support as false when MediaRecorder is absent', () => {
    delete (globalThis as Record<string, unknown>).MediaRecorder;

    const { result, unmount } = renderHook(() => useVoice());

    expect(result.current.isBrowserSupported).toBe(false);
    expect(result.current.isSupported).toBe(false);

    unmount();
  });

  it('isSupported is false when service is not available', () => {
    mockUseVoiceAvailability.mockReturnValue(false);

    const { result, unmount } = renderHook(() => useVoice());

    expect(result.current.isSupported).toBe(false);

    unmount();
  });

  it('startRecording sets error when browser not supported', async () => {
    delete (globalThis as Record<string, unknown>).MediaRecorder;

    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('Voice recording is not supported in this browser');
    expect(result.current.isRecording).toBe(false);

    unmount();
  });

  it('startRecording sets error when service is not available', async () => {
    mockUseVoiceAvailability.mockReturnValue(false);

    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('Voice transcription is not configured');
    expect(result.current.isRecording).toBe(false);

    unmount();
  });

  it('startRecording calls getUserMedia and starts the recorder', async () => {
    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorderInstances.length).toBeGreaterThan(0);
    expect(result.current.isRecording).toBe(true);
    expect(result.current.error).toBeNull();

    unmount();
  });

  it('startRecording handles getUserMedia rejection (permission denied)', async () => {
    (navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError')
    );

    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('Microphone access denied. Please allow microphone access.');
    expect(result.current.isRecording).toBe(false);

    unmount();
  });

  it('startRecording handles generic getUserMedia rejection', async () => {
    (navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Camera in use')
    );

    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('Camera in use');
    expect(result.current.isRecording).toBe(false);

    unmount();
  });

  it('stopRecording returns null when no recorder is active', async () => {
    const { result, unmount } = renderHook(() => useVoice());

    const text = await act(async () => {
      return await result.current.stopRecording();
    });

    expect(text).toBeNull();
    expect(result.current.isRecording).toBe(false);

    unmount();
  });

  it('stopRecording transcribes audio and returns text', async () => {
    mockTranscribe.mockResolvedValue({ text: 'Hello world' });

    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    // Stop and transcribe
    const text = await act(async () => {
      return await result.current.stopRecording();
    });

    expect(text).toBe('Hello world');
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).toHaveBeenCalledWith(expect.any(Blob));

    unmount();
  });

  it('stopRecording handles transcription errors', async () => {
    mockTranscribe.mockRejectedValue(new Error('Transcription service unavailable'));

    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });

    const text = await act(async () => {
      return await result.current.stopRecording();
    });

    expect(text).toBeNull();
    expect(result.current.error).toBe('Transcription service unavailable');
    expect(result.current.isTranscribing).toBe(false);

    unmount();
  });

  it('cancelRecording stops the recorder and cleans up', async () => {
    const { result, unmount } = renderHook(() => useVoice());

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.cancelRecording();
    });
    expect(result.current.isRecording).toBe(false);

    unmount();
  });

  it('cancelRecording is safe when no recorder is active', () => {
    const { result, unmount } = renderHook(() => useVoice());

    expect(() => {
      act(() => {
        result.current.cancelRecording();
      });
    }).not.toThrow();

    unmount();
  });
});
