/**
 * Code Risk Analyzer (Layer 2 Security)
 *
 * Analyzes code snippets for risk factors before execution.
 * Used by the approval dialog to show risk level and factors.
 */

import { checkCriticalPatterns } from './index.js';

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskFactor {
  readonly pattern: string;
  readonly description: string;
  readonly severity: RiskLevel;
}

export interface CodeRiskAnalysis {
  readonly level: RiskLevel;
  readonly score: number; // 0-100
  readonly factors: readonly RiskFactor[];
  readonly blocked: boolean;
  readonly blockReason?: string;
}

interface RiskPattern {
  readonly regex: RegExp;
  readonly description: string;
  readonly severity: RiskLevel;
  readonly score: number;
  readonly languages: readonly ('javascript' | 'python' | 'shell')[];
}

const RISK_PATTERNS: readonly RiskPattern[] = [
  // High risk - system access
  { regex: /\bprocess\.env\b/, description: 'Environment variable access', severity: 'high', score: 25, languages: ['javascript'] },
  { regex: /\brequire\s*\(\s*['"]child_process['"]\s*\)/, description: 'Child process spawning', severity: 'high', score: 30, languages: ['javascript'] },
  { regex: /\bimport\s+.*child_process/, description: 'Child process import', severity: 'high', score: 30, languages: ['javascript'] },
  { regex: /\bsubprocess\b/, description: 'Subprocess module', severity: 'high', score: 30, languages: ['python'] },
  { regex: /\bos\.system\b/, description: 'OS system command', severity: 'high', score: 30, languages: ['python'] },
  { regex: /\bos\.popen\b/, description: 'OS process pipe', severity: 'high', score: 30, languages: ['python'] },
  { regex: /\beval\s*\(/, description: 'Dynamic code evaluation', severity: 'high', score: 25, languages: ['javascript', 'python'] },
  { regex: /\bexec\s*\(/, description: 'Dynamic code execution', severity: 'high', score: 25, languages: ['javascript', 'python'] },
  { regex: /\bfs\.(writeFile|appendFile|unlink|rmdir|rm)\b/, description: 'Filesystem write operation', severity: 'high', score: 20, languages: ['javascript'] },
  { regex: /\bopen\s*\([^)]*['"][wa]/, description: 'File write mode', severity: 'high', score: 20, languages: ['python'] },
  { regex: /\bshutil\.(rmtree|move|copy)\b/, description: 'File system manipulation', severity: 'high', score: 20, languages: ['python'] },
  { regex: /\bctypes\b/, description: 'C-level API access', severity: 'high', score: 25, languages: ['python'] },

  // Medium risk - network and external
  { regex: /\bfetch\s*\(/, description: 'Network request (fetch)', severity: 'medium', score: 15, languages: ['javascript'] },
  { regex: /\brequests\.(get|post|put|delete|patch)\b/, description: 'HTTP request', severity: 'medium', score: 15, languages: ['python'] },
  { regex: /\burllib\b/, description: 'URL library', severity: 'medium', score: 15, languages: ['python'] },
  { regex: /\bhttpx?\b/, description: 'HTTP client', severity: 'medium', score: 15, languages: ['python'] },
  { regex: /\bcurl\s/, description: 'curl command', severity: 'medium', score: 15, languages: ['shell'] },
  { regex: /\bwget\s/, description: 'wget command', severity: 'medium', score: 15, languages: ['shell'] },
  { regex: /\brequire\s*\(\s*['"]fs['"]\s*\)/, description: 'Filesystem module', severity: 'medium', score: 10, languages: ['javascript'] },
  { regex: /\bimport\s+.*\bfs\b/, description: 'Filesystem import', severity: 'medium', score: 10, languages: ['javascript'] },
  { regex: /\bsocket\b/, description: 'Socket operation', severity: 'medium', score: 15, languages: ['javascript', 'python'] },
  { regex: /\bnpm\s+(install|i)\b/, description: 'Package installation', severity: 'medium', score: 15, languages: ['shell'] },
  { regex: /\bpip\s+install\b/, description: 'Pip installation', severity: 'medium', score: 15, languages: ['shell'] },
  { regex: /\bsudo\s/, description: 'Superuser command', severity: 'medium', score: 20, languages: ['shell'] },
  { regex: /\bchmod\b/, description: 'Permission change', severity: 'medium', score: 10, languages: ['shell'] },
  { regex: /\bchown\b/, description: 'Ownership change', severity: 'medium', score: 10, languages: ['shell'] },

  // Low risk - standard operations
  { regex: /\bconsole\.(log|warn|error|info)\b/, description: 'Console output', severity: 'low', score: 0, languages: ['javascript'] },
  { regex: /\bprint\s*\(/, description: 'Print output', severity: 'low', score: 0, languages: ['python'] },
  { regex: /\becho\s/, description: 'Echo output', severity: 'low', score: 0, languages: ['shell'] },
  { regex: /\bJSON\.(parse|stringify)\b/, description: 'JSON operation', severity: 'low', score: 0, languages: ['javascript'] },
  { regex: /\bMath\.\w+/, description: 'Math operation', severity: 'low', score: 0, languages: ['javascript'] },
];

const RISK_THRESHOLDS: Record<RiskLevel, number> = {
  safe: 0,
  low: 1,
  medium: 15,
  high: 30,
  critical: 100,
};

function scoreToLevel(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.high) return 'high';
  if (score >= RISK_THRESHOLDS.medium) return 'medium';
  if (score >= RISK_THRESHOLDS.low) return 'low';
  return 'safe';
}

/**
 * Analyze code for risk factors (Layer 2 security).
 * Returns risk level, score, matched factors, and whether it's critically blocked.
 */
export function analyzeCodeRisk(
  code: string,
  language: 'javascript' | 'python' | 'shell',
): CodeRiskAnalysis {
  // Layer 1 check first
  const critical = checkCriticalPatterns(code);
  if (critical.blocked) {
    return {
      level: 'critical',
      score: 100,
      factors: [{ pattern: 'critical', description: critical.reason ?? 'Critical pattern detected', severity: 'critical' }],
      blocked: true,
      blockReason: critical.reason,
    };
  }

  const factors: RiskFactor[] = [];
  let totalScore = 0;

  for (const riskPattern of RISK_PATTERNS) {
    if (!riskPattern.languages.includes(language)) continue;
    if (riskPattern.regex.test(code)) {
      factors.push({
        pattern: riskPattern.regex.source,
        description: riskPattern.description,
        severity: riskPattern.severity,
      });
      totalScore += riskPattern.score;
    }
  }

  // Cap at 99 (100 = critical/blocked only)
  const score = Math.min(totalScore, 99);

  return {
    level: scoreToLevel(score),
    score,
    factors,
    blocked: false,
  };
}
