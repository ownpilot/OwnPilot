import { useState, useEffect } from 'react';
import { Wrench, Plus, Check, X, Trash, Play, Code } from '../components/icons';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/ToastProvider';
import { useDebouncedValue } from '../hooks';
import { customToolsApi } from '../api';
import type { CustomTool, ToolStats, ToolStatus, ToolPermission } from '../types';


const STATUS_COLORS: Record<ToolStatus, string> = {
  active: 'bg-green-500/10 text-green-600 dark:text-green-400',
  disabled: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  pending_approval: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  rejected: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

const STATUS_LABELS: Record<ToolStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  pending_approval: 'Pending Approval',
  rejected: 'Rejected',
};

const PERMISSION_LABELS: Record<ToolPermission, string> = {
  network: 'Network',
  filesystem: 'File System',
  database: 'Database',
  shell: 'Shell',
  email: 'Email',
  scheduling: 'Scheduling',
};

export function CustomToolsPage() {
  const toast = useToast();
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [stats, setStats] = useState<ToolStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<CustomTool | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | ToolStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    fetchTools();
    fetchStats();
  }, [filter]);

  const fetchTools = async () => {
    try {
      const { tools } = await customToolsApi.list(filter === 'all' ? undefined : filter);
      setTools(tools);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const data = await customToolsApi.stats();
      setStats(data);
    } catch {
      // API client handles error reporting
    }
  };

  const handleAction = async (toolId: string, action: 'enable' | 'disable' | 'approve' | 'reject' | 'delete') => {
    try {
      if (action === 'delete') {
        await customToolsApi.delete(toolId);
      } else {
        await customToolsApi.action(toolId, action);
      }
      const labels: Record<string, string> = { enable: 'Tool enabled', disable: 'Tool disabled', approve: 'Tool approved', reject: 'Tool rejected', delete: 'Tool deleted' };
      toast.success(labels[action]!);
      fetchTools();
      fetchStats();
      if (selectedTool?.id === toolId) {
        setSelectedTool(null);
      }
    } catch {
      // API client handles error reporting
    }
  };

  const filteredTools = tools.filter(tool => {
    if (!debouncedSearch) return true;
    const query = debouncedSearch.toLowerCase();
    return (
      tool.name.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query) ||
      (tool.category?.toLowerCase().includes(query) ?? false)
    );
  });

  const pendingCount = stats?.pendingApproval ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
            Custom Tools
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">
                {pendingCount} pending
              </span>
            )}
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {stats ? `${stats.total} tools (${stats.createdByLLM} by AI, ${stats.createdByUser} by user)` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 w-48"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Tool
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      {stats && (
        <div className="px-6 py-3 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-text-muted dark:text-dark-text-muted">Active: {stats.active}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-500"></span>
              <span className="text-text-muted dark:text-dark-text-muted">Disabled: {stats.disabled}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
              <span className="text-text-muted dark:text-dark-text-muted">Pending: {stats.pendingApproval}</span>
            </div>
            <div className="ml-auto text-text-muted dark:text-dark-text-muted">
              Total Usage: {stats.totalUsage}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading custom tools..." />
        ) : filteredTools.length === 0 ? (
          <EmptyState
            icon={Code}
            title={searchQuery ? 'No tools match your search' : 'No custom tools yet'}
            description={searchQuery ? 'Try a different search term.' : 'Create your first custom tool or let the AI create one for you.'}
            action={!searchQuery ? { label: 'Create Tool', onClick: () => setIsCreateModalOpen(true), icon: Plus } : undefined}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                onClick={() => setSelectedTool(tool)}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tool Detail Modal */}
      {selectedTool && (
        <ToolDetailModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
          onAction={handleAction}
          onRefresh={fetchTools}
        />
      )}

      {/* Create Tool Modal */}
      {isCreateModalOpen && (
        <CreateToolModal
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={() => {
            setIsCreateModalOpen(false);
            fetchTools();
            fetchStats();
          }}
        />
      )}
    </div>
  );
}

interface ToolCardProps {
  tool: CustomTool;
  onClick: () => void;
  onAction: (id: string, action: 'enable' | 'disable' | 'approve' | 'reject' | 'delete') => void;
}

function ToolCard({ tool, onClick, onAction }: ToolCardProps) {
  return (
    <div
      className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl hover:border-primary/50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h4 className="font-medium text-text-primary dark:text-dark-text-primary">
              {tool.name}
            </h4>
            <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[tool.status]}`}>
              {STATUS_LABELS[tool.status]}
            </span>
          </div>
        </div>
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          v{tool.version}
        </span>
      </div>

      <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mb-3">
        {tool.description}
      </p>

      <div className="flex items-center justify-between text-xs text-text-muted dark:text-dark-text-muted">
        <div className="flex items-center gap-2">
          <span className={tool.createdBy === 'llm' ? 'text-purple-500' : 'text-blue-500'}>
            {tool.createdBy === 'llm' ? 'AI Created' : 'User Created'}
          </span>
          {tool.category && (
            <>
              <span>|</span>
              <span>{tool.category}</span>
            </>
          )}
        </div>
        <span>{tool.usageCount} uses</span>
      </div>

      {/* Quick Actions */}
      {tool.status === 'pending_approval' && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border dark:border-dark-border">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAction(tool.id, 'approve');
            }}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-green-500/10 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-500/20 transition-colors text-sm"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAction(tool.id, 'reject');
            }}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-500/20 transition-colors text-sm"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

interface ToolDetailModalProps {
  tool: CustomTool;
  onClose: () => void;
  onAction: (id: string, action: 'enable' | 'disable' | 'approve' | 'reject' | 'delete') => void;
  onRefresh: () => void;
}

function ToolDetailModal({ tool, onClose, onAction, onRefresh }: ToolDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'code' | 'test'>('details');
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(testInput);
      } catch {
        setTestResult('Error: Invalid JSON input');
        setIsTesting(false);
        return;
      }

      const data = await customToolsApi.execute(tool.id, args);
      setTestResult(JSON.stringify(data, null, 2));
      onRefresh();
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-3xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
                {tool.name}
                <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[tool.status]}`}>
                  {STATUS_LABELS[tool.status]}
                </span>
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                {tool.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {tool.status === 'active' && (
                <button
                  onClick={() => onAction(tool.id, 'disable')}
                  className="px-3 py-1.5 text-sm text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                >
                  Disable
                </button>
              )}
              {tool.status === 'disabled' && (
                <button
                  onClick={() => onAction(tool.id, 'enable')}
                  className="px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                >
                  Enable
                </button>
              )}
              {tool.status === 'pending_approval' && (
                <>
                  <button
                    onClick={() => onAction(tool.id, 'approve')}
                    className="px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onAction(tool.id, 'reject')}
                    className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    Reject
                  </button>
                </>
              )}
              <button
                onClick={() => onAction(tool.id, 'delete')}
                className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <Trash className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mt-4">
            <button
              onClick={() => setActiveTab('details')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === 'details'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === 'code'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              Code
            </button>
            <button
              onClick={() => setActiveTab('test')}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === 'test'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              Test
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
                  <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Created By</div>
                  <div className="text-sm text-text-primary dark:text-dark-text-primary">
                    {tool.createdBy === 'llm' ? 'AI Assistant' : 'User'}
                  </div>
                </div>
                <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
                  <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Version</div>
                  <div className="text-sm text-text-primary dark:text-dark-text-primary">
                    v{tool.version}
                  </div>
                </div>
                <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
                  <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Usage Count</div>
                  <div className="text-sm text-text-primary dark:text-dark-text-primary">
                    {tool.usageCount} times
                  </div>
                </div>
                <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
                  <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Last Used</div>
                  <div className="text-sm text-text-primary dark:text-dark-text-primary">
                    {tool.lastUsedAt ? new Date(tool.lastUsedAt).toLocaleString() : 'Never'}
                  </div>
                </div>
              </div>

              {/* Permissions */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Permissions
                </h4>
                <div className="flex flex-wrap gap-2">
                  {tool.permissions.length > 0 ? (
                    tool.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="px-2 py-1 text-xs bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded"
                      >
                        {PERMISSION_LABELS[perm]}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-text-muted dark:text-dark-text-muted">
                      No special permissions required
                    </span>
                  )}
                </div>
              </div>

              {/* Parameters */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Parameters
                </h4>
                <pre className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto">
                  {JSON.stringify(tool.parameters, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'code' && (
            <div>
              <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Tool Implementation
              </h4>
              <pre className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto font-mono whitespace-pre-wrap">
                {tool.code}
              </pre>
            </div>
          )}

          {activeTab === 'test' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Test Arguments (JSON)
                </h4>
                <textarea
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  placeholder='{"param1": "value1"}'
                />
              </div>

              <button
                onClick={handleTest}
                disabled={isTesting || tool.status !== 'active'}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-4 h-4" />
                {isTesting ? 'Running...' : 'Run Tool'}
              </button>

              {tool.status !== 'active' && (
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  Tool must be active to test. Current status: {STATUS_LABELS[tool.status]}
                </p>
              )}

              {testResult && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                    Result
                  </h4>
                  <pre className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto">
                    {testResult}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface CreateToolModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateToolModal({ onClose, onCreated }: CreateToolModalProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [parameters, setParameters] = useState('{\n  "type": "object",\n  "properties": {},\n  "required": []\n}');
  const [code, setCode] = useState('// Access arguments via `args` object\n// Return the result\nreturn { message: "Hello from custom tool!" };');
  const [permissions, setPermissions] = useState<ToolPermission[]>([]);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePermission = (perm: ToolPermission) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmit = async () => {
    setError(null);

    // Validate name
    if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
      setError('Tool name must start with lowercase letter and contain only lowercase letters, numbers, and underscores');
      return;
    }

    // Validate parameters JSON
    let parsedParams;
    try {
      parsedParams = JSON.parse(parameters);
    } catch {
      setError('Invalid parameters JSON');
      return;
    }

    setIsSubmitting(true);

    try {
      await customToolsApi.create({
        name,
        description,
        category: category || undefined,
        parameters: parsedParams,
        code,
        permissions,
        requiresApproval,
        createdBy: 'user',
      });

      toast.success('Tool created');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tool');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Create Custom Tool
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
            Define a new tool that can be used by the AI assistant
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Tool Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="my_custom_tool"
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
              Lowercase letters, numbers, and underscores only
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Description *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What does this tool do?"
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Category
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Utilities"
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Parameters */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Parameters (JSON Schema) *
            </label>
            <textarea
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
          </div>

          {/* Code */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Implementation (JavaScript) *
            </label>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
              Access arguments via `args` object. Return the result.
            </p>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Required Permissions
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PERMISSION_LABELS) as ToolPermission[]).map((perm) => (
                <button
                  key={perm}
                  type="button"
                  onClick={() => togglePermission(perm)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    permissions.includes(perm)
                      ? 'bg-orange-500/10 border-orange-500/50 text-orange-600 dark:text-orange-400'
                      : 'border-border dark:border-dark-border text-text-muted hover:border-primary/50'
                  }`}
                >
                  {PERMISSION_LABELS[perm]}
                </button>
              ))}
            </div>
          </div>

          {/* Requires Approval */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requiresApproval"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="w-4 h-4 rounded border-border dark:border-dark-border text-primary focus:ring-primary"
            />
            <label
              htmlFor="requiresApproval"
              className="text-sm text-text-secondary dark:text-dark-text-secondary"
            >
              Require user approval before each execution
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !name || !description || !code}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Creating...' : 'Create Tool'}
          </button>
        </div>
      </div>
    </div>
  );
}
