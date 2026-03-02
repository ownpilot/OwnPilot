/**
 * ArtifactCard
 *
 * Card wrapper for artifacts with header, type badge, version, and action buttons.
 * Supports compact mode (inline chat) and full mode (page/dashboard).
 */

import { useState, useCallback } from 'react';
import {
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  History,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  PenTool,
  FormInput,
  BarChart3,
  Component,
} from './icons';
import { ArtifactRenderer } from './ArtifactRenderer';
import { useDialog } from './ConfirmDialog';
import type { Artifact, ArtifactType } from '../api/endpoints/artifacts';
import { artifactsApi } from '../api/endpoints/artifacts';

// =============================================================================
// Helpers
// =============================================================================

const TYPE_CONFIG: Record<ArtifactType, { icon: typeof Code2; label: string; color: string }> = {
  html: { icon: Code2, label: 'HTML', color: 'text-blue-500' },
  svg: { icon: PenTool, label: 'SVG', color: 'text-purple-500' },
  markdown: { icon: FileText, label: 'Markdown', color: 'text-green-500' },
  form: { icon: FormInput, label: 'Form', color: 'text-orange-500' },
  chart: { icon: BarChart3, label: 'Chart', color: 'text-cyan-500' },
  react: { icon: Component, label: 'React', color: 'text-sky-500' },
};

// =============================================================================
// Props
// =============================================================================

interface ArtifactCardProps {
  artifact: Artifact;
  compact?: boolean;
  onDelete?: (id: string) => void;
  onUpdate?: (artifact: Artifact) => void;
  onVersions?: (id: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function ArtifactCard({
  artifact,
  compact = false,
  onDelete,
  onUpdate,
  onVersions,
}: ArtifactCardProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [refreshing, setRefreshing] = useState(false);
  const { confirm } = useDialog();

  const cfg = TYPE_CONFIG[artifact.type] ?? TYPE_CONFIG.html;
  const TypeIcon = cfg.icon;

  const handleTogglePin = useCallback(async () => {
    try {
      const updated = await artifactsApi.togglePin(artifact.id);
      onUpdate?.(updated);
    } catch {
      // silent
    }
  }, [artifact.id, onUpdate]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const updated = await artifactsApi.refresh(artifact.id);
      onUpdate?.(updated);
    } catch {
      // silent
    } finally {
      setRefreshing(false);
    }
  }, [artifact.id, refreshing, onUpdate]);

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Delete Artifact?',
      message: `"${artifact.title}" will be permanently deleted.`,
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (confirmed) {
      try {
        await artifactsApi.delete(artifact.id);
        onDelete?.(artifact.id);
      } catch {
        // silent
      }
    }
  }, [artifact.id, artifact.title, confirm, onDelete]);

  // ---- Compact mode (chat inline) ----
  if (compact) {
    return (
      <div className="rounded-lg border border-border dark:border-dark-border bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 overflow-hidden text-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
        >
          <TypeIcon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
          <span className="font-medium text-text-secondary dark:text-dark-text-secondary truncate flex-1 text-left">
            {artifact.title}
          </span>
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            v{artifact.version}
          </span>
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-text-muted" />
          ) : (
            <ChevronRight className="w-3 h-3 text-text-muted" />
          )}
        </button>
        {expanded && (
          <div className="border-t border-border dark:border-dark-border p-3">
            <ArtifactRenderer
              type={artifact.type}
              content={artifact.content}
              dataBindings={artifact.dataBindings}
            />
          </div>
        )}
      </div>
    );
  }

  // ---- Full mode (page / dashboard) ----
  return (
    <div className="card-elevated bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border dark:border-dark-border">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center bg-bg-tertiary dark:bg-dark-bg-tertiary`}
        >
          <TypeIcon className={`w-4 h-4 ${cfg.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
            {artifact.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
            <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
            <span>v{artifact.version}</span>
            {artifact.tags.length > 0 && (
              <span className="truncate">{artifact.tags.join(', ')}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {artifact.dataBindings.length > 0 && (
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              title="Refresh data bindings"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-text-muted ${refreshing ? 'animate-spin' : ''}`}
              />
            </button>
          )}
          <button
            onClick={handleTogglePin}
            className="p-1.5 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            title={artifact.pinned ? 'Unpin from dashboard' : 'Pin to dashboard'}
          >
            {artifact.pinned ? (
              <PinOff className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Pin className="w-3.5 h-3.5 text-text-muted" />
            )}
          </button>
          {onVersions && (
            <button
              onClick={() => onVersions(artifact.id)}
              className="p-1.5 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              title="Version history"
            >
              <History className="w-3.5 h-3.5 text-text-muted" />
            </button>
          )}
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-error/10 transition-colors"
            title="Delete artifact"
          >
            <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-error" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <ArtifactRenderer
          type={artifact.type}
          content={artifact.content}
          dataBindings={artifact.dataBindings}
        />
      </div>
    </div>
  );
}
