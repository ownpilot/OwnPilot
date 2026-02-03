import { Wrench } from '../../components/icons';
import type { ToolItem } from './types';

interface ToolCardProps {
  tool: ToolItem;
  onClick: () => void;
}

export function ToolCard({ tool, onClick }: ToolCardProps) {
  return (
    <button
      onClick={onClick}
      className="card-elevated p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-left hover:border-primary transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Wrench className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">
            {tool.name}
          </h4>
          <p className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-2 mt-0.5">
            {tool.description}
          </p>
        </div>
      </div>
    </button>
  );
}
