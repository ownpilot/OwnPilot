/**
 * Security Dashboard Page
 *
 * Unified security scanner with overall health score,
 * per-section breakdowns, top risks, and recommendations.
 */

import { useState, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  RefreshCw,
} from '../components/icons';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { securityApi } from '../api/endpoints/security';
import type {
  PlatformScanResult,
  SeverityLevel,
  RiskItem,
  SectionScanResult,
} from '../api/endpoints/security';

// =============================================================================
// Score Colors
// =============================================================================

function scoreColor(score: number): string {
  if (score >= 90) return 'text-success';
  if (score >= 70) return 'text-primary';
  if (score >= 50) return 'text-warning';
  return 'text-error';
}

function scoreBg(score: number): string {
  if (score >= 90) return 'bg-success/10 border-success/30';
  if (score >= 70) return 'bg-primary/10 border-primary/30';
  if (score >= 50) return 'bg-warning/10 border-warning/30';
  return 'bg-error/10 border-error/30';
}

function levelBadge(level: SeverityLevel): { text: string; color: string } {
  switch (level) {
    case 'safe':
      return { text: 'Safe', color: 'bg-success/15 text-success' };
    case 'low':
      return { text: 'Low Risk', color: 'bg-primary/15 text-primary' };
    case 'medium':
      return { text: 'Medium Risk', color: 'bg-warning/15 text-warning' };
    case 'high':
      return { text: 'High Risk', color: 'bg-error/15 text-error' };
    case 'critical':
      return { text: 'Critical', color: 'bg-error/20 text-error font-semibold' };
  }
}

function severityIcon(severity: string) {
  switch (severity) {
    case 'critical':
    case 'high':
      return <AlertCircle className="w-4 h-4 text-error shrink-0" />;
    case 'medium':
      return <AlertTriangle className="w-4 h-4 text-warning shrink-0" />;
    default:
      return <Info className="w-4 h-4 text-primary shrink-0" />;
  }
}

// =============================================================================
// Score Gauge
// =============================================================================

function ScoreGauge({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color =
    score >= 90
      ? 'stroke-success'
      : score >= 70
        ? 'stroke-primary'
        : score >= 50
          ? 'stroke-warning'
          : 'stroke-error';

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-border dark:text-dark-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          className={`${color} transition-all duration-1000 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</span>
        <span className="text-xs text-text-muted dark:text-dark-text-muted">/100</span>
      </div>
    </div>
  );
}

// =============================================================================
// Section Card
// =============================================================================

function SectionCard({
  title,
  section,
  expanded,
  onToggle,
}: {
  title: string;
  section: SectionScanResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`rounded-lg border ${scoreBg(section.score)} p-4 cursor-pointer transition-colors hover:opacity-90`}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`text-lg font-bold ${scoreColor(section.score)}`}>{section.score}</div>
          <div>
            <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              {title}
            </div>
            <div className="text-xs text-text-muted dark:text-dark-text-muted">
              {section.count} item{section.count !== 1 ? 's' : ''}
              {section.issues > 0 && (
                <span className="text-error ml-1">
                  ({section.issues} issue{section.issues !== 1 ? 's' : ''})
                </span>
              )}
            </div>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && section.items.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/30 dark:border-dark-border/30 space-y-2">
          {(section.items as Array<Record<string, unknown>>).map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-xs bg-bg-primary/50 dark:bg-dark-bg-primary/50 rounded px-3 py-2"
            >
              <span className="text-text-primary dark:text-dark-text-primary truncate mr-2">
                {(item.name as string) ?? (item.id as string) ?? `Item ${i + 1}`}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {typeof item.issue === 'string' && (
                  <span className="text-error truncate max-w-48" title={item.issue}>
                    {item.issue}
                  </span>
                )}
                {Array.isArray(item.warnings) && (item.warnings as string[]).length > 0 && (
                  <span className="text-warning">
                    {(item.warnings as string[]).length} warning
                    {(item.warnings as string[]).length !== 1 ? 's' : ''}
                  </span>
                )}
                {Array.isArray(item.risks) && (item.risks as string[]).length > 0 && (
                  <span className="text-warning">
                    {(item.risks as string[]).length} risk
                    {(item.risks as string[]).length !== 1 ? 's' : ''}
                  </span>
                )}
                {Array.isArray(item.riskyNodes) && (item.riskyNodes as string[]).length > 0 && (
                  <span className="text-warning">
                    {(item.riskyNodes as string[]).length} risky node
                    {(item.riskyNodes as string[]).length !== 1 ? 's' : ''}
                  </span>
                )}
                <span className={`font-medium ${scoreColor(item.score as number)}`}>
                  {item.score as number}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && section.items.length === 0 && (
        <div className="mt-3 pt-3 border-t border-border/30 dark:border-dark-border/30">
          <div className="text-xs text-text-muted dark:text-dark-text-muted flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            No items to scan
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Risk List
// =============================================================================

function RiskList({ risks }: { risks: RiskItem[] }) {
  if (risks.length === 0) {
    return (
      <div className="text-sm text-text-muted dark:text-dark-text-muted flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-success" />
        No risks detected
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {risks.map((risk, i) => {
        const badge = levelBadge(risk.severity);
        return (
          <div
            key={i}
            className="flex items-start gap-3 text-sm bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg p-3"
          >
            {severityIcon(risk.severity)}
            <div className="flex-1 min-w-0">
              <div className="text-text-primary dark:text-dark-text-primary">
                {risk.description}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs px-1.5 py-0.5 rounded ${badge.color}`}>{badge.text}</span>
                <span className="text-xs text-text-muted dark:text-dark-text-muted capitalize">
                  {risk.source}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export function SecurityDashboardPage() {
  const toast = useToast();
  const [result, setResult] = useState<PlatformScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const runScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const data = await securityApi.scan();
      setResult(data);
      toast.success(`Scan complete: ${data.overallScore}/100`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [toast]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border dark:border-dark-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Security Scanner
              </h1>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Unified vulnerability analysis across all platform components
              </p>
            </div>
          </div>
          <button
            onClick={runScan}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isScanning ? (
              <>
                <LoadingSpinner size="sm" />
                Scanning...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Scan Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!result && !isScanning && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <ShieldCheck className="w-12 h-12 text-text-muted dark:text-dark-text-muted mb-4" />
            <h2 className="text-lg font-medium text-text-primary dark:text-dark-text-primary mb-2">
              No scan results yet
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4 max-w-md">
              Run a security scan to analyze your extensions, custom tools, triggers, workflows, and
              CLI tool policies for potential vulnerabilities.
            </p>
            <button
              onClick={runScan}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition-colors"
            >
              Run First Scan
            </button>
          </div>
        )}

        {isScanning && !result && (
          <div className="flex flex-col items-center justify-center h-64">
            <LoadingSpinner size="md" />
            <p className="text-sm text-text-muted dark:text-dark-text-muted mt-4">
              Scanning all platform components...
            </p>
          </div>
        )}

        {result && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Overall Score */}
            <div className="flex items-center gap-6 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-6">
              <ScoreGauge score={result.overallScore} />
              <div>
                <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                  Overall Health Score
                </h2>
                <div className="mt-1">
                  {(() => {
                    const badge = levelBadge(result.overallLevel);
                    return (
                      <span className={`text-sm px-2 py-1 rounded ${badge.color}`}>
                        {badge.text}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
                  Scanned at {new Date(result.scannedAt).toLocaleString('en-US')}
                </p>
                <p className="text-xs text-text-muted dark:text-dark-text-muted">
                  {result.topRisks.length} risk{result.topRisks.length !== 1 ? 's' : ''} detected
                  across {Object.values(result.sections).reduce((a, s) => a + s.count, 0)} items
                </p>
              </div>
            </div>

            {/* Section Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SectionCard
                title="Extensions"
                section={result.sections.extensions}
                expanded={expandedSections.has('extensions')}
                onToggle={() => toggleSection('extensions')}
              />
              <SectionCard
                title="Custom Tools"
                section={result.sections.customTools}
                expanded={expandedSections.has('customTools')}
                onToggle={() => toggleSection('customTools')}
              />
              <SectionCard
                title="Triggers"
                section={result.sections.triggers}
                expanded={expandedSections.has('triggers')}
                onToggle={() => toggleSection('triggers')}
              />
              <SectionCard
                title="Workflows"
                section={result.sections.workflows}
                expanded={expandedSections.has('workflows')}
                onToggle={() => toggleSection('workflows')}
              />
              <SectionCard
                title="CLI Tools"
                section={result.sections.cliTools}
                expanded={expandedSections.has('cliTools')}
                onToggle={() => toggleSection('cliTools')}
              />
            </div>

            {/* Top Risks */}
            <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
              <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-3">
                Top Risks
              </h3>
              <RiskList risks={result.topRisks} />
            </div>

            {/* Recommendations */}
            {result.recommendations.length > 0 && (
              <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
                <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-3">
                  Recommendations
                </h3>
                <ul className="space-y-2">
                  {result.recommendations.map((rec, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-text-secondary dark:text-dark-text-secondary"
                    >
                      <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
