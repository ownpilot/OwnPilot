import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CodeBlock as CodeshineCB } from '@oxog/codeshine/react';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export function CodeBlock({ code, language = 'bash', filename, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'relative group rounded-xl overflow-hidden border border-[var(--color-border)]',
        'bg-[var(--color-code-bg)]',
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]/50">
        <div className="flex items-center gap-3">
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400/60" />
            <div className="w-3 h-3 rounded-full bg-yellow-400/60" />
            <div className="w-3 h-3 rounded-full bg-green-400/60" />
          </div>
          {filename && (
            <span className="text-xs text-[var(--color-text-subtle)] font-mono">{filename}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-subtle)] uppercase tracking-wider font-mono">
            {language}
          </span>
          <button
            onClick={handleCopy}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all duration-150',
              'text-[var(--color-text-subtle)] hover:text-[var(--color-text)]',
              'hover:bg-[var(--color-border)] cursor-pointer',
              copied && 'text-emerald-500 dark:text-emerald-400'
            )}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code */}
      <div className="overflow-auto p-4">
        <CodeshineCB
          code={code.trim()}
          language={language}
          theme="auto"
          copyButton={false}
          className="!bg-transparent !text-sm !font-mono !p-0 !m-0 !border-0 !rounded-none"
        />
      </div>
    </div>
  );
}

interface InlineCodeProps {
  children: React.ReactNode;
  className?: string;
}

export function InlineCode({ children, className }: InlineCodeProps) {
  return (
    <code
      className={cn(
        'px-1.5 py-0.5 rounded-md text-sm font-mono',
        'bg-[var(--color-code-bg)] text-[var(--color-code-text)]',
        'border border-[var(--color-border)]',
        className
      )}
    >
      {children}
    </code>
  );
}
