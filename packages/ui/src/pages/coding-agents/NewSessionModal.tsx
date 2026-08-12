/**
 * NewSessionModal — the coding-agent session creation dialog.
 *
 * Roughly 600 lines of CodingAgentsPage.tsx: its own form state, workspace and
 * skill pickers, and the advanced-options panel. It shares nothing with the
 * page beyond the props below, so it moves out whole, together with the two
 * helpers used only by it.
 */

import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Play,
  Terminal,
  RefreshCw,
} from '../../components/icons';
import { fileWorkspacesApi } from '../../api';
import type { FileWorkspaceInfo } from '../../api/endpoints';
import type { CodingAgentStatus, CodingAgentPermissions } from '../../api/endpoints/coding-agents';
import { PROVIDER_META, PROVIDER_COLORS } from '../CodingAgentsPage.constants';
import { silentCatch } from '../../utils/ignore-error';

export function NewSessionModal({
  statuses,
  onClose,
  onCreate,
}: {
  statuses: CodingAgentStatus[];
  onClose: () => void;
  onCreate: (
    provider: string,
    prompt: string,
    mode: 'auto' | 'interactive',
    cwd?: string,
    skillIds?: string[],
    permissions?: CodingAgentPermissions,
    settingsFile?: string
  ) => void;
}) {
  const ptyAvailable = statuses.some((s) => s.ptyAvailable);

  const [provider, setProvider] = useState(() => {
    const installed = statuses.find((s) => s.installed);
    return installed?.provider ?? statuses[0]?.provider ?? '';
  });
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'auto' | 'interactive'>('auto');
  const [cwd, setCwd] = useState('');
  const [creating, setCreating] = useState(false);
  const [workspaces, setWorkspaces] = useState<FileWorkspaceInfo[]>([]);
  const [cwdMode, setCwdMode] = useState<'workspace' | 'custom'>('workspace');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [settingsFile, setSettingsFile] = useState('');
  const [permissions, setPermissions] = useState<CodingAgentPermissions>({
    autonomy: 'semi-auto',
    file_access: 'read-write',
    network_access: true,
    shell_access: true,
    git_access: true,
    output_format: 'text',
  });

  // Fetch file workspaces for the picker
  useEffect(() => {
    fileWorkspacesApi
      .list()
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .catch(silentCatch('fileWorkspaces.list'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider || !prompt.trim()) return;
    setCreating(true);
    try {
      await onCreate(
        provider,
        prompt.trim(),
        mode,
        cwd.trim() || undefined,
        selectedSkills.length > 0 ? selectedSkills : undefined,
        permissions,
        settingsFile.trim() || undefined
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">
            New Coding Agent Session
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Provider selection */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Provider
              </label>
              <div className="grid grid-cols-3 gap-2">
                {statuses.map((s) => {
                  const meta = PROVIDER_META[s.provider];
                  const isCustom = s.provider.startsWith('custom:');
                  const color =
                    PROVIDER_COLORS[s.provider] ??
                    'bg-purple-500/20 text-purple-600 dark:text-purple-400';
                  const icon =
                    meta?.icon ?? (isCustom ? s.displayName.charAt(0).toUpperCase() : '?');
                  const selected = provider === s.provider;

                  return (
                    <button
                      key={s.provider}
                      type="button"
                      onClick={() => setProvider(s.provider)}
                      className={`p-3 rounded-lg border text-center transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10'
                          : 'border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                      } ${!s.installed ? 'opacity-60' : ''}`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg mx-auto mb-1 flex items-center justify-center text-sm font-bold ${color}`}
                      >
                        {icon}
                      </div>
                      <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                        {s.displayName}
                      </div>
                      {isCustom && (
                        <div className="text-[10px] text-text-muted dark:text-dark-text-muted mt-0.5">
                          Custom
                        </div>
                      )}
                      {!s.installed && (
                        <div className="text-[10px] text-error mt-0.5" title={s.installCommand}>
                          Not installed
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const sel = statuses.find((s) => s.provider === provider);
                if (sel && !sel.installed && sel.installCommand) {
                  return (
                    <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs">
                      <p className="text-amber-700 dark:text-amber-400 mb-1">
                        {sel.displayName} is not installed. Run:
                      </p>
                      <code className="block bg-black/20 px-2 py-1 rounded font-mono text-[11px] text-text-primary dark:text-dark-text-primary select-all">
                        {sel.installCommand}
                      </code>
                    </div>
                  );
                }
                if (statuses.length > 0 && !statuses.some((s) => s.installed)) {
                  return (
                    <p className="text-xs text-error mt-2 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      No providers installed. Install at least one CLI tool.
                    </p>
                  );
                }
                return null;
              })()}
            </div>

            {/* Working directory — workspace picker or custom path */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Working Directory
              </label>
              <div className="flex gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setCwdMode('workspace');
                    setCwd('');
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    cwdMode === 'workspace'
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  Workspace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCwdMode('custom');
                    setCwd('');
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    cwdMode === 'custom'
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  Custom Path
                </button>
              </div>

              {cwdMode === 'workspace' ? (
                <div className="space-y-1.5">
                  {workspaces.length === 0 ? (
                    <p className="text-xs text-text-muted dark:text-dark-text-muted py-2">
                      No workspaces found. Use "Custom Path" or create a workspace first.
                    </p>
                  ) : (
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-border dark:border-dark-border">
                      {workspaces.map((ws) => (
                        <button
                          key={ws.id}
                          type="button"
                          onClick={() => setCwd(ws.path)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-border/50 dark:border-dark-border/50 last:border-b-0 ${
                            cwd === ws.path
                              ? 'bg-primary/10 text-primary'
                              : 'text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                          }`}
                        >
                          <div className="font-medium truncate">{ws.name}</div>
                          <div className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
                            {ws.path}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {cwd && (
                    <div className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                      Selected: <span className="font-mono">{cwd}</span>
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="C:\Projects\my-app or /home/user/projects/my-app"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm placeholder-text-muted dark:placeholder-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
              )}
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Task
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what the agent should do..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm placeholder-text-muted dark:placeholder-dark-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Mode toggle */}
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                Mode
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('auto')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    mode === 'auto'
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 inline mr-1.5" />
                  Auto
                  <span className="block text-[10px] mt-0.5 opacity-70">
                    Fully autonomous — agent runs and completes the task
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => ptyAvailable && setMode('interactive')}
                  disabled={!ptyAvailable}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    !ptyAvailable
                      ? 'border-border dark:border-dark-border opacity-40 cursor-not-allowed text-text-muted dark:text-dark-text-muted'
                      : mode === 'interactive'
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  }`}
                  title={!ptyAvailable ? 'Requires node-pty: pnpm add node-pty' : undefined}
                >
                  <Terminal className="w-3.5 h-3.5 inline mr-1.5" />
                  Interactive
                  <span className="block text-[10px] mt-0.5 opacity-70">
                    {ptyAvailable
                      ? 'Full terminal — approve, deny, type commands'
                      : 'Requires node-pty (not installed)'}
                  </span>
                </button>
              </div>
            </div>

            {/* Advanced: Settings File, Skills & Permissions (collapsible) */}
            <div className="border-t border-border dark:border-dark-border pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between text-sm font-medium text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
              >
                <span>Advanced Options</span>
                {showAdvanced ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-4">
                  {/* Settings file */}
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                      Settings File
                    </label>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2">
                      Path to a custom Claude Code settings file (e.g. ~/.claude/kimi.json). Uses
                      default settings if empty.
                    </p>
                    <input
                      type="text"
                      value={settingsFile}
                      onChange={(e) => setSettingsFile(e.target.value)}
                      placeholder="~/.claude/kimi.json"
                      className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-sm placeholder-text-muted dark:placeholder-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                    />
                  </div>

                  {/* Skills selector (lazy-loaded from extensions) */}
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-1.5">
                      Skills / Instructions
                    </label>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2">
                      Attach skills to provide context, coding conventions, or rules.
                    </p>
                    <SkillsSelectorInline selected={selectedSkills} onChange={setSelectedSkills} />
                  </div>

                  {/* Permission controls */}
                  <div>
                    <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                      Permissions
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Autonomy level */}
                      <div>
                        <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                          Autonomy
                        </label>
                        <select
                          value={permissions.autonomy ?? 'semi-auto'}
                          onChange={(e) =>
                            setPermissions((p) => ({
                              ...p,
                              autonomy: e.target.value as CodingAgentPermissions['autonomy'],
                            }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-xs"
                        >
                          <option value="supervised">Supervised (asks approval)</option>
                          <option value="semi-auto">Semi-auto (default)</option>
                          <option value="full-auto">Full auto (no prompts)</option>
                        </select>
                      </div>

                      {/* File access */}
                      <div>
                        <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                          File Access
                        </label>
                        <select
                          value={permissions.file_access ?? 'read-write'}
                          onChange={(e) =>
                            setPermissions((p) => ({
                              ...p,
                              file_access: e.target.value as CodingAgentPermissions['file_access'],
                            }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-xs"
                        >
                          <option value="none">No file access</option>
                          <option value="read-only">Read only</option>
                          <option value="read-write">Read & write</option>
                          <option value="full">Full (incl. delete)</option>
                        </select>
                      </div>

                      {/* Output format */}
                      <div>
                        <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                          Output Format
                        </label>
                        <select
                          value={permissions.output_format ?? 'text'}
                          onChange={(e) =>
                            setPermissions((p) => ({
                              ...p,
                              output_format: e.target
                                .value as CodingAgentPermissions['output_format'],
                            }))
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-xs"
                        >
                          <option value="text">Plain text</option>
                          <option value="json">JSON structured</option>
                          <option value="stream-json">Streaming JSON</option>
                        </select>
                      </div>

                      {/* Toggles column */}
                      <div className="space-y-2">
                        <ToggleSwitch
                          label="Network access"
                          checked={permissions.network_access !== false}
                          onChange={(v) => setPermissions((p) => ({ ...p, network_access: v }))}
                        />
                        <ToggleSwitch
                          label="Shell access"
                          checked={permissions.shell_access !== false}
                          onChange={(v) => setPermissions((p) => ({ ...p, shell_access: v }))}
                        />
                        <ToggleSwitch
                          label="Git access"
                          checked={permissions.git_access !== false}
                          onChange={(v) => setPermissions((p) => ({ ...p, git_access: v }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!provider || !prompt.trim() || creating}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {creating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Start Session
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function SkillsSelectorInline({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [skills, setSkills] = useState<{ id: string; name: string; description?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    import('../../api/endpoints/extensions')
      .then(({ extensionsApi }) => extensionsApi.list())
      .then((data) => {
        setSkills(
          data
            .filter((ext) => ext.status === 'enabled')
            .map((ext) => ({ id: ext.id, name: ext.name, description: ext.description }))
        );
      })
      .catch(silentCatch('codingAgents.extensions'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-xs text-text-muted dark:text-dark-text-muted animate-pulse py-2">
        Loading skills...
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="text-xs text-text-muted dark:text-dark-text-muted py-2">
        No skills installed. Install skills from the Skills Hub.
      </div>
    );
  }

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <div className="max-h-32 overflow-y-auto space-y-1 rounded-lg border border-border dark:border-dark-border p-1.5">
      {skills.map((skill) => {
        const isSelected = selected.includes(skill.id);
        return (
          <button
            key={skill.id}
            type="button"
            onClick={() => toggle(skill.id)}
            className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors ${
              isSelected
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
            }`}
          >
            <div className="font-medium">{skill.name}</div>
            {skill.description && (
              <div className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
                {skill.description}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-xs w-full"
    >
      <div
        className={`w-7 h-4 rounded-full transition-colors relative shrink-0 ${
          checked ? 'bg-primary' : 'bg-border dark:bg-dark-border'
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </div>
      <span
        className={`${checked ? 'text-text-primary dark:text-dark-text-primary' : 'text-text-muted dark:text-dark-text-muted'}`}
      >
        {label}
      </span>
    </button>
  );
}
