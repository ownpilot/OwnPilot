import { useState, useEffect } from 'react';
import { CodeBlock } from '../../../components/CodeBlock';
import type { ToolItem } from '../types';
import { toolsApi } from '../../../api';

interface CodeTabProps {
  tool: ToolItem;
}

export function CodeTab({ tool }: CodeTabProps) {
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchSource = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await toolsApi.source(tool.name);
        if (cancelled) return;
        if (data.source) {
          setSourceCode(data.source);
        } else {
          setError('Source code not available for this tool.');
        }
      } catch {
        if (!cancelled) setError('Failed to load source code.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSource();
    return () => { cancelled = true; };
  }, [tool.name]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-text-muted dark:text-dark-text-muted">Loading source code...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!sourceCode) return null;

  // Detect if source is TypeScript (has type annotations like `: string`, `Promise<`, etc.)
  const isTypeScript = /:\s*(string|number|boolean|void|Promise|Record|Array)\b/.test(sourceCode);
  const lang = isTypeScript ? 'typescript' : 'javascript';
  const ext = isTypeScript ? 'ts' : 'js';

  return (
    <CodeBlock
      code={sourceCode}
      language={lang}
      filename={`${tool.name}.${ext}`}
      showLineNumbers={true}
      maxHeight="500px"
    />
  );
}
