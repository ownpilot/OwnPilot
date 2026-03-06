import { useState } from 'react';
import { Sparkles, CheckCircle2, SkipForward } from '../../../components/icons';
import { useToast } from '../../../components/ToastProvider';
import { evalApi } from '../../../api/endpoints/eval';
import { extensionsApi } from '../../../api/endpoints/extensions';
import type { ExtensionInfo } from '../../../api/types';

interface OptimizeStepProps {
  pkg: ExtensionInfo;
  onNext: (updatedDescription: string) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function OptimizeStep({ pkg, onNext, onSkip, onBack }: OptimizeStepProps) {
  const toast = useToast();
  const [testQueries, setTestQueries] = useState('');
  const [iterations, setIterations] = useState(3);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [results, setResults] = useState<
    Array<{ description: string; triggerAccuracy: number; reasoning: string }>
  >([]);
  const [appliedIdx, setAppliedIdx] = useState<number | null>(null);

  const handleOptimize = async () => {
    const queries = testQueries
      .split('\n')
      .map((q) => q.trim())
      .filter(Boolean);
    if (!queries.length) {
      toast.warning('Add at least one test query (one per line).');
      return;
    }
    setIsOptimizing(true);
    setResults([]);
    setAppliedIdx(null);
    try {
      const res = await evalApi.optimizeDescription(
        pkg.id,
        pkg.description ?? '',
        queries,
        iterations
      );
      setResults(res.iterations);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleApply = async (idx: number) => {
    const iter = results[idx];
    if (!iter) return;
    try {
      await extensionsApi.update(pkg.id, { description: iter.description });
      setAppliedIdx(idx);
      toast.success('Description updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const appliedDesc =
    (appliedIdx != null ? results[appliedIdx]?.description : undefined) ?? pkg.description ?? '';

  const bestIdx =
    results.length > 0
      ? results.reduce(
          (best, r, i) => (r.triggerAccuracy > (results[best]?.triggerAccuracy ?? 0) ? i : best),
          0
        )
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          Optimize description — {pkg.name}
        </h3>
        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
          Enter test queries to generate and score alternative descriptions. Higher trigger accuracy
          means the skill fires more reliably on relevant queries.
        </p>
      </div>

      {/* Current description */}
      <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
        <div className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Current description
        </div>
        <p className="text-sm text-text-primary dark:text-dark-text-primary">
          {pkg.description ?? <span className="text-text-muted italic">(none)</span>}
        </p>
      </div>

      {/* Test queries + iterations config */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
            Test queries (one per line)
          </label>
          <textarea
            value={testQueries}
            onChange={(e) => setTestQueries(e.target.value)}
            placeholder={
              'Summarize this PDF\nExtract key insights from document\nWhat does this paper say about...'
            }
            rows={4}
            className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>

        {/* Iterations slider */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
              Iterations
            </label>
            <span className="text-sm font-semibold text-primary">{iterations}</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            value={iterations}
            onChange={(e) => setIterations(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            <span>1 (fast)</span>
            <span>5 (thorough)</span>
          </div>
        </div>
      </div>

      <button
        onClick={handleOptimize}
        disabled={isOptimizing}
        className="flex items-center justify-center gap-2 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {isOptimizing ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Generating {iterations} iteration{iterations !== 1 ? 's' : ''}…
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Run Optimizer
          </>
        )}
      </button>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
              {results.length} iteration{results.length !== 1 ? 's' : ''} generated
            </div>
            {bestIdx !== null && appliedIdx === null && (
              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                ↑ Best result highlighted
              </span>
            )}
          </div>
          {results.map((iter, idx) => (
            <div
              key={idx}
              className={`p-4 border rounded-xl ${
                appliedIdx === idx
                  ? 'border-success bg-success/5'
                  : idx === bestIdx && appliedIdx === null
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1">
                  {idx === bestIdx && appliedIdx === null && (
                    <div className="text-[10px] font-bold text-primary uppercase tracking-wide mb-1">
                      Best
                    </div>
                  )}
                  <p className="text-sm text-text-primary dark:text-dark-text-primary">
                    {iter.description}
                  </p>
                </div>
                {appliedIdx === idx ? (
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                ) : (
                  <button
                    onClick={() => handleApply(idx)}
                    className="px-3 py-1 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shrink-0"
                  >
                    Apply
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      iter.triggerAccuracy >= 0.7
                        ? 'bg-success'
                        : iter.triggerAccuracy >= 0.4
                          ? 'bg-warning'
                          : 'bg-error'
                    }`}
                    style={{ width: `${Math.round(iter.triggerAccuracy * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary w-20 text-right">
                  {Math.round(iter.triggerAccuracy * 100)}% accuracy
                </span>
              </div>
              {iter.reasoning && (
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  {iter.reasoning}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

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
            title="Skip optimization and proceed to Package"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip
          </button>
          <button
            onClick={() => onNext(appliedDesc)}
            className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
