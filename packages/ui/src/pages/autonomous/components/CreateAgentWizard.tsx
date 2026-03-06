/**
 * CreateAgentWizard — multi-step modal for creating soul or background agents
 */

import { useState, useEffect } from 'react';
import { soulsApi, crewsApi } from '../../../api/endpoints/souls';
import type { CrewTemplate } from '../../../api/endpoints/souls';
import { backgroundAgentsApi } from '../../../api/endpoints/background-agents';
import { settingsApi } from '../../../api/endpoints/settings';
import { Bot, Repeat, X, ChevronRight, CheckCircle2, BookOpen } from '../../../components/icons';
import { useToast } from '../../../components/ToastProvider';
import type { AgentKind } from '../types';
import type { AgentTemplate } from '../data/agent-templates';
import { TemplateCatalog } from './TemplateCatalog';
import { SkillSelector } from './SkillSelector';
import { cronToHuman } from '../helpers';

async function getDefaultProviderModel(): Promise<{ provider: string; model: string }> {
  const settings = await settingsApi.get();
  return {
    provider: settings.defaultProvider || 'openai',
    model: settings.defaultModel || 'gpt-4o',
  };
}

interface Props {
  templates: CrewTemplate[];
  initialStep?: 'type' | 'templates';
  onClose: () => void;
  onCreated: () => void;
  prefilledTemplate?: AgentTemplate;
}

type Step = 'type' | 'templates' | 'identity' | 'config' | 'skills' | 'review';

export function CreateAgentWizard({
  templates,
  initialStep,
  onClose,
  onCreated,
  prefilledTemplate,
}: Props) {
  const toast = useToast();
  const [step, setStep] = useState<Step>(prefilledTemplate ? 'review' : (initialStep ?? 'type'));
  const [kind, setKind] = useState<AgentKind>(prefilledTemplate?.kind ?? 'soul');
  const [isCreating, setIsCreating] = useState(false);
  const [cameFromTemplates, setCameFromTemplates] = useState(!!prefilledTemplate);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Soul fields — pre-fill from template if provided
  const [name, setName] = useState(prefilledTemplate?.name ?? '');
  const [emoji, setEmoji] = useState(prefilledTemplate?.emoji ?? '🤖');
  const [role, setRole] = useState(prefilledTemplate?.role ?? '');
  const [personality, setPersonality] = useState(prefilledTemplate?.personality ?? '');
  const [mission, setMission] = useState(prefilledTemplate?.mission ?? '');
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatInterval, setHeartbeatInterval] = useState(
    prefilledTemplate?.heartbeatInterval ?? '0 */6 * * *'
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Skills selection
  const [selectedSkills, setSelectedSkills] = useState<string[]>(prefilledTemplate?.skills ?? []);

  // Template-derived fields (tools, autonomy, etc.)
  const [templateTools, setTemplateTools] = useState<string[]>(prefilledTemplate?.tools ?? []);
  const [templateAutonomyLevel, setTemplateAutonomyLevel] = useState<number>(
    prefilledTemplate?.autonomyLevel ?? 2
  );
  const [templateProvider, setTemplateProvider] = useState<string | undefined>(
    prefilledTemplate?.provider
  );
  const [templateModel, setTemplateModel] = useState<string | undefined>(prefilledTemplate?.model);

  // Background agent fields
  const [bgMission, setBgMission] = useState(prefilledTemplate?.mission ?? '');
  const [bgMode, setBgMode] = useState<'continuous' | 'interval' | 'event'>(
    prefilledTemplate?.bgMode ?? 'interval'
  );
  const [bgIntervalMs, setBgIntervalMs] = useState(prefilledTemplate?.bgIntervalMs ?? 300000);

  /** Apply a template to all form fields and jump to review */
  const applyTemplate = (t: AgentTemplate) => {
    setKind(t.kind);
    setName(t.name);
    setEmoji(t.emoji);
    setRole(t.role);
    setPersonality(t.personality);
    setMission(t.mission);
    setHeartbeatInterval(t.heartbeatInterval);
    setHeartbeatEnabled(true);
    // Set template-derived fields
    setTemplateTools(t.tools ?? []);
    setTemplateAutonomyLevel(t.autonomyLevel ?? 2);
    setTemplateProvider(t.provider);
    setTemplateModel(t.model);
    if (t.kind === 'background') {
      setBgMission(t.mission);
      setBgMode(t.bgMode ?? 'interval');
      setBgIntervalMs(t.bgIntervalMs ?? 300000);
    }
    // Set skills from template
    setSelectedSkills(t.skills ?? []);
    setCameFromTemplates(true);
    setStep('review');
  };

  const inputClass =
    'w-full rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

  const handleCreateSoul = async () => {
    setIsCreating(true);
    try {
      // Use template provider/model or fetch defaults
      const defaults = await getDefaultProviderModel();
      const provider = templateProvider || defaults.provider;
      const model = templateModel || defaults.model;

      await soulsApi.deploy({
        identity: {
          name,
          emoji,
          role,
          personality,
          voice: { tone: 'professional', language: 'en' },
          boundaries: [],
        },
        purpose: {
          mission,
          goals: [],
          expertise: [],
          toolPreferences: templateTools,
        },
        autonomy: {
          level: templateAutonomyLevel,
          allowedActions:
            templateTools.length > 0
              ? templateTools
              : ['search_web', 'create_memory', 'search_memories'],
          blockedActions: ['delete_data', 'execute_code'],
          requiresApproval: templateAutonomyLevel <= 1 ? ['send_message_to_user'] : [],
          maxCostPerCycle: 0.5,
          maxCostPerDay: 5.0,
          maxCostPerMonth: 100.0,
        },
        heartbeat: {
          enabled: heartbeatEnabled,
          interval: heartbeatInterval,
          checklist: [],
          selfHealingEnabled: true,
          maxDurationMs: 120000,
        },
        relationships: { delegates: [], peers: [], channels: [] },
        evolution: {
          evolutionMode: 'supervised',
          coreTraits: personality ? [personality] : [],
          mutableTraits: [],
        },
        bootSequence: { onStart: [], onHeartbeat: ['read_inbox'], onMessage: [] },
        skillAccess: {
          allowed: selectedSkills,
          blocked: [],
        },
        provider,
        model,
      });
      toast.success(`Soul agent "${name}" created`);
      onCreated();
      onClose();
    } catch {
      toast.error('Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateBackground = async () => {
    setIsCreating(true);
    try {
      // Use template provider/model or fetch defaults
      const defaults = await getDefaultProviderModel();
      const provider = templateProvider || defaults.provider;
      const model = templateModel || defaults.model;

      await backgroundAgentsApi.create({
        name,
        mission: bgMission,
        mode: bgMode,
        interval_ms: bgMode === 'interval' ? bgIntervalMs : undefined,
        auto_start: false,
        allowed_tools: templateTools,
        provider,
        model,
      });
      toast.success(`Background agent "${name}" created`);
      onCreated();
      onClose();
    } catch {
      toast.error('Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeployTemplate = async (templateId?: string) => {
    const deployId = templateId || selectedTemplateId;
    if (!deployId) return;
    setIsCreating(true);
    try {
      await crewsApi.deploy(deployId);
      toast.success('Crew deployed from template');
      onCreated();
      onClose();
    } catch {
      toast.error('Failed to deploy crew');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-2xl w-full mx-4 max-h-[90vh] overflow-y-auto ${
          step === 'templates' ? 'max-w-4xl' : 'max-w-lg'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-dark-border">
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Create Agent
          </h2>
          <button
            onClick={onClose}
            aria-label="Close wizard"
            className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Step: Type */}
          {step === 'type' && (
            <>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Choose how to create your agent
              </p>
              <div className="space-y-3">
                {/* Browse Templates — quickest path */}
                <button
                  onClick={() => setStep('templates')}
                  className="w-full text-left p-4 rounded-xl border-2 border-primary/40 bg-primary/5 hover:border-primary transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <BookOpen className="w-6 h-6 text-primary" />
                    <div>
                      <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
                        Browse Templates
                      </h3>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                        Pick from 16+ ready-made agents — one click to create
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-muted ml-auto" />
                  </div>
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border dark:border-dark-border" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-bg-primary dark:bg-dark-bg-primary px-2 text-xs text-text-muted dark:text-dark-text-muted">
                      or create from scratch
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setKind('soul');
                    setStep('identity');
                  }}
                  className="w-full text-left p-4 rounded-xl border-2 border-border dark:border-dark-border hover:border-primary transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Bot className="w-6 h-6 text-primary" />
                    <div>
                      <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
                        Soul Agent
                      </h3>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                        Rich personality with heartbeat cycles. Ideal for scheduled tasks like daily
                        briefings, research monitoring, or periodic reviews.
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-muted ml-auto" />
                  </div>
                </button>
                <button
                  onClick={() => {
                    setKind('background');
                    setStep('identity');
                  }}
                  className="w-full text-left p-4 rounded-xl border-2 border-border dark:border-dark-border hover:border-primary transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Repeat className="w-6 h-6 text-text-muted dark:text-dark-text-muted" />
                    <div>
                      <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
                        Background Agent
                      </h3>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                        Lightweight worker that runs continuously, on an interval, or on demand.
                        Great for monitoring, data processing, or event-driven tasks.
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-muted ml-auto" />
                  </div>
                </button>
                {templates.length > 0 && (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border dark:border-dark-border" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-bg-primary dark:bg-dark-bg-primary px-2 text-xs text-text-muted dark:text-dark-text-muted">
                          or deploy a crew template
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setSelectedTemplateId(t.id)}
                          className={`text-left p-3 rounded-lg border-2 transition-colors ${
                            selectedTemplateId === t.id
                              ? 'border-primary bg-primary/5'
                              : 'border-border dark:border-dark-border hover:border-primary/50'
                          }`}
                        >
                          <span className="text-lg">{t.emoji}</span>
                          <h4 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mt-1">
                            {t.name}
                          </h4>
                          <p className="text-xs text-text-muted dark:text-dark-text-muted">
                            {t.agents.length} agents
                          </p>
                        </button>
                      ))}
                    </div>
                    {selectedTemplateId && (
                      <button
                        onClick={() => handleDeployTemplate()}
                        disabled={isCreating}
                        className="w-full flex items-center justify-center gap-2 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {isCreating ? 'Deploying...' : 'Deploy Crew'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* Step: Templates */}
          {step === 'templates' && (
            <TemplateCatalog
              onSelect={applyTemplate}
              crewTemplates={templates}
              onDeployCrew={(id) => handleDeployTemplate(id)}
            />
          )}

          {/* Step: Identity */}
          {step === 'identity' && (
            <>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                {kind === 'soul'
                  ? 'Give your agent a name, role, and personality. This defines who it is and how it communicates.'
                  : 'Name your agent and describe its mission — what should it do when it runs?'}
              </p>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                      Emoji
                    </label>
                    <input
                      type="text"
                      value={emoji}
                      onChange={(e) => setEmoji(e.target.value)}
                      className={inputClass}
                      maxLength={4}
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                      Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Dr. Nova"
                      className={inputClass}
                    />
                  </div>
                </div>
                {kind === 'soul' && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                        Role
                      </label>
                      <input
                        type="text"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        placeholder="Research Lead"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                        Personality
                      </label>
                      <textarea
                        value={personality}
                        onChange={(e) => setPersonality(e.target.value)}
                        placeholder="Curious, methodical, detail-oriented..."
                        rows={2}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                        Mission
                      </label>
                      <textarea
                        value={mission}
                        onChange={(e) => setMission(e.target.value)}
                        placeholder="Research and summarize the latest developments in..."
                        rows={2}
                        className={inputClass}
                      />
                    </div>
                  </>
                )}
                {kind === 'background' && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                        Mission
                      </label>
                      <textarea
                        value={bgMission}
                        onChange={(e) => setBgMission(e.target.value)}
                        placeholder="Monitor and process incoming data..."
                        rows={3}
                        className={inputClass}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                          Mode
                        </label>
                        <select
                          value={bgMode}
                          onChange={(e) => setBgMode(e.target.value as typeof bgMode)}
                          className={inputClass}
                        >
                          <option value="continuous">Continuous</option>
                          <option value="interval">Interval</option>
                          <option value="event">Event-Driven</option>
                        </select>
                      </div>
                      {bgMode === 'interval' && (
                        <div>
                          <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                            Interval (min)
                          </label>
                          <input
                            type="number"
                            value={bgIntervalMs / 60000}
                            onChange={(e) => setBgIntervalMs(Number(e.target.value) * 60000)}
                            min={1}
                            className={inputClass}
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Step: Config (soul agents only) */}
          {step === 'config' && kind === 'soul' && (
            <>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                The heartbeat is your agent&apos;s clock — it wakes up on this schedule, checks its
                inbox, runs its mission, and goes back to sleep.
              </p>
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={heartbeatEnabled}
                    onChange={(e) => setHeartbeatEnabled(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-text-primary dark:text-dark-text-primary">
                    Enable heartbeat
                  </span>
                </label>
                {heartbeatEnabled && (
                  <div>
                    <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                      Cron Schedule
                    </label>
                    <input
                      type="text"
                      value={heartbeatInterval}
                      onChange={(e) => setHeartbeatInterval(e.target.value)}
                      placeholder="0 */6 * * *"
                      className={inputClass}
                    />
                    <p className="text-xs text-primary mt-1 font-medium">
                      {cronToHuman(heartbeatInterval)}
                    </p>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                      Examples: &quot;0 */6 * * *&quot; (every 6h), &quot;0 9,17 * * *&quot; (9am
                      &amp; 5pm), &quot;*/30 * * * *&quot; (every 30min)
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Step: Skills (soul agents only) */}
          {step === 'skills' && kind === 'soul' && (
            <>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-3">
                Choose which installed skills this agent can access. Skills provide additional
                capabilities like web search, email, weather, and more.
              </p>
              <SkillSelector selectedSkills={selectedSkills} onChange={setSelectedSkills} />
            </>
          )}

          {/* Step: Review */}
          {step === 'review' && (
            <>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Review the details below. You can go back to edit anything before creating.
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted dark:text-dark-text-muted">Type</span>
                  <span className="text-text-primary dark:text-dark-text-primary">
                    {kind === 'soul' ? 'Soul Agent' : 'Background Agent'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted dark:text-dark-text-muted">Name</span>
                  <span className="text-text-primary dark:text-dark-text-primary">
                    {emoji} {name}
                  </span>
                </div>
                {kind === 'soul' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-text-muted dark:text-dark-text-muted">Role</span>
                      <span className="text-text-primary dark:text-dark-text-primary">{role}</span>
                    </div>
                    {personality && (
                      <div>
                        <span className="text-text-muted dark:text-dark-text-muted">
                          Personality
                        </span>
                        <p className="text-text-primary dark:text-dark-text-primary mt-0.5 text-xs line-clamp-2">
                          {personality}
                        </p>
                      </div>
                    )}
                    {mission && (
                      <div>
                        <span className="text-text-muted dark:text-dark-text-muted">Mission</span>
                        <p className="text-text-primary dark:text-dark-text-primary mt-0.5 text-xs line-clamp-2">
                          {mission}
                        </p>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-text-muted dark:text-dark-text-muted">
                        Provider/Model
                      </span>
                      <span className="text-text-primary dark:text-dark-text-primary text-xs">
                        {templateProvider || 'default'}/{templateModel || 'default'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted dark:text-dark-text-muted">Schedule</span>
                      <span className="text-text-primary dark:text-dark-text-primary">
                        {heartbeatEnabled ? cronToHuman(heartbeatInterval) : 'Disabled'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted dark:text-dark-text-muted">Autonomy</span>
                      <span className="text-text-primary dark:text-dark-text-primary">
                        Level {templateAutonomyLevel}/4
                      </span>
                    </div>
                    {templateTools.length > 0 && (
                      <div>
                        <span className="text-text-muted dark:text-dark-text-muted">Tools</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {templateTools.slice(0, 5).map((tool) => (
                            <span
                              key={tool}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
                            >
                              {tool.replace('core.', '').replace(/_/g, ' ')}
                            </span>
                          ))}
                          {templateTools.length > 5 && (
                            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                              +{templateTools.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-text-muted dark:text-dark-text-muted">Skills</span>
                      <span className="text-text-primary dark:text-dark-text-primary">
                        {selectedSkills.length > 0 ? `${selectedSkills.length} selected` : 'None'}
                      </span>
                    </div>
                  </>
                )}
                {kind === 'background' && (
                  <>
                    {bgMission && (
                      <div>
                        <span className="text-text-muted dark:text-dark-text-muted">Mission</span>
                        <p className="text-text-primary dark:text-dark-text-primary mt-0.5 text-xs line-clamp-2">
                          {bgMission}
                        </p>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-text-muted dark:text-dark-text-muted">
                        Provider/Model
                      </span>
                      <span className="text-text-primary dark:text-dark-text-primary text-xs">
                        {templateProvider || 'default'}/{templateModel || 'default'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted dark:text-dark-text-muted">Mode</span>
                      <span className="text-text-primary dark:text-dark-text-primary">
                        {bgMode === 'interval'
                          ? `Every ${Math.round(bgIntervalMs / 60000)} min`
                          : bgMode === 'continuous'
                            ? 'Continuous'
                            : 'On demand'}
                      </span>
                    </div>
                    {templateTools.length > 0 && (
                      <div>
                        <span className="text-text-muted dark:text-dark-text-muted">Tools</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {templateTools.slice(0, 5).map((tool) => (
                            <span
                              key={tool}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
                            >
                              {tool.replace('core.', '').replace(/_/g, ' ')}
                            </span>
                          ))}
                          {templateTools.length > 5 && (
                            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                              +{templateTools.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer with navigation */}
        <div className="flex items-center justify-between p-4 border-t border-border dark:border-dark-border">
          <button
            onClick={() => {
              if (step === 'type') onClose();
              else if (step === 'templates') setStep('type');
              else if (step === 'identity') setStep('type');
              else if (step === 'config') setStep('identity');
              else if (step === 'skills') setStep('config');
              else if (step === 'review') {
                if (cameFromTemplates) {
                  setCameFromTemplates(false);
                  setStep('templates');
                } else {
                  setStep(kind === 'soul' ? 'skills' : 'identity');
                }
              }
            }}
            className="text-sm text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
          >
            {step === 'type' ? 'Cancel' : '← Back'}
          </button>
          {step !== 'type' && step !== 'templates' && (
            <button
              onClick={() => {
                if (step === 'identity' && kind === 'soul') setStep('config');
                else if (step === 'identity' && kind === 'background') setStep('review');
                else if (step === 'config') setStep('skills');
                else if (step === 'skills') setStep('review');
                else if (step === 'review') {
                  if (kind === 'soul') handleCreateSoul();
                  else handleCreateBackground();
                }
              }}
              disabled={
                isCreating ||
                (step === 'identity' && !name.trim()) ||
                (step === 'identity' && kind === 'background' && !bgMission.trim())
              }
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {step === 'review' ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {isCreating ? 'Creating...' : 'Create Agent'}
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
