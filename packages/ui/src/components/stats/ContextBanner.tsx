import { useState } from 'react';
import {
  FolderOpen,
  Terminal,
  Bot,
  Layers,
  Brain,
  Wrench,
  Settings,
  Activity,
} from '../icons';
import { usePageContext } from '../../hooks/usePageContext';

const CONTEXT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  workspace: FolderOpen,
  'coding-agent': Terminal,
  claw: Bot,
  workflow: Layers,
  workflows: Layers,
  agent: Brain,
  agents: Brain,
  tools: Wrench,
  settings: Settings,
};

export function ContextBanner() {
  const { context, isLoading: ctxLoading } = usePageContext();
  const [expanded, setExpanded] = useState(false);

  if (ctxLoading || !context.type) return null;

  const Icon = CONTEXT_ICONS[context.type] ?? Activity;
  const label = context.name || context.type;
  const detail = context.path;

  return (
    <button
      data-testid="context-banner"
      onClick={() => setExpanded((v) => !v)}
      className="w-full flex items-center gap-2 px-3 py-1.5 bg-primary/5 border-b border-primary/10 text-xs text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 transition-colors text-left"
    >
      <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="font-medium truncate">{label}</span>
      {detail && !expanded && (
        <span className="text-text-muted dark:text-dark-text-muted truncate ml-auto">
          {detail.length > 25 ? '...' + detail.slice(-25) : detail}
        </span>
      )}
      {detail && expanded && (
        <span className="text-text-muted dark:text-dark-text-muted break-all ml-auto">
          {detail}
        </span>
      )}
    </button>
  );
}
