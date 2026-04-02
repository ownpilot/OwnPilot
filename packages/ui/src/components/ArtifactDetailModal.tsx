/**
 * ArtifactDetailModal
 *
 * Full-screen modal for viewing a single artifact in detail.
 * Provides larger preview area especially for HTML/SVG artifacts.
 */

import { useCallback, useState } from 'react';
import {
  X,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  Download,
  Code2,
  FileText,
  PenTool,
  FormInput,
  BarChart3,
  Component,
  ExternalLink,
} from './icons';
import { ArtifactRenderer } from './ArtifactRenderer';
import { useDialog } from './ConfirmDialog';
import { useToast } from './ToastProvider';
import type { Artifact, ArtifactType } from '../api/endpoints/artifacts';
import { artifactsApi } from '../api/endpoints/artifacts';

// =============================================================================
// Type Config
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

interface ArtifactDetailModalProps {
  artifact: Artifact;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onUpdate?: (artifact: Artifact) => void;
}

// =============================================================================
// Component
// =============================================================================

export function ArtifactDetailModal({
  artifact,
  onClose,
  onDelete,
  onUpdate,
}: ArtifactDetailModalProps) {
  const [currentArtifact, setCurrentArtifact] = useState(artifact);
  const [refreshing, setRefreshing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const { confirm } = useDialog();
  const toast = useToast();

  const cfg = TYPE_CONFIG[currentArtifact.type] ?? TYPE_CONFIG.html;
  const TypeIcon = cfg.icon;

  const handleTogglePin = useCallback(async () => {
    try {
      const updated = await artifactsApi.togglePin(currentArtifact.id);
      setCurrentArtifact(updated);
      onUpdate?.(updated);
      toast.success(updated.pinned ? 'Artifact pinned' : 'Artifact unpinned');
    } catch {
      // silent
    }
  }, [currentArtifact.id, onUpdate, toast]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const updated = await artifactsApi.refresh(currentArtifact.id);
      setCurrentArtifact(updated);
      onUpdate?.(updated);
      toast.success('Artifact refreshed');
    } catch {
      // silent
    } finally {
      setRefreshing(false);
    }
  }, [currentArtifact.id, refreshing, onUpdate, toast]);

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Delete Artifact?',
      message: `"${currentArtifact.title}" will be permanently deleted.`,
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (confirmed) {
      try {
        await artifactsApi.delete(currentArtifact.id);
        onDelete?.(currentArtifact.id);
        onClose();
        toast.success('Artifact deleted');
      } catch {
        // silent
      }
    }
  }, [currentArtifact.id, currentArtifact.title, confirm, onDelete, onClose, toast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([currentArtifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentArtifact.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${currentArtifact.type === 'markdown' ? 'md' : currentArtifact.type}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Artifact downloaded');
  }, [currentArtifact]);

  const handleOpenInNewTab = useCallback(() => {
    if (currentArtifact.type === 'html') {
      const blob = new Blob([currentArtifact.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } else if (currentArtifact.type === 'svg') {
      const blob = new Blob([currentArtifact.content], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } else {
      toast.info('Open in new tab only available for HTML and SVG artifacts');
    }
  }, [currentArtifact, toast]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-7xl h-full max-h-[90vh] bg-bg-primary dark:bg-dark-bg-primary rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-bg-tertiary dark:bg-dark-bg-tertiary"
          >
            <TypeIcon className={`w-5 h-5 ${cfg.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {currentArtifact.title}
            </h2>
            <div className="flex items-center gap-3 text-sm text-text-muted dark:text-dark-text-muted">
              <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
              <span>v{currentArtifact.version}</span>
              {currentArtifact.tags.length > 0 && (
                <span className="truncate">{currentArtifact.tags.join(', ')}</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Source toggle */}
            <button
              onClick={() => setShowSource(!showSource)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                showSource
                  ? 'bg-primary text-white'
                  : 'border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              {showSource ? 'Preview' : 'Source'}
            </button>

            {/* Open in new tab */}
            {(currentArtifact.type === 'html' || currentArtifact.type === 'svg') && (
              <button
                onClick={handleOpenInNewTab}
                className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="w-4 h-4 text-text-muted" />
              </button>
            )}

            {/* Refresh */}
            {currentArtifact.dataBindings.length > 0 && (
              <button
                onClick={handleRefresh}
                className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                title="Refresh data bindings"
              >
                <RefreshCw
                  className={`w-4 h-4 text-text-muted ${refreshing ? 'animate-spin' : ''}`}
                />
              </button>
            )}

            {/* Pin */}
            <button
              onClick={handleTogglePin}
              className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              title={currentArtifact.pinned ? 'Unpin from dashboard' : 'Pin to dashboard'}
            >
              {currentArtifact.pinned ? (
                <PinOff className="w-4 h-4 text-primary" />
              ) : (
                <Pin className="w-4 h-4 text-text-muted" />
              )}
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              title="Download artifact"
            >
              <Download className="w-4 h-4 text-text-muted" />
            </button>

            {/* Delete */}
            <button
              onClick={handleDelete}
              className="p-2 rounded-lg hover:bg-error/10 transition-colors"
              title="Delete artifact"
            >
              <Trash2 className="w-4 h-4 text-text-muted hover:text-error" />
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors ml-2"
              title="Close"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-bg-primary dark:bg-dark-bg-primary">
          {showSource ? (
            <pre className="w-full h-full p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg overflow-auto text-sm font-mono text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border">
              {currentArtifact.content}
            </pre>
          ) : (
            <div className="w-full min-h-full">
              <ArtifactRenderer
                type={currentArtifact.type}
                content={currentArtifact.content}
                dataBindings={currentArtifact.dataBindings}
                fullWidth
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-xs text-text-muted dark:text-dark-text-muted flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span>Created {new Date(currentArtifact.createdAt).toLocaleString()}</span>
            {currentArtifact.updatedAt !== currentArtifact.createdAt && (
              <span>Updated {new Date(currentArtifact.updatedAt).toLocaleString()}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span>{currentArtifact.content.length.toLocaleString()} characters</span>
            {currentArtifact.dataBindings.length > 0 && (
              <span>• {currentArtifact.dataBindings.length} data binding(s)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
