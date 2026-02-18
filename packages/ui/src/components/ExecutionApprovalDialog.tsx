/**
 * Execution Approval Dialog
 *
 * Real-time modal overlay shown when a tool execution requires user approval
 * (permission mode = 'prompt'). Displays code preview, risk analysis,
 * and a countdown timer. User can approve or reject.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, Clock, Shield, X } from './icons';
import type { ApprovalRequest, CodeRiskAnalysis } from '../api';

const TIMEOUT_SECONDS = 120;

interface ExecutionApprovalDialogProps {
  approval: ApprovalRequest;
  onResolve: (approved: boolean) => void;
}

const RISK_COLORS: Record<string, string> = {
  safe: 'text-green-500',
  low: 'text-green-600 dark:text-green-400',
  medium: 'text-amber-500',
  high: 'text-red-500',
  critical: 'text-red-600 dark:text-red-400',
};

const RISK_BG: Record<string, string> = {
  safe: 'bg-green-500/10',
  low: 'bg-green-500/10',
  medium: 'bg-amber-500/10',
  high: 'bg-red-500/10',
  critical: 'bg-red-500/10',
};

function RiskBadge({ risk }: { risk: CodeRiskAnalysis }) {
  const color = RISK_COLORS[risk.level] ?? 'text-text-muted';
  const bg = RISK_BG[risk.level] ?? 'bg-bg-tertiary';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color} ${bg}`}>
      {risk.level.charAt(0).toUpperCase() + risk.level.slice(1)} (score: {risk.score})
    </span>
  );
}

export function ExecutionApprovalDialog({ approval, onResolve }: ExecutionApprovalDialogProps) {
  const [remaining, setRemaining] = useState(TIMEOUT_SECONDS);
  const backdropRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(Date.now());
  // Stable ref to latest onResolve — avoids stale closure in timer
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  // Countdown timer
  useEffect(() => {
    startRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
      const left = TIMEOUT_SECONDS - elapsed;
      if (left <= 0) {
        clearInterval(interval);
        onResolveRef.current(false);
      } else {
        setRemaining(left);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [approval.approvalId]);

  // Keyboard: Enter = approve, Escape = reject
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onResolve(true);
      } else if (e.key === 'Escape') {
        onResolve(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onResolve]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) {
      onResolve(false);
    }
  }, [onResolve]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const isUrgent = remaining <= 30;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] animate-[fadeIn_150ms_ease-out]"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg mx-4 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-2xl animate-[scaleIn_150ms_ease-out]">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
                Code Execution Approval
              </h3>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                {approval.category}
              </p>
            </div>
          </div>
          <button
            onClick={() => onResolve(false)}
            className="p-1.5 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          </button>
        </div>

        {/* Description */}
        <div className="px-6 pb-3">
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary">
            {approval.description}
          </p>
        </div>

        {/* Code Preview */}
        {approval.code && (
          <div className="mx-6 mb-3 rounded-lg overflow-hidden border border-border dark:border-dark-border bg-[#1e1e1e]">
            <pre className="p-3 text-xs font-mono text-gray-300 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed">
              {approval.code}
            </pre>
          </div>
        )}

        {/* Risk Analysis */}
        {approval.riskAnalysis && (
          <div className="mx-6 mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
              <span className="text-xs text-text-muted dark:text-dark-text-muted">Risk Analysis:</span>
              <RiskBadge risk={approval.riskAnalysis} />
            </div>
            {approval.riskAnalysis.factors.length > 0 && (
              <ul className="space-y-0.5 pl-5">
                {approval.riskAnalysis.factors.map((factor, idx) => (
                  <li key={idx} className="text-xs text-text-secondary dark:text-dark-text-secondary flex items-start gap-1.5">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-text-muted dark:bg-dark-text-muted flex-shrink-0" />
                    {factor.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Timer */}
        <div className="mx-6 mb-4 flex items-center gap-2">
          <Clock className={`w-3.5 h-3.5 ${isUrgent ? 'text-red-500 animate-pulse' : 'text-text-muted dark:text-dark-text-muted'}`} />
          <span className={`text-xs ${isUrgent ? 'text-red-500 font-medium' : 'text-text-muted dark:text-dark-text-muted'}`}>
            Auto-reject in {timeStr}
          </span>
        </div>

        {/* Actions */}
        <div className="px-6 pb-5 flex justify-end gap-3">
          <button
            onClick={() => onResolve(false)}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => onResolve(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
