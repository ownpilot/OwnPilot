/**
 * VoicePlayButton — TTS playback button for assistant messages
 *
 * Synthesizes text via voice API and plays audio.
 * Shows volume icon (idle) → spinner (loading) → stop icon (playing).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Volume2, StopCircle } from './icons';
import { voiceApi } from '../api/endpoints/voice';
import { useVoiceAvailability } from '../hooks/useVoiceAvailability';

interface VoicePlayButtonProps {
  text: string;
}

export function VoicePlayButton({ text }: VoicePlayButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const isAvailable = useVoiceAvailability('tts');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const handleClick = async () => {
    if (!isAvailable) return;

    if (state === 'playing') {
      cleanup();
      setState('idle');
      return;
    }

    if (state === 'loading') return;

    setState('loading');
    try {
      const blob = await voiceApi.synthesize(text);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        cleanup();
        setState('idle');
      };

      audio.onerror = () => {
        cleanup();
        setState('idle');
      };

      await audio.play();
      setState('playing');
    } catch {
      cleanup();
      setState('idle');
    }
  };

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  if (isAvailable !== true) return null;

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
      title={state === 'playing' ? 'Stop playback' : 'Read aloud'}
    >
      {state === 'loading' ? (
        <div className="w-3 h-3 border-1.5 border-current border-t-transparent rounded-full animate-spin" />
      ) : state === 'playing' ? (
        <StopCircle className="w-3 h-3" />
      ) : (
        <Volume2 className="w-3 h-3" />
      )}
      <span>{state === 'playing' ? 'Stop' : state === 'loading' ? 'Loading...' : 'Listen'}</span>
    </button>
  );
}
