/**
 * Claw Tools — Public Entry Point
 *
 * This file is the dispatch surface for the 16 Claw AI-callable tools.
 * All tool definitions live in `./claw/definitions.ts`, executor
 * implementations are grouped by concern under `./claw/`:
 *
 *   lifecycle-executors.ts   — claw_install_package, claw_run_script, claw_create_tool
 *   delegation-executors.ts  — claw_spawn_subclaw, claw_list_subclaws, claw_stop_subclaw,
 *                              claw_send_agent_message
 *   output-executors.ts      — claw_publish_artifact, claw_send_output,
 *                              claw_complete_report, claw_request_escalation,
 *                              claw_emit_event
 *   context-executors.ts     — claw_set_context, claw_get_context, claw_reflect,
 *                              claw_update_config
 *
 * The separate `get_claw_status` and `get_claw_history` management tools live
 * in `./claw-management-tools.ts` and are exposed alongside CLAW_TOOLS by
 * `agent-tool-registry.ts`.
 */

import { getErrorMessage } from '@ownpilot/core';
import { CLAW_TOOLS, CLAW_TOOL_NAMES } from './claw/definitions.js';
import { buildSandboxEnv } from './claw/sandbox-env.js';
import {
  executeInstallPackage,
  executeRunScript,
  executeCreateTool,
} from './claw/lifecycle-executors.js';
import {
  executeSpawnSubclaw,
  executeListSubclaws,
  executeStopSubclaw,
  executeSendAgentMessage,
} from './claw/delegation-executors.js';
import {
  executePublishArtifact,
  executeRequestEscalation,
  executeSendOutput,
  executeCompleteReport,
  executeEmitEvent,
} from './claw/output-executors.js';
import {
  executeSetContext,
  executeGetContext,
  executeReflect,
  executeUpdateConfig,
} from './claw/context-executors.js';

// Public interface — re-exported so existing importers
// (`@ownpilot/gateway` → tools/index.ts, agent-tool-registry.ts) keep working.
export { CLAW_TOOLS, CLAW_TOOL_NAMES, buildSandboxEnv };

export async function executeClawTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    switch (toolName) {
      case 'claw_install_package':
        return await executeInstallPackage(args, userId);

      case 'claw_run_script':
        return await executeRunScript(args, userId);

      case 'claw_create_tool':
        return await executeCreateTool(args);

      case 'claw_spawn_subclaw':
        return await executeSpawnSubclaw(args, userId);

      case 'claw_publish_artifact':
        return await executePublishArtifact(args, userId);

      case 'claw_request_escalation':
        return await executeRequestEscalation(args);

      case 'claw_send_output':
        return await executeSendOutput(args, userId);

      case 'claw_complete_report':
        return await executeCompleteReport(args, userId);

      case 'claw_emit_event':
        return await executeEmitEvent(args);

      case 'claw_update_config':
        return await executeUpdateConfig(args, userId);

      case 'claw_send_agent_message':
        return await executeSendAgentMessage(args, userId);

      case 'claw_reflect':
        return await executeReflect(args);

      case 'claw_list_subclaws':
        return await executeListSubclaws(userId);

      case 'claw_stop_subclaw':
        return await executeStopSubclaw(args, userId);

      case 'claw_set_context':
        return await executeSetContext(args);

      case 'claw_get_context':
        return await executeGetContext();

      default:
        return { success: false, error: `Unknown claw tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
