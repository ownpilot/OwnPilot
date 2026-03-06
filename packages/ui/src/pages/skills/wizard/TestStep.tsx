import { useState } from 'react';
import { Plus, Trash2, Play, SkipForward } from '../../../components/icons';
import { useToast } from '../../../components/ToastProvider';
import { evalApi } from '../../../api/endpoints/eval';
import type { ExtensionInfo } from '../../../api/types';

interface TestCase {
  id: string;
  query: string;
  expectedKeywords: string;
  notes: string;
}

interface TestResult {
  withSkill: string | null;
  withoutSkill: string | null;
  score: number | null;
  feedback: string | null;
  durationWithMs: number | null;
  durationWithoutMs: number | null;
  running: boolean;
  error: string | null;
}

interface TestStepProps {
  pkg: ExtensionInfo;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

function newCase(): TestCase {
  return { id: crypto.randomUUID(), query: '', expectedKeywords: '', notes: '' };
}

export function TestStep({ pkg, onNext, onSkip, onBack }: TestStepProps) {
  const toast = useToast();
  const [cases, setCases] = useState<TestCase[]>([newCase()]);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [isRunningAll, setIsRunningAll] = useState(false);

  const updateCase = (id: string, field: keyof TestCase, value: string) => {
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const addCase = () => setCases((prev) => [...prev, newCase()]);
  const removeCase = (id: string) => {
    setCases((prev) => prev.filter((c) => c.id !== id));
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const runCase = async (tc: TestCase): Promise<void> => {
    if (!tc.query.trim()) {
      toast.warning('Query is empty.');
      return;
    }
    setResults((prev) => ({
      ...prev,
      [tc.id]: {
        withSkill: null,
        withoutSkill: null,
        score: null,
        feedback: null,
        durationWithMs: null,
        durationWithoutMs: null,
        running: true,
        error: null,
      },
    }));
    try {
      const [withRes, withoutRes] = await Promise.all([
        evalApi.runTest(pkg.id, tc.query, true),
        evalApi.runTest(pkg.id, tc.query, false),
      ]);
      const keywords = tc.expectedKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      let grade = null;
      try {
        grade = await evalApi.gradeResponse(pkg.id, tc.query, withRes.response, keywords, tc.notes);
      } catch {
        // grading is optional
      }
      setResults((prev) => ({
        ...prev,
        [tc.id]: {
          withSkill: withRes.response,
          withoutSkill: withoutRes.response,
          score: grade?.score ?? null,
          feedback: grade?.feedback ?? null,
          durationWithMs: withRes.durationMs,
          durationWithoutMs: withoutRes.durationMs,
          running: false,
          error: null,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      setResults((prev) => ({
        ...prev,
        [tc.id]: { ...(prev[tc.id] ?? {}), running: false, error: msg } as TestResult,
      }));
      toast.error(msg);
    }
  };

  /** Run all valid cases in parallel */
  const runAll = async () => {
    const valid = cases.filter((c) => c.query.trim());
    if (!valid.length) {
      toast.warning('Add at least one test case with a query.');
      return;
    }
    setIsRunningAll(true);
    try {
      await Promise.all(valid.map((tc) => runCase(tc)));
    } finally {
      setIsRunningAll(false);
    }
  };

  const completedCount = Object.values(results).filter((r) => !r.running && r.withSkill).length;
  const avgScore =
    completedCount > 0
      ? Object.values(results)
          .filter((r) => r.score != null)
          .reduce((sum, r) => sum + (r.score ?? 0), 0) /
        Object.values(results).filter((r) => r.score != null).length
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Test — {pkg.name}
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
            Compare responses with and without this skill. All cases run in parallel.
          </p>
          {avgScore != null && (
            <p className="text-xs text-success mt-1 font-medium">
              Average score: {Math.round(avgScore * 100)}%
            </p>
          )}
        </div>
        <button
          onClick={runAll}
          disabled={isRunningAll}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isRunningAll ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run All
            </>
          )}
        </button>
      </div>

      <div className="space-y-4">
        {cases.map((tc, idx) => {
          const res = results[tc.id];
          return (
            <div
              key={tc.id}
              className={`p-4 bg-bg-secondary dark:bg-dark-bg-secondary border rounded-xl transition-colors ${
                res?.error
                  ? 'border-error/30'
                  : res && !res.running && res.withSkill
                    ? 'border-success/30'
                    : 'border-border dark:border-dark-border'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                  Test #{idx + 1}
                  {res?.running && (
                    <span className="ml-2 text-primary animate-pulse">Running…</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => runCase(tc)}
                    disabled={res?.running || isRunningAll}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50 transition-colors"
                  >
                    {res?.running ? (
                      <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Run
                  </button>
                  {cases.length > 1 && (
                    <button
                      onClick={() => removeCase(tc.id)}
                      disabled={res?.running}
                      className="p-1 text-text-muted hover:text-error rounded transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2 mb-3">
                <input
                  type="text"
                  value={tc.query}
                  onChange={(e) => updateCase(tc.id, 'query', e.target.value)}
                  placeholder="Test query..."
                  className="w-full px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <input
                  type="text"
                  value={tc.expectedKeywords}
                  onChange={(e) => updateCase(tc.id, 'expectedKeywords', e.target.value)}
                  placeholder="Expected keywords for grading (comma-separated, optional)"
                  className="w-full px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Error */}
              {res?.error && (
                <div className="text-xs text-error bg-error/5 rounded px-2 py-1 mb-2">
                  {res.error}
                </div>
              )}

              {/* Results */}
              {res && !res.running && (res.withSkill || res.withoutSkill) && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <div className="text-xs font-medium text-success mb-1">With skill</div>
                    <div className="p-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-xs text-text-primary dark:text-dark-text-primary max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {res.withSkill ?? '—'}
                    </div>
                    {res.durationWithMs != null && (
                      <div className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                        {res.durationWithMs}ms
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                      Without skill
                    </div>
                    <div className="p-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-xs text-text-primary dark:text-dark-text-primary max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {res.withoutSkill ?? '—'}
                    </div>
                    {res.durationWithoutMs != null && (
                      <div className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                        {res.durationWithoutMs}ms
                      </div>
                    )}
                  </div>
                  {res.score != null && (
                    <div className="col-span-2 flex items-center gap-3">
                      <div className="flex-1 h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            res.score >= 0.7
                              ? 'bg-success'
                              : res.score >= 0.4
                                ? 'bg-warning'
                                : 'bg-error'
                          }`}
                          style={{ width: `${Math.round(res.score * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary w-12 text-right">
                        {Math.round(res.score * 100)}%
                      </span>
                      {res.feedback && (
                        <span className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                          {res.feedback}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={addCase}
        className="flex items-center gap-2 px-3 py-2 text-sm text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add Test Case
      </button>

      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={onSkip}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            title="Skip testing and proceed to Optimize"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip
          </button>
          <button
            onClick={onNext}
            disabled={completedCount === 0}
            className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={completedCount === 0 ? 'Run at least one test first, or skip' : undefined}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
