import { useState } from 'react';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { Copy } from '../../../components/icons';

export function ConfigTab({ claw }: { claw: ClawConfig }) {
  const [copied, setCopied] = useState(false);
  const config = JSON.stringify(claw, null, 2);
  const copy = () => {
    navigator.clipboard.writeText(config).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          Full claw configuration as JSON.
        </p>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono bg-[#0d0d0d] text-gray-300 rounded-lg overflow-auto max-h-[500px] whitespace-pre-wrap leading-relaxed border border-border dark:border-dark-border">
        {config}
      </pre>
    </div>
  );
}
