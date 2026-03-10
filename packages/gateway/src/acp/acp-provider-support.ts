/**
 * ACP Provider Support
 *
 * Determines which coding agent providers support the ACP protocol
 * and builds the appropriate CLI arguments for ACP mode.
 */

import type { BuiltinCodingAgentProvider, CodingAgentProvider } from '@ownpilot/core';
import { isBuiltinProvider } from '@ownpilot/core';

// =============================================================================
// ACP SUPPORT DETECTION
// =============================================================================

/** Built-in providers that support ACP mode */
const ACP_SUPPORTED_PROVIDERS: Set<BuiltinCodingAgentProvider> = new Set([
  'gemini-cli',
  // 'claude-code' — when Claude Code adds --acp flag, add it here
  // 'codex' — when Codex adds ACP support, add it here
]);

/**
 * Check if a provider supports ACP protocol communication.
 */
export function isAcpSupported(provider: CodingAgentProvider): boolean {
  if (isBuiltinProvider(provider)) {
    return ACP_SUPPORTED_PROVIDERS.has(provider);
  }
  // Custom providers: not supported by default (would need explicit flag)
  return false;
}

/**
 * Build CLI arguments for launching a provider in ACP mode.
 * Returns null if the provider doesn't support ACP.
 */
export function buildAcpArgs(
  provider: CodingAgentProvider,
  options?: {
    model?: string;
    cwd?: string;
  }
): string[] | null {
  if (!isAcpSupported(provider)) return null;

  if (!isBuiltinProvider(provider)) return null;

  switch (provider) {
    case 'gemini-cli':
      return [
        '--experimental-acp',
        ...(options?.model ? ['--model', options.model] : []),
      ];

    case 'claude-code':
      // Future: when Claude Code supports --acp
      // return ['--acp', ...(options?.model ? ['--model', options.model] : [])];
      return null;

    case 'codex':
      // Future: when Codex supports ACP
      return null;

    default:
      return null;
  }
}

/**
 * Get the binary name for a provider (same as existing CLI_BINARIES).
 */
export function getAcpBinary(provider: BuiltinCodingAgentProvider): string {
  const binaries: Record<BuiltinCodingAgentProvider, string> = {
    'claude-code': 'claude',
    codex: 'codex',
    'gemini-cli': 'gemini',
  };
  return binaries[provider];
}
