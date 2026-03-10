/**
 * gsd-adapter.ts
 *
 * Natural language → GSD system prompt converter for the OpenClaw Bridge daemon.
 * Receives Turkish/English messages from WhatsApp via OpenClaw, detects intent,
 * loads the relevant GSD workflow file, and builds a --append-system-prompt string
 * ready for the Claude Code process manager.
 */

import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GSDContext {
  /** Short command key, e.g. "execute-phase", "debug", "general" */
  command: string;
  /** Trimmed content of the relevant workflow .md file (max 200 lines) */
  workflowContent: string;
  /** Trimmed content of PROJECT.md from the project directory (empty if absent) */
  projectContext: string;
  /** The decision-framework guidance injected into every prompt */
  decisionFramework: string;
  /** The complete system prompt string ready for --append-system-prompt */
  fullSystemPrompt: string;
}

// ---------------------------------------------------------------------------
// Intent mapping
// ---------------------------------------------------------------------------

/**
 * Each entry contains:
 *   keywords  – regex-compatible substrings (lower-cased, trimmed)
 *   command   – canonical GSD command key
 *   workflow  – filename under ~/.claude/get-shit-done/workflows/ (without .md)
 */
const INTENT_MAP: Array<{
  keywords: RegExp;
  command: string;
  workflow: string | null;
}> = [
  {
    // Execute / next phase (most specific action phrases first)
    keywords:
      /bir sonraki a[sş]ama|next phase|execute|[cç]al[iı][sş]t[iı]r|faz[iı] ba[sş]lat|faz[iı] [cç]al[iı][sş]t[iı]r|execute.?phase/i,
    command: "execute-phase",
    workflow: "execute-phase",
  },
  {
    // Discuss phase — capture user vision and decisions before planning (BUG-1 fix)
    keywords:
      /discuss.?phase|tart[iı][sş]|konu[sş]al[iı]m|netle[sş]tirelim|vizyon konu[sş]|g[oOöÖ]r[uü][sş]elim|context topla|clarify.?phase|talk about phase|discuss approach|capture.?context|capture.?decisions|gray areas|faz[iı] g[oOöÖ]r[uü][sş]|a[sş]amay[iı] tart[iı][sş]/i,
    command: "discuss-phase",
    workflow: "discuss-phase",
  },
  {
    // New project (before plan-phase to prevent "yeni proje planla" mismatch — BUG-7 fix)
    keywords: /yeni proje|new project|proje ba[sş]lat|projeyi olu[sş]tur/i,
    command: "new-project",
    workflow: "new-project",
  },
  {
    // New milestone / new version (before plan-phase — BUG-7 fix)
    keywords:
      /yeni milestone|new milestone|yeni versiyon|milestone ba[sş]lat|yeni s[uü]r[uü]m/i,
    command: "new-milestone",
    workflow: "new-milestone",
  },
  {
    // Debug / fix (before progress to prevent "hata ver progress" mismatch — BUG-8 fix)
    // BUG-4/5 fix: word boundaries on English keywords to prevent substring matches
    keywords:
      /debug|hata|d[uü]zelt|\bfix\b|\bpatch\b|[sS]orun|[cCçÇ][oöOÖ]z|\bbroken\b|\brepair\b|diagnose/i,
    command: "debug",
    workflow: "diagnose-issues",
  },
  {
    // Plan phase (BUG-3 fix: olu[sş]tur for Turkish ş handling)
    keywords: /plan yap|planla|plan.?phase|planning yap|plan [oO]lu[sş]tur/i,
    command: "plan-phase",
    workflow: "plan-phase",
  },
  {
    // Progress / status (before verify-phase: "Status check" should match progress, not verify)
    keywords:
      /ilerleme|progress|ne kadar kald[iı]|durum|ne yap[iı]yoruz|ne bitti|[sS]tatus|rapor ver|[oOöÖ]zet ver/i,
    command: "progress",
    workflow: "progress",
  },
  {
    // Verify / check (BUG-6 fix: word boundary on "check")
    keywords: /do[gğ]rula|verify|\bcheck\b|kontrol et|test et|verify.?phase/i,
    command: "verify-phase",
    workflow: "verify-phase",
  },
  {
    // Quick task
    keywords:
      /h[iı]zl[iı] g[oOöÖ]rev|quick task|[sş]unu yap|[sS]adece [sş]unu|tek [sş]ey yap/i,
    command: "quick",
    workflow: "quick",
  },
  {
    // Resume / continue project (BUG-2 fix: [oOöÖ] for "geri dön")
    keywords: /kald[iı][gğ][iı] yerden|devam et|resume|continue|geri d[oOöÖ]n/i,
    command: "progress", // progress → intelligently routes to next action
    workflow: "progress",
  },
];

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const GSD_WORKFLOWS_DIR = resolve(
  homedir(),
  ".claude/get-shit-done/workflows"
);

function workflowPath(name: string): string {
  return join(GSD_WORKFLOWS_DIR, `${name}.md`);
}

function decisionFrameworkPath(): string {
  return resolve(
    homedir(),
    ".claude/skills/openclaw-manage/decision-framework.md"
  );
}

// ---------------------------------------------------------------------------
// File cache (FIX 9: avoid disk reads on every message)
// ---------------------------------------------------------------------------

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Maximum number of entries in the file cache (P1-1). */
export const FILE_CACHE_MAX = 500;

const fileCache = new Map<string, { content: string; loadedAt: number }>();

/** Clear the file cache — exposed for testing. */
export function clearFileCache(): void {
  fileCache.clear();
}

/** Returns current file cache size — exposed for testing (P1-1). */
export function getFileCacheSize(): number {
  return fileCache.size;
}

/**
 * Directly set a cache entry — exposed for testing (P1-1).
 * Enforces the cap: evicts oldest entry if size would exceed FILE_CACHE_MAX.
 */
export function setFileCacheEntry(filePath: string, content: string): void {
  if (!fileCache.has(filePath) && fileCache.size >= FILE_CACHE_MAX) {
    const oldest = fileCache.keys().next().value as string;
    fileCache.delete(oldest);
  }
  fileCache.set(filePath, { content, loadedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// File reading utilities
// ---------------------------------------------------------------------------

/**
 * Read a file and return at most `maxLines` lines as a string.
 * Returns empty string if the file does not exist.
 * FIX 9 (audit): Results are cached with TTL to avoid disk reads on every message.
 */
async function readFileSafe(
  filePath: string,
  maxLines = 200
): Promise<string> {
  const now = Date.now();
  const cached = fileCache.get(filePath);
  if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
    return cached.content;
  }
  // Evict oldest entry if at cap before adding a new one (P1-1)
  if (!fileCache.has(filePath) && fileCache.size >= FILE_CACHE_MAX) {
    const oldest = fileCache.keys().next().value as string;
    fileCache.delete(oldest);
  }

  // FIX 8 (audit): async file check — avoids blocking event loop
  try { await access(filePath); } catch {
    fileCache.set(filePath, { content: "", loadedAt: now });
    return "";
  }
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw.split("\n");
    const content = lines.length <= maxLines
      ? raw
      : lines.slice(0, maxLines).join("\n") + "\n\n[... truncated for token budget ...]";
    fileCache.set(filePath, { content, loadedAt: now });
    return content;
  } catch {
    fileCache.set(filePath, { content: "", loadedAt: now });
    return "";
  }
}

/**
 * Read the decision-framework skill file. Falls back to an inline minimal
 * version if the file hasn't been created yet.
 */
async function readDecisionFramework(): Promise<string> {
  const content = await readFileSafe(decisionFrameworkPath(), 300);
  if (content.trim()) return content;

  // Inline fallback — minimal but functional
  return `# GSD Bridge Decision Framework (Inline Fallback)

## Otomatik Devam Et (Sormadan)
- Dosya okuma, arama, analiz
- Test calistirma
- GSD phase execute (plan hazir)
- Bug fix (acik sorun)
- Progress raporu

## Mutlaka Sor (Devam Etme)
- Dosya/dizin silme
- Mimari degisiklik
- Mevcut calisan sistemi degistirme
- git push / merge
- Kapsam belirsizligi

## Progress Format (WhatsApp uyumlu)
Basarili:
  ✅ [ne yapıldı]
  🔄 [şu an ne yapılıyor]
  ⏳ [sırada ne var]

Sorun varsa:
  ❌ [sorun]
  💡 [çözüm önerisi]
  ❓ [karar gerekiyor mu?]

## Varsayılan
- Proje dizini: /home/ayaz/
- GSD framework: ~/.claude/get-shit-done/
- Her session başında .planning/ dizinini kontrol et
`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Detect the GSD command intent from a natural-language message.
 *
 * Returns one of: execute-phase | plan-phase | progress | debug |
 *                 new-milestone | new-project | quick | verify-phase | general
 */
export async function detectIntent(message: string): Promise<string> {
  const msg = message.trim();
  for (const entry of INTENT_MAP) {
    if (entry.keywords.test(msg)) {
      return entry.command;
    }
  }
  return "general";
}

/**
 * Build a complete system prompt string for --append-system-prompt.
 *
 * @param command     GSD command key (from detectIntent)
 * @param projectDir  Absolute path to the current project directory
 */
export async function buildSystemPrompt(
  command: string,
  projectDir: string
): Promise<string> {
  // 1. Find the matching workflow file
  const mapping = INTENT_MAP.find((e) => e.command === command);
  const workflowFile = mapping?.workflow ?? null;

  // 2. Load workflow content (first 200 lines to keep tokens sane)
  let workflowContent = "";
  if (workflowFile) {
    const wfPath = workflowPath(workflowFile);
    workflowContent = await readFileSafe(wfPath, 200);
    if (!workflowContent) {
      workflowContent = `[Workflow file not found: ${wfPath}]`;
    }
  }

  // 3. Load PROJECT.md from the project directory
  const projectMdPath = join(resolve(projectDir), "PROJECT.md");
  const projectContext = await readFileSafe(projectMdPath, 80);

  // 4. Load decision framework
  const decisionFramework = await readDecisionFramework();

  // 5. Assemble
  return assemblePrompt(command, workflowContent, projectContext, decisionFramework);
}

/**
 * One-shot convenience: detect intent, then build the full context object.
 *
 * @param message     Raw WhatsApp message text
 * @param projectDir  Absolute path to the current project directory
 */
export async function getGSDContext(
  message: string,
  projectDir: string
): Promise<GSDContext> {
  const command = await detectIntent(message);

  const mapping = INTENT_MAP.find((e) => e.command === command);
  const workflowFile = mapping?.workflow ?? null;

  let workflowContent = "";
  if (workflowFile) {
    const wfPath = workflowPath(workflowFile);
    workflowContent = await readFileSafe(wfPath, 200);
    if (!workflowContent) {
      workflowContent = `[Workflow file not found: ${wfPath}]`;
    }
  }

  const projectMdPath = join(resolve(projectDir), "PROJECT.md");
  const projectContext = await readFileSafe(projectMdPath, 80);
  const decisionFramework = await readDecisionFramework();
  const fullSystemPrompt = assemblePrompt(
    command,
    workflowContent,
    projectContext,
    decisionFramework
  );

  return {
    command,
    workflowContent,
    projectContext,
    decisionFramework,
    fullSystemPrompt,
  };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function assemblePrompt(
  command: string,
  workflowContent: string,
  projectContext: string,
  decisionFramework: string
): string {
  const sections: string[] = [];

  // Header
  sections.push(
    `# GSD Bridge System Prompt\n` +
      `## Detected Command: \`${command}\`\n` +
      `\n` +
      `You are Claude Code running inside the OpenClaw Bridge daemon.\n` +
      `The user communicates via WhatsApp — they cannot type in a terminal.\n` +
      `Apply the GSD workflow below, then respond with the WhatsApp-friendly progress format.\n`
  );

  // Decision framework (always present)
  if (decisionFramework.trim()) {
    sections.push(`---\n\n${decisionFramework.trim()}\n`);
  }

  // Project context (if available)
  if (projectContext.trim()) {
    sections.push(
      `---\n\n## Project Context (PROJECT.md)\n\n${projectContext.trim()}\n`
    );
  }

  // Workflow instructions (if applicable)
  if (command !== "general" && workflowContent.trim()) {
    sections.push(
      `---\n\n## GSD Workflow: \`${command}\`\n\n${workflowContent.trim()}\n`
    );
  } else if (command === "general") {
    sections.push(
      `---\n\n## General GSD Context\n\n` +
        `No specific workflow matched. Apply general GSD principles:\n` +
        `- Read .planning/STATE.md to understand current position\n` +
        `- Read .planning/ROADMAP.md for the project roadmap\n` +
        `- Respond with the WhatsApp progress format\n` +
        `- Ask if the intent is ambiguous\n`
    );
  }

  // Footer
  sections.push(
    `---\n\n## Session Notes\n` +
      `- GSD framework path: ~/.claude/get-shit-done/\n` +
      `- Default project root: /home/ayaz/\n` +
      `- Session state lives in .planning/ (check before acting)\n` +
      `- Every WhatsApp message = one Claude Code --print invocation\n`
  );

  return sections.join("\n");
}
