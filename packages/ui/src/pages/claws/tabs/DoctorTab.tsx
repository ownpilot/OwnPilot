import { useState } from 'react';
import type { ClawConfig, ClawDoctorResponse } from '../../../api/endpoints/claws';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import {
  Wrench,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from '../../../components/icons';
import { labelClass as lbl } from '../utils';

const STATUS_COLOR: Record<string, string> = {
  healthy: 'text-emerald-400',
  watch: 'text-amber-400',
  stuck: 'text-red-400',
  expensive: 'text-amber-400',
  failed: 'text-red-400',
  idle: 'text-gray-400',
};

const SIGNAL_COLORS: Record<string, string> = {
  error: 'bg-red-500/10 text-red-600',
  warning: 'bg-amber-500/10 text-amber-600',
  info: 'bg-blue-500/10 text-blue-600',
  success: 'bg-emerald-500/10 text-emerald-600',
};

function formatPatchValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  if (value === null) return 'clear';
  if (value === undefined) return '-';
  return String(value);
}

function ContractGauge({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" className="transform -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#1a1a1a" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export function DoctorTab({
  claw,
  doctor,
  isLoadingDoctor,
  isApplyingDoctorFixes,
  loadDoctor,
  applyDoctorFixes,
}: {
  claw: ClawConfig;
  doctor: ClawDoctorResponse | null;
  isLoadingDoctor: boolean;
  isApplyingDoctorFixes: boolean;
  loadDoctor: () => void;
  applyDoctorFixes: () => void;
}) {
  const [expandedPatches, setExpandedPatches] = useState<Set<string>>(new Set());
  const patchEntries = Object.entries(doctor?.patch ?? {});
  const health = doctor?.health ?? claw.health;

  const togglePatch = (key: string) => {
    setExpandedPatches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const healthScore = health?.score ?? 0;
  const contractScore = health?.contractScore ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Health Report
          </p>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Configuration diagnostics and recommended fixes.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={loadDoctor}
            disabled={isLoadingDoctor}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDoctor ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={applyDoctorFixes}
            disabled={isLoadingDoctor || isApplyingDoctorFixes || patchEntries.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Wrench className="w-3.5 h-3.5" />
            {isApplyingDoctorFixes ? 'Applying...' : `Apply ${patchEntries.length} Fixes`}
          </button>
        </div>
      </div>

      {isLoadingDoctor ? (
        <LoadingSpinner message="Running diagnostics..." />
      ) : (
        <>
          {/* Health + Contract gauges */}
          {health && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
                <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Health</p>
                <ContractGauge score={healthScore} />
                <p
                  className={`text-xs font-medium mt-1 ${STATUS_COLOR[health.status] ?? 'text-text-muted'}`}
                >
                  {health.status}
                </p>
              </div>
              <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
                <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Contract</p>
                <ContractGauge score={contractScore} />
                <p className="text-xs font-medium mt-1 text-text-primary dark:text-dark-text-primary">
                  score
                </p>
              </div>
              <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
                <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Signals</p>
                <p className="text-xl font-bold text-text-primary dark:text-dark-text-primary">
                  {health.signals.length}
                </p>
                <p className="text-[10px] text-text-muted">detected</p>
              </div>
              <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 flex flex-col items-center text-center">
                <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Warnings</p>
                <p
                  className={`text-xl font-bold ${health.policyWarnings.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
                >
                  {health.policyWarnings.length}
                </p>
                <p className="text-[10px] text-text-muted">policy</p>
              </div>
            </div>
          )}

          {/* Signals */}
          {(health?.signals.length ?? 0) > 0 && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
              <p className={lbl}>Signals ({health!.signals.length})</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {health!.signals.map((signal) => {
                  const s = signal.toLowerCase();
                  const color =
                    s.includes('error') || s.includes('fail') || s.includes('stuck')
                      ? SIGNAL_COLORS.error
                      : s.includes('cost') || s.includes('expensive')
                        ? SIGNAL_COLORS.warning
                        : SIGNAL_COLORS.info;
                  return (
                    <span key={signal} className={`px-2 py-0.5 text-xs rounded-full ${color}`}>
                      {signal}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Policy warnings */}
          {(health?.policyWarnings.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Policy Warnings
                </p>
                <ul className="mt-1 list-disc list-inside text-xs text-amber-700/80 dark:text-amber-300/80 space-y-0.5">
                  {health!.policyWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Recommended fixes */}
          {patchEntries.length > 0 ? (
            <div className="space-y-2">
              <p className={lbl}>Recommended Fixes ({patchEntries.length})</p>
              {patchEntries.map(([field, value]) => {
                const isOpen = expandedPatches.has(field);
                return (
                  <div
                    key={field}
                    className="rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border overflow-hidden"
                  >
                    <button
                      onClick={() => togglePatch(field)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                          {field}
                        </span>
                        <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded">
                          auto-fix
                        </span>
                      </div>
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                      )}
                    </button>
                    {isOpen && (
                      <pre className="px-3 pb-3 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-text-secondary dark:text-dark-text-secondary font-mono border-t border-border dark:border-dark-border pt-2">
                        {formatPatchValue(value)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                All checks passed. No fixes needed.
              </p>
            </div>
          )}

          {/* Skipped fixes */}
          {(doctor?.skipped.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Skipped — manual review needed
                </p>
                <ul className="mt-1 list-disc list-inside text-xs text-amber-700/80 dark:text-amber-300/80 space-y-0.5">
                  {doctor!.skipped.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {(health?.recommendations.length ?? 0) > 0 && (
            <div className="p-3 rounded-lg border border-border dark:border-dark-border">
              <p className={lbl}>Recommendations</p>
              <ul className="mt-2 list-disc list-inside text-xs text-text-secondary dark:text-dark-text-secondary space-y-1">
                {health!.recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
