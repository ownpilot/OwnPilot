/**
 * MCP Module — CLI tool integration via Model Context Protocol
 */

export {
  registerMcpForCli,
  registerMcpForAllClis,
  unregisterMcpForCli,
  getMcpConfigSnippet,
} from './register-cli-mcp.js';

export { createServer as createCliMcpServer, TOOLS as CLI_MCP_TOOLS } from './cli-mcp-server.js';

export { ensureWorkspace, createTempWorkspace, getWorkspaceDir } from './workspace.js';
export type { WorkspaceConfig, WorkspaceInfo } from './workspace.js';

export { buildToolContextBlock, injectToolContext } from './tool-context.js';
