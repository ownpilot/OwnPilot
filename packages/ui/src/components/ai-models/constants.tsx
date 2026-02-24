import {
  Check,
  Settings,
  Cpu,
  Eye,
  Image,
  Code,
  MessageSquare,
  Zap,
  Volume2,
  RefreshCw,
  Brain,
  Edit,
  Power,
} from '../icons';
import type { ModelCapability, MergedModel } from '../../api';

// ============================================================================
// Constants
// ============================================================================

export const CAPABILITY_ICONS: Record<ModelCapability, React.ReactNode> = {
  chat: <MessageSquare className="w-3.5 h-3.5" />,
  code: <Code className="w-3.5 h-3.5" />,
  vision: <Eye className="w-3.5 h-3.5" />,
  function_calling: <Settings className="w-3.5 h-3.5" />,
  json_mode: <Cpu className="w-3.5 h-3.5" />,
  streaming: <RefreshCw className="w-3.5 h-3.5" />,
  embeddings: <Zap className="w-3.5 h-3.5" />,
  image_generation: <Image className="w-3.5 h-3.5" />,
  audio: <Volume2 className="w-3.5 h-3.5" />,
  reasoning: <Brain className="w-3.5 h-3.5" />,
};

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  chat: 'Chat',
  code: 'Code',
  vision: 'Vision',
  function_calling: 'Tools',
  json_mode: 'JSON',
  streaming: 'Stream',
  embeddings: 'Embed',
  image_generation: 'Image',
  audio: 'Audio',
  reasoning: 'Think',
};

export const SOURCE_COLORS: Record<string, string> = {
  builtin: 'bg-primary/10 text-primary',
  aggregator: 'bg-purple-500/10 text-purple-500',
  custom: 'bg-warning/10 text-warning',
  local: 'bg-success/10 text-success',
};

// ============================================================================
// Helper Components
// ============================================================================

export function CapabilityBadge({ capability }: { capability: ModelCapability }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary"
      title={capability}
    >
      {CAPABILITY_ICONS[capability]}
      {CAPABILITY_LABELS[capability]}
    </span>
  );
}

export function PricingDisplay({
  pricingInput,
  pricingOutput,
  pricingPerRequest,
}: {
  pricingInput?: number;
  pricingOutput?: number;
  pricingPerRequest?: number;
}) {
  if (pricingPerRequest !== undefined) {
    return (
      <span className="text-xs text-text-muted dark:text-dark-text-muted">
        ${pricingPerRequest.toFixed(3)}/req
      </span>
    );
  }

  if (pricingInput !== undefined || pricingOutput !== undefined) {
    return (
      <span className="text-xs text-text-muted dark:text-dark-text-muted">
        ${pricingInput?.toFixed(2) || '?'}/${pricingOutput?.toFixed(2) || '?'} /1M
      </span>
    );
  }

  return null;
}

export function ModelCard({
  model,
  onToggle,
  onEdit,
  isToggling,
}: {
  model: MergedModel;
  onToggle: (model: MergedModel, enabled: boolean) => void;
  onEdit: (model: MergedModel) => void;
  isToggling: boolean;
}) {
  return (
    <div
      className={`card-elevated card-hover p-4 rounded-lg border transition-all ${
        model.isEnabled && model.isConfigured
          ? 'border-success/30 bg-bg-primary dark:bg-dark-bg-primary'
          : model.isEnabled
            ? 'border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary'
            : 'border-border/50 dark:border-dark-border/50 bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {model.isConfigured && (
              <span title="API key configured">
                <Check className="w-4 h-4 text-success shrink-0" />
              </span>
            )}
            <h4
              className="font-medium text-text-primary dark:text-dark-text-primary truncate"
              title={model.modelId}
            >
              {model.displayName}
            </h4>
            <span className={`px-1.5 py-0.5 text-xs rounded ${SOURCE_COLORS[model.source]}`}>
              {model.source}
            </span>
            {model.hasOverride && !model.isCustom && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-warning/10 text-warning">
                modified
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-2">
            {model.providerName} &bull; {model.modelId}
          </p>

          {/* Capabilities */}
          <div className="flex flex-wrap gap-1 mb-2">
            {model.capabilities.slice(0, 6).map((cap) => (
              <CapabilityBadge key={cap} capability={cap} />
            ))}
            {model.capabilities.length > 6 && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted">
                +{model.capabilities.length - 6}
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs text-text-muted dark:text-dark-text-muted">
            {model.contextWindow && <span>{(model.contextWindow / 1000).toFixed(0)}K ctx</span>}
            {model.maxOutput && <span>{(model.maxOutput / 1000).toFixed(0)}K out</span>}
            <PricingDisplay
              pricingInput={model.pricingInput}
              pricingOutput={model.pricingOutput}
              pricingPerRequest={model.pricingPerRequest}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(model)}
            className="p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
            title="Edit"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => onToggle(model, !model.isEnabled)}
            disabled={isToggling}
            className={`p-1.5 rounded transition-colors ${
              model.isEnabled
                ? 'hover:bg-error/10 text-success hover:text-error'
                : 'hover:bg-success/10 text-text-muted hover:text-success'
            } disabled:opacity-50`}
            title={model.isEnabled ? 'Disable' : 'Enable'}
          >
            <Power className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
