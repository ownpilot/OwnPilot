import { useState, useEffect, useRef } from 'react';
import { useToast } from '../../components/ToastProvider';
import { clawsApi } from '../../api/endpoints/claws';
import { chatApi } from '../../api/endpoints/chat';
import { settingsApi } from '../../api/endpoints/settings';
import { silentCatch } from '../../utils/ignore-error';
import { Sparkles } from '../../components/icons';
import type { ClawPreset } from '../../api/endpoints/claws';
import { X, ChevronDown, ChevronRight } from '../../components/icons';

type ClawTemplate = {
  name: string;
  icon: string;
  mission: string;
  mode: 'continuous' | 'interval' | 'event' | 'single-shot';
  sandbox: 'auto' | 'docker' | 'local';
  codingAgent?: string;
  description: string;
  preset: string;
  successCriteria: string[];
  deliverables: string[];
  constraints?: string[];
};

const CLAW_TEMPLATES: ClawTemplate[] = [
  {
    name: 'Research Agent',
    icon: '🔍',
    mission:
      'Research the given topic thoroughly using web search, browse relevant pages, extract key information, and compile a comprehensive report with sources.',
    mode: 'single-shot',
    sandbox: 'auto',
    description: 'Web research with final report',
    preset: 'research',
    successCriteria: ['Relevant sources reviewed', 'Findings are synthesized, not copied'],
    deliverables: ['Report with source links', 'Open questions and confidence notes'],
  },
  {
    name: 'Code Reviewer',
    icon: '🔎',
    mission:
      'Review the codebase for quality issues, security vulnerabilities, performance problems, and best practice violations. Use CLI tools (eslint, tsc) and coding agents to analyze. Produce a detailed review report.',
    mode: 'single-shot',
    sandbox: 'local',
    codingAgent: 'claude-code',
    description: 'Deep code review with CLI tools',
    preset: 'code-review',
    successCriteria: ['Findings are actionable', 'Claims reference files, tests, or commands'],
    deliverables: ['Severity-ranked findings', 'Verification commands'],
    constraints: ['Avoid style-only nitpicks', 'Do not change files unless explicitly asked'],
  },
  {
    name: 'Data Analyst',
    icon: '📊',
    mission:
      'Analyze the provided data using Python scripts. Install necessary packages (pandas, matplotlib), process data, generate charts as artifacts, and write an analysis report.',
    mode: 'single-shot',
    sandbox: 'docker',
    description: 'Python-powered data analysis',
    preset: 'data-analysis',
    successCriteria: ['Data assumptions are stated', 'Charts or tables support conclusions'],
    deliverables: ['Analysis report', 'Generated artifacts'],
  },
  {
    name: 'Monitor & Alert',
    icon: '🔔',
    mission:
      'Periodically check the specified URLs/APIs for availability, response time, and content changes. Send alerts via claw_send_output when issues are detected.',
    mode: 'interval',
    sandbox: 'auto',
    description: 'Periodic health checks with alerts',
    preset: 'monitor',
    successCriteria: ['Failures are detected quickly', 'False positives are minimized'],
    deliverables: ['Status updates', 'Incident summary when issues occur'],
  },
  {
    name: 'Content Creator',
    icon: '✍️',
    mission:
      'Create high-quality content based on the brief. Research the topic, write drafts, refine, and publish final content as artifacts. Support HTML, Markdown, and SVG formats.',
    mode: 'single-shot',
    sandbox: 'auto',
    description: 'Write and publish content',
    preset: 'content',
    successCriteria: ['Output matches brief and audience', 'Draft is polished before publishing'],
    deliverables: ['Final content artifact', 'Short editorial rationale'],
  },
  {
    name: 'Event Reactor',
    icon: '⚡',
    mission:
      'Listen for system events and react intelligently. Process incoming data, make decisions, update goals, and coordinate with other claws via messaging.',
    mode: 'event',
    sandbox: 'auto',
    description: 'Event-driven reactive automation',
    preset: 'event-reactor',
    successCriteria: [
      'Only relevant events trigger action',
      'Actions are idempotent where possible',
    ],
    deliverables: ['Action log', 'Escalation when event data is ambiguous'],
  },
];

const splitLines = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

function presetToTemplate(preset: ClawPreset): ClawTemplate {
  return {
    name: preset.name,
    icon: preset.icon.slice(0, 1).toUpperCase(),
    mission: preset.mission,
    mode: preset.mode,
    sandbox: preset.sandbox,
    codingAgent: preset.codingAgentProvider,
    description: preset.description,
    preset: preset.id,
    successCriteria: preset.successCriteria,
    deliverables: preset.deliverables,
    constraints: preset.constraints,
  };
}

export function CreateClawModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [mode, setMode] = useState<'continuous' | 'interval' | 'event' | 'single-shot'>(
    'single-shot'
  );
  const [sandbox, setSandbox] = useState<'auto' | 'docker' | 'local'>('auto');
  const [eventFilters, setEventFilters] = useState('');
  const [codingAgent, setCodingAgent] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [preset, setPreset] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [constraints, setConstraints] = useState('');
  const [allowSelfModify, setAllowSelfModify] = useState(false);
  const [allowSubclaws, setAllowSubclaws] = useState(true);
  const [requireEvidence, setRequireEvidence] = useState(true);
  const [learnSkills, setLearnSkills] = useState(true);
  const [destructiveActionPolicy, setDestructiveActionPolicy] = useState<'ask' | 'block' | 'allow'>(
    'ask'
  );
  const [priority, setPriority] = useState(3);
  const [intervalSecs, setIntervalSecs] = useState(300);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [availableSkills, setAvailableSkills] = useState<
    Array<{ id: string; name: string; description?: string; toolCount: number }>
  >([]);
  const [createModels, setCreateModels] = useState<
    Array<{ id: string; name: string; provider: string; recommended?: boolean }>
  >([]);
  const [createProviders, setCreateProviders] = useState<string[]>([]);
  const [clawTemplates, setClawTemplates] = useState<ClawTemplate[]>(CLAW_TEMPLATES);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAiSuggesting, setIsAiSuggesting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const toast = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const suggestMission = async () => {
    if (!name.trim() && !mission.trim()) {
      toast.error('Enter a name or brief description first');
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsAiSuggesting(true);
    setAiSuggestion('');

    let provider = 'openai';
    let model = 'gpt-4o';
    try {
      const settings = await settingsApi.get();
      provider = settings.defaultProvider || 'openai';
      model = settings.defaultModel || 'gpt-4o';
    } catch {
      // use defaults
    }

    const userBrief = mission.trim() || name.trim() || 'Help me define the mission';
    const clawContext = `Name: ${name.trim() || 'Untitled Claw'}
Template: ${preset || 'custom'}
Mode: ${mode}
Sandbox: ${sandbox}
Skills: ${selectedSkills.join(', ') || 'none selected'}`;

    try {
      const response = await chatApi.send(
        {
          message: `You are a claw mission designer. Generate a concise, actionable claw mission (1-3 sentences) that is specific and outcome-oriented. Keep it under 500 characters. Respond with ONLY the mission text.\n\nContext:\n${clawContext}\n\nUser's brief: ${userBrief}`,
          provider,
          model,
          stream: true,
        },
        { signal: controller.signal }
      );

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]' || data === '') continue;
            if (data.startsWith('{')) {
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  setAiSuggestion((prev) => prev + delta);
                }
              } catch {
                // not JSON, treat as raw content
                setAiSuggestion((prev) => prev + data);
              }
            } else {
              setAiSuggestion((prev) => prev + data);
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error('AI suggestion failed');
      }
    } finally {
      setIsAiSuggesting(false);
    }
  };

  const applyAiSuggestion = () => {
    if (aiSuggestion.trim()) {
      setMission(aiSuggestion.trim());
      setAiSuggestion('');
    }
  };

  useEffect(() => {
    import('../../api/endpoints/models')
      .then(({ modelsApi }) =>
        modelsApi.list().then((data) => {
          setCreateModels(data.models);
          setCreateProviders(data.configuredProviders);
        })
      )
      .catch(silentCatch('createClaw.models'));
  }, []);

  useEffect(() => {
    clawsApi
      .presets()
      .then((data) => {
        if (data.presets.length === 0) return;
        setClawTemplates(data.presets.map(presetToTemplate));
      })
      .catch(silentCatch('createClaw.presets'));
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { extensionsApi } = await import('../../api/endpoints/extensions');
        const exts = await extensionsApi.list({ status: 'enabled' });
        setAvailableSkills(
          exts.map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            toolCount: e.toolCount,
          }))
        );
      } catch {
        // Skills may not be available
      }
    };
    load();
  }, []);

  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (!name.trim() || !mission.trim()) {
      toast.error('Name and mission are required');
      return;
    }
    setIsSubmitting(true);
    try {
      await clawsApi.create({
        name: name.trim(),
        mission: mission.trim(),
        mode,
        sandbox,
        provider: provider || undefined,
        model: model || undefined,
        coding_agent_provider: codingAgent || undefined,
        skills: selectedSkills.length > 0 ? selectedSkills : undefined,
        preset: preset || undefined,
        mission_contract: {
          successCriteria: splitLines(successCriteria),
          deliverables: splitLines(deliverables),
          constraints: splitLines(constraints),
          escalationRules: ['Budget, permissions, destructive actions, or ambiguous success state'],
          evidenceRequired: requireEvidence,
          minConfidence: 0.8,
        },
        autonomy_policy: {
          allowSelfModify,
          allowSubclaws,
          requireEvidence,
          destructiveActionPolicy,
          filesystemScopes: [],
        },
        event_filters:
          mode === 'event' && eventFilters.trim()
            ? eventFilters
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        interval_ms: mode === 'interval' ? intervalSecs * 1000 : undefined,
        priority: priority !== 3 ? priority : undefined,
        learn_skills: learnSkills,
      });
      toast.success('Claw created');
      onCreated();
    } catch {
      toast.error('Failed to create claw');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl border border-border dark:border-dark-border w-full max-w-xl mx-4 p-6 animate-fade-in-up max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Create Claw
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Templates */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Start from template
            </label>
            <div className="grid grid-cols-3 gap-2">
              {clawTemplates.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => {
                    setName(tpl.name);
                    setMission(tpl.mission);
                    setMode(tpl.mode);
                    setSandbox(tpl.sandbox);
                    setPreset(tpl.preset);
                    setSuccessCriteria(tpl.successCriteria.join('\n'));
                    setDeliverables(tpl.deliverables.join('\n'));
                    setConstraints((tpl.constraints ?? []).join('\n'));
                    if (tpl.codingAgent) setCodingAgent(tpl.codingAgent);
                    if (tpl.mode === 'interval') setIntervalSecs(300);
                  }}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all text-center ${
                    name === tpl.name
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border dark:border-dark-border hover:border-primary/40 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                  }`}
                >
                  <span className="text-xl">{tpl.icon}</span>
                  <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                    {tpl.name}
                  </span>
                  <span className="text-[10px] text-text-muted dark:text-dark-text-muted leading-tight">
                    {tpl.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border dark:border-dark-border" />
            <span className="text-xs text-text-muted dark:text-dark-text-muted">or customize</span>
            <div className="flex-1 border-t border-border dark:border-dark-border" />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Market Research Agent"
              className={inputClass}
            />
          </div>

          {/* Mission */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                Mission
              </label>
              <button
                type="button"
                onClick={suggestMission}
                disabled={isAiSuggesting}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                {isAiSuggesting ? 'Generating...' : 'AI assist'}
              </button>
            </div>
            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="Describe what this claw should accomplish..."
              rows={3}
              className={`${inputClass} resize-none`}
            />
            {/* AI suggestion preview */}
            {aiSuggestion && (
              <div className="mt-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-[10px] text-primary font-medium mb-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  AI suggestion
                </p>
                <p className="text-xs text-text-secondary dark:text-dark-text-secondary whitespace-pre-wrap">
                  {aiSuggestion}
                </p>
                <div className="flex gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={applyAiSuggestion}
                    className="px-2 py-1 text-xs rounded bg-primary text-white hover:bg-primary/90 transition-colors"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiSuggestion('')}
                    className="px-2 py-1 text-xs rounded border border-border dark:border-dark-border text-text-muted hover:bg-bg-tertiary transition-colors"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Mode + Sandbox */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as 'continuous' | 'interval' | 'event' | 'single-shot')
                }
                className={inputClass}
              >
                <option value="single-shot">Single-shot</option>
                <option value="continuous">Continuous</option>
                <option value="interval">Interval</option>
                <option value="event">Event-driven</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Sandbox
              </label>
              <select
                value={sandbox}
                onChange={(e) => setSandbox(e.target.value as 'auto' | 'docker' | 'local')}
                className={inputClass}
              >
                <option value="auto">Auto</option>
                <option value="docker">Docker</option>
                <option value="local">Local</option>
              </select>
            </div>
          </div>

          {/* Mode description */}
          <p className="text-xs text-text-muted dark:text-dark-text-muted -mt-2">
            {mode === 'single-shot' && 'Runs once, completes, and stops.'}
            {mode === 'continuous' &&
              'Fast adaptive loop — speeds up when active, slows when idle.'}
            {mode === 'interval' && 'Fixed interval between cycles.'}
            {mode === 'event' && 'Waits for events, then runs a cycle. Requires event filters.'}
          </p>

          {/* Interval (only for interval mode) */}
          {mode === 'interval' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Interval (seconds)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={3600}
                  step={10}
                  value={intervalSecs}
                  onChange={(e) => setIntervalSecs(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm font-mono text-text-primary dark:text-dark-text-primary w-16 text-right">
                  {intervalSecs}s
                </span>
              </div>
              <div className="flex gap-2 mt-1.5">
                {[60, 300, 900, 1800].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setIntervalSecs(s)}
                    className={`text-[10px] px-2 py-0.5 rounded border font-mono ${
                      intervalSecs === s
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border dark:border-dark-border text-text-muted hover:border-primary/40'
                    }`}
                  >
                    {s < 60 ? `${s}s` : `${s / 60}m`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Event Filters (only for event mode) */}
          {mode === 'event' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Event Filters
              </label>
              <input
                value={eventFilters}
                onChange={(e) => setEventFilters(e.target.value)}
                placeholder="e.g., user.message, webhook.received, data:changed"
                className={inputClass}
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                Comma-separated EventBus event types that trigger a cycle
              </p>
            </div>
          )}

          {/* Skills Picker */}
          {availableSkills.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Skills
                <span className="text-xs text-text-muted dark:text-dark-text-muted ml-1">
                  ({selectedSkills.length} selected)
                </span>
              </label>
              <div className="max-h-36 overflow-y-auto border border-border dark:border-dark-border rounded-lg p-2 space-y-1 bg-bg-secondary dark:bg-dark-bg-secondary">
                {availableSkills.map((skill) => (
                  <label
                    key={skill.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                      selectedSkills.includes(skill.id)
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(skill.id)}
                      onChange={() => toggleSkill(skill.id)}
                      className="w-3.5 h-3.5 rounded border-border accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary dark:text-dark-text-primary">
                        {skill.name}
                      </span>
                      <span className="text-xs text-text-muted dark:text-dark-text-muted ml-1">
                        ({skill.toolCount} tools)
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Advanced Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
          >
            {showAdvanced ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Advanced Options
          </button>

          {/* Advanced options */}
          {showAdvanced && (
            <div className="space-y-4 pl-3 border-l-2 border-border dark:border-dark-border">
              {/* Provider / Model */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    AI Provider
                  </label>
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      setModel('');
                    }}
                    className={inputClass}
                  >
                    <option value="">System Default</option>
                    {createProviders.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    AI Model
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">System Default</option>
                    {createModels
                      .filter((m) => !provider || m.provider === provider)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.recommended ? ' *' : ''}
                          {provider ? '' : ` (${m.provider})`}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Coding Agent */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Coding Agent
                </label>
                <select
                  value={codingAgent}
                  onChange={(e) => setCodingAgent(e.target.value)}
                  className={inputClass}
                >
                  <option value="">None</option>
                  <option value="claude-code">Claude Code</option>
                  <option value="codex">Codex CLI</option>
                  <option value="gemini-cli">Gemini CLI</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary">
                  <input
                    type="checkbox"
                    checked={allowSubclaws}
                    onChange={(e) => setAllowSubclaws(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  Allow sub-claws
                </label>
                <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary">
                  <input
                    type="checkbox"
                    checked={allowSelfModify}
                    onChange={(e) => setAllowSelfModify(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  Self-modify
                </label>
                <label className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary">
                  <input
                    type="checkbox"
                    checked={requireEvidence}
                    onChange={(e) => setRequireEvidence(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  Require evidence
                </label>
                <label
                  className="flex items-center gap-2 text-sm text-text-primary dark:text-dark-text-primary"
                  title="Distill successful runs into reusable skills the claw can recall on similar tasks"
                >
                  <input
                    type="checkbox"
                    checked={learnSkills}
                    onChange={(e) => setLearnSkills(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  Learn skills
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Destructive Actions
                </label>
                <select
                  value={destructiveActionPolicy}
                  onChange={(e) =>
                    setDestructiveActionPolicy(e.target.value as 'ask' | 'block' | 'allow')
                  }
                  className={inputClass}
                >
                  <option value="ask">Ask first</option>
                  <option value="block">Block</option>
                  <option value="allow">Allow</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Scheduling Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className={inputClass}
                >
                  <option value={1}>1 — Highest (fastest cycles)</option>
                  <option value={2}>2 — High</option>
                  <option value={3}>3 — Normal (default)</option>
                  <option value={4}>4 — Low</option>
                  <option value={5}>5 — Lowest (slowest cycles)</option>
                </select>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Higher priority claws run more frequently when multiple claws compete for CPU.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Success Criteria
                  </label>
                  <textarea
                    value={successCriteria}
                    onChange={(e) => setSuccessCriteria(e.target.value)}
                    rows={3}
                    placeholder="One criterion per line"
                    className={`${inputClass} resize-none`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Deliverables
                  </label>
                  <textarea
                    value={deliverables}
                    onChange={(e) => setDeliverables(e.target.value)}
                    rows={3}
                    placeholder="One deliverable per line"
                    className={`${inputClass} resize-none`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Constraints
                  </label>
                  <textarea
                    value={constraints}
                    onChange={(e) => setConstraints(e.target.value)}
                    rows={2}
                    placeholder="One constraint per line"
                    className={`${inputClass} resize-none`}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
