import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import { Send, StopCircle, X, Upload } from './icons';
import { ToolPicker, type ResourceAttachment, type ResourceType } from './ToolPicker';
import { VoiceButton } from './VoiceButton';
import type { MessageAttachment } from '../types';
import { STORAGE_KEYS } from '../constants/storage-keys';

interface AttachmentPreview {
  file: File;
  path: string; // server path
  mimeType: string;
  type: 'image' | 'file';
  previewUrl?: string; // object URL for thumbnail (images only)
}

interface ChatInputProps {
  onSend: (message: string, directTools?: string[], imageAttachments?: MessageAttachment[]) => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string;
}

export interface ChatInputHandle {
  setValue: (text: string) => void;
  focus: () => void;
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
    case 'file':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20';
    case 'url':
      return 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20';
    case 'composio-action':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20';
    case 'mcp-tool':
      return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20';
    case 'artifact':
      return 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20';
    case 'prompt':
      return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20';
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
    case 'file':
      return 'file';
    case 'url':
      return 'url';
    case 'composio-action':
      return 'app';
    case 'mcp-tool':
      return 'mcp';
    case 'artifact':
      return 'artifact';
    case 'prompt':
      return 'prompt';
  }
}

// --- Build hidden context block from attachments ---

function buildContextBlock(attachments: ResourceAttachment[]): string {
  // 'prompt' type attachments are prepended to user text, not injected as context
  const contextAtts = attachments.filter((a) => a.type !== 'prompt' && a.toolInstructions);
  if (contextAtts.length === 0) return '';

  const lines: string[] = [
    '',
    '---',
    '[ATTACHED CONTEXT — Follow these tool instructions exactly. Tools listed here are registered directly — call them by their own name. Do NOT wrap them in use_tool or search_tools.]',
    '',
  ];

  for (const att of contextAtts) {
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
  const [filePreviews, setFilePreviews] = useState<AttachmentPreview[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    setValue: (text: string) => {
      setValue(text);
      // Focus and trigger resize after value update
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    focus: () => {
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

  // Cleanup object URLs on unmount — use ref to access latest filePreviews
  const filePreviewsRef = useRef(filePreviews);
  filePreviewsRef.current = filePreviews;
  useEffect(() => {
    return () => {
      for (const p of filePreviewsRef.current) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, []);

  const handleImageSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsUploading(true);
    const newPreviews: AttachmentPreview[] = [];
    for (const file of Array.from(files)) {
      if (filePreviews.length + newPreviews.length >= 5) break; // max 5

      try {
        const formData = new FormData();
        formData.append('file', file);
        const token = localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);
        const res = await fetch('/api/v1/chat/upload-attachment', {
          method: 'POST',
          headers: {
            'X-Session-Token': token || '',
          },
          body: formData,
        });

        if (!res.ok) throw new Error('Upload failed');
        const resData = await res.json();

        const isImage = file.type.startsWith('image/');
        newPreviews.push({
          file,
          path: resData.data?.path || '',
          mimeType: file.type,
          type: isImage ? 'image' : 'file',
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        });
      } catch (err) {
        console.error('Failed to upload file:', err);
      }
    }

    setFilePreviews((prev) => [...prev, ...newPreviews]);
    setIsUploading(false);
    // Reset input so the same file can be re-selected
    e.target.value = '';
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const removeFile = (index: number) => {
    setFilePreviews((prev) => {
      const p = prev[index];
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const hasContent = value.trim() || filePreviews.length > 0;
    if (hasContent && !isLoading) {
      // Prompt attachments prepend their text before the user's message
      const promptPrefixes = attachments
        .filter((a) => a.type === 'prompt' && a.promptText)
        .map((a) => a.promptText!)
        .join('\n\n');
      const hasImage = filePreviews.some(p => p.type === 'image');
      const rawUserText = value.trim() || (hasImage ? 'Analyze this image.' : 'Analyze these files.');
      const userText = promptPrefixes ? `${promptPrefixes}\n\n${rawUserText}` : rawUserText;
      const contextBlock = buildContextBlock(attachments);
      const finalMessage = userText + contextBlock;

      // Extract tool names for direct LLM registration (tools selected via picker)
      const directToolNames = attachments
        .filter((a) => a.type === 'tool' || a.type === 'custom-tool')
        .map((a) => a.name);

      // Convert file previews to MessageAttachment[]
      const msgAttachments: MessageAttachment[] = filePreviews.map((p) => ({
        type: p.type,
        path: p.path,
        mimeType: p.mimeType,
        filename: p.file.name,
        size: p.file.size,
        previewUrl: p.previewUrl,
      }));

      onSend(
        finalMessage,
        directToolNames.length > 0 ? directToolNames : undefined,
        msgAttachments.length > 0 ? msgAttachments : undefined
      );
      setValue('');
      setAttachments([]);
      setFilePreviews([]);
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
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      <div className="flex-1 relative">
        {/* Attachment previews */}
        {filePreviews.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {filePreviews.map((preview, index) => (
              <div
                key={preview.path || index}
                className="relative group/att"
              >
                {preview.type === 'image' ? (
                  <div className="w-16 h-16 rounded-lg overflow-hidden border border-border dark:border-dark-border">
                    <img
                      src={preview.previewUrl}
                      alt={preview.file.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-xs max-w-[160px]">
                    <span className="truncate">{preview.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="absolute -top-1.5 -right-1.5 p-0.5 bg-black/60 text-white rounded-full opacity-0 group-hover/att:opacity-100 transition-opacity z-10"
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
            disabled={isLoading || isUploading || filePreviews.length >= 5}
            className={`p-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isUploading 
                ? 'text-primary dark:text-primary animate-pulse' 
                : 'text-text-muted dark:text-dark-text-muted hover:text-primary dark:hover:text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
            }`}
            aria-label="Attach files"
            title="Attach files (max 5)"
          >
            <Upload className="w-5 h-5" />
          </button>

          {/* Voice Input Button */}
          <VoiceButton
            onTranscription={(text) => {
              setValue((prev) => (prev ? `${prev} ${text}` : text));
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            disabled={isLoading}
          />

          {/* Textarea */}
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                filePreviews.length > 0
                  ? 'Ask what you want to know about the attachments...'
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
          disabled={(!value.trim() && filePreviews.length === 0) || isUploading}
          className="px-4 py-3 bg-primary hover:bg-primary-dark text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          aria-label="Send message"
        >
          <Send className="w-5 h-5" />
        </button>
      )}
    </form>
  );
});
