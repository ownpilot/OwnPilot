/**
 * Workflow Builder Wizard
 *
 * Steps: Name & Description → Choose Method → Define Workflow → Create → Complete
 */

import { useState, useMemo, useRef } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { workflowsApi } from '../../api';
import { Check, AlertTriangle, GitBranch, Sparkles } from '../../components/icons';
import { aiGenerate } from './ai-helper';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'name', label: 'Name' },
  { id: 'method', label: 'Method' },
  { id: 'define', label: 'Define' },
  { id: 'create', label: 'Create' },
  { id: 'done', label: 'Complete' },
];

const WORKFLOW_TEMPLATES = [
  {
    id: 'daily-summary',
    name: 'Daily Summary',
    desc: 'Summarize recent activity and create a daily briefing',
    nodes: [
      { id: 'n1', type: 'start', label: 'Trigger', config: {} },
      {
        id: 'n2',
        type: 'tool',
        label: 'Get Recent Activity',
        config: { toolName: 'get_recent_conversations' },
      },
      {
        id: 'n3',
        type: 'ai',
        label: 'Summarize',
        config: { prompt: 'Summarize the recent activity into a brief daily summary' },
      },
      { id: 'n4', type: 'end', label: 'Output', config: {} },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4' },
    ],
  },
  {
    id: 'web-research',
    name: 'Web Research Pipeline',
    desc: 'Search the web, extract content, and summarize findings',
    nodes: [
      { id: 'n1', type: 'start', label: 'Input Query', config: {} },
      { id: 'n2', type: 'tool', label: 'Web Search', config: { toolName: 'web_search' } },
      {
        id: 'n3',
        type: 'ai',
        label: 'Analyze & Summarize',
        config: { prompt: 'Analyze the search results and create a comprehensive summary' },
      },
      { id: 'n4', type: 'end', label: 'Report', config: {} },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4' },
    ],
  },
];

type Method = 'template' | 'copilot' | 'manual';

export function WorkflowWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<Method | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [copilotPrompt, setCopilotPrompt] = useState('');
  const [copilotGenerated, setCopilotGenerated] = useState<{
    nodes: unknown[];
    edges: unknown[];
  } | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [manualDefinition, setManualDefinition] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; workflowId?: string; error?: string } | null>(
    null
  );

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return name.trim().length >= 2;
      case 1:
        return !!method;
      case 2: {
        if (method === 'template') return !!selectedTemplate;
        if (method === 'copilot') return !!copilotGenerated || copilotPrompt.trim().length >= 10;
        if (method === 'manual') return manualDefinition.trim().length >= 10;
        return false;
      }
      case 3:
        return result?.ok === true;
      default:
        return false;
    }
  }, [
    step,
    name,
    method,
    selectedTemplate,
    copilotPrompt,
    copilotGenerated,
    manualDefinition,
    result,
  ]);

  const generateWorkflow = async () => {
    if (!copilotPrompt.trim()) return;
    setAiGenerating(true);
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    try {
      const prompt = `Generate a workflow definition for: "${copilotPrompt.trim()}"
Workflow name: "${name.trim()}"

Return a JSON object with "nodes" and "edges" arrays.
Each node: { "id": "n1", "type": "start"|"tool"|"ai"|"condition"|"end", "label": "short label", "config": {} }
Each edge: { "source": "n1", "target": "n2" }

Rules:
- First node must be type "start", last must be type "end"
- Use "tool" type for calling tools (set config.toolName)
- Use "ai" type for AI processing (set config.prompt)
- Use "condition" type for branching (set config.condition)
- Create 3-6 nodes typically
- IDs must be sequential: n1, n2, n3...

Return ONLY the JSON object, no explanations.`;

      const text = await aiGenerate(prompt, ctrl.signal);
      // Extract JSON object
      let cleaned = text
        .replace(/```(?:json)?\s*/gi, '')
        .replace(/```/g, '')
        .trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
      }
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed.nodes && parsed.edges) {
          setCopilotGenerated({ nodes: parsed.nodes, edges: parsed.edges });
        }
      } catch {
        // Parse failed — ignore
      }
    } catch {
      // Aborted or failed
    } finally {
      setAiGenerating(false);
    }
  };

  const handleNext = async () => {
    if (step === 2) {
      // Create workflow
      setIsProcessing(true);
      setResult(null);
      try {
        let nodes: unknown[] = [];
        let edges: unknown[] = [];

        if (method === 'template') {
          const tmpl = WORKFLOW_TEMPLATES.find((t) => t.id === selectedTemplate);
          if (tmpl) {
            nodes = tmpl.nodes;
            edges = tmpl.edges;
          }
        } else if (method === 'copilot' && copilotGenerated) {
          nodes = copilotGenerated.nodes;
          edges = copilotGenerated.edges;
        }

        const workflow = await workflowsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          nodes,
          edges,
          status: 'draft',
        });
        setResult({ ok: true, workflowId: workflow.id });
        setStep(3);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to create workflow',
        });
        setStep(3);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    setStep(step + 1);
  };

  return (
    <WizardShell
      title="Create Workflow"
      description="Build an automation workflow with connected steps"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 4}
      onNext={handleNext}
      onBack={() => setStep(Math.max(0, step - 1))}
      onCancel={onCancel}
      onComplete={onComplete}
    >
      {/* Step 0: Name */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Name Your Workflow
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Give your workflow a descriptive name.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Workflow Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Daily Briefing, Content Pipeline"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Description{' '}
                <span className="text-text-muted dark:text-dark-text-muted font-normal">
                  (optional)
                </span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this workflow automate?"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Choose Method */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            How to Build
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Choose how you'd like to create your workflow.
          </p>

          <div className="space-y-3">
            {[
              {
                id: 'template' as const,
                label: 'Start from Template',
                desc: 'Pick a pre-built workflow and customize it',
                icon: Check,
              },
              {
                id: 'copilot' as const,
                label: 'AI Copilot',
                desc: 'Describe what you want and let AI generate the workflow',
                icon: Sparkles,
              },
              {
                id: 'manual' as const,
                label: 'Manual JSON',
                desc: 'Write the workflow definition in JSON for full control',
                icon: GitBranch,
              },
            ].map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={`w-full text-left p-4 rounded-lg border transition-all flex items-center gap-4 ${
                    method === m.id
                      ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                      : 'border-border dark:border-dark-border hover:border-primary/40'
                  }`}
                >
                  <Icon className="w-5 h-5 text-primary flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                      {m.label}
                    </span>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                      {m.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Define */}
      {step === 2 && (
        <div>
          {method === 'template' && (
            <>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
                Choose a Template
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
                Select a pre-built workflow. You can customize it in the editor after creation.
              </p>
              <div className="space-y-3">
                {WORKFLOW_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTemplate(t.id)}
                    className={`w-full text-left p-4 rounded-lg border transition-all ${
                      selectedTemplate === t.id
                        ? 'border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary'
                        : 'border-border dark:border-dark-border hover:border-primary/40'
                    }`}
                  >
                    <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                      {t.name}
                    </span>
                    <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                      {t.desc}
                    </p>
                    <p className="text-xs text-primary mt-2">{t.nodes.length} nodes</p>
                  </button>
                ))}
              </div>
            </>
          )}

          {method === 'copilot' && (
            <>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
                Describe Your Workflow
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Describe what you want the workflow to do, then let AI generate it.
              </p>
              <textarea
                value={copilotPrompt}
                onChange={(e) => {
                  setCopilotPrompt(e.target.value);
                  setCopilotGenerated(null);
                }}
                placeholder="e.g., Every morning, check my calendar, summarize today's meetings, and send me a briefing message..."
                rows={4}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />

              <button
                onClick={generateWorkflow}
                disabled={aiGenerating || copilotPrompt.trim().length < 10}
                className="flex items-center gap-2 mt-3 px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-purple-500 to-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                {aiGenerating ? 'Generating...' : 'Generate Workflow'}
              </button>

              {copilotGenerated && (
                <div className="mt-4 p-4 rounded-lg border border-success/30 bg-success/5">
                  <p className="text-sm font-medium text-success mb-2">
                    Workflow Generated — {copilotGenerated.nodes.length} nodes
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(copilotGenerated.nodes as Array<{ label?: string; type?: string }>).map(
                      (n, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 text-xs rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary"
                        >
                          {n.label || n.type || `Node ${i + 1}`}
                        </span>
                      )
                    )}
                  </div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
                    Click Next to create. You can refine in the visual editor.
                  </p>
                </div>
              )}

              {!copilotGenerated && (
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
                  Generate a workflow or click Next to create a draft you can build in the editor.
                </p>
              )}
            </>
          )}

          {method === 'manual' && (
            <>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
                Manual Definition
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                Define your workflow nodes and edges. The workflow editor provides a better visual
                experience.
              </p>
              <textarea
                value={manualDefinition}
                onChange={(e) => setManualDefinition(e.target.value)}
                placeholder="Describe the steps you want to add later in the visual editor..."
                rows={6}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y font-mono"
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
                An empty workflow will be created. Add nodes in the visual editor.
              </p>
            </>
          )}
        </div>
      )}

      {/* Step 3: Create */}
      {step === 3 && (
        <div className="text-center py-8">
          {!result && (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <p className="text-text-muted dark:text-dark-text-muted">Creating workflow...</p>
            </div>
          )}

          {result?.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <GitBranch className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Workflow Created!
              </h3>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Open the visual editor to refine your workflow.
              </p>
            </>
          )}

          {result && !result.ok && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-error/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Creation Failed
              </h3>
              <p className="text-sm text-error max-w-md mx-auto">{result.error}</p>
              <button
                onClick={() => {
                  setStep(2);
                  setResult(null);
                }}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Go back and try again
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
            <GitBranch className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
            Workflow Ready!
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
            <strong>{name}</strong> has been created. Open it in the editor to add nodes and
            configure triggers.
          </p>
          <div className="flex justify-center gap-3">
            {result?.workflowId && (
              <a
                href={`/workflows/${result.workflowId}`}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
              >
                Open in Editor
              </a>
            )}
            <a
              href="/workflows"
              className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            >
              View All Workflows
            </a>
          </div>
        </div>
      )}
    </WizardShell>
  );
}
