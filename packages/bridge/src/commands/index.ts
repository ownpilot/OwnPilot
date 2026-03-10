/**
 * Command Interceptor — Entry Point
 *
 * Imports handler files (triggering self-registration via side effects)
 * and re-exports the public API for use by router.ts.
 */

// Handler imports trigger command registration at module load time.
// Order doesn't matter — all registrations are synchronous.
import './handlers/info.ts';
import './handlers/session.ts';
import './handlers/config.ts';

export { commandRegistry, tryInterceptCommand, syntheticStream } from './registry.ts';
export type {
  CommandDefinition,
  CommandContext,
  CommandResult,
  CommandHandler,
  ParsedCommand,
  SessionConfigOverrides,
} from './types.ts';
