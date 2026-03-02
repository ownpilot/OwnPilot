/**
 * VoiceButton — microphone recording button for chat input
 *
 * Toggles recording, sends audio for transcription, returns text.
 * Only renders when browser supports MediaRecorder.
 */

import { Mic } from './icons';
import { useVoice } from '../hooks/useVoice';

interface VoiceButtonProps {
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export function VoiceButton({ onTranscription, disabled }: VoiceButtonProps) {
  const {
    isRecording,
    isTranscribing,
    isSupported,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoice();

  if (!isSupported) return null;

  const handleClick = async () => {
    if (isTranscribing) return;

    if (isRecording) {
      const text = await stopRecording();
      if (text) onTranscription(text);
    } else {
      await startRecording();
    }
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isRecording) cancelRecording();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleRightClick}
        disabled={disabled || isTranscribing}
        className={`p-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          isRecording
            ? 'text-red-500 bg-red-500/10 hover:bg-red-500/20 animate-pulse'
            : isTranscribing
              ? 'text-primary bg-primary/10'
              : 'text-text-muted dark:text-dark-text-muted hover:text-primary dark:hover:text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
        }`}
        aria-label={
          isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Voice input'
        }
        title={
          isRecording
            ? 'Click to stop (right-click to cancel)'
            : isTranscribing
              ? 'Transcribing...'
              : 'Voice input'
        }
      >
        {isTranscribing ? (
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>
      {error && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-red-500 bg-bg-secondary dark:bg-dark-bg-secondary border border-red-500/20 rounded whitespace-nowrap">
          {error}
        </div>
      )}
    </div>
  );
}
