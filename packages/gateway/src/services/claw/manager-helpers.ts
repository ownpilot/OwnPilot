/**
 * Claw Manager — Leaf Helpers
 *
 * Standalone helpers extracted from ClawManager to keep the class focused on
 * lifecycle + scheduling. None of these touch the manager's private state,
 * so they're testable in isolation:
 *
 *   - scaffoldClawDir       — idempotent .claw/ directive-file creation
 *   - runRetentionCleanup   — fire-and-forget daily history/audit trim
 *   - ensureConversationRow — guarantee a conversations row for the claw's chat tab
 */

import { getErrorMessage } from '@ownpilot/core';
import { getClawsRepository } from '../../db/repositories/claws.js';
import {
  writeSessionWorkspaceFile,
  readSessionWorkspaceFile,
} from '../../workspace/file-workspace.js';
import { getLog } from '../log.js';

const log = getLog('ClawManagerHelpers');

const HISTORY_RETENTION_DAYS = 90;
const AUDIT_RETENTION_DAYS = 30;

/**
 * Trim claw history and audit-log tables. Runs as fire-and-forget so the
 * daily cleanup timer never blocks the event loop on slow Postgres.
 */
export function runRetentionCleanup(): void {
  const repo = getClawsRepository();

  repo
    .cleanupOldHistory(HISTORY_RETENTION_DAYS)
    .then((deleted) => {
      if (deleted > 0) log.info(`Cleaned up ${deleted} old claw history entries`);
    })
    .catch((err) => {
      log.warn(`History cleanup failed: ${getErrorMessage(err)}`);
    });

  repo
    .cleanupOldAuditLog(AUDIT_RETENTION_DAYS)
    .then((deleted) => {
      if (deleted > 0) log.info(`Cleaned up ${deleted} old claw audit log entries`);
    })
    .catch((err) => {
      log.warn(`Audit log cleanup failed: ${getErrorMessage(err)}`);
    });
}

/**
 * Ensure a conversation row exists for the claw's chat history.
 * The Chat tab fetches /api/v1/chat/claw-{id}/messages — this needs a row in conversations.
 */
export async function ensureConversationRow(
  clawId: string,
  userId: string,
  clawName: string
): Promise<void> {
  const conversationId = `claw-${clawId}`;
  try {
    const { ChatRepository } = await import('../../db/repositories/chat.js');
    const chatRepo = new ChatRepository(userId);
    const existing = await chatRepo.getConversation(conversationId).catch(() => null);
    if (!existing) {
      await chatRepo.createConversation({
        id: conversationId,
        agentName: `claw-${clawName}`,
        metadata: { clawId, clawName, type: 'claw' },
      });
    }
  } catch (err) {
    log.warn('Failed to persist claw conversation', { clawId, error: String(err) });
  }
}

/**
 * Scaffold the .claw/ directory with initial directive files.
 * Each file is only written when it doesn't already exist — idempotent and
 * safe to call on every claw start, including after a crash recovery.
 */
export async function scaffoldClawDir(
  workspaceId: string,
  config: { name: string; mission: string; mode: string }
): Promise<void> {
  try {
    await Promise.all([
      (async () => {
        if (!readSessionWorkspaceFile(workspaceId, '.claw/INSTRUCTIONS.md')) {
          writeSessionWorkspaceFile(
            workspaceId,
            '.claw/INSTRUCTIONS.md',
            Buffer.from(
              `# ${config.name} — Instructions

## Mission
${config.mission}

## Directives
- Follow these instructions every cycle
- Update TASKS.md as you make progress
- Save important findings to MEMORY.md
- Send progress to the user via claw_send_output
- When done, use claw_complete_report to deliver results

## Notes
Add custom directives here. This file persists across cycles.
`,
              'utf-8'
            )
          );
        }
      })(),
      (async () => {
        if (!readSessionWorkspaceFile(workspaceId, '.claw/TASKS.md')) {
          writeSessionWorkspaceFile(
            workspaceId,
            '.claw/TASKS.md',
            Buffer.from(
              `# Tasks

## TODO
- [ ] Start working on the mission
- [ ] Research and gather information
- [ ] Process and analyze findings
- [ ] Send results to user
- [ ] Write final report

## IN PROGRESS

## DONE
`,
              'utf-8'
            )
          );
        }
      })(),
      (async () => {
        if (!readSessionWorkspaceFile(workspaceId, '.claw/MEMORY.md')) {
          writeSessionWorkspaceFile(
            workspaceId,
            '.claw/MEMORY.md',
            Buffer.from(
              `# Memory

Persistent notes across cycles. Write findings, decisions, and context here.
The claw reads this every cycle to maintain continuity.

## Findings

## Decisions

## Context
`,
              'utf-8'
            )
          );
        }
      })(),
      (async () => {
        if (!readSessionWorkspaceFile(workspaceId, '.claw/LOG.md')) {
          writeSessionWorkspaceFile(
            workspaceId,
            '.claw/LOG.md',
            Buffer.from(
              `# Execution Log

Append cycle summaries here for a running log of what happened.
`,
              'utf-8'
            )
          );
        }
      })(),
    ]);
  } catch (err) {
    log.warn(`Failed to scaffold .claw/ dir: ${getErrorMessage(err)}`);
  }
}
