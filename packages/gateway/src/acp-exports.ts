/**
 * ACP (Agent Client Protocol) sub-path.
 *
 * Re-exports the ACP server entry point used by the CLI to expose OwnPilot
 * over JSON-RPC on stdio for external IDEs and integrations.
 */
export { runAcpServer, AcpServerAgent } from './acp/acp-server.js';
