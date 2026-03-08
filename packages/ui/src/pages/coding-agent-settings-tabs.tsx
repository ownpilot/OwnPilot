/**
 * CodingAgentSettingsPage Sub-components
 *
 * Extracted from CodingAgentSettingsPage.tsx:
 * - Provider metadata constants
 * - ProvidersTab, ProviderCard
 * - PermissionsTab, PermissionEditor, ToggleField
 * - SkillsTab, ProviderSkillsCard
 * - BudgetTab, BudgetEditor
 * - SecurityTab
 */

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import {
  CheckCircle2,
  XCircle,
  Terminal,
  Key,
  ExternalLink,
  Play,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  FolderOpen,
} from '../components/icons';
import { codingAgentsApi, settingsApi } from '../api';
import type {
  CodingAgentStatus,
  CodingAgentTestResult,
  CodingAgentPermissionProfile,
  SkillAttachment,
  CodingAgentSubscription,
} from '../api/endpoints/coding-agents';

// =============================================================================
// Provider metadata
// =============================================================================

interface ProviderMeta {
  icon: string;
  description: string;
  installCommand: string;
  docsUrl: string;
  docsLabel: string;
  authInfo: string;
}

interface SubscriptionInfo {
  tier: string;
  envVar: string;
  loginSupported: boolean;
  costNote: string;
}

const SUBSCRIPTION_INFO: Record<string, SubscriptionInfo> = {
  'claude-code': {
    tier: 'Claude Pro ($20/mo) or Claude Max ($100-200/mo)',
    envVar: 'ANTHROPIC_API_KEY',
    loginSupported: true,
    costNote: 'Pro: 5x rate, Max: 20x rate. API key: pay-per-token.',
  },
  codex: {
    tier: 'ChatGPT Plus ($20/mo) or ChatGPT Pro ($200/mo)',
    envVar: 'CODEX_API_KEY',
    loginSupported: true,
    costNote: 'Plus: included with subscription. API key: pay-per-token.',
  },
  'gemini-cli': {
    tier: 'Google AI Studio (free tier) or Gemini Advanced ($20/mo)',
    envVar: 'GEMINI_API_KEY',
    loginSupported: true,
    costNote: 'Free tier: 60 RPM. API key: pay-per-token pricing.',
  },
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  'claude-code': {
    icon: 'C',
    description: 'Anthropic Claude Code — complex multi-file changes and refactoring.',
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    docsUrl: 'https://console.anthropic.com',
    docsLabel: 'console.anthropic.com',
    authInfo: 'Claude Pro subscription or API key (ANTHROPIC_API_KEY)',
  },
  codex: {
    icon: 'O',
    description: 'OpenAI Codex CLI — code generation and test writing.',
    installCommand: 'npm i -g @openai/codex',
    docsUrl: 'https://platform.openai.com',
    docsLabel: 'platform.openai.com',
    authInfo: 'ChatGPT Plus subscription or API key (CODEX_API_KEY)',
  },
  'gemini-cli': {
    icon: 'G',
    description: 'Google Gemini CLI — code analysis and explanation.',
    installCommand: 'npm i -g @google/gemini-cli',
    docsUrl: 'https://aistudio.google.com',
    docsLabel: 'aistudio.google.com',
    authInfo: 'Google account login or API key (GEMINI_API_KEY)',
  },
};

const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  codex: 'bg-green-500/20 text-green-600 dark:text-green-400',
  'gemini-cli': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
};

// =============================================================================
// Providers Tab (original content)
// =============================================================================

export function ProvidersTab({
  statuses,
  testResults,
  testingProvider,
  isLoading,
  onTest,
}: {
  statuses: CodingAgentStatus[];
  testResults: Record<string, CodingAgentTestResult>;
  testingProvider: string | null;
  isLoading: boolean;
  onTest: (provider: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-600 dark:text-blue-400 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <strong>No API key required!</strong> All providers support subscription-based login
          (Claude Pro, ChatGPT Plus, Google account). API keys are optional — the CLI will prompt
          you to authenticate on first use in interactive mode.
        </div>
      </div>

      {statuses.map((status) => (
        <ProviderCard
          key={status.provider}
          status={status}
          testResult={testResults[status.provider]}
          testing={testingProvider === status.provider}
          onTest={() => onTest(status.provider)}
        />
      ))}

      {statuses.length === 0 && !isLoading && (
        <div className="text-center py-12 text-text-muted dark:text-dark-text-muted">
          <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No providers found</p>
          <p className="text-xs mt-1">Restart the gateway to detect installed CLIs</p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Permissions Tab
// =============================================================================

export function PermissionsTab({ providers }: { providers: string[] }) {
  const toast = useToast();
  const [perms, setPerms] = useState<Record<string, CodingAgentPermissionProfile>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    loadPerms();
  }, []); // eslint-disable-line

  const loadPerms = async () => {
    try {
      setIsLoading(true);
      const list = await codingAgentsApi.listPermissions();
      const map: Record<string, CodingAgentPermissionProfile> = {};
      for (const p of list) map[p.providerRef] = p;
      setPerms(map);
    } catch {
      /* ignore - defaults will be used */
    } finally {
      setIsLoading(false);
    }
  };

  const savePerms = async (provider: string, data: Record<string, unknown>) => {
    setSaving(provider);
    try {
      const record = await codingAgentsApi.updatePermissions(provider, data);
      setPerms((prev) => ({ ...prev, [provider]: record }));
      toast.success(`Permissions saved for ${provider}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-text-muted dark:text-dark-text-muted animate-pulse">
        Loading permissions...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted dark:text-dark-text-muted">
        Configure default permissions for each provider. These apply to new sessions unless
        overridden.
      </p>
      {providers.map((provider) => {
        const p = perms[provider];
        const defaults = {
          io_format: p?.ioFormat ?? 'text',
          fs_access: p?.fsAccess ?? 'read-write',
          network_access: p?.networkAccess ?? true,
          shell_access: p?.shellAccess ?? true,
          git_access: p?.gitAccess ?? true,
          autonomy: p?.autonomy ?? 'semi-auto',
          max_file_changes: p?.maxFileChanges ?? 50,
        };

        return (
          <PermissionEditor
            key={provider}
            provider={provider}
            defaults={defaults}
            saving={saving === provider}
            onSave={(data) => savePerms(provider, data)}
          />
        );
      })}
      {providers.length === 0 && (
        <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
          No providers detected
        </div>
      )}
    </div>
  );
}

function PermissionEditor({
  provider,
  defaults,
  saving,
  onSave,
}: {
  provider: string;
  defaults: Record<string, unknown>;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState(defaults);
  const color = PROVIDER_COLORS[provider] ?? 'bg-gray-500/20 text-gray-500';
  const meta = PROVIDER_META[provider];

  const set = (key: string, value: unknown) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="p-4 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${color}`}
          >
            {meta?.icon ?? '?'}
          </div>
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            {provider}
          </h3>
        </div>
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        >
          {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="space-y-1">
          <span className="text-text-muted dark:text-dark-text-muted">Autonomy</span>
          <select
            value={form.autonomy as string}
            onChange={(e) => set('autonomy', e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          >
            <option value="supervised">Supervised</option>
            <option value="semi-auto">Semi-Auto</option>
            <option value="full-auto">Full Auto</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-text-muted dark:text-dark-text-muted">File Access</span>
          <select
            value={form.fs_access as string}
            onChange={(e) => set('fs_access', e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          >
            <option value="none">None</option>
            <option value="read-only">Read Only</option>
            <option value="read-write">Read/Write</option>
            <option value="full">Full</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-text-muted dark:text-dark-text-muted">Output Format</span>
          <select
            value={form.io_format as string}
            onChange={(e) => set('io_format', e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          >
            <option value="text">Text</option>
            <option value="json">JSON</option>
            <option value="stream-json">Stream JSON</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-text-muted dark:text-dark-text-muted">Max File Changes</span>
          <input
            type="number"
            value={form.max_file_changes as number}
            onChange={(e) => set('max_file_changes', parseInt(e.target.value) || 50)}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          />
        </label>
      </div>

      <div className="flex gap-4 text-xs">
        <ToggleField
          label="Network"
          checked={form.network_access as boolean}
          onChange={(v) => set('network_access', v)}
        />
        <ToggleField
          label="Shell"
          checked={form.shell_access as boolean}
          onChange={(v) => set('shell_access', v)}
        />
        <ToggleField
          label="Git"
          checked={form.git_access as boolean}
          onChange={(v) => set('git_access', v)}
        />
      </div>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-4.5 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-3.5' : ''}`}
        />
      </button>
      <span className="text-text-muted dark:text-dark-text-muted">{label}</span>
    </label>
  );
}

// =============================================================================
// Skills Tab
// =============================================================================

export function SkillsTab({ providers }: { providers: string[] }) {
  const toast = useToast();
  const [skills, setSkills] = useState<Record<string, SkillAttachment[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, [providers]); // eslint-disable-line

  const loadSkills = async () => {
    try {
      setIsLoading(true);
      const map: Record<string, SkillAttachment[]> = {};
      for (const p of providers) {
        try {
          map[p] = await codingAgentsApi.listSkillAttachments(p);
        } catch {
          map[p] = [];
        }
      }
      setSkills(map);
    } finally {
      setIsLoading(false);
    }
  };

  const addInlineSkill = async (provider: string, label: string, instructions: string) => {
    setAdding(provider);
    try {
      await codingAgentsApi.attachSkill(provider, {
        type: 'inline',
        label,
        instructions,
      });
      await loadSkills();
      toast.success('Skill attached');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to attach skill');
    } finally {
      setAdding(null);
    }
  };

  const removeSkill = async (provider: string, id: string) => {
    try {
      await codingAgentsApi.detachSkill(provider, id);
      setSkills((prev) => ({
        ...prev,
        [provider]: (prev[provider] || []).filter((s) => s.id !== id),
      }));
      toast.success('Skill detached');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to detach');
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-text-muted dark:text-dark-text-muted animate-pulse">
        Loading skills...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted dark:text-dark-text-muted">
        Attach skills and instructions to each provider. These are injected into the agent&apos;s
        prompt.
      </p>
      {providers.map((provider) => (
        <ProviderSkillsCard
          key={provider}
          provider={provider}
          skills={skills[provider] || []}
          adding={adding === provider}
          onAdd={(label, instructions) => addInlineSkill(provider, label, instructions)}
          onRemove={(id) => removeSkill(provider, id)}
        />
      ))}
      {providers.length === 0 && (
        <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
          No providers detected
        </div>
      )}
    </div>
  );
}

function ProviderSkillsCard({
  provider,
  skills,
  adding,
  onAdd,
  onRemove,
}: {
  provider: string;
  skills: SkillAttachment[];
  adding: boolean;
  onAdd: (label: string, instructions: string) => void;
  onRemove: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [instructions, setInstructions] = useState('');
  const color = PROVIDER_COLORS[provider] ?? 'bg-gray-500/20 text-gray-500';
  const meta = PROVIDER_META[provider];

  const handleAdd = () => {
    if (!label.trim() || !instructions.trim()) return;
    onAdd(label.trim(), instructions.trim());
    setLabel('');
    setInstructions('');
    setShowForm(false);
  };

  return (
    <div className="p-4 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${color}`}
          >
            {meta?.icon ?? '?'}
          </div>
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            {provider}
          </h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
            {skills.length} skill{skills.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-2 py-1 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {/* Existing skills */}
      {skills.length > 0 && (
        <div className="space-y-1.5">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center justify-between p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                    {skill.label ||
                      (skill.type === 'extension' ? `Extension: ${skill.extensionId}` : 'Inline')}
                  </span>
                  <span
                    className={`text-[9px] px-1 py-0.5 rounded ${skill.type === 'extension' ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}
                  >
                    {skill.type}
                  </span>
                </div>
                {skill.instructions && (
                  <p className="text-[10px] text-text-muted dark:text-dark-text-muted truncate mt-0.5">
                    {skill.instructions.slice(0, 100)}
                    {skill.instructions.length > 100 ? '...' : ''}
                  </p>
                )}
              </div>
              <button
                onClick={() => onRemove(skill.id)}
                className="p-1 rounded text-text-muted hover:text-error hover:bg-error/10 transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="p-3 rounded-lg border border-border dark:border-dark-border space-y-2">
          <input
            placeholder="Label (e.g. 'Code Style Rules')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          />
          <textarea
            placeholder="Instructions (injected into agent prompt)"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 rounded-lg text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary resize-y"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={adding || !label.trim() || !instructions.trim()}
              className="px-3 py-1 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
            >
              {adding ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              Attach
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Budget Tab
// =============================================================================

export function BudgetTab({ providers }: { providers: string[] }) {
  const toast = useToast();
  const [subs, setSubs] = useState<Record<string, CodingAgentSubscription>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    loadSubs();
  }, []); // eslint-disable-line

  const loadSubs = async () => {
    try {
      setIsLoading(true);
      const list = await codingAgentsApi.listSubscriptions();
      const map: Record<string, CodingAgentSubscription> = {};
      for (const s of list) map[s.providerRef] = s;
      setSubs(map);
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  };

  const saveSub = async (provider: string, data: Record<string, unknown>) => {
    setSaving(provider);
    try {
      const record = await codingAgentsApi.updateSubscription(provider, data);
      setSubs((prev) => ({ ...prev, [provider]: record }));
      toast.success(`Budget saved for ${provider}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-text-muted dark:text-dark-text-muted animate-pulse">
        Loading budgets...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted dark:text-dark-text-muted">
        Set monthly budget limits and track spending per provider.
      </p>
      {providers.map((provider) => {
        const sub = subs[provider];
        return (
          <BudgetEditor
            key={provider}
            provider={provider}
            sub={sub}
            saving={saving === provider}
            onSave={(data) => saveSub(provider, data)}
          />
        );
      })}
      {providers.length === 0 && (
        <div className="text-center py-8 text-text-muted dark:text-dark-text-muted">
          No providers detected
        </div>
      )}
    </div>
  );
}

function BudgetEditor({
  provider,
  sub,
  saving,
  onSave,
}: {
  provider: string;
  sub?: CodingAgentSubscription;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [tier, setTier] = useState(sub?.tier ?? '');
  const [budget, setBudget] = useState(sub?.monthlyBudgetUsd ?? 0);
  const [maxSessions, setMaxSessions] = useState(sub?.maxConcurrentSessions ?? 3);
  const color = PROVIDER_COLORS[provider] ?? 'bg-gray-500/20 text-gray-500';
  const meta = PROVIDER_META[provider];
  const spent = sub?.currentSpendUsd ?? 0;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;

  return (
    <div className="p-4 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${color}`}
          >
            {meta?.icon ?? '?'}
          </div>
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            {provider}
          </h3>
        </div>
        <button
          onClick={() =>
            onSave({
              tier: tier || undefined,
              monthly_budget_usd: budget,
              max_concurrent_sessions: maxSessions,
            })
          }
          disabled={saving}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        >
          {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
        </button>
      </div>

      {/* Budget progress bar */}
      {budget > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-text-muted dark:text-dark-text-muted">
            <span>${spent.toFixed(2)} spent</span>
            <span>${budget.toFixed(2)} budget</span>
          </div>
          <div className="h-2 rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-error' : pct > 70 ? 'bg-yellow-500' : 'bg-primary'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-xs">
        <label className="space-y-1">
          <span className="text-text-muted dark:text-dark-text-muted">Tier</span>
          <input
            placeholder="e.g. Pro"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          />
        </label>
        <label className="space-y-1">
          <span className="text-text-muted dark:text-dark-text-muted">Monthly Budget ($)</span>
          <input
            type="number"
            min={0}
            step={5}
            value={budget}
            onChange={(e) => setBudget(parseFloat(e.target.value) || 0)}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          />
        </label>
        <label className="space-y-1">
          <span className="text-text-muted dark:text-dark-text-muted">Max Sessions</span>
          <input
            type="number"
            min={1}
            max={10}
            value={maxSessions}
            onChange={(e) => setMaxSessions(parseInt(e.target.value) || 3)}
            className="w-full px-2 py-1.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary"
          />
        </label>
      </div>
    </div>
  );
}

// =============================================================================
// Provider Card
// =============================================================================

function ProviderCard({
  status,
  testResult,
  testing,
  onTest,
}: {
  status: CodingAgentStatus;
  testResult?: CodingAgentTestResult;
  testing: boolean;
  onTest: () => void;
}) {
  const meta = PROVIDER_META[status.provider];
  const subInfo = SUBSCRIPTION_INFO[status.provider];
  const color = PROVIDER_COLORS[status.provider] ?? 'bg-gray-500/20 text-gray-500';

  return (
    <div className="p-4 rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shrink-0 ${color}`}
        >
          {meta?.icon ?? '?'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              {status.displayName}
            </h3>
            {status.installed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/10 text-success">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Installed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-error/10 text-error">
                <XCircle className="w-2.5 h-2.5" />
                Not Installed
              </span>
            )}
            {status.configured && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
                <Key className="w-2.5 h-2.5" />
                API Key
              </span>
            )}
          </div>

          <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2">
            {meta?.description}
          </p>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {status.version && (
              <div className="text-text-muted dark:text-dark-text-muted">
                Version:{' '}
                <span className="font-mono text-text-primary dark:text-dark-text-primary">
                  {status.version}
                </span>
              </div>
            )}
            <div className="text-text-muted dark:text-dark-text-muted">
              PTY:{' '}
              {status.ptyAvailable ? (
                <span className="text-success">Available</span>
              ) : (
                <span className="text-error">Unavailable</span>
              )}
            </div>
            {meta?.authInfo && (
              <div className="col-span-2 text-text-muted dark:text-dark-text-muted">
                Auth: {meta.authInfo}
              </div>
            )}
          </div>

          {/* Subscription & auth info */}
          {subInfo && (
            <div className="mt-3 p-2.5 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary space-y-1.5">
              <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                Subscription & Auth
              </div>
              <div className="text-[11px] text-text-muted dark:text-dark-text-muted space-y-1">
                <div>
                  <span className="font-medium">Tiers:</span> {subInfo.tier}
                </div>
                <div>
                  <span className="font-medium">Cost:</span> {subInfo.costNote}
                </div>
                <div>
                  <span className="font-medium">Env var:</span>{' '}
                  <code className="font-mono text-text-primary dark:text-dark-text-primary bg-bg-primary dark:bg-dark-bg-primary px-1 rounded">
                    {subInfo.envVar}
                  </code>
                </div>
                <div>
                  <span className="font-medium">Login auth:</span>{' '}
                  {subInfo.loginSupported ? (
                    <span className="text-success">
                      Supported (run CLI in interactive mode to log in)
                    </span>
                  ) : (
                    <span className="text-error">Not supported</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Install command (if not installed) */}
          {!status.installed && meta?.installCommand && (
            <div className="mt-3 p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
              <p className="text-[10px] text-text-muted dark:text-dark-text-muted mb-1">
                Install with:
              </p>
              <code className="text-xs font-mono text-text-primary dark:text-dark-text-primary select-all">
                {meta.installCommand}
              </code>
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className={`mt-2 p-2 rounded-lg text-xs ${
                testResult.available ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
              }`}
            >
              {testResult.available
                ? 'Test passed — provider is ready to use'
                : 'Test failed — provider is not available'}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onTest}
            disabled={testing || !status.installed}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-50 inline-flex items-center gap-1"
          >
            {testing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Test
          </button>
          {meta?.docsUrl && (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Docs
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Security Tab — Allowed Working Directories
// =============================================================================

export function SecurityTab() {
  const toast = useToast();
  const [dirs, setDirs] = useState<string[]>([]);
  const [newDir, setNewDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchDirs = useCallback(async () => {
    try {
      const result = await settingsApi.getAllowedDirs();
      setDirs(result.dirs);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDirs();
  }, [fetchDirs]);

  const handleAdd = () => {
    const trimmed = newDir.trim();
    if (!trimmed) return;
    if (dirs.includes(trimmed)) {
      toast.warning('Directory already in the list');
      return;
    }
    setDirs((prev) => [...prev, trimmed]);
    setNewDir('');
  };

  const handleRemove = (index: number) => {
    setDirs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.setAllowedDirs(dirs);
      toast.success('Allowed directories saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Allowed Directories */}
      <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-5 border border-border dark:border-dark-border">
        <div className="flex items-center gap-2 mb-1">
          <FolderOpen className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Allowed Working Directories
          </h3>
        </div>
        <p className="text-xs text-text-muted dark:text-dark-text-muted mb-4">
          Restrict coding agents to only work within these directories. If the list is empty, agents
          can work in any directory. Subdirectories of allowed paths are also permitted.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Current dirs */}
            {dirs.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {dirs.map((dir, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="text-xs font-mono text-text-primary dark:text-dark-text-primary flex-1 truncate">
                      {dir}
                    </span>
                    <button
                      onClick={() => handleRemove(i)}
                      className="p-1 text-text-muted hover:text-error transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  No restrictions — agents can access any directory on this machine.
                </span>
              </div>
            )}

            {/* Add new dir */}
            <div className="flex items-center gap-2">
              <input
                value={newDir}
                onChange={(e) => setNewDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="D:\Projects  or  /home/user/projects"
                className="flex-1 px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
              />
              <button
                onClick={handleAdd}
                disabled={!newDir.trim()}
                className="px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary hover:bg-bg-quaternary dark:hover:bg-dark-bg-quaternary disabled:opacity-40 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Save button */}
            <div className="flex justify-end mt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
