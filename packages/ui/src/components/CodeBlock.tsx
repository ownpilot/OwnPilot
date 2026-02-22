import { useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { Copy, Check, Play, Download } from './icons';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  onExecute?: () => void;
  isExecuting?: boolean;
}

// Map common language names to Prism language identifiers
const languageMap: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  plaintext: 'plain',
  text: 'plain',
};

export function CodeBlock({
  code,
  language = 'plaintext',
  filename,
  showLineNumbers = true,
  maxHeight = '400px',
  onExecute,
  isExecuting = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable or denied — fail silently
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `code.${getExtension(language)}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Normalize language name for Prism
  const prismLanguage = languageMap[language.toLowerCase()] || language.toLowerCase();

  return (
    <div className="rounded-lg overflow-hidden border border-border dark:border-dark-border bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#3d3d3d]">
        <div className="flex items-center gap-2">
          {filename && <span className="text-sm text-gray-400 font-mono">{filename}</span>}
          <span className="px-2 py-0.5 text-xs bg-[#3d3d3d] text-gray-400 rounded">{language}</span>
        </div>
        <div className="flex items-center gap-1">
          {onExecute && (
            <button
              onClick={onExecute}
              disabled={isExecuting}
              className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-[#3d3d3d] rounded transition-colors disabled:opacity-50"
              title="Execute code"
            >
              <Play className={`w-4 h-4 ${isExecuting ? 'animate-pulse' : ''}`} />
            </button>
          )}
          <button
            onClick={handleDownload}
            className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#3d3d3d] rounded transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handleCopy}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-[#3d3d3d] rounded transition-colors"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Code Content */}
      <div className="overflow-auto" style={{ maxHeight }}>
        <Highlight theme={themes.vsDark} code={code.trim()} language={prismLanguage}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={`${className} p-4 text-sm font-mono leading-relaxed m-0`}
              style={{ ...style, background: 'transparent' }}
            >
              {tokens.map((line, lineIndex) => {
                const lineProps = getLineProps({ line, key: lineIndex });
                return (
                  <div
                    key={lineIndex}
                    {...lineProps}
                    className={`${lineProps.className || ''} flex hover:bg-[#2a2a2a] -mx-4 px-4`}
                  >
                    {showLineNumbers && (
                      <span className="w-10 shrink-0 pr-4 text-right text-gray-500 select-none border-r border-[#3d3d3d] mr-4">
                        {lineIndex + 1}
                      </span>
                    )}
                    <span className="flex-1">
                      {line.map((token, tokenIndex) => {
                        const tokenProps = getTokenProps({ token, key: tokenIndex });
                        return <span key={tokenIndex} {...tokenProps} />;
                      })}
                    </span>
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}

function getExtension(language: string): string {
  const extensions: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    json: 'json',
    html: 'html',
    css: 'css',
    markdown: 'md',
    bash: 'sh',
    shell: 'sh',
    ruby: 'rb',
    go: 'go',
    rust: 'rs',
    java: 'java',
    csharp: 'cs',
    cpp: 'cpp',
    c: 'c',
    php: 'php',
    sql: 'sql',
    yaml: 'yaml',
    xml: 'xml',
  };
  return extensions[language.toLowerCase()] || 'txt';
}
