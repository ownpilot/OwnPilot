/**
 * CLI Tools Settings Page
 *
 * Discovery, policy management, custom tool registration, and installation.
 * Accessible at /settings/cli-tools.
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useToast } from '../components/ToastProvider';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  Search,
  Filter,
  Shield,
  Plus,
  Trash2,
  X,
} from '../components/icons';
import { cliToolsApi } from '../api';
import type {
  CliToolStatus,
  CliToolPolicy,
  CliToolCategory,
  CliToolRiskLevel,
} from '../api/endpoints/cli-tools';

// =============================================================================
// Constants
// =============================================================================

const CATEGORY_LABELS: Record<CliToolCategory, string> = {
  linter: 'Linters',
  formatter: 'Formatters',
  build: 'Build Tools',
  test: 'Test Runners',
  'package-manager': 'Package Managers',
  container: 'Containers',
  'version-control': 'Version Control',
  'coding-agent': 'Coding Agents',
  utility: 'Utilities',
  security: 'Security',
  database: 'Database',
};

const POLICY_OPTIONS: {
  value: CliToolPolicy;
  label: string;
  color: string;
  description: string;
}[] = [
  {
    value: 'allowed',
    label: 'Allowed',
    color: 'text-green-400',
    description: 'AI runs automatically',
  },
  {
    value: 'prompt',
    label: 'Prompt',
    color: 'text-yellow-400',
    description: 'AI asks for approval',
  },
  {
    value: 'blocked',
    label: 'Blocked',
    color: 'text-red-400',
    description: 'AI cannot use this',
  },
];

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-red-500/20 text-red-400',
  critical: 'bg-red-700/20 text-red-300',
};

const POLICY_INDICATOR: Record<CliToolPolicy, { icon: string; color: string; label: string }> = {
  allowed: { icon: '\u25CF', color: 'text-green-400', label: 'Auto-runs' },
  prompt: { icon: '\u25CF', color: 'text-yellow-400', label: 'Needs approval' },
  blocked: { icon: '\u25CF', color: 'text-red-400', label: 'Blocked' },
};

// =============================================================================
// Component
// =============================================================================

export function CliToolsSettingsPage() {
  const toast = useToast();
  const [tools, setTools] = useState<CliToolStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CliToolCategory | 'all'>('all');
  const [installingTool, setInstallingTool] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadTools = useCallback(async () => {
    try {
      const data = await cliToolsApi.list();
      setTools(data);
    } catch {
      toast.error('Failed to load CLI tools');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await cliToolsApi.refresh();
      await loadTools();
      toast.success('Discovery cache refreshed');
    } catch {
      toast.error('Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const handlePolicyChange = async (toolName: string, policy: CliToolPolicy) => {
    try {
      await cliToolsApi.setPolicy(toolName, policy);
      setTools((prev) => prev.map((t) => (t.name === toolName ? { ...t, policy } : t)));
    } catch {
      toast.error('Failed to update policy');
    }
  };

  const handleInstall = async (toolName: string) => {
    setInstallingTool(toolName);
    try {
      const result = await cliToolsApi.install(toolName, 'npm-global');
      if (result.success) {
        toast.success(`${toolName} installed successfully`);
        await loadTools();
      } else {
        toast.error(result.error || 'Installation failed');
      }
    } catch {
      toast.error('Installation failed');
    } finally {
      setInstallingTool(null);
    }
  };

  const handleBatchPolicy = async (riskLevel: string, policy: CliToolPolicy) => {
    try {
      const result = await cliToolsApi.batchSetPolicy(policy, { riskLevel });
      toast.success(`Updated ${result.updated} tools to "${policy}"`);
      await loadTools();
    } catch {
      toast.error('Batch update failed');
    }
  };

  const handleDeleteCustom = async (toolName: string) => {
    const baseName = toolName.startsWith('custom:') ? toolName.slice(7) : toolName;
    try {
      await cliToolsApi.deleteCustom(baseName);
      toast.success(`Custom tool "${baseName}" removed`);
      await loadTools();
    } catch {
      toast.error('Failed to remove custom tool');
    }
  };

  const handleCustomToolAdded = async () => {
    setShowAddModal(false);
    await loadTools();
  };

  // Filter tools
  const filteredTools = tools.filter((t) => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.displayName.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by category
  const categories = [...new Set(filteredTools.map((t) => t.category))].sort();

  // Stats
  const installed = tools.filter((t) => t.installed).length;
  const npxOnly = tools.filter((t) => !t.installed && t.npxAvailable).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">CLI Tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage CLI tools the AI can discover, execute, and install.{' '}
            <Link to="/autonomy" className="text-primary hover:underline">
              Autonomy settings
            </Link>{' '}
            control the global approval level.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm text-primary hover:bg-primary/20"
          >
            <Plus className="h-4 w-4" />
            Register Tool
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-bold">{tools.length}</div>
          <div className="text-sm text-muted-foreground">Total Tools</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-bold text-green-400">{installed}</div>
          <div className="text-sm text-muted-foreground">Installed</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-bold text-blue-400">{npxOnly}</div>
          <div className="text-sm text-muted-foreground">npx Available</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-3">
        <span className="text-xs font-medium text-muted-foreground">Quick actions:</span>
        <button
          onClick={() => handleBatchPolicy('low', 'allowed')}
          className="rounded border border-green-500/30 px-2 py-1 text-xs text-green-400 hover:bg-green-500/10"
        >
          Allow All Low-Risk
        </button>
        <button
          onClick={() => handleBatchPolicy('high', 'blocked')}
          className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
        >
          Block All High-Risk
        </button>
        <button
          onClick={() => handleBatchPolicy('critical', 'blocked')}
          className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
        >
          Block All Critical
        </button>
      </div>

      {/* Policy legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {POLICY_OPTIONS.map((opt) => (
          <span key={opt.value} className="flex items-center gap-1">
            <span className={POLICY_INDICATOR[opt.value].color}>
              {POLICY_INDICATOR[opt.value].icon}
            </span>
            <span className="font-medium">{opt.label}</span>
            <span>&mdash; {opt.description}</span>
          </span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-3 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CliToolCategory | 'all')}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tools by category */}
      {categories.map((category) => (
        <div key={category} className="space-y-2">
          <h2 className="text-lg font-semibold">{CATEGORY_LABELS[category] || category}</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-card/50">
                  <th className="px-4 py-2 text-left font-medium">Tool</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Version</th>
                  <th className="px-4 py-2 text-left font-medium">Risk</th>
                  <th className="px-4 py-2 text-left font-medium">Policy</th>
                  <th className="px-4 py-2 text-left font-medium">AI Behavior</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTools
                  .filter((t) => t.category === category)
                  .map((tool) => {
                    const indicator = POLICY_INDICATOR[tool.policy];
                    return (
                      <tr key={tool.name} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium">{tool.displayName}</div>
                          <div className="text-xs text-muted-foreground">
                            {tool.name}
                            {tool.source === 'custom' && (
                              <span className="ml-1 rounded bg-blue-500/20 px-1 text-blue-400">
                                custom
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {tool.installed ? (
                            <span className="inline-flex items-center gap-1 text-green-400">
                              <CheckCircle2 className="h-4 w-4" />
                              Installed
                            </span>
                          ) : tool.npxAvailable ? (
                            <span className="inline-flex items-center gap-1 text-blue-400">
                              <AlertCircle className="h-4 w-4" />
                              npx
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <XCircle className="h-4 w-4" />
                              Missing
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{tool.version || '-'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${RISK_COLORS[tool.riskLevel]}`}
                          >
                            {tool.riskLevel}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={tool.policy}
                            onChange={(e) =>
                              handlePolicyChange(tool.name, e.target.value as CliToolPolicy)
                            }
                            className="rounded border border-border bg-card px-2 py-1 text-xs"
                          >
                            {POLICY_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs ${indicator.color}`}>
                            {indicator.icon} {indicator.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!tool.installed && tool.npxAvailable && (
                              <button
                                onClick={() => handleInstall(tool.name)}
                                disabled={installingTool === tool.name}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent"
                              >
                                {installingTool === tool.name ? (
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                Install
                              </button>
                            )}
                            {tool.source === 'custom' && (
                              <button
                                onClick={() => handleDeleteCustom(tool.name)}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {filteredTools.length === 0 && (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Shield className="mb-2 h-8 w-8" />
          <p>No tools match your filters</p>
        </div>
      )}

      {/* Add Custom Tool Modal (portal to body to escape overflow clipping) */}
      {showAddModal &&
        createPortal(
          <AddCustomToolModal
            onClose={() => setShowAddModal(false)}
            onAdded={handleCustomToolAdded}
          />,
          document.body
        )}
    </div>
  );
}

// =============================================================================
// Add Custom Tool Modal
// =============================================================================

function AddCustomToolModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    binaryName: '',
    description: '',
    category: 'utility' as CliToolCategory,
    riskLevel: 'medium' as CliToolRiskLevel,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.displayName || !form.binaryName) {
      toast.error('Name, display name, and binary are required');
      return;
    }

    setSubmitting(true);
    try {
      await cliToolsApi.registerCustom({
        name: form.name,
        displayName: form.displayName,
        binaryName: form.binaryName,
        description: form.description || undefined,
        category: form.category,
        riskLevel: form.riskLevel,
      });
      toast.success(`Custom tool "${form.displayName}" registered`);
      onAdded();
    } catch {
      toast.error('Failed to register custom tool');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-semibold">Register Custom CLI Tool</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tool ID (slug)
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) =>
                  updateField('name', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                }
                placeholder="my-tool"
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Display Name
              </label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => updateField('displayName', e.target.value)}
                placeholder="My Tool"
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Binary Name (must be in PATH)
            </label>
            <input
              type="text"
              value={form.binaryName}
              onChange={(e) => updateField('binaryName', e.target.value)}
              placeholder="my-tool"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Description
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="What does this tool do?"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) => updateField('category', e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              >
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Risk Level
              </label>
              <select
                value={form.riskLevel}
                onChange={(e) => updateField('riskLevel', e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Register Tool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
