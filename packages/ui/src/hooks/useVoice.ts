/**
 * useVoice — browser audio recording hook
 *
 * Uses MediaRecorder API to capture microphone audio.
 * Returns controls for recording and transcription state.
 */

import { useState, useRef, useCallback } from 'react';
import { voiceApi } from '../api/endpoints/voice';
import { useVoiceAvailability } from './useVoiceAvailability';

export interface UseVoiceReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  isBrowserSupported: boolean;
  isServiceAvailable: boolean | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  cancelRecording: () => void;
}

export function useVoice(): UseVoiceReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const isBrowserSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof MediaRecorder !== 'undefined';

  const voiceServiceAvailable = useVoiceAvailability('stt');
  const isServiceAvailable = isBrowserSupported ? voiceServiceAvailable : false;
  const isSupported = isBrowserSupported && isServiceAvailable === true;

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    if (!isBrowserSupported) {
      setError('Voice recording is not supported in this browser');
      return;
    }
    if (!isServiceAvailable) {
      setError('Voice transcription is not configured');
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer webm/opus, fall back to whatever is available
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : undefined;

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      cleanup();
      const message = err instanceof Error ? err.message : 'Failed to start recording';
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError('Microphone access denied. Please allow microphone access.');
      } else {
        setError(message);
      }
    }
  }, [isBrowserSupported, isServiceAvailable, cleanup]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      cleanup();
      setIsRecording(false);
      return null;
    }

    return new Promise<string | null>((resolve) => {
      recorder.onstop = async () => {
        setIsRecording(false);

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        cleanup();

        if (blob.size === 0) {
          setError('No audio recorded');
          resolve(null);
          return;
        }

        setIsTranscribing(true);
        try {
          const result = await voiceApi.transcribe(blob);
          setIsTranscribing(false);
          resolve(result.text);
        } catch (err) {
          setIsTranscribing(false);
          setError(err instanceof Error ? err.message : 'Transcription failed');
          resolve(null);
        }
      };

      recorder.stop();
    });
  }, [cleanup]);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    cleanup();
    setIsRecording(false);
  }, [cleanup]);

  return {
    isRecording,
    isTranscribing,
    isSupported,
    isBrowserSupported,
    isServiceAvailable,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
