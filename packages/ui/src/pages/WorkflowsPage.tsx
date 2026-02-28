import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { workflowsApi } from '../api';
import type { Workflow, WorkflowLog } from '../api';
import {
  GitBranch,
  Plus,
  Trash2,
  Play,
  Clock,
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Copy,
  Upload,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';

const statusColors: Record<string, string> = {
  active: 'bg-success/10 text-success',
  inactive: 'bg-text-muted/10 text-text-muted',
};

const logStatusColors: Record<string, string> = {
  running: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  cancelled: 'bg-text-muted/10 text-text-muted',
};

const logStatusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  running: Activity,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: AlertCircle,
};

export function WorkflowsPage() {
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const toast = useToast();
  const { subscribe } = useGateway();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [recentLogs, setRecentLogs] = useState<WorkflowLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'workflows' | 'logs'>('workflows');

  const fetchWorkflows = useCallback(async () => {
    try {
      const data = await workflowsApi.list({ limit: '100' });
      setWorkflows(data.workflows);
    } catch {
      // API client handles errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchRecentLogs = useCallback(async () => {
    try {
      const data = await workflowsApi.recentLogs({ limit: '50' });
      setRecentLogs(data.logs);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
    fetchRecentLogs();
  }, [fetchWorkflows, fetchRecentLogs]);

  // Live refresh on data changes
  useEffect(() => {
    const unsub = subscribe('data:changed', (data: { entity: string }) => {
      if (data.entity === 'workflow') {
        fetchWorkflows();
        fetchRecentLogs();
      }
    });
    return unsub;
  }, [subscribe, fetchWorkflows, fetchRecentLogs]);

  const handleCreate = useCallback(async () => {
    try {
      const wf = await workflowsApi.create({
        name: 'Untitled Workflow',
        nodes: [],
        edges: [],
      });
      navigate(`/workflows/${wf.id}`);
    } catch {
      toast.error('Failed to create workflow');
    }
  }, [navigate, toast]);

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (
        !(await confirm({
          message: `Delete "${name}"? Execution logs will be preserved.`,
          variant: 'danger',
        }))
      )
        return;
      try {
        await workflowsApi.delete(id);
        toast.success('Workflow deleted');
        fetchWorkflows();
      } catch {
        // API client handles errors
      }
    },
    [confirm, toast, fetchWorkflows]
  );

  const handleToggleStatus = useCallback(
    async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
      try {
        await workflowsApi.update(id, { status: newStatus });
        toast.success(newStatus === 'active' ? 'Workflow activated' : 'Workflow deactivated');
        fetchWorkflows();
      } catch {
        // API client handles errors
      }
    },
    [toast, fetchWorkflows]
  );

  const handleClone = useCallback(
    async (id: string) => {
      try {
        const cloned = await workflowsApi.clone(id);
        toast.success('Workflow cloned');
        navigate(`/workflows/${cloned.id}`);
      } catch {
        toast.error('Failed to clone workflow');
      }
    },
    [toast, navigate]
  );

  const handleImportFile = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.workflow.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (!json || !Array.isArray(json.nodes) || !Array.isArray(json.edges)) {
          toast.error('Invalid workflow JSON: must contain "nodes" and "edges" arrays');
          return;
        }
        const wf = await workflowsApi.create({
          name: json.name || 'Imported Workflow',
          nodes: json.nodes,
          edges: json.edges,
          variables: json.variables ?? {},
        });
        toast.success('Workflow imported');
        navigate(`/workflows/${wf.id}`);
      } catch {
        toast.error('Failed to import workflow');
      }
    };
    input.click();
  }, [toast, navigate]);

  const handleExecute = useCallback(
    async (id: string) => {
      navigate(`/workflows/${id}?execute=true`);
    },
    [navigate]
  );

  const activeCount = workflows.filter((w) => w.status === 'active').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Workflows
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}, {activeCount} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportFile}
            className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Workflow
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex gap-0 px-6 border-b border-border dark:border-dark-border">
        <button
          onClick={() => setActiveTab('workflows')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'workflows'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
          }`}
        >
          Workflows
        </button>
        <button
          onClick={() => {
            setActiveTab('logs');
            fetchRecentLogs();
          }}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'logs'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Execution Logs
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {activeTab === 'workflows' ? (
          isLoading ? (
            <SkeletonCard count={4} />
          ) : workflows.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="No workflows yet"
              description="Create visual tool pipelines — drag tools onto a canvas, wire them together, and execute with real-time visualization."
              action={{ label: 'Create Workflow', onClick: handleCreate, icon: Plus }}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workflows.map((wf) => (
                <WorkflowCard
                  key={wf.id}
                  workflow={wf}
                  onEdit={() => navigate(`/workflows/${wf.id}`)}
                  onDelete={() => handleDelete(wf.id, wf.name)}
                  onToggle={() => handleToggleStatus(wf.id, wf.status)}
                  onExecute={() => handleExecute(wf.id)}
                  onClone={() => handleClone(wf.id)}
                />
              ))}
            </div>
          )
        ) : // Execution Logs tab
        recentLogs.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No execution logs"
            description="Workflow execution history will appear here."
          />
        ) : (
          <div className="space-y-2">
            {recentLogs.map((log) => (
              <LogEntry
                key={log.id}
                log={log}
                onNavigate={(wfId) => navigate(`/workflows/${wfId}`)}
                onViewLog={(logId) => navigate(`/workflows/logs/${logId}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Workflow Card
// ============================================================================

function WorkflowCard({
  workflow,
  onEdit,
  onDelete,
  onToggle,
  onExecute,
  onClone,
}: {
  workflow: Workflow;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onExecute: () => void;
  onClone: () => void;
}) {
  return (
    <div className="card-elevated card-hover bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg p-4 flex flex-col">
      {/* Top row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate">
            {workflow.name}
          </h3>
          {workflow.description && (
            <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mt-0.5">
              {workflow.description}
            </p>
          )}
        </div>
        <span
          className={`ml-2 px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${statusColors[workflow.status]}`}
        >
          {workflow.status}
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-text-muted dark:text-dark-text-muted mt-auto pt-3 border-t border-border dark:border-dark-border">
        <span className="flex items-center gap-1">
          <GitBranch className="w-3.5 h-3.5" />
          {workflow.nodes.length} node{workflow.nodes.length !== 1 ? 's' : ''}
        </span>
        {workflow.runCount > 0 && (
          <span className="flex items-center gap-1">
            <Play className="w-3.5 h-3.5" />
            {workflow.runCount} run{workflow.runCount !== 1 ? 's' : ''}
          </span>
        )}
        {workflow.lastRun && (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {new Date(workflow.lastRun).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 mt-3 pt-2 border-t border-border dark:border-dark-border">
        <button
          onClick={onExecute}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors"
          title="Execute workflow"
        >
          <Play className="w-3.5 h-3.5" />
          Run
        </button>
        <button
          onClick={onToggle}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            workflow.status === 'active'
              ? 'text-warning hover:bg-warning/10'
              : 'text-success hover:bg-success/10'
          }`}
          title={workflow.status === 'active' ? 'Deactivate' : 'Activate'}
        >
          {workflow.status === 'active' ? 'Deactivate' : 'Activate'}
        </button>
        <div className="flex-1" />
        <button
          onClick={onClone}
          className="p-1.5 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          title="Clone workflow"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
          title="Delete workflow"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Log Entry
// ============================================================================

function LogEntry({
  log,
  onNavigate,
  onViewLog,
}: {
  log: WorkflowLog;
  onNavigate: (id: string) => void;
  onViewLog: (logId: string) => void;
}) {
  const StatusIcon = logStatusIcons[log.status] || Activity;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => onViewLog(log.id)}
    >
      <StatusIcon className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span
          className={`font-medium text-sm text-text-primary dark:text-dark-text-primary ${log.workflowId ? 'cursor-pointer hover:text-primary' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            log.workflowId && onNavigate(log.workflowId);
          }}
        >
          {log.workflowName ?? 'Deleted Workflow'}
        </span>
        {log.error && <p className="text-xs text-error truncate mt-0.5">{log.error}</p>}
      </div>
      <span
        className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${logStatusColors[log.status]}`}
      >
        {log.status}
      </span>
      {log.durationMs != null && (
        <span className="text-xs text-text-muted dark:text-dark-text-muted whitespace-nowrap">
          {log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
      <span className="text-xs text-text-muted dark:text-dark-text-muted whitespace-nowrap">
        {new Date(log.startedAt).toLocaleString()}
      </span>
    </div>
  );
}
