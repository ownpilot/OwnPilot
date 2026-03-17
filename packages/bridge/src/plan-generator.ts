/**
 * Plan Generator Module (Phase 18 — God Mode P0)
 *
 * Converts research findings + DA risk assessment into GSD-compatible PLAN.md files.
 *
 * Functions:
 * - formatPlanMd: Produces GSD-compatible PLAN.md content with YAML frontmatter
 * - parsePlanOutput: Extracts and validates GeneratedPlan JSON from CC output
 * - writePlanFiles: Writes PLAN.md files to .planning/phases/ directory
 * - generatePlans: Orchestrates CC synthesis to generate plans from research
 * - slugify: Internal helper for title normalization
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { claudeManager } from './claude-manager.ts';
import type {
  GeneratedPlan,
  GeneratedPlanEntry,
  PlanGenerationInput,
  StreamChunk,
} from './types.ts';

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

/**
 * Normalize a title for use in directory/file names.
 * Lowercase, replace non-alphanumeric with hyphens, collapse multiples, trim, max 40 chars.
 */
export function slugify(title: string): string {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric sequences with single hyphen
    .replace(/-{2,}/g, '-')       // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');     // trim leading/trailing hyphens

  if (slug.length > 40) {
    slug = slug.substring(0, 40);
    // Remove trailing hyphen after truncation
    slug = slug.replace(/-+$/, '');
  }

  return slug;
}

// ---------------------------------------------------------------------------
// formatPlanMd
// ---------------------------------------------------------------------------

/**
 * Produce GSD-compatible PLAN.md content with YAML frontmatter.
 */
export function formatPlanMd(
  phaseNumber: number,
  plan: GeneratedPlanEntry,
  scopeIn: string,
  scopeOut: string,
): string {
  // Escape double quotes in title for YAML
  const escapedTitle = plan.title.replace(/"/g, '\\"');

  // Format dependsOn as quoted string array
  const depsStr =
    plan.dependsOn.length === 0
      ? '[]'
      : `[${plan.dependsOn.map((d) => `"${d}"`).join(', ')}]`;

  // YAML frontmatter
  const frontmatter = [
    '---',
    `phase: ${phaseNumber}`,
    `plan: "${plan.planId}"`,
    `title: "${escapedTitle}"`,
    `wave: ${plan.wave}`,
    `depends_on: ${depsStr}`,
    `tdd: ${plan.tdd}`,
    '---',
  ].join('\n');

  // Tasks section
  const tasksSection =
    plan.tasks.length === 0
      ? ''
      : plan.tasks
          .map((task, i) => {
            const num = String(i + 1).padStart(2, '0');
            return `- [ ] TASK-${num}: ${task}`;
          })
          .join('\n');

  // Estimated files section
  const filesSection = plan.estimatedFiles.map((f) => `- ${f}`).join('\n');

  // Assemble full markdown
  const sections = [
    frontmatter,
    '',
    '## Goal',
    '',
    plan.goal,
    '',
    '## Tasks',
    '',
    tasksSection,
    '',
    '## Test Strategy',
    '',
    plan.testStrategy,
    '',
    '## Estimated Files',
    '',
    filesSection,
    '',
    '## Scope',
    '',
    `- IN: ${scopeIn}`,
    `- OUT: ${scopeOut}`,
    '',
  ];

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// parsePlanOutput
// ---------------------------------------------------------------------------

/**
 * Extract and validate a GeneratedPlan JSON from CC output text.
 *
 * Supports:
 * - Plain JSON string
 * - JSON wrapped in ```json ... ``` code block
 * - JSON surrounded by arbitrary text
 *
 * Throws descriptive error if JSON not found or invalid.
 */
export function parsePlanOutput(ccOutput: string): GeneratedPlan {
  let jsonStr: string | null = null;

  // Strategy 1: Try ```json ... ``` code block
  const codeBlockMatch = ccOutput.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Strategy 2: Try to find a JSON object starting with { and ending with }
  if (!jsonStr) {
    const firstBrace = ccOutput.indexOf('{');
    const lastBrace = ccOutput.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = ccOutput.substring(firstBrace, lastBrace + 1);
    }
  }

  if (!jsonStr) {
    throw new Error('parsePlanOutput: no valid JSON found in CC output');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('parsePlanOutput: no valid JSON found in CC output');
  }

  // Validate top-level structure
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('phaseNumber' in parsed) ||
    !('phaseTitle' in parsed) ||
    !('plans' in parsed)
  ) {
    throw new Error(
      'parsePlanOutput: invalid structure — must have phaseNumber, phaseTitle, and plans',
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.plans)) {
    throw new Error('parsePlanOutput: plans must be an array');
  }

  // Validate each plan entry
  const requiredFields = [
    'planId',
    'title',
    'wave',
    'dependsOn',
    'tdd',
    'goal',
    'tasks',
    'testStrategy',
    'estimatedFiles',
  ];

  for (const plan of obj.plans as Array<Record<string, unknown>>) {
    for (const field of requiredFields) {
      if (!(field in plan)) {
        throw new Error(
          `parsePlanOutput: plan "${plan.planId ?? 'unknown'}" missing required field "${field}"`,
        );
      }
    }
  }

  return parsed as GeneratedPlan;
}

// ---------------------------------------------------------------------------
// writePlanFiles
// ---------------------------------------------------------------------------

/**
 * Write PLAN.md files to the .planning/phases/ directory.
 *
 * Creates: {projectDir}/.planning/phases/{NN}-{slugified-phaseTitle}/
 * Each plan: {NN}-{planId}-PLAN.md
 *
 * Returns array of absolute file paths written.
 */
export async function writePlanFiles(
  projectDir: string,
  plan: GeneratedPlan,
  scopeIn: string,
  scopeOut: string,
): Promise<string[]> {
  const nn = String(plan.phaseNumber).padStart(2, '0');
  const slug = slugify(plan.phaseTitle);
  const phaseDir = join(projectDir, '.planning', 'phases', `${nn}-${slug}`);

  await mkdir(phaseDir, { recursive: true });

  const writtenPaths: string[] = [];

  for (const entry of plan.plans) {
    const filename = `${nn}-${entry.planId}-PLAN.md`;
    const filePath = join(phaseDir, filename);
    const content = formatPlanMd(plan.phaseNumber, entry, scopeIn, scopeOut);

    await writeFile(filePath, content, 'utf-8');
    writtenPaths.push(filePath);
  }

  return writtenPaths;
}

// ---------------------------------------------------------------------------
// generatePlans
// ---------------------------------------------------------------------------

/**
 * Orchestrate CC synthesis to generate plans from research findings.
 *
 * Spawns a CC session with a synthesis prompt, drains the stream,
 * collects text chunks, and parses the output into a GeneratedPlan.
 */
export async function generatePlans(input: PlanGenerationInput): Promise<GeneratedPlan> {
  const convId = `plan-gen-${randomUUID()}`;

  const findingsBlock = input.researchFindings
    .map((f, i) => `### Finding ${i + 1}\n${f}`)
    .join('\n\n');

  const prompt = `You are a GSD plan architect. Given research findings and risk assessment,
produce a structured execution plan as JSON.

Task: ${input.message}
Scope IN: ${input.scopeIn}
Scope OUT: ${input.scopeOut}
Risk Score: ${input.daRiskScore}/10

Research Findings:
${findingsBlock}

Respond with ONLY a JSON object:
{
  "phaseNumber": <next available phase number>,
  "phaseTitle": "<descriptive title>",
  "plans": [
    {
      "planId": "01",
      "title": "<plan title>",
      "wave": 1,
      "dependsOn": [],
      "tdd": true,
      "goal": "<what this plan achieves>",
      "tasks": ["task description 1", "task description 2"],
      "testStrategy": "<how to test>",
      "estimatedFiles": ["path/to/file1.ts", "path/to/file2.ts"]
    }
  ]
}`;

  const stream = claudeManager.send(convId, prompt, input.projectDir);

  let collectedText = '';
  for await (const chunk of stream) {
    if (chunk.type === 'error') {
      throw new Error(`CC synthesis failed: ${chunk.error}`);
    }
    if (chunk.type === 'text') {
      collectedText += chunk.text;
    }
    // type === 'done' — stream complete, continue to parse
  }

  return parsePlanOutput(collectedText);
}
