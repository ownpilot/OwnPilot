import { X, CheckCircle2, AlertCircle, Save, Trash2, Plus, Star } from './icons';
import { DynamicConfigForm } from './DynamicConfigForm';
import type { ConfigEntryView, ConfigServiceView } from '../api';

// ---------------------------------------------------------------------------
// Constants (duplicated from ConfigCenterPage to keep modal self-contained)
// ---------------------------------------------------------------------------

const CATEGORY_PALETTE = [
  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getCategoryColor(category: string): string {
  return CATEGORY_PALETTE[hashString(category) % CATEGORY_PALETTE.length]!;
}

// ---------------------------------------------------------------------------
// ConfigureServiceModal
// ---------------------------------------------------------------------------

export interface ConfigureServiceModalProps {
  service: ConfigServiceView;
  activeEntryId: string | null;
  entryFormValues: Record<string, unknown>;
  entryLabel: string;
  entryIsActive: boolean;
  isSaving: boolean;
  saveMessage: { type: 'success' | 'error'; text: string } | null;
  onEntrySelect: (entry: ConfigEntryView) => void;
  onNewEntry: () => void;
  onFormChange: (values: Record<string, unknown>) => void;
  onLabelChange: (label: string) => void;
  onActiveChange: (active: boolean) => void;
  onSave: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onClose: () => void;
}

export function ConfigureServiceModal({
  service,
  activeEntryId,
  entryFormValues,
  entryLabel,
  entryIsActive,
  isSaving,
  saveMessage,
  onEntrySelect,
  onNewEntry,
  onFormChange,
  onLabelChange,
  onActiveChange,
  onSave,
  onDelete,
  onSetDefault,
  onClose,
}: ConfigureServiceModalProps) {
  const isCreating = activeEntryId === null;
  const activeEntry = isCreating
    ? null
    : (service.entries.find((e) => e.id === activeEntryId) ?? null);
  const canDelete = !isCreating && service.entries.length > 1;
  const isDefault = activeEntry?.isDefault ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-lg border border-border dark:border-dark-border max-h-[90vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-start justify-between p-6 border-b border-border dark:border-dark-border">
          <div className="flex-1 min-w-0 mr-4">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {service.displayName}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`px-2 py-0.5 text-xs rounded-full ${getCategoryColor(service.category)}`}
              >
                {service.category}
              </span>
              {service.docsUrl && (
                <a
                  href={service.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Documentation
                </a>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Required by info */}
          {service.requiredBy?.length > 0 && (
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <p className="text-xs font-medium text-primary mb-1.5">Used by</p>
              <div className="flex flex-wrap gap-1.5">
                {service.requiredBy.map((dep) => (
                  <span
                    key={dep.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary"
                  >
                    {dep.type === 'tool' ? 'Tool' : 'Plugin'}: {dep.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Entry tabs (multi-entry services) */}
          {service.multiEntry && (
            <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-border dark:border-dark-border">
              {service.entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onEntrySelect(entry)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-lg whitespace-nowrap transition-colors ${
                    activeEntryId === entry.id
                      ? 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary font-medium border border-border dark:border-dark-border border-b-transparent -mb-px'
                      : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50'
                  }`}
                >
                  {entry.isDefault && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                  {entry.label || 'Untitled'}
                </button>
              ))}
              <button
                onClick={onNewEntry}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-t-lg whitespace-nowrap transition-colors ${
                  isCreating
                    ? 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-primary font-medium border border-border dark:border-dark-border border-b-transparent -mb-px'
                    : 'text-text-muted dark:text-dark-text-muted hover:text-primary'
                }`}
                title="Add new entry"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          )}

          {/* Label input (multi-entry only) */}
          {service.multiEntry && (
            <div>
              <label
                htmlFor="entry-label-input"
                className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5"
              >
                Entry Label
              </label>
              <input
                id="entry-label-input"
                type="text"
                value={entryLabel}
                onChange={(e) => onLabelChange(e.target.value)}
                placeholder="e.g. Personal, Work, Backup..."
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {/* Dynamic config form */}
          <DynamicConfigForm
            schema={service.configSchema}
            values={entryFormValues}
            onChange={onFormChange}
            disabled={isSaving}
          />

          {/* Active toggle */}
          <div className="flex items-center justify-between p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
            <div>
              <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                Entry Active
              </p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                When disabled, this entry will not be used by tools.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={entryIsActive}
              onClick={() => onActiveChange(!entryIsActive)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                entryIsActive
                  ? 'bg-success'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  entryIsActive ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Multi-entry actions: Set default / Delete */}
          {service.multiEntry && !isCreating && (
            <div className="flex items-center gap-2">
              {!isDefault && (
                <button
                  onClick={onSetDefault}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 rounded-lg hover:bg-yellow-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Star className="w-3.5 h-3.5" />
                  Set as Default
                </button>
              )}
              {canDelete && (
                <button
                  onClick={onDelete}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-error bg-error/10 border border-error/20 rounded-lg hover:bg-error/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Entry
                </button>
              )}
            </div>
          )}

          {/* Save message */}
          {saveMessage && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                saveMessage.type === 'success'
                  ? 'bg-success/10 text-success'
                  : 'bg-error/10 text-error'
              }`}
            >
              {saveMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              {saveMessage.text}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-between p-4 border-t border-border dark:border-dark-border">
          <div>
            {/* Single-entry delete: only when there is exactly one entry and the service is not multi-entry */}
            {!service.multiEntry && !isCreating && (
              <button
                onClick={onDelete}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-error bg-error/10 hover:bg-error/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : isCreating ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
