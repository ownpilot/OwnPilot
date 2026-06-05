/**
 * Claw Trajectory Export — ShareGPT format.
 *
 * Converts a claw's execution history (claw_history) into ShareGPT-format
 * conversation trajectories suitable for evaluation or fine-tuning data, matching
 * Hermes Agent's batch-processing / trajectory-export capability. Pure and
 * dependency-free so it is trivially unit-testable.
 *
 * ShareGPT turns use the standard roles: `system` (mission), `human` (cycle
 * marker), `gpt` (assistant output and tool-call requests), and `tool` (tool
 * results). Each cycle becomes a human marker, the cycle's tool calls as
 * gpt(tool-call)/tool(result) pairs, then the cycle's final gpt message.
 */

import type { ClawConfig, ClawHistoryEntry } from '@ownpilot/core';

type ShareGPTRole = 'system' | 'human' | 'gpt' | 'tool';

interface ShareGPTTurn {
  from: ShareGPTRole;
  value: string;
}

interface ShareGPTTrajectory {
  id: string;
  mission: string;
  conversations: ShareGPTTurn[];
}

/** Cap a single turn's value so exported datasets stay bounded. */
const MAX_TURN_CHARS = 8000;

function clip(text: string): string {
  if (text.length <= MAX_TURN_CHARS) return text;
  return `${text.slice(0, MAX_TURN_CHARS - 1)}…`;
}

function resultToString(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * Build a ShareGPT trajectory from a claw's config + history entries. Entries
 * may arrive in any order (the repo returns newest-first); they are sorted by
 * cycle number ascending so the conversation reads chronologically.
 */
export function toShareGPT(
  config: Pick<ClawConfig, 'id' | 'name' | 'mission'>,
  entries: ClawHistoryEntry[]
): ShareGPTTrajectory {
  const conversations: ShareGPTTurn[] = [
    {
      from: 'system',
      value: clip(
        `You are "${config.name}", an autonomous Claw agent.\n\nMission: ${config.mission}`
      ),
    },
  ];

  const ordered = [...entries].sort((a, b) => a.cycleNumber - b.cycleNumber);

  for (const entry of ordered) {
    conversations.push({ from: 'human', value: `Cycle ${entry.cycleNumber}` });

    for (const tc of entry.toolCalls ?? []) {
      conversations.push({
        from: 'gpt',
        value: clip(JSON.stringify({ tool: tc.tool, arguments: tc.args ?? {} })),
      });
      conversations.push({ from: 'tool', value: clip(resultToString(tc.result)) });
    }

    if (entry.outputMessage && entry.outputMessage.trim()) {
      conversations.push({ from: 'gpt', value: clip(entry.outputMessage) });
    } else if (entry.error) {
      conversations.push({ from: 'gpt', value: clip(`[error] ${entry.error}`) });
    }
  }

  return { id: config.id, mission: config.mission, conversations };
}
