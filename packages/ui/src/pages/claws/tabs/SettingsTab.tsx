import { useState, useEffect } from 'react';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { clawsApi } from '../../../api/endpoints/claws';
import { useToast } from '../../../components/ToastProvider';
import { Save, Settings2, Activity, Shield, BookOpen } from '../../../components/icons';
import { labelClass as lbl, inputClass as ic } from '../utils';

const splitLines = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export function SettingsTab({
  claw,
  models,
  configuredProviders,
  onSaved,
}: {
  claw: ClawConfig;
  models: Array<{ id: string; name: string; provider: string; recommended?: boolean }>;
  configuredProviders: string[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [editMission, setEditMission] = useState(claw.mission);
  const [editMode, setEditMode] = useState(claw.mode);
  const [editSandbox, setEditSandbox] = useState(claw.sandbox);
  const [editCodingAgent, setEditCodingAgent] = useState(claw.codingAgentProvider ?? '');
  const [editIntervalMs, setEditIntervalMs] = useState(claw.intervalMs ?? 300_000);
  const [editEventFilters, setEditEventFilters] = useState((claw.eventFilters ?? []).join(', '));
  const [editAutoStart, setEditAutoStart] = useState(claw.autoStart);
  const [editStopCondition, setEditStopCondition] = useState(claw.stopCondition ?? '');
  const [editProvider, setEditProvider] = useState(claw.provider ?? '');
  const [editModel, setEditModel] = useState(claw.model ?? '');
  const [editBudget, setEditBudget] = useState(claw.limits.totalBudgetUsd ?? 0);
  const [editMaxTurns, setEditMaxTurns] = useState(claw.limits.maxTurnsPerCycle);
  const [editMaxToolCalls, setEditMaxToolCalls] = useState(claw.limits.maxToolCallsPerCycle);
  const [editSuccessCriteria, setEditSuccessCriteria] = useState(
    (claw.missionContract?.successCriteria ?? []).join('\n')
  );
  const [editDeliverables, setEditDeliverables] = useState(
    (claw.missionContract?.deliverables ?? []).join('\n')
  );
  const [editConstraints, setEditConstraints] = useState(
    (claw.missionContract?.constraints ?? []).join('\n')
  );
  const [editEscalationRules, setEditEscalationRules] = useState(
    (claw.missionContract?.escalationRules ?? []).join('\n')
  );
  const [editEvidenceRequired, setEditEvidenceRequired] = useState(
    claw.missionContract?.evidenceRequired ?? true
  );
  const [editMinConfidence, setEditMinConfidence] = useState(
    claw.missionContract?.minConfidence ?? 0.8
  );
  const [editAllowSelfModify, setEditAllowSelfModify] = useState(
    claw.autonomyPolicy?.allowSelfModify ?? false
  );
  const [editAllowSubclaws, setEditAllowSubclaws] = useState(
    claw.autonomyPolicy?.allowSubclaws ?? true
  );
  const [editDestructivePolicy, setEditDestructivePolicy] = useState<'ask' | 'block' | 'allow'>(
    claw.autonomyPolicy?.destructiveActionPolicy ?? 'ask'
  );
  const [editMaxCostBeforePause, setEditMaxCostBeforePause] = useState(
    claw.autonomyPolicy?.maxCostUsdBeforePause ?? 0
  );
  const [isSaving, setIsSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'general' | 'ai' | 'autonomy' | 'contract'>(
    'general'
  );

  useEffect(() => {
    setEditMission(claw.mission);
    setEditMode(claw.mode);
    setEditSandbox(claw.sandbox);
    setEditCodingAgent(claw.codingAgentProvider ?? '');
    setEditIntervalMs(claw.intervalMs ?? 300_000);
    setEditEventFilters((claw.eventFilters ?? []).join(', '));
    setEditAutoStart(claw.autoStart);
    setEditStopCondition(claw.stopCondition ?? '');
    setEditProvider(claw.provider ?? '');
    setEditModel(claw.model ?? '');
    setEditBudget(claw.limits.totalBudgetUsd ?? 0);
    setEditMaxTurns(claw.limits.maxTurnsPerCycle);
    setEditMaxToolCalls(claw.limits.maxToolCallsPerCycle);
    setEditSuccessCriteria((claw.missionContract?.successCriteria ?? []).join('\n'));
    setEditDeliverables((claw.missionContract?.deliverables ?? []).join('\n'));
    setEditConstraints((claw.missionContract?.constraints ?? []).join('\n'));
    setEditEscalationRules((claw.missionContract?.escalationRules ?? []).join('\n'));
    setEditEvidenceRequired(claw.missionContract?.evidenceRequired ?? true);
    setEditMinConfidence(claw.missionContract?.minConfidence ?? 0.8);
    setEditAllowSelfModify(claw.autonomyPolicy?.allowSelfModify ?? false);
    setEditAllowSubclaws(claw.autonomyPolicy?.allowSubclaws ?? true);
    setEditDestructivePolicy(claw.autonomyPolicy?.destructiveActionPolicy ?? 'ask');
    setEditMaxCostBeforePause(claw.autonomyPolicy?.maxCostUsdBeforePause ?? 0);
  }, [claw.id]);

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      await clawsApi.update(claw.id, {
        mission: editMission,
        mode: editMode,
        sandbox: editSandbox,
        coding_agent_provider: editCodingAgent || null,
        provider: editProvider || null,
        model: editModel || null,
        interval_ms: editMode === 'interval' ? editIntervalMs : undefined,
        event_filters:
          editMode === 'event' && editEventFilters.trim()
            ? editEventFilters
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        auto_start: editAutoStart,
        stop_condition: editStopCondition.trim() || null,
        mission_contract: {
          successCriteria: splitLines(editSuccessCriteria),
          deliverables: splitLines(editDeliverables),
          constraints: splitLines(editConstraints),
          escalationRules: splitLines(editEscalationRules),
          evidenceRequired: editEvidenceRequired,
          minConfidence: editMinConfidence,
        },
        autonomy_policy: {
          allowSelfModify: editAllowSelfModify,
          allowSubclaws: editAllowSubclaws,
          requireEvidence: editEvidenceRequired,
          destructiveActionPolicy: editDestructivePolicy,
          filesystemScopes: claw.autonomyPolicy?.filesystemScopes ?? [],
          maxCostUsdBeforePause: editMaxCostBeforePause > 0 ? editMaxCostBeforePause : undefined,
        },
        limits: {
          ...claw.limits,
          totalBudgetUsd: editBudget > 0 ? editBudget : undefined,
          maxTurnsPerCycle: editMaxTurns,
          maxToolCallsPerCycle: editMaxToolCalls,
        },
      });
      toast.success('Settings saved');
      onSaved();
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const sectionTab = (
    id: 'general' | 'ai' | 'autonomy' | 'contract',
    label: string,
    icon: React.ReactNode
  ) => (
    <button
      key={id}
      onClick={() => setActiveSection(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        activeSection === id
          ? 'bg-primary/10 text-primary border border-primary/20'
          : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Section tabs */}
      <div className="flex items-center gap-2 border-b border-border dark:border-dark-border pb-2">
        {sectionTab('general', 'General', <Settings2 className="w-3.5 h-3.5" />)}
        {sectionTab('ai', 'AI Model', <Activity className="w-3.5 h-3.5" />)}
        {sectionTab('autonomy', 'Autonomy', <Shield className="w-3.5 h-3.5" />)}
        {sectionTab('contract', 'Contract', <BookOpen className="w-3.5 h-3.5" />)}
      </div>

      {/* === GENERAL === */}
      {activeSection === 'general' && (
        <div className="space-y-4">
          <div>
            <label className={lbl}>Mission</label>
            <textarea
              value={editMission}
              onChange={(e) => setEditMission(e.target.value)}
              rows={5}
              className={`${ic} resize-none`}
              placeholder="What should this claw do?"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className={lbl}>Mode</label>
              <select
                value={editMode}
                onChange={(e) => setEditMode(e.target.value as typeof editMode)}
                className={ic}
              >
                <option value="single-shot">Single-shot</option>
                <option value="continuous">Continuous</option>
                <option value="interval">Interval</option>
                <option value="event">Event-driven</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Sandbox</label>
              <select
                value={editSandbox}
                onChange={(e) => setEditSandbox(e.target.value as typeof editSandbox)}
                className={ic}
              >
                <option value="auto">Auto</option>
                <option value="docker">Docker</option>
                <option value="local">Local</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Coding Agent</label>
              <select
                value={editCodingAgent}
                onChange={(e) => setEditCodingAgent(e.target.value)}
                className={ic}
              >
                <option value="">None</option>
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex CLI</option>
                <option value="gemini-cli">Gemini CLI</option>
              </select>
            </div>
            <div>
              <label className={lbl}>Auto-start</label>
              <label className="flex items-center gap-2 h-full px-3">
                <input
                  type="checkbox"
                  checked={editAutoStart}
                  onChange={(e) => setEditAutoStart(e.target.checked)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm">Start on boot</span>
              </label>
            </div>
          </div>

          {editMode === 'interval' && (
            <div>
              <label className={lbl}>Interval (seconds)</label>
              <input
                type="number"
                value={Math.round(editIntervalMs / 1000)}
                onChange={(e) => setEditIntervalMs(Number(e.target.value) * 1000)}
                min={10}
                className={ic}
              />
            </div>
          )}

          {editMode === 'event' && (
            <div>
              <label className={lbl}>Event Filters (comma-separated)</label>
              <input
                value={editEventFilters}
                onChange={(e) => setEditEventFilters(e.target.value)}
                placeholder="user.message, webhook.received"
                className={ic}
              />
            </div>
          )}

          <div>
            <label className={lbl}>Stop Condition</label>
            <input
              value={editStopCondition}
              onChange={(e) => setEditStopCondition(e.target.value)}
              placeholder="e.g. max_cycles:100, on_report, idle:3"
              className={ic}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Max Turns/Cycle</label>
              <input
                type="number"
                value={editMaxTurns}
                onChange={(e) => setEditMaxTurns(Number(e.target.value))}
                min={1}
                max={500}
                className={ic}
              />
            </div>
            <div>
              <label className={lbl}>Max Tool Calls/Cycle</label>
              <input
                type="number"
                value={editMaxToolCalls}
                onChange={(e) => setEditMaxToolCalls(Number(e.target.value))}
                min={1}
                max={2000}
                className={ic}
              />
            </div>
          </div>

          <div>
            <label className={lbl}>Total Budget (USD)</label>
            <input
              type="number"
              value={editBudget}
              onChange={(e) => setEditBudget(Number(e.target.value))}
              min={0}
              step={0.1}
              className={ic}
              placeholder="0 = no limit"
            />
          </div>
        </div>
      )}

      {/* === AI MODEL === */}
      {activeSection === 'ai' && (
        <div className="space-y-4">
          <div>
            <label className={lbl}>AI Provider</label>
            <select
              value={editProvider}
              onChange={(e) => {
                setEditProvider(e.target.value);
                setEditModel('');
              }}
              className={ic}
            >
              <option value="">System Default (pulse)</option>
              {configuredProviders.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {!editProvider && (
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                Uses system model routing. Set a provider to override.
              </p>
            )}
          </div>

          <div>
            <label className={lbl}>AI Model</label>
            <select
              value={editModel}
              onChange={(e) => setEditModel(e.target.value)}
              disabled={!editProvider}
              className={ic}
            >
              <option value="">System Default</option>
              {editProvider &&
                models
                  .filter((m) => !editProvider || m.provider === editProvider)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.recommended ? ' ★' : ''}
                      {!editProvider ? ` (${m.provider})` : ''}
                    </option>
                  ))}
            </select>
          </div>

          <div className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Model selection requires a provider. The claw will use system defaults when no
              provider/model is selected. Set both to lock the model for this claw.
            </p>
          </div>
        </div>
      )}

      {/* === AUTONOMY === */}
      {activeSection === 'autonomy' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border cursor-pointer">
              <input
                type="checkbox"
                checked={editAllowSubclaws}
                onChange={(e) => setEditAllowSubclaws(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Sub-claws
                </span>
                <p className="text-xs text-text-muted">Allow spawning child claws</p>
              </div>
            </label>
            <label className="flex items-center gap-2 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border cursor-pointer">
              <input
                type="checkbox"
                checked={editAllowSelfModify}
                onChange={(e) => setEditAllowSelfModify(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Self-modify
                </span>
                <p className="text-xs text-text-muted">Allow modifying own config</p>
              </div>
            </label>
          </div>

          <div>
            <label className={lbl}>Destructive Action Policy</label>
            <select
              value={editDestructivePolicy}
              onChange={(e) =>
                setEditDestructivePolicy(e.target.value as 'ask' | 'block' | 'allow')
              }
              className={ic}
            >
              <option value="ask">Ask before destructive actions</option>
              <option value="block">Block all destructive actions</option>
              <option value="allow">Allow destructive actions</option>
            </select>
          </div>

          <div>
            <label className={lbl}>Max Cost Before Escalation ($)</label>
            <input
              type="number"
              value={editMaxCostBeforePause}
              onChange={(e) => setEditMaxCostBeforePause(Number(e.target.value))}
              min={0}
              step={0.1}
              className={ic}
              placeholder="0 = no limit"
            />
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
              Escalate when cost exceeds this threshold. 0 = disabled.
            </p>
          </div>

          {claw.autonomyPolicy?.filesystemScopes &&
            claw.autonomyPolicy.filesystemScopes.length > 0 && (
              <div>
                <label className={lbl}>Filesystem Scopes</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {claw.autonomyPolicy.filesystemScopes.map((scope) => (
                    <span
                      key={scope}
                      className="px-2 py-0.5 text-xs bg-gray-500/10 text-gray-600 rounded font-mono"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              </div>
            )}
        </div>
      )}

      {/* === CONTRACT === */}
      {activeSection === 'contract' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Success Criteria</label>
              <textarea
                value={editSuccessCriteria}
                onChange={(e) => setEditSuccessCriteria(e.target.value)}
                rows={4}
                placeholder="One criterion per line"
                className={`${ic} resize-none`}
              />
            </div>
            <div>
              <label className={lbl}>Deliverables</label>
              <textarea
                value={editDeliverables}
                onChange={(e) => setEditDeliverables(e.target.value)}
                rows={4}
                placeholder="One deliverable per line"
                className={`${ic} resize-none`}
              />
            </div>
          </div>

          <div>
            <label className={lbl}>Constraints</label>
            <textarea
              value={editConstraints}
              onChange={(e) => setEditConstraints(e.target.value)}
              rows={3}
              placeholder="One constraint per line"
              className={`${ic} resize-none`}
            />
          </div>

          <div>
            <label className={lbl}>Escalation Rules</label>
            <textarea
              value={editEscalationRules}
              onChange={(e) => setEditEscalationRules(e.target.value)}
              rows={3}
              placeholder="When to escalate (one rule per line)"
              className={`${ic} resize-none`}
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editEvidenceRequired}
                onChange={(e) => setEditEvidenceRequired(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <span className="text-sm">Evidence required</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm">Min confidence:</span>
              <input
                type="number"
                value={editMinConfidence}
                onChange={(e) => setEditMinConfidence(Number(e.target.value))}
                min={0.1}
                max={1}
                step={0.05}
                className="w-16 px-2 py-1 text-sm rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
              />
            </div>
          </div>
        </div>
      )}

      <button
        onClick={saveSettings}
        disabled={isSaving}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        {isSaving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
