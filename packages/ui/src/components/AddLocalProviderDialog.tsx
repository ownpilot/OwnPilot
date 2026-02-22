import { useState } from 'react';
import { Plus, Server, X } from './icons';
import type { LocalProviderTemplate } from '../api';

// ============================================================================
// Types
// ============================================================================

export interface AddLocalProviderDialogProps {
  templates: LocalProviderTemplate[];
  onAdd: (template: LocalProviderTemplate, customUrl?: string, customApiKey?: string) => void;
  onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function AddLocalProviderDialog({ templates, onAdd, onClose }: AddLocalProviderDialogProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<LocalProviderTemplate | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');

  const handleSelect = (template: LocalProviderTemplate) => {
    setSelectedTemplate(template);
    setCustomUrl(template.baseUrl);
    setCustomApiKey('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border dark:border-dark-border flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Add Local AI Provider
            </h3>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Select a provider template or add a custom one
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Template selection */}
          {!selectedTemplate ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t)}
                  className="p-4 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary hover:border-success transition-colors text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Server className="w-4 h-4 text-success" />
                    <h5 className="font-medium text-text-primary dark:text-dark-text-primary">
                      {t.name}
                    </h5>
                  </div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2">
                    {t.description}
                  </p>
                  <code className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted font-mono">
                    {t.baseUrl}
                  </code>
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* Selected template config */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-success/5 border border-success/30">
                <Server className="w-4 h-4 text-success" />
                <span className="font-medium text-text-primary dark:text-dark-text-primary">
                  {selectedTemplate.name}
                </span>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="ml-auto text-xs text-text-muted hover:text-text-primary"
                >
                  Change
                </button>
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder={selectedTemplate.baseUrl}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-success/50"
                />
              </div>

              {/* API Key (optional) */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  API Key <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  type="password"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="Leave empty if not required"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-success/50"
                />
              </div>
            </>
          )}
        </div>

        {selectedTemplate && (
          <div className="p-6 border-t border-border dark:border-dark-border flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onAdd(selectedTemplate, customUrl, customApiKey)}
              className="px-4 py-2 text-sm bg-success text-white rounded-lg hover:bg-success/90 transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add & Discover
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
