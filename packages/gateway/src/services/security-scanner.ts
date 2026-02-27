/**
 * Unified Security Scanner
 *
 * Orchestrates security analysis across all platform components:
 * - Extensions (skill security audit)
 * - Custom tools (code analysis + security score)
 * - Triggers (action risk assessment)
 * - Workflows (node-level tool risk)
 * - CLI tool policies (catalog risk vs. user policy)
 *
 * Produces a single health score with per-section breakdowns.
 */

import { analyzeToolCode, calculateSecurityScore } from '@ownpilot/core';
import type { CliToolCatalogEntry, CliToolPolicy } from '@ownpilot/core';
import { getExtensionService } from './extension-service.js';
import { auditSkillSecurity, type SkillSecurityResult } from './skill-security-audit.js';
import { CLI_TOOLS_CATALOG, CLI_TOOLS_BY_NAME } from './cli-tools-catalog.js';
import {
  createCustomToolsRepo,
  createTriggersRepository,
  createWorkflowsRepository,
  cliToolPoliciesRepo,
} from '../db/repositories/index.js';
import type { CustomToolRecord } from '../db/repositories/custom-tools.js';
import type { Trigger } from '../db/repositories/triggers.js';
import type { Workflow, WorkflowNode } from '../db/repositories/workflows.js';
import type { ExtensionRecord } from '../db/repositories/extensions.js';
import { getLog } from './log.js';

const log = getLog('SecurityScanner');

// =============================================================================
// TYPES
// =============================================================================

export type SeverityLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskItem {
  source: string;
  sourceId?: string;
  severity: SeverityLevel;
  description: string;
}

export interface SectionScanResult<T = unknown> {
  count: number;
  issues: number;
  score: number;
  items: T[];
}

export interface ExtensionScanItem {
  id: string;
  name: string;
  format: string;
  status: string;
  score: number;
  riskLevel: string;
  blocked: boolean;
  warnings: string[];
}

export interface CustomToolScanItem {
  id: string;
  name: string;
  status: string;
  score: number;
  category: string;
  warnings: string[];
  permissions: string[];
}

export interface TriggerScanItem {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  score: number;
  actionType: string;
  risks: string[];
}

export interface WorkflowScanItem {
  id: string;
  name: string;
  status: string;
  score: number;
  nodeCount: number;
  riskyNodes: string[];
}

export interface CliToolScanItem {
  name: string;
  catalogRisk: string;
  policy: string;
  score: number;
  issue?: string;
}

export interface PlatformScanResult {
  overallScore: number;
  overallLevel: SeverityLevel;
  scannedAt: string;
  sections: {
    extensions: SectionScanResult<ExtensionScanItem>;
    customTools: SectionScanResult<CustomToolScanItem>;
    triggers: SectionScanResult<TriggerScanItem>;
    workflows: SectionScanResult<WorkflowScanItem>;
    cliTools: SectionScanResult<CliToolScanItem>;
  };
  topRisks: RiskItem[];
  recommendations: string[];
}

// =============================================================================
// SECTION WEIGHTS
// =============================================================================

const WEIGHTS = {
  extensions: 0.25,
  customTools: 0.25,
  triggers: 0.2,
  workflows: 0.15,
  cliTools: 0.15,
} as const;

// =============================================================================
// RISK LEVEL MAPPINGS
// =============================================================================

const RISK_TO_SCORE: Record<string, number> = {
  low: 95,
  medium: 70,
  high: 40,
  critical: 10,
};

const TOOL_RISK_SCORES: Record<string, number> = {
  low: 90,
  medium: 70,
  high: 40,
  critical: 15,
};

// Trigger action types and their inherent risk
const TRIGGER_ACTION_RISK: Record<string, number> = {
  chat: 95,
  notification: 95,
  goal_check: 90,
  memory_summary: 90,
  tool: 60, // depends on which tool
  workflow: 50,
};

// =============================================================================
// SCORE UTILITIES
// =============================================================================

function scoreToLevel(score: number): SeverityLevel {
  if (score >= 90) return 'safe';
  if (score >= 70) return 'low';
  if (score >= 50) return 'medium';
  if (score >= 25) return 'high';
  return 'critical';
}

function averageScores(scores: number[]): number {
  if (scores.length === 0) return 100;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// =============================================================================
// EXTENSION SCANNER
// =============================================================================

export function scanExtensions(userId: string): SectionScanResult<ExtensionScanItem> {
  const service = getExtensionService();
  const allExts = service.getAll().filter((e) => e.userId === userId);

  const items: ExtensionScanItem[] = [];
  let issues = 0;

  for (const ext of allExts) {
    const audit = auditSkillSecurity(ext.manifest);
    const score = audit.blocked ? 0 : (RISK_TO_SCORE[audit.riskLevel] ?? 50);

    if (audit.blocked || audit.riskLevel === 'high' || audit.riskLevel === 'critical') {
      issues++;
    }

    items.push({
      id: ext.id,
      name: ext.name,
      format: ext.format,
      status: ext.status,
      score,
      riskLevel: audit.riskLevel,
      blocked: audit.blocked,
      warnings: audit.warnings,
    });
  }

  return {
    count: items.length,
    issues,
    score: averageScores(items.map((i) => i.score)),
    items,
  };
}

// =============================================================================
// CUSTOM TOOLS SCANNER
// =============================================================================

export async function scanCustomTools(
  userId: string
): Promise<SectionScanResult<CustomToolScanItem>> {
  const repo = createCustomToolsRepo(userId);
  const tools = await repo.list();

  const items: CustomToolScanItem[] = [];
  let issues = 0;

  for (const tool of tools) {
    const analysis = analyzeToolCode(tool.code, tool.permissions);
    const secScore = calculateSecurityScore(tool.code, tool.permissions);
    const score = secScore.score;

    const warnings: string[] = [...analysis.warnings];
    if (!analysis.valid) {
      warnings.push(...analysis.errors);
    }

    if (score < 50) {
      issues++;
    }

    items.push({
      id: tool.id,
      name: tool.name,
      status: tool.status,
      score,
      category: secScore.category,
      warnings,
      permissions: tool.permissions,
    });
  }

  return {
    count: items.length,
    issues,
    score: averageScores(items.map((i) => i.score)),
    items,
  };
}

// =============================================================================
// TRIGGERS SCANNER
// =============================================================================

export async function scanTriggers(userId: string): Promise<SectionScanResult<TriggerScanItem>> {
  const repo = createTriggersRepository(userId);
  const triggers = await repo.list();

  const items: TriggerScanItem[] = [];
  let issues = 0;

  for (const trigger of triggers) {
    const { score, risks } = assessTriggerRisk(trigger);

    if (score < 50) {
      issues++;
    }

    items.push({
      id: trigger.id,
      name: trigger.name,
      type: trigger.type,
      enabled: trigger.enabled,
      score,
      actionType: trigger.action.type,
      risks,
    });
  }

  return {
    count: items.length,
    issues,
    score: averageScores(items.map((i) => i.score)),
    items,
  };
}

function assessTriggerRisk(trigger: Trigger): { score: number; risks: string[] } {
  const risks: string[] = [];
  let baseScore = TRIGGER_ACTION_RISK[trigger.action.type] ?? 70;

  // Tool actions: check which tool is invoked
  if (trigger.action.type === 'tool') {
    const toolName = (trigger.action.payload as Record<string, unknown>).tool as string;
    if (toolName) {
      const catalogEntry = CLI_TOOLS_BY_NAME.get(toolName);
      if (catalogEntry) {
        baseScore = TOOL_RISK_SCORES[catalogEntry.riskLevel] ?? 60;
        if (catalogEntry.riskLevel === 'high' || catalogEntry.riskLevel === 'critical') {
          risks.push(`Invokes ${catalogEntry.riskLevel}-risk tool: ${toolName}`);
        }
      } else {
        // Unknown tool — moderate risk
        baseScore = Math.min(baseScore, 60);
        risks.push(`Invokes unrecognized tool: ${toolName}`);
      }
    }
  }

  // Workflow actions inherit some risk
  if (trigger.action.type === 'workflow') {
    risks.push('Triggers automated workflow execution');
  }

  // Disabled triggers are less risky
  if (!trigger.enabled) {
    baseScore = Math.min(100, baseScore + 20);
    if (risks.length > 0) {
      risks.push('Trigger is currently disabled');
    }
  }

  return { score: Math.max(0, Math.min(100, baseScore)), risks };
}

// =============================================================================
// WORKFLOWS SCANNER
// =============================================================================

export async function scanWorkflows(
  userId: string
): Promise<SectionScanResult<WorkflowScanItem>> {
  const repo = createWorkflowsRepository(userId);
  const workflows = await repo.getPage(100, 0);

  const items: WorkflowScanItem[] = [];
  let issues = 0;

  for (const wf of workflows) {
    const { score, riskyNodes } = assessWorkflowRisk(wf);

    if (score < 50) {
      issues++;
    }

    items.push({
      id: wf.id,
      name: wf.name,
      status: wf.status,
      score,
      nodeCount: wf.nodes.length,
      riskyNodes,
    });
  }

  return {
    count: items.length,
    issues,
    score: averageScores(items.map((i) => i.score)),
    items,
  };
}

function assessWorkflowRisk(wf: Workflow): { score: number; riskyNodes: string[] } {
  const riskyNodes: string[] = [];
  let worstScore = 100;

  for (const node of wf.nodes) {
    const nodeScore = assessNodeRisk(node);
    if (nodeScore < 70) {
      riskyNodes.push(`${node.id} (${node.type})`);
    }
    worstScore = Math.min(worstScore, nodeScore);
  }

  // Score = blend of worst node and average
  const nodeScores = wf.nodes.map((n) => assessNodeRisk(n));
  const avg = averageScores(nodeScores);
  const score = Math.round(worstScore * 0.6 + avg * 0.4);

  return { score, riskyNodes };
}

function assessNodeRisk(node: WorkflowNode): number {
  const data = node.data as unknown as Record<string, unknown>;

  switch (node.type) {
    case 'tool': {
      const toolName = (data.toolName as string) ?? '';
      const catalogEntry = CLI_TOOLS_BY_NAME.get(toolName);
      if (catalogEntry) {
        return TOOL_RISK_SCORES[catalogEntry.riskLevel] ?? 60;
      }
      // Unknown tool in workflow
      return 60;
    }
    case 'code':
      // Arbitrary code execution in workflow
      return 35;
    case 'llm':
      return 80;
    case 'condition':
    case 'transformer':
      return 90;
    case 'trigger':
      return 85;
    case 'forEach':
      // Iteration amplifies risk
      return 65;
    default:
      return 75;
  }
}

// =============================================================================
// CLI TOOLS POLICY SCANNER
// =============================================================================

export async function scanCliPolicies(
  userId: string
): Promise<SectionScanResult<CliToolScanItem>> {
  const userPolicies = await cliToolPoliciesRepo.listPolicies(userId);
  const policyMap = new Map(userPolicies.map((p) => [p.toolName, p.policy]));

  const items: CliToolScanItem[] = [];
  let issues = 0;

  for (const catalogEntry of CLI_TOOLS_CATALOG) {
    const userPolicy = policyMap.get(catalogEntry.name);
    const effectivePolicy = userPolicy ?? catalogEntry.defaultPolicy;

    const { score, issue } = assessPolicyRisk(catalogEntry, effectivePolicy);

    if (issue) {
      issues++;
    }

    items.push({
      name: catalogEntry.name,
      catalogRisk: catalogEntry.riskLevel,
      policy: effectivePolicy,
      score,
      issue,
    });
  }

  // Only include items that have issues or non-default policies for brevity
  const relevantItems = items.filter((i) => i.issue || i.score < 90);

  return {
    count: CLI_TOOLS_CATALOG.length,
    issues,
    score: averageScores(items.map((i) => i.score)),
    items: relevantItems,
  };
}

function assessPolicyRisk(
  entry: CliToolCatalogEntry,
  policy: CliToolPolicy
): { score: number; issue?: string } {
  // Blocked = safe regardless of risk
  if (policy === 'blocked') {
    return { score: 100 };
  }

  // Prompt = moderate safety (human in the loop)
  if (policy === 'prompt') {
    if (entry.riskLevel === 'critical') return { score: 70 };
    if (entry.riskLevel === 'high') return { score: 80 };
    return { score: 95 };
  }

  // Allowed — risk depends on tool's inherent risk
  if (entry.riskLevel === 'critical') {
    return {
      score: 15,
      issue: `Critical-risk tool "${entry.name}" is set to allowed without prompt`,
    };
  }
  if (entry.riskLevel === 'high') {
    return {
      score: 40,
      issue: `High-risk tool "${entry.name}" is set to allowed without prompt`,
    };
  }
  if (entry.riskLevel === 'medium') {
    return { score: 75 };
  }

  return { score: 95 };
}

// =============================================================================
// FULL PLATFORM SCAN
// =============================================================================

export async function scanPlatform(userId: string): Promise<PlatformScanResult> {
  const startTime = Date.now();

  // Run all section scans in parallel
  const [extensions, customTools, triggers, workflows, cliTools] = await Promise.all([
    Promise.resolve(scanExtensions(userId)),
    scanCustomTools(userId),
    scanTriggers(userId),
    scanWorkflows(userId),
    scanCliPolicies(userId),
  ]);

  // Weighted average
  const overallScore = Math.round(
    extensions.score * WEIGHTS.extensions +
      customTools.score * WEIGHTS.customTools +
      triggers.score * WEIGHTS.triggers +
      workflows.score * WEIGHTS.workflows +
      cliTools.score * WEIGHTS.cliTools
  );

  const overallLevel = scoreToLevel(overallScore);

  // Collect top risks
  const topRisks = collectTopRisks(extensions, customTools, triggers, workflows, cliTools);

  // Generate recommendations
  const recommendations = generateRecommendations(
    extensions,
    customTools,
    triggers,
    workflows,
    cliTools
  );

  const duration = Date.now() - startTime;
  log.info('Platform scan completed', {
    userId,
    overallScore,
    overallLevel,
    durationMs: duration,
    sections: {
      extensions: extensions.score,
      customTools: customTools.score,
      triggers: triggers.score,
      workflows: workflows.score,
      cliTools: cliTools.score,
    },
  });

  return {
    overallScore,
    overallLevel,
    scannedAt: new Date().toISOString(),
    sections: { extensions, customTools, triggers, workflows, cliTools },
    topRisks,
    recommendations,
  };
}

// =============================================================================
// TOP RISKS COLLECTOR
// =============================================================================

function collectTopRisks(
  extensions: SectionScanResult<ExtensionScanItem>,
  customTools: SectionScanResult<CustomToolScanItem>,
  triggers: SectionScanResult<TriggerScanItem>,
  workflows: SectionScanResult<WorkflowScanItem>,
  cliTools: SectionScanResult<CliToolScanItem>
): RiskItem[] {
  const risks: RiskItem[] = [];

  // Extensions
  for (const ext of extensions.items) {
    if (ext.blocked) {
      risks.push({
        source: 'extension',
        sourceId: ext.id,
        severity: 'critical',
        description: `Extension "${ext.name}" is blocked due to security violations`,
      });
    } else if (ext.riskLevel === 'high' || ext.riskLevel === 'critical') {
      risks.push({
        source: 'extension',
        sourceId: ext.id,
        severity: ext.riskLevel as SeverityLevel,
        description: `Extension "${ext.name}" has ${ext.riskLevel} risk: ${ext.warnings[0] ?? 'multiple warnings'}`,
      });
    }
  }

  // Custom tools
  for (const tool of customTools.items) {
    if (tool.score < 50) {
      risks.push({
        source: 'custom-tool',
        sourceId: tool.id,
        severity: tool.category === 'dangerous' ? 'high' : 'medium',
        description: `Custom tool "${tool.name}" has security score ${tool.score}/100 (${tool.category})`,
      });
    }
  }

  // Triggers
  for (const trigger of triggers.items) {
    for (const risk of trigger.risks) {
      if (trigger.score < 60) {
        risks.push({
          source: 'trigger',
          sourceId: trigger.id,
          severity: trigger.score < 30 ? 'high' : 'medium',
          description: `Trigger "${trigger.name}": ${risk}`,
        });
      }
    }
  }

  // Workflows
  for (const wf of workflows.items) {
    if (wf.riskyNodes.length > 0) {
      risks.push({
        source: 'workflow',
        sourceId: wf.id,
        severity: wf.score < 40 ? 'high' : 'medium',
        description: `Workflow "${wf.name}" has ${wf.riskyNodes.length} risky node(s)`,
      });
    }
  }

  // CLI tools
  for (const item of cliTools.items) {
    if (item.issue) {
      risks.push({
        source: 'cli-tool',
        severity: item.score < 30 ? 'critical' : 'high',
        description: item.issue,
      });
    }
  }

  // Sort by severity (critical first)
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    safe: 4,
  };
  risks.sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5));

  return risks.slice(0, 20); // Top 20 risks
}

// =============================================================================
// RECOMMENDATIONS GENERATOR
// =============================================================================

function generateRecommendations(
  extensions: SectionScanResult<ExtensionScanItem>,
  customTools: SectionScanResult<CustomToolScanItem>,
  triggers: SectionScanResult<TriggerScanItem>,
  workflows: SectionScanResult<WorkflowScanItem>,
  cliTools: SectionScanResult<CliToolScanItem>
): string[] {
  const recs: string[] = [];

  // Extension recommendations
  const blockedExts = extensions.items.filter((e) => e.blocked);
  if (blockedExts.length > 0) {
    recs.push(
      `Remove or replace ${blockedExts.length} blocked extension(s) with prompt injection patterns`
    );
  }

  const highRiskExts = extensions.items.filter(
    (e) => !e.blocked && (e.riskLevel === 'high' || e.riskLevel === 'critical')
  );
  if (highRiskExts.length > 0) {
    recs.push(
      `Review ${highRiskExts.length} high/critical-risk extension(s) — consider running LLM audit for detailed analysis`
    );
  }

  // Custom tool recommendations
  const dangerousTools = customTools.items.filter((t) => t.category === 'dangerous');
  if (dangerousTools.length > 0) {
    recs.push(
      `${dangerousTools.length} custom tool(s) flagged as dangerous — review code and permissions`
    );
  }

  const noPermTools = customTools.items.filter(
    (t) => t.permissions.length === 0 && t.warnings.length > 0
  );
  if (noPermTools.length > 0) {
    recs.push(`${noPermTools.length} custom tool(s) have warnings but no declared permissions`);
  }

  // Trigger recommendations
  const riskyTriggers = triggers.items.filter((t) => t.enabled && t.score < 50);
  if (riskyTriggers.length > 0) {
    recs.push(
      `${riskyTriggers.length} active trigger(s) have low security scores — consider adding approval requirements`
    );
  }

  // Workflow recommendations
  const riskyWorkflows = workflows.items.filter((w) => w.riskyNodes.length > 0);
  if (riskyWorkflows.length > 0) {
    recs.push(
      `${riskyWorkflows.length} workflow(s) contain risky nodes — review code execution and tool usage`
    );
  }

  // CLI tool recommendations
  if (cliTools.issues > 0) {
    recs.push(
      `${cliTools.issues} CLI tool(s) have risky policies — consider changing high-risk tools from "allowed" to "prompt"`
    );
  }

  // General recommendations
  if (extensions.score < 70 || customTools.score < 70) {
    recs.push('Run LLM-powered deep audit on low-scoring extensions and custom tools');
  }

  return recs;
}
