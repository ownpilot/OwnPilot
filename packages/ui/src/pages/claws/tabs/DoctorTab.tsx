import type { ClawConfig, ClawDoctorResponse } from '../../../api/endpoints/claws';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { Wrench, RefreshCw, CheckCircle2, AlertTriangle } from '../../../components/icons';
import { labelClass as lbl } from '../utils';

const patchLabel: Record<string, string> = {
  mission_contract: 'Mission contract',
  stop_condition: 'Stop condition',
  autonomy_policy: 'Autonomy policy',
};

function formatPatchValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  if (value === null) return 'clear';
  if (value === undefined) return '-';
  return String(value);
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
  const patchEntries = Object.entries(doctor?.patch ?? {});
  const health = doctor?.health ?? claw.health;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Health Report
          </p>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Configuration diagnostics and safe fixes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDoctor}
            disabled={isLoadingDoctor}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            onClick={applyDoctorFixes}
            disabled={isLoadingDoctor || isApplyingDoctorFixes || patchEntries.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            <Wrench className="w-3.5 h-3.5" />
            {isApplyingDoctorFixes ? 'Applying...' : 'Apply Fixes'}
          </button>
        </div>
      </div>

      {isLoadingDoctor ? (
        <LoadingSpinner message="Running diagnostics..." />
      ) : (
        <>
          {health && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: 'Health',
                  value: health.score,
                  color:
                    health.score >= 80
                      ? 'text-green-400'
                      : health.score >= 50
                        ? 'text-amber-400'
                        : 'text-red-400',
                },
                { label: 'Status', value: health.status, color: 'text-text-primary' },
                {
                  label: 'Contract',
                  value: health.contractScore,
                  color: health.contractScore >= 80 ? 'text-green-400' : 'text-amber-400',
                },
                {
                  label: 'Warnings',
                  value: health.policyWarnings.length,
                  color: health.policyWarnings.length > 0 ? 'text-amber-400' : 'text-green-400',
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3 text-center"
                >
                  <p className="text-xs text-text-muted dark:text-dark-text-muted">{s.label}</p>
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {(health?.signals.length ?? 0) > 0 && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
              <p className={lbl}>Signals</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {health!.signals.map((signal) => (
                  <span
                    key={signal}
                    className="px-2 py-0.5 text-xs rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  >
                    {signal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {patchEntries.length > 0 ? (
            <div className="space-y-2">
              <p className={lbl}>Recommended Fixes ({patchEntries.length})</p>
              {patchEntries.map(([field, value]) => (
                <div
                  key={field}
                  className="p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                      {patchLabel[field] ?? field}
                    </p>
                    <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded shrink-0">
                      auto-fix
                    </span>
                  </div>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-text-secondary dark:text-dark-text-secondary font-mono">
                    {formatPatchValue(value)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                All checks passed. No fixes needed.
              </p>
            </div>
          )}

          {(doctor?.skipped.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Manual decisions needed
                </p>
                <ul className="mt-1 list-disc list-inside text-xs text-amber-700/80 dark:text-amber-300/80 space-y-0.5">
                  {doctor!.skipped.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

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
