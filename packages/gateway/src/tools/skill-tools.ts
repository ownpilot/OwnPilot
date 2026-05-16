/**
 * Skill Tools — Public Entry Point
 *
 * Dispatch surface for the 14 Skill AI-callable tools (search, install,
 * introspect, learn). Definitions live in `./skill/definitions.ts`; executor
 * implementations are grouped by concern:
 *
 *   lifecycle-executors.ts     — search, install, list_installed, get_info,
 *                                toggle, check_updates
 *   introspection-executors.ts — parse_content, read_reference, read_script,
 *                                list_resources
 *   learning-executors.ts      — record_usage, get_learning_stats, compare,
 *                                suggest_learning
 *   helpers.ts                 — resolveSkillDirectory + node_modules walker
 */

import { SKILL_TOOLS } from './skill/definitions.js';
import {
  executeSearch,
  executeInstall,
  executeListInstalled,
  executeGetInfo,
  executeToggle,
  executeCheckUpdates,
} from './skill/lifecycle-executors.js';
import {
  executeParseContent,
  executeReadReference,
  executeReadScript,
  executeListResources,
} from './skill/introspection-executors.js';
import {
  executeRecordUsage,
  executeGetLearningStats,
  executeCompare,
  executeSuggestLearning,
} from './skill/learning-executors.js';

export { SKILL_TOOLS };

export async function executeSkillTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  switch (toolName) {
    case 'skill_search':
      return executeSearch(args);

    case 'skill_install':
      return executeInstall(args, userId);

    case 'skill_list_installed':
      return executeListInstalled(args);

    case 'skill_get_info':
      return executeGetInfo(args);

    case 'skill_toggle':
      return executeToggle(args, userId);

    case 'skill_check_updates':
      return executeCheckUpdates(userId);

    case 'skill_parse_content':
      return executeParseContent(args);

    case 'skill_read_reference':
      return executeReadReference(args);

    case 'skill_read_script':
      return executeReadScript(args);

    case 'skill_list_resources':
      return executeListResources(args);

    case 'skill_record_usage':
      return executeRecordUsage(args, userId);

    case 'skill_get_learning_stats':
      return executeGetLearningStats(args, userId);

    case 'skill_compare':
      return executeCompare(args, userId);

    case 'skill_suggest_learning':
      return executeSuggestLearning(args, userId);

    default:
      return { success: false, error: `Unknown skill tool: ${toolName}` };
  }
}
