import { useState, useEffect, useCallback } from 'react';
import { settingsApi } from '../api';
import type { ToolGroupInfo } from '../api';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ChevronDown, ChevronRight, Lock, Wrench } from '../components/icons';

// =============================================================================
// Tool Group Card
// =============================================================================

function ToolGroupCard({
  group,
  onToggle,
}: {
  group: ToolGroupInfo;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border ${group.enabled ? 'border-border bg-card' : 'border-border/50 bg-card/50 opacity-75'}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* Group info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-text-primary">{group.name}</span>
            <span className="text-xs text-text-muted">({group.toolCount} tools)</span>
            {group.alwaysOn && (
              <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                <Lock className="w-3 h-3" />
                Always on
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5 truncate">{group.description}</p>
        </div>

        {/* Toggle */}
        <button
          onClick={() => onToggle(group.id, !group.enabled)}
          disabled={group.alwaysOn}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
            group.alwaysOn
              ? 'cursor-not-allowed bg-primary/60'
              : group.enabled
                ? 'cursor-pointer bg-primary'
                : 'cursor-pointer bg-border'
          }`}
          aria-label={`${group.enabled ? 'Disable' : 'Enable'} ${group.name}`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
              group.enabled ? 'translate-x-4' : 'translate-x-0.5'
            } mt-0.5`}
          />
        </button>
      </div>

      {/* Expanded tool list */}
      {expanded && (
        <div className="px-4 pb-3 pt-0 border-t border-border/50">
          <div className="flex flex-wrap gap-1.5 mt-2">
            {group.tools.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-bg-secondary text-text-muted font-mono"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function ToolGroupsPage() {
  const toast = useToast();
  const [groups, setGroups] = useState<ToolGroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getToolGroups();
      setGroups(data.groups);
      setDirty(false);
    } catch (err) {
      toast.error('Failed to load tool groups');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, enabled } : g)));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      const enabledIds = groups.filter((g) => g.enabled).map((g) => g.id);
      await settingsApi.saveToolGroups(enabledIds);
      setDirty(false);
      toast.success('Tool groups saved');
    } catch (err) {
      toast.error('Failed to save tool groups');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [groups, toast]);

  const handleReset = useCallback(() => {
    setGroups((prev) => prev.map((g) => ({ ...g, enabled: g.defaultEnabled || g.alwaysOn })));
    setDirty(true);
  }, []);

  const enabledCount = groups.filter((g) => g.enabled).length;
  const totalTools = groups.filter((g) => g.enabled).reduce((sum, g) => sum + g.toolCount, 0);

  // Separate always-on and toggleable
  const alwaysOnGroups = groups.filter((g) => g.alwaysOn);
  const toggleableGroups = groups.filter((g) => !g.alwaysOn);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Tool Groups
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {enabledCount} groups enabled ({totalTools} tools available)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
          >
            Reset defaults
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
              dirty
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-border text-text-muted cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Always-on groups */}
      {alwaysOnGroups.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-text-muted mb-2 uppercase tracking-wide">
            Always Enabled
          </h2>
          <div className="space-y-2">
            {alwaysOnGroups.map((group) => (
              <ToolGroupCard key={group.id} group={group} onToggle={handleToggle} />
            ))}
          </div>
        </div>
      )}

      {/* Toggleable groups */}
      {toggleableGroups.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-muted mb-2 uppercase tracking-wide">
            Optional
          </h2>
          <div className="space-y-2">
            {toggleableGroups.map((group) => (
              <ToolGroupCard key={group.id} group={group} onToggle={handleToggle} />
            ))}
          </div>
        </div>
      )}

      {dirty && (
        <p className="text-xs text-warning mt-4">You have unsaved changes. Click Save to apply.</p>
      )}
    </div>
  );
}
