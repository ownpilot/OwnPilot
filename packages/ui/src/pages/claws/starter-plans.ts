/**
 * Starter plans per preset.
 *
 * When a claw is created from a known preset and has an empty plan, the
 * PlanTab offers to seed these tasks in one click. They are deliberately
 * generic — the agent will refine them on the first cycle — but each one
 * commits the agent to a concrete first-step structure with success
 * criteria, which is the part that's hardest to recover from a cold start.
 *
 * Keep titles short (renders in tight rows) and successCriteria concrete
 * enough to be falsifiable. Avoid more than ~6 starter tasks per preset —
 * the agent should expand the plan as it learns, not start drowning in it.
 */

export interface StarterTask {
  id: string;
  title: string;
  successCriteria?: string;
}

export const STARTER_PLANS: Record<string, StarterTask[]> = {
  research: [
    {
      id: 't1',
      title: 'Scope the research question',
      successCriteria: 'Concrete, falsifiable question recorded in .claw/MEMORY.md',
    },
    {
      id: 't2',
      title: 'Find 3-5 authoritative sources',
      successCriteria: 'Each source captured with URL, author, date',
    },
    {
      id: 't3',
      title: 'Extract key findings from each source',
      successCriteria: 'Per-source 3-5 bullet summary saved as artifact',
    },
    {
      id: 't4',
      title: 'Synthesize findings into a coherent report',
      successCriteria: 'Report cites sources inline and notes any contradictions',
    },
    {
      id: 't5',
      title: 'Surface open questions and confidence',
      successCriteria: 'Open questions list and per-claim confidence level recorded',
    },
  ],
  'code-review': [
    {
      id: 't1',
      title: 'Identify the review scope (files, modules, PR)',
      successCriteria: 'Scope written to .claw/MEMORY.md with exact paths',
    },
    {
      id: 't2',
      title: 'Run static analysis (eslint, tsc, tests)',
      successCriteria: 'Tool outputs captured; no analysis tools skipped',
    },
    {
      id: 't3',
      title: 'Review for security issues',
      successCriteria: 'OWASP top-10 categories considered; findings cite file:line',
    },
    {
      id: 't4',
      title: 'Review for performance issues',
      successCriteria: 'Hot paths identified; complexity / N+1 / leak risks flagged',
    },
    {
      id: 't5',
      title: 'Produce severity-ranked findings report',
      successCriteria: 'Each finding has severity, file:line, why, suggested fix',
    },
  ],
  'data-analysis': [
    {
      id: 't1',
      title: 'Load and inspect the data',
      successCriteria: 'Schema, row count, null rates, dtype summary captured',
    },
    {
      id: 't2',
      title: 'State analysis assumptions',
      successCriteria: 'Assumptions written down before computing anything',
    },
    {
      id: 't3',
      title: 'Compute descriptive statistics',
      successCriteria: 'Means, medians, distributions per column saved',
    },
    {
      id: 't4',
      title: 'Generate visualizations',
      successCriteria: 'At least 2 charts published as artifacts',
    },
    {
      id: 't5',
      title: 'Write analysis report with caveats',
      successCriteria: 'Report ties each conclusion to a chart or stat; lists caveats',
    },
  ],
  monitor: [
    {
      id: 't1',
      title: 'Confirm the monitored endpoints and SLOs',
      successCriteria: 'URLs, expected status, latency budgets recorded',
    },
    {
      id: 't2',
      title: 'Probe each endpoint and capture baseline',
      successCriteria: 'Initial response time and content fingerprint stored',
    },
    {
      id: 't3',
      title: 'Define alert thresholds',
      successCriteria: 'Per-endpoint thresholds in .claw/MEMORY.md',
    },
    {
      id: 't4',
      title: 'Run the monitoring loop',
      successCriteria: 'No false positives in first 5 cycles; alerts only on real drift',
    },
  ],
  content: [
    {
      id: 't1',
      title: 'Clarify brief, audience, and tone',
      successCriteria: 'One-line spec for each of the three captured',
    },
    {
      id: 't2',
      title: 'Outline the piece',
      successCriteria: 'Section headings + 1-line summary each',
    },
    {
      id: 't3',
      title: 'Draft v1',
      successCriteria: 'Full draft saved as artifact',
    },
    {
      id: 't4',
      title: 'Self-edit pass — cut, tighten, fact-check',
      successCriteria: 'Word count reduced by at least 10% or rationale noted',
    },
    {
      id: 't5',
      title: 'Publish final',
      successCriteria: 'Final artifact published with brief editorial rationale',
    },
  ],
  'event-reactor': [
    {
      id: 't1',
      title: 'Document which events this claw reacts to',
      successCriteria: 'Event filters list + per-event action recorded',
    },
    {
      id: 't2',
      title: 'Define idempotency strategy',
      successCriteria: 'Per-event dedupe key documented in .claw/MEMORY.md',
    },
    {
      id: 't3',
      title: 'Define escalation criteria',
      successCriteria: 'Conditions for claw_request_escalation written down',
    },
    {
      id: 't4',
      title: 'Run the reactor loop',
      successCriteria: 'Each handled event logged; ambiguous events escalated',
    },
  ],
};

export function getStarterPlan(preset?: string | null): StarterTask[] | null {
  if (!preset) return null;
  return STARTER_PLANS[preset] ?? null;
}
