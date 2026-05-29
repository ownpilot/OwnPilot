/**
 * Claw Runner
 *
 * Executes a single cycle of a Claw agent — the unified autonomous runtime.
 * Composes: LLM brain + workspace + soul identity + coding agent access + all tools.
 *
 * The runner does NOT own scheduling — that's the ClawManager's job.
 *
 * Key characteristics:
 * - Workspace-aware: includes directory listing in system prompt
 * - Soul-aware: injects soul identity when soulId is configured
 * - Coding-agent-aware: describes coding CLI availability
 * - Has 6 claw-specific tools (install_package, run_script, etc.)
 * - Runs inside ClawExecutionContext (AsyncLocalStorage)
 * - Supports both cyclic and single-shot modes
 */

import {
  getErrorMessage,
  type Agent,
  CLAW_REFLECTION_THRESHOLD,
  CLAW_TASK_STALL_THRESHOLD,
} from '@ownpilot/core';
import type {
  ClawConfig,
  ClawSession,
  ClawCycleResult,
  ClawToolCall,
  ToolCall,
} from '@ownpilot/core';
import type { RuntimeContext } from '@ownpilot/core';
import { getRuntimeContext } from '@ownpilot/core';
import { getLog } from '../log.js';
import { buildEnhancedSystemPrompt } from '../../assistant/orchestrator.js';
import {
  createConfiguredAgent,
  resolveToolFilter,
  executeAgentPipeline,
  buildDateTimeContext,
} from '../agent/runner-utils.js';
import { runInClawContext } from './context.js';
import { getExtensionService } from '../extension/service.js';
import { findLearnedSkills } from './skill-distiller.js';
import {
  getSessionWorkspaceFiles,
  getSessionWorkspacePath,
  readSessionWorkspaceFile,
  type WorkspaceFileInfo,
} from '../../workspace/file-workspace.js';

const log = getLog('ClawRunner');

/** Read a .claw/ file from workspace, return content or null */
function readClawFile(workspaceId: string | undefined, filename: string): string | null {
  if (!workspaceId) return null;
  try {
    const buf = readSessionWorkspaceFile(workspaceId, `.claw/${filename}`);
    return buf ? buf.toString('utf-8') : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Runner
// ============================================================================

export class ClawRunner {
  private config: ClawConfig;
  private agent: Agent | null = null;
  private cachedProvider = '';
  private cachedModel = '';
  /**
   * Process-wide capabilities (LLMRouter, ChannelService, ConfigCenter,
   * EventSystem). Defaults to the singleton; tests can pass a mock bundle
   * to swap individual capabilities without per-global mocking.
   */
  private runtime: RuntimeContext;

  constructor(config: ClawConfig, runtime: RuntimeContext = getRuntimeContext()) {
    this.config = config;
    this.runtime = runtime;
  }

  updateConfig(config: ClawConfig): void {
    this.config = config;
    // Clear cached agent so next cycle recreates with new config
    this.agent = null;
    this.cachedProvider = '';
    this.cachedModel = '';
  }

  /**
   * Execute a single cycle inside a ClawExecutionContext.
   *
   * `abortSignal` lets the manager cancel an in-flight cycle (e.g. on stop or
   * pause) without waiting for the cycle timeout. The agent pipeline races
   * the abort against the chat call and rejects immediately on signal.
   */
  async runCycle(session: ClawSession, abortSignal?: AbortSignal): Promise<ClawCycleResult> {
    const ctx = {
      clawId: this.config.id,
      userId: this.config.userId,
      workspaceId: this.config.workspaceId,
      depth: this.config.depth,
      sandbox: this.config.sandbox,
    };

    return runInClawContext(ctx, () => this.executeCycle(session, abortSignal));
  }

  // ---------- Private Helpers ----------

  private async executeCycle(
    session: ClawSession,
    abortSignal?: AbortSignal
  ): Promise<ClawCycleResult> {
    const startTime = Date.now();
    const cycleNumber = session.cyclesCompleted + 1;

    const { provider, model, fallbackProvider, fallbackModel } = await this.runtime.llm.pick({
      explicitProvider: this.config.provider,
      explicitModel: this.config.model,
      process: 'pulse',
    });

    log.info(`[${this.config.id}] Starting cycle ${cycleNumber}`, {
      dbProvider: this.config.provider ?? '(none)',
      dbModel: this.config.model ?? '(none)',
      resolvedProvider: provider,
      resolvedModel: model,
    });

    try {
      // Reuse cached agent if provider/model unchanged, otherwise create and cache
      if (!this.agent || this.cachedProvider !== provider || this.cachedModel !== model) {
        const newAgent = await this.createAgent(provider, model, fallbackProvider, fallbackModel);
        this.agent = newAgent;
        this.cachedProvider = provider;
        this.cachedModel = model;
      } else {
        // Reset the agent's conversation between cycles. Each cycle is its own
        // mini-task: the cycle message already carries forward state via
        // .claw/MEMORY.md, .claw/TASKS.md, persistentContext, and inbox. Without
        // this reset, conversation history accumulates unbounded across
        // potentially thousands of cycles, blowing up token cost and eventually
        // exceeding context windows.
        try {
          this.agent.reset();
        } catch (err) {
          log.warn(`[${this.config.id}] agent.reset() failed: ${getErrorMessage(err)}`);
        }
      }

      const cycleMessage = this.buildCycleMessage(session, cycleNumber);

      const pipelineResult = await executeAgentPipeline(provider, model, {
        agent: this.agent,
        message: cycleMessage,
        timeoutMs: this.config.limits.cycleTimeoutMs,
        timeoutLabel: 'Claw cycle',
        abortSignal,
        agentId: this.config.id,
        userId: this.config.userId,
        onBeforeToolCall: this.buildGuardrail(cycleNumber),
      });

      const toolCalls: ClawToolCall[] = pipelineResult.toolCalls.map((tc) => ({
        tool: tc.tool,
        args: tc.args as Record<string, unknown>,
        result: tc.result,
        success: tc.success ?? true,
        durationMs: tc.durationMs ?? 0,
      }));

      log.info(`[${this.config.id}] Cycle ${cycleNumber} completed`, {
        toolCalls: toolCalls.length,
        tools: toolCalls.map((tc) => tc.tool),
        durationMs: pipelineResult.durationMs,
      });

      // Save audit log entries for each tool call
      this.saveAuditLog(cycleNumber, toolCalls).catch((err) => {
        log.warn(`[${this.config.id}] Failed to save audit log: ${getErrorMessage(err)}`);
      });

      return {
        success: true,
        toolCalls,
        output: pipelineResult.content,
        outputMessage: pipelineResult.content,
        tokensUsed: pipelineResult.usage
          ? {
              prompt: pipelineResult.usage.promptTokens,
              completion: pipelineResult.usage.completionTokens,
            }
          : undefined,
        costUsd: pipelineResult.costUsd,
        durationMs: pipelineResult.durationMs,
        turns: 1,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);

      log.error(`[${this.config.id}] Cycle ${cycleNumber} failed: ${errorMsg}`);

      return {
        success: false,
        toolCalls: [],
        output: '',
        outputMessage: '',
        durationMs,
        turns: 0,
        error: errorMsg,
      };
    }
  }

  private async createAgent(
    provider: string,
    model: string,
    fallbackProvider?: string,
    fallbackModel?: string
  ) {
    const userId = this.config.userId;
    const conversationId = `claw-${this.config.id}`;

    const basePrompt = this.buildSystemPrompt();

    // Soul-aware: prepend identity section when this claw is bound to an
    // AgentSoul (config.soulId). Previously documented as "Soul-aware" but
    // the field was accepted, stored, and ignored — claws ran with generic
    // identity even when the operator configured a persona.
    const soulSection = await this.buildSoulSection();
    const promptWithSoul = soulSection ? `${soulSection}\n${basePrompt}` : basePrompt;

    let systemPrompt = promptWithSoul;
    try {
      const enhanced = await buildEnhancedSystemPrompt(promptWithSoul, {
        userId,
        maxMemories: 10,
        maxGoals: 5,
      });
      systemPrompt = enhanced.prompt;
    } catch (err) {
      log.warn(
        `[${this.config.id}] Enhanced prompt build failed, using base: ${getErrorMessage(err)}`
      );
    }

    const toolFilter = resolveToolFilter(
      this.config.allowedTools,
      this.config.skills,
      this.config.id
    );

    // Workspace boundary: when this claw owns a session workspace, scope all
    // file-system tool operations to that directory. Without this the
    // file-system tools fall back to process.cwd() — the gateway repo root —
    // so a runaway tool call could read/write anywhere the gateway process
    // can reach.
    let workspaceDir: string | undefined;
    if (this.config.workspaceId) {
      try {
        workspaceDir = getSessionWorkspacePath(this.config.workspaceId);
      } catch (err) {
        log.warn(
          `[${this.config.id}] Could not resolve workspaceId="${this.config.workspaceId}" to a directory; file tools will use process.cwd(): ${getErrorMessage(err)}`
        );
      }
    }

    return createConfiguredAgent({
      name: `claw-${this.config.id}`,
      provider,
      model,
      systemPrompt,
      userId,
      conversationId,
      maxTurns: this.config.limits.maxTurnsPerCycle,
      maxToolCalls: this.config.limits.maxToolCallsPerCycle,
      toolFilter,
      fallbackProvider,
      fallbackModel,
      workspaceDir,
    });
  }

  /**
   * Fetch the configured soul (if any) and render an identity section to
   * prepend to the system prompt. Falls back to empty string on error so a
   * temporary DB hiccup doesn't block the cycle.
   */
  private async buildSoulSection(): Promise<string> {
    if (!this.config.soulId) return '';
    try {
      const { getSoulsRepository } = await import('../../db/repositories/souls.js');
      const soul = await getSoulsRepository().getById(this.config.soulId);
      if (!soul) return '';

      const id = soul.identity;
      const lines: string[] = [];
      lines.push('## Your Identity');
      lines.push(`You are ${id.emoji} ${id.name} — ${id.role}.`);
      if (id.personality) lines.push(`Personality: ${id.personality}`);
      if (id.voice?.tone) lines.push(`Voice: ${id.voice.tone}`);
      if (id.boundaries?.length) {
        lines.push('Hard boundaries you must always respect:');
        for (const b of id.boundaries) lines.push(`- ${b}`);
      }
      if (id.backstory) lines.push(`Backstory: ${id.backstory}`);
      lines.push('');
      lines.push(
        'Stay in character — your identity, voice, and boundaries override default tone choices but never override mission constraints or autonomy policy.'
      );
      lines.push('');
      return lines.join('\n');
    } catch (err) {
      log.warn(
        `[${this.config.id}] Failed to load soul ${this.config.soulId}: ${getErrorMessage(err)}`
      );
      return '';
    }
  }

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    parts.push(`You are "${this.config.name}", an autonomous Claw agent.`);
    parts.push(
      'You have your own workspace, tools, and resources. Take initiative, make decisions, deliver results — without asking permission.'
    );
    parts.push('');

    // Mission
    parts.push('## Your Mission\n' + this.config.mission + '\n');

    // Mission Contract
    if (this.config.missionContract) {
      const c = this.config.missionContract;
      parts.push('## Success Criteria');
      if (c.successCriteria?.length) parts.push(c.successCriteria.map((s) => `- ${s}`).join('\n'));
      if (c.deliverables?.length)
        parts.push('\nRequired deliverables:\n' + c.deliverables.map((d) => `- ${d}`).join('\n'));
      if (c.constraints?.length)
        parts.push('\nConstraints:\n' + c.constraints.map((x) => `- ${x}`).join('\n'));
      if (c.escalationRules?.length)
        parts.push('\nEscalate when:\n' + c.escalationRules.map((r) => `- ${r}`).join('\n'));
      if (c.evidenceRequired)
        parts.push(
          `\nEvidence required (target: ${Math.round((c.minConfidence ?? 0.8) * 100)}%+ confidence).`
        );
      parts.push('');
    }

    // Learned skills (closed learning loop): surface procedures distilled from
    // prior runs on similar missions so the claw reuses them instead of
    // reasoning from scratch.
    this.appendLearnedSkills(parts);

    // Autonomy Policy
    if (this.config.autonomyPolicy) {
      const p = this.config.autonomyPolicy;
      parts.push('## Your Limits');
      if (p.allowSubclaws === false) parts.push('- No sub-claws allowed');
      if (p.requireEvidence) parts.push('- Evidence required for claims');
      if (p.destructiveActionPolicy)
        parts.push(`- Destructive actions: ${p.destructiveActionPolicy}`);
      if (p.filesystemScopes?.length)
        parts.push(`- Filesystem scope: ${p.filesystemScopes.join(', ')}`);
      if (p.maxCostUsdBeforePause !== undefined)
        parts.push(`- Pause before cost exceeds $${p.maxCostUsdBeforePause}`);
      parts.push('');
    }

    // Operating rules
    parts.push('## How to Operate');
    parts.push('1. **FULL AUTONOMY** — act without asking permission');
    parts.push('2. **Use tools freely** — install packages, write scripts, create tools');
    parts.push(
      '3. **Delegate** — spawn sub-claws for parallel work; use coding agents for IDE tasks'
    );
    parts.push('4. **Update .claw/MEMORY.md** with findings and decisions');
    parts.push("5. **Report progress** via claw_send_output — user wants to see what you're doing");
    parts.push('6. **On completion** — claw_complete_report, then respond "MISSION_COMPLETE"');
    parts.push('7. **Need more?** — claw_request_escalation for network/Docker/permissions');
    if (this.config.stopCondition) parts.push(`8. **Stop when**: ${this.config.stopCondition}`);
    parts.push('');

    // Claw tools
    parts.push('## Claw Tools');
    parts.push('| Tool | When to Use |');
    parts.push('|------|-------------|');
    parts.push('| claw_spawn_subclaw | Parallel subtasks |');
    parts.push('| claw_run_script | Python/JS/shell scripts |');
    parts.push('| claw_create_tool | Dynamic runtime tools |');
    parts.push('| claw_install_package | npm/pip/pnpm packages |');
    parts.push('| claw_publish_artifact | Save outputs |');
    parts.push('| claw_send_output | Progress update to user |');
    parts.push('| claw_complete_report | Final deliverable |');
    parts.push('| claw_emit_event | Trigger other claws/workflows |');
    parts.push('| claw_request_escalation | Need more capabilities |');
    parts.push('| claw_plan | Set/replace the structured task plan |');
    parts.push('| claw_update_task | Mark a task in_progress/completed/blocked |');
    parts.push('| claw_list_tasks | Read the current plan |');
    parts.push('| claw_think | Record a reasoning step (no side effects) |');
    parts.push('| claw_set_next_intent | End-of-cycle handoff for the next cycle |');
    parts.push('| claw_split_task | Break a stalled task into subtasks atomically |');
    parts.push('| claw_recall_skill | Load a previously learned procedure for this kind of task |');
    parts.push('| claw_save_skill | Capture a reusable procedure you discovered |');
    parts.push(
      '| claw_execute | Run JS calling many tools in one step (collapse read/query pipelines) |'
    );
    parts.push('');

    // Web & Browser
    parts.push('## Web & Browser');
    parts.push('| Tool | When to Use |');
    parts.push('|------|-------------|');
    parts.push('| browse_web | Render JS pages, interact with UIs |');
    parts.push('| browser_click/type/fill_form | Form automation |');
    parts.push('| browser_select | Choose option in <select> dropdown |');
    parts.push('| browser_press_key | Enter/Tab/Escape — keyboard-driven UIs |');
    parts.push('| browser_wait_for | Wait for SPA content before interacting |');
    parts.push('| browser_scroll | Reveal lazy-loaded content |');
    parts.push('| browser_get_state | Verify URL/title after navigation |');
    parts.push(
      '| browser_accessibility_tree | Structured role/name outline of the page (better than HTML for navigating) |'
    );
    parts.push('| browser_screenshot | Visual capture |');
    parts.push('| browser_extract | Structured data from pages |');
    parts.push('| search_web | Find information |');
    parts.push('');

    // Channels
    parts.push('## Channels (Telegram/Discord/WhatsApp/Slack/Email)');
    parts.push('| Tool | When to Use |');
    parts.push('|------|-------------|');
    parts.push("| list_channels | See what's connected |");
    parts.push('| get_channel_inbox | Read user messages |');
    parts.push('| send_channel_message | Reply to user on channel |');
    parts.push('| broadcast_channel_message | Message across channels |');
    parts.push('');

    // Coding Agents
    parts.push('## Coding Agents');
    parts.push('Delegate coding tasks to specialized AI assistants:');
    parts.push('- **run_coding_task**: Execute via Claude Code/Codex/Gemini CLI');
    parts.push('- **orchestrate_coding_task**: Multi-step coding pipeline');
    if (this.config.codingAgentProvider) {
      parts.push(`Active: **${this.config.codingAgentProvider}**`);
    }
    parts.push('');

    // System tools (concise)
    parts.push('## System Tools');
    parts.push('search_tools(query) to discover. Common categories:');
    parts.push(
      '- **Files**: read_file, write_file, edit_file (in-place find/replace), move_file, copy_file, delete_file, create_directory, list_directory, search_files'
    );
    parts.push('- **Data**: custom tables (CRUD), expenses, contacts');
    parts.push('- **Memory**: create_memory, search_memories');
    parts.push('- **Goals**: create_goal, decompose_goal, complete_step');
    parts.push('- **Code**: execute_javascript, execute_python, execute_shell');
    parts.push('- **Git**: git_status, git_diff, git_commit, git_log');
    parts.push('');

    // Directive system
    parts.push('## .claw/ Files (Persistent Across Cycles)');
    parts.push('| File | Purpose | You Can Edit? |');
    parts.push('|------|---------|----------------|');
    parts.push('| INSTRUCTIONS.md | Your directives | YES |');
    parts.push('| TASKS.md | Task checklist | YES |');
    parts.push('| MEMORY.md | Findings & context | YES |');
    parts.push('| LOG.md | Execution log | YES |');
    parts.push('');

    if (this.config.workspaceId) {
      parts.push(`## Workspace: ${this.config.workspaceId}`);
      parts.push('File tree and directives are injected each cycle below.');
      parts.push('');
    }

    if (this.config.parentClawId) {
      parts.push(`## SubClaw (depth ${this.config.depth}) spawned by ${this.config.parentClawId}.`);
      parts.push('Focus on your subtask. Report clearly when done.');
      parts.push('');
    }

    if (this.config.mode === 'single-shot') {
      parts.push('## Mode: Single-Shot');
      parts.push('Complete in this one execution. No more cycles after this.');
      parts.push('');
    }

    return parts.join('\n');
  }

  private async saveAuditLog(cycleNumber: number, toolCalls: ClawToolCall[]): Promise<void> {
    if (toolCalls.length === 0) return;
    const { getClawsRepository } = await import('../../db/repositories/claws.js');
    const repo = getClawsRepository();
    await repo.saveAuditBatch(
      toolCalls.map((tc) => ({
        clawId: this.config.id,
        cycleNumber,
        toolName: tc.tool,
        toolArgs: tc.args,
        toolResult:
          typeof tc.result === 'string'
            ? tc.result
            : JSON.stringify(tc.result ?? '').slice(0, 5000),
        success: tc.success,
        durationMs: tc.durationMs,
      }))
    );
  }

  /**
   * Build the per-tool-call guardrail. Returns `undefined` (zero overhead) when
   * no autonomy policy is configured, preserving the prior behavior. When a
   * policy is present, every tool call is checked against it via the
   * PermissionGate — turning declared `autonomyPolicy` into real enforcement.
   * Denied / approval-required calls are recorded to `claw_audit_log` under the
   * `blocked` category so operators get a watcher trail.
   */
  private buildGuardrail(
    cycleNumber: number
  ): ((tc: ToolCall) => Promise<{ approved: boolean; reason?: string }>) | undefined {
    const policy = this.config.autonomyPolicy;
    if (!policy) return undefined;

    const workspaceDir = this.config.workspaceId
      ? getSessionWorkspacePath(this.config.workspaceId)
      : undefined;

    return async (tc: ToolCall) => {
      let args: Record<string, unknown> = {};
      try {
        args = tc.arguments ? (JSON.parse(tc.arguments) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }

      const decision = await this.runtime.permissions.check({
        actorId: this.config.id,
        tool: tc.name,
        context: {
          actorType: 'claw',
          autonomyPolicy: policy,
          workspaceDir,
          args,
        },
      });

      if (decision.type === 'allow') return { approved: true };

      const reason = decision.reason;
      log.warn(`[${this.config.id}] Guardrail blocked tool "${tc.name}": ${reason}`);
      this.saveBlockedAudit(cycleNumber, tc.name, args, reason).catch((err) =>
        log.warn(`[${this.config.id}] Failed to save blocked-audit entry: ${getErrorMessage(err)}`)
      );
      return { approved: false, reason };
    };
  }

  /** Persist a guardrail-blocked tool call to the audit trail. */
  private async saveBlockedAudit(
    cycleNumber: number,
    toolName: string,
    args: Record<string, unknown>,
    reason: string
  ): Promise<void> {
    const { getClawsRepository } = await import('../../db/repositories/claws.js');
    await getClawsRepository().saveAuditEntry({
      clawId: this.config.id,
      cycleNumber,
      toolName,
      toolArgs: args,
      toolResult: reason,
      success: false,
      durationMs: 0,
      category: 'blocked',
    });
  }

  /**
   * Inject the most relevant learned skills for this mission. Best-effort and
   * synchronous (the ExtensionService keeps an in-memory cache) so it adds no
   * per-cycle latency — the agent is built once and reused across cycles. Skips
   * silently when learning is disabled, none match, or the lookup fails.
   */
  private appendLearnedSkills(parts: string[]): void {
    if (this.config.learnSkills === false) return;
    try {
      const matches = findLearnedSkills(getExtensionService(), this.config.mission, 3);
      if (matches.length === 0) return;
      parts.push('## Learned Skills (from prior runs)');
      parts.push(
        'Procedures distilled from earlier claws on similar tasks. Reuse them; call claw_recall_skill for the full text or to search others.'
      );
      for (const m of matches) {
        const body =
          m.instructions.length > 800 ? `${m.instructions.slice(0, 800)}…` : m.instructions;
        parts.push(`\n### ${m.name}\n${m.description}\n\n${body}`);
      }
      parts.push('');
    } catch (err) {
      log.warn(`[${this.config.id}] Learned-skill injection failed: ${getErrorMessage(err)}`);
    }
  }

  private appendFileTree(parts: string[], files: WorkspaceFileInfo[], indent: number): void {
    const prefix = '  '.repeat(indent);
    for (const file of files) {
      if (file.isDirectory) {
        parts.push(`${prefix}- ${file.name}/`);
        if (file.children && indent < 3) {
          this.appendFileTree(parts, file.children, indent + 1);
        }
      } else {
        parts.push(`${prefix}- ${file.name} (${file.size} bytes)`);
      }
    }
  }

  private buildCycleMessage(session: ClawSession, cycleNumber: number): string {
    const parts: string[] = [];

    parts.push(`--- Cycle ${cycleNumber} ---`);

    // Cross-cycle handoff: if the previous cycle ended with claw_set_next_intent
    // (agent path) OR an operator queued a directive via POST /next-intent,
    // surface it at the very top so it's the first thing the model reads, then
    // CLEAR it so a stale intent can't linger past one cycle. The agent must
    // re-set it each cycle if it still applies — auto-staleness prevention.
    // Operator-set intents are prefixed with `[OPERATOR] ` so this block can
    // render them with different framing — the agent must know "you didn't say
    // this — your operator did" or it'll get confused.
    if (session.nextIntent && session.nextIntent.trim().length > 0) {
      const trimmed = session.nextIntent.trim();
      if (trimmed.startsWith('[OPERATOR] ')) {
        const body = trimmed.slice('[OPERATOR] '.length).trim();
        parts.push(
          `\n## ↳ Operator directive (next cycle)\nYour operator has queued this for you: **${body}**\n_Treat this as a priority directive. Honor it on this cycle unless it conflicts with the mission contract._`
        );
      } else {
        parts.push(
          `\n## ↻ Continuing from last cycle\nYou said you would do this next: **${trimmed}**\n_If this is still the right next step, do it now. If priorities changed, ignore and re-plan._`
        );
      }
      session.nextIntent = undefined;
    }

    parts.push(`\n## Current Time\n${buildDateTimeContext()}`);

    // .claw/INSTRUCTIONS.md — re-injected every cycle so directive edits
    // made by the claw itself are honored from the very next cycle.
    const instructions = readClawFile(this.config.workspaceId, 'INSTRUCTIONS.md');
    if (instructions && instructions.trim().length > 0) {
      parts.push(`\n## Your Instructions (.claw/INSTRUCTIONS.md)\n${instructions.trim()}`);
    }

    // Workspace file tree — refreshed every cycle so newly created files
    // and outputs are visible to the agent.
    if (this.config.workspaceId) {
      try {
        const files = getSessionWorkspaceFiles(this.config.workspaceId);
        if (files.length > 0) {
          const tree: string[] = ['\n## Workspace Files'];
          this.appendFileTree(tree, files, 0);
          parts.push(tree.join('\n'));
        }
      } catch {
        // workspace not yet initialized — skip
      }
    }

    if (Object.keys(session.persistentContext).length > 0) {
      parts.push(
        `\n## Your Working Memory\n\`\`\`json\n${JSON.stringify(session.persistentContext, null, 2)}\n\`\`\``
      );
    }

    if (session.inbox.length > 0) {
      parts.push(`\n## Inbox Messages`);
      for (const msg of session.inbox) {
        parts.push(`- ${msg}`);
      }
    }

    // Structured task plan (managed by claw_plan / claw_update_task tools).
    // Rendered as a status table so the agent can read its own plan reliably
    // without re-parsing the freeform .claw/TASKS.md every cycle.
    if (session.tasks.length > 0) {
      parts.push(this.buildTaskPlanBlock(session));
    }

    // .claw/ TASKS.md — current task state. Still rendered as a human/agent
    // freeform scratchpad alongside the structured plan above. Agents that
    // prefer to write narrative task notes can keep doing so here.
    const tasks = readClawFile(this.config.workspaceId, 'TASKS.md');
    if (tasks) {
      parts.push(`\n## Notes (.claw/TASKS.md)\n${tasks.trim()}`);
    }

    // .claw/ MEMORY.md — persistent memory
    const memory = readClawFile(this.config.workspaceId, 'MEMORY.md');
    if (memory && memory.trim().split('\n').length > 5) {
      // Only include if there's actual content beyond headers
      parts.push(`\n## Claw Memory (.claw/MEMORY.md)\n${memory.trim()}`);
    }

    // Artifact summary
    if (session.artifacts.length > 0) {
      parts.push(`\n## Published Artifacts: ${session.artifacts.length}`);
    }

    // Stats — show remaining budget/cycles so the agent can pace itself.
    // Without these signals the agent has no way to know it's about to run
    // out of fuel and may pursue a multi-cycle plan it can't finish.
    parts.push(`\nCycles completed: ${session.cyclesCompleted}`);
    parts.push(`Total tool calls: ${session.totalToolCalls}`);
    parts.push(`Total cost: $${session.totalCostUsd.toFixed(4)}`);

    const budget = this.config.limits?.totalBudgetUsd;
    if (typeof budget === 'number' && budget > 0) {
      const remaining = Math.max(0, budget - session.totalCostUsd);
      const pct = Math.round((session.totalCostUsd / budget) * 100);
      parts.push(
        `Budget remaining: $${remaining.toFixed(4)} of $${budget.toFixed(4)} (${pct}% used)`
      );
    }
    const stopCond = this.config.stopCondition;
    if (stopCond) {
      parts.push(`\nStop condition: ${stopCond}`);
      // Extract max_cycles:N so the agent sees a concrete cycles-remaining
      // number rather than having to derive it from the bare condition.
      const maxCyclesMatch = stopCond.match(/^max_cycles:(\d+)$/i);
      if (maxCyclesMatch?.[1]) {
        const maxCycles = parseInt(maxCyclesMatch[1], 10);
        const cyclesLeft = Math.max(0, maxCycles - session.cyclesCompleted);
        parts.push(`Cycles remaining: ${cyclesLeft} of ${maxCycles}`);
      }
      // When stop is gated on plan completion, remind the agent that finishing
      // the plan terminates the claw — otherwise it may keep "improving" past
      // the bar instead of shipping.
      if (stopCond === 'plan_complete') {
        parts.push(
          '_Reminder: this claw stops when every task is completed or blocked (with at least one completion). Mark tasks as you finish them._'
        );
      }
    }

    // Reflection block: once consecutive failures cross the threshold, stop
    // letting the agent retry the same approach blindly. Injected late so it
    // sits right above the "continue" line and gets maximum attention.
    if (session.consecutiveErrors >= CLAW_REFLECTION_THRESHOLD) {
      parts.push(this.buildReflectionBlock(session));
    }

    parts.push(
      '\nContinue your mission. Update .claw/TASKS.md and .claw/MEMORY.md as you work. Append to .claw/LOG.md.'
    );

    return parts.join('\n');
  }

  /**
   * Render the structured task plan as a status table. Shows status badges
   * so the agent can see at a glance what's done, what's blocked, and what's
   * next. Notes are included verbatim so blockers / sub-steps stay visible
   * across cycles without the agent having to re-derive them.
   */
  private buildTaskPlanBlock(session: ClawSession): string {
    const lines: string[] = [];
    lines.push('\n## Plan');

    // Surface current focus prominently. The invariant guarantees at most
    // one in_progress task, so this is unambiguous.
    const focused = session.tasks.find((t) => t.status === 'in_progress');
    if (focused) {
      const heat = focused.cyclesInProgress ?? 0;
      const stallNote =
        heat >= CLAW_TASK_STALL_THRESHOLD
          ? ` ⚠ STALLED — ${heat} cycles without status change. Split, mark blocked, or escalate.`
          : ` (${heat} cycle${heat === 1 ? '' : 's'})`;
      lines.push(`**Focus**: [${focused.id}] ${focused.title}${stallNote}`);
      // Surface the bar the agent committed to — keeps "done" honest.
      if (focused.successCriteria) {
        lines.push(`  - success criteria: ${focused.successCriteria}`);
      }
    } else if (session.tasks.some((t) => t.status === 'pending')) {
      lines.push(
        '**Focus**: none — pick the next pending task and mark it in_progress with claw_update_task.'
      );
    }

    const badge: Record<string, string> = {
      pending: '⏳',
      in_progress: '▶',
      completed: '✓',
      blocked: '⛔',
    };
    for (const t of session.tasks) {
      const mark = badge[t.status] ?? '?';
      const stall =
        t.status === 'in_progress' && (t.cyclesInProgress ?? 0) >= CLAW_TASK_STALL_THRESHOLD
          ? ' ⚠STALL'
          : '';
      lines.push(`- ${mark} [${t.id}] ${t.title} _(${t.status})_${stall}`);
      if (t.notes && t.notes.trim().length > 0) {
        lines.push(`  - notes: ${t.notes.trim()}`);
      }
      // For completed tasks, show evidence — the auditable record of "how
      // do I know it worked". Missing evidence is rendered as a discreet
      // marker so the agent can fill it in retroactively.
      if (t.status === 'completed') {
        if (t.evidence && t.evidence.trim().length > 0) {
          lines.push(`  - evidence: ${t.evidence.trim()}`);
        } else {
          lines.push('  - evidence: _(none recorded — call claw_update_task with evidence)_');
        }
      }
    }
    lines.push(
      '\n_Use claw_plan to replace the plan, claw_update_task to mark progress. Only one task may be in_progress at a time._'
    );
    return lines.join('\n');
  }

  /**
   * Build the REFLECTION REQUIRED block. Lists the most recent failures so
   * the agent has concrete error messages to diagnose against — telling it
   * "you've failed twice" without showing why is not actionable.
   */
  private buildReflectionBlock(session: ClawSession): string {
    const lines: string[] = [];
    lines.push('\n## ⚠ REFLECTION REQUIRED');
    lines.push(
      `You have failed ${session.consecutiveErrors} consecutive cycles. Stop retrying the same approach.`
    );
    lines.push('');
    lines.push('Before taking any new action this cycle:');
    lines.push('1. Read the failures below and identify the ROOT CAUSE — not just the symptom.');
    lines.push(
      '2. Decide whether the failure is environmental (missing tool, bad creds, network) or logical (wrong plan, wrong tool, wrong arguments).'
    );
    lines.push(
      '3. Choose a DIFFERENT strategy than what you tried last cycle. Repeating the same call with the same arguments will not work.'
    );
    lines.push(
      '4. If the root cause is outside your control, request escalation via `claw_request_escalation` instead of burning more cycles.'
    );
    lines.push(
      '5. Write your diagnosis and new plan into .claw/MEMORY.md so future cycles see what you learned.'
    );

    if (session.recentFailures.length > 0) {
      lines.push('');
      lines.push('### Recent failures');
      for (const f of session.recentFailures) {
        lines.push(`- Cycle ${f.cycleNumber} (${f.at})${f.error ? ` — ${f.error}` : ''}`);
        if (f.toolErrors && f.toolErrors.length > 0) {
          for (const te of f.toolErrors) {
            lines.push(`  - tool \`${te.tool}\`: ${te.error}`);
          }
        }
      }
    }
    return lines.join('\n');
  }
}
