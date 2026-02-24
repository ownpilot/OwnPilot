import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import { Send, StopCircle, X, Image } from './icons';
import { ToolPicker, type ResourceAttachment, type ResourceType } from './ToolPicker';
import type { MessageAttachment } from '../types';

/** File attachment being previewed (with base64 data) */
interface ImagePreview {
  file: File;
  data: string; // base64
  mimeType: string;
  previewUrl: string; // object URL for thumbnail
}

interface ChatInputProps {
  onSend: (message: string, directTools?: string[], imageAttachments?: MessageAttachment[]) => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string;
}

export interface ChatInputHandle {
  setValue: (text: string) => void;
}

// --- Chip color mapping ---

function getChipStyle(type: ResourceType): string {
  switch (type) {
    case 'tool':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    case 'custom-tool':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'custom-data':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    case 'builtin-data':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
    case 'skill':
      return 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20';
  }
}

function getChipLabel(type: ResourceType): string {
  switch (type) {
    case 'tool':
      return 'tool';
    case 'custom-tool':
      return 'custom';
    case 'custom-data':
      return 'data';
    case 'builtin-data':
      return 'built-in';
    case 'skill':
      return 'skill';
  }
}

// --- Build hidden context block from attachments ---

function buildContextBlock(attachments: ResourceAttachment[]): string {
  if (attachments.length === 0) return '';

  const lines: string[] = [
    '',
    '---',
    '[ATTACHED CONTEXT — Follow these tool instructions exactly. Tools listed here are registered directly — call them by their own name. Do NOT wrap them in use_tool or search_tools.]',
    '',
  ];

  for (const att of attachments) {
    lines.push(att.toolInstructions);
    lines.push('');
  }

  return lines.join('\n');
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, onStop, isLoading, placeholder = 'Type a message...' },
  ref
) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ResourceAttachment[]>([]);
  const [imagePreviews, setImagePreviews] = useState<ImagePreview[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    setValue: (text: string) => {
      setValue(text);
      // Focus and trigger resize after value update
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
  }));

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const p of imagePreviews) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const handleImageSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newPreviews: ImagePreview[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (imagePreviews.length + newPreviews.length >= 5) break; // max 5

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip "data:image/xxx;base64," prefix
          resolve(result.split(',')[1] ?? '');
        };
        reader.readAsDataURL(file);
      });

      newPreviews.push({
        file,
        data: base64,
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setImagePreviews((prev) => [...prev, ...newPreviews]);
    // Reset input so the same file can be re-selected
    e.target.value = '';
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const removeImage = (index: number) => {
    setImagePreviews((prev) => {
      URL.revokeObjectURL(prev[index]!.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const hasContent = value.trim() || imagePreviews.length > 0;
    if (hasContent && !isLoading) {
      // Build final message: user text + hidden context block
      const userText = value.trim() || (imagePreviews.length > 0 ? 'Analyze this image.' : '');
      const contextBlock = buildContextBlock(attachments);
      const finalMessage = userText + contextBlock;

      // Extract tool names for direct LLM registration (tools selected via picker)
      const directToolNames = attachments
        .filter((a) => a.type === 'tool' || a.type === 'custom-tool')
        .map((a) => a.name);

      // Convert image previews to MessageAttachment[]
      const imageAttachments: MessageAttachment[] = imagePreviews.map((p) => ({
        type: 'image' as const,
        data: p.data,
        mimeType: p.mimeType,
        filename: p.file.name,
      }));

      onSend(
        finalMessage,
        directToolNames.length > 0 ? directToolNames : undefined,
        imageAttachments.length > 0 ? imageAttachments : undefined
      );
      setValue('');
      setAttachments([]);
      // Cleanup previews
      for (const p of imagePreviews) URL.revokeObjectURL(p.previewUrl);
      setImagePreviews([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleResourceSelect = (attachment: ResourceAttachment) => {
    // Prevent duplicates
    if (attachments.some((a) => a.name === attachment.name && a.type === attachment.type)) return;
    setAttachments((prev) => [...prev, attachment]);
    // Focus back on textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStop = () => {
    if (onStop) onStop();
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 items-end">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      <div className="flex-1 relative">
        {/* Image previews */}
        {imagePreviews.length > 0 && (
          <div className="flex gap-2 mb-2 px-1">
            {imagePreviews.map((preview, index) => (
              <div
                key={preview.previewUrl}
                className="relative group/img w-16 h-16 rounded-lg overflow-hidden border border-border dark:border-dark-border"
              >
                <img
                  src={preview.previewUrl}
                  alt={preview.file.name}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute top-0 right-0 p-0.5 bg-black/60 text-white rounded-bl-lg opacity-0 group-hover/img:opacity-100 transition-opacity"
                  aria-label={`Remove ${preview.file.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 px-1">
            {attachments.map((att, index) => (
              <span
                key={`${att.type}-${att.name}-${index}`}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium ${getChipStyle(att.type)}`}
              >
                <span className="opacity-60 text-[10px]">{getChipLabel(att.type)}</span>
                <span>{att.displayName || att.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  className="ml-0.5 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  aria-label={`Remove ${att.displayName || att.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1">
          {/* Resource Picker Button */}
          <ToolPicker onSelect={handleResourceSelect} disabled={isLoading} />

          {/* Image Upload Button */}
          <button
            type="button"
            onClick={handleImageSelect}
            disabled={isLoading || imagePreviews.length >= 5}
            className="p-2.5 text-text-muted dark:text-dark-text-muted hover:text-primary dark:hover:text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Attach image"
            title="Attach image (max 5)"
          >
            <Image className="w-5 h-5" />
          </button>

          {/* Textarea */}
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                imagePreviews.length > 0
                  ? 'Describe what you want to know about the image...'
                  : attachments.length > 0
                    ? 'Ask about the attached context...'
                    : placeholder
              }
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
          className="px-4 py-3 bg-error hover:bg-error/90 text-white rounded-xl transition-colors flex items-center justify-center"
          aria-label="Stop generation"
          title="Stop generation"
        >
          <StopCircle className="w-5 h-5" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!value.trim() && imagePreviews.length === 0}
          className="px-4 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          aria-label="Send message"
        >
          <Send className="w-5 h-5" />
        </button>
      )}
    </form>
  );
});
