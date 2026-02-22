/**
 * Custom Tool Creator Wizard
 *
 * Steps: Metadata → Parameters → Code → Test → Permissions → Complete
 */

import { useState, useMemo, useRef } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { customToolsApi } from '../../api';
import { AlertTriangle, Code, Sparkles } from '../../components/icons';
import { aiGenerate } from './ai-helper';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'meta', label: 'Metadata' },
  { id: 'params', label: 'Parameters' },
  { id: 'code', label: 'Code' },
  { id: 'test', label: 'Test' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'done', label: 'Complete' },
];

const CATEGORIES = ['utility', 'data', 'automation', 'integration', 'analysis', 'other'];

const ALL_PERMISSIONS = [
  { id: 'network', label: 'Network Access', desc: 'HTTP requests, API calls' },
  { id: 'filesystem', label: 'File System', desc: 'Read/write files on disk' },
  { id: 'database', label: 'Database', desc: 'Query the database' },
  { id: 'shell', label: 'Shell Commands', desc: 'Execute system commands' },
  { id: 'email', label: 'Email', desc: 'Send or read emails' },
  { id: 'scheduling', label: 'Scheduling', desc: 'Create timers or triggers' },
];

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

const CODE_TEMPLATE = `// Tool implementation
// 'args' contains the validated parameters
// Return the result object

const { input } = args;

// Your logic here
const result = input;

return { output: result };
`;

export function CustomToolWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [toolName, setToolName] = useState('');
  const [toolDescription, setToolDescription] = useState('');
  const [category, setCategory] = useState('utility');
  const [paramsJson, setParamsJson] = useState(
    '{\n  "type": "object",\n  "properties": {\n    "input": {\n      "type": "string",\n      "description": "The input to process"\n    }\n  },\n  "required": ["input"]\n}'
  );
  const [code, setCode] = useState(CODE_TEMPLATE);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    output?: string;
    error?: string;
  } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; toolId?: string; error?: string } | null>(
    null
  );

  const paramsValid = useMemo(() => {
    try {
      const parsed = JSON.parse(paramsJson);
      return parsed && typeof parsed === 'object' && parsed.type === 'object';
    } catch {
      return false;
    }
  }, [paramsJson]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return TOOL_NAME_PATTERN.test(toolName) && toolDescription.trim().length >= 5;
      case 1:
        return paramsValid;
      case 2:
        return code.trim().length >= 10;
      case 3:
        return true; // test is optional
      case 4:
        return true; // permissions optional
      default:
        return false;
    }
  }, [step, toolName, toolDescription, paramsValid, code]);

  const generateCode = async () => {
    if (!toolName || !toolDescription) return;
    setAiGenerating(true);
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    try {
      const prompt = `Generate JavaScript code for a custom tool called "${toolName}".
Description: "${toolDescription}"
Input parameters schema: ${paramsJson}

Requirements:
- Access parameters via the 'args' object (e.g., args.input)
- Return a result object (e.g., { output: result })
- Keep it concise and functional
- Handle errors gracefully
- Do NOT use import/require — the code runs in a sandbox
- Do NOT include function declarations — write top-level code that returns a value

Return ONLY the JavaScript code, no explanations, no markdown fences.`;

      const result = await aiGenerate(prompt, ctrl.signal);
      if (result) {
        // Strip any accidental markdown fences
        const cleaned = result
          .replace(/```(?:javascript|js)?\s*/gi, '')
          .replace(/```/g, '')
          .trim();
        setCode(cleaned);
      }
    } catch {
      // Aborted or failed
    } finally {
      setAiGenerating(false);
    }
  };

  const handleTest = async () => {
    setIsProcessing(true);
    setTestResult(null);
    try {
      // Create tool temporarily, test, then we'll create for real at the end
      const tool = await customToolsApi.create({
        name: toolName,
        description: toolDescription,
        code,
        parameters: JSON.parse(paramsJson),
        category,
        permissions: [...permissions],
        requiresApproval,
      });
      try {
        const testArgs = JSON.parse(paramsJson).properties?.input ? { input: 'test' } : {};
        const res = await customToolsApi.execute(tool.id, testArgs);
        setTestResult({ ok: true, output: JSON.stringify(res, null, 2) });
      } catch (err) {
        setTestResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Execution failed',
        });
      }
      // Clean up test tool — we'll create the final one at step 4
      await customToolsApi.delete(tool.id).catch(() => {});
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to create tool for testing',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNext = async () => {
    if (step === 4) {
      // Create final tool
      setIsProcessing(true);
      setResult(null);
      try {
        const tool = await customToolsApi.create({
          name: toolName,
          description: toolDescription,
          code,
          parameters: JSON.parse(paramsJson),
          category,
          permissions: [...permissions],
          requiresApproval,
        });
        setResult({ ok: true, toolId: tool.id });
        setStep(5);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to create tool',
        });
        setStep(5);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    setStep(step + 1);
  };

  return (
    <WizardShell
      title="Create Custom Tool"
      description="Write a JavaScript tool your AI can use"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 5}
      onNext={handleNext}
      onBack={() => setStep(Math.max(0, step - 1))}
      onCancel={onCancel}
      onComplete={onComplete}
    >
      {/* Step 0: Metadata */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Tool Metadata
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Name and describe what your tool does.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Tool Name{' '}
                <span className="text-text-muted dark:text-dark-text-muted font-normal">
                  (snake_case)
                </span>
              </label>
              <input
                type="text"
                value={toolName}
                onChange={(e) =>
                  setToolName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
                }
                placeholder="my_tool_name"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                autoFocus
              />
              {toolName && !TOOL_NAME_PATTERN.test(toolName) && (
                <p className="text-xs text-warning mt-1">
                  Must start with a letter and contain only lowercase letters, numbers, and
                  underscores.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Description
              </label>
              <input
                type="text"
                value={toolDescription}
                onChange={(e) => setToolDescription(e.target.value)}
                placeholder="Describe what this tool does..."
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Parameters */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Input Parameters
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Define the JSON Schema for your tool's input. The AI uses this to call your tool
            correctly.
          </p>

          <textarea
            value={paramsJson}
            onChange={(e) => setParamsJson(e.target.value)}
            rows={12}
            className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y font-mono"
          />
          {!paramsValid && paramsJson.trim() && (
            <p className="text-xs text-warning mt-1">
              Must be valid JSON Schema with "type": "object"
            </p>
          )}
        </div>
      )}

      {/* Step 2: Code */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Implementation
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Write the JavaScript code or let AI generate it. Access parameters via{' '}
            <code className="bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded text-xs">
              args
            </code>
            .
          </p>

          <button
            onClick={generateCode}
            disabled={aiGenerating || !toolName || !toolDescription}
            className="flex items-center gap-2 mb-3 px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-purple-500 to-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {aiGenerating ? 'Generating...' : 'Generate Code with AI'}
          </button>

          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={14}
            className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y font-mono"
            spellCheck={false}
          />
        </div>
      )}

      {/* Step 3: Test */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Test Your Tool
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Run a quick test to make sure everything works. This step is optional.
          </p>

          <button
            onClick={handleTest}
            disabled={isProcessing}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isProcessing ? 'Testing...' : 'Run Test'}
          </button>

          {testResult && (
            <div
              className={`mt-4 p-4 rounded-lg border ${
                testResult.ok ? 'border-success/30 bg-success/5' : 'border-error/30 bg-error/5'
              }`}
            >
              <p
                className={`text-sm font-medium mb-2 ${testResult.ok ? 'text-success' : 'text-error'}`}
              >
                {testResult.ok ? 'Test Passed' : 'Test Failed'}
              </p>
              <pre className="text-xs font-mono text-text-secondary dark:text-dark-text-secondary overflow-auto max-h-32">
                {testResult.ok ? testResult.output : testResult.error}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Permissions */}
      {step === 4 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Permissions & Safety
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Declare what resources your tool needs access to.
          </p>

          <div className="space-y-2 mb-6">
            {ALL_PERMISSIONS.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border dark:border-dark-border cursor-pointer hover:border-primary/40 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={permissions.has(p.id)}
                  onChange={() => {
                    setPermissions((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    });
                  }}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
                <div>
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {p.label}
                  </span>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">{p.desc}</p>
                </div>
              </label>
            ))}
          </div>

          <label className="flex items-center gap-3 p-3 rounded-lg border border-border dark:border-dark-border cursor-pointer">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <div>
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                Require Approval
              </span>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Ask for user confirmation before each execution
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Step 5: Complete */}
      {step === 5 && (
        <div className="text-center py-8">
          {result?.ok ? (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Code className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Tool Created!
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
                <strong>{toolName}</strong> is now available for your AI agents to use.
              </p>
              <a
                href="/custom-tools"
                className="inline-flex px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
              >
                View Custom Tools
              </a>
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-error/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Creation Failed
              </h3>
              <p className="text-sm text-error max-w-md mx-auto">{result?.error}</p>
              <button
                onClick={() => {
                  setStep(4);
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
    </WizardShell>
  );
}
