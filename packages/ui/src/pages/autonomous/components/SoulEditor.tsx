/**
 * SoulEditor — embedded soul editor for the Agent Profile page.
 *
 * Instead of duplicating the 1400-line SoulEditorPage, this component
 * wraps the essential editing functionality: loads a soul by agentId,
 * provides tab-based editing with dirty state tracking, and save/discard.
 *
 * The full SoulEditorPage remains available at /souls for direct access.
 * This is a simplified inline version for the profile page context.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { soulsApi } from '../../../api/endpoints/souls';
import type { AgentSoul, SoulVersion } from '../../../api/endpoints/souls';
import { Save, X, History, Star } from '../../../components/icons';
import { useToast } from '../../../components/ToastProvider';
import { SkillSelector } from './SkillSelector';

interface Props {
  agentId: string;
}

type TabId =
  | 'identity'
  | 'purpose'
  | 'autonomy'
  | 'heartbeat'
  | 'relationships'
  | 'evolution'
  | 'skills';

const soulTabs: { id: TabId; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'purpose', label: 'Purpose' },
  { id: 'autonomy', label: 'Autonomy' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'evolution', label: 'Evolution' },
  { id: 'skills', label: 'Skills' },
];

const inputClass =
  'w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function SoulEditor({ agentId }: Props) {
  const toast = useToast();
  const [soul, setSoul] = useState<AgentSoul | null>(null);
  const [edited, setEdited] = useState<AgentSoul | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('identity');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [versions, setVersions] = useState<SoulVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [feedbackType, setFeedbackType] = useState('praise');
  const [feedbackContent, setFeedbackContent] = useState('');

  const isDirty = useMemo(() => {
    if (!soul || !edited) return false;
    return JSON.stringify(soul) !== JSON.stringify(edited);
  }, [soul, edited]);

  const fetchSoul = useCallback(async () => {
    try {
      const data = await soulsApi.get(agentId);
      setSoul(data);
      setEdited(deepClone(data));
    } catch {
      setSoul(null);
      toast.error('Failed to load soul data');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchSoul();
  }, [fetchSoul]);

  const updateField = useCallback(
    <K extends keyof AgentSoul>(section: K, field: string, value: unknown) => {
      setEdited((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [section]: { ...(prev[section] as Record<string, unknown>), [field]: value },
        };
      });
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!edited) return;
    setIsSaving(true);
    try {
      const updated = await soulsApi.update(edited.agentId, edited);
      toast.success('Soul saved');
      setSoul(updated);
      setEdited(deepClone(updated));
    } catch {
      toast.error('Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [edited, toast]);

  const handleDiscard = useCallback(() => {
    if (soul) setEdited(deepClone(soul));
  }, [soul]);

  const handleFeedback = useCallback(async () => {
    if (!soul || !feedbackContent.trim()) return;
    try {
      const updated = await soulsApi.feedback(soul.agentId, {
        type: feedbackType,
        content: feedbackContent.trim(),
      });
      toast.success('Feedback applied');
      setSoul(updated);
      setEdited(deepClone(updated));
      setFeedbackContent('');
    } catch {
      toast.error('Failed to apply feedback');
    }
  }, [soul, feedbackType, feedbackContent, toast]);

  if (isLoading) {
    return (
      <p className="text-sm text-text-muted dark:text-dark-text-muted py-8 text-center">
        Loading soul...
      </p>
    );
  }

  if (!soul || !edited) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          This agent doesn't have a soul configured yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full min-w-[800px] max-w-4xl">
      {/* Dirty state bar */}
      {isDirty && (
        <div className="flex items-center gap-3 p-3 bg-warning/10 border border-warning/30 rounded-lg">
          <span className="text-sm text-warning font-medium">Unsaved changes</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleDiscard}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
            >
              <X className="w-3.5 h-3.5" /> Discard
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1 text-xs bg-primary hover:bg-primary-dark text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-border dark:border-dark-border">
        {soulTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={() => {
            if (!showVersions) {
              soulsApi
                .getVersions(agentId)
                .then(setVersions)
                .catch(() => toast.error('Failed to load version history'));
            }
            setShowVersions(!showVersions);
          }}
          className="ml-auto px-3 py-2 text-xs text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <History className="w-3.5 h-3.5 inline mr-1" />
          Versions
        </button>
      </div>

      {/* Version history */}
      {showVersions && (
        <div className="border border-border dark:border-dark-border rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
          <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Version History
          </h4>
          {versions.length === 0 ? (
            <p className="text-xs text-text-muted dark:text-dark-text-muted italic">
              No versions recorded yet.
            </p>
          ) : (
            versions.map((v) => (
              <div
                key={v.id}
                className="text-xs flex items-center gap-2 text-text-muted dark:text-dark-text-muted"
              >
                <span>v{v.version}</span>
                <span>{v.changeReason || '—'}</span>
                <span className="ml-auto">{new Date(v.createdAt).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'identity' && (
        <div className="space-y-3">
          <FieldGroup label="Name">
            <input
              type="text"
              value={edited.identity.name}
              onChange={(e) => updateField('identity', 'name', e.target.value)}
              className={inputClass}
            />
          </FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="Emoji">
              <input
                type="text"
                value={edited.identity.emoji}
                onChange={(e) => updateField('identity', 'emoji', e.target.value)}
                className={inputClass}
                maxLength={4}
              />
            </FieldGroup>
            <FieldGroup label="Role">
              <input
                type="text"
                value={edited.identity.role}
                onChange={(e) => updateField('identity', 'role', e.target.value)}
                className={inputClass}
              />
            </FieldGroup>
          </div>
          <FieldGroup label="Personality">
            <textarea
              value={edited.identity.personality}
              onChange={(e) => updateField('identity', 'personality', e.target.value)}
              rows={3}
              className={inputClass}
            />
          </FieldGroup>
          <FieldGroup label="Backstory">
            <textarea
              value={edited.identity.backstory || ''}
              onChange={(e) => updateField('identity', 'backstory', e.target.value || undefined)}
              rows={2}
              className={inputClass}
            />
          </FieldGroup>
        </div>
      )}

      {activeTab === 'purpose' && (
        <div className="space-y-3">
          <FieldGroup label="Mission">
            <textarea
              value={edited.purpose.mission}
              onChange={(e) => updateField('purpose', 'mission', e.target.value)}
              rows={3}
              className={inputClass}
            />
          </FieldGroup>
          <FieldGroup label="Goals">
            <TagList
              items={edited.purpose.goals}
              onChange={(v) => updateField('purpose', 'goals', v)}
              placeholder="Add goal..."
            />
          </FieldGroup>
          <FieldGroup label="Expertise">
            <TagList
              items={edited.purpose.expertise}
              onChange={(v) => updateField('purpose', 'expertise', v)}
              placeholder="Add area..."
            />
          </FieldGroup>
        </div>
      )}

      {activeTab === 'autonomy' && (
        <div className="space-y-3">
          <FieldGroup label={`Autonomy Level: ${edited.autonomy.level}`}>
            <input
              type="range"
              min={0}
              max={4}
              value={edited.autonomy.level}
              onChange={(e) => updateField('autonomy', 'level', Number(e.target.value))}
              className="w-full"
            />
          </FieldGroup>
          <div className="grid grid-cols-3 gap-3">
            <FieldGroup label="Max $/cycle">
              <input
                type="number"
                value={edited.autonomy.maxCostPerCycle}
                onChange={(e) => updateField('autonomy', 'maxCostPerCycle', Number(e.target.value))}
                step={0.1}
                className={inputClass}
              />
            </FieldGroup>
            <FieldGroup label="Max $/day">
              <input
                type="number"
                value={edited.autonomy.maxCostPerDay}
                onChange={(e) => updateField('autonomy', 'maxCostPerDay', Number(e.target.value))}
                step={1}
                className={inputClass}
              />
            </FieldGroup>
            <FieldGroup label="Max $/month">
              <input
                type="number"
                value={edited.autonomy.maxCostPerMonth}
                onChange={(e) => updateField('autonomy', 'maxCostPerMonth', Number(e.target.value))}
                step={10}
                className={inputClass}
              />
            </FieldGroup>
          </div>
          <FieldGroup label="Allowed Actions">
            <TagList
              items={edited.autonomy.allowedActions}
              onChange={(v) => updateField('autonomy', 'allowedActions', v)}
              placeholder="Add action..."
            />
          </FieldGroup>
          <FieldGroup label="Blocked Actions">
            <TagList
              items={edited.autonomy.blockedActions}
              onChange={(v) => updateField('autonomy', 'blockedActions', v)}
              placeholder="Add blocked..."
            />
          </FieldGroup>
        </div>
      )}

      {activeTab === 'heartbeat' && (
        <div className="space-y-3">
          <FieldGroup label="Enabled">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={edited.heartbeat.enabled}
                onChange={(e) => updateField('heartbeat', 'enabled', e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-text-primary dark:text-dark-text-primary">
                {edited.heartbeat.enabled ? 'Active' : 'Disabled'}
              </span>
            </label>
          </FieldGroup>
          <FieldGroup label="Cron Interval">
            <input
              type="text"
              value={edited.heartbeat.interval}
              onChange={(e) => updateField('heartbeat', 'interval', e.target.value)}
              placeholder="0 */6 * * *"
              className={inputClass}
            />
          </FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="Self-Healing">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={edited.heartbeat.selfHealingEnabled}
                  onChange={(e) => updateField('heartbeat', 'selfHealingEnabled', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-text-primary dark:text-dark-text-primary">
                  Enabled
                </span>
              </label>
            </FieldGroup>
            <FieldGroup label="Max Duration (ms)">
              <input
                type="number"
                value={edited.heartbeat.maxDurationMs}
                onChange={(e) => updateField('heartbeat', 'maxDurationMs', Number(e.target.value))}
                className={inputClass}
              />
            </FieldGroup>
          </div>
          {edited.heartbeat.checklist.length > 0 && (
            <FieldGroup label={`Tasks (${edited.heartbeat.checklist.length})`}>
              <div className="space-y-1">
                {edited.heartbeat.checklist.map((t) => (
                  <div
                    key={t.id}
                    className="text-xs flex items-center gap-2 p-2 rounded border border-border dark:border-dark-border"
                  >
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {t.name}
                    </span>
                    <span className="text-text-muted dark:text-dark-text-muted">{t.schedule}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary ml-auto">
                      {t.priority}
                    </span>
                  </div>
                ))}
              </div>
            </FieldGroup>
          )}
        </div>
      )}

      {activeTab === 'relationships' && (
        <div className="space-y-3">
          <FieldGroup label="Reports To">
            <input
              type="text"
              value={edited.relationships.reportsTo || ''}
              onChange={(e) =>
                updateField('relationships', 'reportsTo', e.target.value || undefined)
              }
              placeholder="Agent ID of supervisor"
              className={inputClass}
            />
          </FieldGroup>
          <FieldGroup label="Delegates">
            <TagList
              items={edited.relationships.delegates}
              onChange={(v) => updateField('relationships', 'delegates', v)}
              placeholder="Add delegate..."
            />
          </FieldGroup>
          <FieldGroup label="Peers">
            <TagList
              items={edited.relationships.peers}
              onChange={(v) => updateField('relationships', 'peers', v)}
              placeholder="Add peer..."
            />
          </FieldGroup>
          {edited.relationships.crewId && (
            <FieldGroup label="Crew ID">
              <p className="text-sm text-text-primary dark:text-dark-text-primary">
                {edited.relationships.crewId}
              </p>
            </FieldGroup>
          )}
        </div>
      )}

      {activeTab === 'evolution' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <FieldGroup label="Version">
              <p className="text-sm text-text-primary dark:text-dark-text-primary font-medium">
                {edited.evolution.version}
              </p>
            </FieldGroup>
            <FieldGroup label="Mode">
              <p className="text-sm text-text-primary dark:text-dark-text-primary">
                {edited.evolution.evolutionMode}
              </p>
            </FieldGroup>
            <FieldGroup label="Core Traits">
              <p className="text-sm text-text-primary dark:text-dark-text-primary">
                {edited.evolution.coreTraits.join(', ') || '—'}
              </p>
            </FieldGroup>
          </div>

          {/* Feedback form */}
          <div className="border border-border dark:border-dark-border rounded-lg p-3 space-y-2">
            <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
              Give Feedback
            </h4>
            <div className="flex gap-2">
              {['praise', 'correction', 'directive', 'personality_tweak'].map((t) => (
                <button
                  key={t}
                  onClick={() => setFeedbackType(t)}
                  className={`px-2 py-1 text-xs rounded ${
                    feedbackType === t
                      ? 'bg-primary text-white'
                      : 'bg-bg-primary dark:bg-dark-bg-primary text-text-muted dark:text-dark-text-muted border border-border dark:border-dark-border'
                  }`}
                >
                  {t === 'personality_tweak' ? 'tweak' : t}
                </button>
              ))}
            </div>
            <textarea
              value={feedbackContent}
              onChange={(e) => setFeedbackContent(e.target.value)}
              placeholder="Your feedback..."
              rows={2}
              className={inputClass}
            />
            <button
              onClick={handleFeedback}
              disabled={!feedbackContent.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50"
            >
              <Star className="w-3 h-3" />
              Apply Feedback
            </button>
          </div>

          {/* Learnings */}
          {edited.evolution.learnings.length > 0 && (
            <FieldGroup label="Learnings">
              <ul className="text-xs text-text-muted dark:text-dark-text-muted space-y-1">
                {edited.evolution.learnings.slice(-10).map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            </FieldGroup>
          )}
        </div>
      )}

      {activeTab === 'skills' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              Skill Access
            </h4>
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              {edited.skillAccess?.allowed?.length || 0} skills enabled
            </span>
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Select which skills this agent can access. Skills provide additional tools and
            capabilities.
          </p>
          <SkillSelector
            selectedSkills={edited.skillAccess?.allowed || []}
            onChange={(skillIds) => updateField('skillAccess', 'allowed', skillIds)}
          />
          {edited.skillAccess?.blocked && edited.skillAccess.blocked.length > 0 && (
            <FieldGroup label="Blocked Skills">
              <div className="flex flex-wrap gap-1">
                {edited.skillAccess.blocked.map((skillId) => (
                  <span
                    key={skillId}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-danger/10 text-danger"
                  >
                    {skillId}
                  </span>
                ))}
              </div>
            </FieldGroup>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Shared sub-components
// =============================================================================

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function TagList({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const tag = input.trim();
    if (tag && !items.includes(tag)) {
      onChange([...items, tag]);
    }
    setInput('');
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-primary/10 text-primary"
          >
            {item}
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label={`Remove ${item}`}
              className="hover:text-danger"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addTag();
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}
