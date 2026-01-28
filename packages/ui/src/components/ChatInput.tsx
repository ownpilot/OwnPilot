import { useState, useRef, useEffect, type KeyboardEvent, type FormEvent } from 'react';
import { Send, StopCircle } from './icons';
import { ToolPicker } from './ToolPicker';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, onStop, isLoading, placeholder = 'Type a message...' }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !isLoading) {
      onSend(value.trim());
      setValue('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleToolSelect = (toolName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setValue((prev) => prev + toolName);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentValue = value;

    // Insert tool name at cursor position
    const newValue = currentValue.substring(0, start) + toolName + currentValue.substring(end);
    setValue(newValue);

    // Restore cursor position after tool name
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + toolName.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleStop = () => {
    if (onStop) {
      onStop();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 items-end">
      <div className="flex-1 relative">
        <div className="flex items-end gap-1">
          {/* Tool Picker Button */}
          <ToolPicker onSelect={handleToolSelect} disabled={isLoading} />

          {/* Textarea */}
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              rows={1}
              className="w-full px-4 py-3 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted border border-border dark:border-dark-border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            />
          </div>
        </div>
      </div>

      {/* Send or Stop button */}
      {isLoading ? (
        <button
          type="button"
          onClick={handleStop}
          className="px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors flex items-center justify-center"
          title="Stop generation"
        >
          <StopCircle className="w-5 h-5" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-4 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
        >
          <Send className="w-5 h-5" />
        </button>
      )}
    </form>
  );
}
