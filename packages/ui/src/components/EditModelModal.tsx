import { useState } from 'react';
import {
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
} from './icons';
import type { ModelCapability, MergedModel, CapabilityDef } from '../api';

// ============================================================================
// Constants
// ============================================================================

const CAPABILITY_ICONS: Record<ModelCapability, React.ReactNode> = {
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

// ============================================================================
// Types
// ============================================================================

export interface EditModelModalProps {
  model: MergedModel;
  capabilities: CapabilityDef[];
  onSave: (model: MergedModel, updates: Record<string, unknown>) => void;
  onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function EditModelModal({
  model,
  capabilities,
  onSave,
  onClose,
}: EditModelModalProps) {
  const [displayName, setDisplayName] = useState(model.displayName);
  const [selectedCaps, setSelectedCaps] = useState<Set<ModelCapability>>(
    new Set(model.capabilities)
  );
  const [pricingInput, setPricingInput] = useState(model.pricingInput?.toString() || '');
  const [pricingOutput, setPricingOutput] = useState(model.pricingOutput?.toString() || '');
  const [contextWindow, setContextWindow] = useState(model.contextWindow?.toString() || '');
  const [maxOutput, setMaxOutput] = useState(model.maxOutput?.toString() || '');
  const [isEnabled, setIsEnabled] = useState(model.isEnabled);
  const [isSaving, setIsSaving] = useState(false);

  const toggleCapability = (cap: ModelCapability) => {
    setSelectedCaps((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
      } else {
        next.add(cap);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(model, {
      displayName: displayName || undefined,
      capabilities: Array.from(selectedCaps),
      pricingInput: pricingInput ? parseFloat(pricingInput) : undefined,
      pricingOutput: pricingOutput ? parseFloat(pricingOutput) : undefined,
      contextWindow: contextWindow ? parseInt(contextWindow) : undefined,
      maxOutput: maxOutput ? parseInt(maxOutput) : undefined,
      isEnabled,
    });
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Edit Model
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {model.providerName} / {model.modelId}
          </p>
        </div>

        <div className="p-6 space-y-4">
          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={model.modelId}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Capabilities */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Capabilities
            </label>
            <div className="flex flex-wrap gap-2">
              {capabilities.map((cap) => (
                <button
                  key={cap.id}
                  onClick={() => toggleCapability(cap.id)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                    selectedCaps.has(cap.id)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary'
                  }`}
                  title={cap.description}
                >
                  {CAPABILITY_ICONS[cap.id]}
                  {cap.name}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Input Price ($/1M)
              </label>
              <input
                type="number"
                step="0.01"
                value={pricingInput}
                onChange={(e) => setPricingInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Output Price ($/1M)
              </label>
              <input
                type="number"
                step="0.01"
                value={pricingOutput}
                onChange={(e) => setPricingOutput(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Limits */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Context Window
              </label>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="128000"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Max Output
              </label>
              <input
                type="number"
                value={maxOutput}
                onChange={(e) => setMaxOutput(e.target.value)}
                placeholder="16384"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium text-text-primary dark:text-dark-text-primary">Enabled</p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Model is available for use
              </p>
            </div>
            <button
              onClick={() => setIsEnabled(!isEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                isEnabled ? 'bg-success' : 'bg-bg-tertiary dark:bg-dark-bg-tertiary'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  isEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="p-6 border-t border-border dark:border-dark-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
