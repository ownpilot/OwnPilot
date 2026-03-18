/**
 * Claw Runner
 *
 * Executes a single cycle of a Claw agent — the unified autonomous runtime.
 * Composes: LLM brain + workspace + soul identity + coding agent access + all tools.
 *
 * The runner does NOT own scheduling — that's the ClawManager's job.
 *
 * Differences from BackgroundAgentRunner:
 * - Workspace-aware: includes directory listing in system prompt
 * - Soul-aware: injects soul identity when soulId is configured
 * - Coding-agent-aware: describes coding CLI availability
 * - Has 6 claw-specific tools (install_package, run_script, etc.)
 * - Runs inside ClawExecutionContext (AsyncLocalStorage)
 * - Supports both cyclic and single-shot modes
 */

import { getErrorMessage } from '@ownpilot/core';
import type { ClawConfig, ClawSession, ClawCycleResult, ClawToolCall } from '@ownpilot/core';
import { getLog } from './log.js';
import { buildEnhancedSystemPrompt } from '../assistant/orchestrator.js';
import {
  resolveProviderAndModel,
  createConfiguredAgent,
  resolveToolFilter,
  executeAgentPipeline,
  buildDateTimeContext,
} from './agent-runner-utils.js';
import { runInClawContext } from './claw-context.js';
import {
  getSessionWorkspaceFiles,
  readSessionWorkspaceFile,
  type WorkspaceFileInfo,
} from '../workspace/file-workspace.js';

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

  constructor(config: ClawConfig) {
    this.config = config;
  }

  updateConfig(config: ClawConfig): void {
    this.config = config;
  }

  /**
   * Execute a single cycle inside a ClawExecutionContext.
   */
  async runCycle(session: ClawSession): Promise<ClawCycleResult> {
    const ctx = {
      clawId: this.config.id,
      userId: this.config.userId,
      workspaceId: this.config.workspaceId,
      depth: this.config.depth,
    };

    return runInClawContext(ctx, () => this.executeCycle(session));
  }

  // ---------- Private Helpers ----------

  private async executeCycle(session: ClawSession): Promise<ClawCycleResult> {
    const startTime = Date.now();
    const cycleNumber = session.cyclesCompleted + 1;

    log.info(`[${this.config.id}] Starting cycle ${cycleNumber}`);

    try {
      const { provider, model } = await resolveProviderAndModel(
        this.config.provider,
        this.config.model,
        'pulse'
      );

      const agent = await this.createAgent(provider, model);
      const cycleMessage = this.buildCycleMessage(session, cycleNumber);

      const pipelineResult = await executeAgentPipeline(provider, model, {
        agent,
        message: cycleMessage,
        timeoutMs: this.config.limits.cycleTimeoutMs,
        timeoutLabel: 'Claw cycle',
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

  private async createAgent(provider: string, model: string) {
    const userId = this.config.userId;
    const conversationId = `claw-${this.config.id}`;

    const basePrompt = this.buildSystemPrompt();
    let systemPrompt = basePrompt;
    try {
      const enhanced = await buildEnhancedSystemPrompt(basePrompt, {
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
    });
  }

  private buildSystemPrompt(): string {
    const parts: string[] = [];

    parts.push(`You are "${this.config.name}", a fully autonomous Claw agent.`);
    parts.push(
      'You operate independently with your own isolated workspace, tools, and resources. You are not a chatbot — you are an autonomous agent that takes initiative, makes decisions, and delivers results.'
    );
    parts.push('');

    // Mission
    parts.push('## Your Mission');
    parts.push(this.config.mission);
    parts.push('');

    // Execution rules
    parts.push('## How You Operate');
    parts.push('1. You have FULL AUTONOMY. Make decisions, take actions, solve problems without asking for permission.');
    parts.push('2. Use as many tools as needed. You have generous limits — do not hold back.');
    parts.push('3. Install packages, write scripts, create tools — your workspace is yours to use freely.');
    parts.push('4. Store important findings in memory for future cycles.');
    parts.push('5. Send progress updates to the user via claw_send_output — they want to see what you are doing.');
    parts.push('6. When your mission is complete, use claw_complete_report to deliver a comprehensive final report, then respond with "MISSION_COMPLETE".');
    parts.push('7. If you need capabilities you do not have (network, Docker, permissions), use claw_request_escalation.');
    parts.push('8. You can spawn sub-claws for parallel subtasks — delegate when it makes sense.');

    if (this.config.stopCondition) {
      parts.push(`8. Stop condition: ${this.config.stopCondition}`);
    }
    parts.push('');

    // Claw-specific tools
    parts.push('## Claw Tools');
    parts.push('- **claw_install_package**(package_name, manager?): Install npm/pip/pnpm packages');
    parts.push('- **claw_run_script**(script, language?, timeout_ms?): Execute Python/JS/shell scripts');
    parts.push('- **claw_create_tool**(name, description, code): Create ephemeral tools at runtime');
    parts.push('- **claw_spawn_subclaw**(name, mission, mode?): Spawn child claw for subtask');
    parts.push('- **claw_publish_artifact**(title, content, type?): Publish outputs as artifacts');
    parts.push('- **claw_request_escalation**(type, reason): Request environment upgrade');
    parts.push('- **claw_send_output**(message, urgency?): Send results to user NOW (Telegram + UI)');
    parts.push('- **claw_complete_report**(title, report, summary): Final deliverable (artifact + notify)');
    parts.push('- **claw_emit_event**(event_type, payload?): Emit event to EventBus (trigger other claws/workflows)');
    parts.push('- **claw_update_config**(mission?, mode?, sandbox?, ...): Update your own config on the fly');
    parts.push('- **claw_send_agent_message**(target_claw_id, subject, content): Send direct message to another claw');
    parts.push('- **claw_reflect**(question): Self-assess your progress based on .claw/ files');
    parts.push('');

    // CLI tools — system-level power
    parts.push('## CLI Tools');
    parts.push('You can install and run ANY CLI tool on the system:');
    parts.push('- **list_cli_tools**(): Discover all available CLI tools and their status');
    parts.push('- **install_cli_tool**(name, method): Install new CLI tools globally (npm/pnpm)');
    parts.push('- **run_cli_tool**(name, args, cwd): Execute any CLI tool (eslint, git, docker, curl, ffmpeg, etc.)');
    parts.push('Do NOT hesitate to install and use CLI tools. If a tool would help, install it and use it.');
    parts.push('');

    // Browser — headless web automation
    parts.push('## Browser (Headless Chromium)');
    parts.push('You can browse the web, interact with pages, and extract data:');
    parts.push('- **browse_web**(url): Navigate to URL, get rendered page content (JS-rendered)');
    parts.push('- **browser_click**(selector): Click elements on the page');
    parts.push('- **browser_type**(selector, text): Type into input fields');
    parts.push('- **browser_fill_form**(fields): Fill multiple form fields at once');
    parts.push('- **browser_screenshot**(fullPage?, selector?): Take screenshots');
    parts.push('- **browser_extract**(selector?, dataSelectors?): Extract structured data from pages');
    parts.push('');

    // Coding agents — full IDE delegation
    parts.push('## Coding Agents');
    parts.push('You can delegate coding tasks to specialized AI coding assistants:');
    parts.push('- **run_coding_task**(task, provider?, model?): Execute coding task via Claude Code/Codex/Gemini CLI');
    parts.push('- **orchestrate_coding_task**(task, analysis): Multi-step orchestrated coding pipeline');
    if (this.config.codingAgentProvider) {
      parts.push(`Active coding agent: **${this.config.codingAgentProvider}**`);
    }
    parts.push('');

    // System tools summary
    parts.push('## System Tools (250+)');
    parts.push('You also have access to all OwnPilot system tools:');
    parts.push('- **Web**: fetch_url, fetch_json, post_json, search_web');
    parts.push('- **Files**: read_file, write_file, list_directory, delete_file');
    parts.push('- **Data**: custom data tables (CRUD), personal data, expenses');
    parts.push('- **Memory**: create_memory, search_memories, forget_memory');
    parts.push('- **Goals**: create_goal, list_goals, mark_goal_complete');
    parts.push('- **Triggers**: create_trigger (schedule future actions)');
    parts.push('- **Plans**: create_plan, execute_plan (multi-step workflows)');
    parts.push('- **Code**: execute_javascript, execute_python, execute_shell');
    parts.push('- **Email**: send_email, list_emails, read_email');
    parts.push('- **Git**: git_status, git_diff, git_commit, git_log');
    parts.push('- Use search_tools(query) to discover tools by keyword');
    parts.push('');

    // .claw/ directive system
    parts.push('## .claw/ Directive System');
    parts.push('Your workspace contains a `.claw/` directory with persistent files you MUST use:');
    parts.push('- **`.claw/INSTRUCTIONS.md`**: Your directives. Read and follow every cycle. You can edit this.');
    parts.push('- **`.claw/TASKS.md`**: Your task checklist. Mark items done, add new ones as you work.');
    parts.push('- **`.claw/MEMORY.md`**: Your persistent memory. Write findings, decisions, context here.');
    parts.push('- **`.claw/LOG.md`**: Your execution log. Append a summary after each cycle.');
    parts.push('');
    parts.push('Update these files using write_file or claw_run_script. They persist across cycles and restarts.');
    parts.push('');

    // Read and inject INSTRUCTIONS.md into system prompt
    const instructions = readClawFile(this.config.workspaceId, 'INSTRUCTIONS.md');
    if (instructions) {
      parts.push('## Your Instructions (.claw/INSTRUCTIONS.md)');
      parts.push(instructions.trim());
      parts.push('');
    }

    // Workspace info
    if (this.config.workspaceId) {
      parts.push('## Workspace');
      parts.push(`Workspace ID: ${this.config.workspaceId}`);
      try {
        const files = getSessionWorkspaceFiles(this.config.workspaceId);
        if (files.length > 0) {
          parts.push('Files:');
          this.appendFileTree(parts, files, 0);
        }
      } catch {
        // workspace not yet initialized
      }
      parts.push('');
    }

    // Subclaw context
    if (this.config.parentClawId) {
      parts.push('## Parent Context');
      parts.push(`You are a subclaw (depth ${this.config.depth}) spawned by claw ${this.config.parentClawId}.`);
      parts.push('Focus on your specific subtask and report results clearly.');
      parts.push('');
    }

    // Mode
    if (this.config.mode === 'single-shot') {
      parts.push('## Mode: Single-Shot');
      parts.push('Complete your task in this single execution. No further cycles will run.');
      parts.push('');
    }

    return parts.join('\n');
  }

  private async saveAuditLog(cycleNumber: number, toolCalls: ClawToolCall[]): Promise<void> {
    if (toolCalls.length === 0) return;
    const { getClawsRepository } = await import('../db/repositories/claws.js');
    const repo = getClawsRepository();
    await repo.saveAuditBatch(
      toolCalls.map((tc) => ({
        clawId: this.config.id,
        cycleNumber,
        toolName: tc.tool,
        toolArgs: tc.args,
        toolResult: typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result ?? '').slice(0, 5000),
        success: tc.success,
        durationMs: tc.durationMs,
      }))
    );
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
    parts.push(`\n## Current Time\n${buildDateTimeContext()}`);

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

    // .claw/ TASKS.md — current task state
    const tasks = readClawFile(this.config.workspaceId, 'TASKS.md');
    if (tasks) {
      parts.push(`\n## Current Tasks (.claw/TASKS.md)\n${tasks.trim()}`);
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

    // Stats
    parts.push(`\nCycles completed: ${session.cyclesCompleted}`);
    parts.push(`Total tool calls: ${session.totalToolCalls}`);
    parts.push(`Total cost: $${session.totalCostUsd.toFixed(4)}`);

    if (this.config.stopCondition) {
      parts.push(`\nStop condition: ${this.config.stopCondition}`);
    }

    parts.push('\nContinue your mission. Update .claw/TASKS.md and .claw/MEMORY.md as you work. Append to .claw/LOG.md.');

    return parts.join('\n');
  }
}
